import { strToU8, zipSync } from 'fflate';
import type {
  CollectedScore,
  ReconstructedScore,
  ScoreLinkValidationSummary,
} from './types';

const sanitizeFileName = (value: string) => {
  const printable = Array.from(value, (character) => character.charCodeAt(0) >= 32 ? character : '_').join('');
  return printable.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'musescore-score';
};

const decodeBase64 = (value: string) => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

export function createDiagnosticPackage(
  collected: CollectedScore,
  reconstructed?: ReconstructedScore,
  validation?: ScoreLinkValidationSummary,
) {
  const manifest = {
    format: 'noterain-score-link-diagnostic',
    version: 1,
    createdAt: new Date().toISOString(),
    source: collected.source,
    title: collected.title,
    files: {
      midi: 'score.mid',
      pages: collected.pages.map((_, index) => `pages/page-${String(index + 1).padStart(3, '0')}.svg`),
      musicXml: reconstructed ? 'reconstructed.musicxml' : undefined,
      validation: validation ? 'validation.json' : undefined,
    },
  };
  const files: Record<string, Uint8Array> = {
    'manifest.json': strToU8(`${JSON.stringify(manifest, null, 2)}\n`),
    'score.mid': decodeBase64(collected.midiBase64),
  };
  collected.pages.forEach((page, index) => {
    files[manifest.files.pages[index]] = strToU8(page);
  });
  if (reconstructed) files['reconstructed.musicxml'] = strToU8(reconstructed.musicXml);
  if (validation) files['validation.json'] = strToU8(`${JSON.stringify(validation, null, 2)}\n`);

  return {
    blob: new Blob([zipSync(files, { level: 6 })], { type: 'application/zip' }),
    fileName: `${sanitizeFileName(collected.title)}-${collected.source.scoreId}-noterain-debug.zip`,
  };
}

export function downloadDiagnosticPackage(
  collected: CollectedScore,
  reconstructed?: ReconstructedScore,
  validation?: ScoreLinkValidationSummary,
) {
  const packageFile = createDiagnosticPackage(collected, reconstructed, validation);
  const objectUrl = URL.createObjectURL(packageFile.blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = packageFile.fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
  return packageFile.fileName;
}