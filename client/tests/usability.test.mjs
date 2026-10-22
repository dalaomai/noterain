import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const source = buildSync({
  entryPoints: [fileURLToPath(new URL('../src/features/score-link-import/core/usability.ts', import.meta.url))],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
}).outputFiles[0].text;
const bundled = { exports: {} };
new Function('module', 'exports', 'require', source)(bundled, bundled.exports, createRequire(import.meta.url));
const { calculateUsability } = bundled.exports;

const page = `<svg width="100" height="100">
  <path class="StaffLines"/><path class="BarLine"/><path class="Note"/>
  <path class="Beam"/><path class="Hook"/><path class="NoteDot"/>
  <path class="Accidental"/><path class="Rest"/><path class="SlurSegment"/>
  <path class="PedalSegment"/><path class="HairpinSegment"/>
  <path class="Dynamic"/><path class="Text"/><path class="Tuplet"/>
</svg>`;
const svg = {
  valid: false,
  source: [{ systems: [{ staffCount: 2, measureCount: 8 }] }],
  generated: [{ systems: [{ staffCount: 2, measureCount: 8 }] }],
  mismatches: [],
  unsupportedSourceSymbols: ['Accidental', 'Rest', 'SlurSegment', 'PedalSegment', 'Text', 'Tuplet'],
};

test('golden-level reconstruction exceeds the 90 percent usability gate', () => {
  const report = calculateUsability([page], {
    valid: false,
    sourceNoteCount: 2346,
    generatedNoteCount: 2346,
    missing: Array.from({ length: 10 }, (_, pitch) => ({ pitch, onset: 0 })),
    extra: Array.from({ length: 10 }, (_, pitch) => ({ pitch, onset: 0.125 })),
  }, svg);

  assert.ok(report.score >= 90);
  assert.equal(report.usable, true);
  assert.equal(report.structure, 100);
});

test('substantial note loss fails the usability gate', () => {
  const report = calculateUsability([page], {
    valid: false,
    sourceNoteCount: 100,
    generatedNoteCount: 70,
    missing: Array.from({ length: 30 }, (_, pitch) => ({ pitch, onset: 0 })),
    extra: [],
  }, { ...svg, mismatches: [{ page: 1, field: 'measureCount', source: 8, generated: 7 }] });

  assert.ok(report.score < 90);
  assert.equal(report.usable, false);
});

test('only SVG-proven arpeggio expansion offsets are treated as usable', () => {
  const midi = {
    valid: false,
    sourceNoteCount: 1,
    generatedNoteCount: 1,
    missing: [{ pitch: 60, onset: 1 }],
    extra: [{ pitch: 60, onset: 1.125 }],
  };
  const withArpeggio = calculateUsability([page.replace('</svg>', '<path class="Arpeggio"/></svg>')], midi, svg);
  const withoutArpeggio = calculateUsability([page], midi, svg);

  assert.equal(withArpeggio.midi, 100);
  assert.equal(withoutArpeggio.midi, 0);
});

test('paired tuplets and explicit beams count as recovered notation', () => {
  const midi = {
    valid: true,
    sourceNoteCount: 1,
    generatedNoteCount: 1,
    missing: [],
    extra: [],
  };
  const withoutNotation = calculateUsability([page], midi, svg, '<score-partwise/>');
  const withNotation = calculateUsability([page], midi, svg, `
    <score-partwise>
      <note><pitch><step>C</step><octave>4</octave></pitch><beam number="1">begin</beam>
        <notations><tuplet type="start" number="1"/></notations></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><beam number="1">end</beam>
        <notations><tuplet type="stop" number="1"/></notations></note>
    </score-partwise>
  `);

  assert.ok(withNotation.notation > withoutNotation.notation);
  assert.ok(withNotation.score > withoutNotation.score);
});