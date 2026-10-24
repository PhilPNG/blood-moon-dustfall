import { type Attention, type CaptionLanguage, type Clue, type DisplayCapability, type Gender, type MediaPlayback, type MediaPlaybackReport, type PartyAwardCategory, type PartyAwardChoices, type PartyAwards, type Phase, type Presentation, type PreviousAnswer, type QuestionResult, type Result, type Role, type RoomView, type SearchResult, type Session, type Settings, type StageSettings } from '../shared/types.js';
import { attentionActive, attentionEventKey, attentionRemainingMs } from '../shared/attention.js';
import { CHARACTERS, characterById, type CharacterProfile } from '../shared/characters.js';
import { DISPLAY_CAPABILITY_MS, DISPLAY_LEASE_MS, MEDIA_DURATIONS, playbackEventKey, playbackMatchesRoom, PLAYBACK_STALE_MS } from '../shared/media-sync.js';
import { publicEvidence } from '../shared/evidence-browser.js';
import { preflightEvent } from '../shared/stage-presentation.js';
import { getAct, getQuestion, makeClue, privateDossier, searchClue, solution } from './story.js';

const ROOM_LIFETIME = 12 * 60 * 60 * 1000;
const VALID_GENDERS = new Set<Gender>(['any', 'woman', 'man', 'nonbinary']);
const MASTER_ACTIONS = new Set(['settings', 'lock', 'kick', 'set-gender', 'set-role', 'start', 'advance', 'pause', 'resume', 'extend-time', 'reset', 'demo-fill', 'presentation', 'captions', 'stage-settings', 'spotlight', 'preflight-test', 'awards-open', 'awards-reveal', 'awards-skip']);
const DEFAULT_STAGE_SETTINGS: StageSettings = { distanceMode: false, musicEnabled: false, musicVolume: 25 };
const AWARD_CATEGORIES: PartyAwardCategory[] = ['poker-face', 'in-character', 'wild-accusation'];
type Player = { id: string; token: string; name: string; gender: Gender; ready: boolean; assignedRole?: string; role?: Role; clues: Clue[]; votedFor: string | null; demo: boolean; connections: Set<string>; score: number; correctAnswers: number; cluesShared: number; searches: number; search?: SearchResult; answeredOptionId?: string; previousAnswer?: PreviousAnswer; suspicionId: string | null };
type Room = { stageSettings?: StageSettings; spotlight?: RoomView['spotlight']; spotlightSerial?: number; preflight?: RoomView['preflight']; partyAwards?: { id: number; status: PartyAwards['status']; ballots: Record<string, PartyAwardChoices> }; partyAwardSerial?: number; actionEpoch?: number; attention?: Attention; attentionSerial?: number; attentionClaims?: { eventKey: string; clue?: Attention; 'timer-warning'?: Attention; lobby?: Attention }; attentionClueBaseline?: string[]; startsAt?: number | null; code: string; masterToken: string; createdAt: number; rehearsal: boolean; phase: Phase; round: number; settings: Settings; players: Map<string, Player>; isLocked: boolean; endsAt: number | null; remainingMs: number; isPaused: boolean; result?: Result; questionResult?: QuestionResult; notice?: string; gameId?: string; presentation?: Presentation; captionLanguage?: CaptionLanguage; captionSerial?: number; playback?: MediaPlayback; playbackEpoch?: number; display?: { id: string; token: string; expiresAt: number; leaseUntil: number; sequence: number } };
type Connection = { code: string; token?: string };
/** Private durable state: never send this snapshot to a browser. */
type ArcadePlayerFields = 'score' | 'correctAnswers' | 'cluesShared' | 'searches' | 'search' | 'answeredOptionId' | 'suspicionId';
export type RoomSnapshot = Omit<Room, 'players' | 'rehearsal'> & { rehearsal?: boolean; players: (Omit<Player, 'connections' | ArcadePlayerFields> & Partial<Pick<Player, ArcadePlayerFields>>)[] };
export interface EngineOptions { now?: () => number; maxRooms?: number }

function randomBytes(length: number): { toString(encoding: 'hex'): string } {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return { toString: () => [...bytes].map(value => value.toString(16).padStart(2, '0')).join('') };
}
function randomInt(max: number): number {
  const limit = Math.floor(0x100000000 / max) * max;
  let value: number;
  do { value = crypto.getRandomValues(new Uint32Array(1))[0]; } while (value >= limit);
  return value % max;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label}.`);
  return value as Record<string, unknown>;
}
function str(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid ${label}.`);
  return value;
}
function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`Invalid ${label}.`);
  return value;
}
function gender(value: unknown): Gender {
  if (!VALID_GENDERS.has(value as Gender)) throw new Error('Choose a valid character gender.');
  return value as Gender;
}
function token(): string { return randomBytes(24).toString('hex'); }
function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/** Authoritative state. Views always contain copies and never contain bearer tokens. */
export class GameEngine {
  private rooms = new Map<string, Room>();
  private connections = new Map<string, Connection>();
  private now: () => number;
  private maxRooms: number;

  constructor(options: EngineOptions = {}) {
    this.now = options.now ?? Date.now;
    this.maxRooms = options.maxRooms ?? 500;
    if (!Number.isInteger(this.maxRooms) || this.maxRooms < 1 || this.maxRooms > 10000) throw new Error('Invalid room capacity.');
  }

  exportRoom(code: unknown): RoomSnapshot {
    const room = this.room(code);
    return structuredClone({ ...room, players: [...room.players.values()].map(({ connections: _connections, ...player }) => player) });
  }

  restoreRoom(snapshot: RoomSnapshot): void {
    const copy = structuredClone(snapshot);
    const room: Room = { ...copy, actionEpoch: copy.actionEpoch ?? 0, rehearsal: copy.rehearsal === true, captionLanguage: copy.captionLanguage ?? 'off', settings: Object.assign({ rounds: 3, roundSeconds: 300, maxPlayers: 20 }, copy.settings), players: new Map(copy.players.map(player => [player.id, { ...player, score: player.score ?? 0, correctAnswers: player.correctAnswers ?? 0, cluesShared: player.cluesShared ?? 0, searches: player.searches ?? 0, suspicionId: player.suspicionId ?? null, connections: new Set<string>() }])) };
    const obsoleteCast = copy.phase !== 'lobby' && [...room.players.values()].some(player => {
      if (!player.role) return true;
      // A modern named role without an id can be upgraded; archetype-era roles cannot.
      const character = player.role.characterId
        ? characterById(player.role.characterId)
        : CHARACTERS.find(candidate => candidate.name === player.role!.name);
      if (!character || character.name !== player.role.name) return true;
      player.role.characterId = character.id;
      return false;
    });
    for (const player of room.players.values()) {
      if (player.assignedRole && !CHARACTERS.some(character => character.name === player.assignedRole)) delete player.assignedRole;
    }
    if (obsoleteCast) {
      this.resetRoom(room);
      room.notice = 'Dustfall has been upgraded. Your seats are saved; the game master can deal the new cast.';
    }
    this.rooms.set(copy.code, room);
  }

  create(payload: unknown = {}): Session {
    const data = object(payload, 'room request');
    if (Object.keys(data).some(key => key !== 'rehearsal')) throw new Error('Invalid room request.');
    if (data.rehearsal !== undefined && typeof data.rehearsal !== 'boolean') throw new Error('Choose a valid rehearsal mode.');
    this.sweep();
    if (this.rooms.size >= this.maxRooms) throw new Error('Room capacity reached. Try again later.');
    let code: string;
    do { code = Array.from({ length: 4 }, () => String.fromCharCode(65 + randomInt(26))).join(''); } while (this.rooms.has(code));
    const masterToken = token();
    this.rooms.set(code, { actionEpoch: 0, code, masterToken, createdAt: this.now(), rehearsal: data.rehearsal === true, phase: 'lobby', round: 0, settings: { rounds: 3, roundSeconds: 300, maxPlayers: 20 }, players: new Map(), isLocked: false, endsAt: null, remainingMs: 0, isPaused: false, captionLanguage: 'off' });
    return { code, token: masterToken };
  }

  join(payload: unknown): Session {
    const data = object(payload, 'join request');
    const room = this.room(data.code);
    const rawName = str(data.name, 'name');
    if (/[\u0000-\u001f\u007f]/u.test(rawName)) throw new Error('Names cannot contain control characters.');
    const name = rawName.normalize('NFKC').trim().replace(/\s+/gu, ' ');
    if (!name || name.length > 24) throw new Error('Use a name with 1–24 characters.');
    const preference = gender(data.gender);
    if (room.phase !== 'lobby') throw new Error('This game has already started.');
    if (room.isLocked) throw new Error('This room is locked.');
    if (room.players.size >= room.settings.maxPlayers) throw new Error('This room is full.');
    if ([...room.players.values()].some(player => player.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error('That name is already taken.');
    const player: Player = { id: randomBytes(12).toString('hex'), token: token(), name, gender: preference, ready: false, clues: [], votedFor: null, demo: false, connections: new Set(), score: 0, correctAnswers: 0, cluesShared: 0, searches: 0, suspicionId: null };
    this.validateDeck([...room.players.values(), player]);
    room.players.set(player.id, player);
    return { code: room.code, token: player.token, playerId: player.id };
  }

  view(code: unknown, bearer?: unknown): RoomView {
    const room = this.room(code);
    const identity = this.identity(room, bearer);
    const players = [...room.players.values()];
    const view: RoomView = {
      code: room.code, actionEpoch: room.actionEpoch ?? 0, rehearsal: room.rehearsal, phase: room.phase, round: room.round, settings: { ...room.settings },
      players: players.map(player => {
        const character = CHARACTERS.find(character => character.id === player.role?.characterId || character.name === (player.role?.name ?? player.assignedRole));
        return { id: player.id, name: player.name, gender: player.gender, connected: player.demo || player.connections.size > 0, ready: player.ready,
          ...(player.demo ? { isDemo: true } : {}),
          ...(room.phase === 'voting' || room.phase === 'results' ? { hasVoted: player.votedFor !== null } : {}),
          ...(player.role || player.assignedRole ? { roleName: player.role?.name ?? player.assignedRole } : {}),
          ...(character ? { characterId: character.id } : {}) };
      }),
      isLocked: room.isLocked, timer: { ...(typeof room.startsAt === 'number' && room.startsAt > this.now() ? { startsAt: room.startsAt } : {}), endsAt: room.endsAt, remaining: Math.ceil(this.remaining(room) / 1000), isPaused: room.isPaused },
      clues: players.flatMap(player => player.clues.filter(clue => clue.published)),
      votesCount: players.filter(player => player.votedFor !== null).length,
      isMaster: identity === 'master',
      ...(room.notice ? { notice: room.notice } : {}),
      ...(room.gameId ? { gameId: room.gameId } : {}),
      ...(room.presentation ? { presentation: room.presentation } : {}),
      captionLanguage: room.captionLanguage ?? 'off',
      captionSerial: room.captionSerial ?? 0,
      stageSettings: { ...DEFAULT_STAGE_SETTINGS, ...room.stageSettings },
      displayConnected: !!room.display && room.display.leaseUntil > this.now() && room.display.expiresAt > this.now(),
      ...(room.spotlight ? { spotlight: room.spotlight } : {}),
      ...(room.preflight ? { preflight: room.preflight } : {}),
      serverNow: this.now(),
      ...(room.attention ? { attention: room.attention } : {}),
      ...(room.playbackEpoch !== undefined ? { playbackEpoch: room.playbackEpoch } : {}),
    };
    if (room.playback && this.now() - room.playback.updatedAt < PLAYBACK_STALE_MS && playbackMatchesRoom(view, room.playback)) view.playback = room.playback;
    if (room.phase === 'investigation' || room.phase === 'voting' || room.phase === 'results') {
      const storyRound = this.storyRound(room);
      const culpritCharacterId = this.culpritCharacterId(room);
      const act = getAct(storyRound, culpritCharacterId);
      const question = getQuestion(storyRound);
      // Automatic case evidence accumulates, including the complete chain in shortened games.
      const evidence = new Map<string, { id: string; title: string; text: string }>();
      for (let round = 1; round <= storyRound; round++) for (const item of getAct(round, culpritCharacterId).evidence) evidence.set(item.id, { id: item.id, title: item.title, text: item.text });
      view.act = { title: act.title, narration: act.narration, prompt: act.prompt, evidence: [...evidence.values()], locations: act.locations.map(location => ({ id: location.id, label: location.label, description: location.description })), question: { id: question.id, prompt: question.prompt, options: question.options.map(option => ({ id: option.id, text: option.text })) } };
      if (room.phase === 'investigation') {
        view.suspicions = Object.fromEntries(players.map(player => [player.id, players.filter(other => other.suspicionId === player.id).length]));
        view.answerCount = players.filter(player => player.answeredOptionId !== undefined).length;
        view.searchCount = players.filter(player => player.search !== undefined).length;
      }
    }
    if (room.questionResult) view.questionResult = room.questionResult;
    if (room.result) view.result = room.result;
    if (room.partyAwards) {
      const { id, status, ballots } = room.partyAwards;
      view.partyAwards = { id, status, submittedCount: Object.keys(ballots).length, eligibleCount: players.filter(player => !player.demo).length };
      if (status === 'revealed') view.partyAwards.results = AWARD_CATEGORIES.map(category => {
        const tallies: Record<string, number> = Object.fromEntries(players.map(player => [player.id, 0]));
        for (const choices of Object.values(ballots)) tallies[choices[category]] += 1;
        const highest = Math.max(0, ...Object.values(tallies));
        return { category, tallies, winnerIds: highest > 0 ? Object.keys(tallies).filter(id => tallies[id] === highest) : [] };
      });
    }
    if (identity && identity !== 'master') view.me = { playerId: identity.id, ...(identity.role ? { role: identity.role } : {}), clues: identity.clues, votedFor: identity.votedFor, ready: identity.ready, ...(identity.search ? { search: identity.search } : {}), ...(identity.answeredOptionId !== undefined ? { answeredOptionId: identity.answeredOptionId } : {}), ...(identity.previousAnswer ? { previousAnswer: identity.previousAnswer } : {}), suspicionId: identity.suspicionId, score: identity.score };
    if (view.me && room.partyAwards?.ballots[view.me.playerId]) view.me.partyAwardChoices = room.partyAwards.ballots[view.me.playerId];
    return structuredClone(view);
  }

  /** Authenticate only the caller's existing identity; never look it up by display name. */
  session(code: unknown, bearer: unknown): Session {
    const room = this.room(code);
    const identity = this.identity(room, bearer);
    if (!identity) throw new Error('A valid session token is required.');
    if (identity === 'master') return { code: room.code, token: room.masterToken };
    return { code: room.code, token: identity.token, playerId: identity.id, name: identity.name,
      ...(identity.role || identity.assignedRole ? { characterName: identity.role?.name ?? identity.assignedRole } : {}) };
  }

  /** Replace a capability without touching any character, clue, answer, clock or vote. */
  rotateSession(code: unknown, bearer: unknown): Session {
    const room = this.room(code);
    const identity = this.identity(room, bearer);
    if (!identity) throw new Error('A valid session token is required.');
    const replacement = token();
    if (identity === 'master') room.masterToken = replacement;
    else { identity.token = replacement; identity.connections.clear(); }
    for (const [id, connection] of this.connections) if (connection.code === room.code && connection.token === bearer) this.connections.delete(id);
    return this.session(room.code, replacement);
  }

  /** The durable service authorizes the offer or absence before promoting this player. */
  promoteMaster(code: unknown, bearer: unknown): Session {
    const room = this.room(code);
    const identity = this.identity(room, bearer);
    if (!identity || identity === 'master') throw new Error('Only players can do that.');
    if (identity.demo) throw new Error('Choose a real guest for game-master recovery.');
    const oldToken = room.masterToken;
    room.masterToken = token();
    for (const [id, connection] of this.connections) if (connection.code === room.code && connection.token === oldToken) this.connections.delete(id);
    return this.session(room.code, room.masterToken);
  }

  releaseSeat(code: unknown, bearer: unknown): void {
    const room = this.room(code);
    const identity = this.identity(room, bearer);
    if (!identity) throw new Error('A valid session token is required.');
    if (identity === 'master') throw new Error('Only players can do that.');
    if (room.phase !== 'lobby') throw new Error('Seats can only be released in the lobby.');
    room.players.delete(identity.id);
    for (const id of identity.connections) this.connections.delete(id);
  }

  command(code: unknown, bearer: unknown, payload: unknown, context?: unknown): void {
    const room = this.room(code);
    const identity = this.identity(room, bearer);
    if (!identity) throw new Error('A valid session token is required.');
    if (context !== undefined) this.assertCommandContext(room, context);
    const action = object(payload, 'action');
    const type = str(action.type, 'action type');
    if (MASTER_ACTIONS.has(type)) {
      if (identity !== 'master') throw new Error('Only the game master can do that.');
      const phase = `${room.phase}:${room.round}`;
      this.masterCommand(room, type, action);
      if (phase !== `${room.phase}:${room.round}`) {
        delete room.playback;
        delete room.spotlight;
        if (room.phase !== 'lobby') { this.resetAttentionClaims(room); this.beginAttention(room, 'phase'); }
      }
      return;
    }
    if (identity === 'master') throw new Error('Only players can do that.');
    if (room.isPaused) throw new Error('The game is paused.');
    switch (type) {
      case 'award-vote': {
        this.phase(room, 'results');
        const awards = this.currentAwards(room, action.awardsId);
        if (awards.status !== 'voting') throw new Error('This party awards ballot is closed.');
        if (identity.demo) throw new Error('Only real players can vote for party awards.');
        if (awards.ballots[identity.id]) throw new Error('Your party awards ballot is already final.');
        const choices = object(action.choices, 'party awards choices');
        if (Object.keys(choices).length !== AWARD_CATEGORIES.length || Object.keys(choices).some(key => !AWARD_CATEGORIES.includes(key as PartyAwardCategory)) ||
          AWARD_CATEGORIES.some(category => typeof choices[category] !== 'string' || choices[category] === identity.id || !room.players.has(choices[category] as string))) throw new Error('Choose another roster member for every party award.');
        awards.ballots[identity.id] = Object.fromEntries(AWARD_CATEGORIES.map(category => [category, choices[category]])) as PartyAwardChoices;
        return;
      }
      case 'ready':
        this.phase(room, 'roles');
        identity.ready = boolean(action.ready, 'ready status');
        return;
      case 'publish-clue': {
        this.phase(room, 'investigation');
        const clueId = str(action.clueId, 'clue');
        const clue = identity.clues.find(clue => clue.id === clueId);
        if (!clue) throw new Error('That clue is not yours.');
        if (!clue.published) {
          clue.published = true;
          identity.score += 25;
          identity.cluesShared += 1;
        }
        return;
      }
      case 'search': {
        this.phase(room, 'investigation');
        const locationId = str(action.locationId, 'search location');
        const storyRound = this.storyRound(room);
        if (!getAct(storyRound, this.culpritCharacterId(room)).locations.some(location => location.id === locationId)) throw new Error('Choose a search location in this act.');
        if (identity.search) throw new Error('You have already searched this round.');
        const found = searchClue(storyRound, locationId, this.culpritCharacterId(room));
        identity.search = { locationId, title: found.title, text: found.text };
        identity.score += 25;
        identity.searches += 1;
        return;
      }
      case 'answer': {
        this.phase(room, 'investigation');
        const optionId = str(action.optionId, 'answer option');
        const question = getQuestion(this.storyRound(room));
        if (!question.options.some(option => option.id === optionId)) throw new Error('Choose an answer option for this act.');
        if (identity.answeredOptionId !== undefined) throw new Error('Your answer is already final for this round.');
        identity.answeredOptionId = optionId;
        return;
      }
      case 'suspect': {
        this.phase(room, 'investigation');
        const targetId = str(action.playerId, 'suspicion');
        if (targetId === identity.id) throw new Error('You cannot suspect yourself.');
        if (!room.players.has(targetId)) throw new Error('Choose a player in this room.');
        identity.suspicionId = targetId;
        return;
      }
      case 'vote': {
        this.phase(room, 'voting');
        const targetId = str(action.playerId, 'vote');
        if (targetId === identity.id) throw new Error('You cannot vote for yourself.');
        if (!room.players.has(targetId)) throw new Error('Choose a player in this room.');
        if (identity.votedFor !== null) throw new Error('Your vote is already final.');
        identity.votedFor = targetId;
        return;
      }
      default: throw new Error('Unknown action.');
    }
  }

  /** Anyone opening a public TV may claim an idle media lease. This secret has no game authority. */
  claimDisplay(code: unknown, displayId: unknown, bearer?: unknown): DisplayCapability {
    const room = this.room(code), now = this.now();
    if (typeof displayId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(displayId)) throw new Error('Invalid display ID.');
    if (bearer !== undefined && (typeof bearer !== 'string' || !/^[a-f0-9]{48}$/.test(bearer))) throw new Error('Invalid display capability.');
    const own = room.display?.id === displayId && room.display.token === bearer;
    if (room.display && room.display.leaseUntil > now && room.display.expiresAt > now && !own) return { code: room.code, displayId, expiresAt: room.display.leaseUntil, active: false };
    if (own && room.display!.expiresAt > now) room.display!.leaseUntil = now + DISPLAY_LEASE_MS;
    else {
      room.display = { id: displayId, token: token(), expiresAt: now + DISPLAY_CAPABILITY_MS, leaseUntil: now + DISPLAY_LEASE_MS, sequence: 0 };
      delete room.playback;
    }
    return { code: room.code, displayId, token: room.display!.token, expiresAt: room.display!.expiresAt, active: true };
  }

  reportPlayback(code: unknown, displayId: unknown, bearer: unknown, payload: unknown, sequence: unknown): void {
    const room = this.room(code), now = this.now(), display = room.display;
    if (!display || display.id !== displayId || display.token !== bearer || display.expiresAt <= now || display.leaseUntil <= now) throw new Error('A live display capability is required.');
    if (typeof sequence !== 'number' || !Number.isSafeInteger(sequence) || sequence <= display.sequence || sequence > 1_000_000_000) throw new Error('Invalid playback sequence.');
    const raw = object(payload, 'playback');
    if (Object.keys(raw).some(key => !['eventKey', 'clipId', 'kind', 'position', 'playing'].includes(key)) || typeof raw.eventKey !== 'string' || raw.eventKey.length > 200 || typeof raw.clipId !== 'string' || (raw.kind !== 'film' && raw.kind !== 'narration') || typeof raw.position !== 'number' || !Number.isFinite(raw.position) || typeof raw.playing !== 'boolean') throw new Error('Invalid playback report.');
    const sample = raw as unknown as MediaPlaybackReport;
    const duration = (MEDIA_DURATIONS[sample.kind] as Record<string, number>)[sample.clipId];
    if (!duration || sample.position < 0 || sample.position > duration + .5 || !playbackMatchesRoom(this.view(code), sample)) throw new Error('Invalid playback clip or phase.');
    if (sample.playing && attentionActive(room, now)) throw new Error('Wait for the current story presentation to finish.');
    display.sequence = sequence;
    display.leaseUntil = now + DISPLAY_LEASE_MS;
    room.playback = { ...sample, playing: sample.playing && !room.isPaused, updatedAt: now, displayId: display.id };
    const current = this.view(code), preflight = preflightEvent(current);
    if (room.preflight && preflight && sample.kind === 'film' && sample.clipId === preflight.clipId &&
      sample.eventKey === playbackEventKey(current, preflight.key) && !sample.playing && sample.position >= 3.5 && !attentionActive(room, now)) room.preflight.completed = true;
  }

  /** Public presentation authority can request only one eligible cue per current story context. */
  claimAttention(code: unknown, displayId: unknown, bearer: unknown, payload: unknown): { attention: Attention; serverNow: number } {
    const room = this.room(code), now = this.now(), display = room.display;
    if (!display || display.id !== displayId || display.token !== bearer || display.expiresAt <= now || display.leaseUntil <= now) throw new Error('A live display capability is required.');
    const data = object(payload, 'attention request');
    if (Object.keys(data).some(key => !['eventKey', 'cue', 'context', 'presentationSerial', 'clueId'].includes(key)) ||
      typeof data.eventKey !== 'string' || !['clue', 'timer-warning', 'lobby'].includes(data.cue as string)) throw new Error('Invalid attention request.');
    if (data.context !== undefined) this.assertCommandContext(room, data.context);
    if (data.eventKey !== attentionEventKey(room) || data.presentationSerial !== undefined &&
      (typeof data.presentationSerial !== 'number' || !Number.isSafeInteger(data.presentationSerial) || data.presentationSerial < 0 || data.presentationSerial !== (room.presentation?.serial ?? 0))) throw new Error('Invalid attention request.');
    const cue = data.cue as 'clue' | 'timer-warning' | 'lobby';
    if (cue === 'lobby' ? room.phase !== 'lobby' : room.phase !== 'investigation') throw new Error('Invalid attention request.');
    if (cue === 'clue') {
      const eligible = [...room.players.values()].flatMap(player => player.clues).filter(clue => clue.published && clue.round === room.round && !(room.attentionClueBaseline ?? []).includes(clue.id));
      if (data.clueId !== undefined && typeof data.clueId !== 'string' || !eligible.some(clue => data.clueId === undefined || clue.id === data.clueId)) throw new Error('Invalid attention request.');
    } else if (data.clueId !== undefined) throw new Error('Invalid attention request.');
    const existing = room.attentionClaims?.eventKey === data.eventKey ? room.attentionClaims[cue] : undefined;
    if (existing) return { attention: structuredClone(existing), serverNow: now };
    if (room.isPaused) throw new Error('The game is paused.');
    if (cue === 'timer-warning' && (this.remaining(room, now) > 30_000 || this.remaining(room, now) < 28_000)) throw new Error('Invalid attention request.');
    if (attentionActive(room, now) || room.playback?.playing && now - room.playback.updatedAt < PLAYBACK_STALE_MS) throw new Error('Wait for the current story presentation to finish.');
    room.attentionClaims ??= { eventKey: data.eventKey };
    if (room.attentionClaims.eventKey !== data.eventKey) room.attentionClaims = { eventKey: data.eventKey };
    this.beginAttention(room, cue);
    room.attentionClaims[cue] = structuredClone(room.attention!);
    return { attention: structuredClone(room.attention!), serverNow: now };
  }

  connect(code: unknown, bearer: unknown, connectionId: string): void {
    const room = this.room(code);
    const identity = this.identity(room, bearer);
    this.disconnect(connectionId);
    this.connections.set(connectionId, { code: room.code, ...(typeof bearer === 'string' ? { token: bearer } : {}) });
    if (identity && identity !== 'master') identity.connections.add(connectionId);
  }

  disconnect(connectionId: string): string | undefined {
    const connection = this.connections.get(connectionId);
    if (!connection) return;
    this.connections.delete(connectionId);
    const room = this.rooms.get(connection.code);
    if (room) for (const player of room.players.values()) player.connections.delete(connectionId);
    return connection.code;
  }

  sweep(): string[] {
    const expired: string[] = [];
    for (const [code, room] of this.rooms) if (this.now() - room.createdAt >= ROOM_LIFETIME) {
      expired.push(code);
      this.rooms.delete(code);
      for (const [id, connection] of this.connections) if (connection.code === code) this.connections.delete(id);
    }
    return expired;
  }

  private room(code: unknown): Room {
    const normalized = str(code, 'room code').trim().toUpperCase();
    if (!/^[A-Z]{4}$/.test(normalized)) throw new Error('Enter a four-letter room code.');
    const room = this.rooms.get(normalized);
    if (!room) throw new Error('Room not found.');
    if (this.now() - room.createdAt >= ROOM_LIFETIME) {
      this.sweep();
      throw new Error('This room has expired.');
    }
    return room;
  }

  private identity(room: Room, bearer: unknown): Player | 'master' | undefined {
    if (bearer === undefined) return;
    if (typeof bearer !== 'string' || !bearer) throw new Error('Invalid session token.');
    if (bearer === room.masterToken) return 'master';
    const player = [...room.players.values()].find(player => player.token === bearer);
    if (!player) throw new Error('Invalid or revoked session token.');
    return player;
  }

  private phase(room: Room, expected: Phase): void {
    if (room.phase !== expected) throw new Error(`This action is only available during ${expected}.`);
  }

  private remaining(room: Room, now = this.now()): number {
    return room.endsAt === null ? room.remainingMs : Math.max(0, room.endsAt - Math.max(now, room.startsAt ?? now));
  }

  private resetAttentionClaims(room: Room): void {
    room.attentionClaims = { eventKey: attentionEventKey(room) };
    room.attentionClueBaseline = [...room.players.values()].flatMap(player => player.clues).filter(clue => clue.published && clue.round === room.round).map(clue => clue.id);
  }

  private beginAttention(room: Room, cue: Attention['cue']): void {
    const now = this.now(), remaining = this.remaining(room, now);
    const attention: Attention = { id: (room.attentionSerial ?? 0) + 1, eventKey: attentionEventKey(room), cue, endsAt: room.isPaused ? null : now + 10_000, remainingMs: 10_000 };
    room.attentionSerial = attention.id;
    room.attention = attention;
    if (cue !== 'phase') room.playbackEpoch = (room.playbackEpoch ?? 0) + 1;
    if (room.phase === 'investigation') {
      room.remainingMs = remaining;
      room.startsAt = attention.endsAt;
      room.endsAt = room.isPaused ? null : attention.endsAt! + remaining;
    }
    delete room.playback;
  }

  private updateAttention(room: Room, patch: Partial<Attention>): void {
    if (!room.attention) return;
    room.attention = { ...room.attention, ...patch };
    if (room.attentionClaims) for (const cue of ['clue', 'timer-warning', 'lobby'] as const) {
      if (room.attentionClaims[cue]?.id === room.attention.id) room.attentionClaims[cue] = { ...room.attention };
    }
  }

  private player(room: Room, playerId: unknown): Player {
    const player = room.players.get(str(playerId, 'player'));
    if (!player) throw new Error('Player not found.');
    return player;
  }

  private validateDeck(players: Player[]): void {
    const reserved = new Set<string>();
    for (const player of players) if (player.assignedRole) {
      const character = CHARACTERS.find(character => character.name === player.assignedRole);
      if (!character) throw new Error('Choose a character from the Dustfall cast.');
      if (reserved.has(character.id)) throw new Error('That character is already assigned. Choose another character.');
      if ((player.gender === 'man' || player.gender === 'woman') && character.gender !== player.gender) throw new Error(`That character is a ${character.gender}. Choose a matching character or change the character gender preference to either.`);
      reserved.add(character.id);
    }
    for (const preference of ['man', 'woman'] as const) {
      const requested = players.filter(player => player.gender === preference).length;
      if (requested > 10) throw new Error(`Only 10 ${preference === 'man' ? 'men' : 'women'} characters are available. Choose either or the other character gender.`);
      const required = players.filter(player => player.gender === preference && !player.assignedRole).length;
      const available = CHARACTERS.filter(character => character.gender === preference && !reserved.has(character.id)).length;
      if (required > available) throw new Error(`Reserved characters leave too few ${preference === 'man' ? 'men' : 'women'} for the current gender preferences. Release a reservation or choose either.`);
    }
  }

  private assignCharacters(players: Player[]): Map<string, CharacterProfile> {
    const assigned = new Map<string, CharacterProfile>();
    const available = shuffle([...CHARACTERS]);
    for (const player of players) if (player.assignedRole) {
      const index = available.findIndex(character => character.name === player.assignedRole);
      assigned.set(player.id, available.splice(index, 1)[0]);
    }
    for (const player of [...players.filter(player => player.gender === 'man' || player.gender === 'woman'), ...players.filter(player => player.gender !== 'man' && player.gender !== 'woman')]) {
      if (assigned.has(player.id)) continue;
      const index = available.findIndex(character => player.gender !== 'man' && player.gender !== 'woman' || character.gender === player.gender);
      if (index < 0) throw new Error('No compatible character remains. Change a character preference or reservation.');
      assigned.set(player.id, available.splice(index, 1)[0]);
    }
    return assigned;
  }

  private storyRound(room: Room): number {
    return room.settings.rounds <= 2 && room.round === room.settings.rounds ? 3 : room.round;
  }

  private culpritCharacterId(room: Room): string {
    const role = [...room.players.values()].find(player => player.role?.alignment === 'culprit')?.role;
    const character = role?.characterId ? characterById(role.characterId) : CHARACTERS.find(candidate => candidate.name === role?.name);
    if (!character) throw new Error('This game needs the new Dustfall cast. Reset the room to deal a new case.');
    return character.id;
  }

  private resetRoom(room: Room): void {
    room.actionEpoch = (room.actionEpoch ?? 0) + 1;
    room.phase = 'lobby';
    room.round = 0;
    room.isLocked = false;
    room.isPaused = false;
    room.endsAt = null;
    room.remainingMs = 0;
    delete room.result;
    delete room.questionResult;
    delete room.gameId;
    delete room.presentation;
    delete room.playback;
    delete room.playbackEpoch;
    delete room.startsAt;
    delete room.attention;
    delete room.attentionClaims;
    delete room.attentionClueBaseline;
    delete room.spotlight;
    delete room.preflight;
    delete room.partyAwards;
    for (const player of room.players.values()) {
      delete player.role;
      delete player.assignedRole;
      player.ready = false;
      player.clues = [];
      player.votedFor = null;
      player.score = 0;
      player.correctAnswers = 0;
      player.cluesShared = 0;
      player.searches = 0;
      player.suspicionId = null;
      delete player.search;
      delete player.answeredOptionId;
      delete player.previousAnswer;
    }
  }

  private resolveQuestion(room: Room): void {
    const question = getQuestion(this.storyRound(room));
    const counts: Record<string, number> = Object.fromEntries(question.options.map(option => [option.id, 0]));
    for (const player of room.players.values()) {
      if (player.answeredOptionId === undefined) { delete player.previousAnswer; continue; }
      const choice = question.options.find(option => option.id === player.answeredOptionId);
      if (choice) player.previousAnswer = { round: room.round, optionId: choice.id, text: choice.text, correct: choice.id === question.correctOptionId };
      else delete player.previousAnswer;
      counts[player.answeredOptionId] = (counts[player.answeredOptionId] ?? 0) + 1;
      if (player.answeredOptionId === question.correctOptionId) {
        player.score += 100;
        player.correctAnswers += 1;
      }
    }
    room.questionResult = { round: room.round, correctOptionId: question.correctOptionId, explanation: question.explanation, counts };
  }

  /** A request belongs to the game step the caller actually saw, even after a CAS retry. */
  private assertCommandContext(room: Room, value: unknown): void {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid game action context.');
    const context = value as Record<string, unknown>;
    const actionEpoch = context.actionEpoch === undefined ? 0 : context.actionEpoch;
    if (Object.keys(context).some(key => !['gameId', 'phase', 'round', 'actionEpoch'].includes(key)) ||
      !(context.gameId === null || typeof context.gameId === 'string' && context.gameId.length > 0 && context.gameId.length <= 128) ||
      !['lobby', 'roles', 'investigation', 'voting', 'results'].includes(context.phase as string) ||
      typeof context.round !== 'number' || !Number.isInteger(context.round) || context.round < 0 || context.round > 5 ||
      typeof actionEpoch !== 'number' || !Number.isSafeInteger(actionEpoch) || actionEpoch < 0) throw new Error('Invalid game action context.');
    if (context.gameId !== (room.gameId ?? null) || context.phase !== room.phase || context.round !== room.round || actionEpoch !== (room.actionEpoch ?? 0)) throw new Error('The game has moved on. Your action was not applied. Wait for the latest screen and try again.');
  }

  private masterCommand(room: Room, type: string, action: Record<string, unknown>): void {
    switch (type) {
      case 'stage-settings': {
        const settings = object(action.settings, 'stage settings');
        const next = { ...DEFAULT_STAGE_SETTINGS, ...room.stageSettings };
        for (const [key, value] of Object.entries(settings)) {
          if (key === 'distanceMode' || key === 'musicEnabled') {
            if (typeof value !== 'boolean') throw new Error('Choose valid stage settings.');
            next[key] = value;
          } else if (key === 'musicVolume') {
            if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 100) throw new Error('Choose a whole music volume from 0 to 100.');
            next.musicVolume = value;
          } else throw new Error('Choose valid stage settings.');
        }
        room.stageSettings = next;
        return;
      }
      case 'spotlight': {
        if (action.evidenceId === null) {
          delete room.spotlight;
          if (room.attention?.cue === 'spotlight') {
            const now = this.now(), remaining = this.remaining(room, now);
            delete room.attention;
            delete room.startsAt;
            room.playbackEpoch = (room.playbackEpoch ?? 0) + 1;
            delete room.playback;
            room.remainingMs = remaining;
            if (room.phase === 'investigation' && !room.isPaused) room.endsAt = now + remaining;
          }
          return;
        }
        if (typeof action.evidenceId !== 'string' || !publicEvidence(this.view(room.code)).some(item => item.key === action.evidenceId)) throw new Error('Choose a public evidence card to spotlight.');
        if (room.spotlight?.evidenceId === action.evidenceId) return;
        if (attentionActive(room, this.now()) || room.playback?.playing && this.now() - room.playback.updatedAt < PLAYBACK_STALE_MS) throw new Error('Wait for the current story presentation to finish.');
        room.spotlightSerial = (room.spotlightSerial ?? 0) + 1;
        room.spotlight = { evidenceId: action.evidenceId, serial: room.spotlightSerial };
        this.beginAttention(room, 'spotlight');
        return;
      }
      case 'preflight-test':
        this.phase(room, 'lobby');
        room.preflight = { serial: (room.preflight?.serial ?? 0) + 1, completed: false };
        this.beginAttention(room, 'preflight');
        return;
      case 'awards-open':
        this.phase(room, 'results');
        if (room.partyAwards && room.partyAwards.status !== 'skipped') return;
        if (room.players.size < 2 || ![...room.players.values()].some(player => !player.demo)) throw new Error('Party awards need at least two characters and one real player.');
        room.partyAwardSerial = (room.partyAwardSerial ?? 0) + 1;
        room.partyAwards = { id: room.partyAwardSerial, status: 'voting', ballots: {} };
        return;
      case 'awards-reveal':
      case 'awards-skip': {
        this.phase(room, 'results');
        const awards = this.currentAwards(room, action.awardsId);
        const next = type === 'awards-reveal' ? 'revealed' : 'skipped';
        if (awards.status === next) return;
        if (awards.status !== 'voting') throw new Error('This party awards ballot is closed.');
        awards.status = next;
        return;
      }
      case 'presentation': {
        if (room.phase === 'lobby') throw new Error('Start the game before controlling its presentation.');
        const control = action.control;
        if (control !== 'skip' && control !== 'replay') throw new Error('Choose skip or replay for the presentation control.');
        room.presentation = { serial: (room.presentation?.serial ?? 0) + 1, eventKey: `${room.gameId ?? `legacy-${room.code}`}:${room.phase}:${room.round}`, control };
        delete room.playback;
        if (control === 'replay') { this.resetAttentionClaims(room); this.beginAttention(room, 'phase'); }
        else {
          const eventKey = attentionEventKey(room);
          this.updateAttention(room, { eventKey });
          if (room.attentionClaims) {
            room.attentionClaims.eventKey = eventKey;
            for (const cue of ['clue', 'timer-warning', 'lobby'] as const) if (room.attentionClaims[cue]) room.attentionClaims[cue] = { ...room.attentionClaims[cue]!, eventKey };
          }
        }
        return;
      }
      case 'captions': {
        const language = action.language;
        if (language !== 'off' && language !== 'en' && language !== 'es' && language !== 'pt-BR') throw new Error('Choose a valid caption language.');
        room.captionLanguage = language;
        room.captionSerial = (room.captionSerial ?? 0) + 1;
        return;
      }
      case 'settings': {
        this.phase(room, 'lobby');
        const settings = object(action.settings, 'settings');
        const next = { ...room.settings };
        const bounds = { rounds: [1, 5], roundSeconds: [60, 600], maxPlayers: [4, 20] } as const;
        for (const [key, value] of Object.entries(settings)) {
          if (!(key in bounds)) throw new Error('Unknown setting.');
          const setting = key as keyof Settings;
          const [min, max] = bounds[setting];
          if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid ${key}. Use a whole number from ${min} to ${max}.`);
          next[setting] = value;
        }
        if (next.maxPlayers < room.players.size) throw new Error('Capacity cannot be below the current player count.');
        room.settings = next;
        return;
      }
      case 'lock':
        this.phase(room, 'lobby');
        room.isLocked = boolean(action.locked, 'lock status');
        return;
      case 'kick': {
        this.phase(room, 'lobby');
        const player = this.player(room, action.playerId);
        room.players.delete(player.id);
        for (const id of player.connections) this.connections.delete(id);
        return;
      }
      case 'set-gender': {
        this.phase(room, 'lobby');
        const player = this.player(room, action.playerId);
        const preference = gender(action.gender);
        this.validateDeck([...room.players.values()].map(other => other.id === player.id ? { ...other, gender: preference } : other));
        player.gender = preference;
        return;
      }
      case 'set-role': {
        this.phase(room, 'lobby');
        const player = this.player(room, action.playerId);
        const roleName = str(action.roleName, 'role name');
        if (!roleName) { delete player.assignedRole; return; }
        this.validateDeck([...room.players.values()].map(other => other.id === player.id ? { ...other, assignedRole: roleName } : other));
        player.assignedRole = roleName;
        return;
      }
      case 'start': {
        this.phase(room, 'lobby');
        if (room.players.size < (room.rehearsal ? 1 : 4)) throw new Error(room.rehearsal ? 'At least 1 player is required.' : 'At least 4 players are required.');
        const players = [...room.players.values()];
        this.validateDeck(players);
        const assigned = this.assignCharacters(players);
        const culpritIndex = randomInt(players.length);
        for (const [index, player] of players.entries()) {
          const character = assigned.get(player.id)!;
          const dossier = privateDossier(character.id);
          const isCulprit = index === culpritIndex;
          const confession = isCulprit ? ` Your crime: you killed Mayor Solomon Graves using an induction coil, staged a revolver shot, stole the alien power core, and arranged to sell the core at the Black Star auction. ${solution(character.id).method} ${solution(character.id).motive}` : '';
          const roleplayTip = dossier.roleplayTip + (players.length < 20 ? ' Some people in your backstory may be offstage tonight. If a mission names an absent character or faction, ask another guest to speak for their interests; relationships with absent people are background, never required evidence.' : '');
          player.role = { ...dossier, roleplayTip, name: character.name, gender: character.gender, characterId: character.id, alignment: isCulprit ? 'culprit' : 'innocent', brief: dossier.background, secret: dossier.secret + confession, objective: isCulprit ? 'Keep your crime secret and escape the final accusation.' : 'Compare the evidence and identify the culprit.' };
          player.ready = player.demo;
        }
        room.phase = 'roles';
        room.isLocked = true;
        room.gameId = randomBytes(16).toString('hex');
        delete room.presentation;
        delete room.notice;
        return;
      }
      case 'advance':
        if (room.isPaused) throw new Error('Resume the paused game before advancing.');
        if (room.phase === 'investigation') this.resolveQuestion(room);
        if (room.phase === 'roles' || (room.phase === 'investigation' && room.round < room.settings.rounds)) {
          room.phase = 'investigation';
          room.round += 1;
          room.remainingMs = room.settings.roundSeconds * 1000;
          room.endsAt = this.now() + room.remainingMs;
          delete room.startsAt;
          const players = [...room.players.values()];
          const storyRound = this.storyRound(room);
          const culpritCharacterId = this.culpritCharacterId(room);
          const roster = players.map(player => player.role?.characterId).filter((id): id is string => !!id);
          const act = getAct(storyRound, culpritCharacterId);
          const question = getQuestion(storyRound);
          for (const [index, player] of players.entries()) {
            delete player.search;
            delete player.answeredOptionId;
            player.suspicionId = null;
            const authored = makeClue(storyRound, index, culpritCharacterId, roster);
            player.clues.push({ id: randomBytes(12).toString('hex'), title: authored.title, text: authored.text, round: room.round, playerId: player.id, playerName: player.name, published: player.demo });
            if (player.demo) {
              const locationId = act.locations[index % act.locations.length].id;
              const found = searchClue(storyRound, locationId, culpritCharacterId);
              player.search = { locationId, title: found.title, text: found.text };
              player.answeredOptionId = question.correctOptionId;
              player.suspicionId = players.length > 1 ? players[(index + 1) % players.length].id : null;
              player.score += 50;
              player.searches += 1;
              player.cluesShared += 1;
            }
          }
          return;
        }
        if (room.phase === 'investigation') {
          room.phase = 'voting';
          room.endsAt = null;
          room.remainingMs = 0;
          delete room.startsAt;
          const players = [...room.players.values()];
          for (const [index, player] of players.entries()) if (player.demo) player.votedFor = players.length > 1 ? players[(index + 1) % players.length].id : null;
          return;
        }
        if (room.phase === 'voting') {
          const players = [...room.players.values()];
          const tallies: Record<string, number> = Object.fromEntries(players.map(player => [player.id, 0]));
          for (const player of players) if (player.votedFor) tallies[player.votedFor] += 1;
          const highest = Math.max(0, ...Object.values(tallies));
          const leaders = Object.keys(tallies).filter(id => tallies[id] === highest);
          const culprit = players.find(player => player.role?.alignment === 'culprit');
          if (!culprit) throw new Error('This game has no culprit. Reset the room to deal a new case.');
          const caught = highest > 0 && leaders.length === 1 && leaders[0] === culprit.id;
          const scores = players.map(player => {
            const correctAccusation = player.votedFor === culprit.id;
            if (correctAccusation || (player.id === culprit.id && !caught)) player.score += 200;
            return { playerId: player.id, score: player.score, correctAnswers: player.correctAnswers, cluesShared: player.cluesShared, searches: player.searches, correctAccusation };
          }).sort((a, b) => b.score - a.score);
          room.result = { culpritId: culprit.id, tallies, caught, solution: solution(this.culpritCharacterId(room)), scores };
          room.phase = 'results';
          return;
        }
        throw new Error('This phase cannot advance.');
      case 'extend-time': {
        this.phase(room, 'investigation');
        const now = this.now();
        const remaining = this.remaining(room, now);
        if (remaining >= 600_000) throw new Error('The investigation already has 10 minutes remaining.');
        room.remainingMs = Math.min(600_000, remaining + 60_000);
        if (room.attention?.cue === 'timer-warning' && attentionActive(room, now)) {
          delete room.attention;
          if (room.attentionClaims) delete room.attentionClaims['timer-warning'];
          room.playbackEpoch = (room.playbackEpoch ?? 0) + 1;
          delete room.playback;
          delete room.startsAt;
        }
        if (!room.isPaused) room.endsAt = Math.max(now, room.startsAt ?? now) + room.remainingMs;
        return;
      }
      case 'pause':
        if (room.phase === 'lobby' || room.isPaused) throw new Error('This game cannot be paused now.');
        room.remainingMs = this.remaining(room);
        if (attentionActive(room, this.now())) this.updateAttention(room, { remainingMs: attentionRemainingMs(room, this.now()), endsAt: null });
        if (room.startsAt !== undefined) room.startsAt = null;
        room.endsAt = null;
        room.isPaused = true;
        room.playbackEpoch = (room.playbackEpoch ?? 0) + 1;
        delete room.playback;
        return;
      case 'resume':
        if (!room.isPaused) throw new Error('The game is not paused.');
        room.isPaused = false;
        if (room.attention?.endsAt === null && room.attention.remainingMs > 0) {
          this.updateAttention(room, { endsAt: this.now() + room.attention.remainingMs });
          if (room.phase === 'investigation') room.startsAt = room.attention.endsAt;
        } else delete room.startsAt;
        room.playbackEpoch = (room.playbackEpoch ?? 0) + 1;
        delete room.playback;
        if (room.phase === 'investigation') room.endsAt = Math.max(this.now(), room.startsAt ?? this.now()) + room.remainingMs;
        return;
      case 'reset':
        this.resetRoom(room);
        return;
      case 'demo-fill': {
        this.phase(room, 'lobby');
        if (room.isLocked) throw new Error('Unlock the room before adding sample players.');
        const count = Math.min(4, room.settings.maxPlayers - room.players.size);
        if (count === 0) throw new Error('This room is full.');
        for (let i = 0; i < count; i++) {
          let name = `Sample ${i + 1}`;
          let suffix = i + 1;
          while ([...room.players.values()].some(player => player.name.toLocaleLowerCase() === name.toLocaleLowerCase())) name = `Sample ${++suffix}`;
          const session = this.join({ code: room.code, name, gender: 'any' });
          room.players.get(session.playerId!)!.demo = true;
        }
        return;
      }
      default: throw new Error('Unknown action.');
    }
  }

  private currentAwards(room: Room, id: unknown): NonNullable<Room['partyAwards']> {
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1 || !room.partyAwards || room.partyAwards.id !== id) throw new Error('This party awards ballot has changed. Wait for the latest screen.');
    return room.partyAwards;
  }
}
