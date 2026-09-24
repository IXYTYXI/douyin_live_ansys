import {test} from 'node:test';import assert from 'node:assert/strict';
import {remoteSession} from './dist/remote.mjs';import {samples,transcripts,summary} from './dist/model.mjs';
test('backend test data stays distinct and never invents transcript or summary',()=>{
 const s=remoteSession({source:'synthetic-integration-test',id:'1',startedAt:'2026-09-24T04:00:00Z',samples:[{t:0,value:17},{t:10,value:29}]});
 assert.deepEqual(samples(s,0,10),[{t:0,value:17}]);assert.deepEqual(transcripts(s,0,1800),[]);assert.equal(summary(s,0,1800).theme,'');
});
