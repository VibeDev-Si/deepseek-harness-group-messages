/** Minimal public Harness faces used by the browser plugin. */
import type React from 'react';
import type {remoteInfo} from '../rpc.ts';
import type {GroupRemote} from './controller.ts';
export interface Observable<T>{getSnapshot():T;subscribe(fn:()=>void):()=>void}
export interface CatalogRow{id:string;displayTitle:string;cwd?:string;origin?:string;parentId?:string;running:boolean}
export interface SessionCatalog{ids:string[];byId:Record<string,CatalogRow>}
export interface WorkspaceView{workspaceId:string;title:string;path:string;sessionIds:readonly string[]}
export interface WorkspaceSnapshot{items:readonly WorkspaceView[];archivedSessionIds:readonly string[];state:'idle'|'loading'|'error';phase:'pending'|'ready'}
export interface ClientPorts{
 fileUpload:{upload(sessionId:string,data:Blob,name?:string,signal?:AbortSignal,onProgress?:(progress:{loaded:number;total?:number})=>void):Promise<import('./controller.ts').RpcResult<{receiptId:string;file:import('../core/model.ts').Asset['ref']}>>};
 remote:{$mount(info:typeof remoteInfo):Promise<()=>void>;sessionGroups:GroupRemote};
 sessions:{list:Observable<SessionCatalog>;refresh():Promise<void>;create(opts?:{cwd?:string;sessionId?:string;workspaceId?:string}):Promise<string>};
 workspaces:{list:Observable<WorkspaceSnapshot>};
 uiWorkspace:{openSession(id:string):void;startSession():void};
 layout:{panelInfo:Observable<{activePanelId:string|null}>};
 sidebarRight:{mounted:Observable<string|undefined>;openTab(kind:string):void};
 sidebarRightTabs:{register(definition:{id:string;kind:string;keepMounted?:boolean;title:(address:string)=>string}):()=>void};
 locale:{register(ns:string,dicts:object):()=>void;bind(ns:string):(key:string,params?:Record<string,unknown>)=>string;subscribe(fn:()=>void):()=>void};
 slots:{inject(name:string,fn:()=>unknown):unknown;register(options:{name:string;id?:string;key?:string;order?:number;locale:string},component:React.ComponentType):unknown};
}
