export function runLabel(run){return `${run.teacher||'未命名主播'} · ${new Date(run.startedAt).toLocaleString('zh-CN')} · ${run.runId}`;}
export function setupPath(runId){if(typeof runId!=='string'||!runId.trim())throw Error('请先选择采集批次');return '/api/live/setup/'+encodeURIComponent(runId);}
