/** Build an evidence-linked execution record before optional model synthesis. */
import {type Group,type Round,type Task} from './model.ts';
const labels:Record<Task['status'],string>={queued:'排队中',dispatching:'正在派发',running:'运行中',stopping:'停止中',paused:'已暂停',completed:'已完成',cancelled:'已取消',failed:'失败',uncertain:'待确认'};
const clean=(text:string)=>text.replace(/[\r\n]+/g,' ').replace(/([\\`*_{}\[\]<>])/g,'\\$1');
export function buildReport(group:Group,round:Round):string {
 const valid=round.tasks.filter(t=>t.status==='completed'&&!round.messages.find(m=>m.id===t.messageId)?.withdrawnAt);
 const lines=[`# ${clean(group.name)} · 第 ${round.number} 轮协作总结`,'',`目标：${group.goal||'未设置独立目标，以本轮任务指令为准。'}`,'','## 执行结论','',`本轮共 ${round.tasks.length} 项任务，其中 ${valid.length} 项有效交付。任务结束不等于工作区验收通过。`,'','## 成员交付与来源',''];
 if(!valid.length)lines.push('没有可作为结论依据的已完成交付。');
 for(const task of valid){const attempt=task.attempts.at(-1);lines.push(`### ${clean(task.alias)} · ${task.id}`,'',attempt?.output||'任务已结束，但没有返回文本结果。','',`来源：session=${task.sessionId}；attempt=${attempt?.id||'无'}；turn=${attempt?.turns.join(',')||'无'}；seq=${attempt?.eventSeqs.join(',')||'无'}`,'');}
 lines.push('## 未完成、失败与撤回事项','');
 const other=round.tasks.filter(t=>!valid.includes(t));
 if(!other.length)lines.push('本轮没有其他任务。');
 for(const task of other){const withdrawn=round.messages.find(m=>m.id===task.messageId)?.withdrawnAt;lines.push(`- ${clean(task.alias)} / ${task.id}：${labels[task.status]}${withdrawn?'，原指令已撤回':''}${task.error?'；'+clean(task.error):''}。`);}
 lines.push('','## 后续工作','',other.length?'重新确认未完成任务范围，检查已发生的外部操作，再开启下一轮。':'依据原会话事件核对交付，并开展必要的验收。','','> 撤回和取消不会回滚已经执行的文件修改、命令或远程请求。');
 return lines.join('\n');
}
