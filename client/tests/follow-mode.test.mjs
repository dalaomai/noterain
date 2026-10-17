import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

// Exercise the actual store and judgement functions without a browser or audio.
const data = new Map();
globalThis.localStorage = {
  getItem: (key) => data.get(key) ?? null,
  setItem: (key, value) => data.set(key, value),
  removeItem: (key) => data.delete(key),
};
globalThis.window = { localStorage };
localStorage.setItem(
  'piano-storage',
  JSON.stringify({ state: { settings: { volume: 0.5 } }, version: 0 }),
);
const source = buildSync({
  stdin: {
    contents:
      "export { useMidiStore } from './src/stores/midiStore'; export * from './src/lib/followMode'; export * from './src/lib/musicxml/velocity';",
    resolveDir: fileURLToPath(new URL('../', import.meta.url)),
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
}).outputFiles[0].text;
const bundled = { exports: {} };
new Function('module', 'exports', 'require', source)(
  bundled,
  bundled.exports,
  createRequire(import.meta.url),
);
const {
  useMidiStore: store,
  judgeFollowInput,
  followNoteKey,
  velocityReferenceTimeline,
} = bundled.exports;
const initial = store.getState();
let now = 1000;
Object.defineProperty(globalThis, 'performance', {
  configurable: true,
  value: { now: () => now },
});
const note = (pitch, start = 0, track = 0, duration = 0.25) => ({
  noteNumber: pitch,
  startTime: start,
  track,
  duration,
  velocity: 64,
  channel: 0,
});
const makeFile = (notes, format = 'midi') => ({
  id: 'test',
  name: 'test.mid',
  sourceFormat: format,
  duration: 20,
  tracks: [...new Set(notes.map((n) => n.track))].map((index) => ({
    index,
    enabled: true,
    renderOnly: false,
    playAudio: true,
    notes: notes.filter((n) => n.track === index),
    color: '#89b4fa',
    name: 'Piano',
    instrument: 'Piano',
  })),
  tempos: [{ time: 0, bpm: 120 }],
  ticksPerBeat: 480,
  timeSignature: { numerator: 4, denominator: 4 },
  keySignature: { key: 0, scale: 0 },
  lastModified: 0,
});
function load(
  notes = [note(60), note(64), note(67), note(60, 1), note(62, 2)],
  format,
) {
  const file = makeFile(notes, format);
  store.getState().addFile(file);
  store.getState().setCurrentFile(file.id);
  store.getState().toggleWaitMode();
  store.getState().play();
  return file;
}
const state = () => store.getState();
const hit = (pitch, velocity = 65, elapsed = 20) => {
  now += elapsed;
  state().addSatisfiedWaitNote(pitch, velocity, now);
};
beforeEach(() => {
  now = 1000;
  store.setState(
    {
      ...initial,
      files: [],
      currentFileId: null,
      settings: { ...initial.settings },
      playback: {
        ...initial.playback,
        waitMode: false,
        currentTime: 0,
        isPlaying: false,
      },
    },
    true,
  );
});

test('old persisted settings receive feedback and playback cursor defaults', () => {
  assert.equal(initial.settings.volume, 0.5);
  assert.equal(initial.settings.showPlaybackCursor, true);
  assert.equal(initial.settings.followPitchFeedback, true);
  assert.equal(initial.settings.followTimingFeedback, true);
  assert.equal(initial.settings.followVelocityFeedback, true);
});

test('cursor preference is persisted and survives score mode changes and practice actions', () => {
  state().updateSettings({ showPlaybackCursor: false });
  load();
  state().updateSettings({ showOriginalMusicXml: false });
  state().seek(1);
  state().pause();
  assert.equal(state().settings.showPlaybackCursor, false);
  assert.equal(
    JSON.parse(localStorage.getItem('piano-storage')).state.settings
      .showPlaybackCursor,
    false,
  );
  state().updateSettings({ showOriginalMusicXml: true });
  assert.equal(state().settings.showPlaybackCursor, false);
});
test('timing uses real milliseconds, speed and exact boundaries', () => {
  const clock = { scoreTime: 0, timestamp: 1000, speed: 2 };
  for (const [offset, expected] of [
    [-150, 'early'],
    [-80, 'on-time'],
    [80, 'on-time'],
    [81, 'late'],
    [400, 'late'],
    [401, 'waited'],
  ]) {
    const result = judgeFollowInput(note(60, 1), clock, 1500 + offset, 84, 64);
    assert.equal(result.referenceVelocity, 64);
    assert.equal(result.offsetMs, offset);
    assert.equal(result.timing, expected);
  }
});
test('wrong pitch never completes a target or evaluates timing/velocity', () => {
  load();
  hit(61);
  assert.equal(state().waitModeSatisfiedIndices.size, 0);
  assert.equal(state().followResults[0].kind, 'wrong');
  assert.equal(state().followResults[0].offsetMs, null);
  assert.equal(state().followResults[0].referenceVelocity, null);
  assert.equal(state().getWaitModeBoundary(10), 0);
});
test('one input completes one event, including unison in separate tracks', () => {
  load([note(60), note(60, 0, 1)]);
  hit(60);
  assert.equal(state().waitModeSatisfiedIndices.size, 1);
  hit(60);
  assert.equal(state().waitModeSatisfiedIndices.size, 2);
});
test('a repeated completed chord tone cannot consume a later same-pitch note', () => {
  load();
  hit(60);
  hit(60);
  assert.equal(state().waitModeSatisfiedIndices.size, 1);
  assert.equal(state().followResults.length, 1);
  hit(64);
  hit(67);
  assert.equal(state().waitModePendingIndex, 3);
  assert.equal(state().getWaitModeBoundary(5), 1);
});
test('short missing notes still block after a delayed animation frame', () => {
  load([note(60, 0.1, 0, 0.01)]);
  assert.equal(state().getWaitModeBoundary(5), 0.1);
  assert.equal(state().waitModeSatisfiedIndices.size, 0);
});
test('early matching respects the grace window in real time at changed speed', () => {
  load([note(60, 1)]);
  state().seek(0.3);
  state().setSpeed(2);
  state().play();
  hit(60, 65, 0);
  assert.equal(state().waitModeSatisfiedIndices.size, 1);
  assert.equal(state().followResults[0].timing, 'early');
  assert.equal(state().followResults[0].offsetMs, -350);
});
test('an input beyond the early grace window does not satisfy a note', () => {
  load([note(60, 1)]);
  hit(60, 65, 0);
  assert.equal(state().waitModeSatisfiedIndices.size, 0);
  assert.equal(state().followResults.length, 0);
});
test('waiting score time does not turn a late input into on-time', () => {
  load([note(60)]);
  state().setWaitModeBlocked(true);
  hit(60, 65, 650);
  assert.equal(state().playback.currentTime, 0);
  assert.equal(state().followResults[0].timing, 'waited');
  assert.equal(state().followResults[0].offsetMs, 650);
});
test('resolving a wait aligns the next target to a fresh clock', () => {
  load([note(60), note(62, 1)]);
  state().setWaitModeBlocked(true);
  hit(60, 65, 700);
  state().setWaitModeBlocked(false, now);
  state().advancePlayback(1);
  hit(62, 65, 1000);
  assert.equal(state().followResults.at(-1).offsetMs, 0);
});
test('changing speed while waiting preserves elapsed lateness', () => {
  load([note(60)]);
  state().setWaitModeBlocked(true);
  now += 300;
  state().setSpeed(0.5);
  hit(60, 65, 200);
  assert.equal(state().followResults[0].offsetMs, 500);
});
test('fixed velocity and generated MusicXML velocity are not assessed', () => {
  load([note(60)]);
  now += 20;
  state().addSatisfiedWaitNote(60, undefined, now);
  assert.equal(state().followResults[0].velocity, null);
  state().toggleWaitMode();
  state().setCurrentFile(null);
  store.setState({
    files: [],
    playback: { ...state().playback, waitMode: false },
  });
  load([note(60)], 'musicxml');
  hit(60, 84);
  assert.equal(state().followResults[0].referenceVelocity, null);
});
test('all eight visibility combinations preserve matching and judgement', () => {
  for (let mask = 0; mask < 8; mask++) {
    store.setState(
      {
        ...initial,
        files: [],
        playback: { ...initial.playback, waitMode: false },
      },
      true,
    );
    load([note(60)]);
    state().updateSettings({
      followPitchFeedback: !!(mask & 1),
      followTimingFeedback: !!(mask & 2),
      followVelocityFeedback: !!(mask & 4),
    });
    hit(60);
    assert.equal(state().waitModeSatisfiedIndices.size, 1);
    assert.equal(state().followResults[0].kind, 'correct');
  }
});
test('pause does not accept input and resume keeps partial chord completion', () => {
  load();
  hit(60);
  state().pause();
  hit(64);
  assert.equal(state().waitModeSatisfiedIndices.size, 1);
  now += 30000;
  state().play();
  state().buildWaitModeNoteList();
  hit(64);
  assert.equal(state().waitModeSatisfiedIndices.size, 2);
  assert.equal(state().followResults.at(-1).offsetMs, 20);
});
test('small seeks reset judgement and target progress, not preferences', () => {
  load();
  hit(60);
  state().updateSettings({ followVelocityFeedback: false });
  const version = state().seekVersion;
  state().seek(0.01);
  assert.equal(state().followResults.length, 0);
  assert.equal(state().waitModePendingIndex, 3);
  assert.equal(state().seekVersion, version + 1);
  assert.equal(state().settings.followVelocityFeedback, false);
  state().seek(0);
  assert.equal(state().waitModePendingIndex, 0);
});
test('stop and disabling follow mode clear feedback and preserve preferences', () => {
  load();
  hit(60);
  state().updateSettings({ followPitchFeedback: false });
  state().stop();
  assert.equal(state().followResults.length, 0);
  assert.equal(state().waitModePendingIndex, 0);
  state().play();
  hit(60);
  state().toggleWaitMode();
  assert.equal(state().followResults.length, 0);
  assert.equal(state().settings.followPitchFeedback, false);
  hit(64);
  assert.equal(state().followResults.length, 0);
});
test('render-only and disabled tracks never block follow mode', () => {
  load([note(60, 0, 0), note(64, 0, 1)]);
  state().toggleTrackRenderOnly('test', 1);
  assert.deepEqual(
    state().waitModeSortedNotes.map((n) => n.noteNumber),
    [60],
  );
  state().toggleTrack('test', 0);
  assert.equal(state().waitModeSortedNotes.length, 0);
});
test('new files reset transient feedback and stable keys separate repeated notes', () => {
  load();
  hit(60);
  const second = { ...makeFile([note(70)]), id: 'second' };
  state().addFile(second);
  state().setCurrentFile('second');
  assert.equal(state().followResults.length, 0);
  assert.equal(state().playback.isPlaying, false);
  assert.equal(state().waitModeSortedNotes[0].noteNumber, 70);
  assert.notEqual(followNoteKey(note(60)), followNoteKey(note(60, 1)));
});
test('only preferences are persisted, with no note history or clocks', () => {
  load();
  hit(60);
  const persisted = JSON.parse(localStorage.getItem('piano-storage')).state;
  assert.equal(persisted.settings.followPitchFeedback, true);
  assert.equal('followResults' in persisted, false);
  assert.equal('waitModeClock' in persisted, false);
});
test('feedback history is bounded during long practice sessions', () => {
  load(Array.from({ length: 300 }, (_, i) => note(60, i * 0.5)));
  for (let i = 0; i < 300; i++) {
    state().advancePlayback(i * 0.5);
    now = 1000 + i * 500;
    state().addSatisfiedWaitNote(60, 65, now);
  }
  assert.equal(state().followResults.length, 256);
  assert.equal(state().waitModeSatisfiedIndices.size, 300);
});

test('a delayed drawing frame does not reject an input arriving at its real due time', () => {
  load([note(60, 1)]);
  hit(60, 65, 1050);
  assert.equal(state().playback.currentTime, 0);
  assert.equal(state().waitModeSatisfiedIndices.size, 1);
  assert.equal(state().followResults[0].offsetMs, 50);
});

test('the final missing chord tone re-aligns the clock immediately', () => {
  load();
  state().setWaitModeBlocked(true);
  hit(60, 65, 600);
  hit(64);
  hit(67);
  assert.equal(state().waitModeBlocked, false);
  assert.equal(state().waitModeClock.timestamp, now);
  assert.equal(state().waitModeClock.scoreTime, 0);
});

test('play jumping into a loop does not retain targets before the loop', () => {
  load([note(60), note(62, 2), note(64, 4)]);
  state().pause();
  store.setState({
    playback: {
      ...state().playback,
      loopEnabled: true,
      loopStartMeasure: 1,
      loopEndMeasure: 2,
      currentTime: 0,
    },
  });
  state().play();
  state().buildWaitModeNoteList();
  assert.equal(state().playback.currentTime, 2);
  assert.equal(state().waitModePendingIndex, 1);
});

test('authored MusicXML velocity is used instead of the generated MIDI default', () => {
  const n = { ...note(60), velocity: 90, referenceVelocity: 58 };
  load([n], 'musicxml');
  hit(60, 84);
  assert.equal(state().followResults[0].referenceVelocity, 58);
  assert.equal(state().followResults[0].velocity, 84);
});

test('dynamics carry by staff, follow tempo, and reset at repeat boundaries', () => {
  const map = [
    { measureOn: 'm1', qstamp: 0, tstamp: 0, tempo: 120 },
    { measureOn: 'm2', qstamp: 4, tstamp: 2000, tempo: 60 },
    { measureOn: 'm1-repeat', qstamp: 8, tstamp: 6000, tempo: 120 },
    { qstamp: 12, tstamp: 8000 },
  ];
  const measures = [
    { id: 'm1', unit: 4, changes: [{ staff: 1, beat: 1, velocity: 58 }] },
    { id: 'm2', unit: 4, changes: [{ staff: 1, beat: 3, velocity: 90 }] },
  ];
  const timeline = velocityReferenceTimeline(measures, [1, 2], map, (id) =>
    id.replace('-repeat', ''),
  );
  assert.ok(timeline.get(1).some((p) => p.time === 4 && p.velocity === 90));
  assert.equal(
    timeline
      .get(1)
      .filter((p) => p.time === 6)
      .at(-1).velocity,
    58,
  );
  assert.ok(timeline.get(2).every((p) => p.velocity === null));
});

test('unquantified hairpins invalidate the old target until the next authored value', () => {
  const map = [
    { measureOn: 'm1', qstamp: 0, tstamp: 0, tempo: 120 },
    { qstamp: 4, tstamp: 2000 },
  ];
  const timeline = velocityReferenceTimeline(
    [
      {
        id: 'm1',
        unit: 4,
        changes: [
          { staff: 1, beat: 1, velocity: 64 },
          { staff: 1, beat: 2, velocity: null },
          { staff: 1, beat: 4, velocity: 90 },
        ],
      },
    ],
    [1],
    map,
  ).get(1);
  assert.deepEqual(timeline.slice(-3), [
    { time: 0, velocity: 64 },
    { time: 0.5, velocity: null },
    { time: 1.5, velocity: 90 },
  ]);
});

test('MusicXML beat unit changes are applied to dynamics timing', () => {
  const timeline = velocityReferenceTimeline(
    [{ id: 'm1', unit: 8, changes: [{ staff: 1, beat: 3, velocity: 64 }] }],
    [1],
    [
      { measureOn: 'm1', qstamp: 0, tstamp: 0, tempo: 120 },
      { qstamp: 3, tstamp: 1500 },
    ],
  );
  assert.equal(timeline.get(1).at(-1).time, 0.5);
});
