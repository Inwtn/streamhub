import type { Quality } from '../../../packages/shared/src/index';

export type AudioMode = 'window' | 'system' | 'none';

type CaptureOptions = DisplayMediaStreamOptions & {
  systemAudio: 'include' | 'exclude';
  windowAudio: 'window' | 'system' | 'exclude';
};

export function captureOptions(quality: Quality, mode: AudioMode): CaptureOptions {
  return {
    video: {
      width: { ideal: quality.width },
      height: { ideal: quality.height },
      frameRate: { ideal: quality.frameRate },
      ...(mode === 'window' ? { displaySurface: 'window' } : {})
    },
    audio: mode !== 'none',
    systemAudio: mode === 'system' ? 'include' : 'exclude',
    windowAudio: mode === 'window' ? 'window' : mode === 'system' ? 'system' : 'exclude'
  };
}

// A browser may ignore capture preferences. Never forward monitor audio in
// window-only mode because it can contain voice chat from other applications.
export function removeUnwantedAudio(stream: MediaStream, mode: AudioMode): boolean {
  const surface = stream.getVideoTracks()[0]?.getSettings().displaySurface;
  const keepAudio = mode === 'system' || (mode === 'window' && (surface === 'window' || surface === 'browser'));
  if (keepAudio) return false;
  let removed = false;
  for (const track of stream.getAudioTracks()) {
    stream.removeTrack(track);
    track.stop();
    removed = true;
  }
  return removed;
}
