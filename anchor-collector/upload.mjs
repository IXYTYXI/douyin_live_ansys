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
 }catch(error){
  const reason=({400:'数据格式被拒绝',401:'上传凭证无效',403:'上传权限不足',409:'批次或记录ID冲突',413:'上传批次过大',429:'服务限流',500:'接收服务异常',502:'接收服务不可用',503:'接收服务暂不可用'})[error?.status]||'网络异常或回执不匹配';
  await update(state=>{state.retryAt=now+300000;state.uploadStatus=reason+'；上传未确认，保留原批次，5分钟后重试';});
 }
}
