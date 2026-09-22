import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const moduleUrl = new URL('../diting-auto-test/extension/dist/auto-settings.mjs', import.meta.url);
let api;
try { api = await import(moduleUrl); } catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
const binding = { authorId: '123456', teacher: '测试老师', pageUrl: 'https://compass.jinritemai.com/talent/home' };

test('automatic settings implementation exists', () => assert.ok(api, 'missing auto settings module'));
test('fresh install stays off', () => {
  assert.equal(api.readSettings().enabled, false);
  assert.equal(api.readSettings().binding, null);
});
test('enabling without first setup fails', () => {
  assert.throws(() => api.setEnabled(api.readSettings(), true), /首次/);
});
test('setup requires real backend URL and account/teacher', () => {
  for (const pageUrl of ['https://example.com/', 'https://compass.jinritemai.com/login?roleType=talent', 'https://compass.jinritemai.com/login/', 'http://compass.jinritemai.com/']) {
    assert.throws(() => api.configure(api.readSettings(), { ...binding, pageUrl }), /后台/);
  }
  assert.throws(() => api.configure(api.readSettings(), { ...binding, authorId: '' }), /账号/);
  assert.throws(() => api.configure(api.readSettings(), { ...binding, teacher: ' ' }), /老师/);
});
test('configured switch survives reload and remains explicitly awaiting verification', () => {
  const configured = api.configure(api.readSettings(), binding);
  assert.equal(configured.enabled, false);
  const enabled = api.setEnabled(configured, true);
  const loaded = api.readSettings(JSON.parse(JSON.stringify(enabled)));
  assert.equal(loaded.enabled, true);
  assert.equal(loaded.binding.teacher, binding.teacher);
  assert.equal(api.describeStatus(loaded).phase, 'awaiting_verification');
});
test('switch off preserves binding and reconfiguration turns off', () => {
  const enabled = api.setEnabled(api.configure(api.readSettings(), binding), true);
  assert.deepEqual(api.setEnabled(enabled, false).binding, enabled.binding);
  assert.equal(api.configure(enabled, { ...binding, authorId: '654321' }).enabled, false);
});
test('test target cannot be overridden from saved configuration', () => {
  const state = api.readSettings({ enabled: true, targetUrl: 'https://evil.example', binding });
  assert.equal(state.targetUrl, api.TEST_TARGET);
  assert.match(state.targetUrl, /REPLACE_WITH_TEST_BASE_TOKEN/);
});
test('corrupt persisted settings fail closed', () => {
  for (const stored of [null, [], 'yes', { enabled: true }, { enabled: 'false', binding }, { enabled: true, binding: { teacher: 'x' } }]) {
    assert.equal(api.readSettings(stored).enabled, false);
  }
});
test('UI exposes first setup, persistent switch and honest status', async () => {
  const html = await readFile(new URL('../diting-auto-test/extension/popup.html', import.meta.url), 'utf8');
  assert.match(html, /id="auto-enabled"/);
  assert.match(html, /id="auto-author"/);
  assert.match(html, /id="auto-teacher"/);
  assert.match(html, /id="auto-status"/);
});
