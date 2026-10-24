import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameServer } from '../server/app';
import type { PairingTicket, Session, RoomView, Reply } from '../shared/types';

test('HTTP phone pairing gives control only to the claiming phone and public views stay anonymous',async()=>{
  const app=await createGameServer({vite:false});
  const port=await app.listen(0,'127.0.0.1');
  const rpc=async<T>(event:string,payload:unknown,requestId:string):Promise<Reply<T>>=>{
    const response=await fetch('http://127.0.0.1:'+port+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event,payload,requestId})});
    assert.ok([200,400].includes(response.status),'Expected an RPC response, received HTTP '+response.status);
    return response.json() as Promise<Reply<T>>;
  };
  try{
    const prepared=await rpc<PairingTicket>('room:prepare',{},'prepare-integration');
    assert.equal(prepared.ok,true);assert.ok(prepared.data?.ticket);assert.equal('token' in prepared.data!,false);
    const code=prepared.data!.code;
    const waiting=await rpc<RoomView>('room:subscribe',{code},'waiting-integration');
    assert.equal(waiting.data?.masterReady,false);
    const claimed=await rpc<Session>('room:claim',{code,ticket:prepared.data!.ticket},'claim-integration');
    assert.equal(claimed.ok,true);assert.ok(claimed.data?.token);
    const repeated=await rpc<Session>('room:claim',{code,ticket:prepared.data!.ticket},'claim-integration');
    assert.deepEqual(repeated.data,claimed.data);
    const stolen=await rpc<Session>('room:claim',{code,ticket:prepared.data!.ticket},'stolen-integration');
    assert.equal(stolen.ok,false);
    const view=await rpc<RoomView>('room:subscribe',{code},'public-integration');
    assert.equal(view.data?.masterReady,true);assert.equal(view.data?.isMaster,false);
    assert.equal(JSON.stringify(view).includes(claimed.data!.token),false);
    const master=await rpc<RoomView>('room:subscribe',{code,token:claimed.data!.token},'master-integration');
    assert.equal(master.data?.isMaster,true);
    const revoked=await rpc<RoomView>('room:subscribe',{code,token:'forged'},'revoked-integration');
    assert.equal(revoked.errorCode,'SESSION_INVALID');
    const invalid=await rpc<RoomView>('room:command',{code,token:claimed.data!.token,action:{type:'start'}},'incomplete-integration');
    assert.equal(invalid.errorCode,'INVALID_REQUEST');
  }finally{await app.close();}
});
