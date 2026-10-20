import { describe, it, expect } from 'vitest';
import {
  Card, Seat, Sitting, newSitting, startHand, nameTrump, goBlind, pickBlind, playCard, legalMoves, SUITS, cardId,
} from './engine';
import { botAct, botViewFor, sampleDeal, BotAction } from './bot';
import { playMatch } from '../scripts/tournament';

function mulberry32(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const FAST = { budgetMs: 5, minSamples: 6, maxSamples: 12 };

function apply(s: Sitting, seat: Seat, a: BotAction): Sitting {
  if (a.type === 'name') return nameTrump(s, seat, a.suit);
  if (a.type === 'blind') return goBlind(s, seat);
  if (a.type === 'pick') return pickBlind(s, seat, a.index);
  return playCard(s, seat, a.card);
}
const actor = (s: Sitting) => (s.hand!.phase === 'playing' ? s.hand!.turn : s.hand!.chooser) as Seat;

describe('bot', () => {
  it('every bot action is legal, all four seats, many matches', () => {
    const rng = mulberry32(3);
    let s = newSitting(rng);
    for (let m = 0; m < 25; m++) {
      s = startHand(s, rng);
      while (s.hand!.phase !== 'done') {
        const seat = actor(s);
        const a = botAct(botViewFor(s.hand!, seat), rng, FAST);
        if (a.type === 'play') expect(legalMoves(s.hand!, seat).some((c) => c.r === a.card.r && c.s === a.card.s)).toBe(true);
        s = apply(s, seat, a); // throws on anything illegal
      }
      if (s.seriesWinner !== null) break;
    }
    expect(s.results.length).toBeGreaterThan(0);
  });

  it('never sees hidden cards: its view holds only its own cards and public ones', () => {
    const rng = mulberry32(11);
    let s = startHand(newSitting(rng, 0), rng);
    s = pickBlind(goBlind(s, 0), 0, 2);
    for (let k = 0; k < 9; k++) { const seat = actor(s); s = playCard(s, seat, legalMoves(s.hand!, seat)[0]); }
    const h = s.hand!;
    const botSeat = h.turn;
    const v = botViewFor(h, botSeat);
    const allowed = new Set([
      ...h.hands[botSeat].map(cardId),
      ...h.history.flatMap((t) => t.plays.map((p) => cardId(p.card))),
      ...h.trick.map((p) => cardId(p.card)),
      cardId(h.blindCard!),
    ]);
    const cardsIn = JSON.stringify(v).match(/\{"s":"[SHDC]","r":\d+\}/g)!.map((x) => { const c = JSON.parse(x); return cardId(c); });
    for (const c of cardsIn) expect(allowed.has(c)).toBe(true);
  });

  it('decision is unchanged when the other players\' hidden cards are reshuffled', () => {
    const rng = mulberry32(21);
    let s = startHand(newSitting(rng, 1), rng);
    s = nameTrump(s, 1, 'H');
    for (let k = 0; k < 6; k++) { const seat = actor(s); s = playCard(s, seat, legalMoves(s.hand!, seat)[0]); }
    const h = s.hand!;
    const me = h.turn;
    // swap hidden cards between the other three players, keeping their counts
    const others = ([0, 1, 2, 3] as Seat[]).filter((p) => p !== me);
    const pool = others.flatMap((p) => h.hands[p]);
    const shuffled = pool.slice().reverse();
    const hands = h.hands.map((c) => c.slice());
    let k = 0;
    for (const p of others) hands[p] = shuffled.slice(k, (k += h.hands[p].length));
    const altered = { ...h, hands };
    expect(botViewFor(altered, me)).toEqual(botViewFor(h, me));
    const a1 = botAct(botViewFor(h, me), mulberry32(5), FAST);
    const a2 = botAct(botViewFor(altered, me), mulberry32(5), FAST);
    expect(a2).toEqual(a1);
  });

  it('imagined deals respect what is public: counts, shown-out suits, the blind card', () => {
    const rng = mulberry32(8);
    for (let trial = 0; trial < 20; trial++) {
      let s = startHand(newSitting(rng, 2), rng);
      s = pickBlind(goBlind(s, 2), 2, (rng() * 8) | 0);
      for (let k = 0; k < 10 + (trial % 8); k++) { const seat = actor(s); if (s.hand!.phase !== 'playing') break; s = playCard(s, seat, legalMoves(s.hand!, seat)[(rng() * legalMoves(s.hand!, seat).length) | 0]); }
      if (s.hand!.phase !== 'playing') continue;
      const v = botViewFor(s.hand!, s.hand!.turn);
      // suits each seat has shown out of
      const voids = [0, 1, 2, 3].map(() => new Set<string>());
      for (const plays of [...v.history.map((t) => t.plays), v.trick]) {
        if (!plays.length) continue;
        for (const p of plays.slice(1)) if (p.card.s !== plays[0].card.s) voids[p.seat].add(plays[0].card.s);
      }
      for (let d = 0; d < 10; d++) {
        const deal = sampleDeal(v, rng)!;
        expect(deal).not.toBeNull();
        deal.forEach((h, p) => expect(h.length).toBe(v.handCounts[p]));
        for (const p of [0, 1, 2, 3]) if (p !== v.seat) for (const id of deal[p]) expect(voids[p].has(SUITS[(id / 13) | 0])).toBe(false);
        const blindId = SUITS.indexOf(v.blindCard!.s) * 13 + v.blindCard!.r - 2;
        const blindPlayed = v.history.some((t) => t.plays.some((p) => cardId(p.card) === cardId(v.blindCard!))) || v.trick.some((p) => cardId(p.card) === cardId(v.blindCard!));
        if (!blindPlayed && v.seat !== v.chooser) expect(deal[v.chooser]).toContain(blindId);
      }
    }
  });

  it('strategy alone beats random play by a wide margin', () => {
    let wins = 0;
    const n = 120;
    for (let i = 0; i < n; i++) {
      const swap = i % 2 === 1;
      const r = playMatch(swap ? ['random', 'policy'] : ['policy', 'random'], (i % 4) as Seat, 500 + (i >> 1));
      if ((r.winner === 0) !== swap) wins++;
    }
    expect(wins / n).toBeGreaterThan(0.75);
  });

  it('hard (look-ahead) beats strategy alone on identical deals', () => {
    let wins = 0;
    const n = 80;
    for (let i = 0; i < n; i++) {
      const swap = i % 2 === 1;
      const r = playMatch(swap ? ['policy', 'hard'] : ['hard', 'policy'], (i % 4) as Seat, 900 + (i >> 1), 20);
      if ((r.winner === 0) !== swap) wins++;
    }
    expect(wins / n).toBeGreaterThan(0.6);
  }, 120000);
});
