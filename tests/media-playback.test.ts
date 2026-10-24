import test from 'node:test';
import assert from 'node:assert/strict';
import { observeNativePlayback } from '../src/components/media-playback.js';
import type { MediaPlaybackReport } from '../shared/types.js';

class BufferedMedia extends EventTarget {
  currentTime = 0;
  readyState = 4;
  paused = false;
  ended = false;
  seeking = false;
}

test('native stalled events do not silence captions while buffered media keeps advancing', context => {
  let now = 0;
  context.mock.method(performance, 'now', () => now);
  const media = new BufferedMedia(), reports: MediaPlaybackReport[] = [];
  const stop = observeNativePlayback(media as unknown as HTMLMediaElement, { eventKey: 'game:roles:0', clipId: 'opening', kind: 'film' }, sample => reports.push(sample));
  try {
    media.dispatchEvent(new Event('playing'));
    media.dispatchEvent(new Event('stalled'));
    now = 2000; media.currentTime = 2;
    media.dispatchEvent(new Event('timeupdate'));
    now = 4000; media.currentTime = 4;
    media.dispatchEvent(new Event('timeupdate'));
    assert.equal(reports.at(-1)?.playing, true);
    assert.equal(reports.at(-1)?.position, 4);
    media.readyState = 2;
    media.dispatchEvent(new Event('waiting'));
    assert.equal(reports.at(-1)?.playing, false);
    media.readyState = 4;
    now = 6000; media.currentTime = 6;
    media.dispatchEvent(new Event('timeupdate'));
    assert.equal(reports.at(-1)?.playing, true, 'progress after buffering must recover even without another playing event');
  } finally { stop(); }
  assert.equal(reports.at(-1)?.playing, false, 'unmount retires the clock');
});
