import type { CollectedScore } from './types';

const IMPORT_TIMEOUT_MS = 5 * 60 * 1000;
const BRIDGE_TIMEOUT_MS = 5_000;

export function detectCompanionVersion(timeoutMs = 1_500): Promise<string | null> {
  const markedVersion = document.documentElement.dataset.noterainCompanionVersion
    || document.querySelector<HTMLMetaElement>('meta[name="noterain-companion-version"]')?.content;
  console.info('[ScoreLinkCompanion]', 'detect-start', {
    href: window.location.href,
    origin: window.location.origin,
    datasetVersion: document.documentElement.dataset.noterainCompanionVersion ?? null,
    metaVersion: document.querySelector<HTMLMetaElement>('meta[name="noterain-companion-version"]')?.content ?? null,
  });
  if (markedVersion) {
    console.info('[ScoreLinkCompanion]', 'detect-marker-success', { version: markedVersion });
    return Promise.resolve(markedVersion);
  }
  const nonce = crypto.randomUUID();
  return new Promise((resolve) => {
    const finish = (version: string | null) => {
      window.clearTimeout(timeout);
      window.removeEventListener('message', receive);
      console.info('[ScoreLinkCompanion]', version ? 'detect-message-success' : 'detect-timeout', {
        nonce,
        version,
        timeoutMs,
      });
      resolve(version);
    };
    const receive = (event: MessageEvent) => {
      if (
        event.origin !== window.location.origin
        || event.data?.type !== 'noterain-companion-version-response'
        || event.data?.nonce !== nonce
        || typeof event.data?.version !== 'string'
      ) return;
      console.info('[ScoreLinkCompanion]', 'version-response-received', {
        nonce,
        version: event.data.version,
        origin: event.origin,
      });
      finish(event.data.version);
    };
    const timeout = window.setTimeout(() => finish(null), timeoutMs);
    window.addEventListener('message', receive);
    console.info('[ScoreLinkCompanion]', 'version-request-sent', { nonce });
    window.postMessage({ type: 'noterain-companion-version-request', nonce }, window.location.origin);
  });
}

function parseScoreUrl(input: string) {
  const url = new URL(input);
  if (!/^(?:www\.)?musescore\.com$/i.test(url.hostname) || url.protocol !== 'https:') {
    throw new Error('SOURCE_NOT_ACCESSIBLE');
  }
  const match = url.pathname.match(/(?:^|\/)scores\/(\d+)(?:\/|$)/);
  if (!match) throw new Error('SOURCE_NOT_ACCESSIBLE');
  url.hash = '';
  return { url, scoreId: Number(match[1]) };
}

function sanitizeText(value: unknown, maxLength = 256): string {
  return typeof value === 'string'
    ? Array.from(value, (character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 ? ' ' : character;
    }).join('').trim().slice(0, maxLength)
    : '';
}

function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/\s(?:on\w+|href|xlink:href)\s*=\s*(["'])\s*(?:javascript:|https?:|\/\/)[\s\S]*?\1/gi, '');
}

function validateResult(value: unknown, expectedScoreId: number): CollectedScore {
  const result = value as Partial<CollectedScore>;
  if (
    result.source?.provider !== 'musescore'
    || result.source.scoreId !== expectedScoreId
    || typeof result.title !== 'string'
    || !result.title.trim()
    || typeof result.midiBase64 !== 'string'
    || !/^[A-Za-z0-9+/]+=*$/.test(result.midiBase64)
    || !Array.isArray(result.pages)
    || result.pages.length < 1
    || result.pages.length > 100
    || !result.pages.every((page) => typeof page === 'string' && /^\s*<svg\b/i.test(page))
  ) throw new Error('INVALID_IMPORT_RESULT');
  return {
    source: result.source,
    title: sanitizeText(result.title),
    midiBase64: result.midiBase64,
    pages: result.pages.map(sanitizeSvg),
    metadata: {
      subtitle: sanitizeText(result.metadata?.subtitle),
      composer: sanitizeText(result.metadata?.composer),
      arranger: sanitizeText(result.metadata?.arranger),
    },
  };
}

export function importScoreLink(
  input: string,
  sourceWindow: Window,
  signal?: AbortSignal,
): Promise<CollectedScore> {
  const { url, scoreId } = parseScoreUrl(input);
  const nonce = crypto.randomUUID();

  return new Promise((resolve, reject) => {
    const finish = (error?: Error, result?: CollectedScore) => {
      window.clearTimeout(timeout);
      window.clearTimeout(bridgeTimeout);
      signal?.removeEventListener('abort', abort);
      window.removeEventListener('message', receive);
      if (error) reject(error);
      else if (result) resolve(result);
    };
    const abort = () => finish(new DOMException('Aborted', 'AbortError'));
    const receive = (event: MessageEvent) => {
      if (
        event.origin !== window.location.origin
        || event.data?.nonce !== nonce
        || event.data?.type !== 'noterain-score-bridge-response'
      ) return;
      if (event.data.status === 'bridge-ready') {
        window.clearTimeout(bridgeTimeout);
        sourceWindow.location.replace(url);
      } else if (event.data.status === 'complete') {
        try { finish(undefined, validateResult(event.data.result, scoreId)); }
        catch (error) { finish(error instanceof Error ? error : new Error('INVALID_IMPORT_RESULT')); }
      } else if (event.data.status === 'failed') {
        finish(new Error(typeof event.data.error === 'string' ? event.data.error : 'IMPORT_FAILED'));
      }
    };
    const timeout = window.setTimeout(() => finish(new Error('IMPORT_SESSION_TIMEOUT')), IMPORT_TIMEOUT_MS);
    const bridgeTimeout = window.setTimeout(() => finish(new Error('COMPANION_NOT_DETECTED')), BRIDGE_TIMEOUT_MS);
    signal?.addEventListener('abort', abort, { once: true });
    window.addEventListener('message', receive);
    if (signal?.aborted) abort();
    else window.postMessage({
      type: 'noterain-score-bridge-request',
      nonce,
      url: url.toString(),
    }, window.location.origin);
  });
}