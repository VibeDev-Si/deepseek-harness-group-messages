/** Browser files stay local until explicitly sent; the Host stores exact bytes as native attachments. */
import type {Asset} from '../core/model.ts';
import type {ClientPorts} from './ports.ts';
export interface DraftFile{id:string;file:File;preview?:string}
export const isPromptImage=(type:string):boolean=>['image/png','image/jpeg','image/webp','image/gif'].includes(type.toLowerCase());
export function validateDraftFiles(files:Pick<File,'size'>[],existing:Asset[]=[]):void{
 if(files.length+existing.length>8)throw new Error('最多添加 8 个附件');
 if(files.some(file=>file.size>10*1024*1024))throw new Error('每个附件最多 10 MB');
 if(files.reduce((size,file)=>size+file.size,0)+existing.reduce((size,file)=>size+file.bytes,0)>25*1024*1024)throw new Error('附件总大小最多 25 MB');
}
export async function uploadDraftFiles(ports:Pick<ClientPorts,'fileUpload'>,sessionId:string,files:DraftFile[],signal:AbortSignal,onProgress:(completed:number,total:number,loaded:number,size:number)=>void):Promise<Asset[]>{
 validateDraftFiles(files.map(item=>item.file));const assets:Asset[]=[];
 for(const [index,item]of files.entries()){
  signal.throwIfAborted();const result=await ports.fileUpload.upload(sessionId,item.file,item.file.name,signal,progress=>onProgress(index,files.length,progress.loaded,progress.total||item.file.size));
  if(!result.ok)throw result.error;
  const file=result.value.file;
  assets.push({id:item.id,kind:isPromptImage(item.file.type)?'image':'file',name:file.name,bytes:file.bytes,mediaType:item.file.type||'application/octet-stream',sourceSessionId:sessionId,ref:file});
  onProgress(index+1,files.length,file.bytes,file.bytes);
 }
 return assets;
}
export function fileSize(bytes:number):string{return bytes<1024?`${bytes} B`:bytes<1024*1024?`${Math.ceil(bytes/1024)} KB`:`${(bytes/1024/1024).toFixed(1)} MB`;}
export function attachmentBlob(value:{data:string;mediaType:string}):Blob{const binary=atob(value.data);const bytes=Uint8Array.from(binary,character=>character.charCodeAt(0));return new Blob([bytes],{type:value.mediaType});}
export function downloadAttachment(value:{name:string;data:string;mediaType:string}):void{const url=URL.createObjectURL(attachmentBlob(value));const link=document.createElement('a');link.href=url;link.download=value.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
