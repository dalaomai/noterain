import { create } from 'zustand';
import type { MidiFile, ScoreHistoryEntry } from '../types/midi';
import {
  listScoreHistory,
  removeScoreHistory,
  saveScoreHistory,
  touchScoreHistory,
} from '../utils/midiDb';

interface ScoreHistoryState {
  entries: ScoreHistoryEntry[];
  isLoading: boolean;
  error: 'load' | 'save' | 'remove' | null;
  refresh: () => Promise<void>;
  recordImport: (source: File, score: MidiFile) => Promise<string | undefined>;
  remove: (id: string) => Promise<void>;
  touch: (id: string) => Promise<void>;
}

export const useScoreHistoryStore = create<ScoreHistoryState>((set, get) => {
  let revision = 0;
  return {
    entries: [],
    isLoading: false,
    error: null,
    refresh: async () => {
      const request = ++revision;
      set({ isLoading: true, error: get().error === 'save' ? 'save' : null });
      try {
        const entries = await listScoreHistory();
        if (request === revision) set({ entries, isLoading: false });
      } catch (error) {
        console.warn('[ScoreHistory] Cannot read history:', error);
        if (request === revision) set({ error: 'load', isLoading: false });
      }
    },
    recordImport: async (source, score) => {
      try {
        const id = await saveScoreHistory(source, score);
        set({ error: null });
        await get().refresh();
        return id;
      } catch (error) {
        console.warn('[ScoreHistory] Cannot save history:', error);
        set({ error: 'save' });
        return undefined;
      }
    },
    remove: async (id) => {
      try {
        await removeScoreHistory(id);
        await get().refresh();
      } catch (error) {
        console.warn('[ScoreHistory] Cannot remove history:', error);
        set({ error: 'remove' });
      }
    },
    touch: async (id) => {
      try {
        await touchScoreHistory(id);
        await get().refresh();
      } catch (error) {
        console.warn('[ScoreHistory] Cannot update history:', error);
        set({ error: 'save' });
      }
    },
  };
});
