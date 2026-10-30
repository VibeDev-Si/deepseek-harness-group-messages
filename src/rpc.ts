/** Explicit strict Typert descriptors shared by this external plugin's Host and Client. */
import {z} from 'zod';
import {createTypertRemoteInfo} from '@deepseek-ai/dsh-typert-protocol/remote-info';
import {commandSchema,snapshotSchema,memberOptionsSchema} from './core/model.ts';
const codec=(name:string,create:()=>z.ZodType)=>({mode:'strict' as const,typeSymbol:`@local/dsh-session-groups#${name}`,create});
function method(name:string,input:z.ZodType,result:z.ZodType=snapshotSchema){const value=codec(name+'Input',()=>input);return {service:'sessionGroups',invocation:{kind:'direct' as const},parameters:[{name:'request',source:'json' as const,codec:value,strictCodec:value}],cancellation:{parameter:'signal' as const},result:codec(name+'Result',()=>result)};}
export const remoteInfo=createTypertRemoteInfo({package:'@local/dsh-session-groups',methods:{'sessionGroups/options':method('options',z.object({sessionId:z.string().optional()}).strict(),memberOptionsSchema),'sessionGroups/assetData':method('assetData',z.object({groupId:z.string(),assetId:z.string()}).strict(),z.object({name:z.string(),mediaType:z.string(),data:z.string()})),'sessionGroups/snapshot':method('snapshot',z.object({}).strict()),'sessionGroups/watch':method('watch',z.object({revision:z.number().int().nonnegative()}).strict()),'sessionGroups/execute':method('execute',commandSchema)}},z);
