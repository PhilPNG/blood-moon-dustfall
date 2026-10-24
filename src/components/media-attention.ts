import type { Attention, RoomView } from '../../shared/types';
import { attentionEventKey } from '../../shared/attention';
import { narrationCue, type NarrationCueOptions } from '../../shared/narration';
import { cinematicEvent, syncClueCue, type ClueCueState } from '../../shared/cinematics';

export type IncidentalAttentionCue = 'lobby' | 'clue' | 'timer-warning';
export interface AttentionReceipt { attention: Attention; serverNow: number }
export type AttentionRequester = (cue: IncidentalAttentionCue, clueId?: string) => Promise<AttentionReceipt | null>;
export interface AttentionPermit { key: string; eventKey: string; id: number }
export function skipCluePresentation(room: RoomView, previous: ClueCueState | undefined, history: { claim: (key: string) => boolean }): { eventKey: string; state: ClueCueState } | undefined {
  const event = cinematicEvent(room);
  if (room.phase !== 'investigation' || !event || room.presentation?.control !== 'skip'
    || room.presentation.eventKey !== event.key || room.attention?.cue !== 'clue'
    || room.attention.eventKey !== attentionEventKey(room)) return undefined;
  history.claim(`${event.key}:clue`);
  const state = previous?.eventKey === event.key ? previous : syncClueCue(undefined, event.key, [], true).state;
  return { eventKey: event.key, state: { ...state, pending: false, played: true } };
}
export function attentionClueId(previous: ClueCueState | undefined, publishedIds: string[], pendingId?: string): string | undefined {
  return publishedIds.find(id => !previous?.seen.includes(id)) ?? (pendingId && publishedIds.includes(pendingId) ? pendingId : undefined);
}
export function resumeClueAttention(room: RoomView, previous: ClueCueState | undefined, publishedIds: string[], consumed: boolean): { state: ClueCueState; permit: AttentionPermit } | undefined {
  const event = cinematicEvent(room), cue = room.attention;
  if (consumed || room.phase !== 'investigation' || !event || cue?.cue !== 'clue' || cue.eventKey !== attentionEventKey(room)) return undefined;
  const state = previous?.eventKey === event.key ? previous : syncClueCue(undefined, event.key, publishedIds, true).state;
  return { state: { ...state, pending: true, played: false }, permit: { key: `${event.key}:clue`, eventKey: cue.eventKey, id: cue.id } };
}
export function groupedNarrationCue(room: RoomView, options: NarrationCueOptions) {
  const acceptedWarning = room.attention?.cue === 'timer-warning' && room.attention.eventKey === attentionEventKey(room);
  return narrationCue(room, { ...options, timerConsumed: options.timerConsumed || (!acceptedWarning && options.remaining < 29) || (options.evidenceReady && !options.evidenceConsumed) });
}
export function filmHistoryKey(room: RoomView, eventKey: string): string {
  return room.presentation?.eventKey === eventKey ? `${eventKey}:presentation:${room.presentation.serial}` : eventKey;
}

export function attentionRequestPayload(room: RoomView, displayId: string, token: string, cue: IncidentalAttentionCue, clueId?: string): Record<string, unknown> {
  const phase = `${room.gameId ?? `legacy-${room.code}`}:${room.phase}:${room.round}`;
  return {
    code: room.code, displayId, token, eventKey: attentionEventKey(room), cue,
    context: { gameId: room.gameId ?? null, phase: room.phase, round: room.round, actionEpoch: room.actionEpoch ?? 0 },
    ...(room.presentation?.eventKey === phase ? { presentationSerial: room.presentation.serial } : {}),
    ...(cue === 'clue' && clueId ? { clueId } : {}),
  };
}

/** Bridge the claim-to-poll gap without replacing a later authoritative pause/advance. */
export function withAttentionReceipt(room: RoomView, receipt: AttentionReceipt | null): RoomView {
  if (!receipt || receipt.attention.eventKey !== attentionEventKey(room)
    || (room.serverNow !== undefined && room.serverNow >= receipt.serverNow)
    || (room.attention && room.attention.id > receipt.attention.id)) return room;
  return { ...room, attention: receipt.attention, serverNow: receipt.serverNow };
}

export function attentionPermitReleased(room: RoomView, permit: AttentionPermit | null, key: string, seconds: number): boolean {
  return !!permit && permit.key === key && permit.eventKey === attentionEventKey(room)
    && permit.id === room.attention?.id && seconds <= 0 && !room.timer.isPaused;
}
