import { GameEngine, type RoomSnapshot } from '../server/engine.js';
import type { GameMasterView, RoomView, Session } from '../shared/types.js';
import type { RoomRepository } from './repository.js';

const ROOM_LIFETIME = 12 * 60 * 60 * 1000;
const CLAIM_LIFETIME = 10 * 60 * 1000;
const PRESENCE_LIFETIME = 15_000;
const PRESENCE_REFRESH = 5_000;
const TAKEOVER_GRACE = 60_000;
const OFFER_LIFETIME = 120_000;
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SESSION_EVENTS = new Set(['room:claim', 'room:join', 'room:recovery', 'room:recover', 'room:gm-accept', 'room:gm-takeover']);
const VIEW_EVENTS = new Set(['room:command', 'room:gm-profile', 'room:gm-offer']);
type Receipt = { id: string; fingerprint: string; result?: Session | { left: true }; recoveryNonce?: string };
type Presence = { playerId?: string; principal?: string; lastSeen: number };
type GameMaster = Omit<GameMasterView, 'connected' | 'takeoverAt' | 'eligiblePlayerId'> & { lastSeen: number; linkedPlayerId?: string };
interface Envelope {
  room: RoomSnapshot;
  masterReady: boolean;
  claim?: { hash: string; expiresAt: number; consumed: boolean };
  receipts: Receipt[];
  presence: Record<string, Presence>;
  gameMaster: GameMaster;
  recovery: Record<string, string>;
  recoveryRevision: Record<string, number>;
  closedPresence: Record<string, number>;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid request.');
  return value as Record<string, unknown>;
}
function roomCode(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Z]{4}$/.test(value.trim().toUpperCase())) throw new Error('Enter a four-letter room code.');
  return value.trim().toUpperCase();
}
function displayName(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Use a name with 1–24 characters.');
  if (/[\u0000-\u001f\u007f]/u.test(value)) throw new Error('Names cannot contain control characters.');
  const name = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  if (!name || name.length > 24) throw new Error('Use a name with 1–24 characters.');
  return name;
}
function deviceId(value: unknown): string {
  if (value !== undefined && (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value))) throw new Error('Invalid device ID.');
  return value as string | undefined ?? 'default';
}
function normalizeRecovery(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Enter a valid twelve-character recovery code.');
  const code = value.toUpperCase().replace(/[\s-]/g, '');
  if (code.length !== 12 || [...code].some(char => !RECOVERY_ALPHABET.includes(char))) throw new Error('Enter a valid twelve-character recovery code.');
  return code;
}
function randomSecret(): string {
  return [...crypto.getRandomValues(new Uint8Array(32))].map(value => value.toString(16).padStart(2, '0')).join('');
}
async function digest(value: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
// Receipts retain a nonce, never a plaintext code. A lost response can still replay the
// exact code by deriving its 60 random bits from the private bearer plus this nonce.
async function recoveryCode(token: string, nonce: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`dustfall-recovery:${token}:${nonce}`)));
  return [...bytes.slice(0, 12)].map(value => RECOVERY_ALPHABET[value & 31]).join('');
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
function principal(session: Session, envelope: Envelope): string {
  return session.playerId ? `player:${session.playerId}` : `master:${envelope.gameMaster.id}`;
}
function recoveryKey(session: Session): string { return session.playerId ?? 'master'; }

export class OnlineGameService {
  private readonly repository: RoomRepository;
  private readonly now: () => number;
  constructor(options: { repository: RoomRepository; now?: () => number }) {
    this.repository = options.repository;
    this.now = options.now ?? Date.now;
  }

  async execute(event: string, payload: unknown, options: { requestId?: string } = {}): Promise<unknown> {
    if (!['room:create', 'room:prepare', 'room:claim', 'room:join', 'room:subscribe', 'room:command', 'room:unsubscribe', 'room:display-claim', 'room:playback', 'room:attention', 'room:recovery', 'room:recover', 'room:leave', 'room:gm-profile', 'room:gm-offer', 'room:gm-accept', 'room:gm-takeover'].includes(event)) throw new Error('Unknown room request.');
    const data = object(payload);
    const requestId = options.requestId;
    if (requestId !== undefined && (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(requestId))) throw new Error('Invalid request ID.');
    if (event === 'room:create' || event === 'room:prepare') return this.create(event, data);
    const code = roomCode(data.code);
    const fingerprint = requestId ? await digest(canonical({ event, payload: { ...data, code } })) : '';
    for (let attempt = 0; attempt < 24; attempt++) {
      const stored = await this.repository.get(code);
      if (!stored) throw new Error('Room not found.');
      const now = this.now();
      if (stored.expiresAt <= now) throw new Error('This room has expired.');
      let envelope: Envelope;
      try { envelope = JSON.parse(stored.state) as Envelope; }
      catch { throw new Error('This room could not be loaded. Please create a new room.'); }
      let changed = false;
      if (!envelope.gameMaster) {
        envelope.gameMaster = { id: randomSecret().slice(0, 24), name: 'Game master', epoch: 1, lastSeen: now };
        changed = true;
      }
      envelope.receipts ??= [];
      envelope.presence ??= {};
      envelope.recovery ??= {};
      envelope.recoveryRevision ??= {};
      envelope.closedPresence ??= {};
      const engine = new GameEngine({ now: this.now });
      engine.restoreRoom(envelope.room);
      const receipt = requestId ? envelope.receipts.find(value => value.id === requestId) : undefined;
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) throw new Error('This request ID was reused. Please try the action again.');
        if (VIEW_EVENTS.has(event)) return this.view(engine, envelope, code, data.token, now, stored.revision, stored.expiresAt);
        if (SESSION_EVENTS.has(event)) {
          // A promoted guest keeps an independent player credential. Revoking that
          // credential must also revoke its ability to replay the promotion grant.
          if (event === 'room:gm-accept' || event === 'room:gm-takeover') engine.session(code, data.token);
          const result = receipt.result as Session;
          const current = engine.session(code, result.token);
          if (current.playerId !== result.playerId) throw new Error('Invalid or revoked session token.');
          if (receipt.recoveryNonce) {
            const restoredCode = await recoveryCode(result.token, receipt.recoveryNonce);
            if (envelope.recovery[recoveryKey(current)] !== await digest(restoredCode)) throw new Error('This recovery session has been replaced.');
            return { ...structuredClone(result), recoveryCode: restoredCode };
          }
        }
        return structuredClone(receipt.result);
      }
      let result: unknown;
      let recoveryNonce: string | undefined;
      if (event === 'room:claim') {
        if (typeof data.ticket !== 'string' || !/^[a-f0-9]{64}$/.test(data.ticket)) throw new Error('This game-master link is invalid.');
        if (!envelope.claim || envelope.claim.hash !== await digest(data.ticket)) throw new Error('This game-master link is invalid.');
        if (envelope.claim.consumed || envelope.masterReady) throw new Error('This room has already been claimed.');
        if (envelope.claim.expiresAt <= now) throw new Error('This game-master link has expired. Create a new room.');
        envelope.claim.consumed = true;
        envelope.masterReady = true;
        envelope.gameMaster.lastSeen = now;
        ({ session: result, nonce: recoveryNonce } = await this.issueRecovery(engine.session(code, envelope.room.masterToken), envelope, stored.expiresAt, now));
        changed = true;
      } else if (event === 'room:display-claim') {
        if (Object.keys(data).some(key => !['code', 'displayId', 'token'].includes(key))) throw new Error('Invalid display request.');
        result = engine.claimDisplay(code, data.displayId, data.token);
        changed = (result as { active: boolean }).active || changed;
      } else if (event === 'room:playback') {
        if (Object.keys(data).some(key => !['code', 'displayId', 'token', 'playback', 'sequence'].includes(key))) throw new Error('Invalid playback request.');
        if (!envelope.masterReady) throw new Error('Claim the game-master controls on your phone first.');
        engine.reportPlayback(code, data.displayId, data.token, data.playback, data.sequence);
        result = { accepted: true };
        changed = true;
      } else if (event === 'room:attention') {
        if (Object.keys(data).some(key => !['code', 'displayId', 'token', 'eventKey', 'cue', 'context', 'presentationSerial', 'clueId'].includes(key))) throw new Error('Invalid attention request.');
        if (!envelope.masterReady) throw new Error('Claim the game-master controls on your phone first.');
        const { code: _code, displayId, token, ...cue } = data;
        result = engine.claimAttention(code, displayId, token, cue);
        changed = true;
      } else if (event === 'room:join') {
        const joined = engine.join(data);
        ({ session: result, nonce: recoveryNonce } = await this.issueRecovery(engine.session(code, joined.token), envelope, stored.expiresAt, now));
        changed = true;
      } else if (event === 'room:recover') {
        if (data.kind !== 'master' && data.kind !== 'player') throw new Error('Choose player or game master recovery.');
        const hash = await digest(normalizeRecovery(data.recoveryCode));
        const key = Object.entries(envelope.recovery).find(([id, value]) => value === hash && (data.kind === 'master' ? id === 'master' : id !== 'master'))?.[0];
        const oldToken = key === 'master' ? envelope.room.masterToken : envelope.room.players.find(player => player.id === key)?.token;
        if (!oldToken || !key) throw new Error('That recovery code is invalid or has been replaced.');
        const previous = engine.session(code, oldToken);
        this.clearPresence(envelope, principal(previous, envelope));
        const replacement = engine.rotateSession(code, oldToken);
        if (!replacement.playerId) {
          envelope.gameMaster.epoch += 1;
          envelope.gameMaster.lastSeen = now;
          delete envelope.gameMaster.handoff;
        }
        ({ session: result, nonce: recoveryNonce } = await this.issueRecovery(replacement, envelope, stored.expiresAt, now));
        changed = true;
      } else if (event === 'room:recovery') {
        const own = engine.session(code, data.token);
        if (!own.playerId) envelope.gameMaster.lastSeen = now;
        ({ session: result, nonce: recoveryNonce } = await this.issueRecovery(own, envelope, stored.expiresAt, now));
        changed = true;
      } else if (event === 'room:leave') {
        const own = engine.session(code, data.token);
        if (typeof data.release !== 'boolean') throw new Error('Choose whether to release this lobby seat.');
        if (data.release) {
          engine.releaseSeat(code, data.token);
          this.clearPresence(envelope, principal(own, envelope));
          delete envelope.recovery[recoveryKey(own)];
          this.cleanTargets(engine, envelope, code, now);
        } else {
          this.closePresence(envelope, own, data.clientId, now);
          if (!own.playerId) envelope.gameMaster.lastSeen = now;
        }
        result = { left: true };
        changed = true;
      } else if (event === 'room:gm-profile' || event === 'room:gm-offer') {
        const own = engine.session(code, data.token);
        if (own.playerId) throw new Error('Only the game master can do that.');
        if (!envelope.masterReady) throw new Error('Claim the game-master controls on your phone first.');
        if (event === 'room:gm-profile') {
          const name = displayName(data.name);
          if (data.backupPlayerId !== undefined && data.backupPlayerId !== null) this.realPlayer(engine, code, data.backupPlayerId);
          envelope.gameMaster.name = name;
          if (data.backupPlayerId === null) delete envelope.gameMaster.backupPlayerId;
          else if (data.backupPlayerId !== undefined) envelope.gameMaster.backupPlayerId = data.backupPlayerId as string;
        } else if (data.playerId === undefined) delete envelope.gameMaster.handoff;
        else {
          this.realPlayer(engine, code, data.playerId);
          envelope.gameMaster.handoff = { playerId: data.playerId as string, expiresAt: now + OFFER_LIFETIME };
        }
        envelope.gameMaster.lastSeen = now;
        result = this.view(engine, envelope, code, data.token, now, stored.revision + 1, stored.expiresAt);
        changed = true;
      } else if (event === 'room:gm-accept' || event === 'room:gm-takeover') {
        const own = engine.session(code, data.token);
        if (!own.playerId) throw new Error('Only players can do that.');
        this.realPlayer(engine, code, own.playerId);
        if (!envelope.masterReady) throw new Error('Claim the game-master controls on your phone first.');
        if (event === 'room:gm-accept') {
          if (!envelope.gameMaster.handoff || envelope.gameMaster.handoff.expiresAt <= now || envelope.gameMaster.handoff.playerId !== own.playerId) throw new Error('There is no live game-master offer for you.');
        } else {
          const status = this.masterView(engine, envelope, code, now);
          if (status.connected || now < envelope.gameMaster.lastSeen + TAKEOVER_GRACE) throw new Error('Game-master recovery is not available yet.');
          if (status.eligiblePlayerId !== own.playerId) throw new Error('Only the selected connected guest can recover the game-master controls.');
        }
        const oldPrincipal = `master:${envelope.gameMaster.id}`;
        this.clearPresence(envelope, oldPrincipal);
        envelope.gameMaster = { id: randomSecret().slice(0, 24), name: own.name!, epoch: envelope.gameMaster.epoch + 1, lastSeen: now, linkedPlayerId: own.playerId };
        delete envelope.recovery.master;
        ({ session: result, nonce: recoveryNonce } = await this.issueRecovery(engine.promoteMaster(code, data.token), envelope, stored.expiresAt, now));
        changed = true;
      } else if (event === 'room:command') {
        if (!envelope.masterReady) throw new Error('Claim the game-master controls on your phone first.');
        const own = engine.session(code, data.token);
        engine.command(code, data.token, data.action, data.context);
        if (!own.playerId) envelope.gameMaster.lastSeen = now;
        this.cleanTargets(engine, envelope, code, now);
        result = this.view(engine, envelope, code, data.token, now, stored.revision + 1, stored.expiresAt);
        changed = true;
      } else {
        // Validate credentials before accepting even a presence-only change.
        const view = this.view(engine, envelope, code, data.token, now, stored.revision, stored.expiresAt);
        deviceId(data.clientId);
        if (view.me || view.isMaster) {
          const own = engine.session(code, data.token);
          if (event === 'room:unsubscribe') changed = this.closePresence(envelope, own, data.clientId, now) || changed;
          else changed = this.refreshPresence(envelope, own, data.clientId, now) || changed;
        }
        result = event === 'room:unsubscribe' ? undefined : this.view(engine, envelope, code, data.token, now, stored.revision + (changed ? 1 : 0), stored.expiresAt);
      }
      if (!changed) return result;
      envelope.room = engine.exportRoom(code);
      if (requestId && (SESSION_EVENTS.has(event) || VIEW_EVENTS.has(event) || event === 'room:leave')) {
        let receiptResult: Receipt['result'];
        if (SESSION_EVENTS.has(event)) {
          const { recoveryCode: _privateCode, ...session } = result as Session;
          receiptResult = session;
        } else if (event === 'room:leave') receiptResult = { left: true };
        envelope.receipts.push({ id: requestId, fingerprint, ...(receiptResult ? { result: receiptResult } : {}), ...(recoveryNonce ? { recoveryNonce } : {}) });
        envelope.receipts = envelope.receipts.slice(-256);
      }
      if (await this.repository.compareAndSwap({ ...stored, state: JSON.stringify(envelope) }, stored.revision)) return result;
    }
    throw new Error('The room is busy. Please try that action again.');
  }

  private async create(event: string, data: Record<string, unknown>): Promise<unknown> {
    if (Object.keys(data).some(key => key !== 'name' && !(event === 'room:create' && key === 'rehearsal') && !(event === 'room:prepare' && key === 'demo')) || (data.demo !== undefined && typeof data.demo !== 'boolean')) throw new Error('Invalid room request.');
    if (data.rehearsal !== undefined && typeof data.rehearsal !== 'boolean') throw new Error('Choose a valid rehearsal mode.');
    const name = data.name === undefined ? 'Game master' : displayName(data.name);
    await this.repository.purgeExpired(this.now());
    for (let attempt = 0; attempt < 16; attempt++) {
      const engine = new GameEngine({ now: this.now });
      const session = engine.create({ rehearsal: data.rehearsal === true });
      if (data.demo) engine.command(session.code, session.token, { type: 'demo-fill' });
      const now = this.now();
      const ticket = event === 'room:prepare' ? randomSecret() : undefined;
      const claim = ticket ? { hash: await digest(ticket), expiresAt: now + CLAIM_LIFETIME, consumed: false } : undefined;
      const envelope: Envelope = { room: engine.exportRoom(session.code), masterReady: !claim, ...(claim ? { claim } : {}), receipts: [], presence: {}, gameMaster: { id: randomSecret().slice(0, 24), name, epoch: 1, lastSeen: now }, recovery: {}, recoveryRevision: {}, closedPresence: {} };
      const expiresAt = now + ROOM_LIFETIME;
      const privateSession = ticket ? undefined : (await this.issueRecovery(session, envelope, expiresAt, now)).session;
      if (await this.repository.insert({ code: session.code, revision: 0, expiresAt, state: JSON.stringify(envelope) }, now, 500)) return ticket ? { code: session.code, ticket, expiresAt: claim!.expiresAt } : privateSession;
    }
    throw new Error('Room capacity reached. Try again later.');
  }

  private async issueRecovery(own: Session, envelope: Envelope, expiresAt: number, now: number): Promise<{ session: Session; nonce: string }> {
    const nonce = randomSecret();
    const code = await recoveryCode(own.token, nonce);
    const key = recoveryKey(own);
    envelope.recovery[key] = await digest(code);
    const revision = (envelope.recoveryRevision[key] ?? 0) + 1;
    envelope.recoveryRevision[key] = revision;
    return { session: { ...own, name: own.playerId ? own.name : envelope.gameMaster.name, recoveryCode: code, recoveryRevision: revision, expiresAt, updatedAt: now }, nonce };
  }

  private realPlayer(engine: GameEngine, code: string, id: unknown) {
    const player = engine.view(code).players.find(player => player.id === id);
    if (!player) throw new Error('Choose a player in this room.');
    if (player.isDemo) throw new Error('Choose a real guest for game-master recovery.');
    return player;
  }

  private clearPresence(envelope: Envelope, ownPrincipal: string): void {
    for (const [key, presence] of Object.entries(envelope.presence)) if (this.presencePrincipal(presence) === ownPrincipal) delete envelope.presence[key];
    for (const key of Object.keys(envelope.closedPresence)) if (key.startsWith(`${ownPrincipal}:`)) delete envelope.closedPresence[key];
  }

  private presencePrincipal(presence: Presence): string { return presence.principal ?? `player:${presence.playerId}`; }

  private closePresence(envelope: Envelope, own: Session, clientId: unknown, now: number): boolean {
    const client = deviceId(clientId), ownPrincipal = principal(own, envelope);
    const key = `${ownPrincipal}:${client}`;
    const legacyKey = own.playerId ? `${own.playerId}:${client}` : undefined;
    const existed = !!envelope.presence[key] || !!(legacyKey && envelope.presence[legacyKey]);
    delete envelope.presence[key];
    if (legacyKey) delete envelope.presence[legacyKey];
    // Legacy callers have no per-lifetime ID; retain their historic ability to reconnect.
    if (clientId === undefined) return existed;
    const closed = envelope.closedPresence[key] !== undefined;
    envelope.closedPresence[key] = now;
    const entries = Object.entries(envelope.closedPresence).sort((a, b) => a[1] - b[1]);
    for (const [id] of entries.slice(0, Math.max(0, entries.length - 512))) delete envelope.closedPresence[id];
    return existed || !closed;
  }

  private refreshPresence(envelope: Envelope, own: Session, clientId: unknown, now: number): boolean {
    const key = `${principal(own, envelope)}:${deviceId(clientId)}`;
    if (envelope.closedPresence[key] !== undefined) return false;
    if (envelope.presence[key] && now - envelope.presence[key].lastSeen < PRESENCE_REFRESH) return false;
    for (const [id, presence] of Object.entries(envelope.presence)) if (now - presence.lastSeen >= PRESENCE_LIFETIME) delete envelope.presence[id];
    const ownPrincipal = principal(own, envelope);
    const ownSlots = Object.entries(envelope.presence).filter(([, presence]) => this.presencePrincipal(presence) === ownPrincipal);
    if (!envelope.presence[key] && ownSlots.length >= 8) delete envelope.presence[ownSlots.sort((a, b) => a[1].lastSeen - b[1].lastSeen)[0][0]];
    envelope.presence[key] = { principal: ownPrincipal, ...(own.playerId ? { playerId: own.playerId } : {}), lastSeen: now };
    if (!own.playerId) envelope.gameMaster.lastSeen = now;
    return true;
  }

  private connected(envelope: Envelope, ownPrincipal: string, now: number): boolean {
    return Object.values(envelope.presence).some(presence => this.presencePrincipal(presence) === ownPrincipal && now - presence.lastSeen < PRESENCE_LIFETIME);
  }

  private cleanTargets(engine: GameEngine, envelope: Envelope, code: string, now: number): void {
    const players = engine.view(code).players;
    const valid = (id: string) => players.some(player => player.id === id && !player.isDemo);
    if (envelope.gameMaster.backupPlayerId && !valid(envelope.gameMaster.backupPlayerId)) delete envelope.gameMaster.backupPlayerId;
    if (envelope.gameMaster.handoff && (!valid(envelope.gameMaster.handoff.playerId) || envelope.gameMaster.handoff.expiresAt <= now)) delete envelope.gameMaster.handoff;
    if (envelope.gameMaster.linkedPlayerId && !valid(envelope.gameMaster.linkedPlayerId)) delete envelope.gameMaster.linkedPlayerId;
    for (const key of new Set([...Object.keys(envelope.recovery), ...Object.keys(envelope.recoveryRevision)])) if (key !== 'master' && !players.some(player => player.id === key)) {
      delete envelope.recovery[key];
      delete envelope.recoveryRevision[key];
      this.clearPresence(envelope, `player:${key}`);
    }
  }

  private masterView(engine: GameEngine, envelope: Envelope, code: string, now: number): GameMasterView {
    const { lastSeen, handoff, linkedPlayerId: _linkedPlayerId, ...metadata } = envelope.gameMaster;
    const connected = envelope.masterReady && this.connected(envelope, `master:${metadata.id}`, now);
    const players = engine.view(code).players.filter(player => !player.isDemo && this.connected(envelope, `player:${player.id}`, now));
    const candidate = metadata.backupPlayerId ? players.find(player => player.id === metadata.backupPlayerId) : players[0];
    return { ...metadata, connected,
      ...(handoff && handoff.expiresAt > now ? { handoff: { ...handoff } } : {}),
      ...(envelope.masterReady && !connected ? { takeoverAt: lastSeen + TAKEOVER_GRACE,
        ...(now >= lastSeen + TAKEOVER_GRACE && candidate ? { eligiblePlayerId: candidate.id } : {}) } : {}) };
  }

  private view(engine: GameEngine, envelope: Envelope, code: string, token: unknown, now: number, revision: number, expiresAt: number): RoomView {
    const view = engine.view(code, token);
    view.masterReady = envelope.masterReady;
    view.revision = revision;
    view.expiresAt = expiresAt;
    view.gameMaster = this.masterView(engine, envelope, code, now);
    for (const player of view.players) player.connected = player.connected || this.connected(envelope, `player:${player.id}`, now)
      || envelope.gameMaster.linkedPlayerId === player.id && view.gameMaster.connected;
    return view;
  }
}
