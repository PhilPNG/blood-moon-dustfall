import { useEffect, useRef, useState } from 'react';
import { Captions, Check, Radio } from 'lucide-react';
import { captionAt, parseCinematicManifest } from '../../shared/cinematics';
import { parseNarrationManifest } from '../../shared/narration';
import { playbackPosition } from '../../shared/media-sync';
import type { RoomView } from '../../shared/types';
import { useLanguage } from '../i18n';
import { useMediaManifest } from './media-manifest';

const copy = {
  en: { title: 'Shared-screen captions', on: 'Captions on', off: 'Turn captions on', waiting: 'Captions appear while the shared screen plays.', film: 'Story film', narration: 'Your host', paused: 'Captions paused', sealed: 'accusations sealed', remaining: 'waiting', vote: 'Live sealed vote', done: 'Everyone has voted' },
  es: { title: 'Subtítulos de la pantalla', on: 'Subtítulos activados', off: 'Activar subtítulos', waiting: 'Los subtítulos aparecen cuando se reproduce la pantalla compartida.', film: 'Película de la historia', narration: 'Tu anfitrión', paused: 'Subtítulos en pausa', sealed: 'acusaciones selladas', remaining: 'pendientes', vote: 'Votación sellada en directo', done: 'Todos han votado' },
  'pt-BR': { title: 'Legendas da tela compartilhada', on: 'Legendas ativadas', off: 'Ativar legendas', waiting: 'As legendas aparecem durante a reprodução na tela compartilhada.', film: 'Filme da história', narration: 'Seu anfitrião', paused: 'Legendas pausadas', sealed: 'acusações confirmadas', remaining: 'aguardando', vote: 'Votação sigilosa ao vivo', done: 'Todos já votaram' },
};

function savedPreference(language: string) {
  try { const saved = localStorage.getItem(`dustfall.phoneCaptions.${language}`); if (saved === 'on' || saved === 'off') return saved === 'on'; } catch { /* Optional storage. */ }
  return language !== 'en';
}

/** A silent companion to actual TV playback. It never starts an audio or video element on the phone. */
export function PhoneCaptions({ room, connected }: { room: RoomView; connected: boolean }) {
  const { language } = useLanguage(), labels = copy[language];
  const [enabled, setEnabled] = useState(() => savedPreference(language));
  const { manifest: films } = useMediaManifest('/media/cinematics.json', parseCinematicManifest, enabled && connected);
  const { manifest: voices } = useMediaManifest('/media/narration.json', parseNarrationManifest, enabled && connected);
  const [tick, setTick] = useState(0);
  const serverSample = useRef({ server: room.serverNow ?? 0, received: typeof performance === 'undefined' ? 0 : performance.now() });
  if (serverSample.current.server !== room.serverNow) serverSample.current = { server: room.serverNow ?? 0, received: typeof performance === 'undefined' ? 0 : performance.now() };
  useEffect(() => setEnabled(savedPreference(language)), [language]);
  useEffect(() => {
    if (!enabled || !room.playback?.playing) return;
    const interval = window.setInterval(() => setTick(value => value + 1), 200);
    return () => window.clearInterval(interval);
  }, [enabled, room.playback?.playing]);
  void tick;
  const now = serverSample.current.server + (typeof performance === 'undefined' ? 0 : performance.now() - serverSample.current.received);
  const position = room.serverNow === undefined ? null : playbackPosition(room, connected, now);
  const clip = room.playback?.kind === 'film' ? films?.clips.find(item => item.id === room.playback?.clipId) : voices?.clips.find(item => item.id === room.playback?.clipId);
  const cues = language === 'pt-BR' ? clip?.cues.ptBR : language === 'es' ? clip?.cues.es : clip?.cues.en;
  const caption = enabled && position !== null && cues ? captionAt(cues, position) : '';
  const toggle = () => {
    const next = !enabled; setEnabled(next);
    try { localStorage.setItem(`dustfall.phoneCaptions.${language}`, next ? 'on' : 'off'); } catch { /* Optional storage. */ }
  };
  return <>
    <section className={`phone-captions${caption ? ' has-caption' : ''}`} aria-label={labels.title} lang={language}>
      <button type="button" className="phone-caption-toggle" onClick={toggle} aria-pressed={enabled}><Captions size={18}/><span>{enabled ? labels.on : labels.off}</span>{enabled && <Check size={15}/>}</button>
      {enabled && <div className="phone-caption-copy" aria-live="off">{caption ? <><small><Radio size={12}/>{room.playback?.kind === 'film' ? labels.film : labels.narration}</small><p>{caption}</p></> : <span>{!connected || room.timer.isPaused ? labels.paused : labels.waiting}</span>}</div>}
    </section>
    {room.phase === 'voting' && <section className="phone-live-vote" aria-label={labels.vote}><div><Radio size={15}/><strong key={room.votesCount}>{room.votesCount}<small> / {room.players.length}</small></strong><span>{labels.sealed}</span></div><div className="phone-vote-track" role="progressbar" aria-label={labels.sealed} aria-valuenow={room.votesCount} aria-valuemin={0} aria-valuemax={room.players.length}><i style={{ width: `${100 * room.votesCount / Math.max(1, room.players.length)}%` }}/></div><small>{room.votesCount === room.players.length ? labels.done : `${room.players.length - room.votesCount} ${language === 'es' && room.players.length - room.votesCount === 1 ? 'pendiente' : labels.remaining}`}</small></section>}
  </>;
}
