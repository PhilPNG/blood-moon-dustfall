import { cp,rm,mkdir,readdir } from 'node:fs/promises';
import { resolve,join,basename } from 'node:path';

const root=process.cwd();
const destination=resolve(root,'.hosting-release');
await mkdir(destination,{recursive:true});
// This directory is a generated release checkout; preserve its managed Git history.
for(const entry of await readdir(destination)){
  if(!['.git','node_modules','.sites-source-state.json'].includes(entry))await rm(join(destination,entry),{recursive:true,force:true});
}
const files=['.gitignore','.openai','README.md','package.json','package-lock.json','index.html','tsconfig.json','vite.config.ts','vercel.json','src','shared','server','online','public','scripts','tests','drizzle','docs'];
for(const name of files){
  await cp(join(root,name),join(destination,name),{recursive:true,filter:path=>!path.endsWith('.tar.gz')&&!['assets.generated.json','narrator-source','elevenlabs-consent.png'].includes(basename(path))});
}
console.log('Prepared release source at '+destination);
