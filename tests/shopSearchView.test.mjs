// 购物模式（#/l/<id>?shop=1、#/s/<id>?shop=1）和搜索（#/search?q=）两个页面：假 DOM + 真的 state.js（只用内存）+ 假的 navigator.wakeLock。
// 假 ctx 照着 app.js：改数据走 state.mutate，带 undoLabel 的弹「撤销」提示，数据变了在微任务里调页面的 onChange。全是编的数据
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as shopView from '../src/views/shop.js';
import * as searchView from '../src/views/search.js';
import * as state from '../src/core/state.js';
import { normalizeRecord, deletedRecord } from '../src/core/store.js';
import { createList, setArchived } from '../src/core/lists.js';
import { memoryOf } from '../src/core/memory.js';
import { setLang, t } from '../src/i18n.js';
import { Element, all, find, installDom } from './helpers/dom.mjs';

const settle = async (n = 5) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)); };
const cls = (el, c) => (el.className || el.attrs.class || '').split(' ').includes(c);
const byCls = (root, c) => find(root, el => cls(el, c));
const allCls = (root, c) => all(root, el => cls(el, c));
const btn = (root, label) => find(root, el => el.tag === 'button' && el.textContent === label);
const btns = (root, label) => all(root, el => el.tag === 'button' && el.textContent === label);
const S = () => state.getState();
const itemNamed = (name) => Object.values(S().data.items).find(it => it.name === name && !it.deleted);

/** 编的数据：食材清单（要买 3 样、已买 1 样）、想买（有一样以后再说）、一张归档的清单 */
function seed(s) {
  const old = createList(s, { name: '去年的年货', kind: 'grocery', icon: '\u{1F9E7}' }, 1000).id;
  let n = 0;
  const add = (listId, name, f = {}) => { const id = 'i_t' + n++; s.data.items[id] = normalizeRecord('items', { id, listId, name, status: 'need', updatedAt: 1, ...f }); };
  add('l_groceries', '牛奶', { storeId: 's_wholefoods', categoryId: 'c_dairy', qty: 2 });
  add('l_groceries', '鸡蛋', { storeId: 's_wholefoods', categoryId: 'c_dairy', qty: 12 });
  add('l_groceries', '豆腐', { storeId: 's_hmart', categoryId: 'c_produce' });
  add('l_groceries', '吐司', { storeId: 's_wholefoods', categoryId: 'c_bakery', status: 'done', doneAt: 5000 });
  add('l_tobuy', '机械键盘', { storeId: 's_amazon', note: '要静音轴\n配牛奶色的键帽' });
  add('l_tobuy', '雨伞', { storeId: 's_wholefoods', status: 'later' });
  add('l_tobuy', '台灯', { storeId: 's_wholefoods' });
  add(old, '雞蛋卷', { storeId: 's_wholefoods' });
  setArchived(s, old, true, 1001);
}

/** 假的屏幕常亮：要一次给一个 sentinel，记下放了几次 */
function fakeWakeLock() {
  const w = { requests: 0, released: 0 };
  w.request = async () => { w.requests++; return { release: async () => { w.released++; }, addEventListener() {} }; };
  return w;
}

/** 假 ctx。page：'shop' | 'search'；面板：记下内容和按钮，不开真的 <dialog> */
function setup({ page, params = {}, lang = 'zh-Hans', wakeLock = undefined, prep = null }) {
  const dom = installDom({ navigator: { wakeLock } });
  setLang(lang);
  state.load({ storage: null });
  state.mutate(seed);
  if (prep) state.mutate(prep);
  const views = { shop: shopView, search: searchView };
  const env = { ...dom, toasts: [], navs: [], hashes: [], sheets: [], confirms: [], answer: true, handle: null };
  const ctx = env.ctx = {
    t, lang: () => lang, layout: () => 'phone',
    get state() { return S(); }, get local() { return state.getLocal(); },
    setLocal: (p) => state.setLocal(p),
    mutate: (fn, o) => state.mutate(fn, o),
    toast: (msg, o = {}) => env.toasts.push({ msg, ...o }),
    confirm: async (o) => { env.confirms.push(o); return env.answer; },
    navigate: (p, o) => env.navs.push(p), back: (p) => env.navs.push('back:' + p), replaceHash: (p) => env.hashes.push(p),
    sheet(content, opts = {}) {
      const el = new Element('dialog');
      const api = { el, body: el, opts, open: true,
        close() { if (!api.open) return; api.open = false; env.sheets = env.sheets.filter(x => x !== api); if (opts.onClose) opts.onClose(); },
        tryClose() { if (!opts.beforeClose || opts.beforeClose() !== false) api.close(); } };
      const node = typeof content === 'function' ? content(api) : content;
      if (node) el.append(node);
      if (opts.foot) el.append(...opts.foot);
      env.sheets.push(api);
      return api;
    },
  };
  const off = state.subscribe((st, info) => {
    if (info.undoLabel) ctx.toast(info.undoLabel, { ms: 10000, action: { label: t('common.undo'), run: () => state.undo() } });
    queueMicrotask(() => { if (env.handle && env.handle.onChange) env.handle.onChange(info); });
  });
  env.main = new Element('section');
  const ret = views[page].render(env.main, { name: page, query: {}, ...params }, ctx);
  env.handle = ret && typeof ret === 'object' ? ret : null;
  Object.assign(env, {
    rows: (root = env.main) => allCls(root, 'item-row').map(r => byCls(r, 'item-name').textContent),
    row: (name) => allCls(env.main, 'item-row').find(r => byCls(r, 'item-name').textContent === name),
    sec: (k) => byCls(env.main, 'sec-' + k),
    prog: () => byCls(env.main, 'shop-prog-text').textContent,
    bar: () => byCls(env.main, 'shop-bar'),
    tap: async (name) => { await byCls(env.row(name), 'item-tick').fire('click'); await settle(); },
    input: () => byCls(env.main, 'search-input'),
    async type(text) { const i = env.input(); i.value = text; await i.fire('input'); await settle(); },
    done() { if (env.handle && env.handle.cleanup) env.handle.cleanup(); off(); dom.restore(); setLang('zh-Hans'); },
  });
  return env;
}

// ---------- 购物模式 ----------
test('购物模式（清单）：上面是名字、完成购物、「已买 N · 还剩 M」和进度条；只有要买的，已买收在最下面（折起来的）；没有返回、快速添加、以后再说', async () => {
  const wake = fakeWakeLock();
  const env = setup({ page: 'shop', params: { sub: 'list', id: 'l_groceries' }, wakeLock: wake });
  try {
    assert.equal(byCls(env.main, 'shop-name').textContent, '食材');
    assert.equal(byCls(env.main, 'shop-title').attrs.tabindex, '-1');
    assert.equal(env.prog(), '已买 1 · 还剩 3');
    assert.deepEqual([env.bar().attrs.role, env.bar().attrs['aria-valuenow'], env.bar().attrs['aria-valuemax'], env.bar().attrs['aria-valuetext']], ['progressbar', '1', '4', '已买 1 · 还剩 3']);
    assert.equal(byCls(env.main, 'shop-bar-fill').style.width, '25%');
    assert.deepEqual(allCls(env.main, 'group-h').map(x => x.textContent), ['蔬果', '蛋奶'], '和清单页同一套分组');
    assert.deepEqual(env.rows(), ['豆腐', '鸡蛋', '牛奶'], '已买的收起来了（普通清单页的「已买」默认是展开的）');
    const doneToggle = () => byCls(env.sec('done'), 'sec-toggle');
    assert.deepEqual([doneToggle().textContent, doneToggle().attrs['aria-expanded']], ['已买（1）', 'false']);
    assert.equal(byCls(env.row('豆腐'), 'store-chip').textContent, 'H Mart', '不在默认商店买的照样标店名');
    assert.equal(byCls(env.main, 'back'), undefined, '没有返回');
    assert.equal(byCls(env.main, 'add-input'), undefined, '没有快速添加');
    assert.equal(byCls(env.main, 'seg'), undefined);
    // 屏幕常亮：拿到了不说（少一行字）
    await settle();
    assert.equal(wake.requests, 1);
    assert.equal(byCls(env.main, 'shop-wake').hidden, true);
    // 点圆圈勾掉：收进已买、进度跟着走、记下这次在哪家买的（和清单页同一个 setStatus）
    await env.tap('牛奶');
    assert.equal(itemNamed('牛奶').status, 'done');
    assert.equal(memoryOf(S(), '牛奶').stores.s_wholefoods.n, 1);
    assert.equal(env.prog(), '已买 2 · 还剩 2');
    assert.equal(byCls(env.main, 'shop-bar-fill').style.width, '50%');
    assert.deepEqual(env.rows(), ['豆腐', '鸡蛋']);
    assert.equal(doneToggle().textContent, '已买（2）');
    // 点开「已买」：只管这一次购物，不改普通清单页的设置
    doneToggle().focus();
    await doneToggle().fire('click');
    assert.equal(doneToggle().attrs['aria-expanded'], 'true');
    assert.equal(document.activeElement, doneToggle(), '重画后焦点还在折叠按钮上');
    assert.deepEqual(env.rows(env.sec('done')), ['牛奶', '吐司'], '新的在前');
    assert.deepEqual(state.getLocal().view, {}, '没写本机设置');
    // 在已买里点一下放回去；「已买」照样开着
    await byCls(find(env.sec('done'), el => cls(el, 'item-row') && byCls(el, 'item-name').textContent === '牛奶'), 'item-tick').fire('click');
    await settle();
    assert.equal(itemNamed('牛奶').status, 'need');
    assert.equal(env.prog(), '已买 1 · 还剩 3');
    assert.deepEqual(env.rows(env.sec('done')), ['吐司']);
    await doneToggle().fire('click');
    assert.deepEqual(env.rows(env.sec('done')), []);
    // 完成购物：回到普通的清单页；离开时放掉常亮
    await btn(byCls(env.main, 'shop-top'), '完成购物').fire('click');
    assert.deepEqual(env.navs, ['back:/l/l_groceries']);
  } finally { env.done(); }
  await settle();
  assert.equal(wake.released, 1, '离开购物模式时放掉常亮');
});

test('购物模式：都买齐了 → 「都买齐了」带完成购物、清除已买（能撤销）；清完是「这里没有要买的东西」', async () => {
  const env = setup({ page: 'shop', params: { sub: 'list', id: 'l_groceries' } });
  try {
    assert.equal(byCls(env.main, 'shop-end'), undefined);
    for (const name of ['豆腐', '鸡蛋', '牛奶']) await env.tap(name);
    assert.equal(env.prog(), '已买 4 · 还剩 0');
    const end = byCls(env.main, 'shop-end');
    assert.equal(byCls(end, 'shop-end-t').textContent, '都买齐了');
    assert.equal(byCls(end, 'shop-end-hint').textContent, '这一页上的 4 样都买到了。');
    assert.deepEqual(all(end, el => el.tag === 'button').map(b => b.textContent), ['完成购物', '清除已买']);
    assert.equal(btns(env.main, '清除已买').length, 1, '「已买」旁边不再放一个');
    await btn(end, '完成购物').fire('click');
    assert.deepEqual(env.navs, ['back:/l/l_groceries']);
    btn(end, '清除已买').focus();
    await btn(end, '清除已买').fire('click');
    await settle();
    assert.equal(env.toasts.at(-1).msg, '已清除 4 样');
    assert.equal(env.sec('done'), undefined);
    assert.equal(byCls(env.main, 'shop-end'), undefined);
    assert.ok(byCls(env.main, 'shop-none').textContent.includes('这里没有要买的东西'));
    assert.equal(document.activeElement, byCls(env.main, 'shop-title'), '按过的按钮没了：焦点给标题');
    assert.equal(env.prog(), '已买 0 · 还剩 0');
    env.toasts.at(-1).action.run();
    await settle();
    assert.equal(byCls(env.sec('done'), 'sec-toggle').textContent, '已买（4）', '撤销：都回到已买');
  } finally { env.done(); }
});

test('购物模式（商店）：所有清单里在这家买的，标来自哪张清单；不支持常亮就淡淡地说一句；「已买」折着、点开不改商店页的设置；英文界面', async () => {
  const env = setup({ page: 'shop', params: { sub: 'store', id: 's_wholefoods' }, lang: 'en' });
  try {
    assert.equal(byCls(env.main, 'shop-name').textContent, 'Whole Foods');
    assert.equal(env.prog(), '1 bought · 3 to go');
    assert.deepEqual(env.rows(), ['牛奶', '鸡蛋', '台灯'], '雨伞以后再说、雞蛋卷在归档的清单上：都不在（英文界面按英文的规则排）；已买的折着');
    assert.equal(byCls(env.row('台灯'), 'list-chip').textContent, '\u{1F6CD}️To Buy');
    assert.equal(byCls(env.main, 'shop-wake').textContent, 'This device can’t keep the screen on');
    assert.equal(byCls(env.main, 'shop-wake').hidden, false);
    await byCls(env.sec('done'), 'sec-toggle').fire('click');
    assert.deepEqual(env.rows(env.sec('done')), ['吐司']);
    assert.deepEqual(state.getLocal().storeView, {}, '商店页的「已买」设置不动');
    await btn(byCls(env.main, 'shop-top'), 'Done Shopping').fire('click');
    assert.deepEqual(env.navs, ['back:/s/s_wholefoods']);
  } finally { env.done(); }
  const none = setup({ page: 'shop', params: { sub: 'store', id: 'none' } });
  try {
    assert.equal(byCls(none.main, 'shop-name').textContent, '未指定');
    assert.equal(none.prog(), '已买 0 · 还剩 0');
    assert.ok(byCls(none.main, 'shop-none'));
    await btn(byCls(none.main, 'shop-none'), '完成购物').fire('click');
    assert.deepEqual(none.navs, ['back:/s/none']);
  } finally { none.done(); }
});

test('购物模式：按商店分组的清单组名是店名（要买的不再标店名）；清单删掉了 → 回首页并提示，点过的不改；商店不在了 → 回「商店」', async () => {
  const env = setup({ page: 'shop', params: { sub: 'list', id: 'l_groceries' }, prep: () => state.setLocal({ view: { l_groceries: { groupBy: 'store' } } }) });
  try {
    assert.deepEqual(allCls(env.main, 'group-h').map(x => x.textContent), ['Whole Foods', 'H Mart']);
    assert.equal(byCls(env.row('豆腐'), 'store-chip'), undefined);
    state.mutate(s => { s.data.lists.l_groceries = { ...s.data.lists.l_groceries, sys: null, name: '我的' }; });
    await settle();
    assert.equal(byCls(env.main, 'shop-name').textContent, '我的', '改了名字跟着换');
    state.mutate(s => { s.data.lists.l_groceries = deletedRecord(s.data.lists.l_groceries); });
    await settle();
    assert.deepEqual(env.navs, ['/']);
    assert.equal(env.toasts.at(-1).msg, '这张清单不在了');
  } finally { env.done(); }
  const gone = setup({ page: 'shop', params: { sub: 'store', id: 's_nope' } });
  try {
    await settle();
    assert.deepEqual(gone.navs, ['/stores']);
    assert.equal(gone.toasts.at(-1).msg, '这家店不在了');
  } finally { gone.done(); }
});

test('购物模式：常亮被拒绝 → 最下面淡淡地说一句；点一下页面（click：手指松开才算点过）再要一次，要的时候这一行不藏起来（页面最下面不跳）', async () => {
  const wake = { requests: 0, request: async () => { wake.requests++; throw Object.assign(new Error('not allowed'), { name: 'NotAllowedError' }); } };
  const env = setup({ page: 'shop', params: { sub: 'list', id: 'l_groceries' }, wakeLock: wake });
  try {
    await settle();
    const line = byCls(env.main, 'shop-wake');
    assert.deepEqual([wake.requests, line.hidden, line.textContent], [1, false, '没能让屏幕保持常亮（比如开着低电量模式）']);
    assert.equal(env.main.events.pointerdown, undefined, '不在手指按下时再要（那时还不算点过，浏览器不当成点按）');
    const tapped = env.main.fire('click');
    assert.equal(wake.requests, 2, '点一下再要一次');
    assert.deepEqual([line.hidden, line.textContent], [false, '没能让屏幕保持常亮（比如开着低电量模式）'], '正在要的时候这一行不动');
    await tapped;
    await settle();
    assert.deepEqual([line.hidden, line.textContent], [false, '没能让屏幕保持常亮（比如开着低电量模式）']);
  } finally { env.done(); }
  assert.equal(env.main.events.click.size, 0, '离开时不再听');
});

// ---------- 搜索 ----------
test('搜索：还没写搜索词时说明怎么搜、焦点在搜索框；打字马上出结果（按清单分组，归档的标出来），命中的字标出来，地址栏跟着换', async () => {
  const env = setup({ page: 'search' });
  try {
    assert.equal(document.activeElement, env.input(), '焦点在搜索框');
    assert.equal(env.input().attrs.type, 'search');
    assert.ok(byCls(env.main, 'search-hint').textContent.includes('雞蛋'));
    const input = env.input();
    await env.type('雞蛋');
    assert.equal(env.input(), input, '输入框不重画');
    assert.deepEqual(env.hashes, ['/search?q=' + encodeURIComponent('雞蛋')]);
    assert.equal(byCls(env.main, 'search-found').textContent, '找到 2 样');
    assert.equal(byCls(env.main, 'search-found').attrs.role, 'status');
    const heads = allCls(env.main, 'sr-list');
    assert.deepEqual(heads.map(a => [a.attrs.href, byCls(a, 'sr-list-name').textContent, !!byCls(a, 'tag')]),
      [['#/l/l_groceries', '食材', false], [heads[1].attrs.href, '去年的年货', true]], '组名是清单（点了进那张清单），归档的标「已归档」');
    assert.equal(byCls(heads[1], 'tag').textContent, '已归档');
    assert.deepEqual(env.rows(), ['鸡蛋', '雞蛋卷'], '繁体搜到简体写的「鸡蛋」');
    assert.deepEqual(all(env.row('鸡蛋'), el => el.tag === 'mark').map(m => m.textContent), ['鸡蛋'], '标的是原文');
    assert.deepEqual(all(env.row('雞蛋卷'), el => el.tag === 'mark').map(m => m.textContent), ['雞蛋']);
    // 备注里命中的：显示那一行，标出来；以后再说的标出来
    await env.type('键帽');
    assert.deepEqual(env.rows(), ['机械键盘']);
    assert.equal(byCls(env.row('机械键盘'), 'item-note').textContent, '配牛奶色的键帽');
    assert.deepEqual(all(byCls(env.row('机械键盘'), 'item-note'), el => el.tag === 'mark').map(m => m.textContent), ['键帽']);
    await env.type('雨伞');
    assert.equal(byCls(env.row('雨伞'), 'sr-later').textContent, '以后再说');
    // 清空：回到说明，地址栏也去掉 q
    await env.type('');
    assert.ok(byCls(env.main, 'search-hint'));
    assert.equal(env.hashes.at(-1), '/search');
    assert.equal(byCls(env.main, 'search-found').textContent, '');
  } finally { env.done(); }
});

test('搜索：点圆圈勾掉 / 放回去（和清单页一样），已买的画淡排在后面；点这一行打开编辑面板；别处改了数据只重画结果；输入法选字时不搜；Esc 清空、回车收起键盘；没找到', async () => {
  const env = setup({ page: 'search', params: { query: { q: '牛奶' } } });
  try {
    assert.equal(env.input().value, '牛奶');
    assert.equal(document.activeElement, env.input(), '带着搜索词打开（重新载入、后退回来）：焦点也在搜索框，接着打字就能改');
    assert.deepEqual(env.rows(), ['牛奶', '机械键盘']);
    await env.tap('牛奶');
    assert.equal(itemNamed('牛奶').status, 'done');
    assert.ok(cls(env.row('牛奶'), 'done'), '已买的画淡（划线）');
    await env.tap('牛奶');
    assert.equal(itemNamed('牛奶').status, 'need');
    await byCls(env.row('机械键盘'), 'item-main').fire('click');
    assert.equal(env.sheets.at(-1).opts.title, '编辑');
    env.sheets.at(-1).close();
    // 别的设备加了一样：结果跟着变，输入框、焦点不动
    const input = env.input();
    input.focus();
    state.mutate(s => { s.data.items.i_new = normalizeRecord('items', { id: 'i_new', listId: 'l_tobuy', name: '牛奶锅', status: 'need', updatedAt: 9 }); });
    await settle();
    assert.equal(env.input(), input);
    assert.equal(document.activeElement, input);
    assert.deepEqual(env.rows(), ['牛奶', '机械键盘', '牛奶锅']);
    // 输入法还在选字：不搜；选好字再搜
    input.value = 'ji';
    for (const fn of input.events.input) fn({ isComposing: true });
    await settle();
    assert.equal(env.rows().length, 3, '拼音字母不先搜');
    input.value = '鸡';
    for (const fn of input.events.compositionend) fn({});
    await settle();
    assert.deepEqual(env.rows(), ['鸡蛋', '雞蛋卷']);
    // 回车收起键盘（焦点离开搜索框）；Esc 清空
    for (const fn of input.events.keydown) fn({ key: 'Enter', preventDefault() {} });
    assert.notEqual(document.activeElement, input);
    for (const fn of input.events.keydown) fn({ key: 'Escape', preventDefault() {} });
    await settle();
    assert.equal(input.value, '');
    assert.ok(byCls(env.main, 'search-hint'));
    // 没找到：大字说一句；「找到 N 样」那里只给读屏念
    await env.type('榴莲');
    assert.ok(byCls(env.main, 'lp-empty').textContent.includes('没有找到「榴莲」'));
    assert.equal(byCls(env.main, 'search-found').textContent, '没有找到「榴莲」');
    assert.ok(cls(byCls(env.main, 'search-found'), 'sr-only'));
  } finally { env.done(); }
});
