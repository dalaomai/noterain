import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const source = buildSync({
  entryPoints: [
    fileURLToPath(new URL('../src/lib/playbackAudio.ts', import.meta.url)),
  ],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
}).outputFiles[0].text;
const bundled = { exports: {} };
new Function('module', 'exports', 'require', source)(
  bundled,
  bundled.exports,
  createRequire(import.meta.url),
);
const { getPlaybackNoteIndex, schedulePlaybackAudio } = bundled.exports;
const note = (startTime, noteNumber = 60) => ({
  startTime, noteNumber, duration: 0.04, velocity: 64, track: 0, channel: 0,
});

test('a long rest keeps distinct audio onsets while drawing frames are delayed', () => {
  const notes = [note(0), ...[30, 30.06, 30.12, 30.18, 30.24].map(t => note(t))];
  const heard = [];
  let cursor = 0;
  // Audio timer continues at 25ms even with no intervening drawing frame.
  for (const scoreTime of [0, 10, 20, 29.85, 29.875, 29.9, 29.925, 29.95, 30, 30.05, 30.1, 30.15]) {
    cursor = schedulePlaybackAudio(notes, cursor, scoreTime, 100 + scoreTime, 1, 40,
      (n, duration, time) => { heard.push({ n, duration, time }); return true; });
  }
  assert.equal(cursor, notes.length);
  assert.equal(heard.length, notes.length);
  assert.equal(heard[0].time, 100);
  for (let i = 1; i < heard.length; i++) {
    assert.ok(Math.abs(heard[i].time - (100 + notes[i].startTime)) < 1e-8);
  }
  assert.ok(Math.abs(heard[2].time - heard[1].time - 0.06) < 1e-8);
});

test('the first onset includes every chord tone at the exact playback position once', () => {
  const notes = [note(0, 60), note(0, 64), note(0, 67), note(1, 72)];
  const pitches = [];
  const play = n => { pitches.push(n.noteNumber); return true; };
  let cursor = schedulePlaybackAudio(notes, 0, 0, 5, 1, 2, play);
  cursor = schedulePlaybackAudio(notes, cursor, 0.025, 5.025, 1, 2, play);
  assert.deepEqual(pitches, [60, 64, 67]);
  assert.equal(cursor, 3);
});

test('lookahead and note duration follow playback speed in real audio seconds', () => {
  for (const speed of [0.5, 1, 2]) {
    const notes = [note(20 + speed * 0.08), note(20 + speed * 0.25)];
    const played = [];
    const cursor = schedulePlaybackAudio(notes, 0, 20, 80, speed, 40,
      (n, duration, time) => { played.push({ duration, time }); return true; });
    assert.equal(cursor, 1);
    assert.ok(Math.abs(played[0].time - 80.08) < 1e-8);
    assert.equal(played[0].duration, 0.04 / speed);
  }
});

test('loop and song end boundaries do not leak an upcoming onset', () => {
  const notes = [note(9.98), note(10), note(10.02)];
  const played = [];
  const cursor = schedulePlaybackAudio(notes, 0, 9.95, 50, 1, 10,
    n => { played.push(n.startTime); return true; });
  assert.deepEqual(played, [9.98]);
  assert.equal(cursor, 1);
});

test('an audio engine still becoming ready does not consume and lose the first notes', () => {
  const notes = [note(5), note(5.06)];
  let cursor = schedulePlaybackAudio(notes, 0, 4.9, 20, 1, 10, () => false);
  assert.equal(cursor, 0);
  const heard = [];
  cursor = schedulePlaybackAudio(notes, cursor, 4.95, 20.05, 1, 10,
    (n, duration, time) => { heard.push(time); return true; });
  assert.equal(cursor, 2);
  assert.ok(Math.abs(heard[1] - heard[0] - 0.06) < 1e-8);
});

test('intentionally muted tracks consume onsets without replaying them when unmuted', () => {
  const notes = [note(1), note(1.5)];
  const cursor = schedulePlaybackAudio(notes, 0, 0.9, 10, 1, 3, () => true);
  const played = [];
  schedulePlaybackAudio(notes, cursor, 1.4, 10.5, 1, 3,
    n => { played.push(n.startTime); return true; });
  assert.deepEqual(played, [1.5]);
});

test('start, seek and loop resets include their boundary chord without replaying earlier notes', () => {
  const notes = [note(0), note(10), note(10, 64), note(10.1), note(20)];
  assert.equal(getPlaybackNoteIndex(notes, 0), 0);
  assert.equal(getPlaybackNoteIndex(notes, 10), 1);
  assert.equal(getPlaybackNoteIndex(notes, 10.01), 3);
  assert.equal(getPlaybackNoteIndex(notes, 30), 5);
  assert.equal(getPlaybackNoteIndex([], 0), 0);
});
