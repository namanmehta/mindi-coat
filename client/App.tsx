import { useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import type { Card, Seat, Suit, Play } from '../engine/engine';
import type { RoomState } from '../server/protocol';

// ---------- small helpers ----------

const SUIT_SYMBOL: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
const SUIT_NAME: Record<Suit, string> = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs' };
const SUIT_ORDER: Suit[] = ['S', 'H', 'C', 'D']; // alternates colour in the hand
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

// ---------- cards ----------

function CardFace({ card, onClick, disabled, highlight, trump, className, style }: {
  card: Card; onClick?: () => void; disabled?: boolean; highlight?: boolean; trump?: boolean;
  className?: string; style?: React.CSSProperties;
}) {
  const cls = ['card', isRed(card.s) ? 'red' : 'black', card.r === 10 ? 'ten' : '', highlight ? 'win' : '',
    trump ? 'trumpc' : '', onClick ? 'playable' : '', disabled ? 'disabled' : '', className ?? ''].join(' ');
  const label = `${rankLabel(card.r)} of ${SUIT_NAME[card.s]}`;
  const inner = (
    <>
      <span className="corner">{rankLabel(card.r)}<br />{SUIT_SYMBOL[card.s]}</span>
      <span className="pip">{SUIT_SYMBOL[card.s]}</span>
    </>
  );
  if (onClick) {
    return <button className={cls} style={style} onClick={onClick} disabled={disabled} aria-label={label}>{inner}</button>;
  }
  return <div className={cls} style={style} aria-label={label}>{inner}</div>;
}

// ---------- entry screen ----------

function Entry({ onCreate, onJoin, error }: {
  onCreate: (name: string) => void; onJoin: (name: string, code: string) => void; error: string;
}) {
  const initialCode = new URLSearchParams(location.search).get('room')?.toUpperCase() ?? '';
  const [name, setName] = useState(store('mindi.name') ?? '');
  const [code, setCode] = useState(initialCode);
  const ready = name.trim().length > 0;
  return (
    <main className="entry">
      <h1 className="wordmark">Mindi<span>Coat</span></h1>
      <p className="tagline">Four friends, two teams, the four tens. Real players only.</p>
      <div className="entry-panel">
        <label className="field">
          <span>Your name</span>
          <input value={name} maxLength={20} autoComplete="nickname" onChange={(e) => setName(e.target.value)}
            placeholder="What your table calls you" />
        </label>
        {initialCode ? null : (
          <button className="btn primary" disabled={!ready} onClick={() => onCreate(name)}>Create a table</button>
        )}
        <div className="join-row">
          <input className="code-input" value={code} maxLength={4} placeholder="Code"
            aria-label="Room code" onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} />
          <button className={`btn ${initialCode ? 'primary' : ''}`} disabled={!ready || code.length !== 4}
            onClick={() => onJoin(name, code)}>Join table</button>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </main>
  );
}

// ---------- the table ----------

type Pos = 'bottom' | 'right' | 'top' | 'left';

// Where each played card sits on the felt, and where it flies when its hand is won (in --u units).
const CARD_CENTER: Record<Pos, [number, number]> = { bottom: [0, 7.8], top: [0, -7.7], left: [-16.8, 0], right: [16.8, 0] };
const SEAT_CENTER: Record<Pos, [number, number]> = { bottom: [0, 26], top: [0, -26], left: [-59, 0], right: [59, 0] };

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

/** When a hand completes: hold the four cards with the winner lit, then sweep them to the winner. */
function useSweep(view: RoomState['view']) {
  const [sweep, setSweep] = useState<{ key: string; plays: Play[]; winner: Seat; flying: boolean } | null>(null);
  const prev = useRef<{ handNo: number; done: number } | null>(null);
  const done = view ? view.tricks[0] + view.tricks[1] : 0;
  useEffect(() => {
    if (!view) { prev.current = null; return; }
    const p = prev.current;
    prev.current = { handNo: view.handNo, done };
    if (p && p.handNo === view.handNo && done === p.done + 1 && view.lastTrick) {
      const key = `${view.handNo}-${done}`;
      setSweep({ key, plays: view.lastTrick.plays, winner: view.lastTrick.winner, flying: false });
      setTimeout(() => setSweep((s) => (s && s.key === key ? { ...s, flying: true } : s)), 1100);
      setTimeout(() => setSweep((s) => (s && s.key === key ? null : s)), 1700);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view?.handNo, done]);
  // The winner already led the next hand: clear the table at once.
  return sweep && view && view.trick.length === 0 ? sweep : null;
}

function TeamPanel({ team, name, hands, tens, mine, side, onRename }: {
  team: 0 | 1; name: string; hands: number; tens: Suit[]; mine: boolean; side: 'left' | 'right';
  onRename: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const save = () => { const n = draft.trim(); if (n && n !== name) onRename(n); setEditing(false); };
  return (
    <section className={`team-panel ${side} t${team}`} aria-label={`${name} score`}>
      <div className="tp-head">
        {editing ? (
          <form className="rename" onSubmit={(e) => { e.preventDefault(); save(); }}>
            <input value={draft} maxLength={20} autoFocus aria-label="Team name"
              onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setEditing(false); }} />
            <button className="btn tiny primary" type="submit">Save</button>
          </form>
        ) : (
          <>
            <span className="tname">{name}</span>
            {mine && <button className="edit" onClick={() => { setDraft(name); setEditing(true); }} aria-label="Rename your team" title="Rename your team">✎</button>}
            <span className="hands"><b>{hands}</b> {hands === 1 ? 'hand' : 'hands'}</span>
          </>
        )}
      </div>
      <div className="tens">
        {(['S', 'H', 'C', 'D'] as Suit[]).map((suit) => {
          const won = tens.includes(suit);
          return (
            <div key={suit} className={`mini ${won ? 'won' : ''} ${won && isRed(suit) ? 'red' : ''}`}
              aria-label={`10 of ${SUIT_NAME[suit]}${won ? ' won' : ' not won'}`}>
              <span>10<br /><span className="ss">{SUIT_SYMBOL[suit]}</span></span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Table({ state, send, name, onLeave }: {
  state: RoomState; send: (ev: string, payload?: any) => void; name: string; onLeave?: () => void;
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
  const [copied, setCopied] = useState(false);
  const [portraitOk, setPortraitOk] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${location.origin}/?room=${state.code}`);
      setCopied(true); setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked */ }
  };

  const seatName = (seat: number) => seats[seat]?.name ?? 'Open seat';
  const hand = useMemo(() => {
    if (!view) return [];
    // trump suit last, so trump cards sit together on the right
    const order = SUIT_ORDER.filter((s) => s !== view.trump).concat(view.trump ? [view.trump] : []);
    return view.myHand.slice().sort((a, b) => order.indexOf(a.s) - order.indexOf(b.s) || a.r - b.r);
  }, [view]);

  const myTurn = !!view && view.phase === 'playing' && view.turn === you && !state.paused;
  const isLegal = (c: Card) => !!view?.legal.some((x) => same(x, c));
  const iChoose = !!view && view.chooser === you;
  const seated = seats.filter(Boolean).length;
  const target = state.seriesTarget;

  let pauseText = '';
  if (state.started && state.paused) {
    pauseText = seats.map((s, i) => {
      if (s && s.connected) return '';
      if (!s) return 'A seat is empty.';
      if (s.open) return `${s.name} left. Share the code so someone can take the ${posOf(i)} seat.`;
      const secs = Math.max(0, Math.ceil(((s.holdUntil ?? now) - now) / 1000));
      return `Waiting for ${s.name} to reconnect (${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')})`;
    }).filter(Boolean).join(' ');
  }

  const canTakeSeat = (seat: number) => {
    const s = seats[seat];
    if (you !== null) return !state.started && !s;
    return state.started ? !!s?.open : !s;
  };

  const tensOf = (t: number) => (view?.tensTaken ?? []).filter((x) => x.team === t).map((x) => x.suit);

  // What sits on the felt: the live hand, or the finished hand being swept to its winner.
  const onFelt: { plays: Play[]; winner?: Seat; flying: boolean } =
    view && view.trick.length ? { plays: view.trick, flying: false }
      : sweep ? { plays: sweep.plays, winner: sweep.winner, flying: sweep.flying }
        : { plays: [], flying: false };

  const flyStyle = (from: Pos, to: Pos): React.CSSProperties => {
    const [cx, cy] = CARD_CENTER[from], [tx, ty] = SEAT_CENTER[to];
    return { transform: `translate(calc(var(--u) * ${tx - cx}), calc(var(--u) * ${ty - cy})) scale(0.35)`, opacity: 0 };
  };

  return (
    <div className={`board ${portraitOk ? 'portrait-ok' : ''}`}>
      <header className="bar">
        <div className="bar-left">
          <button className="chip code-chip" onClick={copy} title="Copy invite link">
            <span className="dim">Table</span>{state.code}
            <span className="copied" aria-live="polite">{copied ? 'Link copied' : ''}</span>
          </button>
          {!state.started && onLeave && <button className="link" onClick={onLeave}>Leave</button>}
        </div>
        <button className="chip match" onClick={() => setShowResults(true)} title="Results">
          <span className="a">{teamName(0)}</span><span className="n">{state.handsWon[0]}</span>
          <span className="sep" />
          <span className="n">{state.handsWon[1]}</span><span className="b">{teamName(1)}</span>
          <small>{target ? `first to ${target}` : 'matches'}</small>
        </button>
        <div className="bar-right" />
      </header>

      {view?.trump && (
        <div className="trump">
          <div className={`tile ${isRed(view.trump) ? 'red' : ''}`}>{SUIT_SYMBOL[view.trump]}</div>
          <span>{view.blind ? 'Blind trump' : 'Trump'}</span>
          {view.blindCard && view.tricks[0] + view.tricks[1] === 0 && (
            <div className="legend">picked by {seatName(view.chooser)}</div>
          )}
          {you !== null && <div className="legend"><i />tinted in your hand</div>}
        </div>
      )}

      {pauseText && <div className="pause" role="status">{pauseText}</div>}

      <div className="felt" />

      {([0, 1, 2, 3] as Seat[]).map((seat) => {
        const pos = posOf(seat);
        const s = seats[seat];
        const turn = view?.phase === 'playing' && view.turn === seat && !state.paused;
        const isChooser = state.started && view && view.chooser === seat;
        const mine = seat === you;
        const count = view && !mine ? view.handCounts[seat] : 0;
        return (
          <div key={seat} className={`seat s-${pos} t${seat % 2} ${turn ? 'turn' : ''} ${s && !s.connected ? 'away' : ''} ${s ? '' : 'empty'}`}>
            <div className="avatar" aria-hidden="true">
              {isChooser && <span className="crown" title="Chose trump">👑</span>}
              {s ? initials(s.name) : '+'}
            </div>
            <div className={`plate ${mine && myTurn ? 'me-turn' : ''}`}>
              {mine && myTurn ? 'Your turn' : seatName(seat)}
              {pos === 'top' && count > 0 && <span className="cnt">{count} cards</span>}
            </div>
            {(pos === 'left' || pos === 'right') && count > 0 && <div className="count">{count} cards</div>}
            {canTakeSeat(seat) && (
              <button className="btn tiny" onClick={() => send('sit', { seat, name })}>
                {state.started ? 'Take seat' : 'Sit here'}
              </button>
            )}
          </div>
        );
      })}

      <div className="trick" aria-label="Cards on the table">
        {onFelt.plays.map((p) => {
          const pos = posOf(p.seat);
          return (
            <CardFace key={`${p.card.r}${p.card.s}`} card={p.card} className={`t-${pos} ${onFelt.flying ? 'flying' : ''}`}
              highlight={onFelt.winner === p.seat}
              style={onFelt.flying && onFelt.winner !== undefined ? flyStyle(pos, posOf(onFelt.winner)) : undefined} />
          );
        })}
        {sweep && !sweep.flying && (
          <div className="won-tag" role="status">{sweep.winner === you ? 'You win' : `${seatName(sweep.winner)} wins`} the hand</div>
        )}
      </div>

      {/* felt messages */}
      {!state.started && (
        <div className="felt-msg">
          <p>{seated < 4 ? `${seated} of 4 seated. Partners sit opposite.` : 'Everyone is seated.'}</p>
          <div className="seg" role="group" aria-label="Series length">
            <button className={target === 4 ? 'on' : ''} disabled={you === null} onClick={() => send('setSeries', { target: 4 })}>Best of 7</button>
            <button className={target === null ? 'on' : ''} disabled={you === null} onClick={() => send('setSeries', { target: null })}>No limit</button>
          </div>
          {seated === 4 && you !== null && <button className="btn primary" onClick={() => send('start')}>Toss and deal</button>}
        </div>
      )}
      {state.started && !view && state.seriesWinner === null && (
        <div className="felt-msg">
          <p><strong>Series {state.seriesNo}</strong></p>
          {you !== null && <button className="btn primary" onClick={() => send('nextHand')}>Deal first match</button>}
        </div>
      )}
      {view && (view.phase === 'choosing' || view.phase === 'blind') && !iChoose && (
        <div className="felt-msg quiet"><p>{seatName(view.chooser)} is choosing trump{view.phase === 'blind' ? ' blind' : ''}.</p></div>
      )}
      {view && iChoose && view.phase === 'choosing' && (
        <div className="felt-msg choose">
          <p>You choose trump. Pick a suit from your five cards, or go blind.</p>
          <div className="suits">
            {(['S', 'H', 'D', 'C'] as Suit[]).map((s) => (
              <button key={s} className={`suit-btn ${isRed(s) ? 'red' : ''}`} disabled={state.paused}
                onClick={() => send('nameTrump', { suit: s })} aria-label={`Make ${SUIT_NAME[s]} trump`}>{SUIT_SYMBOL[s]}</button>
            ))}
            <button className="btn" disabled={state.paused} onClick={() => send('goBlind')}>Go blind</button>
          </div>
        </div>
      )}
      {view && iChoose && view.phase === 'blind' && (
        <div className="felt-msg choose">
          <p>Tap one of your eight hidden cards. Its suit becomes trump.</p>
          <div className="blind-row">
            {Array.from({ length: view.blindSlots }).map((_, i) => (
              <button key={i} className="card back" disabled={state.paused}
                onClick={() => send('pickBlind', { index: i })} aria-label={`Hidden card ${i + 1}`} />
            ))}
          </div>
        </div>
      )}
      {view?.phase === 'done' && view.result && !(sweep && !sweep.flying) && (
        <div className="felt-msg result">
          {state.seriesWinner !== null ? (
            <>
              <strong>{teamName(state.seriesWinner)} win the series {state.handsWon[state.seriesWinner]} to {state.handsWon[1 - state.seriesWinner]}</strong>
              <span>Series won: {teamName(0)} {state.seriesWon[0]}, {teamName(1)} {state.seriesWon[1]}</span>
              {you !== null && <button className="btn primary" onClick={() => send('newSeries')}>Start new series</button>}
            </>
          ) : (
            <>
              <strong>{teamName(view.result.winner)} win match {view.handNo}</strong>
              <span>{plural(view.tens[view.result.winner], 'ten')}, {plural(view.tricks[view.result.winner], 'hand')}{view.result.early ? ', locked early' : ''}</span>
              {you !== null && <button className="btn primary" onClick={() => send('nextHand')}>Deal next match</button>}
            </>
          )}
        </div>
      )}

      {state.started && (
        <>
          <TeamPanel team={myTeam} name={teamName(myTeam)} hands={view?.tricks[myTeam] ?? 0} tens={tensOf(myTeam)}
            mine={you !== null} side="left" onRename={(n) => send('setTeamName', { name: n })} />
          <TeamPanel team={otherTeam} name={teamName(otherTeam)} hands={view?.tricks[otherTeam] ?? 0} tens={tensOf(otherTeam)}
            mine={false} side="right" onRename={() => {}} />
        </>
      )}
      {!state.started && you !== null && (
        <section className="team-panel left t0 lobby-names">
          <p>Name your team</p>
          <TeamNameField current={teamName(myTeam)} onSave={(n) => send('setTeamName', { name: n })} />
        </section>
      )}

      {you !== null && hand.length > 0 && (
        <div className={`hand ${myTurn ? 'live' : ''}`} style={{ ['--n' as any]: hand.length }}>
          {hand.map((c) => (
            <CardFace key={`${c.r}${c.s}`} card={c} trump={c.s === view?.trump}
              className={myTurn && isLegal(c) ? 'up' : ''}
              onClick={myTurn ? () => send('play', { card: c }) : undefined}
              disabled={myTurn && !isLegal(c)} />
          ))}
        </div>
      )}

      <div className="rotate" role="dialog" aria-label="Rotate your phone">
        <div className="rotate-phone" aria-hidden="true" />
        <p>Turn your phone sideways. The table is built for landscape.</p>
        <button className="link" onClick={() => setPortraitOk(true)}>Continue anyway</button>
      </div>

      {showResults && (
        <div className="sheet" role="dialog" aria-label="Results" onClick={() => setShowResults(false)}>
          <div className="sheet-body" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head">
              <h2>Results</h2>
              <button className="link" onClick={() => setShowResults(false)}>Close</button>
            </div>
            {target !== null && (
              <p className="totals">Series won: <span className="team-a">{teamName(0)} {state.seriesWon[0]}</span>, <span className="team-b">{teamName(1)} {state.seriesWon[1]}</span></p>
            )}
            <p className="totals">{target !== null ? `Series ${state.seriesNo}: ` : 'Matches won: '}<span className="team-a">{teamName(0)} {state.handsWon[0]}</span>, <span className="team-b">{teamName(1)} {state.handsWon[1]}</span></p>
            {state.results.length === 0 ? <p className="muted">No matches finished yet.</p> : (
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
                        <td className={r.winner === 0 ? 'team-a' : 'team-b'}>{teamName(r.winner)}{r.tens[r.winner] === 4 ? ', all four tens' : ''}</td>
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
}

function TeamNameField({ current, onSave }: { current: string; onSave: (n: string) => void }) {
  const [draft, setDraft] = useState(current);
  useEffect(() => { setDraft(current); }, [current]);
  const dirty = draft.trim() && draft.trim() !== current;
  return (
    <form className="rename" onSubmit={(e) => { e.preventDefault(); if (dirty) onSave(draft.trim()); }}>
      <input value={draft} maxLength={20} aria-label="Team name" onChange={(e) => setDraft(e.target.value)} />
      <button className="btn tiny primary" type="submit" disabled={!dirty}>Save</button>
    </form>
  );
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

  // Rejoin automatically after any reconnect (network blip, phone sleep).
  useEffect(() => {
    const rejoin = () => {
      if (codeRef.current) socket.emit('join', { code: codeRef.current, token, name }, () => {});
    };
    socket.on('connect', rejoin);
    return () => { socket.off('connect', rejoin); };
  }, [socket, token, name]);

  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2600); };

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
      {!connected && <div className="offline" role="status">Reconnecting to the server</div>}
      {state && roomCode && state.code === roomCode
        ? <Table state={state} send={send} name={name} onLeave={leave} />
        : <Entry onCreate={(n) => enter('create', n)} onJoin={(n, c) => enter('join', n, c)} error={error} />}
      {toast && <div className="toast" role="alert">{toast}</div>}
    </>
  );
}
