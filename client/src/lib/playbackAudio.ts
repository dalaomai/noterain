import type { MidiNote } from '../types/midi';

/** Include every note exactly on a start, seek or loop boundary. */
export function getPlaybackNoteIndex(notes: readonly MidiNote[], time: number) {
  let low = 0;
  let high = notes.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (notes[mid].startTime < time) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** Queue a short window on the audio clock, independently of drawing frames. */
export function schedulePlaybackAudio(
  notes: readonly MidiNote[],
  cursor: number,
  scoreTime: number,
  audioTime: number,
  speed: number,
  endTime: number,
  play: (note: MidiNote, duration: number, time: number) => boolean,
) {
  const horizon = scoreTime + 0.12 * speed;
  while (cursor < notes.length) {
    const note = notes[cursor];
    if (note.startTime > horizon || note.startTime >= endTime) break;
    const time = audioTime + Math.max(0, (note.startTime - scoreTime) / speed);
    if (!play(note, note.duration / speed, time)) break;
    cursor++;
  }
  return cursor;
}
