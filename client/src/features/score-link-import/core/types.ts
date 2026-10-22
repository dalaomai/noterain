interface CollectedScoreSource {
  provider: 'musescore';
  url: string;
  scoreId: number;
  revisionId: number;
}

export interface CollectedScore {
  source: CollectedScoreSource;
  title: string;
  midiBase64: string;
  pages: string[];
  metadata?: {
    subtitle?: string;
    composer?: string;
    arranger?: string;
  };
}

interface ReconstructionReport {
  pageCount: number;
  svgNoteSymbols: number;
  midiNotes: number;
}

export interface ReconstructedScore {
  fileName: string;
  musicXml: string;
  report: ReconstructionReport;
}

interface ValidationCheck {
  valid: boolean;
  error?: string;
}

export interface ScoreLinkValidationSummary {
  valid: boolean;
  usability: {
    score: number;
    usable: boolean;
    midi: number;
    structure: number;
    notation: number;
  };
  midi: ValidationCheck;
  tempo: ValidationCheck;
  svg: ValidationCheck;
}
