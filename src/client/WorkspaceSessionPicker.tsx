/** Workspace-filtered session selection with persistent selection across workspace changes. */
import React,{useMemo,useState} from 'react';
import type {SessionCatalog,WorkspaceSnapshot} from './ports.ts';
import {groupWorkspaceSessions} from './workspace-sessions.ts';
import type {Key} from './locales.ts';
type T=(key:Key,params?:Record<string,unknown>)=>string;
export interface WorkspaceSessionPickerProps{
 catalog:SessionCatalog;workspaces:WorkspaceSnapshot;excluded:readonly string[];
 selected:string[];aliases:Record<string,string>;limit:number;
 onSelected:(ids:string[])=>void;onAlias:(id:string,alias:string)=>void;t:T;
}
export function WorkspaceSessionPicker({catalog,workspaces,excluded,selected,aliases,limit,onSelected,onAlias,t}:WorkspaceSessionPickerProps){
 const groups=useMemo(()=>groupWorkspaceSessions(catalog,workspaces,excluded),[catalog,workspaces,excluded]);
 const [active,setActive]=useState<string|null>(null);const [query,setQuery]=useState('');
 const current=groups.find(group=>group.id===active)||groups.find(group=>group.rows.length)||groups[0];
 const needle=query.trim().toLocaleLowerCase();
 const rows=(current?.rows||[]).filter(row=>!needle||[row.displayTitle,row.cwd||'',aliases[row.id]||''].some(value=>value.toLocaleLowerCase().includes(needle)));
 const allSelected=rows.length>0&&rows.every(row=>selected.includes(row.id));
 const remaining=limit-selected.length;const missing=rows.filter(row=>!selected.includes(row.id));
 const toggleAll=()=>onSelected(allSelected?selected.filter(id=>!rows.some(row=>row.id===id)):[...selected,...missing.map(row=>row.id)]);
 const groupName=(group:{unassigned:boolean;title:string})=>group.unassigned?t('unassignedWorkspace'):group.title;
 return <div className="dsg-picker">
  <div className="dsg-picker-head"><label className="dsg-picker-search"><span aria-hidden="true">⌕</span><input aria-label={t('searchSessions')} placeholder={t('searchSessions')} value={query} onChange={event=>setQuery(event.target.value)}/></label><span className="dsg-count">{selected.length}/{limit}</span></div>
  <div className="dsg-picker-body">
   <nav className="dsg-workspaces" aria-label={t('workspaces')}><div className="dsg-small dsg-muted dsg-workspaces-label">{t('workspaces')}</div>{groups.map(group=><button type="button" key={group.id} className={'dsg-workspace '+(current?.id===group.id?'is-selected':'')} title={groupName(group)} onClick={()=>setActive(group.id)} aria-pressed={current?.id===group.id}><span className="dsg-workspace-title">{groupName(group)}</span><span className="dsg-count">{group.rows.length}</span></button>)}</nav>
   <div className="dsg-workspace-sessions">
    <label className="dsg-workspace-select">{t('workspaces')}<select value={current?.id||''} onChange={event=>setActive(event.target.value)}>{groups.map(group=><option key={group.id} value={group.id}>{groupName(group)} ({group.rows.length})</option>)}</select></label>
    {current&&<div className="dsg-picker-scope"><div><strong>{groupName(current)}</strong><span className="dsg-small dsg-muted">{current.path||t('unassignedWorkspaceHint')}</span></div><button type="button" className="dsg-text" disabled={!rows.length||(!allSelected&&missing.length>remaining)} onClick={toggleAll}>{t(allSelected?'deselectWorkspace':'selectWorkspace')}</button></div>}
    {!rows.length&&<div className="dsg-picker-empty">{t(needle?'noMatchingSessions':'noWorkspaceSessions')}</div>}
    <div className="dsg-session-options">{rows.map(row=>{const checked=selected.includes(row.id);return <div className={'dsg-pick '+(checked?'is-selected':'')} key={row.id}><label className="dsg-check"><input type="checkbox" checked={checked} disabled={!checked&&remaining<=0} onChange={event=>onSelected(event.target.checked?[...selected,row.id]:selected.filter(id=>id!==row.id))}/><span><strong>{row.displayTitle}</strong><small>{row.cwd||row.id}</small></span>{row.running&&<span className="dsg-state running">{t('running')}</span>}</label>{checked&&<label className="dsg-alias">{t('alias')}<input maxLength={32} value={aliases[row.id]??row.displayTitle.slice(0,32)} onChange={event=>onAlias(row.id,event.target.value)}/></label>}</div>;})}</div>
   </div>
  </div>
  <div className="dsg-selection"><div className="dsg-selection-heading"><strong>{t('selectedSessions',{count:selected.length})}</strong>{selected.length>0&&<button type="button" className="dsg-text" onClick={()=>onSelected([])}>{t('clearSelection')}</button>}</div>{selected.length?<div className="dsg-selection-chips">{selected.map(id=><button type="button" className="dsg-chip" key={id} onClick={()=>onSelected(selected.filter(value=>value!==id))} aria-label={t('remove')+' '+(aliases[id]||catalog.byId[id]?.displayTitle||id)}>{aliases[id]||catalog.byId[id]?.displayTitle||id}<span aria-hidden="true">×</span></button>)}</div>:<p className="dsg-small dsg-muted">{t('crossWorkspaceSelection')}</p>}{remaining<=0&&<p className="dsg-small dsg-muted">{t('selectionLimit',{count:limit})}</p>}</div>
 </div>;
}
