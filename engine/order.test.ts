import { describe, it, expect } from 'vitest';
import { suitOrderFor, sortHand } from './order';
import type { Card, Suit } from './engine';

const hand = (suits: string) => [...suits].map((s, i) => ({ s: s as Suit, r: 2 + i }));
const red = (s: Suit) => s === 'H' || s === 'D';

describe('hand order: red and black alternate', () => {
  it('all four suits: hearts, spades, diamonds, clubs', () => {
    expect(suitOrderFor(hand('CDSH'))).toEqual(['H', 'S', 'D', 'C']);
  });
  it('missing diamonds: spades and clubs are split by hearts', () => {
    expect(suitOrderFor(hand('HSC'))).toEqual(['S', 'H', 'C']);
  });
  it('missing hearts: diamonds sits between the black suits', () => {
    expect(suitOrderFor(hand('SDC'))).toEqual(['S', 'D', 'C']);
  });
  it('one red, one black: base order', () => {
    expect(suitOrderFor(hand('CH'))).toEqual(['H', 'C']);
  });
  it('only red suits cannot alternate: base order kept', () => {
    expect(suitOrderFor(hand('DH'))).toEqual(['H', 'D']);
  });
  it('every possible suit mix alternates whenever it can', () => {
    const all: Suit[] = ['H', 'S', 'D', 'C'];
    for (let mask = 1; mask < 16; mask++) {
      const present = all.filter((_, i) => mask & (1 << i));
      const order = suitOrderFor(hand(present.join('')));
      expect(order.sort()).toEqual([...present].sort());
      const o = suitOrderFor(hand(present.join('')));
      const reds = present.filter(red).length, blacks = present.length - reds;
      if (Math.abs(reds - blacks) <= 1) for (let i = 1; i < o.length; i++) expect(red(o[i])).not.toBe(red(o[i - 1]));
    }
  });
  it('sorts by suit order then rank', () => {
    const h: Card[] = [{ s: 'C', r: 14 }, { s: 'H', r: 3 }, { s: 'C', r: 2 }, { s: 'S', r: 10 }, { s: 'H', r: 12 }];
    expect(sortHand(h).map((c) => c.s + c.r)).toEqual(['S10', 'H3', 'H12', 'C2', 'C14']);
  });
});
