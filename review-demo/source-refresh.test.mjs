import {test} from 'node:test';import assert from 'node:assert/strict';
import * as audio from './dist/audio-health.mjs';
function page(){const listeners=new Set();return {location:{origin:'https://live-ansys.ai.lab.yc345.tv'},listeners,sent:[],addEventListener:(_,fn)=>listeners.add(fn),removeEventListener:(_,fn)=>listeners.delete(fn),postMessage(message,origin){this.sent.push({message,origin});},reply(data,origin=this.location.origin,source=this){for(const fn of listeners)fn({data,origin,source});}};}
test('source request accepts only its own correlated reply and never requests an upload',async()=>{
 assert.equal(typeof audio.requestSourceRefresh,'function');
 const win=page(),pending=audio.requestSourceRefresh('老师',{targetWindow:win,timeoutMs:100});
 const {message,origin}=win.sent[0];assert.equal(message.type,'REFRESH_SOURCE');assert.equal(message.teacher,'老师');assert.equal(origin,win.location.origin);
 let done=false;pending.then(()=>done=true);win.reply({...message,type:'SOURCE_RESULT',ok:true,requested:true},'https://evil.example');
 win.reply({...message,type:'SOURCE_RESULT',requestId:'different',ok:true,requested:true});await Promise.resolve();assert.equal(done,false);
 win.reply({...message,type:'SOURCE_RESULT',ok:true,requested:true});assert.deepEqual(await pending,{requested:true});assert.equal(win.listeners.size,0);
});
test('missing plugin and rejected source are reported without pretending sound recovered',async()=>{
 assert.equal(typeof audio.requestSourceRefresh,'function');
 const win=page();await assert.rejects(audio.requestSourceRefresh('老师',{targetWindow:win,timeoutMs:5}),/未收到.*确认/);assert.equal(win.listeners.size,0);
 const pending=audio.requestSourceRefresh('老师',{targetWindow:win,timeoutMs:100});const {message}=win.sent.at(-1);
 win.reply({...message,type:'SOURCE_RESULT',ok:false,error:'主播不匹配'});await assert.rejects(pending,/主播不匹配/);assert.equal(win.listeners.size,0);
});

test('read-only source health is correlated, sanitized and times out without refresh',async()=>{
 assert.equal(typeof audio.requestSourceHealth,'function');const win=page();
 const pending=audio.requestSourceHealth('老师',{targetWindow:win,timeoutMs:100});const {message}=win.sent[0];assert.equal(message.type,'SOURCE_HEALTH');
 win.reply({...message,type:'SOURCE_RESULT',ok:true,health:{state:'playing',secret:'not-forwarded'}});assert.deepEqual(await pending,{state:'playing'});assert.equal(win.listeners.size,0);
 await assert.rejects(audio.requestSourceHealth('老师',{targetWindow:win,timeoutMs:5}),/无法读取/);
});
