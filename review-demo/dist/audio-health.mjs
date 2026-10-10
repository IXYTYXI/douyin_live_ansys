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
