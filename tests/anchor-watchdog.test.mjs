import {test} from 'node:test';import assert from 'node:assert/strict';
let alarm,badge='';const saved={settings:{enabled:true,lastAt:Date.now()-90000}};
globalThis.chrome={runtime:{id:'test',getURL:x=>x,onMessage:{addListener(){}},onStartup:{addListener(){}},onInstalled:{addListener(){}}},storage:{local:{get:async()=>structuredClone(saved),set:async s=>Object.assign(saved,s)}},action:{setBadgeText:async o=>{badge=o.text},setBadgeBackgroundColor:async()=>{}},alarms:{get:async()=>({}),create:async()=>{},onAlarm:{addListener:f=>alarm=f}}};
await import('../anchor-collector/background.mjs');
test('missing heartbeats raise badge without sealing; fresh samples clear it',async()=>{
 await alarm({name:'collector-health'});await new Promise(r=>setTimeout(r,0));assert.equal(badge,'!');assert.equal(saved.settings.enabled,true);assert.equal(saved.finishes,undefined);
 saved.settings.lastAt=Date.now();await alarm({name:'collector-health'});await new Promise(r=>setTimeout(r,0));assert.equal(badge,'');
});
