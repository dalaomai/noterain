/**
 * IndexedDB storage for raw MIDI file data.
 * Replaces the old localStorage base64 approach (5MB limit, silent failures).
 * Automatically migrates legacy localStorage entries on first access.
 */

const DB_NAME = 'noterain';
const DB_VERSION = 1;
const RAW_MIDI_STORE = 'rawMidi';
const LEGACY_PREFIX = 'piano-midi-raw-';
const MIGRATION_DONE_KEY = 'piano-midi-raw-migrated';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(RAW_MIDI_STORE)) {
        db.createObjectStore(RAW_MIDI_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
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
