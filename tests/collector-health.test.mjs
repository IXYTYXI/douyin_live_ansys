import {test} from 'node:test';import assert from 'node:assert/strict';
import {collectorHealth} from '../anchor-collector/health.mjs';
test('no first sample times out and never appears healthy',()=>{assert.match(collectorHealth({settings:{enabled:true,startedAt:1000},count:0,uploadConfigured:true},40000).join(' '),/未收到首条/);});
test('stopped pending tail and never sampled are distinct',()=>{assert.match(collectorHealth({settings:{},count:2},100).join(' '),/尾批/);assert.match(collectorHealth({settings:{},count:0},100).join(' '),/尚无采样/);});
test('oldest pending sample exposes backlog despite a recent upload',()=>{assert.match(collectorHealth({settings:{enabled:true,lastAt:700000},count:3,oldestPendingAt:new Date(0).toISOString(),uploadConfigured:true,lastUploadedAt:700000},700001).join(' '),/积压/);});
