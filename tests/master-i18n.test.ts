import { recoveryTranslations } from '../src/recovery-translations';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Master, getMasterAction } from '../src/components/Master';
import { LanguageProvider, phoneTranslations, translate } from '../src/i18n';
import { masterTranslations } from '../src/master-translations';
import { shellTranslations } from '../src/shell-translations';
import { GENDERS, PHASES, type RoomView } from '../shared/types';

function view(phase: RoomView['phase']): RoomView {
  return { code: 'DUST', phase, round: 1, settings: { rounds: 3, roundSeconds: 300, maxPlayers: 20 }, players: [{ id: 'p1', name: 'Alex', gender: 'woman', characterId: 'silas-vale', ready: false, connected: true }, { id: 'p2', name: 'Sam', gender: 'any', ready: true, connected: false }], isLocked: false, timer: { endsAt: null, remaining: 300, isPaused: false }, clues: [], votesCount: 1, isMaster: true };
}
test('game master actions, stage hints, roster and film controls use Spanish and Brazilian Portuguese in every phase', () => {
  for (const language of ['es', 'pt-BR'] as const) for (const phase of ['lobby', 'roles', 'investigation', 'voting', 'results'] as const) {
    const room = view(phase);
    const html = renderToStaticMarkup(createElement(LanguageProvider, { initialLanguage: language, children: createElement(Master, { room, connected: true, command: async () => {}, joinOrigin: 'https://alibi.example', onHome: () => {} }) }));
    assert.ok(html.includes(translate(language, getMasterAction(room).label)), `${language} ${phase} action`);
    assert.ok(html.includes(translate(language, 'Host’s quick guide')));
    assert.ok(html.includes(translate(language, 'Story films')));
    assert.ok(html.includes(translate(language, 'Public seal · {seal}', { seal: `${translate(language, 'Mint')} ${translate(language, 'Cactus')}` })));
    assert.match(html, /class="language-menu"/);
    assert.match(html, /<option value="es" lang="es">Español<\/option>/);
    for (const source of ['Game master / private phone controls', 'Host’s quick guide', 'Apply captions to TV', 'The secrets stay on your players’ phones.', 'Continue without everyone']) assert.ok(!html.includes(`>${source}<`), `${language} ${phase} leaked ${source}`);
    assert.ok(html.includes('https://alibi.example/join/DUST'));
    assert.ok(html.includes('Alex')); assert.ok(html.includes('Sam'));
  }
});

test('all GM static strings, phase metadata and legacy gender labels have translations', () => {
  const registry = { ...phoneTranslations, ...masterTranslations, ...shellTranslations, ...recoveryTranslations };
  const source = readFileSync(new URL('../src/components/Master.tsx', import.meta.url), 'utf8');
  for (const match of source.matchAll(/\bt\(["']([^"']+)["']/g)) for (const language of ['es', 'pt-BR'] as const) assert.ok(registry[match[1]]?.[language], `Missing ${language} ${match[1]}`);
  for (const phase of PHASES) for (const language of ['es', 'pt-BR'] as const) {
    assert.ok(registry[phase.label]?.[language]); assert.ok(registry[phase.description]?.[language]);
  }
  for (const gender of GENDERS) for (const language of ['es', 'pt-BR'] as const) assert.ok(registry[gender.label]?.[language]);
  assert.equal(translate('es', '{count} more player needed to begin.', { count: 1 }), 'Falta 1 jugador para comenzar.');
  assert.equal(translate('pt-BR', '{count} more players needed to begin.', { count: 2 }), 'Faltam 2 jogadores para começar.');
  assert.match(translate('es', '{count} players have not voted. Continuing closes voting and reveals the result using only the votes already received.', { count: 2 }), /2 jugadores no han votado/);
});

test('extra investigation time controls explain their cap in all three languages', () => {
  const labels = { en: 'Add 1 minute', es: 'Añadir 1 minuto', 'pt-BR': 'Adicionar 1 minuto' };
  for (const language of ['en', 'es', 'pt-BR'] as const) {
    const room = view('investigation');
    const html = renderToStaticMarkup(createElement(LanguageProvider, { initialLanguage: language, children: createElement(Master, { room, connected: true, command: async () => {}, joinOrigin: 'https://alibi.example', onHome: () => {} }) }));
    assert.ok(html.includes(labels[language]), `${language} extra-time button`);
    assert.ok(html.includes(translate(language, 'Add up to one minute. The countdown limit is ten minutes.')));
    if (language !== 'en') assert.ok(!html.includes('Add 1 minute'));
  }
});
