import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LanguageProvider } from '../src/i18n';
import { WatchEntry } from '../src/components/WatchEntry';

test('watch entry starts with language selection on a new phone', () => {
  const html = renderToStaticMarkup(createElement(LanguageProvider, { children: createElement(WatchEntry, { onOpen: () => {} }) }));
  assert.match(html, /Choose your language/);
  assert.doesNotMatch(html, /<form|Your name|gender/);
});
test('watch entry is localized and asks only for a public room code', () => {
  for (const [language, title] of [['en','Watch the mystery'],['es','Sigue el misterio'],['pt-BR','Acompanhe o mistério']] as const) {
    const html = renderToStaticMarkup(createElement(LanguageProvider, { initialLanguage: language, children: createElement(WatchEntry, { onOpen: () => {}, initialCode: 'DUST' }) }));
    assert.ok(html.includes(title));
    assert.match(html, /value="DUST"/);
    assert.equal((html.match(/<input/g) ?? []).length, 1);
    assert.doesNotMatch(html, /password|nickname|gender/);
  }
});
