import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Bundle the real SPA routes while ignoring their browser-only stylesheet import.
const temporary = mkdtempSync(join(process.cwd(), '.test-app-'));
const output = join(temporary, 'app.mjs');
await build({ entryPoints: ['src/App.tsx'], outfile: output, bundle: true, packages: 'external', platform: 'node', format: 'esm', jsx: 'automatic', loader: { '.css': 'empty' } });
const { default: App } = await import(pathToFileURL(output).href);
after(() => rmSync(temporary, { recursive: true, force: true }));
function render(pathname: string) {
  const originals = ['location', 'navigator', 'localStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { pathname, origin: 'https://alibi.example' } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } });
  try { return renderToStaticMarkup(createElement(App)); }
  finally { for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } }
}
test('home offers explicit phone hosting and the phone entry offers direct room creation', () => {
  const home = render('/');
  assert.match(home, /href="\/host"[^>]*>Host on this phone/);
  assert.match(home, /computer or TV|computer display/);
  const phone = render('/host');
  assert.match(phone, /Create room/);
  assert.match(phone, /private phone controls|Private phone controls/);
  assert.doesNotMatch(phone, /Pairing your phone|Connecting the dots/);
});
test('display routes without a code offer lookup instead of an indefinite loading screen', () => {
  for (const path of ['/screen', '/screen/']) {
    const html = render(path);
    assert.match(html, /Open display/);
    assert.match(html, /Room code/);
    assert.doesNotMatch(html, /Connecting the dots/);
  }
});
test('missing master codes and invalid display codes explain how to recover', () => {
  const master = render('/master/');
  assert.match(master, /Host on this phone/);
  assert.doesNotMatch(master, /Connecting the dots/);
  const invalid = render('/screen/NOT-A-CODE');
  assert.match(invalid, /four-letter room code/);
  assert.match(invalid, /Open display/);
  assert.doesNotMatch(invalid, /Connecting the dots/);
});


test('replacement-device recovery is a real route with private proof and explicit role selection', () => {
  const html = render('/recover/CASE');
  assert.match(html, /Return to your mystery/);
  assert.match(html, /Private recovery code/);
  assert.match(html, /type="password"/);
  assert.match(html, /value="CASE"/);
  assert.doesNotMatch(html, /Connecting the dots/);
  const missingMaster = render('/master/CASE');
  assert.match(missingMaster, /href="\/recover\/CASE\?kind=master"/);
});


test('developer entry and film library are explicit routes without starting ordinary games', () => {
  const dev = render('/dev');
  assert.match(dev, /Create one-player rehearsal/);
  assert.match(dev, /Test rooms allow one player/);
  assert.match(dev, /href="\/films"/);
  const films = render('/films');
  assert.match(films, /Loading the film library/);
  assert.match(films, /Ending spoilers/);
  assert.doesNotMatch(films, /autoplay/);
  const missingTestController = render('/dev/CASE');
  assert.match(missingTestController, /Keep the controls close/);
  assert.doesNotMatch(missingTestController, /Next step:/);
});
