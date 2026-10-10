// Offline UI fixtures only. No live platform, extension management, or business writes.
import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';import {createServer} from 'node:http';import {readFile} from 'node:fs/promises';import assert from 'node:assert/strict';import {join} from 'node:path';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const root=fileURLToPath(new URL('../../review-demo/dist',import.meta.url));
let end=60,live=true,fail=false;const writes=[],errors=[];
const fixture=()=>({id:'live-ui-fixture',teacher:'离线界面测试（非真实直播）',source:'live-review',live,realRecording:true,startedAt:'2026-10-10T03:00:00Z',duration:end,samples:[],segments:[],recordings:[{id:'r1',start:0,duration:end}],notes:[],summaries:[],collectionStatus:{teacher:'离线界面测试（非真实直播）',count:0,recordings:1,asr:{},summaries:{}}});
const server=createServer(async(req,res)=>{
 try{
  if(req.method!=='GET'){writes.push(req.url);res.writeHead(405);res.end();return;}
  if(req.url.startsWith('/api/')){
   if(fail){res.writeHead(503);res.end('{}');return;}
   const value=req.url==='/api/sessions'?{sessions:[{id:'live-ui-fixture',teacher:fixture().teacher,live,startedAt:fixture().startedAt,duration:end}],defaultSession:'live-ui-fixture'}:req.url==='/api/collection-status'?{runs:[]}:fixture();
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));return;
  }
  const name=req.url==='/'?'index.html':req.url.slice(1).split('?')[0];if(name.includes('..'))throw Error('path');
  let body=await readFile(join(root,name));if(name==='index.html')body=Buffer.from(body.toString().replace('<head>','<head><meta name="diting-mode" content="real">'));
  res.setHeader('Content-Type',name.endsWith('.mjs')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(body);
 }catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});const page=await browser.newPage({viewport:{width:1024,height:900}});page.on('pageerror',e=>errors.push(e.message));
 await page.clock.install();await page.addInitScript(()=>{
  window.fixtureState='playing';window.refreshRequests=0;
  window.addEventListener('message',event=>{const m=event.data;if(m?.channel!=='diting-source-control'||m.type==='SOURCE_RESULT')return;
   if(m.type==='REFRESH_SOURCE')window.refreshRequests++;
   window.postMessage({channel:m.channel,type:'SOURCE_RESULT',requestId:m.requestId,ok:true,...(m.type==='SOURCE_HEALTH'?{health:{state:window.fixtureState}}:{requested:true})},location.origin);
  });
 });
 await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>document.getElementById('connection-source').textContent.includes('推进'));
 end=70;await page.clock.runFor(10000);await page.waitForFunction(()=>document.getElementById('connection-ingest').textContent.includes('已观察'));
 assert.equal(await page.locator('#audio-alert').evaluate(e=>e.open),false);
 await page.evaluate(()=>window.fixtureState='stalled');await page.clock.runFor(10000);await page.waitForFunction(()=>document.getElementById('audio-alert').open);
 assert.match(await page.locator('#audio-alert-message').textContent(),/15秒/);assert.equal(await page.locator('#audio-alert-refresh').isVisible(),true);
 await page.locator('#audio-alert-refresh').click();await page.waitForFunction(()=>window.refreshRequests===1);assert.match(await page.locator('#source-refresh-status').textContent(),/已请求/);
 await page.locator('#audio-alert-close').click();await page.clock.runFor(10000);assert.equal(await page.locator('#audio-alert').evaluate(e=>e.open),false);
 await page.locator('#connection-open').click();assert.equal(await page.locator('#audio-alert').evaluate(e=>e.open),true);await page.locator('#audio-alert-close').click();
 await page.evaluate(()=>window.fixtureState='offline');await page.clock.runFor(10000);await page.waitForFunction(()=>document.getElementById('audio-alert-message').textContent.includes('离线'));
 assert.equal(await page.locator('#audio-alert-refresh').isVisible(),false);assert.equal(await page.evaluate(()=>window.refreshRequests),1);
 if(process.env.SCREENSHOT_PATH)await page.screenshot({path:process.env.SCREENSHOT_PATH});
 await page.locator('#audio-alert-close').click();await page.evaluate(()=>window.fixtureState='playing');end=80;await page.clock.runFor(10000);
 fail=true;await page.clock.runFor(10000);await page.waitForFunction(()=>document.getElementById('audio-alert-message').textContent.includes('接口'));assert.equal(await page.locator('#audio-alert-refresh').isVisible(),false);
 fail=false;live=false;await page.clock.runFor(10000);await page.waitForFunction(()=>document.getElementById('audio-alert-message').textContent.includes('本场收流'));
 assert.equal(await page.locator('#audio-alert-refresh').isVisible(),false);assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({ok:true,fixtureOnly:true,checks:['live-growth','source-stall','explicit-refresh-only','dismiss-and-reopen','source-offline-no-refresh','query-failure-no-refresh','live-to-ended','no-business-writes','no-browser-errors']}));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
