import express, { type Express } from 'express';
import cors from 'cors';
import { createServer, type Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { RoomStore, type Room } from './rooms.js';

const nameValue = (value: unknown, max = 50) => typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= max ? value.trim() : null;
const idValue = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_-]{24}$/.test(value);
type Config = { origin: string; maxViewers: number; idleMs: number };
export function makeApp(config: Config): { app: Express; httpServer: HttpServer; io: Server; store: RoomStore; endRoom: (id: string) => void; close: () => Promise<void> } {
  const store = new RoomStore(config.maxViewers, config.idleMs);
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));
  const allowed = new Set([config.origin]);
  if (/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(config.origin)) for (const hostname of ['localhost', '127.0.0.1']) for (const port of [3001, 5173]) allowed.add(`http://${hostname}:${port}`);
  const corsOrigin = (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => callback(null, !origin || allowed.has(origin));
  app.use(cors({ origin: corsOrigin }));
  const hits = new Map<string, { count: number; reset: number }>();
  app.use('/api', (req, res, next) => {
    const key = req.ip || 'unknown', now = Date.now(), hit = hits.get(key);
    const entry = !hit || hit.reset < now ? { count: 1, reset: now + 60_000 } : { count: hit.count + 1, reset: hit.reset };
    hits.set(key, entry);
    if (entry.count > 90) { res.status(429).json({ error: 'Too many requests. Try again in a minute.' }); return; }
    next();
  });
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.post('/api/rooms', (req, res) => {
    const name = nameValue(req.body?.name), hostName = nameValue(req.body?.hostName, 30);
    if (!name || !hostName) { res.status(400).json({ error: 'Room and user names are required (50 and 30 characters maximum).' }); return; }
    const room = store.create(name, hostName);
    res.status(201).json({ room: store.view(room), invite: room.invite, ownerToken: room.ownerToken });
  });
  app.post('/api/rooms/:id/join', (req, res) => {
    const id = req.params.id;
    if (!idValue(id)) { res.status(404).json({ error: 'Room not found.' }); return; }
    if (!store.rooms.has(id)) { res.status(404).json({ error: 'Room not found.' }); return; }
    const name = nameValue(req.body?.name, 30);
    const credential = req.body?.credential, role = req.body?.role;
    if (!name || typeof credential !== 'string' || credential.length > 100 || !['host', 'viewer'].includes(role)) { res.status(400).json({ error: 'Invalid join data.' }); return; }
    const result = store.authorize(id, credential, role, name);
    if (result === 'full') { res.status(409).json({ error: 'Room is full.' }); return; }
    if (result === 'host-busy') { res.status(409).json({ error: 'A host is already connected.' }); return; }
    if (!result) { res.status(403).json({ error: 'Invalid invite or permission.' }); return; }
    res.json({ ticket: result.token, participantId: result.participantId, room: store.view(store.rooms.get(id)!) });
  });
  app.delete('/api/rooms/:id', (req, res) => {
    const room = store.rooms.get(req.params.id);
    const supplied = req.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
    if (!room || supplied !== room.ownerToken) { res.status(403).json({ error: 'Permission denied.' }); return; }
    endRoom(room.id);
    res.status(204).end();
  });
  const httpServer = createServer(app);
  const io = new Server(httpServer, { cors: { origin: corsOrigin, methods: ['GET', 'POST'] }, maxHttpBufferSize: 256_000 });
  const broadcast = (room: Room) => io.to(room.id).emit('room-state', store.view(room));
  const endRoom = (id: string) => { io.to(id).emit('room-closed'); io.in(id).disconnectSockets(true); store.close(id); };
  io.use((socket, next) => {
    const auth = store.resolveTicket(socket.handshake.auth?.ticket);
    if (!auth) return next(new Error('Invalid session. Join the room again.'));
    socket.data.roomId = auth.room.id;
    socket.data.participantId = auth.participant.id;
    socket.data.role = auth.participant.role;
    next();
  });
  io.on('connection', socket => {
    let signalWindow = Date.now(), signalCount = 0;
    const room = store.rooms.get(socket.data.roomId as string);
    const participant = room?.participants.get(socket.data.participantId as string);
    if (!room || !participant) return socket.disconnect(true);
    if (participant.socketId) io.sockets.sockets.get(participant.socketId)?.disconnect(true);
    participant.socketId = socket.id;
    room.lastActive = Date.now();
    socket.join(room.id);
    broadcast(room);
    if (participant.role === 'viewer') {
      const host = [...room.participants.values()].find(p => p.role === 'host' && p.socketId);
      if (host) io.to(host.socketId!).emit('viewer-ready', { viewerId: participant.id });
    } else {
      for (const viewer of room.participants.values()) if (viewer.role === 'viewer' && viewer.socketId) socket.emit('viewer-ready', { viewerId: viewer.id });
    }
    socket.on('stream-state', (live: unknown) => {
      if (participant.role !== 'host' || typeof live !== 'boolean') return;
      room.live = live;
      room.lastActive = Date.now();
      broadcast(room);
    });
    socket.on('signal', (data: unknown) => {
      if (Date.now() - signalWindow > 10_000) { signalWindow = Date.now(); signalCount = 0; }
      if (++signalCount > 120) return;
      if (!data || typeof data !== 'object') return;
      const d = data as Record<string, unknown>;
      if (typeof d.to !== 'string' || !d.to || d.to === participant.id) return;
      const target = room.participants.get(d.to);
      if (!target?.socketId || target.role === participant.role) return;
      const description = d.description as Record<string, unknown> | undefined;
      const candidate = d.candidate as Record<string, unknown> | undefined;
      const validDescription = description && ((participant.role === 'host' && description.type === 'offer') || (participant.role === 'viewer' && description.type === 'answer')) && typeof description.sdp === 'string' && description.sdp.length < 200_000;
      const validCandidate = candidate && typeof candidate.candidate === 'string' && candidate.candidate.length < 10_000;
      if (!validDescription && !validCandidate) return;
      io.to(target.socketId).emit('signal', { from: participant.id, ...(validDescription ? { description } : {}), ...(validCandidate ? { candidate } : {}) });
      room.lastActive = Date.now();
    });
    socket.on('disconnect', () => {
      if (participant.socketId !== socket.id) return;
      participant.socketId = undefined;
      if (participant.role === 'host') room.live = false;
      socket.to(room.id).emit('participant-left', { participantId: participant.id });
      broadcast(room);
      // Keep the ticket briefly so Socket.IO can reconnect without another HTTP round trip.
      setTimeout(() => {
        if (!participant.socketId && room.participants.has(participant.id)) { store.leave(participant.id, room.id); broadcast(room); }
      }, 30_000).unref();
    });
  });
  const sweep = setInterval(() => { store.sweep(); for (const [key, value] of hits) if (value.reset < Date.now()) hits.delete(key); }, 60_000);
  sweep.unref();
  return { app, httpServer, io, store, endRoom, close: async () => { clearInterval(sweep); await new Promise<void>(resolve => io.close(() => resolve())); if (httpServer.listening) await new Promise<void>(resolve => httpServer.close(() => resolve())); } };
}
