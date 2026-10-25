export type Role = 'host' | 'viewer';
export type Participant = { id: string; name: string; role: Role };
export type RoomView = { id: string; name: string; hostName: string; participants: Participant[]; live: boolean; maxViewers: number };
export type Signal = { to: string; description?: { type: 'offer' | 'answer'; sdp: string }; candidate?: RTCIceCandidateInit };
export type Quality = { label: string; width: number; height: number; frameRate: number; bitrate: number };
export const QUALITIES: Quality[] = [
  { label: '720p · 30 FPS', width: 1280, height: 720, frameRate: 30, bitrate: 3500000 },
  { label: '720p · 60 FPS', width: 1280, height: 720, frameRate: 60, bitrate: 5000000 },
  { label: '1080p · 30 FPS', width: 1920, height: 1080, frameRate: 30, bitrate: 6000000 },
  { label: '1080p · 60 FPS', width: 1920, height: 1080, frameRate: 60, bitrate: 9000000 }
];
