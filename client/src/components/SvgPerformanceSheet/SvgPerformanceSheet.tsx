import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { getSvgPlaybackPosition } from '../../features/score-link-import/core/svgPerformance';
import { useMidiStore } from '../../stores/midiStore';
import type { SvgPlaybackSystem } from '../../types/midi';
import styles from './SvgPerformanceSheet.module.css';

const SCROLL_DURATION_MS = 520;

function easeInOutCubic(progress: number) {
  return progress < 0.5
    ? 4 * progress * progress * progress
    : 1 - Math.pow(-2 * progress + 2, 3) / 2;
}

function getSystemViewPadding(system: SvgPlaybackSystem, scale: number) {
  const upperStaff = system.staves[0];
  if (!upperStaff) return 16;
  const spacing = (upperStaff.bottom - upperStaff.top) / 4;
  const highestNote = Math.min(
    upperStaff.top,
    ...system.anchors.flatMap((anchor) =>
      anchor.points.filter((point) => point.staff === 1).map((point) => point.y),
    ),
  );
  const noteOverhang = Math.max(0, upperStaff.top - highestNote);
  const padding = Math.min(spacing * 4.5, spacing * 3.25 + noteOverhang);
  return Math.max(16, padding * scale);
}

export function SvgPerformanceSheet() {
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Array<HTMLDivElement | null>>([]);
  const scrollAnimationRef = useRef<number | null>(null);
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
      if (isPlaying) frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [isPlaying, score]);

  useEffect(() => () => {
    if (scrollAnimationRef.current !== null) {
      cancelAnimationFrame(scrollAnimationRef.current);
    }
  }, []);

  useEffect(() => {
    if (!isPlaying) followedSystemRef.current = -1;
  }, [isPlaying]);

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
    if (!score || !isPlaying || !position || systemIndex < 0 || followedSystemRef.current === systemIndex) return;
    const page = pageRefs.current[position.system.page];
    const container = containerRef.current;
    if (!page || !container) return;
    followedSystemRef.current = systemIndex;
    const pageRect = page.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const toolbar = document.getElementById('playback-toolbar');
    const toolbarBottom = toolbar && !toolbar.inert
      ? toolbar.getBoundingClientRect().bottom
      : containerRect.top;
    const crop = crops[position.system.page] ?? { x: 0, y: 0, ...score!.pageSizes[position.system.page] };
    const scale = pageRect.width / crop.width;
    const viewPadding = getSystemViewPadding(position.system, scale);
    const visibleTop = Math.max(containerRect.top, toolbarBottom) + viewPadding;
    const systemTop = pageRect.top + (position.system.top - crop.y) * scale;
    const target = Math.max(0, container.scrollTop + systemTop - visibleTop);
    if (Math.abs(target - container.scrollTop) < 1) return;
    if (scrollAnimationRef.current !== null) cancelAnimationFrame(scrollAnimationRef.current);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      container.scrollTop = target;
      return;
    }

    const start = container.scrollTop;
    const distance = target - start;
    const startedAt = performance.now();
    const animate = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / SCROLL_DURATION_MS);
      container.scrollTop = start + distance * easeInOutCubic(progress);
      if (progress < 1) {
        scrollAnimationRef.current = requestAnimationFrame(animate);
      } else {
        scrollAnimationRef.current = null;
      }
    };
    scrollAnimationRef.current = requestAnimationFrame(animate);
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
                {active.anchor?.points.map((point, index) => {
                  const staff = active.system.staves?.[point.staff - 1];
                  const spacing = staff ? (staff.bottom - staff.top) / 4 : 5;
                  return (
                    <ellipse
                      key={`${point.x}:${point.y}:${index}`}
                      className={styles.noteHighlight}
                      cx={point.x}
                      cy={point.y}
                      rx={Math.max(3.8, spacing * 0.76)}
                      ry={Math.max(2.8, spacing * 0.56)}
                      vectorEffect="non-scaling-stroke"
                    />
                  );
                })}
              </svg>
            )}
          </div>
        );
      })}
    </div>
  );
}