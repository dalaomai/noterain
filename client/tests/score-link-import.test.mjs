import test from 'node:test';
import assert from 'node:assert/strict';
import { transform } from 'esbuild';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { strFromU8, unzipSync } from 'fflate';
import { parseMidi, writeMidi } from 'midi-file';
import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';

async function loadDiagnosticPackager() {
  const source = await readFile(new URL('../src/features/score-link-import/core/diagnosticPackage.ts', import.meta.url), 'utf8');
  const { code } = await transform(source, { loader: 'ts', format: 'cjs', target: 'es2020' });
  const module = { exports: {} };
  const context = vm.createContext({
    module,
    exports: module.exports,
    Blob,
    require(specifier) {
      if (specifier === 'fflate') return awaitImportFflate;
      throw new Error(`Unexpected import: ${specifier}`);
    },
    atob: (value) => Buffer.from(value, 'base64').toString('binary'),
  });
  new vm.Script(code).runInContext(context);
  return module.exports.createDiagnosticPackage;
}

const awaitImportFflate = await import('fflate');

test('link import returns SVG and MIDI without invoking MusicXML reconstruction', async () => {
  const api = await readFile(new URL('../src/features/score-link-import/core/api.ts', import.meta.url), 'utf8');
  const dialog = await readFile(new URL('../src/features/score-link-import/ScoreLinkImport.tsx', import.meta.url), 'utf8');
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const controls = await readFile(new URL('../src/components/Controls/Controls.tsx', import.meta.url), 'utf8');

  assert.doesNotMatch(api, /reconstructMusicXml|validateReconstructedScore/);
  assert.doesNotMatch(api, /fetch\(/);
  assert.match(api, /window\.addEventListener\('message', receive\)/);
  assert.match(api, /event\.data\?\.nonce !== nonce/);
  assert.match(dialog, /await onImported\(/);
  assert.doesNotMatch(dialog, /musicXml|pendingResult|downloadDiagnosticPackage/);
  assert.match(dialog, /new URL\(/);
  assert.match(dialog, /window\.location\.origin/);
  assert.match(dialog, /score-link-companion\.user\.js\?v=\$\{REQUIRED_COMPANION_VERSION\}/);
  assert.match(api, /noterain-score-bridge-request/);
  assert.match(api, /event\.data\.status === 'bridge-ready'/);
  assert.match(api, /COMPANION_NOT_DETECTED/);
  assert.match(api, /5_000/);
  assert.doesNotMatch(dialog, /checkCompanion|receiveProbe|companionState/);
  assert.match(app, /currentFile\?\.sourceFormat === 'svg-midi'/);
  assert.match(app, /<SvgPerformanceSheet/);
  assert.match(controls, /currentFile\?\.sourceFormat !== 'svg-midi'/);
  assert.match(controls, /aria-haspopup="menu"/);
  assert.match(controls, /t\('importLocalScore'\)/);
  assert.match(controls, /t\('importScoreLink'\)/);
  assert.match(controls, /currentFile\?\.sourceFormat === 'svg-midi'/);
  assert.match(controls, /downloadSvgMidiPackage\(currentFile\)/);
  assert.match(controls, /t\('downloadSvgMidiPackage'\)/);
  assert.doesNotMatch(controls, /aria-label=\{t\('importScoreLink'\)\}/);
});

test('creates a portable diagnostic ZIP with manifest, MIDI and SVG pages', async () => {
  const createPackage = await loadDiagnosticPackager();
  const midi = Uint8Array.from([0x4d, 0x54, 0x68, 0x64]);
  const result = createPackage({
    source: { provider: 'musescore', url: 'https://musescore.com/user/1/scores/2', scoreId: 2, revisionId: 3 },
    title: 'Test / Score',
    midiBase64: Buffer.from(midi).toString('base64'),
    pages: ['<svg id="first"/>', '<svg id="second"/>'],
  });
  const files = unzipSync(new Uint8Array(await result.blob.arrayBuffer()));
  const manifest = JSON.parse(strFromU8(files['manifest.json']));

  assert.equal(result.fileName, 'Test _ Score-2-noterain-debug.zip');
  assert.deepEqual(files['score.mid'], midi);
  assert.equal(strFromU8(files['pages/page-001.svg']), '<svg id="first"/>');
  assert.equal(strFromU8(files['pages/page-002.svg']), '<svg id="second"/>');
  assert.equal(manifest.format, 'noterain-score-link-diagnostic');
  assert.deepEqual(manifest.files.pages, ['pages/page-001.svg', 'pages/page-002.svg']);
});

test('failed-validation package includes reconstructed MusicXML and report', async () => {
  const createPackage = await loadDiagnosticPackager();
  const collected = {
    source: { provider: 'musescore', url: 'https://musescore.com/user/1/scores/2', scoreId: 2, revisionId: 3 },
    title: 'Failed score',
    midiBase64: Buffer.from([0x4d, 0x54, 0x68, 0x64]).toString('base64'),
    pages: ['<svg/>'],
  };
  const reconstructed = {
    fileName: 'Failed score.musicxml',
    musicXml: '<score-partwise/>',
    report: { pageCount: 1, svgNoteSymbols: 0, midiNotes: 0 },
  };
  const validation = {
    valid: false,
    usability: { score: 92.4, usable: true, midi: 99.6, structure: 100, notation: 75.4 },
    midi: { valid: false },
    tempo: { valid: true },
    svg: { valid: false, error: 'render failed' },
  };
  const result = createPackage(collected, reconstructed, validation);
  const files = unzipSync(new Uint8Array(await result.blob.arrayBuffer()));
  const manifest = JSON.parse(strFromU8(files['manifest.json']));

  assert.equal(strFromU8(files['reconstructed.musicxml']), reconstructed.musicXml);
  assert.deepEqual(JSON.parse(strFromU8(files['validation.json'])), validation);
  assert.equal(manifest.files.musicXml, 'reconstructed.musicxml');
  assert.equal(manifest.files.validation, 'validation.json');
});

test('generated MusicXML round-trips notes and encoded layout through Verovio', async () => {
  const entry = new URL('../src/features/score-link-import/core/musicXml.ts', import.meta.url);
  const { buildSync } = await import('esbuild');
  const source = buildSync({
    entryPoints: [entry.pathname],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
  }).outputFiles[0].text;
  const module = { exports: {} };
  new Function('module', 'exports', 'require', source)(module, module.exports, (await import('node:module')).createRequire(import.meta.url));
  const midi = writeMidi({
    header: { format: 1, numTracks: 2, ticksPerBeat: 480 },
    tracks: [
      [
        { deltaTime: 0, type: 'timeSignature', numerator: 3, denominator: 4, metronome: 24, thirtyseconds: 8 },
        { deltaTime: 0, type: 'setTempo', microsecondsPerBeat: 600000 },
        { deltaTime: 0, type: 'noteOn', channel: 0, noteNumber: 72, velocity: 90 },
        { deltaTime: 227, type: 'noteOff', channel: 0, noteNumber: 72, velocity: 0 },
        { deltaTime: 1213, type: 'endOfTrack' },
      ],
      [
        { deltaTime: 0, type: 'noteOn', channel: 1, noteNumber: 48, velocity: 70 },
        { deltaTime: 455, type: 'noteOff', channel: 1, noteNumber: 48, velocity: 0 },
        { deltaTime: 985, type: 'endOfTrack' },
      ],
    ],
  });
  const staffLines = [10, 15, 20, 25, 30, 50, 55, 60, 65, 70]
    .map((y) => `M5 ${y}H105`).join('');
  const page = `<svg width="110" height="80"><path class="StaffLines" d="${staffLines}"/><path class="BarLine" d="M5 10v60M55 10v60M105 10v60"/></svg>`;
  const reconstructed = module.exports.reconstructMusicXml({
    source: { provider: 'musescore', url: 'https://musescore.com/', scoreId: 1, revisionId: 1 },
    title: 'Round trip',
    midiBase64: Buffer.from(midi).toString('base64'),
    pages: [page],
  });

  assert.match(reconstructed.musicXml, /<defaults><scaling>/);
  assert.match(reconstructed.musicXml, /<page-layout><page-height>160\.00<\/page-height><page-width>220\.00<\/page-width>/);
  assert.match(reconstructed.musicXml, /<measure number="1" width="100\.00">/);
  assert.match(reconstructed.musicXml, /<system-layout>/);

  const verovioModule = await createVerovioModule();
  const toolkit = new VerovioToolkit(verovioModule);
  try {
    toolkit.setOptions({ breaks: 'encoded', footer: 'none', header: 'none' });
    assert.ok(toolkit.loadData(reconstructed.musicXml));
    const generated = parseMidi(Buffer.from(toolkit.renderToMIDI(), 'base64'));
    const noteOns = generated.tracks.flatMap((track) => track.filter(
      (event) => event.type === 'noteOn' && event.velocity > 0,
    ));
    assert.deepEqual(noteOns.map((event) => event.noteNumber).sort((a, b) => a - b), [48, 72]);
    assert.equal(toolkit.getPageCount(), 1);
    assert.match(toolkit.renderToSVG(1, false), /class="system"/);
  } finally {
    toolkit.destroy();
  }
});

test('overlapping voices that cross a barline preserve every onset', async () => {
  const entry = new URL('../src/features/score-link-import/core/musicXml.ts', import.meta.url);
  const { buildSync } = await import('esbuild');
  const source = buildSync({ entryPoints: [entry.pathname], bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text;
  const module = { exports: {} };
  new Function('module', 'exports', 'require', source)(module, module.exports, (await import('node:module')).createRequire(import.meta.url));
  const midi = writeMidi({
    header: { format: 0, numTracks: 1, ticksPerBeat: 480 },
    tracks: [[
      { deltaTime: 0, type: 'timeSignature', numerator: 3, denominator: 4, metronome: 24, thirtyseconds: 8 },
      { deltaTime: 960, type: 'noteOn', channel: 0, noteNumber: 60, velocity: 90 },
      { deltaTime: 240, type: 'noteOn', channel: 0, noteNumber: 67, velocity: 80 },
      { deltaTime: 480, type: 'noteOff', channel: 0, noteNumber: 67, velocity: 0 },
      { deltaTime: 240, type: 'noteOff', channel: 0, noteNumber: 60, velocity: 0 },
      { deltaTime: 960, type: 'endOfTrack' },
    ]],
  });
  const lines = [10, 15, 20, 25, 30, 50, 55, 60, 65, 70].map((y) => `M5 ${y}H105`).join('');
  const page = `<svg width="110" height="80"><path class="StaffLines" d="${lines}"/><path class="BarLine" d="M5 10v60M55 10v60M105 10v60"/><path class="Note" d="M35 20c1 0 2 1 3 2M40 15c1 0 2 1 3 2"/></svg>`;
  const result = module.exports.reconstructMusicXml({
    source: { provider: 'musescore', url: '', scoreId: 1, revisionId: 1 },
    title: 'Voices',
    midiBase64: Buffer.from(midi).toString('base64'),
    pages: [page],
  });
  const verovioModule = await createVerovioModule();
  const toolkit = new VerovioToolkit(verovioModule);
  try {
    assert.ok(toolkit.loadData(result.musicXml));
    const generated = parseMidi(Buffer.from(toolkit.renderToMIDI(), 'base64'));
    const onsets = [];
    for (const track of generated.tracks) {
      let tick = 0;
      for (const event of track) {
        tick += event.deltaTime;
        if (event.type === 'noteOn' && event.velocity > 0) onsets.push([event.noteNumber, tick / generated.header.ticksPerBeat]);
      }
    }
    onsets.sort((left, right) => left[1] - right[1] || left[0] - right[0]);
    assert.deepEqual(onsets, [[60, 2], [67, 2.5]]);
    const voices = [...result.musicXml.matchAll(/<voice>(\d+)<\/voice>/g)].map((match) => Number(match[1]));
    assert.ok(new Set(voices).size <= 3);
  } finally {
    toolkit.destroy();
  }
});