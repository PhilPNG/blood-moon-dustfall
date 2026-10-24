import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Eye, Film, Pause, Play, Radio } from 'lucide-react';
import type { RoomView } from '../../shared/types';
import { publicEvidence, type PublicEvidenceItem } from '../../shared/evidence-browser';
import { evidencePage, spotlightEvidence } from '../../shared/stage-presentation';
import { useLanguage } from '../i18n';
import { EvidenceArt } from './GameArt';
import { stageCopy } from './stage-translations';

function PublicCard({ item }: { item: PublicEvidenceItem }) {
  const { language } = useLanguage(), labels = stageCopy[language];
  return <article className="stage-large-evidence"><EvidenceArt text={`${item.title} ${item.text}`}/><div><span className="stage-kicker">{item.kind === 'case' ? labels.case : `${labels.shared} · ${item.playerName ?? ''}`}</span><h2>{item.title}</h2><p>{item.text}</p></div></article>;
}

export function StageSpotlight({ room, blocked }: { room: RoomView; blocked: boolean }) {
  const { language } = useLanguage(), labels = stageCopy[language];
  const item = spotlightEvidence(room, blocked);
  if (!item) return null;
  return <main className="stage-spotlight-layout" lang={language}><div className="stage-spotlight-heading"><span className="stage-kicker"><Eye size={22}/>{labels.spotlight}</span><p>{labels.together}</p></div><PublicCard key={`${room.spotlight?.serial}:${item.key}`} item={item}/></main>;
}

export function DistanceInvestigation({ room, blocked }: { room: RoomView; blocked: boolean }) {
  const { language } = useLanguage(), labels = stageCopy[language];
  const items = publicEvidence(room), key = items.map(item => item.key).join('|');
  const [page, setPage] = useState(0), [selected, setSelected] = useState(''), [rotating, setRotating] = useState(true);
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches); query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useEffect(() => { setPage(Math.max(0, Math.ceil(items.length / 3) - 1)); setSelected(items.at(-1)?.key ?? ''); }, [key]);
  const pages = Math.max(1, Math.ceil(items.length / 3)), cards = evidencePage(items, page, 3);
  const featured = items.find(item => item.key === selected) ?? cards[0] ?? items.at(-1);
  const held = blocked || room.timer.isPaused || reduced || !rotating;
  useEffect(() => {
    if (held || items.length <= 1) return;
    const interval = window.setInterval(() => { const next = (page + 1) % pages; setPage(next); setSelected(evidencePage(items, next, 3)[0]?.key ?? ''); }, 14_000);
    return () => window.clearInterval(interval);
  }, [held, key, pages, page]);
  function move(direction: number) { const next = (page + direction + pages) % pages; setPage(next); setSelected(evidencePage(items, next, 3)[0]?.key ?? ''); }
  return <main className="stage-distance-layout" lang={language} data-rotation-seconds="14"><section className="stage-distance-intro"><span className="stage-kicker">{labels.distance} · {room.round}/{room.settings.rounds}</span><h1>{room.act?.title.replace(/^Act [IVX\d]+\s*[·:—–-]\s*/i, '')}</h1><p><strong>{labels.discuss}</strong>{room.act?.prompt}</p></section>
    {featured ? <PublicCard item={featured}/> : <div className="stage-distance-empty">{labels.empty}</div>}
    <section className="stage-distance-pager" aria-label={labels.evidence}><div className="stage-distance-thumbnails">{cards.map(item => <button key={item.key} aria-pressed={featured?.key === item.key} onClick={() => { setSelected(item.key); setRotating(false); }}><span>{item.kind === 'case' ? labels.case : labels.shared}</span><strong>{item.title}</strong></button>)}</div><div className="stage-distance-page-controls"><button aria-label={labels.previous} disabled={pages <= 1} onClick={() => move(-1)}><ArrowLeft/></button><span>{page % pages + 1} / {pages}</span><button aria-label={labels.next} disabled={pages <= 1} onClick={() => move(1)}><ArrowRight/></button><button aria-pressed={rotating} onClick={() => setRotating(value => !value)}>{rotating ? <Pause/> : <Play/>}{rotating ? labels.pause : labels.resume}</button><small>{held ? labels.held : labels.pace}</small></div></section>
    {room.act?.question && <section className="stage-distance-question"><span className="stage-kicker">{labels.question}</span><h2>{room.act.question.prompt}</h2><ol>{room.act.question.options.map(option => <li key={option.id}>{option.text}</li>)}</ol></section>}
  </main>;
}

export function StagePreflightStatus({ room }: { room: RoomView }) {
  const { language } = useLanguage(), labels = stageCopy[language];
  if (room.phase !== 'lobby' || !room.preflight) return null;
  return <aside className="stage-preflight-status" role="status" lang={language}><Film size={22}/><div><strong>{room.preflight.completed ? labels.testReady : labels.test}</strong><p>{room.preflight.completed ? labels.testConfirm : labels.testPending}</p></div><Radio size={18}/></aside>;
}
