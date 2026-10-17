import type { MidiNote } from '../types/midi';

export const TIMING_TOLERANCE_MS = 80;
export const LATE_WINDOW_MS = 400;
export const VELOCITY_TOLERANCE = 12;
export const FEEDBACK_DURATION_MS = 1200;

export interface FollowClock {
  scoreTime: number;
  timestamp: number;
  speed: number;
}

export interface FollowResult {
  id: number;
  note: MidiNote;
  kind: 'correct' | 'wrong';
  inputPitch: number;
  offsetMs: number | null;
  timing: 'on-time' | 'early' | 'late' | 'waited' | null;
  velocity: number | null;
  referenceVelocity: number | null;
  timestamp: number;
}

/** Stable across engraving changes, view switches and repeated pitches. */
export function followNoteKey(
  note: Pick<MidiNote, 'track' | 'startTime' | 'noteNumber'>,
): string {
  return `${note.track}:${note.startTime.toFixed(6)}:${note.noteNumber}`;
}

export function firstPendingIndex(
  notes: MidiNote[],
  satisfied: Set<number>,
  start = 0,
): number {
  while (start < notes.length && satisfied.has(start)) start++;
  return start;
}

/** Only the current onset may be matched; a chord cannot consume a later note. */
export function pendingGroup(notes: MidiNote[], first: number): number[] {
  const onset = notes[first]?.startTime;
  if (onset === undefined) return [];
  const group: number[] = [];
  for (
    let i = first;
    i < notes.length && Math.abs(notes[i].startTime - onset) < 0.0001;
    i++
  )
    group.push(i);
  for (
    let i = first - 1;
    i >= 0 && Math.abs(notes[i].startTime - onset) < 0.0001;
    i--
  )
    group.unshift(i);
  return group;
}

export function inputOffsetMs(
  clock: FollowClock,
  noteTime: number,
  timestamp: number,
): number {
  return (
    timestamp -
    clock.timestamp -
    ((noteTime - clock.scoreTime) / clock.speed) * 1000
  );
}

export function judgeFollowInput(
  note: MidiNote,
  clock: FollowClock,
  timestamp: number,
  inputVelocity: number | undefined,
  referenceVelocity: number | null,
): Pick<
  FollowResult,
  'offsetMs' | 'timing' | 'velocity' | 'referenceVelocity'
> {
  const offsetMs = Math.round(inputOffsetMs(clock, note.startTime, timestamp));
  const timing =
    offsetMs > LATE_WINDOW_MS
      ? 'waited'
      : offsetMs < -TIMING_TOLERANCE_MS
        ? 'early'
        : offsetMs > TIMING_TOLERANCE_MS
          ? 'late'
          : 'on-time';
  return {
    offsetMs,
    timing,
    velocity:
      inputVelocity !== undefined && inputVelocity > 0 && inputVelocity <= 127
        ? inputVelocity
        : null,
    referenceVelocity:
      referenceVelocity !== null &&
      referenceVelocity > 0 &&
      referenceVelocity <= 127
        ? referenceVelocity
        : null,
  };
}
