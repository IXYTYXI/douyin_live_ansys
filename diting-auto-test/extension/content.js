(() => {
  const HOST_ID = 'baiying-capture-overlay-host';
  const DEFAULT_FEISHU_TABLE_URL = 'https://example.feishu.cn/base/REPLACE_WITH_TEST_BASE_TOKEN?table=REPLACE_WITH_TEST_TABLE_ID&view=REPLACE_WITH_TEST_VIEW_ID';
  const DEFAULT_FEISHU_TABLE_ID = 'REPLACE_WITH_TEST_TABLE_ID';

  function copyText(text) {
    return navigator.clipboard.writeText(text).catch(() => {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.append(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    });
  }

  function formatShanghaiDateTime(value) {
    const parts = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(value));
    const part = (type) => parts.find((item) => item.type === type)?.value || '';
    return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}:${part('second')}`;
  }

  function todayInShanghai() {
    const parts = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const part = (type) => parts.find((item) => item.type === type)?.value || '';
    return `${part('year')}-${part('month')}-${part('day')}`;
  }

  function currentTimeInShanghai(value = new Date()) {
    return formatShanghaiDateTime(value).slice(11);
  }

  function normalizeClockInput(value, finalize = false) {
    const normalized = value.replace(/：/g, ':').replace(/\s+/g, '').trim();
    if (!finalize) return normalized;
    const match = normalized.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
    if (!match) return normalized;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    const second = Number(match[3] ?? '0');
    if (hour > 23 || minute > 59 || second > 59) return normalized;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
  }

  function displayCellValue(value) {
    if (value === null) return '未获取';
    if (typeof value === 'string') return value || '—';
    return JSON.stringify(value);
  }

  function parseDateInput(value) {
    const match = value.trim().match(/^(\d{4})[-/](\d{2})[-/](\d{2})$/);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const candidate = new Date(Date.UTC(year, month - 1, day));
    if (
      candidate.getUTCFullYear() !== year
      || candidate.getUTCMonth() !== month - 1
      || candidate.getUTCDate() !== day
    ) return null;
    return `${match[1]}-${match[2]}-${match[3]}`;
  }

  function addCalendarDays(value, days) {
    const parsed = parseDateInput(value);
    if (!parsed) return '';
    const [year, month, day] = parsed.split('-').map(Number);
    const candidate = new Date(Date.UTC(year, month - 1, day + days));
    return [
      candidate.getUTCFullYear(),
      String(candidate.getUTCMonth() + 1).padStart(2, '0'),
      String(candidate.getUTCDate()).padStart(2, '0'),
    ].join('-');
  }

  function clockToSeconds(value) {
    const match = value.match(/^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/);
    return match
      ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
      : null;
  }

  function normalizeFeishuTableUrl(value) {
    let parsed;
    try {
      parsed = new URL(value.trim());
    } catch {
      throw new Error('飞书表格地址不是有效 URL。');
    }
    const host = parsed.hostname.toLowerCase();
    const allowedHost = host === 'feishu.cn'
      || host.endsWith('.feishu.cn')
      || host === 'larksuite.com'
      || host.endsWith('.larksuite.com');
    if (parsed.protocol !== 'https:' || !allowedHost) {
      throw new Error('仅支持飞书或 Lark 的 HTTPS 多维表格地址。');
    }
    const tableId = parsed.searchParams.get('table');
    if (!/^tbl[A-Za-z0-9]+$/.test(tableId || '')) {
      throw new Error('飞书表格地址缺少有效的 table 参数。');
    }
    return parsed.toString();
  }

  async function storedFeishuTableUrl() {
    const stored = await chrome.storage.local.get('defaultFeishuTableUrl');
    const value = typeof stored.defaultFeishuTableUrl === 'string'
      ? stored.defaultFeishuTableUrl.trim()
      : '';
    if (value) {
      try {
        const parsed = new URL(value);
        if (parsed.searchParams.get('table') === DEFAULT_FEISHU_TABLE_ID) return value;
      } catch {
        // Invalid saved values are replaced with the current table below.
      }
    }
    await chrome.storage.local.set({ defaultFeishuTableUrl: DEFAULT_FEISHU_TABLE_URL });
    return DEFAULT_FEISHU_TABLE_URL;
  }

  function render(result) {
    document.getElementById(HOST_ID)?.remove();
    const host = document.createElement('div');
    host.id = HOST_ID;
    const shadow = host.attachShadow({ mode: 'closed' });
    const successful = result.fields.filter((field) => field.status === 'success').length;
    const copyData = {
      '直播间ID': String(result.liveRoomId),
      '账号ID': result.authorId ? String(result.authorId) : null,
    };
    result.fields.forEach((field) => {
      copyData[field.name] = field.status === 'success' ? field.value : null;
    });
    copyData['直播结束时间'] = formatShanghaiDateTime(result.capturedAt);
    const copyValue = JSON.stringify(copyData, null, 2);
    const diagnosticSources = result.sources.filter((source) => source.status !== 'success');
    const hasDiagnostics = diagnosticSources.length > 0 || !result.authorId || Boolean(result.screenshotError);
    const diagnosticValue = JSON.stringify({
      liveRoomId: result.liveRoomId,
      authorId: result.authorId || null,
      screenshot: result.professionalScreenshot
        ? {
          filename: result.professionalScreenshot.filename,
          mimeType: result.professionalScreenshot.mimeType,
          capturedAt: result.professionalScreenshot.capturedAt,
        }
        : null,
      screenshotError: result.screenshotError || null,
      sources: diagnosticSources.map((source) => ({
        source: source.source,
        status: source.status,
        error: source.error,
        missingFields: source.fields.filter((field) => field.status === 'missing').map((field) => field.name),
        responses: source.diagnostics || [],
      })),
    }, null, 2);

    const style = document.createElement('style');
    style.textContent = `
      :host { all: initial; }
      .panel { position: fixed; z-index: 2147483647; top: 16px; right: 16px; width: 410px; max-height: calc(100vh - 32px); display: flex; flex-direction: column; overflow: hidden; border: 1px solid #dededbcc; border-radius: 14px; background: #ffffffe0; color: #181818; box-shadow: 0 16px 48px #00000024; opacity: .86; backdrop-filter: blur(12px) saturate(120%); -webkit-backdrop-filter: blur(12px) saturate(120%); transition: opacity .16s ease; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif; }
      .panel:hover, .panel:focus-within { opacity: .97; }
      .head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 15px 16px 12px; border-bottom: 1px solid #ececea; }
      h2 { margin: 0; font-size: 16px; }
      .meta { margin-top: 3px; color: #777; font-size: 11px; }
      .close { width: 28px; height: 28px; border: 0; border-radius: 7px; background: #f1f1ef; color: #555; cursor: pointer; font-size: 17px; }
      .sources { display: flex; gap: 6px; padding: 10px 16px; border-bottom: 1px solid #ececea; }
      .source { padding: 4px 7px; border-radius: 999px; background: #f1f1ef; color: #666; font-size: 10px; }
      .source.success { background: #e7f5ec; color: #177245; }
      .source.partial { background: #fff3dd; color: #945d00; }
      .source.failed { background: #fdecea; color: #b42318; }
      .list { overflow: auto; padding: 0 16px; }
      .row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 10px 0; border-bottom: 1px solid #efefed; }
      .name { min-width: 0; color: #555; font-size: 12px; line-height: 1.4; }
      .source-name { margin-top: 2px; color: #aaa; font-size: 10px; }
      .value { font-size: 13px; font-weight: 650; font-variant-numeric: tabular-nums; }
      .value.missing { color: #b42318; font-weight: 500; }
      .footer { padding: 12px 16px 15px; border-top: 1px solid #ececeacc; background: #fafaf8d9; }
      .copy { width: 100%; padding: 11px 14px; border: 0; border-radius: 9px; background: #181818; color: #fff; cursor: pointer; font: inherit; font-size: 13px; font-weight: 650; }
      .submit-feishu { width: 100%; margin-top: 8px; padding: 11px 14px; border: 1px solid #181818; border-radius: 9px; background: #fff; color: #181818; cursor: pointer; font: inherit; font-size: 13px; font-weight: 650; }
      .diagnostic { width: 100%; margin-top: 7px; padding: 9px 12px; border: 1px solid #ddd; border-radius: 9px; background: #fff; color: #555; cursor: pointer; font: inherit; font-size: 12px; }
      button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid #3f6fef; outline-offset: 2px; }
      .submit-layer { position: fixed; z-index: 2147483647; inset: 0; display: none; align-items: center; justify-content: center; padding: 28px; background: #111827a8; backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif; }
      .submit-layer.open { display: flex; }
      .submit-dialog { width: min(1040px, 100%); max-height: calc(100vh - 56px); display: flex; flex-direction: column; overflow: hidden; border: 1px solid #ffffff38; border-radius: 18px; background: #f8f9fb; color: #181818; box-shadow: 0 28px 90px #0000004d; }
      .submit-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 20px 22px 16px; border-bottom: 1px solid #e4e6eb; background: #fff; }
      .submit-head h3 { margin: 0; font-size: 18px; }
      .submit-subtitle { margin-top: 4px; color: #777; font-size: 12px; }
      .submit-close { width: 32px; height: 32px; border: 0; border-radius: 8px; background: #f0f1f3; color: #555; cursor: pointer; font-size: 19px; }
      .submit-body { min-height: 0; overflow: auto; padding: 20px 22px; }
      .form-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-bottom: 18px; }
      .form-field { min-width: 0; }
      .form-field label { display: block; margin-bottom: 6px; color: #555; font-size: 12px; font-weight: 600; }
      .form-field input, .form-field select { width: 100%; height: 40px; box-sizing: border-box; border: 1px solid #d8dbe2; border-radius: 9px; background: #fff; color: #181818; padding: 0 11px; font: inherit; font-size: 13px; }
      .form-field input::placeholder { color: #a6a9b0; }
      .time-picker-field { position: relative; }
      .time-picker-input { cursor: text; font-variant-numeric: tabular-nums; }
      .end-time-composite { display: grid; grid-template-columns: 112px minmax(0, 1fr); gap: 7px; }
      .end-time-composite > select { padding: 0 8px; font-size: 12px; }
      .time-wheel-popover { position: absolute; z-index: 20; top: calc(100% + 7px); left: 0; width: 286px; box-sizing: border-box; overflow: hidden; border: 1px solid #d8dbe2; border-radius: 12px; background: #fff; box-shadow: 0 18px 46px #1118272e; }
      .end-time-composite .time-wheel-popover { right: 0; left: auto; }
      .time-wheel-popover[hidden] { display: none; }
      .time-wheel-title { padding: 10px 12px 8px; border-bottom: 1px solid #eceef1; color: #555; font-size: 12px; font-weight: 650; }
      .time-wheel-columns { position: relative; display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; padding: 0 10px; }
      .time-wheel-columns::after { content: ""; position: absolute; z-index: 0; top: 79px; right: 10px; left: 10px; height: 36px; border-radius: 7px; background: #eef3ff; pointer-events: none; }
      .time-wheel-column { position: relative; z-index: 1; min-width: 0; }
      .time-wheel-column-label { height: 25px; display: grid; place-items: end center; color: #999; font-size: 10px; }
      .time-wheel-list { height: 144px; overflow-x: hidden; overflow-y: auto; padding: 54px 0; box-sizing: border-box; scroll-snap-type: y mandatory; scrollbar-width: none; overscroll-behavior: contain; }
      .time-wheel-list::-webkit-scrollbar { display: none; }
      .time-wheel-option { width: 100%; height: 36px; display: grid; place-items: center; padding: 0; border: 0; scroll-snap-align: center; background: transparent; color: #777; cursor: pointer; font: 13px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
      .time-wheel-option.selected { color: #1f4fc4; font-weight: 750; }
      .time-wheel-actions { display: flex; align-items: center; justify-content: flex-end; gap: 7px; padding: 9px 10px 10px; border-top: 1px solid #eceef1; }
      .time-wheel-actions button { min-width: 56px; padding: 7px 10px; border-radius: 7px; cursor: pointer; font: inherit; font-size: 11px; font-weight: 650; }
      .time-wheel-now, .time-wheel-cancel { border: 1px solid #d8dbe2; background: #fff; color: #555; }
      .time-wheel-confirm { border: 1px solid #315fd6; background: #315fd6; color: #fff; }
      .preview-title { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 0 0 8px; }
      .preview-title strong { font-size: 13px; }
      .preview-count { color: #888; font-size: 11px; }
      .screenshot-card { display: grid; grid-template-columns: minmax(0, 1fr) 240px; gap: 16px; align-items: center; margin-bottom: 18px; padding: 12px; border: 1px solid #e0e2e7; border-radius: 10px; background: #fff; }
      .screenshot-copy strong { display: block; margin-bottom: 5px; font-size: 13px; }
      .screenshot-copy span { display: block; color: #777; font-size: 11px; line-height: 1.55; overflow-wrap: anywhere; }
      .screenshot-frame { height: 128px; display: grid; place-items: center; overflow: hidden; border: 1px solid #e0e2e7; border-radius: 8px; background: #f1f3f6; }
      .screenshot-frame img { width: 100%; height: 100%; display: none; object-fit: contain; cursor: zoom-in; }
      .screenshot-frame img.ready { display: block; }
      .screenshot-empty { padding: 12px; color: #9a5b00; font-size: 11px; line-height: 1.5; text-align: center; }
      .target-card { margin-top: 16px; padding: 12px; border: 1px solid #e0e2e7; border-radius: 10px; background: #fff; }
      .target-card label { display: block; margin-bottom: 6px; color: #555; font-size: 12px; font-weight: 600; }
      .target-card input[type="url"] { width: 100%; height: 40px; box-sizing: border-box; border: 1px solid #d8dbe2; border-radius: 9px; background: #fff; color: #181818; padding: 0 11px; font: inherit; font-size: 12px; }
      .default-target { display: flex !important; align-items: center; gap: 7px; margin: 9px 0 0 !important; color: #666 !important; font-weight: 500 !important; cursor: pointer; }
      .default-target input { width: 15px; height: 15px; margin: 0; }
      .table-wrap { overflow: auto; max-height: min(46vh, 470px); border: 1px solid #e0e2e7; border-radius: 10px; background: #fff; }
      .preview-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 12px; }
      .preview-table th { position: sticky; top: 0; z-index: 1; padding: 10px 12px; border-bottom: 1px solid #e0e2e7; background: #f1f3f6; color: #666; text-align: left; font-weight: 650; }
      .preview-table th:first-child { width: 42%; }
      .preview-table td { padding: 9px 12px; border-bottom: 1px solid #eef0f3; color: #333; line-height: 1.45; overflow-wrap: anywhere; }
      .preview-table tr:last-child td { border-bottom: 0; }
      .preview-table td:last-child { font-variant-numeric: tabular-nums; }
      .preview-table tr.subtracted td { background: #fff8df; }
      .preview-table tr.subtracted td:first-child::after { content: " 已扣减"; margin-left: 6px; color: #9a6500; font-size: 10px; }
      .submit-foot { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 22px 18px; border-top: 1px solid #e4e6eb; background: #fff; }
      .submit-note { min-height: 18px; color: #777; font-size: 12px; }
      .submit-note.error { color: #b42318; }
      .submit-note.success { color: #177245; }
      .submit-actions { display: flex; gap: 9px; flex: 0 0 auto; }
      .secondary-action, .primary-action { min-width: 108px; padding: 10px 15px; border-radius: 9px; cursor: pointer; font: inherit; font-size: 13px; font-weight: 650; }
      .secondary-action { border: 1px solid #d8dbe2; background: #fff; color: #444; }
      .primary-action { border: 1px solid #181818; background: #181818; color: #fff; }
      .bridge-error-layer { position: fixed; z-index: 2147483647; inset: 0; display: grid; place-items: center; padding: 24px; background: #111827bd; backdrop-filter: blur(9px); -webkit-backdrop-filter: blur(9px); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif; }
      .bridge-error-card { width: min(470px, 100%); overflow: hidden; border: 1px solid #ffffff38; border-radius: 16px; background: #fff; color: #181818; box-shadow: 0 28px 90px #00000052; }
      .bridge-error-body { padding: 22px 22px 18px; }
      .bridge-error-icon { width: 38px; height: 38px; display: grid; place-items: center; margin-bottom: 14px; border-radius: 11px; background: #fff1ef; color: #b42318; font-size: 22px; font-weight: 750; }
      .bridge-error-card h4 { margin: 0 0 8px; font-size: 18px; line-height: 1.35; }
      .bridge-error-message { margin: 0; color: #555; font-size: 13px; line-height: 1.7; white-space: pre-wrap; }
      .bridge-error-detail { margin-top: 14px; border: 1px solid #e2e4e8; border-radius: 9px; background: #f7f8fa; }
      .bridge-error-detail summary { padding: 9px 11px; color: #666; cursor: pointer; font-size: 12px; }
      .bridge-error-detail pre { max-height: 180px; margin: 0; overflow: auto; border-top: 1px solid #e2e4e8; padding: 10px 11px; color: #555; font: 11px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
      .bridge-error-actions { display: flex; justify-content: flex-end; gap: 9px; padding: 14px 22px 18px; border-top: 1px solid #eceef1; background: #fafbfc; }
      .bridge-error-actions button { min-width: 96px; padding: 10px 14px; border-radius: 9px; cursor: pointer; font: inherit; font-size: 13px; font-weight: 650; }
      .bridge-error-cancel { border: 1px solid #d8dbe2; background: #fff; color: #444; }
      .bridge-error-confirm { border: 1px solid #181818; background: #181818; color: #fff; }
      .bridge-error-actions button:disabled { cursor: wait; opacity: .62; }
      @media (max-width: 850px) { .form-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .screenshot-card { grid-template-columns: 1fr; } .screenshot-frame { height: 180px; } }
      @media (max-width: 560px) { .submit-layer { padding: 10px; } .submit-dialog { max-height: calc(100vh - 20px); } .form-grid { grid-template-columns: 1fr; } .submit-foot { align-items: stretch; flex-direction: column; } .submit-actions { width: 100%; } .secondary-action, .primary-action { flex: 1; } }
    `;

    const panel = document.createElement('section');
    panel.className = 'panel';
    const sourceBadges = `${result.sources.map((source) => `<span class="source ${source.status}">${source.source}</span>`).join('')}<span class="source ${result.professionalScreenshot ? 'success' : 'failed'}">专业版截图</span>`;
    const rows = result.fields.map((field) => `
      <div class="row">
        <div><div class="name"></div><div class="source-name"></div></div>
        <div class="value ${field.status === 'missing' ? 'missing' : ''}"></div>
      </div>`).join('');
    panel.innerHTML = `
      <div class="head"><div><h2>直播数据汇总</h2><div class="meta">直播间 ${result.liveRoomId} · 账号 ${result.authorId || '未获取'} · ${successful}/${result.fields.length} 个字段</div></div><button class="close" aria-label="关闭">×</button></div>
      <div class="sources">${sourceBadges}</div>
      <div class="list">${rows}</div>
      <div class="footer"><button class="copy">复制全部数据</button><button class="submit-feishu">一键提交飞书</button>${hasDiagnostics ? '<button class="diagnostic">复制诊断信息</button>' : ''}</div>`;

    const submitLayer = document.createElement('div');
    submitLayer.className = 'submit-layer';
    submitLayer.setAttribute('role', 'dialog');
    submitLayer.setAttribute('aria-modal', 'true');
    submitLayer.setAttribute('aria-labelledby', 'baiying-submit-title');
    submitLayer.innerHTML = `
      <section class="submit-dialog">
        <div class="submit-head">
          <div><h3 id="baiying-submit-title">提交飞书数据确认</h3><div class="submit-subtitle">补充场次信息并核对本次采集数据</div></div>
          <button class="submit-close" aria-label="关闭">×</button>
        </div>
        <div class="submit-body">
          <div class="form-grid">
            <div class="form-field"><label for="submit-date">直播日期</label><input id="submit-date" name="date" type="date"></div>
            <div class="form-field"><label for="submit-anchor">主播名称</label><input id="submit-anchor" name="anchor" placeholder="请输入主播名称"></div>
            <div class="form-field"><label for="submit-operator">直播负责人</label><input id="submit-operator" name="operator" placeholder="请输入直播负责人姓名"></div>
            <div class="form-field"><label for="submit-status">直播状态</label><select id="submit-status" name="status"><option value="整场">整场</option><option value="断播">断播</option><option value="重开">重开</option></select></div>
            <div class="form-field">
              <label for="submit-live-start">直播开始时间</label>
              <div class="time-picker-field"><input class="time-picker-input" id="submit-live-start" name="live-start-time" inputmode="numeric" maxlength="8" placeholder="HH:MM:SS" aria-label="直播开始时间" required></div>
            </div>
            <div class="form-field">
              <label for="submit-live-end">直播结束时间</label>
              <div class="end-time-composite">
                <select name="end-day-offset" aria-label="直播结束日期"><option value="0">当天</option><option value="1">次日</option></select>
                <div class="time-picker-field"><input class="time-picker-input" id="submit-live-end" name="live-end-time" inputmode="numeric" maxlength="8" placeholder="HH:MM:SS" aria-label="直播结束时间" required></div>
              </div>
            </div>
          </div>
          <div class="screenshot-card">
            <div class="screenshot-copy"><strong>专业版大屏截图</strong><span class="screenshot-status"></span><span class="screenshot-filename"></span></div>
            <div class="screenshot-frame"><img alt="专业版大屏截图预览"><div class="screenshot-empty"></div></div>
          </div>
          <div class="preview-title"><strong>待提交数据</strong><span class="preview-count"></span></div>
          <div class="table-wrap"><table class="preview-table"><thead><tr><th>字段</th><th>值</th></tr></thead><tbody></tbody></table></div>
          <div class="target-card">
            <label for="submit-target-url">上传到飞书多维表格</label>
            <input id="submit-target-url" name="target-url" type="url" spellcheck="false" autocomplete="off">
            <label class="default-target"><input name="save-default-target" type="checkbox">设为默认上传表格，后续自动使用此地址</label>
          </div>
        </div>
        <div class="submit-foot">
          <div class="submit-note">确认后将通过本机桥接程序写入指定飞书多维表格。</div>
          <div class="submit-actions"><button class="secondary-action">返回修改</button><button class="primary-action">核算最终数据</button></div>
        </div>
      </section>`;

    panel.querySelectorAll('.row').forEach((row, index) => {
      const field = result.fields[index];
      row.querySelector('.name').textContent = field.name;
      row.querySelector('.source-name').textContent = field.source;
      row.querySelector('.value').textContent = field.formatted;
    });
    panel.querySelector('.close').addEventListener('click', () => host.remove());
    panel.querySelector('.copy').addEventListener('click', async (event) => {
      const button = event.currentTarget;
      await copyText(copyValue);
      button.textContent = '已复制';
      setTimeout(() => { button.textContent = '复制全部数据'; }, 1200);
    });
    const dateInput = submitLayer.querySelector('[name="date"]');
    const anchorInput = submitLayer.querySelector('[name="anchor"]');
    const operatorInput = submitLayer.querySelector('[name="operator"]');
    const statusInput = submitLayer.querySelector('[name="status"]');
    const liveStartTimeInput = submitLayer.querySelector('[name="live-start-time"]');
    const liveEndTimeInput = submitLayer.querySelector('[name="live-end-time"]');
    const endDayOffsetInput = submitLayer.querySelector('[name="end-day-offset"]');
    const targetUrlInput = submitLayer.querySelector('[name="target-url"]');
    const saveDefaultTargetInput = submitLayer.querySelector('[name="save-default-target"]');
    const submitNote = submitLayer.querySelector('.submit-note');
    const previewBody = submitLayer.querySelector('.preview-table tbody');
    const previewCount = submitLayer.querySelector('.preview-count');
    const screenshotImage = submitLayer.querySelector('.screenshot-frame img');
    const screenshotEmpty = submitLayer.querySelector('.screenshot-empty');
    const screenshotStatus = submitLayer.querySelector('.screenshot-status');
    const screenshotFilename = submitLayer.querySelector('.screenshot-filename');
    const primaryButton = submitLayer.querySelector('.primary-action');
    let preparedKey = '';
    let holidayValue = null;
    let endDayManuallySelected = false;
    let openTimePickerCloser = null;

    const createTimeWheel = (input, title, onCommit) => {
      const wrapper = input.closest('.time-picker-field');
      const popover = document.createElement('div');
      popover.className = 'time-wheel-popover';
      popover.hidden = true;
      popover.innerHTML = `
        <div class="time-wheel-title">${title}</div>
        <div class="time-wheel-columns"></div>
        <div class="time-wheel-actions">
          <button class="time-wheel-now" type="button">现在</button>
          <button class="time-wheel-cancel" type="button">取消</button>
          <button class="time-wheel-confirm" type="button">确定</button>
        </div>`;
      wrapper.append(popover);
      const columnsHost = popover.querySelector('.time-wheel-columns');
      const limits = [24, 60, 60];
      const labels = ['时', '分', '秒'];
      const draft = [0, 0, 0];
      const lists = [];
      const scrollTimers = [];

      const paintSelection = () => {
        lists.forEach((list, columnIndex) => {
          list.querySelectorAll('.time-wheel-option').forEach((option, optionIndex) => {
            option.classList.toggle('selected', optionIndex === draft[columnIndex]);
          });
        });
      };
      const scrollToDraft = () => {
        lists.forEach((list, index) => {
          list.scrollTop = draft[index] * 36;
        });
        paintSelection();
      };
      const setDraftFromClock = (clock) => {
        const match = clock.match(/^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/);
        const fallback = currentTimeInShanghai().split(':').map(Number);
        const values = match ? match.slice(1).map(Number) : fallback;
        draft.splice(0, 3, ...values);
      };
      limits.forEach((limit, columnIndex) => {
        const column = document.createElement('div');
        column.className = 'time-wheel-column';
        const label = document.createElement('div');
        label.className = 'time-wheel-column-label';
        label.textContent = labels[columnIndex];
        const list = document.createElement('div');
        list.className = 'time-wheel-list';
        list.setAttribute('role', 'listbox');
        list.setAttribute('aria-label', labels[columnIndex]);
        for (let value = 0; value < limit; value += 1) {
          const option = document.createElement('button');
          option.className = 'time-wheel-option';
          option.type = 'button';
          option.textContent = String(value).padStart(2, '0');
          option.setAttribute('role', 'option');
          option.addEventListener('click', () => {
            draft[columnIndex] = value;
            list.scrollTop = value * 36;
            paintSelection();
          });
          list.append(option);
        }
        list.addEventListener('scroll', () => {
          clearTimeout(scrollTimers[columnIndex]);
          scrollTimers[columnIndex] = setTimeout(() => {
            draft[columnIndex] = Math.max(
              0,
              Math.min(limit - 1, Math.round(list.scrollTop / 36)),
            );
            list.scrollTop = draft[columnIndex] * 36;
            paintSelection();
          }, 80);
        }, { passive: true });
        column.append(label, list);
        columnsHost.append(column);
        lists.push(list);
      });

      const close = (restoreFocus = false) => {
        popover.hidden = true;
        if (openTimePickerCloser === close) openTimePickerCloser = null;
        if (restoreFocus) input.focus();
      };
      const open = () => {
        if (openTimePickerCloser && openTimePickerCloser !== close) {
          openTimePickerCloser();
        }
        setDraftFromClock(input.value);
        popover.hidden = false;
        openTimePickerCloser = close;
        requestAnimationFrame(scrollToDraft);
      };
      input.addEventListener('click', () => {
        if (popover.hidden) open();
        else close();
      });
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
          event.preventDefault();
          open();
        }
      });
      popover.querySelector('.time-wheel-now').addEventListener('click', () => {
        setDraftFromClock(currentTimeInShanghai());
        scrollToDraft();
      });
      popover.querySelector('.time-wheel-cancel').addEventListener('click', () => close(true));
      popover.querySelector('.time-wheel-confirm').addEventListener('click', () => {
        lists.forEach((list, columnIndex) => {
          draft[columnIndex] = Math.max(
            0,
            Math.min(limits[columnIndex] - 1, Math.round(list.scrollTop / 36)),
          );
          list.scrollTop = draft[columnIndex] * 36;
        });
        input.value = draft.map((value) => String(value).padStart(2, '0')).join(':');
        close(true);
        onCommit();
      });
      return { close, wrapper };
    };

    const showBridgeError = (response = {}) => {
      shadow.querySelector('.bridge-error-layer')?.remove();
      const status = typeof response.status === 'string' ? response.status : 'unknown_error';
      const titles = {
        lark_cli_outdated: '需要升级 lark-cli',
        missing_scope: '缺少飞书文档权限',
        wiki_access_not_granted: '默认多维表格仍无法访问',
        authorization_required: '飞书登录或授权已失效',
        authorization_expired: '飞书授权已过期',
        authorization_denied: '飞书授权未完成',
        permission_denied: '没有目标文档权限',
        network_error: '网络连接异常',
        rate_limited: '飞书请求过于频繁',
        document_not_found: '没有找到目标文档',
        bridge_environment_error: '本机桥接环境异常',
        schema_error: '多维表格字段不匹配',
        host_unavailable: '无法连接本机桥接程序',
        attachment_failed: '截图附件提交失败',
        state_failed: '本地提交状态保存失败',
      };
      const action = response.suggestedAction;
      const actionLabels = {
        upgrade_lark_cli: '立即升级',
        reauthorize_lark_cli: '重新授权',
      };
      const layer = document.createElement('div');
      layer.className = 'bridge-error-layer';
      layer.setAttribute('role', 'alertdialog');
      layer.setAttribute('aria-modal', 'true');

      const card = document.createElement('section');
      card.className = 'bridge-error-card';
      const body = document.createElement('div');
      body.className = 'bridge-error-body';
      const icon = document.createElement('div');
      icon.className = 'bridge-error-icon';
      icon.textContent = '!';
      const title = document.createElement('h4');
      title.textContent = titles[status] || '提交飞书失败';
      const message = document.createElement('p');
      message.className = 'bridge-error-message';
      message.textContent = response.message || '本机桥接程序未返回有效结果，请稍后重试。';
      body.append(icon, title, message);

      if (response.detail) {
        const details = document.createElement('details');
        details.className = 'bridge-error-detail';
        const summary = document.createElement('summary');
        summary.textContent = '查看技术详情';
        const detail = document.createElement('pre');
        detail.textContent = String(response.detail);
        details.append(summary, detail);
        body.append(details);
      }

      const actions = document.createElement('div');
      actions.className = 'bridge-error-actions';
      const cancelButton = document.createElement('button');
      cancelButton.className = 'bridge-error-cancel';
      cancelButton.textContent = actionLabels[action] ? '稍后处理' : '我知道了';
      cancelButton.addEventListener('click', () => layer.remove());
      actions.append(cancelButton);

      if (actionLabels[action]) {
        const confirmButton = document.createElement('button');
        let maintenanceAction = action;
        let pendingDeviceCode = '';
        confirmButton.className = 'bridge-error-confirm';
        confirmButton.textContent = actionLabels[action];
        confirmButton.addEventListener('click', async () => {
          cancelButton.disabled = true;
          confirmButton.disabled = true;
          confirmButton.textContent = maintenanceAction === 'upgrade_lark_cli'
            ? '正在升级…'
            : maintenanceAction === 'complete_lark_cli_authorization'
              ? '正在确认授权…'
              : '正在打开授权…';
          try {
            const maintenanceResponse = await chrome.runtime.sendMessage({
              type: 'NATIVE_MAINTENANCE',
              payload: {
                action: maintenanceAction,
                ...(pendingDeviceCode ? { deviceCode: pendingDeviceCode } : {}),
              },
            });
            if (!maintenanceResponse?.ok) {
              throw Object.assign(
                new Error(maintenanceResponse?.message || '本机维护操作失败。'),
                { response: maintenanceResponse },
              );
            }
            if (maintenanceResponse.status === 'authorization_pending') {
              maintenanceAction = 'complete_lark_cli_authorization';
              pendingDeviceCode = maintenanceResponse.deviceCode || '';
              title.textContent = '请在飞书完成授权';
              message.textContent = `${maintenanceResponse.message || '已打开飞书授权页面。'}${maintenanceResponse.userCode ? `\n授权码：${maintenanceResponse.userCode}` : ''}`;
              cancelButton.disabled = false;
              cancelButton.textContent = '稍后处理';
              confirmButton.disabled = false;
              confirmButton.textContent = '我已完成授权';
              confirmButton.focus();
              return;
            }
            icon.textContent = '✓';
            icon.style.background = '#e7f5ec';
            icon.style.color = '#177245';
            title.textContent = '处理完成';
            message.textContent = maintenanceResponse.message || '操作已完成，请重新核算。';
            confirmButton.remove();
            cancelButton.disabled = false;
            cancelButton.textContent = '关闭';
            cancelButton.focus();
          } catch (error) {
            const failedResponse = error?.response || {};
            title.textContent = '自动处理失败';
            message.textContent = failedResponse.message
              || (error instanceof Error ? error.message : String(error));
            const existingDetail = body.querySelector('.bridge-error-detail');
            if (failedResponse.detail) {
              if (existingDetail) {
                existingDetail.querySelector('pre').textContent = String(failedResponse.detail);
              } else {
                const details = document.createElement('details');
                details.className = 'bridge-error-detail';
                const summary = document.createElement('summary');
                summary.textContent = '查看技术详情';
                const detail = document.createElement('pre');
                detail.textContent = String(failedResponse.detail);
                details.append(summary, detail);
                body.append(details);
              }
            }
            confirmButton.remove();
            cancelButton.disabled = false;
            cancelButton.textContent = '关闭';
            cancelButton.focus();
          }
        });
        actions.append(confirmButton);
        setTimeout(() => confirmButton.focus(), 0);
      } else {
        setTimeout(() => cancelButton.focus(), 0);
      }
      layer.addEventListener('click', (event) => {
        if (event.target === layer) layer.remove();
      });
      layer.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') layer.remove();
      });
      card.append(body, actions);
      layer.append(card);
      shadow.append(layer);
    };

    const updateEndDayLabels = () => {
      const startDate = parseDateInput(dateInput.value);
      const sameDay = endDayOffsetInput.querySelector('option[value="0"]');
      const nextDay = endDayOffsetInput.querySelector('option[value="1"]');
      sameDay.textContent = startDate ? `当天 · ${startDate.slice(5).replace('-', '/')}` : '当天';
      const nextDate = startDate ? addCalendarDays(startDate, 1) : '';
      nextDay.textContent = nextDate ? `次日 · ${nextDate.slice(5).replace('-', '/')}` : '次日';
    };
    const recommendEndDayOffset = () => {
      if (endDayManuallySelected) return;
      const startSeconds = clockToSeconds(liveStartTimeInput.value);
      const endSeconds = clockToSeconds(liveEndTimeInput.value);
      if (startSeconds === null || endSeconds === null || startSeconds === endSeconds) return;
      endDayOffsetInput.value = endSeconds < startSeconds ? '1' : '0';
    };

    dateInput.value = todayInShanghai();
    liveEndTimeInput.value = currentTimeInShanghai();
    updateEndDayLabels();
    targetUrlInput.value = DEFAULT_FEISHU_TABLE_URL;
    void storedFeishuTableUrl().then((storedTargetUrl) => {
      targetUrlInput.value = storedTargetUrl;
    });
    if (result.professionalScreenshot?.dataUrl) {
      screenshotImage.src = result.professionalScreenshot.dataUrl;
      screenshotImage.classList.add('ready');
      screenshotEmpty.hidden = true;
      screenshotStatus.textContent = '已随本次采集生成，将与记录一起提交。';
      screenshotFilename.textContent = result.professionalScreenshot.filename;
      screenshotImage.addEventListener('click', () => {
        const previewWindow = window.open();
        if (previewWindow) {
          previewWindow.document.title = result.professionalScreenshot.filename;
          const image = previewWindow.document.createElement('img');
          image.src = result.professionalScreenshot.dataUrl;
          image.alt = result.professionalScreenshot.filename;
          image.style.maxWidth = '100%';
          previewWindow.document.body.style.margin = '0';
          previewWindow.document.body.style.background = '#111';
          previewWindow.document.body.append(image);
        }
      });
    } else {
      screenshotEmpty.textContent = result.screenshotError || '本次未获取到专业版大屏截图。';
      screenshotStatus.textContent = '截图不可用，请通过诊断信息确认原因。';
      screenshotFilename.textContent = '';
    }

    const buildDateTime = (clockValue, dayOffset = 0) => {
      const date = addCalendarDays(dateInput.value, dayOffset);
      return date && /^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(clockValue)
        ? `${date} ${clockValue}`
        : '';
    };
    const buildStartDateTime = () => buildDateTime(liveStartTimeInput.value);
    const buildEndDateTime = () => buildDateTime(
      liveEndTimeInput.value,
      Number(endDayOffsetInput.value),
    );
    const durationSeconds = () => {
      const startSeconds = clockToSeconds(liveStartTimeInput.value);
      const endSeconds = clockToSeconds(liveEndTimeInput.value);
      if (startSeconds === null || endSeconds === null) return null;
      return endSeconds + Number(endDayOffsetInput.value) * 86400 - startSeconds;
    };
    const buildSubmitData = () => ({
      ...copyData,
      '主播': anchorInput.value.trim(),
      '直播负责人': operatorInput.value.trim(),
      '提交人': '当前飞书登录用户',
      '直播状态': statusInput.value,
      '直播开始时间': buildStartDateTime(),
      '直播结束时间': buildEndDateTime(),
      '是否节假日': holidayValue ?? '核算时查询',
    });
    const buildSubmissionPayload = () => {
      const fields = Object.fromEntries(
        Object.entries(buildSubmitData())
          .filter(([, value]) => value !== null && value !== '')
          .map(([name, value]) => [
            name,
            name === '人均停留时长' && typeof value === 'number' ? String(value) : value,
          ]),
      );
      return {
        action: 'submit_feishu_record',
        requestId: [
          String(result.liveRoomId),
          result.capturedAt,
        ].join('-'),
        capturedAt: result.capturedAt,
        targetUrl: normalizeFeishuTableUrl(targetUrlInput.value),
        fields,
        attachment: result.professionalScreenshot
          ? {
            fieldName: '专业版数据',
            filename: result.professionalScreenshot.filename,
            mimeType: result.professionalScreenshot.mimeType,
            capturedAt: result.professionalScreenshot.capturedAt,
            dataUrl: result.professionalScreenshot.dataUrl,
          }
          : null,
      };
    };
    const renderPreview = (data = buildSubmitData(), subtractedFields = []) => {
      const subtracted = new Set(subtractedFields);
      previewBody.replaceChildren();
      Object.entries(data).forEach(([name, value]) => {
        const row = document.createElement('tr');
        if (subtracted.has(name)) row.classList.add('subtracted');
        const nameCell = document.createElement('td');
        const valueCell = document.createElement('td');
        nameCell.textContent = name;
        valueCell.textContent = displayCellValue(value);
        row.append(nameCell, valueCell);
        previewBody.append(row);
      });
      previewCount.textContent = `${Object.keys(data).length} 个字段${result.professionalScreenshot ? ' + 1 张截图' : ''}`;
      submitNote.className = 'submit-note';
      submitNote.textContent = '请补全场次信息，然后核算黄色累计字段的最终提交值。';
    };
    const invalidatePrepared = () => {
      preparedKey = '';
      holidayValue = null;
      primaryButton.textContent = '核算最终数据';
      primaryButton.disabled = false;
      renderPreview();
    };
    const closeSubmitLayer = () => {
      submitLayer.classList.remove('open');
      panel.querySelector('.submit-feishu').focus();
    };
    panel.querySelector('.submit-feishu').addEventListener('click', async () => {
      preparedKey = '';
      holidayValue = null;
      primaryButton.textContent = '核算最终数据';
      primaryButton.disabled = false;
      targetUrlInput.value = await storedFeishuTableUrl();
      dateInput.value = todayInShanghai();
      liveEndTimeInput.value = currentTimeInShanghai();
      endDayManuallySelected = false;
      endDayOffsetInput.value = '0';
      recommendEndDayOffset();
      updateEndDayLabels();
      saveDefaultTargetInput.checked = false;
      renderPreview();
      submitLayer.classList.add('open');
      setTimeout(() => dateInput.focus(), 0);
    });
    [dateInput, anchorInput, operatorInput, statusInput, targetUrlInput].forEach((control) => {
      control.addEventListener('input', invalidatePrepared);
      control.addEventListener('change', invalidatePrepared);
    });
    [liveStartTimeInput, liveEndTimeInput].forEach((control) => {
      control.addEventListener('input', () => {
        const normalized = normalizeClockInput(control.value);
        if (normalized !== control.value) control.value = normalized;
        recommendEndDayOffset();
        invalidatePrepared();
      });
      control.addEventListener('blur', () => {
        const normalized = normalizeClockInput(control.value, true);
        if (normalized !== control.value) {
          control.value = normalized;
          recommendEndDayOffset();
          invalidatePrepared();
        }
      });
    });
    dateInput.addEventListener('change', () => {
      updateEndDayLabels();
      recommendEndDayOffset();
    });
    endDayOffsetInput.addEventListener('change', () => {
      endDayManuallySelected = true;
      invalidatePrepared();
    });
    submitLayer.querySelector('.submit-close').addEventListener('click', closeSubmitLayer);
    submitLayer.querySelector('.secondary-action').addEventListener('click', closeSubmitLayer);
    submitLayer.addEventListener('click', (event) => {
      if (event.target === submitLayer) closeSubmitLayer();
    });
    submitLayer.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeSubmitLayer();
    });
    submitLayer.querySelector('.primary-action').addEventListener('click', async (event) => {
      const submitButton = event.currentTarget;
      const missing = [
        [dateInput, '日期'],
        [anchorInput, '主播名称'],
        [operatorInput, '直播负责人'],
        [liveStartTimeInput, '直播开始时间'],
        [liveEndTimeInput, '直播结束时间'],
        [targetUrlInput, '飞书多维表格地址'],
      ].find(([input]) => !input.value.trim());
      if (missing) {
        submitNote.className = 'submit-note error';
        submitNote.textContent = `请填写${missing[1]}。`;
        missing[0].focus();
        return;
      }
      const holidayDate = parseDateInput(dateInput.value);
      if (!holidayDate) {
        submitNote.className = 'submit-note error';
        submitNote.textContent = '请选择有效的直播日期。';
        dateInput.focus();
        return;
      }
      liveStartTimeInput.value = normalizeClockInput(liveStartTimeInput.value, true);
      liveEndTimeInput.value = normalizeClockInput(liveEndTimeInput.value, true);
      if (!/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(liveStartTimeInput.value)) {
        submitNote.className = 'submit-note error';
        submitNote.textContent = '请输入有效的直播开始时间，格式为 HH:MM:SS。';
        liveStartTimeInput.focus();
        return;
      }
      if (!/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(liveEndTimeInput.value)) {
        submitNote.className = 'submit-note error';
        submitNote.textContent = '请输入有效的直播结束时间，格式为 HH:MM:SS。';
        liveEndTimeInput.focus();
        return;
      }
      const currentDurationSeconds = durationSeconds();
      if (currentDurationSeconds === null || currentDurationSeconds <= 0) {
        submitNote.className = 'submit-note error';
        submitNote.textContent = '结束时间必须晚于开始时间；如果直播跨过零点，请把结束日期选择为“次日”。';
        endDayOffsetInput.focus();
        return;
      }
      if (currentDurationSeconds > 86400) {
        submitNote.className = 'submit-note error';
        submitNote.textContent = '直播最长为24小时。选择“次日”时，结束时刻不能晚于开始时刻。';
        endDayOffsetInput.focus();
        return;
      }
      let normalizedTargetUrl;
      try {
        normalizedTargetUrl = normalizeFeishuTableUrl(targetUrlInput.value);
      } catch (error) {
        submitNote.className = 'submit-note error';
        submitNote.textContent = error instanceof Error ? error.message : String(error);
        targetUrlInput.focus();
        return;
      }
      submitButton.disabled = true;
      if (holidayValue === null) {
        submitButton.textContent = '正在查询节假日…';
        try {
          const holidayResponse = await chrome.runtime.sendMessage({
            type: 'CHECK_HOLIDAY',
            date: holidayDate,
          });
          if (!holidayResponse?.ok || typeof holidayResponse.isHoliday !== 'boolean') {
            throw new Error(holidayResponse?.message || '节假日接口未返回有效结果。');
          }
          holidayValue = holidayResponse.isHoliday ? '是' : '否';
        } catch (error) {
          submitNote.className = 'submit-note error';
          submitNote.textContent = error instanceof Error ? error.message : String(error);
          submitButton.textContent = '重新核算';
          submitButton.disabled = false;
          return;
        }
      }
      targetUrlInput.value = normalizedTargetUrl;
      if (saveDefaultTargetInput.checked) {
        await chrome.storage.local.set({ defaultFeishuTableUrl: normalizedTargetUrl });
      }
      const submissionPayload = buildSubmissionPayload();
      const currentPreparedKey = JSON.stringify({
        requestId: submissionPayload.requestId,
        targetUrl: submissionPayload.targetUrl,
        fields: submissionPayload.fields,
      });
      if (preparedKey !== currentPreparedKey) {
        submitButton.textContent = '正在核算最终数据…';
        try {
          const previewResponse = await chrome.runtime.sendMessage({
            type: 'PREVIEW_FEISHU',
            payload: {
              ...submissionPayload,
              action: 'preview_feishu_record',
              attachment: null,
            },
          });
          if (!previewResponse?.ok) {
            showBridgeError(previewResponse || {
              status: 'unknown_error',
              message: '本机桥接程序核算失败。',
            });
            throw Object.assign(
              new Error(previewResponse?.message || '本机桥接程序核算失败。'),
              { bridgeHandled: true },
            );
          }
          renderPreview(previewResponse.fields, previewResponse.subtractedFields || []);
          submitNote.className = 'submit-note success';
          submitNote.textContent = `${previewResponse.message} 请核对黄色行后再次确认。`;
          preparedKey = currentPreparedKey;
          submitButton.textContent = '确认提交飞书';
          submitButton.disabled = false;
        } catch (error) {
          if (!error?.bridgeHandled) {
            showBridgeError({
              status: 'unknown_error',
              message: error instanceof Error ? error.message : String(error),
            });
          }
          submitNote.className = 'submit-note error';
          submitNote.textContent = error instanceof Error ? error.message : String(error);
          submitButton.textContent = '重新核算';
          submitButton.disabled = false;
        }
        return;
      }
      submitButton.textContent = '正在提交飞书…';
      try {
        const response = await chrome.runtime.sendMessage({
          type: 'SUBMIT_FEISHU',
          payload: submissionPayload,
        });
        if (!response?.ok) {
          const recordHint = response?.recordId ? `记录 ${response.recordId} 已创建，但附件或本地状态写入失败。` : '';
          showBridgeError({
            ...(response || {}),
            message: `${recordHint}${response?.message || '本机桥接程序提交失败。'}`,
          });
          throw Object.assign(
            new Error(`${recordHint}${response?.message || '本机桥接程序提交失败。'}`),
            { bridgeHandled: true },
          );
        }
        submitNote.className = 'submit-note success';
        submitNote.textContent = response.isDuplicate
          ? `该打点此前已提交，未重复写入。记录 ID：${response.recordId}`
          : `提交成功。记录 ID：${response.recordId}`;
        submitButton.textContent = response.isDuplicate ? '已阻止重复提交' : '提交成功';
      } catch (error) {
        if (!error?.bridgeHandled) {
          showBridgeError({
            status: 'unknown_error',
            message: error instanceof Error ? error.message : String(error),
          });
        }
        submitNote.className = 'submit-note error';
        submitNote.textContent = error instanceof Error ? error.message : String(error);
        submitButton.textContent = '重新提交飞书';
        submitButton.disabled = false;
      }
    });
    panel.querySelector('.diagnostic')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      await copyText(diagnosticValue);
      button.textContent = '诊断信息已复制';
      setTimeout(() => { button.textContent = '复制诊断信息'; }, 1200);
    });
    shadow.append(style, panel, submitLayer);
    document.documentElement.append(host);
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'SHOW_CAPTURE_OVERLAY' && message.data) render(message.data);
  });
})();
