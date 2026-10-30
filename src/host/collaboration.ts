/** Scoped collaboration tools add routing capabilities without modifying the forwarded user text. */
import {z} from 'zod';
import type {Context} from '@deepseek-ai/cordis';
import type {AgentMessage,ExecutionInput} from '../core/model.ts';
export interface PeerCallbacks{send(message:AgentMessage):Promise<{messageId:string;queued:number;remaining:number}>;read(groupId:string,memberId:string):unknown}
interface Execution{agent?:{id:string};callId:string;signal:AbortSignal}
interface ToolDefinition{name:string;description:string;parameters:Record<string,unknown>;output:{schema:Record<string,unknown>;render(args:unknown,value:unknown):{type:'text';text:string}[]};execute(args:unknown,exec:Execution):Promise<unknown>}
interface ToolRegistry{register(definition:ToolDefinition):()=>void}
const output=(schema:Record<string,unknown>)=>({schema,render:(_args:unknown,value:unknown):{type:'text';text:string}[]=>[{type:'text',text:JSON.stringify(value)}]});
export function bindPeerTools(owner:Context,agentCtx:Context,input:ExecutionInput,callbacks:PeerCallbacks):()=>void{
 const peer=input.peer;if(!peer)return()=>{};
 const tools=agentCtx.get('tools') as ToolRegistry|undefined;if(!tools)throw new Error('当前会话没有工具服务，无法启用成员互聊');
 let active=true;let reads=0;
 const verify=(exec:Execution)=>{if(!active)throw new Error('群内工具已经结束');exec.signal.throwIfAborted();if(exec.agent?.id!==input.sessionId)throw new Error('群内工具的调用者身份不匹配');};
 const recipients=peer.members.filter(member=>member.id!==peer.memberId).map(member=>member.alias);
 const sendSchema=z.object({to:z.array(z.string()).min(1).max(16),message:z.string().min(1).max(20000),attachments:z.array(z.string()).max(8).optional()}).strict();
 const disposers:(()=>void)[]=[];
 try{
  disposers.push(tools.register({name:'group_send',description:`你是群成员「${peer.alias}」。向本群其他会话原文发送一条消息。${peer.senderAlias?'当前任务来自「'+peer.senderAlias+'」。':''}收件人：${recipients.join('、')}。投递返回的是排队回执，不是执行结果；不要等待正在排队的对方。`,parameters:{type:'object',properties:{to:{type:'array',items:{type:'string',enum:recipients},minItems:1,maxItems:16},message:{type:'string',minLength:1,maxLength:20000},attachments:{type:'array',items:{type:'string'},maxItems:8,description:'group_read 返回的本轮附件 ID，可选。'}},required:['to','message'],additionalProperties:false},output:output({type:'object',properties:{messageId:{type:'string'},queued:{type:'integer'},remaining:{type:'integer'}},required:['messageId','queued','remaining'],additionalProperties:false}),async execute(args,exec){verify(exec);const value=sendSchema.parse(args);return callbacks.send({groupId:peer.groupId,roundId:peer.roundId,taskId:peer.taskId,sourceMemberId:peer.memberId,requestId:input.requestId,callId:String(exec.callId),recipients:value.to,text:value.message,...(value.attachments?{assetIds:value.attachments}:{})});}}));
  disposers.push(tools.register({name:'group_read',description:'读取本轮群聊的成员、最近消息和执行结果。此操作不会等待、唤醒或派发其他会话。',parameters:{type:'object',properties:{},additionalProperties:false},output:output({type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false}),async execute(args,exec){verify(exec);if(++reads>8)throw new Error('请结束当前任务，不要轮询；成员回复将作为新消息投递');z.object({}).strict().parse(args);return {text:JSON.stringify(callbacks.read(peer.groupId,peer.memberId))};}}));
 }catch(error){for(const dispose of disposers.reverse())dispose();throw error;}
 const dispose=()=>{active=false;for(const remove of disposers.splice(0).reverse())remove();};
 const owned=owner.effect(()=>dispose,'session-groups: scoped peer tools');
 return()=>{dispose();void owned();};
}
