import test from 'node:test';
import assert from 'node:assert/strict';
import {
  completeImportSession,
  createImportSession,
  failImportSession,
  getImportSession,
  updateImportProgress,
} from '../src/sessions.js';
import { readFileSync } from 'node:fs';

const scoreUrl = 'https://musescore.com/user/16006641/scores/4197961';

test('companion metadata and runtime probe versions stay aligned', () => {
  const script = readFileSync(new URL('../../client/public/score-link-companion.user.js', import.meta.url), 'utf8');
  const metadataVersion = script.match(/@version\s+(\d+\.\d+\.\d+)/)?.[1];
  const runtimeVersion = script.match(/COMPANION_VERSION = '(\d+\.\d+\.\d+)'/)?.[1];
  assert.equal(runtimeVersion, metadataVersion);
  assert.equal(runtimeVersion, '0.5.3');
  assert.match(script, /noterain-import-progress/);
  assert.match(script, /updateProgressView\('complete'/);
  assert.match(script, /updateProgressView\('failed'/);
  assert.match(script, /details\.pageCount/);
  assert.match(script, /GM_setValue\(REQUEST_KEY/);
  assert.match(script, /GM_addValueChangeListener\(responseKey/);
  assert.match(script, /noterain-score-bridge-request/);
  assert.doesNotMatch(script, /\$\{/);
  assert.doesNotMatch(script, /\?\./);
  assert.doesNotMatch(script, /=>/);
  const matches = [...script.matchAll(/^\/\/ @match\s+(.+)$/gm)].map((match) => match[1]);
  assert.deepEqual(matches, [
    'https://noterain.app/*',
    'https://*.noterain.app/*',
    'https://localhost/*',
    'http://localhost/*',
    'https://127.0.0.1/*',
    'http://127.0.0.1/*',
    'https://musescore.com/*',
    'https://www.musescore.com/*',
    'https://s.musescore.com/*',
  ]);
  assert.doesNotMatch(script, /NOTERAIN_APP_MATCH/);
});

test('creates a launch URL and completes an import session', () => {
  const session = createImportSession(scoreUrl, 'https://noterain.example/api/score-link');
  assert.match(session.launchUrl, /^https:\/\/musescore\.com\/user\/16006641\/scores\/4197961#noterain-import=/);
  assert.match(decodeURIComponent(new URL(session.launchUrl).hash), /bridge\/\{action\}\?token=/);
  const waiting = getImportSession(session.id, session.token);
  assert.equal(waiting.status, 'waiting');
  assert.equal(waiting.result, null);
  assert.equal(waiting.error, null);
  assert.equal(waiting.progress.stage, 'session-created');
  const result = {
    source: { provider: 'musescore', url: scoreUrl, scoreId: 4197961, revisionId: 1 },
    title: 'Test',
    midiBase64: 'TVRoZA==',
    pages: ['<svg><script>alert(1)</script><image href="https://example.com/x"/></svg>'],
  };
  completeImportSession(session.id, session.token, result);
  const completed = getImportSession(session.id, session.token).result;
  assert.equal(completed.title, result.title);
  assert.equal(completed.pages[0], '<svg><image/></svg>');
  assert.match(result.pages[0], /<script>/);
});

test('rejects wrong tokens and mismatched score IDs', () => {
  const session = createImportSession(scoreUrl, 'https://noterain.example/api/score-link');
  assert.throws(() => getImportSession(session.id, 'wrong'), /IMPORT_SESSION_NOT_FOUND/);
  assert.throws(
    () => completeImportSession(session.id, session.token, { source: { scoreId: 1 } }),
    /SCORE_ID_MISMATCH/,
  );
});

test('records companion failures', () => {
  const session = createImportSession(scoreUrl, 'https://noterain.example/api/score-link');
  failImportSession(session.id, session.token, 'MIDI_AUTH_UNAVAILABLE');
  const failed = getImportSession(session.id, session.token);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.result, null);
  assert.equal(failed.error, 'MIDI_AUTH_UNAVAILABLE');
  assert.equal(failed.progress.stage, 'failed');
});

test('records only allowlisted progress stages and scalar details', () => {
  const session = createImportSession(scoreUrl, 'https://noterain.example/api/score-link');
  const progress = updateImportProgress(session.id, session.token, 'svg-page-ready', {
    page: 2,
    pageCount: 7,
    nested: { secret: true },
  });
  assert.deepEqual(progress.details, { page: 2, pageCount: 7 });
  assert.throws(
    () => updateImportProgress(session.id, session.token, 'unknown-stage'),
    /INVALID_PROGRESS_STAGE/,
  );
});