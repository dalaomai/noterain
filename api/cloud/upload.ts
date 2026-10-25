import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import {
  blobToken,
  cloudConfigured,
  json,
  parseMetadata,
} from '../_lib/cloud.js';

export async function POST(request: Request) {
  if (!cloudConfigured()) return json({ error: 'CLOUD_UNAVAILABLE' }, { status: 503 });
  try {
    const body = await request.json() as HandleUploadBody;
    const result = await handleUpload({
      token: blobToken(),
      request,
      body,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const metadata = parseMetadata(clientPayload);
        const expectedPrefix = `uploads/${metadata.sha256}/`;
        if (!pathname.startsWith(expectedPrefix) || !pathname.includes('/source.')) {
          throw new Error('INVALID_BLOB_PATH');
        }
        return {
          allowedContentTypes: ['application/octet-stream'],
          maximumSizeInBytes: Number(process.env.CLOUD_MAX_FILE_SIZE ?? 52_428_800),
          addRandomSuffix: false,
          allowOverwrite: true,
          tokenPayload: JSON.stringify(metadata),
        };
      },
    });
    return json(result);
  } catch (error) {
    console.error('[CloudScores] Upload request failed:', error);
    return json({ error: 'UPLOAD_FAILED' }, { status: 400 });
  }
}