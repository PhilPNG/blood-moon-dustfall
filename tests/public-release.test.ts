import test from 'node:test';
import assert from 'node:assert/strict';
import { access, copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const stage = await import(new URL('../scripts/stage-public.mjs', import.meta.url).href) as {
  isPublicSourcePath: (path: string) => boolean;
  stagePublicRelease: (options: { sourceRoot: string; destination: string }) => Promise<{ files: string[] }>;
};
async function exists(path: string) { try { await access(path); return true; } catch { return false; } }
async function put(root: string, name: string, text = 'fixture') {
  const path = join(root, name); await mkdir(dirname(path), { recursive: true }); await writeFile(path, text);
}

test('the public export admits playable source and selected artwork while excluding operational records', () => {
  for (const path of ['README.md', 'vercel.json', '.github/workflows/ci.yml', 'src/App.tsx', 'server/story.ts', 'online/worker.ts', 'drizzle/0001.sql', 'public/media/cinematics.json', 'public/media/narrator/lobby.mp3', 'public/assets/characters/ada-crowe.webp', 'docs/VERCEL.md', 'docs/design/mockups/01-lobby.png', 'docs/screenshots/dustfall-language-first.png', 'docs/screenshots/dustfall-attention-host.jpg', 'docs/screenshots/dustfall-attention-phone.jpg']) {
    assert.equal(stage.isPublicSourcePath(path), true, path);
  }
  for (const path of ['.openai/hosting.json', '.github/private-token', '.github/workflows/unreviewed.yml', '.env', '.env.production', 'src/.env', 'src/credentials.json', 'node_modules/lib/index.js', '.hosting-release/src/App.tsx', '.public-release/README.md', 'online/assets.generated.json', 'rooms.sqlite', 'docs/progress.md', 'docs/screenshots/elevenlabs-consent.png', 'docs/screenshots/unreviewed.png', 'docs/design/cinematics-production.json', 'docs/design/cinematics-verification.json', 'docs/design/narrator-transcripts/production.json', 'docs/design/portrait-prompts.md', 'docs/design/mockup-prompts.md', '/Users/example/private.txt', '../README.md', 'src/../.env']) {
    assert.equal(stage.isPublicSourcePath(path), false, path);
  }
});

test('staging replaces stale files, preserves Git history and never follows source symlinks', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'dustfall-public-export-'));
  try {
    const sourceRoot = join(temporary, 'source'), destination = join(temporary, 'release');
    await put(sourceRoot, 'README.md', 'public readme');
    await put(sourceRoot, 'src/App.tsx', 'export const app = true;');
    await put(sourceRoot, 'public/media/cinematics.json', '{"src":"https://cdn.example.test/user_public/movie.mp4"}');
    await put(sourceRoot, '.openai/hosting.json', 'DO_NOT_EXPORT');
    await put(sourceRoot, 'src/.env', 'DO_NOT_EXPORT');
    await put(sourceRoot, 'docs/design/cinematics-production.json', 'DO_NOT_EXPORT');
    await put(sourceRoot, 'docs/screenshots/elevenlabs-consent.png', 'DO_NOT_EXPORT');
    await put(sourceRoot, 'online/assets.generated.json', 'DO_NOT_EXPORT');
    await put(sourceRoot, 'docs/screenshots/dustfall-live-home.png', 'reviewed fixture');
    await put(temporary, 'private.txt', 'DO_NOT_EXPORT');
    await symlink(join(temporary, 'private.txt'), join(sourceRoot, 'src/leaked.ts'));
    await put(destination, '.git/HEAD', 'keep-history');
    await put(destination, 'stale-private-file.txt', 'remove');
    const result = await stage.stagePublicRelease({ sourceRoot, destination });
    assert.equal(await exists(join(destination, 'README.md')), true, 'Approved source must actually be copied');
    assert.equal(await readFile(join(destination, 'README.md'), 'utf8'), 'public readme');
    assert.equal(await readFile(join(destination, '.git/HEAD'), 'utf8'), 'keep-history');
    assert.equal(await exists(join(destination, 'stale-private-file.txt')), false);
    assert.equal(await exists(join(destination, 'src/leaked.ts')), false);
    assert.deepEqual(result.files.sort(), ['README.md', 'docs/screenshots/dustfall-live-home.png', 'public/media/cinematics.json', 'src/App.tsx']);
    assert.equal(await readFile(join(destination, 'public/media/cinematics.json'), 'utf8'), '{"src":"https://cdn.example.test/user_public/movie.mp4"}');
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test('an export destination symlink cannot erase an unrelated directory', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'dustfall-public-link-'));
  try {
    await put(temporary, 'source/README.md');
    await put(temporary, 'unrelated/keep.txt', 'keep');
    await symlink(join(temporary, 'unrelated'), join(temporary, 'release'));
    await assert.rejects(stage.stagePublicRelease({ sourceRoot: join(temporary, 'source'), destination: join(temporary, 'release') }), /symlink/i);
    assert.equal(await readFile(join(temporary, 'unrelated/keep.txt'), 'utf8'), 'keep');
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test('the real Worker build succeeds without private Sites metadata and retains it when supplied', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'dustfall-public-build-'));
  try {
    await put(temporary, '.web-dist/index.html', '<div id="root"></div>');
    await put(temporary, 'online/worker.ts', 'export default {fetch() {return new Response(\'<div id="root"></div>\')}};');
    await mkdir(join(temporary, 'scripts'));
    await copyFile(new URL('../scripts/build-online.mjs', import.meta.url), join(temporary, 'scripts/build-online.mjs'));
    await symlink(resolve('node_modules'), join(temporary, 'node_modules'));
    await execute(process.execPath, ['scripts/build-online.mjs'], { cwd: temporary });
    assert.equal(await exists(join(temporary, 'dist/server/index.js')), true);
    assert.equal(await exists(join(temporary, 'dist/.openai/hosting.json')), false);
    await put(temporary, '.openai/hosting.json', '{"fixture":"managed-binding"}');
    await execute(process.execPath, ['scripts/build-online.mjs'], { cwd: temporary });
    assert.equal(await readFile(join(temporary, 'dist/.openai/hosting.json'), 'utf8'), '{"fixture":"managed-binding"}');
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
