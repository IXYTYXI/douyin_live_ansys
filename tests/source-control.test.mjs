import {test} from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../anchor-collector/source-control.js',import.meta.url),'utf8'),bridge=readFileSync(new URL('../anchor-collector/review-bridge.js',import.meta.url),'utf8');
test('source document verifies the exact teacher and rechecks before its own reload',()=>{
 let listener,reloads=0,timer;const document={body:{innerText:'直播服务平台\n老师\n流量转化\n在线人数'}};
 const location={origin:'https://anchor.douyin.com',pathname:'/anchor/dashboard',reload:()=>reloads++};
 vm.runInNewContext(source,{document,location,chrome:{runtime:{id:'ours',onMessage:{addListener:f=>listener=f}}},setTimeout:f=>timer=f});
 const call=(teacher,id='ours',type='SOURCE_RELOAD')=>{let reply;listener({type,teacher},{id},r=>reply=r);return reply;};
 assert.equal(call('老师','foreign'),undefined);assert.equal(timer,undefined);
 assert.equal(call('老').ok,false);assert.equal(timer,undefined);
 assert.equal(call('老师','ours','SOURCE_IDENTIFY').matches,true);assert.equal(timer,undefined);
 assert.equal(call('老师').ok,true);timer();assert.equal(reloads,1);
 call('老师');document.body.innerText='直播服务平台\n其他人\n流量转化';timer();assert.equal(reloads,1);
});
test('review bridge requires the allowed top-level page, user click, and forwards only a refresh command',async()=>{
 let listener;const posted=[],messages=[];
 const window={addEventListener:(_,fn)=>listener=fn,postMessage:r=>posted.push(r)};window.top=window;
 const location={origin:'https://live-ansys.ai.lab.yc345.tv',pathname:'/'},navigator={userActivation:{isActive:true}};
 const chrome={runtime:{sendMessage:async m=>{messages.push(m);return {ok:true,requested:true,uploadToken:'never-return'};}}};
 vm.runInNewContext(bridge,{window,location,navigator,chrome});
 const payload={channel:'diting-source-control',type:'REFRESH_SOURCE',requestId:'request-1',teacher:'老师',url:'https://evil.example/',token:'ignored'};
 const event={source:window,origin:location.origin,data:payload};
 await listener({...event,origin:'https://evil.example'});await listener({...event,data:{...payload,type:'UPLOAD_NOW'}});assert.equal(messages.length,0);
 navigator.userActivation.isActive=false;await listener(event);assert.equal(messages.length,0);assert.equal(posted.at(-1).ok,false);
 navigator.userActivation.isActive=true;await listener(event);assert.equal(JSON.stringify(messages),JSON.stringify([{type:'REFRESH_SOURCE',teacher:'老师'}]));
 assert.equal(posted.at(-1).requested,true);assert.equal('uploadToken' in posted.at(-1),false);
});
