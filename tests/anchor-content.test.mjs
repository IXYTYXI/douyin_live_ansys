import {test} from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs';
const source=fs.readFileSync(new URL('../anchor-collector/content.js',import.meta.url),'utf8');
function read(text){let message;vm.runInNewContext(source,{window:{},location:{pathname:'/anchor/dashboard'},document:{body:{innerText:text},visibilityState:'visible'},setInterval:()=>{},chrome:{runtime:{sendMessage:async m=>{message=m;}}}});return message;}
test('only an explicit standalone ended marker without live metrics signals end',()=>{
 assert.equal(read('一星老师\n本场直播已结束\n').platformEnded,true);
 assert.equal(read('一星老师\n').platformEnded,false);
 assert.equal(read('一星老师\n评论：直播已结束了吗\n').platformEnded,false);
 assert.equal(read('一星老师\n直播热度 在线人数 12 直播趋势图\n本场直播已结束\n').platformEnded,false);
});
