import {test} from 'node:test';import assert from 'node:assert/strict';
import * as playback from './dist/remote.mjs';
const rows=[{id:'a',start:0,duration:60,url:'/a'},{id:'b',start:60,duration:60,url:'/b'},{id:'c',start:125,duration:60,url:'/c'}];
test('segment lookup uses half-open boundaries and leaves unavailable gaps empty',()=>{assert.equal(typeof playback.recordingAt,'function');assert.equal(playback.recordingAt(rows,59).id,'a');assert.equal(playback.recordingAt(rows,60).id,'b');assert.equal(playback.recordingAt(rows,120),null);assert.equal(playback.recordingAt(rows,124),null);assert.equal(playback.recordingAt(rows,185),null);});
test('automatic continuation advances only to available contiguous segments',()=>{assert.equal(typeof playback.nextRecording,'function');assert.equal(playback.nextRecording(rows,rows[0]).id,'b');assert.equal(playback.nextRecording(rows,rows[1]),null);assert.equal(playback.nextRecording([...rows,{id:'d',start:120.8,duration:4,url:'/d'}],rows[1]).id,'d');});

// A refreshed signed URL must not restart a video that is still loading.
test('polling rotated signatures keeps the active download and latest seek target',()=>{
 assert.equal(typeof playback.syncRecordingSource,'function');
 let loads=0,src='';
 const video={dataset:{},paused:true,readyState:0,duration:60,currentTime:0,set src(v){src=v;loads++;},get src(){return src;}};
 const first={id:'a',start:0,duration:60,url:'https://example.test/media/a.mp4?expires=1&sig=first'};
 playback.syncRecordingSource(video,'session',first,0);
 playback.syncRecordingSource(video,'session',{...first,url:'https://example.test/media/a.mp4?expires=2&sig=next'},20);
 assert.equal(loads,1);
 video.onloadedmetadata();assert.equal(video.currentTime,20);
 playback.syncRecordingSource(video,'session',{...first,url:'https://example.test/media/optimized.mp4?expires=3'},20);
 assert.equal(loads,2);
});
test('switching recordings loads once and seeks within the new segment',()=>{
 assert.equal(typeof playback.syncRecordingSource,'function');
 let loads=0;const video={dataset:{},paused:true,readyState:1,duration:60,currentTime:0,set src(v){loads++;}};
 playback.syncRecordingSource(video,'session',rows[0],15);video.onloadedmetadata();
 assert.equal(video.currentTime,15);
 playback.syncRecordingSource(video,'session',rows[1],80);video.onloadedmetadata();
 assert.equal(loads,2);assert.equal(video.currentTime,20);
});
