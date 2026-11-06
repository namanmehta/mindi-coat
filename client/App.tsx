import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import type { Card, Seat, Suit, Play } from '../engine/engine';
import type { RoomState } from '../server/protocol';
import { SUIT_ORDER, sortHand } from '../engine/order';
import { T, EASE, run, center, flyIn, flipUp, slide, reducedMotion } from './motion';

// ---------- words and small helpers ----------

const SUIT_SYMBOL: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
const SUIT_NAME: Record<Suit, string> = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs' };
const isRed = (s: Suit) => s === 'H' || s === 'D';
const rankLabel = (r: number) => ({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A' } as Record<number, string>)[r] ?? String(r);
const same = (a: Card, b: Card) => a.r === b.r && a.s === b.s;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function store(key: string, value?: string): string | null {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch { /* storage blocked: fall back to memory */ }
  return value ?? null;
}

function getToken(): string {
  let t = store('mindi.token');
  if (!t) {
    t = (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)) + Date.now().toString(36);
    store('mindi.token', t);
  }
  return t;
}

/** Short vibration. Android only: iPhone does not allow vibration from websites. */
function buzz(pattern: number | number[]) {
  try { if (!reducedMotion()) navigator.vibrate?.(pattern); } catch { /* unsupported */ }
}

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isInstalled = () => matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches || (navigator as any).standalone === true;

type Res = { ok: true; code?: string } | { ok: false; error: string };

function useSocket() {
  const [socket] = useState<Socket>(() => io({ transports: ['websocket', 'polling'] }));
  const [connected, setConnected] = useState(false);
  const [state, setState] = useState<RoomState | null>(null);
  useEffect(() => {
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('state', (s: RoomState) => setState(s));
    return () => { socket.removeAllListeners(); };
  }, [socket]);
  return { socket, connected, state, setState };
}

// ---------- pieces ----------

/** A playing card: big corner rank and suit, court art on J/Q/K, a centred pip on aces. */
function CardFace({ card, onClick, disabled, highlight, trump, className, style, down, elRef, label }: {
  card: Card | null; onClick?: () => void; disabled?: boolean; highlight?: boolean; trump?: boolean;
  className?: string; style?: React.CSSProperties; down?: boolean; elRef?: (el: HTMLElement | null) => void; label?: string;
}) {
  const cls = ['card', highlight ? 'win' : '', onClick ? 'playable' : '', disabled ? 'dim' : '', className ?? ''].filter(Boolean).join(' ');
  const face = card && (
    <div className={['face', isRed(card.s) ? 'red' : '', card.r === 10 ? 'ten' : '', trump ? 'trumpc' : ''].filter(Boolean).join(' ')}>
      <span className="r">{rankLabel(card.r)}</span>
      <span className="s">{SUIT_SYMBOL[card.s]}</span>
      {card.r >= 11 && card.r <= 13
        ? <img className="court" src={`/cards/${card.s}${rankLabel(card.r)}.svg`} alt="" draggable={false} />
        : card.r === 14 ? <span className="ace">{SUIT_SYMBOL[card.s]}</span> : <span className="big">{SUIT_SYMBOL[card.s]}</span>}
    </div>
  );
  const inner = <div className={`flip ${down || !card ? 'down' : ''}`}>{face}<div className="cback" /></div>;
  const aria = label ?? (card ? `${rankLabel(card.r)} of ${SUIT_NAME[card.s]}` : 'Face-down card');
  if (onClick) return <button ref={elRef as any} className={cls} style={style} onClick={onClick} disabled={disabled} aria-label={aria}>{inner}</button>;
  return <div ref={elRef as any} className={cls} style={style} aria-label={aria}>{inner}</div>;
}

/** A number that rolls up when it changes instead of jumping. */
function Roll({ value }: { value: number }) {
  return <span className="roll-wrap"><span className="roll" key={value}>{value}</span></span>;
}

function Crown() {
  return (
    <svg className="crown" viewBox="0 0 44 30" aria-label="Chose trump">
      <defs><linearGradient id="crownG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffe08a" /><stop offset="1" stopColor="#f0a92a" /></linearGradient></defs>
      <path d="M4 26 L2 7 L13 15 L22 2 L31 15 L42 7 L40 26 Z" fill="url(#crownG)" stroke="#a8740e" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

function Pencil() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z" /></svg>;
}
function Eye() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M1.5 12S5.5 4.5 12 4.5 22.5 12 22.5 12 18.5 19.5 12 19.5 1.5 12 1.5 12z" /><circle cx="12" cy="12" r="3.2" /></svg>;
}
function Robot() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="8" width="16" height="12" rx="3" /><path d="M12 8V4M9 13h.01M15 13h.01M9 17h6" /></svg>;
}
function Expand() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>;
}

// ---------- entry ----------

function InstallHint() {
  const [prompt, setPrompt] = useState<any>(null);
  const [hidden, setHidden] = useState(() => store('mindi.installHint') === 'off' || isInstalled());
  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); setPrompt(e); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);
  if (hidden) return null;
  const dismiss = () => { store('mindi.installHint', 'off'); setHidden(true); };
  if (isIOS()) {
    return (
      <div className="install">
        <p><strong>Play full screen.</strong> In Safari, tap Share, then Add to Home Screen. No address bar, more room for cards.</p>
        <button className="text-btn" onClick={dismiss}>Got it</button>
      </div>
    );
  }
  if (prompt) {
    return (
      <div className="install">
        <p><strong>Install Mindi Coat</strong> to play full screen without the address bar.</p>
        <button className="pill primary small" onClick={async () => { prompt.prompt(); await prompt.userChoice.catch(() => null); dismiss(); }}>Install</button>
      </div>
    );
  }
  return null;
}

function Entry({ onCreate, onJoin, error }: {
  onCreate: (name: string) => void; onJoin: (name: string, code: string) => void; error: string;
}) {
  const initialCode = new URLSearchParams(location.search).get('room')?.toUpperCase() ?? '';
  const [name, setName] = useState(store('mindi.name') ?? '');
  const [code, setCode] = useState(initialCode);
  const ready = name.trim().length > 0;
  return (
    <main className="entry">
      <div className="entry-brand">
        <h1 className="wordmark">Mindi Coat</h1>
        <p className="tagline">Four friends, two teams, the four tens.</p>
      </div>
      <div className="entry-card glass">
        <label className="field">
          <span>Your name</span>
          <input value={name} maxLength={20} autoComplete="nickname" onChange={(e) => setName(e.target.value)}
            placeholder="What your table calls you" />
        </label>
        {!initialCode && (
          <button className="pill primary wide" disabled={!ready} onClick={() => onCreate(name)}>Create a table</button>
        )}
        <div className="join-row">
          <input className="code-input" value={code} maxLength={4} placeholder="Code" aria-label="Table code"
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} />
          <button className={`pill ${initialCode ? 'primary' : 'plain'}`} disabled={!ready || code.length !== 4}
            onClick={() => onJoin(name, code)}>Join table</button>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
      </div>
      <InstallHint />
    </main>
  );
}

// ---------- the table ----------

type Pos = 'bottom' | 'right' | 'top' | 'left';
/** Resting tilt of a card played from each side (must match the stylesheet). */
const ROT: Record<Pos, number> = { bottom: 2, top: -3, left: -8, right: 7 };

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0] ?? '?').slice(0, 2).toUpperCase();
}

function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

type Sweep = { key: string; plays: Play[]; winner: Seat; flying: boolean; tens: Suit[] };

/** When a hand completes: hold the four cards (winner lit, MINDI if a ten fell), then sweep them to the winners' panel. */
function useSweep(view: RoomState['view']) {
  const [sweep, setSweep] = useState<Sweep | null>(null);
  const prev = useRef<{ handNo: number; done: number } | null>(null);
  const done = view ? view.tricks[0] + view.tricks[1] : 0;
  useEffect(() => {
    if (!view) { prev.current = null; return; }
    const p = prev.current;
    prev.current = { handNo: view.handNo, done };
    if (p && p.handNo === view.handNo && done === p.done + 1 && view.lastTrick) {
      const key = `${view.handNo}-${done}`;
      const tens = view.lastTrick.plays.filter((x) => x.card.r === 10).map((x) => x.card.s);
      const hold = tens.length ? T.holdMindi : T.hold;
      setSweep({ key, plays: view.lastTrick.plays, winner: view.lastTrick.winner, flying: false, tens });
      setTimeout(() => setSweep((s) => (s && s.key === key ? { ...s, flying: true } : s)), hold);
      setTimeout(() => setSweep((s) => (s && s.key === key ? null : s)), hold + T.sweep);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view?.handNo, done]);
  return sweep && view && view.trick.length === 0 ? sweep : null;
}

function TeamPanel({ team, name, hands, tens, mine, side, celebrate, onRename, elRef }: {
  team: 0 | 1; name: string; hands: number; tens: Suit[]; mine: boolean; side: 'left' | 'right';
  celebrate: boolean; onRename: (name: string) => void; elRef?: (el: HTMLElement | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const save = () => { const n = draft.trim(); if (n && n !== name) onRename(n); setEditing(false); };
  return (
    <section ref={elRef as any} className={`team glass ${side} t${team} ${celebrate ? 'celebrate' : ''}`} aria-label={`${name} score`}>
      <div className="thead">
        {editing ? (
          <form className="rename" onSubmit={(e) => { e.preventDefault(); save(); }}>
            <input value={draft} maxLength={20} autoFocus aria-label="Team name" onBlur={save}
              onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setEditing(false); }} />
          </form>
        ) : (
          <>
            <span className="tname">
              <span className="tname-text">{name}</span>
              {mine && <button className="icon-btn" onClick={() => { setDraft(name); setEditing(true); }} aria-label="Rename your team"><Pencil /></button>}
            </span>
            <span className="hands"><b><Roll value={hands} /></b><span>{hands === 1 ? 'hand' : 'hands'}</span></span>
          </>
        )}
      </div>
      <div className="tens">
        {SUIT_ORDER.map((suit) => {
          const won = tens.includes(suit);
          return (
            <div key={suit} className={`mini ${won ? 'won' : ''} ${won && isRed(suit) ? 'red' : ''}`}
              aria-label={`10 of ${SUIT_NAME[suit]}${won ? ', won' : ''}`}>
              <span>10<br /><span className="ss">{SUIT_SYMBOL[suit]}</span></span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function TeamNameField({ current, onSave }: { current: string; onSave: (n: string) => void }) {
  const [draft, setDraft] = useState(current);
  useEffect(() => { setDraft(current); }, [current]);
  const dirty = !!draft.trim() && draft.trim() !== current;
  return (
    <form className="rename lobby-rename" onSubmit={(e) => { e.preventDefault(); if (dirty) onSave(draft.trim()); }}>
      <input value={draft} maxLength={20} aria-label="Your team name" placeholder="Your team name" onChange={(e) => setDraft(e.target.value)} />
      <button className="pill small plain" type="submit" disabled={!dirty}>Save</button>
    </form>
  );
}

function Confetti() {
  const bits = useMemo(() => Array.from({ length: 44 }, (_, i) => ({
    left: Math.random() * 100, delay: Math.random() * 0.6, dur: 1.8 + Math.random() * 1.4,
    rot: Math.random() * 360, hue: ['#f4b740', '#93d3ec', '#ffffff', '#cc3a2f'][i % 4], w: 6 + Math.random() * 6,
  })), []);
  if (reducedMotion()) return null;
  return (
    <div className="confetti" aria-hidden="true">
      {bits.map((b, i) => (
        <i key={i} style={{ left: `${b.left}%`, animationDelay: `${b.delay}s`, animationDuration: `${b.dur}s`,
          background: b.hue, width: b.w, height: b.w * 0.45, transform: `rotate(${b.rot}deg)` }} />
      ))}
    </div>
  );
}

/** A deal in progress: when it starts, how fast, how many cards each, whether the toss comes first. */
interface Deal {
  id: string;
  kind: 'five' | 'eight';
  tossUntil: number;
  start: number;
  gap: number;
  n: number;
  chooser: Seat;
  end: number;
  /** a non-chooser's face-down five: show 13 backs while dealing, then flip them all */
  reveal: boolean;
}

const cardKey = (c: Card) => `${c.r}${c.s}`;

function Table({ state, send, name, onLeave, flash }: {
  state: RoomState; send: (ev: string, payload?: any) => void; name: string; onLeave?: () => void; flash: (m: string) => void;
}) {
  const { seats, view, you, teamNames } = state;
  const me: Seat = (you ?? 0) as Seat;
  // You sit at the bottom. Play goes counterclockwise, so the next player is on your right.
  const posOf = (seat: number): Pos => (['bottom', 'right', 'top', 'left'] as const)[(seat - me + 4) % 4];
  const myTeam = (you === null ? 0 : you % 2) as 0 | 1;
  const otherTeam = (1 - myTeam) as 0 | 1;
  const teamName = (t: number) => teamNames[t];
  const now = useNow(state.paused);
  const sweep = useSweep(view);
  const [showResults, setShowResults] = useState(false);
  const [portraitOk, setPortraitOk] = useState(false);
  const [fsAvailable] = useState(() => !!document.fullscreenEnabled && !isInstalled());
  const [, rerender] = useState(0);

  const seatName = (seat: number) => seats[seat]?.name ?? 'Open seat';
  const iChoose = !!view && view.chooser === you;
  const choosing = !!view && (view.phase === 'choosing' || view.phase === 'blind');
  const seated = seats.filter(Boolean).length;
  const target = state.seriesTarget;

  // ---------- deals and the toss: detected from state changes, then played out on screen ----------
  const matchId = view ? `${state.seriesNo}-${view.handNo}` : 'none';
  const phase = view?.phase ?? 'none';
  const seenRef = useRef<{ id: string; phase: string } | null>(null);
  const dealRef = useRef<Deal | null>(null);
  const backsShown = useRef(0);
  const tossSeen = useRef(false);
  {
    const prev = seenRef.current;
    if (!prev || prev.id !== matchId || prev.phase !== phase) {
      const t0 = performance.now();
      const firstOfSitting = state.results.length === 0 && state.seriesNo === 1 && view?.handNo === 1;
      if (prev && view && prev.id !== matchId && phase === 'choosing') {
        const withToss = firstOfSitting && !!state.toss && !tossSeen.current && !reducedMotion();
        tossSeen.current = true;
        const start = t0 + (withToss ? T.toss : 0);
        const gap = firstOfSitting ? T.gapFirst : T.gap;
        dealRef.current = { id: matchId, kind: 'five', tossUntil: withToss ? start : 0, start, gap, n: 5, chooser: view.chooser, end: start + 20 * gap + T.fly + T.flip, reveal: false };
      } else if (prev && view && prev.id === matchId && (prev.phase === 'choosing' || prev.phase === 'blind') && phase === 'playing') {
        const gap = firstOfSitting ? T.gap8First : T.gap8;
        const start = Math.max(t0, dealRef.current?.end ?? 0);
        dealRef.current = { id: matchId, kind: 'eight', tossUntil: 0, start, gap, n: 8, chooser: view.chooser, end: start + 32 * gap + T.fly + T.flip, reveal: backsShown.current > 0 };
      }
      if (prev && prev.id === 'none' && view) tossSeen.current = true;
      seenRef.current = { id: matchId, phase };
    }
  }
  const deal = dealRef.current && dealRef.current.id === matchId ? dealRef.current : null;
  const tNow = performance.now();
  const tossing = !!deal && tNow < deal.tossUntil;
  const dealing = !!deal && tNow < deal.end;
  // re-render at the moments the picture changes (toss over, deal over)
  useEffect(() => {
    if (!deal) return;
    const marks = [deal.tossUntil, deal.end].map((t) => t - performance.now()).filter((d) => d > 0);
    const ids = marks.map((d) => setTimeout(() => rerender((x) => x + 1), d + 20));
    return () => ids.forEach(clearTimeout);
  }, [deal?.id, deal?.kind]);

  const myTurn = !!view && view.phase === 'playing' && view.turn === you && !state.paused && !dealing;
  const isLegal = (c: Card) => !!view?.legal.some((x) => same(x, c));

  const hand = useMemo(() => (view ? sortHand(view.myHand) : []), [view]);
  const handCount = you !== null && view ? view.handCounts[you] : 0;
  // what your hand row shows right now
  const showBacks: number = you === null || !view ? 0 : hand.length === 0 ? handCount : deal?.reveal && dealing ? handCount : 0;
  backsShown.current = showBacks || 0;
  const suitStarts = useMemo(() => new Set(hand.map((c, i) => (i > 0 && hand[i - 1].s !== c.s ? i : -1))), [hand]);

  // ---------- element registries for measuring ----------
  const handEls = useRef(new Map<string, HTMLElement>());
  const trickEls = useRef(new Map<string, HTMLElement>());
  const seatEls = useRef(new Map<number, HTMLElement>());
  const panelEls = useRef<{ left: HTMLElement | null; right: HTMLElement | null }>({ left: null, right: null });
  const deckEl = useRef<HTMLElement | null>(null);
  const handRowEl = useRef<HTMLElement | null>(null);
  const lastHandRects = useRef(new Map<string, DOMRect>());
  const landed = useRef(new Set<string>());
  const flippedReveal = useRef('');

  const deckRect = (): DOMRect | null => deckEl.current?.getBoundingClientRect() ?? null;
  const seatRect = (seat: number): DOMRect | null => {
    if (seat === you) return handRowEl.current?.getBoundingClientRect() ?? null;
    return seatEls.current.get(seat)?.querySelector('.av')?.getBoundingClientRect() ?? null;
  };
  /** when the m-th card of this deal reaches `seat` */
  const dealDelay = (d: Deal, seat: number, m: number) => d.start + (m * 4 + ((seat - d.chooser + 4) % 4)) * d.gap - performance.now();

  useLayoutEffect(() => {
    // 1. cards arriving on the table: from your hand, or from the player's seat (turning face up on the way)
    for (const [key, el] of trickEls.current) {
      if (landed.current.has(key)) continue;
      landed.current.add(key);
      const play = view?.trick.find((p) => cardKey(p.card) === key);
      if (!play) continue;
      const pos = posOf(play.seat);
      const fromHand = play.seat === you ? lastHandRects.current.get(key) : null;
      const from = fromHand ?? seatRect(play.seat);
      if (from) flyIn(el, from, { rot: ROT[pos], duration: T.land, flip: !fromHand, fromRot: fromHand ? 0 : ROT[pos] * 4 });
    }
    // 2. your hand: dealt cards fly in from the deck; cards that moved slide; a hidden hand flips over
    const rects = new Map<string, DOMRect>();
    const fresh: [string, HTMLElement][] = [];
    for (const [key, el] of handEls.current) {
      const r = el.getBoundingClientRect();
      rects.set(key, r);
      const prev = lastHandRects.current.get(key);
      if (prev) slide(el, prev);
      else fresh.push([key, el]);
    }
    const d = dealRef.current;
    const faces = fresh.filter(([k]) => !k.startsWith('back'));
    const revealing = d && d.reveal && d.id === matchId && !dealing && flippedReveal.current !== d.id && faces.length === hand.length && hand.length > 0;
    if (revealing) {
      flippedReveal.current = d!.id;
      faces.forEach(([, el], i) => flipUp(el, i * 40, T.flip));
    } else if (d && d.id === matchId && dealing && you !== null && lastHandRects.current.size + fresh.length > 0) {
      const from = deckRect();
      const firstNew = d.n === 8 && !d.reveal ? 0 : d.n === 8 ? 5 : 0;
      fresh
        .filter(([k]) => !k.startsWith('back') || Number(k.slice(5)) >= firstNew)
        .sort((x, y) => x[1].getBoundingClientRect().left - y[1].getBoundingClientRect().left)
        .forEach(([k, el], m) => {
          if (from) flyIn(el, from, { delay: dealDelay(d, you, m), flip: !k.startsWith('back'), fromRot: 0 });
        });
    }
    lastHandRects.current = rects;
  });

  // a new match starts with an empty table
  useEffect(() => { landed.current = new Set(); }, [matchId]);

  // 3. the won hand sweeps into the winning team's panel
  useEffect(() => {
    if (!sweep?.flying) return;
    const team = sweep.winner % 2;
    const panel = team === myTeam ? panelEls.current.left : panelEls.current.right;
    const tr = panel?.querySelector('.tens')?.getBoundingClientRect() ?? panel?.getBoundingClientRect();
    if (!tr) return;
    const [tx, ty] = center(tr);
    sweep.plays.forEach((p, i) => {
      const el = trickEls.current.get(cardKey(p.card));
      if (!el) return;
      const r = el.getBoundingClientRect();
      const [cx, cy] = center(r);
      const rot = ROT[posOf(p.seat)];
      run(el, [{ transform: `rotate(${rot}deg)`, opacity: 1 },
        { transform: `translate(${tx - cx}px, ${ty - cy}px) rotate(${rot - 25}deg) scale(.24)`, opacity: 0.9, offset: 0.88 },
        { transform: `translate(${tx - cx}px, ${ty - cy}px) rotate(${rot - 25}deg) scale(.2)`, opacity: 0 }],
      { duration: T.sweep - 40, delay: i * 35, easing: 'cubic-bezier(.5,0,.3,1)' });
    });
  }, [sweep?.flying]);

  // Feedback scales with rarity: turn (tiny), MINDI (medium), match, series (biggest).
  const turnRef = useRef(false);
  useEffect(() => { if (myTurn && !turnRef.current) buzz(18); turnRef.current = myTurn; }, [myTurn]);
  useEffect(() => { if (sweep && !sweep.flying && sweep.tens.length) buzz([25, 50, 25]); }, [sweep?.key]);
  const matchKey = view?.phase === 'done' ? `${state.seriesNo}-${view.handNo}` : '';
  const seenMatch = useRef('');
  useEffect(() => {
    if (!matchKey || seenMatch.current === matchKey) return;
    seenMatch.current = matchKey;
    buzz(state.seriesWinner !== null ? [30, 70, 30, 70, 120] : 40);
  }, [matchKey, state.seriesWinner]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(`${location.origin}/?room=${state.code}`); flash('Invite link copied'); }
    catch { flash(`Table code ${state.code}`); }
  };
  const goFullscreen = async () => {
    try {
      await document.documentElement.requestFullscreen();
      await (screen.orientation as any)?.lock?.('landscape').catch(() => null);
    } catch { /* not allowed here */ }
  };

  let pauseText = '';
  if (state.started && state.paused) {
    pauseText = seats.map((s, i) => {
      if (s && s.connected) return '';
      if (!s) return 'A seat is empty.';
      if (s.open) return `${s.name} left. Share the code so someone can take their seat.`;
      const secs = Math.max(0, Math.ceil(((s.holdUntil ?? now) - now) / 1000));
      return `Waiting for ${s.name} to reconnect, ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    }).filter(Boolean).join(' ');
  }

  /** What a viewer can do with a seat: sit in it, fill it with a bot, or remove a bot. */
  const seatActions = (seat: number): { label: string; ev: string; payload: any }[] => {
    const s = seats[seat];
    const out: { label: string; ev: string; payload: any }[] = [];
    if (!state.started) {
      if (!s || (s.bot && you === null)) out.push({ label: 'Sit here', ev: 'sit', payload: { seat, name } });
      if (you !== null && !s) out.push({ label: 'Add bot', ev: 'addBot', payload: { seat } });
      if (you !== null && s?.bot) out.push({ label: 'Remove bot', ev: 'removeBot', payload: { seat } });
    } else {
      if (you === null && (s?.open || s?.bot)) out.push({ label: 'Take seat', ev: 'sit', payload: { seat, name } });
      if (you !== null && s?.open) out.push({ label: 'Add bot', ev: 'addBot', payload: { seat } });
    }
    return out;
  };
  const hasBots = seats.some((s) => s?.bot);

  // panels show a won hand only once its cards have landed there
  const pendingTeam = sweep ? sweep.winner % 2 : -1;
  const tensOf = (t: number) => (view?.tensTaken ?? [])
    .filter((x) => x.team === t && !(t === pendingTeam && sweep!.tens.includes(x.suit)))
    .map((x) => x.suit);
  const handsOf = (t: number) => (view?.tricks[t] ?? 0) - (t === pendingTeam ? 1 : 0);

  const onFelt: { plays: Play[]; winner?: Seat } =
    view && view.trick.length ? { plays: view.trick } : sweep ? { plays: sweep.plays, winner: sweep.winner } : { plays: [] };

  const matchDone = view?.phase === 'done' && !!view.result && !sweep;
  const seriesOver = state.seriesWinner !== null && matchDone;
  const mindi = sweep && !sweep.flying && sweep.tens.length > 0 ? sweep : null;
  const mindiTeam = mindi ? teamName(mindi.winner % 2) : '';

  // others' cards in a deal: backs flying from the deck to each seat
  const flights: { id: string; seat: number; m: number }[] = [];
  if (deal && dealing && !tossing) {
    for (const seat of [0, 1, 2, 3]) {
      if (seat === you) continue;
      for (let m = 0; m < deal.n; m++) flights.push({ id: `${deal.id}-${deal.kind}-${seat}-${m}`, seat, m });
    }
  }
  const flightRef = (seat: number, m: number) => (el: HTMLElement | null) => {
    if (!el || el.dataset.go || !deal) return;
    el.dataset.go = '1';
    const to = seatRect(seat), from = deckRect();
    if (!to || !from) { el.style.display = 'none'; return; }
    const [fx, fy] = center(from), [tx, ty] = center(to);
    const r = el.getBoundingClientRect();
    const [cx, cy] = center(r);
    const rot = { top: 180, left: 90, right: -90, bottom: 0 }[posOf(seat)];
    run(el, [
      { transform: `translate(${fx - cx}px, ${fy - cy}px)`, opacity: 0, offset: 0 },
      { transform: `translate(${fx - cx}px, ${fy - cy}px)`, opacity: 1, offset: 0.01 },
      { transform: `translate(${tx - cx}px, ${ty - cy}px) rotate(${rot}deg) scale(.42)`, opacity: 1, offset: 0.85 },
      { transform: `translate(${tx - cx}px, ${ty - cy}px) rotate(${rot}deg) scale(.36)`, opacity: 0 },
    ], { duration: T.fly + 40, delay: Math.max(0, dealDelay(deal, seat, m)), easing: EASE });
  };

  const showChooseUI = !tossing && !(deal?.kind === 'five' && dealing);
  const showCounts = !dealing;

  return (
    <div className={`board ${portraitOk ? 'portrait-ok' : ''}`}>
      <div className="top">
        <div className="top-left">
          <button className="code glass capsule" onClick={copy} aria-label={`Table ${state.code}. Copy invite link`}>
            <b>{state.code}</b>
            {hasBots && <span className="watch" title="This table includes bots"><Robot />Bots</span>}
            {state.watchers.length > 0 && (
              <span className="watch" title={`Watching: ${state.watchers.join(', ')}`}
                onClick={(e) => { e.stopPropagation(); flash(`Watching: ${state.watchers.join(', ')}`); }}>
                <Eye />{state.watchers.length}
              </span>
            )}
          </button>
        </div>
        <button className="score glass capsule" onClick={() => setShowResults(true)} aria-label="Results">
          <span className="tn a">{teamName(0)}</span><span className="n"><Roll value={state.handsWon[0]} /></span>
          <span className="div" />
          <span className="n"><Roll value={state.handsWon[1]} /></span><span className="tn b">{teamName(1)}</span>
          <span className="sub">{target ? `First to ${target}` : 'Matches'}</span>
        </button>
        <div className="top-right">
          {view?.trump && (
            <div className="trump glass capsule">
              <div className={`tile ${isRed(view.trump) ? 'red' : ''}`}>{SUIT_SYMBOL[view.trump]}</div>
              <span>{view.blind ? 'Blind trump' : 'Trump'}</span>
            </div>
          )}
          {fsAvailable && (
            <button className="round-btn glass" onClick={goFullscreen} aria-label="Full screen" title="Full screen"><Expand /></button>
          )}
        </div>
      </div>

      {pauseText && <div className="pause glass capsule" role="status">{pauseText}</div>}

      <div className="felt" />

      {([0, 1, 2, 3] as Seat[]).map((seat) => {
        const pos = posOf(seat);
        if (pos === 'bottom' && you !== null) return null;
        const s = seats[seat];
        const turn = view?.phase === 'playing' && view.turn === seat && !state.paused && !dealing;
        const isChooser = state.started && !!view && view.chooser === seat && !tossing;
        const count = view ? view.handCounts[seat] : 0;
        return (
          <div key={seat} ref={(el) => { if (el) seatEls.current.set(seat, el); else seatEls.current.delete(seat); }}
            className={`seat s-${pos} t${seat % 2} ${turn ? 'turn' : ''} ${s && !s.connected ? 'away' : ''} ${s ? '' : 'empty'}`}>
            <div className="av" aria-hidden="true">
              {isChooser && <Crown />}
              {s ? (s.bot ? <span className="bot-face"><Robot /></span> : initials(s.name)) : '+'}
            </div>
            <div className="name">
              <span className="nm">{seatName(seat)}</span>
              {s && !s.connected ? <span className="cnt">{s.open ? 'Left' : 'Reconnecting'}</span>
                : count > 0 && showCounts && <span className="cnt">{plural(count, 'card')}</span>}
            </div>
            {seatActions(seat).length > 0 && (
              <div className="seat-actions">
                {seatActions(seat).map((a) => (
                  <button key={a.label} className={`pill small ${a.ev === 'sit' ? 'glass-btn' : 'quiet-btn'}`} onClick={() => send(a.ev, a.payload)}>{a.label}</button>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* the deck sits in the middle of the table while dealing */}
      <div className="trick" aria-hidden="true">
        <div ref={(el) => { deckEl.current = el; }} className={`deck ${dealing && !tossing ? 'on' : ''}`}>
          {[0, 1, 2].map((i) => <CardFace key={i} card={null} className="deck-card" style={{ ['--i' as any]: i }} />)}
        </div>
      </div>

      <div className={`trick ${onFelt.winner !== undefined ? 'decided' : ''}`} aria-label="Cards on the table">
        {onFelt.plays.map((p) => {
          const key = cardKey(p.card);
          return (
            <CardFace key={key} card={p.card} className={`p-${posOf(p.seat)}`} highlight={onFelt.winner === p.seat}
              elRef={(el) => { if (el) trickEls.current.set(key, el); else trickEls.current.delete(key); }} />
          );
        })}
      </div>

      {/* the toss: one face-up card each, the highest picks trump first */}
      {tossing && state.toss && view && (
        <div className="trick toss" aria-label="Toss">
          {state.toss.map((c, seat) => (
            <CardFace key={seat} card={c} className={`toss-card at-${posOf(seat)} ${seat === view.chooser ? 'winner' : ''}`}
              style={{ ['--k' as any]: seat }} />
          ))}
          <div className="toss-msg glass capsule">{seat0Name(view.chooser)} {view.chooser === you ? 'choose' : 'chooses'} trump first</div>
        </div>
      )}

      <div className="fx" aria-hidden="true">
        {flights.map((f) => <CardFace key={f.id} card={null} className="flight" elRef={flightRef(f.seat, f.m)} />)}
      </div>

      {sweep && !sweep.flying && (
        <div className="won-tag glass capsule" role="status">{sweep.winner === you ? 'You win' : `${seatName(sweep.winner)} wins`} the hand</div>
      )}
      {mindi && (
        <div className="mindi" role="status" aria-label={`Mindi! ${mindiTeam} take the ten`}>
          <div className="rays" />
          <div className="mindi-word">{mindi.tens.length > 1 ? 'DOUBLE MINDI!' : 'MINDI!'}</div>
          <div className="mindi-sub">{mindiTeam} take the {mindi.tens.map((t) => `10${SUIT_SYMBOL[t]}`).join(' and ')}</div>
        </div>
      )}

      {/* lobby */}
      {!state.started && (
        <div className="status quiet-status">{seated < 4 ? `${seated} of 4 seated. Partners sit opposite.` : 'Everyone is seated'}</div>
      )}
      {!state.started && (
        <div className="lobby glass">
          <div className="lobby-row">
            <div className="seg" role="group" aria-label="Series length">
              <button className={target === 4 ? 'on' : ''} disabled={you === null} onClick={() => send('setSeries', { target: 4 })}>Best of 7</button>
              <button className={target === null ? 'on' : ''} disabled={you === null} onClick={() => send('setSeries', { target: null })}>No limit</button>
            </div>
            {you !== null && <TeamNameField current={teamName(myTeam)} onSave={(n) => send('setTeamName', { name: n })} />}
          </div>
          <div className="lobby-actions">
            {seated === 4 && you !== null && <button className="pill primary" onClick={() => send('start')}>Toss and deal</button>}
            {onLeave && <button className="text-btn" onClick={onLeave}>Leave table</button>}
          </div>
        </div>
      )}

      {state.started && !view && state.seriesWinner === null && (
        <div className="panel glass">
          <h2>Series {state.seriesNo}</h2>
          {you !== null && <button className="pill primary" onClick={() => send('nextHand')}>Deal first match</button>}
        </div>
      )}

      {view && choosing && !iChoose && showChooseUI && (
        <div className="status glass capsule" role="status">
          {seatName(view.chooser)} is choosing trump{view.phase === 'blind' ? ' blind' : ''}
          <span className="dots" aria-hidden="true"><i /><i /><i /></span>
        </div>
      )}
      {view && iChoose && view.phase === 'choosing' && showChooseUI && (
        <div className="panel picker glass">
          <h2>Choose trump</h2>
          <p className="muted">From your five cards, or pick blind</p>
          <div className="suits">
            {SUIT_ORDER.map((s) => (
              <button key={s} className={`suit ${isRed(s) ? 'red' : ''}`} disabled={state.paused}
                onClick={() => send('nameTrump', { suit: s })} aria-label={`Make ${SUIT_NAME[s]} trump`}>{SUIT_SYMBOL[s]}</button>
            ))}
            <button className="pill plain tall" disabled={state.paused} onClick={() => send('goBlind')}>Go blind</button>
          </div>
        </div>
      )}
      {view && iChoose && view.phase === 'blind' && (
        <div className="panel picker glass">
          <h2>Pick a hidden card</h2>
          <p className="muted">Its suit becomes trump</p>
          <div className="blind-row">
            {Array.from({ length: view.blindSlots }).map((_, i) => (
              <button key={i} className="card blind-card" disabled={state.paused}
                onClick={() => send('pickBlind', { index: i })} aria-label={`Hidden card ${i + 1}`}>
                <div className="flip down"><div className="cback" /></div>
              </button>
            ))}
          </div>
        </div>
      )}

      {matchDone && !seriesOver && view?.result && (
        <div className="panel result glass">
          <h2>{teamName(view.result.winner)} win match {view.handNo}</h2>
          <p className="muted">{plural(view.tens[view.result.winner], 'ten')}, {plural(view.tricks[view.result.winner], 'hand')}{view.result.early ? ', decided early' : ''}</p>
          {you !== null && <button className="pill primary" onClick={() => send('nextHand')}>Deal next match</button>}
        </div>
      )}

      {seriesOver && (
        <div className="series-win" role="dialog" aria-label="Series won">
          <Confetti />
          <div className="series-card glass">
            <h2 className={state.seriesWinner === 0 ? 'a' : 'b'}>{teamName(state.seriesWinner!)} win the series</h2>
            <p className="series-score">{state.handsWon[state.seriesWinner!]} to {state.handsWon[1 - state.seriesWinner!]}</p>
            <p className="muted">Series won: {teamName(0)} {state.seriesWon[0]}, {teamName(1)} {state.seriesWon[1]}</p>
            {you !== null && <button className="pill primary" onClick={() => send('newSeries')}>Start new series</button>}
          </div>
        </div>
      )}

      {state.started && (
        <>
          <TeamPanel team={myTeam} name={teamName(myTeam)} hands={handsOf(myTeam)} tens={tensOf(myTeam)}
            mine={you !== null} side="left" celebrate={!!matchDone && view?.result?.winner === myTeam}
            onRename={(n) => send('setTeamName', { name: n })} elRef={(el) => { panelEls.current.left = el; }} />
          <TeamPanel team={otherTeam} name={teamName(otherTeam)} hands={handsOf(otherTeam)} tens={tensOf(otherTeam)}
            mine={false} side="right" celebrate={!!matchDone && view?.result?.winner === otherTeam} onRename={() => {}}
            elRef={(el) => { panelEls.current.right = el; }} />
        </>
      )}

      {myTurn && !(sweep && !sweep.flying) && <div className="yourturn">Your turn</div>}
      {view && choosing && !iChoose && you !== null && showChooseUI && <div className="hint">Your cards are revealed once trump is set</div>}

      {you !== null && (showBacks > 0 || hand.length > 0) && (
        <div ref={(el) => { handRowEl.current = el; }} className={`hand ${myTurn ? 'live' : ''} ${dealing ? 'busy' : ''}`}
          style={{ ['--n' as any]: showBacks || hand.length }}>
          {showBacks > 0
            ? Array.from({ length: showBacks }).map((_, i) => (
              <CardFace key={`back-${i}`} card={null} elRef={(el) => { if (el) handEls.current.set(`back-${i}`, el); else handEls.current.delete(`back-${i}`); }} />
            ))
            : hand.map((c, i) => {
              const key = cardKey(c);
              return (
                <CardFace key={key} card={c} trump={c.s === view?.trump}
                  className={[myTurn && isLegal(c) ? 'up' : '', suitStarts.has(i) ? 'gs' : ''].join(' ')}
                  onClick={myTurn ? () => send('play', { card: c }) : undefined}
                  disabled={myTurn && !isLegal(c)}
                  elRef={(el) => { if (el) handEls.current.set(key, el); else handEls.current.delete(key); }} />
              );
            })}
        </div>
      )}

      <div className="rotate" role="dialog" aria-label="Turn your phone sideways">
        <div className="rotate-phone" aria-hidden="true" />
        <p>Turn your phone sideways. The table is built for landscape.</p>
        <button className="text-btn" onClick={() => setPortraitOk(true)}>Continue anyway</button>
      </div>

      {showResults && (
        <div className="sheet" role="dialog" aria-label="Results" onClick={() => setShowResults(false)}>
          <div className="sheet-body" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head">
              <h2>Results</h2>
              <button className="text-btn dark" onClick={() => setShowResults(false)}>Done</button>
            </div>
            <div className="sheet-stats">
              {target !== null && (
                <div><span className="k">Series won</span><span className="v"><b className="a">{teamName(0)} {state.seriesWon[0]}</b> <b className="b">{teamName(1)} {state.seriesWon[1]}</b></span></div>
              )}
              <div><span className="k">{target !== null ? `Series ${state.seriesNo}` : 'Matches won'}</span><span className="v"><b className="a">{teamName(0)} {state.handsWon[0]}</b> <b className="b">{teamName(1)} {state.handsWon[1]}</b></span></div>
              {state.watchers.length > 0 && <div><span className="k">Watching</span><span className="v">{state.watchers.join(', ')}</span></div>}
            </div>
            {state.results.length === 0 ? <p className="sheet-empty">No matches finished yet.</p> : (
              <div className="results-scroll">
                <table>
                  <thead><tr>{target !== null && <th>Series</th>}<th>Match</th><th>Chooser</th><th>Trump</th><th>Winner</th><th>Tens</th><th>Hands</th></tr></thead>
                  <tbody>
                    {state.results.slice().reverse().map((r) => (
                      <tr key={`${r.series}-${r.handNo}`}>
                        {target !== null && <td>{r.series}</td>}
                        <td>{r.handNo}</td>
                        <td>{seatName(r.chooser)}</td>
                        <td><span className={isRed(r.trump) ? 'red' : ''}>{SUIT_SYMBOL[r.trump]}</span>{r.blind ? ' blind' : ''}</td>
                        <td className={r.winner === 0 ? 'a' : 'b'}>{teamName(r.winner)}{r.tens[r.winner] === 4 ? ', all four tens' : ''}</td>
                        <td>{r.tens[0]} to {r.tens[1]}</td>
                        <td>{r.tricks[0]} to {r.tricks[1]}{r.early ? ', early' : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );

  function seat0Name(seat: number) { return seat === you ? 'You' : seatName(seat); }
}

// ---------- app ----------

export function App() {
  const { socket, connected, state, setState } = useSocket();
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [name, setName] = useState(store('mindi.name') ?? '');
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const codeRef = useRef<string | null>(null);
  codeRef.current = roomCode;
  const token = useMemo(getToken, []);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Rejoin automatically after any reconnect (network blip, phone sleep).
  useEffect(() => {
    const rejoin = () => {
      if (codeRef.current) socket.emit('join', { code: codeRef.current, token, name }, () => {});
    };
    socket.on('connect', rejoin);
    return () => { socket.off('connect', rejoin); };
  }, [socket, token, name]);

  const flash = (msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2600);
  };

  const send = (ev: string, payload?: any) => {
    socket.emit(ev, payload ?? {}, (res: Res) => { if (!res.ok) flash(res.error); });
  };

  const enter = (ev: 'create' | 'join', n: string, code?: string) => {
    const clean = n.trim();
    store('mindi.name', clean);
    setName(clean);
    setError('');
    socket.emit(ev, { code, token, name: clean }, (res: Res) => {
      if (!res.ok) { setError(res.error); return; }
      setRoomCode(res.code!);
      history.replaceState(null, '', `/?room=${res.code}`);
      if (ev === 'create') socket.emit('sit', { seat: 0, name: clean }, () => {});
    });
  };

  const leave = () => {
    setRoomCode(null);
    setState(null);
    history.replaceState(null, '', '/');
    socket.disconnect().connect();
  };

  return (
    <>
      {!connected && <div className="offline glass capsule" role="status">Reconnecting</div>}
      {state && roomCode && state.code === roomCode
        ? <Table state={state} send={send} name={name} onLeave={leave} flash={flash} />
        : <Entry onCreate={(n) => enter('create', n)} onJoin={(n, c) => enter('join', n, c)} error={error} />}
      {toast && <div className="toast glass capsule" role="alert">{toast}</div>}
    </>
  );
}
