import {test} from 'node:test';import assert from 'node:assert/strict';
import {endpoint} from '../anchor-collector/endpoint.mjs';
test('restrict forwarding destination to HTTPS or explicit loopback',()=>{
 assert.equal(endpoint('https://example.com/api/metrics/batches'),'https://example.com/api/metrics/batches');
 assert.ok(endpoint('http://127.0.0.1:18773/api/metrics/batches'));
 for(const url of ['http://example.com/api/metrics/batches','https://user:pass@example.com/api/metrics/batches','https://example.com/api/metrics/batches?token=secret'])assert.throws(()=>endpoint(url));
});
