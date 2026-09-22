import {test} from 'node:test';
import assert from 'node:assert/strict';
import {samples,stats,transcripts,summary,timeLabel} from './dist/model.mjs';
const s={id:'real-test',source:'anchor-review',start:633,startSecond:11,duration:10431,onlineSamples:[],transcriptLines:[{t:4,text:'你好'},{t:600,text:'语文阅读'}]};
test('real session never invents online samples from aggregate values',()=>{assert.deepEqual(samples(s,0,600),[]);assert.equal(stats(samples(s,0,600)).average,null);});
test('real transcript preserves text and uses half-open interval boundaries',()=>{assert.deepEqual(transcripts(s,0,600),[{t:4,text:'你好'}]);assert.deepEqual(transcripts(s,600,1200),[{t:600,text:'语文阅读'}]);assert.deepEqual(transcripts(s,1200,1800),[]);});
test('real time alignment preserves the live start seconds',()=>{assert.equal(timeLabel(s,49),'10:34');assert.equal(timeLabel(s,600,true),'10:43:11');});
test('no mock subject or keywords appear in ungenerated real summaries',()=>{assert.equal(summary(s,0,600).theme,'');assert.deepEqual(summary(s,0,600).keywords,[]);});
