import type { NotationMidiValidationReport } from './midiValidation';
import type { SvgValidationReport } from './svgValidation';
import { parseSvgPage } from './svgScore';

interface UsabilityReport {
  score: number;
  usable: boolean;
  midi: number;
  structure: number;
  notation: number;
}

const NOTATION_CONFIDENCE: Record<string, number> = {
  Accidental: 0.75,
  Arpeggio: 0.95,
  Articulation: 0.9,
  BarLine: 1,
  Beam: 0.95,
  Bracket: 1,
  Clef: 0.95,
  Dynamic: 0.9,
  HairpinSegment: 1,
  Hook: 0.95,
  KeySig: 1,
  LedgerLine: 1,
  Note: 0.98,
  NoteDot: 0.95,
  PedalSegment: 0.97,
  Rest: 0.25,
  SlurSegment: 0.1,
  StaffLines: 1,
  StaffText: 0,
  Stem: 0.9,
  Tempo: 1,
  Text: 0.35,
  TimeSig: 1,
  Tremolo: 0,
  Tuplet: 0,
};

function sourceClassCounts(pages: string[]): Map<string, number> {
  const classes = new Map<string, number>();
  for (const page of pages) {
    for (const match of page.matchAll(/\bclass=(?:"([^"]*)"|'([^']*)')/gi)) {
      for (const className of (match[1] ?? match[2] ?? '').split(/\s+/)) {
        if (className) classes.set(className, (classes.get(className) ?? 0) + 1);
      }
    }
  }
  const models = pages.flatMap((page) => {
    try { return [parseSvgPage(page)]; } catch { return []; }
  });
  const semanticCounts: Record<string, number> = {
    Note: models.reduce((sum, page) => sum + page.systems.reduce((systemSum, system) => systemSum + system.noteAnchors.length, 0), 0),
    Rest: models.reduce((sum, page) => sum + page.systems.reduce((systemSum, system) => systemSum + system.restAnchors.length, 0), 0),
    Accidental: models.reduce((sum, page) => sum + page.systems.reduce((systemSum, system) =>
      systemSum + system.accidentals.filter((accidental) => {
        const correctedY = accidental.y + (accidental.alter === 1 ? 3 : 0);
        return system.noteAnchors.some((note) =>
          note.x > accidental.x
          && note.x - accidental.x < 20
          && Math.abs(note.y - correctedY) < 1,
        );
      }).length,
    0), 0),
    SlurSegment: models.reduce((sum, page) => sum + page.systems.reduce((systemSum, system) => systemSum + system.slurs.length, 0), 0),
    HairpinSegment: models.reduce((sum, page) => sum + page.systems.reduce((systemSum, system) => systemSum + system.hairpins.length, 0), 0),
    PedalSegment: models.reduce((sum, page) => sum + page.systems.reduce((systemSum, system) => systemSum + system.pedals.length, 0), 0),
    Dynamic: models.reduce((sum, page) => sum + page.systems.reduce((systemSum, system) => systemSum + system.dynamics.length, 0), 0),
    Tremolo: models.reduce((sum, page) => sum + page.systems.reduce((systemSum, system) => systemSum + system.tremolos.length, 0), 0),
    Tuplet: models.reduce((sum, page) => sum + page.systems.reduce((systemSum, system) => systemSum + system.tuplets.length, 0), 0),
    Stem: models.reduce((sum, page) => sum + page.systems.reduce((systemSum, system) => systemSum + system.stems.length, 0), 0),
    Beam: models.reduce((sum, page) => sum + page.systems.reduce((systemSum, system) => systemSum + system.beams.length, 0), 0),
    Hook: models.reduce((sum, page) => sum + page.systems.reduce((systemSum, system) => systemSum + system.hooks.length, 0), 0),
    NoteDot: models.reduce((sum, page) => sum + page.systems.reduce((systemSum, system) => systemSum + system.noteDots.length, 0), 0),
    Arpeggio: models.reduce((sum, page) => sum + page.systems.reduce((systemSum, system) => systemSum + system.arpeggios.length, 0), 0),
    Articulation: models.reduce((sum, page) => sum + page.systems.reduce((systemSum, system) => systemSum + system.articulations.length, 0), 0),
  };
  for (const [className, count] of Object.entries(semanticCounts)) {
    if (count > 0) classes.set(className, count);
  }
  return classes;
}

function effectiveMidiErrors(
  pages: string[],
  midi: NotationMidiValidationReport,
): number {
  const hasArpeggio = pages.some((page) => /\bclass="[^"]*\bArpeggio\b[^"]*"/i.test(page));
  if (!hasArpeggio) return Math.max(midi.missing.length, midi.extra.length);
  const unmatchedExtra = [...midi.extra];
  let unmatchedMissing = 0;
  for (const missing of midi.missing) {
    const match = unmatchedExtra.findIndex((extra) =>
      extra.pitch === missing.pitch
      && Math.abs(extra.onset - missing.onset) <= 0.25,
    );
    if (match < 0) unmatchedMissing += 1;
    else unmatchedExtra.splice(match, 1);
  }
  return Math.max(unmatchedMissing, unmatchedExtra.length);
}

export function calculateUsability(
  pages: string[],
  midi: NotationMidiValidationReport,
  svg: SvgValidationReport,
  musicXml?: string,
): UsabilityReport {
  const noteTotal = Math.max(1, midi.sourceNoteCount);
  const midiScore = Math.max(0, 1 - effectiveMidiErrors(pages, midi) / noteTotal);
  const structuralChecks = 1 + svg.source.reduce(
    (sum, page) => sum + 1 + page.systems.length * 2,
    0,
  );
  const structureScore = Math.max(0, 1 - svg.mismatches.length / structuralChecks);
  const classCounts = sourceClassCounts(pages);
  const runtimeConfidence = { ...NOTATION_CONFIDENCE };
  if (musicXml) {
    const noteElements = [...musicXml.matchAll(/<note(?:\s[^>]*)?>([\s\S]*?)<\/note>/g)];
    const visibleRests = noteElements.filter((note) =>
      note[1].includes('<rest') && !note[0].includes('print-object="no"'),
    ).length;
    const pairedCount = (startPattern: RegExp, stopPattern: RegExp) => Math.min(
      (musicXml.match(startPattern) ?? []).length,
      (musicXml.match(stopPattern) ?? []).length,
    );
    const setCoverage = (className: string, generated: number) => {
      const source = classCounts.get(className) ?? 0;
      if (source) runtimeConfidence[className] = Math.min(1, generated / source);
    };
    setCoverage('Rest', visibleRests);
    setCoverage('SlurSegment', pairedCount(/<slur type="start"/g, /<slur type="stop"/g));
    setCoverage('Tuplet', pairedCount(/<tuplet type="start"/g, /<tuplet type="stop"/g));
    setCoverage('HairpinSegment', pairedCount(/<wedge type="(?:crescendo|diminuendo)"/g, /<wedge type="stop"/g));
    setCoverage('PedalSegment', pairedCount(/<pedal type="start"/g, /<pedal type="stop"/g));
    setCoverage('Dynamic', (musicXml.match(/<dynamics>/g) ?? []).length);
    setCoverage('Accidental', (musicXml.match(/<accidental>(?:flat|sharp|natural)<\/accidental>/g) ?? []).length);
    const generatedPitchedNotes = noteElements.filter((note) => note[1].includes('<pitch>')).length;
    setCoverage('Note', generatedPitchedNotes);
    setCoverage('Stem', (musicXml.match(/<stem>(?:up|down)<\/stem>/g) ?? []).length);
    setCoverage('Beam', (musicXml.match(/<beam number="1">(?:begin|continue|end)<\/beam>/g) ?? []).length);
    setCoverage('Arpeggio', (musicXml.match(/<arpeggiate\/>/g) ?? []).length);
    setCoverage('Articulation', (musicXml.match(/<staccato\/>/g) ?? []).length);
    setCoverage('NoteDot', (musicXml.match(/<dot\/>/g) ?? []).length);
  }
  const present = [...classCounts].filter(([className]) => className in runtimeConfidence);
  const notationInstances = present.reduce((sum, [, count]) => sum + count, 0);
  const notationScore = notationInstances
    ? present.reduce((sum, [className, count]) => sum + runtimeConfidence[className] * count, 0) / notationInstances
    : 0;
  const score = (midiScore * 0.5 + structureScore * 0.2 + notationScore * 0.3) * 100;
  return {
    score: Math.round(score * 10) / 10,
    usable: score >= 90,
    midi: Math.round(midiScore * 1000) / 10,
    structure: Math.round(structureScore * 1000) / 10,
    notation: Math.round(notationScore * 1000) / 10,
  };
}