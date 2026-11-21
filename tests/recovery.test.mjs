import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recoveryPanel } from '../src/ui/recovery.js';
import { blankState, normalizeRecord } from '../src/core/store.js';
import { PENDING_PREFIX, STATE_KEY } from '../src/core/persistence.js';
import { setLang, t } from '../src/i18n.js';
import { SyncError } from '../src/core/sync.js';
import { buildBackup } from '../src/core/backup.js';
import { Element, all, find, fakeStorage, installDom } from './helpers/dom.mjs';

// 测试只用编出来的数据
const item = (id, name) => normalizeRecord('items', { id, listId: 'l_groceries', name, status: 'need', updatedAt: 1000 });
function panel({ accept = true, fail = null, code = 'corrupt', original = { records: [{ key: STATE_KEY, raw: '{broken' }] }, sync = null, cloud = null } = {}) {
  const dom = installDom(); setLang('zh-Hans');
  const repairs = [], confirms = [];
  let retries = 0;
  const state = blankState(); state.data.items.local = item('local', '可读取的测试记录');
  state.data.items.gone = { ...item('gone', '删掉的'), deleted: true };
  const ctx = { state, local: { sync }, lang: () => 'zh-Hans', storageIssue: () => ({ code }), recoveryExport: () => original, recoveryCloud: cloud,
    retryData() { retries++; },
    confirm: async options => { confirms.push(options); return accept; },
    repairData: async next => { if (fail) throw new Error(fail); repairs.push(next); } };
  const main = new Element('main'); recoveryPanel(main, ctx);
  return { ...dom, main, ctx, repairs, confirms, retries: () => retries, button: key => find(main, el => el.tag === 'button' && el.textContent === t(key)) };
}

test('恢复页：说明受保护状态和读得出来的数量；下载、重新读取、从备份恢复、保留可读部分（没开过同步就没有「从云端恢复」）', () => {
  const env = panel();
  try {
    assert.ok(env.main.textContent.includes(t('recovery.intro')));
    assert.ok(env.main.textContent.includes(t('recovery.readable', { lists: 0, items: 1 })), '删除了的不算');
    assert.deepEqual(all(env.main, el => el.tag === 'button').map(b => b.textContent), [t('recovery.export'), t('recovery.retry'), t('recovery.backup'), t('recovery.keep')]);
    assert.ok(!env.button('recovery.export').disabled);
    assert.ok(!env.main.textContent.includes(t('recovery.unavailable')));
  } finally { env.restore(); }
});

test('恢复页：继续前确认，只使用读得出来的数据；取消不执行恢复', async () => {
  for (const accept of [true, false]) {
    const env = panel({ accept });
    try {
      await env.button('recovery.keep').fire('click');
      assert.equal(env.confirms.length, 1);
      assert.equal(env.confirms[0].message, t('recovery.keepConfirm'));
      assert.equal(env.repairs.length, Number(accept));
      if (accept) assert.equal(env.repairs[0].data.items.local.name, '可读取的测试记录');
      assert.equal(find(env.main, el => el.attrs.role === 'alert').hidden, true);
    } finally { env.restore(); }
  }
});

test('恢复页「从备份恢复」：选的文件读出来、先确认（会合并、原件先存档），再用它修复；读不出来、不是 PickNest 的文件说清楚，不问', async () => {
  const env = panel();
  try {
    const picker = find(env.main, el => el.tag === 'input' && el.attrs.type === 'file');
    const pick = async (text) => { picker.files = [{ text: async () => text }]; await picker.fire('change'); };
    await pick('{"app":"babble","v":1,"state":{}}');
    const status = find(env.main, el => el.attrs.role === 'alert');
    assert.deepEqual([status.hidden, status.textContent], [false, t('backup.err.notApp')]);
    assert.equal(env.confirms.length, 0);
    const backup = blankState(); backup.data.items.b1 = item('b1', '备份里的测试记录');
    await pick(buildBackup(backup));
    assert.equal(env.confirms[0].message, t('recovery.confirmText'));
    assert.equal(env.repairs.length, 1);
    assert.equal(env.repairs[0].data.items.b1.name, '备份里的测试记录');
    assert.equal(status.hidden, true);
  } finally { env.restore(); }
});

test('恢复页「从云端恢复」：开过同步才有；取云端那一份、确认后修复；云端没有 / 令牌不对时说清楚', async () => {
  let answer = null;
  const remote = blankState(); remote.data.items.c1 = item('c1', '云端的测试记录');
  const env = panel({ sync: { repo: 'me/data', token: 'github_pat_test' }, cloud: async () => { if (answer) throw answer; return remote; } });
  try {
    const cloudBtn = env.button('recovery.cloud');
    assert.ok(cloudBtn);
    const status = find(env.main, el => el.attrs.role === 'alert');
    answer = new SyncError('nofile', { file: 'picknest.json' });
    await cloudBtn.fire('click');
    assert.deepEqual([status.hidden, status.textContent], [false, t('recovery.noCloud')]);
    answer = new SyncError('auth');
    await cloudBtn.fire('click');
    assert.equal(status.textContent, t('recovery.cloudAuth'), '不叫人点这一页上没有的「换令牌」：先修好本机数据，再去换令牌');
    assert.ok(!status.textContent.includes('点「换令牌」换一个新的'));
    answer = new SyncError('perm');
    await cloudBtn.fire('click');
    assert.equal(status.textContent, t('syncErr.perm'));
    assert.equal(env.repairs.length, 0);
    answer = null;
    await cloudBtn.fire('click');
    assert.equal(env.repairs[0].data.items.c1.name, '云端的测试记录');
    assert.equal(status.hidden, true);
  } finally { env.restore(); }
});

test('恢复页：恢复失败时说明原因、按钮恢复可用；没有锁时提示存储不可用', async () => {
  for (const [fail, key] of [['quota', 'recovery.failed'], ['recovery-unavailable', 'recovery.unavailable']]) {
    const env = panel({ fail });
    try {
      await env.button('recovery.keep').fire('click');
      assert.equal(env.repairs.length, 0);
      const status = find(env.main, el => el.attrs.role === 'alert');
      assert.equal(status.hidden, false);
      assert.equal(status.textContent, t(key));
      assert.equal(env.button('recovery.keep').disabled, false);
    } finally { env.restore(); }
  }
});

test('恢复页：重新读取；还是读不出来时说一声并更新数量；存储用不了时多一句说明；没有原始数据时下载按钮不可用', async () => {
  const env = panel({ code: 'unavailable', original: null });
  try {
    assert.ok(env.main.textContent.includes(t('recovery.unavailable')));
    assert.equal(env.button('recovery.export').disabled, true);
    const retry = env.ctx.retryData;
    env.ctx.retryData = () => { retry(); env.ctx.state.data.lists.l_x = normalizeRecord('lists', { id: 'l_x', name: '重新读到的', updatedAt: 1 }); };
    await env.button('recovery.retry').fire('click');
    assert.equal(env.retries(), 1);
    const status = find(env.main, el => el.attrs.role === 'alert');
    assert.deepEqual([status.hidden, status.textContent], [false, t('recovery.stillBroken')], '读取是同步的：不说一声就看不出点没点到');
    assert.ok(env.main.textContent.includes(t('recovery.readable', { lists: 1, items: 1 })), '数量按重新读到的更新');
    assert.equal(env.button('recovery.export').disabled, true, '解锁后仍按原来的状态');
  } finally { env.restore(); }
});

test('真实 App 冷启动：损坏数据进入恢复页、不画清单；别的标签页修好后解除保护；存储失效后用「重新读取」恢复', async () => {
  const storage = fakeStorage([[STATE_KEY, '{broken'], ['picknest.local', JSON.stringify({ lang: 'en', theme: 'dark' })],
    [PENDING_PREFIX + 'healthy', JSON.stringify({ app: 'picknest', v: 1, patch: { data: { items: { i1: item('i1', '完整的测试记录') } } } })]]);
  const loc = { hash: '#/', protocol: 'http:' };
  const dom = installDom({ localStorage: storage, location: loc, history: { state: {}, replaceState(s, title, hash) { loc.hash = hash; }, back() {} },
    navigator: { languages: ['zh-CN'], locks: { request: async (name, fn) => fn() } },
    matchMedia: () => ({ matches: false, addEventListener() {} }), setTimeout: () => 0, setInterval: () => 0 });
  try {
    const shell = new Element('div'); shell.className = 'app';
    for (const id of ['side', 'main']) { const el = new Element('div'); el.id = id; shell.append(el); }
    const tabs = new Element('nav'); tabs.id = 'tabs';
    dom.doc.body.append(shell, tabs);
    const meta = new Element('meta'); meta.setAttribute('name', 'theme-color'); meta.content = '#f6f5f0';
    dom.doc.documentElement.append(meta);
    await import('../src/app.js?test=corrupt-start');
    const app = window.__picknest;
    assert.equal(app.state.storageIssue().code, 'corrupt');
    // 恢复页也用选好的语言（读屏按 lang 选发音）和深浅色（状态栏和页面一样深）
    const root = dom.doc.documentElement;
    assert.deepEqual([root.lang, root.dataset.theme, meta.content], ['en', 'dark', '#121412']);
    assert.equal(app.state.getState().data.items.i1.name, '完整的测试记录');
    const screen = () => dom.doc.querySelector('.recovery-screen');
    assert.ok(screen());
    assert.ok(screen().textContent.includes(t('recovery.readable', { lists: 0, items: 1 })));
    assert.equal(dom.doc.querySelector('#main').children.length, 0, '不画（空的）清单页');
    assert.notEqual(shell.getAttribute('inert'), null);
    assert.notEqual(tabs.getAttribute('inert'), null);
    assert.equal(app.ctx.navigate('/settings'), false, '保护期间不换页');
    assert.equal(storage.getItem(STATE_KEY), '{broken');
    // 另一页修好数据后发来的 storage 事件：本页也必须解除保护并画出清单，而不是留成空屏
    storage.setItem(STATE_KEY, JSON.stringify(app.state.getState()));
    app.state.reload();
    assert.equal(app.state.storageIssue(), null);
    assert.equal(screen(), null);
    assert.equal(shell.getAttribute('inert'), null);
    const names = () => dom.doc.querySelector('#main').querySelectorAll('.list-name').map(el => el.textContent);
    assert.deepEqual(names(), ['Groceries', 'To Buy'], '修好后补上预置清单');
    assert.equal(dom.doc.querySelector('#main').querySelector('.list-count').textContent, '1');
    // 已打开页面访问权限临时失效：通过真实的「重新读取」按钮重新连接存储
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('SecurityError'); } });
    app.state.reload();
    assert.equal(app.state.storageIssue().code, 'unavailable');
    assert.ok(screen());
    const replacement = fakeStorage([...storage.m]);
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: replacement });
    await find(screen(), el => el.tag === 'button' && el.textContent === t('recovery.retry')).fire('click');
    assert.equal(app.state.storageIssue(), null);
    assert.equal(app.state.saveOk(), true);
    assert.equal(screen(), null);
    assert.deepEqual(names(), ['Groceries', 'To Buy']);
    assert.ok(JSON.parse(replacement.getItem(STATE_KEY)).data.items.i1);
  } finally { setLang('zh-Hans'); dom.restore(); }
});

