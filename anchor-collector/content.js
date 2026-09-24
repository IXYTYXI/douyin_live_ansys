// Read only visible page text. No network interception, cookies, comments, or viewer records.
(()=>{
 if(window.__ditingAnchorReader)return;
 window.__ditingAnchorReader=true;
 async function sample(){
  if(location.pathname!=='/anchor/dashboard')return;
  const text=document.body.innerText;
  const start=text.indexOf('直播热度'),end=text.indexOf('直播趋势图',start);
  const header=text.slice(0,text.indexOf('流量转化'));
  try{await chrome.runtime.sendMessage({type:'SAMPLE',at:Date.now(),metricText:start>=0&&end>start?text.slice(start,end)+'直播趋势图':'',header:header.slice(0,1500),visible:document.visibilityState==='visible'});}catch{}
 }
 setInterval(sample,10000);
 sample();
})();
