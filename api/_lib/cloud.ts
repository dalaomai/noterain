import { sql } from '@vercel/postgres';
import { createHash } from 'node:crypto';
import { strFromU8, unzipSync } from 'fflate';

export type CloudScoreFormat = 'midi' | 'musicxml' | 'mxl' | 'noterain';

export interface CloudScoreMetadata {
  schemaVersion: 1;
  id: string;
  sha256: string;
  title: string;
  fileName: string;
  format: CloudScoreFormat;
  mimeType: string;
  byteSize: number;
  source: 'local' | 'musescore' | 'cloud';
  sourceUrl?: string;
  scoreId?: number;
  revisionId?: number;
  composer: string[];
  arranger: string[];
  duration?: number;
  uploadedAt: string;
  originalBlobPath: string;
  originalBlobUrl?: string;
  metadataBlobUrl?: string;
}

export const blobToken = () =>
  process.env.BLOB_READ_WRITE_TOKEN ?? process.env.VERCEL_READ_WRITE_TOKEN;
export const cloudConfigured = () => Boolean(blobToken());
export const cloudIndexConfigured = () =>
  Boolean(process.env.POSTGRES_URL ?? process.env.DATABASE_URL);

export function json(body: unknown, init: ResponseInit = {}) {
  return Response.json(body, {
    ...init,
    headers: { 'Cache-Control': 'no-store', ...init.headers },
  });
}

export function parseMetadata(value: string | null | undefined): CloudScoreMetadata {
  if (!value) throw new Error('MISSING_UPLOAD_METADATA');
  const metadata = JSON.parse(value) as Partial<CloudScoreMetadata>;
  if (
    metadata.schemaVersion !== 1
    || !metadata.sha256?.match(/^[a-f0-9]{64}$/)
    || !metadata.id
    || !metadata.title
    || !metadata.fileName
    || !['midi', 'musicxml', 'mxl', 'noterain'].includes(metadata.format ?? '')
    || !Number.isFinite(metadata.byteSize)
    || (metadata.byteSize ?? 0) <= 0
  ) throw new Error('INVALID_UPLOAD_METADATA');
  return metadata as CloudScoreMetadata;
  }

  export function validateSourceBytes(bytes: Uint8Array, metadata: CloudScoreMetadata) {
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (hash !== metadata.sha256) throw new Error('SOURCE_HASH_MISMATCH');
    let format: CloudScoreFormat | null = null;
    if (strFromU8(bytes.subarray(0, 4)) === 'MThd') format = 'midi';
    else if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
      const archive = unzipSync(bytes, {
        filter: (file) =>
          (file.name === 'manifest.json' || file.name === 'META-INF/container.xml')
          && file.originalSize <= 64 * 1024,
      });
      if (archive['manifest.json']) {
        const manifest = JSON.parse(strFromU8(archive['manifest.json'])) as { format?: string };
        if (manifest.format === 'noterain-svg-midi') format = 'noterain';
      }
      if (!format && archive['META-INF/container.xml']) format = 'mxl';
    } else {
      const prefix = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 4_096)));
      if (/<(?:score-partwise|score-timewise)\b/i.test(prefix)) {
        format = 'musicxml';
      }
    }
    if (format !== metadata.format) throw new Error('SOURCE_FORMAT_MISMATCH');
  }

  export async function ensureCloudScoreTable() {
    await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`;
  await sql`
    CREATE TABLE IF NOT EXISTS public_scores (
      id TEXT PRIMARY KEY,
      sha256 TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      normalized_title TEXT NOT NULL,
      file_name TEXT NOT NULL,
      format TEXT NOT NULL,
      composer TEXT NOT NULL DEFAULT '',
      arranger TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL,
      duration DOUBLE PRECISION,
      byte_size BIGINT NOT NULL,
      blob_url TEXT NOT NULL,
      metadata_url TEXT NOT NULL,
      uploaded_at TIMESTAMPTZ NOT NULL
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS public_scores_title_idx ON public_scores (normalized_title)`;
  await sql`
    CREATE INDEX IF NOT EXISTS public_scores_title_trgm_idx
    ON public_scores USING gin (normalized_title gin_trgm_ops)
  `;
}

export async function indexCloudScore(metadata: CloudScoreMetadata) {
  if (!cloudIndexConfigured() || !metadata.originalBlobUrl || !metadata.metadataBlobUrl) return;
  await ensureCloudScoreTable();
  await sql`
    INSERT INTO public_scores (
      id, sha256, title, normalized_title, file_name, format, composer, arranger,
      source, duration, byte_size, blob_url, metadata_url, uploaded_at
    ) VALUES (
      ${metadata.id}, ${metadata.sha256}, ${metadata.title},
      ${metadata.title.toLocaleLowerCase()}, ${metadata.fileName}, ${metadata.format},
      ${metadata.composer.join('\n')}, ${metadata.arranger.join('\n')}, ${metadata.source},
      ${metadata.duration ?? null}, ${metadata.byteSize}, ${metadata.originalBlobUrl},
      ${metadata.metadataBlobUrl}, ${metadata.uploadedAt}
    )
    ON CONFLICT (id) DO UPDATE SET
      title = EXCLUDED.title,
      normalized_title = EXCLUDED.normalized_title,
      file_name = EXCLUDED.file_name,
      format = EXCLUDED.format,
      composer = EXCLUDED.composer,
      arranger = EXCLUDED.arranger,
      source = EXCLUDED.source,
      duration = EXCLUDED.duration,
      byte_size = EXCLUDED.byte_size,
      blob_url = EXCLUDED.blob_url,
      metadata_url = EXCLUDED.metadata_url,
      uploaded_at = EXCLUDED.uploaded_at
  `;
}