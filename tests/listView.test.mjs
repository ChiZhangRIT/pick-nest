// 清单页（#/l/<id>）、改一样东西的面板、首页的进入 / 新建 / 排顺序 / 已归档：假 DOM + 真的 state.js（只用内存）。
// 假 ctx 照着 app.js：改数据走 state.mutate，带 undoLabel 的弹「撤销」提示，数据变了在微任务里调页面的 onChange。全是编的数据
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../src/views/list.js';
import * as home from '../src/views/lists.js';
import * as state from '../src/core/state.js';
import { deletedRecord, itemId, normalizeRecord } from '../src/core/store.js';
import { memoryOf, memoryId } from '../src/core/memory.js';
import { setStatus } from '../src/core/items.js';
import { setLang, t } from '../src/i18n.js';
import { Element, all, find, installDom } from './helpers/dom.mjs';

const settle = async (n = 5) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)); };
const cls = (el, c) => (el.className || el.attrs.class || '').split(' ').includes(c);
const byCls = (root, c) => find(root, el => cls(el, c));
const allCls = (root, c) => all(root, el => cls(el, c));
const btn = (root, label) => find(root, el => el.tag === 'button' && el.textContent === label);
const key = (el, k, extra = {}) => { for (const fn of el.events.keydown || []) fn({ key: k, target: el, preventDefault() {}, ...extra }); };
const S = () => state.getState();
const itemNamed = (name, listId = 'l_groceries') => S().data.items[itemId(S(), listId, name)];

/** 假 ctx。面板：记下内容和按钮，不开真的 <dialog> */
function setup({ seed = null, listId = 'l_groceries', lang = 'zh-Hans', view = 'list', extraDom = {} } = {}) {
  const dom = installDom(extraDom);
  setLang(lang);
  state.load({ storage: null });
  if (seed) state.mutate(seed);
  const env = { ...dom, toasts: [], navs: [], sheets: [], confirms: [], answer: true, handle: null };
  const ctx = env.ctx = {
    t, lang: () => lang, layout: () => 'phone',
    get state() { return S(); }, get local() { return state.getLocal(); },
    setLocal: (p) => state.setLocal(p),
    mutate: (fn, o) => state.mutate(fn, o),
    remove(c, id, o) { const prev = S().data[c][id]; if (!prev || prev.deleted) return null; state.mutate(s => { s.data[c][id] = deletedRecord(prev); }, o); return prev; },
    toast: (msg, o = {}) => env.toasts.push({ msg, ...o }),
    confirm: async (o) => { env.confirms.push(o); return env.answer; },
    navigate: (p, o) => env.navs.push(p), back: (p) => env.navs.push('back:' + p),
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
  // 和 app.js 一样：带 undoLabel 的修改弹 10 秒「撤销」；页面有 onChange 就只调它，没有就整页重画
  const off = state.subscribe((st, info) => {
    if (info.undoLabel) ctx.toast(info.undoLabel, { ms: 10000, action: { label: t('common.undo'), run: () => state.undo() } });
    queueMicrotask(() => {
      if (env.handle && env.handle.onChange) env.handle.onChange(info);
      else if (view === 'home') { env.main.replaceChildren(); home.render(env.main, { name: 'lists' }, ctx); }
    });
  });
  env.main = new Element('section');
  const ret = view === 'home' ? home.render(env.main, { name: 'lists' }, ctx) : render(env.main, { name: 'list', id: listId }, ctx);
  env.handle = ret && typeof ret === 'object' ? ret : null;
  Object.assign(env, {
    input: () => byCls(env.main, 'add-input'),
    async type(text) { const i = env.input(); i.focus(); i.value = text; await i.fire('input'); },
    async enter(text) { await env.type(text); key(env.input(), 'Enter'); await settle(); },
    rows: (root = env.main) => allCls(root, 'item-row').map(r => [byCls(r, 'item-name').textContent, byCls(r, 'item-qty')?.textContent ?? '']),
    groups: () => allCls(env.main, 'group-h').map(x => x.textContent),
    sec: (k) => byCls(env.main, 'sec-' + k),
    row: (name) => allCls(env.main, 'item-row').find(r => byCls(r, 'item-name').textContent === name),
    sheet: () => env.sheets.at(-1),
    done() { if (env.handle && env.handle.cleanup) env.handle.cleanup(); off(); dom.restore(); },
  });
  return env;
}

// ---------- 快速添加 ----------
test('快速添加：回车就加好（拆出数量、单位，按分类分组），输入框清空、焦点留着；空的不加', async () => {
  const env = setup();
  try {
    assert.equal(byCls(env.main, 'lp-name').textContent, '食材');
    assert.ok(byCls(env.main, 'back'), '手机上有返回按钮');
    assert.equal(env.input().attrs.placeholder, '加东西，比如 鸡蛋 12');
    assert.ok(byCls(env.main, 'lp-empty').textContent.includes(t('list.emptyHint')));
    await env.enter('2 牛奶');
    await env.enter('面粉 1袋');
    await env.enter('苹果');
    await env.enter('没听说过的');
    assert.deepEqual(env.groups(), ['蔬果', '蛋奶', '粮油干货', '未分类']);
    assert.deepEqual(env.rows(), [['苹果', '1'], ['牛奶', '2'], ['面粉', '1 袋'], ['没听说过的', '1']]);
    assert.equal(env.input().value, '');
    assert.equal(document.activeElement, env.input(), '连着加下一样');
    assert.equal(byCls(env.main, 'lp-count').textContent, '还要买 4 样');
    assert.equal(byCls(env.main, 'lp-empty'), undefined);
    await env.enter('   ');
    assert.equal(env.rows().length, 4);
    assert.ok(env.row('没听说过的') && cls(env.row('没听说过的'), 'flash'), '刚加的闪一下');
  } finally { env.done(); }
});

test('快速添加：已经在清单上的 → 提示，不重复，那一行闪一下；已买的再加 → 回到要买', async () => {
  const env = setup();
  try {
    await env.enter('牛奶');
    await env.enter('鸡蛋');
    const before = env.rows();
    env.row('牛奶').classList.remove('flash');
    await env.enter('牛奶 3');
    assert.deepEqual(env.toasts.at(-1).msg, '「牛奶」已经在清单上了');
    assert.deepEqual(env.rows(), before);
    assert.ok(cls(env.row('牛奶'), 'flash'));
    assert.equal(env.input().value, '', '提示过了，输入框清空');
    await byCls(env.row('鸡蛋'), 'item-tick').fire('click');
    await settle();
    assert.equal(itemNamed('鸡蛋').status, 'done');
    await env.enter('鸡蛋');
    assert.equal(itemNamed('鸡蛋').status, 'need');
    assert.equal(env.sec('done'), undefined);
  } finally { env.done(); }
});

test('输入联想：以前买过的东西（常去的商店、已在清单上），点一下就加，带上输入里写的数量；Esc、失去焦点关掉', async () => {
  const env = setup({ seed: s => {
    const m = (name, f) => { s.data.memory[memoryId(name)] = normalizeRecord('memory', { id: memoryId(name), name, kind: 'grocery', updatedAt: 1, ...f }); };
    m('牛奶', { uses: 5, lastAt: 10, stores: { s_costco: { n: 2, at: 9 } } });
    m('燕麦牛奶', { uses: 9, lastAt: 20 });
    m('牛油果', { uses: 1, lastAt: 30 });
  } });
  try {
    const box = () => byCls(env.main, 'sugs');
    const sugs = () => allCls(env.main, 'sug').map(li => li.textContent);
    await env.type('牛');
    assert.equal(box().hidden, false);
    assert.equal(env.input().attrs['aria-expanded'], 'true');
    assert.deepEqual(sugs(), ['牛奶Costco', '牛油果', '燕麦牛奶']);
    key(env.input(), 'Escape');
    assert.equal(box().hidden, true);
    assert.equal(env.input().value, '牛', 'Esc 先关联想，不清输入');
    await env.type('牛奶 2');
    assert.deepEqual(sugs(), ['牛奶Costco', '燕麦牛奶'], '按拆出来的名字找');
    await allCls(env.main, 'sug')[0].fire('click');
    await settle();
    assert.deepEqual([itemNamed('牛奶').qty, itemNamed('牛奶').storeId], [2, 's_costco'], '常去的商店');
    assert.equal(env.input().value, '');
    assert.equal(box().hidden, true);
    await env.type('牛奶');
    assert.ok(byCls(env.main, 'sug-in'), '已在清单上');
    assert.equal(byCls(env.main, 'sug-in').textContent, '已在清单上');
    // ↓ 选中，回车加选中的那个
    key(env.input(), 'ArrowDown'); key(env.input(), 'ArrowDown');
    assert.equal(env.input().attrs['aria-activedescendant'], 'lp-sug-1');
    key(env.input(), 'Enter');
    await settle();
    assert.equal(itemNamed('燕麦牛奶').status, 'need');
    await env.type('牛');
    await env.input().fire('blur');
    assert.equal(box().hidden, true);
  } finally { env.done(); }
});

// ---------- 勾掉、已买、清除已买 ----------
test('只有点左边的圆圈才勾掉：移到「已买（N）」，再点放回来；点这一行别的地方打开编辑面板、不勾；焦点给顶替它位置的那一行；已买可以折起来（记在本机）', async () => {
  const env = setup();
  try {
    for (const x of ['牛奶', '鸡蛋', '面包']) await env.enter(x);
    await env.enter('苹果 3');
    // 圆圈是单独的 checkbox（名字就是东西的名字，数量当说明念）；这一行别的地方是「编辑「牛奶」」按钮，› 只是提示
    const apple = env.row('苹果'), tick = byCls(apple, 'item-tick'), body = byCls(apple, 'item-main');
    assert.deepEqual([tick.attrs.role, tick.attrs['aria-label'], tick.attrs['aria-describedby']], ['checkbox', '苹果', byCls(apple, 'item-qty').id]);
    assert.deepEqual([body.tag, body.attrs.role, body.attrs['aria-label'], body.attrs['aria-haspopup']], ['button', undefined, '编辑「苹果」', 'dialog']);
    assert.ok(byCls(body, 'item-name') && byCls(body, 'item-qty') && byCls(body, 'item-chev'), '名字、数量、› 都在这一行的按钮里');
    assert.equal(byCls(apple, 'item-more'), undefined, '没有单独的 › 按钮');
    await body.fire('click');
    await settle();
    assert.equal(itemNamed('苹果').status, 'need', '点名字不勾掉');
    assert.equal(env.sheet().opts.title, '编辑', '打开编辑面板');
    env.sheet().close();
    await settle();
    const main = byCls(env.row('牛奶'), 'item-tick');
    assert.deepEqual([main.attrs.role, main.attrs['aria-checked']], ['checkbox', 'false']);
    main.focus();
    await main.fire('click');
    await settle();
    assert.equal(byCls(env.sec('done'), 'sec-toggle').textContent, '已买（1）');
    assert.deepEqual(env.rows(env.sec('done')), [['牛奶', '1']]);
    const doneRow = env.row('牛奶');
    assert.ok(cls(doneRow, 'done'));
    assert.equal(byCls(doneRow, 'item-tick').attrs['aria-checked'], 'true');
    assert.equal(document.activeElement, byCls(env.row('面包'), 'item-tick'), '焦点给挪走的那一行下面的一行，键盘、读屏接着往下走');
    assert.equal(byCls(env.main, 'lp-count').textContent, '还要买 3 样');
    // 折起来：只画标题
    await byCls(env.sec('done'), 'sec-toggle').fire('click');
    assert.equal(byCls(env.sec('done'), 'sec-toggle').attrs['aria-expanded'], 'false');
    assert.equal(env.rows(env.sec('done')).length, 0);
    assert.equal(state.getLocal().view.l_groceries.showDone, false);
    await byCls(env.sec('done'), 'sec-toggle').fire('click');
    await byCls(env.row('牛奶'), 'item-tick').fire('click');
    await settle();
    assert.equal(itemNamed('牛奶').status, 'need');
    assert.equal(env.sec('done'), undefined);
  } finally { env.done(); }
});

test('勾的时候先在原地打勾、划线，约 0.3 秒后再挪；动画中再点一下 = 不勾了', async () => {
  const env = setup({ extraDom: { matchMedia: () => ({ matches: false }) } });
  try {
    await env.enter('牛奶');
    await env.enter('鸡蛋');
    await byCls(env.row('牛奶'), 'item-tick').fire('click');
    assert.ok(cls(env.row('牛奶'), 'ticking'));
    assert.equal(itemNamed('牛奶').status, 'need', '还没改数据');
    await new Promise(r => setTimeout(r, 400));
    await settle();
    assert.equal(itemNamed('牛奶').status, 'done');
    await byCls(env.row('鸡蛋'), 'item-tick').fire('click');
    await byCls(env.row('鸡蛋'), 'item-tick').fire('click');
    await new Promise(r => setTimeout(r, 400));
    assert.equal(itemNamed('鸡蛋').status, 'need');
    assert.ok(!cls(env.row('鸡蛋'), 'ticking'));
  } finally { env.done(); }
});

test('「已买」里点一下：先在原地去掉勾，约 0.3 秒后再放回去；连着点几样等最后一下之后一起挪；还没挪之前再点 = 不改', async () => {
  const env = setup({ extraDom: { matchMedia: () => ({ matches: false }) } });
  try {
    for (const x of ['牛奶', '鸡蛋', '面包', '苹果']) await env.enter(x);
    state.mutate(s => { for (const x of ['牛奶', '鸡蛋']) setStatus(s, itemId(s, 'l_groceries', x), 'done', Date.now()); });
    await settle();
    // 去掉勾：还在「已买」里，样子先变
    await byCls(env.row('牛奶'), 'item-tick').fire('click');
    assert.ok(byCls(env.sec('done'), 'item-row') && env.rows(env.sec('done')).some(r => r[0] === '牛奶'), '还没挪');
    assert.ok(!cls(env.row('牛奶'), 'done'));
    assert.equal(byCls(env.row('牛奶'), 'item-tick').attrs['aria-checked'], 'false');
    assert.equal(itemNamed('牛奶').status, 'done', '还没改数据');
    await new Promise(r => setTimeout(r, 400));
    await settle();
    assert.equal(itemNamed('牛奶').status, 'need');
    assert.deepEqual(env.rows(env.sec('done')), [['鸡蛋', '1']]);
    // 双击（两下点在同一行上）：等于没点，不会顺带改掉挪上来的另一行
    await byCls(env.row('鸡蛋'), 'item-tick').fire('click');
    await byCls(env.row('鸡蛋'), 'item-tick').fire('click');
    await new Promise(r => setTimeout(r, 400));
    await settle();
    assert.equal(itemNamed('鸡蛋').status, 'done');
    assert.ok(cls(env.row('鸡蛋'), 'done'));
    // 连着勾两样：每点一下重新等，最后一下之后一起挪、只重画一次
    let changes = 0;
    const off = state.subscribe(() => changes++);
    await byCls(env.row('面包'), 'item-tick').fire('click');
    await new Promise(r => setTimeout(r, 200));
    await byCls(env.row('苹果'), 'item-tick').fire('click');
    await new Promise(r => setTimeout(r, 200));
    assert.deepEqual([itemNamed('面包').status, itemNamed('苹果').status], ['need', 'need'], '第二下以后重新等');
    assert.ok(cls(env.row('面包'), 'ticking') && cls(env.row('苹果'), 'ticking'));
    await new Promise(r => setTimeout(r, 250));
    await settle();
    off();
    assert.deepEqual([itemNamed('面包').status, itemNamed('苹果').status], ['done', 'done']);
    assert.equal(changes, 1, '一起挪');
  } finally { env.done(); }
});

test('键盘 / 读屏：勾掉的那一行挪走了，焦点给顶替它的那一行（最后一行给上一行）；一样都不剩时跟着去「已买」', async () => {
  const env = setup();
  try {
    for (const x of ['苹果', '香蕉', '牛奶']) await env.enter(x);
    assert.deepEqual(env.rows().map(r => r[0]), ['苹果', '香蕉', '牛奶']);
    const tick = async (x) => { const b = byCls(env.row(x), 'item-tick'); b.focus(); await b.fire('click'); await settle(); };
    await tick('苹果');
    assert.equal(document.activeElement, byCls(env.row('香蕉'), 'item-tick'));
    await tick('牛奶');
    assert.equal(document.activeElement, byCls(env.row('香蕉'), 'item-tick'), '最后一行：给上一行');
    await tick('香蕉');
    assert.equal(itemNamed('香蕉').status, 'done');
    assert.equal(document.activeElement, byCls(env.row('香蕉'), 'item-tick'), '要买的都勾完了：跟着去「已买」');
    assert.ok(env.sec('done').contains(document.activeElement));
    // 「已买」里放回去也一样：焦点给「已买」里顶替它的那一行
    const order = env.rows(env.sec('done')).map(r => r[0]);
    await tick(order[0]);
    assert.equal(document.activeElement, byCls(env.row(order[1]), 'item-tick'));
  } finally { env.done(); }
});

test('刚挪到手指下面的那一行，这一下不算（减少动态效果时马上挪，连点两下不会改掉两样）；没挪的行照常能点', async () => {
  // 假 DOM 没有排版：按页面上第几行算位置
  const proto = Element.prototype;
  proto.getBoundingClientRect = function () {
    let root = this; while (root.parent) root = root.parent;
    const i = allCls(root, 'item-row').indexOf(this);
    return { top: i * 54, bottom: i * 54 + 54 };
  };
  const env = setup();
  try {
    for (const x of ['牛奶', '面包', '苹果']) await env.enter(x);
    const t0 = Date.now();
    state.mutate(s => { setStatus(s, itemId(s, 'l_groceries', '面包'), 'done', t0 - 1000); setStatus(s, itemId(s, 'l_groceries', '苹果'), 'done', t0); });
    await settle();
    await new Promise(r => setTimeout(r, 400));                 // 刚挪进「已买」的两行也要等一会儿
    const names = () => env.rows().map(r => r[0]);
    assert.deepEqual(names(), ['牛奶', '苹果', '面包'], '要买：牛奶；已买：苹果、面包');
    const at = (i) => byCls(allCls(env.main, 'item-row')[i], 'item-tick');
    await at(1).fire('click');                                   // 放回去：苹果（蔬果）排到最前，牛奶挪到第二行
    await settle();
    assert.equal(itemNamed('苹果').status, 'need');
    assert.deepEqual(names(), ['苹果', '牛奶', '面包']);
    await at(1).fire('click');                                   // 双击的第二下：落在挪上来的牛奶上
    await settle();
    assert.equal(itemNamed('牛奶').status, 'need', '不算');
    await at(2).fire('click');                                   // 面包没挪
    await settle();
    assert.equal(itemNamed('面包').status, 'need', '没挪的行照常能点');
    await new Promise(r => setTimeout(r, 400));
    await byCls(env.row('牛奶'), 'item-tick').fire('click');
    await settle();
    assert.equal(itemNamed('牛奶').status, 'done', '过一会儿就照常');
  } finally { env.done(); delete proto.getBoundingClientRect; }
});

test('清除已买：已买的都清掉，10 秒内撤销能回来；⋯ 菜单里也有（没有已买的时候不显示）', async () => {
  const env = setup();
  try {
    for (const x of ['牛奶', '鸡蛋', '面包']) await env.enter(x);
    const more = () => find(env.main, el => el.tag === 'button' && el.attrs['aria-label'] === t('common.more'));
    await more().fire('click');
    assert.deepEqual(all(env.sheet().el, el => cls(el, 'menu-row')).map(b => b.textContent), ['编辑清单']);
    env.sheet().close();
    for (const x of ['牛奶', '面包']) { await byCls(env.row(x), 'item-tick').fire('click'); await settle(); }
    await btn(env.sec('done'), '清除已买').fire('click');
    await settle();
    assert.equal(env.sec('done'), undefined);
    assert.deepEqual(env.rows(), [['鸡蛋', '1']]);
    const toast = env.toasts.at(-1);
    assert.deepEqual([toast.msg, toast.ms, toast.action.label], ['已清除 2 样', 10000, '撤销']);
    toast.action.run();
    await settle();
    assert.equal(byCls(env.sec('done'), 'sec-toggle').textContent, '已买（2）');
    // ⋯ → 清除已买
    await more().fire('click');
    await btn(env.sheet().el, '清除已买').fire('click');
    await settle();
    assert.equal(env.sec('done'), undefined);
    assert.equal(env.sheets.length, 0);
  } finally { env.done(); }
});

test('按商店分组：组名是商店（未指定在最后），每张清单各自记住；按分类时在别的店买的标着店名', async () => {
  const env = setup();
  try {
    await env.enter('牛奶');
    await env.enter('豆腐');
    await env.enter('鸡蛋');
    state.mutate(s => { s.data.items[itemId(s, 'l_groceries', '豆腐')].storeId = 's_hmart'; s.data.items[itemId(s, 'l_groceries', '鸡蛋')].storeId = null; });
    await settle();
    assert.equal(byCls(env.row('豆腐'), 'store-chip').textContent, 'H Mart');
    assert.equal(byCls(env.row('牛奶'), 'store-chip'), undefined, '清单的默认商店不用每行都写');
    await btn(env.main, '按商店').fire('click');
    assert.deepEqual(env.groups(), ['Whole Foods', 'H Mart', '未指定商店']);
    assert.equal(byCls(env.main, 'store-chip'), undefined, '按商店分组时组名就是商店');
    assert.equal(state.getLocal().view.l_groceries.groupBy, 'store');
    assert.equal(find(env.main, el => el.tag === 'button' && el.textContent === '按商店').attrs['aria-pressed'], 'true');
    // 「已买」不按商店分：没有组名写着商店，照样标（只标不在清单默认商店的）
    for (const x of ['豆腐', '牛奶']) { await byCls(env.row(x), 'item-tick').fire('click'); await settle(); }
    assert.deepEqual(env.rows(env.sec('done')).map(r => r[0]).sort(), ['牛奶', '豆腐'].sort());
    assert.equal(byCls(env.row('豆腐'), 'store-chip').textContent, 'H Mart');
    assert.equal(byCls(env.row('牛奶'), 'store-chip'), undefined);
  } finally { env.done(); }
});

test('一般清单：「以后再说（N）」单独一组；空的时候提示带单位的写法；光写数字不拆', async () => {
  const env = setup({ listId: 'l_tobuy' });
  try {
    assert.equal(env.input().attrs.placeholder, '加东西，比如 袜子 3双');
    assert.ok(byCls(env.main, 'lp-empty').textContent.includes(t('list.emptyHintGeneral')));
    await env.enter('iPhone 15');
    await env.enter('袜子 3双');
    assert.deepEqual(env.rows(), [['袜子', '3 双'], ['iPhone 15', '1']], '简体中文按拼音排，汉字在字母前');
    assert.deepEqual(env.groups(), [], '只有「未分类」一组时不写组名');
    state.mutate(s => { s.data.items[itemId(s, 'l_tobuy', '袜子')].status = 'later'; });
    await settle();
    assert.equal(byCls(env.sec('later'), 'sec-toggle').textContent, '以后再说（1）');
    assert.deepEqual(env.rows(env.sec('later')), [['袜子', '3 双']]);
    // 只剩「以后再说」：没买过东西，不能说「都买齐了」
    state.mutate(s => { s.data.items[itemId(s, 'l_tobuy', 'iPhone 15')].status = 'later'; });
    await settle();
    assert.equal(byCls(env.main, 'lp-empty').textContent, '还没有要买的东西');
    await byCls(env.row('袜子'), 'item-tick').fire('click');
    await settle();
    assert.equal(byCls(env.main, 'lp-empty').textContent, '要买的都买齐了');
  } finally { env.done(); }
});

test('清单不在了（地址错了、删掉了）→ 回首页并提示', async () => {
  for (const id of ['l_nope', 'l_gone']) {
    const env = setup({ listId: id, seed: s => { s.data.lists.l_gone = deletedRecord(normalizeRecord('lists', { id: 'l_gone', name: '删掉的', updatedAt: 1 })); } });
    try {
      await settle();
      assert.deepEqual(env.navs, ['/']);
      assert.equal(env.toasts.at(-1).msg, '这张清单不在了');
    } finally { env.done(); }
  }
});

// ---------- 改一样东西 ----------
const open = async (env, name) => { await byCls(env.row(name), 'item-main').fire('click'); return env.sheet(); };
const fieldOf = (sh, label) => allCls(sh.el, 'f-row').find(r => byCls(r, 'f-label').textContent === label);
const control = (sh, label) => fieldOf(sh, label).control;

test('编辑：数量 −/+、单位快捷选项、分类、备注；「完成」才存，改了分类和单位记进 memory；名字空着报错不关', async () => {
  const env = setup();
  try {
    await env.enter('牛奶');
    const more = byCls(env.row('牛奶'), 'item-main');
    assert.equal(more.attrs['aria-label'], '编辑「牛奶」');
    const sh = await open(env, '牛奶');
    assert.equal(sh.opts.title, '编辑');
    assert.deepEqual(allCls(sh.el, 'f-label').map(x => x.textContent), ['名字', '数量', '单位', '商店', '分类', '备注', '清单'], '食材清单没有状态、链接、价格');
    assert.equal(byCls(fieldOf(sh, '清单'), 'f-help').textContent, '换一张清单就移过去。', '选着的是现在这张，换一张才是移');
    assert.equal(control(sh, '数量').value, '1');
    const [dec, inc] = allCls(fieldOf(sh, '数量'), 'step-btn');
    await inc.fire('click'); await inc.fire('click');
    assert.equal(control(sh, '数量').value, '3');
    await dec.fire('click');
    assert.equal(control(sh, '数量').value, '2');
    await btn(fieldOf(sh, '单位'), '瓶').fire('click');
    assert.equal(control(sh, '单位').value, '瓶');
    assert.equal(btn(fieldOf(sh, '单位'), '瓶').attrs['aria-pressed'], 'true');
    const cat = control(sh, '分类');
    assert.deepEqual(cat.querySelectorAll('option').map(o => o.textContent),
      ['未分类', '蔬果', '肉类海鲜', '蛋奶', '面包烘焙', '冷冻', '粮油干货', '调料酱料', '零食饮料', '日用清洁'], '只有食材的分类');
    assert.equal(cat.value, 'c_dairy');
    cat.value = 'c_snacks';
    control(sh, '备注').value = '低脂的\n别买错';
    const store = control(sh, '商店');
    assert.equal(store.querySelectorAll('option')[0].textContent, '未指定');
    assert.equal(store.value, 's_wholefoods');
    // 名字空着：报错、不关、什么也没改
    control(sh, '名字').value = '  ';
    await btn(sh.el, '保存').fire('click');
    assert.equal(fieldOf(sh, '名字').err.textContent, '名字不能空着');
    assert.equal(control(sh, '名字').attrs['aria-invalid'], 'true');
    assert.ok(sh.open);
    assert.equal(itemNamed('牛奶').qty, 1);
    control(sh, '名字').value = '牛奶';
    await btn(sh.el, '保存').fire('click');
    await settle();
    assert.equal(sh.open, false);
    const it = itemNamed('牛奶');
    assert.deepEqual([it.qty, it.unit, it.categoryId, it.note, it.storeId], [2, '瓶', 'c_snacks', '低脂的\n别买错', 's_wholefoods']);
    assert.deepEqual([memoryOf(S(), '牛奶').categoryId, memoryOf(S(), '牛奶').unit], ['c_snacks', '瓶']);
    assert.deepEqual(env.rows(), [['牛奶', '2 瓶']]);
    assert.equal(byCls(env.row('牛奶'), 'item-note').textContent, '低脂的', '备注只显示第一行');
    // 数量减到空 = 不写数量
    const sh2 = await open(env, '牛奶');
    const [dec2] = allCls(fieldOf(sh2, '数量'), 'step-btn');
    await dec2.fire('click'); await dec2.fire('click');
    assert.equal(control(sh2, '数量').value, '');
    assert.equal(dec2.attrs['aria-disabled'], 'true');
    await btn(sh2.el, '保存').fire('click');
    await settle();
    assert.equal(itemNamed('牛奶').qty, null);
    assert.deepEqual(env.rows(), [['牛奶', '']]);
  } finally { env.done(); }
});

test('编辑：有没保存的修改时关面板先问；没改直接关', async () => {
  const env = setup();
  try {
    await env.enter('牛奶');
    let sh = await open(env, '牛奶');
    sh.tryClose();
    assert.equal(sh.open, false, '没改：直接关');
    sh = await open(env, '牛奶');
    control(sh, '单位').value = '盒';
    env.answer = false;
    sh.tryClose();
    await settle();
    assert.equal(env.confirms.at(-1).message, '放弃没保存的修改？');
    assert.deepEqual([env.confirms.at(-1).cancelLabel, env.confirms.at(-1).confirmLabel, env.confirms.at(-1).danger], ['继续编辑', '放弃', true], '和别的 App 一样：[继续编辑] [放弃]，焦点先给继续编辑');
    assert.ok(sh.open);
    env.answer = true;
    sh.tryClose();
    await settle();
    assert.equal(sh.open, false);
    assert.equal(itemNamed('牛奶').unit, '');
  } finally { env.done(); }
});

test('编辑一般清单的东西：状态（要买 / 以后再说 / 已买）、链接（只收 http / https，「打开」不带来源）、价格', async () => {
  const env = setup({ listId: 'l_tobuy' });
  try {
    await env.enter('台灯');
    const sh = await open(env, '台灯');
    assert.deepEqual(allCls(sh.el, 'f-label').map(x => x.textContent), ['名字', '数量', '单位', '商店', '分类', '备注', '状态', '商品链接', '价格', '清单']);
    assert.deepEqual(control(sh, '分类').querySelectorAll('option').map(o => o.textContent), ['未分类', '衣物', '书籍', '工具五金', '数码', '家居']);
    const url = control(sh, '商品链接');
    const openA = byCls(sh.el, 'open-link');
    assert.equal(openA.hidden, true, '没有链接时不显示「打开」');
    url.value = 'javascript:alert(1)'; await url.fire('input');
    assert.equal(openA.hidden, true);
    await btn(sh.el, '保存').fire('click');
    assert.equal(fieldOf(sh, '商品链接').err.textContent, '链接要以 http:// 或 https:// 开头');
    url.value = 'https://example.com/lamp'; await url.fire('input');
    assert.deepEqual([openA.hidden, openA.attrs.href, openA.attrs.target, openA.attrs.rel], [false, 'https://example.com/lamp', '_blank', 'noopener noreferrer']);
    control(sh, '价格').value = '-3';
    await btn(sh.el, '保存').fire('click');
    assert.equal(fieldOf(sh, '价格').err.textContent, '价格要是 0 或更大的数字');
    assert.equal(fieldOf(sh, '商品链接').err.hidden, true, '改好的错误收起来');
    control(sh, '价格').value = '$39.90';
    await btn(fieldOf(sh, '状态'), '以后再说').fire('click');
    await btn(sh.el, '保存').fire('click');
    await settle();
    const it = itemNamed('台灯', 'l_tobuy');
    assert.deepEqual([it.url, it.price, it.status], ['https://example.com/lamp', 39.9, 'later']);
    assert.deepEqual(env.rows(env.sec('later')), [['台灯', '1']]);
  } finally { env.done(); }
});

test('编辑：移到别的清单（那边已经有同名的先确认合并）；删除可以撤销', async () => {
  const env = setup({ listId: 'l_tobuy', seed: s => {
    s.data.items.i_g = normalizeRecord('items', { id: 'i_g', listId: 'l_groceries', name: '电池', status: 'done', doneAt: 5, updatedAt: 5 });
  } });
  try {
    await env.enter('电池 x4');
    await env.enter('台灯');
    // 移到「食材」：那边已经有「电池」（已买）→ 先问；不合并就什么也不改
    let sh = await open(env, '电池');
    const to = control(sh, '清单');
    assert.deepEqual(to.querySelectorAll('option').map(o => o.textContent), ['食材', '想买']);
    assert.equal(to.value, 'l_tobuy', '选着的是现在这张');
    to.value = 'l_groceries';
    env.answer = false;
    await btn(sh.el, '保存').fire('click');
    assert.equal(env.confirms.at(-1).message, '「食材」上已经有「电池」了，合并成一条？');
    assert.ok(sh.open);
    assert.equal(itemNamed('电池', 'l_tobuy').listId, 'l_tobuy');
    env.answer = true;
    await btn(sh.el, '保存').fire('click');
    await settle();
    assert.equal(sh.open, false);
    assert.equal(S().data.items.i_g.status, 'need', '合并成那一条，恢复成要买');
    assert.deepEqual(env.rows(), [['台灯', '1']]);
    assert.equal(env.toasts.at(-1).msg, '已移到「食材」');
    // 删除：马上生效，可以撤销
    sh = await open(env, '台灯');
    await btn(sh.el, '删除这一样').fire('click');
    await settle();
    assert.equal(sh.open, false);
    assert.equal(env.rows().length, 0);
    const toast = env.toasts.at(-1);
    assert.deepEqual([toast.msg, toast.action.label], ['已删除「台灯」', '撤销']);
    toast.action.run();
    await settle();
    assert.deepEqual(env.rows(), [['台灯', '1']]);
  } finally { env.done(); }
});

test('编辑：改了数量、备注再移到有同名的清单 → 合并后留下来的那一条带着这次改的（不是改在被删掉的那条上）', async () => {
  const env = setup({ listId: 'l_tobuy', seed: s => {
    s.data.items.i_g = normalizeRecord('items', { id: 'i_g', listId: 'l_groceries', name: '袜子', status: 'done', doneAt: 5, updatedAt: 5 });
  } });
  try {
    await env.enter('袜子');
    const sh = await open(env, '袜子');
    control(sh, '数量').value = '3';
    control(sh, '备注').value = '黑色 M 码';
    control(sh, '清单').value = 'l_groceries';
    await btn(sh.el, '保存').fire('click');
    await settle();
    assert.equal(sh.open, false);
    const kept = S().data.items.i_g;
    assert.deepEqual([kept.status, kept.qty, kept.note], ['need', 3, '黑色 M 码']);
  } finally { env.done(); }
});

test('编辑：改了名字还没点完成就点「删除这一样」→ 先问要不要放弃修改；不放弃就不删', async () => {
  const env = setup();
  try {
    await env.enter('牛奶');
    const sh = await open(env, '牛奶');
    control(sh, '名字').value = '燕麦奶';
    env.answer = false;
    await btn(sh.el, '删除这一样').fire('click');
    await settle();
    assert.equal(env.confirms.at(-1).message, '放弃没保存的修改？');
    assert.ok(sh.open);
    assert.ok(itemNamed('牛奶') && !itemNamed('牛奶').deleted, '没删');
    env.answer = true;
    await btn(sh.el, '删除这一样').fire('click');
    await settle();
    assert.equal(sh.open, false);
    assert.equal(itemNamed('牛奶').deleted, true);
  } finally { env.done(); }
});

test('编辑：指定的商店、分类删掉了 → 显示未指定 / 未分类，只改备注时不算改了它们（恢复了还回来）；指定的商店归档了留在选项里', async () => {
  const env = setup({ seed: s => {
    s.data.stores.s_gone = normalizeRecord('stores', { id: 's_gone', name: '关门的店', order: 20, deleted: true, deletedAt: 3, updatedAt: 3 });
    s.data.stores.s_old = normalizeRecord('stores', { id: 's_old', name: '老店', order: 21, archived: true, updatedAt: 3 });
    s.data.categories.c_gone = normalizeRecord('categories', { id: 'c_gone', name: '删掉的分类', kind: 'grocery', order: 30, deleted: true, deletedAt: 3, updatedAt: 3 });
    s.data.items.i_a = normalizeRecord('items', { id: 'i_a', listId: 'l_groceries', name: '酱油', storeId: 's_gone', categoryId: 'c_gone', updatedAt: 4 });
    s.data.items.i_b = normalizeRecord('items', { id: 'i_b', listId: 'l_groceries', name: '醋', storeId: 's_old', updatedAt: 4 });
  } });
  try {
    let sh = await open(env, '酱油');
    assert.deepEqual([control(sh, '商店').value, control(sh, '分类').value], ['', '']);
    control(sh, '备注').value = '老抽';
    await btn(sh.el, '保存').fire('click');
    await settle();
    const it = S().data.items.i_a;
    assert.deepEqual([it.note, it.storeId, it.categoryId], ['老抽', 's_gone', 'c_gone'], '商店、分类恢复了就回来');
    sh = await open(env, '醋');
    const opts = control(sh, '商店').querySelectorAll('option');
    assert.ok(opts.some(o => o.textContent === t('item.storeArchived', { name: '老店' })), '归档的、现在指定的那家留着');
    assert.ok(!opts.some(o => o.textContent.includes('关门的店')));
    assert.equal(control(sh, '商店').value, 's_old');
    sh.tryClose();
    assert.equal(sh.open, false, '没改：直接关');
  } finally { env.done(); }
});

// ---------- ⋯ → 编辑清单 ----------
test('⋯ → 编辑清单：改名、换图标；自建清单能删除（先确认，离开这一页，能撤销）；预置的只能归档', async () => {
  const env = setup({ listId: 'l_wood', seed: s => { s.data.lists.l_wood = normalizeRecord('lists', { id: 'l_wood', name: '木工', kind: 'general', order: 2, updatedAt: 1 }); } });
  try {
    await env.enter('砂纸 2张');
    const more = find(env.main, el => el.tag === 'button' && el.attrs['aria-label'] === t('common.more'));
    await more.fire('click');
    await btn(env.sheet().el, '编辑清单').fire('click');
    let sh = env.sheet();
    assert.equal(sh.opts.title, '编辑清单');
    assert.equal(byCls(sh.el, 'kind-pick'), undefined, '类型建好以后不能改');
    const name = find(sh.el, el => el.tag === 'input' && el.attrs.maxlength === '80');
    name.value = '木工活';
    await allCls(sh.el, 'icon-opt')[13].fire('click');
    await btn(sh.el, '保存').fire('click');
    await settle();
    assert.equal(byCls(env.main, 'lp-name').textContent, '木工活');
    assert.equal(S().data.lists.l_wood.icon, byCls(env.main, 'lp-icon').textContent);
    // 删除
    await more.fire('click');
    await btn(env.sheet().el, '编辑清单').fire('click');
    sh = env.sheet();
    await btn(sh.el, '删除清单').fire('click');
    await settle();
    assert.equal(env.confirms.at(-1).title, '删除「木工活」？');
    assert.equal(env.confirms.at(-1).message, '里面的 1 样东西会跟着隐藏。删除后 10 秒内可以撤销。');
    assert.deepEqual(env.navs, ['back:/']);
    assert.equal(S().data.lists.l_wood.deleted, true);
    assert.equal(env.toasts.at(-1).msg, '已删除「木工活」');
    env.toasts.at(-1).action.run();
    assert.equal(S().data.lists.l_wood.deleted, undefined);
  } finally { env.done(); }
  const env2 = setup();
  try {
    const more = find(env2.main, el => el.tag === 'button' && el.attrs['aria-label'] === t('common.more'));
    await more.fire('click');
    await btn(env2.sheet().el, '编辑清单').fire('click');
    const sh = env2.sheet();
    assert.equal(btn(sh.el, '删除清单'), undefined);
    assert.ok(sh.el.textContent.includes('系统自带的清单不能删除，可以归档。'));
    await btn(sh.el, '归档').fire('click');
    await settle();
    assert.deepEqual(env2.navs, ['back:/']);
    assert.equal(S().data.lists.l_groceries.archived, true);
    assert.equal(env2.toasts.at(-1).msg, '已归档「食材」');
  } finally { env2.done(); }
});

test('点了一行、还没挪就归档了这张清单（离开这一页）：点过的那一下不改；平常离开时照样写进去', async () => {
  const seed = s => { s.data.items.i_m = normalizeRecord('items', { id: 'i_m', listId: 'l_groceries', name: '牛奶', updatedAt: 1 }); };
  const env = setup({ seed, extraDom: { matchMedia: () => ({ matches: false }) } });
  try {
    await byCls(env.row('牛奶'), 'item-tick').fire('click');           // 0.3 秒后才改数据
    const more = find(env.main, el => el.tag === 'button' && el.attrs['aria-label'] === t('common.more'));
    await more.fire('click');
    await btn(env.sheet().el, '编辑清单').fire('click');
    await btn(env.sheet().el, '归档').fire('click');
    await settle();
    assert.equal(S().data.lists.l_groceries.archived, true);
  } finally { env.done(); }
  await new Promise(r => setTimeout(r, 400));
  assert.equal(S().data.items.i_m.status, 'need', '归档了的清单上点过的不改');
  const env2 = setup({ seed, extraDom: { matchMedia: () => ({ matches: false }) } });
  try {
    await byCls(env2.row('牛奶'), 'item-tick').fire('click');
    env2.handle.cleanup();
    assert.equal(S().data.items.i_m.status, 'done', '换页离开：点过的马上写进去');
    await settle();
  } finally { env2.done(); }
});

// ---------- 首页 ----------
test('首页：每张清单是去清单页的链接；「编辑」切到排顺序（带名字的 ↑↓，到头了标 aria-disabled）；已归档（N）折着', async () => {
  const env = setup({ view: 'home', seed: s => {
    s.data.lists.l_wood = normalizeRecord('lists', { id: 'l_wood', name: '木工', kind: 'general', order: 2, updatedAt: 1 });
    s.data.lists.l_old = normalizeRecord('lists', { id: 'l_old', name: '旧清单', kind: 'general', order: 3, archived: true, updatedAt: 1 });
  } });
  try {
    const links = () => all(env.main, el => el.tag === 'a' && cls(el, 'list-row'));
    assert.deepEqual(links().map(a => [a.attrs.href, byCls(a, 'list-name').textContent]), [['#/l/l_groceries', '食材'], ['#/l/l_tobuy', '想买'], ['#/l/l_wood', '木工']]);
    const arch = byCls(env.main, 'arch');
    assert.equal(byCls(arch, 'sec-toggle').textContent, '已归档（1）');
    assert.equal(byCls(arch, 'sec-toggle').attrs['aria-expanded'], 'false');
    assert.equal(links().length, 3, '归档的折着，不显示');
    await byCls(arch, 'sec-toggle').fire('click');
    assert.deepEqual(links().map(a => a.attrs.href).at(-1), '#/l/l_old');
    // 排顺序
    await btn(env.main, '编辑').fire('click');
    assert.equal(links().filter(a => !a.attrs.href.endsWith('l_old')).length, 0, '排顺序时不是链接');
    const mv = all(env.main, el => cls(el, 'mv-btn'));
    assert.deepEqual(mv.map(b => [b.attrs['aria-label'], b.attrs['aria-disabled']]), [
      ['上移「食材」', 'true'], ['下移「食材」', 'false'], ['上移「想买」', 'false'], ['下移「想买」', 'false'], ['上移「木工」', 'false'], ['下移「木工」', 'true']]);
    await mv[4].fire('click');
    await settle();
    assert.deepEqual(allCls(env.main, 'list-name').slice(0, 3).map(x => x.textContent), ['食材', '木工', '想买']);
    assert.equal(S().data.lists.l_groceries.updatedAt, 0, '没挪的预置清单不盖新时间');
    await mv[0].fire('click');
    assert.equal(S().data.lists.l_groceries.order, 0, '到头了按了也不动');
    await btn(env.main, '完成').fire('click');
    assert.equal(links().length, 4);
  } finally { env.done(); }
});

test('首页：在 iPhone / iPad 的浏览器标签页里打开时说一句「和主屏幕上的不是同一份数据」，点「知道了」以后不再说；主屏幕上的不说', async () => {
  const env = setup({ view: 'home', extraDom: { navigator: { standalone: false } } });
  try {
    const note = () => byCls(env.main, 'tab-note');
    assert.ok(note() && note().textContent.includes(t('list.tabNote')));
    await btn(note(), t('list.tabNoteOk')).fire('click');
    assert.equal(note(), undefined);
    assert.equal(state.getLocal().tabNoteOff, true);
    assert.equal(env.doc.activeElement && env.doc.activeElement.tag, 'h1', '按钮没了：焦点给标题');
    const edit = btn(env.main, '编辑');
    assert.equal(edit.attrs['aria-pressed'], undefined, '字本身说了状态（编辑 / 完成），不再加 aria-pressed');
  } finally { env.done(); }
  for (const standalone of [true, undefined]) {
    const e = setup({ view: 'home', extraDom: { navigator: { standalone } } });
    try { assert.equal(byCls(e.main, 'tab-note'), undefined, String(standalone)); } finally { e.done(); }
  }
});

test('首页：Mac 的 Safari 标签页里说「文件 → 添加到程序坞」；iPad（桌面版网站，UA 写的是 Mac，多点触控）照样说添加到主屏幕；程序坞上的、Mac 上别的浏览器不说', () => {
  const SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15';
  const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
  const mm = (standalone) => () => ({ matches: standalone, addEventListener() {} });
  const mac = setup({ view: 'home', extraDom: { navigator: { userAgent: SAFARI, platform: 'MacIntel', maxTouchPoints: 0 }, matchMedia: mm(false) } });
  try {
    const note = byCls(mac.main, 'tab-note');
    assert.ok(note && note.textContent.includes('文件 → 添加到程序坞'));
    assert.ok(!note.textContent.includes('主屏幕'));
  } finally { mac.done(); }
  const ipad = setup({ view: 'home', extraDom: { navigator: { userAgent: SAFARI, platform: 'MacIntel', maxTouchPoints: 5, standalone: false }, matchMedia: mm(false) } });
  try { assert.ok(byCls(ipad.main, 'tab-note').textContent.includes('分享 → 添加到主屏幕')); } finally { ipad.done(); }
  const kinds = [
    [{ userAgent: SAFARI, platform: 'MacIntel', maxTouchPoints: 0 }, true, null],       // 程序坞上的 App（display-mode: standalone）
    // 现在的 Mac Safari 标签页里 navigator.standalone 也有、是 false：照样是 Mac；程序坞上 display-mode 是 standalone 就不说
    [{ userAgent: SAFARI, platform: 'MacIntel', maxTouchPoints: 0, standalone: false }, false, 'mac'],
    [{ userAgent: SAFARI, platform: 'MacIntel', maxTouchPoints: 0, standalone: false }, true, null],
    [{ userAgent: SAFARI, platform: 'MacIntel', maxTouchPoints: 0, standalone: true }, false, null],
    // Mac 上别的 App 里嵌的网页（UA 里没有 Safari）：没有「添加到程序坞」
    [{ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)', platform: 'MacIntel', maxTouchPoints: 0, standalone: false }, false, null],
    [{ userAgent: 'iPhone', platform: 'iPhone', standalone: false }, true, null],      // 主屏幕上的（display-mode 也算）
    [{ userAgent: CHROME, platform: 'MacIntel', maxTouchPoints: 0 }, false, null],      // Mac 上的 Chrome：没有「添加到程序坞」
    [{ userAgent: SAFARI, platform: 'MacIntel', maxTouchPoints: 5 }, false, null],      // 别的 App 里的 iPad 浏览器（没有 standalone）：分不出来，不说
    [{ userAgent: SAFARI, platform: 'MacIntel', maxTouchPoints: 0 }, false, 'mac'],
    [{ userAgent: 'iPhone', platform: 'iPhone', standalone: false }, false, 'ios'],
  ];
  for (const [nav, installed, want] of kinds) assert.equal(home.tabNoteKind(nav, mm(installed)), want, JSON.stringify(nav));
  setLang('en');
  try { assert.ok(t('list.tabNoteMac').includes('File → Add to Dock')); } finally { setLang('zh-Hans'); }
});

test('清单页：⌘N（别的系统 Ctrl+N）把光标放进快速添加；面板开着、正在别的输入框里打字时不管，也不拦浏览器的快捷键', async () => {
  const scrolled = [];
  const env = setup({ extraDom: { navigator: { platform: 'MacIntel' } } });
  try {
    const input = env.input();
    input.scrollIntoView = (o) => scrolled.push(o);
    const press = (extra) => { let prevented = false; for (const fn of env.doc.events.keydown || []) fn({ key: 'n', preventDefault() { prevented = true; }, ...extra }); return prevented; };
    const other = new Element('button');
    other.focus();
    assert.equal(press({ ctrlKey: true }), false, 'Mac 上 Ctrl+N 不算');
    assert.notEqual(env.doc.activeElement, input);
    assert.equal(press({ metaKey: true, shiftKey: true }), false, '⇧⌘N 是别的快捷键');
    assert.equal(press({ metaKey: true }), true);
    assert.equal(env.doc.activeElement, input);
    assert.deepEqual(scrolled, [{ block: 'nearest' }], '滚到看得见的地方');
    assert.equal(press({ metaKey: true, key: 'N' }), true, '已经在快速添加里：照样算（大写 N 也行）');
    // 正在别的输入框里打字：不抢
    const note = new Element('textarea');
    note.focus();
    assert.equal(press({ metaKey: true }), false);
    assert.equal(env.doc.activeElement, note);
    // 面板、确认框开着：不管
    other.focus();
    const dlg = new Element('dialog');
    const realQS = env.doc.querySelector.bind(env.doc);
    env.doc.querySelector = (q) => (q === 'dialog[open]' ? dlg : realQS(q));
    assert.equal(press({ metaKey: true }), false);
    assert.equal(env.doc.activeElement, other);
    env.doc.querySelector = realQS;
  } finally { env.done(); }
  assert.equal((env.doc.events.keydown || new Set()).size, 0, '离开清单页就不再听');
  const win = setup({ extraDom: { navigator: { platform: 'Win32' } } });
  try {
    const press = (extra) => { let prevented = false; for (const fn of win.doc.events.keydown || []) fn({ key: 'n', preventDefault() { prevented = true; }, ...extra }); return prevented; };
    assert.equal(press({ metaKey: true }), false, '别的系统上 ⊞N 不算');
    assert.equal(press({ ctrlKey: true }), true);
    assert.equal(win.doc.activeElement, win.input());
  } finally { win.done(); }
});

test('首页：新建清单（名字、类型、图标、默认商店），建好进清单页；名字空着报错', async () => {
  const env = setup({ view: 'home' });
  try {
    await find(env.main, el => el.tag === 'button' && el.textContent === '新建清单').fire('click');
    const sh = env.sheet();
    assert.equal(sh.opts.title, '新建清单');
    assert.deepEqual(allCls(sh.el, 'f-label').map(x => x.textContent), ['名字', '类型', '图标', '默认商店']);
    assert.equal(allCls(sh.el, 'icon-opt').length, 16);
    await btn(sh.el, '创建').fire('click');
    assert.equal(byCls(sh.el, 'f-err').textContent, '请写个名字');
    assert.ok(sh.open);
    const name = find(sh.el, el => el.tag === 'input' && el.attrs.maxlength === '80');
    name.value = '木工';
    const custom = byCls(sh.el, 'icon-custom');
    custom.value = '🪚🔨'; await custom.fire('input');
    const store = find(sh.el, el => el.tag === 'select');
    store.value = 's_homedepot';
    await btn(sh.el, '创建').fire('click');
    await settle();
    assert.equal(sh.open, false);
    const l = Object.values(S().data.lists).find(x => x.name === '木工');
    assert.deepEqual([l.kind, l.icon, l.defaultStoreId, l.order], ['general', '🪚', 's_homedepot', 2]);
    assert.deepEqual(env.navs, ['/l/' + l.id]);
  } finally { env.done(); }
});
