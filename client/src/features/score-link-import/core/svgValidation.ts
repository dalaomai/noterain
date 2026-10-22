import { parseSvgPage } from './svgScore';

interface SvgSystemSignature {
  staffCount: number;
  measureCount: number;
  noteCount?: number;
  restCount?: number;
}

interface SvgPageSignature {
  systems: SvgSystemSignature[];
}

interface SvgStructureMismatch {
  page: number;
  system?: number;
  field: 'pageCount' | 'systemCount' | 'staffCount' | 'measureCount';
  source: number;
  generated: number;
}

export interface SvgValidationReport {
  valid: boolean;
  source: SvgPageSignature[];
  generated: SvgPageSignature[];
  mismatches: SvgStructureMismatch[];
  unsupportedSourceSymbols: string[];
}

const UNVERIFIED_NOTATION_CLASSES = [
  'Accidental',
  'PedalSegment',
  'Rest',
  'SlurSegment',
  'StaffText',
  'Stem',
  'Text',
  'Tuplet',
] as const;

interface GroupFrame {
  classes: Set<string>;
  system?: SvgSystemSignature;
  measureStaffCount?: number;
}

function classesFromTag(tag: string): Set<string> {
  const value = tag.match(/\bclass=(?:"([^"]*)"|'([^']*)')/i)?.slice(1).find(Boolean) ?? '';
  return new Set(value.split(/\s+/).filter(Boolean));
}

function sourceNotationClasses(pages: string[]): string[] {
  const present = new Set<string>();
  for (const svg of pages) {
    for (const match of svg.matchAll(/\bclass=(?:"([^"]*)"|'([^']*)')/gi)) {
      const value = match[1] ?? match[2] ?? '';
      for (const className of value.split(/\s+/)) present.add(className);
    }
  }
  return UNVERIFIED_NOTATION_CLASSES.filter((className) => present.has(className));
}

function nearestSystem(stack: GroupFrame[]): SvgSystemSignature | undefined {
  for (let index = stack.length - 1; index >= 0; index--) {
    if (stack[index].system) return stack[index].system;
  }
  return undefined;
}

function nearestMeasure(stack: GroupFrame[]): GroupFrame | undefined {
  for (let index = stack.length - 1; index >= 0; index--) {
    if (stack[index].measureStaffCount !== undefined) return stack[index];
  }
  return undefined;
}

export function summarizeRenderedSvgPage(svg: string): SvgPageSignature {
  if (!/^\s*<svg\b/i.test(svg)) throw new Error('INVALID_RENDERED_SCORE_PAGE');
  const systems: SvgSystemSignature[] = [];
  const stack: GroupFrame[] = [];
  const tags = svg.match(/<\/?g\b[^>]*>/gi) ?? [];

  for (const tag of tags) {
    if (/^<\/g/i.test(tag)) {
      stack.pop();
      continue;
    }
    const classes = classesFromTag(tag);
    const parentSystem = nearestSystem(stack);
    const system = classes.has('system')
      ? { staffCount: 0, measureCount: 0, noteCount: 0, restCount: 0 }
      : parentSystem;
    if (classes.has('system')) systems.push(system as SvgSystemSignature);
    if (parentSystem && classes.has('measure')) parentSystem.measureCount += 1;
    if (parentSystem && classes.has('staff')) {
      const measure = nearestMeasure(stack);
      if (measure) {
        measure.measureStaffCount = (measure.measureStaffCount ?? 0) + 1;
        parentSystem.staffCount = Math.max(parentSystem.staffCount, measure.measureStaffCount);
      } else {
        parentSystem.staffCount += 1;
      }
    }
    if (parentSystem && classes.has('note')) parentSystem.noteCount = (parentSystem.noteCount ?? 0) + 1;
    if (parentSystem && classes.has('rest')) parentSystem.restCount = (parentSystem.restCount ?? 0) + 1;
    if (!/\/>$/.test(tag)) {
      stack.push({
        classes,
        system,
        measureStaffCount: classes.has('measure') ? 0 : undefined,
      });
    }
  }

  if (!systems.length) throw new Error('RENDERED_SCORE_STRUCTURE_UNAVAILABLE');
  return { systems };
}

function summarizeSourceSvgPages(pages: string[]): SvgPageSignature[] {
  return pages.map((svg) => {
    const page = parseSvgPage(svg);
    return {
      systems: page.systems.map((system) => ({
        staffCount: system.staves.length,
        measureCount: Math.max(0, system.barlines.length - 1),
      })),
    };
  });
}

export function validateSvgStructure(
  sourcePages: string[],
  generatedPages: string[],
): SvgValidationReport {
  const source = summarizeSourceSvgPages(sourcePages);
  const generated = generatedPages.map(summarizeRenderedSvgPage);
  const mismatches: SvgStructureMismatch[] = [];
  const unsupportedSourceSymbols = sourceNotationClasses(sourcePages);

  if (source.length !== generated.length) {
    mismatches.push({
      page: 0,
      field: 'pageCount',
      source: source.length,
      generated: generated.length,
    });
  }
  const pageCount = Math.max(source.length, generated.length);
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
    const sourcePage = source[pageIndex];
    const generatedPage = generated[pageIndex];
    if (!sourcePage || !generatedPage) continue;
    if (sourcePage.systems.length !== generatedPage.systems.length) {
      mismatches.push({
        page: pageIndex + 1,
        field: 'systemCount',
        source: sourcePage.systems.length,
        generated: generatedPage.systems.length,
      });
    }
    const systemCount = Math.min(sourcePage.systems.length, generatedPage.systems.length);
    for (let systemIndex = 0; systemIndex < systemCount; systemIndex++) {
      const sourceSystem = sourcePage.systems[systemIndex];
      const generatedSystem = generatedPage.systems[systemIndex];
      for (const field of ['staffCount', 'measureCount'] as const) {
        if (sourceSystem[field] === generatedSystem[field]) continue;
        mismatches.push({
          page: pageIndex + 1,
          system: systemIndex + 1,
          field,
          source: sourceSystem[field],
          generated: generatedSystem[field],
        });
      }
    }
  }

  return {
    valid: mismatches.length === 0 && unsupportedSourceSymbols.length === 0,
    source,
    generated,
    mismatches,
    unsupportedSourceSymbols,
  };
}