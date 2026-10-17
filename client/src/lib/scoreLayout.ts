import type { ScoreDensity } from '../types/midi';

export const BARLINE_NOTE_GAP = 12;

export const SCORE_DENSITIES = {
  relaxed: {
    pageWidthFactor: 1.9,
    spacing: 1.5,
    staveHeight: 112,
    systemGap: 36,
  },
  standard: {
    pageWidthFactor: 2.1,
    spacing: 1.25,
    staveHeight: 104,
    systemGap: 24,
  },
  compact: {
    pageWidthFactor: 2.5,
    spacing: 1,
    staveHeight: 96,
    systemGap: 16,
  },
} satisfies Record<ScoreDensity, object>;

export function getScorePageWidth(viewportWidth: number, density: ScoreDensity) {
  return Math.max(
    750,
    Math.round(
      Math.max(320, viewportWidth) * SCORE_DENSITIES[density].pageWidthFactor,
    ),
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
  density: ScoreDensity = 'standard',
) {
  // Verovio uses 180 units between staff lines in a pageWidth * 10 viewBox.
  // Match that physical staff size, including the original page's 1200px cap.
  // VexFlow's unscaled staff lines are 10px apart.
  const displayWidth = Math.min(1200, viewportWidth);
  const scale = (1.8 * displayWidth) / getScorePageWidth(viewportWidth, density);
  const widest = Math.max(0, ...measureWidths);
  const timeWidth = Math.max(1, widest) * SCORE_DENSITIES[density].spacing;
  // Dense bars remain readable at the same size as the original. Allow panning
  // one oversized bar instead of shrinking every symbol in the entire score.
  const width = Math.max(
    displayWidth / scale,
    timeWidth + headerWidth + padding.left + padding.right + margin * 2,
  );
  const available =
    width - margin * 2 - headerWidth - padding.left - padding.right;
  const measuresPerLine = Math.max(
    1,
    Math.floor((available + 0.001) / timeWidth),
  );
  const boundary = padding.boundary ?? padding.left;
  const lines: {
    measureIndices: number[];
    widths: number[];
    timeStartX: number;
    timeWidth: number;
  }[] = [];
  for (let first = 0; first < measureWidths.length; first += measuresPerLine) {
    const indices = Array.from(
      { length: Math.min(measuresPerLine, measureWidths.length - first) },
      (_, i) => first + i,
    );
    lines.push({
      measureIndices: indices,
      timeStartX: margin + headerWidth + padding.left,
      timeWidth,
      widths: indices.map(
        (_, i) =>
          timeWidth +
          (i === 0 ? headerWidth + padding.left - boundary : 0) +
          // The closing barline is the time-axis endpoint. Keep right-side
          // fitting clearance outside the staff, where it consumes no time.
          (i === indices.length - 1 ? boundary : 0),
      ),
    });
  }
  return { scale, width, lines };
}
