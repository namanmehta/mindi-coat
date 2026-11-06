// Card motion. Every animation here is measured from real positions on screen:
// where a card was (or where it comes from) and where it is now. Nothing is hard-coded per layout.

export const reducedMotion = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Timing for the table's rituals (ms). The server waits a little longer than these before a bot moves. */
export const T = {
  toss: 2900,
  /** gap between cards in a deal; the first match of a sitting deals slower so it feels like an event */
  gapFirst: 120,
  gap: 70,
  gap8First: 60,
  gap8: 45,
  fly: 420,
  flip: 300,
  land: 380,
  hold: 1100,
  holdMindi: 1700,
  sweep: 600,
};

export const SPRING = 'cubic-bezier(.2,.9,.25,1.15)';
export const EASE = 'cubic-bezier(.2,.8,.2,1)';

export function run(el: Element | null | undefined, frames: Keyframe[], opts: KeyframeAnimationOptions): Animation | null {
  if (!el || reducedMotion() || !(el as HTMLElement).animate) return null;
  return (el as HTMLElement).animate(frames, { fill: 'both', ...opts });
}

export const center = (r: DOMRect): [number, number] => [r.left + r.width / 2, r.top + r.height / 2];

/** The size unit the whole board is drawn in (matches --u in the stylesheet). */
export function unit(): number {
  return Math.min(window.innerHeight / 100, window.innerWidth * 0.0056);
}

/**
 * Glide an element from a source rectangle to where it now sits.
 * `rot` is the element's resting rotation (it is restored at the end).
 */
export function flyIn(el: HTMLElement, from: DOMRect, opts: {
  delay?: number; duration?: number; rot?: number; flip?: boolean; fromRot?: number; easing?: string;
} = {}) {
  const to = el.getBoundingClientRect();
  if (!to.width) return;
  const [fx, fy] = center(from), [tx, ty] = center(to);
  const s = from.width / to.width;
  const rot = opts.rot ?? 0;
  const dur = opts.duration ?? T.fly;
  const delay = Math.max(0, opts.delay ?? 0);
  run(el, [
    { transform: `translate(${fx - tx}px, ${fy - ty}px) rotate(${opts.fromRot ?? 0}deg) scale(${s})`, opacity: delay > 0 ? 0 : 1, offset: 0 },
    { transform: `translate(${fx - tx}px, ${fy - ty}px) rotate(${opts.fromRot ?? 0}deg) scale(${s})`, opacity: 1, offset: 0.001 },
    { transform: `rotate(${rot}deg)`, opacity: 1 },
  ], { duration: dur, delay, easing: opts.easing ?? EASE, fill: 'backwards' });
  if (opts.flip) flipUp(el, delay + dur * 0.55, T.flip);
}

/** Turn a card face up (its inner .flip layer goes from back to face). */
export function flipUp(el: HTMLElement, delay = 0, duration = T.flip) {
  run(el.querySelector('.flip'), [{ transform: 'rotateY(180deg)' }, { transform: 'rotateY(0deg)' }], { duration, delay, easing: 'ease-out', fill: 'backwards' });
}

/** Slide an element that moved within its row (hand re-sorting, cards closing a gap). */
export function slide(el: HTMLElement, prev: DOMRect) {
  const now = el.getBoundingClientRect();
  const dx = prev.left - now.left, dy = prev.top - now.top;
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
  run(el, [{ translate: `${dx}px ${dy}px` }, { translate: '0px 0px' }], { duration: 280, easing: EASE, fill: 'none' });
}
