/** Run current dist through historical Cordis/Typert/Gateway without touching that checkout.
 * Usage: node scripts/check-compat.mjs [--harness /path/to/deepseek-harness] [tag ...]
 * Only .acceptance/compat is written. Build the plugin first; no model or network calls occur.
 */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {builtinModules} from 'node:module';
import {dirname,extname,isAbsolute,join,posix,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {build} from 'esbuild';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);let harness=resolve(root,'../deepseek-harness');
const flag=args.indexOf('--harness');if(flag>=0){harness=resolve(args[flag+1]);args.splice(flag,2);}
const tags=args.length?args:['dsh-v0.1.7-rc.2','dsh-v0.2.0-rc.2','dsh-v0.2.1-rc.4','dsh-v0.2.2-alpha.2'];
const localRequire=createRequire(join(root,'package.json'));
const harnessRequire=createRequire(join(harness,'package.json'));
const builtins=new Set([...builtinModules,...builtinModules.map(name=>'node:'+name)]);
const cache=join(root,'.acceptance/compat');await mkdir(cache,{recursive:true});
const git=(...argv)=>execFileSync('git',['-C',harness,...argv],{maxBuffer:64*1024*1024});
const clientCode=await readFile(join(root,'dist/client.js'),'utf8');
const results=[];
for(const tag of tags){
 const started=Date.now();
 try{const runtime=await historicalRuntime(tag);const evidence=await smoke(runtime,tag);const row={tag,commit:git('rev-parse',tag).toString().trim(),ok:true,...evidence,milliseconds:Date.now()-started};results.push(row);console.log(JSON.stringify(row));}
 catch(error){results.push({tag,ok:false,error:error.stack||String(error)});console.error(tag,error);}
}
await writeFile(join(cache,'results.json'),JSON.stringify(results,null,2)+'\n');
if(results.some(row=>!row.ok))process.exitCode=1;

async function historicalRuntime(tag){
 const files=new Set(git('ls-tree','-r','--name-only',tag).toString().trim().split('\n'));
 const manifests=[...files].filter(path=>/^(?:packages\/[^/]+\/[^/]+|vendor\/[^/]+)\/package.json$/.test(path));
 const request=manifests.map(path=>tag+':'+path).join('\n')+'\n';
 const batch=execFileSync('git',['-C',harness,'cat-file','--batch'],{input:request,maxBuffer:64*1024*1024});
 const packages=new Map();let cursor=0;
 for(const path of manifests){const end=batch.indexOf(10,cursor);const header=batch.subarray(cursor,end).toString();const size=Number(header.split(' ').at(-1));cursor=end+1;const json=JSON.parse(batch.subarray(cursor,cursor+size).toString());cursor+=size+1;packages.set(json.name,{dir:posix.dirname(path),json});}
 const sources=new Map();
 const source=path=>{if(!sources.has(path))sources.set(path,git('show',tag+':'+path).toString());return sources.get(path);};
 const select=path=>[path,path.replace(/\.js$/,'.ts'),path.replace(/\.js$/,'.tsx'),path+'.ts',path+'.tsx',path+'/index.ts'].find(candidate=>files.has(candidate));
 function packageSource(spec){
  const segments=spec.split('/');const name=spec.startsWith('@')?segments.slice(0,2).join('/'):segments[0];const sub=segments.slice(spec.startsWith('@')?2:1).join('/');const pkg=packages.get(name);if(!pkg)return;
  const candidates=sub.startsWith('src/')?[sub]:sub?[sub==='client'?'src/client/index.ts':'src/'+sub+'.ts','src/'+sub+'/index.ts']:['src/index.ts'];
  const exported=pkg.json.exports?.[sub?'./'+sub:'.'];const target=typeof exported==='string'?exported:exported?.default;
  if(target)candidates.push(target.replace(/^\.\//,'').replace(/^lib\//,'src/'));
  for(const candidate of candidates){const found=select(posix.join(pkg.dir,candidate));if(found)return found;}
  throw new Error(tag+' has no source export '+spec);
 }
 const runtimePath=join(cache,tag+'.cjs');
 await build({stdin:{contents:
  "export {Context,Service} from '@deepseek-ai/cordis';\n"+
  "export {default as Registry} from '@deepseek-ai/dsh-typert-registry';\n"+
  "export {default as Gateway} from '@deepseek-ai/dsh-api-gateway';\n"+
  "export * as ClientGateway from '@deepseek-ai/dsh-api-gateway/client';\n"+
  (files.has('packages/client/connection/src/peer.ts')?"export {Peer} from '@deepseek-ai/dsh-client-connection/src/peer.ts';\n":"export {OperatorPeer as Peer} from '@deepseek-ai/dsh-client-connection/src/operator-peer.ts';\n")+
  "export {default as HostPlugin} from "+JSON.stringify(join(root,'dist/index.js'))+";\n",
  sourcefile:'compat-entry.ts',resolveDir:root,loader:'ts'},bundle:true,format:'cjs',platform:'node',target:'node24',outfile:runtimePath,logLevel:'silent',plugins:[{name:'historical-sources',setup(builder){
   builder.onResolve({filter:/.*/},info=>{
    if(builtins.has(info.path))return {path:info.path,external:true};
    if(info.path.startsWith('@deepseek-ai/')){const path=packageSource(info.path);if(path)return {path,namespace:'historical'};throw new Error('Unresolved historical dependency '+info.path);}
    if(info.namespace==='historical'&&info.path.startsWith('.')){const path=select(posix.normalize(posix.join(posix.dirname(info.importer),info.path)));if(!path)throw new Error('No historical file '+info.importer+' -> '+info.path);return {path,namespace:'historical'};}
    if(!info.path.startsWith('.')&&!isAbsolute(info.path)){
     const candidates=[localRequire,harnessRequire];if(info.namespace==='historical')candidates.unshift(createRequire(join(harness,dirname(info.importer),'package.json')));
     for(const require of candidates){try{return {path:require.resolve(info.path)};}catch{}}
    }
   });
   builder.onLoad({filter:/.*/,namespace:'historical'},info=>({contents:source(info.path),loader:extname(info.path)==='.tsx'?'tsx':'ts'}));
  }}]});
 return localRequire(runtimePath);
}
function observable(value){return {getSnapshot:()=>value,subscribe:()=>()=>{}};}
async function smoke(runtime,tag){
 const {Context,Registry,Gateway,ClientGateway,HostPlugin,Peer}=runtime;
 const host=new Context();const client=new Context();let pluginFiber;let peer;const wire=[];const slots=[];
 let persisted;
 try{
  await host.plugin(Registry);
  host.provide('remoteAccess',{decide:()=>({kind:'allow'})});
  await host.plugin(Gateway,{});
  const rows=[{id:'compat-session',sessionId:'compat-session',cwd:root,displayTitle:'Compatibility session',origin:'user',running:false}];
  const backend={kv:{open:async()=>({loadAll:async()=>({global:persisted}),setGlobal:async value=>{persisted=structuredClone(value);},close:async()=>{}})}};
  const ports={sessionController:{list:async()=>({items:rows}),modelCatalog:async()=>({groups:[],default:{provider:'compat',model:'none'},failures:[]}),prompt:async()=>{throw new Error('Smoke must not submit model prompts');}},agents:{get:()=>undefined},sessionQuery:{readSession:async()=>({events:[]})},storage:{backend:{get:()=>backend}},'storage.backend.json':backend,llm:{async *stream(){throw new Error('Smoke must not call models');}},agentDefaultModel:{currentSelection:()=>({provider:'compat',model:'none'})}};
  for(const [name,value]of Object.entries(ports))host.provide(name,value);
  peer=new Peer(host,{principal:{kind:'owner'},interactions:'none'});
  const principalAware='principal' in peer;
  if(!principalAware){host.provide('connection',{operator:peer,rpc:{intercept:()=>()=>{}}});assert.equal(host.get('connection').operator,peer);}
  const hostFiber=host.plugin(HostPlugin);await hostFiber;
  assert.ok(host.get('sessionGroups'),'Host plugin did not activate');
  for(const name of ['attachments','fileUploads','commands'])assert.equal(host.get(name),undefined,'Optional Host service unexpectedly supplied: '+name);
  await client.plugin(Registry);
  const connection={interactions:'none',isLoopback:true,generation:observable(undefined),state:observable(undefined),openWebSocket:()=>{throw new Error('No network transport in smoke');},start:()=>({stop(){}}),registerGenerationSource:()=>()=>{},rpc:{open:async function*(){},call:async(path,endpoint,payload,signal)=>{
   assert.equal(path,'/api');wire.push({endpoint,keys:Object.keys(payload.args)});const [namespace,method]=endpoint.split('/');
   try{return {ok:true,value:await host.get('typertGateway').invoke({namespace,method,args:payload.args,peer,signal})};}
   catch(error){return {ok:false,error:{code:error.code||'internal',message:error.message,details:error.details||{}}};}
  }}};
  client.provide('connection',connection);await client.plugin(ClientGateway);
  const uiPorts={sessions:{list:observable({ids:rows.map(row=>row.id),byId:Object.fromEntries(rows.map(row=>[row.id,row]))}),refresh:async()=>{},create:async()=>{throw new Error('No session creation in smoke');}},workspaces:{list:observable({items:[],archivedSessionIds:[],state:'idle',phase:'ready'})},uiWorkspace:{openSession(){},startSession(){}},layout:{panelInfo:observable({activePanelId:null})},sidebarRight:{mounted:observable('compat-session'),openTab(){}},sidebarRightTabs:{register:definition=>{assert.equal(definition.kind,'session-groups');return()=>{};}},locale:{register:()=>()=>{},bind:()=>key=>key,subscribe:()=>()=>{}},slots:{inject:(name,fn)=>{fn();return()=>{};},register:(options,component)=>{slots.push({options,component});return()=>{};}},fileUpload:{upload:async()=>{throw new Error('No uploads in smoke');}}};
  for(const [name,value]of Object.entries(uiPorts))client.provide(name,value);
  let browserPlugin;const sandbox={window:{__ModuleLoader__:{load:row=>{browserPlugin=row.factory(name=>{if(name==='react')return {createElement:()=>null};throw new Error('Unexpected browser external '+name);});}}},document:{createElement:()=>({dataset:{},remove(){}}),head:{append(){}}},crypto:globalThis.crypto,AbortController,AbortSignal,setTimeout,clearTimeout,console,Blob,URL,Uint8Array,TextDecoder,TextEncoder};
  vm.runInNewContext(clientCode,sandbox,{filename:'dist/client.js'});assert.ok(browserPlugin?.apply,'Browser bundle did not register');
  pluginFiber=client.plugin(browserPlugin);await pluginFiber;
  const remote=client.get('remote').sessionGroups;assert.ok(remote,'Browser plugin did not mount namespace');
  const before=await remote.snapshot({});assert.equal(before.ok,true,JSON.stringify(before));assert.equal(before.value.capabilityVersion,2);
  const created=await remote.execute({action:'createGroup',commandId:'compat-create',name:'Compatibility '+tag,goal:'',members:[{id:'compat-member',sessionId:'compat-session',alias:'Member',cwd:root}]});assert.equal(created.ok,true,JSON.stringify(created));assert.equal(created.value.groups.length,1);assert.ok(persisted?.groups.length===1);
  const options=await remote.options({});assert.equal(options.ok,true,JSON.stringify(options));assert.ok(Array.isArray(options.value.commands));
  const invalid=await remote.execute({action:'unknown',commandId:'compat-invalid'});assert.equal(invalid.ok,false,'Unknown command unexpectedly accepted');
  const extra=await remote.snapshot({unexpected:true});assert.equal(extra.ok,false,'Strict input accepted an undeclared field');assert.equal(extra.error.code,'gateway/input-invalid');
  const owner=peer;
  const foreign=principalAware?new Peer(host,{principal:{kind:'compat-non-owner'},interactions:'none'}):{id:'compat-non-owner',ctx:owner.ctx,principal:{kind:'compat-non-owner'},dispose:async()=>{}};
  peer=foreign;try{const denied=await remote.snapshot({});assert.equal(denied.ok,false,'Non-owner unexpectedly admitted');assert.equal(denied.error.code,'gateway/bad-request');}finally{await foreign.dispose();peer=owner;}
  peer={id:owner.id,ctx:owner.ctx,signal:new AbortController().signal,dispose:async()=>{}};
  try{const denied=await remote.snapshot({});assert.equal(denied.ok,false,'Unidentified peer unexpectedly admitted');if(!principalAware)assert.equal(denied.error.code,'gateway/bad-request');}finally{peer=owner;}
  if(!principalAware){
   Object.defineProperty(owner,'principal',{value:undefined,configurable:true});
   try{const denied=await remote.snapshot({});assert.equal(denied.ok,false,'Malformed operator identity unexpectedly admitted');assert.equal(denied.error.code,'gateway/bad-request');}finally{delete owner.principal;}
  }
  const abort=new AbortController();const waiting=remote.watch({revision:created.value.revision},abort.signal);abort.abort();const cancelled=await waiting;assert.equal(cancelled.ok,false,'Aborted watch unexpectedly succeeded');
  assert.ok(slots.some(slot=>slot.options.name==='sidebar.footer.action'),'No sidebar entry');
  assert.ok(wire.every(call=>call.keys.length===1&&call.keys[0]==='request'),'Unexpected named wire fields');
  return {checks:['host-load','optional-host-services-absent','browser-bundle-load','real-client-mount','snapshot','createGroup-persistence','options','invalid-command','strict-wire-input',principalAware?'modern-owner-peer':'legacy-operator-without-principal','non-owner-rejection','same-id-peer-rejection',...(principalAware?[]:['malformed-operator-rejection']),'watch-abort','slot-registration','request-wire-key'],wireCalls:wire.length};
 }finally{
  if(pluginFiber)await pluginFiber.dispose();
  await client.fiber.dispose();if(peer)await peer.dispose();await host.fiber.dispose();
 }
}
