import test from 'node:test';
import assert from 'node:assert/strict';
import { executeRpc } from '../online/rpc.js';
import { OnlineGameService } from '../online/service.js';
import { MemoryRoomRepository } from '../online/repository.js';
import { localizeRoomView } from '../server/localization.js';
import type { Reply, RoomView, Session } from '../shared/types.js';
import type { Language } from '../shared/locale.js';

function setup() {
  const repository = new MemoryRoomRepository();
  const service = new OnlineGameService({ repository, now: () => 100_000 });
  const rpc = async <T>(event: string, payload: unknown, requestId?: string): Promise<T> => {
    const reply = await executeRpc(service, { event, payload, ...(requestId ? { requestId } : {}) }) as Reply<T>;
    assert.equal(reply.ok, true, reply.error ?? 'Expected successful RPC response');
    return reply.data as T;
  };
  return { repository, service, rpc };
}

test('RPC boundary rejects invalid language before creating or changing a room', async () => {
  const { service, rpc } = setup();
  for (const language of [null, '', 'fr', 'pt', 'pt-br', 12, {}, ['es']]) {
    const reply = await executeRpc(service, { event: 'room:create', payload: { language } });
    assert.equal(reply.ok, false); assert.equal(reply.errorCode, 'INVALID_REQUEST'); assert.match(reply.error!, /language/i);
  }
  const master = await rpc<Session>('room:create', {});
  const before = await rpc<RoomView>('room:subscribe', master);
  const invalid = await executeRpc(service, { event: 'room:command', payload: { ...master, language: 'ES', action: { type: 'lock', locked: true } } });
  assert.equal(invalid.ok, false);
  const after = await rpc<RoomView>('room:subscribe', master);
  assert.equal(after.isLocked, before.isLocked); assert.equal(after.revision, before.revision);
});

for (const language of ['es', 'pt-BR'] as const) {
  test(`${language}: RPC language is per request, applies after viewer filtering and never enters canonical state or receipts`, async () => {
    const { repository, rpc } = setup();
    const master = await rpc<Session>('room:create', { language });
    assert.equal(Object.keys(master).some(key => key === 'language'), false);
    const players = [] as Session[];
    for (let index = 0; index < 4; index++) players.push(await rpc<Session>('room:join', { code: master.code, name: `Guest ${index}`, gender: 'any', language }));
    await rpc<RoomView>('room:command', { ...master, language, action: { type: 'start' } }, 'locale-start-0001');
    const stored = await repository.get(master.code); assert.ok(stored);
    const canonical = await rpc<RoomView>('room:subscribe', players[0]);
    const localized = await rpc<RoomView>('room:subscribe', { ...players[0], language });
    // Presence refreshes can affect revision only; story and authority remain the same view.
    assert.deepEqual(localized.me, localizeRoomView(canonical, language).me);
    assert.notEqual(localized.me!.role!.background, canonical.me!.role!.background);
    assert.equal(localized.me!.playerId, players[0].playerId);
    const other = await rpc<RoomView>('room:subscribe', { ...players[1], language: 'en' });
    assert.equal(other.me!.playerId, players[1].playerId);
    assert.notEqual(other.me!.role!.background, canonical.me!.role!.background);
    for (const token of [undefined, master.token]) {
      const publicView = await rpc<RoomView>('room:subscribe', { code: master.code, ...(token ? { token } : {}), language });
      assert.equal(publicView.me, undefined); assert.equal(publicView.result, undefined);
      assert.doesNotMatch(JSON.stringify(publicView), /alignment|correctOptionId|secret|alibi|culpritId/);
      for (const session of [master, ...players]) assert.equal(JSON.stringify(publicView).includes(session.token), false);
    }
    // Replaying an action with the same receipt but another language does not repeat the action.
    const advanced = await rpc<RoomView>('room:command', { ...master, language, action: { type: 'advance' } }, 'locale-advance-01');
    const replayed = await rpc<RoomView>('room:command', { ...master, language: 'en', action: { type: 'advance' } }, 'locale-advance-01');
    assert.equal(advanced.round, 1); assert.equal(replayed.round, 1);
    assert.deepEqual(advanced.act, localizeRoomView(replayed, language).act);
    const persisted = await repository.get(master.code); assert.ok(persisted);
    const envelope = JSON.parse(persisted.state);
    assert.equal('language' in envelope.room, false);
    assert.equal(envelope.room.players[0].role.background, canonical.me!.role!.background);
    assert.equal(envelope.room.players[0].role.name, canonical.me!.role!.name);
    assert.equal(persisted.state.includes(localized.me!.role!.background!), false);
    for (const receipt of envelope.receipts) assert.equal('language' in receipt, false);
    const unchanged = await rpc<RoomView>('room:subscribe', { ...players[0], language: 'en' as Language });
    assert.equal(unchanged.me!.role!.background, canonical.me!.role!.background);
  });
}
