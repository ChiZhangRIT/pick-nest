// 「商店」页（#/stores）、一家店（#/s/<id>）、设置 → 商店 / 分类：假 DOM + 真的 state.js（只用内存）。
// 假 ctx 照着 app.js：改数据走 state.mutate，带 undoLabel 的弹「撤销」提示；页面有 onChange 就只调它，没有就整页重画。全是编的数据
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as storesView from '../src/views/stores.js';
import * as storeView from '../src/views/store.js';
import * as settingsView from '../src/views/settings.js';
import * as state from '../src/core/state.js';
import { deletedRecord, normalizeRecord, SEED_STORES } from '../src/core/store.js';
import { createList, setArchived, deleteList } from '../src/core/lists.js';
import { storeFilter } from '../src/core/stores.js';
import { memoryOf } from '../src/core/memory.js';
import { setLang, t } from '../src/i18n.js';
import { Element, all, find, installDom, fakeStorage } from './helpers/dom.mjs';

const settle = async (n = 5) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)); };
const cls = (el, c) => (el.className || el.attrs.class || '').split(' ').includes(c);
const byCls = (root, c) => find(root, el => cls(el, c));
const allCls = (root, c) => all(root, el => cls(el, c));
const btn = (root, label) => find(root, el => el.tag === 'button' && el.textContent === label);
const S = () => state.getState();
const itemNamed = (name) => Object.values(S().data.items).find(it => it.name === name && !it.deleted);
const listNamed = (name) => Object.values(S().data.lists).find(l => l.name === name);
// 只看一张清单的按钮和面板（ui/storeFilter.js）
const sfBtn = (root) => byCls(root, 'sf-btn');
const sfOpts = (env) => allCls(env.sheet().el, 'sf-opt').map(o => [byCls(o, 'sf-opt-name').textContent, byCls(o, 'list-count').textContent, o.attrs['aria-current'] || null]);
const sfOpt = (env, name) => allCls(env.sheet().el, 'sf-opt').find(o => byCls(o, 'sf-opt-name').textContent === name);

/** 编的数据：食材清单、想买、一张自建的木工清单、一张归档的清单；H Mart 归档了但还有东西要买；台灯没指定商店 */
function seed(s) {
  const wood = createList(s, { name: '木工', kind: 'general', icon: '\u{1FAB5}' }, 1000).id;
  const old = createList(s, { name: '去年的', kind: 'grocery' }, 1001).id;
  setArchived(s, old, true, 1002);
  s.data.stores.s_hmart = { ...s.data.stores.s_hmart, archived: true };
  let n = 0;
  const add = (listId, name, f = {}) => { const id = 'i_t' + n++; s.data.items[id] = normalizeRecord('items', { id, listId, name, status: 'need', updatedAt: 1, ...f }); };
  add('l_groceries', '牛奶', { storeId: 's_wholefoods', categoryId: 'c_dairy', qty: 2 });
  add('l_groceries', '苹果', { storeId: 's_wholefoods', categoryId: 'c_produce', note: '要脆的\n别买太多' });
  add('l_groceries', '鸡蛋', { storeId: 's_wholefoods', categoryId: 'c_dairy', status: 'done', doneAt: 5000 });
  add('l_groceries', '豆腐', { storeId: 's_hmart', categoryId: 'c_produce' });
  add(wood, '木胶', { storeId: 's_wholefoods' });
  add('l_tobuy', '电池', { storeId: 's_costco', categoryId: 'c_electronics' });
  add('l_tobuy', '雨伞', { storeId: 's_costco', status: 'later' });
  add('l_tobuy', '台灯');
  add(old, '月饼', { storeId: 's_wholefoods' });
}

/** 假 ctx。page：'stores' | 'store' | 'settings'；面板：记下内容和按钮，不开真的 <dialog> */
function setup({ page, params = {}, lang = 'zh-Hans', filter = null, storage = null }) {
  const dom = installDom();
  setLang(lang);
  state.load({ storage });
  state.mutate(seed);
  // 本机记着只看哪张清单（按名字找编的清单）
  if (filter) state.setLocal({ storeFilter: listNamed(filter).id });
  const views = { stores: storesView, store: storeView, settings: settingsView };
  const env = { ...dom, toasts: [], navs: [], sheets: [], confirms: [], answer: true, handle: null, refreshes: 0 };
  const ctx = env.ctx = {
    t, lang: () => lang, layout: () => 'phone',
    get state() { return S(); }, get local() { return state.getLocal(); },
    setLocal: (p) => state.setLocal(p),
    mutate: (fn, o) => state.mutate(fn, o),
    toast: (msg, o = {}) => env.toasts.push({ msg, ...o }),
    confirm: async (o) => { env.confirms.push(o); return env.answer; },
    navigate: (p, o) => env.navs.push(p), back: (p) => env.navs.push('back:' + p),
    // 和 app.js 的 refresh 一样：页面清理掉再画一遍，焦点放回带同一个 data-fid 的控件
    refresh() {
      env.refreshes++;
      const a = document.activeElement, fid = a && a.dataset ? a.dataset.fid : null;
      if (env.handle && env.handle.cleanup) env.handle.cleanup();
      mount();
      const el = fid ? env.main.querySelector(`[data-fid="${fid}"]`) : null;
      if (el) el.focus();
    },
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
  const mount = () => {
    env.main = env.main || new Element('section');
    env.main.replaceChildren();
    const ret = views[page].render(env.main, { name: page, ...params }, ctx);
    env.handle = ret && typeof ret === 'object' ? ret : null;
  };
  // 和 app.js 一样：带 undoLabel 的修改弹 10 秒「撤销」；页面有 onChange 就只调它，没有就整页重画（焦点放回带 data-fid 的控件）
  const off = state.subscribe((st, info) => {
    if (info.undoLabel) ctx.toast(info.undoLabel, { ms: 10000, action: { label: t('common.undo'), run: () => state.undo() } });
    queueMicrotask(() => {
      if (env.handle && env.handle.onChange) { env.handle.onChange(info); return; }
      const a = document.activeElement, fid = a && a.dataset ? a.dataset.fid : null;
      mount();
      const el = fid ? env.main.querySelector(`[data-fid="${fid}"]`) : null;
      if (el) el.focus();
    });
  });
  mount();
  Object.assign(env, {
    rows: (root = env.main) => allCls(root, 'item-row').map(r => byCls(r, 'item-name').textContent),
    sec: (k) => byCls(env.main, 'sec-' + k),
    row: (name) => allCls(env.main, 'item-row').find(r => byCls(r, 'item-name').textContent === name),
    sheet: () => env.sheets.at(-1),
    input: () => find(env.sheets.at(-1).el, el => el.tag === 'input' && el.attrs.type === 'text'),
    done() { if (env.handle && env.handle.cleanup) env.handle.cleanup(); off(); dom.restore(); },
  });
  return env;
}

// ---------- 「商店」页 ----------
test('「商店」：每家店还要买几样（跨清单，只数要买的；归档的清单不算），0 样的淡一点；归档的店有东西时标「已归档」排在后面；「未指定」最后', () => {
  const env = setup({ page: 'stores' });
  try {
    assert.equal(byCls(env.main, 'lt').textContent, '商店');
    const rows = allCls(env.main, 'store-row').map(r => [byCls(r, 'store-name').textContent, byCls(r, 'list-count').textContent, !!byCls(r, 'tag'), cls(r, 'zero')]);
    const active = SEED_STORES.filter(([id]) => id !== 's_hmart').map(([id, name]) => [name, { s_wholefoods: '3', s_costco: '1' }[id] || '0', false, !['s_wholefoods', 's_costco'].includes(id)]);
    assert.deepEqual(rows, [...active, ['H Mart', '1', true, false], ['未指定', '1', false, false]], 'Whole Foods：牛奶、苹果、木胶（鸡蛋已买，月饼在归档的清单上）');
    assert.equal(byCls(byCls(env.main, 'store-row'), 'tag'), undefined);
    assert.equal(byCls(env.main, 'tag').textContent, '已归档');
    assert.deepEqual(allCls(env.main, 'store-row').map(a => a.attrs.href).slice(-2), ['#/s/s_hmart', '#/s/none']);
    assert.equal(allCls(env.main, 'sr-only')[0].textContent, '还要买 3 样', '读屏念整句');
    assert.equal(find(env.main, el => el.tag === 'a' && el.textContent === '管理商店').attrs.href, '#/settings/stores');
  } finally { env.done(); }
});

test('「商店」：「所有清单 ▾」选一张清单 → 只数这张（归档的店、未指定在这张里没东西就不列）；本机记住；选原来那张只关上；选回「所有清单」', async () => {
  const env = setup({ page: 'stores' });
  try {
    const wood = listNamed('木工').id;
    const storeRows = () => allCls(env.main, 'store-row').map(r => [byCls(r, 'store-name').textContent, byCls(r, 'list-count').textContent]);
    const before = storeRows();
    assert.equal(sfBtn(env.main).textContent, '所有清单');
    assert.equal(sfBtn(env.main).attrs['aria-label'], '看哪张清单：所有清单');
    assert.equal(sfBtn(env.main).attrs['aria-haspopup'], 'dialog');
    assert.ok(!cls(sfBtn(env.main), 'on'));
    assert.ok(byCls(sfBtn(env.main), 'sf-all-tile'), '「所有清单」是中性的方块');
    sfBtn(env.main).focus();
    await sfBtn(env.main).fire('click');
    assert.equal(env.sheet().opts.title, '看哪张清单');
    assert.equal(byCls(env.sheet().el, 'sf-help').textContent, t('store.filterHelp'));
    assert.deepEqual(sfOpts(env), [['所有清单', '6', 'true'], ['食材', '3', null], ['想买', '2', null], ['木工', '1', null]], '归档的「去年的」不列；数的是所有店加起来');
    assert.equal(document.activeElement, sfOpt(env, '所有清单'), '焦点先给现在选的那一行');
    assert.ok(byCls(sfOpt(env, '所有清单'), 'ic-check'), '现在选的打勾');
    assert.equal(allCls(sfOpt(env, '想买'), 'sr-only')[0].textContent, '还要买 2 样');
    await sfOpt(env, '木工').fire('click');
    assert.equal(env.sheets.length, 0, '点一行就关上');
    assert.equal(state.getLocal().storeFilter, wood, '记在本机');
    assert.equal(env.refreshes, 1);
    assert.deepEqual(storeRows(), SEED_STORES.filter(([id]) => id !== 's_hmart').map(([id, name]) => [name, id === 's_wholefoods' ? '1' : '0']),
      '只数木胶；H Mart（归档，只有食材的豆腐）、未指定（想买的台灯）不列');
    assert.equal(byCls(sfBtn(env.main), 'sf-name').textContent, '木工');
    assert.ok(byCls(sfBtn(env.main), 'list-tile'), '清单自己的图标方块');
    assert.ok(cls(sfBtn(env.main), 'on'), '只看一张时换成强调色');
    assert.equal(sfBtn(env.main).attrs['aria-label'], '看哪张清单：木工');
    assert.equal(document.activeElement, sfBtn(env.main), '重画以后焦点回到按钮上');
    await sfBtn(env.main).fire('click');
    await sfOpt(env, '想买').fire('click');
    assert.deepEqual(storeRows().filter(([, n]) => n !== '0'), [['Costco', '1'], ['未指定', '1']]);
    // 点的还是现在这张：只关上，不重画
    await sfBtn(env.main).fire('click');
    assert.equal(sfOpts(env).find(o => o[2])[0], '想买');
    await sfOpt(env, '想买').fire('click');
    assert.deepEqual([env.sheets.length, env.refreshes], [0, 2]);
    await sfBtn(env.main).fire('click');
    await sfOpt(env, '所有清单').fire('click');
    assert.equal(state.getLocal().storeFilter, null);
    assert.deepEqual(storeRows(), before);
  } finally { env.done(); }
});

// ---------- 一家店 ----------
test('一家店：要买的按分类分组，每行标着来自哪张清单；点圆圈勾掉 → 移到「已买」，记下这次在这家买的；再点放回来', async () => {
  const env = setup({ page: 'store', params: { id: 's_wholefoods' } });
  try {
    assert.equal(byCls(env.main, 'lp-name').textContent, 'Whole Foods');
    assert.equal(byCls(env.main, 'lp-count').textContent, '还要买 3 样');
    assert.ok(byCls(env.main, 'back'), '手机上有返回');
    assert.deepEqual(allCls(env.main, 'group-h').map(x => x.textContent), ['蔬果', '蛋奶', '未分类']);
    assert.deepEqual(env.rows(), ['苹果', '牛奶', '木胶', '鸡蛋']);
    assert.equal(byCls(env.row('苹果'), 'item-note').textContent, '要脆的', '备注的第一行');
    assert.equal(byCls(env.row('木胶'), 'list-chip').textContent, '\u{1FAB5}木工', '来自哪张清单：图标 + 名字');
    assert.equal(byCls(env.row('牛奶'), 'list-chip').textContent, '食材', '没选图标的用默认的（画好的菜篮，没有字）');
    assert.equal(byCls(env.row('牛奶'), 'list-chip-ic').attrs.class, 'list-tile tint-green list-chip-ic');
    assert.equal(byCls(byCls(env.row('牛奶'), 'list-chip-ic'), 'lt-glyph').attrs.class, 'lt-glyph g-basket');
    assert.equal(byCls(env.row('牛奶'), 'list-chip-ic').attrs['aria-hidden'], 'true');
    assert.equal(byCls(env.row('牛奶'), 'item-qty').textContent, '2');
    assert.equal(byCls(env.sec('done'), 'sec-toggle').textContent, '已买（1）');
    await byCls(env.row('木胶'), 'item-tick').fire('click');
    await settle();
    assert.equal(itemNamed('木胶').status, 'done');
    assert.equal(memoryOf(S(), '木胶').stores.s_wholefoods.n, 1, '这次在 Whole Foods 买的');
    assert.deepEqual(env.rows(env.sec('done')), ['木胶', '鸡蛋'], '新的在前');
    assert.equal(byCls(env.main, 'lp-count').textContent, '还要买 2 样');
    assert.deepEqual(allCls(env.main, 'group-h').map(x => x.textContent), ['蔬果', '蛋奶']);
    await byCls(env.row('木胶'), 'item-tick').fire('click');
    await settle();
    assert.equal(itemNamed('木胶').status, 'need');
    assert.equal(memoryOf(S(), '木胶').stores.s_wholefoods, undefined, '刚勾上又取消：那次不算');
    // 点这一行打开的是同一个编辑面板；存了以后（这一行重画了）焦点还在这一行上
    byCls(env.row('牛奶'), 'item-main').focus();
    await byCls(env.row('牛奶'), 'item-main').fire('click');
    assert.equal(env.sheet().opts.title, '编辑');
    find(env.sheet().el, el => cls(el, 'qty-in')).value = '3';
    await btn(env.sheet().el, '保存').fire('click');
    await settle();
    assert.equal(itemNamed('牛奶').qty, 3);
    assert.equal(document.activeElement, byCls(env.row('牛奶'), 'item-main'));
  } finally { env.done(); }
});

test('一家店：「已买」折起来（每家店在本机各自记住）；清除已买只清这家的，能撤销；「未指定」那一页；商店不在了 → 回「商店」并提示', async () => {
  const env = setup({ page: 'store', params: { id: 's_wholefoods' } });
  try {
    await byCls(env.sec('done'), 'sec-toggle').fire('click');
    assert.equal(byCls(env.sec('done'), 'sec-toggle').attrs['aria-expanded'], 'false');
    assert.deepEqual(env.rows(env.sec('done')), []);
    assert.deepEqual(state.getLocal().storeView, { s_wholefoods: { showDone: false } });
    await byCls(env.sec('done'), 'sec-toggle').fire('click');
    btn(env.main, '清除已买').focus();
    await btn(env.main, '清除已买').fire('click');
    await settle();
    assert.equal(env.sec('done'), undefined);
    assert.equal(document.activeElement, byCls(env.main, 'lp-name'), '「已买」那一块没了：焦点给页面标题');
    assert.equal(env.toasts.at(-1).msg, '已清除 1 样');
    env.toasts.at(-1).action.run();
    await settle();
    assert.deepEqual(env.rows(env.sec('done')), ['鸡蛋']);
    // 商店删掉了：回「商店」，提示一句
    state.mutate(s => { s.data.stores.s_wholefoods = deletedRecord(s.data.stores.s_wholefoods); });
    await settle();
    assert.deepEqual(env.navs, ['/stores']);
    assert.equal(env.toasts.at(-1).msg, '这家店不在了');
  } finally { env.done(); }
  const none = setup({ page: 'store', params: { id: 'none' }, lang: 'en' });
  try {
    assert.equal(byCls(none.main, 'lp-name').textContent, 'No Store');
    assert.deepEqual(none.rows(), ['台灯']);
    assert.ok(byCls(none.main, 'sp-hint'));
  } finally { setLang('zh-Hans'); none.done(); }
  const archived = setup({ page: 'store', params: { id: 's_hmart' } });
  try {
    assert.deepEqual(archived.rows(), ['豆腐']);
    const unarchive = btn(byCls(archived.main, 'lp-banner'), '取消归档');
    unarchive.focus();
    await unarchive.fire('click');
    await settle();
    assert.equal(S().data.stores.s_hmart.archived, false);
    assert.equal(byCls(archived.main, 'lp-banner'), undefined);
    assert.equal(document.activeElement, byCls(archived.main, 'lp-name'), '按过的按钮没了：焦点给页面标题，不掉回页首');
    assert.equal(byCls(archived.main, 'lp-name').attrs.tabindex, '-1');
  } finally { archived.done(); }
  const gone = setup({ page: 'store', params: { id: 's_nope' } });
  try {
    await settle();
    assert.deepEqual(gone.navs, ['/stores']);
    assert.equal(gone.toasts.at(-1).msg, '这家店不在了');
  } finally { gone.done(); }
});

test('一家店：只看一张清单（本机记着的）→ 数、要买、已买、清除已买都只算这张，行上不标清单；面板里的数是这家店的；空的时候说清；那张清单删掉了 → 所有清单', async () => {
  const env = setup({ page: 'store', params: { id: 's_wholefoods' }, filter: '木工' });
  try {
    const wood = listNamed('木工').id;
    assert.equal(byCls(env.main, 'lp-count').textContent, '还要买 1 样');
    assert.deepEqual(env.rows(), ['木胶'], '食材清单的牛奶、苹果、鸡蛋（已买）都不在');
    assert.equal(byCls(env.row('木胶'), 'list-chip'), undefined, '都是木工：不标');
    assert.equal(sfBtn(byCls(env.main, 'lp-sub')).textContent, '\u{1FAB5}木工');
    assert.ok(cls(sfBtn(env.main), 'on'));
    await sfBtn(env.main).fire('click');
    assert.deepEqual(sfOpts(env), [['所有清单', '3', null], ['食材', '2', null], ['想买', '0', null], ['木工', '1', 'true']], '只数在 Whole Foods 要买的');
    assert.equal(byCls(env.sheet().el, 'sf-help').textContent, t('store.filterHelpHere'));
    env.sheet().close();
    await byCls(env.row('木胶'), 'item-tick').fire('click');
    await settle();
    assert.equal(byCls(env.main, 'lp-empty').textContent, '「木工」里在这家要买的都买齐了');
    assert.deepEqual(env.rows(env.sec('done')), ['木胶'], '已买也只有木工的（鸡蛋不在）');
    await btn(env.main, '清除已买').fire('click');
    await settle();
    assert.equal(env.toasts.at(-1).msg, '已清除 1 样');
    assert.equal(itemNamed('鸡蛋').status, 'done', '没看见的食材清单的已买不清');
    assert.equal(byCls(env.main, 'lp-empty').textContent, '这家店在「木工」里没有要买的东西现在只看「木工」，可以在上面换成「所有清单」。');
    // 换成食材：整页重画，行上还是不标清单
    await sfBtn(env.main).fire('click');
    await sfOpt(env, '食材').fire('click');
    assert.equal(state.getLocal().storeFilter, 'l_groceries');
    assert.deepEqual(env.rows(), ['苹果', '牛奶', '鸡蛋']);
    assert.equal(byCls(env.main, 'list-chip'), undefined);
    assert.equal(document.activeElement, sfBtn(env.main));
    // 记着的清单删掉了（别的设备上）：按所有清单显示，记着的不动
    state.setLocal({ storeFilter: wood });
    state.mutate(st => deleteList(st, wood, Date.now()));
    await settle();
    assert.equal(sfBtn(env.main).textContent, '所有清单');
    assert.deepEqual(env.rows(), ['苹果', '牛奶', '鸡蛋']);
    assert.ok(byCls(env.row('牛奶'), 'list-chip'), '所有清单：又标来自哪张清单');
    assert.equal(state.getLocal().storeFilter, wood);
  } finally { env.done(); }
  // 归档的清单也一样
  const archived = setup({ page: 'stores', filter: '去年的' });
  try {
    assert.equal(sfBtn(archived.main).textContent, '所有清单');
    assert.equal(byCls(allCls(archived.main, 'store-row')[0], 'list-count').textContent, '3', 'Whole Foods：所有清单的牛奶、苹果、木胶');
  } finally { archived.done(); }
});

test('只看哪张清单记在本机（picknest.local）：关掉再打开还在；不进数据（不同步、不进备份）', async () => {
  const storage = fakeStorage();
  const env = setup({ page: 'stores', storage });
  try {
    const wood = listNamed('木工').id;
    await sfBtn(env.main).fire('click');
    await sfOpt(env, '木工').fire('click');
    assert.equal(JSON.parse(storage.getItem('picknest.local')).storeFilter, wood);
    assert.equal(JSON.stringify(S()).includes('storeFilter'), false, '不在数据里');
    state.load({ storage });          // 关掉再打开
    assert.equal(storeFilter(S(), state.getLocal()), wood);
    env.ctx.refresh();
    assert.equal(byCls(sfBtn(env.main), 'sf-name').textContent, '木工');
    assert.equal(byCls(allCls(env.main, 'store-row')[0], 'list-count').textContent, '1');
  } finally { env.done(); }
});

// ---------- 设置 → 商店 ----------
test('设置 → 商店：新增（排在最后；空的、同名的报错不关）、点名字改名、↑↓ 排顺序（焦点留在同一个按钮上）', async () => {
  const env = setup({ page: 'settings', params: { sub: 'stores' } });
  try {
    const names = () => allCls(byCls(env.main, 'manage-list'), 'manage-name').map(b => b.textContent);
    // 推入的页面：标题在吸顶的顶栏中间（和 Babble 一样），返回、新增在两边，不再有单独的大标题
    const nav = byCls(env.main, 'push-nav');
    assert.equal(byCls(nav, 'nb-title').textContent, '商店');
    assert.equal(byCls(nav, 'nb-title').tag, 'h1', '读屏照样有这一页的标题');
    assert.deepEqual(nav.children.map(c => c.tag), ['button', 'h1', 'button'], '返回 · 标题 · 新增');
    assert.equal(byCls(env.main, 'push-title'), undefined);
    assert.deepEqual(names(), SEED_STORES.filter(([id]) => id !== 's_hmart').map(([, n]) => n), '归档的 H Mart 不在上面');
    assert.deepEqual(allCls(byCls(env.main, 'manage-arch'), 'manage-name').map(b => b.textContent), ['H Mart']);
    await byCls(env.main, 'back').fire('click');
    assert.deepEqual(env.navs, ['back:/settings']);
    // 新增
    await btn(env.main, '新增商店').fire('click');
    assert.equal(env.sheet().opts.title, '新增商店');
    env.input().value = 'costco';
    await btn(env.sheet().el, '添加').fire('click');
    assert.equal(byCls(env.sheet().el, 'f-err').textContent, '已经有同名的商店了');
    assert.equal(env.sheets.length, 1, '有错不关');
    env.input().value = ' 农贸市场 ';
    await btn(env.sheet().el, '添加').fire('click');
    await settle();
    assert.equal(env.sheets.length, 0);
    assert.equal(names().at(-1), '农贸市场');
    // 改名
    await find(env.main, el => cls(el, 'manage-name') && el.textContent === '农贸市场').fire('click');
    assert.equal(env.sheet().opts.title, '编辑商店');
    assert.equal(env.input().value, '农贸市场');
    env.input().value = '周末市集';
    await btn(env.sheet().el, '保存').fire('click');
    await settle();
    assert.equal(names().at(-1), '周末市集');
    // 排顺序：读屏念「上移『Costco』」；到头了标 aria-disabled；挪完焦点还在同一个按钮上，可以接着按
    const up = (name) => find(env.main, el => el.tag === 'button' && el.attrs['aria-label'] === `上移「${name}」`);
    assert.equal(up('Whole Foods').attrs['aria-disabled'], 'true');
    up('Costco').focus();
    await up('Costco').fire('click');
    await settle();
    assert.deepEqual(names().slice(0, 3), ['Whole Foods', 'Costco', "Trader Joe's"]);
    assert.equal(document.activeElement, up('Costco'));
    assert.equal(S().data.stores.s_target.updatedAt, 0, '没挪的预置商店不盖新时间');
    await up('Whole Foods').fire('click');
    await settle();
    assert.equal(names()[0], 'Whole Foods', '到头了的不动');
  } finally { env.done(); }
});

test('设置 → 商店：归档 / 取消归档能撤销；删除先问（说清几样东西会变成未指定），能撤销；东西还在', async () => {
  const env = setup({ page: 'settings', params: { sub: 'stores' } });
  try {
    const open = async (name) => { await find(env.main, el => cls(el, 'manage-name') && el.textContent === name).fire('click'); return env.sheet(); };
    let sh = await open('Costco');
    await btn(sh.el, '归档').fire('click');
    await settle();
    assert.equal(S().data.stores.s_costco.archived, true);
    assert.equal(env.toasts.at(-1).msg, '已归档「Costco」');
    assert.deepEqual(allCls(byCls(env.main, 'manage-arch'), 'manage-name').map(b => b.textContent), ['Costco', 'H Mart']);
    env.toasts.at(-1).action.run();
    await settle();
    assert.equal(S().data.stores.s_costco.archived, false);
    sh = await open('Whole Foods');
    await btn(sh.el, '删除商店').fire('click');
    await settle();
    assert.equal(env.confirms.at(-1).title, '删除「Whole Foods」？');
    assert.equal(env.confirms.at(-1).message, '指定给它的 5 样东西会显示成「未指定」。删除后 10 秒内可以撤销。');
    assert.equal(S().data.stores.s_wholefoods.deleted, true);
    assert.ok(!allCls(env.main, 'manage-name').some(b => b.textContent === 'Whole Foods'));
    assert.equal(itemNamed('牛奶').storeId, 's_wholefoods', '东西的 storeId 不动');
    env.toasts.at(-1).action.run();
    await settle();
    assert.equal(S().data.stores.s_wholefoods.deleted, undefined);
    assert.equal(allCls(env.main, 'manage-name')[0].textContent, 'Whole Foods');
    // 不确定就不删
    env.answer = false;
    sh = await open('Target');
    await btn(sh.el, '删除商店').fire('click');
    await settle();
    assert.equal(S().data.stores.s_target.deleted, undefined);
  } finally { env.done(); }
});

test('设置 → 商店：输入法选字时的回车不提交；改了名字再点归档 / 删除先问「放弃修改？」；名字是「编辑」按钮；删掉以后焦点给下一行', async () => {
  const env = setup({ page: 'settings', params: { sub: 'stores' } });
  const key = (el, e) => { for (const fn of el.events.keydown) fn({ key: 'Enter', isComposing: false, keyCode: 13, preventDefault() {}, ...e }); };
  try {
    const nameBtn = (name) => find(env.main, el => cls(el, 'manage-name') && el.textContent === name);
    assert.deepEqual([nameBtn('Costco').attrs['aria-label'], nameBtn('Costco').attrs['aria-haspopup']], ['编辑「Costco」', 'dialog']);
    assert.ok(cls(byCls(env.main, 'navbar'), 'lp-nav'), '顶栏吸顶');
    // Safari：选字结束后才发回车的 keydown，isComposing 已经是 false，keyCode 是 229
    await btn(env.main, '新增商店').fire('click');
    env.input().value = 'nongmao';
    key(env.input(), { keyCode: 229 });
    key(env.input(), { isComposing: true });
    await settle();
    assert.equal(env.sheets.length, 1, '选字的回车：面板还开着');
    assert.ok(!Object.values(S().data.stores).some(x => x.name === 'nongmao'));
    env.input().value = '农贸';
    key(env.input());
    await settle();
    assert.equal(env.sheets.length, 0);
    assert.ok(Object.values(S().data.stores).some(x => x.name === '农贸'));
    // 改了名字没存就点「归档」：先问；不放弃就什么也不做，面板还开着
    await nameBtn('Costco').fire('click');
    env.input().value = 'Costco Wholesale';
    env.answer = false;
    await btn(env.sheet().el, '归档').fire('click');
    await settle();
    assert.equal(env.confirms.at(-1).message, '放弃没保存的修改？');
    assert.deepEqual([env.sheets.length, S().data.stores.s_costco.archived], [1, false]);
    env.answer = true;
    await btn(env.sheet().el, '归档').fire('click');
    await settle();
    assert.deepEqual([env.sheets.length, S().data.stores.s_costco.archived, S().data.stores.s_costco.name], [0, true, 'Costco'], '放弃了：归档，名字没改');
    // 删除：确定以后焦点先给同一组的下一行，重画后还在它上面（不掉回页首）
    nameBtn('Target').focus();
    await nameBtn('Target').fire('click');
    const confirms = env.confirms.length;
    await btn(env.sheet().el, '删除商店').fire('click');
    await settle();
    assert.equal(env.confirms.length, confirms + 1, '没改过：只问删不删');
    assert.equal(S().data.stores.s_target.deleted, true);
    assert.equal(document.activeElement, nameBtn('99 Ranch'));
  } finally { env.done(); }
});

test('设置 → 商店：↑↓ 按完页面滚一下，按过的按钮还在手指下面（连着按挪的还是同一家）', async () => {
  const env = setup({ page: 'settings', params: { sub: 'stores' } });
  // 假 DOM 没有排版：一行 50px，按 <li> 在列表里的位置算
  Element.prototype.getBoundingClientRect = function () {
    let el = this;
    while (el && el.tag !== 'li') el = el.parent;
    return { top: el && el.parent ? el.parent.children.indexOf(el) * 50 : 0 };
  };
  try {
    document.scrollingElement.scrollTop = 0;
    const down = (name) => find(env.main, el => el.tag === 'button' && el.attrs['aria-label'] === `下移「${name}」`);
    await down('Whole Foods').fire('click');
    await settle();
    assert.equal(allCls(env.main, 'manage-name')[1].textContent, 'Whole Foods');
    assert.equal(document.scrollingElement.scrollTop, 50, '往下挪了一行：页面跟着往下滚一行');
    await down('Whole Foods').fire('click');
    await settle();
    assert.equal(allCls(env.main, 'manage-name')[2].textContent, 'Whole Foods');
    assert.equal(document.scrollingElement.scrollTop, 100);
  } finally { delete Element.prototype.getBoundingClientRect; env.done(); }
});

// ---------- 设置 → 分类 ----------
test('设置 → 分类：三组（食材 / 一般 / 两边都用），新增时选用在哪种；组内排顺序；预置分类改名可以清空；删除先问、能撤销', async () => {
  const env = setup({ page: 'settings', params: { sub: 'categories' } });
  try {
    const sec = (k) => find(env.main, el => cls(el, 'cat-sec') && el.dataset.sec === k);
    const names = (k) => allCls(sec(k), 'manage-name').map(b => b.textContent);
    assert.deepEqual(allCls(env.main, 'group-h').map(x => x.textContent), ['食材', '一般', '两边都用']);
    assert.deepEqual(names('general'), ['衣物', '书籍', '工具五金', '数码', '家居']);
    assert.equal(byCls(sec('both'), 'cat-empty').textContent, '这一组还没有分类。');
    // 新增：两边都用
    await btn(env.main, '新增分类').fire('click');
    env.input().value = '礼物';
    await find(env.sheet().el, el => el.tag === 'input' && el.attrs.type === 'radio' && el.value === 'both').fire('change');
    await btn(env.sheet().el, '添加').fire('click');
    await settle();
    assert.deepEqual(names('both'), ['礼物']);
    assert.equal(Object.values(S().data.categories).find(c => c.name === '礼物').kind, null);
    // 组内 ↓：书籍和衣物换位置
    await find(sec('general'), el => el.attrs && el.attrs['aria-label'] === '下移「衣物」').fire('click');
    await settle();
    assert.deepEqual(names('general').slice(0, 2), ['书籍', '衣物']);
    assert.equal(find(sec('general'), el => el.attrs && el.attrs['aria-label'] === '下移「家居」').attrs['aria-disabled'], 'true');
    // 同名：和食材分类显示的名字一样的不行（报在名字下面，面板不关）
    await btn(env.main, '新增分类').fire('click');
    env.input().value = '蛋奶';
    await btn(env.sheet().el, '添加').fire('click');
    assert.equal(byCls(env.sheet().el, 'f-err').textContent, '已经有同名的分类了');
    env.sheet().close();
    // 名字下面的说明是一整句（不拼两句）
    await find(env.main, el => cls(el, 'manage-name') && el.textContent === '礼物').fire('click');
    assert.equal(byCls(env.sheet().el, 'f-help').textContent, '这个分类用于两种清单，不能更改。');
    env.sheet().close();
    // 改名：预置的可以改，清空了退回自带的名字
    await find(env.main, el => cls(el, 'manage-name') && el.textContent === '蛋奶').fire('click');
    assert.equal(env.input().attrs.placeholder, '蛋奶');
    assert.equal(byCls(env.sheet().el, 'f-help').textContent, '名字空着就用自带的（跟着界面语言）。这个分类用于食材清单，不能更改。');
    env.input().value = '奶和蛋';
    await btn(env.sheet().el, '保存').fire('click');
    await settle();
    assert.equal(names('grocery')[2], '奶和蛋');
    await find(env.main, el => cls(el, 'manage-name') && el.textContent === '奶和蛋').fire('click');
    env.input().value = '';
    await btn(env.sheet().el, '保存').fire('click');
    await settle();
    assert.equal(names('grocery')[2], '蛋奶');
    // 删除：东西归到未分类
    await find(env.main, el => cls(el, 'manage-name') && el.textContent === '蛋奶').fire('click');
    await btn(env.sheet().el, '删除分类').fire('click');
    await settle();
    assert.equal(env.confirms.at(-1).message, '这个分类里的 2 样东西会归到「未分类」。删除后 10 秒内可以撤销。');
    assert.ok(!names('grocery').includes('蛋奶'));
    assert.equal(itemNamed('牛奶').categoryId, 'c_dairy');
    env.toasts.at(-1).action.run();
    await settle();
    assert.ok(names('grocery').includes('蛋奶'));
  } finally { env.done(); }
});

test('删掉了清单的默认商店：编辑清单时显示「未指定」、不算修改；只改名字时不把默认商店清掉（商店恢复了跟着回来）', async () => {
  const { listSheet } = await import('../src/ui/listEditor.js');
  const env = setup({ page: 'stores' });
  try {
    state.mutate(s => { s.data.stores.s_wholefoods = deletedRecord(s.data.stores.s_wholefoods); });
    let sh = listSheet(env.ctx, { list: S().data.lists.l_groceries });
    assert.equal(find(sh.el, el => el.tag === 'select').value, '');
    sh.tryClose();
    assert.deepEqual([env.sheets.length, env.confirms.length], [0, 0], '没改就直接关，不问');
    sh = listSheet(env.ctx, { list: S().data.lists.l_groceries });
    find(sh.el, el => el.tag === 'input' && el.attrs.type === 'text').value = '买菜';
    await btn(sh.el, '保存').fire('click');
    assert.deepEqual([S().data.lists.l_groceries.name, S().data.lists.l_groceries.defaultStoreId], ['买菜', 's_wholefoods']);
  } finally { env.done(); }
});
