import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evidenceStorageKey, filterPublicEvidence, publicEvidence, readEvidencePins, writeEvidencePins,
  type EvidenceFilter, type PublicEvidenceItem,
} from '../shared/evidence-browser.js';
import type { RoomView } from '../shared/types.js';

function evidenceRoom(): Pick<RoomView, 'act' | 'clues'> {
  return {
    act: {
      title: 'Act', narration: 'Narration', prompt: 'Prompt', locations: [],
      question: { id: 'answer', prompt: 'Private answer prompt', options: [] },
      evidence: [{ id: 'same', title: 'Revólver', text: 'Uma peça de latão no escritório.' }],
    },
    clues: [
      { id: 'same', title: 'Conexión', text: 'A silver coil.', round: 2, playerId: 'seat-a', playerName: 'José', published: true },
      { id: 'hidden', title: 'Unpublished secret', text: 'Never searchable.', round: 2, playerId: 'seat-a', playerName: 'José', published: false },
    ],
  };
}

const items: PublicEvidenceItem[] = [
  { key: 'case:revolver', kind: 'case', title: 'Revólver parado', text: 'Uma peça de latão no escritório.' },
  { key: 'shared:coil', kind: 'shared', title: 'Conexión eléctrica', text: 'A silver coil.', playerName: 'José Álvarez', round: 2 },
  { key: 'case:clock', kind: 'case', title: 'Clock', text: 'The minute hand stopped.' },
];

test('projects only public evidence fields and explicitly published clues', () => {
  const room = evidenceRoom();
  Object.assign(room.act!.evidence[0], { secret: 'PRIVATE CASE FIELD', correctOptionId: 'PRIVATE ANSWER' });
  Object.assign(room.clues[0], { secret: 'PRIVATE PLAYER FIELD', token: 'PRIVATE TOKEN' });
  room.clues.push({ ...room.clues[0], id: 'truthy', published: 'true' as unknown as boolean });
  const result = publicEvidence(room);
  assert.deepEqual(result, [
    { key: 'case:same', title: 'Revólver', text: 'Uma peça de latão no escritório.', kind: 'case' },
    { key: 'shared:same', title: 'Conexión', text: 'A silver coil.', kind: 'shared', playerName: 'José', round: 2 },
  ]);
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  assert.deepEqual(publicEvidence({ clues: [] }), []);
  assert.deepEqual(filterPublicEvidence(result, 'all', 'Unpublished', new Set()), []);
});

test('source-qualified identities keep colliding case and shared clue IDs independently pinnable', () => {
  const result = publicEvidence(evidenceRoom());
  assert.deepEqual(filterPublicEvidence(result, 'pinned', '', new Set(['shared:same'])), [result[1]]);
  assert.deepEqual(filterPublicEvidence(result, 'pinned', '', new Set(['case:same'])), [result[0]]);
});

test('search ignores Spanish and Portuguese accents and letter case across all public text fields', () => {
  for (const query of ['REVOLVER', 'peCa latao', 'escritorio']) {
    assert.deepEqual(filterPublicEvidence(items, 'all', query, new Set()), [items[0]]);
  }
  for (const query of ['conexion ELECTRICA', 'JOSE alvarez', 'ele\u0301ctrica']) {
    assert.deepEqual(filterPublicEvidence(items, 'all', query, new Set()), [items[1]]);
  }
});

test('all query words must match, even when spread across title, prose and contributor', () => {
  assert.deepEqual(filterPublicEvidence(items, 'all', '  JOSE\tcoil\nconexion  ', new Set()), [items[1]]);
  assert.deepEqual(filterPublicEvidence(items, 'all', 'coil clock', new Set()), []);
  assert.deepEqual(filterPublicEvidence(items, 'all', '2', new Set()), []);
  assert.deepEqual(filterPublicEvidence(items, 'all', ' \n ', new Set()), items);
});

test('source and pinned filters combine with search while preserving public order', () => {
  const pins = new Set(['case:clock', 'shared:coil', 'shared:missing']);
  const cases: [EvidenceFilter, string, PublicEvidenceItem[]][] = [
    ['all', '', items], ['case', '', [items[0], items[2]]], ['shared', '', [items[1]]],
    ['pinned', '', [items[1], items[2]]], ['pinned', 'clock', [items[2]]],
    ['case', 'coil', []], ['shared', 'clock', []],
  ];
  for (const [filter, query, expected] of cases) assert.deepEqual(filterPublicEvidence(items, filter, query, pins), expected);
  assert.equal(items.length, 3);
  assert.deepEqual([...pins], ['case:clock', 'shared:coil', 'shared:missing']);
});

test('an existing query immediately includes newly published evidence without cached results', () => {
  const room = evidenceRoom();
  assert.deepEqual(filterPublicEvidence(publicEvidence(room), 'shared', 'clock', new Set()), []);
  room.clues.push({ id: 'new', title: 'Clock fragment', text: 'A public update.', playerName: 'Ana', playerId: 'seat-b', round: 3, published: true });
  assert.deepEqual(filterPublicEvidence(publicEvidence(room), 'shared', 'clock', new Set()), [
    { key: 'shared:new', title: 'Clock fragment', text: 'A public update.', kind: 'shared', playerName: 'Ana', round: 3 },
  ]);
});

test('pin storage remains isolated by room, game and player, with stable legacy/public fallbacks', () => {
  const room: Pick<RoomView, 'code' | 'gameId' | 'me'> = {
    code: 'ABCD', gameId: 'game-a', me: { playerId: 'seat-a', clues: [], votedFor: null, ready: false },
  };
  const key = evidenceStorageKey(room);
  assert.match(key, /v1/);
  assert.equal(evidenceStorageKey({ ...room }), key);
  assert.notEqual(evidenceStorageKey({ ...room, code: 'EFGH' }), key);
  assert.notEqual(evidenceStorageKey({ ...room, gameId: 'game-b' }), key);
  assert.notEqual(evidenceStorageKey({ ...room, me: { ...room.me!, playerId: 'seat-b' } }), key);
  assert.notEqual(evidenceStorageKey({ code: 'ABCD' }), key);
  assert.equal(evidenceStorageKey({ code: 'ABCD' }), evidenceStorageKey({ code: 'ABCD', gameId: undefined, me: undefined }));
  const extras = { ...room, token: 'PRIVATE TOKEN', me: { ...room.me!, role: {
    name: 'Role', gender: 'any' as const, alignment: 'innocent' as const, brief: 'Brief', objective: 'Objective', secret: 'PRIVATE SECRET',
  } } };
  assert.equal(evidenceStorageKey(extras), key);
  assert.equal(key.includes('PRIVATE'), false);
  const values = new Map<string, string>();
  const storage = { getItem: (name: string) => values.get(name) ?? null, setItem: (name: string, value: string) => { values.set(name, value); } };
  assert.equal(writeEvidencePins(storage, key, new Set(['case:same'])), true);
  assert.deepEqual([...readEvidencePins(storage, evidenceStorageKey({ ...room, gameId: 'game-b' }))], []);
  assert.deepEqual([...readEvidencePins(storage, key)], ['case:same']);
});

test('optional, blocked and malformed pin storage is harmless', () => {
  assert.deepEqual([...readEvidencePins(undefined, 'pins')], []);
  assert.equal(writeEvidencePins(undefined, 'pins', new Set(['case:a'])), false);
  const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('quota'); } };
  assert.deepEqual([...readEvidencePins(blocked, 'pins')], []);
  assert.equal(writeEvidencePins(blocked, 'pins', new Set(['case:a'])), false);
  for (const raw of [null, '', '{', '{}', 'null', '"case:a"', '42']) {
    assert.deepEqual([...readEvidencePins({ getItem: () => raw }, 'pins')], []);
  }
});

test('pin read/write accepts only bounded source-qualified IDs, never clue prose or tokens', () => {
  const validLongest = `case:${'a'.repeat(195)}`;
  const invalid = ['unqualified', 'private:secret', 'case:', 'shared:', 'case:A secret sentence', 'shared:token:abc', `case:${'a'.repeat(196)}`, 'case:a\n'];
  const raw = JSON.stringify(['case:a', 'shared:a', ...invalid, {}, null, 9, 'case:a', validLongest]);
  assert.deepEqual([...readEvidencePins({ getItem: () => raw }, 'pins')], ['case:a', 'shared:a', validLongest]);
  let saved = '';
  assert.equal(writeEvidencePins({ setItem: (_key, value) => { saved = value; } }, 'pins', new Set(['case:a', 'shared:a', ...invalid, validLongest])), true);
  assert.deepEqual(JSON.parse(saved), ['case:a', 'shared:a', validLongest]);
  const many = Array.from({ length: 205 }, (_, i) => `shared:id-${i}`);
  const read = readEvidencePins({ getItem: () => JSON.stringify(many) }, 'pins');
  assert.equal(read.size, 200);
  assert.equal(read.has('shared:id-199'), true);
  assert.equal(read.has('shared:id-200'), false);
  assert.equal(writeEvidencePins({ setItem: (_key, value) => { saved = value; } }, 'pins', new Set(many)), true);
  assert.equal(JSON.parse(saved).length, 200);
  assert.equal(JSON.parse(saved)[199], 'shared:id-199');
});
