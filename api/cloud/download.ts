import { get } from '@vercel/blob';
import { sql } from '@vercel/postgres';
import {
  blobToken,
  cloudIndexConfigured,
  ensureCloudScoreTable,
  json,
} from '../_lib/cloud.js';

export async function GET(request: Request) {
  if (!cloudIndexConfigured()) return json({ error: 'CLOUD_SEARCH_UNAVAILABLE' }, { status: 503 });
  const id = new URL(request.url).searchParams.get('id') ?? '';
  if (!id.match(/^[a-f0-9]{64}$/)) return json({ error: 'INVALID_ID' }, { status: 400 });
  try {
    await ensureCloudScoreTable();
    const result = await sql`SELECT blob_url FROM public_scores WHERE id = ${id} LIMIT 1`;
    const pathname = result.rows[0]?.blob_url as string | undefined;
    if (!pathname) return json({ error: 'NOT_FOUND' }, { status: 404 });
    const resultBlob = await get(pathname, {
      access: 'private',
      token: blobToken(),
      useCache: false,
    });
    if (!resultBlob?.stream || !resultBlob.blob.size) {
      return json({ error: 'SOURCE_INCOMPLETE' }, { status: 409 });
    }
    return new Response(resultBlob.stream, {
      headers: {
        'Content-Type': resultBlob.blob.contentType ?? 'application/octet-stream',
        'Content-Length': String(resultBlob.blob.size ?? ''),
        'Content-Disposition': 'attachment',
        'Cache-Control': 'public, max-age=300',
      },
    });
  } catch (error) {
    console.error('[CloudScores] Download lookup failed:', error);
    return json({ error: 'DOWNLOAD_FAILED' }, { status: 503 });
  }
}