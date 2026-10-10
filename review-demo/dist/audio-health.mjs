import {timeLabel} from './model.mjs';
export function audioHealthMessage(session,report){
 if(!report)return '';
 const ranges=report.sustainedLowVolumeRanges||[],parts=[];
 if(ranges.length){
  const [a,b]=ranges.at(-1),range=`${timeLabel(session,a,true)}—${timeLabel(session,b,true)}`;
  const state=report.state==='recovered'?'最新已检测片段恢复有声':report.state==='silent'?'截至最新已检测片段仍为静音或音量极低':'检测到持续静音或音量极低';
  parts.push(`${state}。最近异常时段 ${range}${ranges.length>1?`，共 ${ranges.length} 段`:''}。${session.live?'请检查 OBS 混音器、静音按钮和所选音源。':'这些时段无法还原讲话内容，请核对 OBS 音源和原始录制。'}`);
 }
 if(report.uncheckedRanges?.length)parts.push('部分音轨检测尚未完成，不能确认录音正常。');
 if(parts.length)parts.push('音量检测基于已收到的片段，可能滞后约 1—2 分钟；有声音不等于有可识别语音。');
 return parts.join(' ');
}

// Identify a silence incident by the last audible moment, not its growing end
// or recording boundaries. A gap alone is not evidence that sound recovered.
export function createAudioAlertTracker(getStorage=()=>null,initialKeys=[]){
 const storageKey='diting-audio-alerts-v1';let seen=new Set(initialKeys.filter(key=>typeof key==='string'));
 const read=()=>{try{const saved=JSON.parse(getStorage()?.getItem(storageKey)||'[]');if(Array.isArray(saved))for(const key of saved)if(typeof key==='string')seen.add(key);}catch{}};
 read();
 return {next(session,report){
  const id=session.sessionId||session.id,last=report?.lastAudibleAt;
  if(!id||id==='empty'||report?.state!=='silent')return null;
  const ranges=report.sustainedLowVolumeRanges||[];
  // Historical long silence must not turn a new short pause into an alert.
  if(!ranges.some(([a,b])=>Number.isFinite(a)&&Number.isFinite(b)&&b-a>=(report.alertSeconds||60)-.001&&(last==null||a>=last-.001)))return null;
  const key=JSON.stringify([id,last==null?'no-audible':Math.round(last*1000)]);
  read();if(seen.has(key))return null;
  seen.add(key);seen=new Set([...seen].slice(-200));
  try{getStorage()?.setItem(storageKey,JSON.stringify([...seen]));}catch{}
  return {key,sessionId:id};
 }};
}

function sourceRequest(type,teacher,{targetWindow=window,timeoutMs=4000}={}){
 return new Promise((resolve,reject)=>{
  const requestId=crypto.randomUUID(),origin=targetWindow.location.origin;
  const finish=(error,value)=>{clearTimeout(timer);targetWindow.removeEventListener('message',receive);error?reject(Error(error)):resolve(value);};
  const receive=event=>{
   const m=event.data;
   if(event.source!==targetWindow||event.origin!==origin||m?.channel!=='diting-source-control'||m.type!=='SOURCE_RESULT'||m.requestId!==requestId)return;
   if(type==='SOURCE_HEALTH'){
    if(m.ok===true&&typeof m.health?.state==='string')finish(null,{state:m.health.state});
    else finish(typeof m.error==='string'?m.error.slice(0,250):'无法读取直播源状态');
    return;
   }
   finish(m.ok===true&&m.requested===true?null:(typeof m.error==='string'?m.error.slice(0,250):'直播源未确认刷新'),{requested:true});
  };
  const timer=setTimeout(()=>finish(type==='SOURCE_HEALTH'?'无法读取直播源状态。请在推流电脑的同一 Chrome 中打开公网复盘页，更新插件并绑定直播源。':'未收到直播源刷新确认。请在推流电脑的同一 Chrome 中打开公网复盘页，安装新版插件并绑定直播源。'),timeoutMs);
  targetWindow.addEventListener('message',receive);
  try{targetWindow.postMessage({channel:'diting-source-control',type,requestId,teacher},origin);}
  catch{finish('无法联系直播源插件，请到源页面手动刷新');}
 });
}

export function requestSourceRefresh(teacher,options){return sourceRequest('REFRESH_SOURCE',teacher,options);}
export function requestSourceHealth(teacher,options){return sourceRequest('SOURCE_HEALTH',teacher,options);}

// This observes finalized recording growth, not the OBS socket or source network.
// Use local monotonic time; never compare clocks on different computers.
export function createIngestObserver(){
 let sample=null;
 return {
  observe(session,now=performance.now()){
   const id=session.sessionId||session.id,rows=session.recordings||[];
   const valid=rows.every(r=>Number.isFinite(r.start)&&Number.isFinite(r.duration)&&r.duration>=0);
   const end=valid?Math.max(0,...rows.map(r=>r.start+r.duration)):null;
   const reset=!sample||sample.id!==id||sample.failed||now-sample.at>30000||now<sample.at||sample.end==null;
   const grew=!reset&&end!=null&&end>sample.end+.001;
   const stopped=sample?.id===id&&(sample.live||sample.stopped)&&!session.live;
   sample={id,end,live:session.live,stopped,at:now,failed:false,advanced:grew||(!reset&&sample.advanced),lastAdvance:reset||grew?now:sample.lastAdvance};
  },
  fail(id){if(sample?.id===id)sample.failed=true;else sample={id,failed:true};},
  status(session,now=performance.now()){
   if(!session.live)return {state:sample?.id===(session.sessionId||session.id)&&sample.stopped?'stopped':'ended'};
   if(!sample||sample.id!==(session.sessionId||session.id))return {state:'observing'};
   if(sample.failed||now-sample.at>30000)return {state:'query-error'};
   if(sample.end==null)return {state:'unknown'};
   if(now-sample.lastAdvance>=180000)return {state:'stale'};
   return {state:sample.advanced?'receiving':'observing'};
  }
 };
}

export function connectionDiagnosis({source={state:'unknown'},ingest={state:'observing'},online=true,audioSilent=false}){
 const result=(code,message,alert=false,canRefresh=false)=>({code,message,alert,canRefresh});
 if(ingest.state==='stopped')return result('ingest-ended','服务器已将本场收流标记为结束。如果你仍在直播，请检查 OBS 是否断线及自动重连状态；如果已正常停播，关闭此提醒即可。',true);
 if(ingest.state==='ended')return result('ended','本场已结束，不检查当前直播源。');
 if(online===false)return result('review-offline','复盘浏览器报告网络离线。先恢复网络；无法据此确认 OBS 或服务器状态。',true);
 if(source.state==='offline')return result('source-offline','直播源浏览器报告网络离线。先恢复网络，再检查播放器和 OBS 自动重连；此时不反复刷新网页。',true);
 if(ingest.state==='query-error')return result('query-error','复盘接口暂时无法确认最新状态，可能是网络、登录或服务问题。上次数据不能证明当前收流正常；先检查网络和 OBS 连接。',true);
 if(ingest.state==='stale')return result('ingest-stale','持续查询期间，服务器已登记录像超过3分钟未增长。请检查 OBS 推流连接、自动重连和服务器录像处理；不能仅凭此确定网络断线，刷新源网页无法修复推流连接。',true);
 if(source.state==='stalled')return result('source-stalled','直播源播放器进度连续至少15秒未推进，可能在缓冲或卡住。可确认刷新源网页；OBS 保持采集和推流，刷新不保证声音恢复。',true,true);
 if(source.state==='error')return result('source-error','直播源播放器报告错误，原因可能是加载、解码或网络。检查源页面后可确认刷新；不停止 OBS。',true,true);
 if(source.state==='paused'||source.state==='ended')return result('source-paused','直播源播放器已暂停或播放结束。请先在源页面确认是否仍在直播，并手动恢复播放。',true);
 if(source.state==='muted')return result('source-muted','直播源播放器或标签页已静音，或音量为0。请在源页面取消静音并确认 OBS 混音器有声音。',true);
 if(source.state==='playing'&&ingest.state==='receiving')return result('healthy',audioSilent?'源网页播放进度和服务器录像均在推进，但最近已检测音轨仍静音。请检查播放器声音与 OBS 音源；可尝试刷新源网页，再等待新的音轨检测。':'源网页播放进度和服务器录像均在推进；是否有声音仍以音轨检测为准。',false,audioSilent);
 return result('unknown','链路状态仍待确认。源网页状态只能在推流电脑的同一浏览器、绑定对应大屏后读取；播放器无法识别时不推断网络故障。');
}

export function createConnectionAlerts(){
 const seen=new Map();
 return {next(id,diagnosis){
  if(['healthy','ended'].includes(diagnosis.code)){seen.delete(id);return null;}
  if(!diagnosis.alert)return null;
  const codes=seen.get(id)||new Set();if(codes.has(diagnosis.code))return null;
  codes.add(diagnosis.code);seen.set(id,codes);
  if(seen.size>100)seen.delete(seen.keys().next().value);
  return {key:JSON.stringify([id,diagnosis.code]),sessionId:id};
 }};
}
