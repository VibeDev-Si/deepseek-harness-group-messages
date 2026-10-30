/** Group eligible sessions by authoritative Workspace membership, retaining unassigned sessions. */
import type {CatalogRow,SessionCatalog,WorkspaceSnapshot} from './ports.ts';
export interface WorkspaceSessionGroup{ id:string;title:string;path:string;rows:CatalogRow[];unassigned:boolean }
const canonical=(path:string)=>path.length>1?path.replace(/[\\/]+$/u,''):path;
export function groupWorkspaceSessions(catalog:SessionCatalog,workspaces:WorkspaceSnapshot,excludedSessionIds:readonly string[]=[]):WorkspaceSessionGroup[]{
 const excluded=new Set([...workspaces.archivedSessionIds,...excludedSessionIds]);
 const rows=catalog.ids.map(id=>catalog.byId[id]).filter((row):row is CatalogRow=>Boolean(row)&&!row.origin?.includes('subagent')&&!row.parentId&&!excluded.has(row.id));
 const byId=new Map(rows.map(row=>[row.id,row]));const claimed=new Set<string>();
 const groups=workspaces.items.map(workspace=>({id:workspace.workspaceId,title:workspace.title,path:workspace.path,rows:[] as CatalogRow[],unassigned:false}));
 workspaces.items.forEach((workspace,index)=>{for(const id of workspace.sessionIds){const row=byId.get(id);if(row&&!claimed.has(id)){groups[index].rows.push(row);claimed.add(id);}}});
 const unassigned:CatalogRow[]=[];
 for(const row of rows){if(claimed.has(row.id))continue;const index=row.cwd?workspaces.items.findIndex(workspace=>canonical(workspace.path)===canonical(row.cwd!)):-1;if(index>=0)groups[index].rows.push(row);else unassigned.push(row);claimed.add(row.id);}
 if(unassigned.length)groups.push({id:'__unassigned__',title:'',path:'',rows:unassigned,unassigned:true});
 return groups;
}
