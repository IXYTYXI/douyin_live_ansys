import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerAutoSettings, SETTINGS_KEY } from '../diting-auto-test/extension/dist/auto-settings.mjs';

function harness(initial = {}, failWrite = false) {
  const data = structuredClone(initial);
  let listener;
  let pageUrl = 'https://compass.jinritemai.com/talent/home';
  const api = {
    runtime: { id: 'test-extension', getURL: path => `chrome-extension://test-extension/${path}`, onMessage: { addListener: fn => { listener = fn; } } },
    storage: { local: {
      get: async key => ({ [key]: structuredClone(data[key]) }),
      set: async value => { if (failWrite) throw new Error('storage failed'); Object.assign(data, structuredClone(value)); },
    } },
    tabs: { get: async () => ({ url: pageUrl }) },
  };
  registerAutoSettings(api);
  const sender = { id: api.runtime.id, url: api.runtime.getURL('popup.html') };
  return {
    data, api, sender, page: url => { pageUrl = url; },
    send: (message, from = sender) => new Promise(resolve => listener(message, from, resolve)),
  };
}
const setup = { type: 'AUTO_CONFIGURE', tabId: 1, authorId: '123', teacher: '老师' };

test('configuration checks actual tab URL, ignoring caller supplied URL', async () => {
  const h = harness();
  h.page('https://example.com/');
  assert.equal((await h.send({ ...setup, pageUrl: 'https://compass.jinritemai.com/talent/home' })).ok, false);
  assert.equal(h.data[SETTINGS_KEY], undefined);
});
test('web content scripts cannot enable automatic collection', async () => {
  const h = harness();
  const response = await h.send(setup, { id: 'test-extension', url: 'https://compass.jinritemai.com/talent/home', tab: { id: 1 } });
  assert.equal(response.ok, false);
  assert.equal(h.data[SETTINGS_KEY], undefined);
});
test('concurrent configuration and toggles are serialized and survive worker restart', async () => {
  const h = harness();
  const results = await Promise.all([h.send(setup), h.send({ type: 'AUTO_SET_ENABLED', enabled: true })]);
  assert.ok(results.every(r => r.ok));
  const restarted = harness(h.data);
  const result = await restarted.send({ type: 'AUTO_GET_SETTINGS' });
  assert.equal(result.settings.enabled, true);
  assert.equal(result.settings.binding.authorId, '123');
  assert.equal(result.status.phase, 'awaiting_verification');
});
test('failed storage write is reported, never acknowledged as saved', async () => {
  const h = harness({}, true);
  const result = await h.send(setup);
  assert.equal(result.ok, false);
  assert.match(result.error, /storage failed/);
  assert.equal(h.data[SETTINGS_KEY], undefined);
});
test('bad request does not break subsequent settings requests', async () => {
  const h = harness();
  assert.equal((await h.send({ type: 'AUTO_SET_ENABLED', enabled: true })).ok, false);
  assert.equal((await h.send(setup)).ok, true);
  assert.equal((await h.send({ type: 'AUTO_SET_ENABLED', enabled: false })).ok, true);
});
