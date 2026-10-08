export function channelTeachers(channels){return [...new Set(channels.map(c=>c.teacher).filter(t=>typeof t==='string'&&t.trim()))];}
export function bindingBody(teacher){if(typeof teacher!=='string'||!teacher.trim()||teacher.trim().length>60)throw Error('请选择或填写主播名');return JSON.stringify({teacher:teacher.trim()});}
