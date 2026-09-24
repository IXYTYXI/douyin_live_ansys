const labels={online:'在线人数',previewOnline:'预览流看播',giftUsers:'送礼人数',newFollowers:'新增粉丝',commentUsers:'评论人数',likes:'点赞次数',shares:'分享次数',fanClubJoins:'加粉丝团',averageStay:'人均停留时长'};
export function parseMetrics(text){
 const start=text.indexOf('直播热度'),end=text.indexOf('直播趋势图',start);
 if(start<0||end<=start)return null;
 const block=text.slice(start,end).replace(/\s+/g,' '),result={};
 for(const [key,label] of Object.entries(labels)){
  const m=block.match(new RegExp(label+'\\s*([0-9][0-9,]*(?:\\.[0-9]+)?)(万|亿)?(?![0-9])'));
  result[key]={value:m?Number(m[1].replaceAll(',',''))*(m[2]==='万'?10000:m[2]==='亿'?1e8:1):null,raw:m?m[0].slice(label.length).trim():null,approximate:!!m?.[2],unit:key==='averageStay'?null:key==='likes'||key==='shares'?'次':'人'};
 }
 return result;
}
