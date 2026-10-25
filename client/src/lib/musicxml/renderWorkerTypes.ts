import type { ScoreDensity } from '../../types/midi';
import type { MusicXmlTimeEvent } from './parser';

export interface MusicXmlWorkerRequest {
  id: string;
  source: {
    musicXml?: string;
    musicXmlCompressed?: ArrayBuffer;
  };
  pageWidth: number;
  density: ScoreDensity | number;
  expandRepeats: boolean;
  breaks?: 'auto' | 'encoded';
}

export interface MusicXmlWorkerResult {
  pages: string[];
  midiBase64: string;
  timeMap: MusicXmlTimeEvent[];
  mei: string;
  elementPitches: Array<[string, number]>;
  renderedIds: Array<[string, string]>;
}

export type MusicXmlWorkerResponse =
  | {
      id: string;
      type: 'progress';
      stage: 'loadingEngine' | 'parsingScore' | 'layingOutScore' | 'renderingPages';
      progress: number;
    }
  | { id: string; type: 'complete'; result: MusicXmlWorkerResult }
  | { id: string; type: 'error'; error: string };