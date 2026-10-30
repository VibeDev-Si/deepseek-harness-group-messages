/** Explicit strict Typert descriptors shared by this external plugin's Host and Client. */
import {z} from 'zod';
import {commandSchema,snapshotSchema,memberOptionsSchema} from './core/model.ts';
const codec=(name:string,create:()=>z.ZodType)=>({mode:'strict' as const,typeSymbol:`dsh-session-group#${name}`,create});
function method(name:string,input:z.ZodType,result:z.ZodType=snapshotSchema){const value=codec(name+'Input',()=>input);return {service:'sessionGroups',invocation:{kind:'direct' as const},parameters:[{name:'request',source:'json' as const,codec:value,strictCodec:value}],cancellation:{parameter:'signal' as const},result:codec(name+'Result',()=>result)};}
const methods={options:method('options',z.object({sessionId:z.string().optional()}).strict(),memberOptionsSchema),assetData:method('assetData',z.object({groupId:z.string(),assetId:z.string()}).strict(),z.object({name:z.string(),mediaType:z.string(),data:z.string()})),snapshot:method('snapshot',z.object({}).strict()),watch:method('watch',z.object({revision:z.number().int().nonnegative()}).strict()),execute:method('execute',commandSchema)};
const packageName='dsh-session-group';
// Registry contributions work before the RemoteInfo helper was added in DSH 0.2.1-alpha.3.
export const remoteInfo={package:packageName,descriptors:Object.entries(methods).map(([name,definition])=>({...definition,id:`${packageName}#sessionGroups/${name}`,namespace:'sessionGroups',method:name,parameters:definition.parameters.map(parameter=>({...parameter,wire:parameter.name}))}))};
