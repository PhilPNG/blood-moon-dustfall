import test from 'node:test';
import assert from 'node:assert/strict';
import { closePresence } from '../src/presence';

function replaceNavigator(t: import('node:test').TestContext, value: Navigator) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value });
  t.after(() => { if (original) Object.defineProperty(globalThis, 'navigator', original); else Reflect.deleteProperty(globalThis, 'navigator'); });
}

test('closing a tab sends only its authenticated presence slot using a beacon', async t => {
  const messages: { url: string; body: Blob }[] = [];
  replaceNavigator(t, { sendBeacon: (url: string, body: Blob) => { messages.push({ url, body }); return true; } } as unknown as Navigator);
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw Error('Beacon should be enough'); });
  closePresence({ code: 'CASE', token: 'private-token', clientId: 'one-tab' });
  assert.equal(messages.length, 1); assert.equal(messages[0].url, '/api/rpc');
  const input = JSON.parse(await messages[0].body.text());
  assert.deepEqual(input.payload, { code: 'CASE', token: 'private-token', clientId: 'one-tab' });
  assert.equal(input.event, 'room:unsubscribe'); assert.equal(typeof input.requestId, 'string');
  assert.equal(fetch.mock.callCount(), 0);
});

test('a refused or unavailable beacon uses a nonblocking keepalive request', async t => {
  replaceNavigator(t, { sendBeacon: () => false } as unknown as unknown as Navigator);
  const calls: RequestInit[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string | URL | Request, init?: RequestInit) => { calls.push(init!); return new Response('{}'); });
  closePresence({ code: 'CASE', token: 'private-token', clientId: 'other-tab' });
  assert.equal(calls.length, 1); assert.equal(calls[0].keepalive, true);
  assert.equal(calls[0].method, 'POST'); assert.deepEqual(JSON.parse(calls[0].body as string).payload, { code: 'CASE', token: 'private-token', clientId: 'other-tab' });
});
