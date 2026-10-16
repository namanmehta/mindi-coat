// Room and seat management. Owns the authoritative game state for each table.
import {
  Seat, Sitting, Suit, Card, RuleError, newSitting, newSeries, startHand, nameTrump, goBlind, pickBlind, playCard, viewFor,
} from '../engine/engine';
import { RoomState, RECONNECT_MS } from './protocol';

interface SeatRec {
  name: string;
  token: string;
  socketId: string | null;
  holdUntil: number | null;
  open: boolean;
}

export interface Room {
  code: string;
  seats: (SeatRec | null)[];
  sitting: Sitting | null;
  /** socketId -> token, for everyone in the room including spectators */
  members: Map<string, string>;
  timers: Map<number, ReturnType<typeof setTimeout>>;
  emptySince: number | null;
  teamNames: [string, string];
  /** matches needed to win a series: 4 = best of 7, null = no limit */
  seriesTarget: number | null;
}

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I, L, O, 0, 1

export class RoomManager {
  rooms = new Map<string, Room>();
  constructor(
    private onChange: (room: Room) => void,
    private rng: () => number = Math.random,
    private now: () => number = Date.now,
    private reconnectMs = RECONNECT_MS,
  ) {}

  private newCode(): string {
    for (;;) {
      let code = '';
      for (let i = 0; i < 4; i++) code += CODE_CHARS[Math.floor(this.rng() * CODE_CHARS.length)];
      if (!this.rooms.has(code)) return code;
    }
  }

  create(): Room {
    const room: Room = {
      code: this.newCode(), seats: [null, null, null, null], sitting: null,
      members: new Map(), timers: new Map(), emptySince: this.now(),
      teamNames: ['Team A', 'Team B'],
      seriesTarget: 4,
    };
    this.rooms.set(room.code, room);
    return room;
  }

  get(code: string): Room {
    const room = this.rooms.get(String(code || '').toUpperCase().trim());
    if (!room) throw new RuleError('Room not found. Check the code.');
    return room;
  }

  seatOf(room: Room, token: string): Seat | null {
    const i = room.seats.findIndex((s) => s && s.token === token);
    return i < 0 ? null : (i as Seat);
  }

  /** Enter a room. A returning token reclaims its seat. */
  join(room: Room, socketId: string, token: string, name: string): void {
    room.members.set(socketId, token);
    room.emptySince = null;
    const seat = this.seatOf(room, token);
    if (seat !== null) {
      const rec = room.seats[seat]!;
      rec.socketId = socketId;
      rec.holdUntil = null;
      rec.open = false;
      if (name) rec.name = name;
      this.clearTimer(room, seat);
    }
    this.onChange(room);
  }

  /** Take a seat: an empty one before the game, or an abandoned one during it. */
  sit(room: Room, socketId: string, seat: number, name: string): void {
    const token = room.members.get(socketId);
    if (!token) throw new RuleError('Join the room first');
    if (![0, 1, 2, 3].includes(seat)) throw new RuleError('Invalid seat');
    const cleanName = cleanup(name);
    if (!cleanName) throw new RuleError('Enter a name');
    const current = this.seatOf(room, token);
    const target = room.seats[seat];
    if (room.sitting) {
      if (current !== null) throw new RuleError('You already have a seat');
      if (!target || !target.open) throw new RuleError('That seat is taken');
    } else {
      if (target && target.token !== token) throw new RuleError('That seat is taken');
      if (current !== null) room.seats[current] = null; // switching seats in the lobby
    }
    this.clearTimer(room, seat);
    room.seats[seat] = { name: cleanName, token, socketId, holdUntil: null, open: false };
    this.onChange(room);
  }

  /** Leave your seat on purpose. In a game, the seat opens for a replacement right away. */
  standUp(room: Room, socketId: string): void {
    const seat = this.requireSeat(room, socketId);
    this.clearTimer(room, seat);
    if (room.sitting) {
      const rec = room.seats[seat]!;
      rec.socketId = null; rec.holdUntil = null; rec.open = true; rec.token = `left:${rec.token}`;
    } else {
      room.seats[seat] = null;
    }
    this.onChange(room);
  }

  disconnect(socketId: string): void {
    for (const room of this.rooms.values()) {
      if (!room.members.has(socketId)) continue;
      room.members.delete(socketId);
      const i = room.seats.findIndex((s) => s && s.socketId === socketId);
      if (i >= 0) {
        const rec = room.seats[i]!;
        rec.socketId = null;
        rec.holdUntil = this.now() + this.reconnectMs;
        this.clearTimer(room, i);
        room.timers.set(i, setTimeout(() => this.expire(room, i), this.reconnectMs));
      }
      if (room.members.size === 0) room.emptySince = this.now();
      this.onChange(room);
    }
  }

  /** Reconnect window closed. */
  expire(room: Room, seat: number): void {
    room.timers.delete(seat);
    const rec = room.seats[seat];
    if (!rec || rec.socketId) return;
    if (room.sitting) { rec.open = true; rec.holdUntil = null; }
    else room.seats[seat] = null;
    this.onChange(room);
  }

  private clearTimer(room: Room, seat: number) {
    const t = room.timers.get(seat);
    if (t) { clearTimeout(t); room.timers.delete(seat); }
  }

  paused(room: Room): boolean {
    return !!room.sitting && room.seats.some((s) => !s || !s.socketId);
  }

  private requireSeat(room: Room, socketId: string): Seat {
    const token = room.members.get(socketId);
    const seat = token ? this.seatOf(room, token) : null;
    if (seat === null) throw new RuleError('You are not seated');
    return seat;
  }

  private act(room: Room, socketId: string, fn: (s: Sitting, seat: Seat) => Sitting): void {
    const seat = this.requireSeat(room, socketId);
    if (!room.sitting) throw new RuleError('The game has not started');
    if (this.paused(room)) throw new RuleError('Paused: waiting for all four players');
    room.sitting = fn(room.sitting, seat);
    this.onChange(room);
  }

  /** A seated player renames their own team. */
  setTeamName(room: Room, socketId: string, name: string): void {
    const seat = this.requireSeat(room, socketId);
    const clean = cleanup(name);
    if (!clean) throw new RuleError('Enter a team name');
    const other = room.teamNames[1 - (seat % 2)];
    if (clean.toLowerCase() === other.toLowerCase()) throw new RuleError('The other team already has that name');
    room.teamNames[seat % 2] = clean;
    this.onChange(room);
  }

  /** Lobby only: best of 7 (target 4) or no limit (null). */
  setSeries(room: Room, socketId: string, target: number | null): void {
    this.requireSeat(room, socketId);
    if (room.sitting) throw new RuleError('The series length is set before the game starts');
    if (target !== null && target !== 4) throw new RuleError('Choose best of 7 or no limit');
    room.seriesTarget = target;
    this.onChange(room);
  }

  newSeries(room: Room, socketId: string) { this.act(room, socketId, (s) => newSeries(s)); }

  start(room: Room, socketId: string): void {
    this.requireSeat(room, socketId);
    if (room.sitting) throw new RuleError('Already started');
    if (room.seats.some((s) => !s || !s.socketId)) throw new RuleError('Need four connected players');
    room.sitting = startHand(newSitting(this.rng, undefined, room.seriesTarget), this.rng); // toss happens here
    this.onChange(room);
  }

  nextHand(room: Room, socketId: string) {
    this.act(room, socketId, (s) => {
      if (s.hand && s.hand.phase !== 'done') throw new RuleError('The current match is not finished');
      return startHand(s, this.rng);
    });
  }
  nameTrump(room: Room, socketId: string, suit: Suit) { this.act(room, socketId, (s, seat) => nameTrump(s, seat, suit)); }
  goBlind(room: Room, socketId: string) { this.act(room, socketId, (s, seat) => goBlind(s, seat)); }
  pickBlind(room: Room, socketId: string, index: number) { this.act(room, socketId, (s, seat) => pickBlind(s, seat, index)); }
  play(room: Room, socketId: string, card: Card) {
    if (!card || typeof card.r !== 'number' || typeof card.s !== 'string') throw new RuleError('Bad card');
    this.act(room, socketId, (s, seat) => playCard(s, seat, { r: card.r, s: card.s }));
  }

  /** Exactly what one connection is allowed to see. */
  stateFor(room: Room, socketId: string): RoomState {
    const token = room.members.get(socketId);
    const you = token ? this.seatOf(room, token) : null;
    const s = room.sitting;
    return {
      code: room.code,
      teamNames: room.teamNames,
      seats: room.seats.map((r) => r && {
        name: r.name, connected: !!r.socketId, holdUntil: r.holdUntil, open: r.open,
      }),
      started: !!s,
      paused: this.paused(room),
      nextChooser: s ? s.nextChooser : 0,
      handsWon: s ? s.handsWon : [0, 0],
      seriesTarget: s ? s.target : room.seriesTarget,
      seriesNo: s ? s.seriesNo : 1,
      seriesWon: s ? s.seriesWon : [0, 0],
      seriesWinner: s ? s.seriesWinner : null,
      results: s ? s.results : [],
      you,
      view: s && s.hand ? viewFor(s.hand, you) : null,
    };
  }

  /** Drop rooms nobody has been in for a while. */
  sweep(maxIdleMs: number): void {
    const now = this.now();
    for (const [code, room] of this.rooms) {
      if (room.emptySince !== null && now - room.emptySince > maxIdleMs) {
        for (const t of room.timers.values()) clearTimeout(t);
        this.rooms.delete(code);
      }
    }
  }
}

function cleanup(name: string): string {
  return String(name || '').replace(/\s+/g, ' ').trim().slice(0, 20);
}
