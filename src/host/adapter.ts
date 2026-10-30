/** Harness session adapter: follow exact request identities and never cancel unrelated turns. */
import type {Context} from '@deepseek-ai/cordis';
import type {ExecutionInput,ExecutionResult,SessionAdapter,MemberSettings,MemberOptions} from '../core/model.ts';
import {stageAssets,type AttachmentPorts,type FileReceipt,type PromptAttachment} from './assets.ts';
import {bindPeerTools,type PeerCallbacks} from './collaboration.ts';
export interface LogEvent {type:string;seq:number;data:Record<string,unknown>}
interface Message {id?:string;source?:{kind?:string;rpcId?:string};content?:{type:string;text?:string}[]}
export interface AgentPort {ctx?:Context;status:'idle'|'running';session:{id:string;header:{cwd?:string}};inbox:{nextTurn:Message[];nextStep:Message[];remove(id:string):boolean};cancel(cause:{kind:'user'},options:{keepInbox:true}):void;model?:{current?():{provider:string;model:string;reasoningEffort?:string}|undefined;select?(value:{provider:string;model:string;reasoningEffort?:string}):void}}
export interface HostPorts {
 sessionController:{list(request:object,signal:AbortSignal):Promise<{items:SessionRow[]}>;prompt(request:{requestId:string;sessionId:string;mode:'queue';content:({type:'text';text:string}|PromptAttachment)[]},signal:AbortSignal):Promise<unknown>;resolveAgent?(sessionId:string):Promise<{agent:AgentPort}|{error:Error}>;fork?(request:{sessionId:string;atSeq:number}):Promise<{sessionId:string}>;projections?(request:{sessionId:string},signal:AbortSignal):Promise<null|{values:{modelSelection?:{next:{provider:string;model:string;reasoningEffort?:string}|null}}}>;modelCatalog?():Promise<{default:{provider:string;model:string;reasoningEffort?:string};groups:MemberOptions['models'];failures:{id:string;message:string}[]}>};
 agents:{get(id:string):AgentPort|undefined};
 sessionQuery:{readSession(id:string):Promise<{events:readonly LogEvent[]}>};
 permissionPresets?:{catalog():{options:MemberOptions['permissions']};current(session:AgentPort['session']):string;set(session:AgentPort['session'],name:string):void};
 commands?:{list(agent:AgentPort):MemberOptions['commands'];execute(agent:AgentPort,line:string,attachments:{type:'file';receiptId:string}[],signal:AbortSignal):Promise<{commandId:string;result:{kind:'success'|'error';text?:string;sourceEventSeq?:number}}|undefined>};
 attachments?:AttachmentPorts['attachments'];fileUploads?:AttachmentPorts['fileUploads'];
 llm:{resolveCallConfig?(selection:{provider:string;model:string;reasoningEffort?:string}):Promise<unknown>;stream(options:{provider:string;model:string;messages:{role:'user';content:{type:'text';text:string}[]}[];system:string;tools:never[];maxTokens:number;signal:AbortSignal}):AsyncIterable<{type:string;text?:string}>};
 agentDefaultModel:{currentSelection():{provider:string;model:string}};
}
export interface SessionRow {sessionId?:string;id?:string;title?:string;displayTitle?:string;cwd?:string;origin?:string;parentId?:string}
const modelSelectionUnavailable='当前 DSH 版本不支持会话独立模型设置，请在原会话设置模型；群组不会更改全局默认模型。';
const messageOf=(event:LogEvent):Message=>event.data as unknown as Message;
const messageText=(event:LogEvent):string=>{const m=event.data.message as Message|undefined;return (m?.content||[]).filter(p=>p.type==='text').map(p=>p.text||'').join('');};
export class HarnessAdapter implements SessionAdapter {
 private readonly disposers=new Set<()=>void>();
 private peers:PeerCallbacks|undefined;
 private closed=false;private readonly prepareLife=new AbortController();
 setPeers(callbacks:PeerCallbacks):void{this.peers=callbacks;}
 constructor(private readonly ctx:Context,readonly ports:HostPorts){}
 available(sessionId:string):boolean{const a=this.ports.agents.get(sessionId);return !a||(a.status==='idle'&&a.inbox.nextTurn.length===0&&a.inbox.nextStep.length===0);}
 async agent(sessionId:string):Promise<AgentPort>{
  const live=this.ports.agents.get(sessionId);if(live)return live;
  const found=await this.ports.sessionController.resolveAgent?.(sessionId);if(!found)throw new Error('当前部署不能激活此会话');if('error'in found)throw found.error;return found.agent;
 }
 async options(sessionId?:string):Promise<MemberOptions>{
  const agent=sessionId?await this.agent(sessionId):undefined;
  let currentDefault:{provider:string;model:string;reasoningEffort?:string};try{currentDefault=this.ports.agentDefaultModel.currentSelection();}catch{currentDefault={provider:'',model:''};}
  let catalog:{default:MemberOptions['defaultModel'];groups:MemberOptions['models'];failures:{id:string;message:string}[]};
  try{const value=await this.ports.sessionController.modelCatalog?.();if(!value)throw new Error('模型目录不可用');catalog=value;}catch(error){catalog={default:currentDefault,groups:[],failures:[{id:'models',message:error instanceof Error?error.message:String(error)}]};}
  const failures=catalog.failures.map(value=>({id:value.id,message:value.message}));let currentModel:MemberOptions['currentModel'];
  if(agent){
   try{currentModel=agent.model?.current?agent.model.current():(await this.ports.sessionController.projections?.({sessionId:agent.session.id},this.prepareLife.signal))?.values.modelSelection?.next??undefined;}catch(error){failures.push({id:'currentModel',message:error instanceof Error?error.message:String(error)});}
   if(!agent.model?.select)failures.push({id:'modelSelection',message:modelSelectionUnavailable});
  }
  return {models:agent&&!agent.model?.select?[]:catalog.groups,defaultModel:catalog.default,...(currentModel?{currentModel}:{}),permissions:this.ports.permissionPresets?.catalog().options||[],...(agent&&this.ports.permissionPresets?{currentPermission:this.ports.permissionPresets.current(agent.session)}:{}),commands:agent&&this.ports.commands?this.ports.commands.list(agent):[],failures};
 }
 async forkAt(sessionId:string,atSeq:number):Promise<string>{if(!this.ports.sessionController.fork)throw new Error('会话分支接口不可用');return (await this.ports.sessionController.fork({sessionId,atSeq})).sessionId;}
 private async configure(agent:AgentPort,settings:MemberSettings|undefined):Promise<void>{
  if(!settings)return;
  if(settings.provider&&settings.model){if(!agent.model?.select)throw new Error(modelSelectionUnavailable);const catalog=await this.ports.sessionController.modelCatalog?.();if(this.closed)throw new Error('群组适配器已停止');const model=catalog?.groups.find(group=>group.id===settings.provider)?.models.find(model=>model.id===settings.model);if(!model)throw new Error('指定的模型不可用');if(settings.reasoningEffort&&!model.reasoning?.efforts.some(effort=>effort.id===settings.reasoningEffort))throw new Error('该模型不支持指定的推理等级');const value={provider:settings.provider,model:settings.model,...(settings.reasoningEffort?{reasoningEffort:settings.reasoningEffort}:{})};await this.ports.llm.resolveCallConfig?.(value);if(this.closed)throw new Error('群组适配器已停止');agent.model.select(value);}
  if(settings.permissionPreset){if(!this.ports.permissionPresets)throw new Error('当前部署没有权限预设服务');if(!this.ports.permissionPresets.catalog().options.some(option=>option.value===settings.permissionPreset))throw new Error('指定权限预设不可用');this.ports.permissionPresets.set(agent.session,settings.permissionPreset);}
 }
 async execute(input:ExecutionInput,signal:AbortSignal,onProgress:(output:string)=>void,onStarted?:()=>void):Promise<ExecutionResult>{
  if(this.closed)return {status:'uncertain',output:'',turns:[],eventSeqs:[],error:'群组适配器已停止'};
  const prepareSignal=AbortSignal.any([signal,this.prepareLife.signal]);
  if(signal.aborted)return {status:'cancelled',output:'',turns:[],eventSeqs:[]};
  let peerDispose=()=>{};let parts:PromptAttachment[]=[];
  try{if(input.settings||input.peer||input.assets?.length||input.kind==='command'){const agent=await this.agent(input.sessionId);if(this.closed)throw new Error('群组适配器已停止');if(!this.available(input.sessionId))throw new Error('会话正在执行其他任务');if(input.kind==='command'&&input.assets?.some(asset=>asset.kind==='image'))throw new Error('原生指令不支持图片附件');await this.configure(agent,input.settings);if(input.assets?.length){if(!this.ports.attachments||!this.ports.fileUploads)throw new Error('附件服务不可用');parts=await stageAssets({attachments:this.ports.attachments,fileUploads:this.ports.fileUploads},input.sessionId,input.assets,prepareSignal);}if(this.closed)throw new Error('群组适配器已停止');if(input.peer){if(!agent.ctx||!this.peers)throw new Error('成员互聊服务不可用');peerDispose=bindPeerTools(this.ctx,agent.ctx,input,this.peers);}if(input.kind==='command'){try{const files=parts.filter((part):part is FileReceipt=>part.type==='file');if(files.length!==parts.length)throw new Error('原生指令不支持图片附件');return await this.executeCommand(agent,input,files,signal,onStarted);}finally{peerDispose();}}}}catch(error){peerDispose();return {status:this.closed?'uncertain':signal.aborted?'cancelled':'failed',output:'',turns:[],eventSeqs:[],error:error instanceof Error?error.message:String(error)};}
  return await new Promise<ExecutionResult>((resolve)=>{
   let activeTurn:number|undefined;let ownedTurn:number|undefined;let mixed=false;let admitted=false;let settled=false;let stopping=false;let output='';let foreignInputs=0;const seen=new Set<number>();const seqs:number[]=[];const turns:number[]=[];
   const cleanup=()=>{peerDispose();dispose();signal.removeEventListener('abort',requestStop);this.disposers.delete(onUnload);};
   const finish=(status:ExecutionResult['status'],error?:string)=>{if(settled)return;settled=true;cleanup();resolve({status,output,turns,eventSeqs:seqs,...(error?{error}:{})});};
   const requestStop=()=>{
    if(settled||!signal.aborted)return;
    const a=this.ports.agents.get(input.sessionId);
    if(!a){if(admitted)finish('uncertain','已接收任务的活动会话不再可用，不能确认停止');return;}
    const pending=[...a.inbox.nextTurn,...a.inbox.nextStep].find(m=>m.source?.rpcId===input.requestId);
    if(pending?.id&&a.inbox.remove(pending.id)){finish('cancelled');return;}
    if(ownedTurn!==undefined&&activeTurn===ownedTurn){if(mixed){finish('uncertain','本执行轮次混入其他来源输入，已拒绝取消整个轮次，请到原会话处理');return;}if(!stopping){stopping=true;a.cancel({kind:'user'},{keepInbox:true});}return;}
    if(admitted&&ownedTurn===undefined)finish('uncertain','任务已接收但尚未确认所属轮次，请核对原会话');
   };
   const consume=(event:LogEvent)=>{
    if(settled||seen.has(event.seq))return;seen.add(event.seq);
    if(event.type==='turn/start'){activeTurn=Number(event.data.turn);foreignInputs=0;mixed=false;}
    if(event.type==='user/message'){
     const msg=messageOf(event);
     if(msg.source?.rpcId===input.requestId){ownedTurn=activeTurn;admitted=true;if(ownedTurn!==undefined&&!turns.includes(ownedTurn))turns.push(ownedTurn);seqs.push(event.seq);mixed=foreignInputs>0;onStarted?.();requestStop();}
     else if(msg.source?.kind==='user'){foreignInputs++;if(ownedTurn===activeTurn)mixed=true;}
    }
    if(event.type==='assistant/message'&&ownedTurn!==undefined&&Number(event.data.turn)===ownedTurn){const text=messageText(event);if(text){output+=(output?'\n\n':'')+text;if(output.length>200000)output=output.slice(0,199940)+'\n[输出超过展示上限，请查看原会话]';onProgress(output);}seqs.push(event.seq);}
    if(event.type==='turn/end'){
     if(ownedTurn!==undefined&&Number(event.data.turn)===ownedTurn){seqs.push(event.seq);const reason=event.data.reason as {kind?:string;error?:{message?:string}}|undefined;if(reason?.kind==='completed')finish('completed');else if(reason?.kind==='aborted')finish('cancelled');else finish('failed',reason?.error?.message||`执行未正常完成：${reason?.kind||'未知原因'}`);}
     if(Number(event.data.turn)===activeTurn)activeTurn=undefined;
    }
   };
   const dispose=this.ctx.on('session/event' as never,((session:{id:string},event:LogEvent)=>{if(session.id===input.sessionId)consume(event);}) as never);
   const onUnload=()=>finish('uncertain','插件已卸载，任务可能仍在原会话运行，请核对后再继续');this.disposers.add(onUnload);
   signal.addEventListener('abort',requestStop,{once:true});
   void (async()=>{
    try{
     const baseline=await this.ports.sessionQuery.readSession(input.sessionId);
     for(const event of baseline.events)consume(event);
     if(settled)return;
     if(turns.length){finish('uncertain','发现同请求标识的未结束执行，不再次派发，请核对原会话');return;}
     if(signal.aborted){finish('cancelled');return;}
     if(!this.available(input.sessionId)){finish('failed','会话刚被其他工作占用，请在空闲后重试');return;}
     await this.ports.sessionController.prompt({sessionId:input.sessionId,requestId:input.requestId,mode:'queue',content:[...(input.prompt?[{type:'text' as const,text:input.prompt}]:[]),...parts]},prepareSignal);
     admitted=true;requestStop();
    }catch(error){if(settled)return;const code=error&&typeof error==='object'&&'code'in error?String(error.code):'';const definitelyRejected=['session/not-found','session/agent-busy','gateway/bad-request','session/archived','session/attachment-invalid','session/model-unavailable'].includes(code);finish(definitelyRejected?'failed':'uncertain',error instanceof Error?error.message:String(error));}
   })();
  });
 }
 private async executeCommand(agent:AgentPort,input:ExecutionInput,parts:{type:'file';receiptId:string}[],signal:AbortSignal,onStarted?:()=>void):Promise<ExecutionResult>{
  if(!this.ports.commands)throw new Error('当前部署没有指令服务');
  const events:LogEvent[]=[];const dispose=this.ctx.on('session/event' as never,((session:{id:string},event:LogEvent)=>{if(session.id===input.sessionId&&event.type.startsWith('command/'))events.push(event);}) as never);
  try{onStarted?.();const result=await this.ports.commands.execute(agent,input.prompt,parts,signal);if(!result)throw new Error('该会话不支持此指令');const seqs=events.filter(event=>event.data.commandId===result.commandId).map(event=>event.seq);if(signal.aborted)return {status:'uncertain',output:result.result.text||'',turns:[],eventSeqs:seqs,error:'指令已中断，请核对其已发生的操作'};return {status:result.result.kind==='success'?'completed':'failed',output:result.result.text||'指令执行完成',turns:[],eventSeqs:seqs,...(result.result.kind==='error'?{error:result.result.text||'指令失败'}:{})};}finally{dispose();}
 }
 async summarize(report:string,signal:AbortSignal):Promise<string>{
  const selection=this.ports.agentDefaultModel.currentSelection();let text='';
  for await(const chunk of this.ports.llm.stream({...selection,system:'你是只读协作总结助手。仅根据给出的执行记录归纳目标、有效交付、分歧、失败和下一步。保留 task、session、turn、seq 来源。不要把撤回、取消、失败或缺失结果视为已完成。没有证据时明确说明。你没有工具，不执行任何任务。使用中文 Markdown。',messages:[{role:'user',content:[{type:'text',text:report.slice(0,100000)}]}],tools:[],maxTokens:6000,signal})){if(chunk.type==='text-delta')text+=chunk.text||'';}
  if(!text.trim())throw new Error('模型未返回总结正文；结构化执行记录已保留，可重试总结。');
  return text+(report.length>100000?'\n\n> 模型输入受长度限制，部分记录未进入 AI 提炼；请结合以下执行记录核对。':'')+'\n\n---\n\n'+report;
 }
 close():void{this.closed=true;this.prepareLife.abort();for(const fn of [...this.disposers])fn();this.disposers.clear();}
}
