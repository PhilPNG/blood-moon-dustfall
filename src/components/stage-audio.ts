/** A TV keeps its local Sound preference while the live lease decides whether it may emit audio. */
export function stageAudioEnabled(sound: boolean, mediaLeader: boolean): boolean {
  return sound && mediaLeader;
}
