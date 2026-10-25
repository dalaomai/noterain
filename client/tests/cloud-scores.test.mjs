import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';

test('cloud integration remains optional and never blocks local import', async () => {
  const api = await readFile(new URL('../src/features/cloud-scores/cloudApi.ts', import.meta.url), 'utf8');
  const queue = await readFile(new URL('../src/features/cloud-scores/cloudQueue.ts', import.meta.url), 'utf8');
  const midiFile = await readFile(new URL('../src/hooks/useMidiFile.ts', import.meta.url), 'utf8');
  const controls = await readFile(new URL('../src/components/Controls/Controls.tsx', import.meta.url), 'utf8');

  assert.match(api, /AbortController/);
  assert.match(api, /return unavailable/);
  assert.match(api, /catch \(error\)[\s\S]*return false/);
  assert.match(api, /contentType: 'application\/octet-stream'/);
  assert.match(api, /application\/vnd\.recordare\.musicxml/);
  assert.match(queue, /RETRY_DELAYS/);
  assert.match(queue, /window\.addEventListener\('online'/);
  assert.match(midiFile, /void processCloudUploadQueue|enqueueCloudUpload/);
  assert.match(controls, /cloudSearchAvailable &&/);
});

test('cloud file classification inspects content for every supported format', async () => {
  const api = await readFile(new URL('../src/features/cloud-scores/cloudApi.ts', import.meta.url), 'utf8');
  const server = await readFile(new URL('../../api/_lib/cloud.ts', import.meta.url), 'utf8');

  for (const source of [api, server]) {
    assert.match(source, /MThd/);
    assert.match(source, /noterain-svg-midi/);
    assert.match(source, /META-INF\/container\.xml/);
    assert.match(source, /score-partwise\|score-timewise/);
    assert.match(source, /originalSize <= 64 \* 1024/);
  }
});

test('server stores recoverable sidecar metadata and supports private Blob stores', async () => {
  const upload = await readFile(new URL('../../api/cloud/upload.ts', import.meta.url), 'utf8');
  const download = await readFile(new URL('../../api/cloud/download.ts', import.meta.url), 'utf8');
  const rebuild = await readFile(new URL('../../api/cloud/admin/rebuild-index.ts', import.meta.url), 'utf8');
  const status = await readFile(new URL('../../api/cloud/status.ts', import.meta.url), 'utf8');

  assert.match(upload, /metadata\.json/);
  assert.match(upload, /access: 'private'/);
  assert.match(upload, /validateSourceBytes/);
  assert.match(upload, /uploads\/\$\{metadata\.sha256\}/);
  assert.match(upload, /rename\(blob\.pathname, metadata\.originalBlobPath/);
  assert.match(upload, /del\(blob\.pathname/);
  assert.match(download, /get\(pathname/);
  assert.match(download, /SOURCE_INCOMPLETE/);
  assert.match(status, /source\.\$\{extension\}/);
  assert.match(status, /Boolean\(source\?\.blob\.size && metadata\?\.blob\.size\)/);
  assert.match(rebuild, /endsWith\('\/metadata\.json'\)/);
  assert.match(rebuild, /SOURCE_INCOMPLETE/);
  assert.match(rebuild, /x-cloud-admin-secret/);
});