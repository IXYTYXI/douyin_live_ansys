import {test} from 'node:test';import assert from 'node:assert/strict';
import {noteFields} from './dist/save-fields.mjs';
test('whole-session notes cannot inherit range theme or polluted draft tags',()=>{assert.deepEqual(noteFields('session',{periodTheme:'旧小节',keywords:['旧标签'],conclusion:'整场',adjustment:'调整'},{periodTheme:'当前小节',keywords:['当前标签']}),{conclusion:'整场',adjustment:'调整'});});
test('range notes preserve edited theme and keywords',()=>{assert.deepEqual(noteFields('range',{periodTheme:'修改',keywords:[]},{periodTheme:'默认',keywords:['默认'],conclusion:'观察',adjustment:''}),{periodTheme:'修改',keywords:[],conclusion:'观察',adjustment:''});});
