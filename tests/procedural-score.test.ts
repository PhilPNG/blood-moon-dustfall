import test from 'node:test';
import assert from 'node:assert/strict';
import type { RoomView } from '../shared/types';
import { createProceduralScore, stageMusicGain, type MusicGate } from '../src/components/procedural-score';
import { displayLease } from '../src/components/display-lease';

const room: RoomView = { code: 'SHOW', phase: 'lobby', round: 0, settings: { rounds: 3, roundSeconds: 300, maxPlayers: 20 }, players: [], isLocked: false, isMaster: false, timer: { endsAt: null, remaining: 0, isPaused: false }, clues: [], votesCount: 0 };
const audible: MusicGate = { sound: true, leader: true, connected: true, visible: true, mediaBusy: false, attention: false, preflight: false };

test('music is silent by default and requires both the GM setting and this TV sound gesture/lease', () => {
  assert.equal(stageMusicGain(room, audible), 0);
  const enabled = { ...room, stageSettings: { distanceMode: false, musicEnabled: true, musicVolume: 25 } };
  const normal = stageMusicGain(enabled, audible); assert.ok(normal >= .025 && normal <= .035, '25% must reach a restrained but audible output range before the pluck envelope');
  for (const key of ['sound', 'leader', 'connected', 'visible'] as const) assert.equal(stageMusicGain(enabled, { ...audible, [key]: false }), 0, key);
  for (const key of ['attention', 'preflight'] as const) assert.equal(stageMusicGain(enabled, { ...audible, [key]: true }), 0, key);
  assert.equal(stageMusicGain({ ...enabled, timer: { ...enabled.timer, isPaused: true } }, audible), 0);
  assert.equal(stageMusicGain(enabled, { ...audible, mediaBusy: true }), normal * .12);
  assert.equal(stageMusicGain({ ...enabled, stageSettings: { ...enabled.stageSettings, musicVolume: 0 } }, audible), 0);
});

test('the active display music lease expires conservatively even if renewal hangs or another TV takes over', context => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  context.mock.method(performance, 'now', () => Date.now());
  const states: boolean[] = [], lease = displayLease(active => states.push(active));
  lease.renew(0); assert.equal(states.at(-1), true);
  context.mock.timers.tick(7_500); assert.equal(states.at(-1), false);
  lease.renew(0); assert.equal(states.at(-1), false, 'a late response cannot revive an already expired conservative lease');
  lease.renew(7_500); assert.equal(states.at(-1), true);
  lease.revoke(); context.mock.timers.tick(100); lease.renew(7_500);
  assert.equal(states.at(-1), false, 'an in-flight response started before explicit revocation cannot revive music');
  context.mock.timers.tick(8_000); assert.equal(states.at(-1), false);
});

class Parameter {
  value = 0; values: number[] = [];
  setValueAtTime(value: number) { this.value = value; this.values.push(value); }
  linearRampToValueAtTime(value: number) { this.value = value; this.values.push(value); }
  exponentialRampToValueAtTime(value: number) { this.value = value; this.values.push(value); }
  setTargetAtTime(value: number) { this.value = value; this.values.push(value); }
  cancelScheduledValues() {}
}
class GraphNode {
  gain = new Parameter(); frequency = new Parameter(); Q = new Parameter();
  type = ''; buffer: unknown; onended?: () => void;
  starts: number[] = []; stops = 0; disconnected = false;
  connections: unknown[] = [];
  connect(node: unknown) { this.connections.push(node); return node; }
  disconnect() { this.disconnected = true; }
  start(time: number) { this.starts.push(time); }
  stop() { this.stops++; }
}
class SoundContext {
  sampleRate = 8_000; destination = new GraphNode(); sources: GraphNode[] = []; gains: GraphNode[] = [];
  get currentTime() { return Date.now() / 1000; }
  createGain() { const gain = new GraphNode(); this.gains.push(gain); return gain; }
  createBiquadFilter() { return new GraphNode(); }
  createOscillator() { const source = new GraphNode(); this.sources.push(source); return source; }
  createBufferSource() { const source = new GraphNode(); this.sources.push(source); return source; }
  createBuffer(_channels: number, length: number) { return { getChannelData: () => new Float32Array(length) }; }
}

test('the procedural score schedules bounded original notes and retires every source/timer on stop', context => {
  context.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 0 });
  const audio = new SoundContext();
  const score = createProceduralScore(audio as unknown as AudioContext, 'investigation');
  const enabled = { ...room, stageSettings: { distanceMode: false, musicEnabled: true, musicVolume: 25 } };
  score.setLevel(stageMusicGain(enabled, audible));
  const output = audio.gains[0];
  assert.ok(output.gain.value >= .025 && output.gain.value <= .035);
  assert.ok(output.connections.includes(audio.destination), 'the score output must reach the actual destination graph');
  assert.ok(audio.sources.some(source => source.starts.length > 0), 'the score must actually schedule audible notes');
  for (const source of audio.sources) {
    const filter = source.connections[0] as GraphNode, envelope = filter.connections[0] as GraphNode;
    assert.ok(envelope.connections.includes(output), 'every scheduled instrument must route through the controlled music output');
  }
  score.setLevel(stageMusicGain({ ...enabled, stageSettings: { ...enabled.stageSettings, musicVolume: 100 } }, audible));
  assert.ok(output.gain.value > .1 && output.gain.value <= .12, 'the source player must preserve the safe full-volume level rather than silently clamp to an old cap');
  score.setLevel(stageMusicGain(enabled, { ...audible, mediaBusy: true }));
  assert.ok(output.gain.value >= .003 && output.gain.value <= .004, 'native score gain must duck for films and narration');
  score.setLevel(10);
  assert.ok(output.gain.value <= .12, 'an excessive caller level must stay below the headroom cap');
  context.mock.timers.tick(5_000);
  assert.ok(audio.sources.length < 50, 'the lookahead cannot schedule an unbounded future song');
  score.stop();
  const count = audio.sources.length;
  assert.ok(audio.sources.every(source => source.stops > 0 && source.disconnected));
  context.mock.timers.tick(30_000);
  assert.equal(audio.sources.length, count, 'a stopped loop cannot create more audio nodes');
});
