import {test} from 'node:test';import assert from 'node:assert/strict';
import {channelTeachers,bindingBody} from './dist/live-setup-model.mjs';
test('collector restarts leave one stable teacher choice',()=>{assert.deepEqual(channelTeachers([{teacher:'王老师',runId:'a'},{teacher:'王老师',runId:'b'},{teacher:'李老师'}]),['王老师','李老师']);});
test('first binding needs only a teacher, never a per-show task',()=>{assert.equal(bindingBody(' 王老师 '),'{"teacher":"王老师"}');assert.throws(()=>bindingBody(''));assert.throws(()=>bindingBody('字'.repeat(61)));});
