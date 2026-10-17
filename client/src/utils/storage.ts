import type { MidiFile } from '../types/midi';
import {
  saveRawMidiData as idbSaveRawMidiData,
  loadRawMidiData as idbLoadRawMidiData,
  removeRawMidiData as idbRemoveRawMidiData,
  migrateLegacyRawMidiData,
} from './midiDb';

export {
  idbSaveRawMidiData as saveRawMidiData,
  idbLoadRawMidiData as loadRawMidiData,
  idbRemoveRawMidiData as removeRawMidiData,
  migrateLegacyRawMidiData,
};

/** Generate unique ID */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/** Export MIDI file as downloadable .mid file */
export async function downloadMidiFile(file: MidiFile): Promise<void> {
  const rawData = await idbLoadRawMidiData(file.id);
  if (!rawData) {
    console.error('No raw data available for export');
    return;
  }

  const blob = new Blob([rawData], { type: 'audio/midi' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name.endsWith('.mid') ? file.name : `${file.name}.mid`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Get storage usage info (localStorage settings only; raw MIDI now in IndexedDB) */
export function getStorageInfo(): { used: number; available: number } {
  let used = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key) {
      const value = localStorage.getItem(key);
      if (value) {
        used += key.length + value.length;
      }
    }
  }
  // localStorage typically has 5-10MB limit
  const available = 5 * 1024 * 1024 - used;
  return { used, available };
}
