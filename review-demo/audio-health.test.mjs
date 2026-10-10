import {test} from 'node:test';import assert from 'node:assert/strict';
import {audioHealthMessage} from './dist/audio-health.mjs';
const session={start:12*60,startSecond:0,live:true};
test('visible alert identifies received audio and action, without claiming speech or restart cause',()=>{
 const r=audioHealthMessage(session,{state:'silent',sustainedLowVolumeRanges:[[5,80]],checkedUntil:80,uncheckedRanges:[]});
 assert.match(r,/12:00:05/);assert.match(r,/OBS/);assert.match(r,/静音或音量极低/);assert.doesNotMatch(r,/锁屏导致|录音正常/);
});
test('recovery retains evidence and unknown is not success',()=>{
 assert.match(audioHealthMessage(session,{state:'recovered',sustainedLowVolumeRanges:[[0,60]],checkedUntil:90,uncheckedRanges:[]}),/恢复有声/);
 assert.match(audioHealthMessage(session,{state:'unknown',sustainedLowVolumeRanges:[],uncheckedRanges:[[0,60]]}),/尚未完成/);
 assert.equal(audioHealthMessage(session,{state:'sound',sustainedLowVolumeRanges:[],uncheckedRanges:[]}), '');
});
