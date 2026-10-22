import test from 'node:test';
import assert from 'node:assert/strict';
import { transform } from 'esbuild';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { parseMidi, writeMidi } from 'midi-file';

async function loadValidator() {
  const source = await readFile(new URL('../src/features/score-link-import/core/midiValidation.ts', import.meta.url), 'utf8');
  const { code } = await transform(source, { loader: 'ts', format: 'cjs', target: 'es2020' });
  const module = { exports: {} };
  const context = vm.createContext({
    module,
    exports: module.exports,
    require(specifier) {
      if (specifier === 'midi-file') return { parseMidi };
      throw new Error(`Unexpected import: ${specifier}`);
    },
  });
  new vm.Script(code).runInContext(context);
  return module.exports;
}

function midi(ticksPerBeat, tracks) {
  return writeMidi({
    header: { format: tracks.length > 1 ? 1 : 0, numTracks: tracks.length, ticksPerBeat },
    tracks: tracks.map((events) => [...events, { deltaTime: 0, type: 'endOfTrack' }]),
  });
}

const tempo120 = { deltaTime: 0, type: 'setTempo', microsecondsPerBeat: 500000 };

test('accepts equivalent playback semantics across PPQ, tracks, channels and velocity', async () => {
  const { validateMidiRoundTrip: validate } = await loadValidator();
  const source = midi(480, [[
    { deltaTime: 0, type: 'noteOn', channel: 0, noteNumber: 60, velocity: 90 },
    { deltaTime: 480, type: 'noteOff', channel: 0, noteNumber: 60, velocity: 0 },
  ]]);
  const generated = midi(960, [
    [tempo120],
    [
      { deltaTime: 0, type: 'noteOn', channel: 7, noteNumber: 60, velocity: 64 },
      { deltaTime: 960, type: 'noteOff', channel: 7, noteNumber: 60, velocity: 0 },
    ],
  ]);

  const report = validate(source, generated);
  assert.equal(report.valid, true);
  assert.equal(report.sourceNoteCount, 1);
  assert.equal(report.generatedNoteCount, 1);
});

test('reports changed pitch, onset, duration and tempo as semantic differences', async () => {
  const { validateMidiRoundTrip: validate } = await loadValidator();
  const source = midi(480, [[
    tempo120,
    { deltaTime: 0, type: 'noteOn', channel: 0, noteNumber: 60, velocity: 90 },
    { deltaTime: 480, type: 'noteOff', channel: 0, noteNumber: 60, velocity: 0 },
  ]]);
  const generated = midi(480, [[
    { deltaTime: 0, type: 'setTempo', microsecondsPerBeat: 600000 },
    { deltaTime: 120, type: 'noteOn', channel: 0, noteNumber: 61, velocity: 90 },
    { deltaTime: 240, type: 'noteOff', channel: 0, noteNumber: 61, velocity: 0 },
  ]]);

  const report = validate(source, generated);
  assert.equal(report.valid, false);
  assert.equal(report.missingNotes.length, 1);
  assert.equal(report.extraNotes.length, 1);
  assert.equal(report.tempoMatches, false);
});

test('notation validation compares quantized pitch and onset without performed note-off timing', async () => {
  const { validateNotationMidiRoundTrip: validate } = await loadValidator();
  const source = midi(480, [[
    { deltaTime: 3, type: 'noteOn', channel: 0, noteNumber: 60, velocity: 90 },
    { deltaTime: 224, type: 'noteOff', channel: 0, noteNumber: 60, velocity: 0 },
  ]]);
  const generated = midi(960, [[
    { deltaTime: 0, type: 'noteOn', channel: 4, noteNumber: 60, velocity: 64 },
    { deltaTime: 480, type: 'noteOff', channel: 4, noteNumber: 60, velocity: 0 },
  ]]);

  assert.equal(validate(source, generated).valid, true);
  const changed = midi(960, [[
    { deltaTime: 0, type: 'noteOn', channel: 4, noteNumber: 61, velocity: 64 },
    { deltaTime: 480, type: 'noteOff', channel: 4, noteNumber: 61, velocity: 0 },
  ]]);
  assert.equal(validate(source, changed).valid, false);
});