import { get, list } from '@vercel/blob';
import {
  blobToken,
  cloudConfigured,
  indexCloudScore,
  json,
  parseMetadata,
} from '../../_lib/cloud.js';

export default async function handler(request: Request) {
  if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, { status: 405 });
  if (!cloudConfigured()) return json({ error: 'CLOUD_UNAVAILABLE' }, { status: 503 });
  const secret = request.headers.get('x-cloud-admin-secret');
  if (!process.env.CLOUD_ADMIN_SECRET || secret !== process.env.CLOUD_ADMIN_SECRET) {
    return json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  let cursor: string | undefined;
  let scanned = 0;
  let restored = 0;
  const errors: string[] = [];
  do {
    const page = await list({
      prefix: 'scores/',
      cursor,
      limit: 1_000,
      token: blobToken(),
    });
    for (const blob of page.blobs) {
      if (!blob.pathname.endsWith('/metadata.json')) continue;
      scanned++;
      try {
        const result = await get(blob.pathname, {
          access: 'private',
          token: blobToken(),
        });
        if (!result?.stream) throw new Error('MISSING_METADATA');
        const metadata = parseMetadata(await new Response(result.stream).text());
        await indexCloudScore(metadata);
        restored++;
      } catch (error) {
        errors.push(`${blob.pathname}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  return json({ scanned, restored, failed: errors.length, errors: errors.slice(0, 20) });
}