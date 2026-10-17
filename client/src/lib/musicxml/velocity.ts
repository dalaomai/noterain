import type { MidiFile } from '../../types/midi';

export interface VelocityMeasure {
  id: string;
  unit: number;
  changes: { staff: number; beat: number; velocity: number | null }[];
}
interface TimePoint {
  measureOn?: string;
  qstamp?: number;
  tstamp: number;
  tempo?: number;
}
interface Reference {
  time: number;
  velocity: number | null;
}

/** Authored dynamics, repeated in playback order. Unknown passages stay unknown. */
export function velocityReferenceTimeline(
  measures: VelocityMeasure[],
  staffs: number[],
  timeMap: TimePoint[],
  notatedId: (id: string) => string = (id) => id,
): Map<number, Reference[]> {
  const points = timeMap.filter(
    (p): p is TimePoint & { qstamp: number } => typeof p.qstamp === 'number',
  );
  const tempos: number[] = [];
  let tempo = 120;
  for (const point of points) {
    tempo = point.tempo ?? tempo;
    tempos.push(tempo);
  }
  const secondsAt = (quarter: number): number => {
    let lo = 0,
      hi = points.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (points[mid].qstamp <= quarter) lo = mid;
      else hi = mid - 1;
    }
    const point = points[lo];
    return (
      (point.tstamp + ((quarter - point.qstamp) * 60000) / tempos[lo]) / 1000
    );
  };
  const occurrences = new Map<string, (TimePoint & { qstamp: number })[]>();
  for (const point of points)
    if (point.measureOn) {
      const id = notatedId(point.measureOn);
      const list = occurrences.get(id) ?? [];
      list.push(point);
      occurrences.set(id, list);
    }
  const references = new Map(staffs.map((staff) => [staff, [] as Reference[]]));
  const carried = new Map<number, number | null>(
    staffs.map((staff) => [staff, null]),
  );
  for (const measure of measures) {
    const plays = occurrences.get(measure.id) ?? [];
    for (const staff of staffs)
      for (const play of plays)
        references
          .get(staff)!
          .push({
            time: play.tstamp / 1000,
            velocity: carried.get(staff) ?? null,
          });
    for (const change of [...measure.changes].sort((a, b) => a.beat - b.beat)) {
      if (!references.has(change.staff)) continue;
      carried.set(change.staff, change.velocity);
      for (const play of plays)
        references
          .get(change.staff)!
          .push({
            time: secondsAt(
              play.qstamp + ((change.beat - 1) * 4) / measure.unit,
            ),
            velocity: change.velocity,
          });
    }
  }
  for (const list of references.values()) list.sort((a, b) => a.time - b.time);
  return references;
}

/** Verovio's MEI preserves explicit numeric dynamics even when its exported
 * MIDI assigns a default velocity. Do not infer targets from that default. */
export function attachMusicXmlVelocityReferences(
  file: MidiFile,
  mei: string,
  timeMap: TimePoint[],
  notatedId: (id: string) => string,
): void {
  const doc = new DOMParser().parseFromString(mei, 'application/xml');
  const staffs = [
    ...new Set(
      [...doc.querySelectorAll('staffDef')]
        .map((e) => Number(e.getAttribute('n')))
        .filter((n) => n > 0),
    ),
  ];
  let unit = Number(doc.querySelector('meterSig')?.getAttribute('unit')) || 4;
  const measures: VelocityMeasure[] = [...doc.querySelectorAll('measure')].map(
    (element) => {
      unit =
        Number(element.querySelector('meterSig')?.getAttribute('unit')) || unit;
      return {
        id: element.getAttribute('xml:id') ?? '',
        unit,
        changes: [...element.querySelectorAll('dynam,hairpin')].flatMap(
          (dynamic) => {
            const value = Number(dynamic.getAttribute('val'));
            const velocity =
              dynamic.localName === 'dynam' && value > 0 && value <= 127
                ? Math.round(value)
                : null;
            const beat = Number(dynamic.getAttribute('tstamp')) || 1;
            return (dynamic.getAttribute('staff') ?? '')
              .trim()
              .split(/\s+/)
              .map(Number)
              .filter((staff) => staff > 0)
              .map((staff) => ({ staff, beat, velocity }));
          },
        ),
      };
    },
  );
  const references = velocityReferenceTimeline(
    measures,
    staffs,
    timeMap,
    notatedId,
  );
  const tracks = file.tracks.filter((track) => track.notes.length > 0);
  staffs.forEach((staff, index) => {
    const list = references.get(staff) ?? [];
    let cursor = -1;
    for (const note of [...(tracks[index]?.notes ?? [])].sort(
      (a, b) => a.startTime - b.startTime,
    )) {
      while (
        cursor + 1 < list.length &&
        list[cursor + 1].time <= note.startTime + 0.005
      )
        cursor++;
      note.referenceVelocity = list[cursor]?.velocity ?? null;
    }
  });
}
