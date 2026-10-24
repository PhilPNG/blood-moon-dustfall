import { Check, LockKeyhole, Radio, Search } from 'lucide-react';
import { phoneMoves, type PhoneMoveId } from '../../shared/phone-moves';
import type { RoomView } from '../../shared/types';
import { useLanguage } from '../i18n';

const labels = { search: 'Search', share: 'Share clue', answer: 'Case answer' };
const icons = { search: Search, share: Radio, answer: LockKeyhole };

/** Navigation only. Completion always follows the player's server receipts. */
export function PhoneMoves({ room, onNavigate }: { room: RoomView; onNavigate: (id: PhoneMoveId) => void }) {
  const { t } = useLanguage();
  const moves = phoneMoves(room);
  if (!moves) return null;
  const progress = t('{done} of {total} complete', { done: moves.done, total: moves.total });
  return <section className="phone-moves" aria-label={t('Your moves this act')}>
    <div className="phone-moves-heading"><h2>{t('Your moves this act')}</h2><span role="status">{progress}</span></div>
    <div className="phone-moves-progress" role="progressbar" aria-label={t('Your completed moves')} aria-valuemin={0} aria-valuemax={moves.total} aria-valuenow={moves.done} aria-valuetext={progress}><span style={{ width: `${moves.done / moves.total * 100}%` }} /></div>
    <ol>{moves.items.map(move => {
      const Icon = move.status === 'done' ? Check : icons[move.id];
      const status = move.status === 'waiting' ? t('Clue on its way') : move.id === 'share' ? t('{shared}/{total} shared', { shared: move.completed, total: move.total }) : t(move.status === 'done' ? 'Done' : 'To do');
      return <li key={move.id}><button type="button" data-move={move.id} data-status={move.status} aria-label={t('{move}: {status}. Jump to controls', { move: t(labels[move.id]), status })} onClick={() => onNavigate(move.id)}><span className="phone-move-icon" aria-hidden="true"><Icon size={18} /></span><strong>{t(labels[move.id])}</strong><span className="phone-move-status">{status}</span></button></li>;
    })}</ol>
    <p>{t(moves.done === moves.total ? 'All set. Compare evidence and question alibis.' : 'Tap a move to jump to its controls. You decide what to share.')}</p>
  </section>;
}
