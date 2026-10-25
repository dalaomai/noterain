import type { ScoreDensity, SimplifiedScoreLayout } from '../types/midi';

export const BARLINE_NOTE_GAP = 12;

export const SCORE_DENSITIES = {
  relaxed: {
    noteSpacing: 1.35,
    staveHeight: 112,
    systemGap: 36,
    measuresPerLine: 2,
  },
  standard: {
    noteSpacing: 1.15,
    staveHeight: 104,
    systemGap: 24,
    measuresPerLine: 3,
  },
  compact: {
    noteSpacing: 1,
    staveHeight: 96,
    systemGap: 16,
    measuresPerLine: 4,
  },
} satisfies Record<ScoreDensity, object>;

export function getSimplifiedDensity(value: ScoreDensity | number) {
  const numeric = typeof value === 'number'
    ? value
    : value === 'relaxed'
      ? 1
      : value === 'compact'
        ? 10
        : 5;
  const progress = (Math.max(1, Math.min(10, numeric)) - 1) / 9;
  return {
    noteSpacing: 1.4 - progress * 1.05,
    staveHeight: 116 - progress * 36,
    systemGap: 40 - progress * 36,
    measuresPerLine: 2 + Math.round(progress * 6),
  };
}

export function getScorePageWidth(viewportWidth: number, density?: ScoreDensity) {
  void density;
  return Math.max(
    750,
    Math.round(Math.max(320, viewportWidth) * 2.1),
  );
}

export interface ScoreColumn {
  beat: number;
  left: number;
  right: number;
}

/** Find one beat width that leaves room for every note and its accidentals. */
export function getUniformScoreSpacing(
  columns: readonly ScoreColumn[],
  beats: number,
  boundaryLeft = 0,
) {
  // Collision clearance and glyph fitting must not change with density.
  const gap = 8;
  let pixelsPerBeat = 120 / beats;
  for (let i = 1; i < columns.length; i++) {
    const previous = columns[i - 1];
    const column = columns[i];
    const beatGap = column.beat - previous.beat;
    if (beatGap > 0) {
      pixelsPerBeat = Math.max(
        pixelsPerBeat,
        (previous.right + column.left + gap) / beatGap,
      );
    }
  }
  const last = columns[columns.length - 1];
  if (last && last.beat < beats) {
    pixelsPerBeat = Math.max(
      pixelsPerBeat,
      // Leave space on both sides of the barline, including any accidental
      // before the next note. Moving the barline alone can crowd this note.
      (last.right + boundaryLeft + BARLINE_NOTE_GAP + gap) /
        (beats - last.beat),
    );
  }
  const left = Math.max(0, ...columns.map((column) => column.left)) + gap;
  const right = Math.max(0, ...columns.map((column) => column.right)) + gap;
  return {
    left,
    right,
    timeWidth: pixelsPerBeat * beats,
    width: left + right + pixelsPerBeat * beats,
  };
}

export function getScoreTimeX(
  time: number,
  startTime: number,
  duration: number,
  startX: number,
  endX: number,
) {
  const fraction = Math.max(0, Math.min(1, (time - startTime) / duration));
  return startX + fraction * (endX - startX);
}

/** One time scale for the score; headers and edge padding consume no score time. */
export function layoutScoreMeasures(
  measureWidths: readonly number[],
  viewportWidth: number,
  headerWidth: number,
  margin: number,
  padding: { left: number; right: number; boundary?: number } = {
    left: 0,
    right: 0,
  },
  density: ScoreDensity | number = 50,
  layout: SimplifiedScoreLayout = 'smart',
  browserZoom = 1,
) {
  // Verovio uses 180 units between staff lines in a pageWidth * 10 viewBox.
  // Match that physical staff size, including the original page's 1200px cap.
  // VexFlow's unscaled staff lines are 10px apart.
  const displayWidth = Math.min(1200, viewportWidth);
  const densitySettings = getSimplifiedDensity(density);
  const preferredScale =
    ((1.8 * displayWidth) / getScorePageWidth(viewportWidth)) * browserZoom;
  const requiredWidths = measureWidths.map(
    (measureWidth) => Math.max(1, measureWidth) * densitySettings.noteSpacing,
  );
  const scale = preferredScale;
  const width = viewportWidth / scale;
  const available =
    width - margin * 2 - headerWidth - padding.left - padding.right;
  const boundary = padding.boundary ?? padding.left;
  const measuresPerLine = Math.max(
    1,
    Math.round(densitySettings.measuresPerLine / Math.max(1, browserZoom)),
  );
  const lines: {
    measureIndices: number[];
    widths: number[];
    timeStartX: number;
    timeWidth: number;
    timeWidths: number[];
    noteWidths: number[];
  }[] = [];
  for (let first = 0; first < measureWidths.length;) {
    const indices = [first];
    let occupied = requiredWidths[first];
    while (
      first + indices.length < measureWidths.length
      && indices.length < measuresPerLine
    ) {
      const candidate = first + indices.length;
      const candidateWidths = [...indices, candidate].map((index) => requiredWidths[index]);
      const needed = layout === 'equal'
        ? Math.max(...candidateWidths) * candidateWidths.length
        : candidateWidths.reduce((sum, value) => sum + value, 0);
      if (needed > available * Math.max(1, browserZoom) + 0.001) break;
      indices.push(candidate);
      occupied += requiredWidths[candidate];
    }
    const equalWidth = available / indices.length;
    const minimumSmartWidth = equalWidth * 0.5;
    const weightedSpace = available - minimumSmartWidth * indices.length;
    const timeWidths = layout === 'equal'
      ? indices.map(() => equalWidth)
      : indices.map((index) =>
          minimumSmartWidth + requiredWidths[index] * weightedSpace / occupied,
        );
    const noteWidths = indices.map((index, position) =>
      Math.min(timeWidths[position], requiredWidths[index] * 1.35),
    );
    lines.push({
      measureIndices: indices,
      timeStartX: margin + headerWidth + padding.left,
      timeWidth: Math.max(...timeWidths),
      timeWidths,
      noteWidths,
      widths: indices.map(
        (_, i) =>
          timeWidths[i] +
          (i === 0 ? headerWidth + padding.left - boundary : 0) +
          // The closing barline is the time-axis endpoint. Keep right-side
          // fitting clearance outside the staff, where it consumes no time.
          (i === indices.length - 1 ? boundary : 0),
      ),
    });
    first += indices.length;
  }
  return { scale, width, lines };
}
