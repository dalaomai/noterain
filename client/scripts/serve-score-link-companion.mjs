import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const port = Number(process.env.COMPANION_PORT || 5174);
const scriptUrl = new URL('../public/score-link-companion.user.js', import.meta.url);

createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  if (request.method === 'OPTIONS') {
    response.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS' });
    response.end();
    return;
  }
  if (url.pathname !== '/score-link-companion.user.js') {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }
  try {
    const script = await readFile(scriptUrl);
    response.writeHead(200, {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Content-Disposition': 'inline; filename=score-link-companion.user.js',
      'Content-Length': script.byteLength,
    });
    if (request.method === 'HEAD') response.end();
    else response.end(script);
  } catch (error) {
    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(String(error));
  }
}).listen(port, '0.0.0.0', () => {
  console.log(`Companion installer: http://localhost:${port}/score-link-companion.user.js`);
});
