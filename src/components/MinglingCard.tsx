import { Check, ChevronDown, MessageCircle, X } from 'lucide-react';
import type { RoomView } from '../../shared/types';
import { minglingCard, minglingStorageKey, type MingleCard, type MinglePrompt } from '../../shared/mingling';
import { usePartyLanguage } from '../party-translations';
import { useLocalPartyFlags } from './party-ui';

const prompts: Record<MinglePrompt, string> = {
  alibi: 'Ask {name} to walk you through their evening. What time can another guest confirm?',
  evidence: 'Compare one public clue with {name}. Do you agree on what it proves?',
  theory: 'Trade theories with {name}. What evidence would change your mind?',
  contradiction: 'Ask {name} which two public facts are hardest to reconcile.',
  timeline: 'Build a short timeline with {name}. Separate confirmed facts from guesses.',
};
export function MinglingCard({ room }: { room: RoomView }) {
  const card = minglingCard(room);
  if (!card) return null;
  const storageKey = minglingStorageKey(room, card.targetId);
  return <Conversation key={storageKey} card={card} storageKey={storageKey}/>;
}
function Conversation({ card, storageKey }: { card: MingleCard; storageKey: string }) {
  const { t, language } = usePartyLanguage();
  const [flags, update] = useLocalPartyFlags(storageKey, ['done','hidden'] as const);
  if (flags.hidden) return <button type="button" className="party-mingle-restore" onClick={() => update('hidden', false)}><MessageCircle size={16}/>{t('Show optional conversation')}<ChevronDown size={15}/></button>;
  return <section className={`party-card party-mingle${flags.done ? ' is-done' : ''}`} lang={language} aria-label={t('Optional table talk')}>
    <div className="party-heading"><span><MessageCircle size={18}/>{t('Optional table talk')}</span><button type="button" className="party-icon" aria-label={t('Hide this card')} onClick={() => update('hidden', true)}><X size={17}/></button></div>
    <h2>{t('Find {name}', { name: card.targetName })}</h2>
    {card.characterName && <span className="party-secondary">{card.characterName}</span>}
    <p>{t(prompts[card.prompt], { name: card.targetName })}</p>
    <label className="party-check"><input type="checkbox" checked={flags.done} onChange={event => update('done', event.target.checked)}/><span>{flags.done && <Check size={15}/>} {t('We talked')}</span></label>
    <small>{t('No points, no required answers. Share only what you choose.')}</small>
  </section>;
}
