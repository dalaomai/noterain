import { parseMidi, type MidiData } from 'midi-file';

interface NormalizedMidiNote {
  pitch: number;
  onset: number;
  duration: number;
}

interface NormalizedTempo {
  onset: number;
  bpm: number;
}

interface MidiValidationReport {
  valid: boolean;
  sourceNoteCount: number;
  generatedNoteCount: number;
  missingNotes: NormalizedMidiNote[];
  extraNotes: NormalizedMidiNote[];
  sourceTempos: NormalizedTempo[];
  generatedTempos: NormalizedTempo[];
  tempoMatches: boolean;
}

export interface NotationMidiValidationReport {
  valid: boolean;
  sourceNoteCount: number;
  generatedNoteCount: number;
  missing: Array<{ pitch: number; onset: number }>;
  extra: Array<{ pitch: number; onset: number }>;
}

const POSITION_TOLERANCE = 1 / 1920;
const TEMPO_TOLERANCE = 0.01;

function ticksPerBeat(midi: MidiData): number {
  if (!midi.header.ticksPerBeat) throw new Error('SMPTE_MIDI_TIME_DIVISION_UNSUPPORTED');
  return midi.header.ticksPerBeat;
}

function normalizeNotes(midi: MidiData): NormalizedMidiNote[] {
  const resolution = ticksPerBeat(midi);
  const notes: NormalizedMidiNote[] = [];

  for (const track of midi.tracks) {
    const active = new Map<string, Array<{ pitch: number; tick: number }>>();
    let tick = 0;
    for (const event of track) {
      tick += event.deltaTime;
      if (event.type === 'noteOn' && event.velocity > 0) {
        const key = `${event.channel}:${event.noteNumber}`;
        const pending = active.get(key) ?? [];
        pending.push({ pitch: event.noteNumber, tick });
        active.set(key, pending);
      } else if (event.type === 'noteOff' || (event.type === 'noteOn' && event.velocity === 0)) {
        const key = `${event.channel}:${event.noteNumber}`;
        const pending = active.get(key);
        const started = pending?.shift();
        if (!started) continue;
        notes.push({
          pitch: started.pitch,
          onset: started.tick / resolution,
          duration: (tick - started.tick) / resolution,
        });
        if (!pending?.length) active.delete(key);
      }
    }
  }

  return notes.sort(compareNotes);
}

function normalizeTempos(midi: MidiData): NormalizedTempo[] {
  const resolution = ticksPerBeat(midi);
  const tempos: NormalizedTempo[] = [];
  for (const track of midi.tracks) {
    let tick = 0;
    for (const event of track) {
      tick += event.deltaTime;
      if (event.type !== 'setTempo') continue;
      tempos.push({ onset: tick / resolution, bpm: 60_000_000 / event.microsecondsPerBeat });
    }
  }
  if (!tempos.some((tempo) => Math.abs(tempo.onset) <= POSITION_TOLERANCE)) {
    tempos.push({ onset: 0, bpm: 120 });
  }
  tempos.sort((left, right) => left.onset - right.onset || left.bpm - right.bpm);
  return tempos.filter((tempo, index) => !tempos.slice(0, index).some(
    (previous) => sameTempo(tempo, previous),
  ));
}

function compareNotes(left: NormalizedMidiNote, right: NormalizedMidiNote): number {
  return left.onset - right.onset || left.pitch - right.pitch || left.duration - right.duration;
}

function sameNote(left: NormalizedMidiNote, right: NormalizedMidiNote): boolean {
  return left.pitch === right.pitch
    && Math.abs(left.onset - right.onset) <= POSITION_TOLERANCE
    && Math.abs(left.duration - right.duration) <= POSITION_TOLERANCE;
}

function sameTempo(left: NormalizedTempo, right: NormalizedTempo): boolean {
  return Math.abs(left.onset - right.onset) <= POSITION_TOLERANCE
    && Math.abs(left.bpm - right.bpm) <= TEMPO_TOLERANCE;
}

function compareNoteSets(
  source: NormalizedMidiNote[],
  generated: NormalizedMidiNote[],
): Pick<MidiValidationReport, 'missingNotes' | 'extraNotes'> {
  const unmatchedGenerated = [...generated];
  const missingNotes: NormalizedMidiNote[] = [];
  for (const note of source) {
    const match = unmatchedGenerated.findIndex((candidate) => sameNote(note, candidate));
    if (match < 0) missingNotes.push(note);
    else unmatchedGenerated.splice(match, 1);
  }
  return { missingNotes, extraNotes: unmatchedGenerated };
}

export function validateMidiRoundTrip(
  sourceBytes: Uint8Array,
  generatedBytes: Uint8Array,
): MidiValidationReport {
  const sourceMidi = parseMidi(sourceBytes);
  const generatedMidi = parseMidi(generatedBytes);
  const sourceNotes = normalizeNotes(sourceMidi);
  const generatedNotes = normalizeNotes(generatedMidi);
  const sourceTempos = normalizeTempos(sourceMidi);
  const generatedTempos = normalizeTempos(generatedMidi);
  const { missingNotes, extraNotes } = compareNoteSets(sourceNotes, generatedNotes);
  const tempoMatches = sourceTempos.length === generatedTempos.length
    && sourceTempos.every((tempo, index) => sameTempo(tempo, generatedTempos[index]));

  return {
    valid: missingNotes.length === 0 && extraNotes.length === 0 && tempoMatches,
    sourceNoteCount: sourceNotes.length,
    generatedNoteCount: generatedNotes.length,
    missingNotes,
    extraNotes,
    sourceTempos,
    generatedTempos,
    tempoMatches,
  };
}

function notationOnsets(midi: MidiData, subdivisions: number) {
  const resolution = ticksPerBeat(midi);
  const grid = resolution / subdivisions;
  const notes: Array<{ pitch: number; onset: number }> = [];
  for (const track of midi.tracks) {
    let tick = 0;
    for (const event of track) {
      tick += event.deltaTime;
      if (event.type === 'noteOn' && event.velocity > 0) {
        notes.push({ pitch: event.noteNumber, onset: Math.round(tick / grid) / subdivisions });
      }
    }
  }
  return notes.sort((left, right) => left.onset - right.onset || left.pitch - right.pitch);
}

export function validateNotationMidiRoundTrip(
  sourceBytes: Uint8Array,
  generatedBytes: Uint8Array,
  subdivisions = 8,
): NotationMidiValidationReport {
  const source = notationOnsets(parseMidi(sourceBytes), subdivisions);
  const generated = notationOnsets(parseMidi(generatedBytes), subdivisions);
  const unmatched = [...generated];
  const missing = source.filter((note) => {
    const index = unmatched.findIndex((candidate) =>
      candidate.pitch === note.pitch && candidate.onset === note.onset,
    );
    if (index < 0) return true;
    unmatched.splice(index, 1);
    return false;
  });
  return {
    valid: missing.length === 0 && unmatched.length === 0,
    sourceNoteCount: source.length,
    generatedNoteCount: generated.length,
    missing,
    extra: unmatched,
  };
}