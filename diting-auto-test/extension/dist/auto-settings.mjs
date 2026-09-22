export const TEST_TARGET = 'https://example.feishu.cn/base/REPLACE_WITH_TEST_BASE_TOKEN?table=REPLACE_WITH_TEST_TABLE_ID';
export const SETTINGS_KEY = 'ditingAutoSettingsV1';

function validBinding(binding) {
  return binding && typeof binding.authorId === 'string' && /^\d+$/.test(binding.authorId)
    && typeof binding.teacher === 'string' && binding.teacher.trim().length > 0
    && binding.teacher.length <= 100;
}

export function readSettings(stored) {
  const binding = validBinding(stored?.binding)
    ? { authorId: stored.binding.authorId, teacher: stored.binding.teacher.trim() } : null;
  return { version: 1, enabled: stored?.enabled === true && binding !== null, binding, targetUrl: TEST_TARGET };
}

export function configure(stored, input) {
  let url;
  try { url = new URL(input.pageUrl); } catch { throw new Error('请先手动打开并登录罗盘后台。'); }
  if (url.origin !== 'https://compass.jinritemai.com' || /(^|\/)(login|passport|auth)(\/|$)/i.test(url.pathname)) {
    throw new Error('请先手动打开并登录罗盘后台，不能在登录页完成设置。');
  }
  const authorId = typeof input.authorId === 'string' ? input.authorId.trim() : '';
  const teacher = typeof input.teacher === 'string' ? input.teacher.trim() : '';
  if (!/^\d+$/.test(authorId)) throw new Error('请输入数字格式的平台账号 ID。');
  if (!teacher || teacher.length > 100) throw new Error('请填写老师姓名，长度不超过 100 字。');
  return { ...readSettings(stored), enabled: false, binding: { authorId, teacher } };
}

export function setEnabled(stored, enabled) {
  if (typeof enabled !== 'boolean') throw new Error('自动开关参数无效。');
  const state = readSettings(stored);
  if (enabled && !state.binding) throw new Error('请先完成首次后台设置。');
  return { ...state, enabled };
}

export function describeStatus(stored) {
  const state = readSettings(stored);
  if (!state.binding) return { phase: 'unconfigured', message: '未设置：请先手动打开并登录后台，再填写账号和老师。' };
  if (!state.enabled) return { phase: 'off', message: '全自动开关已关闭，绑定信息已保存。' };
  return { phase: 'awaiting_verification', message: '开关已开启，等待实时数据源联调；当前尚未自动采集或上传。账号绑定也需在后台核实。' };
}

export function registerAutoSettings(chromeApi) {
  // Serialize reads and writes so two popups cannot overwrite a newer setting.
  let pending = Promise.resolve();
  chromeApi.runtime.onMessage.addListener((message, sender, reply) => {
    if (!['AUTO_GET_SETTINGS', 'AUTO_CONFIGURE', 'AUTO_SET_ENABLED'].includes(message?.type)) return false;
    if (sender.id !== chromeApi.runtime.id || sender.url !== chromeApi.runtime.getURL('popup.html')) {
      reply({ ok: false, error: '自动设置仅允许通过插件弹窗修改。' });
      return false;
    }
    const operation = pending.then(async () => {
      const stored = await chromeApi.storage.local.get(SETTINGS_KEY);
      let settings = readSettings(stored[SETTINGS_KEY]);
      if (message.type === 'AUTO_CONFIGURE') {
        if (!Number.isInteger(message.tabId)) throw new Error('请先打开后台标签页。');
        const tab = await chromeApi.tabs.get(message.tabId);
        settings = configure(settings, { authorId: message.authorId, teacher: message.teacher, pageUrl: tab.url });
      } else if (message.type === 'AUTO_SET_ENABLED') {
        settings = setEnabled(settings, message.enabled);
      }
      if (message.type !== 'AUTO_GET_SETTINGS') await chromeApi.storage.local.set({ [SETTINGS_KEY]: settings });
      return { ok: true, settings, status: describeStatus(settings) };
    });
    pending = operation.catch(() => {});
    void operation.then(reply, error => reply({ ok: false, error: error.message || String(error) }));
    return true;
  });
}
