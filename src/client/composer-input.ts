/** Enter sends; Shift+Enter and input-method confirmation keep editing the message. */
export function shouldSubmitMessage(event:{key:string;shiftKey:boolean;isComposing:boolean;keyCode?:number}):boolean{
 return event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&event.keyCode!==229;
}
/** Quoted/model text stays ordinary text unless the user explicitly chooses a native command. */
export function submissionKind(body:string,chosenCommand:string,forceText:boolean,availableNames:readonly string[]):'prompt'|'command'{
 if(forceText)return 'prompt';
 const name=body.match(/^\/([a-z][\w-]*)(?:\s|$)/)?.[1];
 return chosenCommand&&body.startsWith('/'+chosenCommand)||Boolean(name&&availableNames.includes(name))?'command':'prompt';
}
