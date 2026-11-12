/** Live moderator status, human plan approval and bounded auto-mode controls. */
import React,{useEffect,useState} from 'react';
import type {Group,Round,PlanStep} from '../core/model.ts';
import type {T} from './SocialChat.tsx';
const statusKey={idle:'moderatorIdle',planning:'moderatorPlanning',awaiting_approval:'moderatorAwaiting',halted:'moderatorHalted',failed:'moderatorFailed'} as const;
const stepKey={proposed:'stepProposed',approved:'stepApproved',rejected:'stepRejected',dispatched:'stepDispatched'} as const;
export function ModeratorPanel({group,round,historical,busy,t,canModerate,onConfigure,onPlan,onApprove,onReject,onStop}:{group:Group;round:Round;historical:boolean;busy:boolean;t:T;canModerate:boolean;onConfigure:()=>void;onPlan:()=>void;onApprove:(stepIds:string[])=>void;onReject:()=>void;onStop:()=>void}){
 const config=group.moderator;const rm=round.moderator;const plan=rm?.plan;const planId=plan?.id;
 const [selected,setSelected]=useState<string[]>([]);
 useEffect(()=>{setSelected((plan?.steps.filter(step=>step.status==='proposed')||[]).map(step=>step.id));},[planId]);
 if(!config?.enabled)return <div className="dsg-detail-section dsg-moderator-section"><div className="dsg-section-head"><strong>{t('moderator')}</strong><button className="dsg-text" disabled={!canModerate} onClick={onConfigure}>{t('configure')}</button></div><p className="dsg-small dsg-muted">{t('moderatorDisabled')}</p></div>;
 const status=rm?.status||'idle';const awaiting=status==='awaiting_approval'&&Boolean(plan)&&!historical;
 const canPlan=!historical&&round.status==='active'&&['idle','halted','failed'].includes(status);
 const canStop=!historical&&['planning','awaiting_approval'].includes(status)||(config.mode==='auto'&&status==='idle'&&!historical&&round.status==='active');
 const alias=(step:PlanStep)=>group.members.find(member=>member.id===step.to)?.alias||step.to;
 return <div className="dsg-detail-section dsg-moderator-section">
  <div className="dsg-section-head"><strong>{t('moderator')}</strong><button className="dsg-text" disabled={!canModerate} onClick={onConfigure}>{t('configure')}</button></div>
  <p className="dsg-moderator-status"><span className={'dsg-state '+status}>{t(statusKey[status])}</span><span className="dsg-small dsg-muted">{t('moderatorStepsUsed',{used:rm?.steps||0,limit:config.maxSteps})}</span></p>
  {rm?.error&&<p className="dsg-small dsg-error-text">{rm.error}</p>}
  {plan?.rationale&&<p className="dsg-small dsg-muted">{plan.rationale}</p>}
  {plan?.finish&&<p className="dsg-small">{t('moderatorFinish')}</p>}
  {plan&&plan.steps.length>0?<ul className="dsg-plan-steps">{plan.steps.map(step=>{const dep=step.dependsOn?plan.steps.find(item=>item.id===step.dependsOn):undefined;return <li key={step.id} className="dsg-plan-step">
   {awaiting&&step.status==='proposed'?<label className="dsg-check"><input type="checkbox" checked={selected.includes(step.id)} onChange={event=>setSelected(ids=>event.target.checked?[...ids,step.id]:ids.filter(id=>id!==step.id))}/><span>{alias(step)}</span></label>:<strong>{alias(step)}</strong>}
   <p className="dsg-small">{step.instruction}</p>
   {dep&&<p className="dsg-small dsg-muted">{t('moderatorDependsOn',{name:alias(dep)})}</p>}
   {!awaiting&&<span className={'dsg-state '+step.status}>{t(stepKey[step.status])}</span>}
  </li>;})}</ul>:<p className="dsg-small dsg-muted">{t('moderatorNoPlan')}</p>}
  <div className="dsg-actions">
   {awaiting?<><button className="dsg-btn dsg-primary" disabled={busy||!selected.length} onClick={()=>onApprove(selected)}>{t('approvePlan')}</button><button className="dsg-text" disabled={busy} onClick={onReject}>{t('rejectPlan')}</button></>:<>
    {canPlan&&<button className="dsg-text" disabled={busy||!canModerate} onClick={onPlan}>{t(status==='idle'?'planRound':'retry')}</button>}
    {canStop&&<button className="dsg-text" disabled={busy} onClick={onStop}>{t('stopModerator')}</button>}
   </>}
  </div>
 </div>;
}