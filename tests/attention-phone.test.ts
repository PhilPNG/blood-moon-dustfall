import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Player } from '../src/components/Player';
import { Master } from '../src/components/Master';
import { attentionEventKey } from '../shared/attention';
import type { RoomView } from '../shared/types';

function room(): RoomView {
  const value = {
    code:'LOOK',phase:'roles',round:0,gameId:'game',serverNow:1_000,
    settings:{rounds:3,roundSeconds:300,maxPlayers:20}, players:[],isLocked:true,
    timer:{endsAt:null,remaining:0,isPaused:false},clues:[],votesCount:0,isMaster:false,
    me:{playerId:'p1',ready:false,clues:[],votedFor:null,role:{name:'Private Name',background:'PRIVATE_DOSSIER',objectives:[],relationships:[]}},
  } as unknown as RoomView;
  value.attention={id:1,cue:'phase',eventKey:attentionEventKey(value),endsAt:11_000,remainingMs:10_000};
  return value;
}
test('player attention replaces private dossier and input until the shared gate opens',()=>{
  const value=room();
  const render=()=>renderToStaticMarkup(createElement(Player,{room:value,connected:true,command:async()=>{},onLeave:()=>{}}));
  const html=render();
  assert.match(html,/Eyes on the big screen/i);
  assert.doesNotMatch(html,/PRIVATE_DOSSIER|phone-ready|phone-modal-backdrop/);
  value.serverNow=12_000;
  assert.match(render(),/PRIVATE_DOSSIER/);
});
test('game master sees the same countdown while pause and film controls remain available',()=>{
  const value=room();value.isMaster=true;
  const html=renderToStaticMarkup(createElement(Master,{room:value,connected:true,command:async()=>{},joinOrigin:'https://game.example',onHome:()=>{}}));
  assert.match(html,/Gather the table/i);
  assert.match(html,/Pause game|Pause/);
  assert.match(html,/Skip current film/);
});
