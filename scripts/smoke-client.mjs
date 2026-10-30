/** Exercise the shipped browser factory with the actual Cordis and Client Gateway. */
import {Context} from '@deepseek-ai/cordis';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const harness=resolve(process.env.DSH_ROOT||'../deepseek-harness');
const from=path=>import(pathToFileURL(resolve(harness,path)).href);
const registry=await from('packages/typert/registry/src/client/index.ts');
const gateway=await from('packages/api/gateway/src/client/index.ts');
const req=createRequire(resolve(harness,'apps/web/package.json'));
let plugin;const styles=new Set();const document={createElement(){const element={dataset:{},textContent:'',remove(){styles.delete(element);}};return element;},head:{append(element){styles.add(element);}}};
runInNewContext(await readFile('dist/client.js','utf8'),{window:{__ModuleLoader__:{load(info){plugin=info.factory(req);}}},crypto:webcrypto,AbortController,console,setTimeout,clearTimeout,structuredClone,document});
const ctx=new Context();
try{
 await ctx.plugin(registry);
 ctx.provide('connection',{interactions:'none',rpc:{open(){throw new Error('unused stream');},call(_channel,endpoint,_payload,signal){if(endpoint.endsWith('/snapshot'))return Promise.resolve({ok:true,value:{formatVersion:1,revision:0,groups:[],commands:[]}});return new Promise(resolve=>{signal?.addEventListener('abort',()=>resolve({ok:false,error:{code:'gateway/cancelled',message:'test ended',details:{}}}),{once:true});});}}});
 await ctx.plugin(gateway);
 ctx.provide('fileUpload',{});ctx.provide('sessions',{});ctx.provide('uiWorkspace',{});
 ctx.provide('workspaces',{});ctx.provide('layout',{});ctx.provide('sidebarRight',{});
 const tabTypes=[];ctx.provide('sidebarRightTabs',{register(definition){tabTypes.push(definition);return()=>{};}});
 ctx.provide('locale',{register(){return()=>{};},bind(){return key=>key;},subscribe(){return()=>{};}});
 const registrations=[];ctx.provide('slots',{inject(_name,callback){return callback();},register(options){registrations.push(options.name);return()=>{};}});
 const fiber=ctx.plugin(plugin);
 await fiber;
 if(registrations.includes('main')||registrations.includes('shell.overlay'))throw new Error('Group page must remain in the sidebar');
 if(!registrations.includes('sidebar.right.pane.tab')||tabTypes[0]?.kind!=='session-groups')throw new Error('Native sidebar tab was not registered');
 console.log('PASS: Client activation, native sidebar tab and sidebar-only registration',registrations);
 await fiber.dispose();if(styles.size)throw new Error('Plugin stylesheet leaked after unload');
}finally{await ctx.fiber.dispose();}
