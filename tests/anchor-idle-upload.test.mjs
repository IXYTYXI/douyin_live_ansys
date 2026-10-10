import {test} from 'node:test';
import assert from 'node:assert/strict';
let alarm,callback;const startups=[];let saved={},posts=[],now=2000000,failStatus=0,hold=null;
const realNow=Date.now;Date.now=()=>now;
const sample=(id)=>({id:String(id),runId:'run',capturedAt:new Date(1000000).toISOString()});
globalThis.chrome={runtime:{id:'test',getURL:x=>'chrome-extension://test/'+x,onMessage:{addListener:f=>callback=f},onStartup:{addListener:f=>startups.push(f)},onInstalled:{addListener(){}}},storage:{local:{get:async()=>structuredClone(saved),set:async s=>Object.assign(saved,structuredClone(s))}},action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}},alarms:{get:async()=>({}),create:async()=>{},onAlarm:{addListener:f=>alarm=f}}};
globalThis.fetch=async(_url,options)=>{const b=JSON.parse(options.body);posts.push(b);if(hold)await hold;if(failStatus)return {ok:false,status:failStatus};return {ok:true,json:async()=>({batchId:b.batchId,acceptedIds:b.records.map(r=>r.id)})};};
await import('../anchor-collector/background.mjs');
function reset(count=1){now=2000000;posts=[];failStatus=0;hold=null;saved={settings:{enabled:true,teacher:'老师',tabId:1,runId:'run',lastAt:now-600000,capturedCount:count},records:Array.from({length:count},(_,i)=>sample(i)),ingestUrl:'https://example.com/api/metrics/batches',uploadToken:'t'.repeat(32)};}
const tick=async()=>{await alarm({name:'collector-health'});await new Promise(r=>setImmediate(r));};
const call=m=>new Promise(resolve=>callback(m,{id:'test',url:'https://anchor.douyin.com/anchor/dashboard',tab:{id:1}},resolve));
test('ten minutes without a new sample drains cached batches without ending collection',async()=>{
 reset(301);now--;await tick();assert.equal(posts.length,0);
 now++;await tick();assert.equal(posts.length,2);assert.equal(saved.records.length,0);
 assert.equal(saved.settings.enabled,true);assert.equal(saved.settings.endedAt,undefined);assert.equal(saved.finishes,undefined);
 await tick();assert.equal(posts.length,2);
});
test('failed idle upload retains the batch and observes five minute retry delay',async()=>{
 reset();failStatus=503;await tick();assert.equal(posts.length,1);assert.equal(saved.records.length,1);
 const id=posts[0].batchId;now+=60000;await tick();assert.equal(posts.length,1);
 now+=240000;failStatus=0;await tick();assert.equal(posts.length,2);assert.equal(posts[1].batchId,id);assert.equal(saved.records.length,0);
});
test('unchanged metric values with fresh sample timestamps do not trigger idle upload',async()=>{
 reset();const message={type:'SAMPLE',header:'老师',metricText:'直播热度 在线人数 9 直播趋势图',visible:true};
 await call(message);now+=590000;await call(message);await tick();assert.equal(posts.length,0);assert.equal(saved.settings.lastAt,now);
 now+=600000;await tick();assert.equal(saved.records.length,0);
});
test('idle upload needs a configured destination and does not duplicate an in-flight request',async()=>{
 reset();delete saved.uploadToken;await tick();assert.equal(posts.length,0);
 saved.uploadToken='t'.repeat(32);let release;hold=new Promise(r=>release=r);
 const first=tick();await new Promise(r=>setImmediate(r));assert.equal(posts.length,1);
 await tick();assert.equal(posts.length,1);release();await first;assert.equal(saved.records.length,0);
});
test('browser restart drains cached batches without enabling sampling or creating a finish event',async()=>{
 reset(301);await Promise.all(startups.map(f=>f()));await new Promise(r=>setImmediate(r));
 assert.equal(saved.records.length,0);assert.equal(posts.length,2);assert.equal(saved.settings.enabled,false);assert.equal(saved.finishes,undefined);
});
test.after(()=>{Date.now=realNow;});
