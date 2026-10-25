import { get, put } from '@vercel/blob';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import {
  blobToken,
  cloudConfigured,
  indexCloudScore,
  json,
  parseMetadata,
    validateSourceBytes,
} from '../_lib/cloud.js';

export default async function handler(request: Request) {
  if (!cloudConfigured()) return json({ error: 'CLOUD_UNAVAILABLE' }, { status: 503 });
  if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, { status: 405 });
  try {
    const body = await request.json() as HandleUploadBody;
    const result = await handleUpload({
      token: blobToken(),
      request,
      body,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const metadata = parseMetadata(clientPayload);
        const expectedPrefix = `scores/${metadata.sha256}/source.`;
        if (!pathname.startsWith(expectedPrefix)) throw new Error('INVALID_BLOB_PATH');
        return {
          allowedContentTypes: [metadata.mimeType || 'application/octet-stream'],
          maximumSizeInBytes: Number(process.env.CLOUD_MAX_FILE_SIZE ?? 52_428_800),
          addRandomSuffix: false,
          allowOverwrite: true,
          tokenPayload: JSON.stringify(metadata),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        const metadata = parseMetadata(tokenPayload);
          const source = await get(blob.pathname, {
            access: 'private',
            token: blobToken(),
            useCache: false,
          });
          if (!source?.stream) throw new Error('UPLOADED_SOURCE_MISSING');
          validateSourceBytes(
            new Uint8Array(await new Response(source.stream).arrayBuffer()),
            metadata,
          );
        const completed: typeof metadata = {
          ...metadata,
          originalBlobUrl: blob.pathname,
        };
        const sidecar = await put(
          `scores/${metadata.sha256}/metadata.json`,
          JSON.stringify(completed),
          {
            access: 'private',
            contentType: 'application/json; charset=utf-8',
            addRandomSuffix: false,
            allowOverwrite: true,
            token: blobToken(),
          },
        );
        completed.metadataBlobUrl = sidecar.pathname;
        await put(
          `scores/${metadata.sha256}/metadata.json`,
          JSON.stringify(completed),
          {
            access: 'private',
            contentType: 'application/json; charset=utf-8',
            addRandomSuffix: false,
            allowOverwrite: true,
            token: blobToken(),
          },
        );
        try {
          await indexCloudScore(completed);
        } catch (error) {
          console.error('[CloudScores] Indexing failed; Blob remains recoverable:', error);
        }
      },
    });
    return json(result);
  } catch (error) {
    console.error('[CloudScores] Upload request failed:', error);
    return json({ error: 'UPLOAD_FAILED' }, { status: 400 });
  }
}