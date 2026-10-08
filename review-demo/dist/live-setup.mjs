import {channelTeachers,bindingBody} from './live-setup-model.mjs';
const $=id=>document.getElementById(id);let epoch=0;
function clearCredentials(){++epoch;$('server').value='';$('stream-key').value='';$('stream-key').type='password';$('toggle-key').textContent='显示密钥';$('toggle-key').setAttribute('aria-pressed','false');$('credentials').hidden=true;}
async function refresh(){
 clearCredentials();const token=epoch;$('refresh').disabled=true;$('status').textContent='正在读取主播…';
 try{const response=await fetch('/api/live/channels',{cache:'no-store'});if(!response.ok)throw Error('主播读取失败，请重试');const data=await response.json();if(token!==epoch)return;
 $('teachers').replaceChildren(...channelTeachers(data.channels||[]).map(teacher=>{const option=document.createElement('option');option.value=teacher;return option;}));
 $('status').textContent='首次选择或填写与插件一致的主播名，获取固定配置。以后直接在 OBS 开始推流。';
 }catch(e){if(token===epoch)$('status').textContent=e.message;}finally{$('refresh').disabled=false;}
}
$('teacher').oninput=()=>{clearCredentials();$('load').disabled=!$('teacher').value.trim();};
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
