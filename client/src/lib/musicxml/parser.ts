import { parseMidiFile } from '../midi/parser';
import type { MidiFile, ScoreDensity } from '../../types/midi';
import { attachMusicXmlVelocityReferences } from './velocity';
import type {
  MusicXmlWorkerRequest,
  MusicXmlWorkerResponse,
} from './renderWorkerTypes';

interface VerovioToolkitLike {
  destroy(): void;
  getNotatedIdForElement(xmlId: string): string;
  getPageCount(): number;
  getMEI(): string;
  getMIDIValuesForElement(xmlId: string): { pitch?: number };
  loadData(data: string): boolean;
  loadZipDataBuffer(data: ArrayBuffer): boolean;
  renderToMIDI(): string;
  renderToSVG(page: number, xmlDeclaration?: boolean): string;
  renderToTimemap(options?: Record<string, unknown>): MusicXmlTimeEvent[];
  setOptions(options: Record<string, unknown>): void;
}

export interface MusicXmlTimeEvent {
  measureOn?: string;
  off?: string[];
  on?: string[];
  tstamp: number;
  qstamp?: number;
  tempo?: number;
}

export interface MusicXmlRenderResult {
  pages: string[];
  timeMap: MusicXmlTimeEvent[];
}

export type MusicXmlRenderStage =
  'loadingEngine' | 'parsingScore' | 'layingOutScore' | 'renderingPages';

const renderCache = new WeakMap<object, Map<string, MusicXmlRenderResult>>();

type VerovioToolkitConstructor = new (module: unknown) => VerovioToolkitLike;

let verovioPromise: Promise<{
  module: unknown;
  Toolkit: VerovioToolkitConstructor;
}> | null = null;

async function loadVerovio() {
  if (!verovioPromise) {
    verovioPromise = Promise.all([
      import('verovio/wasm'),
      import('verovio/esm'),
    ]).then(async ([wasmModule, toolkitModule]) => ({
      module: await wasmModule.default(),
      Toolkit: toolkitModule.VerovioToolkit as VerovioToolkitConstructor,
    }));
  }
  return verovioPromise;
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

export function isMusicXmlFileName(fileName: string): boolean {
  return /\.(musicxml|xml|mxl)$/i.test(fileName);
}

/**
 * Load MusicXML with Verovio, preserve the original notation for engraving,
 * and convert it to MIDI so playback/falling-notes/wait-mode can reuse the
 * existing engine.
 */
export async function parseMusicXmlFile(file: File): Promise<MidiFile> {
  const { module, Toolkit } = await loadVerovio();
  const toolkit = new Toolkit(module);

  try {
    const compressed = file.name.toLowerCase().endsWith('.mxl');
    const sourceData = await file.arrayBuffer();
    let musicXml: string | undefined;
    let loaded: boolean;

    if (compressed) {
      loaded = toolkit.loadZipDataBuffer(sourceData);
    } else {
      musicXml = new TextDecoder().decode(sourceData);
      loaded = toolkit.loadData(musicXml);
    }

    if (!loaded) {
      throw new Error('Unable to parse MusicXML score');
    }

    const midiBase64 = toolkit.renderToMIDI();
    if (!midiBase64) {
      throw new Error('MusicXML score contains no playable MIDI data');
    }

    const parsed = parseMidiFile(base64ToArrayBuffer(midiBase64), file.name);
    attachMusicXmlVelocityReferences(parsed, toolkit.getMEI(), toolkit.renderToTimemap({ includeMeasures: true }), (id) => toolkit.getNotatedIdForElement(id) || id);
    const metadata = new DOMParser().parseFromString(
      musicXml ?? toolkit.getMEI(),
      'application/xml',
    );
    const title = [
      'work > work-title',
      'movement-title',
      'meiHead fileDesc titleStmt title',
    ]
      .map((selector) => metadata.querySelector(selector)?.textContent?.trim())
      .find(Boolean);
    return {
      ...parsed,
      title,
      sourceFormat: 'musicxml',
      musicXml,
      musicXmlCompressed: compressed ? sourceData : undefined,
    };
  } finally {
    toolkit.destroy();
  }
}

/** Render every page of an imported MusicXML score as notation-preserving SVG. */
export async function renderMusicXmlPages(
  source: Pick<MidiFile, 'musicXml' | 'musicXmlCompressed'> & object,
  pageWidth: number,
  density: ScoreDensity | number,
  expandRepeats: boolean,
  onProgress?: (stage: MusicXmlRenderStage, progress: number) => void,
  signal?: AbortSignal,
): Promise<MusicXmlRenderResult> {
  const cacheKey = `${pageWidth}:${density}:${expandRepeats}`;
  const cached = renderCache.get(source)?.get(cacheKey);
  if (cached) {
    onProgress?.('renderingPages', 1);
    return cached;
  }

  const worker = new Worker(new URL('./render.worker.ts', import.meta.url), {
    type: 'module',
  });
  const id = crypto.randomUUID();
  const request: MusicXmlWorkerRequest = {
    id,
    source: {
      musicXml: source.musicXml,
      musicXmlCompressed: source.musicXmlCompressed,
    },
    pageWidth,
    density,
    expandRepeats,
  };

  try {
    const workerResult = await new Promise<Extract<MusicXmlWorkerResponse, { type: 'complete' }>['result']>((resolve, reject) => {
      const abort = () => reject(new DOMException('Aborted', 'AbortError'));
      signal?.addEventListener('abort', abort, { once: true });
      worker.addEventListener('error', (event) => reject(new Error(event.message || 'MusicXML worker failed')), { once: true });
      worker.addEventListener('message', (event: MessageEvent<MusicXmlWorkerResponse>) => {
        const response = event.data;
        if (response.id !== id) return;
        if (response.type === 'progress') {
          onProgress?.(response.stage, response.progress);
        } else if (response.type === 'complete') {
          signal?.removeEventListener('abort', abort);
          resolve(response.result);
        } else {
          signal?.removeEventListener('abort', abort);
          reject(new Error(response.error));
        }
      });
      if (signal?.aborted) abort();
      else worker.postMessage(request);
    });
    const renderedIds = new Map(workerResult.renderedIds);
    const toRenderedId = (id: string) => renderedIds.get(id) ?? id;
    const elementPitches = new Map(workerResult.elementPitches);
    const elementStaffs = new Map<string, string>();
    const engraving = new DOMParser().parseFromString(workerResult.mei, 'application/xml');
    for (const element of engraving.querySelectorAll('note')) {
      const id = element.getAttribute('xml:id');
      const staff = element.closest('staff')?.getAttribute('n');
      if (id && staff && /^\d+$/.test(staff)) elementStaffs.set(toRenderedId(id), staff);
    }
    const elementTimes = new Map<string, number>();
    for (const event of workerResult.timeMap) {
      if (event.measureOn && !elementTimes.has(event.measureOn)) {
        elementTimes.set(event.measureOn, event.tstamp / 1000);
      }
      for (const id of event.on ?? []) {
        if (!elementTimes.has(id)) elementTimes.set(id, event.tstamp / 1000);
      }
    }

    const pages = workerResult.pages.map((page) =>
      page.replace(
          /(<g\s+id="([^"]+)"\s+class="(?:note|measure)"?)/g,
          (match, opening: string, id: string) => {
            const time = elementTimes.get(id);
            const pitch = elementPitches.get(id);
            const staff = elementStaffs.get(id);
            return time === undefined
              ? match
              : `${opening} data-playback-time="${time}"${pitch !== undefined ? ` data-midi-pitch="${pitch}"` : ''}${staff ? ` data-midi-staff="${staff}"` : ''}`;
          },
        ),
    );

    const result = {
      pages,
      timeMap: workerResult.timeMap,
    };
    const sourceCache = renderCache.get(source) ?? new Map();
    sourceCache.set(cacheKey, result);
    renderCache.set(source, sourceCache);
    return result;
  } finally {
    worker.terminate();
  }
}
