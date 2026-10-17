import { create } from 'zustand';
import {
  downloadOfflinePack,
  getCachedSampleCount,
  getTotalSampleCount,
  removeOfflinePack,
  requestPersistentStorage,
} from '../utils/offlinePack';

interface OfflinePackState {
  total: number;
  cached: number;
  isDownloading: boolean;
  progress: number;
  failed: number;
  error: boolean;
  refresh: () => Promise<void>;
  startDownload: () => Promise<void>;
  cancelDownload: () => void;
  removePack: () => Promise<void>;
}

let controller: AbortController | null = null;
let downloading: Promise<void> | null = null;
let refreshing: Promise<void> | null = null;

export const useOfflinePackStore = create<OfflinePackState>((set, get) => ({
  total: getTotalSampleCount(),
  cached: 0,
  isDownloading: false,
  progress: 0,
  failed: 0,
  error: false,
  refresh: () => {
    if (refreshing) return refreshing;
    refreshing = getCachedSampleCount()
      .then((cached) => {
        set((state) => ({
          cached,
          error: cached === state.total ? false : state.error,
        }));
      })
      .finally(() => {
        refreshing = null;
      });
    return refreshing;
  },
  startDownload: () => {
    if (downloading) return downloading;
    const task = new AbortController();
    controller = task;
    set({ isDownloading: true, progress: 0, failed: 0, error: false });
    downloading = (async () => {
      try {
        const cached = await downloadOfflinePack((progress) => {
          if (controller === task)
            set({
              cached: progress.downloaded,
              progress: progress.downloaded / progress.total,
              failed: progress.failed,
            });
        }, task.signal);
        if (controller === task) {
          set({ error: cached < get().total });
          if (cached === get().total) await requestPersistentStorage();
        }
      } catch (error) {
        if (!task.signal.aborted && controller === task) {
          set({ error: true });
          console.warn('[OfflinePack] Download failed:', error);
        }
      } finally {
        if (controller === task) {
          controller = null;
          downloading = null;
          set({ isDownloading: false });
          await get().refresh();
        }
      }
    })();
    return downloading;
  },
  cancelDownload: () => {
    controller?.abort();
    controller = null;
    downloading = null;
    set({ isDownloading: false });
  },
  removePack: async () => {
    const previous = downloading;
    get().cancelDownload();
    await previous;
    await removeOfflinePack();
    set({ progress: 0, failed: 0, error: false });
    await get().refresh();
  },
}));
