import { CHARACTERS } from './characters.js';

export type Gender = 'any' | 'woman' | 'man' | 'nonbinary';
export type Phase = 'lobby' | 'roles' | 'investigation' | 'voting' | 'results';
export type CaptionLanguage = 'off' | 'en' | 'es' | 'pt-BR';
export interface MediaPlayback { eventKey: string; clipId: string; kind: 'film' | 'narration'; position: number; playing: boolean; updatedAt: number; displayId: string }
export type MediaPlaybackReport = Omit<MediaPlayback, 'updatedAt' | 'displayId'>;
export interface DisplayCapability { code: string; displayId: string; token?: string; expiresAt: number; active: boolean }
export interface Presentation { serial: number; eventKey: string; control: 'skip' | 'replay' }
export interface Attention { id: number; eventKey: string; cue: 'phase' | 'clue' | 'timer-warning' | 'lobby'; endsAt: number | null; remainingMs: number }
export interface Settings { rounds: number; roundSeconds: number; maxPlayers: number }
export interface Role {
  name: string; gender: Gender; alignment: 'culprit' | 'innocent'; brief: string; objective: string;
  characterId?: string; background?: string; secret?: string; alibi?: string; objectives?: string[];
  relationships?: { name: string; detail: string }[]; roleplayTip?: string;
}
export interface Clue { id: string; title: string; text: string; round: number; playerId: string; playerName: string; published: boolean }
export interface PlayerView { id: string; name: string; gender: Gender; connected: boolean; ready: boolean; roleName?: string; characterId?: string; hasVoted?: boolean; isDemo?: boolean }
export type SessionKind = 'master' | 'player';
export interface GameMasterView {
  id: string; name: string; connected: boolean; epoch: number;
  backupPlayerId?: string; takeoverAt?: number; eligiblePlayerId?: string;
  handoff?: { playerId: string; expiresAt: number };
}
export interface CaseEvidence { id: string; title: string; text: string }
export interface SearchLocation { id: string; label: string; description: string }
export interface CaseQuestion { id: string; prompt: string; options: { id: string; text: string }[] }
export interface InvestigationAct { title: string; narration: string; prompt: string; evidence: CaseEvidence[]; locations: SearchLocation[]; question: CaseQuestion }
export interface QuestionResult { round: number; correctOptionId: string; explanation: string; counts: Record<string, number> }
export interface PreviousAnswer { round: number; optionId: string; text: string; correct: boolean }
export interface SearchResult { locationId: string; title: string; text: string }
export interface CaseSolution { headline: string; summary: string; method: string; motive: string; timeline: { time: string; text: string }[] }
export interface PlayerScore { playerId: string; score: number; correctAnswers: number; cluesShared: number; searches: number; correctAccusation: boolean }
export interface Result { culpritId: string; tallies: Record<string, number>; caught: boolean; solution?: CaseSolution; scores?: PlayerScore[] }
export interface RoomView {
  attention?: Attention;
  actionEpoch?: number;
  serverNow?: number;
  playback?: MediaPlayback;
  playbackEpoch?: number;
  notice?: string;
  gameId?: string;
  presentation?: Presentation;
  captionLanguage?: CaptionLanguage;
  captionSerial?: number;
  masterReady?: boolean;
  gameMaster?: GameMasterView;
  expiresAt?: number;
  rehearsal?: boolean;
  revision?: number;
  code: string; phase: Phase; round: number; settings: Settings; players: PlayerView[]; isLocked: boolean;
  timer: { startsAt?: number | null; endsAt: number | null; remaining: number; isPaused: boolean };
  clues: Clue[]; votesCount: number; result?: Result;
  act?: InvestigationAct; suspicions?: Record<string, number>; answerCount?: number; searchCount?: number; questionResult?: QuestionResult;
  me?: {
    playerId: string; role?: Role; clues: Clue[]; votedFor: string | null; ready: boolean;
    search?: SearchResult; answeredOptionId?: string; suspicionId?: string | null; score?: number;
    previousAnswer?: PreviousAnswer;
  };
  isMaster: boolean;
}
export type Action =
  | { type: 'settings'; settings: Partial<Settings> }
  | { type: 'lock'; locked: boolean }
  | { type: 'kick'; playerId: string }
  | { type: 'set-gender'; playerId: string; gender: Gender }
  | { type: 'set-role'; playerId: string; roleName: string }
  | { type: 'start' } | { type: 'advance' } | { type: 'pause' } | { type: 'resume' } | { type: 'extend-time' }
  | { type: 'presentation'; control: Presentation['control'] }
  | { type: 'captions'; language: CaptionLanguage }
  | { type: 'reset' } | { type: 'ready'; ready: boolean }
  | { type: 'publish-clue'; clueId: string } | { type: 'vote'; playerId: string }
  | { type: 'search'; locationId: string } | { type: 'answer'; optionId: string } | { type: 'suspect'; playerId: string }
  | { type: 'demo-fill' };
export interface Session { code: string; token: string; playerId?: string; recoveryCode?: string; recoveryRevision?: number; name?: string; characterName?: string; expiresAt?: number; updatedAt?: number }
export interface PairingTicket { code: string; ticket: string; expiresAt: number }
export interface Reply<T = undefined> { ok: boolean; data?: T; error?: string; errorCode?: string }
export const GENDERS: { value: Gender; label: string }[] = [
  { value: 'any', label: 'Either' }, { value: 'woman', label: 'Woman' }, { value: 'man', label: 'Man' }, { value: 'nonbinary', label: 'Flexible (legacy)' },
];
export const ROLE_NAMES = CHARACTERS.map(character => character.name);
export const PHASES: { id: Phase; label: string; description: string }[] = [
  { id: 'lobby', label: 'Gather the suspects', description: 'Phones out. Secrets in.' },
  { id: 'roles', label: 'Meet your character', description: 'A private role for every player.' },
  { id: 'investigation', label: 'Follow the evidence', description: 'Share clues. Question everything.' },
  { id: 'voting', label: 'Make an accusation', description: 'One vote. Trust your instincts.' },
  { id: 'results', label: 'The truth comes out', description: 'Find out who got away with it.' },
];
