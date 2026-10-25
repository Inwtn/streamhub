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
      ? 'Choose the game window and enable its audio in the browser picker. Full-screen system audio is blocked to avoid sharing Discord voices.'
      : mode === 'system'
        ? 'This can send Discord voices back to people in your call.'
        : 'Your viewers will receive video without sound.'}</p>
  </div>;
}
