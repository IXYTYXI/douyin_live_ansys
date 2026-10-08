// Persistent outbox, serialized with sampling. A finish never substitutes for sample ACKs.
export async function flushFinishes({update,post}){
 const events=await update(s=>structuredClone(s.finishes||[]));
 for(const event of events){
  if(await update(s=>(s.records||[]).some(r=>r.runId===event.runId)))continue;
  try{const ack=await post(event);if(ack.runId!==event.runId||ack.finished!==true)throw Error('invalid finish acknowledgment');
   await update(s=>{s.finishes=(s.finishes||[]).filter(e=>e.runId!==event.runId);s.finishStatus='批次 '+event.runId.slice(0,8)+'：'+(ack.verified?'后端已确认采集结束，数量与最后采样时间一致。':'后端已登记结束；旧批次缺少总数，无法核验完整性。');});
  }catch{await update(s=>{s.finishStatus='结束确认未成功，记录已保留，下次上传时重试。';});}
 }
}
