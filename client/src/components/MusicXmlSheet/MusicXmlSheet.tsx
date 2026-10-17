import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../hooks/useI18n';
import type { TranslationKeys } from '../../i18n';
import {
  renderMusicXmlPages,
  type MusicXmlRenderStage,
  type MusicXmlTimeEvent,
} from '../../lib/musicxml/parser';
import { useMidiStore } from '../../stores/midiStore';
import styles from './MusicXmlSheet.module.css';

const STAGE_LABELS: Record<MusicXmlRenderStage, TranslationKeys> = {
  loadingEngine: 'musicXmlLoadingEngine',
  parsingScore: 'musicXmlParsingScore',
  layingOutScore: 'musicXmlLayingOutScore',
  renderingPages: 'musicXmlRenderingPages',
};

export function MusicXmlSheet() {
  const containerRef = useRef<HTMLDivElement>(null);
  const highlightsRef = useRef<HTMLDivElement>(null);
  const { t } = useI18n();
  const currentFile = useMidiStore((state) => state.getCurrentFile());
  const isPlaying = useMidiStore((state) => state.playback.isPlaying);
  const scoreDensity = useMidiStore((state) => state.settings.scoreDensity);
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

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !currentFile || currentFile.sourceFormat !== 'musicxml') {
      setPages([]);
      return;
    }

    let cancelled = false;
    let timeout: number | undefined;

    const render = () => {
      setError(null);
      setPages([]);
      setRenderProgress({ stage: 'loadingEngine', progress: 0 });
      void renderMusicXmlPages(
        currentFile,
        Math.max(320, container.clientWidth - 32),
        scoreDensity,
        expandRepeats,
        (stage, progress) => {
          if (!cancelled) setRenderProgress({ stage, progress });
        },
      )
        .then((result) => {
          if (!cancelled) {
            setPages(result.pages);
            setTimeMap(result.timeMap);
          }
        })
        .catch((renderError: unknown) => {
          console.error('[MusicXML] Failed to render score:', renderError);
          if (!cancelled) setError(t('musicXmlRenderError'));
        });
    };

    const observer = new ResizeObserver(() => {
      window.clearTimeout(timeout);
      timeout = window.setTimeout(render, 150);
    });
    observer.observe(container);
    render();

    return () => {
      cancelled = true;
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
      let time = directTime === undefined ? noteTimes.get(note.id) : Number(directTime);

      if (time === undefined) {
        const measure = note.closest<SVGGElement>('.measure');
        const noteCenter = note.getBoundingClientRect().left +
          note.getBoundingClientRect().width / 2;
        let closestDistance = Number.POSITIVE_INFINITY;

        for (const candidate of measure?.querySelectorAll<SVGGElement>('.note') ?? []) {
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
          time = measureTime === undefined
            ? measureTimes.get(measure.id)
            : Number(measureTime);
        }
      }

      if (time === undefined) return;
      useMidiStore.getState().seek(time);
      note.scrollIntoView({ behavior: 'smooth', block: 'center' });
    },
    [measureTimes, noteTimes],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container || pages.length === 0 || timeMap.length === 0) return;

    let animationFrame = 0;

    const clearHighlights = () => {
      for (const id of activeIdsRef.current) {
        container.querySelector(`#${CSS.escape(id)}`)?.classList.remove(styles.playing);
      }
      activeIdsRef.current.clear();
      highlightsRef.current?.replaceChildren();
    };

    const update = () => {
      const currentMillis = useMidiStore.getState().playback.currentTime * 1000;
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

      if (eventIndex !== eventIndexRef.current) {
        clearHighlights();
        eventIndexRef.current = eventIndex;

        if (eventIndex >= 0) {
          const frame = playbackFrames[eventIndex];
          const ids = frame.activeIds;
          for (const id of ids) {
            const element = container.querySelector<SVGElement>(`#${CSS.escape(id)}`);
            if (!element) continue;
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

          const focusId = ids[0] ?? frame.measureId;
          const focusElement = focusId
            ? container.querySelector<SVGElement>(`#${CSS.escape(focusId)}`)
            : null;
          if (isPlaying && focusElement) {
            const noteRect = focusElement.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            if (
              noteRect.top < containerRect.top + 32 ||
              noteRect.bottom > containerRect.bottom - 48
            ) {
              focusElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }
        }
      }

      animationFrame = requestAnimationFrame(update);
    };

    animationFrame = requestAnimationFrame(update);
    return () => {
      cancelAnimationFrame(animationFrame);
      clearHighlights();
      eventIndexRef.current = -1;
    };
  }, [isPlaying, pages, playbackFrames, timeMap]);

  return (
    <div
      ref={containerRef}
      className={styles.container}
      onClick={handleScoreClick}
    >
      <div ref={highlightsRef} className={styles.highlights} />
      {error && <div className={styles.status}>{error}</div>}
      {!error && pages.length === 0 && (
        <div className={styles.status}>
          <div className={styles.statusContent}>
            <div>
              {t(STAGE_LABELS[renderProgress.stage])}
            </div>
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