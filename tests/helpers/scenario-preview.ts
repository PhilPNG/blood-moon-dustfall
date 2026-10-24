/** Local-only fault proxy for testing the real compiled SPA. Never mounted by the app/Worker. */
import { createServer, request as upstreamRequest } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createGameServer } from '../../server/app';

const port = Number(process.env.SCENARIO_PORT || 3002);
const controlFile = process.env.SCENARIO_CONTROL_FILE || '/tmp/dustfall-bugbash-control.json';
const backend = await createGameServer({ production: true, port: 0, publicUrl: `http://localhost:${port}` });
const backendPort = await backend.listen(0, '127.0.0.1');
const counts: Record<string, number> = {};
const proxy = createServer(async (incoming, outgoing) => {
  const pathname = new URL(incoming.url || '/', 'http://localhost').pathname;
  let controls: { blockManifests?: boolean; blockAudio?: boolean; blockRpc?: boolean; blockPlayerPolls?: boolean; delayEvents?: Record<string, number> } = {};
  try { controls = JSON.parse(await readFile(controlFile, 'utf8')); } catch { /* Default: healthy network. */ }
  if (pathname === '/_qa/status') { outgoing.setHeader('Content-Type', 'application/json'); outgoing.end(JSON.stringify(counts)); return; }
  const body: Buffer[] = []; for await (const chunk of incoming) body.push(Buffer.from(chunk));
  const bytes = Buffer.concat(body);
  let event = '';
  if (pathname === '/api/rpc') { try { event = JSON.parse(bytes.toString()).event || ''; } catch { /* The real API will validate it. */ } }
  const label = event ? `rpc:${event}` : pathname;
  counts[label] = (counts[label] || 0) + 1;
  if ((controls.blockManifests && ['/media/cinematics.json', '/media/narration.json'].includes(pathname)) || (controls.blockAudio && pathname.startsWith('/media/narrator/') && pathname.endsWith('.mp3')) || (controls.blockRpc && pathname === '/api/rpc')) {
    outgoing.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    outgoing.end(JSON.stringify({ ok: false, error: 'Temporary scenario outage.', errorCode: 'TEMPORARY' })); return;
  }
  const delay = Math.max(0, Math.min(10_000, controls.delayEvents?.[event] || 0));
  const forwarded = upstreamRequest({ hostname: '127.0.0.1', port: backendPort, path: incoming.url, method: incoming.method, headers: incoming.headers }, response => {
    const chunks: Buffer[] = []; response.on('data', chunk => chunks.push(Buffer.from(chunk)));
    response.on('end', () => {
      const responseBody = Buffer.concat(chunks);
      if (controls.blockPlayerPolls && event === 'room:subscribe') {
        let isPlayer = false; try { isPlayer = !!JSON.parse(responseBody.toString()).data?.me; } catch { /* Unsuccessful API responses remain unchanged. */ }
        if (isPlayer) { outgoing.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); outgoing.end(JSON.stringify({ ok: false, error: 'Temporary player network outage.', errorCode: 'TEMPORARY' })); return; }
      }
      const send = () => { if (!outgoing.destroyed) { outgoing.writeHead(response.statusCode || 502, response.headers); outgoing.end(responseBody); } };
      if (delay) setTimeout(send, delay); else send();
    });
  });
  forwarded.on('error', () => { if (!outgoing.headersSent) outgoing.writeHead(502); outgoing.end(); });
  forwarded.end(bytes);
});
await new Promise<void>(resolve => proxy.listen(port, '127.0.0.1', resolve));
console.log(`Scenario preview: http://localhost:${port} (local-only; control file ${controlFile})`);
async function stop() { proxy.closeAllConnections(); proxy.close(); await backend.close(); process.exit(0); }
process.once('SIGINT', () => void stop()); process.once('SIGTERM', () => void stop());
