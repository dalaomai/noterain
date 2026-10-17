import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const source = buildSync({
  entryPoints: [
    fileURLToPath(new URL('../src/lib/midi/timing.ts', import.meta.url)),
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
const { buildMidiTempoMap, midiTicksToSeconds } = bundled.exports;
const tempo = (deltaTime, microsecondsPerBeat) => ({
  type: 'setTempo',
  deltaTime,
  microsecondsPerBeat,
});
const file = (...tracks) => ({ header: { ticksPerBeat: 480 }, tracks });

test('multiple tempo changes accumulate elapsed time instead of reusing the first tempo', () => {
  const map = buildMidiTempoMap(
    file([tempo(0, 500000), tempo(960, 1000000), tempo(960, 250000)]),
    480,
  );
  assert.deepEqual(
    map.map(({ tick, time, bpm }) => ({ tick, time, bpm })),
    [
      { tick: 0, time: 0, bpm: 120 },
      { tick: 960, time: 1, bpm: 60 },
      { tick: 1920, time: 3, bpm: 240 },
    ],
  );
  for (const [tick, expected] of [
    [480, 0.5],
    [960, 1],
    [1440, 2],
    [1920, 3],
    [2400, 3.25],
  ]) {
    assert.equal(midiTicksToSeconds(tick, map), expected);
  }
  // A held note crossing both tempo changes must keep its complete duration.
  assert.equal(
    midiTicksToSeconds(2160, map) - midiTicksToSeconds(480, map),
    2.625,
  );
});

test('tempo events from different tracks are sorted by absolute tick', () => {
  const map = buildMidiTempoMap(
    file([tempo(960, 1000000)], [tempo(0, 500000)]),
    480,
  );
  assert.equal(midiTicksToSeconds(960, map), 1);
  assert.equal(midiTicksToSeconds(1920, map), 3);
});

test('absent and late first tempos use 120 BPM until an actual change', () => {
  const empty = buildMidiTempoMap(file([]), 480);
  assert.equal(midiTicksToSeconds(960, empty), 1);
  const late = buildMidiTempoMap(file([tempo(480, 1000000)]), 480);
  assert.equal(midiTicksToSeconds(240, late), 0.25);
  assert.equal(midiTicksToSeconds(480, late), 0.5);
  assert.equal(midiTicksToSeconds(960, late), 1.5);
});

test('same-tick tempo updates consume no elapsed time and steady-tempo files stay unchanged', () => {
  const duplicate = buildMidiTempoMap(
    file([tempo(0, 500000), tempo(0, 250000), tempo(480, 1000000)]),
    480,
  );
  assert.equal(duplicate.length, 2);
  assert.equal(midiTicksToSeconds(480, duplicate), 0.25);
  assert.equal(midiTicksToSeconds(960, duplicate), 1.25);
  const steady = buildMidiTempoMap(file([tempo(0, 1000000)]), 480);
  assert.equal(midiTicksToSeconds(2400, steady), 5);
});
