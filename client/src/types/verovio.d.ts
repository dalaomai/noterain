declare module 'verovio/wasm' {
  interface VerovioModule {
    _malloc(size: number): number;
    _free(pointer: number): void;
    HEAPU8: Uint8Array;
  }

  export default function createVerovioModule(): Promise<VerovioModule>;
}

declare module 'verovio/esm' {
  export class VerovioToolkit {
    constructor(module: unknown);
    destroy(): void;
    getPageCount(): number;
    getNotatedIdForElement(xmlId: string): string;
    loadData(data: string): boolean;
    loadZipDataBuffer(data: ArrayBuffer): boolean;
    renderToMIDI(): string;
    renderToSVG(page: number, xmlDeclaration?: boolean): string;
    renderToTimemap(options?: Record<string, unknown>): Array<{
      measureOn?: string;
      off?: string[];
      on?: string[];
      tstamp: number;
    }>;
    setOptions(options: Record<string, unknown>): void;
  }
}