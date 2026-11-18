// src/boot.js（第一次绘制前定深浅色、启动看门狗）：和 app.js 的主题规则一致
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(new URL('../src/boot.js', import.meta.url), 'utf8');

function boot({ local, systemDark = false }) {
  const attrs = {}, meta = { content: '#f6f5f0', setAttribute(k, v) { this[k] = v; } };
  const store = { 'picknest.local': local === undefined ? null : typeof local === 'string' ? local : JSON.stringify(local) };
  vm.runInNewContext(SRC, {
    localStorage: { getItem: k => store[k] ?? null },
    window: { matchMedia: () => ({ matches: systemDark }), addEventListener() {} },
    matchMedia: () => ({ matches: systemDark }),
    document: { documentElement: { setAttribute: (k, v) => { attrs[k] = v; } }, querySelector: sel => (sel === 'meta[name="theme-color"]' ? meta : null) },
    setTimeout: () => 0, JSON,
  });
  return [attrs['data-theme'], meta.content];
}

test('深浅色：本机设置 light / dark 优先，auto 或没设置跟系统；读不到设置也不出错；状态栏颜色一起定（和 app.js 的 THEME_COLOR 一样）', () => {
  const light = ['light', '#f6f5f0'], dark = ['dark', '#121412'];
  assert.deepEqual(boot({ local: undefined }), light);
  assert.deepEqual(boot({ local: undefined, systemDark: true }), dark);
  assert.deepEqual(boot({ local: { theme: 'auto' }, systemDark: true }), dark);
  assert.deepEqual(boot({ local: { theme: 'dark' } }), dark);
  assert.deepEqual(boot({ local: { theme: 'light' }, systemDark: true }), light);
  assert.deepEqual(boot({ local: '{broken', systemDark: true }), dark);
  const app = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /THEME_COLOR = \{ light: '#f6f5f0', dark: '#121412' \}/, '两边的颜色要一起改');
});

test('启动看门狗：10 秒还没启动（window.__picknest 没有）→ 显示「重新载入」；启动了、或启动器自己在提示就不显示', () => {
  for (const mode of ['stuck', 'booted', 'starter']) {
    const timers = [], added = [];
    const el = () => ({ style: {}, setAttribute() {}, appendChild(c) { (this.kids = this.kids || []).push(c); }, remove() {} });
    const win = { matchMedia: () => ({ matches: false }), addEventListener() {} };
    if (mode === 'booted') win.__picknest = {};
    if (mode === 'starter') win.__picknestBootError = true;
    vm.runInNewContext(SRC, {
      localStorage: { getItem: () => null }, location: { reload() {} }, navigator: { language: 'zh-CN' },
      window: win, matchMedia: () => ({ matches: false }),
      document: { documentElement: { setAttribute() {} }, body: { appendChild: (n) => added.push(n) }, createElement: el },
      setTimeout: (fn, ms) => timers.push([fn, ms]), setInterval: () => 0, clearInterval() {}, JSON, String,
    });
    const t10 = timers.find(([, ms]) => ms === 10000);
    assert.ok(t10, '定了 10 秒的看门狗');
    t10[0]();
    assert.equal(added.length, mode === 'stuck' ? 1 : 0, mode);
    if (mode === 'stuck') assert.equal(added[0].kids[1].textContent, '重新载入');
  }
});

test('启动看门狗的语言和 App 一样：选过的语言优先；没选过时系统语言里先碰到繁体中文 → 繁体，其他（包括英文系统）→ 简体', () => {
  const button = (local, nav) => {
    const timers = [], added = [];
    const el = () => ({ style: {}, setAttribute() {}, appendChild(c) { (this.kids = this.kids || []).push(c); }, remove() {} });
    vm.runInNewContext(SRC, {
      localStorage: { getItem: () => (local ? JSON.stringify(local) : null) }, location: { reload() {} }, navigator: nav,
      window: { matchMedia: () => ({ matches: false }), addEventListener() {} }, matchMedia: () => ({ matches: false }),
      document: { documentElement: { setAttribute() {} }, body: { appendChild: (n) => added.push(n) }, createElement: el },
      setTimeout: (fn, ms) => timers.push([fn, ms]), setInterval: () => 0, clearInterval() {}, JSON, String,
    });
    timers.find(([, ms]) => ms === 10000)[0]();
    return added[0].kids[1].textContent;
  };
  assert.equal(button(null, { languages: ['zh-TW'], language: 'zh-TW' }), '重新載入');
  assert.equal(button(null, { languages: ['en-US'], language: 'en-US' }), '重新载入', '英文系统也先用简体，和 App 一样');
  assert.equal(button(null, { languages: ['en-US', 'zh-Hant-TW'], language: 'en-US' }), '重新載入');
  assert.equal(button(null, { languages: ['zh-CN', 'zh-TW'] }), '重新载入');
  assert.equal(button(null, { language: 'zh-HK' }), '重新載入', '没有 languages 时用 language');
  assert.equal(button({ lang: 'en' }, { languages: ['zh-TW'] }), 'Reload', '设置里选了 English');
  assert.equal(button({ lang: 'fr' }, { languages: ['zh-TW'] }), '重新載入', '不认识的语言当没选过');
});
