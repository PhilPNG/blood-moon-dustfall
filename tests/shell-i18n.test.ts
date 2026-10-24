import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import App from '../src/App';
import { ArcadeHome } from '../src/components/ArcadeHome';
import { LanguageProvider, translate } from '../src/i18n';
import { CHARACTERS } from '../shared/characters';
import type { Language } from '../shared/locale';

const htmlText = (text: string) => renderToStaticMarkup(createElement('span', {}, text)).replace(/^<span>|<\/span>$/g, '');
function renderPath(pathname: string, language: Language) {
 const originals = ['location','navigator','localStorage'].map(key => [key,Object.getOwnPropertyDescriptor(globalThis,key)] as const);
 Object.defineProperty(globalThis,'location',{configurable:true,value:{pathname,origin:'https://alibi.example'}});
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true}});
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:()=>null}});
 try { return renderToStaticMarkup(createElement(LanguageProvider,{initialLanguage:language,children:createElement(App)})); }
 finally { for(const [key,descriptor] of originals)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key); }
}

test('launch and phone hosting use the selected language through the real App shell',()=>{
 for(const language of ['es','pt-BR'] as const){
  const home=renderPath('/',language),host=renderPath('/host',language);
  for(const source of ['Host a game','Join a game','One dead mayor. A town full of secrets.','No downloads'])assert.ok(home.includes(htmlText(translate(language,source))),`${language} launch: ${source}`);
  for(const source of ['Create room','PRIVATE PHONE CONTROLS','Try with sample players','Your private phone controls stay saved in this browser. You set the pace of every act.'])assert.ok(host.includes(htmlText(translate(language,source))),`${language} host: ${source}`);
  assert.doesNotMatch(home,/>Host a game</); assert.doesNotMatch(host,/>Create room</);
  assert.match(home,/class="language-menu"/);assert.match(host,/class="language-menu"/);
 }
});

test('all twenty public gallery profiles and printable badges are localized without changing names or IDs',()=>{
 for(const language of ['es','pt-BR'] as const){
  const cast=renderPath('/cast',language),kit=renderPath('/party-kit',language);
  assert.equal((cast.match(/class="arcade-character"/g)||[]).length,20);
  assert.equal((kit.match(/class="party-badge"/g)||[]).length,20);
  for(const character of CHARACTERS){
   assert.ok(cast.includes(`id="${character.id}"`));assert.ok(cast.includes(character.name));
   for(const field of ['title','bio','personality','costume'] as const){const text=translate(language,character[field]);assert.notEqual(text,character[field],`${language} ${character.id} ${field}`);assert.ok(cast.includes(htmlText(text)),`${language} rendered ${character.id} ${field}`);}
   assert.ok(kit.includes(htmlText(translate(language,character.costume))));
  }
  for(const source of ['Print the party kit','One phone per player.','Vote once.'])assert.ok(kit.includes(htmlText(translate(language,source))));
 }
});

test('room recovery explains invalid codes in both supported non-English languages',()=>{
 for(const language of ['es','pt-BR'] as const){
  const page=renderPath('/screen/INVALID',language);
  assert.ok(page.includes(htmlText(translate(language,'Find your room again.'))));
  assert.ok(page.includes(htmlText(translate(language,'This address needs a four-letter room code. Enter the code from your game master’s phone.'))));
 }
});
