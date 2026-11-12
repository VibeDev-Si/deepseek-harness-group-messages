/** Configure the read-only moderator: mode, step budget and optional planning model. */
import React,{useEffect,useState} from 'react';
import type {Group,MemberOptions,ModeratorConfig} from '../core/model.ts';
import type {Controller} from './controller.ts';
import type {T} from './SocialChat.tsx';
export function ModeratorSettingsForm({group,controller,t,onSave}:{group:Group;controller:Controller;t:T;onSave:(options:ModeratorConfig,acknowledged:boolean)=>Promise<boolean>}){
 const config=group.moderator;const sessionId=group.members[0]?.sessionId;
 const [options,setOptions]=useState<MemberOptions|null>(null);const [error,setError]=useState('');const [saving,setSaving]=useState(false);
 const [enabled,setEnabled]=useState(config?.enabled||false);const [mode,setMode]=useState<'suggest'|'auto'>(config?.mode||'suggest');
 const [maxSteps,setMaxSteps]=useState(config?.maxSteps||6);const [model,setModel]=useState(config?.model?JSON.stringify([config.model.provider,config.model.model]):'');
 const [effort,setEffort]=useState(config?.model?.reasoningEffort||'');const [ack,setAck]=useState(false);
 useEffect(()=>{if(!sessionId)return;let active=true;void controller.options(sessionId).then(value=>{if(active)setOptions(value);},reason=>{if(active)setError(reason instanceof Error?reason.message:String(reason));});return()=>{active=false;};},[sessionId]);
 const modelUnavailable=Boolean(options?.failures?.some(failure=>failure.id==='modelSelection'));
 const pair=model&&!modelUnavailable?JSON.parse(model) as [string,string]:undefined;
 const selected=pair?options?.models.find(provider=>provider.id===pair[0])?.models.find(model=>model.id===pair[1]):undefined;
 const autoRisk=enabled&&mode==='auto'&&config?.mode!=='auto';
 const submit=async()=>{setSaving(true);try{await onSave({enabled,mode,maxSteps,...(pair?{model:{provider:pair[0],model:pair[1],...(effort?{reasoningEffort:effort}:{})}}:{})},ack);}finally{setSaving(false);}};
 return <div className="dsg-member-settings">
  <p className="dsg-setting-note">{t('moderatorNote')}</p>
  <label className="dsg-permission-ack"><input type="checkbox" checked={enabled} onChange={event=>setEnabled(event.target.checked)}/><span>{t('moderatorEnabled')}</span></label>
  {enabled&&<>
   <div className="dsg-group-fields">
    <label>{t('moderatorMode')}<select value={mode} onChange={event=>{setMode(event.target.value as 'suggest'|'auto');setAck(false);}}><option value="suggest">{t('moderatorSuggest')}</option><option value="auto">{t('moderatorAuto')}</option></select></label>
    <label>{t('moderatorMaxSteps')}<input type="number" min={1} max={20} value={maxSteps} onChange={event=>setMaxSteps(Math.max(1,Math.min(20,Number(event.target.value)||1)))}/></label>
    <label>{t('moderatorModel')}<select value={modelUnavailable?'':model} disabled={modelUnavailable} onChange={event=>{setModel(event.target.value);setEffort('');}}><option value="">{t('moderatorModelInherit')}</option>{options?.models.map(provider=><optgroup key={provider.id} label={provider.name}>{provider.models.map(model=><option key={model.id} value={JSON.stringify([provider.id,model.id])}>{model.name}</option>)}</optgroup>)}</select></label>
    {pair&&<label>{t('reasoningEffort')}<select value={effort} disabled={!selected?.reasoning?.efforts.length} onChange={event=>setEffort(event.target.value)}><option value="">{t('modelDefault')}</option>{selected?.reasoning?.efforts.map(value=><option key={value.id} value={value.id}>{value.name}</option>)}</select></label>}
   </div>
   <p className="dsg-small dsg-muted">{t(mode==='auto'?'moderatorAutoNote':'moderatorSuggestNote')}</p>
   {autoRisk&&<label className="dsg-permission-ack"><input type="checkbox" checked={ack} onChange={event=>setAck(event.target.checked)}/><span>{t('moderatorAutoRisk')}</span></label>}
  </>}
  {error&&<p className="dsg-error-text" role="alert">{error}</p>}
  <button type="button" className="dsg-btn dsg-primary dsg-wide" disabled={saving||(autoRisk&&!ack)} onClick={()=>void submit()}>{t(saving?'pending':'saveModeratorSettings')}</button>
  <p className="dsg-small dsg-muted">{t('moderatorReadOnlyNote')}</p>
 </div>;
}