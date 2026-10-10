import {collectorHealth} from './health.mjs';
import {INGEST_URL} from './upload-config.mjs';
import {endpoint} from './endpoint.mjs';
const $=id=>document.getElementById(id);
async function send(message){const r=await chrome.runtime.sendMessage(message);if(!r.ok)throw Error(r.error);return r;}
async function refresh(){const r=await send({type:'STATUS'});if(!$('endpoint').value)$('endpoint').value=r.ingestUrl||INGEST_URL;if(!$('teacher').value)$('teacher').value=r.settings.teacher||'';$('health').textContent=[...collectorHealth(r),r.finishingCount?'待后端确认结束 '+r.finishingCount+' 批。':'',r.finishStatus||''].filter(Boolean).join('\n');const age=r.settings.lastAt?Date.now()-r.settings.lastAt:null;$('status').textContent=`${r.settings.status||'默认关闭，请先打开主播大屏'}。待上传 ${r.count} 条。${r.uploadStatus||'尚未配置上传服务'}。${r.lastUploadedAt?'最近确认上传 '+new Date(r.lastUploadedAt).toLocaleString('zh-CN')+'。':'尚无上传成功记录。'}${r.settings.runId?'当前批次 '+r.settings.runId.slice(0,8)+'。':''}${age!==null?'距上次采样 '+Math.floor(age/1000)+' 秒。':''}${r.settings.enabled&&age>30000?'采样中断，请检查页面或浏览器休眠。':''}`;}
for(const [id,type] of [['start','START'],['stop','STOP']])$(id).onclick=async()=>{try{await send({type,teacher:$('teacher').value});await refresh();}catch(e){$('status').textContent=e.message;}};
$('export').onclick=async()=>{try{const r=await send({type:'EXPORT'});const u=URL.createObjectURL(new Blob([JSON.stringify(r,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=u;a.download='diting-anchor-'+new Date().toISOString().replaceAll(':','-')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),10000);}catch(e){$('status').textContent=e.message;}};
refresh().catch(e=>$('status').textContent=e.message);setInterval(()=>refresh().catch(()=>{}),2000);

$('configure').onclick=async()=>{try{
 const url=endpoint($('endpoint').value.trim());
 const allowed=await chrome.permissions.request({origins:[new URL(url).origin+'/*']});
 if(!allowed)throw Error('未授权上传地址');
 await send({type:'CONFIGURE_UPLOAD',url,token:$('token').value});$('token').value='';await refresh();
}catch(e){$('status').textContent=e.message;}};
$('upload').onclick=async()=>{try{await send({type:'UPLOAD_NOW'});await refresh();}catch(e){$('status').textContent=e.message;}};

async function sourceStatus(){const r=await send({type:'SOURCE_STATUS'});$('source-status').textContent=r.bound?'已绑定：'+r.teacher+'。复盘页须在本机同一浏览器打开。':'尚未绑定。请打开 OBS 采集的大屏，填写主播昵称后绑定。';}
$('bind-source').onclick=async()=>{try{await send({type:'SOURCE_BIND',teacher:$('teacher').value});await sourceStatus();}catch(e){$('source-status').textContent=e.message;}};
sourceStatus().catch(()=>$('source-status').textContent='无法读取直播源绑定，请重新打开插件');
