// 搜索（#/search?q=）：假 DOM + 真的 state.js（只用内存）。
// 假 ctx 照着 app.js：改数据走 state.mutate，带 undoLabel 的弹「撤销」提示，数据变了在微任务里调页面的 onChange。全是编的数据
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as searchView from '../src/views/search.js';
import * as state from '../src/core/state.js';
import { normalizeRecord } from '../src/core/store.js';
import { createList, setArchived } from '../src/core/lists.js';
import { setLang, t } from '../src/i18n.js';
import { Element, all, find, installDom } from './helpers/dom.mjs';

const settle = async (n = 5) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)); };
const cls = (el, c) => (el.className || el.attrs.class || '').split(' ').includes(c);
const byCls = (root, c) => find(root, el => cls(el, c));
const allCls = (root, c) => all(root, el => cls(el, c));
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

/** 假 ctx。page：'search'；面板：记下内容和按钮，不开真的 <dialog> */
function setup({ page, params = {}, lang = 'zh-Hans' }) {
  const dom = installDom();
  setLang(lang);
  state.load({ storage: null });
  state.mutate(seed);
  const views = { search: searchView };
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
    tap: async (name) => { await byCls(env.row(name), 'item-tick').fire('click'); await settle(); },
    input: () => byCls(env.main, 'search-input'),
    async type(text) { const i = env.input(); i.value = text; await i.fire('input'); await settle(); },
    done() { if (env.handle && env.handle.cleanup) env.handle.cleanup(); off(); dom.restore(); setLang('zh-Hans'); },
  });
  return env;
}

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
