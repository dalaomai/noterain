import { makeAbsolute, parseSVG } from 'svg-path-parser';

interface SvgStaff {
  top: number;
  bottom: number;
  spacing: number;
}

interface SvgNoteAnchor {
  x: number;
  y: number;
  staff: number;
  measure: number;
}

interface SvgRestAnchor extends SvgNoteAnchor {
  width: number;
  height: number;
}

interface SvgPointAnchor {
  x: number;
  y: number;
}

interface SvgRangeAnchor {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  startX?: number;
  startY?: number;
  endX?: number;
  endY?: number;
}

interface SvgAccidentalAnchor extends SvgPointAnchor {
  alter: -1 | 0 | 1;
}

interface SvgHairpinAnchor extends SvgRangeAnchor {
  type: 'crescendo' | 'diminuendo';
}

type SvgPedalAnchor = SvgRangeAnchor;

interface SvgSystem {
  top: number;
  bottom: number;
  staves: SvgStaff[];
  barlines: number[];
  noteAnchors: SvgNoteAnchor[];
  restAnchors: SvgRestAnchor[];
  noteDots: SvgPointAnchor[];
  arpeggios: SvgRangeAnchor[];
  articulations: SvgPointAnchor[];
  slurs: SvgRangeAnchor[];
  hairpins: SvgHairpinAnchor[];
  pedals: SvgPedalAnchor[];
  accidentals: SvgAccidentalAnchor[];
  stems: SvgRangeAnchor[];
  beams: SvgRangeAnchor[];
  hooks: SvgRangeAnchor[];
  tremolos: SvgRangeAnchor[];
  dynamics: SvgRangeAnchor[];
  tuplets: SvgPointAnchor[];
  clefs: Array<'G' | 'F'>;
}

export interface SvgPageModel {
  width: number;
  height: number;
  systems: SvgSystem[];
}

const NUMBER = String.raw`[-+]?(?:\d*\.\d+|\d+\.?\d*)`;

function attribute(svg: string, name: string): string | undefined {
  return svg.match(new RegExp(String.raw`\b${name}="([^"]*)"`, 'i'))?.[1];
}

function classPath(svg: string, className: string): string {
  return classPaths(svg, className)
    .join('');
}

function classPaths(svg: string, className: string): string[] {
  return [...svg.matchAll(/<path\b[^>]*>/gi)]
    .filter(([tag]) => new RegExp(String.raw`\bclass="[^"]*\b${className}\b[^"]*"`, 'i').test(tag))
    .map(([tag]) => attribute(tag, 'd') ?? '');
}

function uniqueSorted(values: number[], tolerance = 0.05): number[] {
  return values
    .sort((left, right) => left - right)
    .filter((value, index, sorted) => index === 0 || Math.abs(value - sorted[index - 1]) > tolerance);
}

function parseStaffLines(path: string): SvgStaff[] {
  const horizontalLine = new RegExp(String.raw`M(${NUMBER})[ ,](${NUMBER})H(${NUMBER})`, 'gi');
  const yValues = [...path.matchAll(horizontalLine)].map((match) => Number(match[2]));
  const lines = uniqueSorted(yValues);
  const staves: SvgStaff[] = [];

  for (let index = 0; index + 4 < lines.length;) {
    const group = lines.slice(index, index + 5);
    const gaps = group.slice(1).map((value, gapIndex) => value - group[gapIndex]);
    const spacing = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
    if (spacing > 0 && gaps.every((gap) => Math.abs(gap - spacing) < 0.1)) {
      staves.push({ top: group[0], bottom: group[4], spacing });
      index += 5;
    } else {
      index += 1;
    }
  }
  return staves;
}

function parseBarlines(path: string): Array<{ x: number; top: number; bottom: number }> {
  const verticalLine = new RegExp(String.raw`M(${NUMBER})[ ,](${NUMBER})v(${NUMBER})`, 'gi');
  const segments = [...path.matchAll(verticalLine)].map((match) => {
    const top = Number(match[2]);
    return { x: Number(match[1]), top, bottom: top + Number(match[3]) };
  }).sort((left, right) => left.x - right.x || left.top - right.top);
  const merged: typeof segments = [];
  for (const segment of segments) {
    const previous = merged[merged.length - 1];
    if (
      previous
      && Math.abs(previous.x - segment.x) < 0.1
      && segment.top <= previous.bottom + 5
    ) {
      previous.top = Math.min(previous.top, segment.top);
      previous.bottom = Math.max(previous.bottom, segment.bottom);
    } else merged.push({ ...segment });
  }
  return merged;
}

function mergeNearbyBarlines(
  barlines: Array<{ x: number; top: number; bottom: number }>,
  threshold: number,
) {
  const groups: Array<typeof barlines> = [];
  for (const barline of barlines) {
    const group = groups[groups.length - 1];
    if (!group || barline.x - group[group.length - 1].x > threshold) groups.push([barline]);
    else group.push(barline);
  }
  return groups.map((group) => ({
    x: group.reduce((sum, barline) => sum + barline.x, 0) / group.length,
    top: Math.min(...group.map((barline) => barline.top)),
    bottom: Math.max(...group.map((barline) => barline.bottom)),
  }));
}

function parseNoteAnchors(svg: string): Array<{ x: number; y: number }> {
  const anchors = [...svg.matchAll(/<path\b[^>]*>/gi)]
    .filter(([tag]) => /\bclass="[^"]*\bNote\b[^"]*"/i.test(tag))
    .flatMap(([tag]) => {
      const commands = makeAbsolute(parseSVG(attribute(tag, 'd') ?? ''));
      const anchors: Array<{ x: number; y: number }> = [];
      let bounds: { minX: number; maxX: number; minY: number; maxY: number } | undefined;
      const finish = () => {
        if (!bounds) return;
        anchors.push({
          x: (bounds.minX + bounds.maxX) / 2,
          y: (bounds.minY + bounds.maxY) / 2,
        });
        bounds = undefined;
      };
      for (const command of commands) {
        if (command.code === 'M') {
          finish();
          bounds = {
            minX: command.x,
            maxX: command.x,
            minY: command.y,
            maxY: command.y,
          };
          continue;
        }
        if (!bounds) continue;
        for (const key of ['x', 'x0', 'x1', 'x2'] as const) {
          const value = command[key];
          if (value === undefined) continue;
          bounds.minX = Math.min(bounds.minX, value);
          bounds.maxX = Math.max(bounds.maxX, value);
        }
        for (const key of ['y', 'y0', 'y1', 'y2'] as const) {
          const value = command[key];
          if (value === undefined) continue;
          bounds.minY = Math.min(bounds.minY, value);
          bounds.maxY = Math.max(bounds.maxY, value);
        }
      }
      finish();
      return anchors;
    });
  const merged: Array<{ x: number; y: number }> = [];
  for (const anchor of anchors) {
    const existing = merged.find((candidate) =>
      Math.abs(candidate.x - anchor.x) < 0.01
      && Math.abs(candidate.y - anchor.y) < 0.01,
    );
    if (existing) {
      existing.x = (existing.x + anchor.x) / 2;
      existing.y = (existing.y + anchor.y) / 2;
    } else merged.push({ ...anchor });
  }
  return merged;
}

function pathBounds(path: string): SvgRangeAnchor[] {
  const commands = makeAbsolute(parseSVG(path));
  const groups: SvgRangeAnchor[] = [];
  let bounds: SvgRangeAnchor | undefined;
  const finish = () => {
    if (bounds) groups.push(bounds);
    bounds = undefined;
  };
  for (const command of commands) {
    if (command.code === 'M') {
      finish();
      bounds = { minX: command.x, maxX: command.x, minY: command.y, maxY: command.y };
      continue;
    }
    if (!bounds) continue;
    for (const key of ['x', 'x0', 'x1', 'x2'] as const) {
      const value = command[key];
      if (value !== undefined) { bounds.minX = Math.min(bounds.minX, value); bounds.maxX = Math.max(bounds.maxX, value); }
    }
    for (const key of ['y', 'y0', 'y1', 'y2'] as const) {
      const value = command[key];
      if (value !== undefined) { bounds.minY = Math.min(bounds.minY, value); bounds.maxY = Math.max(bounds.maxY, value); }
    }
  }
  finish();
  return groups;
}

function parsePointAnchors(svg: string, className: string): SvgPointAnchor[] {
  return [...svg.matchAll(/<path\b[^>]*>/gi)]
    .filter(([tag]) => new RegExp(String.raw`\bclass="[^"]*\b${className}\b[^"]*"`, 'i').test(tag))
    .flatMap(([tag]) => pathBounds(attribute(tag, 'd') ?? ''))
    .map((bounds) => ({
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
    }));
}

function parseArticulationPoints(svg: string): SvgPointAnchor[] {
  return [...svg.matchAll(/<path\b[^>]*>/gi)]
    .filter(([tag]) => /\bclass="[^"]*\bArticulation\b[^"]*"/i.test(tag))
    .flatMap(([tag]) => pathBounds(attribute(tag, 'd') ?? ''))
    .filter((bounds) =>
      bounds.maxX - bounds.minX <= 3
      && bounds.maxY - bounds.minY <= 3,
    )
    .map((bounds) => ({
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
    }));
}

function parseTupletPoints(svg: string): SvgPointAnchor[] {
  return [...svg.matchAll(/<path\b[^>]*>/gi)]
    .filter(([tag]) => /\bclass="[^"]*\bTuplet\b[^"]*"/i.test(tag))
    .flatMap(([tag]) => pathBounds(attribute(tag, 'd') ?? ''))
    .filter((bounds) => {
      const width = bounds.maxX - bounds.minX;
      const height = bounds.maxY - bounds.minY;
      return width >= 4 && width <= 5 && height >= 6 && height <= 8;
    })
    .map((bounds) => ({
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
    }));
}

function parseRestPoints(svg: string): Array<SvgPointAnchor & { width: number; height: number }> {
  return [...svg.matchAll(/<path\b[^>]*>/gi)]
    .filter(([tag]) => /\bclass="[^"]*\bRest\b[^"]*"/i.test(tag))
    .flatMap(([tag]) => pathBounds(attribute(tag, 'd') ?? ''))
    .map((bounds) => ({
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
      width: bounds.maxX - bounds.minX,
      height: bounds.maxY - bounds.minY,
    }));
}

function parseAccidentalAnchors(svg: string): SvgAccidentalAnchor[] {
  const parts = [...svg.matchAll(/<path\b[^>]*>/gi)]
    .filter(([tag]) => /\bclass="[^"]*\bAccidental\b[^"]*"/i.test(tag))
    .flatMap(([tag]) => pathBounds(attribute(tag, 'd') ?? ''))
    .sort((left, right) => left.minX - right.minX || left.minY - right.minY);
  const clusters: Array<SvgRangeAnchor & { parts: number }> = [];
  for (const part of parts) {
    const cluster = clusters.find((candidate) => !(
      part.maxX < candidate.minX - 1.5 || part.minX > candidate.maxX + 1.5
      || part.maxY < candidate.minY - 1.5 || part.minY > candidate.maxY + 1.5
    ));
    if (cluster) {
      cluster.minX = Math.min(cluster.minX, part.minX);
      cluster.maxX = Math.max(cluster.maxX, part.maxX);
      cluster.minY = Math.min(cluster.minY, part.minY);
      cluster.maxY = Math.max(cluster.maxY, part.maxY);
      cluster.parts += 1;
    } else clusters.push({ ...part, parts: 1 });
  }
  return clusters.flatMap((cluster) => {
    if (cluster.parts !== 2) return [];
    const width = cluster.maxX - cluster.minX;
    const height = cluster.maxY - cluster.minY;
    let alter: -1 | 0 | 1 | undefined;
    if (width < 4.1 && height > 14) alter = -1;
    else if (width > 5 && height > 14) alter = 0;
    else if (width >= 4 && width <= 5 && height < 14) alter = 1;
    return alter === undefined ? [] : [{
      x: (cluster.minX + cluster.maxX) / 2,
      y: (cluster.minY + cluster.maxY) / 2,
      alter,
    }];
  });
}

function parseConnectedRanges(svg: string, className: string, gap = 1): SvgRangeAnchor[] {
  const parts = [...svg.matchAll(/<path\b[^>]*>/gi)]
    .filter(([tag]) => new RegExp(String.raw`\bclass="[^"]*\b${className}\b[^"]*"`, 'i').test(tag))
    .flatMap(([tag]) => pathBounds(attribute(tag, 'd') ?? ''));
  const clusters: SvgRangeAnchor[] = [];
  for (const part of parts) {
    const cluster = clusters.find((candidate) => !(
      part.maxX < candidate.minX - gap || part.minX > candidate.maxX + gap
      || part.maxY < candidate.minY - gap || part.minY > candidate.maxY + gap
    ));
    if (cluster) {
      cluster.minX = Math.min(cluster.minX, part.minX);
      cluster.maxX = Math.max(cluster.maxX, part.maxX);
      cluster.minY = Math.min(cluster.minY, part.minY);
      cluster.maxY = Math.max(cluster.maxY, part.maxY);
    } else clusters.push({ ...part });
  }
  return clusters;
}

function parseRangeAnchors(svg: string, className: string): SvgRangeAnchor[] {
  return [...svg.matchAll(/<path\b[^>]*>/gi)]
    .filter(([tag]) => new RegExp(String.raw`\bclass="[^"]*\b${className}\b[^"]*"`, 'i').test(tag))
    .flatMap(([tag]) => {
      const groups = pathBounds(attribute(tag, 'd') ?? '');
      if (!groups.length) return [];
      return [groups.reduce((combined, bounds) => ({
        minX: Math.min(combined.minX, bounds.minX),
        maxX: Math.max(combined.maxX, bounds.maxX),
        minY: Math.min(combined.minY, bounds.minY),
        maxY: Math.max(combined.maxY, bounds.maxY),
      }))];
    });
}

function parseSlurAnchors(svg: string): SvgRangeAnchor[] {
  const segments = [...svg.matchAll(/<path\b[^>]*>/gi)]
    .filter(([tag]) => /\bclass="[^"]*\bSlurSegment\b[^"]*"/i.test(tag))
    .flatMap(([tag]) => {
      const commands = makeAbsolute(parseSVG(attribute(tag, 'd') ?? ''));
      const slurs: SvgRangeAnchor[] = [];
      let move: { x: number; y: number } | undefined;
      let drawable: typeof commands = [];
      const finish = () => {
        if (!move || !drawable.length) {
          move = undefined;
          drawable = [];
          return;
        }
        const valuesX = drawable.flatMap((command) => [command.x0, command.x, command.x1, command.x2]).filter((value): value is number => value !== undefined);
        const valuesY = drawable.flatMap((command) => [command.y0, command.y, command.y1, command.y2]).filter((value): value is number => value !== undefined);
        const last = drawable[drawable.length - 1];
        slurs.push({
          minX: Math.min(move.x, ...valuesX),
          maxX: Math.max(move.x, ...valuesX),
          minY: Math.min(move.y, ...valuesY),
          maxY: Math.max(move.y, ...valuesY),
          startX: move.x,
          startY: move.y,
          endX: last.x,
          endY: last.y,
        });
        move = undefined;
        drawable = [];
      };
      for (const command of commands) {
        if (command.code === 'M') {
          finish();
          move = { x: command.x, y: command.y };
        } else if (command.code !== 'Z') drawable.push(command);
      }
      finish();
      return slurs;
    });
  const paired: SvgRangeAnchor[] = [];
  const used = new Set<number>();
  segments.forEach((segment, index) => {
    if (used.has(index)) return;
    const width = segment.maxX - segment.minX;
    if (width < 8) return;
    let bestIndex = -1;
    let bestScore = Number.POSITIVE_INFINITY;
    segments.forEach((candidate, candidateIndex) => {
      if (candidateIndex === index || used.has(candidateIndex)) return;
      const candidateWidth = candidate.maxX - candidate.minX;
      const overlap = Math.min(segment.maxX, candidate.maxX) - Math.max(segment.minX, candidate.minX);
      if (overlap < Math.min(width, candidateWidth) * 0.8) return;
      const score = Math.abs(segment.minX - candidate.minX) + Math.abs(segment.maxX - candidate.maxX);
      if (score < bestScore) {
        bestScore = score;
        bestIndex = candidateIndex;
      }
    });
    if (bestIndex < 0 || bestScore > 8) return;
    const other = segments[bestIndex];
    used.add(index);
    used.add(bestIndex);
    const minX = Math.min(segment.minX, other.minX);
    const maxX = Math.max(segment.maxX, other.maxX);
    const minY = Math.min(segment.minY, other.minY);
    const maxY = Math.max(segment.maxY, other.maxY);
    if (maxY - minY > width * 1.5) return;
    paired.push({
      minX,
      maxX,
      minY,
      maxY,
      startX: minX,
      startY: (segment.minY + segment.maxY + other.minY + other.maxY) / 4,
      endX: maxX,
      endY: (segment.minY + segment.maxY + other.minY + other.maxY) / 4,
    });
  });
  return paired;
}

function parseHairpinAnchors(svg: string): SvgHairpinAnchor[] {
  const lines = [...svg.matchAll(/<path\b[^>]*>/gi)]
    .filter(([tag]) => /\bclass="[^"]*\bHairpinSegment\b[^"]*"/i.test(tag))
    .flatMap(([tag]) => {
      const commands = makeAbsolute(parseSVG(attribute(tag, 'd') ?? ''));
      const segments: Array<{ startX: number; startY: number; endX: number; endY: number }> = [];
      let move: { x: number; y: number } | undefined;
      let last: { x: number; y: number } | undefined;
      const finish = () => {
        if (move && last) segments.push({ startX: move.x, startY: move.y, endX: last.x, endY: last.y });
        move = undefined;
        last = undefined;
      };
      for (const command of commands) {
        if (command.code === 'M') {
          finish();
          move = { x: command.x, y: command.y };
        } else if (command.code !== 'Z') last = { x: command.x, y: command.y };
      }
      finish();
      return segments;
    });
  const hairpins: SvgHairpinAnchor[] = [];
  const used = new Set<number>();
  lines.forEach((line, index) => {
    if (used.has(index)) return;
    const matchIndex = lines.findIndex((candidate, candidateIndex) =>
      candidateIndex !== index
      && !used.has(candidateIndex)
      && Math.abs(candidate.startX - line.startX) < 0.2
      && Math.abs(candidate.endX - line.endX) < 0.2,
    );
    if (matchIndex < 0) return;
    const other = lines[matchIndex];
    used.add(index);
    used.add(matchIndex);
    const startGap = Math.abs(line.startY - other.startY);
    const endGap = Math.abs(line.endY - other.endY);
    if (Math.max(startGap, endGap) < 2) return;
    hairpins.push({
      minX: Math.min(line.startX, line.endX),
      maxX: Math.max(line.startX, line.endX),
      minY: Math.min(line.startY, line.endY, other.startY, other.endY),
      maxY: Math.max(line.startY, line.endY, other.startY, other.endY),
      startX: line.startX,
      startY: (line.startY + other.startY) / 2,
      endX: line.endX,
      endY: (line.endY + other.endY) / 2,
      type: endGap > startGap ? 'crescendo' : 'diminuendo',
    });
  });
  return hairpins;
}

function parsePedalAnchors(svg: string): SvgPedalAnchor[] {
  return [...svg.matchAll(/<path\b[^>]*>/gi)]
    .filter(([tag]) => /\bclass="[^"]*\bPedalSegment\b[^"]*"/i.test(tag))
    .flatMap(([tag]) => {
      const commands = makeAbsolute(parseSVG(attribute(tag, 'd') ?? ''));
      const segments: SvgPedalAnchor[] = [];
      let points: SvgPointAnchor[] = [];
      const finish = () => {
        if (points.length < 2) { points = []; return; }
        const minX = Math.min(...points.map((point) => point.x));
        const maxX = Math.max(...points.map((point) => point.x));
        const minY = Math.min(...points.map((point) => point.y));
        const maxY = Math.max(...points.map((point) => point.y));
        if (maxX - minX > 8 && maxY - minY < 1) {
          segments.push({
            minX,
            maxX,
            minY,
            maxY,
            startX: minX,
            startY: (minY + maxY) / 2,
            endX: maxX,
            endY: (minY + maxY) / 2,
          });
        }
        points = [];
      };
      for (const command of commands) {
        if (command.code === 'M') {
          finish();
          points.push({ x: command.x, y: command.y });
        } else if (command.code !== 'Z') points.push({ x: command.x, y: command.y });
      }
      finish();
      return segments;
    });
}

function parseClefAnchors(svg: string): Array<{ x: number; y: number; sign: 'G' | 'F' }> {
  return [...svg.matchAll(/<path\b[^>]*>/gi)]
    .filter(([tag]) => /\bclass="[^"]*\bClef\b[^"]*"/i.test(tag))
    .flatMap(([tag]) => {
      const commands = makeAbsolute(parseSVG(attribute(tag, 'd') ?? ''));
      const groups: Array<{ minX: number; maxX: number; minY: number; maxY: number }> = [];
      let bounds: (typeof groups)[number] | undefined;
      const finish = () => {
        if (bounds) groups.push(bounds);
        bounds = undefined;
      };
      for (const command of commands) {
        if (command.code === 'M') {
          finish();
          bounds = { minX: command.x, maxX: command.x, minY: command.y, maxY: command.y };
          continue;
        }
        if (!bounds) continue;
        for (const key of ['x', 'x0', 'x1', 'x2'] as const) {
          const value = command[key];
          if (value !== undefined) { bounds.minX = Math.min(bounds.minX, value); bounds.maxX = Math.max(bounds.maxX, value); }
        }
        for (const key of ['y', 'y0', 'y1', 'y2'] as const) {
          const value = command[key];
          if (value !== undefined) { bounds.minY = Math.min(bounds.minY, value); bounds.maxY = Math.max(bounds.maxY, value); }
        }
      }
      finish();
      const clusters: typeof groups = [];
      for (const group of groups) {
        const cluster = clusters.find((candidate) => !(
          group.maxX < candidate.minX - 3 || group.minX > candidate.maxX + 3
          || group.maxY < candidate.minY - 3 || group.minY > candidate.maxY + 3
        ));
        if (cluster) {
          cluster.minX = Math.min(cluster.minX, group.minX);
          cluster.maxX = Math.max(cluster.maxX, group.maxX);
          cluster.minY = Math.min(cluster.minY, group.minY);
          cluster.maxY = Math.max(cluster.maxY, group.maxY);
        } else clusters.push({ ...group });
      }
      return clusters.map((cluster) => ({
        x: (cluster.minX + cluster.maxX) / 2,
        y: (cluster.minY + cluster.maxY) / 2,
        sign: cluster.maxY - cluster.minY > 24 ? 'G' as const : 'F' as const,
      }));
    });
}

function groupSystems(
  staves: SvgStaff[],
  barlines: Array<{ x: number; top: number; bottom: number }>,
  noteAnchors: Array<{ x: number; y: number }>,
  restPoints: Array<SvgPointAnchor & { width: number; height: number }>,
  clefAnchors: Array<{ x: number; y: number; sign: 'G' | 'F' }>,
  noteDots: SvgPointAnchor[],
  arpeggios: SvgRangeAnchor[],
  articulations: SvgPointAnchor[],
  slurs: SvgRangeAnchor[],
  hairpins: SvgHairpinAnchor[],
  pedals: SvgPedalAnchor[],
  accidentals: SvgAccidentalAnchor[],
  stems: SvgRangeAnchor[],
  beams: SvgRangeAnchor[],
  hooks: SvgRangeAnchor[],
  tremolos: SvgRangeAnchor[],
  dynamics: SvgRangeAnchor[],
  tuplets: SvgPointAnchor[],
): SvgSystem[] {
  const systems: SvgSystem[] = [];
  for (let index = 0; index < staves.length;) {
    const first = staves[index];
    const boundaryTolerance = first.spacing * 0.25;
    const candidates = barlines.filter((barline) => Math.abs(barline.top - first.top) <= boundaryTolerance);
    const boundary = candidates.reduce(
      (largest, barline) => Math.max(largest, barline.bottom),
      first.bottom,
    );
    const systemStaves = staves.slice(index).filter(
      (staff) => staff.top >= first.top - 0.1 && staff.bottom <= boundary + 0.1,
    );
    if (!systemStaves.length) systemStaves.push(first);
    const bottom = systemStaves[systemStaves.length - 1].bottom;
    const previousBottom = systems[systems.length - 1]?.bottom;
    const nextStaff = staves[index + systemStaves.length];
    const regionTop = previousBottom === undefined
      ? Number.NEGATIVE_INFINITY
      : (previousBottom + first.top) / 2;
    const regionBottom = nextStaff === undefined
      ? Number.POSITIVE_INFINITY
      : (bottom + nextStaff.top) / 2;
    const systemBarlines = mergeNearbyBarlines(
      barlines.filter(
        (barline) =>
          Math.abs(barline.top - first.top) <= boundaryTolerance
          && barline.bottom >= bottom - boundaryTolerance,
      )
        .sort((left, right) => left.x - right.x),
      first.spacing * 0.75,
    );
    const systemNotes = noteAnchors.flatMap((note) => {
      if (note.y < first.top - first.spacing * 4 || note.y > bottom + first.spacing * 4) return [];
      const staff = systemStaves.reduce((best, candidate, staffIndex) => {
        const center = (candidate.top + candidate.bottom) / 2;
        const distance = Math.abs(note.y - center);
        return distance < best.distance ? { staff: staffIndex + 1, distance } : best;
      }, { staff: 1, distance: Number.POSITIVE_INFINITY }).staff;
      const measure = systemBarlines.findIndex((barline, barlineIndex) =>
        barlineIndex < systemBarlines.length - 1
          && note.x >= barline.x - 0.1
          && note.x < systemBarlines[barlineIndex + 1].x - 0.1,
      );
      return measure < 0 ? [] : [{ ...note, staff, measure }];
    });
    const systemRests = restPoints.flatMap((rest) => {
      if (rest.y < first.top - first.spacing * 4 || rest.y > bottom + first.spacing * 4) return [];
      const staff = systemStaves.reduce((best, candidate, staffIndex) => {
        const distance = Math.abs(rest.y - (candidate.top + candidate.bottom) / 2);
        return distance < best.distance ? { staff: staffIndex + 1, distance } : best;
      }, { staff: 1, distance: Number.POSITIVE_INFINITY }).staff;
      const measure = systemBarlines.findIndex((barline, barlineIndex) =>
        barlineIndex < systemBarlines.length - 1
          && rest.x >= barline.x - 0.1
          && rest.x < systemBarlines[barlineIndex + 1].x - 0.1,
      );
      return measure < 0 ? [] : [{ ...rest, staff, measure }];
    });
    const clefs = systemStaves.map((staff) => {
      const center = (staff.top + staff.bottom) / 2;
      return clefAnchors
        .filter((clef) => Math.abs(clef.y - center) < staff.spacing * 5)
        .sort((left, right) => left.x - right.x)[0]?.sign ?? 'G';
    });
    const systemDots = noteDots.filter((dot) => dot.y >= regionTop && dot.y < regionBottom);
    const systemArpeggios = arpeggios.filter((arpeggio) =>
      (arpeggio.minY + arpeggio.maxY) / 2 >= regionTop
      && (arpeggio.minY + arpeggio.maxY) / 2 < regionBottom,
    );
    const systemArticulations = articulations.filter((articulation) => articulation.y >= regionTop && articulation.y < regionBottom);
    const systemSlurs = slurs.filter((slur) =>
      (slur.minY + slur.maxY) / 2 >= regionTop
      && (slur.minY + slur.maxY) / 2 < regionBottom,
    );
    const systemHairpins = hairpins.filter((hairpin) =>
      (hairpin.minY + hairpin.maxY) / 2 >= regionTop
      && (hairpin.minY + hairpin.maxY) / 2 < regionBottom,
    );
    const systemPedals = pedals.filter((pedal) =>
      (pedal.minY + pedal.maxY) / 2 >= regionTop
      && (pedal.minY + pedal.maxY) / 2 < regionBottom,
    );
    const systemAccidentals = accidentals.filter((accidental) => accidental.y >= regionTop && accidental.y < regionBottom);
    const inRegion = (range: SvgRangeAnchor) => {
      const center = (range.minY + range.maxY) / 2;
      return center >= regionTop && center < regionBottom;
    };
    systems.push({
      top: first.top,
      bottom,
      staves: systemStaves,
      barlines: uniqueSorted(systemBarlines.map((barline) => barline.x)),
      noteAnchors: systemNotes,
      restAnchors: systemRests,
      noteDots: systemDots,
      arpeggios: systemArpeggios,
      articulations: systemArticulations,
      slurs: systemSlurs,
      hairpins: systemHairpins,
      pedals: systemPedals,
      accidentals: systemAccidentals,
      stems: stems.filter(inRegion),
      beams: beams.filter(inRegion),
      hooks: hooks.filter(inRegion),
      tremolos: tremolos.filter(inRegion),
      dynamics: dynamics.filter(inRegion),
      tuplets: tuplets.filter((tuplet) => tuplet.y >= regionTop && tuplet.y < regionBottom),
      clefs,
    });
    index += systemStaves.length;
  }
  return systems;
}

export function parseSvgPage(svg: string): SvgPageModel {
  if (!/^\s*<svg\b/i.test(svg)) throw new Error('INVALID_SCORE_PAGE');
  const width = Number(attribute(svg, 'width'));
  const height = Number(attribute(svg, 'height'));
  if (!Number.isFinite(width) || !Number.isFinite(height)) throw new Error('INVALID_SCORE_PAGE_SIZE');

  const staves = parseStaffLines(classPath(svg, 'StaffLines'));
  const barlines = parseBarlines(classPath(svg, 'BarLine'));
  const noteAnchors = parseNoteAnchors(svg);
  const restPoints = parseRestPoints(svg);
  const clefAnchors = parseClefAnchors(svg);
  const noteDots = parsePointAnchors(svg, 'NoteDot');
  const arpeggios = parseRangeAnchors(svg, 'Arpeggio');
  const articulations = parseArticulationPoints(svg);
  const slurs = parseSlurAnchors(svg);
  const hairpins = parseHairpinAnchors(svg);
  const pedals = parsePedalAnchors(svg);
  const accidentals = parseAccidentalAnchors(svg);
  const ranges = (className: string) => classPaths(svg, className).flatMap(pathBounds);
  const stems = ranges('Stem');
  const beams = ranges('Beam');
  const hooks = ranges('Hook');
  const tremolos = ranges('Tremolo');
  const dynamics = parseConnectedRanges(svg, 'Dynamic');
  const tuplets = parseTupletPoints(svg);
  if (!staves.length || !barlines.length) throw new Error('SCORE_PAGE_STRUCTURE_UNAVAILABLE');
  return { width, height, systems: groupSystems(staves, barlines, noteAnchors, restPoints, clefAnchors, noteDots, arpeggios, articulations, slurs, hairpins, pedals, accidentals, stems, beams, hooks, tremolos, dynamics, tuplets) };
}