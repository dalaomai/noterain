import { useEffect, useRef, useCallback } from 'react';
import { useMidiStore, getMeasureTime, createSortedNotesIndex } from '../stores/midiStore';
import { useAudioEngine } from './useAudioEngine';
import { MidiNote } from '../types/midi';
import { getPlaybackNoteIndex, schedulePlaybackAudio } from '../lib/playbackAudio';

/** Hook for MIDI playback control */
export function usePlayback() {
  // Use selective subscriptions to avoid re-rendering on every seek() call
  const isPlaying = useMidiStore((s) => s.playback.isPlaying);
  const currentTime = useMidiStore((s) => s.playback.currentTime);
  const speed = useMidiStore((s) => s.playback.speed);
  const waitMode = useMidiStore((s) => s.playback.waitMode);
  const activeNotes = useMidiStore((s) => s.playback.activeNotes);
  const loopEnabled = useMidiStore((s) => s.playback.loopEnabled);
  const loopStartMeasure = useMidiStore((s) => s.playback.loopStartMeasure);
  const loopEndMeasure = useMidiStore((s) => s.playback.loopEndMeasure);

  const play = useMidiStore((s) => s.play);
  const pause = useMidiStore((s) => s.pause);
  const stop = useMidiStore((s) => s.stop);
  const seek = useMidiStore((s) => s.seek);
  const advancePlayback = useMidiStore((s) => s.advancePlayback);
  const setSpeed = useMidiStore((s) => s.setSpeed);
  const toggleWaitMode = useMidiStore((s) => s.toggleWaitMode);
  const setActiveNotes = useMidiStore((s) => s.setActiveNotes);
  const getCurrentFile = useMidiStore((s) => s.getCurrentFile);
  const buildWaitModeNoteList = useMidiStore((s) => s.buildWaitModeNoteList);
  const resetWaitModeState = useMidiStore((s) => s.resetWaitModeState);
  const advanceWaitModeReached = useMidiStore((s) => s.advanceWaitModeReached);
  const getWaitModeBoundary = useMidiStore((s) => s.getWaitModeBoundary);
  const setWaitModeBlocked = useMidiStore((s) => s.setWaitModeBlocked);
  const setLoopRange = useMidiStore((s) => s.setLoopRange);
  const toggleLoop = useMidiStore((s) => s.toggleLoop);
  const clearLoop = useMidiStore((s) => s.clearLoop);

  const { playNote, stopAll, resumeAudio, getAudioTime } = useAudioEngine();

  const animationFrameRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);
  // Track current playback time in ref to avoid stale closure in tick()
  const currentTimeRef = useRef<number>(0);
  // Sorted notes index + cursor for O(log n) note scheduling
  const sortedNotesRef = useRef<{ notes: MidiNote[]; maxDuration: number }>({ notes: [], maxDuration: 0 });
  const scheduleCursorRef = useRef<number>(0);
  // Track previous activeNotes to avoid unnecessary store writes
  const prevActiveNotesRef = useRef<Set<number>>(new Set());
  // Track map for O(1) lookups inside tick (rebuilt when file changes)
  const trackMapRef = useRef<Map<number, { enabled: boolean; playAudio: boolean }>>(new Map());
  const fileIdRef = useRef<string | null>(null);

  // Main playback loop
  useEffect(() => {
    console.log('[Playback] Effect triggered, isPlaying:', isPlaying);

    if (!isPlaying) {
      console.log('[Playback] Not playing, cleaning up animation frame');
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      return;
    }

    const initialFile = getCurrentFile();
    if (!initialFile) {
      console.log('[Playback] No file loaded, pausing');
      pause();
      return;
    }

    console.log(
      '[Playback] Starting playback loop, file duration:',
      initialFile.duration,
    );
    lastTimeRef.current = performance.now();
    // Initialize currentTimeRef from store
    currentTimeRef.current = useMidiStore.getState().playback.currentTime;

    // Build sorted notes index for O(log n) scheduling
    sortedNotesRef.current = createSortedNotesIndex(initialFile);
    fileIdRef.current = initialFile.id;
    // Build track map for O(1) lookups
    const tMap = new Map<number, { enabled: boolean; playAudio: boolean }>();
    for (const t of initialFile.tracks) tMap.set(t.index, { enabled: t.enabled, playAudio: t.playAudio });
    trackMapRef.current = tMap;
    // Set cursor to first note at or after current time
    const sortedNotes = sortedNotesRef.current.notes;
    scheduleCursorRef.current = getPlaybackNoteIndex(sortedNotes, currentTimeRef.current);

    // Build the sorted note list for wait mode (index-based tracking)
    buildWaitModeNoteList();
    let seekVersion = useMidiStore.getState().seekVersion;
    let audioSpeed = useMidiStore.getState().playback.speed;
    let audioWaitMode = useMidiStore.getState().playback.waitMode;
    let resumingAudio = false;
    let resumeAfter = 0;
    let disposed = false;
    let audioAnchor: { scoreTime: number; audioTime: number } | null = null;
    const resetAudio = (time: number) => {
      stopAll();
      audioAnchor = null;
      scheduleCursorRef.current = getPlaybackNoteIndex(sortedNotesRef.current.notes, time);
    };
    const scheduleAudio = () => {
      const state = useMidiStore.getState();
      const file = state.getCurrentFile();
      if (
        disposed || !file || !state.playback.isPlaying || state.playback.waitMode ||
        state.seekVersion !== seekVersion || state.playback.speed !== audioSpeed ||
        file.id !== fileIdRef.current
      ) return;
      const scoreTime = currentTimeRef.current +
        (performance.now() - lastTimeRef.current) / 1000 * state.playback.speed;
      if (!state.settings.audioEnabled) {
        scheduleCursorRef.current = getPlaybackNoteIndex(sortedNotesRef.current.notes, scoreTime);
        return;
      }
      const audioTime = getAudioTime();
      if (audioTime === null) {
        if (audioAnchor) resetAudio(scoreTime);
        // Reopen an interrupted context during rests, before the next attack.
        if (!resumingAudio && performance.now() >= resumeAfter) {
          resumingAudio = true;
          resumeAfter = performance.now() + 1000;
          void resumeAudio().catch((error: unknown) => {
            console.warn('[Playback] Cannot resume audio:', error);
          }).finally(() => { resumingAudio = false; });
        }
        return;
      }
      audioAnchor ??= { scoreTime, audioTime };
      // One clock mapping keeps timer jitter from changing rhythmic intervals.
      const mappedAudioTime = audioAnchor.audioTime +
        (scoreTime - audioAnchor.scoreTime) / state.playback.speed;
      const { loopEnabled, loopEndMeasure } = state.playback;
      const endTime = loopEnabled && loopEndMeasure !== null
        ? Math.min(file.duration, getMeasureTime(file, loopEndMeasure + 1))
        : file.duration;
      scheduleCursorRef.current = schedulePlaybackAudio(
        sortedNotesRef.current.notes, scheduleCursorRef.current, scoreTime,
        mappedAudioTime, state.playback.speed, endTime,
        (note, duration, time) => {
          const track = file.tracks.find((track) => track.index === note.track);
          return !track?.playAudio || playNote(note.noteNumber, note.velocity, duration, time);
        },
      );
    };

    const tick = () => {
      const state = useMidiStore.getState();
      const file = state.files.find((f) => f.id === state.currentFileId);
      if (!file) {
        stop();
        return;
      }

      // Rebuild track map if file changed (rare — track enable/disable)
      if (file.id !== fileIdRef.current) {
        fileIdRef.current = file.id;
        sortedNotesRef.current = createSortedNotesIndex(file);
      }
      // Refresh track enabled/playAudio flags (cheap — just overwrite values)
      const tMap = trackMapRef.current;
      for (const t of file.tracks) {
        const existing = tMap.get(t.index);
        if (existing) {
          existing.enabled = t.enabled;
          existing.playAudio = t.playAudio;
        } else {
          tMap.set(t.index, { enabled: t.enabled, playAudio: t.playAudio });
        }
      }

      const now = performance.now();
      let deltaMs = now - lastTimeRef.current;
      lastTimeRef.current = now;

      // Check if user seeked externally (slider) - sync if store time differs significantly
      const storeTime = state.playback.currentTime;
      if (state.seekVersion !== seekVersion || Math.abs(storeTime - currentTimeRef.current) > 0.1) {
        const explicitSeek = state.seekVersion !== seekVersion;
        if (explicitSeek) deltaMs = 0;
        seekVersion = state.seekVersion;
        currentTimeRef.current = storeTime;
        resetAudio(storeTime);
        // seek() already reset progress. Do not erase an input arriving between
        // the seek and this frame; other position changes still need a reset.
        if (!explicitSeek) resetWaitModeState(storeTime);
      }

      if (audioSpeed !== state.playback.speed || audioWaitMode !== state.playback.waitMode) {
        audioSpeed = state.playback.speed;
        audioWaitMode = state.playback.waitMode;
        resetAudio(currentTimeRef.current);
      }

      // Calculate new time using ref (not stale closure)
      const speed = state.playback.speed;
      const deltaSeconds = (deltaMs / 1000) * speed;
      const prevTime = currentTimeRef.current;
      let newTime = prevTime + deltaSeconds;
      // Clamp at the first missing onset, even after a slow frame. A short
      // note must not expire and let the player skip it without playing it.
      const boundary = state.playback.waitMode ? getWaitModeBoundary(newTime) : null;
      const blocked = boundary !== null;
      if (boundary !== null) newTime = Math.max(prevTime, boundary);
      currentTimeRef.current = newTime;

      // Check for loop boundary
      const { loopEnabled, loopStartMeasure, loopEndMeasure } = state.playback;
      if (loopEnabled && loopStartMeasure !== null && loopEndMeasure !== null) {
        const loopEndTime = getMeasureTime(file, loopEndMeasure + 1); // End of the last measure
        const loopStartTime = getMeasureTime(file, loopStartMeasure);

        if (newTime >= loopEndTime) {
          // Loop back to start
          newTime = loopStartTime;
          currentTimeRef.current = loopStartTime;
          resetAudio(loopStartTime);
          resetWaitModeState(loopStartTime); // Reset wait mode on loop
          seek(loopStartTime);
          animationFrameRef.current = requestAnimationFrame(tick);
          return;
        }
      }

      // Loop back to start when reaching the end
      if (newTime >= file.duration) {
        newTime = 0;
        currentTimeRef.current = 0;
        resetAudio(0);
        resetWaitModeState(0);
        prevActiveNotesRef.current = new Set();
        seek(0);
        animationFrameRef.current = requestAnimationFrame(tick);
        return;
      }

      // Build active notes set from sorted index using binary scan (O(k) where k = visible notes)
      const activeNoteNumbers = new Set<number>();
      const sNotes = sortedNotesRef.current.notes;
      const maxDur = sortedNotesRef.current.maxDuration;
      // Only scan notes that could possibly be active (started within maxDuration ago)
      const scanStart = newTime - maxDur;
      // Visual state must not depend on an audio cursor waiting for the engine.
      const scanIdx = getPlaybackNoteIndex(sNotes, scanStart);
      for (let i = scanIdx; i < sNotes.length; i++) {
        const n = sNotes[i];
        if (n.startTime > newTime) break;
        if (n.startTime + n.duration > newTime) {
          const tInfo = tMap.get(n.track);
          if (tInfo?.enabled) {
            activeNoteNumbers.add(n.noteNumber);
          }
        }
      }

      // Waiting holds the score while the independent event clock keeps time.
      if (state.playback.waitMode) {
        // Advance the cursor to include any notes we've reached at newTime
        advanceWaitModeReached(newTime);

        // Check if there are unsatisfied notes that are still active at newTime
        setWaitModeBlocked(blocked, now);
        if (blocked) {
          advancePlayback(newTime);
          const previous = prevActiveNotesRef.current;
          if (activeNoteNumbers.size !== previous.size || [...activeNoteNumbers].some((n) => !previous.has(n))) {
            prevActiveNotesRef.current = activeNoteNumbers;
            setActiveNotes(activeNoteNumbers);
          }
          // Still update the animation frame to keep checking
          animationFrameRef.current = requestAnimationFrame(tick);
          return;
        }
      }

      if (state.playback.waitMode) {
        while (scheduleCursorRef.current < sNotes.length) {
          const note = sNotes[scheduleCursorRef.current];
          if (note.startTime > newTime) break;
          if (tMap.get(note.track)?.playAudio) {
            playNote(note.noteNumber, note.velocity, note.duration / speed);
          }
          scheduleCursorRef.current++;
        }
      }

      // Only update activeNotes in store if the set actually changed
      const prev = prevActiveNotesRef.current;
      if (activeNoteNumbers.size !== prev.size || [...activeNoteNumbers].some((n) => !prev.has(n))) {
        prevActiveNotesRef.current = activeNoteNumbers;
        setActiveNotes(activeNoteNumbers);
      }
      advancePlayback(newTime);
      scheduleAudio();

      animationFrameRef.current = requestAnimationFrame(tick);
    };

    scheduleAudio();
    // Audio remains scheduled while a drawing frame is delayed or throttled.
    const audioTimer = window.setInterval(scheduleAudio, 25);
    animationFrameRef.current = requestAnimationFrame(tick);

    return () => {
      disposed = true;
      window.clearInterval(audioTimer);
      stopAll();
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
    // Note: playback.currentTime and playback.speed are intentionally excluded -
    // they're read via useMidiStore.getState() inside tick() to avoid stale closures
  }, [
    isPlaying,
    getCurrentFile,
    pause,
    stop,
    seek,
    setActiveNotes,
    playNote,
    stopAll,
    resumeAudio,
    getAudioTime,
    buildWaitModeNoteList,
    resetWaitModeState,
    advanceWaitModeReached,
    getWaitModeBoundary,
    setWaitModeBlocked,
    advancePlayback,
  ]);

  // Pause playback when window/tab loses focus or becomes hidden
  useEffect(() => {
    const pauseIfPlaying = () => {
      // Read fresh state to avoid stale closure
      const isPlaying = useMidiStore.getState().playback.isPlaying;
      if (isPlaying) {
        console.log('[Playback] Window lost focus, pausing playback');
        stopAll();
        pause();
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        pauseIfPlaying();
      }
    };

    const handleBlur = () => {
      pauseIfPlaying();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleBlur);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleBlur);
    };
  }, [pause, stopAll]);

  /** Toggle play/pause */
  const togglePlay = useCallback(async () => {
    console.log(
      '[Playback] togglePlay called, current isPlaying:',
      isPlaying,
    );
    await resumeAudio();

    if (isPlaying) {
      console.log('[Playback] Pausing playback');
      stopAll();
      pause();
    } else {
      console.log('[Playback] Starting playback');
      play();
    }
  }, [isPlaying, play, pause, stopAll, resumeAudio]);

  /** Stop playback and reset */
  const handleStop = useCallback(() => {
    stopAll();
    stop();
    resetWaitModeState(useMidiStore.getState().playback.currentTime);
  }, [stop, stopAll, resetWaitModeState]);

  /** Seek to position (0-1) */
  const seekToPercent = useCallback(
    (percent: number) => {
      const file = getCurrentFile();
      if (!file) return;
      seek(file.duration * Math.max(0, Math.min(1, percent)));
    },
    [getCurrentFile, seek],
  );

  /** Get current progress (0-1) */
  const getProgress = useCallback(() => {
    const file = getCurrentFile();
    if (!file || file.duration === 0) return 0;
    return useMidiStore.getState().playback.currentTime / file.duration;
  }, [getCurrentFile]);

  return {
    isPlaying,
    currentTime,
    speed,
    waitMode,
    activeNotes,
    loopEnabled,
    loopStartMeasure,
    loopEndMeasure,
    togglePlay,
    stop: handleStop,
    seek,
    seekToPercent,
    setSpeed,
    toggleWaitMode,
    getProgress,
    setLoopRange,
    toggleLoop,
    clearLoop,
  };
}
