/** Render model Markdown as React elements; raw HTML and unsafe link schemes never execute. */
import React,{useMemo} from 'react';
import {fromMarkdown} from 'mdast-util-from-markdown';
import {gfmFromMarkdown} from 'mdast-util-gfm';
import {gfm} from 'micromark-extension-gfm';
interface Node{type:string;value?:string;children?:Node[];depth?:number;url?:string;alt?:string;ordered?:boolean;start?:number|null;lang?:string|null;checked?:boolean|null}
const href=(value:string|undefined):string|undefined=>value&&/^(?:https?:|mailto:)/iu.test(value)?value:undefined;
function render(node:Node,key:React.Key):React.ReactNode{
 const children=node.children?.map((child,index)=>render(child,index));
 switch(node.type){
  case 'root':return <React.Fragment key={key}>{children}</React.Fragment>;
  case 'text':return node.value||'';
  case 'paragraph':return <p key={key}>{children}</p>;
  case 'strong':return <strong key={key}>{children}</strong>;
  case 'emphasis':return <em key={key}>{children}</em>;
  case 'delete':return <del key={key}>{children}</del>;
  case 'inlineCode':return <code key={key}>{node.value}</code>;
  case 'code':return <pre key={key}><code>{node.value}</code></pre>;
  case 'heading':return React.createElement('h'+Math.min(6,Math.max(3,node.depth||3)),{key},children);
  case 'list':return node.ordered?<ol key={key} start={node.start||1}>{children}</ol>:<ul key={key}>{children}</ul>;
  case 'listItem':return <li key={key}>{node.checked!==undefined&&node.checked!==null&&<span className="dsg-checkmark" aria-label={String(node.checked)}>{node.checked?'☑':'☐'} </span>}{children}</li>;
  case 'blockquote':return <blockquote key={key}>{children}</blockquote>;
  case 'thematicBreak':return <hr key={key}/>;
  case 'break':return <br key={key}/>;
  case 'link':return href(node.url)?<a key={key} href={href(node.url)} target="_blank" rel="noopener noreferrer">{children}</a>:<span key={key}>{children}</span>;
  case 'image':return <span key={key}>{node.alt||node.url||''}</span>;
  case 'table':return <div className="dsg-table-scroll" key={key}><table><tbody>{children}</tbody></table></div>;
  case 'tableRow':return <tr key={key}>{node.children?.map((child,index)=><td key={index}>{child.children?.map((item,j)=>render(item,j))}</td>)}</tr>;
  case 'html':return <span key={key}>{node.value}</span>;
  default:return <React.Fragment key={key}>{children}</React.Fragment>;
 }
}
export function ChatMarkdown({text}:{text:string}){
 const tree=useMemo(()=>fromMarkdown(text,{extensions:[gfm()],mdastExtensions:[gfmFromMarkdown()]}),[text]);
 return <div className="dsg-markdown">{render(tree as Node,'root')}</div>;
}
