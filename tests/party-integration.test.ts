import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LanguageProvider } from '../src/i18n';
import { Master } from '../src/components/Master';
import { Join, Player } from '../src/components/Player';
import type { RoomView } from '../shared/types';
const view={code:'FEST',gameId:'integration',phase:'lobby',round:0,serverNow:100_000,expiresAt:500_000,settings:{rounds:3,roundSeconds:300,maxPlayers:20},players:[{id:'a',name:'Alice',gender:'any',connected:true,ready:true},{id:'b',name:'Bea',gender:'any',connected:true,ready:true}],isLocked:false,timer:{endsAt:null,remaining:300,isPaused:false},clues:[],votesCount:0,isMaster:true} as RoomView;
function render(component:any,props:any){return renderToStaticMarkup(createElement(LanguageProvider,{initialLanguage:'en',children:createElement(component,props)}));}
const command=async()=>{};
test('GM phone mounts preflight, stage preferences and a separate public audience invitation',()=>{
 const html=render(Master,{room:view,connected:true,command,joinOrigin:'https://example.com',onHome:()=>{}});
 for(const expected of ['Party check','Stage and sound','https://example.com/watch/FEST'])assert.ok(html.includes(expected),expected);
});
test('post-verdict GM phone exposes optional party awards',()=>{
 assert.ok(render(Master,{room:{...view,phase:'results'},connected:true,command,joinOrigin:'https://example.com',onHome:()=>{}}).includes('Party awards'));
});
test('join offers public audience access without requiring a new player seat',()=>{
 const html=render(Join,{initialCode:'FEST',onJoined:()=>{}});
 assert.ok(html.includes('href="/watch/FEST"'));
});
test('player gets optional mingling during investigation and awards after verdict',()=>{
 const me={playerId:'a',ready:true,clues:[]};
 const common={connected:true,command,onLeave:()=>{}};
 assert.ok(render(Player,{...common,room:{...view,isMaster:false,phase:'investigation',round:1,me}}).includes('Optional table talk'));
 assert.ok(render(Player,{...common,room:{...view,isMaster:false,phase:'results',me,partyAwards:{id:1,status:'voting',submittedCount:0,eligibleCount:2}}}).includes('Party awards'));
});

test('phone party awards appear before the long reconstruction and personal score',()=>{
 const html=render(Player,{connected:true,command,onLeave:()=>{},room:{...view,isMaster:false,phase:'results',me:{playerId:'a',ready:true,clues:[]},partyAwards:{id:1,status:'voting',submittedCount:0,eligibleCount:2},result:{culpritId:'b',caught:false,tallies:{},solution:{headline:'LONG_RECONSTRUCTION',summary:'Case details',method:'Method',motive:'Motive',timeline:[]}}}});
 assert.ok(html.indexOf('Party awards')<html.indexOf('YOUR DUSTFALL AWARD'));
 assert.ok(html.indexOf('Party awards')<html.indexOf('LONG_RECONSTRUCTION'));
});
