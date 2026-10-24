import test from 'node:test';
import assert from 'node:assert/strict';
import { publicJoinOrigin } from '../src/join-origin';

test('hosted QR and invite links retain the actual frontend origin behind an API rewrite',()=>{
  assert.equal(publicJoinOrigin({online:true,joinOrigin:'https://backend.example'},'https://dustfall.vercel.app'),'https://dustfall.vercel.app');
});
test('local phones can still use the configured LAN address',()=>{
  assert.equal(publicJoinOrigin({joinOrigin:'http://192.168.1.2:3000'},'http://localhost:3000'),'http://192.168.1.2:3000');
  assert.equal(publicJoinOrigin({},'https://dustfall.vercel.app'),'https://dustfall.vercel.app');
});
