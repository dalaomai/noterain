import { parseMidi, type MidiData, type MidiEvent } from 'midi-file';
import type { CollectedScore, ReconstructedScore } from './types';
import { parseSvgPage, type SvgPageModel } from './svgScore';

interface ScoreNote {
  pitch: number;
  onset: number;
  duration: number;
  velocity: number;
  staff: number;
  voice: number;
  arpeggiate: boolean;
  staccato: boolean;
  slurStarts: number[];
  slurStops: number[];
  tupletStarts: number[];
  tupletStops: number[];
  notationDuration?: number;
  writtenStep?: string;
  writtenOctave?: number;
  writtenAlter?: -1 | 0 | 1;
  explicitAccidental?: -1 | 0 | 1;
  stemDirection?: 'up' | 'down';
  beamLevel?: number;
}

interface StaffColumn {
  x: number;
  counts: [number, number];
  dotted: boolean;
  arpeggiate: boolean;
  staccato: [boolean, boolean];
  slurStarts: [number[], number[]];
  slurStops: [number[], number[]];
  tupletStarts: [number[], number[]];
  tupletStops: [number[], number[]];
  noteYs: [number[], number[]];
  accidentalByY: Array<{ y: number; alter: -1 | 0 | 1 }>;
  writtenPitches: [Array<{ y: number; step: string; octave: number }>, Array<{ y: number; step: string; octave: number }>];
  beamLevel: number;
  hookLevel: number;
  stemDirection: [ScoreNote['stemDirection'], ScoreNote['stemDirection']];
}

interface RestModel {
  x: number;
  staff: number;
  start: number;
  duration: number;
  type: string;
}

interface DirectionModel {
  start: number;
  xml: string;
}

interface TimedEvent<T extends MidiEvent = MidiEvent> {
  tick: number;
  event: T;
}

interface MeasureModel {
  index: number;
  start: number;
  duration: number;
  pageStart: boolean;
  systemStart: boolean;
  staffAnchorCounts: [number, number];
  staffColumns: StaffColumn[];
  clefs?: Array<'G' | 'F'>;
  rests: RestModel[];
  directions: DirectionModel[];
  widthTenths: number;
  systemLayout?: {
    leftMargin: number;
    rightMargin: number;
    topSystemDistance?: number;
    systemDistance?: number;
  };
}

interface ScoreModel {
  divisions: number;
  measures: MeasureModel[];
  notes: ScoreNote[];
  tempos: TimedEvent<Extract<MidiEvent, { type: 'setTempo' }>>[];
  timeSignatures: TimedEvent<Extract<MidiEvent, { type: 'timeSignature' }>>[];
  keySignatures: TimedEvent<Extract<MidiEvent, { type: 'keySignature' }>>[];
  pageLayout: {
    width: number;
    height: number;
  };
}

const PERFORMANCE_GATE = 0.95;

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[character] ?? character);
}

function timedEvents<T extends MidiEvent['type']>(midi: MidiData, type: T) {
  const result: TimedEvent<Extract<MidiEvent, { type: T }>>[] = [];
  for (const track of midi.tracks) {
    let tick = 0;
    for (const event of track) {
      tick += event.deltaTime;
      if (event.type === type) result.push({ tick, event } as TimedEvent<Extract<MidiEvent, { type: T }>>);
    }
  }
  return result.sort((left, right) => left.tick - right.tick);
}

function extractNotes(
  midi: MidiData,
  divisions: number,
): Array<Omit<ScoreNote, 'voice' | 'arpeggiate' | 'staccato' | 'slurStarts' | 'slurStops' | 'tupletStarts' | 'tupletStops'>> {
  const grid = divisions / 8;
  const notes: Array<Omit<ScoreNote, 'voice' | 'arpeggiate' | 'staccato' | 'slurStarts' | 'slurStops' | 'tupletStarts' | 'tupletStops'>> = [];
  midi.tracks.forEach((track, trackIndex) => {
    const active = new Map<string, Array<{ onset: number; velocity: number }>>();
    let tick = 0;
    for (const event of track) {
      tick += event.deltaTime;
      if (event.type === 'noteOn' && event.velocity > 0) {
        const key = `${event.channel}:${event.noteNumber}`;
        const pending = active.get(key) ?? [];
        pending.push({ onset: tick, velocity: event.velocity });
        active.set(key, pending);
      } else if (event.type === 'noteOff' || (event.type === 'noteOn' && event.velocity === 0)) {
        const key = `${event.channel}:${event.noteNumber}`;
        const pending = active.get(key);
        const started = pending?.shift();
        if (!started) continue;
        const onset = Math.round(started.onset / grid) * grid;
        const performedDuration = Math.max(grid, tick - started.onset);
        notes.push({
          pitch: event.noteNumber,
          onset,
          duration: Math.max(grid, Math.round((performedDuration / PERFORMANCE_GATE) / grid) * grid),
          velocity: started.velocity,
          staff: Math.min(trackIndex + 1, 2),
        });
        if (!pending?.length) active.delete(key);
      }
    }
  });

  return notes;
}

function assignStavesAndVoices(
  notes: Array<Omit<ScoreNote, 'voice' | 'arpeggiate' | 'staccato' | 'slurStarts' | 'slurStops' | 'tupletStarts' | 'tupletStops'>>,
  measures: MeasureModel[],
  divisions: number,
): ScoreNote[] {
  const assigned = notes.map((note) => ({ ...note }));
  for (const measure of measures) {
    const measureNotes = assigned
      .filter((note) => note.onset >= measure.start && note.onset < measure.start + measure.duration)
      .sort((left, right) => left.onset - right.onset || right.pitch - left.pitch);
    const [upperAnchors, lowerAnchors] = measure.staffAnchorCounts;
    const onsetGroups = new Map<number, typeof measureNotes>();
    for (const note of measureNotes) {
      const group = onsetGroups.get(note.onset) ?? [];
      group.push(note);
      onsetGroups.set(note.onset, group);
    }
    const groups = [...onsetGroups.values()];
    if (groups.length && measure.staffColumns.length) {
      const columnOnsets = measure.staffColumns.map((column, columnIndex) => ({
        x: column.x,
        onset: groups.length === 1
          ? groups[0][0].onset - measure.start
          : groups[Math.round(columnIndex * (groups.length - 1) / Math.max(1, measure.staffColumns.length - 1))][0].onset - measure.start,
      }));
      for (const rest of measure.rests) {
        const nearest = columnOnsets.reduce((best, candidate) =>
          Math.abs(candidate.x - rest.x) < best.distance
            ? { onset: candidate.onset, distance: Math.abs(candidate.x - rest.x) }
            : best,
        { onset: rest.start, distance: Number.POSITIVE_INFINITY });
        if (nearest.distance < 20) rest.start = nearest.onset;
      }
      groups.forEach((group, groupIndex) => {
        const columnIndex = groups.length === 1
          ? 0
          : Math.round(groupIndex * (measure.staffColumns.length - 1) / (groups.length - 1));
        const column = measure.staffColumns[columnIndex];
        const [upper, lower] = column.counts;
        const upperQuota = Math.round(group.length * upper / Math.max(1, upper + lower));
        group
          .sort((left, right) => right.pitch - left.pitch)
          .forEach((note, noteIndex) => {
            note.staff = noteIndex < upperQuota ? 1 : 2;
            const staffIndex = note.staff - 1;
            const staffNoteIndex = noteIndex - (staffIndex ? upperQuota : 0);
            const noteY = column.noteYs[staffIndex][staffNoteIndex];
            const geometricAccidental = noteY === undefined
              ? undefined
              : column.accidentalByY
                .filter((item) => {
                  const candidateYs = item.alter === 1 ? [item.y + 3, item.y - 2] : [item.y];
                  return candidateYs.some((accidentalY) => Math.abs(accidentalY - noteY) < 1);
                })
                .sort((left, right) => {
                  const distance = (item: typeof left) => Math.min(
                    ...(item.alter === 1 ? [item.y + 3, item.y - 2] : [item.y])
                      .map((accidentalY) => Math.abs(accidentalY - noteY)),
                  );
                  return distance(left) - distance(right);
                })[0];
            const accidentalSpelling = geometricAccidental
              ? (() => {
                const steps = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
                const naturalPitchClasses = [0, 2, 4, 5, 7, 9, 11];
                const pitchClass = ((note.pitch % 12) + 12) % 12;
                const stepIndex = naturalPitchClasses.findIndex((natural) =>
                  (natural + geometricAccidental.alter + 12) % 12 === pitchClass,
                );
                if (stepIndex < 0) return undefined;
                const octave = Math.floor((note.pitch - naturalPitchClasses[stepIndex] - geometricAccidental.alter) / 12) - 1;
                return { step: steps[stepIndex], octave, alter: geometricAccidental.alter };
              })()
              : undefined;
            const naturalPitchClasses = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 } as Record<string, number>;
            const writtenMatches = column.writtenPitches[staffIndex].flatMap((candidate) => {
              const accidental = column.accidentalByY
                .filter((item) => {
                  const noteY = item.y + (item.alter === 1 ? 3 : 0);
                  return Math.abs(noteY - candidate.y) < 1;
                })
                .sort((left, right) => {
                  const leftY = left.y + (left.alter === 1 ? 3 : 0);
                  const rightY = right.y + (right.alter === 1 ? 3 : 0);
                  return Math.abs(leftY - candidate.y) - Math.abs(rightY - candidate.y);
                })[0];
              const natural = naturalPitchClasses[candidate.step];
              const alters: Array<-1 | 0 | 1> = accidental ? [accidental.alter] : [-1, 0, 1];
              return alters.map((alter) => ({
                ...candidate,
                alter,
                accidental,
                midi: (candidate.octave + 1) * 12 + natural + alter,
              }));
            }).filter((candidate) => candidate.midi === note.pitch);
            const writtenPitch = writtenMatches.sort((left, right) => {
              const leftPenalty = left.accidental ? 0 : Math.abs(left.alter);
              const rightPenalty = right.accidental ? 0 : Math.abs(right.alter);
              return leftPenalty - rightPenalty;
            })[0];
            Object.assign(note, {
              arpeggiate: column.arpeggiate,
              staccato: column.staccato[staffIndex],
              slurStarts: column.slurStarts[staffIndex],
              slurStops: column.slurStops[staffIndex],
              tupletStarts: column.tupletStarts[staffIndex],
              tupletStops: column.tupletStops[staffIndex],
              notationDuration: (() => {
                const level = Math.max(column.beamLevel, column.hookLevel);
                if (level <= 0) return undefined;
                const base = divisions / (2 ** level);
                return column.dotted ? base * 1.5 : base;
              })(),
              writtenStep: accidentalSpelling?.step ?? writtenPitch?.step,
              writtenOctave: accidentalSpelling?.octave ?? writtenPitch?.octave,
              writtenAlter: accidentalSpelling?.alter ?? writtenPitch?.alter,
              explicitAccidental: accidentalSpelling?.alter,
              stemDirection: column.stemDirection[staffIndex],
              beamLevel: column.beamLevel,
            });
          });
      });
    } else if (measureNotes.length && upperAnchors + lowerAnchors > 0) {
      const upperQuota = Math.round(measureNotes.length * upperAnchors / (upperAnchors + lowerAnchors));
      [...measureNotes]
        .sort((left, right) => right.pitch - left.pitch)
        .forEach((note, index) => { note.staff = index < upperQuota ? 1 : 2; });
    }
  }

  for (const note of assigned) {
    if (!('notationDuration' in note) || !note.notationDuration) continue;
    const nextOnset = assigned
      .filter((candidate) => candidate.staff === note.staff && candidate.onset > note.onset)
      .reduce((next, candidate) => Math.min(next, candidate.onset), Number.POSITIVE_INFINITY);
    const maximum = Number.isFinite(nextOnset) ? nextOnset - note.onset : note.notationDuration;
    note.duration = Math.min(note.notationDuration, maximum);
  }

  const result: ScoreNote[] = [];
  for (const staff of [1, 2]) {
    const groups = new Map<string, typeof notes>();
    for (const note of assigned.filter((candidate) => candidate.staff === staff)) {
      const key = `${note.onset}:${note.duration}`;
      const group = groups.get(key) ?? [];
      group.push(note);
      groups.set(key, group);
    }
    const voiceBase = staff === 1 ? 1 : 1001;
    const voiceEnds: number[] = [];
    for (const group of [...groups.values()].sort((left, right) => left[0].onset - right[0].onset)) {
      const onset = group[0].onset;
      const direction = group.find((note) => 'stemDirection' in note)?.stemDirection;
      const preferred = direction === 'down' ? 1 : 0;
      let voiceIndex = voiceEnds[preferred] === undefined || voiceEnds[preferred] <= onset
        ? preferred
        : voiceEnds.findIndex((end) => end <= onset);
      if (voiceIndex < 0) voiceIndex = voiceEnds.length;
      voiceEnds[voiceIndex] = onset + Math.max(...group.map((note) => note.duration));
      for (const note of group) {
        result.push({
          ...note,
          voice: voiceBase + voiceIndex,
          arpeggiate: 'arpeggiate' in note && note.arpeggiate === true,
          staccato: 'staccato' in note && note.staccato === true,
          slurStarts: 'slurStarts' in note ? note.slurStarts as number[] : [],
          slurStops: 'slurStops' in note ? note.slurStops as number[] : [],
          tupletStarts: 'tupletStarts' in note ? note.tupletStarts as number[] : [],
          tupletStops: 'tupletStops' in note ? note.tupletStops as number[] : [],
        });
      }
    }
  }
  const slurStarts = new Set(result.flatMap((note) => note.slurStarts));
  const slurStops = new Set(result.flatMap((note) => note.slurStops));
  for (const note of result) {
    note.slurStarts = note.slurStarts.filter((number) => slurStops.has(number));
    note.slurStops = note.slurStops.filter((number) => slurStarts.has(number));
  }
  return result;
}

function latestAt<T extends MidiEvent>(events: TimedEvent<T>[], tick: number): TimedEvent<T> | undefined {
  return events.filter((entry) => entry.tick <= tick).pop();
}

function measureDurationAt(
  tick: number,
  divisions: number,
  signatures: ScoreModel['timeSignatures'],
): number {
  const signature = latestAt(signatures, tick)?.event;
  return Math.round((signature?.numerator ?? 4) * divisions * 4 / (signature?.denominator ?? 4));
}

function buildModel(midi: MidiData, pages: SvgPageModel[]): ScoreModel {
  const divisions = midi.header.ticksPerBeat;
  if (!divisions) throw new Error('SMPTE_MIDI_TIME_DIVISION_UNSUPPORTED');
  const timeSignatures = timedEvents(midi, 'timeSignature');
  const keySignatures = timedEvents(midi, 'keySignature');
  const tempos = timedEvents(midi, 'setTempo');
  const performanceNotes = extractNotes(midi, divisions);
  const measures: MeasureModel[] = [];
  let start = 0;
  for (const [pageIndex, page] of pages.entries()) {
    for (const [systemIndex, system] of page.systems.entries()) {
      const tenthsPerUnit = 10 / system.staves[0].spacing;
      const count = Math.max(1, system.barlines.length - 1);
      for (let localIndex = 0; localIndex < count; localIndex++) {
        const duration = measureDurationAt(start, divisions, timeSignatures);
        const measureLeft = system.barlines[localIndex];
        const measureRight = system.barlines[localIndex + 1];
        const toMeasureOffset = (x: number) => Math.max(0, Math.min(
          duration,
          Math.round(((x - measureLeft) / Math.max(1, measureRight - measureLeft) * duration) / (divisions / 8)) * (divisions / 8),
        ));
        const anchors = system.noteAnchors
          .filter((note) => note.measure === localIndex)
          .sort((left, right) => left.x - right.x);
        const columns: Array<{
          x: number;
          minY: number;
          maxY: number;
          counts: [number, number];
          noteYs: [number[], number[]];
        }> = [];
        for (const anchor of anchors) {
          let column = columns[columns.length - 1];
          if (!column || anchor.x - column.x > system.staves[0].spacing * 0.6) {
            column = { x: anchor.x, minY: anchor.y, maxY: anchor.y, counts: [0, 0], noteYs: [[], []] };
            columns.push(column);
          } else {
            column.x = (column.x + anchor.x) / 2;
            column.minY = Math.min(column.minY, anchor.y);
            column.maxY = Math.max(column.maxY, anchor.y);
          }
          column.counts[anchor.staff - 1] += 1;
          column.noteYs[anchor.staff - 1].push(anchor.y);
        }
        const columnSlurStarts: Array<[number[], number[]]> = columns.map(() => [[], []]);
        const columnSlurStops: Array<[number[], number[]]> = columns.map(() => [[], []]);
        const columnTupletStarts: Array<[number[], number[]]> = columns.map(() => [[], []]);
        const columnTupletStops: Array<[number[], number[]]> = columns.map(() => [[], []]);
        system.slurs.forEach((slur, slurIndex) => {
          if (!columns.length || slur.startX === undefined || slur.endX === undefined) return;
          const startIndex = columns.reduce((best, column, columnIndex) =>
            Math.abs(column.x - slur.startX!) < best.distance
              ? { index: columnIndex, distance: Math.abs(column.x - slur.startX!) }
              : best,
          { index: -1, distance: Number.POSITIVE_INFINITY });
          const stopIndex = columns.reduce((best, column, columnIndex) =>
            Math.abs(column.x - slur.endX!) < best.distance
              ? { index: columnIndex, distance: Math.abs(column.x - slur.endX!) }
              : best,
          { index: -1, distance: Number.POSITIVE_INFINITY });
          const limit = system.staves[0].spacing * 2;
          if (
            startIndex.index < 0 || stopIndex.index < 0
            || startIndex.index === stopIndex.index
            || startIndex.distance > limit || stopIndex.distance > limit
          ) return;
          const nearestStaff = (y: number | undefined) => system.staves.reduce((best, candidate, staffIndex) => {
            const distance = Math.abs((y ?? 0) - (candidate.top + candidate.bottom) / 2);
            return distance < best.distance ? { index: staffIndex, distance } : best;
          }, { index: 0, distance: Number.POSITIVE_INFINITY }).index;
          const startStaff = nearestStaff(slur.startY);
          const stopStaff = nearestStaff(slur.endY);
          if (startStaff !== stopStaff) return;
          const number = measures.length * 1000 + slurIndex + 1;
          columnSlurStarts[startIndex.index][startStaff].push(number);
          columnSlurStops[stopIndex.index][stopStaff].push(number);
        });
        system.tuplets
          .filter((tuplet) =>
            tuplet.x >= system.barlines[localIndex]
            && tuplet.x < system.barlines[localIndex + 1],
          )
          .forEach((tuplet, tupletIndex) => {
            if (columns.length < 3) return;
            const centerIndex = columns.reduce((best, column, columnIndex) =>
              Math.abs(column.x - tuplet.x) < best.distance
                ? { index: columnIndex, distance: Math.abs(column.x - tuplet.x) }
                : best,
            { index: -1, distance: Number.POSITIVE_INFINITY }).index;
            if (centerIndex < 0) return;
            const startIndex = Math.max(0, Math.min(columns.length - 3, centerIndex - 1));
            const stopIndex = startIndex + 2;
            const staff = system.staves.reduce((best, candidate, staffIndex) => {
              const distance = Math.abs(tuplet.y - (candidate.top + candidate.bottom) / 2);
              return distance < best.distance ? { index: staffIndex, distance } : best;
            }, { index: 0, distance: Number.POSITIVE_INFINITY }).index;
            const number = measures.length * 1000 + tupletIndex + 1;
            columnTupletStarts[startIndex][staff].push(number);
            columnTupletStops[stopIndex][staff].push(number);
          });
        measures.push({
          index: measures.length,
          start,
          duration,
          pageStart: pageIndex > 0 && systemIndex === 0 && localIndex === 0,
          systemStart: systemIndex > 0 && localIndex === 0,
          staffAnchorCounts: [
            anchors.filter((note) => note.staff === 1).length,
            anchors.filter((note) => note.staff === 2).length,
          ],
          staffColumns: columns.map((column, columnIndex) => {
            const nearestStaff = (y: number) => system.staves.reduce((best, staff, staffIndex) => {
              const distance = Math.abs(y - (staff.top + staff.bottom) / 2);
              return distance < best.distance ? { index: staffIndex, distance } : best;
            }, { index: 0, distance: Number.POSITIVE_INFINITY }).index;
            const staccato: [boolean, boolean] = [false, false];
            for (const articulation of system.articulations) {
              if (Math.abs(articulation.x - column.x) < system.staves[0].spacing * 1.2) {
                staccato[nearestStaff(articulation.y)] = true;
              }
            }
            return {
            x: column.x,
            counts: column.counts,
            dotted: system.noteDots.some((dot) =>
              dot.x > column.x
              && dot.x - column.x < system.staves[0].spacing * 2.5
              && dot.y >= column.minY - system.staves[0].spacing
              && dot.y <= column.maxY + system.staves[0].spacing,
            ),
            arpeggiate: system.arpeggios.some((arpeggio) =>
              arpeggio.maxX < column.x
              && column.x - arpeggio.maxX < system.staves[0].spacing * 3
              && arpeggio.minY <= column.maxY + system.staves[0].spacing
              && arpeggio.maxY >= column.minY - system.staves[0].spacing,
            ),
            staccato,
            slurStarts: columnSlurStarts[columnIndex],
            slurStops: columnSlurStops[columnIndex],
            tupletStarts: columnTupletStarts[columnIndex],
            tupletStops: columnTupletStops[columnIndex],
            noteYs: [
              [...column.noteYs[0]].sort((left, right) => left - right),
              [...column.noteYs[1]].sort((left, right) => left - right),
            ],
            writtenPitches: system.staves.map((staff, staffIndex) => {
              const sign = system.clefs[staffIndex] ?? (staffIndex === 0 ? 'G' : 'F');
              const bottomDiatonic = sign === 'G' ? 32 : 18;
              return [...column.noteYs[staffIndex]]
                .sort((left, right) => left - right)
                .map((y) => {
                  const diatonic = bottomDiatonic + Math.round((staff.bottom - y) / (staff.spacing / 2));
                  const normalized = ((diatonic % 7) + 7) % 7;
                  return {
                    y,
                    step: ['C', 'D', 'E', 'F', 'G', 'A', 'B'][normalized],
                    octave: Math.floor(diatonic / 7),
                  };
                });
            }) as StaffColumn['writtenPitches'],
            accidentalByY: system.accidentals
              .filter((accidental) =>
                accidental.x < column.x
                && column.x - accidental.x < system.staves[0].spacing * 4,
              )
              .map((accidental) => ({ y: accidental.y, alter: accidental.alter })),
            beamLevel: system.beams.filter((beam) =>
              column.x >= beam.minX - system.staves[0].spacing
              && column.x <= beam.maxX + system.staves[0].spacing,
            ).length,
            hookLevel: system.hooks.filter((hook) =>
              Math.abs((hook.minX + hook.maxX) / 2 - column.x) < system.staves[0].spacing * 1.5,
            ).length,
            stemDirection: system.staves.map((_, staffIndex) => {
              const ys = column.noteYs[staffIndex];
              if (!ys.length) return undefined;
              const centerY = ys.reduce((sum, y) => sum + y, 0) / ys.length;
              const stem = system.stems
                .filter((candidate) =>
                  Math.abs((candidate.minX + candidate.maxX) / 2 - column.x) < system.staves[0].spacing * 1.5,
                )
                .sort((left, right) => {
                  const leftDistance = Math.min(Math.abs(left.minY - centerY), Math.abs(left.maxY - centerY));
                  const rightDistance = Math.min(Math.abs(right.minY - centerY), Math.abs(right.maxY - centerY));
                  return leftDistance - rightDistance;
                })[0];
              if (!stem) return undefined;
              return (stem.minY + stem.maxY) / 2 < centerY ? 'up' : 'down';
            }) as StaffColumn['stemDirection'],
          };}),
          clefs: localIndex === 0 ? system.clefs : undefined,
          rests: system.restAnchors
            .filter((rest) => rest.measure === localIndex)
            .flatMap((rest) => {
              const left = system.barlines[localIndex];
              const right = system.barlines[localIndex + 1];
              const grid = divisions / 8;
              const start = Math.max(0, Math.min(
                duration - grid,
                Math.round(((rest.x - left) / Math.max(1, right - left) * duration) / grid) * grid,
              ));
              if (rest.width > 7 && rest.height < 4) {
                return [{ x: rest.x, staff: rest.staff, start: 0, duration, type: 'whole' }];
              }
              if (rest.height > 12) return [{ x: rest.x, staff: rest.staff, start, duration: divisions, type: 'quarter' }];
              if (rest.height > 7) return [{ x: rest.x, staff: rest.staff, start, duration: divisions / 2, type: 'eighth' }];
              return [];
            }),
          directions: system.hairpins.flatMap((hairpin) => {
            if (hairpin.startX === undefined || hairpin.endX === undefined) return [];
            const events: DirectionModel[] = [];
            if (hairpin.startX >= measureLeft && hairpin.startX < measureRight) {
              events.push({ start: toMeasureOffset(hairpin.startX), xml: `<wedge type="${hairpin.type}"/>` });
            }
            if (hairpin.endX >= measureLeft && hairpin.endX <= measureRight) {
              events.push({ start: toMeasureOffset(hairpin.endX), xml: '<wedge type="stop"/>' });
            }
            return events;
          }).concat(system.pedals
            .filter((pedal) =>
              pedal.startX !== undefined
              && pedal.endX !== undefined
              && pedal.startX >= system.barlines[0]
              && pedal.endX <= system.barlines[system.barlines.length - 1],
            )
            .flatMap((pedal) => {
            if (pedal.startX === undefined || pedal.endX === undefined) return [];
            const events: DirectionModel[] = [];
            if (pedal.startX >= measureLeft && pedal.startX < measureRight) {
              events.push({ start: toMeasureOffset(pedal.startX), xml: '<pedal type="start" line="yes" sign="yes"/>' });
            }
            if (pedal.endX >= measureLeft && pedal.endX <= measureRight) {
              events.push({ start: toMeasureOffset(pedal.endX), xml: '<pedal type="stop" line="yes" sign="yes"/>' });
            }
            return events;
          })).concat(system.dynamics.flatMap((dynamic) => {
            const centerX = (dynamic.minX + dynamic.maxX) / 2;
            if (centerX < measureLeft || centerX >= measureRight) return [];
            const offset = toMeasureOffset(centerX);
            let nearby = performanceNotes.filter((note) =>
              Math.abs(note.onset - (start + offset)) <= divisions,
            );
            if (!nearby.length) {
              const measureNotes = performanceNotes
                .filter((note) => note.onset >= start && note.onset < start + duration)
                .sort((leftNote, rightNote) =>
                  Math.abs(leftNote.onset - (start + offset))
                  - Math.abs(rightNote.onset - (start + offset)),
                );
              nearby = measureNotes.slice(0, 1);
            }
            if (!nearby.length) return [];
            const velocity = nearby.reduce((sum, note) => sum + note.velocity, 0) / nearby.length;
            const mark = velocity < 40 ? 'pp' : velocity < 55 ? 'p' : velocity < 70 ? 'mp' : velocity < 85 ? 'mf' : velocity < 105 ? 'f' : 'ff';
            return [{ start: offset, xml: `<dynamics><${mark}/></dynamics>` }];
          })),
          widthTenths: (system.barlines[localIndex + 1] - system.barlines[localIndex]) * tenthsPerUnit,
          systemLayout: localIndex === 0 ? {
            leftMargin: system.barlines[0] * tenthsPerUnit,
            rightMargin: (page.width - system.barlines[system.barlines.length - 1]) * tenthsPerUnit,
            ...(systemIndex === 0
              ? { topSystemDistance: system.top * tenthsPerUnit }
              : { systemDistance: (system.top - page.systems[systemIndex - 1].bottom) * tenthsPerUnit }),
          } : undefined,
        });
        start += duration;
      }
    }
  }
  const scoreEnd = measures[measures.length - 1]?.start + measures[measures.length - 1]?.duration;
  const notes = assignStavesAndVoices(performanceNotes, measures, divisions)
    .filter((note) => note.onset < scoreEnd)
    .map((note) => ({ ...note, duration: Math.min(note.duration, scoreEnd - note.onset) }));
  if (!measures.length || !notes.length) throw new Error('NOTATION_RECONSTRUCTION_UNAVAILABLE');
  const referenceSpacing = pages[0]?.systems[0]?.staves[0]?.spacing ?? 5;
  const tenthsPerUnit = 10 / referenceSpacing;
  return {
    divisions,
    measures,
    notes,
    tempos,
    timeSignatures,
    keySignatures,
    pageLayout: {
      width: (pages[0]?.width ?? 595.275) * tenthsPerUnit,
      height: (pages[0]?.height ?? 841.89) * tenthsPerUnit,
    },
  };
}

function pitchXml(
  midiPitch: number,
  fifths: number,
  written?: Pick<ScoreNote, 'writtenStep' | 'writtenOctave' | 'writtenAlter'>,
): string {
  if (written?.writtenStep !== undefined && written.writtenOctave !== undefined) {
    return `<pitch><step>${written.writtenStep}</step>${written.writtenAlter ? `<alter>${written.writtenAlter}</alter>` : ''}<octave>${written.writtenOctave}</octave></pitch>`;
  }
  const sharp = ['C', 'C', 'D', 'D', 'E', 'F', 'F', 'G', 'G', 'A', 'A', 'B'];
  const sharpAlter = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
  const flat = ['C', 'D', 'D', 'E', 'E', 'F', 'G', 'G', 'A', 'A', 'B', 'B'];
  const flatAlter = [0, -1, 0, -1, 0, 0, -1, 0, -1, 0, -1, 0];
  const pitchClass = ((midiPitch % 12) + 12) % 12;
  const step = (fifths < 0 ? flat : sharp)[pitchClass];
  const alter = (fifths < 0 ? flatAlter : sharpAlter)[pitchClass];
  return `<pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ''}<octave>${Math.floor(midiPitch / 12) - 1}</octave></pitch>`;
}

function inferredAlter(midiPitch: number, fifths: number, note: ScoreNote): number {
  if (note.writtenStep !== undefined && note.writtenAlter !== undefined) return note.writtenAlter;
  const pitchClass = ((midiPitch % 12) + 12) % 12;
  const sharpAlter = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
  const flatAlter = [0, -1, 0, -1, 0, 0, -1, 0, -1, 0, -1, 0];
  return (fifths < 0 ? flatAlter : sharpAlter)[pitchClass];
}

function attributesXml(model: ScoreModel, measure: MeasureModel): string {
  const changedTime = model.timeSignatures.find((entry) => entry.tick === measure.start)?.event;
  const changedKey = model.keySignatures.find((entry) => entry.tick === measure.start)?.event;
  if (measure.index > 0 && !changedTime && !changedKey && !measure.clefs) return '';
  const time = changedTime ?? latestAt(model.timeSignatures, measure.start)?.event;
  const key = changedKey ?? latestAt(model.keySignatures, measure.start)?.event;
  const clefs = measure.clefs ?? (measure.index === 0 ? ['G', 'F'] as const : []);
  return `<attributes><divisions>${model.divisions}</divisions>${key ? `<key><fifths>${key.key}</fifths><mode>${key.scale ? 'minor' : 'major'}</mode></key>` : ''}${time ? `<time><beats>${time.numerator}</beats><beat-type>${time.denominator}</beat-type></time>` : ''}${measure.index === 0 ? '<staves>2</staves>' : ''}${clefs.map((sign, index) => `<clef number="${index + 1}"><sign>${sign}</sign><line>${sign === 'G' ? 2 : 4}</line></clef>`).join('')}</attributes>`;
}

function directionsXml(model: ScoreModel, measure: MeasureModel): string {
  const tempos = model.tempos.filter((tempo) => tempo.tick >= measure.start && tempo.tick < measure.start + measure.duration)
    .map((tempo) => `<direction placement="above"><offset>${tempo.tick - measure.start}</offset><sound tempo="${60_000_000 / tempo.event.microsecondsPerBeat}"/></direction>`)
    .join('');
  const notation = measure.directions
    .sort((left, right) => left.start - right.start)
    .map((direction) => `<direction placement="below"><direction-type>${direction.xml}</direction-type>${direction.start ? `<offset>${direction.start}</offset>` : ''}</direction>`)
    .join('');
  return tempos + notation;
}

interface NoteFragment extends ScoreNote {
  start: number;
  length: number;
  tieStart: boolean;
  tieStop: boolean;
}

interface NotatedFragment extends NoteFragment {
  type: string;
  dots: number;
}

const NOTATED_VALUES = [
  [4, 'whole', 0], [3, 'half', 1], [2, 'half', 0], [1.5, 'quarter', 1],
  [1, 'quarter', 0], [0.75, 'eighth', 1], [0.5, 'eighth', 0], [0.375, '16th', 1],
  [0.25, '16th', 0], [0.125, '32nd', 0], [0.09375, '64th', 1], [0.0625, '64th', 0],
] as const;

function splitNotatedFragment(note: NoteFragment, divisions: number): NotatedFragment[] {
  const pieces: NotatedFragment[] = [];
  let remaining = note.length;
  let start = note.start;
  while (remaining > 0) {
    const value = NOTATED_VALUES.find(([beats]) => Math.round(beats * divisions) <= remaining);
    if (!value) throw new Error(`UNREPRESENTABLE_NOTE_DURATION:${remaining}:${note.start}:${note.length}`);
    const length = Math.round(value[0] * divisions);
    pieces.push({
      ...note,
      start,
      length,
      type: value[1],
      dots: value[2],
      tieStop: note.tieStop || pieces.length > 0,
      tieStart: note.tieStart || remaining > length,
      arpeggiate: note.arpeggiate && pieces.length === 0,
      staccato: note.staccato && pieces.length === 0,
      slurStarts: pieces.length === 0 ? note.slurStarts : [],
      slurStops: remaining === length ? note.slurStops : [],
      tupletStarts: pieces.length === 0 ? note.tupletStarts : [],
      tupletStops: remaining === length ? note.tupletStops : [],
    });
    start += length;
    remaining -= length;
  }
  return pieces;
}

function hiddenRestsXml(duration: number, divisions: number, voice: number, staff: number): string {
  let remaining = duration;
  let xml = '';
  while (remaining > 0) {
    const value = NOTATED_VALUES.find(([beats]) => Math.round(beats * divisions) <= remaining);
    if (!value) throw new Error(`UNREPRESENTABLE_REST_DURATION:${remaining}`);
    const length = Math.round(value[0] * divisions);
    xml += `<note print-object="no" print-spacing="no"><rest/><duration>${length}</duration><voice>${voice}</voice><type>${value[1]}</type>${'<dot/>'.repeat(value[2])}<staff>${staff}</staff></note>`;
    remaining -= length;
  }
  return xml;
}

function gapXml(
  start: number,
  duration: number,
  divisions: number,
  voice: number,
  staff: number,
  rests: RestModel[],
): string {
  const matching = rests
    .filter((rest) => rest.start >= start && rest.start + rest.duration <= start + duration)
    .sort((left, right) => left.start - right.start);
  if (!matching.length) return hiddenRestsXml(duration, divisions, voice, staff);
  let cursor = start;
  let xml = '';
  for (const rest of matching) {
    if (rest.start > cursor) xml += hiddenRestsXml(rest.start - cursor, divisions, voice, staff);
    xml += `<note><rest${rest.type === 'whole' ? ' measure="yes"' : ''}/><duration>${rest.duration}</duration><voice>${voice}</voice><type>${rest.type}</type><staff>${staff}</staff></note>`;
    cursor = rest.start + rest.duration;
  }
  if (cursor < start + duration) xml += hiddenRestsXml(start + duration - cursor, divisions, voice, staff);
  return xml;
}

function fragmentsForMeasure(model: ScoreModel, measure: MeasureModel): NoteFragment[] {
  const end = measure.start + measure.duration;
  return model.notes.flatMap((note) => {
    const noteEnd = note.onset + note.duration;
    if (note.onset >= end || noteEnd <= measure.start) return [];
    const absoluteStart = Math.max(note.onset, measure.start);
    const absoluteEnd = Math.min(noteEnd, end);
    return [{
      ...note,
      start: absoluteStart - measure.start,
      length: absoluteEnd - absoluteStart,
      tieStop: note.onset < measure.start,
      tieStart: noteEnd > end,
    }];
  });
}

function voicesXml(model: ScoreModel, measure: MeasureModel): string {
  const fragments = fragmentsForMeasure(model, measure)
    .flatMap((note) => splitNotatedFragment(note, model.divisions));
  const fifths = latestAt(model.keySignatures, measure.start)?.event.key ?? 0;
  const voices = new Map<string, NotatedFragment[]>();
  for (const note of fragments) {
    const key = `${note.staff}:${note.voice}`;
    const voice = voices.get(key) ?? [];
    voice.push(note);
    voices.set(key, voice);
  }
  const restsByVoice = new Map<string, RestModel[]>();
  const staffsWithVoices = new Set([...voices.keys()].map((key) => Number(key.split(':')[0])));
  const emptyStaffRests = measure.rests.filter((rest) =>
    rest.start === 0
    && rest.duration === measure.duration
    && !staffsWithVoices.has(rest.staff),
  );
  for (const rest of measure.rests) {
    const candidates = [...voices.entries()].flatMap(([key, notes]) => {
      const [staff] = key.split(':').map(Number);
      if (staff !== rest.staff) return [];
      const intervals = notes
        .map((note) => ({ start: note.start, end: note.start + note.length }))
        .sort((left, right) => left.start - right.start);
      const gaps: Array<{ start: number; end: number }> = [];
      let cursor = 0;
      for (const interval of intervals) {
        if (interval.start > cursor) gaps.push({ start: cursor, end: interval.start });
        cursor = Math.max(cursor, interval.end);
      }
      if (cursor < measure.duration) gaps.push({ start: cursor, end: measure.duration });
      const gap = gaps.find((candidate) =>
        rest.start >= candidate.start
        && rest.start + rest.duration <= candidate.end,
      );
      return gap ? [{ key, waste: gap.end - gap.start - rest.duration }] : [];
    }).sort((left, right) => left.waste - right.waste);
    const target = candidates[0]?.key;
    if (!target) continue;
    const assigned = restsByVoice.get(target) ?? [];
    if (!assigned.some((candidate) =>
      rest.start < candidate.start + candidate.duration
      && rest.start + rest.duration > candidate.start,
    )) {
      assigned.push(rest);
      restsByVoice.set(target, assigned);
    }
  }
  const measureAnchor = hiddenRestsXml(measure.duration, model.divisions, 9999, 1);
  const wholeRestVoices = emptyStaffRests.map((rest, index) => {
    const voice = 3001 + rest.staff * 10 + index;
    return `${voices.size || index > 0 ? `<backup><duration>${measure.duration}</duration></backup>` : ''}<note><rest measure="yes"/><duration>${measure.duration}</duration><voice>${voice}</voice><type>whole</type><staff>${rest.staff}</staff></note>`;
  }).join('');
  if (!voices.size) return wholeRestVoices || measureAnchor;

  const renderedVoices = [...voices.entries()].sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))
    .map(([key, notes], voiceIndex) => {
      const [staff, voice] = key.split(':').map(Number);
      const onsetGroups = new Map<number, NotatedFragment[]>();
      for (const note of notes) {
        const group = onsetGroups.get(note.start) ?? [];
        group.push(note);
        onsetGroups.set(note.start, group);
      }
      let cursor = 0;
      let xml = voiceIndex ? `<backup><duration>${measure.duration}</duration></backup>` : '';
      const assignedRests = restsByVoice.get(key) ?? [];
      const sortedGroups = [...onsetGroups].sort(([left], [right]) => left - right);
      const beamTypes = new Map<number, 'begin' | 'continue' | 'end'>();
      let beamRun: Array<[number, NotatedFragment[]]> = [];
      const flushBeamRun = () => {
        if (beamRun.length > 1) {
          beamRun.forEach(([start], index) => {
            beamTypes.set(start, index === 0 ? 'begin' : index === beamRun.length - 1 ? 'end' : 'continue');
          });
        }
        beamRun = [];
      };
      for (const entry of sortedGroups) {
        const [start, group] = entry;
        const beamed = group.some((note) => (note.beamLevel ?? 0) > 0);
        const previous = beamRun[beamRun.length - 1];
        const contiguous = previous
          ? previous[0] + Math.max(...previous[1].map((note) => note.length)) === start
          : true;
        if (!beamed || !contiguous) flushBeamRun();
        if (beamed) beamRun.push(entry);
      }
      flushBeamRun();
      for (const [start, group] of sortedGroups) {
        if (start > cursor) xml += gapXml(cursor, start - cursor, model.divisions, voice, staff, assignedRests);
        const groupSlurStarts = [...new Set(group.flatMap((note) => note.slurStarts))];
        const groupSlurStops = [...new Set(group.flatMap((note) => note.slurStops))];
        const groupTupletStarts = [...new Set(group.flatMap((note) => note.tupletStarts))];
        const groupTupletStops = [...new Set(group.flatMap((note) => note.tupletStops))];
        const groupArpeggiate = group.some((note) => note.arpeggiate);
        const groupStaccato = group.some((note) => note.staccato);
        group.forEach((note, noteIndex) => {
          const columnNotations = noteIndex === 0
            ? `${groupArpeggiate ? '<arpeggiate/>' : ''}${groupSlurStops.map((number) => `<slur type="stop" number="${number}"/>`).join('')}${groupSlurStarts.map((number) => `<slur type="start" number="${number}"/>`).join('')}${groupTupletStops.map((number) => `<tuplet type="stop" number="${number}"/>`).join('')}${groupTupletStarts.map((number) => `<tuplet type="start" number="${number}" bracket="yes" show-number="actual"/>`).join('')}${groupStaccato ? '<articulations><staccato/></articulations>' : ''}`
            : '';
          const notations = `${note.tieStop ? '<tied type="stop"/>' : ''}${note.tieStart ? '<tied type="start"/>' : ''}${columnNotations}`;
          const displayAccidental = note.explicitAccidental === inferredAlter(note.pitch, fifths, note)
            ? note.explicitAccidental
            : undefined;
          const accidental = displayAccidental === -1
            ? '<accidental>flat</accidental>'
            : displayAccidental === 1
              ? '<accidental>sharp</accidental>'
              : displayAccidental === 0
                ? '<accidental>natural</accidental>'
                : '';
          const beam = noteIndex === 0 && beamTypes.has(start)
            ? `<beam number="1">${beamTypes.get(start)}</beam>`
            : '';
          xml += `<note dynamics="${note.velocity}">${noteIndex ? '<chord/>' : ''}${pitchXml(note.pitch, fifths, note)}<duration>${note.length}</duration>${note.tieStop ? '<tie type="stop"/>' : ''}${note.tieStart ? '<tie type="start"/>' : ''}<voice>${voice}</voice><type>${note.type}</type>${'<dot/>'.repeat(note.dots)}${accidental}${note.stemDirection ? `<stem>${note.stemDirection}</stem>` : ''}<staff>${staff}</staff>${beam}${notations ? `<notations>${notations}</notations>` : ''}</note>`;
        });
        cursor = Math.max(cursor, start + Math.max(...group.map((note) => note.length)));
      }
      if (cursor < measure.duration) {
        xml += gapXml(cursor, measure.duration - cursor, model.divisions, voice, staff, assignedRests);
      }
      return xml;
    }).join('');
  return `${renderedVoices}${wholeRestVoices}<backup><duration>${measure.duration}</duration></backup>${measureAnchor}`;
}

function generateMusicXml(
  title: string,
  midi: MidiData,
  pages: SvgPageModel[],
  metadata?: CollectedScore['metadata'],
): string {
  const model = buildModel(midi, pages);
  let measures = model.measures.map((measure) => {
    const layout = measure.systemLayout;
    const systemLayout = layout
      ? `<system-layout><system-margins><left-margin>${layout.leftMargin.toFixed(2)}</left-margin><right-margin>${layout.rightMargin.toFixed(2)}</right-margin></system-margins>${layout.topSystemDistance !== undefined ? `<top-system-distance>${layout.topSystemDistance.toFixed(2)}</top-system-distance>` : ''}${layout.systemDistance !== undefined ? `<system-distance>${layout.systemDistance.toFixed(2)}</system-distance>` : ''}</system-layout>`
      : '';
    const print = measure.pageStart
      ? `<print new-page="yes">${systemLayout}</print>`
      : measure.systemStart
        ? `<print new-system="yes">${systemLayout}</print>`
        : measure.index === 0 && systemLayout
          ? `<print>${systemLayout}</print>`
          : '';
    return `<measure number="${measure.index + 1}" width="${measure.widthTenths.toFixed(2)}">${print}${attributesXml(model, measure)}${directionsXml(model, measure)}${voicesXml(model, measure)}</measure>`;
  }).join('');
  const slurStarts = [...measures.matchAll(/<slur type="start" number="(\d+)"\/>/g)];
  const slurStops = [...measures.matchAll(/<slur type="stop" number="(\d+)"\/>/g)];
  const slurNumbers = new Set([...slurStarts, ...slurStops].map((match) => match[1]));
  const validSlurs = new Set([...slurNumbers].filter((number) => {
    const starts = slurStarts.filter((match) => match[1] === number);
    const stops = slurStops.filter((match) => match[1] === number);
    return starts.length === 1
      && stops.length === 1
      && (starts[0].index ?? -1) < (stops[0].index ?? -1);
  }));
  measures = measures.replace(
    /<slur type="(?:start|stop)" number="(\d+)"\/>/g,
    (slur, number: string) => validSlurs.has(number) ? slur : '',
  );
  const tupletStarts = [...measures.matchAll(/<tuplet type="start" number="(\d+)"[^>]*\/>/g)];
  const tupletStops = [...measures.matchAll(/<tuplet type="stop" number="(\d+)"\/>/g)];
  const validTuplets = new Set(tupletStarts.flatMap((start) => {
    const stops = tupletStops.filter((stop) => stop[1] === start[1]);
    return stops.length === 1 && (start.index ?? -1) < (stops[0].index ?? -1) ? [start[1]] : [];
  }));
  measures = measures.replace(
    /<tuplet type="(?:start|stop)" number="(\d+)"[^>]*\/>/g,
    (tuplet, number: string) => validTuplets.has(number) ? tuplet : '',
  );
  const identification = metadata?.composer || metadata?.arranger
    ? `<identification>${metadata.composer ? `<creator type="composer">${escapeXml(metadata.composer)}</creator>` : ''}${metadata.arranger ? `<creator type="arranger">${escapeXml(metadata.arranger)}</creator>` : ''}</identification>`
    : '';
  const defaults = `<defaults><scaling><millimeters>7.0556</millimeters><tenths>40</tenths></scaling><page-layout><page-height>${model.pageLayout.height.toFixed(2)}</page-height><page-width>${model.pageLayout.width.toFixed(2)}</page-width><page-margins type="both"><left-margin>0</left-margin><right-margin>0</right-margin><top-margin>0</top-margin><bottom-margin>0</bottom-margin></page-margins></page-layout></defaults>`;
  return `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><work><work-title>${escapeXml(title)}</work-title></work>${metadata?.subtitle ? `<movement-title>${escapeXml(metadata.subtitle)}</movement-title>` : ''}${identification}${defaults}<part-list><score-part id="P1"><part-name>Piano</part-name><score-instrument id="P1-I1"><instrument-name>Piano</instrument-name></score-instrument><midi-instrument id="P1-I1"><midi-channel>1</midi-channel><midi-program>1</midi-program></midi-instrument></score-part></part-list><part id="P1">${measures}</part></score-partwise>`;
}

export function reconstructMusicXml(collected: CollectedScore): ReconstructedScore {
  if (!collected.pages?.length) throw new Error('INVALID_SCORE_PAGES');
  if (!collected.midiBase64) throw new Error('MIDI_DATA_UNAVAILABLE');
  const pages = collected.pages.map(parseSvgPage);
  const midi = parseMidi(decodeBase64(collected.midiBase64));
  const midiNotes = midi.tracks.reduce(
    (count, track) => count + track.filter(
      (event) => event.type === 'noteOn' && event.velocity > 0,
    ).length,
    0,
  );
  if (!midiNotes) throw new Error('MIDI_CONTAINS_NO_NOTES');
  const fileTitle = Array.from(collected.title.replace(/[\\/:*?"<>|]/g, '_'))
    .filter((character) => character.charCodeAt(0) >= 32)
    .join('')
    .trim() || 'score';
  return {
    fileName: `${fileTitle}.musicxml`,
    musicXml: generateMusicXml(collected.title, midi, pages, collected.metadata),
    report: {
      pageCount: pages.length,
      svgNoteSymbols: (collected.pages.join('').match(/\bclass="[^"]*\bNote\b/g) ?? []).length,
      midiNotes,
    },
  };
}