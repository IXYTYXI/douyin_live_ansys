export function remoteSession(data){
 if(!data||data.source!=='synthetic-integration-test'||!Array.isArray(data.samples))throw Error('无效的测试场次响应');
 const d=new Date(data.startedAt);
 if(!Number.isFinite(d.getTime()))throw Error('无效的场次时间');
 return {id:'backend-test-'+data.id,teacher:'联调测试主播',course:'模拟上传数据',source:'backend-test',
 start:d.getHours()*60+d.getMinutes(),startSecond:d.getSeconds(),date:d.toLocaleDateString('zh-CN'),duration:1800,
 onlineSamples:data.samples.map(r=>({t:r.t,value:r.value})),transcriptLines:[]};
}
export async function loadTestSession(){
 const response=await fetch('/api/test/session',{cache:'no-store'});
 if(!response.ok)throw Error('后端测试接口不可用');
 return remoteSession(await response.json());
}
