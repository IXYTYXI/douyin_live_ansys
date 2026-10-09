import {samples} from './model.mjs';
export const metrics=[
 {key:'online',label:'在线人数',unit:'人'},
 {key:'likes',label:'点赞次数',unit:'次'},
 {key:'commentUsers',label:'评论人数',unit:'人'},
 {key:'newFollowers',label:'新增粉丝',unit:'人'},
 {key:'shares',label:'分享次数',unit:'次'},
 {key:'giftUsers',label:'送礼人数',unit:'人'},
 {key:'fanClubJoins',label:'加粉丝团',unit:'人'},
 {key:'previewOnline',label:'预览流看播',unit:'人'}
];
export const metricDefinition=key=>metrics.find(m=>m.key===key)||metrics[0];
export function metricRows(session,start,end,key){
 const raw=session.metricSamples;
 const rows=raw?raw.filter(r=>r.t>=start&&r.t<end).map(r=>{
  const m=r.metrics?.[key],value=m?.value??(key==='online'?r.value:null);
  return {t:r.t,value:typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null,approximate:m?.approximate===true};
 }):key==='online'?samples(session,start,end):[];
 const result=[];
 for(const row of rows){const prev=result.at(-1);if(prev&&row.t-prev.t>15)result.push({t:prev.t+10,value:null});result.push(row);}
 return result;
}
export function axisMaximum(rows,key){
 const value=Math.max(key==='online'?100:2,...rows.map(r=>r.value??0));
 const power=10**Math.floor(Math.log10(value));
 return [1,2,4,5,8,10].map(n=>n*power).find(n=>n>=value);
}
export function metricReading(rows,time,key){
 const row=rows.findLast(r=>r.t<=time);
 if(!row||time-row.t>15||row.value==null)return '未获取';
 return `${row.approximate?'约 ':''}${row.value.toLocaleString('zh-CN')} ${metricDefinition(key).unit}`;
}
