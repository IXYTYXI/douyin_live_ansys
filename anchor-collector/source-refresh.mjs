// Browser-tab control is independent of metric collection and upload.
const DASHBOARD='https://anchor.douyin.com/anchor/dashboard';
const REVIEW='https://live-ansys.ai.lab.yc345.tv';
function dashboard(url){try{const u=new URL(url);return u.origin+u.pathname===DASHBOARD;}catch{return false;}}
function reviewPage(sender){try{const u=new URL(sender.url);return sender.frameId===0&&sender.tab&&u.origin===REVIEW&&['/','/index.html'].includes(u.pathname);}catch{return false;}}
export async function sourceCommand(chrome,message,sender){
 const own=sender.id===chrome.runtime.id,popup=own&&sender.url===chrome.runtime.getURL('popup.html');
 const fail=error=>({ok:false,error});
 if(!popup&&!(own&&reviewPage(sender)&&message.type==='REFRESH_SOURCE'))return fail('不允许的来源');
 try{
  const {sourceBinding}=await chrome.storage.local.get('sourceBinding');
  if(message.type==='SOURCE_STATUS')return {ok:true,bound:Boolean(sourceBinding),teacher:sourceBinding?.teacher||''};
  const teacher=typeof message.teacher==='string'?message.teacher.trim():'';
  if(!teacher||teacher.length>60)return fail('请填写与直播源页面一致的主播昵称');
  if(message.type==='SOURCE_BIND'){
   const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
   if(!tab||!dashboard(tab.url)||tab.pendingUrl)return fail('请在 OBS 采集的抖音主播大屏中绑定');
   const check=await chrome.tabs.sendMessage(tab.id,{type:'SOURCE_IDENTIFY',teacher},{frameId:0});
   if(!check?.ok||!check.matches)return fail('当前大屏昵称不匹配或未加载，请核对后再绑定');
   await chrome.storage.local.set({sourceBinding:{teacher,tabId:tab.id,lastReloadAt:null}});
   return {ok:true,bound:true,teacher};
  }
  if(!sourceBinding)return fail('请在推流电脑的插件中先绑定 OBS 直播源页面');
  if(sourceBinding.teacher!==teacher)return fail('已绑定主播与当前复盘场次不一致，未刷新任何页面');
  const tab=await chrome.tabs.get(sourceBinding.tabId);
  if(!dashboard(tab.url)||tab.pendingUrl)return fail('绑定页面已跳转或正在加载，请回到直播大屏重新绑定');
  if(sourceBinding.lastReloadAt!=null&&Date.now()-sourceBinding.lastReloadAt<30000)return fail('刚刚已请求刷新，请等待30秒并检查直播源声音');
  const check=await chrome.tabs.sendMessage(tab.id,{type:'SOURCE_IDENTIFY',teacher},{frameId:0});
  if(!check?.ok||!check.matches)return fail('无法确认直播源主播身份，请在源页面检查登录和昵称');
  // Recheck identity inside the source document immediately before reloading.
  const result=await chrome.tabs.sendMessage(tab.id,{type:'SOURCE_RELOAD',teacher},{frameId:0});
  if(!result?.ok||!result.matches)return fail('直播源状态已变化，未执行刷新');
  await chrome.storage.local.set({sourceBinding:{...sourceBinding,lastReloadAt:Date.now()}});
  return {ok:true,requested:true};
 }catch{return fail('无法连接已绑定的直播源页面，请检查标签页并更新插件后重新绑定');}
}
