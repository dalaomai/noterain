import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const source = buildSync({
  entryPoints: [fileURLToPath(new URL('../src/features/score-link-import/core/scorePackage.ts', import.meta.url))],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
}).outputFiles[0].text;
const bundled = { exports: {} };
new Function('module', 'exports', 'require', source)(bundled, bundled.exports, createRequire(import.meta.url));
const { createScorePackage, parseScorePackage } = bundled.exports;

test('SVG MIDI score package round-trips for offline history', async () => {
  const original = {
    source: { provider: 'musescore', url: 'https://musescore.com/user/1/scores/2', scoreId: 2, revisionId: 3 },
    title: 'Offline score',
    metadata: { subtitle: 'Sub', composer: 'Composer', arranger: 'Arranger' },
    midiBase64: Buffer.from([0x4d, 0x54, 0x68, 0x64]).toString('base64'),
    pages: ['<svg width="1" height="1"/>', '<svg width="2" height="2"/>'],
  };
  const file = createScorePackage(original);
  const restored = await parseScorePackage(file);

  assert.match(file.name, /\.noterain$/);
  assert.equal(file.type, 'application/vnd.noterain.svg-midi+zip');
  assert.deepEqual(restored, original);
});