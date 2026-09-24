import {flush,UPLOAD_PERIOD_MINUTES} from './upload.mjs';
import {INGEST_URL} from './upload-config.mjs';
import {parseMetrics} from './parser.mjs';
const CAP=5000;
let pending=Promise.resolve();
const dashboard=url=>{try{const u=new URL(url);return u.origin==='https://anchor.douyin.com'&&u.pathname==='/anchor/dashboard';}catch{return false;}};
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
 const popup=sender.id===chrome.runtime.id&&sender.url===chrome.runtime.getURL('popup.html');
 const content=sender.id===chrome.runtime.id&&sender.tab&&dashboard(sender.url);
 if(!popup&&!(content&&message.type==='SAMPLE')){reply({ok:false,error:'不允许的来源'});return false;}
 const task=pending.then(async()=>{
  const {settings={},records=[]}=await chrome.storage.local.get(['settings','records']);
  if(message.type==='STATUS'){const {uploadStatus,lastUploadedAt}=await chrome.storage.local.get(['uploadStatus','lastUploadedAt']);return {settings,count:records.length,last:records.at(-1)||null,uploadStatus,lastUploadedAt};}
  if(message.type==='EXPORT')return {schema:1,source:'anchor-visible-dashboard',records};
  if(message.type==='STOP'){settings.enabled=false;settings.status='已停止，本地记录保留';await chrome.storage.local.set({settings});return {settings};}
  if(message.type==='START'){
   if(records.length>=CAP)throw Error('本地记录已满，请先导出并使用新测试环境');
   const tabs=await chrome.tabs.query({active:true,currentWindow:true});const tab=tabs[0];
   if(!tab||!dashboard(tab.url))throw Error('请先打开已登录的抖音主播直播大屏');
   const teacher=String(message.teacher||'').trim();
   if(!teacher||teacher.length>60)throw Error('请输入当前主播昵称');
   // Each explicit start is a separate observation run, not an inferred platform live session.
   const next={enabled:true,teacher,tabId:tab.id,runId:crypto.randomUUID(),startedAt:Date.now(),status:'等待首个采样；请保持大屏前台可见',lastAt:null};
   await chrome.storage.local.set({settings:next});return {settings:next};
  }
  if(message.type!=='SAMPLE'||!settings.enabled||sender.tab.id!==settings.tabId)return {};
  const now=Date.now();
  if(settings.lastAt&&now-settings.lastAt<9000)return {};
  const metrics=parseMetrics(String(message.metricText||'').slice(0,3000));
  const accountMatched=String(message.header||'').includes(settings.teacher);
  if(!accountMatched||!metrics||metrics.online.value===null){settings.status='暂停取数：账号或大屏指标无法确认，请检查页面';await chrome.storage.local.set({settings});return {};}
  if(records.length>=CAP){settings.enabled=false;settings.status='记录已满，已停止以避免覆盖；请导出';await chrome.storage.local.set({settings});return {};}
  const gap=settings.lastAt?now-settings.lastAt:null;
  records.push({id:crypto.randomUUID(),runId:settings.runId,teacher:settings.teacher,platformSessionId:null,capturedAt:new Date(now).toISOString(),intervalMs:gap,gap:gap!==null&&gap>15000,foreground:message.visible===true,sourceUrl:'https://anchor.douyin.com/anchor/dashboard',metrics});
  settings.lastAt=now;settings.status=message.visible?'正在取数 · 本地保存':'后台页面采样 · 可能受浏览器节流影响';
  await chrome.storage.local.set({settings,records});return {count:records.length};
 });
 pending=task.catch(()=>{});task.then(data=>{reply({ok:true,...data});if(message.type==='STOP')void upload(true);},e=>reply({ok:false,error:e.message}));return true;
});
// Fail closed on browser restart: saved tab IDs are not safe account/session bindings.
chrome.runtime.onStartup.addListener(()=>{const task=pending.then(async()=>{const {settings={}}=await chrome.storage.local.get('settings');settings.enabled=false;settings.status='浏览器已重启，请核对主播后重新开始';await chrome.storage.local.set({settings});});pending=task.catch(()=>{});});

function updateUpload(fn){
 const task=pending.then(async()=>{const state=await chrome.storage.local.get(['records','batch','retryAt','uploadStatus','lastUploadedAt']);const result=fn(state);await chrome.storage.local.set(state);return result;});
 pending=task.catch(()=>{});return task;
}
let uploading=false;
async function upload(force=false){
 if(uploading)return;uploading=true;
 try{
  if(!INGEST_URL){await updateUpload(s=>{s.uploadStatus='尚未配置上传服务，数据仅保存在本机';});return;}
  const endpoint=new URL(INGEST_URL);
  if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password)throw Error('HTTPS endpoint required');
  const {uploadToken}=await chrome.storage.local.get('uploadToken');
  if(!uploadToken)throw Error('Upload authorization required');
  await flush({update:updateUpload,force,post:async batch=>{
   const response=await fetch(endpoint.href,{method:'POST',redirect:'error',credentials:'omit',headers:{'Content-Type':'application/json','Authorization':'Bearer '+uploadToken},body:JSON.stringify(batch),signal:AbortSignal.timeout(15000)});
   if(!response.ok)throw Error('Upload failed');return response.json();
  }});
 }catch{await updateUpload(s=>{s.uploadStatus='上传配置或授权不可用，本机数据保留';});}
 finally{uploading=false;}
}
async function ensureAlarm(){await chrome.alarms.create('upload-metrics',{periodInMinutes:UPLOAD_PERIOD_MINUTES,delayInMinutes:UPLOAD_PERIOD_MINUTES});}
if(chrome.alarms){
 chrome.alarms.onAlarm.addListener(a=>{if(a.name==='upload-metrics')void upload();});
 chrome.runtime.onInstalled.addListener(()=>{void ensureAlarm();});
 chrome.runtime.onStartup.addListener(()=>{void ensureAlarm();void upload();});
 void chrome.alarms.get('upload-metrics').then(a=>{if(!a)void ensureAlarm();});
}
