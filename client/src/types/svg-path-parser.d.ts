declare module 'svg-path-parser' {
  export interface SvgPathCommand {
    code: string;
    command: string;
    x: number;
    y: number;
    x0?: number;
    y0?: number;
    x1?: number;
    y1?: number;
    x2?: number;
    y2?: number;
  }

  export function parseSVG(path: string): SvgPathCommand[];
  export function makeAbsolute(commands: SvgPathCommand[]): SvgPathCommand[];
}