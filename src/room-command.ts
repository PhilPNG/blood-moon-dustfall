import type { Action, RoomView, Session } from '../shared/types';
import type { Language } from '../shared/locale';

/** Snapshot the game step visible when the user submitted their action. */
export function roomCommandPayload(room: RoomView, session: Session, action: Action, language: Language) {
  return { code: room.code, token: session.token, action, language, context: { gameId: room.gameId ?? null, phase: room.phase, round: room.round, actionEpoch: room.actionEpoch ?? 0 } };
}
