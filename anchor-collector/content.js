// Read only visible page text. No network interception, cookies, comments, or viewer records.
(()=>{
 if(window.__ditingAnchorReader)return;
 window.__ditingAnchorReader=true;
 async function sample(){
  if(location.pathname!=='/anchor/dashboard')return;
  const text=document.body.innerText;
  const start=text.indexOf('直播热度'),end=text.indexOf('直播趋势图',start);
  const headerEnd=text.indexOf('流量转化');
  const header=text.slice(0,headerEnd<0?1500:headerEnd);
  // Only an empty-state marker; never infer an end from missing metrics or elapsed time.
  const platformEnded=start<0&&!/互动评论|礼物记录/.test(text)&&text.split('\n').some(line=>/^(本场直播已结束|直播已结束)$/.test(line.trim()));
  try{await chrome.runtime.sendMessage({type:'SAMPLE',at:Date.now(),platformEnded,metricText:start>=0&&end>start?text.slice(start,end)+'直播趋势图':'',header:header.slice(0,1500),visible:document.visibilityState==='visible'});}catch{}
 }
 setInterval(sample,10000);
 sample();
})();
