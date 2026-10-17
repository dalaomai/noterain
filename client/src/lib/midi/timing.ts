import type { MidiData } from 'midi-file';

export interface MidiTempoPoint {
  tick: number;
  time: number;
  bpm: number;
  secondsPerTick: number;
}

/** Integrate tempo events in tick order, including events on other tracks. */
export function buildMidiTempoMap(
  midi: MidiData,
  ticksPerBeat: number,
): MidiTempoPoint[] {
  const events: { tick: number; microsecondsPerBeat: number }[] = [];
  for (const track of midi.tracks) {
    let tick = 0;
    for (const event of track) {
      tick += event.deltaTime;
      if (event.type === 'setTempo' && event.microsecondsPerBeat > 0) {
        events.push({ tick, microsecondsPerBeat: event.microsecondsPerBeat });
      }
    }
  }
  events.sort((a, b) => a.tick - b.tick);
  const result: MidiTempoPoint[] = [
    { tick: 0, time: 0, bpm: 120, secondsPerTick: 0.5 / ticksPerBeat },
  ];
  for (const event of events) {
    const previous = result[result.length - 1];
    const point = {
      tick: event.tick,
      time:
        previous.time + (event.tick - previous.tick) * previous.secondsPerTick,
      bpm: 60000000 / event.microsecondsPerBeat,
      secondsPerTick: event.microsecondsPerBeat / 1000000 / ticksPerBeat,
    };
    if (event.tick === previous.tick) result[result.length - 1] = point;
    else result.push(point);
  }
  return result;
}

export function midiTicksToSeconds(
  tick: number,
  map: readonly MidiTempoPoint[],
): number {
  let low = 0;
  let high = map.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (map[middle].tick <= tick) low = middle;
    else high = middle - 1;
  }
  const point = map[low];
  return point.time + (tick - point.tick) * point.secondsPerTick;
}
