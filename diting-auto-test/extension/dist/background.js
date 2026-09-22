import { registerAutoSettings } from './auto-settings.mjs';
registerAutoSettings(chrome);
const COMPASS_ORIGIN = 'https://compass.jinritemai.com';
const FLOW_PATH = '/compass_api/author/live/live_room_detail/flow/flow_analysis';
const UNIFY_TRACK_PATH = '/business_api/home/unify_track';
const CORE_DATA_PATH = '/compass_api/author/live/live_screen/core_data';
const FLOW_DISTRIBUTION_PATH = '/compass_api/content_live/author/live_screen/flow_distribution';
const STATEMENT_PATH = '/talent/live-statement';
const STATEMENT_CAPTURE_TIMEOUT_MS = 60_000;
const PROFESSIONAL_CAPTURE_TIMEOUT_MS = 120_000;
const FLOW_CLICK_RETRY_INTERVAL_MS = 8_000;
const FLOW_CLICK_RETRY_COUNT = 8;
const NATIVE_HOST_NAME = 'com.diting.feishu_bridge';
export function parseAuthorId(payload) {
    if (!payload || typeof payload !== 'object')
        return null;
    const trackPayload = payload;
    if (trackPayload.st !== 0)
        return null;
    const candidate = trackPayload.data?.author_id;
    if (typeof candidate !== 'string' && typeof candidate !== 'number')
        return null;
    const normalized = String(candidate);
    return /^\d+$/.test(normalized) ? normalized : null;
}
const LIVE_FIELDS = [
    { key: 'live_room_exposure_uv', outputName: '直播间曝光人数', source: '百应-直播数据', aliases: ['直播间曝光人数'] },
    { key: 'product_exposure_uv', outputName: '商品曝光人数', source: '百应-直播数据', aliases: ['商品曝光人数'] },
    { key: 'product_click_uv', outputName: '商品点击人数', source: '百应-直播数据', aliases: ['商品点击人数'] },
    { key: 'buyer_uv', outputName: '成交人数', source: '百应-直播数据', aliases: ['成交人数'] },
];
export const BASIC_FIELDS = [
    { key: 'cumulative_watch_uv', outputName: '累计观看人数', source: '百应-基础版', aliases: ['累计观看人数', 'watch_ucnt', 'total_watch_ucnt', 'watch_user_count'] },
    { key: 'new_fans', outputName: '新增粉丝数', source: '百应-基础版', aliases: ['新增粉丝数', 'follow_anchor_ucnt', 'incr_fans_cnt'] },
    { key: 'buyer_fan_rate', outputName: '成交粉丝占比', source: '百应-基础版', aliases: ['成交粉丝占比', '成交老粉占比', 'pay_order_fans_rate', 'pay_fans_rate', 'old_fans_pay_ucnt_ratio'] },
];
export const PROFESSIONAL_FIELDS = [
    { key: 'avg_stay_duration', outputName: '人均停留时长', source: '百应-专业版', aliases: ['人均观看时长', 'avg_watch_duration'] },
    { key: 'gmv', outputName: '成交GMV', source: '百应-专业版', aliases: ['直播间成交金额', 'pay_gmv', 'gmv', 'pay_amt'] },
    { key: 'cost', outputName: '消耗', source: '百应-专业版', aliases: ['消耗', '千川消耗', '整体消耗(元)', 'stat_cost'] },
    { key: 'natural_recommend', outputName: '流量-直播推荐', source: '百应-专业版', aliases: ['直播推荐', '直播推荐流量', 'live_recommend', 'recommend_feed'] },
    { key: 'natural_follow', outputName: '流量-关注', source: '百应-专业版', aliases: ['关注', '关注页', 'follow', 'following'] },
    { key: 'natural_search', outputName: '流量-搜索', source: '百应-专业版', aliases: ['搜索', '搜索流量', 'search'] },
    { key: 'natural_short_video', outputName: '流量-短视频', source: '百应-专业版', aliases: ['短视频', '短视频引流', 'short_video'] },
    { key: 'other_traffic_rate', outputName: '流量-其他占比', source: '百应-专业版', aliases: ['其他', '其他占比', '其他流量', 'other_ratio', 'other_rate'] },
];
const PROFESSIONAL_TRAFFIC_KEYS = new Set([
    'natural_recommend',
    'natural_follow',
    'natural_search',
    'natural_short_video',
    'other_traffic_rate',
]);
const PROFESSIONAL_CAPTURE_FIELDS = [...PROFESSIONAL_FIELDS, ...BASIC_FIELDS];
const AUGMENTED_CORE_INDICATORS = [
    'stat_cost',
    'watch_ucnt',
    'follow_anchor_ucnt',
    'old_fans_pay_ucnt_ratio',
];
const runningCaptures = new Map();
function parseStatementUrl(rawUrl) {
    const url = new URL(rawUrl);
    if (url.origin !== COMPASS_ORIGIN || url.pathname !== STATEMENT_PATH) {
        throw new Error('请先打开百应的直播详情页。');
    }
    const liveRoomId = url.searchParams.get('live_room_id');
    if (!liveRoomId || !/^\d+$/.test(liveRoomId))
        throw new Error('当前页面缺少有效的 live_room_id。');
    return liveRoomId;
}
function statementUrl(liveRoomId) {
    return `${COMPASS_ORIGIN}${STATEMENT_PATH}?live_room_id=${liveRoomId}&tab=coreTag`;
}
function professionalUrl(liveRoomId) {
    return `${COMPASS_ORIGIN}/screen/live/talent?live_room_id=${liveRoomId}`;
}
function decodeBody(body, base64Encoded) {
    if (!base64Encoded)
        return body;
    const binary = atob(body);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
}
function formatScalar(value, unit) {
    if (value === null)
        return '未获取';
    if (typeof value === 'number' && unit === 'time') {
        if (value < 60)
            return `${value}秒`;
        const minutes = Math.floor(value / 60);
        const seconds = Math.round(value % 60);
        return seconds > 0 ? `${minutes}分${seconds}秒` : `${minutes}分`;
    }
    if (typeof value === 'number' && unit === 'ratio') {
        return new Intl.NumberFormat('zh-CN', { style: 'percent', maximumFractionDigits: 2 }).format(value);
    }
    if (typeof value === 'number')
        return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value);
    return value;
}
function capturedField(spec, extracted) {
    let value = extracted?.value ?? null;
    let unit = extracted?.unit;
    if (['gmv', 'cost'].includes(spec.key) && unit === 'price' && typeof value === 'number') {
        value /= 100;
        unit = 'yuan';
    }
    return {
        key: spec.key,
        name: spec.outputName,
        source: spec.source,
        value,
        formatted: formatScalar(value, unit),
        status: value === null ? 'missing' : 'success',
    };
}
export function sourceResult(specs, values, error = null, diagnostics) {
    const fields = specs.map((spec) => capturedField(spec, values.get(spec.key) ?? null));
    const found = fields.filter((field) => field.status === 'success').length;
    return {
        source: specs[0].source,
        status: found === fields.length ? 'success' : found > 0 ? 'partial' : 'failed',
        error: error ?? (found === fields.length ? null : `未获取 ${fields.length - found} 个字段`),
        fields,
        diagnostics,
    };
}
function selectSourceResult(result, source) {
    const fields = result.fields.filter((field) => field.source === source);
    const found = fields.filter((field) => field.status === 'success').length;
    return {
        source,
        status: found === fields.length ? 'success' : found > 0 ? 'partial' : 'failed',
        error: found === fields.length ? null : `未获取 ${fields.length - found} 个字段`,
        fields,
        diagnostics: result.diagnostics,
    };
}
function unwrapValue(candidate) {
    if (typeof candidate === 'number' && Number.isFinite(candidate))
        return { value: candidate };
    if (typeof candidate === 'string' && candidate.trim())
        return { value: candidate.trim() };
    if (!candidate || typeof candidate !== 'object')
        return null;
    const object = candidate;
    for (const key of ['value', 'val', 'display_value', 'show_value', 'value_str', 'index_value', 'metric_value', 'watch_ratio', 'ratio', 'rate', 'percent', 'percentage', 'flow_ratio', 'flow_rate', 'distribution_ratio', 'count', 'amount']) {
        if (key in object) {
            const extracted = unwrapValue(object[key]);
            if (extracted !== null) {
                const inferredUnit = ['watch_ratio', 'ratio', 'rate', 'percent', 'percentage', 'flow_ratio', 'flow_rate', 'distribution_ratio'].includes(key) ? 'ratio' : extracted.unit;
                const unit = typeof object.unit === 'string' ? object.unit : inferredUnit;
                return { ...extracted, unit };
            }
        }
    }
    return null;
}
export function collectNamedValues(root, specs, values) {
    const seen = new Set();
    const labelKeys = ['index_name', 'indexName', 'index_code', 'indexCode', 'code', 'key', 'name', 'title', 'label', 'index_display', 'metric_name', 'metricName', 'channel_name', 'channelName', 'channel_display_name', 'source_name', 'traffic_name', 'flow_name', 'flowName'];
    const valueKeys = ['value', 'val', 'display_value', 'show_value', 'value_str', 'index_value', 'metric_value', 'watch_ratio', 'ratio', 'rate', 'percent', 'percentage', 'flow_ratio', 'flow_rate', 'distribution_ratio', 'count', 'amount', 'data'];
    const visit = (node) => {
        if (!node || typeof node !== 'object')
            return;
        if (seen.has(node))
            return;
        seen.add(node);
        if (Array.isArray(node)) {
            for (const item of node)
                visit(item);
            return;
        }
        const object = node;
        for (const spec of specs) {
            if (values.has(spec.key))
                continue;
            for (const alias of spec.aliases) {
                if (alias in object) {
                    const directValue = unwrapValue(object[alias]);
                    if (directValue !== null)
                        values.set(spec.key, directValue);
                }
            }
            const label = labelKeys.map((key) => object[key]).find((value) => typeof value === 'string');
            if (typeof label === 'string' && spec.aliases.includes(label.trim())) {
                for (const key of valueKeys) {
                    const labeledValue = unwrapValue(object[key]);
                    if (labeledValue !== null) {
                        values.set(spec.key, labeledValue);
                        break;
                    }
                }
            }
        }
        for (const value of Object.values(object))
            visit(value);
    };
    visit(root);
}
async function attachDebugger(tabId) {
    const debuggee = { tabId };
    try {
        await chrome.debugger.attach(debuggee, '1.3');
        await chrome.debugger.sendCommand(debuggee, 'Network.enable');
        await chrome.debugger.sendCommand(debuggee, 'Page.enable');
        await chrome.debugger.sendCommand(debuggee, 'Network.setCacheDisabled', { cacheDisabled: true });
        return debuggee;
    }
    catch (error) {
        await chrome.debugger.detach(debuggee).catch(() => undefined);
        throw new Error(`无法连接页面，请关闭该页的 DevTools 后重试。${error instanceof Error ? ` ${error.message}` : ''}`);
    }
}
function waitForStatementData(debuggee, liveRoomId) {
    return new Promise((resolvePromise, rejectPromise) => {
        const pendingBodies = new Set();
        const diagnostics = [];
        let liveResult = null;
        let authorId = null;
        let completed = false;
        let metadataGraceTimeout;
        const cleanup = () => {
            clearTimeout(timeoutId);
            if (metadataGraceTimeout !== undefined)
                clearTimeout(metadataGraceTimeout);
            chrome.debugger.onEvent.removeListener(listener);
        };
        const finish = () => {
            if (completed || liveResult === null)
                return;
            completed = true;
            cleanup();
            if (authorId === null) {
                diagnostics.push({
                    path: UNIFY_TRACK_PATH,
                    payload: null,
                    request: 'page',
                    error: '未在直播明细页捕获到有效的 author_id。',
                });
            }
            if (diagnostics.length > 0)
                liveResult.diagnostics = diagnostics;
            resolvePromise({ result: liveResult, authorId });
        };
        const fail = (error) => {
            if (completed)
                return;
            completed = true;
            cleanup();
            rejectPromise(error instanceof Error ? error : new Error(String(error)));
        };
        const maybeFinish = () => {
            if (liveResult === null || pendingBodies.size > 0)
                return;
            if (authorId !== null) {
                finish();
                return;
            }
            if (metadataGraceTimeout === undefined) {
                metadataGraceTimeout = setTimeout(finish, 4_000);
            }
        };
        const listener = (source, method, params) => {
            if (source.tabId !== debuggee.tabId || method !== 'Network.responseReceived' || completed)
                return;
            const event = params;
            if (!event.requestId || event.response?.status !== 200 || !event.response.url || pendingBodies.has(event.requestId))
                return;
            let url;
            try {
                url = new URL(event.response.url);
            }
            catch {
                return;
            }
            const isFlowResponse = url.pathname === FLOW_PATH && url.searchParams.get('live_room_id') === liveRoomId;
            const isAccountResponse = url.pathname === UNIFY_TRACK_PATH;
            if (!isFlowResponse && !isAccountResponse)
                return;
            if (isAccountResponse && metadataGraceTimeout !== undefined) {
                clearTimeout(metadataGraceTimeout);
                metadataGraceTimeout = undefined;
            }
            const requestId = event.requestId;
            pendingBodies.add(requestId);
            void chrome.debugger.sendCommand(debuggee, 'Network.getResponseBody', { requestId: event.requestId })
                .then((response) => {
                const body = response;
                if (typeof body.body !== 'string')
                    throw new Error(`无法读取${isFlowResponse ? '直播数据' : '账号信息'}响应。`);
                const payload = JSON.parse(decodeBody(body.body, body.base64Encoded === true));
                if (isFlowResponse) {
                    const flowPayload = payload;
                    if (flowPayload.BaseResp?.StatusCode !== 0 || flowPayload.st !== 0) {
                        throw new Error(flowPayload.BaseResp?.StatusMessage || flowPayload.msg || '直播数据接口失败');
                    }
                    const values = new Map();
                    collectNamedValues(flowPayload.data?.gmv_change, LIVE_FIELDS, values);
                    liveResult = sourceResult(LIVE_FIELDS, values);
                    return;
                }
                const accountPayload = payload;
                authorId = parseAuthorId(accountPayload);
                diagnostics.push({
                    path: UNIFY_TRACK_PATH,
                    payload: accountPayload,
                    request: 'page',
                    status: event.response?.status,
                    url: event.response?.url,
                    error: authorId === null ? accountPayload.msg || 'unify_track 未返回有效的 author_id。' : undefined,
                });
            })
                .catch((error) => {
                if (isFlowResponse) {
                    fail(error);
                    return;
                }
                diagnostics.push({
                    path: UNIFY_TRACK_PATH,
                    payload: null,
                    request: 'page',
                    status: event.response?.status,
                    url: event.response?.url,
                    error: error instanceof Error ? error.message : String(error),
                });
            })
                .finally(() => {
                pendingBodies.delete(requestId);
                maybeFinish();
            });
        };
        const timeoutId = setTimeout(() => {
            if (liveResult !== null)
                finish();
            else
                fail(new Error('60 秒内未捕获到 flow_analysis 接口。'));
        }, STATEMENT_CAPTURE_TIMEOUT_MS);
        chrome.debugger.onEvent.addListener(listener);
    });
}
function waitForNamedJson(debuggee, specs, acceptedPaths, liveRoomId, timeoutMs = PROFESSIONAL_CAPTURE_TIMEOUT_MS) {
    return new Promise((resolvePromise) => {
        const values = new Map();
        const pendingBodies = new Set();
        const seenPaths = new Set();
        const diagnostics = [];
        let completed = false;
        let augmentedCoreRequested = false;
        let augmentedCorePending = false;
        const cleanup = () => {
            clearTimeout(timeoutId);
            chrome.debugger.onEvent.removeListener(listener);
        };
        const finish = () => {
            if (completed)
                return;
            completed = true;
            cleanup();
            resolvePromise(sourceResult(specs, values, null, diagnostics));
        };
        const addDiagnostic = (diagnostic) => {
            if (diagnostics.length < 8)
                diagnostics.push(diagnostic);
        };
        const specsForPath = (path) => path === FLOW_DISTRIBUTION_PATH
            ? specs.filter((spec) => PROFESSIONAL_TRAFFIC_KEYS.has(spec.key))
            : path === CORE_DATA_PATH && specs[0]?.source === '百应-专业版'
                ? specs.filter((spec) => !PROFESSIONAL_TRAFFIC_KEYS.has(spec.key))
                : specs;
        const collectPayload = (path, payload, request, status, url) => {
            const serializedLength = JSON.stringify(payload).length;
            addDiagnostic({
                path,
                request,
                status,
                url,
                payload: serializedLength <= 750_000
                    ? payload
                    : { truncated: true, topLevelKeys: payload && typeof payload === 'object' ? Object.keys(payload) : [] },
            });
            collectNamedValues(payload, specsForPath(path), values);
            seenPaths.add(path);
        };
        const maybeFinish = () => {
            const captureComplete = specs.every((spec) => values.has(spec.key))
                && acceptedPaths.every((path) => seenPaths.has(path))
                && !augmentedCorePending
                && pendingBodies.size === 0;
            if (captureComplete)
                finish();
        };
        const requestAugmentedCore = (originalUrl, selected) => {
            if (augmentedCoreRequested)
                return;
            augmentedCoreRequested = true;
            augmentedCorePending = true;
            for (const indicator of AUGMENTED_CORE_INDICATORS)
                selected.add(indicator);
            const encodedSelection = encodeURIComponent([...selected].join(','));
            const augmentedUrl = /([?&])index_selected=[^&]*/.test(originalUrl)
                ? originalUrl.replace(/([?&])index_selected=[^&]*/, `$1index_selected=${encodedSelection}`)
                : `${originalUrl}${originalUrl.includes('?') ? '&' : '?'}index_selected=${encodedSelection}`;
            const expression = `(async () => {
        try {
          const response = await fetch(${JSON.stringify(augmentedUrl)}, { credentials: 'include', cache: 'no-store' });
          return { ok: response.ok, status: response.status, url: response.url, body: await response.text() };
        } catch (error) {
          return { ok: false, status: 0, url: ${JSON.stringify(augmentedUrl)}, error: String(error) };
        }
      })()`;
            void chrome.debugger.sendCommand(debuggee, 'Runtime.evaluate', {
                expression,
                awaitPromise: true,
                returnByValue: true,
            }).then((evaluation) => {
                const result = evaluation;
                const response = result.result?.value;
                const status = response?.status ?? 0;
                const responseUrl = response?.url || augmentedUrl;
                if (response?.ok && typeof response.body === 'string') {
                    try {
                        collectPayload(CORE_DATA_PATH, JSON.parse(response.body), 'augmented', status, responseUrl);
                    }
                    catch (error) {
                        addDiagnostic({
                            path: CORE_DATA_PATH,
                            request: 'augmented',
                            status,
                            url: responseUrl,
                            payload: response.body.slice(0, 2_000),
                            error: `增强 core_data 响应不是有效 JSON：${error instanceof Error ? error.message : String(error)}`,
                        });
                    }
                    return;
                }
                addDiagnostic({
                    path: CORE_DATA_PATH,
                    request: 'augmented',
                    status,
                    url: responseUrl,
                    payload: typeof response?.body === 'string' ? response.body.slice(0, 2_000) : null,
                    error: response?.error || result.exceptionDetails?.text || `增强 core_data 请求失败（HTTP ${status}）`,
                });
            }).catch((error) => {
                addDiagnostic({
                    path: CORE_DATA_PATH,
                    request: 'augmented',
                    status: 0,
                    url: augmentedUrl,
                    payload: null,
                    error: `无法发起增强 core_data 请求：${error instanceof Error ? error.message : String(error)}`,
                });
            }).finally(() => {
                augmentedCorePending = false;
                maybeFinish();
            });
        };
        const listener = (source, method, params) => {
            if (source.tabId !== debuggee.tabId || method !== 'Network.responseReceived' || completed)
                return;
            const event = params;
            if (!event.requestId || !event.response?.url || pendingBodies.has(event.requestId))
                return;
            if (!['XHR', 'Fetch'].includes(event.type ?? '') && !event.response?.mimeType?.includes('json'))
                return;
            let responseUrl;
            try {
                responseUrl = new URL(event.response.url);
            }
            catch {
                return;
            }
            if (responseUrl.origin !== COMPASS_ORIGIN || !acceptedPaths.includes(responseUrl.pathname))
                return;
            const responseRoomId = responseUrl.searchParams.get('room_id');
            if (responseRoomId && responseRoomId !== liveRoomId)
                return;
            const responsePath = responseUrl.pathname;
            if (event.response.status !== 200) {
                addDiagnostic({
                    path: responsePath,
                    request: 'page',
                    status: event.response.status,
                    url: event.response.url,
                    payload: null,
                    error: `页面请求失败（HTTP ${event.response.status}）`,
                });
                return;
            }
            const requestId = event.requestId;
            const responseStatus = event.response.status;
            const responseHref = event.response.url;
            const shouldAugmentCore = responsePath === CORE_DATA_PATH
                && specs.some((spec) => spec.source === '百应-基础版');
            if (shouldAugmentCore) {
                const selected = new Set((responseUrl.searchParams.get('index_selected') || '').split(',').filter(Boolean));
                const hasAllAugmentedIndicators = AUGMENTED_CORE_INDICATORS.every((indicator) => selected.has(indicator));
                if (!hasAllAugmentedIndicators) {
                    requestAugmentedCore(responseHref, selected);
                }
            }
            pendingBodies.add(requestId);
            void chrome.debugger.sendCommand(debuggee, 'Network.getResponseBody', { requestId })
                .then((response) => {
                const body = response;
                if (typeof body.body !== 'string')
                    return;
                let payload;
                try {
                    payload = JSON.parse(decodeBody(body.body, body.base64Encoded === true));
                }
                catch (error) {
                    addDiagnostic({
                        path: responsePath,
                        request: 'page',
                        status: responseStatus,
                        url: responseHref,
                        payload: body.body.slice(0, 2_000),
                        error: `页面响应不是有效 JSON：${error instanceof Error ? error.message : String(error)}`,
                    });
                    return;
                }
                collectPayload(responsePath, payload, 'page', responseStatus, responseHref);
                maybeFinish();
            })
                .catch((error) => {
                addDiagnostic({
                    path: responsePath,
                    request: 'page',
                    status: responseStatus,
                    url: responseHref,
                    payload: null,
                    error: `无法读取页面响应：${error instanceof Error ? error.message : String(error)}`,
                });
            })
                .finally(() => {
                pendingBodies.delete(requestId);
                maybeFinish();
            });
        };
        const timeoutId = setTimeout(finish, timeoutMs);
        chrome.debugger.onEvent.addListener(listener);
    });
}
function wait(milliseconds) {
    return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}
async function waitForForegroundPage(debuggee, expectedUrl) {
    const expected = new URL(expectedUrl);
    for (let attempt = 0; attempt < 120; attempt += 1) {
        try {
            const response = await chrome.debugger.sendCommand(debuggee, 'Runtime.evaluate', {
                expression: `({ href: location.href, readyState: document.readyState, visibilityState: document.visibilityState, hasBody: Boolean(document.body) })`,
                returnByValue: true,
            });
            const page = response.result?.value;
            if (page?.href) {
                const current = new URL(page.href);
                const reachedTarget = current.origin === expected.origin
                    && current.pathname === expected.pathname
                    && current.searchParams.get('live_room_id') === expected.searchParams.get('live_room_id');
                if (reachedTarget && page.hasBody && page.readyState !== 'loading' && page.visibilityState === 'visible')
                    return;
            }
        }
        catch {
            // Navigation can briefly invalidate the execution context; retry until the new page is ready.
        }
        await wait(250);
    }
    throw new Error('专业版页面未能在前台完成加载。');
}
async function activateTabAndVerify(tabId, windowId) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
        await chrome.windows.update(windowId, { focused: true }).catch(() => undefined);
        await chrome.tabs.update(tabId, { active: true });
        const tab = await chrome.tabs.get(tabId);
        if (tab.active && tab.windowId === windowId)
            return;
        await wait(250);
    }
    throw new Error('Chrome 未能切换到专业版标签页。');
}
async function clickFlowAnalysis(debuggee, shouldStop = () => false) {
    const expression = `(() => {
    const candidates = [...document.querySelectorAll('*')]
      .filter((element) => {
        const text = (element.textContent || '').replace(/\\s+/g, ' ').trim();
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return text.includes('流量分析') && text.length <= 20 && rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && style.pointerEvents !== 'none';
      })
      .sort((left, right) => {
        const leftRect = left.getBoundingClientRect();
        const rightRect = right.getBoundingClientRect();
        return leftRect.width * leftRect.height - rightRect.width * rightRect.height;
      });
    const label = candidates[0];
    if (!label) return { found: false };
    const target = label.closest('button, a, [role="tab"], [role="button"]') || label;
    target.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = target.getBoundingClientRect();
    target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse', button: 0 }));
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse', button: 0 }));
    target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
    target.click();
    return { found: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`;
    let successfulClicks = 0;
    for (let attempt = 0; attempt < 15; attempt += 1) {
        if (shouldStop())
            return successfulClicks > 0;
        try {
            const response = await chrome.debugger.sendCommand(debuggee, 'Runtime.evaluate', {
                expression,
                returnByValue: true,
            });
            const target = response.result?.value;
            if (target?.found && typeof target.x === 'number' && typeof target.y === 'number') {
                await chrome.debugger.sendCommand(debuggee, 'Input.dispatchMouseEvent', {
                    type: 'mousePressed', x: target.x, y: target.y, button: 'left', clickCount: 1,
                });
                await chrome.debugger.sendCommand(debuggee, 'Input.dispatchMouseEvent', {
                    type: 'mouseReleased', x: target.x, y: target.y, button: 'left', clickCount: 1,
                });
                successfulClicks += 1;
                if (successfulClicks >= 3)
                    return true;
                for (let tick = 0; tick < 6 && !shouldStop(); tick += 1)
                    await wait(250);
                continue;
            }
        }
        catch {
            if (shouldStop())
                return successfulClicks > 0;
        }
        for (let tick = 0; tick < 4 && !shouldStop(); tick += 1)
            await wait(200);
    }
    return false;
}
async function retryFlowAnalysisClicks(debuggee, shouldStop) {
    for (let attempt = 0; attempt < FLOW_CLICK_RETRY_COUNT && !shouldStop(); attempt += 1) {
        await clickFlowAnalysis(debuggee, shouldStop);
        for (let elapsed = 0; elapsed < FLOW_CLICK_RETRY_INTERVAL_MS && !shouldStop(); elapsed += 500) {
            await wait(500);
        }
    }
}
async function captureCurrentStatement(tabId, liveRoomId) {
    const debuggee = await attachDebugger(tabId);
    try {
        const responsePromise = waitForStatementData(debuggee, liveRoomId);
        await chrome.tabs.update(tabId, { url: statementUrl(liveRoomId) });
        return await responsePromise;
    }
    finally {
        await chrome.debugger.detach(debuggee).catch(() => undefined);
    }
}
async function captureProfessionalScreenshot(debuggee, liveRoomId) {
    const response = await chrome.debugger.sendCommand(debuggee, 'Page.captureScreenshot', {
        format: 'jpeg',
        quality: 84,
        fromSurface: true,
        captureBeyondViewport: true,
        optimizeForSpeed: true,
    });
    if (!response.data)
        throw new Error('Chrome 未返回专业版大屏截图。');
    const capturedAt = new Date().toISOString();
    const filenameTimestamp = capturedAt.replace(/[:.]/g, '-');
    return {
        filename: `专业版大屏_${liveRoomId}_${filenameTimestamp}.jpg`,
        mimeType: 'image/jpeg',
        dataUrl: `data:image/jpeg;base64,${response.data}`,
        capturedAt,
    };
}
async function captureCreatedPage(url, specs, acceptedPaths, liveRoomId, shouldClickFlowAnalysis = false, foregroundTabId) {
    const foregroundOrigin = foregroundTabId === undefined
        ? undefined
        : await chrome.tabs.get(foregroundTabId);
    const tab = await chrome.tabs.create({
        url: 'about:blank',
        active: false,
        windowId: foregroundOrigin?.windowId,
    });
    if (!tab.id)
        throw new Error('无法创建采集标签页。');
    const tabId = tab.id;
    try {
        const debuggee = await attachDebugger(tabId);
        try {
            const responsePromise = waitForNamedJson(debuggee, specs, acceptedPaths, liveRoomId, shouldClickFlowAnalysis ? PROFESSIONAL_CAPTURE_TIMEOUT_MS : STATEMENT_CAPTURE_TIMEOUT_MS);
            await chrome.tabs.update(tabId, { url });
            if (foregroundTabId !== undefined) {
                await activateTabAndVerify(tabId, tab.windowId);
                await chrome.debugger.sendCommand(debuggee, 'Page.bringToFront').catch(() => undefined);
                await waitForForegroundPage(debuggee, url);
                // The document can be ready before the SPA has attached the tab's click handler.
                await wait(1_500);
            }
            const foregroundCaptureStartedAt = Date.now();
            let stopFlowRetries = false;
            const flowRetryTask = shouldClickFlowAnalysis
                ? retryFlowAnalysisClicks(debuggee, () => stopFlowRetries)
                : Promise.resolve();
            const result = await responsePromise.finally(() => {
                stopFlowRetries = true;
            });
            await flowRetryTask;
            if (shouldClickFlowAnalysis) {
                const minimumForegroundMs = 5_000;
                await wait(Math.max(0, minimumForegroundMs - (Date.now() - foregroundCaptureStartedAt)));
            }
            try {
                result.screenshot = await captureProfessionalScreenshot(debuggee, liveRoomId);
            }
            catch (error) {
                result.screenshotError = error instanceof Error ? error.message : String(error);
            }
            return result;
        }
        finally {
            await chrome.debugger.detach(debuggee).catch(() => undefined);
        }
    }
    finally {
        if (foregroundTabId !== undefined) {
            await activateTabAndVerify(foregroundTabId, tab.windowId).catch(() => undefined);
        }
        await chrome.tabs.remove(tabId).catch(() => undefined);
    }
}
async function safeSourceCapture(specs, capture) {
    try {
        return await capture();
    }
    catch (error) {
        return sourceResult(specs, new Map(), error instanceof Error ? error.message : String(error));
    }
}
async function safeStatementCapture(capture) {
    try {
        return await capture();
    }
    catch (error) {
        return {
            result: sourceResult(LIVE_FIELDS, new Map(), error instanceof Error ? error.message : String(error)),
            authorId: null,
        };
    }
}
async function captureAll(tabId, tabUrl) {
    const liveRoomId = parseStatementUrl(tabUrl);
    const [statementCapture, professionalCapture] = await Promise.all([
        safeStatementCapture(() => captureCurrentStatement(tabId, liveRoomId)),
        safeSourceCapture(PROFESSIONAL_CAPTURE_FIELDS, () => captureCreatedPage(professionalUrl(liveRoomId), PROFESSIONAL_CAPTURE_FIELDS, [CORE_DATA_PATH, FLOW_DISTRIBUTION_PATH], liveRoomId, true, tabId)),
    ]);
    const live = statementCapture.result;
    const professional = selectSourceResult(professionalCapture, '百应-专业版');
    const basic = selectSourceResult(professionalCapture, '百应-基础版');
    const sources = [professional, basic, live];
    return {
        liveRoomId,
        authorId: statementCapture.authorId,
        capturedAt: new Date().toISOString(),
        professionalScreenshot: professionalCapture.screenshot ?? null,
        screenshotError: professionalCapture.screenshotError ?? null,
        sources,
        fields: sources.flatMap((source) => source.fields),
    };
}
async function showOverlay(tabId, result) {
    await chrome.tabs.sendMessage(tabId, { type: 'SHOW_CAPTURE_OVERLAY', data: result });
}
async function checkHoliday(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
        throw new Error('节假日查询日期格式无效。');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
        const response = await fetch(`https://holiday.dreace.top?date=${encodeURIComponent(date)}`, {
            cache: 'no-store',
            signal: controller.signal,
        });
        if (!response.ok)
            throw new Error(`节假日接口返回 HTTP ${response.status}`);
        const payload = await response.json();
        if (payload.date !== date || typeof payload.isHoliday !== 'boolean') {
            throw new Error('节假日接口返回格式异常。');
        }
        return payload.isHoliday;
    }
    catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
            throw new Error('节假日接口 10 秒内未响应。');
        }
        throw error;
    }
    finally {
        clearTimeout(timeout);
    }
}
async function runCapture(message) {
    const existing = runningCaptures.get(message.tabId);
    if (existing)
        return existing;
    const task = captureAll(message.tabId, message.tabUrl)
        .then(async (result) => {
        const { professionalScreenshot: _professionalScreenshot, ...sessionResult } = result;
        await chrome.storage.session.set({ lastCapture: sessionResult });
        await showOverlay(message.tabId, result);
        await chrome.action.setBadgeBackgroundColor({ color: '#177245', tabId: message.tabId });
        await chrome.action.setBadgeText({ text: 'OK', tabId: message.tabId });
        return result;
    })
        .catch(async (error) => {
        await chrome.action.setBadgeBackgroundColor({ color: '#b42318', tabId: message.tabId });
        await chrome.action.setBadgeText({ text: '!', tabId: message.tabId });
        throw error;
    })
        .finally(() => runningCaptures.delete(message.tabId));
    runningCaptures.set(message.tabId, task);
    return task;
}
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== 'object')
        return false;
    const type = message.type;
    if (type === 'CAPTURE_ALL') {
        void runCapture(message)
            .then((data) => sendResponse({ ok: true, data }))
            .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
        return true;
    }
    if (type === 'CHECK_HOLIDAY') {
        const holidayMessage = message;
        void checkHoliday(holidayMessage.date)
            .then((isHoliday) => sendResponse({ ok: true, isHoliday }))
            .catch((error) => sendResponse({
            ok: false,
            message: `无法判断是否节假日：${error instanceof Error ? error.message : String(error)}`,
        }));
        return true;
    }
    if (type === 'SUBMIT_FEISHU' || type === 'PREVIEW_FEISHU') {
        const submission = message;
        try {
            const target = new URL(submission.payload?.targetUrl);
            if (target.protocol !== 'https:' || target.hostname !== 'example.feishu.cn' || target.pathname !== '/base/REPLACE_WITH_TEST_BASE_TOKEN' || target.searchParams.get('table') !== 'REPLACE_WITH_TEST_TABLE_ID') throw new Error('隔离测试包只允许访问指定测试表。');
        } catch (error) {
            sendResponse({ok:false, status:'test_target_blocked', message:'隔离测试包已阻止访问非测试表。'});
            return false;
        }
        void chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, submission.payload)
            .then((response) => sendResponse(response))
            .catch((error) => sendResponse({
            ok: false,
            status: 'host_unavailable',
            message: `无法连接本机飞书桥接程序：${error instanceof Error ? error.message : String(error)}`,
        }));
        return true;
    }
    if (type === 'NATIVE_MAINTENANCE') {
        const maintenance = message;
        void chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, maintenance.payload)
            .then(async (response) => {
            const authorization = response;
            if (authorization.ok
                && authorization.status === 'authorization_pending'
                && typeof authorization.verificationUrl === 'string') {
                const parsed = new URL(authorization.verificationUrl);
                const host = parsed.hostname.toLowerCase();
                const allowed = parsed.protocol === 'https:'
                    && (host === 'feishu.cn'
                        || host.endsWith('.feishu.cn')
                        || host === 'larksuite.com'
                        || host.endsWith('.larksuite.com'));
                if (!allowed) {
                    sendResponse({
                        ok: false,
                        status: 'authorization_failed',
                        message: 'lark-cli 返回的授权地址不是受信任的飞书地址，已阻止打开。',
                    });
                    return;
                }
                await chrome.tabs.create({ url: authorization.verificationUrl, active: true });
            }
            sendResponse(response);
        })
            .catch((error) => sendResponse({
            ok: false,
            status: 'host_unavailable',
            message: `无法连接本机飞书桥接程序：${error instanceof Error ? error.message : String(error)}`,
        }));
        return true;
    }
    return false;
});
