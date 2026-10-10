import {test} from 'node:test';import assert from 'node:assert/strict';
import * as health from './dist/audio-health.mjs';
const session=(end=60,id='live-a',live=true)=>({id,sessionId:id,live,recordings:[{start:0,duration:end}]});
test('ingest observation distinguishes growth, no growth, failed reads, and ended sessions',()=>{
 assert.equal(typeof health.createIngestObserver,'function');const o=health.createIngestObserver();
 o.observe(session(),0);assert.equal(o.status(session(),0).state,'observing');
 o.observe(session(70),10000);assert.equal(o.status(session(70),10000).state,'receiving');
 for(let t=20000;t<=190000;t+=10000)o.observe(session(70),t);
 assert.equal(o.status(session(70),190000).state,'stale');
 o.fail('live-a');assert.equal(o.status(session(70),190000).state,'query-error');
 o.observe(session(70),200000);assert.equal(o.status(session(70),200000).state,'observing');
 o.observe(session(80),210000);assert.equal(o.status(session(80),210000).state,'receiving');
 assert.equal(o.status(session(80),241000).state,'query-error','old cache cannot imply current receiving');
 assert.equal(o.status(session(80,'live-b'),210000).state,'observing');
 assert.equal(o.status(session(80,'live-a',false),210000).state,'ended');
});
test('sleep, missing media metadata and changing session reset the observation',()=>{
 assert.equal(typeof health.createIngestObserver,'function');const o=health.createIngestObserver();
 o.observe(session(),0);o.observe(session(),500000);assert.equal(o.status(session(),500000).state,'observing');
 o.observe(session(60,'live-b'),510000);o.observe(session(60),520000);assert.equal(o.status(session(),520000).state,'observing');
 o.observe({...session(),recordings:[{start:0,duration:NaN}]},530000);assert.equal(o.status(session(),530000).state,'unknown');
});
test('diagnosis only recommends source refresh with source evidence and preserves uncertainty',()=>{
 assert.equal(typeof health.connectionDiagnosis,'function');const d=(source,ingest='receiving',online=true)=>health.connectionDiagnosis({source:{state:source},ingest:{state:ingest},online});
 assert.equal(d('stalled').canRefresh,true);assert.equal(d('stalled').code,'source-stalled');
 for(const [source,ingest,online] of [['offline','receiving',true],['playing','stale',true],['stalled','query-error',true],['playing','receiving',false],['paused','receiving',true],['muted','receiving',true],['unknown','receiving',true]])assert.equal(d(source,ingest,online).canRefresh,false);
 assert.equal(d('playing','receiving').alert,false);assert.equal(d('playing','ended').alert,false);
 assert.match(d('playing','stale').message,/录像.*未增长/);assert.match(d('playing','stale').message,/不能.*确定/);
});
test('connection alerts deduplicate a continuous incident and reset only after known recovery',()=>{
 assert.equal(typeof health.createConnectionAlerts,'function');const a=health.createConnectionAlerts();
 const incident={code:'source-stalled',alert:true};assert.ok(a.next('a',incident));assert.equal(a.next('a',incident),null);
 a.next('a',{code:'unknown',alert:false});assert.equal(a.next('a',incident),null);
 a.next('a',{code:'healthy',alert:false});assert.ok(a.next('a',incident));assert.ok(a.next('b',incident));
});

test('a live-to-ended transition is reported once even when the backend closes before the stale threshold',()=>{
 const o=health.createIngestObserver();o.observe(session(),0);o.observe(session(70,'live-a',false),10000);
 assert.equal(o.status(session(70,'live-a',false),10000).state,'stopped');
 const diagnosis=health.connectionDiagnosis({source:{state:'playing'},ingest:{state:'stopped'}});
 assert.equal(diagnosis.alert,true);assert.equal(diagnosis.canRefresh,false);assert.match(diagnosis.message,/本场.*结束/);
 const historical=health.createIngestObserver();historical.observe(session(70,'live-a',false),0);assert.equal(historical.status(session(70,'live-a',false),0).state,'ended');
});
