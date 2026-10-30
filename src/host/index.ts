/** Persistent Cordis plugin providing owner-only group coordination through Typert Remote. */
import {Service,type Context} from '@deepseek-ai/cordis';
import {RemoteError,TypertRemoteService} from '@deepseek-ai/dsh-typert-protocol';
import {realpath} from 'node:fs/promises';
import {resolve} from 'node:path';
import {GroupEngine} from '../core/engine.ts';
import {type Command,type Snapshot,type MemberOptions,commandSchema} from '../core/model.ts';
import {remoteInfo} from '../rpc.ts';
import {readAsset} from './assets.ts';
import {HarnessAdapter,type HostPorts} from './adapter.ts';
interface KvUnit {loadAll():Promise<{global:unknown}>;setGlobal(value:unknown):Promise<void>;close():Promise<void>}
interface TypertPort {register(info:{package:string;face:'host';schemas:never[];invocations:typeof remoteInfo.descriptors;model:{services:never[];events:never[];objects:never[]}}):()=>void}
interface StoragePort {backend:{get(name:string):{kv?:{open(descriptor:{name:string;version:number;tables:string[];hasGlobal:boolean;layout:'single'}):Promise<KvUnit>}}}}
interface Invocation {peer:{principal:{kind:string}}}
declare module '@deepseek-ai/cordis' {interface Context {sessionGroups:SessionGroupsService}}
/** Deployment defaults; all group/task data uses an independent Harness storage unit. */
export interface Config {backend?:string;maxConcurrent?:number}
export default class SessionGroupsService extends TypertRemoteService {
 static inject=['sessionController','agents','sessionQuery','storage','storage.backend.json','typert','llm','agentDefaultModel','attachments','fileUploads','commands'];
 private engine!:GroupEngine;
 private adapter!:HarnessAdapter;
 constructor(ctx:Context,private readonly config:Config={}){super(ctx,'sessionGroups');}
 protected async [Service.init]():Promise<void>{
  const max=this.config.maxConcurrent??3;if(!Number.isInteger(max)||max<1||max>16)throw new Error('maxConcurrent must be an integer from 1 to 16');
  const storage=this.ctx.get('storage') as StoragePort;const backend=storage.backend.get(this.config.backend??'json');if(!backend.kv)throw new Error('Storage backend does not expose KV units');
  const unit=await backend.kv.open({name:'session_groups',version:1,tables:[],hasGlobal:true,layout:'single'});
  const get=<K extends keyof HostPorts>(name:K):HostPorts[K]=>this.ctx.get(name) as HostPorts[K];
  const hostCtx=this.ctx;
  this.adapter=new HarnessAdapter(this.ctx,{sessionController:get('sessionController'),agents:get('agents'),sessionQuery:get('sessionQuery'),llm:get('llm'),agentDefaultModel:get('agentDefaultModel'),attachments:get('attachments'),fileUploads:get('fileUploads'),commands:get('commands'),get permissionPresets(){return hostCtx.get('permissionPresets') as HostPorts['permissionPresets'];}});
  this.engine=new GroupEngine({load:async()=>(await unit.loadAll()).global,save:value=>unit.setGlobal(value)},this.adapter,max);
  this.adapter.setPeers({send:message=>this.engine.sendFromAgent(message),read:(groupId,memberId)=>this.engine.readForAgent(groupId,memberId)});
  try{await this.engine.initialize();}catch(e){await unit.close();throw e;}
  (this.ctx.get('typert') as unknown as TypertPort).register({package:remoteInfo.package,face:'host',schemas:[],invocations:remoteInfo.descriptors,model:{services:[],events:[],objects:[]}});
  this.ctx.on('agent/status' as never,(()=>this.engine.kick()) as never);
  this.ctx.effect(()=>async()=>{await this.engine.close();this.adapter.close();await unit.close();},'session-groups: durable lifecycle');
 }
 private owner():void{const invocation=(this.ctx as unknown as {invocation?:Invocation}).invocation;if(invocation&&invocation.peer.principal.kind!=='owner')throw new RemoteError('gateway/bad-request','会话群组仅允许 Host 所有者访问',{});}
 /** Read native model, reasoning, permission and slash-command choices. */
 async options(request:{sessionId?:string},signal:AbortSignal):Promise<MemberOptions>{this.owner();signal.throwIfAborted();return this.adapter.options(request.sessionId);}
 /** Read a saved group attachment without publishing a bearer URL or exposing filesystem paths. */
 async assetData(request:{groupId:string;assetId:string},signal:AbortSignal):Promise<{name:string;mediaType:string;data:string}>{
  this.owner();signal.throwIfAborted();const group=this.engine.snapshot().groups.find(group=>group.id===request.groupId);if(!group)throw new Error('群组不存在');const asset=group.rounds.flatMap(round=>[...round.messages.flatMap(message=>message.assets||[]),...(round.draft?.assets||[])]).find(asset=>asset.id===request.assetId);if(!asset)throw new Error('附件不存在');if(!this.adapter.ports.attachments)throw new Error('附件存储不可用');return readAsset({attachments:this.adapter.ports.attachments},asset,signal);
 }
 /** Return a detached durable group snapshot. */
 snapshot(_request:object,signal:AbortSignal):Snapshot{this.owner();signal.throwIfAborted();if(this.engine.healthError)throw new Error(this.engine.healthError);return {...this.engine.snapshot(),capabilityVersion:2};}
 /** Wait for one durable revision or a twenty-second reconnect checkpoint. */
 async watch(request:{revision:number},signal:AbortSignal):Promise<Snapshot>{
  this.owner();signal.throwIfAborted();if(this.engine.healthError)throw new Error(this.engine.healthError);if(this.engine.snapshot().revision!==request.revision)return {...this.engine.snapshot(),capabilityVersion:2};
  await new Promise<void>((resolveWait,reject)=>{let done=false;const finish=(error?:unknown)=>{if(done)return;done=true;clearTimeout(timer);dispose();signal.removeEventListener('abort',abort);if(error)reject(error);else resolveWait();};const abort=()=>finish(signal.reason??new Error('aborted'));const dispose=this.engine.subscribe(()=>finish());const timer=setTimeout(()=>finish(),20000);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();if(this.engine.snapshot().revision!==request.revision)finish();});
  if(this.engine.healthError)throw new Error(this.engine.healthError);return {...this.engine.snapshot(),capabilityVersion:2};
 }
 /** Validate a user operation, verify actual member identities, and durably accept it. */
 async execute(raw:Command,signal:AbortSignal):Promise<Snapshot>{
  this.owner();signal.throwIfAborted();
  try{const request=commandSchema.parse(raw);if(request.action==='createGroup'||request.action==='addMember'){
   const rows=(await this.adapter.ports.sessionController.list({},signal)).items;
   const members=request.action==='createGroup'?request.members:[request.member];
   for(const member of members){const row=rows.find(row=>(row.sessionId||row.id)===member.sessionId);if(!row||row.origin==='subagent'||row.parentId)throw new Error('会话不存在，或其生命周期属于子代理，不能直接加入');member.cwd=row.cwd?await realpath(row.cwd).catch(()=>resolve(row.cwd!)):'';}
  }if(request.action==='configureMember'){const options=await this.adapter.options();const settings=request.settings;const model=settings.model?options.models.find(provider=>provider.id===settings.provider)?.models.find(model=>model.id===settings.model):undefined;if(settings.model&&!model)throw new Error('请选择当前可用的模型');if(settings.reasoningEffort&&!model?.reasoning?.efforts.some(effort=>effort.id===settings.reasoningEffort))throw new Error('推理等级不适用于所选模型');if(settings.permissionPreset&&!options.permissions.some(option=>option.value===settings.permissionPreset))throw new Error('权限预设不可用');}return {...await this.engine.execute(request),capabilityVersion:2};}catch(error){if(error instanceof RemoteError)throw error;throw new RemoteError('gateway/bad-request',error instanceof Error?error.message:String(error),{});}
 }
}
