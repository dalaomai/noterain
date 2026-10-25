import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../hooks/useI18n';
import type { TranslationKeys } from '../../i18n';
import {
  renderMusicXmlPages,
  type MusicXmlRenderStage,
  type MusicXmlTimeEvent,
} from '../../lib/musicxml/parser';
import { useMidiStore } from '../../stores/midiStore';
import { followNoteKey } from '../../lib/followMode';
import {
  buildScoreCursorRuns,
  getScoreCursorPosition,
  type EngravedMeasureGeometry,
} from '../../lib/scoreCursor';
import styles from './MusicXmlSheet.module.css';

const STAGE_LABELS: Record<MusicXmlRenderStage, TranslationKeys> = {
  loadingEngine: 'musicXmlLoadingEngine',
  parsingScore: 'musicXmlParsingScore',
  layingOutScore: 'musicXmlLayingOutScore',
  renderingPages: 'musicXmlRenderingPages',
};

/** Keep both piano staves visible instead of centering an individual note. */
function scrollScoreSystemIntoView(
  container: HTMLDivElement,
  element: SVGElement,
  force = false,
) {
  const system = element.closest('.system') ?? element;
  const systemRect = system.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const toolbar = document.getElementById('playback-toolbar');
  const toolbarBottom =
    toolbar && !toolbar.inert
      ? (toolbar.parentElement?.getBoundingClientRect().top ?? 0) +
        toolbar.offsetTop +
        toolbar.offsetHeight
      : containerRect.top;
  const visibleTop = Math.max(containerRect.top, toolbarBottom) + 8;
  const visibleBottom = containerRect.bottom - 8;

  if (
    !force &&
    systemRect.top >= visibleTop &&
    systemRect.bottom <= visibleBottom
  )
    return;

  const top = Math.max(0, container.scrollTop + systemRect.top - visibleTop);
  if (Math.abs(top - container.scrollTop) < 1) return;
  container.scrollTo({
    top,
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 'auto'
      : 'smooth',
  });
}

export function MusicXmlSheet() {
  const containerRef = useRef<HTMLDivElement>(null);
  const highlightsRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const { t } = useI18n();
  const currentFile = useMidiStore((state) => state.getCurrentFile());
  const isPlaying = useMidiStore((state) => state.playback.isPlaying);
  const waitMode = useMidiStore((state) => state.playback.waitMode);
  const scoreDensity = useMidiStore(
    (state) => state.settings.simplifiedScoreDensity,
  );
  const expandRepeats = useMidiStore(
    (state) => state.settings.expandMusicXmlRepeats,
  );
  const [pages, setPages] = useState<string[]>([]);
  const [timeMap, setTimeMap] = useState<MusicXmlTimeEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [renderProgress, setRenderProgress] = useState<{
    stage: MusicXmlRenderStage;
    progress: number;
  }>({ stage: 'loadingEngine', progress: 0 });
  const activeIdsRef = useRef<Set<string>>(new Set());
  const eventIndexRef = useRef(-1);

  const playbackFrames = useMemo(() => {
    const activeIds = new Set<string>();
    return timeMap.map((event) => {
      for (const id of event.off ?? []) activeIds.delete(id);
      for (const id of event.on ?? []) activeIds.add(id);
      return {
        activeIds: [...activeIds],
        measureId: event.measureOn,
      };
    });
  }, [timeMap]);

  const noteTimes = useMemo(() => {
    const times = new Map<string, number>();
    for (const event of timeMap) {
      for (const id of event.on ?? []) {
        if (!times.has(id)) times.set(id, event.tstamp / 1000);
      }
    }
    return times;
  }, [timeMap]);

  const measureTimes = useMemo(() => {
    const times = new Map<string, number>();
    for (const event of timeMap) {
      if (event.measureOn && !times.has(event.measureOn)) {
        times.set(event.measureOn, event.tstamp / 1000);
      }
    }
    return times;
  }, [timeMap]);

  // Match the engraving's own MIDI pitch and onset to the playback events.
  // An ID may occur more than once in a collapsed repeat; keep every event key.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !currentFile) return;
    const notes = currentFile.tracks.flatMap((track) => track.notes);
    const byPitch = new Map<number, typeof notes>();
    for (const note of notes) {
      const group = byPitch.get(note.noteNumber) ?? [];
      group.push(note);
      byPitch.set(note.noteNumber, group);
    }
    const staffTracks = currentFile.tracks.filter(
      (track) => track.notes.length > 0,
    );
    const onsets = new Map<string, number[]>();
    for (const event of timeMap)
      for (const id of event.on ?? []) {
        const times = onsets.get(id) ?? [];
        times.push(event.tstamp / 1000);
        onsets.set(id, times);
      }
    for (const element of container.querySelectorAll<SVGGElement>(
      '.note[data-midi-pitch]',
    )) {
      const pitch = Number(element.dataset.midiPitch);
      const times = onsets.get(element.id) ?? [];
      const staffTrack =
        staffTracks[Number(element.dataset.midiStaff) - 1]?.index;
      const matches = (byPitch.get(pitch) ?? []).filter((note) =>
        times.some((time) => Math.abs(time - note.startTime) < 0.005),
      );
      const preferred =
        staffTrack !== undefined
          ? matches.filter((note) => note.track === staffTrack)
          : [];
      const head = element.querySelector<SVGGElement>('.notehead');
      if (head)
        head.dataset.followNote = (preferred.length ? preferred : matches)
          .map(followNoteKey)
          .join(' ');
    }
  }, [currentFile, pages, timeMap]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !currentFile || currentFile.sourceFormat !== 'musicxml') {
      setPages([]);
      return;
    }

    let cancelled = false;
    let timeout: number | undefined;
    let rendering = false;
    let renderQueued = false;
    let requestedWidth = 0;
    let renderController: AbortController | null = null;

    const render = async (pageWidth: number) => {
      if (rendering) {
        renderQueued = requestedWidth !== pageWidth;
        requestedWidth = pageWidth;
        return;
      }
      rendering = true;
      requestedWidth = pageWidth;
      renderController = new AbortController();
      setError(null);
      setPages([]);
      setRenderProgress({ stage: 'loadingEngine', progress: 0 });
      try {
        const result = await renderMusicXmlPages(
          currentFile,
          pageWidth,
          scoreDensity,
          expandRepeats,
          (stage, progress) => {
            if (!cancelled) setRenderProgress({ stage, progress });
          },
          renderController.signal,
        );
        if (!cancelled) {
          setPages(result.pages);
          setTimeMap(result.timeMap);
        }
      } catch (renderError: unknown) {
        if (renderError instanceof DOMException && renderError.name === 'AbortError') return;
        console.error('[MusicXML] Failed to render score:', renderError);
        if (!cancelled) setError(t('musicXmlRenderError'));
      } finally {
        renderController = null;
        rendering = false;
        if (!cancelled && renderQueued) {
          renderQueued = false;
          void render(requestedWidth);
        }
      }
    };

    const observer = new ResizeObserver(() => {
      const pageWidth = Math.max(320, Math.round(container.clientWidth - 32));
      if (pageWidth === requestedWidth) return;
      window.clearTimeout(timeout);
      timeout = window.setTimeout(() => void render(pageWidth), 150);
    });
    observer.observe(container);
    void render(Math.max(320, Math.round(container.clientWidth - 32)));

    return () => {
      cancelled = true;
      renderController?.abort();
      window.clearTimeout(timeout);
      observer.disconnect();
    };
  }, [currentFile, expandRepeats, scoreDensity, t]);

  const handleScoreClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const container = containerRef.current;
      if (!container) return;
      const target = event.target as Element | null;
      const note = target?.closest<SVGGElement>('.note');
      if (!note || !container.contains(note)) return;
      const directTime = note.dataset.playbackTime;
      let time =
        directTime === undefined ? noteTimes.get(note.id) : Number(directTime);

      if (time === undefined) {
        const measure = note.closest<SVGGElement>('.measure');
        const noteCenter =
          note.getBoundingClientRect().left +
          note.getBoundingClientRect().width / 2;
        let closestDistance = Number.POSITIVE_INFINITY;

        for (const candidate of measure?.querySelectorAll<SVGGElement>(
          '.note',
        ) ?? []) {
          const candidateTime = noteTimes.get(candidate.id);
          if (candidateTime === undefined) continue;
          const rect = candidate.getBoundingClientRect();
          const distance = Math.abs(rect.left + rect.width / 2 - noteCenter);
          if (distance < closestDistance) {
            closestDistance = distance;
            time = candidateTime;
          }
        }

        if (time === undefined && measure) {
          const measureTime = measure.dataset.playbackTime;
          time =
            measureTime === undefined
              ? measureTimes.get(measure.id)
              : Number(measureTime);
        }
      }

      if (time === undefined) return;
      useMidiStore.getState().seek(time);
      scrollScoreSystemIntoView(container, note, true);
    },
    [measureTimes, noteTimes],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container || pages.length === 0 || timeMap.length === 0) return;

    let animationFrame = 0;
    let followedSystem: Element | null = null;
    const toolbar = document.getElementById('playback-toolbar');
    const cursorElement = cursorRef.current;
    let toolbarWasCollapsed = toolbar?.inert;

    const containerRect = container.getBoundingClientRect();
    const contentLeft = containerRect.left - container.scrollLeft;
    const contentTop = containerRect.top - container.scrollTop;
    const elements = new Map(
      Array.from(container.querySelectorAll<SVGElement>('[id]'), (element) => [
        element.id,
        element,
      ]),
    );
    const measureGeometry = new Map<string, EngravedMeasureGeometry>();
    const onsetPositions = new Map<string, number>();
    const cursorRuns = buildScoreCursorRuns(
      timeMap,
      (id) => {
        const cached = measureGeometry.get(id);
        if (cached) return cached;
        const measure = elements.get(id);
        const system = measure?.closest<SVGElement>('.system');
        if (!measure || !system) return undefined;
        const rect = measure.getBoundingClientRect();
        const staves = Array.from(
          system.querySelectorAll<SVGElement>('.staff'),
          (staff) => staff.getBoundingClientRect(),
        );
        const systemRect = system.getBoundingClientRect();
        const top = staves.length
          ? Math.min(...staves.map((staff) => staff.top))
          : systemRect.top;
        const bottom = staves.length
          ? Math.max(...staves.map((staff) => staff.bottom))
          : systemRect.bottom;
        const barlines = Array.from(
          measure.querySelectorAll<SVGElement>('.barLine'),
          (barline) => barline.getBoundingClientRect().right,
        );
        const geometry = {
          systemId: system.id,
          left: rect.left - contentLeft,
          right:
            (barlines.length ? Math.max(...barlines) : rect.right) -
            contentLeft,
          top: top - contentTop - 4,
          height: bottom - top + 8,
        };
        measureGeometry.set(id, geometry);
        return geometry;
      },
      (id) => {
        if (onsetPositions.has(id)) return onsetPositions.get(id);
        const element = elements.get(id);
        if (!element) return undefined;
        const rect = (
          element.querySelector('.notehead') ?? element
        ).getBoundingClientRect();
        const x = rect.left + rect.width / 2 - contentLeft;
        onsetPositions.set(id, x);
        return x;
      },
      currentFile?.duration ?? 0,
    );

    const clearHighlights = () => {
      for (const id of activeIdsRef.current) {
        container
          .querySelector(`#${CSS.escape(id)}`)
          ?.classList.remove(styles.playing);
      }
      activeIdsRef.current.clear();
      highlightsRef.current?.replaceChildren();
    };

    const update = () => {
      const currentMillis = useMidiStore.getState().playback.currentTime * 1000;
      const cursor = getScoreCursorPosition(cursorRuns, currentMillis / 1000);
      if (cursorElement) {
        if (cursor && useMidiStore.getState().settings.showPlaybackCursor) {
          cursorElement.style.left = `${cursor.x}px`;
          cursorElement.style.top = `${cursor.top}px`;
          cursorElement.style.height = `${cursor.height}px`;
          cursorElement.style.display = 'block';
        } else {
          cursorElement.style.display = 'none';
        }
      }
      let eventIndex = -1;

      // Timemap is sorted. Binary search the latest event at/before playback.
      let low = 0;
      let high = timeMap.length - 1;
      while (low <= high) {
        const middle = (low + high) >> 1;
        if (timeMap[middle].tstamp <= currentMillis) {
          eventIndex = middle;
          low = middle + 1;
        } else {
          high = middle - 1;
        }
      }

      const eventChanged = eventIndex !== eventIndexRef.current;
      const toolbarChanged = toolbar?.inert !== toolbarWasCollapsed;
      toolbarWasCollapsed = toolbar?.inert;

      if (eventChanged) {
        clearHighlights();
        eventIndexRef.current = eventIndex;

        if (eventIndex >= 0) {
          const frame = playbackFrames[eventIndex];
          const ids = frame.activeIds;
          for (const id of ids) {
            const element = container.querySelector<SVGElement>(
              `#${CSS.escape(id)}`,
            );
            if (!element) continue;
            // The follow layer supplies a small cue at the head. Keep the
            // original scrolling, but avoid covering it with the old red fill.
            if (waitMode) continue;
            element.classList.add(styles.playing);
            activeIdsRef.current.add(id);

            const noteRect = element.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            const highlight = document.createElement('div');
            highlight.className = styles.noteHighlight;
            highlight.style.left = `${noteRect.left - containerRect.left + container.scrollLeft - 6}px`;
            highlight.style.top = `${noteRect.top - containerRect.top + container.scrollTop - 6}px`;
            highlight.style.width = `${Math.max(20, noteRect.width + 12)}px`;
            highlight.style.height = `${Math.max(24, noteRect.height + 12)}px`;
            highlightsRef.current?.appendChild(highlight);
          }
        }
      }

      if (isPlaying && eventIndex >= 0) {
        const frame = playbackFrames[eventIndex];
        const focusId =
          cursor?.focusId ?? frame.activeIds[0] ?? frame.measureId;
        const focusElement = focusId
          ? container.querySelector<SVGElement>(`#${CSS.escape(focusId)}`)
          : null;
        if (focusElement) {
          const system = focusElement.closest('.system') ?? focusElement;
          if (system !== followedSystem || toolbarChanged) {
            // Align every newly active system immediately so the next row stays
            // available for reading ahead, even when this row was partly visible.
            scrollScoreSystemIntoView(container, focusElement, true);
            followedSystem = system;
          }
        }
      }

      animationFrame = requestAnimationFrame(update);
    };

    animationFrame = requestAnimationFrame(update);
    return () => {
      cancelAnimationFrame(animationFrame);
      clearHighlights();
      if (cursorElement) cursorElement.style.display = 'none';
      eventIndexRef.current = -1;
    };
  }, [
    currentFile?.duration,
    isPlaying,
    pages,
    playbackFrames,
    timeMap,
    waitMode,
  ]);

  return (
    <div
      ref={containerRef}
      data-follow-view="original"
      className={styles.container}
      onClick={handleScoreClick}
    >
      <div ref={highlightsRef} className={styles.highlights} />
      <div
        ref={cursorRef}
        className={styles.playbackCursor}
        data-playback-cursor
        aria-hidden="true"
      />
      {error && <div className={styles.status}>{error}</div>}
      {!error && pages.length === 0 && (
        <div className={styles.status}>
          <div className={styles.statusContent}>
            <div>{t(STAGE_LABELS[renderProgress.stage])}</div>
            <progress value={renderProgress.progress} max={1} />
            <div className={styles.progressText}>
              {Math.round(renderProgress.progress * 100)}%
            </div>
          </div>
        </div>
      )}
      {pages.map((svg, index) => (
        <div
          key={index}
          className={styles.page}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ))}
    </div>
  );
}
