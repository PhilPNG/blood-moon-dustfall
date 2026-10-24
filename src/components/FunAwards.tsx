import { useId, useState } from 'react';
import { Award, CheckCheck, LockKeyhole, Trophy } from 'lucide-react';
import type { Action, PartyAwardCategory, PartyAwardChoices, RoomView } from '../../shared/types';
import { usePartyLanguage } from '../party-translations';
import { usePartyAction } from './party-ui';
import { stageCopy } from './stage-translations';

export type FunAwardsProps = { room: RoomView; connected: boolean; disabled?: boolean; onAction?: (action: Action) => Promise<void>; variant?: 'phone' | 'host' };
const categories: PartyAwardCategory[] = ['poker-face','in-character','wild-accusation'];
const categoryNames: Record<PartyAwardCategory, string> = { 'poker-face': 'Best Poker Face', 'in-character': 'Best in Character', 'wild-accusation': 'Wildest Accusation' };

export function FunAwards(props: FunAwardsProps) {
  const { room } = props;
  if (room.phase !== 'results' || (!room.partyAwards && (!room.isMaster || props.variant === 'host'))) return null;
  const identity = JSON.stringify([room.code, room.gameId ?? null, room.actionEpoch ?? 0, room.me?.playerId ?? null, room.partyAwards?.id ?? null]);
  return <Awards key={identity} {...props}/>;
}
function Awards({ room, connected, disabled = false, onAction, variant = 'phone' }: FunAwardsProps) {
  const { t, language } = usePartyLanguage();
  const { run, busy, error } = usePartyAction(onAction);
  const id = useId();
  const [confirmReveal, setConfirmReveal] = useState(false);
  const [review, setReview] = useState(false);
  const [choices, setChoices] = useState<Partial<PartyAwardChoices>>({});
  const [submitted, setSubmitted] = useState<PartyAwardChoices>();
  const awards = room.partyAwards;
  const name = (playerId: string) => room.players.find(player => player.id === playerId)?.name ?? t('Player');
  const nominees = room.players.filter(player => player.id !== room.me?.playerId);
  const canOpen = room.players.length >= 2 && room.players.some(player => !player.isDemo);
  const voter = room.me && room.players.find(player => player.id === room.me!.playerId && !player.isDemo);
  const unavailable = disabled || !connected || busy || !onAction;
  const ownChoices = room.me?.partyAwardChoices ?? submitted;
  const complete = categories.every(category => nominees.some(player => player.id === choices[category]));
  const publicOnly = variant === 'host' || !voter || room.isMaster;
  const intro = <p>{t('A little applause after the verdict. These votes never change the case or scores.')}</p>;
  async function reveal() {
    if (!awards) return;
    if (awards.submittedCount < awards.eligibleCount) setConfirmReveal(true);
    else await run({ type: 'awards-reveal', awardsId: awards.id });
  }
  async function submit() {
    if (!awards || !complete) return;
    const ballot = { 'poker-face': choices['poker-face']!, 'in-character': choices['in-character']!, 'wild-accusation': choices['wild-accusation']! };
    if (await run({ type: 'award-vote', awardsId: awards.id, choices: ballot })) { setSubmitted(ballot); setReview(false); }
  }
  return <section className={`party-card party-awards party-awards--${variant}`} lang={language} aria-label={t('Party awards')}>
    <div className="party-heading"><h2><Trophy size={21}/>{t('Party awards')}</h2></div>
    {intro}
    {(!awards || awards.status === 'skipped') && room.isMaster && variant !== 'host' && <><button type="button" className="party-button" disabled={unavailable || !canOpen} onClick={() => void run({ type: 'awards-open' })}><Award size={17}/>{t(busy ? 'Saving…' : awards ? 'Reopen party awards' : 'Open party awards')}</button>{!canOpen && <p className="party-secondary">{t('At least one real player and another cast member are needed.')}</p>}</>}
    {awards?.status === 'skipped' && <p className="party-secondary">{t('Party awards were skipped.')}</p>}
    {awards?.status === 'voting' && <>
      <p className="party-award-participation" role="status"><LockKeyhole size={16}/>{t('{submitted} of {eligible} party ballots sealed', { submitted: awards.submittedCount, eligible: awards.eligibleCount })}</p>
      {room.isMaster && variant !== 'host' ? <>
        {!confirmReveal ? <div className="party-actions"><button type="button" className="party-button" disabled={unavailable} onClick={() => void reveal()}>{t('Reveal awards')}</button><button type="button" className="party-button secondary" disabled={unavailable} onClick={() => void run({ type: 'awards-skip', awardsId: awards.id })}>{t('Skip party awards')}</button></div>
          : <div className="party-confirm" role="group" aria-label={t('Reveal before everyone votes?')}><h3>{t('Reveal before everyone votes?')}</h3><p>{t('Some guests have not submitted. Revealing closes their ballot.')}</p><div className="party-actions"><button type="button" className="party-button" disabled={unavailable} onClick={() => void run({ type: 'awards-reveal', awardsId: awards.id })}>{t('Reveal submitted ballots')}</button><button type="button" className="party-button secondary" disabled={busy} onClick={() => setConfirmReveal(false)}>{t('Keep voting open')}</button></div></div>}
      </> : !publicOnly && onAction ? ownChoices ? <div className="party-award-receipt"><CheckCheck size={26}/><h3>{t('Your party ballot is sealed')}</h3><p>{t('Choices stay private until the GM reveals the awards.')}</p><dl>{categories.map(category => <div key={category}><dt>{t(categoryNames[category])}</dt><dd>{name(ownChoices[category])}</dd></div>)}</dl></div>
        : <form className="party-award-ballot" onSubmit={event => { event.preventDefault(); if (complete) setReview(true); }}>
          {!review ? <><p className="party-secondary">{t('Choose another cast member for each award. The same person may win more than one.')}</p><fieldset disabled={unavailable}>{categories.map(category => <label className="party-field" key={category} htmlFor={`${id}-${category}`}>{t(categoryNames[category])}<select id={`${id}-${category}`} value={choices[category] ?? ''} required onChange={event => setChoices(previous => ({ ...previous, [category]: event.target.value }))}><option value="">{t('Choose a guest')}</option>{nominees.map(player => <option value={player.id} key={player.id}>{player.name}{player.isDemo ? ` · ${t('Sample player')}` : ''}{player.roleName ? ` · ${player.roleName}` : ''}</option>)}</select></label>)}<button type="submit" className="party-button" disabled={!complete}>{t('Review my party ballot')}</button></fieldset></>
            : <div className="party-confirm"><dl>{categories.map(category => <div key={category}><dt>{t(categoryNames[category])}</dt><dd>{name(choices[category]!)}</dd></div>)}</dl><p>{t('These three choices are final once submitted.')}</p><div className="party-actions"><button type="button" className="party-button" disabled={unavailable || !complete} onClick={() => void submit()}><LockKeyhole size={17}/>{t(busy ? 'Saving…' : 'Seal my party ballot')}</button><button type="button" className="party-button secondary" disabled={busy} onClick={() => setReview(false)}>{t('Change my choices')}</button></div></div>}
        </form> : variant === 'host' ? <div className="party-award-categories">{categories.map(category => <article className="party-award-category" key={category}><Award size={38}/><h3>{t(categoryNames[category])}</h3><p>{stageCopy[language].awardsVote}</p></article>)}</div> : <p className="party-secondary">{t('Waiting for the players’ party ballots.')}</p>}
    </>}
    {awards?.status === 'revealed' && <div className="party-award-winners">{categories.map(category => {
      const result = awards.results?.find(item => item.category === category);
      const winners = result?.winnerIds ?? [];
      return <article key={category}><Award size={25}/><span>{t(categoryNames[category])}</span><h3>{winners.length ? winners.map(name).join(' · ') : t('No votes in this category')}</h3>{winners.length > 0 && <small>{t(winners.length > 1 ? 'Tied winners' : 'Winner')}</small>}{result && <details><summary>{t('See vote totals')}</summary><ul>{room.players.filter(player => (result.tallies[player.id] ?? 0) > 0).sort((a,b) => (result.tallies[b.id] ?? 0) - (result.tallies[a.id] ?? 0)).map(player => <li key={player.id}><span>{player.name}</span><strong>{result.tallies[player.id]}</strong></li>)}</ul></details>}</article>;
    })}</div>}
    {error && <p className="party-error" role="alert">{t(error)}</p>}
  </section>;
}
