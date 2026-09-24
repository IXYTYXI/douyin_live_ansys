export const sessions=[{id:'math',teacher:'林老师',course:'分数应用题专项',start:1200,duration:7200,date:'2026 / 09 / 21'},{id:'reading',teacher:'周老师',course:'阅读理解训练',start:1140,duration:6500,date:'2026 / 09 / 22'}];
export const topics=['导入与目标','寻找单位“1”','画图理解题意','互动练习','错题拆解','方法归纳','变式练习','独立解题','重点回顾','答疑互动','综合练习','课堂收尾'];
export function timeLabel(session,seconds,precise=false){const total=Math.floor(session.start*60+(session.startSecond||0)+seconds);const h=String(Math.floor(total/3600)%24).padStart(2,'0'),m=String(Math.floor(total/60)%60).padStart(2,'0'),sec=String(total%60).padStart(2,'0');return `${h}:${m}${precise?':'+sec:''}`;}
export function rangeLabel(s,a,b){return `${timeLabel(s,a)}—${timeLabel(s,b)}`;}
export function selection(session,top,step,index=null){const start=top*1800,end=Math.min(start+1800,session.duration);if(index===null)return [start,end];const a=Math.min(start+index*step,Math.max(start,end-1));return [a,Math.min(a+step,end)];}
export function samples(session,start,end){if(['anchor-review','backend-test','backend-asr'].includes(session.source))return (session.onlineSamples||[]).filter(r=>r.t>=start&&r.t<end);let list=[];for(let t=start;t<end;t+=10){const missing=session.id==='math'&&t>=2520&&t<2580;const v=Math.round(90+t/60*1.05+35*Math.sin(t/350)+12*Math.sin(t/80)+(session.id==='reading'?35:0));list.push({t,value:missing?null:Math.max(20,v)});}return list;}
export function stats(rows){const good=rows.filter(r=>r.value!==null);return {average:good.length?Math.round(good.reduce((n,r)=>n+r.value,0)/good.length):null,max:good.length?Math.max(...good.map(r=>r.value)):null,missing:rows.length-good.length,count:good.length};}
export function transcripts(session,start,end){if(['anchor-review','backend-test','backend-asr'].includes(session.source))return (session.transcriptLines||[]).filter(r=>r.t>=start&&r.t<end);const list=[];for(let t=Math.floor(start/120)*120;t<end;t+=120){if(t<start)continue;const ix=Math.floor(t/600)%topics.length;const prompts=session.id==='math'?['先找一找，这道题中谁是单位“1”？','大家试着画一张线段图，把已知条件标出来。','现在把你的答案打在评论区，说一说为什么。','注意这里的对应关系，我们换一种方法检查。','这一步很关键，先理解，再列式计算。']:['先读这一段，找出作者想表达的核心意思。','圈出关键词，再用自己的话概括。','请在评论区写出你的判断和依据。','我们看看这个答案，哪些信息还可以补充？','回到原文，用句子支持你的观点。'];list.push({t,text:prompts[Math.floor(t/120)%5],topic:session.id==='math'?topics[ix]:['阅读导入','关键词定位','主旨归纳','互动答疑'][ix%4]});}return list;}
export function summary(session,a,b){if(['anchor-review','backend-test','backend-asr'].includes(session.source))return {theme:'',keywords:[],body:''};const rows=samples(session,a,b),st=stats(rows),text=transcripts(session,a,b),names=[...new Set(text.map(t=>t.topic))];return {theme:periodTheme(session,text),keywords:session.id==='math'?'单位“1”、线段图、对应关系':'关键词、中心句、原文依据',body:`本时段围绕${names.join('、')}展开，通过讲解和提问推进练习。有效采样点均值 ${st.average??'未获取'} 人，采样最大值 ${st.max??'未获取'} 人。${st.missing?'存在采样缺失，需结合录像核对。':'可结合互动片段进一步复盘。'}人数变化仅作观察，不据此判断教学效果。`};}
export function draftKey(id,a,b){return `${id}:${a}:${b}`;}

export function limitTheme(value){return Array.from(typeof value==='string'?value:'').slice(0,16).join('');}
export function periodTheme(session,lines){
 if(!lines.length)return '本时段暂无转写内容';
 const counts=new Map();for(const line of lines)counts.set(line.topic,(counts.get(line.topic)||0)+1);
 const dominant=[...counts].sort((a,b)=>b[1]-a[1])[0][0];
 // Deterministic mock only: production generation must use time-aligned metrics and ASR text.
 return limitTheme(`${session.id==='math'?'分数应用题':'阅读理解'}：${dominant}`);
}
