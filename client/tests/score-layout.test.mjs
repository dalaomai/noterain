import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const source = buildSync({
  entryPoints: [
    fileURLToPath(new URL('../src/lib/scoreLayout.ts', import.meta.url)),
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
const { getUniformScoreSpacing, getScoreTimeX, layoutScoreMeasures, getScorePageWidth, getSimplifiedDensity } =
  bundled.exports;

test('time proportional spacing reserves enough room for short notes and accidentals', () => {
  const columns = [
    { beat: 0, left: 0, right: 14 },
    { beat: 0.25, left: 18, right: 14 },
    { beat: 1, left: 0, right: 14 },
    { beat: 3, left: 12, right: 14 },
  ];
  const spacing = getUniformScoreSpacing(columns, 4);
  for (const density of ['relaxed', 'standard', 'compact']) {
    const { lines } = layoutScoreMeasures(
      [spacing.timeWidth],
      1440,
      80,
      20,
      spacing,
      density,
    );
    const beatWidth = lines[0].timeWidth / 4;
    for (let i = 1; i < columns.length; i++) {
      const gap = (columns[i].beat - columns[i - 1].beat) * beatWidth;
      assert.ok(gap > columns[i - 1].right + columns[i].left);
    }
    assert.ok(spacing.left >= 18);
    assert.ok(spacing.right >= 14);
  }
});

test('measures wrap before squeezing below their measured widths, with one header per line', () => {
  const { scale, width, lines } = layoutScoreMeasures(
    [200, 150, 210, 160],
    400,
    80,
    20,
    { left: 0, right: 0 },
    10,
  );
  assert.ok(scale > 0);
  assert.deepEqual(lines.flatMap((line) => line.measureIndices), [0, 1, 2, 3]);
  assert.ok(lines.every((line) => line.measureIndices.length <= 8));
  for (const line of lines) {
    assert.ok(line.widths.reduce((a, b) => a + b) + 40 <= width + 1e-8);
    assert.ok(line.timeWidth > 0);
  }
});

test('dense bars preserve symbol scale and never require horizontal panning', () => {
  const dense = layoutScoreMeasures([600, 120], 328, 100, 20);
  const sparse = layoutScoreMeasures([120, 120], 328, 100, 20);
  assert.equal(dense.scale, sparse.scale);
  assert.ok(dense.lines[0].measureIndices.length >= 1);
  assert.ok(dense.width * dense.scale <= 328 + 1e-8);
  assert.ok(sparse.width * sparse.scale <= 328 + 1e-8);
  for (const line of dense.lines) {
    assert.ok(line.widths.reduce((a, b) => a + b) + 40 <= dense.width + 1e-8);
  }
});

test('one unusually dense bar does not force every sparse bar onto its own line', () => {
  const widths = [620, 120, 130, 110, 125, 115];
  const { lines } = layoutScoreMeasures(
    widths,
    1200,
    80,
    20,
    { left: 30, right: 20 },
    10,
  );
  assert.ok(lines.every((line) => line.measureIndices.length <= 8));
  assert.ok(lines.some((line) => line.measureIndices.length >= 4));
  for (const line of lines) {
    const equalWidth = line.timeWidths.reduce((sum, width) => sum + width, 0)
      / line.timeWidths.length;
    assert.ok(line.timeWidths.every((width) => width >= equalWidth * 0.5 - 1e-8));
    assert.ok(line.noteWidths.every((width) => width > 0));
  }
});

test('all rows share one right edge, including the final row', () => {
  const { lines } = layoutScoreMeasures(
    [180, 120, 160, 140, 130, 110, 100],
    900,
    80,
    20,
    { left: 30, right: 20 },
    5,
  );
  const rowWidths = lines.map((line) =>
    line.timeWidths.reduce((sum, width) => sum + width, 0),
  );
  assert.ok(rowWidths.every((width) => Math.abs(width - rowWidths[0]) < 1e-8));
});

test('equal layout uses equal measures while smart layout follows notation complexity', () => {
  const widths = [120, 240, 180];
  const equal = layoutScoreMeasures(
    widths, 1200, 80, 20, { left: 30, right: 20 }, 10, 'equal',
  );
  const smart = layoutScoreMeasures(
    widths, 1200, 80, 20, { left: 30, right: 20 }, 10, 'smart',
  );
  assert.ok(equal.lines[0].timeWidths.every(
    (width) => Math.abs(width - equal.lines[0].timeWidths[0]) < 1e-8,
  ));
  assert.ok(smart.lines[0].timeWidths[1] > smart.lines[0].timeWidths[2]);
  assert.ok(smart.lines[0].timeWidths[2] > smart.lines[0].timeWidths[0]);
  assert.ok(smart.lines[0].timeWidths.every(
    (width) => width >= smart.lines[0].timeWidths.reduce((sum, value) => sum + value, 0) / 6,
  ));
});

test('density continuously expands rows from two to eight measures', () => {
  const limits = [[1, 2], [5, 5], [10, 8]];
  for (const [density, limit] of limits) {
    const { lines } = layoutScoreMeasures(
      Array(9).fill(120), 1800, 80, 20,
      { left: 30, right: 20 }, density, 'equal',
    );
    assert.ok(lines.every((line) => line.measureIndices.length <= limit));
    assert.ok(lines.some((line) => line.measureIndices.length === limit));
    assert.ok(lines.every((line) => line.noteWidths.every((width) => width > 0)));
  }
});

test('browser zoom reduces measures per line before compressing notation', () => {
  const widths = Array(12).fill(100);
  for (const [density, expected] of [
    [1, 1],
    [5, 3],
    [10, 5],
  ]) {
    const { lines } = layoutScoreMeasures(
      widths, 1600, 80, 20,
      { left: 30, right: 20 }, density, 'equal', 1.5,
    );
    assert.ok(lines.every((line) => line.measureIndices.length <= expected));
    assert.ok(lines.some((line) => line.measureIndices.length === expected));
  }
});

test('density changes spacing and wrapping without changing symbol scale', () => {
  const spacing = getUniformScoreSpacing([{ beat: 0, left: 0, right: 14 }], 4);
  const layouts = [1, 5, 10].map((density) => {
    return layoutScoreMeasures(
      Array(12).fill(spacing.timeWidth),
      780,
      80,
      20,
      spacing,
      density,
    );
  });
  assert.equal(layouts[0].scale, layouts[1].scale);
  assert.equal(layouts[1].scale, layouts[2].scale);
  assert.ok(layouts[0].lines[0].noteWidths[0] > layouts[1].lines[0].noteWidths[0]);
  assert.ok(layouts[1].lines[0].noteWidths[0] > layouts[2].lines[0].noteWidths[0]);
  assert.ok(layouts[0].lines.length >= layouts[1].lines.length);
  assert.ok(layouts[1].lines.length >= layouts[2].lines.length);
});

test('symbol size follows viewport dimensions equally across density presets', () => {
  const spacing = { relaxed: 1.35, standard: 1.15, compact: 1 };
  for (const viewport of [288, 313, 328, 748, 1393, 2029]) {
    for (const density of ['relaxed', 'standard', 'compact']) {
      const originalPage = Math.max(750, Math.round(Math.max(320, viewport) * 2.1));
      const originalStaffSpacing = 18 * Math.min(1200, viewport) / originalPage;
      assert.equal(getScorePageWidth(viewport, density), originalPage);
      for (const minimumWidth of [120, 300, 700]) {
        const layout = layoutScoreMeasures(
          Array(13).fill(minimumWidth), viewport, 80, 20,
          { left: 30, right: 20 }, density,
        );
        assert.ok(layout.scale * 10 <= originalStaffSpacing + 1e-8);
        assert.ok(layout.width * layout.scale <= viewport + 1e-8);
        if (
          minimumWidth * spacing[density] + 80 + 30 + 20 + 40
            <= viewport / (originalStaffSpacing / 10)
        ) {
          assert.ok(Math.abs(layout.scale * 10 - originalStaffSpacing) < 1e-8);
        }
        for (const line of layout.lines) {
          assert.ok(line.timeWidth > 0);
          assert.ok(line.widths.reduce((a, b) => a + b) + 40 <= layout.width + 1e-8);
          assert.ok(line.noteWidths.every((width) => width > 0));
        }
      }
    }
  }
});

test('notes and cursor share a linear time axis excluding clefs and bar padding', () => {
  const x = (time) => getScoreTimeX(time, 2, 2, 150, 550);
  assert.equal(x(2), 150);
  assert.equal(x(2.25), 200);
  assert.equal(x(2.5), 250);
  assert.equal(x(3), 350);
  assert.equal(x(4), 550);
  assert.equal(x(-10), 150);
  assert.equal(x(10), 550);
  assert.equal(x(2), 150); // A backwards loop jump carries no accumulated drift.
});

test('playback crosses the full measure even when notation uses a compact note span', () => {
  const playbackStart = 180;
  const playbackEnd = 980;
  const compactNoteEnd = 460;
  const quarter = getScoreTimeX(10.5, 10, 2, playbackStart, playbackEnd);
  const threeQuarter = getScoreTimeX(11.5, 10, 2, playbackStart, playbackEnd);
  assert.equal(quarter, 380);
  assert.equal(threeQuarter, 780);
  assert.ok(threeQuarter > compactNoteEnd);
});

test('bar padding causes no cursor jump and each line keeps one time scale', () => {
  const { lines } = layoutScoreMeasures(
    [100, 200, 120, 100, 140],
    650,
    80,
    20,
    { left: 30, right: 20, boundary: 12 },
    'compact',
  );
  assert.deepEqual(lines.flatMap((line) => line.measureIndices), [0, 1, 2, 3, 4]);
  for (const line of lines) {
    const pixelsPerSecond = line.timeWidth / 2;
    assert.equal(line.timeWidth / 2, pixelsPerSecond);
    for (let i = 0; i < line.measureIndices.length; i++) {
      const startTime = line.measureIndices[i] * 2;
      const startX = line.timeStartX + i * line.timeWidth;
      const endX = startX + line.timeWidth;
      const x = (time) => getScoreTimeX(time, startTime, 2, startX, endX);
      assert.ok(
        Math.abs(
          (x(startTime + 1.001) - x(startTime + 1)) / 0.001 - pixelsPerSecond,
        ) < 1e-8,
      );
      if (i + 1 < line.measureIndices.length) {
        const nextStart = line.timeStartX + (i + 1) * line.timeWidth;
        const nextX = getScoreTimeX(
          startTime + 2.001,
          startTime + 2,
          2,
          nextStart,
          nextStart + line.timeWidth,
        );
        assert.ok(
          Math.abs((nextX - x(startTime + 1.999)) / 0.002 - pixelsPerSecond) <
            1e-8,
        );
      }
    }
  }
  assert.ok(lines.every((line) => line.timeWidth > 0));
});

test('the last short note leaves room for the next barline and accidentals', () => {
  const columns = [
    { beat: 0, left: 0, right: 14 },
    { beat: 3.875, left: 0, right: 14 },
  ];
  const spacing = getUniformScoreSpacing(columns, 4, 18);
  const remaining = ((4 - 3.875) * spacing.timeWidth) / 4;
  assert.ok(remaining >= 14 + 18 + 12 + 8);
});

test('internal barlines leave breathing room for notes on both sides, including accidentals', () => {
  for (const accidentalWidth of [0, 18]) {
    const columns = [
      { beat: 0, left: accidentalWidth, right: 14 },
      { beat: 3.5, left: 0, right: 14 },
    ];
    const spacing = getUniformScoreSpacing(columns, 4, accidentalWidth);
    for (const density of ['standard', 'compact']) {
      const { scale, lines } = layoutScoreMeasures(
        Array(5).fill(spacing.timeWidth),
        2200,
        100,
        20,
        { ...spacing, boundary: accidentalWidth + 12 },
        density,
      );
      assert.ok(lines[0].measureIndices.length > 1);
      for (const line of lines) {
        let barline = 20;
        for (let i = 0; i < line.measureIndices.length - 1; i++) {
          barline += line.widths[i];
          const startX = line.timeStartX + i * line.timeWidth;
          const previousNoteRight =
            getScoreTimeX(3.5, 0, 4, startX, startX + line.timeWidth) + 14;
          const nextNoteLeft = startX + line.timeWidth - accidentalWidth;
          assert.ok((barline - previousNoteRight) * scale >= 8 * scale - 1e-8);
          assert.ok((nextNoteLeft - barline) * scale >= 12 * scale - 1e-8);
        }
      }
    }
  }
});

test('each closing barline ends exactly at the playback endpoint, including short last rows', () => {
  for (const viewport of [360, 780, 1440]) {
    for (const density of ['relaxed', 'standard', 'compact']) {
      const { lines } = layoutScoreMeasures(
        Array(13).fill(180),
        viewport,
        80,
        20,
        { left: 36, right: 32, boundary: 18 },
        density,
      );
      for (const line of lines) {
        const staffEnd =
          20 + line.widths.reduce((sum, width) => sum + width, 0);
        const lastStart =
          line.timeStartX + (line.measureIndices.length - 1) * line.timeWidth;
        const playbackEnd = getScoreTimeX(
          2,
          0,
          2,
          lastStart,
          lastStart + line.timeWidth,
        );
        assert.ok(
          Math.abs(staffEnd - playbackEnd) < 1e-8,
          `${density} at ${viewport}: unused tail ${staffEnd - playbackEnd}`,
        );
      }
    }
  }
});
