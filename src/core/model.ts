/** Version-one group records accept additive fields so existing collaboration history remains readable. */
import {z} from 'zod';
const id=z.string().min(1).max(160);
const text=z.string().max(200_000);
export const memberSettingsSchema=z.object({provider:z.string().max(160).optional(),model:z.string().max(200).optional(),reasoningEffort:z.string().max(80).optional(),permissionPreset:z.string().max(100).optional()}).strict().refine(value=>Boolean(value.provider)===Boolean(value.model),'请选择完整的模型');
export const fileRefSchema=z.object({attachmentId:id,name:z.string().max(512),bytes:z.number().int().nonnegative()});
export const assetSchema=z.object({id,kind:z.enum(['image','file']),name:z.string().max(512),bytes:z.number().int().min(0).max(10*1024*1024),mediaType:z.string().max(120),sourceSessionId:id,ref:fileRefSchema}).strict().refine(asset=>asset.bytes===asset.ref.bytes,'附件大小与存储引用不一致').refine(asset=>asset.kind!=='image'||['image/png','image/jpeg','image/webp','image/gif'].includes(asset.mediaType),'图片格式不受支持');
export const assetsSchema=z.array(assetSchema).max(8).refine(items=>items.reduce((n,item)=>n+item.bytes,0)<=25*1024*1024,'附件总大小最多 25 MB');
export const memberSchema=z.object({id,sessionId:id,alias:z.string().trim().min(1).max(32),cwd:z.string().max(4096).default(''),settings:memberSettingsSchema.optional()});
export const collaborationSchema=z.object({enabled:z.boolean(),maxMessages:z.number().int().min(1).max(30)}).strict();
export const statusSchema=z.enum(['queued','dispatching','running','stopping','paused','completed','cancelled','failed','uncertain']);
export const attemptSchema=z.object({id,requestId:id,status:statusSchema,output:text,turns:z.array(z.number().int()),eventSeqs:z.array(z.number().int()),startedAt:z.number(),settings:memberSettingsSchema.optional(),endedAt:z.number().optional(),error:text.optional()});
export const taskSchema=z.object({id,roundId:id,messageId:id,memberId:id,sessionId:id,alias:z.string(),cwd:z.string(),prompt:text,kind:z.enum(['prompt','command']).optional(),assets:assetsSchema.optional(),settings:memberSettingsSchema.optional(),senderMemberId:id.optional(),status:statusSchema,attempts:z.array(attemptSchema),control:z.enum(['pause','cancel']).optional(),error:text.optional(),createdAt:z.number()});
export const messageSchema=z.object({id,roundId:id,author:z.string(),body:text,mentions:z.array(id),quoteTaskId:id.optional(),senderMemberId:id.optional(),relayOfTaskId:id.optional(),kind:z.enum(['prompt','command']).optional(),assets:assetsSchema.optional(),withdrawnAt:z.number().optional(),createdAt:z.number()});
export const reportSchema=z.object({status:z.enum(['generating','completed','failed']),kind:z.enum(['structured','ai']),content:text,sourceRevision:z.number(),createdAt:z.number(),error:text.optional()});
export const draftSchema=z.object({body:text,memberIds:z.array(id),assets:assetsSchema.optional(),kind:z.enum(['prompt','command']).optional()});
export const roundSchema=z.object({id,number:z.number(),status:z.enum(['active','pausing','paused','closing','summarizing','completed']),messages:z.array(messageSchema),tasks:z.array(taskSchema),report:reportSchema.optional(),relayCount:z.number().int().nonnegative().optional(),rewindOf:z.object({roundId:id,messageId:id}).optional(),draft:draftSchema.optional(),createdAt:z.number()});
export const groupSchema=z.object({id,name:z.string().min(1).max(80),goal:z.string().max(4000),archived:z.boolean(),members:z.array(memberSchema),collaboration:collaborationSchema.optional(),rounds:z.array(roundSchema),createdAt:z.number()});
export const snapshotSchema=z.object({formatVersion:z.literal(1),capabilityVersion:z.literal(2).optional(),revision:z.number().int().nonnegative(),groups:z.array(groupSchema),commands:z.array(id)});
export type Member=z.infer<typeof memberSchema>;
export type MemberSettings=z.infer<typeof memberSettingsSchema>;
export type Asset=z.infer<typeof assetSchema>;
export type Task=z.infer<typeof taskSchema>;
export type Attempt=z.infer<typeof attemptSchema>;
export type Round=z.infer<typeof roundSchema>;
export type Group=z.infer<typeof groupSchema>;
export type Snapshot=z.infer<typeof snapshotSchema>;
const base={commandId:id,groupId:id};
export const commandSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('createGroup'),commandId:id,name:z.string().trim().min(1).max(80),goal:z.string().max(4000).default(''),members:z.array(memberSchema).min(1).max(16)}).strict(),
 z.object({...base,action:z.literal('addMember'),member:memberSchema}).strict(),
 z.object({...base,action:z.literal('removeMember'),memberId:id}).strict(),
 z.object({...base,action:z.literal('configureMember'),memberId:id,settings:memberSettingsSchema,permissionAcknowledged:z.boolean().optional()}).strict(),
 z.object({...base,action:z.literal('collaboration'),options:collaborationSchema}).strict(),
 z.object({...base,action:z.literal('send'),roundId:id.optional(),body:z.string().max(20_000),memberIds:z.array(id).max(16),quoteTaskId:id.optional(),assets:assetsSchema.optional(),kind:z.enum(['prompt','command']).optional()}).strict(),
 z.object({...base,action:z.literal('forward'),taskId:id,memberIds:z.array(id).min(1).max(16)}).strict(),
 z.object({...base,action:z.literal('rewind'),messageId:id,roundId:id.optional()}).strict(),
 z.object({...base,action:z.literal('withdraw'),messageId:id}).strict(),
 z.object({...base,action:z.literal('pauseTask'),taskId:id}).strict(),
 z.object({...base,action:z.literal('resumeTask'),taskId:id}).strict(),
 z.object({...base,action:z.literal('cancelTask'),taskId:id}).strict(),
 z.object({...base,action:z.literal('retryTask'),taskId:id,acknowledgeDuplicateRisk:z.boolean().optional()}).strict(),
 z.object({...base,action:z.literal('pauseRound')}).strict(),
 z.object({...base,action:z.literal('resumeRound')}).strict(),
 z.object({...base,action:z.literal('finish'),mode:z.enum(['wait','stop'])}).strict(),
 z.object({...base,action:z.literal('newRound')}).strict(),
 z.object({...base,action:z.literal('archive')}).strict(),
 z.object({...base,action:z.literal('retrySummary')}).strict(),
]);
export type Command=z.infer<typeof commandSchema>;
export const modelSelectionSchema=z.object({provider:z.string(),model:z.string(),reasoningEffort:z.string().optional()});
const modelSchema=z.object({id:z.string(),name:z.string(),description:z.string().optional(),reasoning:z.object({efforts:z.array(z.object({id:z.string(),name:z.string(),description:z.string().optional()})),defaultEffort:z.string().optional()}).optional()});
export const memberOptionsSchema=z.object({models:z.array(z.object({id:z.string(),name:z.string(),models:z.array(modelSchema)})),defaultModel:modelSelectionSchema,currentModel:modelSelectionSchema.optional(),permissions:z.array(z.object({value:z.string(),name:z.string(),description:z.string().optional()})),currentPermission:z.string().optional(),commands:z.array(z.object({name:z.string(),description:z.string(),input:z.object({hint:z.string(),attachments:z.boolean().optional()}).optional()})),failures:z.array(z.object({id:z.string(),message:z.string()})).optional()});
export type MemberOptions=z.infer<typeof memberOptionsSchema>;
export const initialSnapshot=():Snapshot=>({formatVersion:1,revision:0,groups:[],commands:[]});
export const isTerminal=(task:Task):boolean=>['completed','cancelled','failed'].includes(task.status);
export const currentRound=(group:Group):Round=>group.rounds[group.rounds.length-1];
export interface PeerContext{groupId:string;roundId:string;taskId:string;memberId:string;alias:string;senderAlias?:string;members:{id:string;alias:string;sessionId:string}[]}
export interface ExecutionInput{sessionId:string;requestId:string;prompt:string;kind?:'prompt'|'command';assets?:Asset[];settings?:MemberSettings;peer?:PeerContext}
export interface ExecutionResult{status:'completed'|'cancelled'|'failed'|'uncertain';output:string;turns:number[];eventSeqs:number[];error?:string}
export interface AgentMessage{assetIds?:string[];groupId:string;roundId:string;taskId:string;sourceMemberId:string;requestId:string;callId:string;recipients:string[];text:string}
export interface SessionAdapter{
 available(sessionId:string):boolean;
 execute(input:ExecutionInput,signal:AbortSignal,onProgress:(output:string)=>void,onStarted?:()=>void):Promise<ExecutionResult>;
 summarize?(report:string,signal:AbortSignal):Promise<string>;
 forkAt?(sessionId:string,atSeq:number):Promise<string>;
}
export interface Persistence{load():Promise<unknown>;save(snapshot:Snapshot):Promise<void>}
