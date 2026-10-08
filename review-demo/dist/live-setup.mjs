import {channelTeachers,bindingBody} from './live-setup-model.mjs';
const $=id=>document.getElementById(id);let epoch=0;
function clearCredentials(){++epoch;$('server').value='';$('stream-key').value='';$('stream-key').type='password';$('toggle-key').textContent='显示密钥';$('toggle-key').setAttribute('aria-pressed','false');$('credentials').hidden=true;}
async function refresh(){
 clearCredentials();const token=epoch;$('refresh').disabled=true;$('status').textContent='正在读取主播…';
 try{const response=await fetch('/api/live/channels',{cache:'no-store'});if(!response.ok)throw Error('主播读取失败，请重试');const data=await response.json();if(token!==epoch)return;
 $('teachers').replaceChildren(...channelTeachers(data.channels||[]).map(teacher=>{const option=document.createElement('option');option.value=teacher;return option;}));
 $('status').textContent='首次选择或填写与插件一致的主播名，获取固定配置。以后直接在 OBS 开始推流。';
 }catch(e){if(token===epoch)$('status').textContent=e.message;}finally{$('refresh').disabled=false;if(token===epoch)$('load').disabled=!$('teacher').value.trim();}
}
$('teacher').oninput=()=>{$('preflight-status').textContent='主播已更改，请重新检查。';clearCredentials();$('load').disabled=!$('teacher').value.trim();};
$('refresh').onclick=refresh;
$('load').onclick=async()=>{
 const teacher=$('teacher').value.trim();if(!teacher)return;clearCredentials();const token=epoch;$('load').disabled=true;$('status').textContent='正在获取固定配置…';
 try{const response=await fetch('/api/live/channels',{method:'POST',headers:{'Content-Type':'application/json'},body:bindingBody(teacher),cache:'no-store'});if(!response.ok)throw Error('配置获取失败，请重试');const data=await response.json();if(token!==epoch||$('teacher').value.trim()!==teacher)return;
 if(!data.server||!data.streamKey)throw Error('配置不完整，请重试');$('server').value=data.server;$('stream-key').value=data.streamKey;$('chosen').textContent=data.teacher+' · 固定推流入口';$('credentials').hidden=false;$('status').textContent='填入 OBS 后可持续使用，无需每场重新配置。';
 }catch(e){if(token===epoch)$('status').textContent=e.message;}finally{if(token===epoch)$('load').disabled=!$('teacher').value.trim();}
};
$('toggle-key').onclick=()=>{const visible=$('stream-key').type==='password';$('stream-key').type=visible?'text':'password';$('toggle-key').textContent=visible?'隐藏密钥':'显示密钥';$('toggle-key').setAttribute('aria-pressed',String(visible));};
for(const [button,input,label] of [['copy-server','server','服务器'],['copy-key','stream-key','密钥']])$(button).onclick=async()=>{if(!$(input).value)return;try{await navigator.clipboard.writeText($(input).value);$('status').textContent=label+'已复制';}catch{$('status').textContent='浏览器无法复制，请手动选择对应字段复制';}};
window.addEventListener('pagehide',clearCredentials);
refresh();

$('preflight').onclick=async()=>{
 const teacher=$('teacher').value.trim();if(!teacher){$('preflight-status').textContent='请先填写与插件一致的主播名。';return;}
 const token=epoch;$('preflight').disabled=true;$('preflight-status').textContent='正在查询服务器…';
 try{const response=await fetch('/api/collection-status',{cache:'no-store'});if(!response.ok)throw Error();const data=await response.json();if(token!==epoch)return;
 const rows=data.runs.filter(r=>r.teacher===teacher),latest=rows[0];
 $('preflight-status').textContent='服务器查询可用。\n'+(latest?`找到同名采集批次，最近入库：${new Date(latest.lastReceivedAt).toLocaleString('zh-CN')}。\n`+(Date.now()-Date.parse(latest.lastCapturedAt)<360000?'近6分钟有采样记录；不代表OBS已经推流。':'没有近6分钟的采样：开播后开启插件并确认一次上传。'):'最近20个采集批次中没有这个昵称，请核对插件绑定名称。')+'\n仍需在插件确认上传配置、待上传数量；OBS推流是否正常需开始推流后检查复盘页。';
 }catch{if(token===epoch)$('preflight-status').textContent='服务器查询失败，暂不能确认数据接收情况，请检查网络或网页登录。';}finally{$('preflight').disabled=false;}
};
