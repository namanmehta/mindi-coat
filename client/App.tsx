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
const teamName = (t: number) => (t === 0 ? 'Team A' : 'Team B');

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

function CardFace({ card, onClick, disabled, highlight, small }: {
  card: Card; onClick?: () => void; disabled?: boolean; highlight?: boolean; small?: boolean;
}) {
  const cls = ['card', isRed(card.s) ? 'red' : 'black', card.r === 10 ? 'ten' : '', highlight ? 'win' : '',
    small ? 'small' : '', onClick ? 'playable' : '', disabled ? 'disabled' : ''].join(' ');
  const label = `${rankLabel(card.r)} of ${SUIT_NAME[card.s]}`;
  const inner = (
    <>
      <span className="corner">{rankLabel(card.r)}<br />{SUIT_SYMBOL[card.s]}</span>
      <span className="pip">{SUIT_SYMBOL[card.s]}</span>
    </>
  );
  if (onClick) {
    return <button className={cls} onClick={onClick} disabled={disabled} aria-label={label}>{inner}</button>;
  }
  return <div className={cls} aria-label={label}>{inner}</div>;
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
      <div className="panel">
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

function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

function Table({ state, send, name, onLeave }: {
  state: RoomState; send: (ev: string, payload?: any) => void; name: string; onLeave?: () => void;
}) {
  const { seats, view, you } = state;
  const me: Seat = (you ?? 0) as Seat;
  // You sit at the bottom. Play goes counterclockwise, so the next player is on your right.
  const posOf = (seat: number) => (['bottom', 'right', 'top', 'left'] as const)[(seat - me + 4) % 4];
  const myTeam = you === null ? null : you % 2;
  const now = useNow(state.paused);
  const [showResults, setShowResults] = useState(false);
  const [copied, setCopied] = useState(false);

  const shareUrl = `${location.origin}/?room=${state.code}`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(shareUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* clipboard blocked; the link is visible anyway */ }
  };

  const seatLabel = (seat: number) => seats[seat]?.name ?? 'Open seat';
  const teamTag = (seat: number) => (myTeam === null ? teamName(seat % 2) : seat % 2 === myTeam ? 'Your team' : 'Opponents');

  // Trick on the table: current trick, or the last finished trick until a new card lands.
  const shownTrick: Play[] = view ? (view.trick.length ? view.trick : view.lastTrick?.plays ?? []) : [];
  const trickWinner = view && !view.trick.length ? view.lastTrick?.winner : undefined;

  const hand = useMemo(() => {
    if (!view) return [];
    return view.myHand.slice().sort((a, b) =>
      SUIT_ORDER.indexOf(a.s) - SUIT_ORDER.indexOf(b.s) || a.r - b.r);
  }, [view]);

  const myTurn = !!view && view.phase === 'playing' && view.turn === you && !state.paused;
  const isLegal = (c: Card) => !!view?.legal.some((x) => same(x, c));
  const choosing = view && (view.phase === 'choosing' || view.phase === 'blind');
  const iChoose = !!view && view.chooser === you;

  // Pause banner text
  let pauseText = '';
  if (state.started && state.paused) {
    const gone = seats.map((s, i) => ({ s, i })).filter(({ s }) => !s || !s.connected);
    pauseText = gone.map(({ s, i }) => {
      if (!s) return 'A seat is empty';
      if (s.open) return `${s.name} left. Share the code so someone can take the ${posOf(i)} seat.`;
      const secs = Math.max(0, Math.ceil(((s.holdUntil ?? now) - now) / 1000));
      return `Waiting for ${s.name} to reconnect (${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')})`;
    }).join(' ');
  }

  const canTakeSeat = (seat: number) => {
    const s = seats[seat];
    if (you !== null) return !state.started && !s; // switch seats in the lobby
    return state.started ? !!s?.open : !s;
  };

  return (
    <div className="table-screen">
      <header className="bar">
        <button className="code-chip" onClick={copy} title="Copy invite link">
          <span className="code-label">Table</span> {state.code}
          <span className="copied" aria-live="polite">{copied ? 'Link copied' : ''}</span>
        </button>
        <div className={`trump-chip ${view?.trump ? '' : 'none'}`}>
          {view?.trump ? (
            <>
              <span className={`trump-suit ${isRed(view.trump) ? 'red' : ''}`}>{SUIT_SYMBOL[view.trump]}</span>
              <span>{view.blind ? 'Blind trump' : 'Trump'}</span>
            </>
          ) : <span>No trump</span>}
        </div>
        <button className="score-chip" onClick={() => setShowResults(true)}>
          <span className="team-a">A {state.handsWon[0]}</span>
          <span className="vs">hands won</span>
          <span className="team-b">B {state.handsWon[1]}</span>
        </button>
      </header>

      {pauseText && <div className="pause" role="status">{pauseText}</div>}

      <section className="cloth">
        {([0, 1, 2, 3] as Seat[]).map((seat) => {
          const pos = posOf(seat);
          const s = seats[seat];
          const turn = view?.phase === 'playing' && view.turn === seat;
          const isChooser = state.started && view?.chooser === seat;
          if (pos === 'bottom' && you !== null) return null;
          return (
            <div key={seat} className={`seat ${pos} team${seat % 2} ${turn ? 'turn' : ''} ${s && !s.connected ? 'away' : ''}`}>
              <div className="seat-name">{seatLabel(seat)}</div>
              <div className="seat-meta">
                {teamTag(seat)}
                {isChooser && <span className="badge">chooser</span>}
                {view && view.dealer === seat && <span className="badge quiet">dealer</span>}
              </div>
              {view && view.handCounts[seat] > 0 && <div className="backs" aria-label={`${view.handCounts[seat]} cards`}>
                {Array.from({ length: Math.min(view.handCounts[seat], 13) }).map((_, i) => <span key={i} />)}
              </div>}
              {canTakeSeat(seat) && (
                <button className="btn small" onClick={() => send('sit', { seat, name })}>
                  {state.started ? 'Take this seat' : 'Sit here'}
                </button>
              )}
            </div>
          );
        })}

        <div className="trick" aria-label="Cards on the table">
          {shownTrick.map((p) => (
            <div key={`${p.card.r}${p.card.s}`} className={`slot ${posOf(p.seat)} ${view?.trick.length ? '' : 'settled'}`}>
              <CardFace card={p.card} small highlight={trickWinner === p.seat} />
            </div>
          ))}
          {!state.started && (
            <div className="center-msg">
              {seats.filter(Boolean).length < 4
                ? <span>{seats.filter(Boolean).length} of 4 seated. Partners sit opposite.</span>
                : you !== null
                  ? <button className="btn primary" onClick={() => send('start')}>Toss and deal</button>
                  : <span>Table is full.</span>}
              {onLeave && <button className="link" onClick={onLeave}>Leave table</button>}
            </div>
          )}
          {view && choosing && !iChoose && (
            <div className="center-msg">{seatLabel(view.chooser)} is choosing trump{view.phase === 'blind' ? ' blind' : ''}.</div>
          )}
          {view?.phase === 'done' && view.result && (
            <div className="center-msg result">
              <strong>{teamName(view.result.winner)} wins hand {view.handNo}</strong>
              <span>{view.tens[view.result.winner]} tens, {view.tricks[view.result.winner]} tricks{view.result.early ? ', locked early' : ''}</span>
              {you !== null && <button className="btn primary" onClick={() => send('nextHand')}>Deal next hand</button>}
            </div>
          )}
        </div>

        {view && view.blindCard && view.phase === 'playing' && view.tricks[0] + view.tricks[1] === 0 && view.trick.length === 0 && (
          <div className="blind-reveal">
            Blind pick: <CardFace card={view.blindCard} small /> by {seatLabel(view.chooser)}
          </div>
        )}
      </section>

      {view && state.started && (
        <div className="tally">
          <span className="team-a">Team A: {view.tens[0]} tens, {view.tricks[0]} tricks</span>
          <span className="team-b">Team B: {view.tens[1]} tens, {view.tricks[1]} tricks</span>
        </div>
      )}

      {/* trump choice */}
      {view && iChoose && view.phase === 'choosing' && (
        <div className="choose">
          <p>You choose trump. Pick a suit from your five cards, or go blind.</p>
          <div className="suits">
            {(['S', 'H', 'D', 'C'] as Suit[]).map((s) => (
              <button key={s} className={`suit-btn ${isRed(s) ? 'red' : ''}`} disabled={state.paused}
                onClick={() => send('nameTrump', { suit: s })} aria-label={`Make ${SUIT_NAME[s]} trump`}>
                {SUIT_SYMBOL[s]}
              </button>
            ))}
            <button className="btn" disabled={state.paused} onClick={() => send('goBlind')}>Go blind</button>
          </div>
        </div>
      )}
      {view && iChoose && view.phase === 'blind' && (
        <div className="choose">
          <p>Tap one of your eight hidden cards. Its suit becomes trump.</p>
          <div className="blind-row">
            {Array.from({ length: view.blindSlots }).map((_, i) => (
              <button key={i} className="card back" disabled={state.paused}
                onClick={() => send('pickBlind', { index: i })} aria-label={`Hidden card ${i + 1}`} />
            ))}
          </div>
        </div>
      )}

      {/* your hand */}
      {you !== null && (
        <footer className={`me team${you % 2} ${myTurn ? 'turn' : ''}`}>
          <div className="me-line">
            <span className="seat-name">{seatLabel(you)}</span>
            <span className="seat-meta">{teamName(you % 2)}{view?.chooser === you && state.started && <span className="badge">chooser</span>}</span>
            <span className="prompt">{myTurn ? 'Your turn' : view?.phase === 'playing' ? `${seatLabel(view.turn)} to play` : ''}</span>
            {!state.started && <button className="link" onClick={() => send('standUp')}>Stand up</button>}
          </div>
          <div className="hand" style={{ ['--n' as any]: hand.length }}>
            {hand.map((c) => (
              <CardFace key={`${c.r}${c.s}`} card={c}
                onClick={myTurn ? () => send('play', { card: c }) : undefined}
                disabled={myTurn && !isLegal(c)} />
            ))}
          </div>
        </footer>
      )}

      {showResults && (
        <div className="sheet" role="dialog" aria-label="Results" onClick={() => setShowResults(false)}>
          <div className="sheet-body" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head">
              <h2>Results</h2>
              <button className="link" onClick={() => setShowResults(false)}>Close</button>
            </div>
            <p className="totals"><span className="team-a">Team A {state.handsWon[0]}</span> hands won <span className="team-b">Team B {state.handsWon[1]}</span></p>
            {state.results.length === 0 ? <p className="muted">No hands finished yet.</p> : (
              <div className="results-scroll">
                <table>
                  <thead><tr><th>Hand</th><th>Chooser</th><th>Trump</th><th>Winner</th><th>Tens</th><th>Tricks</th></tr></thead>
                  <tbody>
                    {state.results.slice().reverse().map((r) => (
                      <tr key={r.handNo}>
                        <td>{r.handNo}</td>
                        <td>{seatLabel(r.chooser)}</td>
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
