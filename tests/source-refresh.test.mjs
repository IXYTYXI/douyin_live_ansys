import {test} from 'node:test';import assert from 'node:assert/strict';
let callback,startup;let saved={},sent=[],active={id:5,url:'https://anchor.douyin.com/anchor/dashboard'},matches=true;
globalThis.chrome={runtime:{id:'test',getURL:x=>'chrome-extension://test/'+x,onMessage:{addListener:f=>callback=f},onStartup:{addListener:f=>startup=f}},tabs:{query:async()=>[active],get:async id=>({...active,id}),sendMessage:async(id,m)=>{sent.push({id,...m});return {ok:true,matches,health:{state:"playing",checkedAt:100,uploadToken:"DO_NOT_EXPOSE"}};}},storage:{local:{get:async()=>structuredClone(saved),set:async data=>Object.assign(saved,structuredClone(data))}}};
globalThis.fetch=()=>{throw Error('Source refresh must not upload');};
await import('../anchor-collector/background.mjs');
const popup={id:'test',url:'chrome-extension://test/popup.html'},review={id:'test',url:'https://live-ansys.ai.lab.yc345.tv/?session=live-a',frameId:0,tab:{id:9}};
const call=(message,sender=popup)=>new Promise(resolve=>callback(message,sender,resolve));
function reset(){saved={records:[{id:'cached'}],settings:{enabled:false,teacher:'其他主播'},uploadToken:'DO_NOT_EXPOSE'};sent=[];matches=true;active={id:5,url:'https://anchor.douyin.com/anchor/dashboard'};}
test('explicit source binding refreshes only that teacher tab without touching collection or upload',async()=>{
 reset();assert.equal((await call({type:'SOURCE_BIND',teacher:'老师'})).ok,true);
 const before=structuredClone(saved);
 const result=await call({type:'REFRESH_SOURCE',teacher:'老师'},review);
 assert.equal(result.ok,true);assert.equal(result.requested,true);
 assert.equal(sent.at(-1).id,5);assert.equal(sent.at(-1).type,'SOURCE_RELOAD');
 assert.deepEqual(saved.records,before.records);assert.deepEqual(saved.settings,before.settings);
 assert.equal(JSON.stringify(result).includes('DO_NOT_EXPOSE'),false);
 assert.equal((await call({type:'REFRESH_SOURCE',teacher:'老师'},review)).ok,false,'repeat clicks are throttled');
});
test('review page cannot bind, start sampling, upload, read tokens, or refresh another teacher',async()=>{
 reset();await call({type:'SOURCE_BIND',teacher:'老师'});
 for(const message of [{type:'SOURCE_BIND',teacher:'坏人'},{type:'START',teacher:'老师'},{type:'UPLOAD_NOW'},{type:'STATUS'},{type:'REFRESH_SOURCE',teacher:'另一老师'}])assert.equal((await call(message,review)).ok,false);
 for(const sender of [{...review,url:'https://evil.example/'},{...review,frameId:1},{...review,id:'another-extension'}])assert.equal((await call({type:'REFRESH_SOURCE',teacher:'老师'},sender)).ok,false);
 assert.equal(sent.filter(x=>x.type==='SOURCE_RELOAD').length,0);
});
test('missing, navigated or mismatched source refuses refresh; browser restart invalidates binding',async()=>{
 reset();assert.equal((await call({type:'REFRESH_SOURCE',teacher:'老师'},review)).ok,false);
 await call({type:'SOURCE_BIND',teacher:'老师'});matches=false;
 assert.equal((await call({type:'REFRESH_SOURCE',teacher:'老师'},review)).ok,false);
 matches=true;active.url='https://example.com/';assert.equal((await call({type:'REFRESH_SOURCE',teacher:'老师'},review)).ok,false);
 active.url='https://anchor.douyin.com/anchor/dashboard';await startup();
 assert.equal((await call({type:'REFRESH_SOURCE',teacher:'老师'},review)).ok,false);
 assert.equal(sent.filter(x=>x.type==='SOURCE_RELOAD').length,0);
});


test('review health queries are bound, sanitized and do not refresh or upload',async()=>{
 reset();await call({type:'SOURCE_BIND',teacher:'老师'});const before=structuredClone(saved);
 const result=await call({type:'SOURCE_HEALTH',teacher:'老师'},review);
 assert.equal(result.ok,true);assert.deepEqual(result.health,{state:'playing',checkedAt:100});
 assert.deepEqual(saved,before);assert.equal(sent.at(-1).type,'SOURCE_HEALTH');assert.equal(sent.some(m=>m.type==='SOURCE_RELOAD'),false);
 assert.equal((await call({type:'SOURCE_HEALTH',teacher:'wrong'},review)).ok,false);
 assert.equal((await call({type:'SOURCE_HEALTH',teacher:'老师'},{...review,url:'https://evil.example'})).ok,false);
 matches=false;assert.equal((await call({type:'SOURCE_HEALTH',teacher:'老师'},review)).ok,false);
});
