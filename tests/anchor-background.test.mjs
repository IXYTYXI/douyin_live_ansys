import {test} from 'node:test';import assert from 'node:assert/strict';
let callback, startup;let saved={};
globalThis.chrome={runtime:{id:'test',getURL:x=>'chrome-extension://test/'+x,onMessage:{addListener:f=>callback=f},onStartup:{addListener:f=>startup=f}},tabs:{query:async()=>[{id:1,url:'https://anchor.douyin.com/anchor/dashboard'}]},storage:{local:{get:async()=>structuredClone(saved),set:async v=>{saved={...saved,...structuredClone(v)}}}}};
await import('../anchor-collector/background.mjs');
const popup={id:'test',url:'chrome-extension://test/popup.html'},page={id:'test',url:'https://anchor.douyin.com/anchor/dashboard',tab:{id:1}};
const call=(m,s=popup)=>new Promise(resolve=>callback(m,s,resolve));
test('only popup can enable; other tabs cannot submit; samples deduplicate and export without raw header',async()=>{
 assert.equal((await call({type:'START',teacher:'老师'},page)).ok,false);
 assert.equal((await call({type:'START',teacher:'老师'})).ok,true);
 const m={type:'SAMPLE',header:'主播版 老师 流量转化',metricText:'直播热度 在线人数 99 点赞次数 123 直播趋势图',visible:true};
 await call(m,{...page,tab:{id:2}});assert.equal((await call({type:'STATUS'})).count,0);
 await call(m,page);await call(m,page);const out=await call({type:'EXPORT'});assert.equal(out.records.length,1);assert.equal(out.records[0].metrics.online.value,99);assert.equal(out.records[0].platformSessionId,null);assert.equal('header' in out.records[0],false);
 await call({type:'STOP'});await call(m,page);assert.equal((await call({type:'STATUS'})).count,1);
});
test('unknown account never emits samples',async()=>{saved={};await call({type:'START',teacher:'老师'});await call({type:'SAMPLE',header:'其他主播',metricText:'直播热度 在线人数 88 直播趋势图'},page);assert.equal((await call({type:'STATUS'})).count,0);});
test('upload settings require popup and explicit destination permission',async()=>{
 saved={};chrome.permissions={contains:async()=>false};
 const message={type:'CONFIGURE_UPLOAD',url:'https://example.com/api/metrics/batches',token:'t'.repeat(32)};
 assert.equal((await call(message,page)).ok,false);
 assert.equal((await call(message)).ok,false);
 chrome.permissions.contains=async()=>true;
 assert.equal((await call(message)).ok,true);
 assert.equal(saved.ingestUrl,message.url);
 assert.equal('uploadToken' in await call({type:'STATUS'}),false);
 saved.batch={batchId:'pending'};
 assert.equal((await call({...message,url:'https://other.example/api/metrics/batches'})).ok,false);
});

test('confirmed end seals once; blank page and mismatched account never seal',async()=>{
 saved={};await call({type:'START',teacher:'老师'});
 const realNow=Date.now;let now=realNow();Date.now=()=>now;
 const m={type:'SAMPLE',header:'老师',metricText:'',visible:true,platformEnded:true};
 try{
  await call({...m,platformEnded:false},page);assert.equal(saved.settings.enabled,true);
  await call({...m,header:'其他人'},page);now+=10000;
  await call(m,page);assert.equal(saved.settings.enabled,true);now+=10000;
  await call(m,page);assert.equal(saved.settings.enabled,true);now+=10000;
  await call(m,page);assert.equal(saved.settings.enabled,false);
  assert.equal(saved.finishes.length,1);assert.equal(saved.finishes[0].reason,'platform-ended');
  await call(m,page);assert.equal(saved.finishes.length,1);
 }finally{Date.now=realNow;}
});
test('live metrics or interruption reset pending end confirmation',async()=>{
 saved={};await call({type:'START',teacher:'老师'});let now=Date.now();const realNow=Date.now;Date.now=()=>now;
 const m={type:'SAMPLE',header:'老师',metricText:'',visible:true,platformEnded:true};
 try{
  await call(m,page);now+=10000;await call({...m,platformEnded:false},page);now+=10000;
  await call(m,page);now+=10000;await call(m,page);assert.equal(saved.settings.enabled,true);
  now+=10000;await call({...m,metricText:'直播热度 在线人数 9 直播趋势图'},page);assert.equal(saved.settings.enabled,true);assert.equal(saved.records.length,1);
 }finally{Date.now=realNow;}
});
