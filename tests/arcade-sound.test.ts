import test from 'node:test';
import assert from 'node:assert/strict';
import { createArcadeSound } from '../src/components/arcade-sound';

class NativeContext extends EventTarget {
  state = 'suspended';
  resumes = 0;
  closes = 0;
  resumeResult: () => Promise<void> = async () => { this.transition('running'); };
  transition(state: string) { this.state = state; this.dispatchEvent(new Event('statechange')); }
  async resume() { this.resumes++; await this.resumeResult(); }
  async close() { this.closes++; this.transition('closed'); }
}

test('a native audio interruption preserves Sound preference and asks the next gesture to resume it', async () => {
  const native = new NativeContext();
  const updates: { enabled: boolean; needsResume: boolean }[] = [];
  let creations = 0;
  const sound = createArcadeSound(() => { creations++; return native; }, () => updates.push(sound.snapshot()));
  assert.equal(sound.snapshot().enabled, false);
  assert.equal(creations, 0, 'mounting must not create or unlock audio');
  await sound.toggle();
  assert.equal(sound.snapshot().enabled, true);
  native.transition('interrupted');
  assert.deepEqual(updates.at(-1) && { enabled: updates.at(-1)!.enabled, needsResume: updates.at(-1)!.needsResume }, { enabled: true, needsResume: true });
  assert.equal(native.resumes, 1, 'statechange must never auto-resume without a gesture');
  await sound.toggle();
  assert.equal(sound.snapshot().enabled, true, 'the recovery gesture must not mute the saved preference');
  assert.equal(sound.snapshot().needsResume, false);
  assert.equal(native.resumes, 2);
  await sound.toggle();
  assert.equal(sound.snapshot().enabled, false, 'the normal running Sound control still mutes');
  native.transition('suspended');
  assert.equal(sound.snapshot().needsResume, false, 'an intentionally muted TV must not request recovery');
  assert.equal(native.resumes, 2);
  sound.close();
});

test('suspended and interrupted contexts resume, while a closed native context is replaced on the gesture', async () => {
  for (const state of ['suspended', 'interrupted', 'closed']) {
    const first = new NativeContext(), replacement = new NativeContext();
    let creations = 0;
    const sound = createArcadeSound(() => ++creations === 1 ? first : replacement, () => {});
    await sound.toggle(); first.transition(state);
    await sound.toggle();
    assert.equal(sound.snapshot().enabled, true, state);
    assert.equal(sound.snapshot().needsResume, false, state);
    assert.equal(sound.snapshot().context?.state, 'running', state);
    assert.equal(creations, state === 'closed' ? 2 : 1, state);
    sound.close();
  }
});

test('a rejected resume remains retryable and an explicit mute cancels the preference without unlocking audio', async () => {
  const native = new NativeContext();
  const sound = createArcadeSound(() => native, () => {});
  await sound.toggle(); native.transition('suspended');
  native.resumeResult = async () => { throw new Error('gesture was denied'); };
  assert.equal(await sound.toggle(), false);
  assert.equal(sound.snapshot().enabled, true);
  assert.equal(sound.snapshot().needsResume, true);
  assert.equal(sound.snapshot().pending, false);
  sound.mute();
  assert.equal(sound.snapshot().enabled, false);
  assert.equal(sound.snapshot().needsResume, false);
  assert.equal(native.resumes, 2);
  native.resumeResult = async () => { native.transition('running'); };
  assert.equal(await sound.toggle(), true);
  assert.equal(sound.snapshot().needsResume, false);
  sound.close();
});

test('overlapping recovery taps do not repeat a native resume or revive a preference muted while pending', async () => {
  const native = new NativeContext();
  let finish!: () => void;
  native.resumeResult = () => new Promise(resolve => { finish = () => { native.transition('running'); resolve(); }; });
  const sound = createArcadeSound(() => native, () => {});
  const first = sound.toggle();
  const repeated = sound.toggle();
  assert.equal(native.resumes, 1);
  assert.equal(sound.snapshot().pending, true);
  sound.mute(); finish(); await Promise.all([first, repeated]);
  assert.equal(sound.snapshot().enabled, false);
  assert.equal(sound.snapshot().pending, false);
  sound.close();
});

test('closing detaches state updates and retires pending completion, while a fresh mount can unlock again', async () => {
  const old = new NativeContext(), fresh = new NativeContext();
  let finish!: () => void, updates = 0, creations = 0;
  old.resumeResult = () => new Promise(resolve => { finish = () => { old.transition('running'); resolve(); }; });
  const sound = createArcadeSound(() => ++creations === 1 ? old : fresh, () => { updates++; });
  const pending = sound.toggle();
  sound.close(); const stoppedUpdates = updates;
  finish(); await pending; old.transition('interrupted');
  assert.equal(updates, stoppedUpdates, 'retired native events and promises cannot update an unmounted display');
  assert.equal(sound.snapshot().enabled, false);
  assert.equal(sound.snapshot().context, null);
  assert.equal(old.closes, 1);
  await sound.toggle();
  assert.equal(sound.snapshot().context, fresh);
  assert.equal(sound.snapshot().enabled, true);
  sound.close();
});
