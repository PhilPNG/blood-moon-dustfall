import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGameServer } from '../server/app.js';

test('production serves SPA deep links from the hidden build directory while unknown API paths stay 404', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'alibi-production-routes-'));
  const previousDirectory = process.cwd();
  const html = '<!doctype html><html><body><div id="root">Production route fixture</div></body></html>';
  mkdirSync(join(directory, '.web-dist', 'assets'), { recursive: true });
  writeFileSync(join(directory, '.web-dist', 'index.html'), html);
  writeFileSync(join(directory, '.web-dist', 'assets', 'app.js'), 'window.productionFixture = true;');
  process.chdir(directory);
  let server: Awaited<ReturnType<typeof createGameServer>> | undefined;
  try {
    server = await createGameServer({ production: true, vite: false });
    const port = await server.listen(0, '127.0.0.1');
    const origin = `http://127.0.0.1:${port}`;
    for (const path of ['/', '/host', '/join/CASE', '/play/CASE', '/master/CASE', '/recover/CASE', '/dev', '/dev/CASE', '/films']) {
      const response = await fetch(origin + path, { headers: { Accept: 'text/html' } });
      assert.equal(response.status, 200, `SPA route ${path} must load directly.`);
      assert.match(response.headers.get('content-type') ?? '', /text\/html/);
      assert.equal(await response.text(), html);
    }
    const asset = await fetch(origin + '/assets/app.js');
    assert.equal(asset.status, 200);
    assert.equal(await asset.text(), 'window.productionFixture = true;');
    for (const path of ['/api', '/api/missing', '/api/rpc']) {
      const response = await fetch(origin + path, { headers: { Accept: 'text/html' } });
      assert.equal(response.status, 404, `Unregistered API route ${path} must not serve the SPA.`);
      assert.notEqual(await response.text(), html);
    }
    const health = await fetch(origin + '/api/health');
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true, service: 'alibi' });
  } finally {
    await server?.close();
    process.chdir(previousDirectory);
    rmSync(directory, { recursive: true, force: true });
  }
});
