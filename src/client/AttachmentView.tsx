/** Attachment previews are read from the authenticated Host, never from remote image URLs. */
import React,{useEffect,useRef,useState} from 'react';
import type {Asset} from '../core/model.ts';
import type {Controller} from './controller.ts';
import {attachmentBlob,downloadAttachment,fileSize} from './attachments.ts';
import type {T} from './SocialChat.tsx';
export function AttachmentView({asset,groupId,controller,t}:{asset:Asset;groupId:string;controller:Controller;t:T}){
 const host=useRef<HTMLDivElement>(null);const [url,setUrl]=useState<string|null>(null);const [error,setError]=useState('');const [loading,setLoading]=useState(false);const [expanded,setExpanded]=useState(false);
 useEffect(()=>{
  if(asset.kind!=='image')return;const abort=new AbortController();let preview:string|undefined;
  const load=()=>{if(abort.signal.aborted)return;setLoading(true);void controller.assetData(groupId,asset.id,abort.signal).then(value=>{if(abort.signal.aborted)return;preview=URL.createObjectURL(attachmentBlob(value));setUrl(preview);},reason=>{if(!abort.signal.aborted)setError(reason instanceof Error?reason.message:String(reason));}).finally(()=>{if(!abort.signal.aborted)setLoading(false);});};
  const observer=typeof IntersectionObserver==='undefined'?undefined:new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){observer?.disconnect();load();}});
  if(observer&&host.current)observer.observe(host.current);else load();
  return()=>{abort.abort();observer?.disconnect();if(preview)URL.revokeObjectURL(preview);};
 },[asset.id,groupId]);
 const download=async()=>{setError('');setLoading(true);try{downloadAttachment(await controller.assetData(groupId,asset.id));}catch(reason){setError(reason instanceof Error?reason.message:String(reason));}finally{setLoading(false);}};
 return <div ref={host} className={'dsg-asset '+(asset.kind==='image'?'is-image':'is-file')+(expanded?' is-expanded':'')}>
  {asset.kind==='image'&&url?<button type="button" className="dsg-image-preview" aria-label={asset.name} aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}><img src={url} alt={asset.name} loading="lazy"/></button>:asset.kind==='image'?<span className="dsg-image-placeholder">{t(loading?'loadingAttachment':'imageAttachment')}</span>:<span className="dsg-file-glyph" aria-hidden="true">↳</span>}
  <div className="dsg-asset-caption"><span><strong>{asset.name}</strong><small>{fileSize(asset.bytes)}</small></span><button className="dsg-quiet-action" type="button" disabled={loading} onClick={()=>void download()}>{t('downloadFile')}</button></div>
  {error&&<p className="dsg-asset-error">{error}</p>}
 </div>;
}
