import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { localizeError, SAFE_ERROR_MESSAGE } from '../server/localization.js';
import { ERROR_TRANSLATIONS, VALIDATION_LABELS } from '../server/locales/errors.js';
import { executeRpc } from '../online/rpc.js';
import { OnlineGameService } from '../online/service.js';
import { MemoryRoomRepository } from '../online/repository.js';
import type { Reply, Session } from '../shared/types.js';

const sources = ['../server/engine.ts', '../online/service.ts', '../online/rpc.ts'].map(path => readFileSync(new URL(path, import.meta.url), 'utf8'));
const staticErrors = [...new Set(sources.flatMap(source => [...source.matchAll(/throw new Error\('((?:\\.|[^'\\])*)'\)/g)].map(match => match[1])))];
const validationLabels = [...new Set([...sources[0].matchAll(/\b(?:str|object|boolean)\([^;\n]*?, '([^']+)'\)/g)].map(match => match[1]))];
const dynamicErrors = [
  ...['lobby', 'roles', 'investigation', 'voting', 'results'].map(phase => `This action is only available during ${phase}.`),
  ...['man', 'woman'].map(gender => `That character is a ${gender}. Choose a matching character or change the character gender preference to either.`),
  ...['men', 'women'].map(gender => `Only 10 ${gender} characters are available. Choose either or the other character gender.`),
  ...['men', 'women'].map(gender => `Reserved characters leave too few ${gender} for the current gender preferences. Release a reservation or choose either.`),
  'Invalid rounds. Use a whole number from 1 to 5.',
  'Invalid roundSeconds. Use a whole number from 60 to 600.',
  'Invalid maxPlayers. Use a whole number from 4 to 20.',
];

test('public error catalog covers every static engine/service/RPC error and all authored validator labels', () => {
  assert.ok(staticErrors.length >= 68);
  assert.ok(validationLabels.length >= 17);
  for (const message of staticErrors) assert.ok(ERROR_TRANSLATIONS[message], `Missing public error: ${message}`);
  for (const label of validationLabels) assert.ok(VALIDATION_LABELS[label], `Missing validator: ${label}`);
  for (const message of [...staticErrors, ...validationLabels.map(label => `Invalid ${label}.`), ...dynamicErrors]) {
    assert.equal(localizeError(message, 'en'), message);
    for (const language of ['es', 'pt-BR'] as const) {
      const translated = localizeError(message, language);
      assert.notEqual(translated, message, `English fallback for ${language}: ${message}`);
      assert.notEqual(translated, SAFE_ERROR_MESSAGE, `Unrecognized ${language} error: ${message}`);
      assert.ok(translated.length > 10);
      assert.doesNotMatch(translated, /undefined|\{\{|\}\}/);
    }
  }
});

test('dynamic public errors preserve numeric bounds and never echo unknown labels, names, credentials or infrastructure details', () => {
  for (const language of ['en', 'es', 'pt-BR'] as const) {
    const range = localizeError('Invalid roundSeconds. Use a whole number from 60 to 600.', language);
    assert.match(range, /60/); assert.match(range, /600/);
    const count = localizeError('Only 10 women characters are available. Choose either or the other character gender.', language);
    assert.match(count, /10/);
    for (const unexpected of ['Invalid sk-secret-token.', 'D1_ERROR: no such table private_roles', 'SQLITE private-token abcdef', 'Unexpected private dossier for Player Name', 'Only 10 sk-secret characters are available. Choose either or the other character gender.']) {
      assert.equal(localizeError(unexpected, language), SAFE_ERROR_MESSAGE);
    }
  }
});

for (const language of ['es', 'pt-BR'] as const) {
  test(`${language}: real RPC errors localize expired/locked/full rooms, exhausted character pools, paused and unauthorized actions, and display capabilities`, async () => {
    let now = 100_000;
    const service = new OnlineGameService({ repository: new MemoryRoomRepository(), now: () => now });
    const rpc = (event: string, payload: Record<string, unknown>) => executeRpc(service, { event, payload: { ...payload, language } });
    const success = async <T>(event: string, payload: Record<string, unknown>): Promise<T> => {
      const reply = await rpc(event, payload); assert.equal(reply.ok, true, reply.error ?? 'Expected successful RPC'); return reply.data as T;
    };
    const error = async (event: string, payload: Record<string, unknown>, english: string, code = 'INVALID_REQUEST') => {
      const reply = await rpc(event, payload); assert.equal(reply.ok, false); assert.equal(reply.errorCode, code); assert.equal(reply.error, localizeError(english, language));
      assert.equal(reply.data, undefined); return reply;
    };
    const master = await success<Session>('room:create', {});
    const credentials = { code: master.code, token: master.token };
    await success('room:command', { ...credentials, action: { type: 'lock', locked: true } });
    await error('room:join', { code: master.code, name: 'Alex English Name', gender: 'any' }, 'This room is locked.');
    await success('room:command', { ...credentials, action: { type: 'lock', locked: false } });
    const players: Session[] = [];
    for (let index = 0; index < 4; index++) players.push(await success<Session>('room:join', { code: master.code, name: `Guest ${index}`, gender: 'any' }));
    await error('room:command', { ...credentials, action: { type: 'settings', settings: { rounds: 0 } } }, 'Invalid rounds. Use a whole number from 1 to 5.');
    await error('room:command', { ...players[0], action: { type: 'start' } }, 'Only the game master can do that.');
    await error('room:command', { ...credentials, action: { type: 'ready', ready: true } }, 'Only players can do that.');
    await error('room:command', { ...players[0], action: { type: 'search', locationId: 'mayors-office' } }, 'This action is only available during investigation.');
    await error('room:playback', { code: master.code, displayId: 'display', token: 'a'.repeat(48), sequence: 1, playback: {} }, 'A live display capability is required.');
    await success('room:command', { ...credentials, action: { type: 'settings', settings: { maxPlayers: 4 } } });
    await error('room:join', { code: master.code, name: 'Extra Guest', gender: 'any' }, 'This room is full.');
    await success('room:command', { ...credentials, action: { type: 'start' } });
    await success('room:command', { ...credentials, action: { type: 'advance' } });
    await success('room:command', { ...credentials, action: { type: 'pause' } });
    await error('room:command', { ...players[0], action: { type: 'search', locationId: 'mayors-office' } }, 'The game is paused.');
    await error('room:subscribe', { code: master.code, token: 'forged-sensitive-token' }, 'Invalid or revoked session token.', 'SESSION_INVALID');
    const pool = await success<Session>('room:create', {});
    for (let index = 0; index < 10; index++) await success('room:join', { code: pool.code, name: `Woman ${index}`, gender: 'woman' });
    await error('room:join', { code: pool.code, name: 'Eleventh Woman', gender: 'woman' }, 'Only 10 women characters are available. Choose either or the other character gender.');
    now += 12 * 60 * 60 * 1000;
    await error('room:subscribe', credentials, 'This room has expired.', 'ROOM_EXPIRED');
  });

  test(`${language}: RPC classifies canonical English errors before localization and sanitizes internal failures`, async () => {
    for (const [message, code] of [
      ['Room not found.', 'ROOM_NOT_FOUND'], ['This room has expired.', 'ROOM_EXPIRED'], ['The room is busy. Please try that action again.', 'BUSY'], ['Invalid session token.', 'SESSION_INVALID'],
      ['D1_ERROR: SQLITE no such table private_roles secret-token', 'TEMPORARY'],
    ]) {
      const service = { execute: async () => { throw new Error(message); } } as unknown as OnlineGameService;
      const reply: Reply<unknown> = await executeRpc(service, { event: 'room:subscribe', payload: { code: 'TEST', language } });
      assert.equal(reply.ok, false); assert.equal(reply.errorCode, code);
      assert.equal(reply.error, localizeError(code === 'TEMPORARY' ? 'The online room is temporarily unavailable. Please try again.' : message, language));
      assert.doesNotMatch(reply.error!, /D1_ERROR|SQLITE|private_roles|secret-token/);
    }
    const service = { execute: async () => { throw new Error('Unexpected secret-token in private state'); } } as unknown as OnlineGameService;
    assert.equal((await executeRpc(service, { event: 'room:subscribe', payload: { code: 'TEST', language } })).error, SAFE_ERROR_MESSAGE);
    const invalidLanguage = await executeRpc(service, { event: 'room:subscribe', payload: { code: 'TEST', language: 'invalid-language' } });
    assert.equal(invalidLanguage.error, 'Invalid language.'); assert.equal(invalidLanguage.errorCode, 'INVALID_REQUEST');
  });
}
