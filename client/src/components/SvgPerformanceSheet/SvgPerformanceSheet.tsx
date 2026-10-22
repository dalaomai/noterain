import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { getSvgPlaybackPosition } from '../../features/score-link-import/core/svgPerformance';
import { useMidiStore } from '../../stores/midiStore';
import styles from './SvgPerformanceSheet.module.css';

export function SvgPerformanceSheet() {
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Array<HTMLDivElement | null>>([]);
  const currentFile = useMidiStore((state) => state.getCurrentFile());
  const isPlaying = useMidiStore((state) => state.playback.isPlaying);
  const showCursor = useMidiStore((state) => state.settings.showPlaybackCursor);
  const score = currentFile?.svgScore;
  const [position, setPosition] = useState(() => score ? getSvgPlaybackPosition(score, 0) : null);
  const [crops, setCrops] = useState<Array<{ x: number; y: number; width: number; height: number }>>([]);
  const followedSystemRef = useRef(-1);

  const systemIndex = useMemo(
    () => position && score ? score.systems.indexOf(position.system) : -1,
    [position, score],
  );

  useEffect(() => {
    if (!score) return;
    let frame = 0;
    const update = () => {
      setPosition(getSvgPlaybackPosition(score, useMidiStore.getState().playback.currentTime));
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [score]);

  useLayoutEffect(() => {
    if (!score) return;
    const measured = score.pageSizes.map((size, pageIndex) => {
      const svg = pageRefs.current[pageIndex]?.querySelector<SVGSVGElement>('[class*="engraving"] svg');
      if (!svg) return { x: 0, y: 0, width: size.width, height: size.height };
      const boxes = Array.from(svg.children).flatMap((element) => {
        if (!(element instanceof SVGGraphicsElement)) return [];
        try {
          const box = element.getBBox();
          return box.width > 0 || box.height > 0 ? [box] : [];
        } catch {
          return [];
        }
      });
      if (!boxes.length) return { x: 0, y: 0, width: size.width, height: size.height };
      const margin = Math.max(8, Math.min(size.width, size.height) * 0.015);
      const left = Math.max(0, Math.min(...boxes.map((box) => box.x)) - margin);
      const top = Math.max(0, Math.min(...boxes.map((box) => box.y)) - margin);
      const right = Math.min(size.width, Math.max(...boxes.map((box) => box.x + box.width)) + margin);
      const bottom = Math.min(size.height, Math.max(...boxes.map((box) => box.y + box.height)) + margin);
      svg.setAttribute('viewBox', `${left} ${top} ${right - left} ${bottom - top}`);
      svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      return { x: left, y: top, width: right - left, height: bottom - top };
    });
    setCrops(measured);
  }, [score]);

  useEffect(() => {
    if (!isPlaying || !position || systemIndex < 0 || followedSystemRef.current === systemIndex) return;
    followedSystemRef.current = systemIndex;
    const page = pageRefs.current[position.system.page];
    const container = containerRef.current;
    if (!page || !container) return;
    const pageRect = page.getBoundingClientRect();
    const crop = crops[position.system.page] ?? { x: 0, y: 0, ...score!.pageSizes[position.system.page] };
    const scale = pageRect.width / crop.width;
    const target = page.offsetTop + (position.system.top - crop.y) * scale - 24;
    container.scrollTo({
      top: Math.max(0, target),
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  }, [crops, isPlaying, position, score, systemIndex]);

  const seekFromPage = useCallback((pageIndex: number, event: React.MouseEvent<HTMLDivElement>) => {
    if (!score) return;
    const page = pageRefs.current[pageIndex];
    if (!page) return;
    const rect = page.getBoundingClientRect();
    const size = score.pageSizes[pageIndex];
    const crop = crops[pageIndex] ?? { x: 0, y: 0, width: size.width, height: size.height };
    const x = crop.x + (event.clientX - rect.left) * crop.width / rect.width;
    const y = crop.y + (event.clientY - rect.top) * crop.height / rect.height;
    const systems = score.systems.filter((system) => system.page === pageIndex);
    const system = systems.reduce((best, candidate) => {
      const distance = y < candidate.top ? candidate.top - y : y > candidate.bottom ? y - candidate.bottom : 0;
      return distance < best.distance ? { system: candidate, distance } : best;
    }, { system: systems[0], distance: Number.POSITIVE_INFINITY }).system;
    if (!system) return;
    const anchors = system.anchors;
    const measure = system.measures?.find((candidate) => x >= candidate.left && x < candidate.right);
    const measureAnchors = measure
      ? anchors.filter((anchor) => anchor.time >= measure.startTime && anchor.time < measure.endTime)
      : anchors;
    if (!measureAnchors.length) {
      const range = measure ?? system;
      const progress = Math.max(0, Math.min(1, (x - range.left) / Math.max(1, range.right - range.left)));
      useMidiStore.getState().seek(range.startTime + (range.endTime - range.startTime) * progress);
      return;
    }
    const nearest = measureAnchors.reduce((best, anchor) =>
      Math.abs(anchor.x - x) < best.distance ? { anchor, distance: Math.abs(anchor.x - x) } : best,
    { anchor: measureAnchors[0], distance: Number.POSITIVE_INFINITY }).anchor;
    useMidiStore.getState().seek(nearest.time);
  }, [crops, score]);

  if (!score) return null;

  return (
    <div ref={containerRef} className={styles.container} data-follow-view="svg-performance">
      {score.pages.map((svg, pageIndex) => {
        const size = score.pageSizes[pageIndex];
        const crop = crops[pageIndex] ?? { x: 0, y: 0, width: size.width, height: size.height };
        const active = position?.system.page === pageIndex ? position : null;
        return (
          <div
            key={pageIndex}
            ref={(element) => { pageRefs.current[pageIndex] = element; }}
            className={styles.page}
            style={{ aspectRatio: `${crop.width} / ${crop.height}` }}
            onClick={(event) => seekFromPage(pageIndex, event)}
          >
            <div className={styles.engraving} dangerouslySetInnerHTML={{ __html: svg }} />
            {active && (
              <svg
                className={styles.overlay}
                viewBox={`${crop.x} ${crop.y} ${crop.width} ${crop.height}`}
                aria-hidden="true"
              >
                {showCursor && active.measure && (
                  <rect
                    className={styles.measureHighlight}
                    x={active.measure.left}
                    y={active.measure.top - 5}
                    width={active.measure.right - active.measure.left}
                    height={active.measure.bottom - active.measure.top + 10}
                    rx="2"
                  />
                )}
                {active.anchor?.points.map((point, index) => (
                  <ellipse
                    key={`${point.x}:${point.y}:${index}`}
                    className={styles.noteHighlight}
                    cx={point.x}
                    cy={point.y}
                    rx="3.8"
                    ry="2.8"
                  />
                ))}
              </svg>
            )}
          </div>
        );
      })}
    </div>
  );
}