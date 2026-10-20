import type { Card, Suit } from './engine';

/** Table order everywhere: red and black alternate. */
export const SUIT_ORDER: Suit[] = ['H', 'S', 'D', 'C'];
const isRed = (s: Suit) => s === 'H' || s === 'D';

function permutations<T>(xs: T[]): T[][] {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
}

/**
 * Suit order for a hand: start from ♥ ♠ ♦ ♣. If a missing suit would put two
 * same-coloured suits side by side, use the closest order that still alternates.
 * If alternating is impossible (e.g. only ♥ and ♦), keep the base order.
 */
export function suitOrderFor(hand: Card[]): Suit[] {
  const present = SUIT_ORDER.filter((s) => hand.some((c) => c.s === s));
  const alternates = (o: Suit[]) => o.every((s, i) => i === 0 || isRed(s) !== isRed(o[i - 1]));
  return permutations(present).find(alternates) ?? present;
}

export function sortHand(hand: Card[]): Card[] {
  const order = suitOrderFor(hand);
  return hand.slice().sort((a, b) => order.indexOf(a.s) - order.indexOf(b.s) || a.r - b.r);
}
