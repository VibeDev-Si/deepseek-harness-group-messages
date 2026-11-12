import {createRequire} from 'node:module';
import {mkdir,symlink,lstat,readlink,unlink,readFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const harness=resolve(process.argv[2]||resolve(root,'../deepseek-harness'));
const req=createRequire(resolve(harness,'package.json'));
const web=createRequire(resolve(harness,'apps/web/package.json'));
const ui=createRequire(resolve(harness,'packages/client/ui-conversation/package.json'));
await mkdir(resolve(root,'node_modules/@types'),{recursive:true});
await mkdir(resolve(root,'node_modules/@deepseek-ai'),{recursive:true});
const targets={tsx:req.resolve('tsx/package.json'),typescript:req.resolve('typescript/package.json'),zod:req.resolve('zod/package.json'),react:web.resolve('react/package.json'),'@types/react':req.resolve('@types/react/package.json'),'@types/node':req.resolve('@types/node/package.json')};
for(const name of ['mdast-util-from-markdown','mdast-util-gfm','micromark-extension-gfm'])targets[name]=resolve(dirname(req.resolve(name)),'package.json');
targets['react-dom']=web.resolve('react-dom/package.json');
const tsxReq=createRequire(targets.tsx);targets.esbuild=tsxReq.resolve('esbuild/package.json');
targets['@deepseek-ai/cordis']=resolve(harness,'vendor/cordis/package.json');
targets['@deepseek-ai/dsh-typert-protocol']=resolve(harness,'packages/typert/protocol/package.json');
for(const [name,path]of Object.entries(targets))await link(resolve(root,'node_modules',name),dirname(path));
await mkdir(resolve(root,'node_modules/.bin'),{recursive:true});
for(const [name,path]of [['tsc',resolve(dirname(targets.typescript),'bin/tsc')]])await link(resolve(root,'node_modules/.bin',name),path,'file');
console.log('Local development dependencies linked from',harness);
console.log('Cordis version:',JSON.parse(await readFile(targets['@deepseek-ai/cordis'],'utf8')).version);

/** A dangling link still passes lstat but fails access(), so only readlink can tell it needs repair. */
async function link(to,target,type='dir'){
 const stat=await lstat(to).catch(()=>null);
 if(stat){
  if(!stat.isSymbolicLink())return;
  if(await readlink(to)===target)return;
  await unlink(to);
 }
 await symlink(target,to,type);
}
