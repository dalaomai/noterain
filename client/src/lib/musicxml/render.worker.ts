/// <reference lib="webworker" />

import { getScorePageWidth } from '../scoreLayout';
import type {
  MusicXmlWorkerRequest,
  MusicXmlWorkerResponse,
  MusicXmlWorkerResult,
} from './renderWorkerTypes';

const worker = self as DedicatedWorkerGlobalScope;

const post = (response: MusicXmlWorkerResponse) => worker.postMessage(response);

worker.addEventListener('message', (event: MessageEvent<MusicXmlWorkerRequest>) => {
  const request = event.data;
  void render(request)
    .then((result) => post({ id: request.id, type: 'complete', result }))
    .catch((error: unknown) => {
      post({
        id: request.id,
        type: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    });
});

async function render(request: MusicXmlWorkerRequest): Promise<MusicXmlWorkerResult> {
  post({ id: request.id, type: 'progress', stage: 'loadingEngine', progress: 0.1 });
  const [{ default: createVerovioModule }, { VerovioToolkit }] = await Promise.all([
    import('verovio/wasm'),
    import('verovio/esm'),
  ]);
  const module = await createVerovioModule();
  const toolkit = new VerovioToolkit(module);
  post({ id: request.id, type: 'progress', stage: 'loadingEngine', progress: 1 });

  try {
    const densityValue = typeof request.density === 'number'
      ? request.density
      : request.density === 'relaxed'
        ? 1
        : request.density === 'compact'
          ? 10
          : 5;
    const densityProgress = (Math.max(1, Math.min(10, densityValue)) - 1) / 9;
    const interpolate = (loose: number, compact: number) =>
      loose + (compact - loose) * densityProgress;
    const densityOptions = {
      lyricWordSpace: interpolate(2.2, 1.2),
      measureMinWidth: interpolate(21, 11),
      spacingLinear: interpolate(0.4, 0.2),
      spacingNonLinear: interpolate(0.68, 0.52),
      spacingSystem: interpolate(7, 3.5),
    };

    post({ id: request.id, type: 'progress', stage: 'parsingScore', progress: 0.2 });
    toolkit.setOptions({
      adjustPageHeight: true,
      breaks: request.breaks ?? 'auto',
      expandAlways: request.expandRepeats,
      footer: 'none',
      header: 'none',
      lyricHeightFactor: 1.1,
      lyricTopMinMargin: 2.25,
      lyricWordSpace: densityOptions.lyricWordSpace,
      measureMinWidth: densityOptions.measureMinWidth,
      pageWidth: getScorePageWidth(request.pageWidth),
      scale: 40,
      spacingLinear: densityOptions.spacingLinear,
      spacingNonLinear: densityOptions.spacingNonLinear,
      spacingSystem: densityOptions.spacingSystem,
    });
    const loaded = request.source.musicXmlCompressed
      ? toolkit.loadZipDataBuffer(request.source.musicXmlCompressed)
      : request.source.musicXml
        ? toolkit.loadData(request.source.musicXml)
        : false;
    if (!loaded) throw new Error('Unable to render MusicXML score');
    post({ id: request.id, type: 'progress', stage: 'parsingScore', progress: 1 });

    post({ id: request.id, type: 'progress', stage: 'layingOutScore', progress: 0.2 });
    const midiBase64 = toolkit.renderToMIDI();
    if (!midiBase64) throw new Error('MusicXML score contains no playable MIDI data');
    const timeMap = toolkit.renderToTimemap({ includeMeasures: true, includeRests: true });
    const renderedIds = new Map<string, string>();
    const toRenderedId = (id: string) => {
      const cached = renderedIds.get(id);
      if (cached) return cached;
      const rendered = request.expandRepeats ? id : toolkit.getNotatedIdForElement(id) || id;
      renderedIds.set(id, rendered);
      return rendered;
    };
    const mappedTimeMap = timeMap.map((timeEvent) => ({
      ...timeEvent,
      measureOn: timeEvent.measureOn ? toRenderedId(timeEvent.measureOn) : undefined,
      off: timeEvent.off?.map(toRenderedId),
      on: timeEvent.on?.map(toRenderedId),
    }));
    const elementPitches = new Map<string, number>();
    for (const timeEvent of timeMap) {
      for (const id of timeEvent.on ?? []) {
        const pitch = toolkit.getMIDIValuesForElement(id).pitch;
        if (typeof pitch === 'number') elementPitches.set(toRenderedId(id), pitch);
      }
    }
    const mei = toolkit.getMEI();
    post({ id: request.id, type: 'progress', stage: 'layingOutScore', progress: 1 });

    const pageCount = toolkit.getPageCount();
    const pages: string[] = [];
    for (let page = 0; page < pageCount; page++) {
      pages.push(toolkit.renderToSVG(page + 1, false));
      post({
        id: request.id,
        type: 'progress',
        stage: 'renderingPages',
        progress: (page + 1) / pageCount,
      });
    }
    return {
      pages,
      midiBase64,
      timeMap: mappedTimeMap,
      mei,
      elementPitches: [...elementPitches],
      renderedIds: [...renderedIds],
    };
  } finally {
    toolkit.destroy();
  }
}