// The review page may request a source refresh, never read storage or upload.
(()=>{
 if(location.origin!=='https://live-ansys.ai.lab.yc345.tv'||!['/','/index.html'].includes(location.pathname)||window.top!==window)return;
 let busy=false;
 window.addEventListener('message',async event=>{
  const m=event.data;
  if(event.source!==window||event.origin!==location.origin||m?.channel!=='diting-source-control'||m.type!=='REFRESH_SOURCE'||typeof m.requestId!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(m.requestId)||typeof m.teacher!=='string'||!m.teacher.trim()||m.teacher.length>60)return;
  const respond=result=>window.postMessage({channel:'diting-source-control',type:'SOURCE_RESULT',requestId:m.requestId,...result},location.origin);
  if(!navigator.userActivation.isActive){respond({ok:false,error:'请点击“刷新直播源”按钮后重试'});return;}
  if(busy){respond({ok:false,error:'正在请求刷新直播源，请稍候'});return;}
  busy=true;
  try{const r=await chrome.runtime.sendMessage({type:'REFRESH_SOURCE',teacher:m.teacher});respond(r?.ok===true&&r.requested===true?{ok:true,requested:true}:{ok:false,error:r?.error||'直播源未确认刷新'});}
  catch{respond({ok:false,error:'插件连接已失效，请重新加载扩展并刷新复盘页'});}
  finally{busy=false;}
 });
})();
