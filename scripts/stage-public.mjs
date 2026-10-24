import { copyFile, lstat, mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootFiles = new Set(['.gitignore', 'README.md', 'package.json', 'package-lock.json', 'index.html', 'tsconfig.json', 'vite.config.ts', 'vercel.json', 'LICENSE']);
const sourceDirectories = new Set(['src', 'shared', 'server', 'online', 'public', 'scripts', 'tests', 'drizzle']);
const documentation = new Set(['docs/VERCEL.md', 'docs/MEDIA.md', 'docs/TESTING.md', 'docs/PLAYER_RECOVERY.md', 'docs/PARTY_SCENARIOS.md']);
const workflow = new Set(['.github', '.github/workflows', '.github/workflows/ci.yml']);
// These real gameplay captures were reviewed for credentials and story spoilers.
const screenshots = new Set(['dustfall-live-home.png', 'dustfall-language-first.png', 'dustfall-stage.png', 'dustfall-live-voting.png', 'dustfall-attention-host.jpg', 'dustfall-attention-phone.jpg']);

/** An allowlist for a public repository, not the private Sites source export. */
export function isPublicSourcePath(path) {
  if (typeof path !== 'string' || !path || isAbsolute(path) || path.includes('\\')) return false;
  const parts = path.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) return false;
  if (rootFiles.has(path)) return true;
  if (workflow.has(path)) return true;
  if (parts.some(part => part.startsWith('.'))) return false;
  const name = parts.at(-1);
  if (['assets.generated.json', 'credentials.json', 'secrets.json', 'billing.json', 'elevenlabs-consent.png'].includes(name)) return false;
  if (/\.(sqlite(?:-shm|-wal)?|db|log|tar\.gz)$/i.test(name)) return false;
  if (sourceDirectories.has(parts[0])) return true;
  if (documentation.has(path)) return true;
  if (['docs', 'docs/story', 'docs/screenshots', 'docs/design', 'docs/design/mockups'].includes(path)) return true;
  if (/^docs\/story\/[^/]+\.md$/.test(path)) return true;
  if (/^docs\/design\/mockups\/[^/]+\.png$/.test(path)) return true;
  return parts.length === 3 && parts[0] === 'docs' && parts[1] === 'screenshots' && screenshots.has(name);
}

export async function stagePublicRelease({ sourceRoot, destination }) {
  const source = resolve(sourceRoot), target = resolve(destination);
  const sourceWithinTarget = relative(target, source);
  if (sourceWithinTarget === '' || (!sourceWithinTarget.startsWith('..') && !isAbsolute(sourceWithinTarget))) {
    throw new Error('The public staging destination must not contain the source checkout.');
  }
  try {
    if ((await lstat(target)).isSymbolicLink()) throw new Error('The public staging destination must not be a symlink.');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(target, { recursive: true });
  for (const entry of await readdir(target)) {
    if (entry !== '.git') await rm(join(target, entry), { recursive: true, force: true });
  }
  const files = [];
  async function visit(directory = '') {
    for (const entry of await readdir(join(source, directory), { withFileTypes: true })) {
      const path = directory ? `${directory}/${entry.name}` : entry.name;
      if (!isPublicSourcePath(path) || entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) {
        await mkdir(dirname(join(target, path)), { recursive: true });
        await copyFile(join(source, path), join(target, path));
        files.push(path);
      }
    }
  }
  await visit();
  return { files: files.sort() };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sourceRoot = process.cwd(), destination = join(sourceRoot, '.public-release');
  const result = await stagePublicRelease({ sourceRoot, destination });
  console.log(`Prepared ${result.files.length} public source files in .public-release (existing Git history preserved).`);
}
