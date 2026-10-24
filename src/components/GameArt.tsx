import { useState, type CSSProperties, type ReactNode } from 'react';
import { CHARACTERS, characterById, entrySeal, type CharacterProfile } from '../../shared/characters';
import type { PlayerView } from '../../shared/types';

export function playerCharacter(player: PlayerView, fallbackIndex = 0): CharacterProfile {
  return characterById(player.characterId || '') || CHARACTERS.find(character => character.name === player.roleName) || CHARACTERS[fallbackIndex % CHARACTERS.length];
}
export function CharacterPortrait({ character, className = '', decorative = false }: { character: CharacterProfile; className?: string; decorative?: boolean }) {
  const [failed, setFailed] = useState(false);
  return <div className={`dustfall-portrait ${className}`} style={{ '--portrait-color': character.color } as CSSProperties}>
    <svg className="dustfall-portrait-fallback" viewBox="0 0 200 220" aria-hidden="true"><circle cx="160" cy="43" r="26" fill="currentColor" opacity=".25"/><path d="M16 220c2-56 43-77 84-77s82 21 84 77M61 89c0-50 78-50 78 0v23c0 53-78 53-78 0" fill="#211536"/><path d="m35 77 40-14 9-36 36 4 12 33 35 13c-24 19-108 20-132 0" fill="#211536"/><path d="m72 139 27 19 30-19-10 48-20-15-20 15" fill="currentColor" opacity=".7"/><path d="m38 35 3 8 9 1-7 6 2 9-7-5-8 5 2-9-7-6 10-1" fill="currentColor"/></svg>
    {!failed && <img src={character.portrait} alt={decorative ? '' : character.name} onError={() => setFailed(true)} loading="eager"/>}
  </div>;
}
export function DustfallLogo({ large = false }: { large?: boolean }) {
  return <div className={`stage-logo${large ? ' stage-logo-large' : ''}`} aria-label="Blood Moon over Dustfall"><span>Blood Moon</span><small>over</small><strong>Dustfall</strong></div>;
}
export function StageArt() {
  return <div className="dustfall-stage-art" aria-hidden="true"><div className="stage-art-background"/><div className="stage-native-moon"/><div className="stage-beam"/>{Array.from({ length: 12 }, (_, i) => <i className="stage-mote" key={i} style={{ '--mote': i } as CSSProperties}/>)}<div className="stage-art-grain"/></div>;
}
export function EvidenceArt({ text, small = false }: { text: string; small?: boolean }) {
  const kind = /coil|burn|revolver|shot|clock|strike/i.test(text) ? 'coil' : /registry|gallery|tape|seal|star|telegraph|lantern|offer|bargain/i.test(text) ? 'signal' : 'core';
  return <div className={`stage-prop stage-prop-${kind}${small ? ' stage-prop-small' : ''}`}><img src={`/assets/evidence-${kind}.webp`} alt="" onError={event => { event.currentTarget.style.display = 'none'; }}/><span aria-hidden="true">{kind === 'coil' ? 'ϟ' : kind === 'signal' ? '✧' : '◈'}</span></div>;
}

/** Public, spoiler-safe admission seals let every player compare the independent clue traces. */
export function PublicSeal({ characterId }: { characterId: string }) {
  const seal = entrySeal(characterId);
  const color = { Mint: '#A5FFCE', Coral: '#FF6B87', Gold: '#FFE178', Violet: '#C6A1EF' }[seal.color];
  const paths: Record<string, ReactNode> = {
    Cactus: <><path d="M12 21V5a3 3 0 0 0-6 0v8M6 11H4a2 2 0 0 1-2-2V6m10 9h4a3 3 0 0 0 3-3V8M8 21h8"/></>,
    Comet: <><circle cx="8" cy="16" r="5"/><path d="m11 11 9-9m-5 12 6-6M9 6l4-4"/></>,
    Spur: <><path d="m12 2 2 6 6-2-2 6 4 4-7 1-3 5-3-5-7-1 4-4-2-6 6 2z"/><circle cx="12" cy="12" r="2"/></>,
    Sun: <><circle cx="12" cy="12" r="4"/><path d="M12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/></>,
    Eye: <><path d="M1 12S5 5 12 5s11 7 11 7-4 7-11 7S1 12 1 12Z"/><circle cx="12" cy="12" r="3"/></>,
  };
  return <span className={`stage-entry-seal seal-${seal.color.toLowerCase()}`} style={{ '--seal-color': color } as CSSProperties} aria-label={`Public admission seal: ${seal.label}`}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[seal.symbol]}</svg><span>{seal.color} <b>{seal.symbol}</b></span></span>;
}
