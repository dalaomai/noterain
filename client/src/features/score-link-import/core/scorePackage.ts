import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { CollectedScore } from './types';

const MANIFEST_PATH = 'manifest.json';
const MIDI_PATH = 'score.mid';

interface ScorePackageManifest {
  format: 'noterain-svg-midi';
  version: 1;
  source: CollectedScore['source'];
  title: string;
  metadata?: CollectedScore['metadata'];
  midi: string;
  pages: string[];
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function safeFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, '_').trim() || 'MuseScore';
}

export function createScorePackage(score: CollectedScore): File {
  const pages = score.pages.map((_, index) => `pages/page-${String(index + 1).padStart(3, '0')}.svg`);
  const manifest: ScorePackageManifest = {
    format: 'noterain-svg-midi',
    version: 1,
    source: score.source,
    title: score.title,
    metadata: score.metadata,
    midi: MIDI_PATH,
    pages,
  };
  const files: Record<string, Uint8Array> = {
    [MANIFEST_PATH]: strToU8(JSON.stringify(manifest)),
    [MIDI_PATH]: decodeBase64(score.midiBase64),
  };
  score.pages.forEach((page, index) => { files[pages[index]] = strToU8(page); });
  return new File(
    [zipSync(files, { level: 6 })],
    `${safeFileName(score.title)}.noterain`,
    { type: 'application/vnd.noterain.svg-midi+zip' },
  );
}

export async function parseScorePackage(file: File): Promise<CollectedScore> {
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const manifestBytes = files[MANIFEST_PATH];
  if (!manifestBytes) throw new Error('INVALID_NOTERAIN_PACKAGE');
  const manifest = JSON.parse(strFromU8(manifestBytes)) as ScorePackageManifest;
  if (
    manifest.format !== 'noterain-svg-midi'
    || manifest.version !== 1
    || !files[manifest.midi]
    || !Array.isArray(manifest.pages)
    || !manifest.pages.length
    || manifest.pages.some((path) => !files[path])
  ) throw new Error('INVALID_NOTERAIN_PACKAGE');
  return {
    source: manifest.source,
    title: manifest.title,
    metadata: manifest.metadata,
    midiBase64: encodeBase64(files[manifest.midi]),
    pages: manifest.pages.map((path) => strFromU8(files[path])),
  };
}