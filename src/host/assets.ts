/** Native attachment storage keeps binary data out of group snapshots and stages fresh receipts per attempt. */
import type {Asset} from '../core/model.ts';
export type FileReceipt={type:'file';receiptId:string};
export type PromptAttachment=FileReceipt|{type:'image';data:string;mediaType:string;name?:string};
export interface AttachmentPorts{
 attachments:{readFileStream(ref:Asset['ref'],signal?:AbortSignal):AsyncIterable<Uint8Array>};
 fileUploads:{uploadStream(request:{sessionId:string;data:AsyncIterable<Uint8Array>;name:string;signal:AbortSignal}):Promise<{receiptId:string}>;uploadImageStream?(request:{sessionId:string;data:AsyncIterable<Uint8Array>;name:string;mediaType:string;signal:AbortSignal}):Promise<{receiptId:string}>};
}
export async function stageAssets(ports:AttachmentPorts,sessionId:string,assets:Asset[],signal:AbortSignal):Promise<PromptAttachment[]>{
 const parts:PromptAttachment[]=[];
 for(const asset of assets){
  signal.throwIfAborted();
  if(asset.kind==='image'&&!ports.fileUploads.uploadImageStream){
   // DSH before 0.2.2 admits images as encoded prompt content, not file receipts.
   const image=await readAsset(ports,asset,signal);signal.throwIfAborted();
   parts.push({type:'image',data:image.data,mediaType:asset.mediaType,name:asset.name});
  }else{
   const request={sessionId,data:ports.attachments.readFileStream(asset.ref,signal),name:asset.name,signal};
   const staged=asset.kind==='image'?await ports.fileUploads.uploadImageStream!({...request,mediaType:asset.mediaType}):await ports.fileUploads.uploadStream(request);
   signal.throwIfAborted();parts.push({type:'file',receiptId:staged.receiptId});
  }
 }
 return parts;
}
export async function readAsset(ports:Pick<AttachmentPorts,'attachments'>,asset:Asset,signal:AbortSignal):Promise<{name:string;mediaType:string;data:string}>{
 const chunks:Buffer[]=[];let size=0;
 for await(const data of ports.attachments.readFileStream(asset.ref,signal)){signal.throwIfAborted();size+=data.byteLength;if(size>10*1024*1024)throw new Error('附件超过读取上限');chunks.push(Buffer.from(data));}
 signal.throwIfAborted();
 return {name:asset.name,mediaType:asset.mediaType,data:Buffer.concat(chunks).toString('base64')};
}
