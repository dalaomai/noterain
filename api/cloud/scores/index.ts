import { sql } from '@vercel/postgres';
import {
  cloudIndexConfigured,
  ensureCloudScoreTable,
  json,
} from '../../_lib/cloud.js';

export default async function handler(request: Request) {
  if (!cloudIndexConfigured()) return json({ error: 'CLOUD_SEARCH_UNAVAILABLE' }, { status: 503 });
  if (request.method !== 'GET') return json({ error: 'METHOD_NOT_ALLOWED' }, { status: 405 });
  try {
    await ensureCloudScoreTable();
    const url = new URL(request.url);
    const query = url.searchParams.get('q')?.trim().toLocaleLowerCase() ?? '';
    const format = url.searchParams.get('format')?.trim() ?? '';
    const limit = Math.max(1, Math.min(50, Number(url.searchParams.get('limit') ?? 30)));
    const pattern = `%${query}%`;
    const result = await sql`
      SELECT id, title, file_name AS "fileName", format,
        string_to_array(composer, E'\n') AS composer,
        string_to_array(arranger, E'\n') AS arranger,
        source, duration, byte_size AS "byteSize", uploaded_at AS "uploadedAt"
      FROM public_scores
      WHERE (${query} = '' OR normalized_title ILIKE ${pattern}
        OR LOWER(file_name) ILIKE ${pattern}
        OR composer ILIKE ${pattern}
        OR arranger ILIKE ${pattern})
        AND (${format} = '' OR format = ${format})
      ORDER BY
        CASE WHEN normalized_title = ${query} THEN 0
             WHEN normalized_title LIKE ${query + '%'} THEN 1
             ELSE 2 END,
        similarity(normalized_title, ${query}) DESC,
        uploaded_at DESC
      LIMIT ${limit}
    `;
    return json({ items: result.rows });
  } catch (error) {
    console.error('[CloudScores] Search failed:', error);
    return json({ error: 'CLOUD_SEARCH_FAILED' }, { status: 503 });
  }
}