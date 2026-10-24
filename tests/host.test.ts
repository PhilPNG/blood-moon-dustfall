import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Host } from '../src/components/Host';
import { Display } from '../src/components/Display';
import type { RoomView } from '../shared/types';

function room(): RoomView {
  return { code:'TEST', phase:'roles', round:0, settings:{rounds:3,roundSeconds:180,maxPlayers:12}, players:[{id:'a',name:'Alex',gender:'any',ready:false,connected:false},{id:'b',name:'Bea',gender:'woman',ready:true,connected:true}],isLocked:true,timer:{endsAt:null,remaining:0,isPaused:false},clues:[],votesCount:1,isMaster:true };
}
const props = { connected:true, command:async()=>{}, joinOrigin:'http://192.168.1.2:3000',create:async()=>{},creating:false,error:'',onJoin:()=>{},onHome:()=>{} };
test('master can continue when a phone misses a role acknowledgement or final vote',()=>{
  const view=room();
  for (const phase of ['roles','voting'] as const) {
    view.phase=phase;
    const html=renderToStaticMarkup(createElement(Host,{...props,room:view}));
    assert.match(html,/Continue without everyone/);
  }
});
test('public display renders every published clue instead of silently dropping earlier players',()=>{
  const view=room();view.phase='investigation';view.round=2;
  view.clues=Array.from({length:6},(_,i)=>({id:String(i),title:'Distinct evidence '+i,text:'Clue '+i,round:i===0?2:1,playerId:String(i),playerName:'Player '+i,published:true}));
  const html=renderToStaticMarkup(createElement(Display,{room:view,connected:true,joinOrigin:props.joinOrigin}));
  for(let i=0;i<6;i++) assert.ok(html.includes('Distinct evidence '+i));
});
