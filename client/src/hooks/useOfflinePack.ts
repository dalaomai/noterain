import { useCallback, useEffect, useRef, useState } from 'react';
import {
  downloadOfflinePack,
  getCachedSampleCount,
  getTotalSampleCount,
  removeOfflinePack,
  requestPersistentStorage,
  type OfflinePackProgress,
} from '../utils/offlinePack';

export interface OfflinePackHook {
  /** Total samples in the full pack */
  total: number;
  /** Currently cached samples */
  cached: number;
  /** Whether the full pack is downloaded */
  isComplete: boolean;
  /** Whether a download is in progress */
  isDownloading: boolean;
  /** Download progress (0-1) */
  progress: number;
  /** Number of failed downloads in current run */
  failed: number;
  /** Start downloading the full pack */
  startDownload: () => void;
  /** Cancel ongoing download */
  cancelDownload: () => void;
  /** Remove the cached pack */
  removePack: () => void;
}

/** Hook managing the offline piano sample pack */
export function useOfflinePack(): OfflinePackHook {
  const total = getTotalSampleCount();
  const [cached, setCached] = useState(0);
  const [isDownloading, setIsDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [failed, setFailed] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  // Refresh cached count on mount and when download finishes
  const refreshCached = useCallback(async () => {
    const count = await getCachedSampleCount();
    setCached(count);
  }, []);

  useEffect(() => {
    void refreshCached();
  }, [refreshCached]);

  const startDownload = useCallback(() => {
    if (abortRef.current) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setIsDownloading(true);
    setProgress(0);
    setFailed(0);

    const onProgress = (p: OfflinePackProgress) => {
      setProgress(p.downloaded / p.total);
      setFailed(p.failed);
    };

    downloadOfflinePack(onProgress, controller.signal)
      .then(async () => {
        if (!controller.signal.aborted) {
          await requestPersistentStorage();
        }
      })
      .catch((error) => {
        console.warn('[OfflinePack] Download failed:', error);
      })
      .finally(async () => {
        abortRef.current = null;
        setIsDownloading(false);
        await refreshCached();
      });
  }, [refreshCached]);

  const cancelDownload = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsDownloading(false);
  }, []);

  const removePack = useCallback(async () => {
    abortRef.current?.abort();
    abortRef.current = null;
    await removeOfflinePack();
    await refreshCached();
  }, [refreshCached]);

  return {
    total,
    cached,
    isComplete: cached >= total,
    isDownloading,
    progress,
    failed,
    startDownload,
    cancelDownload,
    removePack,
  };
}
