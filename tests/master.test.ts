import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QRCodeSVG } from 'qrcode.react';
import { Master, getMasterAction, preferenceActions } from '../src/components/Master';
import type { RoomView } from '../shared/types';

function room(): RoomView {
  return {
    code: 'CASE', phase: 'lobby', round: 0,
    settings: { rounds: 3, roundSeconds: 180, maxPlayers: 12 },
    players: [
      { id: 'a', name: 'Alex', gender: 'any', ready: false, connected: false },
      { id: 'b', name: 'Bea', gender: 'woman', ready: true, connected: true },
      { id: 'c', name: 'Cameron', gender: 'man', ready: true, connected: true },
      { id: 'd', name: 'Drew', gender: 'nonbinary', ready: true, connected: true },
    ],
    isLocked: false, timer: { endsAt: null, remaining: 180, isPaused: false },
    clues: [], votesCount: 3, isMaster: true,
  };
}
const props = {
  connected: true, command: async () => {},
  joinOrigin: 'https://alibi.example/', onHome: () => {},
};
function render(view: RoomView, connected = true) {
  return renderToStaticMarkup(createElement(Master, { ...props, room: view, connected }));
}
function button(html: string, label: string) {
  const buttons = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
  const found = buttons.find(value => value.includes(label));
  assert.ok(found, `Expected a ${label} button`);
  return found;
}

test('starting requires four players and the lobby exposes invitation and display links', () => {
  const view = room();
  view.players.pop();
  assert.deepEqual(getMasterAction(view), { label: 'Start the mystery', action: { type: 'start' }, disabled: true });
  assert.match(button(render(view), 'Start the mystery'), /disabled/);
  view.players.push({ id: 'e', name: 'Ellis', gender: 'any', ready: false, connected: true });
  assert.equal(getMasterAction(view).disabled, false);
  const html = render(view);
  assert.doesNotMatch(button(html, 'Start the mystery'), /disabled/);
  assert.match(html, /https:\/\/alibi\.example\/join\/CASE/);
  assert.match(html, /https:\/\/alibi\.example\/screen\/CASE/);
  assert.match(html, /Manage Alex/);
});

test('the GM invites players and spectators to the custom domain and opens its public display', () => {
  const html = renderToStaticMarkup(createElement(Master, { ...props, room: room(), joinOrigin: 'https://party.devicebytes.com/' }));
  for (const path of ['join', 'watch', 'screen']) assert.ok(html.includes(`href="https://party.devicebytes.com/${path}/CASE"`));
  const expectedQR = renderToStaticMarkup(createElement(QRCodeSVG, {
    value: 'https://party.devicebytes.com/join/CASE',
    size: 136, level: 'M', bgColor: '#FFF0CB', fgColor: '#130C25', title: 'Join ALIBI room CASE',
  }));
  assert.ok(html.includes(expectedQR), 'The GM invitation QR must encode the custom-domain player invitation.');
  assert.doesNotMatch(html, /#ticket=|blood-moon-dustfall\.vercel\.app/);
});

test('missing acknowledgements and votes require the explicit continue override', () => {
  const view = room();
  for (const phase of ['roles', 'voting'] as const) {
    view.phase = phase;
    const next = getMasterAction(view);
    assert.equal(next.disabled, true);
    assert.deepEqual(next.action, { type: 'advance' });
    const html = render(view);
    assert.match(button(html, next.label), /disabled/);
    assert.doesNotMatch(button(html, 'Continue without everyone'), /disabled/);
    view.players.forEach(player => { player.ready = true; });
    view.votesCount = 4;
    assert.equal(getMasterAction(view).disabled, false);
    assert.doesNotMatch(render(view), /Continue without everyone/);
    view.players[0].ready = false;
    view.votesCount = 3;
  }
});

test('paused phases offer resume and block both ordinary and missing-player advancement', () => {
  const view = room();
  view.timer.isPaused = true;
  for (const phase of ['roles', 'investigation', 'voting'] as const) {
    view.phase = phase;
    view.round = 1;
    assert.equal(getMasterAction(view).disabled, true);
    const html = render(view);
    assert.match(button(html, getMasterAction(view).label), /disabled/);
    assert.doesNotMatch(button(html, 'Resume game'), /disabled/);
    if (phase !== 'investigation') assert.match(button(html, 'Continue without everyone'), /disabled/);
  }
});

test('the final investigation opens voting and disconnected controls cannot mutate the game', () => {
  const view = room();
  view.phase = 'investigation'; view.round = 3;
  assert.deepEqual(getMasterAction(view), { label: 'Open voting', action: { type: 'advance' }, disabled: false });
  const html = render(view, false);
  assert.match(button(html, 'Open voting'), /disabled/);
  assert.match(button(html, 'Pause game'), /disabled/);
});

test('every published clue is reviewable while private clues and stale secret data stay hidden', () => {
  const view = room(); view.phase = 'investigation'; view.round = 2;
  view.clues = Array.from({ length: 6 }, (_, index) => ({ id: String(index), title: `Shared evidence ${index}`, text: `Statement ${index}`, round: index < 3 ? 1 : 2, playerId: 'a', playerName: 'Alex', published: true }));
  view.clues.push({ id: 'private', title: 'Unpublished secret evidence', text: 'Private statement', round: 2, playerId: 'a', playerName: 'Alex', published: false });
  view.me = { playerId: 'a', votedFor: null, ready: false, clues: [], role: { name: 'Private character', gender: 'any', alignment: 'culprit', brief: 'Hidden role brief', objective: 'Secret objective' } };
  view.result = { culpritId: 'a', tallies: { a: 4 }, caught: true };
  const html = render(view);
  for (let index = 0; index < 6; index++) assert.ok(html.includes(`Shared evidence ${index}`));
  assert.doesNotMatch(html, /Unpublished secret evidence|Private statement|Private character|Hidden role brief|Secret objective|THE CULPRIT/);
});

test('results reveal the culprit and vote totals and offer a new mystery', () => {
  const view = room(); view.phase = 'results';
  view.result = { culpritId: 'b', tallies: { a: 0, b: 3, c: 1, d: 0 }, caught: true };
  assert.deepEqual(getMasterAction(view), { label: 'New mystery', action: { type: 'reset' }, disabled: false });
  const html = render(view);
  assert.match(html, /The culprit was/);
  assert.match(html, /Bea/);
  assert.match(html, /3 votes/);
  assert.doesNotMatch(button(html, 'New mystery'), /disabled/);
});

test('results keep public case evidence reviewable without reopening investigation narration', () => {
  const view = room(); view.phase = 'results';
  view.act = { title: 'Last investigation', narration: 'PENDING INVESTIGATION NARRATION', prompt: 'PENDING INVESTIGATION PROMPT', evidence: [{ id: 'e', title: 'Final public evidence', text: 'The audit establishes the method.' }], locations: [], question: { id: 'q', prompt: '', options: [] } };
  const html = render(view);
  assert.ok(html.includes('Final public evidence'));
  assert.ok(!html.includes('PENDING INVESTIGATION NARRATION'));
  assert.ok(!html.includes('PENDING INVESTIGATION PROMPT'));
});


test('changing a reserved character gender clears the old role before changing preference', () => {
  const player = { id: 'a', name: 'Alex', gender: 'man' as const, connected: true, ready: false, roleName: 'Marshal Silas Vale' };
  assert.deepEqual(preferenceActions(player, 'woman', 'Ada Crowe'), [
    { type: 'set-role', playerId: 'a', roleName: '' },
    { type: 'set-gender', playerId: 'a', gender: 'woman' },
    { type: 'set-role', playerId: 'a', roleName: 'Ada Crowe' },
  ]);
  assert.deepEqual(preferenceActions(player, 'man', 'Marshal Silas Vale'), []);
  assert.deepEqual(preferenceActions(player, 'woman', ''), [
    { type: 'set-role', playerId: 'a', roleName: '' },
    { type: 'set-gender', playerId: 'a', gender: 'woman' },
  ]);
});

test('GM gets only public act narration, automatic evidence and action counts', () => {
  const view = room(); view.phase = 'investigation'; view.round = 2;
  view.act = { title: 'The Black Star', narration: 'Narration for every guest', prompt: 'Follow the missing core', evidence: [{ id: 'a', title: 'Automatic evidence', text: 'Evidence for every group' }], locations: [], question: { id: 'q', prompt: 'Why?', options: [] } };
  view.searchCount = 3; view.answerCount = 2;
  const html = render(view);
  for (const value of ['Narration for every guest', 'Follow the missing core', 'Evidence for every group', '3/4', '2/4', '4–20 guests']) assert.ok(html.includes(value));
});

test('only an investigation offers an extra minute, including while paused or expired', () => {
  const view = room();
  for (const phase of ['lobby', 'roles', 'voting', 'results'] as const) {
    view.phase = phase;
    assert.doesNotMatch(render(view), /Add 1 minute/);
  }
  view.phase = 'investigation'; view.round = 1;
  for (const paused of [false, true]) for (const remaining of [0, 180, 599]) {
    view.timer = { endsAt: null, remaining, isPaused: paused };
    const html = render(view);
    assert.doesNotMatch(button(html, 'Add 1 minute'), /disabled/);
    assert.match(html, /Add up to one minute\. The countdown limit is ten minutes\./);
  }
});

test('extra time is unavailable at the countdown cap, offline, or without GM authority', () => {
  const view = room(); view.phase = 'investigation'; view.round = 1;
  view.timer.remaining = 600;
  assert.match(button(render(view), 'Add 1 minute'), /disabled/);
  assert.match(render(view), /The countdown is at the ten-minute limit\./);
  view.timer.remaining = 599;
  assert.match(button(render(view, false), 'Add 1 minute'), /disabled/);
  view.isMaster = false;
  assert.match(button(render(view), 'Add 1 minute'), /disabled/);
});

test('a rehearsal GM phone starts with one real player while ordinary and empty rooms stay gated', () => {
  const view = room();
  view.players = view.players.slice(0, 1);
  view.rehearsal = true;
  assert.equal(getMasterAction(view).disabled, false);
  view.rehearsal = false;
  assert.equal(getMasterAction(view).disabled, true);
  view.rehearsal = true; view.players = [];
  assert.equal(getMasterAction(view).disabled, true);
});
