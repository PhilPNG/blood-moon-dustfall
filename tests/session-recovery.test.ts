import test from 'node:test';
import assert from 'node:assert/strict';
import * as client from '../src/client.js';
import type { RoomView, Session } from '../shared/types.js';

function storage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const control = { readBlocked: false, writeBlocked: false, removeBlocked: false, writes: 0 };
  const browser: Storage = {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { if (control.readBlocked) throw new Error('Storage blocked'); return values.get(key) ?? null; },
    setItem(key, value) { control.writes++; if (control.writeBlocked) throw new Error('Quota exceeded'); values.set(key, value); },
    removeItem(key) { if (control.removeBlocked) throw new Error('Storage blocked'); values.delete(key); },
    clear() { values.clear(); },
  };
  return { browser, control, values };
}

function browserContext(browser: Storage) {
  const keys = ['localStorage', 'window', 'fetch'] as const;
  const originals = keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  const events = new EventTarget();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: browser });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: events });
  return { events, restore() {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  } };
}

function room(overrides: Partial<RoomView> = {}): RoomView {
  return {
    code: 'CASE', phase: 'roles', round: 0, settings: { rounds: 3, roundSeconds: 300, maxPlayers: 20 },
    players: [{ id: 'seat-a', name: 'Alex', gender: 'any', connected: true, ready: true, roleName: 'Marshal Silas Vale' }],
    isLocked: true, timer: { endsAt: null, remaining: 0, isPaused: false }, clues: [], votesCount: 0,
    isMaster: false, ...overrides,
  };
}

test('blocked session writes preserve the active seat and only safe metadata in memory', () => {
  const saved = storage(); saved.control.writeBlocked = true;
  const context = browserContext(saved.browser);
  const session = { code: 'CASE', token: 'seat-token', playerId: 'seat-a', name: 'Alex', characterName: 'Marshal Silas Vale', recoveryCode: 'ABCD1234EFGH', updatedAt: 10,
    role: { secret: 'PRIVATE DOSSIER' }, clues: ['PRIVATE CLUE'], votedFor: 'PRIVATE VOTE' };
  try {
    assert.equal(client.saveSession('player', session), false);
    assert.deepEqual(client.getSession('player', 'CASE'), {
      code: 'CASE', token: 'seat-token', playerId: 'seat-a', name: 'Alex', characterName: 'Marshal Silas Vale', recoveryCode: 'ABCD1234EFGH', updatedAt: 10,
    });
    assert.equal(client.savedGames()[0].session.token, 'seat-token');
    assert.equal(JSON.stringify(client.savedGames()).includes('PRIVATE'), false);
  } finally { context.restore(); }
});

test('session reads and forgetting stay usable when storage access or removal fails', () => {
  const saved = storage(); const context = browserContext(saved.browser);
  try {
    client.saveSession('player', { code: 'CASE', token: 'player-old', playerId: 'seat-a' });
    client.saveSession('master', { code: 'CASE', token: 'master-keep' });
    client.saveSession('player', { code: 'DUST', token: 'other-room' });
    saved.control.readBlocked = true;
    assert.equal(client.getSession('player', 'CASE')?.token, 'player-old');
    saved.control.removeBlocked = true;
    assert.doesNotThrow(() => client.forgetSession('player', 'CASE'));
    assert.equal(client.getSession('player', 'CASE'), undefined);
    saved.control.readBlocked = false;
    assert.equal(client.getSession('player', 'CASE'), undefined, 'a failed remove must not revive stale credentials');
    assert.equal(client.getSession('master', 'CASE')?.token, 'master-keep');
    assert.equal(client.getSession('player', 'DUST')?.token, 'other-room');
    saved.values.set('alibi:player:CASE', JSON.stringify({ code: 'CASE', token: 'player-new', playerId: 'seat-a' }));
    assert.equal(client.getSession('player', 'CASE')?.token, 'player-new', 'a different tab may install rotated credentials');
  } finally { context.restore(); }
});

test('a failed credential replacement overrides old disk data but accepts a later rotation from another tab', () => {
  const saved = storage(); const context = browserContext(saved.browser);
  try {
    client.saveSession('player', { code: 'CASE', token: 'original-token', playerId: 'seat-a' });
    saved.control.writeBlocked = true;
    assert.equal(client.saveSession('player', { code: 'CASE', token: 'recovered-token', playerId: 'seat-a' }), false);
    assert.equal(client.getSession('player', 'CASE')?.token, 'recovered-token');
    saved.values.set('alibi:player:CASE', JSON.stringify({ code: 'CASE', token: 'latest-tab-token', playerId: 'seat-a' }));
    assert.equal(client.getSession('player', 'CASE')?.token, 'latest-tab-token');
  } finally { context.restore(); }
});

test('denying the storage getter preserves this visit and recovery remains usable when access returns', () => {
  const saved = storage(); const context = browserContext(saved.browser);
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('SecurityError'); } });
    assert.equal(client.saveSession('player', { code: 'CASE', token: 'memory-seat', playerId: 'seat-a' }), false);
    assert.equal(client.getSession('player', 'CASE')?.token, 'memory-seat');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: saved.browser });
    assert.equal(client.getSession('player', 'CASE')?.token, 'memory-seat');
    client.forgetSession('player', 'CASE');
    assert.equal(client.getSession('player', 'CASE'), undefined);
  } finally { context.restore(); }
});

test('recent games include legacy keys, preserve credentials beyond eight entries and isolate kinds', () => {
  const saved = storage({
    'alibi:player:OLDX': JSON.stringify({ code: 'OLDX', token: 'legacy-player', playerId: 'legacy', name: 'Legacy', updatedAt: 1 }),
    'alibi:master:OLDX': JSON.stringify({ code: 'OLDX', token: 'legacy-master', updatedAt: 2 }),
    'alibi:player:BADX': '{broken json',
  });
  const context = browserContext(saved.browser);
  try {
    assert.equal(client.savedGames().length, 2);
    for (const [index, code] of ['AAAA', 'BBBB', 'CCCC', 'DDDD', 'EEEE', 'FFFF', 'GGGG', 'HHHH', 'IIII'].entries()) {
      assert.equal(client.saveSession('player', { code, token: `token-${code}`, updatedAt: 100 + index }), true);
    }
    assert.deepEqual(client.savedGames().map(entry => entry.session.code), ['IIII', 'HHHH', 'GGGG', 'FFFF', 'EEEE', 'DDDD', 'CCCC', 'BBBB']);
    assert.equal(client.getSession('player', 'OLDX')?.token, 'legacy-player');
    assert.equal(client.getSession('master', 'OLDX')?.token, 'legacy-master');
    client.forgetSession('player', 'OLDX');
    assert.equal(client.getSession('master', 'OLDX')?.token, 'legacy-master');
    assert.equal(saved.values.get('alibi:master:OLDX')?.includes('legacy-master'), true);
  } finally { context.restore(); }
});

test('saves and forgets notify same-tab consumers without sharing credentials in the event', () => {
  const saved = storage(); const context = browserContext(saved.browser);
  const received: Event[] = [];
  context.events.addEventListener('alibi:sessions-changed', event => received.push(event));
  try {
    client.saveSession('player', { code: 'CASE', token: 'private-bearer' });
    client.forgetSession('player', 'CASE');
    assert.equal(received.length, 2);
    assert.equal(JSON.stringify(received).includes('private-bearer'), false);
  } finally { context.restore(); }
});

test('view summaries update public identity once and never cache private gameplay or stale credentials', () => {
  const saved = storage(); const context = browserContext(saved.browser);
  const original = { code: 'CASE', token: 'seat-token', playerId: 'seat-a', updatedAt: 1 };
  const view = room({
    expiresAt: 5_000_000,
    me: { playerId: 'seat-a', ready: true, role: { name: 'Marshal Silas Vale', gender: 'man', alignment: 'culprit', brief: 'PRIVATE BRIEF', objective: 'PRIVATE OBJECTIVE' }, clues: [], votedFor: 'other-seat', score: 300 },
  });
  try {
    client.saveSession('player', original);
    client.updateSessionFromView('player', original, view);
    const summary = client.getSession('player', 'CASE')!;
    assert.equal(summary.name, 'Alex'); assert.equal(summary.characterName, 'Marshal Silas Vale'); assert.equal(summary.expiresAt, 5_000_000);
    assert.ok(summary.updatedAt! > 1);
    const writes = saved.control.writes;
    client.updateSessionFromView('player', summary, { ...view, revision: 99 });
    assert.equal(saved.control.writes, writes, 'ordinary polls must not repeatedly save unchanged summaries');
    const serialized = saved.values.get('alibi:player:CASE')!;
    assert.equal(/PRIVATE|culprit|votedFor|score|clues/.test(serialized), false);
    client.saveSession('player', { ...summary, token: 'replacement-token' });
    client.updateSessionFromView('player', original, view);
    assert.equal(client.getSession('player', 'CASE')?.token, 'replacement-token');
    client.updateSessionFromView('player', client.getSession('player', 'CASE')!, room({ players: [{ id: 'seat-a', name: 'Alex', gender: 'any', connected: true, ready: false }] }));
    assert.equal(client.getSession('player', 'CASE')?.characterName, undefined, 'a reset clears the prior assigned-character summary');
  } finally { context.restore(); }
});

test('GM summaries use only the matching room public profile and preserve separate player credentials', () => {
  const saved = storage(); const context = browserContext(saved.browser);
  const master: Session = { code: 'CASE', token: 'master-token', name: 'Morgan' };
  try {
    client.saveSession('master', master);
    client.saveSession('player', { code: 'CASE', token: 'player-token', playerId: 'seat-a', name: 'Alex' });
    client.updateSessionFromView('master', master, room({ gameMaster: { id: 'gm-a', name: 'Pat', connected: true, epoch: 2 }, expiresAt: 4_000_000, isMaster: true }));
    assert.equal(client.getSession('master', 'CASE')?.name, 'Pat');
    assert.equal(client.getSession('master', 'CASE')?.expiresAt, 4_000_000);
    assert.equal(client.getSession('player', 'CASE')?.name, 'Alex');
    const writes = saved.control.writes;
    client.updateSessionFromView('master', master, room({ code: 'DUST', gameMaster: { id: 'gm-other', name: 'Wrong room', connected: true, epoch: 1 } }));
    assert.equal(saved.control.writes, writes);
  } finally { context.restore(); }
});

test('new lifecycle operations retry transient responses with one receipt and the chosen language', async () => {
  const saved = storage({ 'alibi:language': 'es' }); const context = browserContext(saved.browser);
  try {
    for (const event of ['room:recovery', 'room:recover', 'room:leave', 'room:gm-profile', 'room:gm-offer', 'room:gm-accept', 'room:gm-takeover']) {
      const bodies: Record<string, unknown>[] = [];
      globalThis.fetch = async (_input, init) => {
        bodies.push(JSON.parse(init!.body as string));
        return bodies.length === 1 ? Response.json({ ok: false, error: 'Busy', errorCode: 'BUSY' }, { status: 503 }) : Response.json({ ok: true, data: { accepted: true } });
      };
      assert.deepEqual(await client.request(event, { code: 'CASE', token: 'private' }), { accepted: true });
      assert.equal(bodies.length, 2); assert.deepEqual(bodies[0], bodies[1]);
      assert.equal((bodies[0].payload as Record<string, unknown>).language, 'es');
      assert.equal(typeof bodies[0].requestId, 'string');
    }
  } finally { context.restore(); }
});

test('recovering a replacement phone returns and saves its session even when persistence is blocked', async () => {
  const saved = storage(); saved.control.writeBlocked = true;
  const context = browserContext(saved.browser);
  const recovered = { code: 'CASE', token: 'rotated-token', playerId: 'seat-a', recoveryCode: 'NEWT1234ABCD', name: 'Alex' };
  const bodies: { event: string; payload: Record<string, unknown> }[] = [];
  globalThis.fetch = async (_input, init) => { bodies.push(JSON.parse(init!.body as string)); return Response.json({ ok: true, data: recovered }); };
  try {
    assert.deepEqual(await client.recoverSession('CASE', 'player', 'OLDT-1234-ABCD'), recovered);
    assert.equal(client.getSession('player', 'CASE')?.token, 'rotated-token');
    assert.equal(bodies.length, 1);
    assert.deepEqual(bodies[0], { event: 'room:recover', payload: { language: 'en', code: 'CASE', kind: 'player', recoveryCode: 'OLDT-1234-ABCD' }, requestId: (bodies[0] as { requestId?: string }).requestId });
  } finally { context.restore(); }
});

test('phone creation accepts a GM name and does not repeat room creation when session storage is full', async () => {
  const saved = storage(); saved.control.writeBlocked = true;
  const context = browserContext(saved.browser);
  const bodies: { event: string; payload: Record<string, unknown> }[] = [];
  globalThis.fetch = async (_input, init) => { bodies.push(JSON.parse(init!.body as string)); return Response.json({ ok: true, data: { code: 'CASE', token: 'new-master', name: 'Morgan' } }); };
  try {
    const created = await client.createPhoneRoom(false, 'Morgan');
    assert.equal(created.token, 'new-master');
    assert.equal(client.getSession('master', 'CASE')?.token, 'new-master');
    assert.equal(bodies.length, 1); assert.equal(bodies[0].payload.name, 'Morgan');
  } finally { context.restore(); }
});

test('terminal validation forgets only the rejected GM even when browser removal is denied', async () => {
  const saved = storage(); const context = browserContext(saved.browser);
  try {
    client.saveSession('master', { code: 'CASE', token: 'rejected-master' });
    client.saveSession('player', { code: 'CASE', token: 'saved-player', playerId: 'seat-a' });
    saved.control.removeBlocked = true;
    globalThis.fetch = async () => Response.json({ ok: false, error: 'Invalid session token.', errorCode: 'SESSION_INVALID' }, { status: 400 });
    await assert.rejects(client.claimMasterSession('CASE'), cause => cause instanceof client.RpcError && cause.terminal);
    assert.equal(client.getSession('master', 'CASE'), undefined);
    assert.equal(client.getSession('player', 'CASE')?.token, 'saved-player');
  } finally { context.restore(); }
});

test('a delayed terminal GM validation cannot erase a newer session saved by another tab', async () => {
  const saved = storage(); const context = browserContext(saved.browser);
  const requests: { event: string; payload: { token?: string } }[] = [];
  let finishOld!: (response: Response) => void;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(init!.body as string); requests.push(body);
    if (requests.length === 1) return new Promise<Response>(resolve => { finishOld = resolve; });
    return Response.json({ ok: true, data: body.event === 'room:claim' ? { code: 'CASE', token: 'unwanted-claim' } : { code: 'CASE', isMaster: true } });
  };
  try {
    client.saveSession('master', { code: 'CASE', token: 'old-master' });
    const validation = client.claimMasterSession('CASE', { ticket: 'old-ticket', requestId: 'old-claim' });
    client.saveSession('master', { code: 'CASE', token: 'new-master', name: 'Pat' });
    finishOld(Response.json({ ok: false, error: 'Invalid session token.', errorCode: 'SESSION_INVALID' }, { status: 400 }));
    assert.deepEqual(await validation, { code: 'CASE', token: 'new-master', name: 'Pat' });
    assert.equal(client.getSession('master', 'CASE')?.token, 'new-master');
    assert.deepEqual(requests.map(value => value.event), ['room:subscribe', 'room:subscribe']);
    assert.equal(requests[1].payload.token, 'new-master');
  } finally { context.restore(); }
});

test('an initial pairing response cannot overwrite a newer master installed while claiming', async () => {
  const saved = storage(); const context = browserContext(saved.browser);
  const requests: { event: string; payload: { token?: string } }[] = [];
  let finishClaim!: (response: Response) => void;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(init!.body as string); requests.push(body);
    if (requests.length === 1) return new Promise<Response>(resolve => { finishClaim = resolve; });
    return Response.json({ ok: true, data: { code: 'CASE', isMaster: true } });
  };
  try {
    const claim = client.claimMasterSession('CASE', { ticket: 'original-ticket', requestId: 'original-claim-receipt' });
    client.saveSession('master', { code: 'CASE', token: 'current-master', name: 'Pat', recoveryRevision: 2 });
    finishClaim(Response.json({ ok: true, data: { code: 'CASE', token: 'obsolete-claim-result', recoveryRevision: 1 } }));
    assert.deepEqual(await claim, { code: 'CASE', token: 'current-master', name: 'Pat', recoveryRevision: 2 });
    assert.equal(client.getSession('master', 'CASE')?.token, 'current-master');
    assert.deepEqual(requests.map(value => value.event), ['room:claim', 'room:subscribe']);
    assert.equal(requests[1].payload.token, 'current-master');
  } finally { context.restore(); }
});

test('continuous cross-tab master changes stop validation after a bounded retry without forgetting the latest session', async () => {
  const saved = storage(); const context = browserContext(saved.browser);
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls <= 4) client.saveSession('master', { code: 'CASE', token: `changed-master-${calls}` });
    return Response.json({ ok: true, data: { code: 'CASE', isMaster: true } });
  };
  try {
    client.saveSession('master', { code: 'CASE', token: 'initial-master' });
    await assert.rejects(client.claimMasterSession('CASE'), cause => cause instanceof client.RpcError && cause.network && !cause.terminal);
    assert.equal(calls, 4);
    assert.equal(client.getSession('master', 'CASE')?.token, 'changed-master-4');
  } finally { context.restore(); }
});

test('older same-bearer code responses cannot replace the newest private recovery code', () => {
  const saved = storage(); const context = browserContext(saved.browser);
  try {
    client.saveSession('player', { code: 'CASE', token: 'same-bearer', playerId: 'seat-a', recoveryCode: 'NEWESTCODEAB', recoveryRevision: 2 });
    client.saveSession('player', { code: 'CASE', token: 'same-bearer', playerId: 'seat-a', recoveryCode: 'OLDERACODEAB', recoveryRevision: 1 });
    assert.equal(client.getSession('player', 'CASE')?.recoveryCode, 'NEWESTCODEAB');
    assert.equal(client.getSession('player', 'CASE')?.recoveryRevision, 2);
    client.saveSession('player', { code: 'CASE', token: 'same-bearer', playerId: 'seat-a', name: 'Alex', recoveryCode: 'LEGACYCODEAB' });
    assert.equal(client.getSession('player', 'CASE')?.recoveryCode, 'NEWESTCODEAB');
    assert.equal(client.getSession('player', 'CASE')?.recoveryRevision, 2);
  } finally { context.restore(); }
});

test('a pending memory code accepts a newer same-bearer code persisted by another tab', () => {
  const saved = storage(); const context = browserContext(saved.browser);
  try {
    client.saveSession('player', { code: 'CASE', token: 'same-bearer', playerId: 'seat-a', recoveryCode: 'FIRSTCODEABC', recoveryRevision: 1 });
    saved.control.writeBlocked = true;
    client.saveSession('player', { code: 'CASE', token: 'same-bearer', playerId: 'seat-a', recoveryCode: 'MEMORYCODEAB', recoveryRevision: 2 });
    assert.equal(client.getSession('player', 'CASE')?.recoveryRevision, 2);
    saved.values.set('alibi:player:CASE', JSON.stringify({ code: 'CASE', token: 'same-bearer', playerId: 'seat-a', recoveryCode: 'LATESTCODEAB', recoveryRevision: 3 }));
    assert.equal(client.getSession('player', 'CASE')?.recoveryCode, 'LATESTCODEAB');
    assert.equal(client.getSession('player', 'CASE')?.recoveryRevision, 3);
  } finally { context.restore(); }
});

test('an older cross-tab storage write cannot downgrade an already observed recovery code', () => {
  const saved = storage(); const context = browserContext(saved.browser);
  try {
    client.saveSession('player', { code: 'CASE', token: 'same-bearer', playerId: 'seat-a', name: 'Alex', recoveryCode: 'LATESTCODEAB', recoveryRevision: 3 });
    saved.values.set('alibi:player:CASE', JSON.stringify({ code: 'CASE', token: 'same-bearer', playerId: 'seat-a', name: 'Alex', recoveryCode: 'OLDERCODEABC', recoveryRevision: 2 }));
    assert.equal(client.getSession('player', 'CASE')?.recoveryCode, 'LATESTCODEAB');
    assert.equal(client.getSession('player', 'CASE')?.recoveryRevision, 3);
  } finally { context.restore(); }
});
