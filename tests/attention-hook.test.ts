import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RoomView } from '../shared/types';
import { useAttentionCountdown } from '../src/useAttentionCountdown';

const room = (attention?: unknown, serverNow = 10_000) => ({
  code:'TEST', phase:'roles', round:0, gameId:'game', actionEpoch:0,
  timer:{endsAt:null,remaining:0,isPaused:false}, attention, serverNow,
}) as RoomView;
const cue = (overrides = {}) => ({ id:1,eventKey:'game:roles:0:attention:0:presentation:0',cue:'phase',endsAt:20_000,remainingMs:10_000,...overrides });
function Clock({ value }: { value: RoomView }) { return createElement('output',null,useAttentionCountdown(value)); }
const rendered = (value:RoomView) => renderToStaticMarkup(createElement(Clock,{value}));

test('attention clock uses server time and retains only the shared remaining delay',()=>{
  assert.equal(rendered(room(cue())),'<output>10</output>');
  assert.equal(rendered(room(cue(),16_000)),'<output>4</output>');
  assert.equal(rendered(room(cue(),20_001)),'<output>0</output>');
});
test('attention clock freezes paused remaining delay and supports old rooms',()=>{
  assert.equal(rendered(room(cue({endsAt:null,remainingMs:4_400}),80_000)),'<output>5</output>');
  assert.equal(rendered(room()),'<output>0</output>');
});
