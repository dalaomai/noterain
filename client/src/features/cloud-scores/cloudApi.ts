import { upload } from '@vercel/blob/client';
import { strFromU8, unzipSync } from 'fflate';
import type { MidiFile } from '../../types/midi';
import type {
  CloudCapabilities,
  CloudScoreFormat,
  CloudScoreMetadata,
  CloudScoreSummary,
} from './cloudTypes';

const apiBase = (import.meta.env.VITE_CLOUD_API_URL || '').replace(/\/$/, '');
let capabilitiesCache: { value: CloudCapabilities; expiresAt: number } | null = null;

export async function getCloudCapabilities(force = false): Promise<CloudCapabilities> {
  if (!force && capabilitiesCache && capabilitiesCache.expiresAt > Date.now()) {
    return capabilitiesCache.value;
  }
  const unavailable = { available: false, upload: false, search: false, maxFileSize: 0 };
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 1_500);
  try {
    const response = await fetch(`${apiBase}/api/cloud/capabilities`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return unavailable;
    const value = await response.json() as CloudCapabilities;
    capabilitiesCache = { value, expiresAt: Date.now() + 5 * 60_000 };
    return value;
  } catch {
    return unavailable;
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function detectScoreFormat(file: File): Promise<CloudScoreFormat | null> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (strFromU8(bytes.subarray(0, 4)) === 'MThd') return 'midi';
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    try {
      const archive = unzipSync(bytes, {
        filter: (entry) =>
          (entry.name === 'manifest.json' || entry.name === 'META-INF/container.xml')
          && entry.originalSize <= 64 * 1024,
      });
      if (archive['manifest.json']) {
        const manifest = JSON.parse(strFromU8(archive['manifest.json'])) as { format?: string };
        if (manifest.format === 'noterain-svg-midi') return 'noterain';
      }
      if (archive['META-INF/container.xml']) return 'mxl';
    } catch {
      return null;
    }
  }
  const prefix = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 4_096)));
  if (/<(?:score-partwise|score-timewise)\b/i.test(prefix)) {
    return 'musicxml';
  }
  return null;
}

async function sha256(file: File) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

const extension = (format: CloudScoreFormat) => ({
  midi: 'mid',
  musicxml: 'musicxml',
  mxl: 'mxl',
  noterain: 'noterain',
})[format];

const contentType = (format: CloudScoreFormat) => ({
  midi: 'audio/midi',
  musicxml: 'application/vnd.recordare.musicxml+xml',
  mxl: 'application/vnd.recordare.musicxml',
  noterain: 'application/vnd.noterain.svg-midi+zip',
})[format];

function splitContributors(value: unknown) {
  return typeof value === 'string'
    ? value.split(/[;,，、]/).map((part) => part.trim()).filter(Boolean)
    : [];
}

async function readEmbeddedMetadata(file: File, format: CloudScoreFormat) {
  const result: Pick<CloudScoreMetadata,
    'composer' | 'arranger' | 'sourceUrl' | 'scoreId' | 'revisionId'> & { title?: string } = {
    composer: [],
    arranger: [],
  };
  if (format === 'noterain') {
    const archive = unzipSync(new Uint8Array(await file.arrayBuffer()), {
      filter: (entry) => entry.name === 'manifest.json' && entry.originalSize <= 64 * 1024,
    });
    const manifest = JSON.parse(strFromU8(archive['manifest.json'])) as {
      title?: string;
      source?: { url?: string; scoreId?: number; revisionId?: number };
      metadata?: { composer?: string; arranger?: string };
    };
    result.title = manifest.title;
    result.sourceUrl = manifest.source?.url;
    result.scoreId = manifest.source?.scoreId;
    result.revisionId = manifest.source?.revisionId;
    result.composer = splitContributors(manifest.metadata?.composer);
    result.arranger = splitContributors(manifest.metadata?.arranger);
  } else if (format === 'musicxml') {
    const xml = await file.text();
    const document = new DOMParser().parseFromString(xml, 'application/xml');
    result.title = document.querySelector('work-title, movement-title')?.textContent?.trim();
    result.composer = Array.from(document.querySelectorAll('creator[type="composer"]'),
      (element) => element.textContent?.trim() ?? '').filter(Boolean);
    result.arranger = Array.from(document.querySelectorAll('creator[type="arranger"]'),
      (element) => element.textContent?.trim() ?? '').filter(Boolean);
  }
  return result;
}

export async function uploadScoreSilently(file: File, score: MidiFile) {
  try {
    const capabilities = await getCloudCapabilities();
    const format = await detectScoreFormat(file);
    if (!capabilities.upload || !format || file.size > capabilities.maxFileSize) return false;
    const hash = await sha256(file);
    const embedded = await readEmbeddedMetadata(file, format);
    const metadata: CloudScoreMetadata = {
      schemaVersion: 1,
      id: hash,
      sha256: hash,
      title: embedded.title || score.title || file.name.replace(/\.[^.]+$/, ''),
      fileName: file.name,
      format,
      mimeType: contentType(format),
      byteSize: file.size,
      source: score.sourceFormat === 'svg-midi' ? 'musescore' : 'local',
      sourceUrl: embedded.sourceUrl,
      scoreId: embedded.scoreId,
      revisionId: embedded.revisionId,
      composer: embedded.composer,
      arranger: embedded.arranger,
      duration: score.duration,
      uploadedAt: new Date().toISOString(),
      originalBlobPath: `scores/${hash}/source.${extension(format)}`,
    };
    const temporaryPath = `uploads/${hash}/${crypto.randomUUID()}/source.${extension(format)}`;
    await upload(temporaryPath, file, {
      access: 'private',
      handleUploadUrl: `${apiBase}/api/cloud/upload`,
      clientPayload: JSON.stringify(metadata),
      contentType: 'application/octet-stream',
      multipart: file.size > 5 * 1024 * 1024,
    });
    const statusParams = new URLSearchParams({ id: hash, format });
    for (let attempt = 0; attempt < 6; attempt++) {
      const response = await fetch(`${apiBase}/api/cloud/status?${statusParams}`);
      if (response.ok && (await response.json() as { complete?: boolean }).complete) {
        return true;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 500 * (attempt + 1)));
    }
    return false;
  } catch (error) {
    console.warn('[CloudScores] Silent upload deferred:', error);
    return false;
  }
}

export async function searchCloudScores(
  query: string,
  format: CloudScoreFormat | '',
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({ q: query, limit: '30' });
  if (format) params.set('format', format);
  const response = await fetch(`${apiBase}/api/cloud/scores?${params}`, { signal });
  if (!response.ok) throw new Error('CLOUD_SEARCH_FAILED');
  return (await response.json() as { items: CloudScoreSummary[] }).items;
}

export async function downloadCloudScore(score: CloudScoreSummary) {
  const response = await fetch(`${apiBase}/api/cloud/scores/${encodeURIComponent(score.id)}/download`);
  if (!response.ok) throw new Error('CLOUD_DOWNLOAD_FAILED');
  return new File([await response.blob()], score.fileName);
}