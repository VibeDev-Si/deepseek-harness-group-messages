/** Browser state follows the Host; drafts and view selection are the only local state. */
import type {Command,Snapshot,MemberOptions} from '../core/model.ts';
export type RpcResult<T>={ok:true;value:T}|{ok:false;error:Error};
export interface GroupRemote {options(request:{sessionId?:string},signal?:AbortSignal):Promise<RpcResult<MemberOptions>>;assetData(request:{groupId:string;assetId:string},signal?:AbortSignal):Promise<RpcResult<{name:string;mediaType:string;data:string}>>;snapshot(request:object,signal?:AbortSignal):Promise<RpcResult<Snapshot>>;watch(request:{revision:number},signal?:AbortSignal):Promise<RpcResult<Snapshot>>;execute(request:Command,signal?:AbortSignal):Promise<RpcResult<Snapshot>>}
export interface ViewState {open:boolean;data:Snapshot|null;error:string|null;busy:boolean;groupId:string|null}
export class Controller {
 private state:ViewState={open:false,data:null,error:null,busy:false,groupId:null};
 private readonly listeners=new Set<()=>void>();
 private readonly life=new AbortController();
 constructor(private readonly remote:GroupRemote){}
 getSnapshot=():ViewState=>this.state;
 subscribe=(listener:()=>void):(()=>void)=>{this.listeners.add(listener);return()=>this.listeners.delete(listener);};
 private update(patch:Partial<ViewState>){this.state={...this.state,...patch};for(const fn of this.listeners)fn();}
 open=()=>this.update({open:true});
 close=()=>this.update({open:false});
 select=(groupId:string)=>this.update({groupId});
 clearError=()=>this.update({error:null});
 reportError=(error:unknown)=>this.update({error:error instanceof Error?error.message:String(error)});
 async options(sessionId?:string):Promise<MemberOptions>{const result=await this.remote.options(sessionId?{sessionId}:{},this.life.signal);if(!result.ok)throw result.error;return result.value;}
 async assetData(groupId:string,assetId:string,signal?:AbortSignal):Promise<{name:string;mediaType:string;data:string}>{const result=await this.remote.assetData({groupId,assetId},signal||this.life.signal);if(!result.ok)throw result.error;return result.value;}
 private accept(data:Snapshot){if(this.state.data&&data.revision<this.state.data.revision)return;const groupId=this.state.groupId&&data.groups.some(g=>g.id===this.state.groupId&&!g.archived)?this.state.groupId:data.groups.find(g=>!g.archived)?.id||null;this.update({data,error:null,groupId});}
 async start():Promise<void>{
  while(!this.life.signal.aborted){try{const result=this.state.data?await this.remote.watch({revision:this.state.data.revision},this.life.signal):await this.remote.snapshot({},this.life.signal);if(!result.ok)throw result.error;this.accept(result.value);}catch(error){if(this.life.signal.aborted)return;this.update({error:error instanceof Error?error.message:String(error)});await new Promise<void>(resolve=>{const timer=setTimeout(done,2000);const abort=()=>done();function done(){clearTimeout(timer);thisAbort.signal.removeEventListener('abort',abort);resolve();}const thisAbort=this.life;thisAbort.signal.addEventListener('abort',abort,{once:true});if(thisAbort.signal.aborted)done();});}}
 }
 async execute(command:Command):Promise<void>{if(this.state.busy)throw new Error('An operation is already being saved');this.update({busy:true,error:null});try{const result=await this.remote.execute(command,this.life.signal);if(!result.ok)throw result.error;this.accept(result.value);}catch(error){this.update({error:error instanceof Error?error.message:String(error)});throw error;}finally{this.update({busy:false});}}
 dispose():void{this.life.abort();this.listeners.clear();}
}
