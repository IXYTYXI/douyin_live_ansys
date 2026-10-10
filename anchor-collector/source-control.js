// This listener only checks the chosen source and refreshes that document.
(()=>{
 const matches=teacher=>{
  if(location.origin!=='https://anchor.douyin.com'||location.pathname!=='/anchor/dashboard'||typeof teacher!=='string'||!teacher.trim())return false;
  const text=document.body?.innerText||'',end=text.indexOf('流量转化');
  if(end<0)return false;
  return text.slice(0,end).split('\n').some(line=>line.trim()===teacher.trim());
 };
 chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(sender.id!==chrome.runtime.id||!['SOURCE_IDENTIFY','SOURCE_RELOAD'].includes(message?.type))return false;
  const matched=matches(message.teacher);reply({ok:matched,matches:matched});
  if(matched&&message.type==='SOURCE_RELOAD')setTimeout(()=>{if(matches(message.teacher))location.reload();},50);
  return false;
 });
})();
