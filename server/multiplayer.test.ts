// End to end: four real socket clients play against a live server.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { io as connect, Socket } from 'socket.io-client';
import { startServer } from './index';
import type { RoomState } from './protocol';

let server: Awaited<ReturnType<typeof startServer>>;
const RECONNECT_MS = 400;

beforeAll(async () => { server = await startServer(0, { reconnectMs: RECONNECT_MS }); });
afterAll(async () => { await server.close(); });

interface Client { s: Socket; token: string; name: string; last: RoomState | null }

function client(name: string, token = `tok-${name}-${Math.random()}`): Promise<Client> {
  return new Promise((resolve) => {
    const s = connect(`http://localhost:${server.port}`, { transports: ['websocket'], forceNew: true });
    const c: Client = { s, token, name, last: null };
    s.on('state', (st: RoomState) => { c.last = st; });
    s.on('connect', () => resolve(c));
  });
}

function emit(c: Client, ev: string, payload: any = {}): Promise<any> {
  return new Promise((resolve) => c.s.emit(ev, payload, resolve));
}

const settle = () => new Promise((r) => setTimeout(r, 120));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fullTable() {
  const names = ['Asha', 'Bilal', 'Chitra', 'Dev'];
  const cs = await Promise.all(names.map((n) => client(n)));
  const created = await emit(cs[0], 'create', { token: cs[0].token, name: 'Asha' });
  expect(created.ok).toBe(true);
  const code = created.code as string;
  for (let i = 1; i < 4; i++) {
    const r = await emit(cs[i], 'join', { code: code.toLowerCase(), token: cs[i].token, name: names[i] });
    expect(r.ok).toBe(true);
  }
  for (let i = 0; i < 4; i++) expect((await emit(cs[i], 'sit', { seat: i, name: names[i] })).ok).toBe(true);
  await settle();
  return { cs, code };
}

/** Play out the current hand: every move picked from the mover's own legal list. */
async function playHand(cs: Client[]) {
  let guard = 0;
  for (;;) {
    await settle();
    const v = cs[0].last!.view!;
    if (v.phase === 'done') return;
    if (v.phase === 'choosing') {
      const r = await emit(cs[v.chooser], 'nameTrump', { suit: 'H' });
      expect(r.ok).toBe(true);
      continue;
    }
    const mover = cs[v.turn];
    const legal = mover.last!.view!.legal;
    expect(legal.length).toBeGreaterThan(0);
    const r = await emit(mover, 'play', { card: legal[0] });
    expect(r).toEqual({ ok: true });
    expect(++guard).toBeLessThan(60);
  }
}

describe('multiplayer table', { timeout: 30000 }, () => {
  it('seats four players, deals, hides hands, and finishes hands', async () => {
    const { cs } = await fullTable();
    // no game before start; a fifth person cannot take a filled seat
    const extra = await client('Eve');
    expect((await emit(extra, 'join', { code: cs[0].last!.code, token: extra.token, name: 'Eve' })).ok).toBe(true);
    expect((await emit(extra, 'sit', { seat: 2, name: 'Eve' })).ok).toBe(false);

    expect((await emit(cs[1], 'start')).ok).toBe(true);
    await settle();
    const st = cs[0].last!;
    expect(st.started).toBe(true);
    const chooser = st.view!.chooser;
    for (let i = 0; i < 4; i++) {
      const v = cs[i].last!.view!;
      // only the chooser receives cards while trump is chosen; nothing to peek at in the payload
      expect(v.myHand.length).toBe(i === chooser ? 5 : 0);
      if (i !== chooser) expect(JSON.stringify(cs[i].last).match(/"s":"[SHDC]"/g) ?? []).toEqual([]);
      expect(cs[i].last!.you).toBe(i);
    }
    // everyone at the table sees who is watching
    expect(cs[0].last!.watchers).toEqual(['Eve']);
    expect(cs[3].last!.watchers).toEqual(['Eve']);
    // spectator sees no cards, and nobody's payload contains another hand
    expect(extra.last!.view!.myHand).toEqual([]);
    const leaked = JSON.stringify(cs[chooser].last).match(/"s":"[SHDC]"/g) ?? [];
    expect(leaked.length).toBe(5); // the chooser's payload holds exactly their own 5 cards

    // wrong player cannot choose trump
    const wrong = cs[(chooser + 1) % 4];
    expect((await emit(wrong, 'nameTrump', { suit: 'S' })).ok).toBe(false);

    // garbage input is rejected without crashing
    expect((await emit(cs[chooser], 'play', { card: null })).ok).toBe(false);
    expect((await emit(cs[chooser], 'pickBlind', { index: 99 })).ok).toBe(false);

    await playHand(cs);
    let s = cs[2].last!;
    expect(s.results.length).toBe(1);
    expect(s.handsWon[0] + s.handsWon[1]).toBe(1);
    const expectedNext = s.results[0].winner === chooser % 2 ? (chooser + 2) % 4 : (chooser + 1) % 4;
    expect(s.nextChooser).toBe(expectedNext);

    // second hand: blind trump
    expect((await emit(cs[3], 'nextHand')).ok).toBe(true);
    await settle();
    const c2 = cs[0].last!.view!.chooser;
    expect(c2).toBe(expectedNext);
    expect((await emit(cs[c2], 'goBlind')).ok).toBe(true);
    await settle();
    expect(cs[c2].last!.view!.blindSlots).toBe(8);
    expect(cs[(c2 + 1) % 4].last!.view!.blindSlots).toBe(0);
    expect((await emit(cs[c2], 'pickBlind', { index: 3 })).ok).toBe(true);
    await settle();
    const v2 = cs[(c2 + 2) % 4].last!.view!;
    expect(v2.blind).toBe(true);
    expect(v2.trump).toBe(v2.blindCard!.s);
    expect(v2.myHand.length).toBe(13);
    await playHand(cs);
    s = cs[1].last!;
    expect(s.results.length).toBe(2);
    expect(s.results[1].blind).toBe(true);

    extra.s.close();
    await settle();
    expect(cs[0].last!.watchers).toEqual([]); // gone when they leave
    for (const c of cs) c.s.close();
  });

  it('two players racing for the same turn: exactly one wins', async () => {
    const { cs } = await fullTable();
    await emit(cs[0], 'start');
    await settle();
    const v = cs[0].last!.view!;
    await emit(cs[v.chooser], 'nameTrump', { suit: 'S' });
    await settle();
    const t = cs[0].last!.view!.turn;
    const mover = cs[t], other = cs[(t + 2) % 4]; // never the next player
    const [a, b] = await Promise.all([
      emit(mover, 'play', { card: mover.last!.view!.legal[0] }),
      emit(other, 'play', { card: other.last!.view!.myHand[0] }),
    ]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(false); // it was not their turn when it arrived
    await settle();
    expect(cs[0].last!.view!.trick.length).toBe(1);
    for (const c of cs) c.s.close();
  });

  it('disconnect pauses the game, reconnect resumes with the same hand', async () => {
    const { cs } = await fullTable();
    await emit(cs[0], 'start');
    await settle();
    const chooser = cs[0].last!.view!.chooser;
    const away = cs[chooser];
    const handBefore = away.last!.view!.myHand;
    away.s.close();
    await settle();
    const st = cs[(chooser + 1) % 4].last!;
    expect(st.paused).toBe(true);
    expect(st.seats[chooser]!.connected).toBe(false);
    expect(st.seats[chooser]!.holdUntil).not.toBeNull();

    // back with the same token, before the window closes
    const back = await client(away.name, away.token);
    expect((await emit(back, 'join', { code: st.code, token: away.token, name: away.name })).ok).toBe(true);
    await settle();
    expect(back.last!.you).toBe(chooser);
    expect(back.last!.view!.myHand).toEqual(handBefore);
    expect(back.last!.paused).toBe(false);
    expect((await emit(back, 'nameTrump', { suit: 'C' })).ok).toBe(true);
    for (const c of cs) c.s.close();
    back.s.close();
  });

  it('after the window, the seat opens to a new human (never a bot)', async () => {
    const { cs, code } = await fullTable();
    await emit(cs[0], 'start');
    await settle();
    const seat = 2;
    const hand = cs[seat].last!.view!.myHand;
    cs[seat].s.close();
    await settle();
    // actions blocked while paused
    const ch = cs[0].last!.view!.chooser;
    if (ch !== seat) expect((await emit(cs[ch], 'nameTrump', { suit: 'D' })).error).toMatch(/Paused/);

    // newcomer cannot grab a held seat
    const sub = await client('Farah');
    await emit(sub, 'join', { code, token: sub.token, name: 'Farah' });
    expect((await emit(sub, 'sit', { seat, name: 'Farah' })).ok).toBe(false);

    await wait(RECONNECT_MS + 150);
    const st = cs[0].last!;
    expect(st.seats[seat]!.open).toBe(true);
    expect(st.paused).toBe(true); // still paused: no bot filled it

    expect((await emit(sub, 'sit', { seat, name: 'Farah' })).ok).toBe(true);
    await settle();
    expect(sub.last!.you).toBe(seat);
    expect(sub.last!.view!.myHand).toEqual(hand);
    expect(sub.last!.paused).toBe(false);

    // the old token can no longer take it back
    const ghost = await client('ghost', cs[seat].token);
    await emit(ghost, 'join', { code, token: cs[seat].token, name: 'ghost' });
    await settle();
    expect(ghost.last!.you).toBe(null);
    for (const c of [...cs, sub, ghost]) c.s.close();
  });

  it('each team names itself; only seated players, only their own team', async () => {
    const { cs } = await fullTable();
    expect(cs[0].last!.teamNames).toEqual(['Team A', 'Team B']);
    expect((await emit(cs[0], 'setTeamName', { name: '  Delhi   Dhurandhars ' })).ok).toBe(true);
    expect((await emit(cs[1], 'setTeamName', { name: 'Tampa Tigers' })).ok).toBe(true);
    await settle();
    expect(cs[3].last!.teamNames).toEqual(['Delhi Dhurandhars', 'Tampa Tigers']);
    // partner of seat 0 renames team A again
    expect((await emit(cs[2], 'setTeamName', { name: 'Lions' })).ok).toBe(true);
    // duplicate of other team rejected; blank rejected
    expect((await emit(cs[3], 'setTeamName', { name: 'lions' })).ok).toBe(false);
    expect((await emit(cs[3], 'setTeamName', { name: '   ' })).ok).toBe(false);
    // spectators cannot rename
    const spec = await client('Spec');
    await emit(spec, 'join', { code: cs[0].last!.code, token: spec.token, name: 'Spec' });
    expect((await emit(spec, 'setTeamName', { name: 'Hijack' })).ok).toBe(false);
    await settle();
    expect(cs[1].last!.teamNames).toEqual(['Lions', 'Tampa Tigers']);
    for (const c of [...cs, spec]) c.s.close();
  });

  it('series: chosen in the lobby, ends at 4 wins, new series resets', async () => {
    const { cs } = await fullTable();
    expect(cs[0].last!.seriesTarget).toBe(4); // best of 7 by default
    expect((await emit(cs[1], 'setSeries', { target: 9 })).ok).toBe(false);
    expect((await emit(cs[1], 'setSeries', { target: null })).ok).toBe(true);
    await settle();
    expect(cs[3].last!.seriesTarget).toBe(null);
    expect((await emit(cs[1], 'setSeries', { target: 4 })).ok).toBe(true);
    await emit(cs[0], 'start');
    expect((await emit(cs[1], 'setSeries', { target: null })).ok).toBe(false); // locked once started
    expect((await emit(cs[0], 'newSeries')).ok).toBe(false); // not over yet
    let st = cs[0].last!;
    for (let m = 0; m < 7 && cs[0].last!.seriesWinner === null; m++) {
      if (m > 0) expect((await emit(cs[m % 4], 'nextHand')).ok).toBe(true);
      await playHand(cs);
    }
    await settle();
    st = cs[2].last!;
    expect(st.seriesWinner).not.toBe(null);
    expect(st.handsWon[st.seriesWinner!]).toBe(4);
    expect(st.seriesWon[st.seriesWinner!]).toBe(1);
    expect((await emit(cs[0], 'nextHand')).error).toMatch(/series is over/);
    expect((await emit(cs[3], 'newSeries')).ok).toBe(true);
    await settle();
    st = cs[1].last!;
    expect(st.handsWon).toEqual([0, 0]);
    expect(st.seriesNo).toBe(2);
    expect((await emit(cs[0], 'nextHand')).ok).toBe(true);
    await settle();
    expect(cs[0].last!.view!.handNo).toBe(1);
    for (const c of cs) c.s.close();
  }, 120000);

  it('bad room code is a clear error', async () => {
    const c = await client('Zed');
    const r = await emit(c, 'join', { code: 'QQQQ', token: c.token, name: 'Zed' });
    expect(r).toEqual({ ok: false, error: 'Room not found. Check the code.' });
    c.s.close();
  });
});
