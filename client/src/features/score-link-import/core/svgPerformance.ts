import type { MidiFile, MidiNote, SvgPerformanceScore, SvgPlaybackAnchor } from '../../../types/midi';
import { parseSvgPage } from './svgScore';

function secondsAtBeat(file: MidiFile, targetBeat: number): number {
  const tempos = file.tempos.length ? file.tempos : [{ time: 0, bpm: 120 }];
  let beat = 0;
  for (let index = 0; index < tempos.length; index++) {
    const tempo = tempos[index];
    const next = tempos[index + 1];
    if (!next) return tempo.time + (targetBeat - beat) * 60 / tempo.bpm;
    const segmentBeats = (next.time - tempo.time) * tempo.bpm / 60;
    if (beat + segmentBeats >= targetBeat) {
      return tempo.time + (targetBeat - beat) * 60 / tempo.bpm;
    }
    beat += segmentBeats;
  }
  return 0;
}

function groupNotesByOnset(notes: MidiNote[]): MidiNote[][] {
  const groups: MidiNote[][] = [];
  for (const note of [...notes].sort((left, right) =>
    left.startTime - right.startTime || right.noteNumber - left.noteNumber,
  )) {
    const group = groups[groups.length - 1];
    if (!group || Math.abs(group[0].startTime - note.startTime) >= 0.0001) groups.push([note]);
    else group.push(note);
  }
  return groups;
}

function buildMeasureBeats(file: MidiFile, count: number): Array<{ start: number; end: number }> {
  const changes = file.timeSignatureChanges?.length
    ? file.timeSignatureChanges
    : [{ ...file.timeSignature, beat: 0, time: 0 }];
  const measures: Array<{ start: number; end: number }> = [];
  let beat = 0;
  let changeIndex = 0;
  while (measures.length < count) {
    while (
      changeIndex + 1 < changes.length
      && changes[changeIndex + 1].beat <= beat + 0.0001
    ) changeIndex++;
    const signature = changes[changeIndex];
    const length = signature.numerator * 4 / signature.denominator;
    const nextChange = changes[changeIndex + 1]?.beat;
    const end = nextChange !== undefined && nextChange < beat + length - 0.0001
      ? nextChange
      : beat + length;
    measures.push({ start: beat, end });
    beat = end;
  }
  return measures;
}

export function buildSvgPerformanceScore(file: MidiFile, pages: string[]): SvgPerformanceScore {
  const models = pages.map(parseSvgPage);
  const notes = file.tracks.flatMap((track) => track.notes);
  const totalMeasureCount = models.reduce((total, page) =>
    total + page.systems.reduce(
      (pageTotal, system) => pageTotal + Math.max(0, system.barlines.length - 1),
      0,
    ),
  0);
  const measureBeats = buildMeasureBeats(file, totalMeasureCount);
  let measureIndex = 0;
  const systems: SvgPerformanceScore['systems'] = [];

  models.forEach((page, pageIndex) => {
    page.systems.forEach((system) => {
      const systemAnchors: SvgPlaybackAnchor[] = [];
      const systemMeasures: SvgPerformanceScore['systems'][number]['measures'] = [];
      const systemStartMeasure = measureIndex;
      const measureCount = Math.max(0, system.barlines.length - 1);
      for (let localMeasure = 0; localMeasure < measureCount; localMeasure++, measureIndex++) {
        const measure = measureBeats[measureIndex];
        const startTime = secondsAtBeat(file, measure.start);
        const endTime = secondsAtBeat(file, measure.end);
        systemMeasures.push({
          startTime,
          endTime,
          left: system.barlines[localMeasure],
          right: system.barlines[localMeasure + 1],
          top: system.staves[0].top,
          bottom: system.staves[system.staves.length - 1].bottom,
        });
        const onsetGroups = groupNotesByOnset(notes.filter((note) =>
          note.startTime >= startTime - 0.0001 && note.startTime < endTime - 0.0001,
        ));
        const noteAnchors = system.noteAnchors
          .filter((anchor) => anchor.measure === localMeasure)
          .sort((left, right) => left.x - right.x || left.y - right.y);
        const columns: typeof noteAnchors[] = [];
        for (const anchor of noteAnchors) {
          const column = columns[columns.length - 1];
          if (!column || anchor.x - column[0].x > system.staves[0].spacing * 0.6) columns.push([anchor]);
          else column.push(anchor);
        }
        columns.forEach((column, columnIndex) => {
          if (!onsetGroups.length) return;
          const groupPosition = columns.length === 1
            ? 0
            : columnIndex * (onsetGroups.length - 1) / (columns.length - 1);
          const lowerIndex = Math.floor(groupPosition);
          const upperIndex = Math.min(onsetGroups.length - 1, Math.ceil(groupPosition));
          const lowerGroup = onsetGroups[lowerIndex];
          const upperGroup = onsetGroups[upperIndex];
          const fraction = groupPosition - lowerIndex;
          const time = lowerGroup[0].startTime
            + (upperGroup[0].startTime - lowerGroup[0].startTime) * fraction;
          const representativeGroup = fraction < 0.5 ? lowerGroup : upperGroup;
          const sortedNotes = [...representativeGroup].sort((left, right) => right.noteNumber - left.noteNumber);
          const points = column.map((anchor, anchorIndex) => ({
            x: anchor.x,
            y: anchor.y,
            staff: anchor.staff,
            pitch: sortedNotes[anchorIndex]?.noteNumber,
          }));
          systemAnchors.push({
            time,
            x: column.reduce((sum, anchor) => sum + anchor.x, 0) / column.length,
            points,
            pitches: representativeGroup.map((note) => note.noteNumber),
          });
        });
      }
      const startTime = secondsAtBeat(file, measureBeats[systemStartMeasure].start);
      const endTime = secondsAtBeat(file, measureBeats[measureIndex - 1].end);
      systems.push({
        page: pageIndex,
        top: system.top,
        bottom: system.bottom,
        staves: system.staves.map((staff) => ({ top: staff.top, bottom: staff.bottom })),
        left: system.barlines[0],
        right: system.barlines[system.barlines.length - 1],
        startTime,
        endTime,
        measures: systemMeasures,
        anchors: systemAnchors.sort((left, right) => left.time - right.time),
      });
    });
  });

  return {
    pages,
    pageSizes: models.map((page) => ({ width: page.width, height: page.height })),
    systems,
  };
}

export function getSvgPlaybackPosition(score: SvgPerformanceScore, time: number) {
  if (!score.systems.length) return null;
  const system = score.systems.find((candidate) =>
    time >= candidate.startTime && time < candidate.endTime,
  ) ?? (time < score.systems[0].startTime ? score.systems[0] : score.systems[score.systems.length - 1]);
  const anchors = system.anchors;
  const measure = system.measures?.find((candidate) =>
    time >= candidate.startTime && time < candidate.endTime,
  ) ?? system.measures?.[system.measures.length - 1];
  const measureAnchors = measure
    ? anchors.filter((candidate) => candidate.x >= measure.left && candidate.x <= measure.right)
    : anchors;
  if (!measureAnchors.length) {
    const progress = Math.max(0, Math.min(1,
      (time - system.startTime) / Math.max(0.001, system.endTime - system.startTime),
    ));
    return { system, measure, anchor: undefined, x: system.left + (system.right - system.left) * progress };
  }
  let index = -1;
  while (index + 1 < measureAnchors.length && measureAnchors[index + 1].time <= time) index++;
  const anchor = measureAnchors[index];
  const next = measureAnchors[index + 1];
  if (!anchor) return { system, measure, anchor: undefined, x: measure?.left ?? system.left };
  const x = next
    ? anchor.x + (next.x - anchor.x) * Math.max(0, Math.min(1,
      (time - anchor.time) / Math.max(0.001, next.time - anchor.time),
    ))
    : anchor.x + (system.right - anchor.x) * Math.max(0, Math.min(1,
      (time - anchor.time) / Math.max(0.001, system.endTime - anchor.time),
    ));
  return { system, measure, anchor, x };
}