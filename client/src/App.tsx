import { lazy, Suspense, useCallback, useEffect, useMemo, useRef } from 'react';
import { Controls } from './components/Controls/Controls';
import { FollowFeedback } from './components/FollowFeedback/FollowFeedback';
import { LoadingScreen } from './components/LoadingScreen/LoadingScreen';
import { PianoKeyboard } from './components/PianoKeyboard/PianoKeyboard';
import { PwaStatus } from './components/PwaStatus/PwaStatus';
import { startCloudUploadQueue } from './features/cloud-scores/cloudQueue';
import { installE2EImportBridge } from './features/e2e/importBridge';
import { useAudioEngine } from './hooks/useAudioEngine';
import { useMidiFile } from './hooks/useMidiFile';
import { useMidiInput } from './hooks/useMidiInput';
import { useI18n } from './hooks/useI18n';
import { useMidiStore, calculateNoteRange } from './stores/midiStore';
import './App.css';

const FallingNotes = lazy(() => import('./components/FallingNotes/FallingNotes').then(
  (module) => ({ default: module.FallingNotes }),
));
const MusicXmlSheet = lazy(() => import('./components/MusicXmlSheet/MusicXmlSheet').then(
  (module) => ({ default: module.MusicXmlSheet }),
));
const NotesOverlay = lazy(() => import('./components/NotesOverlay/NotesOverlay').then(
  (module) => ({ default: module.NotesOverlay }),
));
const SheetMusic = lazy(() => import('./components/SheetMusic/SheetMusic').then(
  (module) => ({ default: module.SheetMusic }),
));
const SvgPerformanceSheet = lazy(() => import('./components/SvgPerformanceSheet/SvgPerformanceSheet').then(
  (module) => ({ default: module.SvgPerformanceSheet }),
));

function App() {
  useEffect(() => startCloudUploadQueue(), []);

  const { handleDrop, currentFile, loadFile } = useMidiFile();
  const audioEngine = useAudioEngine(Boolean(currentFile));
  const { noteOn, noteOff, setSustain, resumeAudio, requestAudio, audioActive, isLoading, loadingPhase, downloadProgress, decodeProgress, totalSamples, totalLayers, isLoadingFullVelocity, audioError, isRetryingAudio, retryAudio } = audioEngine;
  const { settings, setLiveNote, addSatisfiedWaitNote } = useMidiStore();
  const { t } = useI18n();

  useEffect(() => installE2EImportBridge(loadFile), [loadFile]);

  // Store audio functions in ref to avoid MIDI listener re-subscriptions
  const audioRef = useRef({ noteOn, noteOff, setSustain, resumeAudio, requestAudio, audioActive, settings, isLoading });
  audioRef.current = { noteOn, noteOff, setSustain, resumeAudio, requestAudio, audioActive, settings, isLoading };

  // MIDI input callbacks - play audio when hardware MIDI notes are received
  const handleMidiNoteOn = useCallback(async (noteNumber: number, velocity: number) => {
    const { noteOn, resumeAudio, requestAudio, audioActive, settings, isLoading } = audioRef.current;
    if (!audioActive) {
      requestAudio();
      return;
    }
    if (isLoading) return; // Block input while loading
    if (settings.playMidiInputAudio) {
      await resumeAudio();
      noteOn(noteNumber, velocity);
    }
  }, []);

  const handleMidiNoteOff = useCallback((noteNumber: number) => {
    const { noteOff, settings, isLoading } = audioRef.current;
    if (isLoading) return; // Block input while loading
    if (settings.playMidiInputAudio) {
      noteOff(noteNumber);
    }
  }, []);

  const handleMidiSustain = useCallback((isPressed: boolean) => {
    const { setSustain, settings, isLoading } = audioRef.current;
    if (isLoading) return; // Block input while loading
    if (settings.playMidiInputAudio) {
      setSustain(isPressed);
    }
  }, []);

  // Initialize MIDI input with audio callbacks
  useMidiInput({
    onNoteOn: handleMidiNoteOn,
    onNoteOff: handleMidiNoteOff,
    onSustain: handleMidiSustain,
  });

  // Calculate dynamic note range based on enabled tracks (only when fitKeyboardToSong is enabled)
  const { minNote, maxNote } = useMemo(
    () => settings.fitKeyboardToSong ? calculateNoteRange(currentFile, 2) : calculateNoteRange(null, 2),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentFile, currentFile?.tracks, settings.fitKeyboardToSong]
  );

  // Apply theme to document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', settings.theme);
  }, [settings.theme]);

  // Handle key press on virtual piano
  const handleNoteOn = useCallback(
    async (noteNumber: number) => {
      if (!audioActive) {
        requestAudio();
        return;
      }
      if (isLoading) return; // Block input while loading
      // Register before the audio promise: its latency is not playing error.
      setLiveNote(noteNumber, true);
      addSatisfiedWaitNote(noteNumber);
      await resumeAudio();
      noteOn(noteNumber, 64);
    },
    [noteOn, resumeAudio, requestAudio, audioActive, setLiveNote, addSatisfiedWaitNote, isLoading]
  );

  const handleNoteOff = useCallback(
    (noteNumber: number) => {
      if (isLoading) return; // Block input while loading
      noteOff(noteNumber);
      setLiveNote(noteNumber, false);
    },
    [noteOff, setLiveNote, isLoading]
  );

  // Handle drag over
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  return (
    <div
      className="app"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      {isLoading && (
        <LoadingScreen
          phase={loadingPhase}
          downloadProgress={downloadProgress}
          decodeProgress={decodeProgress}
          totalSamples={totalSamples}
          totalLayers={totalLayers}
        />
      )}

      <Controls playbackAudio={audioEngine} isLoadingFullVelocity={isLoadingFullVelocity} audioError={audioError} isRetryingAudio={isRetryingAudio} onRetryAudio={retryAudio} />

      <div className={`main-content${settings.showPianoKeyboard ? '' : ' keyboard-hidden'}${settings.showPianoKeyboard && settings.pinKeyboardExpanded ? ' keyboard-pinned' : ''}`}>
        <Suspense fallback={null}>
          {settings.showNotesOverlay && <NotesOverlay />}

          {currentFile?.sourceFormat === 'svg-midi' &&
            settings.showSheetMusic &&
            settings.showOriginalMusicXml && (
            <SvgPerformanceSheet key={currentFile.id} />
          )}

          {currentFile?.sourceFormat === 'musicxml' &&
            settings.showSheetMusic &&
            settings.showOriginalMusicXml && (
            <MusicXmlSheet key={currentFile.id} />
          )}

          {currentFile && settings.showSheetMusic &&
            (currentFile.sourceFormat === 'midi' ||
              !settings.showOriginalMusicXml) && (
            <SheetMusic key={currentFile.id} />
          )}

          {currentFile && settings.showFallingNotes && !settings.showSheetMusic && (
            <FallingNotes key={currentFile.id} lookahead={3} minNote={minNote} maxNote={maxNote} />
          )}
        </Suspense>

        {!currentFile && !isLoading && (
          <div className="empty-state">
            <p>{t('emptyState')}</p>
          </div>
        )}

        {settings.showPianoKeyboard && (
          <PianoKeyboard
            onNoteOn={handleNoteOn}
            onNoteOff={handleNoteOff}
            minNote={minNote}
            maxNote={maxNote}
          />
        )}
        {currentFile && <FollowFeedback minNote={minNote} maxNote={maxNote} />}
        <PwaStatus />
      </div>
    </div>
  );
}

export default App;
