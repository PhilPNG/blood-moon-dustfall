import { useState } from 'react';
import { ArrowLeft, ArrowUpRight, Eye } from 'lucide-react';
import { LanguageMenu, LanguagePicker, useLanguage } from '../i18n';
import { watchCopy } from '../watch-translations';

export function WatchEntry({ initialCode = '', onOpen }: { initialCode?: string; onOpen: (path: string) => void }) {
  const { t, language, hasChosenLanguage } = useLanguage();
  const [code, setCode] = useState(initialCode.replace(/[^A-Z]/gi, '').toUpperCase().slice(0, 4));
  const copy = watchCopy(language);
  if (!hasChosenLanguage) return <div className="connection-page"><a className="wordmark" href="/">ALIBI<span>®</span></a><LanguagePicker/></div>;
  return <div className="connection-page route-entry-page" lang={language}><a className="wordmark" href="/">ALIBI<span>®</span></a><LanguageMenu/><section className="home-display-lookup"><div><span className="eyebrow"><Eye size={16}/> ALIBI · DUSTFALL</span><h1>{copy.title}</h1><p>{copy.description}</p></div><form onSubmit={event => { event.preventDefault(); if (/^[A-Z]{4}$/.test(code)) onOpen(`/watch/${code}`); }}><label htmlFor="watch-code">{t('Room code')}</label><div><input id="watch-code" value={code} onChange={event => setCode(event.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4))} placeholder="ABCD" maxLength={4} pattern="[A-Z]{4}" autoComplete="off" autoCapitalize="characters" spellCheck={false} required/><button className="button secondary" type="submit">{copy.open}<ArrowUpRight size={16}/></button></div></form></section><a className="text-button" href="/">{t('Back home')}<ArrowLeft size={16}/></a></div>;
}
