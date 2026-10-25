import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const source = buildSync({
  entryPoints: [
    fileURLToPath(new URL('../src/features/score-link-import/core/svgScore.ts', import.meta.url)),
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
const { parseSvgPage } = bundled.exports;

test('recovers paired staves and shared measure boundaries from classified SVG paths', () => {
  const staffLines = [10, 15, 20, 25, 30, 50, 55, 60, 65, 70]
    .map((y) => `M5 ${y}H105`)
    .join('');
  const barlines = [5, 45, 105].map((x) => `M${x} 10v60`).join('');
  const page = parseSvgPage(
    `<svg width="110" height="80"><path class="StaffLines" d="${staffLines}"/><path class="BarLine" d="${barlines}"/></svg>`,
  );

  assert.equal(page.systems.length, 1);
  assert.equal(page.systems[0].staves.length, 2);
  assert.deepEqual(page.systems[0].barlines, [5, 45, 105]);
  assert.equal(page.systems[0].staves[0].spacing, 5);
  assert.deepEqual(page.systems[0].noteAnchors, []);
  assert.deepEqual(page.systems[0].restAnchors, []);
  assert.deepEqual(page.systems[0].clefs, ['G', 'G']);
});

test('assigns Note path anchors to their system, measure and nearest staff', () => {
  const staffLines = [10, 15, 20, 25, 30, 50, 55, 60, 65, 70]
    .map((y) => `M5 ${y}H105`)
    .join('');
  const page = parseSvgPage(
    `<svg width="110" height="80"><path class="StaffLines" d="${staffLines}"/><path class="BarLine" d="M5 10v60M45 10v60M105 10v60"/><path class="Note" d="M20 20c1 0 2 1 3 2M24 21z"/><path class="Note" d="M70 60c1 0 2 1 3 2"/></svg>`,
  );

  assert.deepEqual(page.systems[0].noteAnchors, [
    { x: 21.5, y: 21, staff: 1, measure: 0 },
    { x: 24, y: 21, staff: 1, measure: 0 },
    { x: 71.5, y: 61, staff: 2, measure: 1 },
  ]);
});

test('pairs hairpin lines and extracts horizontal pedal spans', () => {
  const staffLines = [10, 15, 20, 25, 30, 50, 55, 60, 65, 70]
    .map((y) => `M5 ${y}H105`)
    .join('');
  const page = parseSvgPage(
    `<svg width="110" height="90"><path class="StaffLines" d="${staffLines}"/><path class="BarLine" d="M5 10v60M105 10v60"/><path class="HairpinSegment" d="M20 75L80 78M20 75L80 72"/><path class="PedalSegment" d="M15 82H90M90 82v5"/></svg>`,
  );

  assert.equal(page.systems[0].hairpins.length, 1);
  assert.equal(page.systems[0].hairpins[0].type, 'crescendo');
  assert.equal(page.systems[0].pedals.length, 1);
  assert.equal(page.systems[0].pedals[0].minX, 15);
  assert.equal(page.systems[0].pedals[0].maxX, 90);
});

test('merges double barlines and accepts lines extending beyond the staves', () => {
  const staffLines = [10, 15, 20, 25, 30, 50, 55, 60, 65, 70]
    .map((y) => `M5 ${y}H105`)
    .join('');
  const page = parseSvgPage(
    `<svg width="110" height="90"><path class="StaffLines" d="${staffLines}"/><path class="BarLine" d="M5 9.5v70M45 9.5v70M46 9.5v70M105 9.5v70"/><path class="Note" d="M20 20c1 0 2 1 3 2M70 60c1 0 2 1 3 2"/></svg>`,
  );

  assert.equal(page.systems.length, 1);
  assert.deepEqual(page.systems[0].barlines, [5, 45.5, 105]);
  assert.deepEqual(page.systems[0].noteAnchors.map((note) => note.measure), [0, 1]);
});

test('rejects pages without recoverable score structure', () => {
  assert.throws(
    () => parseSvgPage('<svg width="100" height="100"><path class="Note" d="M1 1"/></svg>'),
    /SCORE_PAGE_STRUCTURE_UNAVAILABLE/,
  );
});