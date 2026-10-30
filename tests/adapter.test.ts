import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Context} from '@deepseek-ai/cordis';
import {HarnessAdapter,type HostPorts,type LogEvent,type AgentPort} from '../src/host/adapter.ts';
import type {ExecutionInput} from '../src/core/model.ts';
let seq=0;
const event=(type:string,data:Record<string,unknown>):LogEvent=>({type,data,seq:++seq});
const wait=async(fn:()=>boolean)=>{const end=Date.now()+1000;while(!fn()){if(Date.now()>end)throw new Error('timeout');await new Promise(r=>setTimeout(r,1));}};
function fixture(options:{input?:Partial<ExecutionInput>;setup?:(ports:HostPorts,agent:AgentPort,emit:(type:string,data:Record<string,unknown>)=>void)=>void}={}){
 const listeners=new Set<(session:{id:string},event:LogEvent)=>void>();let prompted=false;let cancels=0;const prompts:Parameters<HostPorts['sessionController']['prompt']>[0][]=[];
 const agent={status:'idle' as 'idle'|'running',session:{id:'s',header:{cwd:'/s'}},inbox:{nextTurn:[] as {id:string;source:{kind:string;rpcId:string}}[],nextStep:[],remove(id:string){const index=this.nextTurn.findIndex(m=>m.id===id);if(index<0)return false;this.nextTurn.splice(index,1);return true;}},cancel(){cancels++;},model:{current:()=>({provider:'p',model:'m'})}};
 const ctx={on(_name:string,listener:(session:{id:string},event:LogEvent)=>void){listeners.add(listener);return()=>listeners.delete(listener);}} as unknown as Context;
 const ports:HostPorts={agents:{get:()=>agent},sessionQuery:{async readSession(){return {events:[]};}},sessionController:{async list(){return {items:[]};},async prompt(request){prompts.push(request);prompted=true;}},agentDefaultModel:{currentSelection:()=>({provider:'p',model:'m'})},llm:{async *stream(){}}};
 const emit=(type:string,data:Record<string,unknown>,sid='s')=>{for(const fn of listeners)fn({id:sid},event(type,data));};
 options.setup?.(ports,agent,emit);
 const adapter=new HarnessAdapter(ctx,ports);const abort=new AbortController();const result=adapter.execute({sessionId:'s',requestId:'ours',prompt:'task',...options.input},abort.signal,()=>{});
 return {adapter,abort,result,agent,emit,listeners,ports,prompts,isPrompted:()=>prompted,cancels:()=>cancels};
}
test('results follow the request turn and retain exact event sources',async()=>{const f=fixture();await wait(f.isPrompted);f.emit('turn/start',{turn:1});f.emit('user/message',{source:{kind:'user',rpcId:'ours'},content:[]});f.emit('assistant/message',{turn:9,message:{content:[{type:'text',text:'unrelated'}]}});f.emit('assistant/message',{turn:1,message:{content:[{type:'text',text:'actual'}]}});f.emit('turn/end',{turn:1,reason:{kind:'completed'}});const result=await f.result;assert.equal(result.output,'actual');assert.equal(result.status,'completed');assert.deepEqual(result.turns,[1]);assert.equal(result.eventSeqs.length,3);assert.equal(f.listeners.size,0);});
test('cancelling a queued request removes only its own inbox occurrence',async()=>{const f=fixture();await wait(f.isPrompted);f.agent.inbox.nextTurn.push({id:'foreign',source:{kind:'user',rpcId:'foreign'}},{id:'ours-id',source:{kind:'user',rpcId:'ours'}});f.abort.abort();assert.equal((await f.result).status,'cancelled');assert.deepEqual(f.agent.inbox.nextTurn.map(x=>x.id),['foreign']);assert.equal(f.cancels(),0);});
test('pause waits for turn-end acknowledgement instead of just cancel acceptance',async()=>{const f=fixture();await wait(f.isPrompted);f.emit('turn/start',{turn:2});f.emit('user/message',{source:{kind:'user',rpcId:'ours'}});f.abort.abort();assert.equal(f.cancels(),1);let settled=false;void f.result.then(()=>{settled=true;});await Promise.resolve();assert.equal(settled,false);f.emit('assistant/message',{turn:2,message:{content:[{type:'text',text:'partial'}]}});f.emit('turn/end',{turn:2,reason:{kind:'aborted'}});const result=await f.result;assert.equal(result.status,'cancelled');assert.equal(result.output,'partial');});
test('mixed-input turns are not cancelled on behalf of one group task',async()=>{const f=fixture();await wait(f.isPrompted);f.emit('turn/start',{turn:3});f.emit('user/message',{source:{kind:'user',rpcId:'ours'}});f.emit('user/message',{source:{kind:'user',rpcId:'other'}});f.abort.abort();const result=await f.result;assert.equal(result.status,'uncertain');assert.match(result.error||'',/其他来源/);assert.equal(f.cancels(),0);});
test('a completed turn wins a racing stop and unload never cancels the source agent',async()=>{const f=fixture();await wait(f.isPrompted);f.emit('turn/start',{turn:4});f.emit('user/message',{source:{kind:'user',rpcId:'ours'}});f.emit('turn/end',{turn:4,reason:{kind:'completed'}});f.abort.abort();assert.equal((await f.result).status,'completed');assert.equal(f.cancels(),0);const other=fixture();await wait(other.isPrompted);other.adapter.close();assert.equal((await other.result).status,'uncertain');assert.equal(other.cancels(),0);});
test('native commands execute through the command registry and never become model prompts',async()=>{const line='/plan off  ';const f=fixture({input:{kind:'command',prompt:line},setup(ports,_agent,emit){ports.commands={list:()=>[],async execute(_agent,received){assert.equal(received,line);emit('command/run',{commandId:'command-one'});emit('command/done',{commandId:'command-one'});return {commandId:'command-one',result:{kind:'success',text:'native result'}};}};}});const result=await f.result;assert.equal(result.status,'completed');assert.equal(result.output,'native result');assert.equal(result.eventSeqs.length,2);assert.equal(f.prompts.length,0);});
test('member model and permissions apply to the session without rewriting text or saving a global default',async()=>{let globalSaves=0;const models:unknown[]=[];const permissions:string[]=[];const raw='  text stays exact\n ';const f=fixture({input:{prompt:raw,settings:{provider:'p',model:'reasoner',reasoningEffort:'high',permissionPreset:'read-only'}},setup(ports,agent){agent.model!.select=value=>models.push(value);ports.sessionController.modelCatalog=async()=>({default:{provider:'p',model:'m'},groups:[{id:'p',name:'Provider',models:[{id:'reasoner',name:'Reasoner',reasoning:{efforts:[{id:'high',name:'High'}]}}]}],failures:[]});ports.llm.resolveCallConfig=async()=>({});ports.permissionPresets={catalog:()=>({options:[{value:'read-only',name:'Read only'}]}),current:()=>'',set:(_session,preset)=>{permissions.push(preset);}};Object.assign(ports.agentDefaultModel,{saveSelection(){globalSaves++;}});}});await wait(f.isPrompted);assert.deepEqual(models,[{provider:'p',model:'reasoner',reasoningEffort:'high'}]);assert.deepEqual(permissions,['read-only']);assert.equal(globalSaves,0);assert.deepEqual(f.prompts[0].content,[{type:'text',text:raw}]);f.emit('turn/start',{turn:1});f.emit('user/message',{source:{kind:'user',rpcId:'ours'}});f.emit('turn/end',{turn:1,reason:{kind:'completed'}});await f.result;});
test('an interrupted native command does not claim its effects have stopped',async()=>{let started=false;const f=fixture({input:{kind:'command',prompt:'/long'},setup(ports){ports.commands={list:()=>[],async execute(_agent,_line,_parts,signal){started=true;await new Promise<void>(resolve=>signal.addEventListener('abort',()=>resolve(),{once:true}));return {commandId:'long',result:{kind:'error',text:'interrupted'}};}};}});await wait(()=>started);f.abort.abort();const result=await f.result;assert.equal(result.status,'uncertain');assert.match(result.error||'',/核对/);assert.equal(f.cancels(),0);});

test('an unavailable model catalog still exposes native commands and permissions',async()=>{
 const f=fixture({setup(ports){
  ports.sessionController.modelCatalog=async()=>{throw new Error('catalog offline');};
  ports.commands={list:()=>[{name:'help',description:'Help'}],async execute(){return undefined;}};
  ports.permissionPresets={catalog:()=>({options:[{value:'workspace-write',name:'Workspace'}]}),current:()=> 'workspace-write',set(){}};
 }});
 const options=await f.adapter.options('s');
 assert.equal(options.commands[0].name,'help');
 assert.equal(options.permissions[0].value,'workspace-write');
 assert.equal(options.models.length,0);
 assert.match(options.failures![0].message,/offline/);
 f.adapter.close();await f.result;
});
test('legacy agents expose options and execute ordinary prompts without a model port',async()=>{
 let legacySelects=0;const f=fixture({setup(ports,agent){delete agent.model;ports.sessionController.projections=async()=>({values:{modelSelection:{next:{provider:'legacy',model:'existing'}}}});ports.sessionController.modelCatalog=async()=>({default:{provider:'default',model:'m'},groups:[{id:'legacy',name:'Legacy',models:[{id:'existing',name:'Existing'}]}],failures:[]});Object.assign(ports.sessionController,{async selectModel(){legacySelects++;}});}});
 const options=await f.adapter.options('s');assert.deepEqual(options.currentModel,{provider:'legacy',model:'existing'});assert.deepEqual(options.models,[]);assert.match(options.failures!.find(failure=>failure.id==='modelSelection')!.message,/原会话/);
 await wait(f.isPrompted);f.emit('turn/start',{turn:1});f.emit('user/message',{source:{kind:'user',rpcId:'ours'}});f.emit('turn/end',{turn:1,reason:{kind:'completed'}});assert.equal((await f.result).status,'completed');assert.equal(legacySelects,0);
});
test('legacy member model overrides fail before dispatch without changing global defaults',async()=>{
 let globalSaves=0;const f=fixture({input:{settings:{provider:'p',model:'m'}},setup(ports,agent){delete agent.model;Object.assign(ports.sessionController,{async selectModel(){globalSaves++;}});Object.assign(ports.agentDefaultModel,{saveSelection(){globalSaves++;}});}});
 const result=await f.result;assert.equal(result.status,'failed');assert.match(result.error||'',/独立模型/);assert.equal(globalSaves,0);assert.equal(f.prompts.length,0);
});
test('legacy projection failures leave commands and inherited-model prompts available',async()=>{
 const f=fixture({setup(ports,agent){delete agent.model;ports.sessionController.projections=async()=>{throw new Error('projection offline');};ports.commands={list:()=>[{name:'help',description:'Help'}],async execute(){return undefined;}};}});
 const options=await f.adapter.options('s');assert.equal(options.commands[0].name,'help');assert.match(options.failures!.find(failure=>failure.id==='currentModel')!.message,/offline/);await wait(f.isPrompted);f.adapter.close();await f.result;
});
test('legacy images keep their native content type and exact prompt text',async()=>{
 const f=fixture({input:{prompt:'  看图\n',assets:[{id:'image',kind:'image',name:'image.png',bytes:3,mediaType:'image/png',sourceSessionId:'s',ref:{attachmentId:'digest',name:'image.png',bytes:3}}]},setup(ports){ports.attachments={async *readFileStream(){yield Buffer.from('raw');}};ports.fileUploads={async uploadStream(){throw new Error('images must not become files');}};}});
 await wait(f.isPrompted);assert.deepEqual(f.prompts[0].content,[{type:'text',text:'  看图\n'},{type:'image',data:'cmF3',mediaType:'image/png',name:'image.png'}]);f.adapter.close();await f.result;
});
test('image attachments are rejected before native commands or uploads begin',async()=>{
 const f=fixture({input:{kind:'command',prompt:'/help',assets:[{id:'image',kind:'image',name:'image.png',bytes:3,mediaType:'image/png',sourceSessionId:'s',ref:{attachmentId:'digest',name:'image.png',bytes:3}}]},setup(ports){ports.commands={list:()=>[],async execute(){throw new Error('must not execute');}};}});
 const result=await f.result;assert.equal(result.status,'failed');assert.match(result.error||'',/不支持图片/);assert.equal(f.prompts.length,0);
});
test('closing during attachment preparation never submits a native prompt',async()=>{
 let release!:()=>void;let staging=false;
 const f=fixture({input:{assets:[{id:'asset',kind:'file',name:'note.txt',bytes:3,mediaType:'text/plain',sourceSessionId:'s',ref:{attachmentId:'digest',name:'note.txt',bytes:3}}]},setup(ports){
  ports.attachments={async *readFileStream(){yield Buffer.from('raw');}};
  ports.fileUploads={async uploadStream(){staging=true;await new Promise<void>(resolve=>{release=resolve;});return {receiptId:'receipt'};},async uploadImageStream(){throw new Error('unused');}};
 }});
 await wait(()=>staging);f.adapter.close();release();
 assert.equal((await f.result).status,'uncertain');
 assert.equal(f.prompts.length,0);
});
