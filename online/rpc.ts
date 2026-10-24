import type { Reply, RoomView } from '../shared/types';
import { normalizeLanguage } from '../shared/locale';
import { localizeError, localizeRoomView } from '../server/localization';
import type { OnlineGameService } from './service';

export async function executeRpc(service:OnlineGameService,input:unknown):Promise<Reply<unknown>> {
  let language=normalizeLanguage(undefined);
  try {
    if(!input || typeof input!=='object' || Array.isArray(input))throw new Error('Invalid request.');
    const {event,payload,requestId}=input as Record<string,unknown>;
    // Language is a presentation preference, never part of persisted state, command receipts or authority.
    let requestPayload=payload;
    if(payload&&typeof payload==='object'&&!Array.isArray(payload)){
      const {language:requestedLanguage,...canonicalPayload}=payload as Record<string,unknown>;
      if(requestedLanguage!==undefined&&!['en','es','pt-BR'].includes(requestedLanguage as string))throw new Error('Invalid language.');
      language=normalizeLanguage(requestedLanguage);
      requestPayload=canonicalPayload;
    }
    if(typeof event!=='string'||!event.startsWith('room:')||event.length>40)throw new Error('Invalid room operation.');
    if(requestId!==undefined&&(typeof requestId!=='string'||!/^[a-zA-Z0-9_-]{8,80}$/.test(requestId)))throw new Error('Invalid request receipt.');
    const data=await service.execute(event,requestPayload,{requestId:requestId as string|undefined});
    const isRoomView=(value:unknown):value is RoomView=>!!value&&typeof value==='object'&&'phase' in value&&'players' in value&&'clues' in value;
    return data===undefined?{ok:true}:{ok:true,data:isRoomView(data)?localizeRoomView(data,language):data};
  }catch(cause){
    const message=cause instanceof Error?cause.message:'The room could not respond.';
    const internal=/D1_ERROR|SQLITE|database|binding|no such table|syntax error|fetch failed/i.test(message);
    const errorCode=internal?'TEMPORARY':/invalid or revoked session token|invalid session token|valid session token is required/i.test(message)?'SESSION_INVALID':/room has expired/i.test(message)?'ROOM_EXPIRED':/room not found/i.test(message)?'ROOM_NOT_FOUND':/room is busy/i.test(message)?'BUSY':'INVALID_REQUEST';
    const publicMessage=internal?'The online room is temporarily unavailable. Please try again.':message;
    return {ok:false,error:localizeError(publicMessage,language),errorCode};
  }
}
