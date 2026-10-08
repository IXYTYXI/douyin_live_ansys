import {test} from 'node:test';import assert from 'node:assert/strict';
import * as setup from './dist/live-setup-model.mjs';
test('live run choices require explicit selection and display identity plus time',()=>{assert.equal(typeof setup.runLabel,'function');assert.match(setup.runLabel({runId:'run-42',teacher:'王老师',startedAt:'2026-10-08T03:00:00Z'}),/王老师/);assert.match(setup.runLabel({runId:'run-42',teacher:'王老师',startedAt:'2026-10-08T03:00:00Z'}),/run-42/);});
test('setup credential endpoint encodes only a selected run',()=>{assert.equal(typeof setup.setupPath,'function');assert.throws(()=>setup.setupPath(''));assert.equal(setup.setupPath('run/a'),'/api/live/setup/run%2Fa');});
