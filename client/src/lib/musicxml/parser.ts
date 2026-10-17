import { parseMidiFile } from '../midi/parser';
import { getScorePageWidth } from '../scoreLayout';
import type { MidiFile, ScoreDensity } from '../../types/midi';
import { attachMusicXmlVelocityReferences } from './velocity';

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

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

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

function loadSource(
  toolkit: VerovioToolkitLike,
  source: Pick<MidiFile, 'musicXml' | 'musicXmlCompressed'>,
): boolean {
  if (source.musicXmlCompressed) {
    return toolkit.loadZipDataBuffer(source.musicXmlCompressed);
  }
  if (source.musicXml) {
    return toolkit.loadData(source.musicXml);
  }
  return false;
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
  density: ScoreDensity,
  expandRepeats: boolean,
  onProgress?: (stage: MusicXmlRenderStage, progress: number) => void,
): Promise<MusicXmlRenderResult> {
  const cacheKey = `${pageWidth}:${density}:${expandRepeats}`;
  const cached = renderCache.get(source)?.get(cacheKey);
  if (cached) {
    onProgress?.('renderingPages', 1);
    return cached;
  }

  onProgress?.('loadingEngine', 0.1);
  await yieldToBrowser();
  const { module, Toolkit } = await loadVerovio();
  onProgress?.('loadingEngine', 1);
  await yieldToBrowser();
  const toolkit = new Toolkit(module);

  try {
    const densityOptions = {
      relaxed: {
        lyricWordSpace: 2.2,
        measureMinWidth: 21,
        spacingLinear: 0.4,
        spacingNonLinear: 0.68,
        spacingSystem: 7,
      },
      standard: {
        lyricWordSpace: 2.0,
        measureMinWidth: 20,
        spacingLinear: 0.36,
        spacingNonLinear: 0.65,
        spacingSystem: 6,
      },
      compact: {
        lyricWordSpace: 1.5,
        measureMinWidth: 16,
        spacingLinear: 0.28,
        spacingNonLinear: 0.6,
        spacingSystem: 5,
      },
    }[density ?? 'standard'];

    onProgress?.('parsingScore', 0.2);
    await yieldToBrowser();
    toolkit.setOptions({
      adjustPageHeight: true,
      breaks: 'auto',
      expandAlways: expandRepeats,
      footer: 'none',
      header: 'none',
      lyricHeightFactor: 1.1,
      lyricTopMinMargin: 2.25,
      lyricWordSpace: densityOptions.lyricWordSpace,
      measureMinWidth: densityOptions.measureMinWidth,
      pageWidth: getScorePageWidth(pageWidth, density ?? 'standard'),
      scale: 40,
      spacingLinear: densityOptions.spacingLinear,
      spacingNonLinear: densityOptions.spacingNonLinear,
      spacingSystem: densityOptions.spacingSystem,
    });

    if (!loadSource(toolkit, source)) {
      throw new Error('Unable to render MusicXML score');
    }
    onProgress?.('parsingScore', 1);
    await yieldToBrowser();

    onProgress?.('layingOutScore', 0.2);
    await yieldToBrowser();
    toolkit.renderToMIDI();
    const timeMap = toolkit.renderToTimemap({
      includeMeasures: true,
      includeRests: true,
    });
    const toRenderedId = (id: string) =>
      expandRepeats ? id : toolkit.getNotatedIdForElement(id) || id;

    onProgress?.('layingOutScore', 1);
    await yieldToBrowser();
    const mappedTimeMap = timeMap.map((event) => ({
      ...event,
      measureOn: event.measureOn ? toRenderedId(event.measureOn) : undefined,
      off: event.off?.map(toRenderedId),
      on: event.on?.map(toRenderedId),
    }));
    const elementPitches = new Map<string, number>();
    const elementStaffs = new Map<string, string>();
    const engraving = new DOMParser().parseFromString(toolkit.getMEI(), 'application/xml');
    for (const element of engraving.querySelectorAll('note')) {
      const id = element.getAttribute('xml:id');
      const staff = element.closest('staff')?.getAttribute('n');
      if (id && staff && /^\d+$/.test(staff)) elementStaffs.set(toRenderedId(id), staff);
    }
    for (const event of timeMap) {
      for (const id of event.on ?? []) {
        const pitch = toolkit.getMIDIValuesForElement(id).pitch;
        if (typeof pitch === 'number') elementPitches.set(toRenderedId(id), pitch);
      }
    }
    const elementTimes = new Map<string, number>();
    for (const event of mappedTimeMap) {
      if (event.measureOn && !elementTimes.has(event.measureOn)) {
        elementTimes.set(event.measureOn, event.tstamp / 1000);
      }
      for (const id of event.on ?? []) {
        if (!elementTimes.has(id)) elementTimes.set(id, event.tstamp / 1000);
      }
    }

    const pageCount = toolkit.getPageCount();
    const pages: string[] = [];
    for (let page = 0; page < pageCount; page++) {
      const svg = toolkit
        .renderToSVG(page + 1, false)
        .replace(
          /(<g\s+id="([^"]+)"\s+class="(?:note|measure)"?)/g,
          (match, opening: string, id: string) => {
            const time = elementTimes.get(id);
            const pitch = elementPitches.get(id);
            const staff = elementStaffs.get(id);
            return time === undefined
              ? match
              : `${opening} data-playback-time="${time}"${pitch !== undefined ? ` data-midi-pitch="${pitch}"` : ''}${staff ? ` data-midi-staff="${staff}"` : ''}`;
          },
        );
      pages.push(svg);
      onProgress?.('renderingPages', (page + 1) / pageCount);
      await yieldToBrowser();
    }

    const result = {
      pages,
      timeMap: mappedTimeMap,
    };
    const sourceCache = renderCache.get(source) ?? new Map();
    sourceCache.set(cacheKey, result);
    renderCache.set(source, sourceCache);
    return result;
  } finally {
    toolkit.destroy();
  }
}
