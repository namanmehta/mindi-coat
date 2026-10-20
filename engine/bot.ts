// Mindi Coat bot (Hard).
//
// The bot is given a BotView: only what a human in its seat could know (its own cards, every
// card played so far, the revealed blind card, public counts). It never sees the full state.
//
// Card play: Monte Carlo over determinized deals. Sample many ways the unseen cards could be
// spread over the other three players, consistent with everything public (counts, cards played,
// who has shown out of which suit, where the blind card sits). For each legal card, play every
// sample to the end of the match with a strategy policy and keep the card that wins most often.
//
// Trump choice: same idea. Deal the unseen cards many ways, play each candidate trump (and the
// blind option) to the end, and pick the best.

import type { Card, HandState, Play, Seat, Suit } from './engine';
import { SUITS, lockedWinner } from './engine';

export interface BotView {
  seat: Seat;
  phase: 'choosing' | 'blind' | 'playing';
  hand: Card[];
  chooser: Seat;
  trump: Suit | null;
  blindCard: Card | null;
  blindSlots: number;
  turn: Seat;
  trick: Play[];
  history: { plays: Play[]; winner: Seat }[];
  handCounts: number[];
  tricks: [number, number];
  tens: [number, number];
}

export type BotAction =
  | { type: 'name'; suit: Suit }
  | { type: 'blind' }
  | { type: 'pick'; index: number }
  | { type: 'play'; card: Card };

const cp = <T>(x: T): T => JSON.parse(JSON.stringify(x));

/** Everything the bot may know, and nothing more. */
export function botViewFor(h: HandState, seat: Seat): BotView {
  if (h.phase === 'done') throw new Error('No decision in a finished match');
  return cp({
    seat,
    phase: h.phase,
    hand: h.hands[seat],
    chooser: h.chooser,
    trump: h.trump,
    blindCard: h.blindCard,
    blindSlots: h.phase === 'blind' && seat === h.chooser ? h.pending[seat].length : 0,
    turn: h.turn,
    trick: h.trick,
    history: h.history,
    handCounts: h.hands.map((c) => c.length),
    tricks: h.tricks,
    tens: h.tens,
  });
}

// ---------- fast simulator on integer cards: id = suitIndex * 13 + (rank - 2) ----------

const suitOf = (id: number) => (id / 13) | 0;
const rankOf = (id: number) => (id % 13) + 2;
const toId = (c: Card) => SUITS.indexOf(c.s) * 13 + (c.r - 2);
const toCard = (id: number): Card => ({ s: SUITS[suitOf(id)], r: rankOf(id) });

interface Sim {
  hands: number[][];
  trick: number[];
  trickSeats: number[];
  turn: number;
  trump: number;
  tens: [number, number];
  tricks: [number, number];
  played: Uint8Array; // 52 flags: card is out of everyone's hands
  done: number; // winning team, or -1
}

type Rng = () => number;

function cloneSim(s: Sim): Sim {
  return {
    hands: s.hands.map((h) => h.slice()), trick: s.trick.slice(), trickSeats: s.trickSeats.slice(),
    turn: s.turn, trump: s.trump, tens: [s.tens[0], s.tens[1]], tricks: [s.tricks[0], s.tricks[1]],
    played: s.played.slice(), done: s.done,
  };
}

function legal(s: Sim, seat: number): number[] {
  const h = s.hands[seat];
  if (s.trick.length === 0) return h;
  const led = suitOf(s.trick[0]);
  const f = h.filter((c) => suitOf(c) === led);
  return f.length ? f : h;
}

/** Index (into the trick) of the card currently winning. */
function winningIndex(trick: number[], trump: number): number {
  const led = suitOf(trick[0]);
  let best = 0;
  for (let i = 1; i < trick.length; i++) {
    const b = trick[best], c = trick[i];
    const cs = suitOf(c), bs = suitOf(b);
    if (cs === trump && bs !== trump) best = i;
    else if (cs === bs && rankOf(c) > rankOf(b) && (cs === trump || cs === led)) best = i;
  }
  return best;
}

function beats(c: number, w: number, led: number, trump: number): boolean {
  const cs = suitOf(c), ws = suitOf(w);
  if (cs === trump && ws !== trump) return true;
  if (cs === ws && rankOf(c) > rankOf(w) && (cs === trump || cs === led)) return true;
  return false;
}

function step(s: Sim, card: number): void {
  const seat = s.turn;
  const h = s.hands[seat];
  h.splice(h.indexOf(card), 1);
  s.trick.push(card);
  s.trickSeats.push(seat);
  if (s.trick.length < 4) { s.turn = (seat + 1) % 4; return; }
  const wi = winningIndex(s.trick, s.trump);
  const winner = s.trickSeats[wi];
  const team = winner % 2;
  s.tricks[team]++;
  for (const c of s.trick) { s.played[c] = 1; if (rankOf(c) === 10) s.tens[team]++; }
  s.trick = []; s.trickSeats = []; s.turn = winner;
  const w = lockedWinner(s.tens, s.tricks);
  if (w !== null) s.done = w;
}

/** Highest card of its suit still unplayed, apart from the holder's own cards? */
function isBoss(s: Sim, card: number, own: number[]): boolean {
  const su = suitOf(card);
  for (let r = rankOf(card) + 1; r <= 14; r++) {
    const id = su * 13 + (r - 2);
    if (!s.played[id] && !own.includes(id) && !s.trick.includes(id)) return false;
  }
  return true;
}

const lowest = (cs: number[]) => cs.reduce((a, b) => (rankOf(b) < rankOf(a) ? b : a));
const highest = (cs: number[]) => cs.reduce((a, b) => (rankOf(b) > rankOf(a) ? b : a));
const notTen = (c: number) => rankOf(c) !== 10;

/** Strategy used for every player inside simulations, and as the bot's fallback. */
function policy(s: Sim, rng: Rng, eps = 0.06): number {
  const seat = s.turn;
  const own = s.hands[seat];
  const L = legal(s, seat);
  if (L.length === 1) return L[0];
  if (rng() < eps) return L[(rng() * L.length) | 0];
  const T = s.trump;
  const isTrump = (c: number) => suitOf(c) === T;

  if (s.trick.length === 0) {
    const side = L.filter((c) => !isTrump(c));
    const bosses = side.filter((c) => notTen(c) && isBoss(s, c, own));
    if (bosses.length) return highest(bosses);
    // lead low from the longest side suit, never a ten if avoidable
    const pool = side.filter(notTen);
    if (pool.length) {
      const bySuit = new Map<number, number[]>();
      for (const c of pool) bySuit.set(suitOf(c), [...(bySuit.get(suitOf(c)) ?? []), c]);
      let best: number[] = [];
      for (const cs of bySuit.values()) if (cs.length > best.length) best = cs;
      return lowest(best);
    }
    const trumps = L.filter(isTrump);
    const tb = trumps.filter((c) => notTen(c) && isBoss(s, c, own));
    if (tb.length) return highest(tb);
    const nt = L.filter(notTen);
    return lowest(nt.length ? nt : L);
  }

  const led = suitOf(s.trick[0]);
  const wi = winningIndex(s.trick, T);
  const wCard = s.trick[wi];
  const wSeat = s.trickSeats[wi];
  const partnerWinning = wSeat === (seat + 2) % 4;
  const last = s.trick.length === 3;
  const tenOnTable = s.trick.some((c) => rankOf(c) === 10);
  const following = suitOf(L[0]) === led && L.every((c) => suitOf(c) === led);

  if (partnerWinning) {
    const safe = last || (isBoss(s, wCard, own) && (suitOf(wCard) === T || s.trick.length >= 2));
    if (safe) {
      const tens = L.filter((c) => rankOf(c) === 10 && !isTrump(c));
      if (tens.length) return tens[0];
      const tenT = L.filter((c) => rankOf(c) === 10);
      if (tenT.length && last) return tenT[0];
    }
    const pool = L.filter((c) => notTen(c) && !isTrump(c));
    if (pool.length) return lowest(pool);
    const p2 = L.filter(notTen);
    return lowest(p2.length ? p2 : L);
  }

  const beaters = L.filter((c) => beats(c, wCard, led, T));
  if (beaters.length) {
    if (following) {
      // win cheaply; only commit a ten when it cannot be overtaken
      const safeBeaters = beaters.filter((c) => notTen(c) || last || isBoss(s, c, own));
      if (safeBeaters.length) {
        const sure = safeBeaters.filter((c) => last || isBoss(s, c, own));
        if (tenOnTable || last) return lowest(sure.length ? sure : safeBeaters);
        if (sure.length) return lowest(sure);
        return lowest(safeBeaters);
      }
    } else {
      // void in the led suit: cut with trump when it is worth it
      const trumps = beaters.filter(isTrump);
      const myTrumps = own.filter(isTrump).length;
      if (trumps.length && (tenOnTable || last || myTrumps >= 3 || rng() < 0.35)) {
        const nt = trumps.filter(notTen);
        return lowest(nt.length ? nt : trumps);
      }
    }
  }
  // cannot (or should not) win: throw the cheapest card, keep tens and trumps
  const keep = L.filter((c) => notTen(c) && !isTrump(c));
  if (keep.length) return lowest(keep);
  const p2 = L.filter(notTen);
  return lowest(p2.length ? p2 : L);
}

function rollout(s: Sim, rng: Rng): void {
  let guard = 0;
  while (s.done < 0 && guard++ < 60) {
    if (s.hands[s.turn].length === 0) break;
    step(s, policy(s, rng));
  }
}

function score(s: Sim, team: number): number {
  if (s.done < 0) return 0.5;
  const won = s.done === team ? 1 : 0;
  return won + 0.02 * (s.tens[team] - s.tens[1 - team]) + 0.004 * (s.tricks[team] - s.tricks[1 - team]);
}

function shuffle<T>(a: T[], rng: Rng): T[] {
  for (let i = a.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** Suits each player has shown they are out of, from everything played in public. */
function knownVoids(v: BotView): boolean[][] {
  const voids = [0, 1, 2, 3].map(() => [false, false, false, false]);
  const tricks = [...v.history.map((t) => t.plays), v.trick];
  for (const plays of tricks) {
    if (!plays.length) continue;
    const led = SUITS.indexOf(plays[0].card.s);
    for (const p of plays.slice(1)) if (SUITS.indexOf(p.card.s) !== led) voids[p.seat][led] = true;
  }
  return voids;
}

/** One possible deal of the unseen cards, consistent with everything public. */
export function sampleDeal(v: BotView, rng: Rng): number[][] | null { return determinize(v, rng); }

function determinize(v: BotView, rng: Rng): number[][] | null {
  const me = v.seat;
  const seen = new Set<number>(v.hand.map(toId));
  for (const t of v.history) for (const p of t.plays) seen.add(toId(p.card));
  for (const p of v.trick) seen.add(toId(p.card));
  const hands: number[][] = [[], [], [], []];
  hands[me] = v.hand.map(toId);
  const need = v.handCounts.slice();
  need[me] = 0;
  // the revealed blind card is known to be in the chooser's hand until it is played
  if (v.blindCard && v.chooser !== me) {
    const id = toId(v.blindCard);
    if (!seen.has(id)) { hands[v.chooser].push(id); need[v.chooser]--; seen.add(id); }
  }
  const unseen: number[] = [];
  for (let id = 0; id < 52; id++) if (!seen.has(id)) unseen.push(id);
  const voids = knownVoids(v);
  const others = [0, 1, 2, 3].filter((p) => p !== me);

  for (let attempt = 0; attempt < 30; attempt++) {
    const cards = shuffle(unseen.slice(), rng);
    const left = need.slice();
    const out = hands.map((h) => h.slice());
    const eligible = (c: number) => others.filter((p) => left[p] > 0 && (attempt >= 25 || !voids[p][suitOf(c)]));
    // most constrained cards first
    cards.sort((a, b) => eligible(a).length - eligible(b).length);
    let ok = true;
    for (const c of cards) {
      const el = eligible(c);
      if (!el.length) { ok = false; break; }
      // weight by remaining space so counts fill evenly
      const total = el.reduce((n, p) => n + left[p], 0);
      let x = rng() * total, pick = el[0];
      for (const p of el) { x -= left[p]; if (x < 0) { pick = p; break; } }
      out[pick].push(c); left[pick]--;
    }
    if (ok && others.every((p) => left[p] === 0)) return out;
  }
  return null;
}

function simFrom(v: BotView, hands: number[][], trump: number): Sim {
  const played = new Uint8Array(52);
  for (const t of v.history) for (const p of t.plays) played[toId(p.card)] = 1;
  return {
    hands, trick: v.trick.map((p) => toId(p.card)), trickSeats: v.trick.map((p) => p.seat),
    turn: v.turn, trump, tens: [v.tens[0], v.tens[1]], tricks: [v.tricks[0], v.tricks[1]], played, done: -1,
  };
}

export interface BotOptions { budgetMs?: number; maxSamples?: number; minSamples?: number }

function chooseCard(v: BotView, rng: Rng, o: Required<BotOptions>): Card {
  const trump = SUITS.indexOf(v.trump!);
  const base = simFrom(v, [[], [], [], []], trump);
  base.hands[v.seat] = v.hand.map(toId);
  const moves = legal(base, v.seat);
  if (moves.length === 1) return toCard(moves[0]);
  const team = v.seat % 2;
  const totals = new Array(moves.length).fill(0);
  let n = 0;
  const t0 = Date.now();
  while (n < o.maxSamples && (n < o.minSamples || Date.now() - t0 < o.budgetMs)) {
    const deal = determinize(v, rng);
    if (!deal) break;
    const world = simFrom(v, deal, trump);
    for (let i = 0; i < moves.length; i++) {
      const s = cloneSim(world);
      step(s, moves[i]);
      rollout(s, rng);
      totals[i] += score(s, team);
    }
    n++;
  }
  if (n === 0) {
    const s = simFrom(v, [[], [], [], []], trump);
    s.hands[v.seat] = v.hand.map(toId);
    return toCard(policy(s, rng, 0));
  }
  let best = 0;
  for (let i = 1; i < moves.length; i++) if (totals[i] > totals[best]) best = i;
  return toCard(moves[best]);
}

function chooseTrump(v: BotView, rng: Rng, o: Required<BotOptions>): BotAction {
  const me = v.seat;
  const mine = v.hand.map(toId); // the five cards
  const rest: number[] = [];
  for (let id = 0; id < 52; id++) if (!mine.includes(id)) rest.push(id);
  const candidates = [0, 1, 2, 3, -1]; // four suits, then blind
  const totals = new Array(candidates.length).fill(0);
  const team = me % 2;
  let n = 0;
  const t0 = Date.now();
  const target = Math.max(o.minSamples, Math.min(o.maxSamples, 160));
  while (n < target && (n < o.minSamples || Date.now() - t0 < o.budgetMs * 1.5)) {
    const deck = shuffle(rest.slice(), rng);
    const myRest = deck.slice(0, 8);
    const hands: number[][] = [[], [], [], []];
    hands[me] = [...mine, ...myRest];
    let k = 8;
    for (const p of [0, 1, 2, 3]) if (p !== me) { hands[p] = deck.slice(k, k + 13); k += 13; }
    const blindSuit = suitOf(myRest[(rng() * 8) | 0]);
    for (let i = 0; i < candidates.length; i++) {
      const trump = candidates[i] < 0 ? blindSuit : candidates[i];
      const s: Sim = { hands: hands.map((h) => h.slice()), trick: [], trickSeats: [], turn: me, trump,
        tens: [0, 0], tricks: [0, 0], played: new Uint8Array(52), done: -1 };
      rollout(s, rng);
      totals[i] += score(s, team);
    }
    n++;
  }
  let best = 0;
  for (let i = 1; i < totals.length; i++) if (totals[i] > totals[best]) best = i;
  return candidates[best] < 0 ? { type: 'blind' } : { type: 'name', suit: SUITS[candidates[best]] };
}

/** The bot's move for this view. Throws if it is not the bot's decision to make. */
export function botAct(v: BotView, rng: Rng = Math.random, opts: BotOptions = {}): BotAction {
  const o: Required<BotOptions> = { budgetMs: 250, maxSamples: 400, minSamples: 24, ...opts };
  if (v.phase === 'choosing') {
    if (v.seat !== v.chooser) throw new Error('Not the chooser');
    return chooseTrump(v, rng, o);
  }
  if (v.phase === 'blind') {
    if (v.seat !== v.chooser) throw new Error('Not the chooser');
    return { type: 'pick', index: (rng() * v.blindSlots) | 0 }; // the cards are face down: any pick is a guess
  }
  if (v.turn !== v.seat) throw new Error('Not the bot\'s turn');
  return { type: 'play', card: chooseCard(v, rng, o) };
}

/** Plain strategy without lookahead (used to measure how much the search adds). */
export function policyAct(v: BotView, rng: Rng = Math.random): BotAction {
  if (v.phase === 'choosing') {
    // strongest suit in the five cards by length and honours; blind if nothing stands out
    const score = (s: Suit) => v.hand.filter((c) => c.s === s).reduce((n, c) => n + 2 + Math.max(0, c.r - 10), 0);
    const best = SUITS.reduce((a, b) => (score(b) > score(a) ? b : a));
    return score(best) >= 6 ? { type: 'name', suit: best } : { type: 'blind' };
  }
  if (v.phase === 'blind') return { type: 'pick', index: (rng() * v.blindSlots) | 0 };
  const s = simFrom(v, [[], [], [], []], SUITS.indexOf(v.trump!));
  s.hands[v.seat] = v.hand.map(toId);
  for (const t of v.history) for (const p of t.plays) s.played[toId(p.card)] = 1;
  return { type: 'play', card: toCard(policy(s, rng, 0)) };
}
