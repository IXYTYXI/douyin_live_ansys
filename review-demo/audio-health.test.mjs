import {test} from 'node:test';import assert from 'node:assert/strict';
import {audioHealthMessage,createAudioAlertTracker} from './dist/audio-health.mjs';
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

test('popup is one incident while silence grows or recording gaps split its ranges',()=>{
 const storage=new Map(),store={getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)};
 const tracker=createAudioAlertTracker(()=>store),s={...session,sessionId:'live-a'};
 const report={state:'silent',lastAudibleAt:5,sustainedLowVolumeRanges:[[5,80]]};
 assert.ok(tracker.next(s,report));
 const growing={...report,sustainedLowVolumeRanges:[[5,90],[110,180]]};
 assert.equal(tracker.next(s,growing),null);
 assert.equal(createAudioAlertTracker(()=>store).next(s,growing),null,'refresh keeps the acknowledgment');
 assert.ok(tracker.next({...s,sessionId:'live-b'},report),'another session is independent');
});
test('recovery permits a new alert only after a new sustained low-volume interval',()=>{
 const tracker=createAudioAlertTracker(),s={...session,sessionId:'live-a'};
 const report={state:'silent',lastAudibleAt:5,sustainedLowVolumeRanges:[[5,80]]};
 const first=tracker.next(s,report);assert.ok(first);
 assert.equal(tracker.next(s,{...report,state:'recovered',lastAudibleAt:100}),null);
 assert.equal(tracker.next(s,{...report,lastAudibleAt:100}),null,'an old sustained range must not trigger on a new short pause');
 const second=tracker.next(s,{...report,lastAudibleAt:100,sustainedLowVolumeRanges:[[5,80],[100,165]]});
 assert.ok(second);assert.notEqual(second.key,first.key);
});
test('popup handles unavailable storage, no audible samples, and incomplete detection',()=>{
 const tracker=createAudioAlertTracker(()=>{throw Error('storage blocked');}),s={...session,sessionId:'live-a',live:false};
 const report={state:'silent',lastAudibleAt:null,sustainedLowVolumeRanges:[[0,65]]};
 assert.equal(tracker.next(s,{...report,state:'unknown'}),null);
 assert.equal(tracker.next(s,{...report,state:'sound'}),null);
 assert.equal(tracker.next(s,{...report,sustainedLowVolumeRanges:[]}),null);
 assert.ok(tracker.next(s,report),'ended recordings can warn on first review');
 assert.equal(tracker.next(s,{...report,sustainedLowVolumeRanges:[[0,65],[90,180]]}),null);
 assert.equal(tracker.next({},report),null);
});
test('bad saved state and failed writes do not break the page or repeat alerts',()=>{
 for(const value of ['not json','{}','[null,4]']){
  const tracker=createAudioAlertTracker(()=>({getItem:()=>value,setItem:()=>{throw Error('quota');}}));
  const s={sessionId:'live-a'},report={state:'silent',lastAudibleAt:0,sustainedLowVolumeRanges:[[0,60]]};
  assert.ok(tracker.next(s,report));assert.equal(tracker.next(s,report),null);
 }
});

test('refresh retains this incident through navigation state when browser storage is blocked',()=>{
 const blocked=()=>{throw Error('storage blocked');},s={sessionId:'live-a'};
 const report={state:'silent',lastAudibleAt:5,sustainedLowVolumeRanges:[[5,80]]};
 const alert=createAudioAlertTracker(blocked).next(s,report);
 const reloaded=createAudioAlertTracker(blocked,[alert.key]);
 assert.equal(reloaded.next(s,report),null);
 assert.ok(reloaded.next(s,{...report,lastAudibleAt:100,sustainedLowVolumeRanges:[[100,170]]}));
});
