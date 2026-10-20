import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RoomManager, Room, BotSettings } from './rooms';
import { Ack } from './protocol';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.resolve(here, '../dist');

export function startServer(port: number, opts: { reconnectMs?: number; bot?: BotSettings } = {}) {
const app = express();
const http = createServer(app);
const io = new Server(http, { cors: { origin: process.env.CORS_ORIGIN || false } });

function broadcast(room: Room) {
  for (const socketId of room.members.keys()) {
    io.to(socketId).emit('state', rooms.stateFor(room, socketId));
  }
}
const rooms = new RoomManager(broadcast, Math.random, Date.now, opts.reconnectMs, opts.bot);
setInterval(() => rooms.sweep(30 * 60 * 1000), 60 * 1000).unref();

app.get('/health', (_req, res) => { res.json({ ok: true, rooms: rooms.rooms.size }); });
app.use(express.static(clientDir));
app.get(/^\/(?!socket\.io).*/, (_req, res) => res.sendFile(path.join(clientDir, 'index.html')));

io.on('connection', (socket) => {
  // Each handler: run, ack ok, or ack the rule error. Never crash the server on bad input.
  const handle = (fn: (...args: any[]) => string | void) => (...args: any[]) => {
    const ack: Ack = typeof args[args.length - 1] === 'function' ? args.pop() : () => {};
    try {
      const code = fn(...args);
      ack(code ? { ok: true, code } : { ok: true });
    } catch (e: any) {
      ack({ ok: false, error: e?.message || 'Something went wrong' });
    }
  };
  let current: Room | null = null;
  const room = () => {
    if (!current) throw new Error('Join a room first');
    return current;
  };

  socket.on('create', handle((p: { token: string; name: string }) => {
    const r = rooms.create();
    if (current && current !== r) rooms.disconnect(socket.id);
    current = r;
    rooms.join(r, socket.id, String(p?.token || socket.id), p?.name);
    return r.code;
  }));
  socket.on('join', handle((p: { code: string; token: string; name: string }) => {
    const r = rooms.get(p?.code);
    if (current && current !== r) rooms.disconnect(socket.id);
    current = r;
    rooms.join(r, socket.id, String(p?.token || socket.id), p?.name);
    return r.code;
  }));
  socket.on('sit', handle((p: { seat: number; name: string }) => rooms.sit(room(), socket.id, Number(p?.seat), p?.name)));
  socket.on('standUp', handle(() => rooms.standUp(room(), socket.id)));
  socket.on('setTeamName', handle((p: { name: string }) => rooms.setTeamName(room(), socket.id, p?.name)));
  socket.on('setSeries', handle((p: { target: number | null }) => rooms.setSeries(room(), socket.id, p?.target ?? null)));
  socket.on('newSeries', handle(() => rooms.newSeries(room(), socket.id)));
  socket.on('addBot', handle((p: { seat: number }) => rooms.addBot(room(), socket.id, Number(p?.seat))));
  socket.on('removeBot', handle((p: { seat: number }) => rooms.removeBot(room(), socket.id, Number(p?.seat))));
  socket.on('start', handle(() => rooms.start(room(), socket.id)));
  socket.on('nextHand', handle(() => rooms.nextHand(room(), socket.id)));
  socket.on('nameTrump', handle((p: { suit: any }) => rooms.nameTrump(room(), socket.id, p?.suit)));
  socket.on('goBlind', handle(() => rooms.goBlind(room(), socket.id)));
  socket.on('pickBlind', handle((p: { index: number }) => rooms.pickBlind(room(), socket.id, Number(p?.index))));
  socket.on('play', handle((p: { card: any }) => rooms.play(room(), socket.id, p?.card)));
  socket.on('disconnect', () => rooms.disconnect(socket.id));
});

return new Promise<{ port: number; rooms: RoomManager; close: () => Promise<void> }>((resolve) => {
  http.listen(port, () => {
    const addr = http.address();
    resolve({
      port: typeof addr === 'object' && addr ? addr.port : port,
      rooms,
      close: () => new Promise<void>((r) => { io.close(); http.close(() => r()); }),
    });
  });
});
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const PORT = Number(process.env.PORT) || 3001;
  startServer(PORT).then(({ port }) => console.log(`Mindi Coat listening on :${port}`));
}
