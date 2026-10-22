import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  completeImportSession,
  createImportSession,
  failImportSession,
  getImportSession,
  updateImportProgress,
  verifyBridgeSession,
} from './sessions.js';

const PORT = Number(process.env.PORT || 8787);
const MAX_REQUEST_BYTES = 8 * 1024;
const MAX_RESULT_BYTES = 40 * 1024 * 1024;
const companionPath = fileURLToPath(
  new URL('../public/score-link-companion.user.js', import.meta.url),
);

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(payload));
}

function applyCompanionCors(request, response) {
  const origin = request.headers.origin;
  if (origin === 'https://musescore.com' || origin === 'https://s.musescore.com') {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (request.headers['access-control-request-private-network'] === 'true') {
      response.setHeader('Access-Control-Allow-Private-Network', 'true');
    }
  }
}

async function readJson(request, maxBytes = MAX_REQUEST_BYTES) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('REQUEST_TOO_LARGE');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function route(url, pattern) {
  return url.pathname.match(pattern);
}

function publicBase(request) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const protocol = request.headers['x-forwarded-proto'] || 'http';
  return `${protocol}://${request.headers.host}/api/score-link`;
}

function logSession(event, id, details = {}) {
  console.info('[score-link-importer]', event, { sessionId: id, ...details });
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  applyCompanionCors(request, response);
  if (request.method === 'OPTIONS') {
    response.writeHead(204, { 'Cache-Control': 'no-store' });
    return response.end();
  }
  if (request.method === 'GET' && url.pathname === '/health') {
    return sendJson(response, 200, { ok: true });
  }
  if (request.method === 'GET' && url.pathname === '/v1/companion.user.js') {
    const script = await readFile(companionPath, 'utf8');
    response.writeHead(200, {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Content-Disposition': 'inline; filename="score-link-companion.user.js"',
      'Cache-Control': 'no-cache',
    });
    return response.end(script);
  }
  try {
    if (request.method === 'POST' && url.pathname === '/v1/sessions') {
      const body = await readJson(request);
      const session = createImportSession(body?.url, publicBase(request));
      logSession('session-created', session.id);
      return sendJson(response, 201, session);
    }
    const sessionMatch = route(url, /^\/v1\/sessions\/([^/]+)$/);
    if (request.method === 'GET' && sessionMatch) {
      return sendJson(response, 200, getImportSession(sessionMatch[1], url.searchParams.get('token')));
    }
    const bridgeMatch = route(url, /^\/v1\/sessions\/([^/]+)\/bridge\/(progress|sign|complete|fail)$/);
    if (request.method === 'POST' && bridgeMatch) {
      const id = bridgeMatch[1];
      const action = bridgeMatch[2];
      const token = url.searchParams.get('token');
      const session = verifyBridgeSession(id, token);
      const body = await readJson(request, action === 'complete' ? MAX_RESULT_BYTES : MAX_REQUEST_BYTES);
      if (action === 'progress') {
        const progress = updateImportProgress(id, token, body?.stage, body?.details);
        logSession('progress', id, { stage: progress.stage, ...progress.details });
        return sendJson(response, 200, { ok: true });
      }
      if (action === 'sign') {
        const validTypeAndIndex =
          (body.type === 'midi' && body.index === 0) ||
          (body.type === 'img' && Number.isInteger(body.index) && body.index >= 1 && body.index < 100);
        if (!validTypeAndIndex || body.scoreId !== session.source.scoreId || typeof body.suffix !== 'string' || body.suffix.length > 128) {
          throw new Error('INVALID_SIGN_REQUEST');
        }
        const authorization = createHash('md5')
          .update(`${body.scoreId}${body.type}${body.index}${body.suffix}`)
          .digest('hex')
          .slice(0, 4);
        logSession('signature-issued', id, { scoreId: body.scoreId, type: body.type, index: body.index });
        return sendJson(response, 200, { authorization });
      }
      if (action === 'complete') {
        completeImportSession(id, token, body);
        logSession('complete', id, { pageCount: body?.pages?.length });
      } else {
        failImportSession(id, token, body?.error);
        logSession('failed', id, { error: String(body?.error || 'IMPORT_FAILED') });
      }
      return sendJson(response, 200, { ok: true });
    }
    return sendJson(response, 404, { error: 'NOT_FOUND' });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'IMPORT_FAILED';
    const clientError = /^(INVALID_|SOURCE_|REQUEST_|IMPORT_SESSION_|SCORE_ID_)/.test(code);
    console.error('[score-link-importer]', code);
    sendJson(response, clientError ? 400 : 500, { error: code });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Score link importer listening on http://0.0.0.0:${PORT}`);
});