import { useCallback, useRef } from 'react';
import { useMidiStore } from '../stores/midiStore';
import { useScoreHistoryStore } from '../stores/scoreHistoryStore';
import { parseMidiFile, createEmptyMidiFile, exportToMidi } from '../lib/midi/parser';
import {
  isMusicXmlFileName,
  parseMusicXmlFile,
} from '../lib/musicxml/parser';
import { removeRawMidiData } from '../utils/storage';
import { loadScoreHistoryFile } from '../utils/midiDb';
import type { MidiFile } from '../types/midi';
import type { CollectedScore } from '../features/score-link-import/core/types';
import { buildSvgPerformanceScore } from '../features/score-link-import/core/svgPerformance';
import { createScorePackage, parseScorePackage } from '../features/score-link-import/core/scorePackage';
import { enqueueCloudUpload } from '../features/cloud-scores/cloudQueue';

function isSupportedScoreFile(file: File): boolean {
  return /\.(mid|midi|noterain)$/i.test(file.name) || isMusicXmlFileName(file.name);
}

type ScorePickerWindow = Window & {
  showOpenFilePicker?: (options: {
    id: string;
    multiple: boolean;
    startIn: 'downloads';
  }) => Promise<{ getFile(): Promise<File> }[]>;
};

/** Hook for MIDI file operations */
export function useMidiFile() {
  const nativePickerFallbackRef = useRef(false);
  const {
    files,
    currentFileId,
    addFile,
    removeFile,
    updateFile,
    setCurrentFile,
    getCurrentFile,
  } = useMidiStore();

  const loadSvgMidiScore = useCallback(
    async (score: CollectedScore, source = createScorePackage(score)): Promise<MidiFile> => {
      const binary = atob(score.midiBase64);
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      const midiFile = parseMidiFile(
        bytes.buffer,
        `${score.title.replace(/[\\/:*?"<>|]/g, '_') || 'MuseScore'}.mid`,
      );
      midiFile.title = score.title;
      midiFile.sourceFormat = 'svg-midi';
      midiFile.svgScore = buildSvgPerformanceScore(midiFile, score.pages);
      midiFile.historyId = await useScoreHistoryStore.getState().recordImport(source, midiFile);
      if (midiFile.historyId) enqueueCloudUpload(midiFile.historyId, midiFile);
      addFile(midiFile);
      setCurrentFile(midiFile.id);
      return midiFile;
    },
    [addFile, setCurrentFile],
  );

  /** Load a MIDI file from File object */
  const loadFile = useCallback(
    async (file: File): Promise<MidiFile> => {
      if (/\.noterain$/i.test(file.name)) {
        const score = await parseScorePackage(file);
        const midiFile = await loadSvgMidiScore(score, file);
        return midiFile;
      }
      const midiFile = isMusicXmlFileName(file.name)
        ? await parseMusicXmlFile(file)
        : parseMidiFile(await file.arrayBuffer(), file.name);
      midiFile.historyId = await useScoreHistoryStore.getState().recordImport(file, midiFile);
      if (midiFile.historyId) enqueueCloudUpload(midiFile.historyId, midiFile);
      addFile(midiFile);
      setCurrentFile(midiFile.id);
      return midiFile;
    },
    [addFile, setCurrentFile, loadSvgMidiScore]
  );

  /** Prefer Android's document picker over the media upload chooser. */
  const handleFilePicker = useCallback(
    async (e: React.MouseEvent<HTMLInputElement>) => {
      if (nativePickerFallbackRef.current) return;
      const pickerWindow = window as ScorePickerWindow;
      if (!window.isSecureContext || !pickerWindow.showOpenFilePicker) return;

      e.preventDefault();
      const input = e.currentTarget;
      let handles;
      try {
        // No MIME filters: Android providers may label scores as audio or ZIP.
        handles = await pickerWindow.showOpenFilePicker({
          id: 'import-score',
          multiple: false,
          startIn: 'downloads',
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        // Some browsers expose the API but block it in the current context.
        nativePickerFallbackRef.current = true;
        try {
          input.click();
        } finally {
          nativePickerFallbackRef.current = false;
        }
        return;
      }

      for (const handle of handles) {
        const file = await handle.getFile();
        if (isSupportedScoreFile(file)) await loadFile(file);
      }
    },
    [loadFile],
  );

  /** Load a MIDI file from URL */
  const loadFromUrl = useCallback(
    async (url: string, name?: string): Promise<MidiFile> => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to fetch score: HTTP ${response.status}`);
      const fileName = name || url.split('/').pop() || 'Untitled.mid';
      return loadFile(new File([await response.blob()], fileName));
    },
    [loadFile]
  );

  /** Create a new empty MIDI file */
  const createNew = useCallback(
    (name: string = 'Untitled'): MidiFile => {
      const midiFile = createEmptyMidiFile(name);
      addFile(midiFile);
      setCurrentFile(midiFile.id);
      return midiFile;
    },
    [addFile, setCurrentFile]
  );

  /** Delete a MIDI file */
  const deleteFile = useCallback(
    (id: string) => {
      void removeRawMidiData(id);
      removeFile(id);
    },
    [removeFile]
  );

  /** Export current file as .mid download */
  const exportFile = useCallback(
    (file?: MidiFile) => {
      const targetFile = file || getCurrentFile();
      if (!targetFile) return;

      // Generate fresh MIDI data from internal format
      const midiData = exportToMidi(targetFile);
      const blob = new Blob([new Uint8Array(midiData)], { type: 'audio/midi' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = targetFile.name.endsWith('.mid')
        ? targetFile.name
        : `${targetFile.name}.mid`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
    [getCurrentFile]
  );

  const downloadSvgMidiPackage = useCallback(async (file?: MidiFile) => {
    const targetFile = file || getCurrentFile();
    if (targetFile?.sourceFormat !== 'svg-midi' || !targetFile.historyId) return false;
    const packageFile = await loadScoreHistoryFile(targetFile.historyId);
    const url = URL.createObjectURL(packageFile);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = packageFile.name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    return true;
  }, [getCurrentFile]);

  /** Handle file drop */
  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      const droppedFiles = Array.from(e.dataTransfer.files).filter(
        isSupportedScoreFile,
      );

      for (const file of droppedFiles) {
        await loadFile(file);
      }
    },
    [loadFile]
  );

  /** Handle file input change */
  const handleFileInput = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFiles = Array.from(e.target.files || []).filter(
        isSupportedScoreFile,
      );

      for (const file of selectedFiles) {
        await loadFile(file);
      }

      // Reset input
      e.target.value = '';
    },
    [loadFile]
  );

  return {
    files,
    currentFile: getCurrentFile(),
    currentFileId,
    loadFile,
    loadFromUrl,
    loadSvgMidiScore,
    createNew,
    deleteFile,
    updateFile,
    setCurrentFile,
    exportFile,
    downloadSvgMidiPackage,
    handleDrop,
    handleFilePicker,
    handleFileInput,
  };
}
