import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

const origin = new URL(process.argv[2] || 'http://localhost:3001').origin;
let requests = 0;
async function call(event,payload) {
  requests++;
  const response = await fetch(origin+'/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event,payload,requestId:crypto.randomUUID()}),signal:AbortSignal.timeout(12_000)});
  assert.ok([200,400].includes(response.status),'Expected room RPC response');
  return response.json();
}
async function rpc(event,payload) { const reply=await call(event,payload); assert.equal(reply.ok,true,`Expected ${event} to succeed: ${reply.error??''}`); return reply.data; }
const identity = session => ({code:session.code,token:session.token});
const view = session => rpc('room:subscribe',identity(session));
const command = (session,action) => rpc('room:command',{...identity(session),action});
const phaseKey = room => `${room.gameId??`legacy-${room.code}`}:${room.phase}:${room.round}`;
const playbackKey = room => `${phaseKey(room)}${room.presentation?.eventKey===phaseKey(room)?`:presentation:${room.presentation.serial}`:''}${room.playbackEpoch?`:clock:${room.playbackEpoch}`:''}`;

try {
  const master=await rpc('room:create',{rehearsal:true,name:'Attention HTTP QA'});
  const player=await rpc('room:join',{code:master.code,name:'Countdown guest',gender:'any'});
  await command(master,{type:'settings',settings:{rounds:1,roundSeconds:60}});
  await command(master,{type:'start'});
  let room=await view(master);
  assert.equal(room.attention.cue,'phase');
  assert.ok(room.attention.endsAt-room.serverNow>8_000&&room.attention.endsAt-room.serverNow<=10_000);
  const phone=await view(player);
  assert.deepEqual(phone.attention,room.attention,'TV and phone must receive one authoritative cue');
  let publicRoom=await rpc('room:subscribe',{code:master.code});
  assert.equal(publicRoom.me,undefined);
  assert.equal(publicRoom.result,undefined);
  assert.ok(!JSON.stringify(publicRoom.attention).includes(master.token));
  const displayId='attention-http-'+crypto.randomUUID();
  let capability=await rpc('room:display-claim',{code:master.code,displayId});
  const sample=value=>({eventKey:playbackKey(value),clipId:value.phase==='roles'?'opening':'act-3',kind:'film',position:0,playing:true});
  const early=await call('room:playback',{code:master.code,displayId,token:capability.token,sequence:1,playback:sample(room)});
  assert.equal(early.ok,false,'A TV cannot start media before the countdown');
  const unauthorized=await call('room:attention',{code:master.code,displayId,token:player.token,eventKey:room.attention.eventKey,cue:'lobby'});
  assert.equal(unauthorized.ok,false,'A player token must not claim TV presentation authority');

  await delay(450);
  await command(master,{type:'pause'});
  const paused=await view(master);
  assert.equal(paused.attention.id,room.attention.id);
  assert.equal(paused.attention.endsAt,null);
  await delay(450);
  assert.equal((await view(player)).attention.remainingMs,paused.attention.remainingMs,'Pause must freeze the shared lead-in');
  await command(master,{type:'resume'});
  room=await view(master);
  assert.equal(room.attention.id,paused.attention.id);
  assert.ok(Math.abs(room.attention.endsAt-room.serverNow-paused.attention.remainingMs)<500);
  await command(master,{type:'presentation',control:'replay'});
  const replay=await view(master);
  assert.ok(replay.attention.id>room.attention.id,'Replay needs a new shared cue');
  await command(master,{type:'presentation',control:'skip'});
  const skipped=await view(master);
  assert.equal(skipped.attention.id,replay.attention.id,'Skipping film must preserve the narration countdown');
  assert.equal(skipped.attention.endsAt,replay.attention.endsAt);

  await command(player,{type:'ready',ready:true});
  await command(master,{type:'advance'});
  room=await view(master);
  assert.equal(room.phase,'investigation');
  assert.equal(room.timer.remaining,60,'The lead-in must preserve the complete act duration');
  assert.equal(room.timer.startsAt,room.attention.endsAt);
  await command(master,{type:'extend-time'});
  const extended=await view(master);
  assert.equal(extended.timer.remaining,120);
  assert.equal(extended.attention.endsAt,room.attention.endsAt);
  await delay(500);
  assert.equal((await view(player)).timer.remaining,120,'Time must remain held during attention');
  await rpc('room:unsubscribe',{...identity(player),clientId:'attention-http-phone'});
  assert.equal((await view(player)).attention.id,room.attention.id,'A reconnect must retain the original countdown');

  // Exercise the actual ten-second deadline while keeping the scoped display lease alive.
  const releaseAt=performance.now()+Math.max(0,room.attention.endsAt-room.serverNow)+150;
  while(performance.now()<releaseAt){
    await delay(Math.min(2_000,Math.max(1,releaseAt-performance.now())));
    capability=await rpc('room:display-claim',{code:master.code,displayId,token:capability.token});
  }
  room=await view(master);
  assert.ok(room.timer.remaining<=120&&room.timer.remaining>=118);
  assert.equal(room.timer.startsAt,undefined);
  const accepted=await rpc('room:playback',{code:master.code,displayId,token:capability.token,sequence:2,playback:sample(room)});
  assert.equal(accepted.accepted,true,'The same TV can play as soon as the shared gate opens');
  publicRoom=await rpc('room:subscribe',{code:master.code});
  assert.equal(publicRoom.playback.playing,true);
  await command(master,{type:'reset'});
  const reset=await view(player);
  assert.equal(reset.phase,'lobby');
  assert.equal(reset.attention,undefined);
  assert.equal(reset.me.role,undefined);
  console.log(`Attention countdown verified: shared TV/phone clock, early media rejection, pause/resume, replay/skip, reconnect and protected act time (${requests} RPC calls).`);
}catch(error){ console.error('Attention verification failed:',error instanceof Error?error.message:'Unknown failure'); process.exitCode=1; }
