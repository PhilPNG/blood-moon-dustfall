import express from 'express';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { resolve } from 'node:path';
import { Server } from 'socket.io';
import type { ViteDevServer } from 'vite';
import type { Reply } from '../shared/types.js';
import { GameEngine } from './engine.js';
import { OnlineGameService } from '../online/service.js';
import { MemoryRoomRepository } from '../online/repository.js';
import { executeRpc } from '../online/rpc.js';

export interface ServerOptions {
  engine?: GameEngine;
  production?: boolean;
  publicUrl?: string;
  port?: number;
  vite?: false;
}
type Subscription = { code: string; token?: string };
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : 'The request could not be completed.'; }
function dataObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid request.');
  return value as Record<string, unknown>;
}
function externalOrigin(value: string): string {
  if (!value) return '';
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('PUBLIC_URL must be an HTTP or HTTPS origin.');
  return url.origin;
}
function lanAddress(): string {
  for (const addresses of Object.values(networkInterfaces())) for (const address of addresses ?? []) {
    if (!address.internal && address.family === 'IPv4' && !address.address.startsWith('169.254.')) return address.address;
  }
  return 'localhost';
}

export async function createGameServer(options: ServerOptions = {}) {
  const engine = options.engine ?? new GameEngine();
  const app = express();
  app.disable('x-powered-by');
  const online = new OnlineGameService({ repository:new MemoryRoomRepository() });
  app.get('/api/health',(_request,response)=>response.json({ok:true,service:'alibi'}));
  app.post('/api/rpc',
    (request,response,next)=>{
      if(!request.is('application/json')){response.status(415).json({ok:false,error:'Use a JSON request.'});return;}
      next();
    },
    express.json({limit:'16kb'}),
    async(request,response)=>{
      response.setHeader('Cache-Control','no-store');
      response.setHeader('Referrer-Policy','no-referrer');
      const reply=await executeRpc(online,request.body);
      response.status(reply.ok?200:['TEMPORARY','BUSY'].includes(reply.errorCode||'')?503:400).json(reply);
    });
  app.use((error:unknown,_request:express.Request,response:express.Response,next:express.NextFunction)=>{
    if(!error)return next();
    response.status(400).json({ok:false,error:'Invalid or oversized JSON request.'});
  });
  const httpServer = createServer(app);
  const io = new Server(httpServer, { serveClient: false, maxHttpBufferSize: 16 * 1024 });
  const subscriptions = new Map<string, Subscription>();
  const publicOrigin = externalOrigin(options.publicUrl ?? process.env.PUBLIC_URL ?? '');
  const defaultPort = options.port ?? (process.env.PORT ? Number(process.env.PORT) : 3000);
  if (!Number.isInteger(defaultPort) || defaultPort < 0 || defaultPort > 65535) throw new Error('PORT must be a whole number from 0 to 65535.');

  app.get('/api/config', (_request, response) => {
    const address = httpServer.address();
    const port = address && typeof address === 'object' ? address.port : defaultPort;
    response.setHeader('Cache-Control', 'no-store');
    response.json({ joinOrigin: publicOrigin || `http://${lanAddress()}:${port}` });
  });

  function broadcast(code: string): void {
    for (const [id, session] of subscriptions) {
      if (session.code !== code) continue;
      const socket = io.sockets.sockets.get(id);
      if (!socket) { subscriptions.delete(id); engine.disconnect(id); continue; }
      try { socket.emit('room:state', engine.view(session.code, session.token)); }
      catch (error) {
        subscriptions.delete(id);
        engine.disconnect(id);
        socket.emit('room:error', { error: errorMessage(error) });
      }
    }
  }

  io.on('connection', socket => {
    function handle(event: string, operation: (payload: unknown) => unknown): void {
      socket.on(event, (payload: unknown, acknowledgement?: (reply: Reply<unknown>) => void) => {
        if (typeof payload === 'function' && acknowledgement === undefined) {
          acknowledgement = payload as (reply: Reply<unknown>) => void;
          payload = undefined;
        }
        let reply: Reply<unknown>;
        try {
          for (const code of engine.sweep()) broadcast(code);
          const result = operation(payload);
          reply = result === undefined ? { ok: true } : { ok: true, data: result };
        } catch (error) { reply = { ok: false, error: errorMessage(error) }; }
        if (typeof acknowledgement === 'function') acknowledgement(reply);
      });
    }
    handle('room:create', payload => engine.create(payload));
    handle('room:join', payload => {
      const session = engine.join(payload);
      broadcast(session.code);
      return session;
    });
    handle('room:subscribe', payload => {
      const data = dataObject(payload);
      const view = engine.view(data.code, data.token);
      const previousCode = subscriptions.get(socket.id)?.code;
      engine.connect(view.code, data.token, socket.id);
      subscriptions.set(socket.id, { code: view.code, ...(typeof data.token === 'string' ? { token: data.token } : {}) });
      if (previousCode && previousCode !== view.code) broadcast(previousCode);
      broadcast(view.code);
      return engine.view(view.code, data.token);
    });
    handle('room:unsubscribe', () => {
      const code = engine.disconnect(socket.id) ?? subscriptions.get(socket.id)?.code;
      subscriptions.delete(socket.id);
      if (code) broadcast(code);
    });
    handle('room:command', payload => {
      const data = dataObject(payload);
      engine.command(data.code, data.token, data.action);
      broadcast(engine.view(data.code).code);
    });
    handle('room:display-claim', payload => {
      const data = dataObject(payload);
      return engine.claimDisplay(data.code, data.displayId, data.token);
    });
    handle('room:playback', payload => {
      const data = dataObject(payload);
      engine.reportPlayback(data.code, data.displayId, data.token, data.playback, data.sequence);
      broadcast(engine.view(data.code).code);
      return { accepted: true };
    });
    handle('room:attention', payload => {
      const data = dataObject(payload);
      if (Object.keys(data).some(key => !['code', 'displayId', 'token', 'eventKey', 'cue', 'context', 'presentationSerial', 'clueId'].includes(key))) throw new Error('Invalid attention request.');
      const { code, displayId, token, ...cue } = data;
      const result = engine.claimAttention(code, displayId, token, cue);
      broadcast(engine.view(code).code);
      return result;
    });
    socket.on('disconnect', () => {
      const code = engine.disconnect(socket.id);
      subscriptions.delete(socket.id);
      if (code) broadcast(code);
    });
  });

  // Fixed lifetimes and a room limit bound the state retained by a persistent host.
  const sweepInterval = setInterval(() => {
    for (const code of engine.sweep()) broadcast(code);
  }, 30_000);
  sweepInterval.unref();

  let vite: ViteDevServer | undefined;
  const production = options.production ?? process.env.NODE_ENV === 'production';
  if (production) {
    const dist = resolve(process.cwd(), '.web-dist');
    app.use(express.static(dist));
    app.get('/{*path}', (request, response, next) => {
      if (request.path === '/api' || request.path.startsWith('/api/')) return next();
      // Keep the hidden build directory in root so sendFile's dotfile guard
      // evaluates index.html rather than rejecting the absolute .web-dist path.
      response.sendFile('index.html', { root: dist });
    });
  } else if (options.vite !== false) {
    const { createServer: createViteServer } = await import('vite');
    vite = await createViteServer({ server: { middlewareMode: true, hmr: { server: httpServer } }, appType: 'spa' });
    app.use(vite.middlewares);
  }

  return {
    app, io, httpServer, engine,
    listen(port = defaultPort, host = '0.0.0.0'): Promise<number> {
      return new Promise((resolvePort, reject) => {
        const fail = (error: Error) => reject(error);
        httpServer.once('error', fail);
        httpServer.listen(port, host, () => {
          httpServer.off('error', fail);
          const address = httpServer.address();
          resolvePort(typeof address === 'object' && address ? address.port : port);
        });
      });
    },
    async close(): Promise<void> {
      clearInterval(sweepInterval);
      subscriptions.clear();
      await vite?.close();
      await new Promise<void>(resolveClose => io.close(() => resolveClose()));
    },
  };
}
