import { randomBytes, randomUUID } from 'node:crypto';
import { parsePublicScoreUrl } from './url-policy.js';
import { validateCollectedScore } from './collected-score.js';

const SESSION_TTL_MS = 5 * 60 * 1000;
const sessions = new Map();

function findSession(id, token) {
  const session = sessions.get(id);
  if (!session) throw new Error('IMPORT_SESSION_NOT_FOUND');
  if (session.expiresAt < Date.now()) {
    sessions.delete(id);
    throw new Error('IMPORT_SESSION_NOT_FOUND');
  }
  if (session.token !== token) throw new Error('IMPORT_SESSION_NOT_FOUND');
  return session;
}

export function createImportSession(input, callbackBase) {
  const source = parsePublicScoreUrl(input);
  const id = randomUUID();
  const token = randomBytes(24).toString('base64url');
  const session = {
    id,
    token,
    source,
    status: 'waiting',
    result: null,
    error: null,
    progress: { stage: 'session-created', details: {}, updatedAt: Date.now() },
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
  sessions.set(id, session);
  const bridge = `${callbackBase}/v1/sessions/${id}/bridge/{action}?token=${encodeURIComponent(token)}`;
  const launchUrl = new URL(source.url);
  launchUrl.hash = `noterain-import=${encodeURIComponent(bridge)}`;
  return { id, token, launchUrl: launchUrl.toString(), expiresAt: session.expiresAt };
}

export function getImportSession(id, token) {
  const session = findSession(id, token);
  return {
    status: session.status,
    result: session.result,
    error: session.error,
    progress: session.progress,
  };
}

const PROGRESS_STAGES = new Set([
  'waiting-for-score',
  'score-ready',
  'signature-ready',
  'midi-url-ready',
  'midi-ready',
  'svg-page-ready',
  'uploading-result',
]);

export function updateImportProgress(id, token, stage, details = {}) {
  const session = findSession(id, token);
  if (!PROGRESS_STAGES.has(stage)) throw new Error('INVALID_PROGRESS_STAGE');
  const safeDetails = Object.fromEntries(
    Object.entries(details)
      .filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value))
      .slice(0, 8),
  );
  session.progress = { stage, details: safeDetails, updatedAt: Date.now() };
  return session.progress;
}

export function completeImportSession(id, token, result) {
  const session = findSession(id, token);
  result = validateCollectedScore(result, session.source.scoreId);
  session.status = 'complete';
  session.result = result;
  session.progress = { stage: 'complete', details: {}, updatedAt: Date.now() };
}

export function failImportSession(id, token, error) {
  const session = findSession(id, token);
  session.status = 'failed';
  session.error = String(error || 'IMPORT_FAILED');
  session.progress = { stage: 'failed', details: {}, updatedAt: Date.now() };
}

export function verifyBridgeSession(id, token) {
  return findSession(id, token);
}