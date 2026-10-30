/** Host-owned serialized persistence, task queue, cancellation and collaboration rounds. */
import {createHash,randomUUID} from 'node:crypto';
import {type Snapshot,type Group,type Round,type Task,type Member,type Command,type Persistence,type SessionAdapter,type ExecutionResult,type ExecutionInput,type Asset,type AgentMessage,commandSchema,snapshotSchema,initialSnapshot,currentRound,isTerminal} from './model.ts';
import {buildReport} from './report.ts';
const id=()=>randomUUID();
const errorText=(e:unknown)=>e instanceof Error?e.message:String(e);
const blankRound=(number:number):Round=>({id:id(),number,status:'active',messages:[],tasks:[],createdAt:Date.now()});
export class GroupEngine {
 private state:Snapshot=initialSnapshot();
 private chain:Promise<void>=Promise.resolve();
 private readonly listeners=new Set<()=>void>();
 private readonly running=new Map<string,{sessionId:string;cwd:string;abort:AbortController}>();
 private scheduled=false;
 private closed=false;
 private fatal:string|undefined;
 private readonly summaries=new Map<string,AbortController>();
 constructor(private readonly persistence:Persistence,private readonly adapter:SessionAdapter,private readonly maxConcurrent=3){}
 async initialize():Promise<void>{
  const stored=await this.persistence.load();
  this.state=stored===null||stored===undefined?initialSnapshot():snapshotSchema.parse(stored);
  await this.mutate(state=>{for(const g of state.groups)for(const r of g.rounds){for(const t of r.tasks){if(['dispatching','running','stopping'].includes(t.status)){t.status='uncertain';t.error='Host 或插件重新加载，需核对原会话后再决定是否重新派发。';const a=t.attempts.at(-1);if(a)a.status='uncertain';}}if(r.status==='pausing')r.status='paused';if(r.status==='summarizing'){r.report={status:'failed',kind:'structured',content:r.report?.content||buildReport(g,r),sourceRevision:state.revision,createdAt:Date.now(),error:'总结在 Host 重新加载时中断，可只重试总结。'};}}});
  this.schedule();
 }
 snapshot():Snapshot{return structuredClone(this.state);}
 subscribe(listener:()=>void):()=>void{this.listeners.add(listener);return()=>this.listeners.delete(listener);}
 get healthError():string|undefined{return this.fatal;}
 private async mutate(operation:(draft:Snapshot)=>void|Promise<void>):Promise<void>{
  const result=this.chain.then(async()=>{if(this.fatal)throw new Error(this.fatal);const next=structuredClone(this.state);await operation(next);next.revision++;try{await this.persistence.save(next);}catch(e){this.fatal='群组存储失败，已停止继续派发：'+errorText(e);for(const f of this.listeners)f();throw e;}this.state=next;for(const f of this.listeners)f();});
  this.chain=result.catch(()=>{});await result;
 }
 private group(state:Snapshot,groupId:string):Group{const g=state.groups.find(g=>g.id===groupId);if(!g)throw new Error('群组不存在');if(g.archived)throw new Error('群组已归档');return g;}
 async execute(raw:unknown):Promise<Snapshot>{
  if(this.closed)throw new Error('群组服务已停止');
  const command=commandSchema.parse(raw);const toAbort=new Set<string>();
  await this.mutate(async state=>{
   if(state.commands.includes(command.commandId))return;
   if(command.action==='createGroup'){
    this.validateMembers(command.members);
    state.groups.push({id:id(),name:command.name,goal:command.goal,archived:false,members:command.members,rounds:[blankRound(1)],createdAt:Date.now()});
   }else{
    const g=this.group(state,command.groupId);const r=currentRound(g);
    const taskFor=(taskId:string)=>{const t=r.tasks.find(t=>t.id===taskId);if(!t)throw new Error('本轮任务不存在');return t;};
    const control=(t:Task,kind:'pause'|'cancel')=>{
     if(isTerminal(t))return;
     if(t.status==='uncertain')throw new Error('执行归属尚未确认，请先核对原会话；不能直接报告停止成功');
     if(['queued','paused'].includes(t.status)){t.status=kind==='pause'?'paused':'cancelled';t.control=kind;return;}
     t.control=kind;t.status='stopping';toAbort.add(t.id);
    };
    switch(command.action){
     case 'addMember':if(r.status!=='active')throw new Error('请在协作进行中添加成员');this.validateMembers([...g.members,command.member]);g.members.push(command.member);break;
     case 'removeMember':if(r.tasks.some(t=>t.memberId===command.memberId&&!isTerminal(t)))throw new Error('该成员仍有未结束任务，请先处理');g.members=g.members.filter(m=>m.id!==command.memberId);if(g.members.length<2&&g.collaboration)g.collaboration.enabled=false;break;
     case 'configureMember':{const member=g.members.find(member=>member.id===command.memberId);if(!member)throw new Error('成员不存在');if(['danger-full-access','auto'].includes(command.settings.permissionPreset||'')&&command.settings.permissionPreset!==member.settings?.permissionPreset&&!command.permissionAcknowledged)throw new Error('启用此权限前请确认风险提示');member.settings=command.settings;break;}
     case 'collaboration':if(command.options.enabled&&g.members.length<2)throw new Error('成员互聊至少需要两位会话');g.collaboration=command.options;break;
     case 'send':{
      if(command.roundId&&command.roundId!==r.id)throw new Error('协作轮次已改变，请检查草稿后重新发送');
      const quote=command.quoteTaskId?r.tasks.find(task=>task.id===command.quoteTaskId):undefined;
      if(command.quoteTaskId&&(!quote||quote.status!=='completed'||r.messages.find(message=>message.id===quote.messageId)?.withdrawnAt))throw new Error('引用结果不存在、未完成或来源已撤回');
      this.appendMessage(g,r,{body:command.body,memberIds:command.memberIds,assets:command.assets,kind:command.kind,quoteTaskId:command.quoteTaskId});break;
     }
     case 'forward':{const source=g.rounds.flatMap(round=>round.tasks).find(task=>task.id===command.taskId);if(!source||source.status!=='completed')throw new Error('只能转发已完成结果');const sourceRound=g.rounds.find(round=>round.tasks.includes(source))!;if(sourceRound.messages.find(message=>message.id===source.messageId)?.withdrawnAt)throw new Error('结果来源已撤回');const output=source.attempts.at(-1)?.output||'';const destination=r.status==='completed'?blankRound(r.number+1):r;if(destination!==r)g.rounds.push(destination);this.appendMessage(g,destination,{body:output,memberIds:command.memberIds,relayOfTaskId:source.id});break;}
     case 'rewind':{
      if(!this.adapter.forkAt)throw new Error('当前部署不支持会话分支回退');
      if(r.tasks.some(task=>!isTerminal(task))||['closing','summarizing'].includes(r.status))throw new Error('请先结束或取消本轮未完成任务，再回退对话');
      const sourceRound=command.roundId?g.rounds.find(round=>round.id===command.roundId):r;if(!sourceRound)throw new Error('协作轮次不存在');
      let cut=sourceRound.messages.findIndex(message=>message.id===command.messageId);if(cut<0)throw new Error('消息不存在');let anchor=sourceRound.messages[cut];const visited=new Set<string>();while(anchor.senderMemberId&&anchor.relayOfTaskId){if(visited.has(anchor.id))throw new Error('互聊来源链不完整');visited.add(anchor.id);const parent=sourceRound.tasks.find(task=>task.id===anchor.relayOfTaskId);const index=parent?sourceRound.messages.findIndex(message=>message.id===parent.messageId):-1;if(index<0)throw new Error('互聊来源不在当前轮次，请选择用户请求回退');cut=index;anchor=sourceRound.messages[index];}
      const sourceIndex=g.rounds.indexOf(sourceRound);const afterIds=new Set(sourceRound.messages.slice(cut).map(message=>message.id));const plans=new Map<string,{sessionId:string;seq:number}>();
      const affected=g.rounds.slice(sourceIndex).flatMap((round,index)=>round.tasks.filter(task=>index>0||afterIds.has(task.messageId)));
      if(affected.some(task=>!isTerminal(task)))throw new Error('请先处理相关轮次中未结束的任务');
      for(const task of affected){for(const attempt of task.attempts){if(!attempt.eventSeqs.length)continue;const seq=Math.min(...attempt.eventSeqs)-1;if(seq<0)throw new Error('无法在首个日志事件之前创建分支');const previous=plans.get(task.memberId);if(!previous)plans.set(task.memberId,{sessionId:task.sessionId,seq});else if(previous.sessionId===task.sessionId)previous.seq=Math.min(previous.seq,seq);}}
      const forks=new Map<string,string>();for(const [memberId,plan]of plans)forks.set(memberId,await this.adapter.forkAt(plan.sessionId,plan.seq));
      for(const member of g.members){const fork=forks.get(member.id);if(fork)member.sessionId=fork;}
      const next=blankRound(r.number+1);const beforeIds=new Set(sourceRound.messages.slice(0,cut).map(message=>message.id));
      next.messages=structuredClone(sourceRound.messages.slice(0,cut)).map(message=>({...message,roundId:next.id}));
      next.tasks=structuredClone(sourceRound.tasks.filter(task=>beforeIds.has(task.messageId))).map(task=>({...task,roundId:next.id}));
      next.rewindOf={roundId:sourceRound.id,messageId:anchor.id};next.draft={body:anchor.body,memberIds:anchor.mentions.filter(memberId=>g.members.some(member=>member.id===memberId)),...(anchor.assets?{assets:anchor.assets}:{}),...(anchor.kind?{kind:anchor.kind}:{})};
      g.rounds.push(next);break;
     }
     case 'withdraw':{const m=r.messages.find(m=>m.id===command.messageId);if(!m)throw new Error('消息不存在');if(m.withdrawnAt)break;const affected=r.tasks.filter(t=>t.messageId===m.id);if(affected.some(t=>t.status==='uncertain'))throw new Error('关联任务仍待确认，请先核对原会话');m.withdrawnAt=Date.now();for(const t of affected)control(t,'cancel');const affectedIds=new Set(affected.map(t=>t.id));for(const message of r.messages)if(message.quoteTaskId&&affectedIds.has(message.quoteTaskId)){for(const t of r.tasks.filter(t=>t.messageId===message.id&&t.status==='queued')){t.status='paused';t.error='所引用结果的来源已撤回，请重新确认任务输入。';}}break;}
     case 'pauseTask':control(taskFor(command.taskId),'pause');break;
     case 'cancelTask':control(taskFor(command.taskId),'cancel');break;
     case 'resumeTask':{const t=taskFor(command.taskId);if(r.status!=='active')throw new Error('请先继续本轮协作');if(t.status!=='paused')throw new Error('任务没有暂停');if(t.error?.includes('来源已撤回'))throw new Error('请重新发送带有效引用的任务');t.status='queued';const settings=g.members.find(member=>member.id===t.memberId)?.settings;if(settings)t.settings=structuredClone(settings);else delete t.settings;delete t.control;break;}
     case 'retryTask':{const t=taskFor(command.taskId);if(r.status!=='active')throw new Error('本轮不接收重试');if(!['failed','uncertain'].includes(t.status))throw new Error('仅失败或待确认任务可重试');if(t.status==='uncertain'&&!command.acknowledgeDuplicateRisk)throw new Error('请先核对原会话并确认重派可能重复执行');if(r.messages.find(m=>m.id===t.messageId)?.withdrawnAt)throw new Error('原指令已撤回，请重新发送');t.status='queued';const settings=g.members.find(member=>member.id===t.memberId)?.settings;if(settings)t.settings=structuredClone(settings);else delete t.settings;delete t.control;delete t.error;break;}
     case 'pauseRound':if(!['active','pausing'].includes(r.status))throw new Error('当前轮次不能暂停');r.status='pausing';for(const t of r.tasks)control(t,'pause');if(!r.tasks.some(t=>t.status==='stopping'))r.status='paused';break;
     case 'resumeRound':if(r.status!=='paused')throw new Error('本轮尚未暂停');r.status='active';for(const t of r.tasks)if(t.status==='paused'&&!t.error?.includes('来源已撤回')){t.status='queued';const settings=g.members.find(member=>member.id===t.memberId)?.settings;if(settings)t.settings=structuredClone(settings);else delete t.settings;delete t.control;}break;
     case 'finish':if(!['active','paused'].includes(r.status))throw new Error('本轮已在结束或已结束');if(r.tasks.some(t=>t.status==='uncertain'))throw new Error('存在待确认任务，请先核对原会话并处理');r.status='closing';if(command.mode==='stop'){for(const t of r.tasks)control(t,'cancel');}else{for(const t of r.tasks)if(t.status==='paused'){if(t.error?.includes('来源已撤回'))throw new Error('存在无效引用，请先取消相关任务');t.status='queued';const settings=g.members.find(member=>member.id===t.memberId)?.settings;if(settings)t.settings=structuredClone(settings);else delete t.settings;delete t.control;}}break;
     case 'newRound':if(r.status!=='completed')throw new Error('请先结束当前轮次');g.rounds.push(blankRound(r.number+1));break;
     case 'archive':if(r.tasks.some(t=>!isTerminal(t))||r.status==='summarizing')throw new Error('仍有未结束执行，不能归档');g.archived=true;break;
     case 'retrySummary':if(!r.report||r.report.status!=='failed')throw new Error('总结没有失败');r.status='closing';delete r.report;break;
    }
   }
   state.commands.push(command.commandId);
   if(state.commands.length>2000)state.commands.splice(0,state.commands.length-2000);
  });
  for(const taskId of toAbort)this.running.get(taskId)?.abort.abort();
  this.schedule();return this.snapshot();
 }
 private appendMessage(g:Group,r:Round,input:{body:string;memberIds:string[];assets?:Asset[];kind?:'prompt'|'command';quoteTaskId?:string;relayOfTaskId?:string;senderMemberId?:string}):string{
  if(r.status!=='active')throw new Error('本轮当前不接收任务');
  if(input.body.length>20000)throw new Error('消息超过 20000 字符，请编辑后发送');
  if(!input.body.trim()&&!input.assets?.length)throw new Error('消息或附件不能为空');
  if(new Set(input.assets?.map(asset=>asset.id)).size!==(input.assets?.length||0))throw new Error('附件标识重复');
  for(const asset of input.assets||[]){const prior=g.rounds.flatMap(round=>round.messages.flatMap(message=>message.assets||[])).find(item=>item.id===asset.id);if(prior&&(prior.ref.attachmentId!==asset.ref.attachmentId||prior.bytes!==asset.bytes||prior.name!==asset.name))throw new Error('附件标识已用于另一文件');}
  const recipients=[...new Set(input.memberIds)].map(memberId=>{const member=g.members.find(member=>member.id===memberId);if(!member)throw new Error('接收者已失效，请重新选择');return member;});
  if(input.kind==='command'&&!recipients.length)throw new Error('调用指令时请选择目标会话');
  const sender=input.senderMemberId?g.members.find(member=>member.id===input.senderMemberId):undefined;
  const messageId=id();r.messages.push({id:messageId,roundId:r.id,author:sender?.alias||'user',body:input.body,mentions:recipients.map(member=>member.id),createdAt:Date.now(),...(input.assets?.length?{assets:input.assets}:{}),...(input.kind?{kind:input.kind}:{}),...(input.quoteTaskId?{quoteTaskId:input.quoteTaskId}:{}),...(input.relayOfTaskId?{relayOfTaskId:input.relayOfTaskId}:{}),...(sender?{senderMemberId:sender.id}:{})});
  delete r.draft;
  for(const member of recipients)r.tasks.push({id:id(),roundId:r.id,messageId,memberId:member.id,sessionId:member.sessionId,alias:member.alias,cwd:member.cwd,prompt:input.body,status:'queued',attempts:[],createdAt:Date.now(),...(input.kind?{kind:input.kind}:{}),...(input.assets?.length?{assets:input.assets}:{}),...(member.settings?{settings:structuredClone(member.settings)}:{}),...(sender?{senderMemberId:sender.id}:{})});
  return messageId;
 }
 /** Enqueue an agent-addressed message without awaiting its recipient or permitting unbounded loops. */
 async sendFromAgent(input:AgentMessage):Promise<{messageId:string;queued:number;remaining:number}>{
  if(this.closed)throw new Error('群组服务已停止');
  let receipt={messageId:'',queued:0,remaining:0};
  const commandId='peer-'+createHash('sha256').update(input.requestId+':'+input.callId).digest('hex');
  await this.mutate(state=>{
   const g=this.group(state,input.groupId);const r=currentRound(g);
   if(state.commands.includes(commandId)){const message=r.messages.find(message=>message.relayOfTaskId===input.taskId&&message.senderMemberId===input.sourceMemberId&&message.body===input.text);receipt={messageId:message?.id||'',queued:message?.mentions.length||0,remaining:Math.max(0,(g.collaboration?.maxMessages||0)-(r.relayCount||0))};return;}
   if(!g.collaboration?.enabled||r.status!=='active'||r.id!==input.roundId)throw new Error('群内互聊已关闭或本轮已停止');
   const source=r.tasks.find(task=>task.id===input.taskId&&task.memberId===input.sourceMemberId&&task.attempts.at(-1)?.requestId===input.requestId);
   if(!source||!this.running.has(source.id)||!['running','dispatching'].includes(source.status))throw new Error('发送方不是当前群任务的活动会话');
   const targets=[...new Set(input.recipients)].map(value=>g.members.find(member=>member.id===value||member.alias===value));
   if(!targets.length||targets.some(member=>!member))throw new Error('请指定有效的群成员');
   if(targets.some(member=>member!.id===source.memberId))throw new Error('互聊消息不能发送给自己');
   const used=r.relayCount||0;if(used+targets.length>g.collaboration.maxMessages)throw new Error('本轮互聊消息额度已用完，请由用户开启下一轮');
   const assets=[...new Set(input.assetIds||[])].map(id=>{const asset=r.messages.flatMap(message=>message.assets||[]).find(asset=>asset.id===id);if(!asset)throw new Error('只能转发本轮群聊中的附件');return asset;});
   const messageId=this.appendMessage(g,r,{body:input.text,memberIds:targets.map(member=>member!.id),senderMemberId:source.memberId,relayOfTaskId:source.id,...(assets.length?{assets}:{})});
   r.relayCount=used+targets.length;state.commands.push(commandId);if(state.commands.length>2000)state.commands.splice(0,state.commands.length-2000);receipt={messageId,queued:targets.length,remaining:g.collaboration.maxMessages-r.relayCount};
  });this.schedule();return receipt;
 }
 /** Read-only view for a currently authorized group's collaboration tool. */
 readForAgent(groupId:string,memberId:string):{members:{id:string;alias:string}[];messages:{from:string;text:string;recipients:string[];attachments:{id:string;name:string;kind:string}[];truncated:boolean}[];results:{from:string;status:string;text:string;truncated:boolean}[]}{
  const g=this.group(this.state,groupId);if(!g.collaboration?.enabled||!g.members.some(member=>member.id===memberId))throw new Error('当前会话没有群内互聊权限');
  const r=currentRound(g);return {members:g.members.map(member=>({id:member.id,alias:member.alias})),messages:r.messages.filter(message=>!message.withdrawnAt).slice(-10).map(message=>({from:message.author,text:message.body.slice(-4000),truncated:message.body.length>4000,recipients:message.mentions.map(id=>g.members.find(member=>member.id===id)?.alias||id),attachments:(message.assets||[]).map(asset=>({id:asset.id,name:asset.name,kind:asset.kind}))})),results:r.tasks.slice(-10).map(task=>({from:task.alias,status:task.status,text:task.attempts.at(-1)?.output.slice(-4000)||'',truncated:(task.attempts.at(-1)?.output.length||0)>4000}))};
 }
 private validateMembers(members:Member[]):void{
  if(members.length>16)throw new Error('每组最多 16 个会话');if(new Set(members.map(m=>m.id)).size!==members.length||new Set(members.map(m=>m.alias)).size!==members.length||new Set(members.map(m=>m.sessionId)).size!==members.length)throw new Error('会话、成员标识和群内别名必须唯一');
 }
 kick():void{this.schedule();}
 private schedule():void{if(this.closed||this.scheduled||this.fatal)return;this.scheduled=true;queueMicrotask(()=>{this.scheduled=false;void this.pump().catch(e=>{this.fatal=errorText(e);for(const f of this.listeners)f();});});}
 private async pump():Promise<void>{
  if(this.closed||this.fatal)return;
  for(const g of this.state.groups){if(g.archived)continue;const r=currentRound(g);
   if(r.status==='closing'&&r.tasks.every(isTerminal)&&!this.summaries.has(r.id)){void this.summarize(g.id,r.id);continue;}
   if(!['active','closing'].includes(r.status))continue;
   for(const t of r.tasks){if(this.running.size>=this.maxConcurrent)break;if(t.status!=='queued'||this.running.has(t.id)||!this.adapter.available(t.sessionId))continue;if([...this.running.values()].some(x=>x.sessionId===t.sessionId||(t.cwd&&x.cwd===t.cwd)))continue;
    const abort=new AbortController();this.running.set(t.id,{sessionId:t.sessionId,cwd:t.cwd,abort});
    try{let input:ExecutionInput|undefined;await this.mutate(state=>{const draft=this.group(state,g.id);const round=currentRound(draft);const task=round.tasks.find(x=>x.id===t.id);if(!task||task.status!=='queued'||!['active','closing'].includes(round.status))return;const requestId=id();task.attempts.push({id:id(),requestId,status:'dispatching',output:'',turns:[],eventSeqs:[],startedAt:Date.now(),...(task.settings?{settings:structuredClone(task.settings)}:{})});task.status='dispatching';delete task.error;input={sessionId:task.sessionId,requestId,prompt:round.messages.find(message=>message.id===task.messageId)?.body??task.prompt,...(task.kind?{kind:task.kind}:{}),...(task.assets?{assets:task.assets}:{}),...(task.settings?{settings:task.settings}:{}),...(draft.collaboration?.enabled?{peer:{groupId:draft.id,roundId:round.id,taskId:task.id,memberId:task.memberId,alias:task.alias,...(task.senderMemberId?{senderAlias:round.messages.find(message=>message.id===task.messageId)?.author}:{}),members:draft.members.map(member=>({id:member.id,alias:member.alias,sessionId:member.sessionId}))}}:{})};});if(!input){this.running.delete(t.id);continue;}void this.run(g.id,r.id,t.id,input,abort);}catch(e){this.running.delete(t.id);throw e;}
   }
  }
 }
 private async run(groupId:string,roundId:string,taskId:string,input:ExecutionInput,abort:AbortController):Promise<void>{
  const update=(draft:Snapshot,fn:(task:Task)=>void)=>{const t=draft.groups.find(g=>g.id===groupId)?.rounds.find(r=>r.id===roundId)?.tasks.find(t=>t.id===taskId);if(t&&t.attempts.at(-1)?.requestId===input.requestId)fn(t);};
  let result:ExecutionResult;
  try{await this.mutate(state=>update(state,t=>{const a=t.attempts.at(-1)!;a.status=t.status;}));
   result=await this.adapter.execute(input,abort.signal,output=>{void this.mutate(state=>update(state,t=>{t.attempts.at(-1)!.output=output.slice(0,200000);})).catch(()=>{});},()=>{void this.mutate(state=>update(state,t=>{if(t.status!=='stopping'){t.status='running';t.attempts.at(-1)!.status='running';}})).catch(()=>{});});
  }catch(e){result={status:'uncertain',output:'',turns:[],eventSeqs:[],error:'执行状态需核对：'+errorText(e)};}
  if(this.closed){this.running.delete(taskId);return;}
  try{await this.mutate(state=>{update(state,t=>{const a=t.attempts.at(-1)!;const status=result.status==='cancelled'&&t.control==='pause'?'paused':result.status;t.status=status;a.status=status;a.output=(result.output||a.output).slice(0,200000);a.turns=result.turns;a.eventSeqs=result.eventSeqs;a.endedAt=Date.now();if(result.error){t.error=result.error;a.error=result.error;}});const r=state.groups.find(g=>g.id===groupId)?.rounds.find(r=>r.id===roundId);if(r?.status==='pausing'&&!r.tasks.some(t=>['running','dispatching','stopping'].includes(t.status)))r.status='paused';});}finally{this.running.delete(taskId);this.schedule();}
 }
 private async summarize(groupId:string,roundId:string):Promise<void>{
  const abort=new AbortController();this.summaries.set(roundId,abort);
  try{let report='';await this.mutate(state=>{const g=this.group(state,groupId);const r=g.rounds.find(r=>r.id===roundId)!;if(r.status!=='closing'||!r.tasks.every(isTerminal))throw new Error('任务尚未结束');report=buildReport(g,r);r.status='summarizing';r.report={status:'generating',kind:'structured',content:report,sourceRevision:state.revision,createdAt:Date.now()};});
   const content=this.adapter.summarize?await this.adapter.summarize(report,abort.signal):report;
   if(this.closed)return;
   await this.mutate(state=>{const r=this.group(state,groupId).rounds.find(r=>r.id===roundId)!;r.status='completed';r.report={...r.report!,status:'completed',kind:this.adapter.summarize?'ai':'structured',content:content.length>200000?content.slice(0,199900)+'\n[总结超过展示上限，完整结果请查看本轮任务及原会话。]':content};});
  }catch(e){if(this.closed)return;await this.mutate(state=>{const r=this.group(state,groupId).rounds.find(r=>r.id===roundId)!;r.report={status:'failed',kind:'structured',content:r.report?.content||'',sourceRevision:state.revision,createdAt:Date.now(),error:errorText(e)};}).catch(()=>{});}finally{this.summaries.delete(roundId);}
 }
 async close():Promise<void>{this.closed=true;for(const abort of this.summaries.values())abort.abort();await this.chain;this.listeners.clear();}
}
