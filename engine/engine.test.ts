import { describe, it, expect } from 'vitest';
import {
  Card, Seat, Sitting, Suit, newDeck, newSitting, startHand, nameTrump, goBlind, pickBlind,
  playCard, legalMoves, trickWinner, lockedWinner, viewFor, cardId, RuleError, teamOf,
} from './engine';

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const c = (r: number, s: Suit): Card => ({ r, s });

describe('deck and deal', () => {
  it('has 52 unique cards', () => {
    const d = newDeck();
    expect(d.length).toBe(52);
    expect(new Set(d.map(cardId)).size).toBe(52);
  });

  it('deals 5 now and holds 8 back per player, all unique', () => {
    const s = startHand(newSitting(mulberry32(1), 0), mulberry32(2));
    const h = s.hand!;
    expect(h.hands.map((x) => x.length)).toEqual([5, 5, 5, 5]);
    expect(h.pending.map((x) => x.length)).toEqual([8, 8, 8, 8]);
    const all = [...h.hands.flat(), ...h.pending.flat()].map(cardId);
    expect(new Set(all).size).toBe(52);
  });

  it('dealer is the seat whose right is the chooser', () => {
    const s = startHand(newSitting(mulberry32(1), 2), mulberry32(2));
    expect(s.hand!.chooser).toBe(2);
    expect(s.hand!.dealer).toBe(1);
  });
});

describe('trump choice', () => {
  const base = () => startHand(newSitting(mulberry32(1), 1), mulberry32(3));

  it('only the chooser can name trump', () => {
    expect(() => nameTrump(base(), 0, 'H')).toThrow(RuleError);
  });

  it('naming trump deals the rest: 13 each, chooser leads', () => {
    const s = nameTrump(base(), 1, 'D');
    expect(s.hand!.trump).toBe('D');
    expect(s.hand!.hands.map((x) => x.length)).toEqual([13, 13, 13, 13]);
    expect(s.hand!.phase).toBe('playing');
    expect(s.hand!.turn).toBe(1);
  });

  it('any suit may be named, even one not held', () => {
    let s = base();
    const held = new Set(s.hand!.hands[1].map((x) => x.s));
    const missing = (['S', 'H', 'D', 'C'] as Suit[]).find((x) => !held.has(x));
    if (missing) expect(nameTrump(s, 1, missing).hand!.trump).toBe(missing);
  });

  it('cannot name trump twice', () => {
    const s = nameTrump(base(), 1, 'D');
    expect(() => nameTrump(s, 1, 'S')).toThrow(RuleError);
  });

  it('blind: picked card sets trump, stays in chooser hand, revealed to all', () => {
    let s = goBlind(base(), 1);
    expect(viewFor(s.hand!, 1).blindSlots).toBe(8);
    expect(viewFor(s.hand!, 0).blindSlots).toBe(0);
    const target = s.hand!.pending[1][5];
    s = pickBlind(s, 1, 5);
    expect(s.hand!.trump).toBe(target.s);
    expect(s.hand!.blind).toBe(true);
    expect(s.hand!.blindCard).toEqual(target);
    expect(s.hand!.hands[1].some((x) => x.s === target.s && x.r === target.r)).toBe(true);
    expect(viewFor(s.hand!, 3).blindCard).toEqual(target);
    expect(s.hand!.hands.map((x) => x.length)).toEqual([13, 13, 13, 13]);
  });

  it('blind: cannot name trump after going blind, bad index rejected', () => {
    const s = goBlind(base(), 1);
    expect(() => nameTrump(s, 1, 'H')).toThrow(RuleError);
    expect(() => pickBlind(s, 1, 8)).toThrow(RuleError);
    expect(() => pickBlind(s, 0, 0)).toThrow(RuleError);
  });

  it('views never leak other hands or pending cards', () => {
    const s = goBlind(base(), 1);
    const v = viewFor(s.hand!, 0);
    expect(v.myHand.length).toBe(5);
    expect(JSON.stringify(v)).not.toContain('pending');
    expect(v.handCounts).toEqual([5, 5, 5, 5]);
  });
});

describe('trick resolution', () => {
  it('highest of led suit wins with no trump', () => {
    expect(trickWinner([
      { seat: 0, card: c(9, 'H') }, { seat: 1, card: c(14, 'S') },
      { seat: 2, card: c(13, 'H') }, { seat: 3, card: c(2, 'H') },
    ], 'D')).toBe(2);
  });
  it('any trump beats the led suit; highest trump wins', () => {
    expect(trickWinner([
      { seat: 0, card: c(14, 'H') }, { seat: 1, card: c(2, 'D') },
      { seat: 2, card: c(13, 'H') }, { seat: 3, card: c(5, 'D') },
    ], 'D')).toBe(3);
  });
  it('off-suit non-trump never wins, even if high', () => {
    expect(trickWinner([
      { seat: 0, card: c(3, 'C') }, { seat: 1, card: c(14, 'S') },
      { seat: 2, card: c(14, 'H') }, { seat: 3, card: c(2, 'C') },
    ], 'D')).toBe(0);
  });
  it('trump led: highest trump wins', () => {
    expect(trickWinner([
      { seat: 0, card: c(10, 'D') }, { seat: 1, card: c(12, 'D') },
      { seat: 2, card: c(14, 'S') }, { seat: 3, card: c(11, 'D') },
    ], 'D')).toBe(1);
  });
});

describe('hand lock rule', () => {
  it('3 or 4 tens wins', () => {
    expect(lockedWinner([3, 0], [3, 2])).toBe(0);
    expect(lockedWinner([0, 4], [1, 4])).toBe(1);
  });
  it('2 tens needs 7 tricks', () => {
    expect(lockedWinner([2, 1], [6, 5])).toBe(null);
    expect(lockedWinner([2, 1], [7, 4])).toBe(0);
    expect(lockedWinner([2, 2], [6, 7])).toBe(1);
  });
  it('7 tricks without 2 tens is not locked', () => {
    expect(lockedWinner([1, 1], [7, 2])).toBe(null);
  });
});

describe('follow suit', () => {
  // Hand-built deal: we control every card so the test is exact.
  function fixedSitting(): Sitting {
    // Deal order from chooser 0: seats 0,1,2,3 each round, 5 rounds then 8 rounds.
    // Build hands by seat, then interleave into a deck.
    const want: Card[][] = [[], [], [], []];
    const suits: Suit[] = ['S', 'H', 'D', 'C'];
    // Seat k gets all 13 cards of suit k, except seat 1 swaps one heart for a spade.
    suits.forEach((s, k) => { for (let r = 2; r <= 14; r++) want[k].push(c(r, s)); });
    // swap 2S (seat 0) with 2H (seat 1)
    want[0][0] = c(2, 'H'); want[1][0] = c(2, 'S');
    const deck: Card[] = [];
    for (let i = 0; i < 5; i++) for (let s = 0; s < 4; s++) deck.push(want[s][i]);
    for (let i = 5; i < 13; i++) for (let s = 0; s < 4; s++) deck.push(want[s][i]);
    return nameTrump(startHand(newSitting(mulberry32(1), 0), mulberry32(1), deck), 0, 'C');
  }

  it('must follow when able', () => {
    let s = fixedSitting();
    s = playCard(s, 0, c(14, 'S'));
    // Seat 1 holds 2S and must play it.
    expect(legalMoves(s.hand!, 1)).toEqual([c(2, 'S')]);
    expect(() => playCard(s, 1, c(14, 'H'))).toThrow('You must follow suit');
    s = playCard(s, 1, c(2, 'S'));
    // Seat 2 has no spades: anything goes, trump optional.
    expect(legalMoves(s.hand!, 2).length).toBe(13);
  });

  it('rejects out of turn and cards not held', () => {
    const s = fixedSitting();
    expect(() => playCard(s, 1, c(2, 'S'))).toThrow('Not your turn');
    expect(() => playCard(s, 0, c(14, 'D'))).toThrow('You do not hold that card');
  });
});

describe('fuzz: random full hands', () => {
  it('every hand resolves, invariants hold, chooser rotates right', () => {
    const rng = mulberry32(42);
    let s = newSitting(rng);
    let early = 0, blind = 0;
    for (let n = 0; n < 3000; n++) {
      const chooser = s.nextChooser;
      s = startHand(s, rng);
      expect(s.hand!.chooser).toBe(chooser);
      if (rng() < 0.3) {
        s = pickBlind(goBlind(s, chooser), chooser, Math.floor(rng() * 8));
        blind++;
      } else {
        s = nameTrump(s, chooser, (['S', 'H', 'D', 'C'] as Suit[])[Math.floor(rng() * 4)]);
      }
      let guard = 0;
      while (s.hand!.phase === 'playing') {
        const h = s.hand!;
        const moves = legalMoves(h, h.turn);
        expect(moves.length).toBeGreaterThan(0);
        // only the player on turn has moves
        for (const other of [0, 1, 2, 3] as Seat[]) if (other !== h.turn) expect(legalMoves(h, other)).toEqual([]);
        s = playCard(s, h.turn, moves[Math.floor(rng() * moves.length)]);
        expect(++guard).toBeLessThanOrEqual(52);
      }
      const h = s.hand!;
      const row = s.results[s.results.length - 1];
      expect(h.result).not.toBeNull();
      expect(row.winner).toBe(h.result!.winner);
      expect(h.tens[0] + h.tens[1]).toBeLessThanOrEqual(4);
      expect(h.tricks[0] + h.tricks[1]).toBe(h.tricksPlayed);
      expect(lockedWinner(h.tens, h.tricks)).toBe(h.result!.winner);
      // conservation of cards: held + played = 52
      const held = h.hands.flat().length;
      expect(held + h.tricksPlayed * 4).toBe(52);
      if (h.result!.early) early++; else expect(h.tricksPlayed).toBe(13);
      expect(s.nextChooser).toBe((chooser + 1) % 4);
    }
    expect(s.handsWon[0] + s.handsWon[1]).toBe(3000);
    expect(s.results.length).toBe(3000);
    expect(early).toBeGreaterThan(0);
    expect(blind).toBeGreaterThan(0);
    // sanity: team assignment
    expect([0, 1, 2, 3].map(teamOf)).toEqual([0, 1, 0, 1]);
  });

  it('cannot start a new hand while one is in progress', () => {
    const rng = mulberry32(7);
    const s = startHand(newSitting(rng), rng);
    expect(() => startHand(s, rng)).toThrow(RuleError);
  });
});
