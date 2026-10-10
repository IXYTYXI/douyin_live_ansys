import {sourceCommand} from './source-refresh.mjs';
import {flushFinishes} from './finish.mjs';
import {flush,UPLOAD_PERIOD_MINUTES} from './upload.mjs';
import {endpoint as validateEndpoint} from './endpoint.mjs';
import {parseMetrics} from './parser.mjs';
const CAP=5000;
const IDLE_UPLOAD_MS=10*60*1000;
let pending=Promise.resolve(),sourcePending=Promise.resolve();
const dashboard=url=>{try{const u=new URL(url);return u.origin==='https://anchor.douyin.com'&&u.pathname==='/anchor/dashboard';}catch{return false;}};
async function finishRun(settings,reason){
 const {finishes=[]}=await chrome.storage.local.get('finishes');
 if(settings.runId&&!settings.endedAt){
  settings.endedAt=new Date().toISOString();
  finishes.push({schema:1,kind:'finish',runId:settings.runId,teacher:settings.teacher,expectedCount:Number.isInteger(settings.capturedCount)?settings.capturedCount:null,lastCapturedAt:settings.lastAt?new Date(settings.lastAt).toISOString():null,endedAt:settings.endedAt,reason});
 }
 settings.enabled=false;delete settings.endCandidate;
 settings.status=(reason==='platform-ended'?'已确认平台停播，自动结束采集':'采集已停止')+'，正在上传尾批并确认结束';
 await chrome.storage.local.set({settings,finishes});return {settings,flushTail:true};
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
 if(['SOURCE_BIND','SOURCE_STATUS','REFRESH_SOURCE'].includes(message?.type)){
  const task=sourcePending.then(()=>sourceCommand(chrome,message,sender));sourcePending=task.catch(()=>{});
  task.then(reply,()=>reply({ok:false,error:'直播源操作失败，请重试'}));return true;
 }
 const popup=sender.id===chrome.runtime.id&&sender.url===chrome.runtime.getURL('popup.html');
 const content=sender.id===chrome.runtime.id&&sender.tab&&dashboard(sender.url);
 if(!popup&&!(content&&message.type==='SAMPLE')){reply({ok:false,error:'不允许的来源'});return false;}
 const task=pending.then(async()=>{
  const {settings={},records=[]}=await chrome.storage.local.get(['settings','records']);
  if(message.type==='STATUS'){const {uploadStatus,lastUploadedAt,ingestUrl,uploadToken,finishStatus,finishes}=await chrome.storage.local.get(['uploadStatus','lastUploadedAt','ingestUrl','uploadToken','finishStatus','finishes']);return {finishStatus,finishingCount:(finishes||[]).length,settings,count:records.length,last:records.at(-1)||null,oldestPendingAt:records[0]?.capturedAt||null,uploadConfigured:Boolean(ingestUrl&&uploadToken),uploadStatus,lastUploadedAt,ingestUrl};}
  if(message.type==='CONFIGURE_UPLOAD'){
   const ingestUrl=validateEndpoint(message.url);
   if(!await chrome.permissions.contains({origins:[new URL(ingestUrl).origin+'/*']}))throw Error('尚未授权接收地址');
   if(typeof message.token!=='string'||message.token.length<24)throw Error('上传令牌至少24字符');
   const state=await chrome.storage.local.get(['ingestUrl','batch']);
   if(state.batch&&state.ingestUrl!==ingestUrl)throw Error('先完成当前批次上传再更换地址');
   await chrome.storage.local.set({ingestUrl,uploadToken:message.token,uploadStatus:'上传已配置，每5分钟发送；10分钟无新采样自动补传'});return {};
  }
  if(message.type==='UPLOAD_NOW')return {};
  if(message.type==='EXPORT')return {schema:1,source:'anchor-visible-dashboard',records};
  if(message.type==='STOP')return finishRun(settings,'manual');
  if(message.type==='START'){
   if(settings.runId&&!settings.endedAt)throw Error('请先结束上一批采集并确认收尾，再开始新批次');
   if(records.length>=CAP)throw Error('本地记录已满，请先导出并使用新测试环境');
   const tabs=await chrome.tabs.query({active:true,currentWindow:true});const tab=tabs[0];
   if(!tab||!dashboard(tab.url))throw Error('请先打开已登录的抖音主播直播大屏');
   const teacher=String(message.teacher||'').trim();
   if(!teacher||teacher.length>60)throw Error('请输入当前主播昵称');
   // Each explicit start is a separate observation run, not an inferred platform live session.
   const next={enabled:true,teacher,tabId:tab.id,runId:crypto.randomUUID(),startedAt:Date.now(),status:'等待首个采样；请保持大屏前台可见',lastAt:null,capturedCount:0};
   await chrome.storage.local.set({settings:next});return {settings:next};
  }
  if(message.type!=='SAMPLE'||!settings.enabled||sender.tab.id!==settings.tabId)return {};
  const now=Date.now();
  const metrics=parseMetrics(String(message.metricText||'').slice(0,3000));
  const accountMatched=String(message.header||'').includes(settings.teacher);
  const endEvidence=accountMatched&&message.visible===true&&message.platformEnded===true&&!metrics;
  if(endEvidence){
   const prior=settings.endCandidate;
   if(!prior||now-prior.last>15000)settings.endCandidate={first:now,last:now,count:1};
   else if(now-prior.last>=9000){prior.last=now;prior.count++;}
   const candidate=settings.endCandidate;
   if(candidate.count>=3&&now-candidate.first>=20000)return finishRun(settings,'platform-ended');
   settings.status='检测到平台已结束提示，正在连续确认';await chrome.storage.local.set({settings});return {};
  }
  delete settings.endCandidate;
  if(!accountMatched||!metrics||metrics.online.value===null){settings.status='采集中断，尚未确认停播：请检查大屏或登录；确认直播结束后点“结束本场采集”';await chrome.storage.local.set({settings});return {};}
  if(settings.lastAt&&now-settings.lastAt<9000){await chrome.storage.local.set({settings});return {};}

  if(records.length>=CAP){settings.enabled=false;settings.status='记录已满，已停止以避免覆盖；请导出';await chrome.storage.local.set({settings});return {};}
  const gap=settings.lastAt?now-settings.lastAt:null;
  records.push({id:crypto.randomUUID(),runId:settings.runId,teacher:settings.teacher,platformSessionId:null,capturedAt:new Date(now).toISOString(),intervalMs:gap,gap:gap!==null&&gap>15000,foreground:message.visible===true,sourceUrl:'https://anchor.douyin.com/anchor/dashboard',metrics});
  if(Number.isInteger(settings.capturedCount))settings.capturedCount++;settings.lastAt=now;settings.status=message.visible?'正在取数 · 本地保存':'后台页面采样 · 可能受浏览器节流影响';
  await chrome.storage.local.set({settings,records});return {count:records.length};
 });
 pending=task.catch(()=>{});task.then(data=>{reply({ok:true,...data});if(data?.flushTail||['STOP','UPLOAD_NOW'].includes(message.type))void upload(true);},e=>reply({ok:false,error:e.message}));return true;
});
// Fail closed on browser restart: saved tab IDs are not safe account/session bindings.
chrome.runtime.onStartup.addListener(()=>{const task=pending.then(async()=>{const {settings={}}=await chrome.storage.local.get('settings');settings.enabled=false;settings.status='浏览器已重启，请核对主播后重新开始';await chrome.storage.local.set({settings,sourceBinding:null});});pending=task.catch(()=>{});return task;});

function updateUpload(fn){
 const task=pending.then(async()=>{const state=await chrome.storage.local.get(['records','batch','retryAt','uploadStatus','lastUploadedAt','finishes','finishStatus']);const result=fn(state);await chrome.storage.local.set(state);return result;});
 pending=task.catch(()=>{});return task;
}
let uploading=false;
async function upload(force=false,drain=false){
 if(uploading)return;uploading=true;
 try{
  const {ingestUrl,uploadToken}=await chrome.storage.local.get(['ingestUrl','uploadToken']);
  if(!ingestUrl){await updateUpload(s=>{s.uploadStatus='尚未配置上传服务，数据仅保存在本机';});return;}
  const endpoint=new URL(validateEndpoint(ingestUrl));
  if(!uploadToken)throw Error('Upload authorization required');
  const post=async batch=>{
   const response=await fetch(endpoint.href,{method:'POST',redirect:'error',credentials:'omit',headers:{'Content-Type':'application/json','Authorization':'Bearer '+uploadToken},body:JSON.stringify(batch),signal:AbortSignal.timeout(15000)});
   if(!response.ok){const error=Error('Upload failed');error.status=response.status;throw error;}return response.json();
  };
  for(let i=0;i<((force||drain)?17:1);i++){
   const before=await updateUpload(s=>(s.records||[]).length);if(!before)break;
   await flush({update:updateUpload,force,post});
   const after=await updateUpload(s=>(s.records||[]).length);if(after>=before)break;
  }
  await flushFinishes({update:updateUpload,post});
 }catch{await updateUpload(s=>{s.uploadStatus='上传配置或授权不可用，本机数据保留';});}
 finally{uploading=false;}
}
async function checkHealth(){
 // Serialize the trigger with sampling so a fresh sample resets the idle clock.
 const task=pending.then(async()=>{
  const {settings={},records=[],finishes=[],ingestUrl,uploadToken,retryAt=0,idleUploadAt=0}=await chrome.storage.local.get(['settings','records','finishes','ingestUrl','uploadToken','retryAt','idleUploadAt']);
  const now=Date.now(),lastAt=settings.lastAt??settings.startedAt;
  const idle=Number.isFinite(lastAt)?now-lastAt:0;
  const stale=settings.enabled&&idle>30000;
  if(chrome.action){await chrome.action.setBadgeText({text:stale?'!':''});if(stale)await chrome.action.setBadgeBackgroundColor({color:'#b45309'});}
  if(uploading||idle<IDLE_UPLOAD_MS||(!records.length&&!finishes.length)||!ingestUrl||!uploadToken||retryAt>now||now-idleUploadAt<UPLOAD_PERIOD_MINUTES*60000)return false;
  // Persist throttling across service-worker suspension; never infer a live end here.
  await chrome.storage.local.set({idleUploadAt:now});return true;
 });
 pending=task.catch(()=>{});
 if(await task)await upload(false,true);
}
async function ensureAlarm(){
 await chrome.alarms.create('upload-metrics',{periodInMinutes:UPLOAD_PERIOD_MINUTES,delayInMinutes:UPLOAD_PERIOD_MINUTES});
 await chrome.alarms.create('collector-health',{periodInMinutes:1,delayInMinutes:1});
}
if(chrome.alarms){
 chrome.alarms.onAlarm.addListener(a=>{if(a.name==='upload-metrics')return upload();if(a.name==='collector-health')return checkHealth();});
 chrome.runtime.onInstalled.addListener(()=>{void ensureAlarm();});
 chrome.runtime.onStartup.addListener(async()=>{await ensureAlarm();await upload(false,true);});
 void chrome.alarms.get('collector-health').then(a=>{if(!a)void chrome.alarms.create('collector-health',{periodInMinutes:1,delayInMinutes:1});});
 void chrome.alarms.get('upload-metrics').then(a=>{if(!a)void ensureAlarm();});
}
