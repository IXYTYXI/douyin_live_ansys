import {test} from 'node:test';
import assert from 'node:assert/strict';
import {remoteSession} from './dist/remote.mjs';
import {metricRows,axisMaximum,metricReading} from './dist/metric-chart.mjs';
const session=()=>remoteSession({source:'live-review',realRecording:true,id:'live-a',teacher:'老师',startedAt:'2026-10-09T03:00:00Z',duration:80,samples:[{t:0,value:20,metrics:{likes:{value:1200,approximate:true},shares:{value:0}}},{t:10,value:21,metrics:{likes:{value:null}}},{t:40,value:22,metrics:{likes:{value:1500},shares:{value:3}}}]});
test('switching metrics keeps raw snapshots, zero and missing values',()=>{
 const s=session();assert.deepEqual(metricRows(s,0,20,'likes').map(r=>r.value),[1200,null]);assert.equal(metricRows(s,0,20,'shares')[0].value,0);assert.deepEqual(metricRows(s,0,20,'online').map(r=>r.value),[20,21]);
});
test('sampling gaps break paths and absent historical fields are not fabricated',()=>{
 const rows=metricRows(session(),0,60,'shares');assert.ok(rows.some(r=>r.t>10&&r.t<40&&r.value===null));
 assert.ok(metricRows(session(),0,60,'giftUsers').every(r=>r.value===null));
 assert.deepEqual(metricRows({source:'live-review',onlineSamples:[{t:0,value:10}]},0,60,'likes'),[]);
});
test('readout never reuses stale points or loses approximation',()=>{
 const rows=metricRows(session(),0,60,'likes');assert.equal(metricReading(rows,0,'likes'),'约 1,200 次');assert.equal(metricReading(rows,10,'likes'),'未获取');assert.equal(metricReading(rows,35,'likes'),'未获取');
});
test('axes accommodate low counts and large totals',()=>{assert.equal(axisMaximum([{value:3}],'shares'),4);assert.ok(axisMaximum([{value:18000}],'likes')>=18000);assert.equal(axisMaximum([{value:35}],'online'),100);});
