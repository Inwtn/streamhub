import test from 'node:test';
import assert from 'node:assert/strict';
import { io as clientIo, type Socket } from 'socket.io-client';
import { makeApp } from '../src/app.ts';

const once = <T>(socket: Socket, event: string, timeout = 2500) => new Promise<T>((resolve, reject) => {
  const timer = setTimeout(() => { socket.off(event, handler); reject(new Error(`Timeout: ${event}`)); }, timeout);
  const handler = (data: T) => { clearTimeout(timer); resolve(data); };
  socket.once(event, handler);
});

test('HTTP creation, authorized joins, signaling, capacity and close', async () => {
  const service = makeApp({ origin: 'http://localhost:5173', maxViewers: 3, idleMs: 60_000 });
  await new Promise<void>(resolve => service.httpServer.listen(0, '127.0.0.1', resolve));
  const address = service.httpServer.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const sockets: Socket[] = [];
  const post = async (path: string, data: unknown) => {
    const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    return { response, body: await response.json() };
  };
  try {
    const created = await post('/api/rooms', { name: 'Test room', hostName: 'Host' });
    assert.equal(created.response.status, 201);
    const { room, invite, ownerToken } = created.body;
    assert.equal((await post(`/api/rooms/${room.id}/join`, { name: 'Intruso', role: 'host', credential: invite })).response.status, 403);
    assert.equal((await post('/api/rooms/aaaaaaaaaaaaaaaaaaaaaaaa/join', { name: 'A', role: 'viewer', credential: invite })).response.status, 404);
    const host = (await post(`/api/rooms/${room.id}/join`, { name: 'Host', role: 'host', credential: ownerToken })).body;
    const v1 = (await post(`/api/rooms/${room.id}/join`, { name: 'A', role: 'viewer', credential: invite })).body;
    const v2 = (await post(`/api/rooms/${room.id}/join`, { name: 'B', role: 'viewer', credential: invite })).body;
    const connect = async (ticket: string) => {
      const socket = clientIo(base, { auth: { ticket }, transports: ['websocket'], reconnection: false });
      sockets.push(socket);
      await once(socket, 'connect');
      return socket;
    };
    const hostSocket = await connect(host.ticket);
    assert.equal((await post(`/api/rooms/${room.id}/join`, { name: 'Other host', role: 'host', credential: ownerToken })).response.status, 409);
    const v1Socket = await connect(v1.ticket);
    const v2Socket = await connect(v2.ticket);
    const signalPromise = once<{ from: string; description: { type: string; sdp: string } }>(v1Socket, 'signal');
    hostSocket.emit('signal', { to: v1.participantId, description: { type: 'offer', sdp: 'test-offer' } });
    const signal = await signalPromise;
    assert.equal(signal.from, host.participantId);
    assert.equal(signal.description.type, 'offer');
    let unauthorized = false;
    v1Socket.on('signal', () => { unauthorized = true; });
    v2Socket.emit('signal', { to: v1.participantId, description: { type: 'offer', sdp: 'bad' } });
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(unauthorized, false);
    const livePromise = once<{ live: boolean }>(v1Socket, 'room-state');
    hostSocket.emit('stream-state', true);
    assert.equal((await livePromise).live, true);
    const ready = once<{ viewerId: string }>(hostSocket, 'viewer-ready');
    const late = (await post(`/api/rooms/${room.id}/join`, { name: 'C', role: 'viewer', credential: invite })).body;
    const lateSocket = await connect(late.ticket);
    assert.equal((await ready).viewerId, late.participantId);
    assert.equal((await post(`/api/rooms/${room.id}/join`, { name: 'D', role: 'viewer', credential: invite })).response.status, 409);
    const lateOffer = once<{ from: string }>(lateSocket, 'signal');
    hostSocket.emit('signal', { to: late.participantId, description: { type: 'offer', sdp: 'late-offer' } });
    assert.equal((await lateOffer).from, host.participantId);
    const closeResponse = await fetch(`${base}/api/rooms/${room.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${invite}` } });
    assert.equal(closeResponse.status, 403);
    const closed = once(v1Socket, 'room-closed');
    const authorizedClose = await fetch(`${base}/api/rooms/${room.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${ownerToken}` } });
    assert.equal(authorizedClose.status, 204);
    await closed;
    assert.equal(service.store.rooms.has(room.id), false);
  } finally { sockets.forEach(socket => socket.disconnect()); await service.close(); }
});
