import { useRef, useState, useEffect } from 'react';
import {
  Play,
  Pause,
  Square,
  Volume2,
  VolumeX,
  Sun,
  Moon,
  Repeat,
  X,
  Eye,
  EyeOff,
  CloudDownload,
  CheckCircle2,
  Trash2,
  SlidersHorizontal,
  Maximize,
  Minimize,
  ChevronDown,
  Clock3,
} from 'lucide-react';
import { ScoreHistory } from '../ScoreHistory/ScoreHistory';
import { FloatingPlaybackRemote } from '../FloatingPlaybackRemote/FloatingPlaybackRemote';
import { ScoreSelector } from './ScoreSelector';
import { usePlayback } from '../../hooks/usePlayback';
import { useMidiFile } from '../../hooks/useMidiFile';
import { useMidiInput } from '../../hooks/useMidiInput';
import { useOfflinePack } from '../../hooks/useOfflinePack';
import { useI18n } from '../../hooks/useI18n';
import { useFullscreen } from '../../hooks/useFullscreen';
import { useAutoHideToolbar } from '../../hooks/useAutoHideToolbar';
import { useScreenWakeLock } from '../../hooks/useScreenWakeLock';
import { usePwaStore } from '../../stores/pwaStore';
import { LOCALE_OPTIONS } from '../../i18n';
import {
  useMidiStore,
  getMeasureCount,
  getSecondsPerMeasure,
} from '../../stores/midiStore';
import styles from './Controls.module.css';

interface ControlsProps {
  isLoadingFullVelocity: boolean;
}

const FEEDBACK_OPTIONS = ['followPitchFeedback', 'followTimingFeedback', 'followVelocityFeedback'] as const;

export function Controls({ isLoadingFullVelocity }: ControlsProps) {
  const headerRef = useRef<HTMLDivElement>(null);
  const autoCloseTimerRef = useRef<number | null>(null);
  const [isExpanded, setIsExpanded] = useState(
    () =>
      window.matchMedia(
        '(min-width: 901px) and (hover: hover) and (pointer: fine)',
      ).matches,
  );
  const [tracksDropdownOpen, setTracksDropdownOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  const {
    isPlaying,
    currentTime,
    speed,
    waitMode,
    loopEnabled,
    loopStartMeasure,
    loopEndMeasure,
    togglePlay,
    stop,
    seekToPercent,
    setSpeed,
    toggleWaitMode,
    getProgress,
    setLoopRange,
    toggleLoop,
    clearLoop,
  } = usePlayback();

  const {
    files,
    currentFile,
    currentFileId,
    setCurrentFile,
    handleFilePicker,
    handleFileInput,
  } = useMidiFile();

  const {
    inputs,
    selectedInput,
    selectInput,
    isEnabled,
    accessState,
    accessError,
    requestAccess,
    bluetoothState,
    bluetoothError,
    bluetoothDeviceName,
    connectBluetooth,
    disconnectBluetooth,
  } = useMidiInput();

  const { settings, updateSettings } = useMidiStore();
  const keepScreenAwake = settings.keepScreenAwake ?? true;
  const screenWakeLock = useScreenWakeLock(keepScreenAwake);

  const offlinePack = useOfflinePack();
  const pwa = usePwaStore();

  const { locale, t, setLocale } = useI18n();
  const fullscreen = useFullscreen();
  const toolbar = useAutoHideToolbar(
    fullscreen.isFullscreen,
    isExpanded || isHistoryOpen,
  );

  // Auto-collapse when playback starts
  useEffect(() => {
    if (isPlaying) {
      setIsExpanded(false);
    }
  }, [isPlaying]);

  useEffect(() => {
    document.documentElement.dataset.settingsOpen = String(isExpanded);
    return () => {
      delete document.documentElement.dataset.settingsOpen;
    };
  }, [isExpanded]);

  useEffect(() => {
    const desktopQuery = window.matchMedia(
      '(min-width: 901px) and (hover: hover) and (pointer: fine)',
    );
    const handleBreakpointChange = (event: MediaQueryListEvent) => {
      setIsExpanded(event.matches);
    };
    desktopQuery.addEventListener('change', handleBreakpointChange);
    return () => {
      desktopQuery.removeEventListener('change', handleBreakpointChange);
    };
  }, []);

  const cancelAutoClose = () => {
    if (autoCloseTimerRef.current !== null) {
      window.clearTimeout(autoCloseTimerRef.current);
      autoCloseTimerRef.current = null;
    }
  };

  const scheduleAutoClose = () => {
    if (
      !window.matchMedia(
        '(min-width: 901px) and (hover: hover) and (pointer: fine)',
      ).matches
    )
      return;
    cancelAutoClose();
    autoCloseTimerRef.current = window.setTimeout(() => {
      setIsExpanded(false);
      autoCloseTimerRef.current = null;
    }, 900);
  };

  useEffect(() => cancelAutoClose, []);

  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const updateHeight = () => {
      document.documentElement.style.setProperty(
        '--controls-header-height',
        toolbar.isCollapsed
          ? '0px'
          : `${header.offsetHeight + (header.parentElement?.getBoundingClientRect().top ?? 0)}px`,
      );
    };
    const observer = new ResizeObserver(updateHeight);
    observer.observe(header);
    updateHeight();
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty('--controls-header-height');
    };
  }, [toolbar.isCollapsed, fullscreen.isFullscreen]);

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div
      className={`${styles.controls}${fullscreen.isFullscreen ? ` ${styles.fullscreenControls}` : ''}`}
    >
      <div
        id="playback-toolbar"
        ref={headerRef}
        className={`${styles.header}${toolbar.isCollapsed ? ` ${styles.headerCollapsed}` : ''}`}
        aria-hidden={toolbar.isCollapsed}
        inert={toolbar.isCollapsed}
        {...toolbar.headerEvents}
      >
        <div className={styles.headerLeft}>
          <img
            src="/logo.png"
            alt="noterain"
            className={styles.logo}
            style={{ background: 'white' }}
          />
          {/* File controls */}
          <div className={styles.section}>
            <label
              className={`${styles.button} ${styles.fileButton}`}
              htmlFor="score-file-input"
            >
              {t('openMidi')}
              {/* Keep the native input under the user's tap on mobile. */}
              <input
                id="score-file-input"
                className={styles.fileInput}
                type="file"
                // Android treats audio MIME types as requests for a recorder.
                // A generic document type also keeps XML/MXL files selectable.
                accept={
                  /Android/i.test(navigator.userAgent)
                    ? 'application/octet-stream'
                    : '.mid,.midi,.musicxml,.xml,.mxl'
                }
                onClick={handleFilePicker}
                onChange={handleFileInput}
              />
            </label>

            <button
              type="button"
              className={`${styles.button} ${styles.iconButton}`}
              title={t('scoreHistory')}
              aria-label={t('scoreHistory')}
              aria-haspopup="dialog"
              onClick={() => {
                setIsExpanded(false);
                setIsHistoryOpen(true);
              }}
            >
              <Clock3 size={18} />
            </button>

            {files.length > 0 && (
              <ScoreSelector
                files={files}
                currentFileId={currentFileId}
                onChange={setCurrentFile}
              />
            )}

            {/* Export button hidden for now
            {currentFile && (
              <button className={styles.button} onClick={() => exportFile()}>
                Export
              </button>
            )}
*/}
          </div>
        </div>

        {/* Playback controls - centered */}
        <div className={styles.headerCenter}>
          <button
            className={`${styles.button} ${styles.playButton}`}
            onClick={togglePlay}
            disabled={!currentFile}
          >
            {isPlaying ? <Pause size={16} /> : <Play size={16} />}
          </button>

          <button
            className={`${styles.button} ${styles.playButton}`}
            onClick={stop}
            disabled={!currentFile}
          >
            <Square size={16} />
          </button>

          <div className={styles.timeDisplay}>
            {formatTime(currentTime)} / {formatTime(currentFile?.duration || 0)}
            {currentFile && (
              <span className={styles.measureDisplay}>
                M
                {Math.floor(currentTime / getSecondsPerMeasure(currentFile)) +
                  1}
                /{getMeasureCount(currentFile)}
              </span>
            )}
          </div>

          <input
            type="range"
            className={styles.progressBar}
            min="0"
            max="100"
            value={getProgress() * 100}
            onChange={(e) => seekToPercent(parseFloat(e.target.value) / 100)}
            disabled={!currentFile}
          />
        </div>

        <div className={styles.headerRight}>
          {fullscreen.isSupported && (
            <button
              type="button"
              className={`${styles.button} ${styles.iconButton}`}
              title={
                fullscreen.isFullscreen
                  ? t('exitFullscreen')
                  : t('enterFullscreen')
              }
              aria-label={
                fullscreen.isFullscreen
                  ? t('exitFullscreen')
                  : t('enterFullscreen')
              }
              aria-pressed={fullscreen.isFullscreen}
              disabled={fullscreen.isChanging}
              onClick={() => {
                cancelAutoClose();
                setIsExpanded(false);
                void fullscreen.toggleFullscreen();
              }}
            >
              {fullscreen.isFullscreen ? (
                <Minimize size={18} />
              ) : (
                <Maximize size={18} />
              )}
            </button>
          )}

          {/* Toggle expand button */}
          <button
            className={`${styles.button} ${styles.iconButton}`}
            onClick={() => setIsExpanded(!isExpanded)}
            title={isExpanded ? t('hideControls') : t('showControls')}
          >
            <SlidersHorizontal size={18} />
          </button>
        </div>
      </div>

      {toolbar.isCollapsed && (
        <button
          type="button"
          className={styles.revealToolbar}
          title={t('showToolbar')}
          aria-label={t('showToolbar')}
          aria-controls="playback-toolbar"
          aria-expanded={false}
          onClick={toolbar.reveal}
        >
          <ChevronDown size={18} />
        </button>
      )}

      {(fullscreen.hasError || fullscreen.needsLandscape) && (
        <div className={styles.fullscreenNotice} role="status">
          {fullscreen.hasError
            ? t('fullscreenError')
            : t('rotateForFullscreen')}
        </div>
      )}

      {/* Expanded grid content */}
      <button
        type="button"
        className={`${styles.backdrop} ${isExpanded ? styles.backdropVisible : ''}`}
        aria-label={t('hideControls')}
        onPointerDown={() => setIsExpanded(false)}
      />

      <aside
        className={`${styles.grid} ${isExpanded ? styles.sidebarOpen : ''}`}
        aria-hidden={!isExpanded}
        inert={!isExpanded}
        onMouseEnter={cancelAutoClose}
        onMouseLeave={scheduleAutoClose}
      >
        <div className={styles.sidebarHeader}>
          <span>{t('settings')}</span>
          <button
            className={`${styles.button} ${styles.iconButton}`}
            onClick={() => setIsExpanded(false)}
            title={t('hideControls')}
          >
            <X size={16} />
          </button>
        </div>
        <section
          className={styles.settingsGroup}
          aria-labelledby="display-settings"
        >
          <h2 id="display-settings" className={styles.groupTitle}>
            {t('displaySettings')}
          </h2>
          <div className={styles.gridItem}>
            <span className={styles.label}>{t('theme')}</span>
            <button
              className={`${styles.button} ${styles.iconButton}`}
              onClick={() =>
                updateSettings({
                  theme: settings.theme === 'mocha' ? 'latte' : 'mocha',
                })
              }
              title={
                settings.theme === 'mocha'
                  ? t('switchToLightTheme')
                  : t('switchToDarkTheme')
              }
            >
              {settings.theme === 'mocha' ? (
                <Sun size={18} />
              ) : (
                <Moon size={18} />
              )}
            </button>
          </div>
          {/* Render mode toggle */}
          <div className={styles.gridItem}>
            <button
              className={`${styles.button} ${styles.viewButton} ${!settings.showSheetMusic ? styles.active : ''}`}
              onClick={() => updateSettings({ showSheetMusic: false, showFallingNotes: true })}
            >
              {t('fallingNotes')}
            </button>
            <button
              className={`${styles.button} ${styles.viewButton} ${settings.showSheetMusic ? styles.active : ''}`}
              onClick={() => updateSettings({ showSheetMusic: true })}
            >
              {t('sheetMusic')}
            </button>
          </div>

          {currentFile?.sourceFormat === 'musicxml' &&
            settings.showSheetMusic && (
              <div className={styles.gridItem}>
                <label className={styles.label}>{t('scoreMode')}</label>
                <button
                  className={`${styles.button} ${settings.showOriginalMusicXml ? styles.active : ''}`}
                  onClick={() => updateSettings({ showOriginalMusicXml: true })}
                >
                  {t('originalScore')}
                </button>
                <button
                  className={`${styles.button} ${!settings.showOriginalMusicXml ? styles.active : ''}`}
                  onClick={() =>
                    updateSettings({ showOriginalMusicXml: false })
                  }
                >
                  {t('simplifiedScore')}
                </button>
              </div>
            )}

          {currentFile?.sourceFormat === 'musicxml' &&
            settings.showSheetMusic &&
            settings.showOriginalMusicXml && (
              <div className={styles.gridItem}>
                <label className={styles.label}>{t('scoreDensity')}</label>
                <select
                  className={styles.select}
                  value={settings.scoreDensity}
                  onChange={(event) =>
                    updateSettings({
                      scoreDensity: event.target.value as
                        'relaxed' | 'standard' | 'compact',
                    })
                  }
                >
                  <option value="relaxed">{t('scoreDensityRelaxed')}</option>
                  <option value="standard">{t('scoreDensityStandard')}</option>
                  <option value="compact">{t('scoreDensityCompact')}</option>
                </select>
                <label className={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={settings.expandMusicXmlRepeats}
                    onChange={() =>
                      updateSettings({
                        expandMusicXmlRepeats: !settings.expandMusicXmlRepeats,
                      })
                    }
                  />
                  {t('expandRepeats')}
                </label>
              </div>
            )}

          {/* Notes overlay toggle */}
          <div className={styles.gridItem}>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={settings.showNotesOverlay}
                onChange={() =>
                  updateSettings({
                    showNotesOverlay: !settings.showNotesOverlay,
                  })
                }
              />
              {t('showNotesChords')}
            </label>
          </div>

          {/* Note color mode toggle (only for falling notes view) */}
          {!settings.showSheetMusic && (
            <div className={styles.gridItem}>
              <label className={styles.label}>{t('colors')}</label>
              <button
                className={`${styles.button} ${settings.noteColorMode === 'track' ? styles.active : ''}`}
                onClick={() => updateSettings({ noteColorMode: 'track' })}
                title={t('colorByTrack')}
              >
                {t('track')}
              </button>
              <button
                className={`${styles.button} ${settings.noteColorMode === 'pitch' ? styles.active : ''}`}
                onClick={() => updateSettings({ noteColorMode: 'pitch' })}
                title={t('colorByPitch')}
              >
                {t('pitch')}
              </button>
            </div>
          )}
        </section>

        <section
          className={styles.settingsGroup}
          aria-labelledby="keyboard-settings"
        >
          <h2 id="keyboard-settings" className={styles.groupTitle}>
            {t('keyboardSettings')}
          </h2>
          <div className={styles.gridItem}>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={settings.pinKeyboardExpanded}
                onChange={() =>
                  updateSettings({
                    pinKeyboardExpanded: !settings.pinKeyboardExpanded,
                  })
                }
              />
              {t('pinKeyboardExpanded')}
            </label>
          </div>

          {/* Fit keyboard to song toggle */}
          <div className={styles.gridItem}>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={settings.fitKeyboardToSong}
                onChange={() =>
                  updateSettings({
                    fitKeyboardToSong: !settings.fitKeyboardToSong,
                  })
                }
              />
              {t('fitKeyboardToSong')}
            </label>
          </div>
        </section>

        <section
          className={styles.settingsGroup}
          aria-labelledby="practice-settings"
        >
          <h2 id="practice-settings" className={styles.groupTitle}>
            {t('practiceSettings')}
          </h2>
          <div className={styles.gridItem}>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={settings.showFloatingRemote ?? true}
                onChange={() =>
                  updateSettings({
                    showFloatingRemote: !(settings.showFloatingRemote ?? true),
                  })
                }
              />
              {t('showFloatingRemote')}
            </label>
          </div>
          <div className={styles.gridItem}>
            <label
              className={styles.checkboxLabel}
              title={t('keepScreenAwakeDescription')}
            >
              <input
                type="checkbox"
                checked={keepScreenAwake}
                onChange={() =>
                  updateSettings({ keepScreenAwake: !keepScreenAwake })
                }
              />
              {t('keepScreenAwake')}
            </label>
            {keepScreenAwake && screenWakeLock.status !== 'inactive' && (
              <span
                className={
                  screenWakeLock.status === 'error' ||
                  screenWakeLock.status === 'unsupported'
                    ? styles.warning
                    : styles.muted
                }
                role="status"
              >
                {t(
                  screenWakeLock.status === 'active'
                    ? 'screenWakeLockActive'
                    : screenWakeLock.status === 'requesting'
                      ? 'screenWakeLockRequesting'
                      : screenWakeLock.status === 'unsupported'
                        ? 'screenWakeLockUnsupported'
                        : 'screenWakeLockError',
                )}
              </span>
            )}
            {keepScreenAwake && screenWakeLock.status === 'error' && (
              <button
                type="button"
                className={styles.button}
                onClick={screenWakeLock.retry}
              >
                {t('retryScreenWakeLock')}
              </button>
            )}
          </div>
          {/* Wait mode toggle */}
          <div className={styles.gridItem}>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={waitMode}
                data-testid="follow-mode"
                onChange={toggleWaitMode}
              />
              {t('waitForInput')}
            </label>
            {waitMode && (
              <>
                <label className={styles.label}>{t('grace')}</label>
                <select
                  className={styles.select}
                  value={settings.waitModeGracePeriod}
                  onChange={(e) =>
                    updateSettings({
                      waitModeGracePeriod: parseInt(e.target.value),
                    })
                  }
                  title="Grace period for early note hits"
                >
                  {[0, 50, 100, 150, 200, 250, 300, 350, 400, 450, 500].map(
                    (ms) => (
                      <option key={ms} value={ms}>
                        {ms}ms
                      </option>
                    ),
                  )}
                </select>
              </>
            )}
          </div>

          <fieldset className={styles.feedbackOptions} disabled={!waitMode} data-testid="follow-feedback-settings">
            <legend>{t('followFeedback')}</legend>
            {FEEDBACK_OPTIONS.map((key) => <label key={key} className={`${styles.checkboxLabel} ${styles.feedbackOption}`}>
              <input type="checkbox" checked={settings[key]} onChange={(event) => updateSettings({ [key]: event.target.checked })} data-testid={key} />
              <span>{t(key)}</span>
              <svg viewBox="0 0 42 24" aria-hidden="true" className={key === 'followPitchFeedback' ? styles.pitchSample : styles.adjustSample}>
                {key === 'followTimingFeedback' ? <><path d="M5 12h32M21 8v8" fill="none" stroke="currentColor" opacity=".4" /><path d="M29 6v12" fill="none" stroke="currentColor" strokeWidth="2" /></> : <><circle cx="21" cy="12" r="7" fill="none" stroke="currentColor" strokeDasharray={key === 'followVelocityFeedback' ? '2 2' : undefined} opacity=".45" /><circle cx="21" cy="12" r="10" fill="none" stroke="currentColor" /></>}
              </svg>
            </label>)}
            <small>{t('followFeedbackShared')}</small>
          </fieldset>

          {/* Speed control */}
          <div className={styles.gridItem}>
            <label className={styles.label}>{t('speed')}</label>
            <input
              type="number"
              className={styles.speedInput}
              min="10"
              max="200"
              step="5"
              value={Math.round(speed * 100)}
              onChange={(e) => {
                const val = parseInt(e.target.value);
                if (!isNaN(val)) {
                  setSpeed(Math.max(10, Math.min(200, val)) / 100);
                }
              }}
            />
            <span className={styles.label}>%</span>
          </div>

          {/* Loop controls */}
          {currentFile && (
            <div className={styles.gridItem}>
              <label className={styles.label}>{t('loop')}</label>
              <button
                className={`${styles.button} ${loopEnabled ? styles.active : ''}`}
                onClick={toggleLoop}
                title={t('toggleLoop')}
              >
                <Repeat size={16} />
              </button>
              {loopEnabled && (
                <>
                  <input
                    type="number"
                    className={styles.measureInput}
                    min="1"
                    max={getMeasureCount(currentFile)}
                    value={(loopStartMeasure ?? 0) + 1}
                    onChange={(e) => {
                      const val = parseInt(e.target.value) - 1;
                      if (!isNaN(val)) {
                        setLoopRange(Math.max(0, val), loopEndMeasure);
                      }
                    }}
                    title={t('loopStartMeasure')}
                  />
                  <span className={styles.loopSeparator}>-</span>
                  <input
                    type="number"
                    className={styles.measureInput}
                    min="1"
                    max={getMeasureCount(currentFile)}
                    value={(loopEndMeasure ?? 0) + 1}
                    onChange={(e) => {
                      const val = parseInt(e.target.value) - 1;
                      if (!isNaN(val)) {
                        const maxMeasure = getMeasureCount(currentFile) - 1;
                        setLoopRange(
                          loopStartMeasure,
                          Math.min(val, maxMeasure),
                        );
                      }
                    }}
                    title={t('loopEndMeasure')}
                  />
                  <button
                    className={styles.button}
                    onClick={clearLoop}
                    title={t('clearLoop')}
                  >
                    <X size={14} />
                  </button>
                </>
              )}
            </div>
          )}
        </section>

        {currentFile && currentFile.tracks.length > 0 && (
          <section
            className={styles.settingsGroup}
            aria-labelledby="track-settings"
          >
            <h2 id="track-settings" className={styles.groupTitle}>
              {t('trackSettings')}
            </h2>
            {/* Track list - inline for 2 or fewer, dropdown for more */}
            {currentFile &&
              currentFile.tracks.length > 0 &&
              currentFile.tracks.length <= 2 &&
              currentFile.tracks.map((track) => (
                <div
                  key={track.index}
                  className={styles.gridItem}
                  style={{
                    borderLeftColor: track.color,
                    borderLeftWidth: 3,
                    borderLeftStyle: 'solid',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={track.enabled}
                    onChange={() =>
                      useMidiStore
                        .getState()
                        .toggleTrack(currentFile.id, track.index)
                    }
                  />
                  <span className={styles.trackName}>{track.name}</span>
                  <button
                    className={`${styles.trackButton} ${track.renderOnly || track.enabled ? styles.active : styles.crossed}`}
                    onClick={() =>
                      useMidiStore
                        .getState()
                        .toggleTrackRenderOnly(currentFile.id, track.index)
                    }
                    title={
                      track.renderOnly ? t('hideTrack') : t('showTrackVisually')
                    }
                    disabled={track.enabled}
                  >
                    {track.renderOnly || track.enabled ? (
                      <Eye size={14} />
                    ) : (
                      <EyeOff size={14} />
                    )}
                  </button>
                  <button
                    className={`${styles.trackButton} ${track.playAudio ? styles.active : styles.crossed}`}
                    onClick={() =>
                      useMidiStore
                        .getState()
                        .toggleTrackPlayAudio(currentFile.id, track.index)
                    }
                    title={
                      track.playAudio ? t('muteTrack') : t('playTrackAudio')
                    }
                  >
                    {track.playAudio ? (
                      <Volume2 size={14} />
                    ) : (
                      <VolumeX size={14} />
                    )}
                  </button>
                </div>
              ))}

            {/* Tracks dropdown for more than 2 tracks */}
            {currentFile && currentFile.tracks.length > 2 && (
              <div className={`${styles.gridItem} ${styles.tracksContainer}`}>
                <button
                  className={`${styles.button} ${tracksDropdownOpen ? styles.active : ''}`}
                  onClick={() => setTracksDropdownOpen(!tracksDropdownOpen)}
                >
                  {t('tracks')} ({currentFile.tracks.length}){' '}
                  {tracksDropdownOpen ? (
                    <span aria-hidden="true">−</span>
                  ) : (
                    <span aria-hidden="true">+</span>
                  )}
                </button>
                {tracksDropdownOpen && (
                  <div className={styles.tracksDropdown}>
                    {currentFile.tracks.map((track) => (
                      <div
                        key={track.index}
                        className={styles.trackItem}
                        style={{
                          borderLeftColor: track.color,
                          borderLeftWidth: 3,
                          borderLeftStyle: 'solid',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={track.enabled}
                          onChange={() =>
                            useMidiStore
                              .getState()
                              .toggleTrack(currentFile.id, track.index)
                          }
                        />
                        <span className={styles.trackName}>{track.name}</span>
                        <button
                          className={`${styles.trackButton} ${track.renderOnly || track.enabled ? styles.active : styles.crossed}`}
                          onClick={() =>
                            useMidiStore
                              .getState()
                              .toggleTrackRenderOnly(
                                currentFile.id,
                                track.index,
                              )
                          }
                          title={
                            track.renderOnly
                              ? t('hideTrack')
                              : t('showTrackVisually')
                          }
                          disabled={track.enabled}
                        >
                          {track.renderOnly || track.enabled ? (
                            <Eye size={14} />
                          ) : (
                            <EyeOff size={14} />
                          )}
                        </button>
                        <button
                          className={`${styles.trackButton} ${track.playAudio ? styles.active : styles.crossed}`}
                          onClick={() =>
                            useMidiStore
                              .getState()
                              .toggleTrackPlayAudio(currentFile.id, track.index)
                          }
                          title={
                            track.playAudio
                              ? t('muteTrack')
                              : t('playTrackAudio')
                          }
                        >
                          {track.playAudio ? (
                            <Volume2 size={14} />
                          ) : (
                            <VolumeX size={14} />
                          )}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        <section
          className={styles.settingsGroup}
          aria-labelledby="device-settings"
        >
          <h2 id="device-settings" className={styles.groupTitle}>
            {t('deviceSettings')}
          </h2>
          {/* MIDI input selector */}
          <div className={styles.gridItem}>
            <label className={styles.label}>{t('midiInput')}</label>
            {accessState === 'unsupported' ? (
              <span className={styles.warning}>{t('midiUnsupported')}</span>
            ) : accessState === 'insecure' ? (
              <span className={styles.warning}>{t('midiRequiresHttps')}</span>
            ) : accessState === 'requesting' ? (
              <button className={styles.button} disabled>
                {t('enablingMidi')}
              </button>
            ) : !isEnabled ? (
              <button
                className={styles.button}
                title={accessError ?? undefined}
                onClick={() => {
                  void requestAccess().catch(() => undefined);
                }}
              >
                {accessState === 'denied'
                  ? t('midiPermissionDenied')
                  : accessState === 'error'
                    ? t('midiAccessError')
                    : t('enableMidi')}
              </button>
            ) : inputs.length === 0 ? (
              <span className={styles.muted}>{t('noDevices')}</span>
            ) : (
              <select
                className={styles.select}
                value={selectedInput?.id || ''}
                onChange={(e) => selectInput(e.target.value || null)}
              >
                <option value="">{t('none')}</option>
                {inputs.map((device) => (
                  <option key={device.id} value={device.id}>
                    {device.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {bluetoothState !== 'unsupported' && accessState !== 'insecure' && (
            <div className={styles.gridItem}>
              {bluetoothState === 'connected' ? (
                <>
                  <span className={styles.offlineReady}>
                    {t('bluetoothMidiConnected', {
                      device: bluetoothDeviceName ?? 'MIDI',
                    })}
                  </span>
                  <button
                    className={styles.button}
                    onClick={disconnectBluetooth}
                    title={t('disconnectBluetoothMidi')}
                  >
                    <X size={14} />
                  </button>
                </>
              ) : bluetoothState === 'connecting' ? (
                <button className={styles.button} disabled>
                  {t('connectingBluetoothMidi')}
                </button>
              ) : (
                <button
                  className={styles.button}
                  title={bluetoothError ?? undefined}
                  onClick={() => {
                    void connectBluetooth().catch(() => undefined);
                  }}
                >
                  {bluetoothState === 'error'
                    ? t('bluetoothMidiError')
                    : t('connectBluetoothMidi')}
                </button>
              )}
            </div>
          )}
        </section>

        <section
          className={styles.settingsGroup}
          aria-labelledby="audio-settings"
        >
          <h2 id="audio-settings" className={styles.groupTitle}>
            {t('audioSettings')}
          </h2>
          <div className={styles.gridItem}>
            <label className={styles.label} htmlFor="master-volume">
              {t('volume', { percent: Math.round(settings.volume * 100) })}
            </label>
            <div className={styles.volumeControl}>
              <button
                className={`${styles.button} ${styles.iconButton} ${!settings.audioEnabled ? styles.mutedIcon : ''}`}
                onClick={() =>
                  updateSettings({ audioEnabled: !settings.audioEnabled })
                }
                title={
                  settings.audioEnabled ? t('muteAudio') : t('enableAudio')
                }
                aria-label={
                  settings.audioEnabled ? t('muteAudio') : t('enableAudio')
                }
                aria-pressed={!settings.audioEnabled}
              >
                {settings.audioEnabled ? (
                  <Volume2 size={18} />
                ) : (
                  <VolumeX size={18} />
                )}
              </button>
              <input
                id="master-volume"
                type="range"
                className={styles.volumeSlider}
                min="0"
                max="100"
                value={settings.volume * 100}
                onChange={(e) =>
                  updateSettings({ volume: parseFloat(e.target.value) / 100 })
                }
                aria-label={t('volume', {
                  percent: Math.round(settings.volume * 100),
                })}
              />
            </div>
          </div>
          {/* Play MIDI input audio toggle */}
          <div className={styles.gridItem}>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={settings.playMidiInputAudio}
                onChange={() =>
                  updateSettings({
                    playMidiInputAudio: !settings.playMidiInputAudio,
                  })
                }
              />
              {t('playMidiInput')}
              {isLoadingFullVelocity && (
                <span className={styles.loadingIndicator}>
                  {t('loadingSamples')}
                </span>
              )}
            </label>
          </div>

          {/* Offline audio pack */}
          <div className={styles.gridItem}>
            <label className={styles.label}>{t('offline')}</label>
            {offlinePack.isComplete ? (
              <>
                {pwa.installed && pwa.installPhase !== 'ready' ? (
                  <span className={styles.muted}>
                    {t(
                      pwa.installPhase === 'error'
                        ? 'offlineInstallIncomplete'
                        : 'offlineInstallPreparing',
                    )}
                  </span>
                ) : (
                  <span className={styles.offlineReady}>
                    <CheckCircle2 size={14} /> {t('offlineReady')}
                  </span>
                )}
                {pwa.installed && pwa.installPhase === 'error' && (
                  <button
                    type="button"
                    className={styles.button}
                    onClick={() => {
                      void pwa.retryInstall();
                    }}
                  >
                    {t('retryOfflineInstall')}
                  </button>
                )}
                <button
                  className={styles.button}
                  onClick={offlinePack.removePack}
                  title={t('removeOfflinePack')}
                  disabled={pwa.installed}
                >
                  <Trash2 size={14} />
                </button>
              </>
            ) : offlinePack.isDownloading ? (
              <>
                <span className={styles.offlineProgress}>
                  {Math.round(offlinePack.progress * 100)}%
                  {offlinePack.failed > 0 &&
                    ` (${t('failedCount', { count: offlinePack.failed })})`}
                </span>
                <progress
                  className={styles.offlineProgressBar}
                  value={offlinePack.progress}
                  max={1}
                />
                <button
                  className={styles.button}
                  onClick={offlinePack.cancelDownload}
                  title={t('cancelDownload')}
                  disabled={pwa.installed}
                >
                  <X size={14} />
                </button>
              </>
            ) : (
              <>
                <button
                  className={styles.button}
                  onClick={() => {
                    void (pwa.installed
                      ? pwa.retryInstall()
                      : offlinePack.startDownload());
                  }}
                  title={t('downloadAudioPack')}
                >
                  <CloudDownload size={14} /> {t('audioPack')}
                </button>
                {offlinePack.cached > 0 && (
                  <span className={styles.muted}>
                    {offlinePack.cached}/{offlinePack.total}
                  </span>
                )}
              </>
            )}
            {offlinePack.error && !offlinePack.isDownloading && (
              <span className={styles.warning}>
                {t('offlinePackIncomplete')}
              </span>
            )}
          </div>
        </section>

        <section
          className={styles.settingsGroup}
          aria-labelledby="general-settings"
        >
          <h2 id="general-settings" className={styles.groupTitle}>
            {t('generalSettings')}
          </h2>
          {pwa.updateReady && (
            <div className={styles.gridItem}>
              <span className={styles.label}>{t('pwaUpdateReady')}</span>
              <button
                type="button"
                className={styles.button}
                disabled={
                  isPlaying ||
                  pwa.isApplying ||
                  pwa.installPhase === 'preparing'
                }
                onClick={() => {
                  void pwa.applyUpdate();
                }}
              >
                {t(
                  isPlaying
                    ? 'pwaPauseToUpdate'
                    : pwa.isApplying
                      ? 'pwaUpdating'
                      : 'applyPwaUpdate',
                )}
              </button>
            </div>
          )}
          {/* Language selector */}
          <div className={styles.gridItem}>
            <label className={styles.label}>{t('language')}</label>
            <select
              className={styles.select}
              aria-label={t('language')}
              value={locale}
              onChange={(e) => setLocale(e.target.value as 'en' | 'zh')}
            >
              {LOCALE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </section>
      </aside>
      <ScoreHistory
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
      />
      {currentFile && (settings.showFloatingRemote ?? true) && (
        <FloatingPlaybackRemote
          isPlaying={isPlaying}
          onTogglePlay={togglePlay}
        />
      )}
    </div>
  );
}
