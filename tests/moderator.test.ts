import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GroupEngine} from '../src/core/engine.ts';
import {type Snapshot,type ExecutionResult,type SessionAdapter,type ExecutionInput,type Persistence,type ModeratorInput,type ModeratorPlanResult,snapshotSchema,currentRound} from '../src/core/model.ts';
let serial=0;const commandId=()=>`command-${++serial}`;
const wait=async(fn:()=>boolean)=>{const deadline=Date.now()+2000;while(!fn()){if(Date.now()>deadline)throw new Error('condition timed out');await new Promise(r=>setTimeout(r,2));}};
class Memory implements Persistence{value:Snapshot|null=null;async load(){return structuredClone(this.value);}async save(value:Snapshot){this.value=structuredClone(value);}}
class Adapter implements SessionAdapter{
 busy=new Set<string>();calls:{input:ExecutionInput;finish:(result?:Partial<ExecutionResult>)=>void;signal:AbortSignal}[]=[];
 planCalls:ModeratorInput[]=[];planResult:ModeratorPlanResult={steps:[]};planImpl?:(input:ModeratorInput)=>Promise<ModeratorPlanResult>;
 available(id:string){return !this.busy.has(id);}
 execute(input:ExecutionInput,signal:AbortSignal,onProgress:(text:string)=>void){return new Promise<ExecutionResult>(resolve=>{const finish=(result:Partial<ExecutionResult>={})=>resolve({status:'completed',output:'verified result '+input.sessionId,turns:[1],eventSeqs:[1,2,3],...result});this.calls.push({input,finish,signal});onProgress('partial');signal.addEventListener('abort',()=>finish({status:'cancelled',output:'partial'}),{once:true});if(signal.aborted)finish({status:'cancelled'});});}
 async plan(input:ModeratorInput){this.planCalls.push(input);if(this.planImpl)return this.planImpl(input);return this.planResult;}
}
async function setup(){const persistence=new Memory();const adapter=new Adapter();const engine=new GroupEngine(persistence,adapter);await engine.initialize();await engine.execute({action:'createGroup',commandId:commandId(),name:'Moderator',goal:'达成目标',members:[{id:'one',sessionId:'session-one',alias:'前端',cwd:'/project/a'},{id:'two',sessionId:'session-two',alias:'后端',cwd:'/project/b'}]});return {engine,adapter,persistence,groupId:engine.snapshot().groups[0].id};}
const enable=(engine:GroupEngine,groupId:string,mode:'suggest'|'auto',maxSteps=6)=>engine.execute({action:'configureModerator',commandId:commandId(),groupId,options:{enabled:true,mode,maxSteps},autoAcknowledged:mode==='auto'});
const plan=(engine:GroupEngine,groupId:string)=>engine.execute({action:'planRound',commandId:commandId(),groupId});
const roundOf=(engine:GroupEngine,groupId:string)=>currentRound(engine.snapshot().groups.find(g=>g.id===groupId)!);

test('suggest mode proposes assignments and dispatches nothing until approved',async()=>{
 const {engine,adapter,groupId}=await setup();
 try{
  await enable(engine,groupId,'suggest');
  adapter.planResult={steps:[{to:'前端',instruction:'做A'},{to:'后端',instruction:'做B'}],rationale:'分工'};
  await plan(engine,groupId);
  await wait(()=>roundOf(engine,groupId).moderator?.status==='awaiting_approval');
  assert.equal(adapter.calls.length,0);
  const steps=roundOf(engine,groupId).moderator!.plan!.steps;
  assert.equal(steps.length,2);assert.equal(steps[0].to,'one');assert.ok(steps.every(s=>s.status==='proposed'));
  await engine.execute({action:'approvePlan',commandId:commandId(),groupId,planId:roundOf(engine,groupId).moderator!.plan!.id,stepIds:[steps[0].id]});
  await wait(()=>adapter.calls.length===1);
  assert.equal(adapter.calls[0].input.prompt,'做A');
  const message=roundOf(engine,groupId).messages.at(-1)!;
  assert.ok(message.moderatorOf);assert.equal(message.author,'主持人');
  const after=roundOf(engine,groupId).moderator!.plan!.steps;
  assert.equal(after[0].status,'dispatched');assert.equal(after[1].status,'rejected');
 }finally{await engine.close();}
});

test('rejecting a plan dispatches nothing and keeps the round usable',async()=>{
 const {engine,adapter,groupId}=await setup();
 try{
  await enable(engine,groupId,'suggest');
  adapter.planResult={steps:[{to:'前端',instruction:'做A'}]};
  await plan(engine,groupId);
  await wait(()=>roundOf(engine,groupId).moderator?.status==='awaiting_approval');
  await engine.execute({action:'rejectPlan',commandId:commandId(),groupId,planId:roundOf(engine,groupId).moderator!.plan!.id});
  assert.equal(adapter.calls.length,0);
  assert.equal(roundOf(engine,groupId).moderator!.status,'idle');
  assert.ok(roundOf(engine,groupId).moderator!.plan!.steps.every(s=>s.status==='rejected'));
 }finally{await engine.close();}
});

test('enabling auto mode requires explicit risk acknowledgement',async()=>{
 const {engine,groupId}=await setup();
 try{
  await assert.rejects(engine.execute({action:'configureModerator',commandId:commandId(),groupId,options:{enabled:true,mode:'auto',maxSteps:6}}),/确认/);
  await enable(engine,groupId,'auto');
  assert.equal(engine.snapshot().groups[0].moderator!.mode,'auto');
 }finally{await engine.close();}
});

test('auto mode stops at the step budget and never re-plans beyond it',async()=>{
 const {engine,adapter,groupId}=await setup();
 try{
  await enable(engine,groupId,'auto',1);
  adapter.planResult={steps:[{to:'前端',instruction:'第一步'}]};
  await plan(engine,groupId);
  await wait(()=>adapter.calls.length===1);
  assert.equal(roundOf(engine,groupId).moderator!.steps,1);
  adapter.calls[0].finish();
  await wait(()=>roundOf(engine,groupId).moderator?.status==='halted');
  assert.equal(adapter.planCalls.length,1);
  assert.match(roundOf(engine,groupId).moderator!.error||'',/步数/);
 }finally{await engine.close();}
});

test('auto mode re-plans on completion and halts cleanly when the goal is finished',async()=>{
 const {engine,adapter,groupId}=await setup();
 try{
  await enable(engine,groupId,'auto',6);
  let calls=0;adapter.planImpl=async()=>{calls++;return calls===1?{steps:[{to:'前端',instruction:'X'}]}:{steps:[],finish:true};};
  await plan(engine,groupId);
  await wait(()=>adapter.calls.length===1);
  adapter.calls[0].finish();
  await wait(()=>adapter.planCalls.length===2);
  await wait(()=>roundOf(engine,groupId).moderator?.status==='halted');
  assert.equal(roundOf(engine,groupId).moderator!.plan!.finish,true);
  assert.equal(adapter.calls.length,1);
 }finally{await engine.close();}
});

test('auto mode halts on a failed task and never auto-retries it',async()=>{
 const {engine,adapter,groupId}=await setup();
 try{
  await enable(engine,groupId,'auto',6);
  adapter.planResult={steps:[{to:'前端',instruction:'X'}]};
  await plan(engine,groupId);
  await wait(()=>adapter.calls.length===1);
  adapter.calls[0].finish({status:'failed',error:'boom'});
  await wait(()=>roundOf(engine,groupId).moderator?.status==='halted');
  assert.equal(adapter.calls.length,1);
  assert.equal(adapter.planCalls.length,1);
  assert.match(roundOf(engine,groupId).moderator!.error||'',/待确认或失败/);
 }finally{await engine.close();}
});

test('an empty non-finish plan halts without dispatching',async()=>{
 const {engine,adapter,groupId}=await setup();
 try{
  await enable(engine,groupId,'auto',6);
  adapter.planResult={steps:[]};
  await plan(engine,groupId);
  await wait(()=>roundOf(engine,groupId).moderator?.status==='halted');
  assert.equal(adapter.calls.length,0);
  assert.match(roundOf(engine,groupId).moderator!.error||'',/可执行分配/);
 }finally{await engine.close();}
});

test('a planning failure is retryable and dispatches nothing',async()=>{
 const {engine,adapter,groupId}=await setup();
 try{
  await enable(engine,groupId,'suggest');
  adapter.planImpl=async()=>{throw new Error('bad json');};
  await plan(engine,groupId);
  await wait(()=>roundOf(engine,groupId).moderator?.status==='failed');
  assert.equal(adapter.calls.length,0);
  assert.match(roundOf(engine,groupId).moderator!.error||'',/bad json/);
  adapter.planImpl=async()=>({steps:[{to:'前端',instruction:'恢复'}]});
  await plan(engine,groupId);
  await wait(()=>roundOf(engine,groupId).moderator?.status==='awaiting_approval');
 }finally{await engine.close();}
});

test('dependent assignments wait for their prerequisite to complete',async()=>{
 const {engine,adapter,groupId}=await setup();
 try{
  await enable(engine,groupId,'suggest');
  adapter.planResult={steps:[{to:'前端',instruction:'A'},{to:'后端',instruction:'B',dependsOn:0}]};
  await plan(engine,groupId);
  await wait(()=>roundOf(engine,groupId).moderator?.status==='awaiting_approval');
  const steps=roundOf(engine,groupId).moderator!.plan!.steps;
  await engine.execute({action:'approvePlan',commandId:commandId(),groupId,planId:roundOf(engine,groupId).moderator!.plan!.id,stepIds:steps.map(s=>s.id)});
  await wait(()=>adapter.calls.length===1);
  assert.equal(adapter.calls[0].input.prompt,'A');
  const tasks=roundOf(engine,groupId).tasks;
  const taskA=tasks.find(t=>t.alias==='前端')!;const taskB=tasks.find(t=>t.alias==='后端')!;
  assert.equal(taskB.dependsOn,taskA.id);
  adapter.calls[0].finish();
  await wait(()=>adapter.calls.length===2);
  assert.equal(adapter.calls[1].input.prompt,'B');
 }finally{await engine.close();}
});

test('moderator assignments inherit member permissions and cannot self-elevate',async()=>{
 const {engine,adapter,groupId}=await setup();
 try{
  await engine.execute({action:'configureMember',commandId:commandId(),groupId,memberId:'one',settings:{permissionPreset:'read-only'}});
  await enable(engine,groupId,'suggest');
  adapter.planResult={steps:[{to:'前端',instruction:'只读任务'}]};
  await plan(engine,groupId);
  await wait(()=>roundOf(engine,groupId).moderator?.status==='awaiting_approval');
  const step=roundOf(engine,groupId).moderator!.plan!.steps[0];
  await engine.execute({action:'approvePlan',commandId:commandId(),groupId,planId:roundOf(engine,groupId).moderator!.plan!.id,stepIds:[step.id]});
  await wait(()=>adapter.calls.length===1);
  assert.equal(adapter.calls[0].input.settings?.permissionPreset,'read-only');
 }finally{await engine.close();}
});

test('rewinding a moderator message restores the initiating user request',async()=>{
 const {engine,adapter,groupId}=await setup();const forks:{sessionId:string;seq:number}[]=[];
 Object.assign(adapter,{forkAt:async(sessionId:string,seq:number)=>{forks.push({sessionId,seq});return 'branch-'+sessionId;}});
 try{
  await engine.execute({action:'send',commandId:commandId(),groupId,body:'原始用户请求',memberIds:['one']});
  await wait(()=>adapter.calls.length===1);
  adapter.calls[0].finish({eventSeqs:[5,6,7]});
  await wait(()=>roundOf(engine,groupId).tasks[0].status==='completed');
  await enable(engine,groupId,'suggest');
  adapter.planResult={steps:[{to:'前端',instruction:'主持人分配'}]};
  await plan(engine,groupId);
  await wait(()=>roundOf(engine,groupId).moderator?.status==='awaiting_approval');
  const step=roundOf(engine,groupId).moderator!.plan!.steps[0];
  await engine.execute({action:'approvePlan',commandId:commandId(),groupId,planId:roundOf(engine,groupId).moderator!.plan!.id,stepIds:[step.id]});
  await wait(()=>adapter.calls.length===2);
  adapter.calls[1].finish({eventSeqs:[15,16,17]});
  await wait(()=>roundOf(engine,groupId).tasks.every(t=>t.status==='completed'));
  const before=roundOf(engine,groupId);
  const moderatorMessage=before.messages.find(m=>m.moderatorOf)!;
  await engine.execute({action:'rewind',commandId:commandId(),groupId,roundId:before.id,messageId:moderatorMessage.id});
  const next=roundOf(engine,groupId);
  assert.equal(next.draft!.body,'原始用户请求');
  assert.equal(next.rewindOf!.messageId,before.messages[0].id);
 }finally{await engine.close();}
});

test('reloading interrupts planning into a retryable failed state',async()=>{
 const persistence=new Memory();const adapter=new Adapter();const engine=new GroupEngine(persistence,adapter);
 let release!:(value:ModeratorPlanResult)=>void;adapter.planImpl=()=>new Promise(resolve=>{release=resolve;});
 await engine.initialize();
 await engine.execute({action:'createGroup',commandId:commandId(),name:'M',members:[{id:'one',sessionId:'s',alias:'A',cwd:'/a'}]});
 const groupId=engine.snapshot().groups[0].id;
 await enable(engine,groupId,'suggest');
 void plan(engine,groupId);
 await wait(()=>roundOf(engine,groupId).moderator?.status==='planning');
 await engine.close();
 const recovered=new GroupEngine(persistence,new Adapter());
 try{
  await recovered.initialize();
  assert.equal(roundOf(recovered,groupId).moderator!.status,'failed');
 }finally{release({steps:[]});await recovered.close();}
});

test('legacy version-one snapshots without moderator fields still parse',async()=>{
 const {engine,persistence,groupId}=await setup();
 try{
  await engine.execute({action:'send',commandId:commandId(),groupId,body:'普通消息',memberIds:['one']});
  const stored=persistence.value!;
  assert.equal(stored.formatVersion,1);
  assert.equal(stored.groups[0].moderator,undefined);
  const parsed=snapshotSchema.parse(JSON.parse(JSON.stringify(stored)));
  assert.equal(parsed.groups[0].id,groupId);
 }finally{await engine.close();}
});