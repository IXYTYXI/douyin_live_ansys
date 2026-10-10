import {audioHealthMessage,createAudioAlertTracker} from './audio-health.mjs';
import {metrics,metricDefinition,metricRows,axisMaximum,metricReading} from './metric-chart.mjs';
import {noteFields} from './save-fields.mjs';
import {printReview} from './print.mjs';
import {loadTestSession,loadSession,loadSessions,recordingAt,nextRecording,syncRecordingSource} from './remote.mjs';
import {anchorSession} from './anchor-fixture.mjs';
import {normalizeTags,mountTags} from './tags.mjs';
import {sessions,timeLabel,rangeLabel,selection,samples,stats,transcripts,summary,draftKey,limitTheme} from './model.mjs';
const query=new URLSearchParams(location.search),hosted=document.querySelector('meta[name=diting-mode]')?.content==='real',testMode=query.get('test')==='1',formal=hosted&&!testMode;
let selectedMetric='online';
let apiSession=null,apiError=null,sessionList=[],selectionEpoch=0,refreshing=false;
if(formal){sessions.splice(0);try{const listing=await loadSessions();sessionList=listing.sessions;const id=query.get('session')||listing.defaultSession||sessionList[0]?.id;if(id){apiSession=await loadSession(id);sessions.push(apiSession);}}catch(e){apiError=e.message;}}
else if(testMode){try{apiSession=await loadTestSession();if(apiSession.realRecording)sessions.splice(0);sessions.push(apiSession);}catch(e){apiError=e.message;}}
if(anchorSession&&!formal)sessions.push(anchorSession);
// An empty real page must never fall back to simulated numbers or words.
if(!sessions.length)sessions.push({id:'empty',teacher:'暂无直播',course:'等待采集',source:'live-review',start:0,date:'',duration:1,realRecording:true,onlineSamples:[],transcriptLines:[]});
const $=id=>document.getElementById(id);let si=(apiSession||anchorSession)?sessions.length-1:0,top=0,step=600,index=null,cursor=0,playing=false,scope='range',drafts={},storageOK=true,lastTick=0;
try{const stored=JSON.parse(localStorage.getItem('diting-demo-reviews-v1')||'{}');if(stored&&typeof stored==='object'&&!Array.isArray(stored))drafts=stored;}catch{storageOK=false;}
const dirtyKeys=new Set();
const audioAlerts=createAudioAlertTracker(()=>localStorage),audioDialog=$('audio-alert');
let audioDialogSession=null;
function noteRecordKey(r,s){return r.scope==='session'?`${s.id}:whole`:draftKey(s.id,r.start,r.end);}
function hydrateNotes(s=apiSession){for(const r of s?.notes||[]){const k=noteRecordKey(r,s);if(!dirtyKeys.has(k))drafts[k]={...r.fields,version:r.version,savedAt:r.savedAt};}}
if(apiSession?.databaseReviews){for(const k of Object.keys(drafts))if(k.startsWith(apiSession.id+':'))delete drafts[k];hydrateNotes();}
const tagValues={keywords:[]};
// Keep the native select as the single selection value; render a consistent popup over it.
const sessionPicker=document.createElement('div');sessionPicker.className='session-picker';
const sessionToggle=document.createElement('button');sessionToggle.type='button';sessionToggle.className='session-toggle';sessionToggle.id='session-toggle';sessionToggle.setAttribute('aria-haspopup','listbox');sessionToggle.setAttribute('aria-expanded','false');sessionToggle.setAttribute('aria-controls','session-menu');
const sessionMenu=document.createElement('div');sessionMenu.id='session-menu';sessionMenu.className='session-menu';sessionMenu.setAttribute('role','listbox');sessionMenu.setAttribute('aria-label','选择直播场次');sessionMenu.hidden=true;
$('session').hidden=true;$('session').before(sessionPicker);sessionPicker.append(sessionToggle,sessionMenu);document.querySelector('label[for="session"]').htmlFor='session-toggle';
function closeSessionMenu(focus=false){sessionMenu.hidden=true;sessionToggle.setAttribute('aria-expanded','false');if(focus)sessionToggle.focus();}
function openSessionMenu(){if($('session').disabled)return;sessionOptions();sessionMenu.hidden=false;sessionToggle.setAttribute('aria-expanded','true');(sessionMenu.querySelector('[aria-selected="true"]')||sessionMenu.firstElementChild)?.focus();}
sessionToggle.onclick=()=>sessionMenu.hidden?openSessionMenu():closeSessionMenu();
sessionToggle.onkeydown=e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();openSessionMenu();}};
sessionMenu.onkeydown=e=>{const items=[...sessionMenu.children],i=items.indexOf(document.activeElement);let next;
 if(e.key==='Escape'){e.preventDefault();closeSessionMenu(true);return;}
 if(e.key==='ArrowDown')next=Math.min(i+1,items.length-1);if(e.key==='ArrowUp')next=Math.max(0,i-1);if(e.key==='Home')next=0;if(e.key==='End')next=items.length-1;
 if(next!==undefined){e.preventDefault();items[next]?.focus();}
};
document.addEventListener('click',e=>{if(!sessionPicker.contains(e.target))closeSessionMenu();});
sessionPicker.addEventListener('focusout',e=>{if(!sessionPicker.contains(e.relatedTarget))closeSessionMenu();});
function sessionOptions(){
 const rows=formal?sessionList:sessions;
 $('session').replaceChildren(...rows.map((s,i)=>{const o=document.createElement('option');o.value=formal?s.id:i;o.textContent=s.teacher;return o;}));
 $('session').value=formal?(apiSession?.sessionId||''):si;
 // Polling must not replace the focused menu while the user is choosing.
 sessionToggle.disabled=$('session').disabled;
 if(!sessionMenu.hidden)return;
 sessionMenu.replaceChildren(...rows.map((s,i)=>{
  const value=String(formal?s.id:i),chosen=value===$('session').value;
  const date=formal?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(s.startedAt)):s.course;
  const status=formal?(s.live?'直播中':'回放'):(s.source==='backend-test'?'模拟联调':s.source?'测试':'模拟');
  const item=document.createElement('button');item.type='button';item.className='session-option';item.setAttribute('role','option');item.setAttribute('aria-selected',String(chosen));item.tabIndex=-1;item.title=s.teacher+' · '+date+' · '+status;
  const name=document.createElement('span');name.className='session-option-name';name.textContent=s.teacher;
  const meta=document.createElement('span');meta.className='session-option-meta';meta.textContent=date+' · '+status;
  item.append(name,meta);item.onclick=()=>{if($('session').disabled)return;closeSessionMenu(true);$('session').value=value;$('session').dispatchEvent(new Event('change',{bubbles:true}));sessionToggle.disabled=$('session').disabled;sessionToggle.textContent=s.teacher;sessionToggle.title=item.title;};
  if(chosen){sessionToggle.textContent=s.teacher;sessionToggle.title=item.title;}
  return item;
 }));
 if(!rows.length)sessionToggle.textContent='暂无直播';
}

sessionOptions();
if(hosted){const link=document.createElement('a');link.href='/live-setup';link.textContent='OBS 直播接入';link.className='muted';document.querySelector('.page-title').append(link);}
const session=()=>sessions[si],bounds=()=>selection(session(),top,step,index),key=()=>draftKey(session().id,...bounds()),noteKey=()=>scope==='range'?key():`${session().id}:whole`;
function store(){try{localStorage.setItem('diting-demo-reviews-v1',JSON.stringify(drafts));storageOK=true;return true;}catch{storageOK=false;$('save-status').textContent='浏览器存储不可用，内容仅暂存本页';return false;}}
function persist(){const k=key(),n=noteKey();if(session().databaseReviews&&!dirtyKeys.has(k)&&!dirtyKeys.has(n))return;drafts[k]={...drafts[k],periodTheme:limitTheme($('theme').value),keywords:[...tagValues.keywords]};drafts[n]={...drafts[n],conclusion:$('conclusion').value,adjustment:$('adjustment').value};store();}
function edits(){const [a,b]=bounds();const generated=summary(session(),a,b);const value={...generated,...drafts[key()],theme:generated.theme};$('theme').value=typeof value.periodTheme==='string'?limitTheme(value.periodTheme):value.theme;updateThemeCount();for(const id of ['keywords']){tagValues[id]=normalizeTags(value[id]);mountTags($(id),tagValues[id],values=>{tagValues[id]=values;dirtyKeys.add(key());persist();$('save-status').textContent=storageOK?'标签已暂存 · 点击保存确认复盘':'浏览器存储不可用，标签仅暂存本页';});}const n=drafts[noteKey()]||{};const operational=scope==='session'?summary(session(),0,session().duration):generated;$('conclusion').value=n.conclusion??((session().combinedTest||session().databaseReviews)?operational.body:'');$('adjustment').value=n.adjustment??((session().combinedTest||session().databaseReviews)?operational.adjustment:'');$('draft-status').textContent=scope==='range'?rangeLabel(session(),a,b):'整场结论';$('save-status').textContent=!storageOK?'浏览器存储不可用':n.savedAt?`已保存 · ${new Date(n.savedAt).toLocaleTimeString('zh-CN')}`:(session().databaseReviews?'尚未保存到数据库':'仅保存在当前浏览器');if(session().databaseReviews)$('save-status').textContent=dirtyKeys.has(noteKey())||dirtyKeys.has(key())?'有未保存修改':n.savedAt?'已保存到数据库 · '+new Date(n.savedAt).toLocaleTimeString('zh-CN'):'尚未保存到数据库';$('scope-range').setAttribute('aria-pressed',scope==='range');$('scope-session').setAttribute('aria-pressed',scope==='session');}
function tabs(){const s=session();$('session-meta').textContent=`${s.date}　${rangeLabel(s,0,s.duration)}`;$('top-tabs').replaceChildren();for(let i=0;i<Math.ceil(s.duration/1800);i++){const b=document.createElement('button');b.textContent=rangeLabel(s,i*1800,Math.min((i+1)*1800,s.duration));b.setAttribute('aria-selected',i===top);b.onclick=()=>change(()=>{top=i;index=null;cursor=i*1800});$('top-tabs').append(b);}}
function change(fn){persist();playing=false;testAudio.pause();fn();render();}
function render(){renderCollectionStatus();const s=session(),[a,b]=bounds();const real=['anchor-review','backend-test','backend-asr','live-review'].includes(s.source),remote=s.source==='backend-test';$('source-note').textContent=real?'主播后台真实快照 · 转写仅已加载片段 · 视频与实时采集未接入':'模拟数据测试 · 视频与文字均为演示';$('transcript-source').textContent=real?'平台原文 · 部分加载':'模拟文字 · 点击定位';$('video-note').textContent=real?'尚未接入本场录像':'模拟录屏回放';$('play').disabled=real&&!s.combinedTest;$('speed').disabled=real&&!s.combinedTest;$('theme').placeholder=real?'尚未生成，可手动填写':'';$('page-footer').textContent=real?'独立测试数据 · 复盘仅保存在当前浏览器':'全部为模拟数据 · 复盘仅保存在当前浏览器';$('session-aggregate').hidden=!s.aggregate;if(real&&s.aggregate){const m=s.aggregate;$('session-aggregate').textContent=`整场数据：平均在线 ${m.averageOnline} 人 · 最高 ${m.maximumOnline} 人 · 曝光约 ${m.exposureDisplay} · 进房 ${m.entries} 人 · 进房率 ${m.entryRatePercent}% · 人均停留 ${m.averageStayMinutes} 分钟 · 评论 ${m.commentUsers} 人 · 点赞 ${m.likes} 次 · 新增粉丝 ${m.newFollowers} 人 · 分享 ${m.shares} 次 · 加粉丝团 ${m.fanClubJoins} 人`;}cursor=Math.max(a,Math.min(cursor,b));tabs();$('chart-range').textContent=rangeLabel(s,a,b);
const end=Math.min((top+1)*1800,s.duration),num=Math.ceil((end-top*1800)/step);$('segment-slider').min=top*1800;$('segment-slider').max=end;$('segment-slider').step=1;$('segment-slider').value=cursor;$('segment-slider').setAttribute('aria-valuetext',index===null?'当前查看完整区间，拖动选择片段':rangeLabel(s,a,b));$('segment-buttons').replaceChildren();for(let i=0;i<num;i++){const button=document.createElement('button');const r=selection(s,top,step,i);button.textContent=rangeLabel(s,...r);button.setAttribute('aria-pressed',index===i);button.onclick=()=>change(()=>{index=i;cursor=r[0]});$('segment-buttons').append(button);}

const values=samples(s,a,b),st=stats(values);$('average').innerHTML=`${st.average??'—'}<small>人</small>`;$('maximum').innerHTML=`${st.max??'—'}<small>人</small>`;$('sample-count').innerHTML=`${st.count}<small>/ ${values.length} 点</small>`;$('chart-status').textContent=st.missing?`缺失 ${st.missing} 点 · 图中留空`:'每 10 秒采样 · 数据完整（模拟）';renderMetricChart();
$('transcript').replaceChildren();for(const line of transcripts(s,a,b)){const button=document.createElement('button');button.dataset.t=line.t;const tm=document.createElement('time');tm.textContent=timeLabel(s,line.t,real);const tx=document.createElement('span');tx.textContent=`${line.synthetic?'[模拟] ':''}${s.teacher}：${line.text}`;button.append(tm,tx);button.onclick=()=>{testAudio.pause();cursor=line.t;playing=false;updateCursor();};$('transcript').append(button);}if(real){const note=document.createElement('p');note.className='muted';note.textContent=transcripts(s,a,b).length?'仅已加载 10:33:15—10:38:36 的 18 条记录，未覆盖完整时段':'本时段文字尚未加载';$('transcript').append(note);}edits();updateCursor();if(remote){$('source-note').textContent='模拟联调 · 数据从后端 PostgreSQL 读取';$('transcript-source').textContent='尚未接入 ASR';$('chart-status').textContent='模拟上传数据 · 每10秒采样';$('page-footer').textContent='独立模拟场次 · 曲线来自数据库 · 运营复盘仍存本浏览器';}if(s.source==='backend-asr'||s.source==='live-review'){$('source-note').textContent='真实ASR联调 · 淘宝录音样本 · 文字从PostgreSQL读取';$('transcript-source').textContent=s.processing?'ASR处理中':(s.transcriptLines.some(r=>r.end!==undefined)?'公司ASR转写 · 逐句时间':'公司ASR转写 · 音频块时间');$('transcript').querySelector('p.muted')?.remove();$('chart-status').textContent='未关联在线人数采样';$('page-footer').textContent='独立ASR测试 · 非本场直播数据';}if(s.combinedTest){$('transcript-source').textContent='前45秒真实，其余逐行标注模拟';$('video-note').textContent='测试时间轴演示 · 非视频';$('source-note').textContent='组合联调 · 前45秒真实转写 · 其余文字与人数为模拟 · 完整30分钟联调';$('chart-status').textContent='之前的模拟人数 · 每10秒采样';$('page-footer').textContent='主题/关键词/运营建议为规则生成测试稿 · 非正式AI分析 · 原始数据未改动';}if(s.realRecording){$('source-note').textContent='真实录制联调 · 人数按采集时间对齐 · 以录制开始为零点';$('chart-status').textContent='插件真实人数 · 每10秒采样 · 缺失不补造';$('page-footer').textContent='真实录像与公司ASR转写 · 自动总结尚未生成 · 运营填写仅存本浏览器';$('play').hidden=true;$('video-note').textContent='真实录像 · 使用播放器控制';}else{$('play').hidden=false;}if(s.databaseReviews){$('page-footer').textContent='AI总结与人工复盘分开存储 · 点击保存复盘写入数据库';const status=s.summaries?.find(r=>Math.abs(r.start-a)<.001&&Math.abs(r.end-b)<.001)?.status;$('theme').placeholder=!s.summaryConfigured?'等待配置总结模型':status==='failed'?'总结生成失败，待重试':status==='done'?'':'总结生成中';}if(s.source==='live-review'){$('source-note').textContent=s.live?'直播中 · 已完成录像片段持续更新':'直播回放 · 录像、转写与人数按本场时间对齐';$('transcript-source').textContent=s.processing?'ASR处理中 · 已完成文字持续更新':'本场真实转写';}if(apiError)$('source-note').textContent='联调读取失败：'+apiError;updateMetricStatus();}
function updateMetricStatus(){
 const s=session(),real=['anchor-review','backend-test','backend-asr','live-review'].includes(s.source);
 $('chart-status').textContent=selectedMetric==='online'?(s.combinedTest||s.source==='backend-test'||!real?'模拟人数 · 每10秒采样':'平台在线人数 · 每10秒采样 · 缺失不补造'):'平台当时值 · 保留原始统计口径 · 缺失不补造';
}
function renderMetricChart(){
 const [a,b]=bounds(),definition=metricDefinition(selectedMetric),rows=metricRows(session(),a,b,selectedMetric);
 $('chart-title').textContent=definition.label+'曲线';$('chart').setAttribute('aria-label',definition.label+'曲线');
 // Keep buttons stable during polling so keyboard focus is preserved.
 if(!$('metric-choices').children.length)for(const metric of metrics){
  const button=document.createElement('button');button.type='button';button.textContent=metric.label;button.dataset.metric=metric.key;
  button.onclick=()=>{selectedMetric=metric.key;renderMetricChart();updateCursor();};$('metric-choices').append(button);
 }
 for(const button of $('metric-choices').children)button.setAttribute('aria-pressed',String(button.dataset.metric===selectedMetric));
 if(rows.some(r=>r.value!==null)){renderChart(rows,a,b);$('hover-readout').textContent='点击曲线定位回放';}
 else{const empty=document.createElement('p');empty.className='chart-empty';empty.textContent='本时段暂无'+definition.label+'采样';$('chart').replaceChildren(empty);$('hover-readout').textContent='';}
 updateMetricStatus();
}
function renderChart(rows,a,b){const W=600,H=175,left=35,right=585,t=14,base=145;const max=axisMaximum(rows,selectedMetric),x=v=>left+(v-a)/(b-a)*(right-left),y=v=>base-v/max*(base-t);let lines='',active=false;for(const r of rows){if(r.value===null){active=false;continue;}lines+=`${active?'L':'M'}${x(r.t).toFixed(1)},${y(r.value).toFixed(1)} `;active=true;}
const grids=[0,.5,1].map(f=>`<line x1="${left}" x2="${right}" y1="${y(max*f)}" y2="${y(max*f)}" stroke="#e9eef6" stroke-dasharray="3 4"/><text x="25" y="${y(max*f)+4}" text-anchor="end" fill="#93a0b5" font-size="15">${max*f}</text>`).join('');
$('chart').innerHTML=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${rangeLabel(session(),a,b)}的${metricDefinition(selectedMetric).label}，点击可定位回放">${grids}<path d="${lines}" fill="none" stroke="#456aeb" stroke-width="2.6" stroke-linecap="round"/><line id="chart-cursor" x1="35" x2="35" y1="8" y2="145" stroke="#94a8ca" stroke-opacity="0.65" stroke-width="1" stroke-dasharray="3 5" pointer-events="none"/><circle id="chart-position-dot" r="4" fill="#456aeb" stroke="white" stroke-width="2" pointer-events="none" visibility="hidden"/>${[a,(a+b)/2,b].map((v,i)=>`<text x="${x(v)}" y="169" text-anchor="${i===0?'start':i===2?'end':'middle'}" fill="#93a0b5" font-size="16">${timeLabel(session(),v)}</text>`).join('')}</svg>`;
const svg=$('chart').firstChild;const locate=e=>{const rect=svg.getBoundingClientRect(),local=(e.clientX-rect.left)/rect.width*W;return Math.max(a,Math.min(b,Math.round((a+(local-left)/(right-left)*(b-a))/10)*10));};svg.onmousemove=e=>{const v=locate(e);$('hover-readout').textContent=`${timeLabel(session(),v)} · ${metricReading(rows,v,selectedMetric)}`;};svg.onmouseleave=()=>{$('hover-readout').textContent='点击曲线定位回放';};svg.onclick=e=>{testAudio.pause();cursor=locate(e);playing=false;updateCursor();};}
function updateCursor(){const [a,b]=bounds(),s=session();$('play').textContent=playing?'Ⅱ':'▶';$('play').setAttribute('aria-label',s.source==='anchor-review'?'尚未接入本场录像':s.combinedTest?(playing?'暂停测试时间轴':'播放测试时间轴'):playing?'暂停模拟录像':'播放模拟录像');$('play-time').textContent=timeLabel(s,cursor,s.source==='anchor-review');$('play-end').textContent=`/ ${timeLabel(s,b)}`;$('lesson-time').textContent=timeLabel(s,cursor);$('lesson-teacher').textContent=`${s.teacher} · ${s.course}`;const text=transcripts(s,Math.max(0,Math.floor(Math.min(cursor,b-1)/120)*120),Math.min(cursor+120,s.duration))[0];$('lesson-topic').textContent=text?.topic||s.course;$('lesson-line').textContent=text?.text||'课堂片段结束';$('segment-slider').value=cursor;$('video-range').textContent=`当前时段：${rangeLabel(s,a,b)}`;$('back-ten').disabled=cursor<=0;$('forward-ten').disabled=cursor>=s.duration;$('back-ten').textContent=`‹ 后退 ${step/60} 分钟`;$('forward-ten').textContent=`前进 ${step/60} 分钟 ›`;const node=$('chart-cursor');if(node){const x=35+(cursor-a)/(b-a)*550;node.setAttribute('x1',x);node.setAttribute('x2',x);
 const rows=metricRows(s,a,b,selectedMetric),dot=$('chart-position-dot');
 const left=rows.findLast(r=>r.t<=cursor),right=rows.find(r=>r.t>=cursor);
 const valid=left&&right&&left.value!==null&&right.value!==null&&right.t-left.t<=15;
 dot.setAttribute('visibility',valid?'visible':'hidden');
 if(valid){const value=right.t===left.t?left.value:left.value+(right.value-left.value)*(cursor-left.t)/(right.t-left.t);const max=axisMaximum(rows,selectedMetric);dot.setAttribute('cx',x);dot.setAttribute('cy',145-value/max*131);}
 }const buttons=[...$('transcript').querySelectorAll('button')];let active=null;for(const btn of buttons){const on=Number(btn.dataset.t)<=cursor;btn.classList.remove('active');if(on)active=btn;}if(active){active.classList.add('active');const area=$('transcript');if(active.offsetTop-area.offsetTop<area.scrollTop||active.offsetTop-area.offsetTop>area.scrollTop+area.clientHeight-45)area.scrollTop=active.offsetTop-area.offsetTop-30;}}
$('session').onchange=e=>{if(formal){switchSession(e.target.value);return;}change(()=>{si=Number(e.target.value);apiSession=session().sessionId?session():null;top=0;index=null;cursor=0;});};$('step').onchange=e=>change(()=>{step=Number(e.target.value);index=0;cursor=top*1800;});$('segment-slider').oninput=e=>seek(Number(e.target.value));$('play').onclick=()=>{testAudio.pause();const [a,b]=bounds();if(cursor>=b)cursor=a;playing=!playing;lastTick=performance.now();updateCursor();};for(const choice of ['range','session'])$('scope-'+choice).onclick=()=>{persist();scope=choice;edits();};for(const id of ['conclusion','adjustment'])$(id).oninput=()=>{dirtyKeys.add(noteKey());persist();$('save-status').textContent=storageOK?'草稿已暂存 · 点击保存确认复盘':'浏览器存储不可用，内容仅暂存本页';};$('save').onclick=async()=>{if(session().databaseReviews)return saveDatabase();persist();drafts[noteKey()].savedAt=new Date().toISOString();drafts[key()].savedAt=drafts[noteKey()].savedAt;if(store()){edits();$('toast').textContent='复盘已保存在当前浏览器';$('toast').classList.add('show');setTimeout(()=>$('toast').classList.remove('show'),2300);}};
setInterval(()=>{const now=performance.now();if(playing){cursor=Math.min(bounds()[1],cursor+(now-lastTick)/1000*Number($('speed').value));if(cursor>=bounds()[1])playing=false;updateCursor();}lastTick=now;},200);render();

function seek(target){change(()=>{cursor=Math.max(0,Math.min(target,session().duration));top=Math.min(Math.floor(cursor/1800),Math.ceil(session().duration/1800)-1);index=Math.min(Math.floor((cursor-top*1800)/step),Math.ceil((Math.min((top+1)*1800,session().duration)-top*1800)/step)-1);});}
$('back-ten').onclick=()=>seek(cursor-step);$('forward-ten').onclick=()=>seek(cursor+step);

function updateThemeCount(){$('theme-count').textContent=`${Array.from($('theme').value).length}/16`;}
function saveTheme(){if(themeComposing)return;dirtyKeys.add(key());$('theme').value=limitTheme($('theme').value);updateThemeCount();persist();$('save-status').textContent=storageOK?'主题已暂存 · 点击保存确认复盘':'浏览器存储不可用，主题仅暂存本页';}
let themeComposing=false;$('theme').addEventListener('compositionstart',()=>themeComposing=true);$('theme').addEventListener('compositionend',()=>{themeComposing=false;saveTheme();});$('theme').addEventListener('input',saveTheme);

async function switchSession(id){
 persist();const epoch=++selectionEpoch;testAudio.pause();playing=false;$('session').disabled=true;
 try{const fresh=await loadSession(id);if(epoch!==selectionEpoch)return;apiSession=fresh;sessions.splice(0,sessions.length,fresh);si=0;top=0;index=null;cursor=0;apiError=null;hydrateNotes(fresh);const url=new URL(location.href);url.searchParams.set('session',id);history.replaceState(null,'',url);testAudio.removeAttribute('src');testAudio.dataset.recording='';render();syncTestAudio();}
 catch(e){apiError=e.message;$('source-note').textContent=e.message;}finally{if(epoch===selectionEpoch){$('session').disabled=false;sessionOptions();}}
}
setInterval(async()=>{
 if(refreshing)return;refreshing=true;const selected=apiSession,epoch=selectionEpoch;
 try{if(formal){const list=await loadSessions();sessionList=list.sessions;if(epoch===selectionEpoch)sessionOptions();if(!selected&&sessionList.length&&epoch===selectionEpoch){await switchSession(query.get('session')||list.defaultSession||sessionList[0].id);return;}}if(selected){const fresh=await (formal?loadSession(selected.sessionId):loadTestSession());if(epoch!==selectionEpoch||apiSession!==selected)return;persist();const oldKey=key(),oldNoteKey=noteKey(),rangeDirty=dirtyKeys.has(oldKey),noteDirty=dirtyKeys.has(oldNoteKey);Object.assign(selected,fresh);if(rangeDirty)dirtyKeys.add(key());if(noteDirty)dirtyKeys.add(noteKey());if(rangeDirty||noteDirty)persist();hydrateNotes(selected);if(session()===selected)render();apiError=null;}}
 catch{if(epoch===selectionEpoch)$('source-note').textContent='后端读取失败，当前显示上次成功数据';}finally{refreshing=false;}
},10000);

// One real audio sample is available in the isolated combined test; no simulated video.
const testAudio=document.createElement('video');testAudio.controls=true;testAudio.preload='auto';testAudio.playsInline=true;testAudio.style.cssText='width:100%;max-height:230px;margin-top:8px';testAudio.hidden=true;document.querySelector('.lesson').append(testAudio);
const videoRetry=document.createElement('button');videoRetry.type='button';videoRetry.textContent='重新加载录像';videoRetry.hidden=true;document.querySelector('.lesson').append(videoRetry);
let videoLoadStarted=0;
videoRetry.onclick=()=>{testAudio.pause();testAudio.dataset.recording='';syncTestAudio();};

function syncTestAudio(){const s=session(),r=(s.combinedTest||s.realRecording)?recordingAt(s.recordings,cursor):null;testAudio.hidden=!r;
 if(r){if(syncRecordingSource(testAudio,s.id,r,cursor))videoLoadStarted=Date.now();
 const waiting=testAudio.readyState<2;
 videoRetry.hidden=!(testAudio.error||(waiting&&Date.now()-videoLoadStarted>15000));
 $('video-note').textContent=testAudio.error?'录像加载失败，可重新加载':waiting?'正在加载录像…':s.realRecording?'真实录像 · 音画同步回放':'真实45秒音频 · 无视频';}

 else {videoRetry.hidden=true;if(!testAudio.paused)testAudio.pause();if(s.realRecording)$('video-note').textContent=s.live?'本时段录像尚未完成或存在中断':'本时段暂无录像';else if(s.combinedTest)$('video-note').textContent='测试时间轴演示 · 非视频';}
}
function activeRecording(){return session().recordings?.find(r=>session().id+':'+r.id===testAudio.dataset.recording);}
testAudio.ontimeupdate=()=>{if(!testAudio.paused){const r=activeRecording();if(r){cursor=Math.min(r.start+testAudio.currentTime,r.start+r.duration-.001);const nextTop=Math.floor(cursor/1800);if(nextTop!==top||cursor>bounds()[1]){persist();top=nextTop;index=null;render();}else updateCursor();}}};
testAudio.onended=()=>{const current=activeRecording(),next=nextRecording(session().recordings,current);if(!next){if(current)cursor=current.start+current.duration;updateCursor();return;}persist();cursor=next.start;top=Math.floor(cursor/1800);index=null;render();syncTestAudio();testAudio.play().catch(()=>{$('video-note').textContent='下一段录像已就绪，点击播放继续';});};
setInterval(syncTestAudio,300);syncTestAudio();

async function saveDatabase(){
 persist();const [a,b]=bounds(),s=session();
 const ranges=[{scope:'range',start:a,end:b,k:key()}];if(scope==='session')ranges.push({scope:'session',start:0,end:s.duration,k:noteKey()});
 const records=ranges.map(r=>{const d=drafts[r.k]||{};return {scope:r.scope,start:r.start,end:r.end,version:d.version||0,fields:noteFields(r.scope,d,{periodTheme:$('theme').value,keywords:tagValues.keywords,conclusion:r.k===noteKey()?$('conclusion').value:'',adjustment:r.k===noteKey()?$('adjustment').value:''})};});
 const snapshots=ranges.map(r=>JSON.stringify(drafts[r.k]));$('save').disabled=true;$('save-status').textContent='正在保存到数据库…';
 try{const response=await fetch('/api/reviews',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:s.sessionId,records})});const result=await response.json();
 if(response.status===409){
  const fresh=await loadSession(s.sessionId);if(session()!==s)return;
  const current=ranges.map(r=>({r,d:structuredClone(drafts[r.k]||{}),latest:fresh.notes?.find(n=>noteRecordKey(n,s)===r.k)}));
  const describe=fields=>JSON.stringify({主题:fields?.periodTheme||'',关键词:fields?.keywords||[],结论:fields?.conclusion||'',调整:fields?.adjustment||''},null,2);
  const message=current.map(({r,d,latest})=>`${r.scope==='session'?'整场':'当前时段'}\n本地修改：\n${describe(d)}\n服务器最新：\n${describe(latest?.fields)}`).join('\n\n');
  if(window.confirm('保存版本冲突，请核对以下内容。确定：保留本地内容并采用最新版本号，之后需再次点击保存；取消：保持草稿不变。\n\n'+message)){
   for(const {r,latest} of current){drafts[r.k]={...drafts[r.k],version:latest?.version||0};dirtyKeys.add(r.k);}
   s.notes=fresh.notes;store();$('save-status').textContent='已保留本地内容并更新版本号，请核对后再次保存';
  }else $('save-status').textContent='尚未解决版本冲突，本地修改已保留';
  return;
 }
 if(!response.ok)throw Error(result.error||'保存失败');
 ranges.forEach((r,i)=>{if(JSON.stringify(drafts[r.k])===snapshots[i])dirtyKeys.delete(r.k);});s.notes=result.notes;hydrateNotes(s);if(session()!==s)return;edits();$('save-status').textContent=dirtyKeys.has(noteKey())||dirtyKeys.has(key())?'已保存提交版本，仍有新修改未保存':'已保存到数据库';
 }catch(e){if(session()===s)$('save-status').textContent=e.message+'；本页修改已保留';}finally{$('save').disabled=false;}
}

$('export-pdf').onclick=async()=>{
 const s=session(),button=$('export-pdf');if(s.id==='empty'||apiError){$('toast').textContent='当前数据未加载成功，暂不能导出';$('toast').classList.add('show');setTimeout(()=>$('toast').classList.remove('show'),2300);return;}
 button.disabled=true;
 try{await printReview(document.querySelector('main'));}
 catch(error){console.error('PDF export failed',error);$('toast').textContent='页面截图失败，请重试';$('toast').classList.add('show');setTimeout(()=>$('toast').classList.remove('show'),3500);}
 finally{button.disabled=false;}
};

function renderCollectionStatus(){
 const audioMessage=audioHealthMessage(session(),session().collectionStatus?.audioQuality);
 $('audio-health').hidden=!audioMessage;$('audio-health').textContent=audioMessage;
 const s=session(),report=s.collectionStatus?.audioQuality,id=s.sessionId||s.id;
 if(audioDialog.open&&(audioDialogSession!==id||['sound','recovered'].includes(report?.state)))audioDialog.close();
 const alert=audioAlerts.next(s,report);
 if(alert||(audioDialog.open&&audioDialogSession===id)){
  $('audio-alert-title').textContent=s.live?'录音持续静音，请检查音源':'这场录像存在静音时段';
  $('audio-alert-session').textContent=`${s.teacher} · ${s.date} · ${rangeLabel(s,0,s.duration)}`;
  $('audio-alert-message').textContent=audioMessage;
 }
 if(alert){audioDialogSession=alert.sessionId;if(!audioDialog.open)audioDialog.showModal();}
 const panel=$('collection-status');panel.hidden=!formal;if(!formal)return;
 const status=session().collectionStatus;
 const readiness=status?.readiness;
 $('collection-status').querySelector('summary').textContent='采集与处理状态'+(readiness?' · '+readiness.label:'');
 $('collection-finishing').textContent=[...(readiness?.reasons||[]),...(status?.finishing||[])].join(' ');
 $('collection-current').textContent=status?`当前场次：${status.teacher} · 已关联人数 ${status.count} 条 · 关联方式：${status.binding==='teacher-time'?'主播昵称＋时间（插件与OBS昵称须一致）':'采集批次ID'} · 录像 ${status.recordings} 段 · ASR ${Object.entries(status.asr).map(([k,v])=>( {done:'完成',queued:'排队',pending:'排队',submitted:'处理中',processing:'处理中',failed:'失败'}[k]||k)+' '+v).join('，')||'暂无片段'} · 总结 ${Object.entries(status.summaries).map(([k,v])=>({done:'完成',pending:'等待',running:'生成中',failed:'失败'}[k]||k)+' '+v).join('，')||'暂无'}`:'当前场次暂无处理状态';
}
let statusLoading=false;
async function refreshCollectionStatus(){
 if(!formal||statusLoading)return;statusLoading=true;
 try{const response=await fetch('/api/collection-status',{cache:'no-store'});if(!response.ok)throw Error();const data=await response.json();
 const stamp=value=>new Date(value).toLocaleString('zh-CN');
 $('collection-runs').replaceChildren(...data.runs.map(row=>{const p=document.createElement('p');p.textContent=`${row.teacher} · 批次 ${row.runId.slice(0,8)} · 已入库 ${row.count} 条 · 最近采样 ${stamp(row.lastCapturedAt)} · 最近入库 ${stamp(row.lastReceivedAt)} · ${({'verified':'采集结束已核验','unverified':'已登记结束（旧批次未核验总数）','not-confirmed':'尚无结束确认'})[row.finishState]||'结束状态未知'}`;return p;}));
 if(!data.runs.length)$('collection-runs').textContent='数据库尚未收到采样';
 }catch{$('collection-runs').textContent='采集状态查询失败，请稍后重试（不能据此判断采集是否正常）';}finally{statusLoading=false;}
}
refreshCollectionStatus();setInterval(refreshCollectionStatus,15000);
