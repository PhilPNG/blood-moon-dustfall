import test from 'node:test';
import assert from 'node:assert/strict';
import * as client from '../src/client.js';

// The transport boundary is external; keep the real request/retry logic under test.
test('a lost command response retries with the identical receipt and returns the recovered view', async () => {
  const originalFetch = globalThis.fetch;
  const bodies: unknown[] = [];
  globalThis.fetch = async (input, init) => {
    assert.equal(input, '/api/rpc');
    assert.equal(init?.method, 'POST');
    bodies.push(JSON.parse(init?.body as string));
    if (bodies.length === 1) throw new TypeError('connection lost');
    return Response.json({ ok: true, data: { code: 'CASE', revision: 4 } });
  };
  try {
    const view = await client.request<{ code: string; revision: number }>('room:command', { code: 'CASE', token: 'private', action: { type: 'advance' } }, 'receipt-a');
    assert.deepEqual(view, { code: 'CASE', revision: 4 });
    assert.equal(bodies.length, 2);
    assert.deepEqual(bodies[0], { event: 'room:command', payload: { language: 'en', code: 'CASE', token: 'private', action: { type: 'advance' } }, requestId: 'receipt-a' });
    assert.deepEqual(bodies[1], bodies[0]);
  } finally { globalThis.fetch = originalFetch; }
});

test('domain rejection is not retried and keeps its useful error', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ ok: false, error: 'This phone has been removed.' }, { status: 400 }); };
  try {
    await assert.rejects(client.request('room:subscribe', { code: 'CASE' }), error => error instanceof Error && error.message === 'This phone has been removed.' && (error as Error & { network: boolean }).network === false);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test('room creation and preparation do not repeat an ambiguous request', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ ok: false, error: 'Storage unavailable.' }, { status: 503 }); };
  try {
    for (const event of ['room:create', 'room:prepare']) {
      await assert.rejects(client.request(event, {}), error => error instanceof Error && (error as Error & { network: boolean }).network === true);
    }
    assert.equal(calls, 2);
  } finally { globalThis.fetch = originalFetch; }
});

test('join and claim retry a transient response once without changing the request id', async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const event of ['room:join', 'room:claim']) {
      const receipts: string[] = [];
      globalThis.fetch = async (_input, init) => {
        receipts.push(JSON.parse(init?.body as string).requestId);
        return receipts.length === 1 ? Response.json({ ok: false, error: 'Busy.' }, { status: 503 }) : Response.json({ ok: true, data: { code: 'CASE', token: 'secret' } });
      };
      assert.deepEqual(await client.request(event, { code: 'CASE' }), { code: 'CASE', token: 'secret' });
      assert.equal(receipts.length, 2);
      assert.equal(receipts[0], receipts[1]);
      assert.ok(receipts[0]);
    }
  } finally { globalThis.fetch = originalFetch; }
});

test('rate limiting and malformed replies remain transient and never revoke a saved session', async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const response of [new Response('<html>rate limited</html>', { status: 429 }), new Response('<html>temporary gateway</html>', { status: 200 }), Response.json({ surprise: 'missing envelope' })]) {
      globalThis.fetch = async () => response.clone();
      await assert.rejects(client.request('room:subscribe', { code: 'CASE' }), error => error instanceof client.RpcError && error.network && !error.terminal);
    }
    globalThis.fetch = async () => Response.json({ ok: false, error: 'Too many requests.', errorCode: 'INVALID_REQUEST' }, { status: 429 });
    await assert.rejects(client.request('room:subscribe', { code: 'CASE' }), error => error instanceof client.RpcError && error.network && !error.terminal);
  } finally { globalThis.fetch = originalFetch; }
});

test('only explicit identity and expired-room errors authorize forgetting a saved session', async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const [errorCode, terminal] of [['INVALID_REQUEST', false], ['SESSION_INVALID', true], ['ROOM_EXPIRED', true], ['ROOM_NOT_FOUND', true]] as const) {
      globalThis.fetch = async () => Response.json({ ok: false, error: 'Domain rejection', errorCode }, { status: 400 });
      await assert.rejects(client.request('room:subscribe', { code: 'CASE' }), error => error instanceof client.RpcError && !error.network && error.terminal === terminal && error.code === errorCode);
    }
  } finally { globalThis.fetch = originalFetch; }
});

function browserStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } } as Storage;
}

test('the display entry always prepares a ticket and only explicit phone creation stores a bearer', async () => {
  const originalFetch = globalThis.fetch;
  const originalLocal = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const originalSession = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  const local = browserStorage(); const session = browserStorage();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: local });
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: session });
  const events: string[] = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(init?.body as string); events.push(body.event);
    return Response.json({ ok: true, data: body.event === 'room:prepare' ? { code: 'CASE', ticket: 'pair', expiresAt: 900_000 } : { code: 'CASE', token: 'phone-only' } });
  };
  try {
    assert.deepEqual(await client.prepareDisplayRoom(false), { code: 'CASE', ticket: 'pair', expiresAt: 900_000 });
    assert.equal(local.getItem('alibi:master:CASE'), null);
    assert.equal(JSON.parse(session.getItem('alibi:pairing:CASE')!).ticket, 'pair');
    assert.deepEqual(await client.createPhoneRoom(false), { code: 'CASE', token: 'phone-only' });
    assert.equal(JSON.parse(local.getItem('alibi:master:CASE')!).token, 'phone-only');
    assert.deepEqual(events, ['room:prepare', 'room:create']);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalLocal) Object.defineProperty(globalThis, 'localStorage', originalLocal); else Reflect.deleteProperty(globalThis, 'localStorage');
    if (originalSession) Object.defineProperty(globalThis, 'sessionStorage', originalSession); else Reflect.deleteProperty(globalThis, 'sessionStorage');
  }
});

test('a fresh pairing ticket replaces a stale saved master only after explicit session rejection', async () => {
  const originalFetch = globalThis.fetch;
  const originalLocal = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const local = browserStorage();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: local });
  client.saveSession('master', { code: 'CASE', token: 'stale-master' });
  const requests: { event: string; payload: unknown; requestId: string }[] = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(init?.body as string); requests.push(body);
    return body.event === 'room:subscribe' ? Response.json({ ok: false, error: 'Invalid session token.', errorCode: 'SESSION_INVALID' }, { status: 400 }) : Response.json({ ok: true, data: { code: 'CASE', token: 'fresh-master' } });
  };
  try {
    assert.deepEqual(await client.claimMasterSession('CASE', { ticket: 'fresh-ticket', requestId: 'stable-claim' }), { code: 'CASE', token: 'fresh-master' });
    assert.deepEqual(requests.map(value => value.event), ['room:subscribe', 'room:claim']);
    assert.deepEqual(requests[1], { event: 'room:claim', payload: { language: 'en', code: 'CASE', ticket: 'fresh-ticket' }, requestId: 'stable-claim' });
    assert.equal(client.getSession('master', 'CASE')?.token, 'fresh-master');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalLocal) Object.defineProperty(globalThis, 'localStorage', originalLocal); else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('transient validation preserves the existing master and ticket while a verified master skips claiming', async () => {
  const originalFetch = globalThis.fetch;
  const originalLocal = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const local = browserStorage();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: local });
  client.saveSession('master', { code: 'CASE', token: 'saved-master' });
  let claims = 0;
  try {
    for (const response of [new Response('Slow down', { status: 429 }), new Response('Gateway', { status: 200 }), Response.json({ ok: false, error: 'Invalid request.', errorCode: 'INVALID_REQUEST' }, { status: 400 })]) {
      globalThis.fetch = async (_input, init) => { if (JSON.parse(init?.body as string).event === 'room:claim') claims++; return response.clone(); };
      await assert.rejects(client.claimMasterSession('CASE', { ticket: 'fresh-ticket', requestId: 'stable-claim' }));
      assert.equal(client.getSession('master', 'CASE')?.token, 'saved-master');
    }
    globalThis.fetch = async (_input, init) => { if (JSON.parse(init?.body as string).event === 'room:claim') claims++; return Response.json({ ok: true, data: { code: 'CASE', isMaster: true } }); };
    assert.deepEqual(await client.claimMasterSession('CASE', { ticket: 'unused', requestId: 'stable' }), { code: 'CASE', token: 'saved-master' });
    assert.equal(claims, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalLocal) Object.defineProperty(globalThis, 'localStorage', originalLocal); else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('each phone sends its selected language while the public screen can explicitly retain English', async () => {
 const originalFetch=globalThis.fetch,originalLocal=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
 const storage=browserStorage();storage.setItem('alibi:language','es');
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:storage});
 const bodies:{event:string;payload:Record<string,unknown>}[]=[];
 globalThis.fetch=async(_input,init)=>{bodies.push(JSON.parse(init!.body as string));return Response.json({ok:true,data:{code:'CASE'}});};
 try{
  for(const event of ['room:create','room:prepare','room:claim','room:join','room:subscribe','room:command'])await client.request(event,{code:'CASE'});
  for(const body of bodies)assert.equal(body.payload.language,'es');
  await client.request('room:subscribe',{code:'CASE',language:'en'});assert.equal(bodies.at(-1)!.payload.language,'en');
  await client.request('room:display-claim',{code:'CASE',displayId:'display-test'});assert.equal('language' in bodies.at(-1)!.payload,false);
  assert.equal(storage.getItem('alibi:master:CASE'),null,'a presentation preference must not create master authority');
 }finally{globalThis.fetch=originalFetch;if(originalLocal)Object.defineProperty(globalThis,'localStorage',originalLocal);else Reflect.deleteProperty(globalThis,'localStorage');}
});

test('network errors use the current phone language without changing retry or session semantics',async()=>{
 const originalFetch=globalThis.fetch,originalLocal=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
 const storage=browserStorage();storage.setItem('alibi:language','pt-BR');
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:storage});
 globalThis.fetch=async()=>{throw new TypeError('offline');};
 try{await assert.rejects(client.request('room:subscribe',{code:'CASE'}),cause=>cause instanceof client.RpcError&&cause.network&&!cause.terminal&&/Não foi possível conectar/.test(cause.message));}
 finally{globalThis.fetch=originalFetch;if(originalLocal)Object.defineProperty(globalThis,'localStorage',originalLocal);else Reflect.deleteProperty(globalThis,'localStorage');}
});
