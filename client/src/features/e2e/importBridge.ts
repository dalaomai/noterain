import type { MidiFile } from '../../types/midi';

export interface E2EImportResult {
  id: string;
  name: string;
  title?: string;
  sourceFormat?: MidiFile['sourceFormat'];
  duration: number;
  historyId?: string;
}

type E2EImportSource = string | number[] | Uint8Array | ArrayBuffer;

declare global {
  interface Window {
    __NOTERAIN_E2E_IMPORT__?: (
      name: string,
      source: E2EImportSource,
      mimeType?: string,
    ) => Promise<E2EImportResult>;
  }
}

function decodeSource(source: E2EImportSource): BlobPart {
  if (typeof source === 'string') {
    const normalized = source.replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
    const binary = atob(normalized);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }
  if (source instanceof ArrayBuffer) return source;
  if (source instanceof Uint8Array) return new Uint8Array(source);
  return Uint8Array.from(source);
}

function bridgeEnabled() {
  const host = window.location.hostname;
  return import.meta.env.DEV
    || host === 'localhost'
    || host === '127.0.0.1'
    || (
      host.endsWith('.vercel.app')
      && new URLSearchParams(window.location.search).get('e2e-import') === '1'
    );
}

export function installE2EImportBridge(loadFile: (file: File) => Promise<MidiFile>) {
  if (!bridgeEnabled()) return () => undefined;
  window.__NOTERAIN_E2E_IMPORT__ = async (name, source, mimeType = 'application/octet-stream') => {
    const file = new File([decodeSource(source)], name, { type: mimeType });
    const imported = await loadFile(file);
    return {
      id: imported.id,
      name: imported.name,
      title: imported.title,
      sourceFormat: imported.sourceFormat,
      duration: imported.duration,
      historyId: imported.historyId,
    };
  };
  return () => {
    delete window.__NOTERAIN_E2E_IMPORT__;
  };
}