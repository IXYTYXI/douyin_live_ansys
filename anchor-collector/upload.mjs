export const UPLOAD_PERIOD_MINUTES=5;
// update(fn) must serialize read/modify/write against the same store used by sampling.
export async function flush({update,post,now=Date.now(),force=false}){
 const batch=await update(state=>{
  if(!force&&(state.retryAt||0)>now)return null;
  if(!state.batch){const rows=(state.records||[]).slice(0,300);if(!rows.length)return null;state.batch={schema:1,batchId:crypto.randomUUID(),records:rows};}
  return structuredClone(state.batch);
 });
 if(!batch)return;
 try{
  const ack=await post(batch);
  if(ack?.batchId!==batch.batchId||!Array.isArray(ack.acceptedIds))throw Error('Invalid acknowledgment');
  const sent=new Set(batch.records.map(r=>r.id));
  if(!ack.acceptedIds.every(id=>sent.has(id)))throw Error('Unknown acknowledged record');
  if(!ack.acceptedIds.length)throw Error('No records acknowledged');
  await update(state=>{
   if(state.batch?.batchId!==batch.batchId)return;
   const accepted=new Set(ack.acceptedIds);
   state.records=(state.records||[]).filter(r=>!accepted.has(r.id));
   state.batch=null;state.retryAt=0;state.uploadStatus='已确认上传 '+accepted.size+' 条';state.lastUploadedAt=now;
  });
 }catch{
  await update(state=>{state.retryAt=now+300000;state.uploadStatus='上传未确认，保留原批次，5分钟后重试';});
 }
}
