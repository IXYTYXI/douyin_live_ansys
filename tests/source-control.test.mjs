import {test} from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../anchor-collector/source-control.js',import.meta.url),'utf8'),bridge=readFileSync(new URL('../anchor-collector/review-bridge.js',import.meta.url),'utf8');
test('source document verifies the exact teacher and rechecks before its own reload',()=>{
 let listener,reloads=0,timer;const document={body:{innerText:'直播服务平台\n老师\n流量转化\n在线人数'}};
 const location={origin:'https://anchor.douyin.com',pathname:'/anchor/dashboard',reload:()=>reloads++};
 vm.runInNewContext(source,{document,location,navigator:{onLine:true},chrome:{runtime:{id:'ours',onMessage:{addListener:f=>listener=f}}},setTimeout:f=>timer=f});
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


test('source health is read-only and requires sustained lack of media progress',()=>{
 let listener,now=0,reloads=0;const media={paused:false,ended:false,muted:false,volume:1,readyState:4,currentTime:0,error:null,getBoundingClientRect:()=>({width:320,height:180})};
 const document={body:{innerText:'直播服务平台\n老师\n流量转化'},querySelectorAll:()=>[media],visibilityState:'visible'};
 const navigator={onLine:true};
 vm.runInNewContext(source,{document,navigator,Date:{now:()=>now},location:{origin:'https://anchor.douyin.com',pathname:'/anchor/dashboard',reload:()=>reloads++},chrome:{runtime:{id:'ours',onMessage:{addListener:f=>listener=f}}},setTimeout:()=>assert.fail('health must not reload')});
 const read=()=>{let r;listener({type:'SOURCE_HEALTH',teacher:'老师'},{id:'ours'},v=>r=v);return r?.health?.state;};
 assert.equal(read(),'observing');now=10000;media.currentTime=10;assert.equal(read(),'playing');
 now=20000;assert.equal(read(),'observing');now=26000;assert.equal(read(),'stalled');
 media.paused=true;assert.equal(read(),'paused');media.paused=false;media.muted=true;assert.equal(read(),'muted');
 media.muted=false;navigator.onLine=false;assert.equal(read(),'offline');navigator.onLine=true;
 media.error={code:2};assert.equal(read(),'error');media.error=null;
 now=90000;assert.equal(read(),'observing','long observation gap must not prove stalled');
 document.querySelectorAll=()=>[];assert.equal(read(),'unknown');
 document.querySelectorAll=()=>[media,media];assert.equal(read(),'unknown','never guess which of two players is captured');
 assert.equal(reloads,0);
});

test('bridge permits read-only health without a gesture but still refuses background reload',async()=>{
 let listener;const posted=[],messages=[];
 const window={addEventListener:(_,f)=>listener=f,postMessage:r=>posted.push(r)};window.top=window;
 const location={origin:'https://live-ansys.ai.lab.yc345.tv',pathname:'/'},navigator={userActivation:{isActive:false}};
 const chrome={runtime:{sendMessage:async m=>{messages.push(m);return {ok:true,health:{state:'playing',checkedAt:10,secret:'private'},uploadToken:'private'};}}};
 vm.runInNewContext(bridge,{window,location,navigator,chrome});
 const event={source:window,origin:location.origin,data:{channel:'diting-source-control',type:'SOURCE_HEALTH',requestId:'health-1',teacher:'老师'}};
 await listener(event);assert.equal(messages.length,1);assert.equal(posted[0].health.state,'playing');assert.equal(JSON.stringify(posted).includes('private'),false);
 await listener({...event,data:{...event.data,type:'REFRESH_SOURCE'}});assert.equal(messages.length,1);
});

test('source reload refuses offline state even if the review used an older healthy reading',()=>{
 let listener,timer,reloads=0;const navigator={onLine:false};
 const document={body:{innerText:'直播服务平台\n老师\n流量转化'}};
 const location={origin:'https://anchor.douyin.com',pathname:'/anchor/dashboard',reload:()=>reloads++};
 vm.runInNewContext(source,{document,location,navigator,chrome:{runtime:{id:'ours',onMessage:{addListener:f=>listener=f}}},setTimeout:f=>timer=f});
 const call=()=>{let reply;listener({type:'SOURCE_RELOAD',teacher:'老师'},{id:'ours'},r=>reply=r);return reply;};
 assert.equal(call().ok,false);assert.equal(timer,undefined);
 navigator.onLine=true;assert.equal(call().ok,true);navigator.onLine=false;timer();assert.equal(reloads,0);
});
