import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';

test('Playwright import bridge is explicitly gated and reuses the production loader', async () => {
  const bridge = await readFile(new URL('../src/features/e2e/importBridge.ts', import.meta.url), 'utf8');
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');

  assert.match(bridge, /e2e-import/);
  assert.match(bridge, /host\.endsWith\('\.vercel\.app'\)/);
  assert.match(bridge, /await loadFile\(file\)/);
  assert.match(bridge, /delete window\.__NOTERAIN_E2E_IMPORT__/);
  assert.match(app, /installE2EImportBridge\(loadFile\)/);
});