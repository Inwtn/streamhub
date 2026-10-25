import assert from 'node:assert/strict';
import test from 'node:test';
import { captureOptions, removeUnwantedAudio } from '../src/audio.js';

const quality = { label: 'test', width: 1280, height: 720, frameRate: 30, bitrate: 3_500_000 };

test('window mode requests window audio and excludes system audio', () => {
  const options = captureOptions(quality, 'window');
  assert.equal(options.audio, true);
  assert.equal(options.systemAudio, 'exclude');
  assert.equal(options.windowAudio, 'window');
});

test('window mode drops monitor audio even if the browser returns it', () => {
  let stopped = false;
  let removed = false;
  const audio = { stop: () => { stopped = true; } };
  const stream = {
    getVideoTracks: () => [{ getSettings: () => ({ displaySurface: 'monitor' }) }],
    getAudioTracks: () => [audio],
    removeTrack: (track: unknown) => { removed = track === audio; }
  } as unknown as MediaStream;
  assert.equal(removeUnwantedAudio(stream, 'window'), true);
  assert.equal(stopped, true);
  assert.equal(removed, true);
});

test('window mode keeps window audio', () => {
  const stream = {
    getVideoTracks: () => [{ getSettings: () => ({ displaySurface: 'window' }) }],
    getAudioTracks: () => [{ stop: () => { throw new Error('unexpected stop'); } }]
  } as unknown as MediaStream;
  assert.equal(removeUnwantedAudio(stream, 'window'), false);
});
