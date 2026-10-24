import { useEffect, useId, useRef, useState } from 'react';
import { Bookmark, BookmarkCheck, ChevronDown, Search, X } from 'lucide-react';
import type { RoomView } from '../../shared/types';
import { evidenceStorageKey, filterPublicEvidence, publicEvidence, readEvidencePins, writeEvidencePins, type EvidenceFilter } from '../../shared/evidence-browser';
import { useLanguage } from '../i18n';

function optionalStorage(): Storage | undefined {
  try { return typeof localStorage === 'undefined' ? undefined : localStorage; }
  catch { return undefined; }
}

/** A personal browser over already-public material; it never reads a private dossier or search receipt. */
export function PublicEvidence({ room }: { room: RoomView }) {
  const storageKey = evidenceStorageKey(room);
  return <EvidenceBrowser key={storageKey} room={room} storageKey={storageKey}/>;
}

function EvidenceBrowser({ room, storageKey }: { room: RoomView; storageKey: string }) {
  const { t, language } = useLanguage();
  const searchId = useId();
  const pinnedFilter = useRef<HTMLButtonElement>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<EvidenceFilter>('all');
  const [pins, setPins] = useState(() => readEvidencePins(optionalStorage(), storageKey));
  const [saveFailed, setSaveFailed] = useState(false);
  const [receipt, setReceipt] = useState<{ key: string; pinned: boolean }>();
  const items = publicEvidence(room);
  const shown = filterPublicEvidence(items, filter, query, pins);
  const receiptItem = receipt && items.find(item => item.key === receipt.key);
  const filters: { value: EvidenceFilter; label: string }[] = [
    { value: 'all', label: 'All evidence' }, { value: 'case', label: 'Case evidence' },
    { value: 'shared', label: 'Shared clues' }, { value: 'pinned', label: 'Pinned' },
  ];

  useEffect(() => { setQuery(''); setFilter('all'); setReceipt(undefined); }, [room.round, room.phase]);
  useEffect(() => { setQuery(''); }, [language]);

  function togglePin(key: string, keyboard = false) {
    // Prune obsolete or unknown stored IDs. No clue text is ever persisted.
    const next = new Set(items.filter(item => pins.has(item.key)).map(item => item.key));
    const pinned = !next.has(key);
    if (pinned) next.add(key); else next.delete(key);
    setPins(next);
    setSaveFailed(!writeEvidencePins(optionalStorage(), storageKey, next));
    setReceipt({ key, pinned });
    if (!pinned && filter === 'pinned' && keyboard) pinnedFilter.current?.focus();
  }
  function resetFilters() { setQuery(''); setFilter('all'); }

  return <details className="phone-accordion phone-public-evidence">
    <summary>{t('Review the case evidence')} <span>{items.length}</span><ChevronDown size={18}/></summary>
    <div className="phone-evidence-body">
      {items.length > 0 ? <>
        <div className="phone-evidence-tools">
          <label htmlFor={searchId}>{t('Search public evidence')}</label>
          <div className="phone-evidence-search"><Search size={18} aria-hidden="true"/><input id={searchId} type="search" value={query} maxLength={120} placeholder={t('Title, detail or player name')} onChange={event => setQuery(event.target.value)}/>{query && <button type="button" onClick={() => setQuery('')} aria-label={t('Clear search')}><X size={18}/></button>}</div>
          <div className="phone-evidence-filters" role="group" aria-label={t('Evidence filters')}>{filters.map(option => <button key={option.value} ref={option.value === 'pinned' ? pinnedFilter : undefined} type="button" aria-pressed={filter === option.value} onClick={() => setFilter(option.value)}>{t(option.label)}<span>{filterPublicEvidence(items, option.value, '', pins).length}</span></button>)}</div>
          <p className="phone-evidence-count" role="status">{t('Showing {shown} of {total}', { shown: shown.length, total: items.length })}<span>{t('Pins are personal to this browser.')}</span></p>
        </div>
        {saveFailed && <p className="phone-evidence-save-note" role="status">{t('Pins could not be saved. Keep this evidence panel open.')}</p>}
        <div className="phone-evidence-pin-receipt" role="status">{receiptItem && t(receipt!.pinned ? 'Pinned {title}' : 'Unpinned {title}', { title: receiptItem.title })}</div>
        {shown.map(item => <article className={`phone-evidence-paper${pins.has(item.key) ? ' is-pinned' : ''}`} data-evidence-key={item.key} key={item.key}>
          <div className="phone-evidence-card-top"><span className="phone-kicker">{item.kind === 'case' ? t('AUTOMATIC CASE EVIDENCE') : t('SHARED BY {name} · ACT {round}', { name: item.playerName ?? '', round: item.round ?? 0 })}</span><button type="button" className="phone-evidence-pin" aria-pressed={pins.has(item.key)} aria-label={t(pins.has(item.key) ? 'Unpin {title}' : 'Pin {title}', { title: item.title })} onClick={event => togglePin(item.key, event.detail === 0)}>{pins.has(item.key) ? <BookmarkCheck size={17}/> : <Bookmark size={17}/>}<span>{t(pins.has(item.key) ? 'Unpin' : 'Pin')}</span></button></div>
          <h3>{item.title}</h3><p>{item.text}</p>
        </article>)}
        {shown.length === 0 && <div className="phone-evidence-empty"><Bookmark size={25}/><p>{filter === 'pinned' && !query ? t('Pin evidence cards to keep your shortlist here.') : t('No matching evidence. Try another search or filter.')}</p><button type="button" onClick={resetFilters}>{t('Show all evidence')}</button></div>}
      </> : <p>{t('No public evidence yet. Your host will open the case.')}</p>}
    </div>
  </details>;
}
