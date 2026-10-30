/** Verify the external package against the actual local Cordis and Typert Gateway. */
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {Context} from '@deepseek-ai/cordis';
const harness=resolve(process.env.DSH_ROOT||'../deepseek-harness');
const from=async path=>import(pathToFileURL(resolve(harness,path)).href);
const {default:Registry}=await from('packages/typert/registry/lib/index.js');
const {default:Access}=await from('packages/api/remote-access/lib/index.js');
const {default:Gateway}=await from('packages/api/gateway/lib/index.js');
const {Peer}=await from('packages/client/connection/lib/index.js');
const {default:Groups}=await import('../dist/index.js');
const ctx=new Context();let stored=null;
try {
 await ctx.plugin(Registry);await ctx.plugin(Access);await ctx.plugin(Gateway);
 ctx.provide('storage',{backend:{get(){return {kv:{async open(){return {async loadAll(){return {global:stored};},async setGlobal(value){stored=structuredClone(value);},async close(){}};}}};}}});
 ctx.provide('storage.backend.json',{});
 ctx.provide('sessionController',{async list(){return {items:[{sessionId:'session-test',title:'Session',cwd:'/private/tmp'}]};}});
 ctx.provide('agents',{get(){return undefined;}});
 ctx.provide('sessionQuery',{async readSession(){return {events:[]};}});
 ctx.provide('attachments',{});ctx.provide('fileUploads',{});ctx.provide('commands',{});
 ctx.provide('llm',{});ctx.provide('agentDefaultModel',{});
 const fiber=ctx.plugin(Groups,{backend:'json',maxConcurrent:3});await fiber;
 assert.ok(ctx.get('sessionGroups'),'Service activated');
 const peer=new Peer(ctx,{principal:{kind:'owner'}});
 const call=(method,request)=>ctx.get('typertGateway').invoke({namespace:'sessionGroups',method,args:{request},peer});
 const before=await call('snapshot',{});assert.equal(before.groups.length,0);
 const created=await call('execute',{action:'createGroup',commandId:'smoke-create',name:'Integration check',goal:'No model requests',members:[{id:'member-test',sessionId:'session-test',alias:'Session',cwd:''}]});
 assert.equal(created.groups.length,1);assert.equal(created.groups[0].members[0].cwd,'/private/tmp');
 const changed=await call('watch',{revision:0});assert.equal(changed.groups.length,1);
 await assert.rejects(call('execute',{action:'send',commandId:'bad',groupId:created.groups[0].id,body:'test',memberIds:['missing']}));
 await assert.rejects(call('execute',{action:'createGroup',commandId:'extra',name:'Bad',members:[],extra:true}));
 await fiber.dispose();
 await assert.rejects(call('snapshot',{}));
 console.log('PASS: real Cordis activation, strict Gateway invocation, member resolution, watch, validation and unload.');
} finally {await ctx.fiber.dispose();}
