// Read-only media evidence and explicit refresh of the bound source document.
(()=>{
 const matches=teacher=>{
  if(location.origin!=='https://anchor.douyin.com'||location.pathname!=='/anchor/dashboard'||typeof teacher!=='string'||!teacher.trim())return false;
  const text=document.body?.innerText||'',end=text.indexOf('流量转化');
  if(end<0)return false;
  return text.slice(0,end).split('\n').some(line=>line.trim()===teacher.trim());
 };
 let observation=null;
 const health=()=>{
  const now=Date.now(),result=state=>({state,checkedAt:now});
  if(navigator.onLine===false){observation=null;return result('offline');}
  // A custom/iframe player or multiple candidates cannot be identified reliably.
  const players=[...document.querySelectorAll('video,audio')].filter(p=>{const box=p.getBoundingClientRect();return box.width>0&&box.height>0;});
  if(players.length!==1){observation=null;return result('unknown');}
  const media=players[0];
  for(const [condition,state] of [[media.error,'error'],[media.ended,'ended'],[media.paused,'paused'],[media.muted||media.volume===0,'muted']]){
   if(condition){observation=null;return result(state);}
  }
  if(!Number.isFinite(media.currentTime)){observation=null;return result('unknown');}
  const prior=observation,reset=!prior||prior.media!==media||now-prior.lastSeen>30000||now<prior.lastSeen;
  const advancing=!reset&&media.currentTime>prior.time+.05;
  const jumped=!reset&&media.currentTime<prior.time;
  observation={media,time:media.currentTime,lastSeen:now,lastProgress:reset||advancing||jumped?now:prior.lastProgress};
  return result(advancing?'playing':now-observation.lastProgress>=15000?'stalled':'observing');
 };
 chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(sender.id!==chrome.runtime.id||!['SOURCE_IDENTIFY','SOURCE_RELOAD','SOURCE_HEALTH'].includes(message?.type))return false;
  const matched=matches(message.teacher),allowed=matched&&(message.type!=='SOURCE_RELOAD'||navigator.onLine!==false);
  reply({ok:allowed,matches:matched,...(matched&&message.type==='SOURCE_HEALTH'?{health:health()}:{})});
  if(allowed&&message.type==='SOURCE_RELOAD')setTimeout(()=>{if(matches(message.teacher)&&navigator.onLine!==false)location.reload();},50);
  return false;
 });
})();
