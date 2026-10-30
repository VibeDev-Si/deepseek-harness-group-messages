/** Verify real Harness scoped-tool registration, validation, caller identity and disposal. */
import {Context} from '@deepseek-ai/cordis';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {bindPeerTools} from '../src/host/collaboration.ts';
const harness=resolve(process.env.DSH_ROOT||'../deepseek-harness');
const load=path=>import(pathToFileURL(resolve(harness,path)).href);
const {default:Tools}=await load('packages/core/tools/lib/index.js');
const {createScope}=await load('packages/core/scope/lib/index.js');
const owner=new Context();
try{
 owner.provide('systemPrompt',{tools(){return()=>{};}});await owner.plugin(Tools);
 const agent={id:'source-session'};const scope=createScope(owner,agent);const deliveries=[];
 const dispose=bindPeerTools(owner,scope.ctx,{sessionId:agent.id,requestId:'request',prompt:'raw',peer:{groupId:'g',roundId:'r',taskId:'task',memberId:'a',alias:'A',members:[{id:'a',alias:'A',sessionId:agent.id},{id:'b',alias:'B',sessionId:'target-session'}]}},{async send(value){deliveries.push(value);return {messageId:'sent',queued:1,remaining:7};},read(){return {members:['A','B']};}});
 const registry=owner.get('tools');
 assert.equal(registry.get('group_send'),undefined,'Group tools must not leak into the global tool list');
 const send=registry.get('group_send',agent);assert.ok(send,'Member tool must be scoped to its source Agent');
 const exec={agent,callId:'call-one',signal:new AbortController().signal};
 const result=await send.execute({to:['B'],message:'  exact text\n '},exec);assert.equal(result.queued,1);assert.equal(deliveries[0].text,'  exact text\n ');
 await assert.rejects(send.execute({to:['B'],message:'wrong'},{...exec,agent:{id:'other'}}));
 dispose();assert.equal(registry.get('group_send',agent),undefined);await assert.rejects(send.execute({to:['B'],message:'stale'},exec));
 await scope.dispose();
 console.log('PASS: native tool schemas, Agent scoping, exact peer text, caller guard and cleanup.');
}finally{await owner.fiber.dispose();}
