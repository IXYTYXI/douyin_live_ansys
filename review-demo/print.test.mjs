import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reviewPrintHTML} from './dist/print.mjs';
test('exports current edits, range and note scope without executing text as HTML',()=>{
 const html=reviewPrintHTML({teacher:'王<script>alert(1)</script>',date:'2026/10/08',range:'14:00—14:10',source:'实际采集',noteScope:'整场结论',saveStatus:'有未保存修改',theme:'当前修改',keywords:['<img src=x>'],conclusion:'第一行\n第二行',adjustment:'下次调整',transcript:[{time:'14:01',text:'A & B'}]});
 assert.ok(html.includes('14:00—14:10'));assert.ok(html.includes('整场结论'));assert.ok(html.includes('有未保存修改'));assert.ok(html.includes('当前修改'));assert.ok(html.includes('第一行\n第二行'));assert.ok(html.includes('A &amp; B'));assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img src=x>'));
});
test('long transcript remains complete and missing data is explicit',()=>{
 const lines=Array.from({length:500},(_,i)=>({time:String(i),text:'第'+i+'句'}));
 const html=reviewPrintHTML({teacher:'测试主播（模拟人数）',transcript:lines,keywords:[]});
 assert.ok(html.includes('第499句'));assert.ok(html.includes('模拟人数'));assert.ok(html.includes('暂无人数曲线'));assert.ok(html.includes('未填写'));assert.ok(!html.includes('max-height'));
});
