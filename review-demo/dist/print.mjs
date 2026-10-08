// Capture locally: no page content is sent to a third-party rendering service.
export function pageSlices(height,limit,protectedRects=[]){
 const pages=[];let top=0;
 while(top<height){let end=Math.min(top+limit,height);
  if(end<height){let previous;do{previous=end;for(const r of protectedRects){if(r.top>top&&r.top<end&&r.bottom>end&&r.bottom-r.top<=limit)end=Math.floor(r.top);}}while(end!==previous);}
  pages.push({top,height:end-top});top=end;
 }return pages;
}
export async function printReview(root){
 const {default:html2canvas}=await import('./html2canvas.mjs');
 await document.fonts.ready;
 let protectedRects=[];
 const canvas=await html2canvas(root,{scale:2,backgroundColor:'#f4f6fb',logging:false,useCORS:true,onclone:doc=>{
  const main=doc.querySelector('main');
  // Preserve the viewport layout, while exposing content hidden by inner scrollbars.
  main.style.width=root.getBoundingClientRect().width+'px';main.style.maxWidth='none';
  doc.querySelector('#export-pdf').style.visibility='hidden';
  const transcript=doc.querySelector('#transcript');transcript.style.maxHeight='none';transcript.style.overflow='visible';
  main.querySelectorAll('details').forEach(details=>{
   const box=doc.createElement('div');box.className=details.className;
   const heading=doc.createElement('div');heading.textContent=(details.open?'▾ ':'▸ ')+details.querySelector('summary').textContent;box.append(heading);
   if(details.open)for(const child of [...details.children])if(child.tagName!=='SUMMARY')box.append(child);
   details.replaceWith(box);
  });
  main.querySelectorAll('input[type="range"]').forEach(input=>{
   const track=doc.createElement('div'),fill=doc.createElement('div'),dot=doc.createElement('span');
   const percent=Math.max(0,Math.min(100,(Number(input.value)-Number(input.min))/(Number(input.max)-Number(input.min)||1)*100));
   track.style.cssText='height:4px;background:#c3cee1;border-radius:4px;margin:5px 0 8px;position:relative;width:100%';
   fill.style.cssText='height:100%;background:#3d73f2;border-radius:4px;width:'+percent+'%';
   dot.style.cssText='position:absolute;width:10px;height:10px;border-radius:50%;background:#3d73f2;top:-3px;transform:translateX(-50%);left:'+percent+'%';track.append(fill,dot);input.replaceWith(track);
  });
  doc.querySelectorAll('textarea, input[type="text"], select').forEach(input=>{
   const text=doc.createElement('div'),style=doc.defaultView.getComputedStyle(input);
   for(const name of style)text.style.setProperty(name,style.getPropertyValue(name));
   text.textContent=input.tagName==='SELECT'?input.selectedOptions[0]?.textContent:input.value||input.placeholder;
   text.style.whiteSpace='pre-wrap';text.style.overflowWrap='anywhere';text.style.height='auto';text.style.minHeight=style.height;text.style.overflow='visible';
   input.replaceWith(text);
  });
  const offset=main.getBoundingClientRect().top;
  const add=rect=>protectedRects.push({top:rect.top-offset,bottom:rect.bottom-offset});
  main.querySelectorAll('svg,video,canvas,.summary-card').forEach(el=>add(el.getBoundingClientRect()));
  const walker=doc.createTreeWalker(main,4);let node;
  while((node=walker.nextNode())){if(!node.textContent.trim())continue;const range=doc.createRange();range.selectNodeContents(node);for(const rect of range.getClientRects())add(rect);}
 }});
 const frame=document.createElement('iframe');frame.title='复盘打印预览';frame.style.cssText='position:fixed;left:-10000px;top:0;width:1000px;height:1000px;border:0';
 document.querySelectorAll('iframe[title="复盘打印预览"]').forEach(old=>old.remove());document.body.append(frame);
 try{
  const doc=frame.contentDocument;doc.open();doc.write('<!doctype html><html><head><meta charset="UTF-8"><style>@page{size:A4;margin:8mm}body{margin:0}img{display:block;width:100%;height:auto}section{break-after:page}section:last-child{break-after:auto}</style></head><body></body></html>');doc.close();
  doc.title=document.title+' · 页面截图';
  const scale=canvas.width/root.getBoundingClientRect().width;
  const rects=protectedRects.map(r=>({top:Math.floor(r.top*scale),bottom:Math.ceil(r.bottom*scale)}));
  const limit=Math.floor(canvas.width*281/194);
  for(const slice of pageSlices(canvas.height,limit,rects)){
   const part=document.createElement('canvas');part.width=canvas.width;part.height=slice.height;
   part.getContext('2d').drawImage(canvas,0,slice.top,canvas.width,slice.height,0,0,canvas.width,slice.height);
   const image=doc.createElement('img');image.alt='复盘页面截图';image.src=part.toDataURL('image/png');
   const section=doc.createElement('section');section.append(image);doc.body.append(section);await image.decode();
  }
  frame.contentWindow.addEventListener('afterprint',()=>frame.remove(),{once:true});frame.contentWindow.focus();frame.contentWindow.print();
 }catch(error){frame.remove();throw error;}
}
