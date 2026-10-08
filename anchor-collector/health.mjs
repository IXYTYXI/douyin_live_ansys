export function collectorHealth(state,now=Date.now()){
 const {settings={},count=0,uploadConfigured=false,oldestPendingAt}=state,lines=[];
 if(!uploadConfigured)lines.push('上传未配置完整：记录仅存本机，请检查上传设置。');
 if(settings.enabled){
  if(!settings.lastAt&&now-(settings.startedAt||now)>30000)lines.push('超过30秒未收到首条采样：刷新主播大屏，核对昵称和登录状态。');
  else if(settings.lastAt&&now-settings.lastAt>30000)lines.push('采样已超过30秒未更新：检查大屏、网络或电脑休眠。');
  else lines.push(settings.lastAt?'最近有采样；服务器接收情况以确认上传时间为准。':'等待首条采样，尚不能确认取数正常。');
 }else lines.push(count?'采集已停止，仍有尾批待上传：请点击立即上传，确认归零后再关闭浏览器。':settings.lastAt?'本地待上传队列已清空；录像、ASR和总结请到网页确认。':'尚无采样，队列为空不表示链路已验证。');
 if(count&&oldestPendingAt&&now-Date.parse(oldestPendingAt)>360000)lines.push('上传积压超过6分钟：检查上传错误提示，记录仍保留在本机。');
 return lines;
}
