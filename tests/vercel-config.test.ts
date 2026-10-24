import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest, type IncomingMessage } from 'node:http';
// Plain ESM is shared with Vercel's native Node function runtime.
// @ts-expect-error JavaScript handler has no separate declaration file.
import handler from '../api/config.mjs';

test('Vercel config uses the requested frontend host, not a forwarded backend origin',async()=>{
  const server=createServer(handler);
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const address=server.address(); assert.ok(address&&typeof address==='object');
    const url=`http://127.0.0.1:${address.port}/api/config`;
    const response=await new Promise<IncomingMessage>((resolve,reject)=>{
      const outgoing=httpRequest(url,{headers:{host:'blood-moon-dustfall.vercel.app','x-forwarded-host':'upstream.example'}},resolve);
      outgoing.on('error',reject);outgoing.end();
    });
    let body='';for await(const chunk of response)body+=chunk;
    assert.equal(response.statusCode,200);
    assert.equal(response.headers['cache-control'],'no-store');
    assert.deepEqual(JSON.parse(body),{joinOrigin:'https://blood-moon-dustfall.vercel.app',pollInterval:1000,online:true});
    const forbidden=await fetch(url,{method:'POST'});
    assert.equal(forbidden.status,405);
  }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
