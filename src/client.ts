import type { PairingTicket, Reply, RoomView, Session, SessionKind } from '../shared/types';
import { readLanguage, translate } from './i18n';
import { forgetSession, getSession, saveSession } from './session-storage';
import { savePairing } from './pairing-storage';

export { forgetSession, getSession, saveSession, savedGames, updateSessionFromView } from './session-storage';
export { getPairing, clearPairing } from './pairing-storage';

const LIFECYCLE_EVENTS = ['room:recovery', 'room:recover', 'room:leave', 'room:gm-profile', 'room:gm-offer', 'room:gm-accept', 'room:gm-takeover'];

export class RpcError extends Error {
  readonly terminal: boolean;
  constructor(message: string, public readonly network: boolean, public readonly code?: string) {
    super(message);
    this.name = 'RpcError';
    this.terminal = !network && ['SESSION_INVALID', 'ROOM_EXPIRED', 'ROOM_NOT_FOUND'].includes(code ?? '');
  }
}

export async function request<T = undefined>(event: string, payload: unknown, requestId: string = crypto.randomUUID()): Promise<T> {
  if (['room:create', 'room:prepare', 'room:claim', 'room:join', 'room:subscribe', 'room:command', 'room:unsubscribe', ...LIFECYCLE_EVENTS].includes(event) && payload && typeof payload === 'object' && !Array.isArray(payload)) {
    payload = { language: readLanguage(), ...payload };
  }
  const retryable = ['room:claim', 'room:join', 'room:command', ...LIFECYCLE_EVENTS].includes(event);
  const body = JSON.stringify({ event, payload, requestId });
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch('/api/rpc', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
        cache: 'no-store', signal: AbortSignal.timeout(12_000),
      });
      const reply = await response.json().catch(() => undefined) as Reply<T> | undefined;
      if (!reply || typeof reply.ok !== 'boolean' || (response.ok && reply.ok && event !== 'room:unsubscribe' && reply.data === undefined)) {
        throw new RpcError(translate(readLanguage(), 'The room returned an incomplete response. Try again shortly.'), true);
      }
      if (!response.ok || !reply.ok) {
        const transient = response.status === 429 || response.status >= 500;
        throw new RpcError(translate(readLanguage(), reply.error || (transient ? 'The room is taking a moment to respond. Try again shortly.' : 'Something went wrong. Please try again.')), transient, reply.errorCode);
      }
      return reply.data as T;
    } catch (cause) {
      const error = cause instanceof RpcError ? cause : new RpcError(translate(readLanguage(), 'The room couldn’t be reached. Check your internet connection and try again.'), true);
      if (retryable && attempt === 0 && error.network) continue;
      throw error;
    }
  }
}

export { formatTime } from '../shared/format';


export async function prepareDisplayRoom(demo = false): Promise<PairingTicket> {
  const pairing = await request<PairingTicket>('room:prepare', { demo });
  savePairing(pairing);
  return pairing;
}

export async function createPhoneRoom(demo = false, name = 'Game master'): Promise<Session> {
  const created = await request<Session>('room:create', { name });
  saveSession('master', created);
  if (demo) await request<RoomView>('room:command', { code: created.code, token: created.token, action: { type: 'demo-fill' } });
  return created;
}

export async function recoverSession(code: string, kind: SessionKind, recoveryCode: string): Promise<Session> {
  const recovered = await request<Session>('room:recover', { code, kind, recoveryCode });
  saveSession(kind, recovered);
  return getSession(kind, recovered.code) ?? recovered;
}

export async function claimMasterSession(code: string, receipt?: { ticket: string; requestId: string }): Promise<Session> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const saved = getSession('master', code);
    if (saved) {
      try {
        const view = await request<RoomView>('room:subscribe', { code, token: saved.token });
        if (view?.code !== code || typeof view.isMaster !== 'boolean') throw new RpcError('The room returned an incomplete response. Try pairing again shortly.', true);
        if (!view.isMaster) throw new RpcError('This browser has no valid game master session.', false, 'SESSION_INVALID');
        const current = getSession('master', code);
        if (current?.token !== saved.token) {
          if (current) continue;
          throw new RpcError('This browser has no valid game master session.', false, 'SESSION_INVALID');
        }
        return current;
      } catch (cause) {
        if (!(cause instanceof RpcError) || !cause.terminal) throw cause;
        const current = getSession('master', code);
        if (current?.token !== saved.token) {
          if (current) continue;
          throw cause;
        }
        forgetSession('master', code);
        if (!receipt) throw cause;
      }
    }
    if (!receipt) throw new Error('This phone needs the game master QR from the original computer pairing screen.');
    const claimed = await request<Session>('room:claim', { code, ticket: receipt.ticket }, receipt.requestId);
    const current = getSession('master', code);
    if (current && current.token !== claimed.token) continue;
    saveSession('master', claimed);
    return getSession('master', code) ?? claimed;
  }
  throw new RpcError(translate(readLanguage(), 'The room is taking a moment to respond. Try again shortly.'), true);
}
