import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const source = buildSync({
  entryPoints: [fileURLToPath(new URL('../src/features/score-link-import/core/svgPerformance.ts', import.meta.url))],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
}).outputFiles[0].text;
const bundled = { exports: {} };
new Function('module', 'exports', 'require', source)(bundled, bundled.exports, createRequire(import.meta.url));
const { buildSvgPerformanceScore, getSvgPlaybackPosition } = bundled.exports;

test('maps MIDI onset groups to source SVG columns and interpolates playback', () => {
  const lines = [10, 15, 20, 25, 30, 50, 55, 60, 65, 70].map((y) => `M5 ${y}H105`).join('');
  const page = `<svg width="110" height="80"><path class="StaffLines" d="${lines}"/><path class="BarLine" d="M5 10v60M105 10v60"/><path class="Note" d="M20 20c1 0 2 1 3 2M80 25c1 0 2 1 3 2"/></svg>`;
  const file = {
    timeSignature: { numerator: 4, denominator: 4 },
    tempos: [{ time: 0, bpm: 120 }],
    tracks: [{ notes: [
      { noteNumber: 60, startTime: 0, duration: 0.5, velocity: 80, track: 0, channel: 0 },
      { noteNumber: 64, startTime: 1, duration: 0.5, velocity: 80, track: 0, channel: 0 },
    ] }],
  };
  const score = buildSvgPerformanceScore(file, [page]);

  assert.equal(score.systems.length, 1);
  assert.deepEqual(score.systems[0].staves, [
    { top: 10, bottom: 30 },
    { top: 50, bottom: 70 },
  ]);
  assert.deepEqual(score.systems[0].measures, [{
    startTime: 0,
    endTime: 2,
    left: 5,
    right: 105,
    top: 10,
    bottom: 70,
  }]);
  assert.equal(score.systems[0].anchors.length, 2);
  assert.deepEqual(score.systems[0].anchors.map((anchor) => anchor.time), [0, 1]);
  const midway = getSvgPlaybackPosition(score, 0.5);
  assert.ok(midway.x > score.systems[0].anchors[0].x);
  assert.ok(midway.x < score.systems[0].anchors[1].x);
  assert.equal(midway.anchor.pitches[0], 60);
  assert.equal(midway.measure, score.systems[0].measures[0]);
});

test('does not retain a note marker from the previous measure', () => {
  const measureOne = { startTime: 0, endTime: 2, left: 5, right: 55, top: 10, bottom: 70 };
  const measureTwo = { startTime: 2, endTime: 4, left: 55, right: 105, top: 10, bottom: 70 };
  const score = {
    pages: [],
    pageSizes: [],
    systems: [{
      page: 0,
      top: 10,
      bottom: 70,
      staves: [],
      left: 5,
      right: 105,
      startTime: 0,
      endTime: 4,
      measures: [measureOne, measureTwo],
      anchors: [
        { time: 1.5, x: 45, points: [], pitches: [] },
        { time: 2.5, x: 65, points: [], pitches: [] },
      ],
    }],
  };

  const position = getSvgPlaybackPosition(score, 2.25);

  assert.equal(position.measure, measureTwo);
  assert.equal(position.anchor, undefined);
  assert.equal(position.x, measureTwo.left);
});

test('uses MIDI time-signature changes for SVG measure boundaries', () => {
  const lines = [10, 15, 20, 25, 30, 50, 55, 60, 65, 70]
    .map((y) => `M5 ${y}H110`)
    .join('');
  const page = `<svg width="115" height="80"><path class="StaffLines" d="${lines}"/><path class="BarLine" d="M5 10v60M40 10v60M75 10v60M110 10v60"/></svg>`;
  const file = {
    timeSignature: { numerator: 4, denominator: 4 },
    timeSignatureChanges: [
      { numerator: 4, denominator: 4, beat: 0, time: 0 },
      { numerator: 3, denominator: 4, beat: 4, time: 2 },
      { numerator: 4, denominator: 4, beat: 7, time: 3.5 },
    ],
    tempos: [{ time: 0, bpm: 120 }],
    tracks: [],
  };

  const score = buildSvgPerformanceScore(file, [page]);

  assert.deepEqual(
    score.systems[0].measures.map(({ startTime, endTime }) => [startTime, endTime]),
    [[0, 2], [2, 3.5], [3.5, 5.5]],
  );
});