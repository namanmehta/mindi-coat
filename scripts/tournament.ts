// Bot strength check: two teams of bots play full matches; seats swap halfway for fairness.
// Usage: npx tsx scripts/tournament.ts [matches] [teamA] [teamB]   (kinds: hard, policy, random)
import { newSitting, startHand, nameTrump, goBlind, pickBlind, playCard, legalMoves, Seat, Sitting } from '../engine/engine';
import { botAct, policyAct, botViewFor, BotAction } from '../engine/bot';

function mulberry32(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
type Kind = 'hard' | 'policy' | 'random';

export function decide(kind: Kind, s: Sitting, seat: Seat, rng: () => number, budgetMs: number): BotAction {
  const h = s.hand!;
  const v = botViewFor(h, seat);
  if (kind === 'hard') return botAct(v, rng, budgetMs >= 250 ? { budgetMs } : { budgetMs, minSamples: 16, maxSamples: 120 });
  if (kind === 'policy') return policyAct(v, rng);
  if (h.phase === 'choosing') return rng() < 0.5 ? { type: 'blind' } : { type: 'name', suit: (['S', 'H', 'D', 'C'] as const)[(rng() * 4) | 0] };
  if (h.phase === 'blind') return { type: 'pick', index: (rng() * 8) | 0 };
  const L = legalMoves(h, seat);
  return { type: 'play', card: L[(rng() * L.length) | 0] };
}

export function playMatch(kinds: [Kind, Kind], chooser: Seat, seed: number, budgetMs = 40) {
  const rng = mulberry32(seed);
  let s = startHand(newSitting(rng, chooser), rng);
  let moves = 0, ms = 0;
  while (s.hand!.phase !== 'done') {
    const h = s.hand!;
    const seat = (h.phase === 'playing' ? h.turn : h.chooser) as Seat;
    const kind = kinds[seat % 2];
    const t = Date.now();
    const a = decide(kind, s, seat, rng, budgetMs);
    if (kind === 'hard') { ms += Date.now() - t; moves++; }
    if (a.type === 'name') s = nameTrump(s, seat, a.suit);
    else if (a.type === 'blind') s = goBlind(s, seat);
    else if (a.type === 'pick') s = pickBlind(s, seat, a.index);
    else s = playCard(s, seat, a.card);
  }
  return { winner: s.hand!.result!.winner, moves, ms };
}

if (process.argv[1]?.endsWith('tournament.ts')) {
  const n = Number(process.argv[2] ?? 100);
  const A = (process.argv[3] ?? 'hard') as Kind, B = (process.argv[4] ?? 'policy') as Kind;
  let winsA = 0, moves = 0, ms = 0;
  for (let i = 0; i < n; i++) {
    // swap which team each kind sits on, and rotate the chooser, so luck evens out
    const swap = i % 2 === 1;
    const r = playMatch(swap ? [B, A] : [A, B], (i % 4) as Seat, 1000 + Math.floor(i / 2), Number(process.env.BUDGET ?? 40));
    if ((r.winner === 0) !== swap) winsA++;
    moves += r.moves; ms += r.ms;
  }
  console.log(`${A} vs ${B}: ${A} won ${winsA}/${n} (${(100 * winsA / n).toFixed(1)}%)` + (moves ? `, avg ${(ms / moves).toFixed(1)} ms per hard decision` : ''));
}
