import { get, list } from '@vercel/blob';
import {
  blobToken,
  cloudConfigured,
  json,
  parseMetadata,
} from '../_lib/cloud.js';

export async function GET(request: Request) {
  if (!cloudConfigured()) return json({ complete: false }, { status: 503 });
  const url = new URL(request.url);
  const id = url.searchParams.get('id') ?? '';
  const format = url.searchParams.get('format') ?? '';
  if (!id.match(/^[a-f0-9]{64}$/) || !['midi', 'musicxml', 'mxl', 'noterain'].includes(format)) {
    return json({ complete: false, error: 'INVALID_REQUEST' }, { status: 400 });
  }
  try {
    const page = await list({
      prefix: `scores/${id}/versions/`,
      limit: 1_000,
      token: blobToken(),
    });
    const sidecars = page.blobs
      .filter((blob) => blob.pathname.endsWith('/metadata.json') && blob.size > 0)
      .sort((left, right) => right.uploadedAt.getTime() - left.uploadedAt.getTime());
    for (const sidecar of sidecars) {
      const metadataResult = await get(sidecar.pathname, {
        access: 'private',
        token: blobToken(),
        useCache: false,
      });
      if (!metadataResult?.stream) continue;
      const metadata = parseMetadata(await new Response(metadataResult.stream).text());
      if (metadata.format !== format) continue;
      const source = await get(metadata.originalBlobPath, {
        access: 'private',
        token: blobToken(),
        useCache: false,
      });
      if (source?.blob.size === metadata.byteSize) return json({ complete: true });
    }
    return json({ complete: false }, { status: 202 });
  } catch {
    return json({ complete: false }, { status: 202 });
  }
}