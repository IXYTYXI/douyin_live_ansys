export function remoteSession(data){
 if(!data||!['synthetic-integration-test','asr-integration-test'].includes(data.source)||!Array.isArray(data.samples))throw Error('无效的测试场次响应');
 const asr=data.source==='asr-integration-test';
 const d=new Date(data.startedAt);
 if(!Number.isFinite(d.getTime()))throw Error('无效的场次时间');
 return {id:'backend-test-'+data.id,teacher:asr?'淘宝录音样本':'联调测试主播',course:asr?'公司ASR真实转写测试':'模拟上传数据',source:asr?'backend-asr':'backend-test',
 start:d.getHours()*60+d.getMinutes(),startSecond:d.getSeconds(),date:d.toLocaleDateString('zh-CN'),duration:asr?Math.max(1,data.duration):1800,
 onlineSamples:data.samples.map(r=>({t:r.t,value:r.value})),transcriptLines:asr?(data.segments||[]).filter(r=>r.state==='done').flatMap(r=>r.utterances?.length?r.utterances.map(u=>({t:r.start+u.start,end:r.start+u.end,text:u.text,speaker:u.speaker})): [{t:r.start,text:r.text}]):[],processing:asr?(data.segments||[]).some(r=>r.state!=='done'):false};
}
export async function loadTestSession(){
 const response=await fetch('/api/test/session',{cache:'no-store'});
 if(!response.ok)throw Error('后端测试接口不可用');
 return remoteSession(await response.json());
}
