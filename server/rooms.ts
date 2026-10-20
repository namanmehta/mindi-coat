// Room and seat management. Owns the authoritative game state for each table.
import {
  Seat, Sitting, Suit, Card, RuleError, newSitting, newSeries, startHand, nameTrump, goBlind, pickBlind, playCard, viewFor,
} from '../engine/engine';
import { botAct, botViewFor } from '../engine/bot';
import { RoomState, RECONNECT_MS } from './protocol';

interface SeatRec {
  name: string;
  token: string;
  socketId: string | null;
  holdUntil: number | null;
  open: boolean;
  /** a bot plays this seat */
  bot?: boolean;
}

export interface BotSettings {
  /** pause before a bot moves, so it feels like a person (ms) */
  delayMs: number;
  /** extra pause after a hand is won, so the sweep finishes first (ms) */
  afterHandMs: number;
  /** thinking time per move (ms) */
  budgetMs: number;
}
const BOT_NAMES = ['Bot Raja', 'Bot Rani', 'Bot Mantri', 'Bot Sipahi'];

export interface Room {
  code: string;
  seats: (SeatRec | null)[];
  sitting: Sitting | null;
  /** socketId -> token, for everyone in the room including spectators */
  members: Map<string, string>;
  timers: Map<number, ReturnType<typeof setTimeout>>;
  emptySince: number | null;
  teamNames: [string, string];
  /** socketId -> display name, for showing who is watching */
  memberNames: Map<string, string>;
  /** matches needed to win a series: 4 = best of 7, null = no limit */
  seriesTarget: number | null;
  botTimer: ReturnType<typeof setTimeout> | null;
}

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I, L, O, 0, 1

export class RoomManager {
  rooms = new Map<string, Room>();
  constructor(
    private onChange: (room: Room) => void,
    private rng: () => number = Math.random,
    private now: () => number = Date.now,
    private reconnectMs = RECONNECT_MS,
    private botSettings: BotSettings = { delayMs: 900, afterHandMs: 1900, budgetMs: 250 },
  ) {}

  /** Every state change goes through here: tell everyone, then let a bot move if it's a bot's turn. */
  private changed(room: Room) {
    this.onChange(room);
    this.scheduleBot(room);
  }

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
      memberNames: new Map(),
      seriesTarget: 4,
      botTimer: null,
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
    room.memberNames.set(socketId, cleanup(name) || 'Someone');
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
    this.changed(room);
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
      if (!target || !(target.open || target.bot)) throw new RuleError('That seat is taken');
    } else {
      if (target && target.token !== token && !target.bot) throw new RuleError('That seat is taken');
      if (current !== null) room.seats[current] = null; // switching seats in the lobby
    }
    this.clearTimer(room, seat);
    room.seats[seat] = { name: cleanName, token, socketId, holdUntil: null, open: false };
    this.changed(room);
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
    this.changed(room);
  }

  /** A seated player fills an empty seat (lobby) or an abandoned one (mid-game) with a bot. */
  addBot(room: Room, socketId: string, seat: number): void {
    this.requireSeat(room, socketId);
    if (![0, 1, 2, 3].includes(seat)) throw new RuleError('Invalid seat');
    const target = room.seats[seat];
    if (room.sitting ? !target?.open : !!target) throw new RuleError('That seat is taken');
    const used = new Set(room.seats.map((r) => r?.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) ?? `Bot ${seat + 1}`;
    this.clearTimer(room, seat);
    room.seats[seat] = { name, token: `bot:${room.code}:${seat}:${Math.floor(this.rng() * 1e9)}`, socketId: null, holdUntil: null, open: false, bot: true };
    this.changed(room);
  }

  /** Lobby only: take a bot out of its seat. */
  removeBot(room: Room, socketId: string, seat: number): void {
    this.requireSeat(room, socketId);
    if (room.sitting) throw new RuleError('Bots can be removed before the game starts. A player can take a bot\'s seat any time.');
    if (!room.seats[seat]?.bot) throw new RuleError('No bot in that seat');
    room.seats[seat] = null;
    this.changed(room);
  }

  /** If it is a bot's decision, make it after a short, human-feeling pause. */
  private scheduleBot(room: Room): void {
    if (room.botTimer || !this.rooms.has(room.code)) return;
    const who = this.botToAct(room);
    if (who === null) return;
    const h = room.sitting!.hand!;
    const justWon = h.phase === 'playing' && h.trick.length === 0 && h.history.length > 0;
    const delay = this.botSettings.delayMs + (justWon ? this.botSettings.afterHandMs : 0);
    room.botTimer = setTimeout(() => {
      room.botTimer = null;
      if (this.botToAct(room) !== who) { this.scheduleBot(room); return; }
      try {
        const s = room.sitting!;
        const a = botAct(botViewFor(s.hand!, who), this.rng, { budgetMs: this.botSettings.budgetMs });
        room.sitting = a.type === 'name' ? nameTrump(s, who, a.suit)
          : a.type === 'blind' ? goBlind(s, who)
            : a.type === 'pick' ? pickBlind(s, who, a.index)
              : playCard(s, who, a.card);
      } catch (e) {
        console.error('bot move failed', e);
        return;
      }
      this.changed(room);
    }, delay);
  }

  private botToAct(room: Room): Seat | null {
    const h = room.sitting?.hand;
    if (!h || h.phase === 'done' || this.paused(room)) return null;
    const seat = (h.phase === 'playing' ? h.turn : h.chooser) as Seat;
    return room.seats[seat]?.bot ? seat : null;
  }

  disconnect(socketId: string): void {
    for (const room of this.rooms.values()) {
      if (!room.members.has(socketId)) continue;
      room.members.delete(socketId);
      room.memberNames.delete(socketId);
      const i = room.seats.findIndex((s) => s && s.socketId === socketId);
      if (i >= 0) {
        const rec = room.seats[i]!;
        rec.socketId = null;
        rec.holdUntil = this.now() + this.reconnectMs;
        this.clearTimer(room, i);
        room.timers.set(i, setTimeout(() => this.expire(room, i), this.reconnectMs));
      }
      if (room.members.size === 0) room.emptySince = this.now();
      this.changed(room);
    }
  }

  /** Reconnect window closed. */
  expire(room: Room, seat: number): void {
    room.timers.delete(seat);
    const rec = room.seats[seat];
    if (!rec || rec.socketId) return;
    if (room.sitting) { rec.open = true; rec.holdUntil = null; }
    else room.seats[seat] = null;
    this.changed(room);
  }

  private clearTimer(room: Room, seat: number) {
    const t = room.timers.get(seat);
    if (t) { clearTimeout(t); room.timers.delete(seat); }
  }

  paused(room: Room): boolean {
    return !!room.sitting && room.seats.some((s) => !s || (!s.bot && !s.socketId));
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
    this.changed(room);
  }

  /** A seated player renames their own team. */
  setTeamName(room: Room, socketId: string, name: string): void {
    const seat = this.requireSeat(room, socketId);
    const clean = cleanup(name);
    if (!clean) throw new RuleError('Enter a team name');
    const other = room.teamNames[1 - (seat % 2)];
    if (clean.toLowerCase() === other.toLowerCase()) throw new RuleError('The other team already has that name');
    room.teamNames[seat % 2] = clean;
    this.changed(room);
  }

  /** Lobby only: best of 7 (target 4) or no limit (null). */
  setSeries(room: Room, socketId: string, target: number | null): void {
    this.requireSeat(room, socketId);
    if (room.sitting) throw new RuleError('The series length is set before the game starts');
    if (target !== null && target !== 4) throw new RuleError('Choose best of 7 or no limit');
    room.seriesTarget = target;
    this.changed(room);
  }

  newSeries(room: Room, socketId: string) { this.act(room, socketId, (s) => newSeries(s)); }

  start(room: Room, socketId: string): void {
    this.requireSeat(room, socketId);
    if (room.sitting) throw new RuleError('Already started');
    if (room.seats.some((s) => !s || (!s.bot && !s.socketId))) throw new RuleError('Need four connected players');
    room.sitting = startHand(newSitting(this.rng, undefined, room.seriesTarget), this.rng); // toss happens here
    this.changed(room);
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
      watchers: this.watchers(room),
      seats: room.seats.map((r) => r && {
        name: r.name, connected: !!r.bot || !!r.socketId, holdUntil: r.holdUntil, open: r.open, bot: !!r.bot,
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

  /** Names of everyone connected to the room without a seat (one entry per person). */
  watchers(room: Room): string[] {
    const seen = new Set<string>();
    const names: string[] = [];
    for (const [socketId, token] of room.members) {
      if (this.seatOf(room, token) !== null || seen.has(token)) continue;
      seen.add(token);
      names.push(room.memberNames.get(socketId) || 'Someone');
    }
    return names;
  }

  /** Drop rooms nobody has been in for a while. */
  sweep(maxIdleMs: number): void {
    const now = this.now();
    for (const [code, room] of this.rooms) {
      if (room.emptySince !== null && now - room.emptySince > maxIdleMs) {
        for (const t of room.timers.values()) clearTimeout(t);
        if (room.botTimer) clearTimeout(room.botTimer);
        this.rooms.delete(code);
      }
    }
  }
}

function cleanup(name: string): string {
  return String(name || '').replace(/\s+/g, ' ').trim().slice(0, 20);
}
