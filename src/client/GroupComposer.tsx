/** Raw-text composer with native commands, uploads, IME-safe Enter and per-recipient settings. */
import React,{useEffect,useRef,useState} from 'react';
import type {Asset,Group,MemberOptions,Round} from '../core/model.ts';
import type {ClientPorts} from './ports.ts';
import type {Controller} from './controller.ts';
import {Icon,Avatar,type T} from './SocialChat.tsx';
import {shouldSubmitMessage,submissionKind} from './composer-input.ts';
import {fileSize,isPromptImage,uploadDraftFiles,validateDraftFiles,type DraftFile} from './attachments.ts';
interface Props{group:Group;round:Round;controller:Controller;ports:ClientPorts;t:T;body:string;setBody:React.Dispatch<React.SetStateAction<string>>;selected:string[];setSelected:React.Dispatch<React.SetStateAction<string[]>>;quote:string|null;clearQuote:()=>void;inputRef:React.RefObject<HTMLTextAreaElement>;disabled:boolean;onSettings:(id:string)=>void}
export function GroupComposer({group,round,controller,ports,t,body,setBody,selected,setSelected,quote,clearQuote,inputRef,disabled,onSettings}:Props){
 const [files,setFiles]=useState<DraftFile[]>([]);const [saved,setSaved]=useState<Asset[]>(round.draft?.assets||[]);
 const [mentionTrigger,setMentionTrigger]=useState<{start:number;end:number}|null>(null);const [optionsError,setOptionsError]=useState('');
 const [menu,setMenu]=useState<'add'|'mentions'|'commands'|null>(null);const [options,setOptions]=useState<MemberOptions|null>(null);const [loadingOptions,setLoadingOptions]=useState(false);
 const [forceText,setForceText]=useState(false);const [command,setCommand]=useState(round.draft?.kind==='command'?(round.draft.body.match(/^\/(\S+)/)?.[1]||''):'');
 const [uploading,setUploading]=useState(false);const [progress,setProgress]=useState('');const [menuIndex,setMenuIndex]=useState(0);
 const targetSessionId=group.members.find(member=>member.id===selected[0])?.sessionId;
 const chooser=useRef<HTMLInputElement>(null);const abort=useRef<AbortController|null>(null);const epoch=useRef(0);const sending=useRef(false);const filesRef=useRef(files);
 filesRef.current=files;
 useEffect(()=>{epoch.current++;abort.current?.abort();for(const file of filesRef.current)if(file.preview)URL.revokeObjectURL(file.preview);setFiles([]);setSaved(round.draft?.assets||[]);setCommand(round.draft?.kind==='command'?(round.draft.body.match(/^\/(\S+)/)?.[1]||''):'');setMenu(null);setUploading(false);setProgress('');setForceText(false);sending.current=false;return()=>{abort.current?.abort();for(const file of filesRef.current)if(file.preview)URL.revokeObjectURL(file.preview);};},[round.id,group.id]);
 useEffect(()=>{let active=true;const member=group.members.find(member=>member.id===selected[0]);setOptions(null);setOptionsError('');if(member){setLoadingOptions(true);void controller.options(member.sessionId).then(value=>{if(active)setOptions(value);},error=>{if(active)setOptionsError(error instanceof Error?error.message:String(error));}).finally(()=>{if(active)setLoadingOptions(false);});}return()=>{active=false;};},[targetSessionId,group.id,menu==='commands']);
 useEffect(()=>{if(quote){setCommand('');setForceText(true);setMenu(null);setMentionTrigger(null);}},[quote]);
 const addFiles=(incoming:File[])=>{if(disabled||uploading)return;try{validateDraftFiles([...files.map(item=>item.file),...incoming],saved);setFiles(value=>[...value,...incoming.map(file=>({id:crypto.randomUUID(),file,...(isPromptImage(file.type)?{preview:URL.createObjectURL(file)}:{})}))]);setMenu(null);}catch(error){controller.reportError(error);}};
 const removeFile=(id:string)=>{setFiles(value=>value.filter(item=>{if(item.id!==id)return true;if(item.preview)URL.revokeObjectURL(item.preview);return false;}));setSaved(value=>value.filter(item=>item.id!==id));};
 const pickMention=(id:string|'all')=>{setSelected(value=>id==='all'?group.members.map(member=>member.id):[...new Set([...value,id])]);setBody(value=>mentionTrigger&&value[mentionTrigger.start]==='@'?value.slice(0,mentionTrigger.start)+value.slice(mentionTrigger.end):value);setMentionTrigger(null);setMenu(null);inputRef.current?.focus();};
 const pickCommand=(name:string)=>{setForceText(false);setBody('/'+name+' ');setCommand(name);setMenu(null);inputRef.current?.focus();};
 const submit=async()=>{
  if(disabled||uploading||sending.current||(!body.trim()&&!files.length&&!saved.length))return;
  const commandName=body.match(/^\/([a-z][\w-]*)(?:\s|$)/)?.[1];const native=options?.commands.find(item=>item.name===commandName);
  const kind=submissionKind(body,command,forceText,(options?.commands||[]).map(item=>item.name));
  if(kind==='command'&&!selected.length){controller.reportError(t('chooseCommandTarget'));return;}
  if(kind==='command'&&(files.length||saved.length)&&!(native||options?.commands.find(item=>item.name===command))?.input?.attachments){controller.reportError(t('unsupportedCommandAttachment'));return;}
  const myEpoch=epoch.current;const sender=group.members.find(member=>member.id===selected[0])?.sessionId||ports.sidebarRight.mounted.getSnapshot();
  if(files.length&&!sender){controller.reportError(t('fileUploadTargetMissing'));return;}
  const lifetime=new AbortController();abort.current=lifetime;sending.current=true;setUploading(true);
  try{
   validateDraftFiles(files.map(item=>item.file),saved);
   const uploaded=files.length?await uploadDraftFiles(ports,sender!,files,lifetime.signal,(done,total)=>setProgress(t('uploadingAttachments',{done,total}))):[];
   if(myEpoch!==epoch.current||lifetime.signal.aborted)return;
   await controller.execute({action:'send',commandId:crypto.randomUUID(),groupId:group.id,roundId:round.id,body,memberIds:selected,kind,...(quote?{quoteTaskId:quote}:{}),...([...saved,...uploaded].length?{assets:[...saved,...uploaded]}:{})});
   if(myEpoch!==epoch.current||lifetime.signal.aborted)return;
   setBody('');setSelected([]);clearQuote();setSaved([]);for(const item of files)if(item.preview)URL.revokeObjectURL(item.preview);setFiles([]);setCommand('');setForceText(false);setMenu(null);
  }catch(error){if(!lifetime.signal.aborted)controller.reportError(error);}finally{if(myEpoch===epoch.current){sending.current=false;setUploading(false);setProgress('');}}
 };
 const chooseCommands=()=>{if(!selected.length){controller.reportError(t('chooseCommandTarget'));setMenu('mentions');return;}setMenu('commands');setMenuIndex(0);};
 const mentionQuery=mentionTrigger?body.slice(mentionTrigger.start+1,mentionTrigger.end).toLocaleLowerCase():'';
 const mentionRows=mentionQuery?group.members.filter(member=>member.alias.toLocaleLowerCase().includes(mentionQuery)).map(member=>member.id):['all',...group.members.map(member=>member.id)];
 const commandQuery=body.match(/^\/([^\s]*)$/)?.[1]||'';const commandOptions=(options?.commands||[]).filter(item=>!commandQuery||item.name.startsWith(commandQuery));
 const rows=menu==='mentions'?mentionRows:menu==='commands'?commandOptions.map(item=>item.name):[];
 return <div className="dsg-social-compose" onDragOver={event=>{if(Array.from(event.dataTransfer.types).includes('Files'))event.preventDefault();}} onDrop={event=>{if(event.dataTransfer.files.length){event.preventDefault();addFiles(Array.from(event.dataTransfer.files));}}}>
  {round.status!=='active'&&<p className="dsg-compose-notice">{t(round.status==='paused'?'pausedRound':round.status)}</p>}
  {quote&&<div className="dsg-quote-preview"><span>{t('quoted',{alias:round.tasks.find(task=>task.id===quote)?.alias||''})}</span><button type="button" className="dsg-icon-button" aria-label={t('clearQuote')} onClick={clearQuote}><Icon name="close"/></button></div>}
  {(files.length>0||saved.length>0)&&<div className="dsg-draft-files">{saved.map(asset=><div className="dsg-draft-file" key={asset.id}><Icon name="paperclip"/><span>{asset.name}<small>{fileSize(asset.bytes)}</small></span><button type="button" aria-label={t('removeAttachment')+' '+asset.name} onClick={()=>removeFile(asset.id)}><Icon name="close"/></button></div>)}{files.map(item=><div className={'dsg-draft-file '+(item.preview?'is-image':'')} key={item.id}>{item.preview?<img src={item.preview} alt={item.file.name}/>:<Icon name="paperclip"/>}<span>{item.file.name}<small>{fileSize(item.file.size)}</small></span><button type="button" disabled={uploading} aria-label={t('removeAttachment')+' '+item.file.name} onClick={()=>removeFile(item.id)}><Icon name="close"/></button></div>)}</div>}
  {selected.length>0&&<div className="dsg-recipient-pills">{selected.map(id=>{const member=group.members.find(member=>member.id===id);return <span className="dsg-recipient-pill" key={id}><button type="button" disabled={uploading} onClick={()=>setSelected(value=>value.filter(item=>item!==id))}>@{member?.alias}<span aria-hidden="true">×</span></button><button type="button" className="dsg-recipient-settings" disabled={uploading} title={t('settingsFor',{name:member?.alias||''})} aria-label={t('settingsFor',{name:member?.alias||''})} onClick={()=>onSettings(id)}><Icon name="settings"/></button>{member?.settings?.model&&<small>{member.settings.model}{member.settings.reasoningEffort?' · '+member.settings.reasoningEffort:''}</small>}</span>;})}</div>}
  {command&&<div className="dsg-command-chip"><span>/{command}</span><button type="button" className="dsg-quiet-action" onClick={()=>{setCommand('');setForceText(true);}}>{t('clearCommand')}</button></div>}
  <form className="dsg-message-input" onSubmit={event=>{event.preventDefault();void submit();}}>
   <input ref={chooser} type="file" multiple hidden onChange={event=>{addFiles(Array.from(event.target.files||[]));event.target.value='';}}/>
   <button type="button" className="dsg-attachment-button" aria-label={t('addAttachment')} title={t('attachmentHint')} disabled={disabled||uploading} onClick={()=>{setMenu(menu==='add'?null:'add');setMenuIndex(0);}}>＋</button>
   <button type="button" className="dsg-mention-button" aria-label={t('mention')} disabled={disabled||uploading} onClick={()=>{setMentionTrigger(null);setMenu(menu==='mentions'?null:'mentions');setMenuIndex(0);}}>＠</button>
   <label className="dsg-sr" htmlFor="dsg-message-input">{t('message')}</label>
   <textarea id="dsg-message-input" ref={inputRef} value={body} maxLength={20000} disabled={disabled||uploading} placeholder={t('socialPlaceholder')} rows={1} onPaste={event=>{const incoming=Array.from(event.clipboardData.files);if(incoming.length){event.preventDefault();addFiles(incoming);const text=event.clipboardData.getData('text/plain');if(text)setBody(value=>value+text);}}} onChange={event=>{const value=event.target.value;setBody(value);const token=value.match(/(?:^|\s)@([^\s@]*)$/);if(token){const start=value.lastIndexOf('@');setMentionTrigger({start,end:value.length});setMenu('mentions');setMenuIndex(0);}else if(!forceText&&/^\/[^\s]*$/.test(value)){if(selected.length){setMenu('commands');setMenuIndex(0);}else if(value==='/')chooseCommands();}else if(menu==='commands'||mentionTrigger){setMenu(null);setMentionTrigger(null);}if(command&&!value.startsWith('/'+command))setCommand('');if(!value)setForceText(false);}} onKeyDown={event=>{if(event.nativeEvent.isComposing||event.nativeEvent.keyCode===229)return;if(rows.length&&['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();setMenuIndex(index=>(index+(event.key==='ArrowDown'?1:-1)+rows.length)%rows.length);return;}if(event.key==='Escape'){setMenu(null);return;}if(shouldSubmitMessage({key:event.key,shiftKey:event.shiftKey,isComposing:event.nativeEvent.isComposing,keyCode:event.nativeEvent.keyCode})){event.preventDefault();if(menu==='commands'&&loadingOptions)return;if(rows.length){if(menu==='mentions')pickMention(rows[menuIndex%rows.length]);else pickCommand(rows[menuIndex%rows.length]);}else void submit();}}}/>
   <button className="dsg-send-button" type="submit" aria-label={t('send')} title={t('enterHint')} disabled={disabled||uploading||(!body.trim()&&!files.length&&!saved.length)}><Icon name="send"/></button>
  </form>
  {menu&&<div className="dsg-mentions" role="listbox" aria-label={t(menu==='mentions'?'mention':menu==='commands'?'chooseCommand':'addAttachment')}>
   {menu==='add'?<><button type="button" onClick={()=>chooser.current?.click()}><Icon name="paperclip"/><span>{t('addAttachment')}</span></button><button type="button" onClick={chooseCommands}><Icon name="command"/><span>{t('chooseCommand')}</span></button></>:menu==='mentions'?rows.map((id,index)=>{const member=group.members.find(member=>member.id===id);return <button type="button" key={id} className={index===menuIndex?'is-selected':''} onClick={()=>pickMention(id)}><Avatar name={member?.alias||t('all')} identity={member?.sessionId} group={id==='all'} size="small"/><span>@{member?.alias||t('all')}{member?.settings?.model&&<small>{member.settings.model}</small>}</span></button>;}):loadingOptions?<p className="dsg-small dsg-muted">{t('loadingOptions')}</p>:optionsError?<p className="dsg-error-text">{optionsError}</p>:commandOptions.map((item,index)=><button type="button" key={item.name} className={index===menuIndex?'is-selected':''} onClick={()=>pickCommand(item.name)}><Icon name="command"/><span>/{item.name}<small>{item.description}</small></span></button>)}
   <button type="button" className="dsg-picker-dismiss" onClick={()=>setMenu(null)}>{t('close')}</button>
  </div>}
  <p className="dsg-compose-hint">{uploading?progress||t('pending'):t('enterHint')}{!selected.length?' · '+t('noMention'):''}</p>
 </div>;
}
