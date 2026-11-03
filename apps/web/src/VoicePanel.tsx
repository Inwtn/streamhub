import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { Headphones, HeadphoneOff, Mic, MicOff, PhoneOff, Volume2 } from 'lucide-react';
import type { RoomView } from '../../../packages/shared/src/index';

type VoiceSignal = { from: string; description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };
type Language = 'en' | 'pt';
type Props = { socket: Socket | null; room: RoomView; selfId: string; language: Language };

const words = {
  en: {
    title: 'Voice call', join: 'Join voice', joining: 'Opening microphone…', leave: 'Leave voice',
    mute: 'Mute microphone', unmute: 'Unmute microphone', silence: 'Mute others', unsilence: 'Hear others',
    alone: 'Join to talk with everyone in this room.', active: 'You are in the voice call.',
    enable: 'Enable voice audio', volume: 'Voice volume',
    unavailable: 'Microphone access requires localhost or HTTPS.', disconnected: 'Signaling is reconnecting.',
    failed: 'Voice connection failed. Leave and rejoin voice; these networks may need a TURN server.'
  },
  pt: {
    title: 'Chamada de voz', join: 'Entrar na voz', joining: 'Abrindo microfone…', leave: 'Sair da voz',
    mute: 'Silenciar microfone', unmute: 'Ativar microfone', silence: 'Silenciar outros', unsilence: 'Ouvir outros',
    alone: 'Entre para conversar com todos nesta sala.', active: 'Você está na chamada de voz.',
    enable: 'Ativar áudio da chamada', volume: 'Volume da voz',
    unavailable: 'O microfone exige localhost ou HTTPS.', disconnected: 'Reconectando sinalização.',
    failed: 'A conexão de voz falhou. Saia e entre novamente; essas redes podem precisar de um servidor TURN.'
  }
};

const iceServers = (): RTCIceServer[] => {
  const urls = (import.meta.env.VITE_STUN_URLS || 'stun:stun.l.google.com:19302').split(',').map((value: string) => value.trim()).filter(Boolean);
  const servers: RTCIceServer[] = urls.length ? [{ urls }] : [];
  if (import.meta.env.VITE_TURN_URL) servers.push({ urls: import.meta.env.VITE_TURN_URL, username: import.meta.env.VITE_TURN_USERNAME || '', credential: import.meta.env.VITE_TURN_CREDENTIAL || '' });
  return servers;
};

export function VoicePanel({ socket, room, selfId, language }: Props) {
  const t = words[language];
  const [active, setActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [muted, setMuted] = useState(false);
  const [speakersMuted, setSpeakersMuted] = useState(false);
  const [volume, setVolume] = useState(80);
  const [connected, setConnected] = useState(0);
  const [needsPlayback, setNeedsPlayback] = useState(false);
  const [error, setError] = useState('');
  const streamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef(new Map<string, RTCPeerConnection>());
  const pendingIceRef = useRef(new Map<string, RTCIceCandidateInit[]>());
  const audiosRef = useRef(new Map<string, HTMLAudioElement>());
  const blockedRef = useRef(new Set<string>());
  const roomRef = useRef(room);
  const volumeRef = useRef(volume);
  const speakersMutedRef = useRef(speakersMuted);
  const mountedRef = useRef(true);

  const closePeer = useCallback((id: string) => {
    const pc = peersRef.current.get(id);
    if (pc) { pc.ontrack = null; pc.onicecandidate = null; pc.onconnectionstatechange = null; pc.close(); peersRef.current.delete(id); }
    const audio = audiosRef.current.get(id);
    if (audio) { audio.pause(); audio.srcObject = null; audiosRef.current.delete(id); }
    pendingIceRef.current.delete(id);
    blockedRef.current.delete(id);
    if (mountedRef.current) {
      setConnected([...peersRef.current.values()].filter(peer => peer.connectionState === 'connected').length);
      setNeedsPlayback(blockedRef.current.size > 0);
    }
  }, []);

  const closeAllPeers = useCallback(() => { for (const id of [...peersRef.current.keys()]) closePeer(id); }, [closePeer]);

  const playAudio = useCallback((id: string, audio: HTMLAudioElement) => {
    void audio.play().then(() => {
      blockedRef.current.delete(id);
      if (mountedRef.current) setNeedsPlayback(blockedRef.current.size > 0);
    }).catch(() => {
      blockedRef.current.add(id);
      if (mountedRef.current) setNeedsPlayback(true);
    });
  }, []);

  const makePeer = useCallback((id: string) => {
    closePeer(id);
    const pc = new RTCPeerConnection({ iceServers: iceServers(), bundlePolicy: 'max-bundle' });
    peersRef.current.set(id, pc);
    pc.onicecandidate = event => { if (event.candidate) socket?.emit('voice-signal', { to: id, candidate: event.candidate.toJSON() }); };
    pc.onconnectionstatechange = () => {
      if (!mountedRef.current) return;
      setConnected([...peersRef.current.values()].filter(peer => peer.connectionState === 'connected').length);
      if (pc.connectionState === 'failed') setError(t.failed);
    };
    pc.ontrack = event => {
      let audio = audiosRef.current.get(id);
      if (!audio) { audio = new Audio(); audio.autoplay = true; audiosRef.current.set(id, audio); }
      audio.srcObject = event.streams[0] || new MediaStream([event.track]);
      audio.volume = volumeRef.current / 100;
      audio.muted = speakersMutedRef.current;
      playAudio(id, audio);
    };
    return pc;
  }, [closePeer, playAudio, socket, t.failed]);

  const offerToPeer = useCallback(async (id: string) => {
    const stream = streamRef.current;
    if (!stream || !socket?.connected || peersRef.current.has(id)) return;
    try {
      const pc = makePeer(id);
      pc.addTrack(stream.getAudioTracks()[0], stream);
      await pc.setLocalDescription(await pc.createOffer());
      if (pc.localDescription && peersRef.current.get(id) === pc) socket.emit('voice-signal', { to: id, description: { type: 'offer', sdp: pc.localDescription.sdp } });
    } catch (cause) { closePeer(id); setError(cause instanceof Error ? cause.message : t.failed); }
  }, [closePeer, makePeer, socket, t.failed]);

  const reconcile = useCallback((next: RoomView) => {
    roomRef.current = next;
    if (!streamRef.current || !socket?.connected || !next.participants.some(person => person.id === selfId && person.voice)) { closeAllPeers(); return; }
    const others = next.participants.filter(person => person.id !== selfId && person.voice);
    const activeIds = new Set(others.map(person => person.id));
    for (const id of [...peersRef.current.keys()]) if (!activeIds.has(id)) closePeer(id);
    for (const person of others) if (selfId < person.id && !peersRef.current.has(person.id)) void offerToPeer(person.id);
  }, [closeAllPeers, closePeer, offerToPeer, selfId, socket]);

  const handleSignal = useCallback(async (data: VoiceSignal) => {
    const stream = streamRef.current;
    if (!stream || !socket?.connected || !roomRef.current.participants.some(person => person.id === data.from && person.voice)) return;
    try {
      let pc = peersRef.current.get(data.from);
      if (data.description?.type === 'offer') {
        if (data.from >= selfId) return;
        const queued = pendingIceRef.current.get(data.from) || [];
        pc = makePeer(data.from);
        pc.addTrack(stream.getAudioTracks()[0], stream);
        await pc.setRemoteDescription(data.description);
        for (const candidate of queued) await pc.addIceCandidate(candidate).catch(() => {});
        pendingIceRef.current.delete(data.from);
        await pc.setLocalDescription(await pc.createAnswer());
        if (pc.localDescription && peersRef.current.get(data.from) === pc) socket.emit('voice-signal', { to: data.from, description: { type: 'answer', sdp: pc.localDescription.sdp } });
      } else if (data.description?.type === 'answer' && pc && selfId < data.from) {
        await pc.setRemoteDescription(data.description);
        for (const candidate of pendingIceRef.current.get(data.from) || []) await pc.addIceCandidate(candidate).catch(() => {});
        pendingIceRef.current.delete(data.from);
      }
      if (data.candidate) {
        if (pc?.remoteDescription) await pc.addIceCandidate(data.candidate);
        else pendingIceRef.current.set(data.from, [...(pendingIceRef.current.get(data.from) || []), data.candidate].slice(-64));
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : t.failed); }
  }, [makePeer, selfId, socket, t.failed]);

  useEffect(() => { reconcile(room); }, [room, reconcile]);

  useEffect(() => {
    if (!socket) return;
    const onConnect = () => { if (streamRef.current) socket.emit('voice-state', true); };
    const onDisconnect = () => closeAllPeers();
    const onLeft = ({ participantId }: { participantId: string }) => closePeer(participantId);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('participant-left', onLeft);
    socket.on('voice-signal', handleSignal);
    return () => { socket.off('connect', onConnect); socket.off('disconnect', onDisconnect); socket.off('participant-left', onLeft); socket.off('voice-signal', handleSignal); };
  }, [closeAllPeers, closePeer, handleSignal, socket]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      socket?.emit('voice-state', false);
      streamRef.current?.getTracks().forEach(track => { track.onended = null; track.stop(); });
      streamRef.current = null;
      closeAllPeers();
    };
  }, [closeAllPeers, socket]);

  const leaveVoice = () => {
    socket?.emit('voice-state', false);
    streamRef.current?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    streamRef.current = null;
    closeAllPeers();
    setActive(false);
    setMuted(false);
    setError('');
  };

  const joinVoice = async () => {
    if (starting || streamRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia) { setError(t.unavailable); return; }
    if (!socket?.connected) { setError(t.disconnected); return; }
    setStarting(true);
    setError('');
    const roomId = roomRef.current.id;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      if (!mountedRef.current || !socket.connected || roomRef.current.id !== roomId) { stream.getTracks().forEach(track => track.stop()); return; }
      streamRef.current = stream;
      stream.getAudioTracks()[0].onended = () => leaveVoice();
      setActive(true);
      setMuted(false);
      socket.emit('voice-state', true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t.unavailable); }
    finally { if (mountedRef.current) setStarting(false); }
  };

  const toggleMute = () => {
    const track = streamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = muted;
    setMuted(!muted);
  };

  const toggleSpeakers = () => {
    const next = !speakersMuted;
    speakersMutedRef.current = next;
    for (const audio of audiosRef.current.values()) audio.muted = next;
    setSpeakersMuted(next);
  };

  const updateVolume = (value: number) => {
    volumeRef.current = value;
    for (const audio of audiosRef.current.values()) audio.volume = value / 100;
    setVolume(value);
  };

  const retryPlayback = () => { for (const [id, audio] of audiosRef.current) playAudio(id, audio); };
  const voiceCount = room.participants.filter(person => person.voice).length;

  return <section className="panel voice-panel" aria-label={t.title}>
    <h3><Headphones size={18}/> {t.title} <span>{voiceCount}</span></h3>
    <p>{active ? t.active : t.alone}</p>
    {voiceCount > 0 && <div className="voice-members">{room.participants.filter(person => person.voice).map(person => <span key={person.id}><span className="voice-member-dot"/>{person.name}</span>)}</div>}
    {!active ? <button className="primary voice-join" onClick={() => void joinVoice()} disabled={starting || !socket?.connected}><Mic size={17}/>{starting ? t.joining : t.join}</button> : <>
      <div className="voice-controls">
        <button className="icon-button" onClick={toggleMute} title={muted ? t.unmute : t.mute} aria-label={muted ? t.unmute : t.mute}>{muted ? <MicOff size={18}/> : <Mic size={18}/>}</button>
        <button className="icon-button" onClick={toggleSpeakers} title={speakersMuted ? t.unsilence : t.silence} aria-label={speakersMuted ? t.unsilence : t.silence}>{speakersMuted ? <HeadphoneOff size={18}/> : <Headphones size={18}/>}</button>
        <button className="danger voice-leave" onClick={leaveVoice}><PhoneOff size={16}/>{t.leave}</button>
      </div>
      <label className="voice-volume"><Volume2 size={16}/><span>{t.volume}</span><input type="range" min="0" max="100" value={volume} onChange={event => updateVolume(Number(event.target.value))} aria-label={t.volume}/></label>
      {voiceCount > 1 && <small className="voice-connected">{connected}/{voiceCount - 1} WebRTC</small>}
      {needsPlayback && <button className="voice-retry" onClick={retryPlayback}>{t.enable}</button>}
    </>}
    {error && <p className="voice-error" role="alert">{error}</p>}
  </section>;
}
