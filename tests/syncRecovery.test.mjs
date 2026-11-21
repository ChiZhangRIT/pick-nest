// 真实 App：本机数据读不出来（恢复页）时一律不同步——一个请求都不发、残缺的数据不会传上去；「从云端恢复」只读地取仓库里那一份，
// 原件先存档再替换；修好以后同步照常（合并的结果传上去）。假 DOM + 假的 GitHub（tests/helpers/github.mjs，不联网），全是编的数据
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockGitHub, DATA } from './helpers/github.mjs';
import { normalizeRecord } from '../src/core/store.js';
import { STATE_KEY, PENDING_PREFIX, ARCHIVE_PREFIX, readStoredState } from '../src/core/persistence.js';
import { t } from '../src/i18n.js';
import { Element, find, fakeStorage, installDom } from './helpers/dom.mjs';

const item = (id, name, updatedAt = Date.now() - 1000) => normalizeRecord('items', { id, listId: 'l_groceries', name, status: 'need', updatedAt });

test('恢复页期间不同步；「从云端恢复」只读、先确认、原件存档；修好后同步照常，合并的结果传上去', async () => {
  const gh = mockGitHub();
  gh.pushJson(s => { s.data.items.i_cloud = item('i_cloud', '云端的牛奶'); });
  const storage = fakeStorage([[STATE_KEY, '{broken'], ['picknest.local', JSON.stringify({ sync: { repo: 'me/data', token: 'github_pat_test', sha: 'old', etag: 'old' } })],
    [PENDING_PREFIX + 'ok', JSON.stringify({ app: 'picknest', v: 1, patch: { data: { items: { i_local: item('i_local', '本机读得出来的鸡蛋') } } } })]]);
  const loc = { hash: '#/', protocol: 'http:' };
  const timers = [];
  const dom = installDom({ localStorage: storage, location: loc, history: { state: {}, replaceState(s, title, hash) { loc.hash = hash; }, back() {} },
    navigator: { languages: ['zh-CN'], locks: { request: async (name, fn) => fn() } }, matchMedia: () => ({ matches: false, addEventListener() {} }),
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].fn = null; }, setInterval: () => 0,
    getComputedStyle: () => ({ bottom: '24px' }), requestAnimationFrame: () => 0, MutationObserver: class { observe() {} disconnect() {} }, CSS: { escape: String },
    fetch: (...a) => gh.fetch(...a) });
  try {
    dom.doc.visibilityState = 'visible';
    const shell = new Element('div'); shell.className = 'app';
    for (const id of ['side', 'main']) { const el = new Element('div'); el.id = id; shell.append(el); }
    const tabs = new Element('nav'); tabs.id = 'tabs';
    dom.doc.body.append(shell, tabs);
    await import('../src/app.js?test=sync-recovery');
    const app = window.__picknest, { ctx, syncer } = app;
    const settle = async () => { await syncer.idle(); for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); };
    await settle();
    assert.equal(app.state.storageIssue().code, 'corrupt');
    assert.deepEqual(gh.log, [], '启动时不同步');
    // 联网、切回来、立即同步：都不发
    await window.fire('online');
    dom.doc.visibilityState = 'hidden'; await dom.doc.fire('visibilitychange'); dom.doc.visibilityState = 'visible'; await dom.doc.fire('visibilitychange');
    assert.deepEqual(await ctx.sync.now(), { ok: false, skipped: true });
    await settle();
    assert.deepEqual(gh.log, []);

    const screen = dom.doc.querySelector('.recovery-screen');
    const button = (label) => find(screen, el => el.tag === 'button' && el.textContent === label);
    assert.ok(button(t('recovery.cloud')), '开过同步：有「从云端恢复」');
    const asked = [];
    ctx.confirm = async (o) => { asked.push(o); return true; };      // 恢复页拿着同一个 ctx，确认框换成直接答「是」
    await button(t('recovery.cloud')).fire('click');
    await settle();
    assert.deepEqual(gh.log, ['GET /repos/me/data/contents/' + DATA], '只读：一个 GET，要原文');
    assert.equal(gh.opts[0].headers.Accept, 'application/vnd.github.raw+json');
    assert.equal(asked[0].message, t('recovery.confirmText'));
    assert.equal(app.state.storageIssue(), null);
    assert.equal(dom.doc.querySelector('.recovery-screen'), null);
    const disk = readStoredState(storage);
    assert.deepEqual([disk.data.items.i_cloud.name, disk.data.items.i_local.name], ['云端的牛奶', '本机读得出来的鸡蛋'], '读得出来的和云端的合并');
    assert.ok([...storage.m.keys()].some(k => k.startsWith(ARCHIVE_PREFIX)), '原件先存档');
    assert.equal(ctx.recoveryArchive().records.find(r => r.key === STATE_KEY).raw, '{broken');
    assert.equal(gh.puts, 0, '确认、存档之前没有上传');
    // 修好以后：同步照常（云端版本号清掉了，完整拉取一次再把合并的结果传上去）
    const due = timers.filter(x => x.fn && x.ms === 2000);
    assert.equal(due.length, 1, '修好算本机修改：排了一次同步');
    due[0].fn(); await settle();
    assert.equal(gh.puts, 1);
    assert.ok(gh.json().state.data.items.i_local, '本机读得出来的那样传上去了');
    assert.equal(JSON.parse(storage.getItem('picknest.local')).sync.dirty, false);
  } finally { dom.restore(); }
});
