// Shared message shapes between server and client.
import type { PlayerView, ResultRow, Seat } from '../engine/engine';

export interface SeatInfo {
  name: string;
  connected: boolean;
  /** ms epoch when the reconnect window closes; null if connected */
  holdUntil: number | null;
  /** window expired: a new player may take this seat */
  open: boolean;
}

export interface RoomState {
  code: string;
  teamNames: [string, string];
  /** people connected without a seat */
  watchers: string[];
  seats: (SeatInfo | null)[];
  started: boolean;
  paused: boolean;
  nextChooser: Seat;
  handsWon: [number, number];
  seriesTarget: number | null;
  seriesNo: number;
  seriesWon: [number, number];
  seriesWinner: 0 | 1 | null;
  results: ResultRow[];
  you: Seat | null;
  view: PlayerView | null;
}

export type Ack = (res: { ok: true; code?: string } | { ok: false; error: string }) => void;

export const RECONNECT_MS = 2 * 60 * 1000;
