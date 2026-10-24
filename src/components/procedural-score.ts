import type { Phase, RoomView } from '../../shared/types';

export interface MusicGate { sound: boolean; leader: boolean; connected: boolean; visible: boolean; mediaBusy: boolean; attention: boolean; preflight: boolean }
export function stageMusicGain(room: RoomView, gate: MusicGate): number {
  if (!room.stageSettings?.musicEnabled || !gate.sound || !gate.leader || !gate.connected || !gate.visible
    || room.timer.isPaused || gate.attention || gate.preflight) return 0;
  const volume = room.stageSettings.musicVolume;
  const level = .045 * Math.max(0, Math.min(100, Number.isFinite(volume) ? volume : 25)) / 100;
  return gate.mediaBusy ? level * .12 : level;
}
export interface ProceduralScore { setLevel: (level: number) => void; stop: () => void }

/** Original four-bar frontier motif. This owns only its graph; Sound unlock owns the context. */
export function createProceduralScore(context: AudioContext, phase: Phase): ProceduralScore {
  const output = context.createGain(); output.gain.setValueAtTime(0, context.currentTime); output.connect(context.destination);
  const voices = new Set<{ source: AudioScheduledSourceNode; clean: () => void }>();
  const noise = context.createBuffer(1, Math.ceil(context.sampleRate * .12), context.sampleRate);
  const samples = noise.getChannelData(0);
  let seed = 7321;
  for (let index = 0; index < samples.length; index++) { seed = (seed * 16807) % 2147483647; samples[index] = (seed / 1073741823.5 - 1) * (1 - index / samples.length); }
  const stepSeconds = 60 / (phase === 'voting' ? 64 : phase === 'results' ? 76 : 72) / 2;
  const roots = [50, 46, 53, 48], pattern = [12, 19, 24, 15, 19, 24, 22, 19];
  let step = 0, nextAt = context.currentTime + .025, stopped = false, currentLevel = 0;
  function register(source: AudioScheduledSourceNode, nodes: AudioNode[]) {
    const voice = { source, clean: () => { source.disconnect(); nodes.forEach(node => node.disconnect()); voices.delete(voice); } };
    voices.add(voice); source.onended = voice.clean;
  }
  function tone(midi: number, at: number, bass: boolean) {
    const source = context.createOscillator(), envelope = context.createGain(), filter = context.createBiquadFilter();
    source.type = bass ? 'sine' : 'triangle'; source.frequency.setValueAtTime(440 * 2 ** ((midi - 69) / 12), at);
    filter.type = 'lowpass'; filter.frequency.setValueAtTime(bass ? 400 : 1800, at);
    const duration = bass ? .72 : .48;
    envelope.gain.setValueAtTime(.0001, at); envelope.gain.linearRampToValueAtTime(bass ? .42 : .7, at + .008); envelope.gain.exponentialRampToValueAtTime(.0001, at + duration);
    source.connect(filter); filter.connect(envelope); envelope.connect(output); register(source, [filter, envelope]); source.start(at); source.stop(at + duration + .02);
  }
  function brush(at: number) {
    const source = context.createBufferSource(), envelope = context.createGain(), filter = context.createBiquadFilter();
    source.buffer = noise; filter.type = 'highpass'; filter.frequency.setValueAtTime(2200, at);
    envelope.gain.setValueAtTime(.075, at); envelope.gain.exponentialRampToValueAtTime(.0001, at + .1);
    source.connect(filter); filter.connect(envelope); envelope.connect(output); register(source, [filter, envelope]); source.start(at); source.stop(at + .12);
  }
  function schedule() {
    if (stopped) return;
    const now = context.currentTime;
    if (nextAt < now - .25) nextAt = now + .025;
    while (nextAt < now + .25) {
      const barStep = step % 8, root = roots[Math.floor(step / 8) % roots.length];
      if (phase !== 'voting' || step % 2 === 0) tone(root + pattern[barStep], nextAt, false);
      if (barStep === 0 || barStep === 4) tone(root - 12, nextAt, true);
      if ((phase === 'investigation' || phase === 'results') && step % 2 === 1) brush(nextAt);
      step++; nextAt += stepSeconds;
    }
  }
  schedule(); const timer = setInterval(schedule, 100);
  return {
    setLevel(level) {
      if (stopped) return;
      const target = Math.max(0, Math.min(.045, Number.isFinite(level) ? level : 0));
      output.gain.cancelScheduledValues(context.currentTime);
      output.gain.setTargetAtTime(target, context.currentTime, target < currentLevel ? .035 : .2); currentLevel = target;
    },
    stop() {
      if (stopped) return;
      stopped = true; clearInterval(timer);
      output.gain.cancelScheduledValues(context.currentTime); output.gain.setValueAtTime(0, context.currentTime);
      for (const voice of [...voices]) { try { voice.source.stop(); } catch { /* Already ended. */ } voice.clean(); }
      output.disconnect();
    },
  };
}
