import test from 'node:test';
import assert from 'node:assert/strict';
import * as client from '../src/client.js';
import { OnlineGameService } from '../online/service.js';
import { MemoryRoomRepository } from '../online/repository.js';
import { executeRpc } from '../online/rpc.js';
import type { Session, RoomView } from '../shared/types.js';

function browserContext() {
  const values = new Map<string, string>();
  const storage: Storage = {
    get length() { return values.size; }, key: index => [...values.keys()][index] ?? null,
    getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); },
    removeItem: key => { values.delete(key); }, clear: () => values.clear(),
  };
  const keys = ['localStorage', 'window', 'fetch'] as const;
  const originals = keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });
  return { values, restore() {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  } };
}
function party() {
  let now = 100_000;
  const service = new OnlineGameService({ repository: new MemoryRoomRepository(), now: () => now });
  return { service, advance: (milliseconds: number) => { now += milliseconds; } };
}

test('a suspended master recovery response cannot undo a newer eligible-guest takeover', async () => {
  const browser = browserContext(); const f = party();
  let deliver!: () => void, committed!: () => void;
  const recoveryCommitted = new Promise<void>(resolve => { committed = resolve; });
  try {
    const original = await f.service.execute('room:create', { name: 'Original GM' }) as Session;
    const player = await f.service.execute('room:join', { code: original.code, name: 'Backup', gender: 'any' }) as Session;
    client.saveSession('master', original);
    globalThis.fetch = async (_input, init) => {
      const reply = await executeRpc(f.service, JSON.parse(init!.body as string));
      committed();
      return new Promise<Response>(resolve => { deliver = () => resolve(Response.json(reply, { status: reply.ok ? 200 : 400 })); });
    };
    const delayedRecovery = client.recoverSession(original.code, 'master', original.recoveryCode!);
    await recoveryCommitted;
    // While that browser is suspended, the server's real grace period elapses.
    f.advance(60_001);
    await f.service.execute('room:subscribe', { code: original.code, token: player.token, clientId: 'backup-phone' });
    const latest = await f.service.execute('room:gm-takeover', { code: original.code, token: player.token }) as Session;
    client.saveSession('master', latest);
    deliver();
    const recovered = await delayedRecovery;
    assert.equal(recovered.token === latest.token, true, 'return the current controller rather than a retired recovery result');
    assert.equal(client.getSession('master', original.code)?.token === latest.token, true, 'the saved current controller must remain usable');
    const currentView = await f.service.execute('room:subscribe', { code: original.code, token: client.getSession('master', original.code)!.token }) as RoomView;
    assert.equal(currentView.isMaster, true);
  } finally { browser.restore(); }
});

test('a delayed cross-tab disk write cannot retire an already observed replacement credential', () => {
  const browser = browserContext();
  const latest: Session = { code: 'CASE', token: 'latest-bearer', playerId: 'same-seat', recoveryCode: 'LATESTABCDEF', recoveryRevision: 3, expiresAt: 43_300_000 };
  const older: Session = { code: 'CASE', token: 'retired-bearer', playerId: 'same-seat', recoveryCode: 'RETIREDABCDE', recoveryRevision: 2, expiresAt: 43_300_000 };
  try {
    client.saveSession('player', latest);
    browser.values.set('alibi:player:CASE', JSON.stringify(older));
    assert.equal(client.getSession('player', 'CASE')?.token, 'latest-bearer');
    assert.equal(client.getSession('player', 'CASE')?.recoveryRevision, 3);
  } finally { browser.restore(); }
});

test('credential ordering does not block a new room lifetime or a different released-and-rejoined seat', () => {
  const browser = browserContext();
  try {
    client.saveSession('master', { code: 'CASE', token: 'expired-master', recoveryRevision: 10, expiresAt: 43_300_000 });
    client.saveSession('master', { code: 'CASE', token: 'new-room-master', recoveryRevision: 1, expiresAt: 86_600_000 });
    assert.equal(client.getSession('master', 'CASE')?.token, 'new-room-master');
    client.saveSession('player', { code: 'CASE', playerId: 'old-seat', token: 'old-seat-token', recoveryRevision: 10, expiresAt: 86_600_000 });
    client.saveSession('player', { code: 'CASE', playerId: 'new-seat', token: 'new-seat-token', recoveryRevision: 1, expiresAt: 86_600_000 });
    assert.equal(client.getSession('player', 'CASE')?.token, 'new-seat-token');
  } finally { browser.restore(); }
});
