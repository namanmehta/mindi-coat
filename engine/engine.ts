// Mindi Coat rules engine. Implements RULES.md. Pure: no I/O, no globals.
// Every action returns a new state or throws a RuleError.

export type Suit = 'S' | 'H' | 'D' | 'C';
export const SUITS: Suit[] = ['S', 'H', 'D', 'C'];
export interface Card { s: Suit; r: number } // r: 2..14, 14 = Ace
export type Seat = 0 | 1 | 2 | 3; // play order: A1, B1, A2, B2
export type Team = 0 | 1; // 0 = Team A (seats 0,2), 1 = Team B (seats 1,3)

export const teamOf = (seat: number): Team => (seat % 2) as Team;
export const rightOf = (seat: number): Seat => ((seat + 1) % 4) as Seat;
export const partnerOf = (seat: number): Seat => ((seat + 2) % 4) as Seat;
export const cardId = (c: Card) => `${c.r}${c.s}`;
export const sameCard = (a: Card, b: Card) => a.s === b.s && a.r === b.r;

export class RuleError extends Error {}

export type Phase = 'choosing' | 'blind' | 'playing' | 'done';

export interface Play { seat: Seat; card: Card }

export interface HandResult {
  winner: Team;
  early: boolean; // stopped before all 13 tricks
}

export interface HandState {
  handNo: number;
  chooser: Seat;
  dealer: Seat; // flavor only: the seat whose right is the chooser
  phase: Phase;
  hands: Card[][]; // cards currently held
  pending: Card[][]; // second-deal cards not yet given (8 each)
  trump: Suit | null;
  blind: boolean;
  blindCard: Card | null;
  turn: Seat;
  trick: Play[];
  lastTrick: { plays: Play[]; winner: Seat } | null;
  /** every finished hand this match, in order: public, everyone saw these cards */
  history: { plays: Play[]; winner: Seat }[];
  tricks: [number, number];
  tens: [number, number];
  /** which ten went to which team, in capture order */
  tensTaken: { suit: Suit; team: Team }[];
  tricksPlayed: number;
  result: HandResult | null;
}

export interface ResultRow {
  handNo: number;
  chooser: Seat;
  trump: Suit;
  blind: boolean;
  winner: Team;
  tens: [number, number];
  tricks: [number, number];
  early: boolean;
  series: number;
}

export interface Sitting {
  nextChooser: Seat;
  /** matches won in the current series */
  handsWon: [number, number];
  results: ResultRow[];
  hand: HandState | null;
  /** matches needed to win a series (4 = best of 7); null = no limit, just keep counting */
  target: number | null;
  seriesNo: number;
  seriesWon: [number, number];
  /** set when a team reaches the target; cleared by newSeries */
  seriesWinner: Team | null;
}

export type Rng = () => number;

export function newDeck(): Card[] {
  const d: Card[] = [];
  for (const s of SUITS) for (let r = 2; r <= 14; r++) d.push({ s, r });
  return d;
}

export function shuffle<T>(arr: T[], rng: Rng): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Start a sitting. The toss picks the first chooser at random. */
export function newSitting(rng: Rng, firstChooser?: Seat, target: number | null = null): Sitting {
  const chooser = firstChooser ?? (Math.floor(rng() * 4) as Seat);
  if (target !== null && (!Number.isInteger(target) || target < 1)) throw new RuleError('Invalid series length');
  return {
    nextChooser: chooser, handsWon: [0, 0], results: [], hand: null,
    target, seriesNo: 1, seriesWon: [0, 0], seriesWinner: null,
  };
}

/** After a series is won, reset the match count and start the next series. */
export function newSeries(sitting: Sitting): Sitting {
  if (sitting.seriesWinner === null) throw new RuleError('The series is not over yet');
  return { ...sitting, handsWon: [0, 0], seriesNo: sitting.seriesNo + 1, seriesWinner: null, hand: null };
}

/** Deal a new hand: 5 cards each now, 8 each held back for the second deal. */
export function startHand(sitting: Sitting, rng: Rng, deck?: Card[]): Sitting {
  if (sitting.hand && sitting.hand.phase !== 'done') throw new RuleError('A hand is already in progress');
  if (sitting.seriesWinner !== null) throw new RuleError('The series is over. Start a new series.');
  const d = deck ?? shuffle(newDeck(), rng);
  if (d.length !== 52) throw new RuleError('Deck must have 52 cards');
  const chooser = sitting.nextChooser;
  // Deal starts with the chooser and goes around in play order.
  const order = [0, 1, 2, 3].map((i) => ((chooser + i) % 4) as Seat);
  const hands: Card[][] = [[], [], [], []];
  const pending: Card[][] = [[], [], [], []];
  let k = 0;
  for (let round = 0; round < 5; round++) for (const s of order) hands[s].push(d[k++]);
  for (let round = 0; round < 8; round++) for (const s of order) pending[s].push(d[k++]);
  const hand: HandState = {
    handNo: sitting.handsWon[0] + sitting.handsWon[1] + 1, // match number within the series
    chooser,
    dealer: ((chooser + 3) % 4) as Seat,
    phase: 'choosing',
    hands,
    pending,
    trump: null,
    blind: false,
    blindCard: null,
    turn: chooser,
    trick: [],
    lastTrick: null,
    history: [],
    tricks: [0, 0],
    tens: [0, 0],
    tensTaken: [],
    tricksPlayed: 0,
    result: null,
  };
  return { ...sitting, hand };
}

function requireHand(s: Sitting): HandState {
  if (!s.hand) throw new RuleError('No hand in progress');
  return s.hand;
}

function finishDeal(h: HandState): HandState {
  const hands = h.hands.map((c, i) => [...c, ...h.pending[i]]);
  return { ...h, hands, pending: [[], [], [], []], phase: 'playing', turn: h.chooser };
}

/** Chooser names a trump suit from their first 5 cards. */
export function nameTrump(sitting: Sitting, seat: Seat, suit: Suit): Sitting {
  const h = requireHand(sitting);
  if (h.phase !== 'choosing') throw new RuleError('Trump cannot be chosen now');
  if (seat !== h.chooser) throw new RuleError('Only the chooser picks trump');
  if (!SUITS.includes(suit)) throw new RuleError('Unknown suit');
  return { ...sitting, hand: finishDeal({ ...h, trump: suit }) };
}

/** Chooser decides to go blind: they will pick one of their 8 face-down cards. */
export function goBlind(sitting: Sitting, seat: Seat): Sitting {
  const h = requireHand(sitting);
  if (h.phase !== 'choosing') throw new RuleError('Cannot go blind now');
  if (seat !== h.chooser) throw new RuleError('Only the chooser can go blind');
  return { ...sitting, hand: { ...h, phase: 'blind', blind: true } };
}

/** Chooser taps face-down card `index` (0..7). Its suit becomes trump. */
export function pickBlind(sitting: Sitting, seat: Seat, index: number): Sitting {
  const h = requireHand(sitting);
  if (h.phase !== 'blind') throw new RuleError('Not picking a blind card now');
  if (seat !== h.chooser) throw new RuleError('Only the chooser picks the blind card');
  if (!Number.isInteger(index) || index < 0 || index >= h.pending[seat].length)
    throw new RuleError('Invalid card position');
  const card = h.pending[seat][index];
  return { ...sitting, hand: finishDeal({ ...h, trump: card.s, blindCard: card }) };
}

/** Cards `seat` may legally play right now. */
export function legalMoves(h: HandState, seat: Seat): Card[] {
  if (h.phase !== 'playing' || h.turn !== seat) return [];
  const hand = h.hands[seat];
  if (h.trick.length === 0) return hand.slice();
  const led = h.trick[0].card.s;
  const follow = hand.filter((c) => c.s === led);
  return follow.length ? follow : hand.slice(); // void: anything, trump optional
}

/** Winner of a complete or partial trick. */
export function trickWinner(plays: Play[], trump: Suit): Seat {
  const led = plays[0].card.s;
  let best = plays[0];
  for (const p of plays.slice(1)) {
    const b = best.card, c = p.card;
    if (c.s === trump && b.s !== trump) best = p;
    else if (c.s === b.s && c.r > b.r && (c.s === trump || c.s === led)) best = p;
  }
  return best.seat;
}

/** Hand result if it is locked, else null. */
export function lockedWinner(tens: [number, number], tricks: [number, number]): Team | null {
  for (const t of [0, 1] as Team[]) {
    if (tens[t] >= 3) return t;
    if (tens[t] === 2 && tricks[t] >= 7) return t;
  }
  return null;
}

export function playCard(sitting: Sitting, seat: Seat, card: Card): Sitting {
  const h = requireHand(sitting);
  if (h.phase !== 'playing') throw new RuleError('Cards cannot be played now');
  if (seat !== h.turn) throw new RuleError('Not your turn');
  const hand = h.hands[seat];
  if (!hand.some((c) => sameCard(c, card))) throw new RuleError('You do not hold that card');
  if (!legalMoves(h, seat).some((c) => sameCard(c, card))) throw new RuleError('You must follow suit');

  const hands = h.hands.map((c, i) => (i === seat ? c.filter((x) => !sameCard(x, card)) : c));
  const trick = [...h.trick, { seat, card }];

  if (trick.length < 4) {
    return { ...sitting, hand: { ...h, hands, trick, turn: rightOf(seat) } };
  }

  // Trick complete.
  const winner = trickWinner(trick, h.trump!);
  const team = teamOf(winner);
  const tricks: [number, number] = [...h.tricks];
  const tens: [number, number] = [...h.tens];
  tricks[team]++;
  const newTens = trick.filter((p) => p.card.r === 10).map((p) => ({ suit: p.card.s, team }));
  tens[team] += newTens.length;
  const tensTaken = [...h.tensTaken, ...newTens];
  const tricksPlayed = h.tricksPlayed + 1;
  const won = lockedWinner(tens, tricks);

  let next: HandState = {
    ...h, hands, trick: [], lastTrick: { plays: trick, winner }, history: [...h.history, { plays: trick, winner }], tricks, tens, tensTaken, tricksPlayed, turn: winner,
  };
  if (won === null) {
    if (tricksPlayed === 13) throw new Error('Invariant: 13 tricks played without a result');
    return { ...sitting, hand: next };
  }

  const early = tricksPlayed < 13;
  next = { ...next, phase: 'done', result: { winner: won, early } };
  const handsWon: [number, number] = [...sitting.handsWon];
  handsWon[won]++;
  const row: ResultRow = {
    handNo: h.handNo, chooser: h.chooser, trump: h.trump!, blind: h.blind,
    winner: won, tens, tricks, early, series: sitting.seriesNo,
  };
  const seriesOver = sitting.target !== null && handsWon[won] >= sitting.target;
  const seriesWon: [number, number] = [...sitting.seriesWon];
  if (seriesOver) seriesWon[won]++;
  return {
    ...sitting,
    seriesWon,
    seriesWinner: seriesOver ? won : null,
    // Winning team chooses next: chooser's team won -> partner; lost -> player on chooser's right.
    nextChooser: won === teamOf(h.chooser) ? partnerOf(h.chooser) : rightOf(h.chooser),
    handsWon,
    results: [...sitting.results, row],
    hand: next,
  };
}

// ---------- What each player is allowed to see ----------

export interface PlayerView {
  you: Seat | null;
  handNo: number;
  chooser: Seat;
  dealer: Seat;
  phase: Phase;
  myHand: Card[];
  handCounts: number[];
  blindSlots: number; // face-down cards on offer to the chooser
  trump: Suit | null;
  blind: boolean;
  blindCard: Card | null;
  turn: Seat;
  trick: Play[];
  lastTrick: { plays: Play[]; winner: Seat } | null;
  tricks: [number, number];
  tens: [number, number];
  tensTaken: { suit: Suit; team: Team }[];
  result: HandResult | null;
  legal: Card[];
}

export const choosingPhase = (h: HandState) => h.phase === 'choosing' || h.phase === 'blind';

export function viewFor(h: HandState, seat: Seat | null): PlayerView {
  return {
    you: seat,
    handNo: h.handNo,
    chooser: h.chooser,
    dealer: h.dealer,
    phase: h.phase,
    // While trump is being chosen, only the chooser may see cards, so partners can't signal.
    myHand: seat === null || (choosingPhase(h) && seat !== h.chooser) ? [] : h.hands[seat],
    handCounts: h.hands.map((c) => c.length),
    blindSlots: h.phase === 'blind' && seat === h.chooser ? h.pending[seat].length : 0,
    trump: h.trump,
    blind: h.blind,
    blindCard: h.blindCard,
    turn: h.turn,
    trick: h.trick,
    lastTrick: h.lastTrick,
    tricks: h.tricks,
    tens: h.tens,
    tensTaken: h.tensTaken,
    result: h.result,
    legal: seat === null ? [] : legalMoves(h, seat),
  };
}
