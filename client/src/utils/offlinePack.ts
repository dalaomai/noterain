/**
 * Offline audio pack: proactively pre-caches all piano samples
 * into the same Cache Storage entry the service worker uses
 * (piano-samples-local-v{version}), so cached samples work offline
 * for both the app and the SW runtime caching.
 */

import { version } from '../../../package.json';

export const SAMPLES_CACHE_NAME = `piano-samples-local-v${version}`;

/** Velocity layers (1=softest, 16=loudest) */
export const VELOCITY_LAYERS = Array.from({ length: 16 }, (_, i) => i + 1);

/** Sample notes available in Salamander (every minor third) */
export const SAMPLE_NOTES = [
  'A0', 'C1', 'Ds1', 'Fs1', 'A1', 'C2', 'Ds2', 'Fs2', 'A2', 'C3',
  'Ds3', 'Fs3', 'A3', 'C4', 'Ds4', 'Fs4', 'A4', 'C5', 'Ds5', 'Fs5',
  'A5', 'C6', 'Ds6', 'Fs6', 'A6', 'C7', 'Ds7', 'Fs7', 'A7', 'C8',
];

/** Build the full list of sample URLs */
export function getAllSampleUrls(): string[] {
  const urls: string[] = [];
  for (const layer of VELOCITY_LAYERS) {
    for (const note of SAMPLE_NOTES) {
      urls.push(`/samples/piano/v${layer}/${note}v${layer}.mp3`);
    }
  }
  return urls;
}

export interface OfflinePackProgress {
  downloaded: number;
  total: number;
  failed: number;
}

export interface OfflinePackStatus {
  /** Whether a download is currently running */
  isDownloading: boolean;
  progress: OfflinePackProgress;
}

/** Count how many sample URLs are already cached */
export async function getCachedSampleCount(): Promise<number> {
  try {
    if (!('caches' in window)) return 0;
    const cache = await caches.open(SAMPLES_CACHE_NAME);
    const keys = await cache.keys();
    return keys.filter((req) => req.url.includes('/samples/')).length;
  } catch {
    return 0;
  }
}

/** Total number of samples in the full pack */
export function getTotalSampleCount(): number {
  return VELOCITY_LAYERS.length * SAMPLE_NOTES.length;
}

/**
 * Download the full offline sample pack with progress reporting.
 * Returns the number of successfully cached samples.
 */
export async function downloadOfflinePack(
  onProgress?: (progress: OfflinePackProgress) => void,
  signal?: AbortSignal,
): Promise<number> {
  const urls = getAllSampleUrls();
  const total = urls.length;
  let downloaded = 0;
  let failed = 0;

  const cache = await caches.open(SAMPLES_CACHE_NAME);

  // Concurrency pool: keep ~6 parallel downloads
  const CONCURRENCY = 6;
  let index = 0;

  async function worker(): Promise<void> {
    while (index < urls.length) {
      if (signal?.aborted) return;
      const url = urls[index++];
      try {
        // Skip if already cached
        const cached = await cache.match(url);
        if (!cached) {
          const response = await fetch(url, { signal });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          await cache.put(url, response);
        }
        downloaded++;
      } catch (error) {
        if ((error as Error).name === 'AbortError') return;
        failed++;
        console.warn(`[OfflinePack] Failed to cache ${url}:`, error);
      }
      onProgress?.({ downloaded, failed, total });
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, urls.length) }, () => worker()),
  );

  return downloaded;
}

/** Remove the offline sample pack (frees ~85MB) */
export async function removeOfflinePack(): Promise<void> {
  try {
    await caches.delete(SAMPLES_CACHE_NAME);
  } catch (error) {
    console.warn('[OfflinePack] Failed to remove cache:', error);
  }
}

/** Request persistent storage so the browser won't evict the pack */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) {
      return await navigator.storage.persist();
    }
  } catch (error) {
    console.warn('[OfflinePack] persist() failed:', error);
  }
  return false;
}
