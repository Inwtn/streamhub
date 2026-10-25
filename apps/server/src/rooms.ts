import { randomBytes, timingSafeEqual } from 'node:crypto';

export type Role = 'host' | 'viewer';
export type Participant = { id: string; name: string; role: Role; socketId?: string };
export type Room = { id: string; name: string; invite: string; ownerToken: string; hostName: string; participants: Map<string, Participant>; live: boolean; createdAt: number; lastActive: number };
export type Ticket = { token: string; roomId: string; participantId: string; role: Role; expiresAt: number };
const token = (bytes = 24) => randomBytes(bytes).toString('base64url');
const equal = (a: string, b: string) => {
  const aa = Buffer.from(a), bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
};
export class RoomStore {
  rooms = new Map<string, Room>();
  tickets = new Map<string, Ticket>();
  constructor(readonly maxViewers = 5, readonly idleMs = 60 * 60_000) {}
  create(name: string, hostName: string) {
    const room: Room = { id: token(18), name, invite: token(), ownerToken: token(), hostName, participants: new Map(), live: false, createdAt: Date.now(), lastActive: Date.now() };
    this.rooms.set(room.id, room);
    return room;
  }
  authorize(roomId: string, credential: string, role: Role, name: string) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (role === 'host' ? !equal(credential, room.ownerToken) : !equal(credential, room.invite)) return null;
    if (role === 'host') {
      const oldHost = [...room.participants.values()].find(p => p.role === 'host');
      if (oldHost?.socketId) return 'host-busy' as const;
      if (oldHost) this.leave(oldHost.id, roomId);
    }
    const viewers = [...room.participants.values()].filter(p => p.role === 'viewer');
    if (role === 'viewer' && viewers.length >= this.maxViewers) return 'full' as const;
    const participantId = token(12);
    const ticket: Ticket = { token: token(), roomId, participantId, role, expiresAt: Date.now() + 24 * 60 * 60_000 };
    this.tickets.set(ticket.token, ticket);
    room.participants.set(participantId, { id: participantId, name, role });
    room.lastActive = Date.now();
    return ticket;
  }
  resolveTicket(value: unknown) {
    if (typeof value !== 'string') return null;
    const ticket = this.tickets.get(value);
    if (!ticket || ticket.expiresAt < Date.now() || !this.rooms.has(ticket.roomId)) return null;
    const participant = this.rooms.get(ticket.roomId)!.participants.get(ticket.participantId);
    return participant ? { ticket, participant, room: this.rooms.get(ticket.roomId)! } : null;
  }
  leave(participantId: string, roomId: string) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    room.participants.delete(participantId);
    for (const [key, ticket] of this.tickets) if (ticket.participantId === participantId) this.tickets.delete(key);
    if (![...room.participants.values()].some(p => p.role === 'host')) room.live = false;
    room.lastActive = Date.now();
  }
  close(roomId: string) {
    this.rooms.delete(roomId);
    for (const [key, ticket] of this.tickets) if (ticket.roomId === roomId) this.tickets.delete(key);
  }
  sweep(now = Date.now()) {
    for (const [id, room] of this.rooms) if (!room.live && now - room.lastActive > this.idleMs) this.close(id);
    for (const [key, ticket] of this.tickets) if (ticket.expiresAt < now) this.tickets.delete(key);
  }
  view(room: Room) {
    return { id: room.id, name: room.name, hostName: room.hostName, live: room.live, maxViewers: this.maxViewers,
      participants: [...room.participants.values()].filter(p => p.socketId).map(({ id, name, role }) => ({ id, name, role })) };
  }
}
