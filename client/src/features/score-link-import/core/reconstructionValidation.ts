import type { MusicXmlWorkerRequest, MusicXmlWorkerResponse } from '../../../lib/musicxml/renderWorkerTypes';
import { parseMidi } from 'midi-file';
import { validateNotationMidiRoundTrip, type NotationMidiValidationReport } from './midiValidation';
import { validateSvgStructure, type SvgValidationReport } from './svgValidation';
import { calculateUsability } from './usability';
import type {
  CollectedScore,
  ReconstructedScore,
  ScoreLinkValidationSummary,
} from './types';

interface ReconstructionValidationReport {
  midi: NotationMidiValidationReport;
  svg: SvgValidationReport;
  tempoMatches: boolean;
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function sourceTempos(bytes: Uint8Array) {
  const midi = parseMidi(bytes);
  const divisions = midi.header.ticksPerBeat;
  if (!divisions) throw new Error('SMPTE_MIDI_TIME_DIVISION_UNSUPPORTED');
  return midi.tracks.flatMap((track) => {
    let tick = 0;
    return track.flatMap((event) => {
      tick += event.deltaTime;
      return event.type === 'setTempo'
        ? [{ onset: tick / divisions, bpm: 60_000_000 / event.microsecondsPerBeat }]
        : [];
    });
  }).sort((left, right) => left.onset - right.onset || left.bpm - right.bpm);
}

function musicXmlTempos(musicXml: string) {
  const document = new DOMParser().parseFromString(musicXml, 'application/xml');
  if (document.querySelector('parsererror')) throw new Error('RECONSTRUCTION_XML_INVALID');
  let divisions = 1;
  let numerator = 4;
  let denominator = 4;
  let measureStart = 0;
  const tempos: Array<{ onset: number; bpm: number }> = [];
  for (const measure of document.querySelectorAll('part:first-of-type > measure')) {
    divisions = Number(measure.querySelector(':scope > attributes > divisions')?.textContent) || divisions;
    numerator = Number(measure.querySelector(':scope > attributes > time > beats')?.textContent) || numerator;
    denominator = Number(measure.querySelector(':scope > attributes > time > beat-type')?.textContent) || denominator;
    for (const direction of measure.querySelectorAll(':scope > direction')) {
      const bpm = Number(direction.querySelector(':scope > sound[tempo]')?.getAttribute('tempo'));
      if (!Number.isFinite(bpm)) continue;
      const offset = Number(direction.querySelector(':scope > offset')?.textContent) || 0;
      tempos.push({ onset: measureStart + offset / divisions, bpm });
    }
    measureStart += numerator * 4 / denominator;
  }
  return tempos;
}

function validateTempoMap(sourceBytes: Uint8Array, musicXml: string): boolean {
  const source = sourceTempos(sourceBytes);
  const generated = musicXmlTempos(musicXml);
  return source.length === generated.length && source.every((tempo, index) =>
    Math.abs(tempo.onset - generated[index].onset) <= 1 / 1920
      && Math.abs(tempo.bpm - generated[index].bpm) <= 0.01,
  );
}

async function renderForValidation(
  musicXml: string,
  signal?: AbortSignal,
) {
  const worker = new Worker(new URL('../../../lib/musicxml/render.worker.ts', import.meta.url), {
    type: 'module',
  });
  const id = crypto.randomUUID();
  const request: MusicXmlWorkerRequest = {
    id,
    source: { musicXml },
    pageWidth: 1200,
    density: 'standard',
    expandRepeats: false,
    breaks: 'encoded',
  };

  try {
    return await new Promise<Extract<MusicXmlWorkerResponse, { type: 'complete' }>['result']>((resolve, reject) => {
      const abort = () => reject(new DOMException('Aborted', 'AbortError'));
      signal?.addEventListener('abort', abort, { once: true });
      worker.addEventListener('error', (event) => reject(new Error(event.message || 'RECONSTRUCTION_RENDER_FAILED')), { once: true });
      worker.addEventListener('message', (event: MessageEvent<MusicXmlWorkerResponse>) => {
        const response = event.data;
        if (response.id !== id) return;
        if (response.type === 'complete') {
          signal?.removeEventListener('abort', abort);
          resolve(response.result);
        } else if (response.type === 'error') {
          signal?.removeEventListener('abort', abort);
          reject(new Error(`RECONSTRUCTION_RENDER_FAILED:${response.error}`));
        }
      });
      if (signal?.aborted) abort();
      else worker.postMessage(request);
    });
  } finally {
    worker.terminate();
  }
}

export async function validateReconstructedScore(
  collected: CollectedScore,
  reconstructed: ReconstructedScore,
  signal?: AbortSignal,
): Promise<ReconstructionValidationReport & { summary: ScoreLinkValidationSummary }> {
  const sourceMidi = decodeBase64(collected.midiBase64);
  let rendered: Awaited<ReturnType<typeof renderForValidation>> | undefined;
  let renderError: string | undefined;
  try {
    rendered = await renderForValidation(reconstructed.musicXml, signal);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    renderError = error instanceof Error ? error.message : String(error);
  }
  let midi: NotationMidiValidationReport = {
    valid: false,
    sourceNoteCount: 0,
    generatedNoteCount: 0,
    missing: [],
    extra: [],
  };
  let midiError = renderError;
  if (rendered) {
    try {
      midi = validateNotationMidiRoundTrip(sourceMidi, decodeBase64(rendered.midiBase64));
    } catch (error) {
      midiError = error instanceof Error ? error.message : String(error);
    }
  }
  let svg: SvgValidationReport = {
    valid: false,
    source: [],
    generated: [],
    mismatches: [],
    unsupportedSourceSymbols: [],
  };
  let svgError = renderError;
  if (rendered) {
    try {
      svg = validateSvgStructure(collected.pages, rendered.pages);
    } catch (error) {
      svgError = error instanceof Error ? error.message : String(error);
    }
  }
  let tempoMatches = false;
  let tempoError: string | undefined;
  try {
    tempoMatches = validateTempoMap(sourceMidi, reconstructed.musicXml);
  } catch (error) {
    tempoError = error instanceof Error ? error.message : String(error);
  }
  const summary: ScoreLinkValidationSummary = {
    valid: midi.valid && tempoMatches && svg.valid,
    usability: calculateUsability(collected.pages, midi, svg, reconstructed.musicXml),
    midi: { valid: midi.valid, error: midiError },
    tempo: { valid: tempoMatches, error: tempoError },
    svg: { valid: svg.valid, error: svgError },
  };
  if (!summary.valid) console.error('[ScoreLinkImport] reconstruction validation failed', { summary, midi, svg });
  return { midi, svg, tempoMatches, summary };
}