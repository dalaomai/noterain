import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const source = buildSync({
  entryPoints: [
    fileURLToPath(new URL('../src/lib/scoreCursor.ts', import.meta.url)),
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
const { buildScoreCursorRuns, getScoreCursorPosition } = bundled.exports;
const measures = new Map([
  ['a', { systemId: 'first', left: 80, right: 200, top: 10, height: 90 }],
  ['b', { systemId: 'first', left: 200, right: 340, top: 10, height: 90 }],
  ['c', { systemId: 'second', left: 80, right: 210, top: 210, height: 90 }],
]);
const onsets = new Map([
  ['n0', 100],
  ['n1', 160],
  ['n2', 220],
  ['n3', 280],
  ['n4', 100],
]);
const build = (events, duration) =>
  buildScoreCursorRuns(
    events,
    (id) => measures.get(id),
    (id) => onsets.get(id),
    duration,
  );

test('original engraving cursor crosses actual onsets, barlines and a row end continuously', () => {
  const runs = build(
    [
      { tstamp: 0, measureOn: 'a', on: ['n0'] },
      { tstamp: 1000, on: ['n1'] },
      { tstamp: 2000, measureOn: 'b', on: ['n2'] },
      { tstamp: 3000, on: ['n3'] },
      { tstamp: 4000, measureOn: 'c', on: ['n4'] },
      { tstamp: 6000, off: ['n4'] },
    ],
    6,
  );
  assert.equal(runs.length, 2);
  for (const [time, expected] of [
    [0, 100],
    [0.5, 130],
    [1, 160],
    [2, 220],
    [3, 280],
  ]) {
    assert.equal(getScoreCursorPosition(runs, time).x, expected);
  }
  assert.ok(Math.abs(getScoreCursorPosition(runs, 1.999).x - 220) < 0.1);
  assert.ok(Math.abs(getScoreCursorPosition(runs, 3.999).x - 340) < 0.1);
  assert.equal(getScoreCursorPosition(runs, 4).top, 210);
  assert.equal(getScoreCursorPosition(runs, 4).x, 100);
  assert.equal(getScoreCursorPosition(runs, 6).x, 210);
});

test('empty measures and rests retain their duration and the cursor keeps advancing', () => {
  const runs = build(
    [
      { tstamp: 0, measureOn: 'a', on: ['n0'] },
      { tstamp: 2000, measureOn: 'b' },
      { tstamp: 3000, off: ['n0'] },
    ],
    4,
  );
  assert.equal(getScoreCursorPosition(runs, 2).x, 200);
  assert.equal(getScoreCursorPosition(runs, 3).x, 270);
  assert.equal(getScoreCursorPosition(runs, 4).x, 340);
});

test('a repeat to an earlier measure starts a new visit instead of dragging backwards through notes', () => {
  const runs = build(
    [
      { tstamp: 0, measureOn: 'a', on: ['n0'] },
      { tstamp: 2000, measureOn: 'b', on: ['n2'] },
      { tstamp: 4000, measureOn: 'a', on: ['n0'] },
      { tstamp: 6000, measureOn: 'b', on: ['n2'] },
    ],
    8,
  );
  assert.equal(runs.length, 2);
  assert.ok(getScoreCursorPosition(runs, 3.999).x > 339);
  assert.equal(getScoreCursorPosition(runs, 4).x, 100);
  assert.equal(getScoreCursorPosition(runs, 6).x, 220);
  assert.equal(getScoreCursorPosition(runs, 0).x, 100);
});

test('chord tones share one onset and missing engravings never create invalid positions', () => {
  const runs = build(
    [
      { tstamp: 0, measureOn: 'a', on: ['n1', 'n0', 'missing'] },
      { tstamp: 500, off: ['n0'] },
      { tstamp: 1000, on: ['missing'] },
    ],
    2,
  );
  assert.equal(getScoreCursorPosition(runs, 0).x, 100);
  assert.equal(getScoreCursorPosition(runs, 1).x, 150);
  assert.equal(getScoreCursorPosition(runs, -1).x, 100);
  assert.equal(getScoreCursorPosition(runs, 20).x, 200);
  assert.equal(getScoreCursorPosition([], 1), null);
});
