const captureButton = document.querySelector('#capture');
const statusElement = document.querySelector('#status');
function requireElement(element, name) {
    if (!element)
        throw new Error(`缺少页面元素：${name}`);
    return element;
}
function setStatus(message, kind = 'idle') {
    const element = requireElement(statusElement, 'status');
    element.textContent = message;
    element.dataset.kind = kind;
}
async function capture() {
    const button = requireElement(captureButton, 'capture');
    button.disabled = true;
    setStatus('正在同时获取三个页面的数据，网络较慢时最长约 2 分钟…', 'loading');
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id || !tab.url)
            throw new Error('无法读取当前标签页。');
        const response = (await chrome.runtime.sendMessage({ type: 'CAPTURE_ALL', tabId: tab.id, tabUrl: tab.url }));
        if (!response.ok)
            throw new Error(response.error || '采集失败。');
        setStatus('采集完成，结果已显示在页面右上角。', 'success');
    }
    catch (error) {
        setStatus(error instanceof Error ? error.message : String(error), 'error');
    }
    finally {
        button.disabled = false;
    }
}
requireElement(captureButton, 'capture').addEventListener('click', () => void capture());

const autoAuthor = document.querySelector('#auto-author');
const autoTeacher = document.querySelector('#auto-teacher');
const autoConfigure = document.querySelector('#auto-configure');
const autoEnabled = document.querySelector('#auto-enabled');
const autoStatus = document.querySelector('#auto-status');
let savedSettings = null;
function renderAuto(response) {
    savedSettings = response.settings;
    autoAuthor.value = savedSettings.binding?.authorId || '';
    autoTeacher.value = savedSettings.binding?.teacher || '';
    autoEnabled.checked = savedSettings.enabled;
    autoEnabled.disabled = !savedSettings.binding;
    autoStatus.textContent = response.status.message;
}
async function autoRequest(message) {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) throw new Error(response?.error || '无法读取自动采集设置。');
    return response;
}
async function autoAction(action) {
    autoConfigure.disabled = true;
    autoEnabled.disabled = true;
    try { renderAuto(await action()); }
    catch (error) {
        autoEnabled.checked = savedSettings?.enabled === true;
        autoStatus.textContent = error.message || String(error);
    }
    finally {
        autoConfigure.disabled = false;
        autoEnabled.disabled = !savedSettings?.binding;
    }
}
autoConfigure.addEventListener('click', () => void autoAction(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return autoRequest({ type: 'AUTO_CONFIGURE', tabId: tab?.id, authorId: autoAuthor.value, teacher: autoTeacher.value });
}));
autoEnabled.addEventListener('change', () => {
    const enabled = autoEnabled.checked;
    void autoAction(() => autoRequest({ type: 'AUTO_SET_ENABLED', enabled }));
});
void autoAction(() => autoRequest({ type: 'AUTO_GET_SETTINGS' }));
export {};
