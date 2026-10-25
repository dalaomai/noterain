import { del, get, put, rename } from '@vercel/blob';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
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
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        const metadata = parseMetadata(tokenPayload);
        try {
          const source = await get(blob.pathname, {
            access: 'private',
            token: blobToken(),
            useCache: false,
          });
          if (!source?.stream || source.blob.size !== metadata.byteSize) {
            throw new Error('UPLOADED_SOURCE_INCOMPLETE');
          }
          validateSourceBytes(
            new Uint8Array(await new Response(source.stream).arrayBuffer()),
            metadata,
          );
          const pathParts = blob.pathname.split('/');
          const uploadId = pathParts[2];
          const sourceName = pathParts.at(-1);
          if (!uploadId || !sourceName) throw new Error('INVALID_TEMPORARY_PATH');
          const publishedPath = `scores/${metadata.sha256}/versions/${uploadId}/${sourceName}`;
          const published = await rename(blob.pathname, publishedPath, {
            access: 'private',
            addRandomSuffix: false,
            token: blobToken(),
            contentType: 'application/octet-stream',
          });
          const completed: typeof metadata = {
            ...metadata,
            originalBlobPath: published.pathname,
            originalBlobUrl: published.pathname,
          };
          const metadataPath = `scores/${metadata.sha256}/versions/${uploadId}/metadata.json`;
          completed.metadataBlobUrl = metadataPath;
          await put(
            metadataPath,
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
        } finally {
          await del(blob.pathname, { token: blobToken() }).catch(() => undefined);
        }
      },
    });
    return json(result);
  } catch (error) {
    console.error('[CloudScores] Upload request failed:', error);
    return json({ error: 'UPLOAD_FAILED' }, { status: 400 });
  }
}