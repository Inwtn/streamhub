import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { MonitorUp, Users, Copy, Volume2, VolumeX, Maximize, Settings2, Radio, Square, LogOut, Plus, Link2, ShieldCheck, Activity, Mic2, MicOff, Wifi, WifiOff } from 'lucide-react';
import { QUALITIES, type Participant, type RoomView } from '../../../packages/shared/src/index';

type ApiJoin = { ticket: string; participantId: string; room: RoomView };
type Stats = { state: string; rtt?: number; jitter?: number; loss?: number; fps?: number; width?: number; height?: number; bitrate?: number; quality: string };
const api = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(`/api${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  if (!res.ok) { const payload = await res.json().catch(() => ({})); throw new Error(payload.error || `Error ${res.status}`); }
  return res.status === 204 ? undefined as T : res.json();
};
const roomIdFromPath = () => /^\/room\/([A-Za-z0-9_-]{24})$/.exec(location.pathname)?.[1] || '';
const inviteFromHash = () => new URLSearchParams(location.hash.slice(1)).get('invite') || '';
const iceServers = (): RTCIceServer[] => {
  const urls = (import.meta.env.VITE_STUN_URLS || 'stun:stun.l.google.com:19302').split(',').map((v: string) => v.trim()).filter(Boolean);
  const servers: RTCIceServer[] = urls.length ? [{ urls }] : [];
  if (import.meta.env.VITE_TURN_URL) servers.push({ urls: import.meta.env.VITE_TURN_URL, username: import.meta.env.VITE_TURN_USERNAME || '', credential: import.meta.env.VITE_TURN_CREDENTIAL || '' });
  return servers;
};
const friendlyCaptureError = (err: unknown) => {
  const name = err instanceof DOMException ? err.name : '';
  if (name === 'NotAllowedError') return 'Screen sharing was canceled or blocked by the browser.';
  if (name === 'NotFoundError') return 'No screen or window is available to share.';
  if (name === 'NotReadableError') return 'This screen is busy or protected. Try another source.';
  return err instanceof Error ? err.message : 'Could not start screen capture.';
};

export function App() {
  const [pathRoom, setPathRoom] = useState(roomIdFromPath());
  const [name, setName] = useState(localStorage.getItem('streamhub-name') || '');
  const [roomName, setRoomName] = useState('My stream');
  const [linkInput, setLinkInput] = useState('');
  const [hostCode, setHostCode] = useState('');
  const [room, setRoom] = useState<RoomView | null>(null);
  const [role, setRole] = useState<'host' | 'viewer' | null>(null);
  const [status, setStatus] = useState('Ready to start');
  const [error, setError] = useState('');
  const [qualityIndex, setQualityIndex] = useState(1);
  const [showSettings, setShowSettings] = useState(false);
  const [audioAvailable, setAudioAvailable] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [volume, setVolume] = useState(80);
  const [stats, setStats] = useState<Stats>({ state: 'Waiting', quality: '—' });
  const [sessionRooms, setSessionRooms] = useState<{ id: string; name: string; invite: string }[]>(() => JSON.parse(sessionStorage.getItem('streamhub-rooms') || '[]'));
  const socketRef = useRef<Socket | null>(null);
  const peersRef = useRef(new Map<string, RTCPeerConnection>());
  const pendingIceRef = useRef(new Map<string, RTCIceCandidateInit[]>());
  const localStreamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const roomRef = useRef<RoomView | null>(null);
  const roleRef = useRef<'host' | 'viewer' | null>(null);
  const selfIdRef = useRef('');
  const ticketRef = useRef('');
  const qualityRef = useRef(qualityIndex);
  const statsHistoryRef = useRef<{ bytes: number; at: number } | null>(null);

  useEffect(() => { const fn = () => { setPathRoom(roomIdFromPath()); setRoom(null); }; addEventListener('popstate', fn); return () => removeEventListener('popstate', fn); }, []);
  useEffect(() => { if (videoRef.current) videoRef.current.volume = volume / 100; }, [volume, room, role]);
  useEffect(() => { roomRef.current = room; }, [room]);
  useEffect(() => { qualityRef.current = qualityIndex; }, [qualityIndex]);

  const closePeer = useCallback((id: string) => { const pc = peersRef.current.get(id); if (pc) { pc.ontrack = null; pc.onicecandidate = null; pc.onconnectionstatechange = null; pc.close(); peersRef.current.delete(id); } pendingIceRef.current.delete(id); }, []);
  const closeAllPeers = useCallback(() => { for (const id of [...peersRef.current.keys()]) closePeer(id); if (videoRef.current && roleRef.current === 'viewer') videoRef.current.srcObject = null; }, [closePeer]);
  const stopStream = useCallback(() => {
    const stream = localStreamRef.current;
    if (stream) { for (const track of stream.getTracks()) { track.onended = null; track.stop(); } localStreamRef.current = null; }
    closeAllPeers();
    if (videoRef.current) videoRef.current.srcObject = null;
    setAudioAvailable(false);
    socketRef.current?.emit('stream-state', false);
    setStatus('Stream stopped');
  }, [closeAllPeers]);

  const makePeer = useCallback((otherId: string) => {
    closePeer(otherId);
    const pc = new RTCPeerConnection({ iceServers: iceServers(), bundlePolicy: 'max-bundle' });
    peersRef.current.set(otherId, pc);
    pc.onicecandidate = event => { if (event.candidate) socketRef.current?.emit('signal', { to: otherId, candidate: event.candidate.toJSON() }); };
    pc.onconnectionstatechange = () => {
      setStatus(pc.connectionState === 'connected' ? 'Connected via WebRTC' : pc.connectionState === 'failed' ? 'Peer connection failed. Configure TURN if needed.' : `WebRTC: ${pc.connectionState}`);
      if (pc.connectionState === 'failed' && roleRef.current === 'host' && localStreamRef.current) void offerToViewer(otherId);
    };
    if (roleRef.current === 'viewer') pc.ontrack = event => { if (videoRef.current) { videoRef.current.srcObject = event.streams[0] || new MediaStream([event.track]); void videoRef.current.play().catch(() => setStatus('Click the video to play with sound.')); } };
    return pc;
  // offerToViewer is defined below and accessed only after the callback has been initialized.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closePeer]);

  const offerToViewer = useCallback(async (viewerId: string) => {
    const stream = localStreamRef.current;
    if (!stream || !socketRef.current?.connected) return;
    const pc = makePeer(viewerId);
    for (const track of stream.getTracks()) pc.addTrack(track, stream);
    const videoTransceiver = pc.getTransceivers().find(t => t.sender.track?.kind === 'video');
    const codecs = RTCRtpSender.getCapabilities?.('video')?.codecs;
    if (videoTransceiver && codecs?.length) {
      const rank = (codec: { mimeType: string }) => /\/VP8$/i.test(codec.mimeType) ? 0 : /\/H264$/i.test(codec.mimeType) ? 1 : 2;
      try { videoTransceiver.setCodecPreferences([...codecs].sort((a, b) => rank(a) - rank(b))); } catch { /* Browser defaults remain usable. */ }
    }
    const sender = pc.getSenders().find(s => s.track?.kind === 'video');
    if (sender) { const params = sender.getParameters(); params.encodings = [{ maxBitrate: QUALITIES[qualityRef.current].bitrate, maxFramerate: QUALITIES[qualityRef.current].frameRate }]; await sender.setParameters(params).catch(() => {}); }
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socketRef.current.emit('signal', { to: viewerId, description: { type: 'offer', sdp: offer.sdp } });
  }, [makePeer]);

  const handleSignal = useCallback(async (data: { from: string; description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }) => {
    try {
      let pc = peersRef.current.get(data.from);
      if (data.description?.type === 'offer') {
        if (roleRef.current !== 'viewer') return;
        const queued = pendingIceRef.current.get(data.from) || [];
        pc = makePeer(data.from);
        await pc.setRemoteDescription(data.description);
        for (const ice of queued) await pc.addIceCandidate(ice).catch(() => {});
        pendingIceRef.current.delete(data.from);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socketRef.current?.emit('signal', { to: data.from, description: { type: 'answer', sdp: answer.sdp } });
      } else if (data.description?.type === 'answer' && pc && roleRef.current === 'host') {
        await pc.setRemoteDescription(data.description);
        for (const ice of pendingIceRef.current.get(data.from) || []) await pc.addIceCandidate(ice).catch(() => {});
        pendingIceRef.current.delete(data.from);
      }
      if (data.candidate) {
        if (pc?.remoteDescription) await pc.addIceCandidate(data.candidate);
        else pendingIceRef.current.set(data.from, [...(pendingIceRef.current.get(data.from) || []), data.candidate]);
      }
    } catch (err) { setError(`WebRTC signaling: ${friendlyCaptureError(err)}`); }
  }, [makePeer]);

  const connectSocket = useCallback((joined: ApiJoin, asRole: 'host' | 'viewer') => {
    socketRef.current?.disconnect();
    closeAllPeers();
    ticketRef.current = joined.ticket;
    selfIdRef.current = joined.participantId;
    roleRef.current = asRole;
    setRole(asRole);
    setRoom(joined.room);
    roomRef.current = joined.room;
    const socket = io({ auth: { ticket: joined.ticket }, reconnectionAttempts: Infinity, reconnectionDelayMax: 5000 });
    socketRef.current = socket;
    socket.on('connect', () => { setStatus('Signaling connected'); if (asRole === 'host' && localStreamRef.current) socket.emit('stream-state', true); });
    socket.on('disconnect', () => { setStatus('Reconnecting signaling…'); closeAllPeers(); });
    socket.on('connect_error', err => { setStatus('Signaling unavailable'); setError(err.message); });
    socket.on('room-state', (next: RoomView) => { setRoom(next); roomRef.current = next; if (!next.live && roleRef.current === 'viewer') closeAllPeers(); });
    socket.on('viewer-ready', ({ viewerId }: { viewerId: string }) => { if (roleRef.current === 'host' && localStreamRef.current) void offerToViewer(viewerId); });
    socket.on('signal', (data: { from: string; description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }) => void handleSignal(data));
    socket.on('participant-left', ({ participantId }: { participantId: string }) => closePeer(participantId));
    socket.on('room-closed', () => { stopStream(); socket.disconnect(); setRoom(null); setRole(null); setPathRoom(''); history.replaceState(null, '', '/'); setError('The host closed this room.'); });
  }, [closeAllPeers, closePeer, handleSignal, offerToViewer, stopStream]);

  const join = useCallback(async (id: string, credential: string, asRole: 'host' | 'viewer') => {
    setError('');
    const cleanName = name.trim();
    if (!cleanName) { setError('Enter your name before joining.'); return; }
    localStorage.setItem('streamhub-name', cleanName);
    try {
      const joined = await api<ApiJoin>(`/rooms/${id}/join`, { method: 'POST', body: JSON.stringify({ name: cleanName, credential, role: asRole }) });
      if (asRole === 'host') sessionStorage.setItem(`streamhub-owner-${id}`, credential);
      connectSocket(joined, asRole);
    } catch (err) { setError(friendlyCaptureError(err)); }
  }, [name, connectSocket]);

  const createRoom = async () => {
    if (!name.trim() || !roomName.trim()) { setError('Enter your name and a room name.'); return; }
    setError('');
    try {
      const created = await api<{ room: RoomView; invite: string; ownerToken: string }>('/rooms', { method: 'POST', body: JSON.stringify({ name: roomName.trim(), hostName: name.trim() }) });
      sessionStorage.setItem(`streamhub-owner-${created.room.id}`, created.ownerToken);
      const updated = [{ id: created.room.id, name: created.room.name, invite: created.invite }, ...sessionRooms].slice(0, 10);
      sessionStorage.setItem('streamhub-rooms', JSON.stringify(updated));
      setSessionRooms(updated);
      history.pushState(null, '', `/room/${created.room.id}#invite=${created.invite}`);
      setPathRoom(created.room.id);
      await join(created.room.id, created.ownerToken, 'host');
    } catch (err) { setError(friendlyCaptureError(err)); }
  };

  const enterLink = () => {
    try {
      const url = new URL(linkInput.trim());
      const id = /^\/room\/([A-Za-z0-9_-]{24})$/.exec(url.pathname)?.[1];
      const invite = new URLSearchParams(url.hash.slice(1)).get('invite');
      if (!id || !invite) throw new Error('Paste the full invite link.');
      history.pushState(null, '', `/room/${id}#invite=${invite}`);
      setPathRoom(id); setError('');
    } catch { setError('Paste a valid StreamHub invite link.'); }
  };

  const startStream = async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) { setError('Screen capture requires a recent Chrome or Edge on localhost or HTTPS.'); return; }
    try {
      const preset = QUALITIES[qualityIndex];
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { width: { ideal: preset.width }, height: { ideal: preset.height }, frameRate: { ideal: preset.frameRate } }, audio: true });
      localStreamRef.current = stream;
      setAudioAvailable(stream.getAudioTracks().length > 0);
      setAudioEnabled(true);
      stream.getVideoTracks()[0].onended = () => stopStream();
      if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.muted = true; void videoRef.current.play(); }
      socketRef.current?.emit('stream-state', true);
      setStatus('Sharing screen'); setError('');
      for (const participant of roomRef.current?.participants || []) if (participant.role === 'viewer') void offerToViewer(participant.id);
    } catch (err) { setError(friendlyCaptureError(err)); }
  };

  const leave = () => { stopStream(); socketRef.current?.disconnect(); socketRef.current = null; setRoom(null); setRole(null); roleRef.current = null; history.pushState(null, '', '/'); setPathRoom(''); setError(''); };
  const closeRoom = async () => {
    if (!room) return;
    const ownerToken = sessionStorage.getItem(`streamhub-owner-${room.id}`);
    try { await api(`/rooms/${room.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${ownerToken}` } }); leave(); }
    catch (err) { setError(friendlyCaptureError(err)); }
  };
  const copyInvite = async () => {
    const invite = inviteFromHash() || sessionRooms.find(r => r.id === room?.id)?.invite;
    if (!invite || !room) { setError('Invite unavailable.'); return; }
    await navigator.clipboard.writeText(`${location.origin}/room/${room.id}#invite=${invite}`);
    setStatus('Invite copied');
  };
  const toggleAudio = () => { const track = localStreamRef.current?.getAudioTracks()[0]; if (track) { track.enabled = !track.enabled; setAudioEnabled(track.enabled); } };

  useEffect(() => {
    if (!room) return;
    const timer = setInterval(async () => {
      const pc = [...peersRef.current.values()].find(p => p.connectionState === 'connected') || [...peersRef.current.values()][0];
      if (!pc) { setStats({ state: room.live ? 'Waiting for connection' : 'No stream', quality: '—' }); return; }
      try {
        const report = await pc.getStats(); let rtt: number | undefined, jitter: number | undefined, loss: number | undefined, fps: number | undefined, width: number | undefined, height: number | undefined, bitrate: number | undefined;
        let bytes: number | undefined;
        report.forEach(s => {
          if (s.type === 'candidate-pair' && s.state === 'succeeded' && typeof s.currentRoundTripTime === 'number') rtt = s.currentRoundTripTime * 1000;
          if ((s.type === 'inbound-rtp' || s.type === 'outbound-rtp') && s.kind === 'video') {
            fps = s.framesPerSecond ?? fps; width = s.frameWidth ?? width; height = s.frameHeight ?? height;
            bytes = s.bytesReceived ?? s.bytesSent ?? bytes;
            if (s.type === 'inbound-rtp') { jitter = s.jitter !== undefined ? s.jitter * 1000 : jitter; const total = (s.packetsReceived || 0) + (s.packetsLost || 0); if (total > 0) loss = Math.max(0, s.packetsLost || 0) / total * 100; }
          }
          if (s.type === 'remote-inbound-rtp' && s.kind === 'video') { if (s.roundTripTime !== undefined) rtt = s.roundTripTime * 1000; if (s.fractionLost !== undefined) loss = s.fractionLost * 100; }
        });
        const now = Date.now(), prev = statsHistoryRef.current;
        if (bytes !== undefined) { if (prev && bytes >= prev.bytes) bitrate = (bytes - prev.bytes) * 8 / ((now - prev.at) / 1000) / 1_000_000; statsHistoryRef.current = { bytes, at: now }; }
        const quality = pc.connectionState !== 'connected' ? 'Connecting' : (loss || 0) > 8 || (rtt || 0) > 300 ? 'Unstable' : (loss || 0) > 3 || (rtt || 0) > 150 ? 'Fair' : 'Good';
        setStats({ state: pc.connectionState, rtt, jitter, loss, fps, width, height, bitrate, quality });
        if (roleRef.current === 'host' && loss !== undefined) {
          for (const sender of pc.getSenders()) if (sender.track?.kind === 'video') {
            const params = sender.getParameters(), base = QUALITIES[qualityRef.current].bitrate;
            const next = loss > 8 ? Math.max(600_000, Math.floor((params.encodings?.[0]?.maxBitrate || base) * .75)) : loss < 2 ? Math.min(base, Math.floor((params.encodings?.[0]?.maxBitrate || base) * 1.1)) : undefined;
            if (next !== undefined) { params.encodings = [{ ...(params.encodings?.[0] || {}), maxBitrate: next, maxFramerate: loss > 8 ? 30 : QUALITIES[qualityRef.current].frameRate }]; void sender.setParameters(params).catch(() => {}); }
          }
        }
      } catch { setStats({ state: 'Error', quality: '—' }); }
    }, 2000);
    return () => clearInterval(timer);
  }, [room?.id, room?.live]);
  useEffect(() => () => { localStreamRef.current?.getTracks().forEach(t => t.stop()); socketRef.current?.disconnect(); peersRef.current.forEach(pc => pc.close()); }, []);

  const viewerCount = room?.participants.filter(p => p.role === 'viewer').length || 0;
  const ownerToken = pathRoom ? sessionStorage.getItem(`streamhub-owner-${pathRoom}`) : null;
  const effectiveHostToken = ownerToken || hostCode.trim();
  const invite = inviteFromHash();
  return <div className="app-shell">
    <aside className="rail"><div className="brand-mark">S<span>H</span></div><div className="rail-rule"/><button title="Home" onClick={leave}><Radio size={21}/></button><div className="rail-spacer"/><div className="avatar">{name.slice(0, 1).toUpperCase() || 'U'}</div></aside>
    <aside className="sidebar"><div className="sidebar-heading"><span>STREAMHUB</span><span className="online-dot"/></div><div className="sidebar-section">STREAMING SPACE</div><div className="sidebar-item active"><Radio size={18}/> Live <span className="live-small">LIVE</span></div><div className="sidebar-section">YOUR ROOMS</div>{sessionRooms.map(r => <button className="sidebar-item room-link" key={r.id} onClick={() => { history.pushState(null, '', `/room/${r.id}#invite=${r.invite}`); setPathRoom(r.id); setRoom(null); }}><span className="room-hash">#</span>{r.name}</button>)}<div className="sidebar-bottom"><ShieldCheck size={16}/> Private invite-only rooms</div></aside>
    <main className="main-content"><header className="topbar"><div className="breadcrumb"><Radio size={18}/><span>{room?.name || 'Your streaming space'}</span></div><div className="topbar-right"><span className="status-dot"/>{status}</div></header>
    {error && <div className="error-banner" role="alert">{error}<button onClick={() => setError('')}>×</button></div>}
    {!pathRoom ? <div className="home"><div className="eyebrow"><span className="pulse-dot"/> REAL-TIME P2P STREAMING</div><h1>Share what is<br/><em>happening on your screen.</em></h1><p className="home-lede">Create a private room, invite friends, and stream right from your browser. No downloads required.</p><div className="home-grid"><section className="card"><div className="card-icon"><Plus size={23}/></div><h2>Create a room</h2><p>You will be the host. Up to five friends can watch.</p><label>YOUR NAME<input placeholder="What should we call you?" maxLength={30} value={name} onChange={e => setName(e.target.value)}/></label><label>ROOM NAME<input placeholder="e.g. Game night" maxLength={50} value={roomName} onChange={e => setRoomName(e.target.value)}/></label><button className="primary" onClick={createRoom}><MonitorUp size={18}/> Create room</button></section><section className="card"><div className="card-icon secondary"><Link2 size={23}/></div><h2>Join a room</h2><p>Got an invite? Paste its link to watch.</p><label>YOUR NAME<input placeholder="What should we call you?" maxLength={30} value={name} onChange={e => setName(e.target.value)}/></label><label>INVITE LINK<input placeholder="https://…/room/…#invite=…" value={linkInput} onChange={e => setLinkInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && enterLink()}/></label><button className="secondary-button" onClick={enterLink}><Users size={18}/> Join as viewer</button></section></div><div className="feature-row"><span><Wifi size={17}/> Direct WebRTC</span><span><ShieldCheck size={17}/> Private invites</span><span><Activity size={17}/> Live diagnostics</span></div></div> : !room ? <div className="join-screen"><div className="join-icon"><Users size={31}/></div><h1>Join room</h1><p>{ownerToken ? 'You created this room.' : 'Use the invite to watch the stream.'}</p><label>YOUR NAME<input autoFocus placeholder="Your name" maxLength={30} value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && void join(pathRoom, effectiveHostToken || invite, effectiveHostToken ? 'host' : 'viewer')}/></label>{!ownerToken && <label>HOST CODE (OPTIONAL)<input type="password" placeholder="Only if you created the room with the bot" value={hostCode} onChange={e => setHostCode(e.target.value)}/></label>}<button className="primary" disabled={!effectiveHostToken && !invite} onClick={() => void join(pathRoom, effectiveHostToken || invite, effectiveHostToken ? 'host' : 'viewer')}>{effectiveHostToken ? 'Join as host' : 'Watch stream'}</button>{!effectiveHostToken && !invite && <div className="hint">This URL does not contain a valid invite key.</div>}</div> : <div className="room-layout"><div className="room-main"><div className="room-title-row"><div><div className="eyebrow">PRIVATE ROOM {room.live && <span className="live-pill">● LIVE</span>}</div><h1>{room.name}</h1><p>By {room.hostName} <span className="sep">·</span> {viewerCount} of {room.maxViewers} viewers</p></div><button className="settings-button" onClick={() => setShowSettings(!showSettings)}><Settings2 size={18}/> Settings</button></div><div className="video-stage"><video ref={videoRef} autoPlay playsInline muted={role === 'host'} onClick={() => void videoRef.current?.play()} />{role === 'host' && localStreamRef.current && <span className="preview-tag">YOUR SCREEN</span>}{!(role === 'host' ? !!localStreamRef.current : room.live) && <div className="video-placeholder"><div className="placeholder-icon"><MonitorUp size={42}/></div><h2>{role === 'host' ? 'Your stream starts here' : 'Waiting for the host'}</h2><p>{role === 'host' ? 'Choose a screen, window, or tab to share.' : 'Video will appear automatically when the stream starts.'}</p></div>}</div><div className="control-bar"><div className="control-left"><span className={room.live ? 'live-indicator' : 'offline-indicator'}>{room.live ? '● LIVE' : '○ OFFLINE'}</span><span className="viewer-chip"><Users size={16}/> {viewerCount}</span></div><div className="control-actions">{role === 'host' ? <>{!localStreamRef.current ? <button className="primary compact" onClick={startStream}><MonitorUp size={18}/> Share screen</button> : <><button className="danger" onClick={stopStream}><Square size={16}/> Stop stream</button><button className="icon-button" onClick={toggleAudio} title={audioAvailable ? audioEnabled ? 'Mute audio' : 'Unmute audio' : 'Audio unavailable'} disabled={!audioAvailable}>{audioEnabled ? <Mic2 size={19}/> : <MicOff size={19}/>}</button></>}</> : <div className="volume-control"><button className="icon-button" onClick={() => setVolume(volume ? 0 : 80)}>{volume ? <Volume2 size={20}/> : <VolumeX size={20}/>}</button><input aria-label="Volume" type="range" min="0" max="100" value={volume} onChange={e => setVolume(Number(e.target.value))}/></div>}<button className="icon-button" title="Fullscreen" onClick={() => void videoRef.current?.requestFullscreen()}><Maximize size={19}/></button></div></div>{role === 'host' && localStreamRef.current && !audioAvailable && <div className="info-note">The browser did not provide audio for this source. On Windows, Chrome or Edge usually works best when sharing a tab with audio.</div>}{showSettings && <section className="settings-panel"><h3>Settings and diagnostics</h3>{role === 'host' && <label>CAPTURE QUALITY<select value={qualityIndex} onChange={e => setQualityIndex(Number(e.target.value))} disabled={!!localStreamRef.current}>{QUALITIES.map((q, i) => <option value={i} key={q.label}>{q.label}</option>)}</select><small>Capture targets; actual resolution and FPS depend on your browser and connection.</small></label>}<div className="stats-grid"><div><span>Connection</span><strong>{stats.quality}</strong></div><div><span>State</span><strong>{stats.state}</strong></div><div><span>RTT</span><strong>{stats.rtt?.toFixed(0) ?? '—'} ms</strong></div><div><span>Packet loss</span><strong>{stats.loss?.toFixed(1) ?? '—'}%</strong></div><div><span>Jitter</span><strong>{stats.jitter?.toFixed(0) ?? '—'} ms</strong></div><div><span>FPS</span><strong>{stats.fps?.toFixed(0) ?? '—'}</strong></div><div><span>Resolution</span><strong>{stats.width && stats.height ? `${stats.width}×${stats.height}` : '—'}</strong></div><div><span>Bitrate</span><strong>{stats.bitrate?.toFixed(1) ?? '—'} Mbps</strong></div></div><p className="stats-note">RTT is network round-trip time, not capture-to-display latency. This panel shows one connection at a time.</p></section>}</div><aside className="room-sidebar"><div className="panel"><h3><Users size={17}/> Participants <span>{room.participants.length}</span></h3>{room.participants.map((person: Participant) => <div className="participant" key={person.id}><div className={`participant-avatar ${person.role}`}>{person.name.slice(0,1).toUpperCase()}</div><div><strong>{person.name}</strong><small>{person.role === 'host' ? 'Host' : 'Viewer'}</small></div>{person.role === 'host' && <Radio size={16} className="participant-live"/>}</div>)}</div><div className="panel invite-panel"><div className="invite-icon"><Link2 size={20}/></div><h3>Invite your friends</h3><p>Share this private room link. The invite allows watching, not broadcasting.</p><button className="secondary-button" onClick={() => void copyInvite()}><Copy size={16}/> Copy invite</button></div><div className="panel room-actions"><button onClick={leave}><LogOut size={17}/> Leave room</button>{role === 'host' && <button className="close-room" onClick={() => void closeRoom()}><Square size={16}/> Close room</button>}</div></aside></div>}
    </main></div>;
}
