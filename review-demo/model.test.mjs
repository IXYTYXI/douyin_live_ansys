import {test} from 'node:test';import assert from 'node:assert/strict';import {sessions,selection,samples,stats,summary,draftKey} from './dist/model.mjs';
test('30 minute view contains 180 ten-second samples',()=>assert.equal(samples(sessions[0],0,1800).length,180));
test('10 minute snap stays inside top range',()=>{assert.deepEqual(selection(sessions[0],1,600,1),[2400,3000]);assert.equal(samples(sessions[0],2400,3000).length,60);});
test('partial final segment clamps at actual end',()=>assert.deepEqual(selection(sessions[1],3,600,1),[6000,6500]));
test('missing samples stay null and excluded from mean',()=>{const list=samples(sessions[0],2400,3000);assert.equal(stats(list).missing,6);assert.equal(stats(list).count,54);});
test('different time selections produce different summaries',()=>assert.notEqual(summary(sessions[0],0,600).theme,summary(sessions[0],600,1200).theme));
test('draft keys distinguish sessions and time ranges',()=>{assert.notEqual(draftKey('math',0,600),draftKey('math',0,1800));assert.notEqual(draftKey('math',0,600),draftKey('reading',0,600));});

import {limitTheme} from './dist/model.mjs';
test('period themes are single concise sentences within sixteen characters',()=>{for(const session of sessions){for(let a=0;a<session.duration;a+=600){const title=summary(session,a,Math.min(a+1800,session.duration)).theme;assert.ok(typeof title==='string'&&Array.from(title).length<=16);assert.ok(!title.includes('、'));}}});
test('manual theme is limited to sixteen characters',()=>assert.equal(Array.from(limitTheme('一二三四五六七八九十一二三四五六七八九十')).length,16));
