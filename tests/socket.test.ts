import test from 'node:test';
import assert from 'node:assert/strict';
import { io, type Socket } from 'socket.io-client';
import { createGameServer } from '../server/app.js';
import type { Reply, RoomView, Session } from '../shared/types.js';
import { GameEngine } from '../server/engine.js';
import { attentionEventKey } from '../shared/attention.js';

type Fixture = Awaited<ReturnType<typeof fixture>>;
async function fixture(options: Parameters<typeof createGameServer>[0] = {}) {
  const server = await createGameServer({ ...options, vite: false });
  const port = await server.listen(0, '127.0.0.1');
  const url = `http://127.0.0.1:${port}`;
  const clients: Socket[] = [];
  return { server, url, async client() {
    const socket = io(url, { transports: ['websocket'], forceNew: true });
    clients.push(socket);
    await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
    return socket;
  }, async close() { clients.forEach(socket => socket.disconnect()); await server.close(); } };
}
function request<T>(socket: Socket, event: string, payload: unknown): Promise<Reply<T>> {
  return new Promise((resolve, reject) => socket.timeout(2000).emit(event, payload, (error: Error | null, reply: Reply<T>) => error ? reject(error) : resolve(reply)));
}
function next<T>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, onEvent); reject(new Error(`No ${event} received`)); }, 2000);
    function onEvent(value: T) { clearTimeout(timer); resolve(value); }
    socket.once(event, onEvent);
  });
}
async function create(f: Fixture) {
  const host = await f.client();
  const result = await request<Session>(host, 'room:create', {});
  assert.equal(result.ok, true);
  assert.ok(result.data);
  return { host, master: result.data };
}

test('real sockets claim and broadcast the same scoped audience cue without exposing display authority', async () => {
  let now = 100_000;
  const f = await fixture({ engine: new GameEngine({ now: () => now }) });
  try {
    const { host, master } = await create(f);
    const display = await f.client();
    const publicView = await request<RoomView>(display, 'room:subscribe', { code: master.code });
    const cap = await request<{ token: string }>(display, 'room:display-claim', { code: master.code, displayId: 'socket-attention' });
    const payload = { code: master.code, displayId: 'socket-attention', token: cap.data!.token, cue: 'lobby', eventKey: attentionEventKey(publicView.data!) };
    const update = next<RoomView>(display, 'room:state');
    const reply = await request<{ attention: NonNullable<RoomView['attention']>; serverNow: number }>(display, 'room:attention', payload);
    assert.equal(reply.ok, true);
    assert.equal(reply.data?.attention.endsAt, 110_000);
    assert.equal(reply.data?.serverNow, 100_000);
    const state = await update;
    assert.deepEqual(state.attention, reply.data?.attention);
    assert.equal(JSON.stringify(state).includes(cap.data!.token), false);
    const repeated = await request<{ attention: unknown }>(display, 'room:attention', payload);
    assert.deepEqual(repeated.data?.attention, reply.data?.attention);
    const before = f.server.engine.exportRoom(master.code);
    const forged = await request(display, 'room:attention', { ...payload, token: master.token });
    assert.equal(forged.ok, false);
    assert.deepEqual(f.server.engine.exportRoom(master.code), before);
    now = 110_000;
    await request(display, 'room:display-claim', { code: master.code, displayId: 'socket-attention', token: cap.data!.token });
    const completed = await request<{ attention: unknown }>(display, 'room:attention', payload);
    assert.deepEqual(completed.data?.attention, reply.data?.attention);
  } finally { await f.close(); }
});

test('real socket creates, joins and subscribes with contract acknowledgements and public privacy', async () => {
  const f = await fixture();
  try {
    const { host, master } = await create(f);
    const phone = await f.client();
    const display = await f.client();
    const joined = await request<Session>(phone, 'room:join', { code: master.code, name: 'Alex', gender: 'nonbinary' });
    assert.equal(joined.ok, true);
    const session = joined.data!;
    const hostState = next<RoomView>(host, 'room:state');
    const subscription = await request<RoomView>(host, 'room:subscribe', master);
    assert.equal(subscription.data?.isMaster, true);
    assert.equal((await hostState).code, master.code);
    const phoneState = next<RoomView>(phone, 'room:state');
    const subscribed = await request<RoomView>(phone, 'room:subscribe', session);
    assert.equal(subscribed.data?.me?.playerId, session.playerId);
    assert.equal((await phoneState).players[0].connected, true);
    const publicReply = await request<RoomView>(display, 'room:subscribe', { code: master.code });
    assert.equal(publicReply.data?.me, undefined);
    assert.equal(publicReply.data?.isMaster, false);
    assert.equal(JSON.stringify(publicReply).includes(master.token), false);
    assert.equal(JSON.stringify(publicReply).includes(session.token), false);
    const update = next<RoomView>(display, 'room:state');
    const command = await request(host, 'room:command', { ...master, action: { type: 'lock', locked: true } });
    assert.deepEqual(command, { ok: true });
    assert.equal((await update).isLocked, true);
  } finally { await f.close(); }
});

test('real sockets reject malformed and forged requests while leaving room state intact', async () => {
  const f = await fixture();
  try {
    const { host, master } = await create(f);
    for (const [event, payload] of [['room:create', null], ['room:join', null], ['room:subscribe', null], ['room:command', null], ['room:command', { ...master, action: null }], ['room:subscribe', { code: master.code, token: 'forged' }], ['room:command', { code: master.code, token: 'forged', action: { type: 'demo-fill' } }]] as const) {
      const reply = await request(host, event, payload);
      assert.equal(reply.ok, false);
      assert.equal(typeof reply.error, 'string');
      assert.equal(reply.data, undefined);
    }
    host.emit('room:command', null);
    const view = await request<RoomView>(host, 'room:subscribe', master);
    assert.equal(view.ok, true);
    assert.equal(view.data?.players.length, 0);
    assert.equal(view.data?.phase, 'lobby');
  } finally { await f.close(); }
});

test('same token reconnects after start and all player states retain only their own private role', async () => {
  const f = await fixture();
  try {
    const { host, master } = await create(f);
    const phones = await Promise.all(Array.from({ length: 4 }, () => f.client()));
    const sessions: Session[] = [];
    for (const [i, phone] of phones.entries()) {
      const joined = await request<Session>(phone, 'room:join', { code: master.code, name: `Player ${i + 1}`, gender: 'any' });
      sessions.push(joined.data!);
      await request(phone, 'room:subscribe', joined.data!);
    }
    const display = await f.client();
    await request(display, 'room:subscribe', { code: master.code });
    const publicUpdate = next<RoomView>(display, 'room:state');
    const start = await request(host, 'room:command', { ...master, action: { type: 'start' } });
    assert.equal(start.ok, true);
    assert.equal(JSON.stringify(await publicUpdate).includes('alignment'), false);
    const first = await request<RoomView>(phones[0], 'room:subscribe', sessions[0]);
    assert.ok(first.data?.me?.role);
    assert.equal(first.data?.players.length, 4);
    phones[0].disconnect();
    const newPhone = await f.client();
    const restored = await request<RoomView>(newPhone, 'room:subscribe', sessions[0]);
    assert.deepEqual(restored.data?.me?.role, first.data?.me?.role);
    assert.equal(restored.data?.me?.playerId, sessions[0].playerId);
    assert.equal(restored.data?.players.length, 4);
    assert.equal(restored.data?.players[0].connected, true);
    const joinAfterStart = await request(host, 'room:join', { code: master.code, name: 'Late', gender: 'any' });
    assert.equal(joinAfterStart.ok, false);
  } finally { await f.close(); }
});

test('kick revokes an existing socket subscription and token', async () => {
  const f = await fixture();
  try {
    const { host, master } = await create(f);
    const phone = await f.client();
    const joined = await request<Session>(phone, 'room:join', { code: master.code, name: 'Alex', gender: 'any' });
    await request(phone, 'room:subscribe', joined.data!);
    const removed = next<{ error: string }>(phone, 'room:error');
    const response = await request(host, 'room:command', { ...master, action: { type: 'kick', playerId: joined.data!.playerId } });
    assert.equal(response.ok, true);
    assert.equal(typeof (await removed).error, 'string');
    const states: RoomView[] = [];
    phone.on('room:state', state => states.push(state));
    await request(host, 'room:command', { ...master, action: { type: 'lock', locked: true } });
    assert.deepEqual(states, []);
    const retry = await request(phone, 'room:subscribe', joined.data!);
    assert.equal(retry.ok, false);
  } finally { await f.close(); }
});

test('config returns reachable LAN port and honors explicit public origin', async () => {
  const f = await fixture({ publicUrl: 'https://party.example.test/' });
  try {
    const response = await fetch(`${f.url}/api/config`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { joinOrigin: 'https://party.example.test' });
  } finally { await f.close(); }
  const local = await fixture({ publicUrl: '' });
  try {
    const response = await fetch(`${local.url}/api/config`);
    const config = await response.json() as { joinOrigin: string };
    assert.equal(new URL(config.joinOrigin).port, new URL(local.url).port);
    assert.equal(new URL(config.joinOrigin).protocol, 'http:');
  } finally { await local.close(); }
});

test('a request noticing expiry revokes every expired subscription promptly', async () => {
  let now = 0;
  const { GameEngine } = await import('../server/engine.js');
  const f = await fixture({ engine: new GameEngine({ now: () => now }) });
  try {
    const { host, master } = await create(f);
    const display = await f.client();
    await request(display, 'room:subscribe', { code: master.code });
    now = 12 * 60 * 60 * 1000;
    const removed = next<{ error: string }>(display, 'room:error');
    const result = await request(host, 'room:create', {});
    assert.equal(result.ok, true);
    assert.match((await removed).error, /expired|found/i);
  } finally { await f.close(); }
});

test('unsubscribe removes presence and private broadcasts while preserving the reconnectable seat', async () => {
  const f = await fixture();
  try {
    const { host, master } = await create(f);
    await request(host, 'room:subscribe', master);
    const phone = await f.client();
    const joined = await request<Session>(phone, 'room:join', { code: master.code, name: 'Alex', gender: 'any' });
    await request(phone, 'room:subscribe', joined.data!);
    const disconnected = next<RoomView>(host, 'room:state');
    const reply = await request(phone, 'room:unsubscribe', {});
    assert.deepEqual(reply, { ok: true });
    assert.equal((await disconnected).players[0].connected, false);
    const states: RoomView[] = [];
    phone.on('room:state', state => states.push(state));
    // The state and acknowledgement share a socket, so all earlier state frames
    // have arrived when this acknowledgement is received.
    await request(phone, 'room:command', { ...master, action: { type: 'lock', locked: true } });
    assert.deepEqual(states, []);
    const restored = await request<RoomView>(phone, 'room:subscribe', joined.data!);
    assert.equal(restored.data?.me?.playerId, joined.data!.playerId);
    assert.equal(restored.data?.players.length, 1);
    assert.equal(restored.data?.players[0].connected, true);
  } finally { await f.close(); }
});

test('unsubscribe accepts an omitted payload and is idempotent', async () => {
  const f = await fixture();
  try {
    const socket = await f.client();
    const reply = await new Promise<Reply>((resolve, reject) => {
      socket.timeout(2000).emit('room:unsubscribe', (error: Error | null, value: Reply) => error ? reject(error) : resolve(value));
    });
    assert.deepEqual(reply, { ok: true });
    assert.deepEqual(await request(socket, 'room:unsubscribe', {}), { ok: true });
  } finally { await f.close(); }
});
