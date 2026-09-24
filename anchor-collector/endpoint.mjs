export function endpoint(value){
 const u=new URL(value);
 if(u.username||u.password||u.search||u.hash||u.pathname!=='/api/metrics/batches')throw Error('请输入完整的数据接收接口地址');
 if(u.protocol!=='https:'&&!(u.protocol==='http:'&&u.hostname==='127.0.0.1'))throw Error('仅支持 HTTPS 或本机测试地址');
 return u.href;
}
