import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePublicScoreUrl } from '../src/url-policy.js';

test('accepts a canonical public score URL', () => {
  assert.deepEqual(
    parsePublicScoreUrl('https://musescore.com/user/16006641/scores/4197961?from=home#top'),
    {
      url: 'https://musescore.com/user/16006641/scores/4197961',
      scoreId: 4197961,
    },
  );
});

test('rejects non-MuseScore and non-score URLs', () => {
  assert.throws(() => parsePublicScoreUrl('http://127.0.0.1/scores/1'));
  assert.throws(() => parsePublicScoreUrl('https://musescore.com/sheetmusic'));
  assert.throws(() => parsePublicScoreUrl('https://example.com/user/1/scores/2'));
});