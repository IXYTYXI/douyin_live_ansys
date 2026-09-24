import {test} from 'node:test';import assert from 'node:assert/strict';
import {remoteSession} from './dist/remote.mjs';import {samples,transcripts,summary} from './dist/model.mjs';
test('backend test data stays distinct and never invents transcript or summary',()=>{
 const s=remoteSession({source:'synthetic-integration-test',id:'1',startedAt:'2026-09-24T04:00:00Z',samples:[{t:0,value:17},{t:10,value:29}]});
 assert.deepEqual(samples(s,0,10),[{t:0,value:17}]);assert.deepEqual(transcripts(s,0,1800),[]);assert.equal(summary(s,0,1800).theme,'');
});
test('real ASR preview exposes only completed text without simulated metrics',()=>{
 const s=remoteSession({source:'asr-integration-test',id:'asr1',startedAt:'2026-09-24T04:00:00Z',duration:45,samples:[],segments:[{start:0,state:'done',text:'真实识别结果'},{start:20,state:'submitted',text:null}]});
 assert.equal(s.source,'backend-asr');assert.equal(s.duration,45);assert.equal(s.processing,true);
 assert.deepEqual(samples(s,0,45),[]);assert.equal(transcripts(s,0,45)[0].text,'真实识别结果');assert.equal(summary(s,0,45).theme,'');
});
test('combined test links prior metrics, real text and generated review by range',()=>{
 const s=remoteSession({source:'asr-integration-test',id:'combined',combinedTest:true,startedAt:'2026-09-24T04:00:00Z',duration:1800,samples:[{t:0,value:90},{t:600,value:120}],segments:[{start:0,state:'done',text:'分数画图法应用题',utterances:[{start:.1,end:4,text:'分数画图法应用题'}]}]});
 assert.equal(summary(s,0,600).theme,'分数概念与课程演示');assert.ok(summary(s,0,600).keywords.includes('分数'));
 assert.equal(summary(s,600,1200).theme,'画图法解应用题');assert.match(summary(s,600,1200).body,/120/);
 assert.equal(transcripts(s,600,1200).length,20);assert.ok(transcripts(s,600,1200).every(r=>r.synthetic));assert.equal(summary(s,1200,1800).theme,'乘法练习与课堂回顾');
});
