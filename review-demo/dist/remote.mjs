export function remoteSession(data){
 if(!data||!['synthetic-integration-test','asr-integration-test'].includes(data.source)||!Array.isArray(data.samples))throw Error('无效的测试场次响应');
 const asr=data.source==='asr-integration-test';
 const d=new Date(data.startedAt);
 if(!Number.isFinite(d.getTime()))throw Error('无效的场次时间');
 const session={id:'backend-test-'+data.id+(data.combinedTest?'-combined-v2':''),teacher:asr?'淘宝录音样本':'联调测试主播',course:asr?'公司ASR真实转写测试':'模拟上传数据',source:asr?'backend-asr':'backend-test',
 start:d.getHours()*60+d.getMinutes(),startSecond:d.getSeconds(),date:d.toLocaleDateString('zh-CN'),duration:asr?Math.max(1,data.duration):1800,
 onlineSamples:data.samples.map(r=>({t:r.t,value:r.value})),transcriptLines:asr?(data.segments||[]).filter(r=>r.state==='done').flatMap(r=>r.utterances?.length?r.utterances.map(u=>({t:r.start+u.start,end:r.start+u.end,text:u.text,speaker:u.speaker})): [{t:r.start,text:r.text}]):[],combinedTest:data.combinedTest===true,recordings:data.recordings||[],processing:asr?(data.segments||[]).some(r=>r.state!=='done'):false};
 if(session.combinedTest){
  const themes=['分数概念与课程演示','画图法解应用题','乘法练习与课堂回顾'];
  const prompts=[['先认识二分之一，再比较分数大小。','结合图形说明分数的含义。','通过课程演示回顾基础概念。'],['用画图法找出应用题里的数量关系。','请先画图，再说明列式依据。','核对应用题答案，讨论容易出错的步骤。'],['进行乘法练习，复习厘米和米的关系。','请独立完成练习，再核对计算过程。','回顾本节方法，安排课后复习。']];
  for(let t=60;t<session.duration;t+=30){const i=Math.min(2,Math.floor(t/600));session.transcriptLines.push({t,end:t+20,text:prompts[i][Math.floor(t/30)%3],topic:themes[i],synthetic:true});}
  session.transcriptLines.sort((a,b)=>a.t-b.t);
 }
 return session;
}

export async function loadTestSession(){
 const response=await fetch('/api/test/session',{cache:'no-store'});
 if(!response.ok)throw Error('后端测试接口不可用');
 return remoteSession(await response.json());
}
