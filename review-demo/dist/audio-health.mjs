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
