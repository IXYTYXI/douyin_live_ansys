// The review page may read normalized source health or explicitly refresh; never upload.
(()=>{
 if(location.origin!=='https://live-ansys.ai.lab.yc345.tv'||!['/','/index.html'].includes(location.pathname)||window.top!==window)return;
 const busy=new Set();
 window.addEventListener('message',async event=>{
  const m=event.data;
  if(event.source!==window||event.origin!==location.origin||m?.channel!=='diting-source-control'||!['REFRESH_SOURCE','SOURCE_HEALTH'].includes(m.type)||typeof m.requestId!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(m.requestId)||typeof m.teacher!=='string'||!m.teacher.trim()||m.teacher.length>60)return;
  const respond=result=>window.postMessage({channel:'diting-source-control',type:'SOURCE_RESULT',requestId:m.requestId,...result},location.origin);
  if(m.type==='REFRESH_SOURCE'&&!navigator.userActivation.isActive){respond({ok:false,error:'请点击“刷新直播源”按钮后重试'});return;}
  if(busy.has(m.type)){respond({ok:false,error:'正在请求直播源，请稍候'});return;}
  busy.add(m.type);
  try{
   const r=await chrome.runtime.sendMessage({type:m.type,teacher:m.teacher});
   if(m.type==='SOURCE_HEALTH'&&r?.ok===true){
    const states=['playing','observing','stalled','paused','muted','offline','error','ended','unknown'];
    respond({ok:true,health:{state:states.includes(r.health?.state)?r.health.state:'unknown',checkedAt:Number.isFinite(r.health?.checkedAt)?r.health.checkedAt:null}});
   }else respond(r?.ok===true&&r.requested===true?{ok:true,requested:true}:{ok:false,error:typeof r?.error==='string'?r.error.slice(0,250):'直播源未确认请求'});
  }
  catch{respond({ok:false,error:'插件连接已失效，请重新加载扩展并刷新复盘页'});}
  finally{busy.delete(m.type);}
 });
})();
