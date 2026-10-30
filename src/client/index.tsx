/** Native sidebar page for coordinating Harness sessions without replacing the main conversation. */
import React,{useEffect,useRef,useState,useSyncExternalStore} from 'react';
import type {Context} from '@deepseek-ai/cordis';
import {remoteInfo} from '../rpc.ts';
import type {Command,Group,Member,Round,Task} from '../core/model.ts';
import {GroupComposer} from './GroupComposer.tsx';
import {MemberSettingsForm} from './MemberSettingsForm.tsx';
import {Controller} from './controller.ts';
import type {ClientPorts,SessionCatalog} from './ports.ts';
import {Avatar,GroupList,MessageFeed,Icon,type ChatView} from './SocialChat.tsx';
import {ChatMarkdown} from './ChatMarkdown.tsx';
import {WorkspaceSessionPicker} from './WorkspaceSessionPicker.tsx';
import {zh,en,type Key} from './locales.ts';
declare const __GROUP_STYLES__:string;
const TAB_KIND='session-groups';
const TAB_ID='@local/dsh-session-groups/panel';
export const inject=['remote','sessions','fileUpload','workspaces','uiWorkspace','layout','sidebarRight','sidebarRightTabs','slots','locale'];
const uuid=()=>crypto.randomUUID();
type DraftCommand=Command extends infer C?C extends Command?Omit<C,'commandId'>:never:never;
type T=(key:Key,params?:Record<string,unknown>)=>string;
type Run=(command:DraftCommand)=>Promise<boolean>;
type Tab='chat'|'tasks'|'members'|'summary';
type Modal={kind:'create'|'members'|'session'|'collaboration'}|{kind:'settings';memberId:string}|{kind:'forward';taskId:string}|{kind:'rewind';messageId:string;roundId:string}|{kind:'withdraw';messageId:string}|{kind:'finish'}|{kind:'retry';taskId:string}|{kind:'remove';memberId:string}|{kind:'archive'};
function GroupsIcon(){return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 4h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/><path d="M18 8h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2l-4-3"/><path d="M6 8h8M6 11h5"/></svg>;}
/** Mount strict RPC first, then use its declared dependent scope for all UI resources. */
export async function apply(ctx:Context):Promise<void>{
 const root=ctx as unknown as ClientPorts;
 ctx.effect(()=>root.locale.register('session-groups',{zh,en}),'session-groups: locales');
 const release=await root.remote.$mount(remoteInfo);
 ctx.effect(()=>release,'session-groups: Remote methods');
 ctx.effect(()=>{const style=document.createElement('style');style.dataset.plugin='@local/dsh-session-groups';style.dataset.pluginCss='session-groups';style.textContent=__GROUP_STYLES__;document.head.append(style);return()=>style.remove();},'session-groups: styles');
 await ctx.inject(['remote.sessionGroups'],activeCtx=>{
  const ports=activeCtx as unknown as ClientPorts;
  const controller=new Controller(ports.remote.sessionGroups);
  const t=ports.locale.bind('session-groups') as T;
  const useLocale=()=>useSyncExternalStore(ports.locale.subscribe.bind(ports.locale),()=>t('title'));
  function Entry({wide}:{wide?:boolean}){
   useLocale();
   const mounted=useSyncExternalStore(ports.sidebarRight.mounted.subscribe.bind(ports.sidebarRight.mounted),ports.sidebarRight.mounted.getSnapshot.bind(ports.sidebarRight.mounted));
   const panel=useSyncExternalStore(ports.layout.panelInfo.subscribe.bind(ports.layout.panelInfo),ports.layout.panelInfo.getSnapshot.bind(ports.layout.panelInfo));
   const [pending,setPending]=useState(false);
   useEffect(()=>{if(pending&&mounted){ports.sidebarRight.openTab(TAB_KIND);setPending(false);}},[pending,mounted]);
   const unavailable=!mounted&&panel.activePanelId!==null;
   return <button type="button" className={'dsg-entry '+(wide===false?'is-compact':'')} title={t(unavailable?'openConversationFirst':'title')} aria-label={t('title')} disabled={unavailable||pending} onClick={()=>{if(mounted)ports.sidebarRight.openTab(TAB_KIND);else{setPending(true);ports.uiWorkspace.startSession();}}}><GroupsIcon/>{wide!==false&&<span>{t('title')}</span>}</button>;
  }
  function Body(){useLocale();return <GroupsView controller={controller} ports={ports} t={t}/>;}
  function Title(){useLocale();return <>{t('title')}</>;}
  activeCtx.effect(()=>ports.sidebarRightTabs.register({id:TAB_ID,kind:TAB_KIND,keepMounted:true,title:()=>t('title')}),'session-groups: sidebar type');
  ports.slots.inject('sidebar.right.pane.tab',()=>ports.slots.register({name:'sidebar.right.pane.tab',key:TAB_ID,locale:'session-groups'},Body));
  ports.slots.inject('sidebar.right.pane.tab.title',()=>ports.slots.register({name:'sidebar.right.pane.tab.title',key:TAB_ID,locale:'session-groups'},Title));
  ports.slots.inject('sidebar.footer.action',()=>ports.slots.register({name:'sidebar.footer.action',id:'session-groups',order:-10,locale:'session-groups'},Entry));
  void controller.start();
  activeCtx.effect(()=>()=>controller.dispose(),'session-groups: browser lifetime');
 });
}
function GroupsView({controller,ports,t}:{controller:Controller;ports:ClientPorts;t:T}){
 const state=useSyncExternalStore(controller.subscribe,controller.getSnapshot);
 const catalog=useSyncExternalStore(ports.sessions.list.subscribe.bind(ports.sessions.list),ports.sessions.list.getSnapshot.bind(ports.sessions.list));
 const input=useRef<HTMLTextAreaElement>(null);const feed=useRef<HTMLDivElement>(null);const atBottom=useRef(true);
 const [view,setView]=useState<ChatView>('chat');const [body,setBody]=useState('');const [selected,setSelected]=useState<string[]>([]);
 const [quote,setQuote]=useState<string|null>(null);const [menu,setMenu]=useState(false);
 const [modal,setModal]=useState<Modal|null>(null);const [viewRoundId,setViewRoundId]=useState<string|null>(null);
 const groups=state.data?.groups.filter(group=>!group.archived)||[];const group=groups.find(group=>group.id===state.groupId);
 const current=group?.rounds.at(-1);const round=group?.rounds.find(round=>round.id===viewRoundId)||current;
 const historical=Boolean(round&&current&&round.id!==current.id);const canManage=state.data?.capabilityVersion===2;
 useEffect(()=>{void ports.sessions.refresh().catch(()=>{});},[]);
 useEffect(()=>{setSelected(current?.draft?.memberIds||[]);setQuote(null);setBody(current?.draft?.body||'');setViewRoundId(null);setView('chat');setModal(null);setMenu(false);atBottom.current=true;},[state.groupId,current?.id]);
 useEffect(()=>{if(feed.current&&atBottom.current)feed.current.scrollTop=feed.current.scrollHeight;},[state.data?.revision,view,round?.id]);
 const run:Run=async action=>{try{await controller.execute({...action,commandId:uuid()} as Command);return true;}catch{return false;}};
 const navigate=(id:string)=>ports.uiWorkspace.openSession(id);
 const openForm=(next:Modal)=>{setMenu(false);setModal(next);};
 const addMention=(id:string)=>{setSelected(value=>[...new Set([...value,id])]);input.current?.focus();};
 const taskAction=(action:'pauseTask'|'resumeTask'|'cancelTask'|'retryTask',task:Task)=>{
  if(action==='retryTask'&&task.status==='uncertain'){openForm({kind:'retry',taskId:task.id});return;}
  void run({action,groupId:group!.id,taskId:task.id});
 };
 const nextRound=()=>void run({action:'newRound',groupId:group!.id}).then(ok=>{if(ok){setViewRoundId(null);setView('chat');}});
 const selectGroup=(id:string)=>{controller.select(id);setView('chat');};
 return <section className="dsg-window dsg-social" aria-label={t('title')} onKeyDown={event=>{if(event.key==='Escape'){setMenu(false);}}}>
  {modal&&<ActionModal modal={modal} group={group} controller={controller} ports={ports} catalog={catalog} t={t} close={()=>setModal(null)} run={run}/>}<div className="dsg-view-host" hidden={Boolean(modal)}>
   {state.data&&!canManage&&<div className="dsg-update-notice" role="status">{t('restartRequired')}</div>}
   {state.error&&<div className="dsg-error" role="alert"><span>{state.error}</span><button className="dsg-text" onClick={controller.clearError}>{t('close')}</button></div>}
   {!state.data?<div className="dsg-empty">{t('loading')}</div>:<div className="dsg-social-shell" data-view={!group?'list':view}>
    <GroupList groups={groups} selectedId={group?.id} t={t} onSelect={selectGroup} onCreate={()=>openForm({kind:'create'})}/>
    {group&&round&&<>
     <main className="dsg-social-center">
      <header className="dsg-chat-header"><button type="button" className="dsg-back-to-list" aria-label={t('allGroups')} onClick={()=>setView('list')}><Icon name="back"/><span>{t('allGroups')}</span></button><button type="button" className="dsg-chat-heading" onClick={()=>setView(view==='details'?'chat':'details')} aria-label={t('groupDetails')}><span className="dsg-avatar-stack">{group.members.slice(0,3).map(member=><Avatar key={member.id} name={member.alias} identity={member.sessionId} size="small"/>)}</span><span><strong>{group.name}</strong><small>{t('memberCount',{count:group.members.length})} · {t('round',{number:round.number})}</small></span></button><div className="dsg-chat-header-actions"><button type="button" className="dsg-icon-button" aria-label={t('groupDetails')} title={t('groupDetails')} onClick={()=>setView(view==='details'?'chat':'details')}><Icon name="info"/></button><button type="button" className="dsg-icon-button" aria-label={t('moreActions')} aria-expanded={menu} onClick={()=>setMenu(!menu)}><Icon name="more"/></button></div>{menu&&<div className="dsg-header-menu"><button type="button" onClick={()=>openForm({kind:'create'})}><Icon name="compose"/>{t('newGroup')}</button><button type="button" onClick={()=>{setMenu(false);setView('summary');}}><Icon name="summary"/>{t('showReport')}</button>{!historical&&['active','paused'].includes(round.status)&&<><button type="button" disabled={state.busy} onClick={()=>{setMenu(false);void run({action:round.status==='paused'?'resumeRound':'pauseRound',groupId:group.id});}}>{t(round.status==='paused'?'resume':'pause')}</button><button type="button" disabled={state.busy} onClick={()=>openForm({kind:'finish'})}>{t('finish')}</button></>}<button type="button" disabled={!canManage} onClick={()=>openForm({kind:'collaboration'})}>{t('peerMessages')}</button><button type="button" onClick={()=>{setMenu(false);setView('details');}}>{t('groupDetails')}</button></div>}</header>
      {view==='summary'?<section className="dsg-social-report"><div className="dsg-sheet-heading"><button className="dsg-text" onClick={()=>setView('chat')}><Icon name="back"/>{t('backToChat')}</button><h3>{t('summary')}</h3></div>{!round.report?<div className="dsg-empty">{t('noSummary')}</div>:<><div className="dsg-report-tools"><span>{t(round.report.kind==='ai'?'reportAi':'reportRecord')}</span><button className="dsg-btn" onClick={()=>download(`${group.name}-round-${round.number}.md`,round.report!.content)}>{t('export')}</button></div>{round.report.error&&<div className="dsg-error">{round.report.error}{!historical&&<button className="dsg-btn" disabled={state.busy} onClick={()=>void run({action:'retrySummary',groupId:group.id})}>{t('retrySummary')}</button>}</div>}<ChatMarkdown text={round.report.content}/></>}</section>:<>
       <div className="dsg-thread-status"><span className={'dsg-round-state '+round.status}>{t(round.status)}</span><label><span className="dsg-sr">{t('roundHistory')}</span><select aria-label={t('roundHistory')} value={round.id} onChange={event=>{setViewRoundId(event.target.value);setSelected([]);setQuote(null);atBottom.current=true;}}>{group.rounds.map(item=><option key={item.id} value={item.id}>{t('round',{number:item.number})}</option>)}</select></label></div>
       <div ref={feed} className="dsg-thread-feed" onScroll={event=>{const element=event.currentTarget;atBottom.current=element.scrollHeight-element.scrollTop-element.clientHeight<80;}}><MessageFeed controller={controller} canManage={canManage} onForward={id=>openForm({kind:'forward',taskId:id})} onRewind={id=>openForm({kind:'rewind',messageId:id,roundId:round.id})} group={group} round={round} historical={historical} t={t} onWithdraw={id=>openForm({kind:'withdraw',messageId:id})} onQuote={id=>{const result=round.tasks.find(task=>task.id===id)?.attempts.at(-1)?.output||'';setQuote(id);setBody(value=>result+'\n\n'+value);input.current?.focus();}} onNavigate={navigate} onMention={addMention}/></div>
       {!historical&&round.status!=='completed'?<GroupComposer group={group} round={round} controller={controller} ports={ports} t={t} body={body} setBody={setBody} selected={selected} setSelected={setSelected} quote={quote} clearQuote={()=>setQuote(null)} inputRef={input} disabled={!canManage||state.busy||round.status!=='active'} onSettings={id=>openForm({kind:'settings',memberId:id})}/>:<footer className="dsg-round-complete"><span>{t(historical?'historyRound':'roundFinished')}</span>{!historical&&<button className="dsg-btn dsg-primary" disabled={state.busy} onClick={nextRound}>{t('nextRound')}</button>}</footer>}
      </>}
     </main>
     <aside className="dsg-social-inspector" aria-label={t('groupDetails')}><header className="dsg-inspector-header"><button className="dsg-icon-button" aria-label={t('backToChat')} onClick={()=>setView('chat')}><Icon name="back"/></button><h3>{t('groupDetails')}</h3></header><div className="dsg-inspector-content"><div className="dsg-group-profile"><Avatar name={group.name} identity={group.id} group size="large"/><h3>{group.name}</h3><p>{t('memberCount',{count:group.members.length})}</p>{group.goal&&<p className="dsg-group-goal">{group.goal}</p>}</div><div className="dsg-detail-section"><div className="dsg-section-head"><strong>{t('members')}</strong><button className="dsg-text" disabled={state.busy||current?.status!=='active'} onClick={()=>openForm({kind:'members'})}>{t('addMember')}</button></div>{group.members.map(member=>{const task=round.tasks.find(task=>task.memberId===member.id&&['running','dispatching','stopping','paused'].includes(task.status));return <div className="dsg-member" key={member.id}><Avatar name={member.alias} identity={member.sessionId}/><div><button className="dsg-member-name" onClick={()=>navigate(member.sessionId)}>{member.alias}</button><p>{task?t(task.status):t('idleMember')}</p></div><button className="dsg-member-configure" disabled={!canManage} aria-label={t('settingsFor',{name:member.alias})} title={t('memberSettings')} onClick={()=>openForm({kind:'settings',memberId:member.id})}><Icon name="settings"/></button><button className="dsg-member-remove" aria-label={t('removeMember')+' '+member.alias} onClick={()=>openForm({kind:'remove',memberId:member.id})}><Icon name="close"/></button></div>;})}<button className="dsg-text dsg-create-member" disabled={current?.status!=='active'} onClick={()=>openForm({kind:'session'})}>＋ {t('createSession')}</button></div><div className="dsg-detail-section dsg-peer-section"><div className="dsg-section-head"><strong>{t('peerMessages')}</strong><button className="dsg-text" disabled={!canManage} onClick={()=>openForm({kind:'collaboration'})}>{t('configure')}</button></div><p>{group.collaboration?.enabled?t('peerBudgetUsed',{used:round.relayCount||0,limit:group.collaboration.maxMessages}):t('peerDisabled')}</p><p className="dsg-small dsg-muted">{t('peerFutureOnly')}</p></div><div className="dsg-detail-section"><TaskList round={round} historical={historical} busy={state.busy} t={t} navigate={navigate} taskAction={taskAction}/></div><button className="dsg-btn dsg-wide" onClick={()=>setView('summary')}><Icon name="summary"/>{t('showReport')}</button><button className="dsg-text dsg-archive" onClick={()=>openForm({kind:'archive'})}>{t('archive')}</button></div></aside>
    </>}
   </div>}
  </div>
 </section>;
}
function TaskList({round,historical,busy,t,navigate,taskAction}:{round:Round;historical:boolean;busy:boolean;t:T;navigate:(id:string)=>void;taskAction:(action:'pauseTask'|'resumeTask'|'cancelTask'|'retryTask',task:Task)=>void}){
 return <div className="dsg-task-page"><div className="dsg-section-head"><strong>{t('tasks')}</strong><span className="dsg-small dsg-muted">{round.tasks.filter(task=>task.status==='completed').length} / {round.tasks.length}</span></div>{!round.tasks.length&&<div className="dsg-empty">{t('emptyTasks')}</div>}{round.tasks.map(task=><div className="dsg-task" key={task.id}><div className="dsg-task-head"><strong>{task.alias}</strong><span className={'dsg-state '+task.status}>{t(task.status)}</span></div><p>{round.messages.find(message=>message.id===task.messageId)?.withdrawnAt?t('withdrawn'):round.messages.find(message=>message.id===task.messageId)?.body.slice(0,160)}</p>{task.status==='queued'&&<p className="dsg-small dsg-muted">{t('sessionBusy')}</p>}{task.error&&<p className="dsg-small dsg-error-text">{task.error}</p>}<div className="dsg-actions"><button className="dsg-text" onClick={()=>navigate(task.sessionId)}>{t('origin')}</button>{!historical&&<>{['queued','running','dispatching'].includes(task.status)&&<button disabled={busy} className="dsg-text" onClick={()=>taskAction('pauseTask',task)}>{t('pause')}</button>}{task.status==='paused'&&<button className="dsg-text" disabled={busy||round.status!=='active'} onClick={()=>taskAction('resumeTask',task)}>{t('resume')}</button>}{['queued','running','dispatching','paused'].includes(task.status)&&<button className="dsg-text" disabled={busy} onClick={()=>taskAction('cancelTask',task)}>{t('cancel')}</button>}{['failed','uncertain'].includes(task.status)&&<button className="dsg-text" disabled={busy||round.status!=='active'} onClick={()=>taskAction('retryTask',task)}>{t('retry')}</button>}</>}</div></div>)}</div>;
}
function ActionModal({modal,group,controller,ports,catalog,t,close,run}:{modal:Modal;group:Group|undefined;controller:Controller;ports:ClientPorts;catalog:SessionCatalog;t:T;close:()=>void;run:Run}){
 const workspaces=useSyncExternalStore(ports.workspaces.list.subscribe.bind(ports.workspaces.list),ports.workspaces.list.getSnapshot.bind(ports.workspaces.list));
 const [name,setName]=useState('');const [goal,setGoal]=useState('');
 const [creatingSession,setCreatingSession]=useState(false);const [newAlias,setNewAlias]=useState('');const [newCwd,setNewCwd]=useState('');const [creatingNative,setCreatingNative]=useState(false);
 const [selected,setSelected]=useState<string[]>([]);const [aliases,setAliases]=useState<Record<string,string>>({});
 const [workspaceId,setWorkspaceId]=useState(()=>workspaces.items.find(workspace=>workspace.path===group?.members[0]?.cwd)?.workspaceId||workspaces.items[0]?.workspaceId||'');
 const [peerEnabled,setPeerEnabled]=useState(group?.collaboration?.enabled||false);const [peerLimit,setPeerLimit]=useState(group?.collaboration?.maxMessages||8);
 const [localError,setLocalError]=useState('');const [saving,setSaving]=useState(false);
 const focus=useRef<HTMLElement>(null);
 useEffect(()=>{focus.current?.querySelector<HTMLElement>('input,button')?.focus();},[]);
 const title:Key=modal.kind==='settings'?'memberSettings':modal.kind==='collaboration'?'peerMessages':modal.kind==='rewind'?'rewindTitle':modal.kind==='forward'?'forward':modal.kind==='create'?'newGroup':modal.kind==='members'?'addMember':modal.kind==='withdraw'?'withdraw':modal.kind==='finish'?'finish':modal.kind==='retry'?'retry':modal.kind==='session'?'createSession':modal.kind==='remove'?'removeMember':'archive';
 const members=():Member[]=>selected.map(sessionId=>({id:uuid(),sessionId,alias:(aliases[sessionId]??catalog.byId[sessionId]?.displayTitle.slice(0,32)??sessionId.slice(0,12)).trim(),cwd:catalog.byId[sessionId]?.cwd||''}));
 const perform:Run=async command=>{const ok=await run(command);if(!ok)setLocalError(controller.getSnapshot().error||t('error'));return ok;};
 const apply=async()=>{
  setLocalError('');setSaving(true);
  try{
   if(modal.kind==='create'){
    if(!name.trim()||!selected.length){setLocalError(t('selectOne'));return;}
    if(await perform({action:'createGroup',name:name.trim(),goal,members:members()})){
     const newest=controller.getSnapshot().data?.groups.at(-1);if(newest)controller.select(newest.id);close();
    }
   }else if(modal.kind==='members'){
    for(const member of members())if(!await perform({action:'addMember',groupId:group!.id,member}))return;
    close();
   }else if(modal.kind==='collaboration'){if(await perform({action:'collaboration',groupId:group!.id,options:{enabled:peerEnabled,maxMessages:peerLimit}}))close();
   }else if(modal.kind==='forward'){if(await perform({action:'forward',groupId:group!.id,taskId:modal.taskId,memberIds:selected}))close();
   }else if(modal.kind==='rewind'){if(await perform({action:'rewind',groupId:group!.id,messageId:modal.messageId,roundId:modal.roundId})){void ports.sessions.refresh();close();}
   }else if(modal.kind==='session'){
    const sessionId=await ports.sessions.create({sessionId:'session-'+uuid(),...(workspaceId?{workspaceId}:{})});
    const workspace=workspaces.items.find(workspace=>workspace.workspaceId===workspaceId);
    if(await perform({action:'addMember',groupId:group!.id,member:{id:uuid(),sessionId,alias:name.trim()||`${t('newSessionAlias')} ${group!.members.length+1}`,cwd:workspace?.path||''}}))close();
   }else{
    let command:DraftCommand;
    if(modal.kind==='withdraw')command={action:'withdraw',groupId:group!.id,messageId:modal.messageId};
    else if(modal.kind==='retry')command={action:'retryTask',groupId:group!.id,taskId:modal.taskId,acknowledgeDuplicateRisk:true};
    else if(modal.kind==='remove')command={action:'removeMember',groupId:group!.id,memberId:modal.memberId};
    else command={action:'archive',groupId:group!.id};
    if(await perform(command))close();
   }
  }catch(error){setLocalError(error instanceof Error?error.message:String(error));}finally{setSaving(false);}
 };
 const createAndSelect=async()=>{setCreatingNative(true);setLocalError('');try{const sessionId=await ports.sessions.create({sessionId:'session-'+uuid(),...(newCwd.trim()?{cwd:newCwd.trim()}:workspaceId?{workspaceId}:{})});await ports.sessions.refresh();setSelected(value=>[...new Set([...value,sessionId])]);setAliases(value=>({...value,[sessionId]:newAlias.trim()||`${t('newSessionAlias')} ${selected.length+1}`}));setNewAlias('');setCreatingSession(false);}catch(error){setLocalError(error instanceof Error?error.message:String(error));}finally{setCreatingNative(false);}};
 const picker=modal.kind==='create'||modal.kind==='members';
 if(modal.kind==='settings')return <section className="dsg-form-page"><header className="dsg-form-head"><button type="button" className="dsg-back" onClick={close} aria-label={t('backToGroup')}>‹</button><h3>{t('memberSettings')}</h3></header><div className="dsg-form-body"><MemberSettingsForm group={group!} memberId={modal.memberId} controller={controller} t={t} onSave={async(settings,ack)=>{const ok=await perform({action:'configureMember',groupId:group!.id,memberId:modal.memberId,settings,permissionAcknowledged:ack});if(ok)close();return ok;}}/>{localError&&<p role="alert" className="dsg-error-text">{localError}</p>}</div></section>;
 return <section ref={focus} className="dsg-form-page" aria-label={t(title)} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}}}>
  <header className="dsg-form-head"><button type="button" className="dsg-back" onClick={close} aria-label={t('backToGroup')}>‹</button><div><h3>{t(title)}</h3>{picker&&<p className="dsg-small dsg-muted">{t('crossWorkspaceSelection')}</p>}</div></header>
  <div className="dsg-form-body">
   {modal.kind==='create'&&<div className="dsg-group-fields"><label>{t('name')}<input value={name} onChange={event=>setName(event.target.value)} maxLength={80} placeholder={t('name')}/></label><label>{t('goal')}<textarea value={goal} onChange={event=>setGoal(event.target.value)} placeholder={t('optionalGoal')} maxLength={4000} rows={2}/></label></div>}
   {picker&&<><div className="dsg-section-head"><strong>{t('chooseSessions')}</strong><div className="dsg-actions"><button type="button" className="dsg-text" disabled={selected.length>=16||creatingNative} onClick={()=>setCreatingSession(!creatingSession)}>＋ {t('createSession')}</button><button type="button" className="dsg-text" onClick={()=>void ports.sessions.refresh()}>{t('refresh')}</button></div></div>{creatingSession&&<div className="dsg-new-session-fields dsg-group-fields"><label>{t('alias')}<input value={newAlias} maxLength={32} onChange={event=>setNewAlias(event.target.value)}/></label><label>{t('workspaces')}<select value={workspaceId} onChange={event=>setWorkspaceId(event.target.value)}>{workspaces.items.map(workspace=><option key={workspace.workspaceId} value={workspace.workspaceId}>{workspace.title}</option>)}</select></label><label>{t('newSessionPath')}<input value={newCwd} onChange={event=>setNewCwd(event.target.value)}/></label><button type="button" className="dsg-btn" disabled={creatingNative} onClick={()=>void createAndSelect()}>{t(creatingNative?'pending':'createAndSelect')}</button></div>}<WorkspaceSessionPicker catalog={catalog} workspaces={workspaces} excluded={modal.kind==='members'?group?.members.map(member=>member.sessionId)||[]:[]} selected={selected} aliases={aliases} limit={modal.kind==='members'?16-(group?.members.length||0):16} onSelected={setSelected} onAlias={(id,alias)=>setAliases(value=>({...value,[id]:alias}))} t={t}/></>}
   {modal.kind==='session'&&<div className="dsg-group-fields"><label>{t('alias')}<input value={name} onChange={event=>setName(event.target.value)} maxLength={32}/></label><label>{t('workspaces')}<select value={workspaceId} onChange={event=>setWorkspaceId(event.target.value)}>{workspaces.items.map(workspace=><option key={workspace.workspaceId} value={workspace.workspaceId}>{workspace.title}</option>)}</select></label></div>}
   {modal.kind==='collaboration'&&<div className="dsg-collaboration-form"><p>{t('peerNote')}</p><label className="dsg-permission-ack"><input type="checkbox" checked={peerEnabled} onChange={event=>setPeerEnabled(event.target.checked)}/><span>{t('peerEnabled')}</span></label><div className="dsg-group-fields"><label>{t('peerBudget')}<input type="number" min={1} max={30} value={peerLimit} onChange={event=>setPeerLimit(Math.max(1,Math.min(30,Number(event.target.value)||1)))}/></label></div><p className="dsg-small dsg-muted">{t('peerReadAccess')}</p><p className="dsg-small dsg-muted">{t('peerFutureOnly')}</p></div>}
   {modal.kind==='forward'&&<><p className="dsg-confirm-copy">{t('forwardNote')}</p><div className="dsg-forward-picker">{group!.members.map(member=><label className="dsg-check" key={member.id}><input type="checkbox" checked={selected.includes(member.id)} onChange={event=>setSelected(ids=>event.target.checked?[...ids,member.id]:ids.filter(id=>id!==member.id))}/><Avatar name={member.alias} identity={member.sessionId}/><span>{member.alias}</span></label>)}</div></>}
   {modal.kind==='rewind'&&<p className="dsg-confirm-copy">{t('rewindNote')}</p>}
   {['withdraw','finish','retry','remove','archive'].includes(modal.kind)&&<p className="dsg-confirm-copy">{t(modal.kind==='withdraw'?'withdrawNotice':modal.kind==='finish'?'finishNotice':modal.kind==='retry'?'uncertainNotice':modal.kind==='remove'?'confirmRemove':'confirmArchive')}</p>}
   {localError&&<p role="alert" className="dsg-error-text">{localError}</p>}
  </div>
  <footer className="dsg-form-footer"><button type="button" className="dsg-btn" disabled={saving} onClick={close}>{t('cancel')}</button>{modal.kind==='finish'?<><button type="button" className="dsg-btn" disabled={saving} onClick={()=>{setSaving(true);void perform({action:'finish',groupId:group!.id,mode:'stop'}).then(ok=>{setSaving(false);if(ok)close();});}}>{t('stopFinish')}</button><button type="button" className="dsg-btn dsg-primary" disabled={saving} onClick={()=>{setSaving(true);void perform({action:'finish',groupId:group!.id,mode:'wait'}).then(ok=>{setSaving(false);if(ok)close();});}}>{t('waitFinish')}</button></>:<button type="button" className="dsg-btn dsg-primary" disabled={saving||((picker||modal.kind==='forward')&&!selected.length)||(modal.kind==='create'&&!name.trim())} onClick={()=>void apply()}>{t(modal.kind==='collaboration'?'savePeerSettings':modal.kind==='rewind'?'confirmRewind':modal.kind==='forward'?'forward':modal.kind==='create'?'create':modal.kind==='withdraw'?'confirmWithdraw':modal.kind==='retry'?'confirmRetry':modal.kind==='members'?'addMember':modal.kind==='session'?'createSessionConfirm':modal.kind==='archive'?'archive':'remove')}</button>}</footer>
 </section>;
}
function download(filename:string,text:string):void{
 const blob=new Blob([text],{type:'text/markdown;charset=utf-8'});const url=URL.createObjectURL(blob);
 const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
