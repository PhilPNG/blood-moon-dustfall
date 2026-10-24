import test from 'node:test';
import assert from 'node:assert/strict';
import * as client from '../src/client';
import type { PairingTicket } from '../shared/types';

function browserStorage() {
  const values = new Map<string, string>();
  const access = { readsBlocked: false, writesBlocked: false, removesBlocked: false };
  const storage = {
    getItem(key: string) { if (access.readsBlocked) throw new Error('Storage blocked'); return values.get(key) ?? null; },
    setItem(key: string, value: string) { if (access.writesBlocked) throw new Error('Storage full'); values.set(key, value); },
    removeItem(key: string) { if (access.removesBlocked) throw new Error('Storage blocked'); values.delete(key); },
  } as Storage;
  return { values, access, storage };
}

function browserContext() {
  const keys = ['localStorage', 'sessionStorage', 'window', 'fetch'] as const;
  const originals = keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  const local = browserStorage(), session = browserStorage();
  const window = new EventTarget();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: local.storage });
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: session.storage });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  return { local, session, window, restore() {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  } };
}

const pairing: PairingTicket = { code: 'CASE', ticket: 'private-pairing-ticket', expiresAt: 900_000 };

test('display preparation keeps its original ticket when session storage cannot persist it', async () => {
  const browser = browserContext(); browser.session.access.writesBlocked = true;
  let preparations = 0;
  globalThis.fetch = async (_input, init) => {
    assert.equal(JSON.parse(init!.body as string).event, 'room:prepare'); preparations++;
    return Response.json({ ok: true, data: pairing });
  };
  try {
    assert.deepEqual(await client.prepareDisplayRoom(), pairing);
    assert.equal(preparations, 1);
    assert.deepEqual(client.getPairing('CASE'), pairing);
    assert.equal(browser.session.values.has('alibi:pairing:CASE'), false);
    assert.equal(client.getSession('master', 'CASE'), undefined);
  } finally { browser.restore(); }
});

test('pairing fallback tolerates a denied storage getter and survives access returning', async () => {
  const browser = browserContext();
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, get() { throw new Error('SecurityError'); } });
  globalThis.fetch = async () => Response.json({ ok: true, data: pairing });
  try {
    assert.deepEqual(await client.prepareDisplayRoom(), pairing);
    assert.deepEqual(client.getPairing('CASE'), pairing);
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: browser.session.storage });
    assert.deepEqual(client.getPairing('CASE'), pairing);
  } finally { browser.restore(); }
});

test('legacy pairing keys survive blocked reads and clearing cannot resurrect a denied removal', () => {
  const browser = browserContext();
  browser.session.values.set('alibi:pairing:CASE', JSON.stringify(pairing));
  browser.session.values.set('alibi:pairing:DUST', JSON.stringify({ ...pairing, code: 'DUST', ticket: 'other-room-ticket' }));
  try {
    assert.deepEqual(client.getPairing('CASE'), pairing);
    browser.session.access.readsBlocked = true;
    assert.deepEqual(client.getPairing('CASE'), pairing);
    browser.session.access.removesBlocked = true;
    assert.doesNotThrow(() => client.clearPairing('CASE'));
    assert.equal(client.getPairing('CASE'), undefined);
    browser.session.access.readsBlocked = false;
    assert.equal(client.getPairing('CASE'), undefined);
    assert.equal(client.getPairing('DUST')?.ticket, 'other-room-ticket');
  } finally { browser.restore(); }
});

test('memory pairing stays local to the original tab and returns copies of the ticket', async () => {
  const browser = browserContext(); browser.session.access.writesBlocked = true;
  globalThis.fetch = async () => Response.json({ ok: true, data: pairing });
  try {
    await client.prepareDisplayRoom();
    const copy = client.getPairing('CASE')!; copy.ticket = 'mutated-copy';
    assert.equal(client.getPairing('CASE')?.ticket, 'private-pairing-ticket');
    Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: browserStorage().storage });
    assert.equal(client.getPairing('CASE'), undefined);
    Object.defineProperty(globalThis, 'window', { configurable: true, value: browser.window });
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: browser.session.storage });
    assert.deepEqual(client.getPairing('CASE'), pairing);
  } finally { browser.restore(); }
});

test('a memory pairing still claims with the same ticket and receipt after an ambiguous response', async () => {
  const browser = browserContext(); browser.session.access.writesBlocked = true;
  const requests: { event: string; payload: Record<string, unknown>; requestId: string }[] = [];
  let claims = 0;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(init!.body as string); requests.push(body);
    if (body.event === 'room:prepare') return Response.json({ ok: true, data: pairing });
    claims++;
    if (claims === 1) throw new TypeError('Response lost');
    return Response.json({ ok: true, data: { code: 'CASE', token: 'phone-only-master' } });
  };
  try {
    await client.prepareDisplayRoom();
    const original = client.getPairing('CASE')!;
    assert.deepEqual(await client.claimMasterSession('CASE', { ticket: original.ticket, requestId: 'stable-pairing-receipt' }), { code: 'CASE', token: 'phone-only-master' });
    assert.deepEqual(requests.map(value => value.event), ['room:prepare', 'room:claim', 'room:claim']);
    assert.deepEqual(requests[1], requests[2]);
    assert.equal(requests[1].payload.ticket, 'private-pairing-ticket');
    assert.equal(requests[1].requestId, 'stable-pairing-receipt');
    client.clearPairing('CASE'); assert.equal(client.getPairing('CASE'), undefined);
  } finally { browser.restore(); }
});
