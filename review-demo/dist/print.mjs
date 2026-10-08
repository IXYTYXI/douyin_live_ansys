const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// chartSVG must be the application's generated chart, never user-provided markup.
export function reviewPrintHTML(data){
 const text=value=>escape(value||'未填写');
 return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><title>${escape([data.teacher,data.date,data.range,'直播复盘'].filter(Boolean).join(' · '))}</title><style>
 @page{size:A4;margin:16mm}*{box-sizing:border-box}body{font:12px/1.7 -apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;color:#27364a;margin:0}h1{font-size:20px;margin:0 0 10px}h2{font-size:14px;margin:0 0 6px;break-after:avoid}p{margin:4px 0;white-space:pre-wrap;overflow-wrap:anywhere}.meta{color:#64748b;font-size:11px}section{border:1px solid #d3dceb;border-radius:6px;padding:12px;margin:12px 0}.compact{break-inside:avoid}.tags span{display:inline-block;background:#eef3ff;border-radius:4px;padding:1px 6px;margin:0 5px 4px 0}svg{display:block;width:100%;height:auto}article{margin:6px 0;break-inside:avoid;overflow-wrap:anywhere}time{color:#64748b;margin-right:8px}.transcript{border:0;padding:0}.transcript p{display:inline}.field{margin:8px 0}.field strong{display:block}footer{font-size:10px;color:#64748b;border-top:1px solid #d3dceb;margin-top:18px;padding-top:8px}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}
 </style></head><body><h1>直播复盘</h1><p><strong>${escape(data.teacher)}</strong>　${escape(data.date)}</p><p>导出时段：${escape(data.range)}</p><p class="meta">${escape(data.source)}</p><p class="meta">导出时间：${escape(data.exportedAt)} · 当前页面快照，录像不嵌入 PDF</p>
 <section class="compact"><h2>在线人数曲线</h2>${data.chartSVG||'<p>暂无人数曲线</p>'}<p class="meta">${escape(data.chartStatus)}</p></section>
 <section class="compact"><h2>AI总结（含当前编辑）</h2><p>授课主题：${text(data.theme)}</p><div class="tags">关键词：${(data.keywords||[]).map(t=>`<span>${escape(t)}</span>`).join('')||'未填写'}</div></section>
 <section><h2>运营填写 · ${escape(data.noteScope)}</h2><p class="meta">${escape(data.saveStatus)} · 导出不会自动保存或修改数据库</p><div class="field"><strong>复盘结论</strong><p>${text(data.conclusion)}</p></div><div class="field"><strong>下一场调整</strong><p>${text(data.adjustment)}</p></div></section>
 <section class="transcript"><h2>所选时段文字稿</h2>${(data.transcript||[]).map(line=>`<article><time>${escape(line.time)}</time><p>${escape(line.text)}</p></article>`).join('')||'<p>本时段暂无已加载文字稿</p>'}</section><footer>仅导出当前已加载内容；缺失数据不补造。直播中或转写处理中，内容可能尚未完整。</footer></body></html>`;
}
export function printReview(data){
 const frame=document.createElement('iframe');frame.title='复盘打印预览';frame.style.cssText='position:fixed;left:-10000px;top:0;width:794px;height:1123px;border:0';
 frame.onload=async()=>{const win=frame.contentWindow;try{await win.document.fonts.ready;win.addEventListener('afterprint',()=>frame.remove(),{once:true});win.focus();win.print();}catch{frame.remove();}};
 document.querySelectorAll('iframe[title="复盘打印预览"]').forEach(old=>old.remove());
 frame.srcdoc=reviewPrintHTML(data);document.body.append(frame);
}
