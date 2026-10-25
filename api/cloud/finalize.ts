import { del, get, put, rename } from '@vercel/blob';
import {
  blobToken,
  cloudConfigured,
  indexCloudScore,
  json,
  parseMetadata,
  validateSourceBytes,
} from '../_lib/cloud.js';

export async function POST(request: Request) {
  if (!cloudConfigured()) return json({ error: 'CLOUD_UNAVAILABLE' }, { status: 503 });
  let pathname = '';
  try {
    const body = await request.json() as { pathname?: string; metadata?: unknown };
    pathname = body.pathname ?? '';
    const metadata = parseMetadata(JSON.stringify(body.metadata));
    if (!pathname.startsWith(`uploads/${metadata.sha256}/`) || !pathname.includes('/source.')) {
      throw new Error('INVALID_TEMPORARY_PATH');
    }
    const source = await get(pathname, {
      access: 'private',
      token: blobToken(),
      useCache: false,
    });
    if (!source?.stream) throw new Error('UPLOADED_SOURCE_MISSING');
    const sourceBytes = new Uint8Array(await new Response(source.stream).arrayBuffer());
    if (sourceBytes.byteLength !== metadata.byteSize) {
      throw new Error('UPLOADED_SOURCE_INCOMPLETE');
    }
    validateSourceBytes(sourceBytes, metadata);
    const pathParts = pathname.split('/');
    const uploadId = pathParts[2];
    const sourceName = pathParts.at(-1);
    if (!uploadId || !sourceName) throw new Error('INVALID_TEMPORARY_PATH');
    const published = await rename(
      pathname,
      `scores/${metadata.sha256}/versions/${uploadId}/${sourceName}`,
      {
        access: 'private',
        addRandomSuffix: false,
        token: blobToken(),
        contentType: 'application/octet-stream',
      },
    );
    const completed = {
      ...metadata,
      originalBlobPath: published.pathname,
      originalBlobUrl: published.pathname,
      metadataBlobUrl: `scores/${metadata.sha256}/versions/${uploadId}/metadata.json`,
    };
    await put(completed.metadataBlobUrl, JSON.stringify(completed), {
      access: 'private',
      contentType: 'application/json; charset=utf-8',
      addRandomSuffix: false,
      token: blobToken(),
    });
    try {
      await indexCloudScore(completed);
    } catch (error) {
      console.error('[CloudScores] Indexing failed; Blob remains recoverable:', error);
    }
    return json({ complete: true, id: metadata.id });
  } catch (error) {
    console.error('[CloudScores] Finalization failed:', error);
    if (pathname) await del(pathname, { token: blobToken() }).catch(() => undefined);
    return json({
      error: error instanceof Error ? error.message : 'FINALIZE_FAILED',
    }, { status: 400 });
  }
}