import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const source = buildSync({
  entryPoints: [
    fileURLToPath(new URL('../src/features/score-link-import/core/svgValidation.ts', import.meta.url)),
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
const { summarizeRenderedSvgPage, validateSvgStructure } = bundled.exports;

function sourcePage(staffCount = 2, barlines = [5, 45, 105]) {
  const lines = Array.from({ length: staffCount }, (_, staff) =>
    [10, 15, 20, 25, 30].map((y) => `M5 ${y + staff * 40}H105`).join(''),
  ).join('');
  const bottom = 30 + (staffCount - 1) * 40;
  const bars = barlines.map((x) => `M${x} 10v${bottom - 10}`).join('');
  return `<svg width="110" height="${bottom + 10}"><path class="StaffLines" d="${lines}"/><path class="BarLine" d="${bars}"/></svg>`;
}

function renderedPage({ staffCount = 2, measureCount = 2 } = {}) {
  const measures = Array.from({ length: measureCount }, (_, measure) => `
    <g id="measure-${measure}" class="measure">
      ${Array.from({ length: staffCount }, (_, staff) => `<g id="staff-${measure}-${staff}" class="staff"><g class="layer"><g class="note"><g class="notehead"/></g><g class="rest"/></g></g>`).join('')}
    </g>`).join('');
  return `<svg width="110" height="100"><g class="page-margin"><g class="system">${measures}</g></g></svg>`;
}

test('summarizes Verovio system, measure, staff, note and rest groups', () => {
  const page = summarizeRenderedSvgPage(renderedPage());
  assert.deepEqual(page.systems, [{
    staffCount: 2,
    measureCount: 2,
    noteCount: 4,
    restCount: 4,
  }]);
});

test('accepts matching page, system, staff and measure structure', () => {
  const report = validateSvgStructure([sourcePage()], [renderedPage()]);
  assert.equal(report.valid, true);
  assert.deepEqual(report.mismatches, []);
  assert.deepEqual(report.unsupportedSourceSymbols, []);
});

test('rejects structurally matching pages when notation semantics are not reconstructed', () => {
  const source = sourcePage().replace('</svg>', '<path class="Note" d="M20 20"/><path class="Beam" d="M20 15"/><path class="PedalSegment" d="M20 70"/><path class="SlurSegment" d="M20 12"/></svg>');
  const report = validateSvgStructure([source], [renderedPage()]);

  assert.equal(report.valid, false);
  assert.deepEqual(report.mismatches, []);
  assert.deepEqual(report.unsupportedSourceSymbols, ['PedalSegment', 'SlurSegment']);
});

test('reports pagination and per-system structural differences', () => {
  const report = validateSvgStructure(
    [sourcePage(), sourcePage()],
    [renderedPage({ staffCount: 1, measureCount: 1 })],
  );
  assert.equal(report.valid, false);
  assert.deepEqual(report.mismatches.map(({ field }) => field), [
    'pageCount',
    'staffCount',
    'measureCount',
  ]);
});