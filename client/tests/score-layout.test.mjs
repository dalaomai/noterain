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
const { getUniformScoreSpacing, getScoreTimeX, layoutScoreMeasures, getScorePageWidth } =
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
  const { scale, lines } = layoutScoreMeasures(
    [200, 150, 210, 160],
    400,
    80,
    20,
    { left: 0, right: 0 },
    'compact',
  );
  assert.ok(Math.abs(scale - 0.72) < 1e-8);
  assert.deepEqual(
    lines.map((line) => line.measureIndices),
    [
      [0, 1],
      [2, 3],
    ],
  );
  for (const line of lines)
    assert.equal(
      line.widths.reduce((a, b) => a + b),
      500,
    );
  assert.ok(lines[0].widths[0] >= 280);
  assert.ok(lines[1].widths[0] >= 290);
});

test('dense bars keep the same symbol size as sparse bars and remain available for horizontal panning', () => {
  const dense = layoutScoreMeasures([600, 120], 328, 100, 20);
  const sparse = layoutScoreMeasures([120, 120], 328, 100, 20);
  assert.equal(dense.scale, sparse.scale);
  assert.equal(dense.lines[0].measureIndices.length, 1);
  assert.ok(dense.width * dense.scale > 328);
  for (const line of dense.lines) {
    assert.ok(line.widths.reduce((a, b) => a + b) + 40 <= dense.width + 1e-8);
  }
});

test('relaxed, standard and compact scale symbols, spacing and wrapping in order', () => {
  const spacing = getUniformScoreSpacing([{ beat: 0, left: 0, right: 14 }], 4);
  const layouts = ['relaxed', 'standard', 'compact'].map((density) => {
    return layoutScoreMeasures(
      Array(12).fill(spacing.timeWidth),
      780,
      80,
      20,
      spacing,
      density,
    );
  });
  assert.ok(layouts[0].scale > layouts[1].scale);
  assert.ok(layouts[1].scale > layouts[2].scale);
  assert.ok(Math.abs(layouts[0].scale / layouts[1].scale - 2.1 / 1.9) < 1e-8);
  assert.ok(Math.abs(layouts[2].scale / layouts[1].scale - 2.1 / 2.5) < 1e-8);
  assert.ok(layouts[0].lines[0].timeWidth > layouts[1].lines[0].timeWidth);
  assert.ok(layouts[1].lines[0].timeWidth > layouts[2].lines[0].timeWidth);
  assert.ok(layouts[0].lines.length >= layouts[1].lines.length);
  assert.ok(layouts[1].lines.length >= layouts[2].lines.length);
});

test('symbol size matches original page dimensions across presets, viewports and note densities', () => {
  const factors = { relaxed: 1.9, standard: 2.1, compact: 2.5 };
  for (const viewport of [288, 313, 328, 748, 1393, 2029]) {
    for (const [density, factor] of Object.entries(factors)) {
      const originalPage = Math.max(750, Math.round(Math.max(320, viewport) * factor));
      const originalStaffSpacing = 18 * Math.min(1200, viewport) / originalPage;
      assert.equal(getScorePageWidth(viewport, density), originalPage);
      for (const minimumWidth of [120, 300, 700]) {
        const layout = layoutScoreMeasures(
          Array(13).fill(minimumWidth), viewport, 80, 20,
          { left: 30, right: 20 }, density,
        );
        assert.ok(Math.abs(layout.scale * 10 - originalStaffSpacing) < 1e-8);
        for (const line of layout.lines) {
          assert.ok(line.timeWidth >= minimumWidth - 1e-8);
          assert.ok(line.widths.reduce((a, b) => a + b) + 40 <= layout.width + 1e-8);
          assert.equal(line.timeWidth, layout.lines[0].timeWidth);
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

test('bar padding causes no cursor jump and unequal note density causes no speed change', () => {
  const { lines } = layoutScoreMeasures(
    [100, 200, 120, 100, 140],
    650,
    80,
    20,
    { left: 30, right: 20, boundary: 12 },
    'compact',
  );
  assert.deepEqual(
    lines.map((line) => line.measureIndices),
    [
      [0, 1, 2],
      [3, 4],
    ],
  );
  const pixelsPerSecond = lines[0].timeWidth / 2;
  for (const line of lines) {
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
  // A short final row retains the same scale instead of stretching its bars.
  assert.equal(lines[1].timeWidth, lines[0].timeWidth);
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
    for (const density of ['relaxed', 'standard', 'compact']) {
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
