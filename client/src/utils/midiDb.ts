/**
 * IndexedDB storage for raw MIDI file data.
 * Replaces the old localStorage base64 approach (5MB limit, silent failures).
 * Automatically migrates legacy localStorage entries on first access.
 */

import type { MidiFile, ScoreHistoryEntry } from '../types/midi';

const DB_NAME = 'noterain';
const DB_VERSION = 2;
const RAW_MIDI_STORE = 'rawMidi';
const SCORE_HISTORY_STORE = 'scoreHistory';
const LEGACY_PREFIX = 'piano-midi-raw-';
const MIGRATION_DONE_KEY = 'piano-midi-raw-migrated';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    let blocked = false;
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(RAW_MIDI_STORE)) {
        db.createObjectStore(RAW_MIDI_STORE);
      }
      if (!db.objectStoreNames.contains(SCORE_HISTORY_STORE)) {
        db.createObjectStore(SCORE_HISTORY_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      if (blocked) {
        db.close();
        return;
      }
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onblocked = () => {
      blocked = true;
      dbPromise = null;
      reject(new Error('Close other NoteRain tabs and retry local storage.'));
    };
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
  });
  return dbPromise;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Wait for a transaction to complete */
function transactionToPromise(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

interface StoredScoreHistory extends ScoreHistoryEntry {
  source: Blob;
  sourceLastModified: number;
}

async function readHistoryRecords(): Promise<StoredScoreHistory[]> {
  const db = await openDb();
  return requestToPromise(
    db
      .transaction(SCORE_HISTORY_STORE, 'readonly')
      .objectStore(SCORE_HISTORY_STORE)
      .getAll(),
  );
}

/** Keep source bytes as well as metadata, so history works offline after refresh. */
export async function saveScoreHistory(
  source: File,
  score: MidiFile,
): Promise<string> {
  const records = await readHistoryRecords();
  let existing: StoredScoreHistory | undefined;
  let bytes: Uint8Array | undefined;
  for (const record of records) {
    if (record.fileName !== source.name || record.size !== source.size)
      continue;
    const imported = bytes ??= new Uint8Array(await source.arrayBuffer());
    const stored = new Uint8Array(await record.source.arrayBuffer());
    if (
      stored.length === imported.length &&
      stored.every((value, index) => value === imported[index])
    ) {
      existing = record;
      break;
    }
  }
  const id =
    existing?.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const entry: StoredScoreHistory = {
    id,
    fileName: source.name,
    title: score.title,
    sourceFormat: score.sourceFormat ?? 'midi',
    size: source.size,
    duration: score.duration,
    lastImportedAt: Date.now(),
    source,
    sourceLastModified: source.lastModified,
  };
  const db = await openDb();
  const tx = db.transaction(SCORE_HISTORY_STORE, 'readwrite');
  tx.objectStore(SCORE_HISTORY_STORE).put(entry);
  await transactionToPromise(tx);
  return id;
}

export async function listScoreHistory(): Promise<ScoreHistoryEntry[]> {
  return (await readHistoryRecords())
    .map((entry) => ({
      id: entry.id,
      fileName: entry.fileName,
      title: entry.title,
      sourceFormat: entry.sourceFormat,
      size: entry.size,
      duration: entry.duration,
      lastImportedAt: entry.lastImportedAt,
    }))
    .sort((a, b) => b.lastImportedAt - a.lastImportedAt);
}

export async function loadScoreHistoryFile(id: string): Promise<File> {
  const db = await openDb();
  const entry: StoredScoreHistory | undefined = await requestToPromise(
    db
      .transaction(SCORE_HISTORY_STORE, 'readonly')
      .objectStore(SCORE_HISTORY_STORE)
      .get(id),
  );
  if (!entry) throw new Error('The saved score is no longer available.');
  return new File([entry.source], entry.fileName, {
    type: entry.source.type,
    lastModified: entry.sourceLastModified,
  });
}

export async function touchScoreHistory(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(SCORE_HISTORY_STORE, 'readwrite');
  const done = transactionToPromise(tx);
  const store = tx.objectStore(SCORE_HISTORY_STORE);
  const request = store.get(id);
  request.onsuccess = () => {
    const entry = request.result as StoredScoreHistory | undefined;
    if (entry) store.put({ ...entry, lastImportedAt: Date.now() });
  };
  await done;
}

export async function removeScoreHistory(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(SCORE_HISTORY_STORE, 'readwrite');
  tx.objectStore(SCORE_HISTORY_STORE).delete(id);
  await transactionToPromise(tx);
}

/** Save raw MIDI data (ArrayBuffer) */
export async function saveRawMidiData(
  fileId: string,
  data: ArrayBuffer,
): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(RAW_MIDI_STORE, 'readwrite');
    tx.objectStore(RAW_MIDI_STORE).put(data, fileId);
    await transactionToPromise(tx);
  } catch (error) {
    console.warn('Failed to save raw MIDI data:', error);
  }
}

/** Load raw MIDI data */
export async function loadRawMidiData(
  fileId: string,
): Promise<ArrayBuffer | null> {
  try {
    const db = await openDb();
    const tx = db.transaction(RAW_MIDI_STORE, 'readonly');
    const result = await requestToPromise(
      tx.objectStore(RAW_MIDI_STORE).get(fileId),
    );
    return (result as ArrayBuffer | undefined) ?? null;
  } catch (error) {
    console.warn('Failed to load raw MIDI data:', error);
    return null;
  }
}

/** Remove raw MIDI data */
export async function removeRawMidiData(fileId: string): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(RAW_MIDI_STORE, 'readwrite');
    tx.objectStore(RAW_MIDI_STORE).delete(fileId);
    await transactionToPromise(tx);
  } catch (error) {
    console.warn('Failed to remove raw MIDI data:', error);
  }
}

/** List all stored raw MIDI file ids */
export async function listRawMidiIds(): Promise<string[]> {
  try {
    const db = await openDb();
    const tx = db.transaction(RAW_MIDI_STORE, 'readonly');
    const keys = await requestToPromise(
      tx.objectStore(RAW_MIDI_STORE).getAllKeys(),
    );
    return keys.map(String);
  } catch (error) {
    console.warn('Failed to list raw MIDI ids:', error);
    return [];
  }
}

/** Convert base64 to ArrayBuffer (legacy format) */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * One-time migration: move legacy localStorage base64 entries into IndexedDB,
 * then remove them from localStorage to free space.
 */
export async function migrateLegacyRawMidiData(): Promise<number> {
  if (localStorage.getItem(MIGRATION_DONE_KEY)) return 0;

  let migrated = 0;
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(LEGACY_PREFIX)) keys.push(key);
  }

  for (const key of keys) {
    const base64 = localStorage.getItem(key);
    if (!base64) continue;
    const fileId = key.slice(LEGACY_PREFIX.length);
    try {
      const existing = await loadRawMidiData(fileId);
      if (!existing) {
        await saveRawMidiData(fileId, base64ToArrayBuffer(base64));
      }
      localStorage.removeItem(key);
      migrated++;
    } catch (error) {
      console.warn(`Failed to migrate ${key}:`, error);
    }
  }

  localStorage.setItem(MIGRATION_DONE_KEY, String(Date.now()));
  if (migrated > 0) {
    console.log(`[Storage] Migrated ${migrated} MIDI files to IndexedDB`);
  }
  return migrated;
}
