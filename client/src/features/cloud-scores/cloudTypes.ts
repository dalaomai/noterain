export type CloudScoreFormat = 'midi' | 'musicxml' | 'mxl' | 'noterain';

export interface CloudCapabilities {
  available: boolean;
  upload: boolean;
  search: boolean;
  maxFileSize: number;
}

export interface CloudScoreSummary {
  id: string;
  title: string;
  fileName: string;
  format: CloudScoreFormat;
  composer: string[];
  arranger: string[];
  source: string;
  duration?: number;
  byteSize: number;
  uploadedAt: string;
}

export interface CloudScoreMetadata {
  schemaVersion: 1;
  id: string;
  sha256: string;
  title: string;
  fileName: string;
  format: CloudScoreFormat;
  mimeType: string;
  byteSize: number;
  source: 'local' | 'musescore' | 'cloud';
  sourceUrl?: string;
  scoreId?: number;
  revisionId?: number;
  composer: string[];
  arranger: string[];
  duration?: number;
  uploadedAt: string;
  originalBlobPath: string;
}