import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseMetrics} from '../anchor-collector/parser.mjs';
test('reads observed dashboard labels and keeps preview separate',()=>{const r=parseMetrics('直播热度 设置 在线人数 101 预览流看播 39 送礼人数 16 新增粉丝 68 评论人数 87 点赞次数 1,696 分享次数 2 加粉丝团 12 人均停留时长 2.7 直播趋势图');assert.equal(r.online.value,101);assert.equal(r.likes.value,1696);assert.equal(r.averageStay.unit,null);});
test('missing values stay null, zero stays zero, abbreviated counts marked approximate',()=>{const r=parseMetrics('直播热度 在线人数 -- 新增粉丝 0 点赞次数 1.2万 直播趋势图');assert.equal(r.online.value,null);assert.equal(r.newFollowers.value,0);assert.equal(r.likes.value,12000);assert.equal(r.likes.approximate,true);});
test('unrelated comments and historical statistics cannot become metrics',()=>{const r=parseMetrics('评论 在线人数 500 直播热度 在线人数 99 直播趋势图 评论 点赞次数 999');assert.equal(r.online.value,99);assert.equal(r.likes.value,null);assert.equal(parseMetrics('平均在线人数 68 最高在线人数 123'),null);});
