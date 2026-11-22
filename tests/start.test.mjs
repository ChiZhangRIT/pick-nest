import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start, errorLang, BUILD } from '../src/start.js';
import { BUILD as VERSION } from '../src/version.js';
import { guessLang } from '../src/i18n.js';

class Channel {
  constructor() {
    this.port1 = { close() {} };
    this.port2 = { close() {}, reply: data => this.port1.onmessage({ data }) };
  }
}
function setup(controller = BUILD) {
  const calls = [];
  const nav = { serviceWorker: { controller: controller === null ? null : { postMessage: (message, [port]) => { calls.push('version:' + message); port.reply(controller); } },
    register: async () => { calls.push('register'); return {}; }, ready: Promise.resolve({}) } };
  return { calls, nav, loc: { protocol: 'https:', reload: () => calls.push('reload') }, win: {}, Channel, timeout: 50, load: async () => calls.push('app') };
}
test('启动器的版本号来自 version.js', () => {
  assert.equal(BUILD, VERSION);
  assert.match(BUILD, /^picknest-v\d+$/);
});
test('首次安装：等待完整版本安装后重开，尚未受控制的页面不加载 App', async () => {
  const o = setup(null); await start(o);
  assert.deepEqual(o.calls, ['register', 'reload']);
});
test('已安装：核对当前版本后立即加载；离线时重新注册失败不影响启动', async () => {
  const o = setup(); o.nav.serviceWorker.register = async () => { throw new Error('offline'); };
  await start(o);
  assert.deepEqual(o.calls, ['version:picknest-build', 'app']);
  assert.equal(o.win.__picknestBootError, false);
});
test('旧 worker 版本不符：不加载新 App、不强制重载正在使用的页面', async () => {
  const o = setup('picknest-v0');
  await assert.rejects(start(o), /update-pending/);
  assert.deepEqual(o.calls, ['version:picknest-build']);
});
test('旧 worker 不回答版本查询：超时后提示完成更新，不能混用程序文件', async () => {
  const o = setup(); o.timeout = 10; o.nav.serviceWorker.controller.postMessage = () => {};
  await assert.rejects(start(o), /update-pending/);
  assert.ok(!o.calls.includes('app'));
});
test('安装或 App 加载失败时明确报错；开发用 http 仍直接打开', async () => {
  const first = setup(null); first.nav.serviceWorker.register = async () => { throw new Error('offline'); };
  await assert.rejects(start(first), /offline/); assert.ok(!first.calls.includes('app'));
  const dev = setup(); dev.loc.protocol = 'http:'; await start(dev);
  assert.deepEqual(dev.calls, ['app']);
  // 别的 App 里的浏览器没有 Service Worker：照样打开（不能离线用），不报「请联网后重试」
  const inApp = setup(); delete inApp.nav.serviceWorker; await start(inApp);
  assert.deepEqual(inApp.calls, ['app']);
  assert.equal(inApp.win.__picknestBootError, false);
  const broken = setup(); broken.load = async () => { throw new Error('bad-module'); };
  await assert.rejects(start(broken), /bad-module/);
  assert.equal(broken.win.__picknestBootError, true, '加载失败时看门狗不再盖一层，由启动器显示错误');
});
test('出错提示的语言和 App 一样：选过的优先；没选过按系统语言（繁体中文 → 繁体，其他包括英文 → 简体）', () => {
  assert.equal(errorLang('', ['zh-TW']), 'zh-Hant-TW');
  assert.equal(errorLang(null, ['en-US']), 'zh-Hans');
  assert.equal(errorLang('en', ['zh-TW']), 'en');
  assert.equal(errorLang('fr', ['en-US', 'zh-Hant-TW']), 'zh-Hant-TW', '不认识的语言当没选过');
  // 启动器不能 import i18n.js（App 的模块坏了也要能提示），所以把规则抄了一份：和 guessLang 对一遍
  for (const langs of [[], ['zh-TW'], ['zh-HK'], ['zh-MO'], ['zh-Hant'], ['zh-Hant-TW'], ['zh-CN'], ['zh'], ['en-US'], ['en-US', 'zh-Hant-TW'], ['zh-CN', 'zh-TW'], ['ja', 'zh-hk'], [null]]) {
    assert.equal(errorLang(undefined, langs), guessLang(langs), JSON.stringify(langs));
  }
});
