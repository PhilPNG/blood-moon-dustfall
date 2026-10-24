import type { RoomView, Session } from '../shared/types';
import type { Language } from '../shared/locale';

/** Public screens must never inherit a phone credential from the same browser. */
export function isPublicRoomRoute(kind: string): boolean {
  return kind === 'screen' || kind === 'watch';
}

export function roomSubscribePayload(kind: string, code: string, language: Language, session: Session | undefined, clientId: string) {
  if (isPublicRoomRoute(kind)) return { code, language };
  if (!session) throw new Error('A saved session is required for private phone controls.');
  return { code, language, token: session.token, clientId };
}

export function audienceRoom(room: RoomView): RoomView {
  const { me: _privatePhone, ...publicRoom } = room;
  return { ...publicRoom, isMaster: false };
}
