import type { AudioMode } from './audio';

export function AudioModePicker({ mode, onChange }: { mode: AudioMode; onChange: (mode: AudioMode) => void }) {
  return <div className="audio-mode-picker">
    <label htmlFor="audio-mode">AUDIO TO SHARE</label>
    <select id="audio-mode" value={mode} onChange={event => onChange(event.target.value as AudioMode)}>
      <option value="window">Selected window or tab only (recommended)</option>
      <option value="none">No audio</option>
      <option value="system">Entire system audio (includes Discord)</option>
    </select>
    <p>{mode === 'window'
      ? 'In Chrome, choose the game window and select "share this window’s audio". If only "system audio" appears, leave it unchecked: it can repeat Discord voices.'
      : mode === 'system'
        ? 'This can send Discord voices back to people in your call.'
        : 'Your viewers will receive video without sound.'}</p>
  </div>;
}
