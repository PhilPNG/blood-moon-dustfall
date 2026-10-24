import test from 'node:test';
import assert from 'node:assert/strict';
import { isPublicRoomRoute, roomSubscribePayload, audienceRoom } from '../src/audience-routing';
import type { RoomView } from '../shared/types';

const identity={code:'DUST',token:'PRIVATE_GM_BEARER'};
test('audience and TV subscriptions never attach a saved phone bearer or device identity',()=>{
  for(const kind of ['watch','screen']){
    assert.equal(isPublicRoomRoute(kind),true);
    const payload=roomSubscribePayload(kind,'DUST','pt-BR',identity,'PRIVATE_DEVICE');
    assert.deepEqual(payload,{code:'DUST',language:'pt-BR'});
    assert.doesNotMatch(JSON.stringify(payload),/PRIVATE/);
  }
});
test('private controllers still require their saved identity and preserve language/presence',()=>{
  for(const kind of ['master','play','dev']){
    assert.equal(isPublicRoomRoute(kind),false);
    assert.deepEqual(roomSubscribePayload(kind,'DUST','es',identity,'phone'),{code:'DUST',language:'es',token:identity.token,clientId:'phone'});
    assert.throws(()=>roomSubscribePayload(kind,'DUST','es',undefined,'phone'),/saved session/i);
  }
});
test('a spectator projection discards accidentally supplied private phone state',()=>{
  const room={code:'DUST',isMaster:true,phase:'results',players:[],me:{playerId:'PRIVATE_PLAYER',partyAwardChoices:{'poker-face':'PRIVATE_VOTE'},role:{secret:'PRIVATE_SECRET'}}} as unknown as RoomView;
  const safe=audienceRoom(room);
  assert.equal(safe.isMaster,false);assert.equal(safe.me,undefined);
  assert.doesNotMatch(JSON.stringify(safe),/PRIVATE/);
  assert.equal(room.isMaster,true,'The source private controller must not be mutated');
});
