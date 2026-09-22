// Old drafts used comma-separated text; new drafts keep explicit tag arrays.
export function normalizeTags(value){
 const values=Array.isArray(value)?value:typeof value==='string'?value.split(/[、，,\n]+/):[];
 return [...new Set(values.filter(v=>typeof v==='string').map(v=>v.trim()).filter(Boolean))];
}
export function mountTags(container,initial,onChange){
 let values=normalizeTags(initial);
 const chips=document.createElement('div');chips.className='tag-chips';
 const entry=document.createElement('div');entry.className='tag-entry';
 entry.hidden=true;const toggle=document.createElement('button');toggle.type='button';toggle.className='tag-toggle';toggle.textContent='＋';toggle.setAttribute('aria-label','新增关键词');toggle.onclick=()=>{entry.hidden=false;toggle.hidden=true;input.focus();};
 const input=document.createElement('input');input.type='text';input.maxLength=60;input.placeholder='输入标签';input.setAttribute('aria-label',`新增${container.dataset.label}标签`);
 const add=document.createElement('button');add.type='button';add.textContent='添加';add.setAttribute('aria-label',`添加${container.dataset.label}标签`);
 const notice=document.createElement('span');notice.className='tag-notice';notice.setAttribute('role','status');
 function draw(){chips.replaceChildren();for(const [i,value] of values.entries()){
  const chip=document.createElement('span');chip.className='tag';const text=document.createElement('span');text.textContent=value;
  const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.setAttribute('aria-label',`删除${container.dataset.label}标签：${value}`);
  remove.onclick=()=>{values.splice(i,1);draw();onChange([...values]);notice.textContent=`已删除“${value}”`;toggle.focus();};chip.append(text,remove);chips.append(chip);
 }}
 function submit(){const value=input.value.trim();if(!value){notice.textContent='请输入标签内容';input.focus();return;}if(values.includes(value)){notice.textContent='该标签已存在';input.select();return;}values.push(value);draw();input.value='';onChange([...values]);notice.textContent=`已添加“${value}”`;entry.hidden=true;toggle.hidden=false;toggle.focus();}
 input.addEventListener('keydown',e=>{if(e.key==='Escape'){entry.hidden=true;toggle.hidden=false;input.value='';notice.textContent='';toggle.focus();return;}if(e.key==='Enter'&&!e.isComposing&&e.keyCode!==229){e.preventDefault();submit();}});add.onclick=submit;
 entry.append(input,add);container.replaceChildren(chips,toggle,entry,notice);draw();
}
