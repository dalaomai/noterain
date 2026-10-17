import type { MusicXmlTimeEvent } from './musicxml/parser';
import { getScoreTimeX } from './scoreLayout';

export interface EngravedMeasureGeometry {
  systemId: string;
  left: number;
  right: number;
  top: number;
  height: number;
}

export interface ScoreCursorRun {
  startTime: number;
  endTime: number;
  focusId: string;
  top: number;
  height: number;
  anchors: { time: number; x: number }[];
}

/** Follow the original engraving, including rests and repeated visits to a row. */
export function buildScoreCursorRuns(
  events: readonly MusicXmlTimeEvent[],
  getMeasure: (id: string) => EngravedMeasureGeometry | undefined,
  getOnsetX: (id: string) => number | undefined,
  duration: number,
): ScoreCursorRun[] {
  const runs: ScoreCursorRun[] = [];
  let current: ScoreCursorRun | undefined;
  let lastMeasure: EngravedMeasureGeometry | undefined;
  let lastMeasureId: string | undefined;
  let anchors = new Map<number, number>();

  const finish = (endTime: number) => {
    if (!current || !lastMeasure) return;
    current.endTime = endTime;
    if (!anchors.has(endTime)) anchors.set(endTime, lastMeasure.right);
    current.anchors = Array.from(anchors, ([time, x]) => ({ time, x })).sort(
      (a, b) => a.time - b.time,
    );
    runs.push(current);
  };

  for (const event of events) {
    const time = event.tstamp / 1000;
    const measure = event.measureOn ? getMeasure(event.measureOn) : undefined;
    if (measure && event.measureOn) {
      const repeat =
        lastMeasure &&
        (measure.left < lastMeasure.left - 1 ||
          event.measureOn === lastMeasureId);
      if (!current || measure.systemId !== lastMeasure?.systemId || repeat) {
        finish(time);
        anchors = new Map();
        current = {
          startTime: time,
          endTime: time,
          focusId: event.measureOn,
          top: measure.top,
          height: measure.height,
          anchors: [],
        };
      }
      anchors.set(time, measure.left);
      lastMeasure = measure;
      lastMeasureId = event.measureOn;
    }
    if (!current) continue;
    const xs = (event.on ?? [])
      .map(getOnsetX)
      .filter((x): x is number => x !== undefined && Number.isFinite(x));
    // Onsets override the barline at the same instant; aligned voices share it.
    if (xs.length) anchors.set(time, Math.min(...xs));
  }
  finish(Math.max(duration, (events[events.length - 1]?.tstamp ?? 0) / 1000));
  return runs;
}

export function getScoreCursorPosition(
  runs: readonly ScoreCursorRun[],
  time: number,
) {
  if (!runs.length) return null;
  let low = 0;
  let high = runs.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (runs[middle].startTime <= time) low = middle;
    else high = middle - 1;
  }
  const run = runs[low];
  if (!run.anchors.length) return null;
  let from = 0;
  let to = run.anchors.length - 1;
  while (from < to) {
    const middle = Math.ceil((from + to) / 2);
    if (run.anchors[middle].time <= time) from = middle;
    else to = middle - 1;
  }
  const anchor = run.anchors[from];
  const next = run.anchors[from + 1];
  const x = next
    ? getScoreTimeX(
        time,
        anchor.time,
        next.time - anchor.time,
        anchor.x,
        next.x,
      )
    : anchor.x;
  return { x, top: run.top, height: run.height, focusId: run.focusId };
}
