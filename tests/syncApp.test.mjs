// 真实 App（src/app.js）的同步什么时候跑：启动时拉取合并、改了数据 2 秒后上传、切到后台直接上传（keepalive；刚勾的先写进数据）、切回来 / 联网 / 每分钟检查、
// 请求太多时先不自动同步、停止以后不再同步；首页的同步标签跟着变。假 DOM + 假的 GitHub（tests/helpers/github.mjs，不联网），全是编的数据
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockGitHub, DATA } from './helpers/github.mjs';
import { normalizeRecord } from '../src/core/store.js';
import { readStoredState } from '../src/core/persistence.js';
import { Element, fakeStorage, installDom } from './helpers/dom.mjs';

test('同步接在 App 上：启动、改数据、切到后台、切回来、联网、定时、请求太多、停止', async () => {
  const gh = mockGitHub();
  gh.pushJson(s => { s.data.items.i_remote = normalizeRecord('items', { id: 'i_remote', listId: 'l_groceries', name: '别的设备加的牛奶', status: 'need', updatedAt: Date.now() - 1000 }); });
  const storage = fakeStorage([['picknest.local', JSON.stringify({ sync: { repo: 'me/data', token: 'github_pat_test', dirty: false } })]]);
  const loc = { hash: '', protocol: 'http:' };
  const timers = [], intervals = [];
  const dom = installDom({ localStorage: storage, location: loc, history: { state: {}, replaceState(s, title, hash) { loc.hash = hash; }, back() {} },
    navigator: { languages: ['zh-CN'], userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', platform: 'iPhone', locks: { request: async (name, fn) => fn() } },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].fn = null; },
    setInterval: (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; },
    getComputedStyle: () => ({ bottom: '24px' }), requestAnimationFrame: () => 0, MutationObserver: class { observe() {} disconnect() {} }, CSS: { escape: String },
    fetch: (...a) => gh.fetch(...a) });
  const realNow = Date.now;
  try {
    dom.doc.visibilityState = 'visible';
    const shell = new Element('div'); shell.className = 'app';
    for (const id of ['side', 'main']) { const el = new Element('div'); el.id = id; shell.append(el); }
    const tabs = new Element('nav'); tabs.id = 'tabs';
    dom.doc.body.append(shell, tabs);
    await import('../src/app.js?test=sync');
    const app = window.__picknest, { ctx, syncer } = app;
    const main = dom.doc.querySelector('#main');
    const settle = async () => { await syncer.idle(); for (let i = 0; i < 5; i++) await new Promise(r => queueMicrotask(r)); };
    const badge = () => main.querySelector('.sync-badge').textContent;
    const pending = (ms) => timers.filter(x => x.fn && x.ms === ms);
    const runDebounce = () => { const due = pending(2000); for (const x of due) { const fn = x.fn; x.fn = null; fn(); } return due.length; };
    const local = () => JSON.parse(storage.getItem('picknest.local')).sync;

    // 启动：确认私有、拉取、合并别的设备加的；本机没有新的就不传
    await settle();
    assert.deepEqual(gh.log, ['GET /repos/me/data', 'GET /repos/me/data/contents/' + DATA]);
    assert.equal(main.querySelector('.list-count').textContent, '1', '首页马上有了别的设备加的');
    assert.ok(ctx.state.data.items.i_remote);
    assert.match(badge(), /^已同步 · \d{1,2}:\d{2}$/);
    assert.equal(dom.doc.querySelector('.side-foot').querySelector('.sync-badge').textContent, badge());
    assert.equal(pending(2000).length, 0, '拉下来的不再排一轮');
    assert.ok(local().sha && local().at, '同步状态存进本机设置');
    assert.equal(ctx.sync.status().on, true);

    // 本机改了：2 秒后上传（期间标签是「待同步」）；设备名是平台名
    ctx.put('items', { listId: 'l_groceries', name: '鸡蛋', status: 'need' });
    ctx.put('items', { listId: 'l_groceries', name: '面包', status: 'need' });
    await settle();
    assert.equal(badge(), '待同步');
    assert.equal(dom.doc.querySelector('.side-foot').querySelector('.sync-badge').textContent, '待同步');
    assert.equal(gh.puts, 0);
    assert.equal(runDebounce(), 1, '连着改两次只排一次');
    await settle();
    assert.equal(gh.puts, 1);
    assert.deepEqual(Object.values(gh.json().state.data.items).map(it => it.name).sort(), ['别的设备加的牛奶', '面包', '鸡蛋']);
    assert.equal(gh.json().device, 'iPhone');
    assert.equal(local().dirty, false);
    assert.equal(dom.doc.querySelector('.side-foot').querySelector('.sync-badge').textContent, badge());
    assert.ok(!JSON.stringify(gh.json()).includes('github_pat_test'), '令牌不上传');

    // 切到后台、有没传的：不等防抖，直接上传（不先拉取），带 keepalive
    ctx.put('items', { listId: 'l_tobuy', name: '台灯', status: 'need' });
    gh.log.length = 0; gh.opts.length = 0;
    dom.doc.visibilityState = 'hidden';
    await dom.doc.fire('visibilitychange');
    await settle();
    assert.deepEqual(gh.log, ['PUT /repos/me/data/contents/' + DATA]);
    assert.equal(gh.opts[0].keepalive, true);
    assert.equal(pending(2000).length, 0, '防抖的那次取消了');
    // 没改动时切到后台：什么也不发
    gh.log.length = 0;
    await dom.doc.fire('visibilitychange');
    await settle();
    assert.deepEqual(gh.log, []);

    // 勾完最后一样马上锁屏：勾选要在原地停 0.3 秒才写进数据（ui/checklist.js），切到后台时先写进去，再直接传
    dom.doc.visibilityState = 'visible';
    loc.hash = '#/l/l_groceries'; await window.fire('hashchange'); await settle();
    const egg = Object.values(ctx.state.data.items).find(it => it.name === '鸡蛋');
    await main.querySelector(`[data-fid="it-${egg.id}"]`).fire('click');
    assert.equal(ctx.state.data.items[egg.id].status, 'need', '还在原地停着，没写进数据');
    assert.equal(local().dirty, false);
    dom.doc.visibilityState = 'hidden';
    await dom.doc.fire('visibilitychange');
    await settle();
    assert.equal(ctx.state.data.items[egg.id].status, 'done', '切到后台前写进了数据');
    assert.equal(readStoredState(storage).data.items[egg.id].status, 'done', '也存进了本机');
    assert.deepEqual(gh.log, ['PUT /repos/me/data/contents/' + DATA]);
    assert.equal(gh.opts.at(-1).keepalive, true);
    assert.equal(gh.json().state.data.items[egg.id].status, 'done');
    assert.equal(local().dirty, false);
    assert.equal(pending(2000).length, 0);
    loc.hash = '#/'; await window.fire('hashchange'); await settle();
    gh.log.length = 0;

    // 切回来：离上次超过 5 秒才检查；定时器只在看得见时检查
    dom.doc.visibilityState = 'visible';
    await dom.doc.fire('visibilitychange');
    await settle();
    assert.deepEqual(gh.log, [], '刚同步过');
    Date.now = () => realNow() + 10000;
    await dom.doc.fire('visibilitychange');
    await settle();
    assert.deepEqual(gh.log, ['GET /repos/me/data/contents/' + DATA], '只拉取（5 分钟内确认过私有，不再问）');
    const every = intervals.find(x => x.ms === 60000);
    assert.ok(every, '每分钟一次');
    Date.now = () => realNow() + 20000;
    dom.doc.visibilityState = 'hidden';
    every.fn(); await settle();
    assert.equal(gh.log.length, 1, '在后台不检查');
    dom.doc.visibilityState = 'visible';
    const n304 = gh.n304;
    every.fn(); await settle();
    assert.equal(gh.log.length, 2);
    assert.ok(gh.opts.at(-1).headers['If-None-Match'], '带着上次合并时记下的 ETag 问');
    assert.equal(gh.n304, n304 + 1, '没变化：304');

    // 联网：马上同步；请求太多：在 GitHub 说的时刻之前不自动同步，标签说「稍后重试」
    gh.faults.push({ path: DATA, status: 429, headers: { 'Retry-After': '120' } });
    await window.fire('online'); await settle();
    assert.equal(local().err.code, 'rate');
    assert.equal(badge(), '稍后重试');
    gh.log.length = 0;
    await window.fire('online'); await settle();
    ctx.put('items', { listId: 'l_tobuy', name: '雨伞', status: 'need' });
    runDebounce(); await settle();
    assert.deepEqual(gh.log, [], '还没到再试的时刻');
    assert.equal((await ctx.sync.now()).ok, true, '用户点「立即同步」照样同步');
    await settle();
    assert.equal(local().err, null);
    assert.ok(Object.values(gh.json().state.data.items).some(it => it.name === '雨伞'));

    // 从备份恢复（合并进来的，算本机修改）：不等两秒，马上传；防抖的那一轮也不再多跑
    const backup = structuredClone(ctx.state);
    backup.data.items.i_bak = normalizeRecord('items', { id: 'i_bak', listId: 'l_groceries', name: '备份里的', status: 'need', updatedAt: Date.now() });
    gh.log.length = 0;
    assert.equal(ctx.mergeIn(backup).changed, 1);
    await settle();
    assert.ok(Object.values(gh.json().state.data.items).some(it => it.name === '备份里的'));
    assert.equal(gh.writes().length, 1);
    assert.equal(pending(2000).length, 0);

    // 停止同步：只清本机设置，之后什么都不发；标签变成「未开同步」
    ctx.sync.stop();
    await settle();
    assert.equal(JSON.parse(storage.getItem('picknest.local')).sync, null);
    assert.equal(badge(), '未开同步');
    gh.log.length = 0;
    ctx.put('items', { listId: 'l_tobuy', name: '书', status: 'need' });
    runDebounce();
    await window.fire('online');
    every.fn();
    await settle();
    assert.deepEqual(gh.log, []);
    assert.deepEqual(await ctx.sync.now(), { ok: true, skipped: true });
  } finally { Date.now = realNow; dom.restore(); }
});
