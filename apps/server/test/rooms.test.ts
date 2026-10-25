import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomStore } from '../src/rooms.ts';

test('room credentials separate host and viewer permissions; capacity and expiry', () => {
  const store = new RoomStore(2, 1000);
  const room = store.create('Jogo', 'Isaac');
  assert.match(room.id, /^[A-Za-z0-9_-]{24}$/);
  assert.notEqual(room.invite, room.ownerToken);
  assert.equal(store.authorize(room.id, room.invite, 'host', 'intruso'), null);
  assert.equal(store.authorize(room.id, room.ownerToken, 'viewer', 'intruso'), null);
  const host = store.authorize(room.id, room.ownerToken, 'host', 'Isaac');
  assert.ok(host && typeof host !== 'string');
  const viewer1 = store.authorize(room.id, room.invite, 'viewer', 'A');
  const viewer2 = store.authorize(room.id, room.invite, 'viewer', 'B');
  assert.ok(viewer1 && typeof viewer1 !== 'string');
  assert.ok(viewer2 && typeof viewer2 !== 'string');
  assert.equal(store.authorize(room.id, room.invite, 'viewer', 'C'), 'full');
  assert.equal(store.resolveTicket(viewer1.token)?.participant.id, viewer1.participantId);
  store.leave(viewer1.participantId, room.id);
  assert.equal(store.resolveTicket(viewer1.token), null);
  assert.ok(store.authorize(room.id, room.invite, 'viewer', 'C'));
  store.sweep(Date.now() + 1100);
  assert.equal(store.rooms.has(room.id), false);
});
