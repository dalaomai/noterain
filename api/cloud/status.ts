import { get } from '@vercel/blob';
import { blobToken, cloudConfigured, json } from '../_lib/cloud.js';

const extensions = new Map([
  ['midi', 'mid'],
  ['musicxml', 'musicxml'],
  ['mxl', 'mxl'],
  ['noterain', 'noterain'],
]);

export async function GET(request: Request) {
  if (!cloudConfigured()) return json({ complete: false }, { status: 503 });
  const url = new URL(request.url);
  const id = url.searchParams.get('id') ?? '';
  const extension = extensions.get(url.searchParams.get('format') ?? '');
  if (!id.match(/^[a-f0-9]{64}$/) || !extension) {
    return json({ complete: false, error: 'INVALID_REQUEST' }, { status: 400 });
  }
  try {
    const [source, metadata] = await Promise.all([
      get(`scores/${id}/source.${extension}`, {
        access: 'private',
        token: blobToken(),
        useCache: false,
      }),
      get(`scores/${id}/metadata.json`, {
        access: 'private',
        token: blobToken(),
        useCache: false,
      }),
    ]);
    const complete = Boolean(source?.blob.size && metadata?.blob.size);
    return json({ complete }, { status: complete ? 200 : 202 });
  } catch {
    return json({ complete: false }, { status: 202 });
  }
}