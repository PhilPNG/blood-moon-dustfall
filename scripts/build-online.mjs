import { readdir,readFile,writeFile,mkdir,rm,copyFile } from 'node:fs/promises';
import { join,extname,relative } from 'node:path';
import { build } from 'esbuild';

const assets={};
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.ico':'image/x-icon','.woff2':'font/woff2','.json':'application/json','.vtt':'text/vtt; charset=utf-8','.mp3':'audio/mpeg','.m4a':'audio/mp4','.wav':'audio/wav'};
async function collect(dir){
  for(const file of await readdir(dir,{withFileTypes:true})){
    const path=join(dir,file.name);
    if(file.isDirectory())await collect(path);
    else assets['/'+relative('.web-dist',path).split('\\').join('/')]={body:(await readFile(path)).toString('base64'),type:mime[extname(path)]||'application/octet-stream'};
  }
}
await collect('.web-dist');
await writeFile('online/assets.generated.json',JSON.stringify(assets));
await rm('dist',{recursive:true,force:true});
await mkdir('dist/server',{recursive:true});
await mkdir('dist/.openai',{recursive:true});
await build({entryPoints:['online/worker.ts'],outfile:'dist/server/index.js',bundle:true,platform:'browser',format:'esm',target:'es2022',minify:true,legalComments:'none'});
// Public/Vercel clones have no private Sites binding metadata. Sites releases
// still carry their existing manifest into the Worker package when available.
try { await copyFile('.openai/hosting.json','dist/.openai/hosting.json'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const worker=await import('../dist/server/index.js?build='+Date.now());
if(typeof worker.default?.fetch!=='function')throw new Error('Worker must export default.fetch');
const response=await worker.default.fetch(new Request('https://alibi.example/'),{});
if(response.status!==200||!(await response.text()).includes('<div id="root">'))throw new Error('Embedded app shell did not render.');
console.log('Built single-file Worker with '+Object.keys(assets).length+' embedded assets.');
