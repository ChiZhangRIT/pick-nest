// 真实 App（src/app.js）：拉下别的设备的改动、合并好了，却存不进本机（空间满）时，本机设置里不记云端版本号（sha / ETag）。
// 不然下次启动时 304 / 同一个 sha 会被当成「没变化」，磁盘上缺的那一版永远合并不进来。启动两次（同一份假存储），
// 假 DOM + 假的 GitHub（tests/helpers/github.mjs，不联网），全是编的数据
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockGitHub, DATA } from './helpers/github.mjs';
import { normalizeRecord } from '../src/core/store.js';
import { readStoredState, PENDING_PREFIX } from '../src/core/persistence.js';
import { Element, fakeStorage, installDom } from './helpers/dom.mjs';

/** 在假 DOM 里打开一次 App（每次是新的模块实例：?test= 不一样） */
async function launch(storage, gh, tag) {
  const loc = { hash: '#/', protocol: 'http:' };
  const dom = installDom({ localStorage: storage, location: loc, history: { state: {}, replaceState(s, title, hash) { loc.hash = hash; }, back() {} },
    navigator: { languages: ['zh-CN'], platform: 'MacIntel', locks: { request: async (name, fn) => fn() } }, matchMedia: () => ({ matches: false, addEventListener() {} }),
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0,
    getComputedStyle: () => ({ bottom: '24px' }), requestAnimationFrame: () => 0, MutationObserver: class { observe() {} disconnect() {} }, CSS: { escape: String },
    fetch: (...a) => gh.fetch(...a) });
  dom.doc.visibilityState = 'visible';
  const shell = new Element('div'); shell.className = 'app';
  for (const id of ['side', 'main']) { const el = new Element('div'); el.id = id; shell.append(el); }
  const tabs = new Element('nav'); tabs.id = 'tabs';
  dom.doc.body.append(shell, tabs);
  await import('../src/app.js?test=' + tag);
  const app = window.__picknest;
  await app.syncer.idle();
  for (let i = 0; i < 5; i++) await new Promise(r => queueMicrotask(r));
  return { dom, app };
}

test('合并的结果存不进本机：不记云端版本号；下次启动完整拉取（不带 If-None-Match），把那一版合并、存好', async () => {
  const gh = mockGitHub();
  gh.pushJson(s => { s.data.items.i_remote = normalizeRecord('items', { id: 'i_remote', listId: 'l_groceries', name: '别的设备加的燕麦奶', status: 'need', updatedAt: Date.now() - 1000 }); });
  const storage = fakeStorage([['picknest.local', JSON.stringify({ sync: { repo: 'me/data', token: 'github_pat_test', dirty: false } })]]);
  const setItem = storage.setItem;
  let full = true;
  storage.setItem = (k, v) => { if (full && k.startsWith(PENDING_PREFIX)) throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' }); return setItem(k, v); };
  const contentsGets = () => gh.opts.filter(o => o.method === 'GET' && o.path === '/repos/me/data/contents/' + DATA);
  const saved = () => JSON.parse(storage.getItem('picknest.local')).sync;

  const first = await launch(storage, gh, 'save-fail-1');
  try {
    assert.equal(first.app.ctx.state.data.items.i_remote.name, '别的设备加的燕麦奶', '这一次打开期间照样看得到');
    assert.equal(first.app.state.saveOk(), false);
    assert.equal(readStoredState(storage).data.items.i_remote, undefined, '没存进本机');
    assert.deepEqual([saved().sha, saved().etag], [null, null], '本机设置里不记云端版本号');
    assert.ok(saved().at, '这一轮同步本身算成功');
    assert.ok(first.app.state.getLocal().sync.sha, '内存里留着：这次打开期间不用每次都整个重拉');
  } finally { first.dom.restore(); }

  full = false;                                   // 腾出了空间，关掉再打开
  const before = contentsGets().length;
  const second = await launch(storage, gh, 'save-fail-2');
  try {
    const gets = contentsGets().slice(before);
    assert.equal(gets.length, 1);
    assert.equal(gets[0].headers['If-None-Match'], undefined, '完整拉取，不会被 304 挡住');
    assert.equal(readStoredState(storage).data.items.i_remote.name, '别的设备加的燕麦奶', '这次存进了本机');
    assert.ok(saved().sha && saved().etag, '存好以后才记云端版本号');
    assert.equal(gh.puts, 0, '本机没有云端没有的：不上传');
  } finally { second.dom.restore(); }
});
