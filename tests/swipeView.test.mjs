// 一行左右滑（src/ui/swipe.js 接到 ui/checklist.js 的行上）：清单页、商店页、搜索。最小 DOM + 真的 state.js，事件按捕获 → 冒泡派发。
//   每一行都是往右滑露出「编辑」、往左滑露出红色的「删除」（哪张清单、什么状态都一样；没有「以后再说」「移回要买」）。
//   滑只是露出按钮，点了按钮才做：拖得再远、甩得再快、被打断、触控板猛扫都只是开着或者关上；
//   删除和编辑面板里的一样（进「最近删除」、10 秒「撤销」），编辑打开点这一行的那个面板；点开着的行（圆圈、别处）只是关上（不勾掉、不打开）；同一时间只开一行；
//   关着时没有按钮（之后关着时 hidden），开着时能用键盘点、名字带东西的名字；拖着的时候数据变了，滑完再重画。
// 东西都是编的（仓库是公开的）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as listView from '../src/views/list.js';
import * as storeView from '../src/views/store.js';
import * as searchView from '../src/views/search.js';
import { SWIPE } from '../src/ui/swipe.js';
import * as state from '../src/core/state.js';
import { normalizeRecord, deletedRecord } from '../src/core/store.js';
import { setLang, t } from '../src/i18n.js';
import { Element, all, find, installDom } from './helpers/dom.mjs';

const A = SWIPE.action, W = 343;
const tick = async (n = 3) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)); };
const cls = (el, c) => (el.className || el.attrs.class || '').split(' ').includes(c);
const byCls = (root, c) => find(root, el => cls(el, c));
const S = () => state.getState();
const raw = (id) => S().data.items[id];
// 最小 DOM 里没有的
Object.defineProperty(Element.prototype, 'parentNode', { configurable: true, get() { return this.parent || null; } });
Element.prototype.closest = function (sel) {          // 只要 .class
  for (let n = this; n; n = n.parent) if (n.classList && n.classList.contains(sel.slice(1))) return n;
  return null;
};
Element.prototype.scrollIntoView = function () {};

/** 派发事件：先 window、document（swipe.js 在这两个上面听捕获），再从目标往上冒泡；返回事件（看 defaultPrevented） */
function dispatch(target, type, props = {}) {
  const ev = { type, target, defaultPrevented: false, stopped: false, cancelable: true, ...props,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; } };
  for (const node of [globalThis.window, globalThis.document]) {
    for (const fn of [...(node.events[type] || [])]) { fn(ev); if (ev.stopped) return ev; }
  }
  for (let el = target; el; el = el.parent) {
    for (const fn of [...(el.events[type] || [])]) fn(ev);
    if (ev.stopped) break;
  }
  return ev;
}

/** 编的数据：食材（要买 牛奶、面包，已买 鸡蛋）、想买（要买 台灯、椅子，以后再说 书桌，已买 雨伞） */
function seed(s) {
  const add = (id, listId, name, f = {}) => { s.data.items[id] = normalizeRecord('items', { id, listId, name, status: 'need', storeId: 's_wholefoods', updatedAt: 1, createdAt: 1, ...f }); };
  add('i_milk', 'l_groceries', '牛奶', { categoryId: 'c_dairy' });
  add('i_bread', 'l_groceries', '面包', { categoryId: 'c_dairy' });
  add('i_egg', 'l_groceries', '鸡蛋', { categoryId: 'c_dairy', status: 'done', doneAt: 5 });
  add('i_lamp', 'l_tobuy', '台灯');
  add('i_chair', 'l_tobuy', '椅子');
  add('i_desk', 'l_tobuy', '书桌', { status: 'later' });
  add('i_umb', 'l_tobuy', '雨伞', { status: 'done', doneAt: 5 });
}

/** 一页：时钟、计时器（手动推进）、宽度、减少动态效果交给 swipe.js；ctx 照着 app.js（undoLabel → 提示条带「撤销」，数据变了下一个微任务里 onChange） */
function setup({ page = 'list', params = { id: 'l_groceries' }, reduce = false } = {}) {
  const dom = installDom({ navigator: {} });
  setLang('zh-Hans');
  state.load({ storage: null });
  state.mutate(seed);
  const clock = { t: 1000 }, timers = [];
  let tid = 0;
  const swipe = {
    now: () => clock.t, width: () => W, reduceMotion: () => reduce,
    setTimeout: (fn, ms) => { const id = ++tid; timers.push({ id, fn, at: clock.t + ms }); return id; },
    clearTimeout: (id) => { const i = timers.findIndex(x => x.id === id); if (i >= 0) timers.splice(i, 1); },
  };
  /** 把到期的计时器都跑完（动画做完） */
  const flush = (ms = 5000) => {
    const end = clock.t + ms;
    for (;;) {
      timers.sort((x, y) => x.at - y.at);
      const x = timers[0];
      if (!x || x.at > end) break;
      timers.shift();
      clock.t = Math.max(clock.t, x.at);
      x.fn();
    }
  };
  const env = { ...dom, clock, timers, flush, toasts: [], navs: [], sheets: [], handle: null };
  const ctx = env.ctx = {
    t, lang: () => 'zh-Hans', layout: () => 'phone',
    get state() { return S(); }, get local() { return state.getLocal(); },
    setLocal: (p) => state.setLocal(p),
    mutate: (fn, o) => state.mutate(fn, o),
    remove(c, id, o) { const prev = S().data[c][id]; if (!prev || prev.deleted) return null; state.mutate(s => { s.data[c][id] = deletedRecord(prev); }, o); return prev; },
    toast: (msg, o = {}) => env.toasts.push({ msg, ...o }),
    confirm: async () => true,
    navigate: (p) => env.navs.push(p), back: (p) => env.navs.push('back:' + p), replaceHash() {},
    get route() { return { name: page }; },
    sheet(content, opts = {}) {
      const el = new Element('dialog');
      const api = { el, body: el, opts, open: true, close() { api.open = false; env.sheets = env.sheets.filter(x => x !== api); } };
      const node = typeof content === 'function' ? content(api) : content;
      if (node) el.append(node);
      env.sheets.push(api);
      return api;
    },
  };
  const off = state.subscribe((st, info) => {
    if (info.undoLabel) ctx.toast(info.undoLabel, { ms: 10000, action: { label: t('common.undo'), run: () => state.undo() } });
    queueMicrotask(() => { if (env.handle && env.handle.onChange) env.handle.onChange(info); });
  });
  const views = { list: listView, store: storeView, search: searchView };
  env.main = new Element('section');
  env.handle = views[page].render(env.main, { name: page, query: {}, ...params }, ctx, { swipe });
  Object.assign(env, {
    row: (name) => all(env.main, el => cls(el, 'item-row')).find(r => byCls(r, 'item-name').textContent === name),
    rows: () => all(env.main, el => cls(el, 'item-row')).map(r => byCls(r, 'item-name').textContent),
    // 先拿掉 handle：离开时做完的删除、移动会在下一个微任务里通知 onChange，那时假 DOM 已经拆了
    done() { const hd = env.handle; env.handle = null; if (hd && hd.cleanup) hd.cleanup(); off(); dom.restore(); },
  });
  return env;
}

const inner = (w) => w.children[0];
const mainOf = (w) => byCls(w, 'item-main');      // 这一行（点了是编辑；拖的时候按在这里）
const tickOf = (w) => byCls(w, 'item-tick');      // 左边的圆圈（只有点它才勾掉）
const btnOf = (w, c) => byCls(w, c);
/** 这一行现在移开多少 px（没移是 0） */
const offsetOf = (w) => Number((/-?\d+/.exec(inner(w).style.transform || '') || [0])[0]);
/** 用手指（或笔）拖：pts = [[x, y], …]，每步 16 ms；rest：松手前停多久（0 = 边拖边松手，有速度） */
function drag(env, target, pts, { id = 1, type = 'touch', rest = 200, up = true } = {}) {
  const p = (x, y) => ({ pointerId: id, pointerType: type, clientX: x, clientY: y, button: 0, isPrimary: true });
  dispatch(target, 'pointerdown', p(...pts[0]));
  for (const [x, y] of pts.slice(1)) { env.clock.t += 16; dispatch(target, 'pointermove', p(x, y)); }
  env.clock.t += rest;
  if (up) dispatch(target, 'pointerup', p(...pts[pts.length - 1]));
}
const line = (x0, x1, n = 8, y = 300) => Array.from({ length: n + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / n, y]);
/** 点一下（按下、抬起、click）→ click 事件 */
function tap(env, target, x = 200, y = 300) {
  drag(env, target, [[x, y]], { rest: 60 });
  env.clock.t += 10;
  return dispatch(target, 'click', { clientX: x, clientY: y });
}
/** 往左（-1）/ 往右（1）慢慢滑开、动画做完 */
function openRow(env, w, side) {
  drag(env, mainOf(w), side < 0 ? line(320, 160) : line(60, 220));
  env.flush();
}
/** 所有东西的状态、删除（看手势有没有偷偷改数据） */
const snapshot = () => Object.fromEntries(Object.entries(S().data.items).map(([id, it]) => [id, [it.status, !!it.deleted]]));

test('往左滑露出红色的「删除」：关着时没有按钮；拖得再远、甩得再快、松手都只是开着，不删、不打开面板', async () => {
  const env = setup();
  try {
    const before = snapshot();
    const w = env.row('牛奶');
    assert.ok(cls(w, 'swipe'), '行本身（<li>）是可滑的那一层');
    assert.deepEqual(w.children.map(x => x.attrs.class), ['item-in'], '关着：只有内容，没有按钮（读屏、Tab 都碰不到）');
    drag(env, mainOf(w), line(320, 250), { up: false });
    assert.equal(inner(w).style.transform, 'translateX(-70px)', '跟手');
    const side = byCls(w, 'sw-r'), del = btnOf(w, 'sw-del');
    assert.deepEqual(side.children, [del], '右边只有一个「删除」');
    assert.equal(byCls(side, 'sw-edit'), undefined);
    assert.deepEqual([byCls(w, 'sw-l').hidden, btnOf(w, 'sw-edit').hidden], [true, true], '另一边的「编辑」藏着');
    assert.deepEqual([del.attrs['aria-label'], byCls(del, 'sw-t').textContent], ['删除「牛奶」', '删除']);
    assert.equal(side.style.width, '70px');
    dispatch(mainOf(w), 'pointerup', { pointerId: 1, pointerType: 'touch', clientX: 250, clientY: 300 });
    env.clock.t += 5;
    assert.ok(dispatch(mainOf(w), 'click').defaultPrevented, '滑完松手不算点（不打开面板）');
    env.flush();
    assert.equal(w.swipe.side, -1);
    assert.equal(offsetOf(w), -A, '开着：移开一个按钮宽');
    assert.equal(side.style.width, A + 'px');
    assert.deepEqual([side.hidden, del.hidden], [false, false]);
    // 一口气往左拖过整行、甩得很快：最多 1.5 倍（橡皮筋），松手照样只是开着
    drag(env, mainOf(w), line(340, -500, 5), { rest: 0, up: false });
    assert.ok(-offsetOf(w) > A && -offsetOf(w) <= A * SWIPE.pull, String(offsetOf(w)));
    dispatch(mainOf(w), 'pointerup', { pointerId: 1, pointerType: 'touch', clientX: -500, clientY: 300 });
    env.flush();
    await tick();
    assert.equal(w.swipe.side, -1);
    assert.deepEqual(snapshot(), before, '数据一点没变');
    assert.deepEqual([env.toasts, env.sheets], [[], []]);
    assert.ok(env.row('牛奶') === w, '没有重画');
    // 拖了不到一个按钮宽的一半：弹回去
    const bread = env.row('面包');
    env.clock.t += 1000;
    drag(env, mainOf(bread), line(320, 290));
    env.flush();
    assert.deepEqual([bread.swipe.side, w.swipe.side], [0, 0], '拖了 30 px：弹回去（开着的牛奶也关上了）');
  } finally { env.done(); }
});
test('点「删除」：这一行滑出去、收起来以后删（进「最近删除」），提示条和编辑面板的删除一样能撤销；减少动态效果时马上删', async () => {
  const env = setup();
  try {
    let w = env.row('牛奶');
    openRow(env, w, -1);
    const ev = tap(env, btnOf(w, 'sw-del'));
    assert.ok(ev.defaultPrevented);
    assert.ok(cls(w, 'sw-out'));
    assert.equal(!!raw('i_milk').deleted, false, '动画做完以前还没删');
    env.flush();
    assert.ok(cls(w, 'sw-gone'));
    assert.equal(w.style.height, '0px');
    assert.equal(!!raw('i_milk').deleted, true, '软删除：进「最近删除」');
    assert.deepEqual(env.toasts.map(x => [x.msg, x.ms, x.action && x.action.label]), [[t('item.deleted', { name: '牛奶' }), 10000, '撤销']]);
    await tick();
    assert.equal(env.row('牛奶'), undefined, '重画，那一行不见了');
    env.toasts[0].action.run();
    await tick();
    assert.equal(!!raw('i_milk').deleted, false, '撤销');
    w = env.row('牛奶');
    assert.equal(w.swipe.side, 0);
  } finally { env.done(); }
  const quick = setup({ reduce: true });
  try {
    const w = quick.row('面包');
    drag(quick, mainOf(w), line(320, 160));
    assert.equal(offsetOf(w), -A, '没有动画：直接到位');
    assert.ok(!cls(w, 'sw-anim'));
    tap(quick, btnOf(w, 'sw-del'));
    assert.equal(!!raw('i_bread').deleted, true, '马上删');
  } finally { quick.done(); }
});

test('往右滑露出「编辑」，点了这一行弹回去，打开和点这一行一样的编辑面板（不改数据）', async () => {
  const env = setup();
  try {
    const before = snapshot();
    const w = env.row('牛奶');
    drag(env, mainOf(w), line(60, 400, 4), { rest: 0 });          // 往右狠甩：也只是露出来
    env.flush();
    await tick();
    const edit = btnOf(w, 'sw-edit');
    assert.deepEqual([w.swipe.side, offsetOf(w)], [1, A]);
    assert.deepEqual(byCls(w, 'sw-l').children, [edit], '左边只有一个「编辑」');
    assert.deepEqual([edit.attrs['aria-label'], byCls(edit, 'sw-t').textContent], ['编辑「牛奶」', '编辑']);
    assert.deepEqual([snapshot(), env.sheets], [before, []], '松手不打开');
    tap(env, edit);
    assert.equal(w.swipe.side, 0, '关上');
    assert.equal(env.sheets.length, 1);
    assert.equal(env.sheets[0].opts.title, t('item.editTitle'));
    assert.equal(find(env.sheets[0].el, el => el.tag === 'input').value, '牛奶', '就是这一样的面板');
    env.flush();
    await tick();
    assert.deepEqual(snapshot(), before);
    // 和点这一行打开的是同一个面板
    env.sheets[0].close();
    await mainOf(w).fire('click');
    assert.equal(env.sheets[0].opts.title, t('item.editTitle'));
  } finally { env.done(); }
});
test('每一行都一样：一般清单的要买、以后再说、已买，食材清单的已买，都是往右「编辑」、往左「删除」（没有「以后再说」「移回要买」）', async () => {
  const env = setup({ params: { id: 'l_tobuy' } });
  try {
    const before = snapshot();
    for (const name of ['台灯', '书桌', '雨伞']) {
      const w = env.row(name);
      env.clock.t += 1000;
      openRow(env, w, 1);
      assert.equal(w.swipe.side, 1, name);
      assert.deepEqual(byCls(w, 'sw-l').children.map(b => b.attrs['aria-label']), ['编辑「' + name + '」'], name + '：往右是编辑');
      w.swipe.close();
      env.clock.t += 1000;
      openRow(env, w, -1);
      assert.equal(w.swipe.side, -1, name);
      assert.deepEqual(byCls(w, 'sw-r').children.map(b => b.attrs['aria-label']), ['删除「' + name + '」'], name + '：往左是删除');
      assert.equal(btnOf(w, 'sw-later'), undefined);
      w.swipe.close();
    }
    assert.deepEqual(snapshot(), before, '只是露出来，什么都没改');
  } finally { env.done(); }
  const groc = setup();
  try {
    const w = groc.row('鸡蛋');
    openRow(groc, w, 1);
    assert.equal(w.swipe.side, 1, '已买的也能往右滑出「编辑」');
    assert.ok(btnOf(w, 'sw-edit'));
  } finally { groc.done(); }
});
test('点开着的行（圆圈、别处）只是关上，不勾掉、不打开面板；开着时点别的行也只是关上；同一时间只开一行；没有开着的行时只有点圆圈才勾掉', async () => {
  const env = setup();
  try {
    const before = snapshot();
    const milk = env.row('牛奶'), bread = env.row('面包');
    for (const [side, part] of [[-1, mainOf], [-1, tickOf], [1, mainOf], [1, tickOf]]) {
      env.clock.t += 1000;
      openRow(env, milk, side);
      env.clock.t += 1000;
      const ev = tap(env, part(milk), 100);
      assert.ok(ev.defaultPrevented && ev.stopped, '这一下 click 吞掉了');
      env.flush();
      await tick();
      assert.equal(milk.swipe.side, 0);
      assert.deepEqual([snapshot(), env.sheets.length], [before, 0], '没有勾掉，也没打开面板');
    }

    openRow(env, milk, -1);
    env.clock.t += 1000;
    tap(env, tickOf(bread), 100);
    env.flush();
    await tick();
    assert.equal(milk.swipe.side, 0);
    assert.deepEqual(snapshot(), before, '点到别的行的圆圈：只是关上开着的那行');

    openRow(env, milk, -1);
    env.clock.t += 1000;
    openRow(env, bread, 1);
    assert.deepEqual([milk.swipe.side, bread.swipe.side], [0, 1], '在别的行上开始滑：先开着的那行关上');
    env.row('面包').swipe.close();
    // 没有开着的行时：点这一行打开编辑面板（不勾）；点圆圈才勾掉
    env.clock.t += 1000;
    tap(env, mainOf(env.row('牛奶')), 200);
    await tick();
    assert.deepEqual([raw('i_milk').status, env.sheets.length], ['need', 1], '点名字：打开面板，不勾');
    env.sheets[0].close();
    env.clock.t += 1000;
    tap(env, tickOf(env.row('牛奶')), 30);
    await tick();
    assert.equal(raw('i_milk').status, 'done');
  } finally { env.done(); }
});
test('关着时按钮 hidden；开着时能用键盘点（Enter / 空格是 detail 0 的 click），删掉以后焦点给下一行；Esc 关上、焦点回到这一行的圆圈', async () => {
  const env = setup();
  try {
    assert.deepEqual(env.rows(), ['面包', '牛奶', '鸡蛋']);
    let w = env.row('面包');
    w.swipe.open(-1);
    const edit = btnOf(w, 'sw-edit'), del = btnOf(w, 'sw-del');
    assert.deepEqual([del.hidden, edit.hidden], [false, true], '开着的那边能 Tab 到，另一边的「编辑」藏着');
    del.focus();
    dispatch(globalThis.document, 'keydown', { key: 'Escape' });
    assert.equal(w.swipe.side, 0);
    assert.equal(globalThis.document.activeElement, tickOf(w), '焦点回到这一行的圆圈');
    env.flush();
    assert.deepEqual([edit.hidden, del.hidden, byCls(w, 'sw-r').hidden], [true, true, true], '关上以后藏起来');

    w.swipe.open(-1);
    del.focus();
    dispatch(del, 'click', { detail: 0 });         // 键盘
    assert.equal(globalThis.document.activeElement, tickOf(env.row('牛奶')), '焦点挪到下一行（的圆圈），不掉回页首');
    env.flush();
    assert.equal(!!raw('i_bread').deleted, true);
    await tick();
    assert.equal(globalThis.document.activeElement.dataset.fid, 'it-i_milk', '重画以后还在那一行上');

    // 删到这一页最后一行：焦点先留在这一行的勾上，删掉重画以后给页面标题（和编辑面板里的「删除」一样），不掉回页首的 <body>
    for (const name of ['牛奶', '鸡蛋']) {
      w = env.row(name);
      w.swipe.open(-1);
      const d = btnOf(w, 'sw-del');
      d.focus();
      dispatch(d, 'click', { detail: 0 });
      env.flush();
      await tick();
    }
    assert.deepEqual(env.rows(), []);
    assert.equal(globalThis.document.activeElement && globalThis.document.activeElement.dataset.fid, 'lp-title');
  } finally { env.done(); }
});

test('不算点了按钮的：滑完落到按钮上的 click、在按钮上按下去移开 10 px 以上、两根手指同时按着、按钮那边没露着', async () => {
  const env = setup();
  try {
    const before = snapshot();
    const w = env.row('牛奶');
    openRow(env, w, -1);
    const del = btnOf(w, 'sw-del');
    // 在行上按下、拖着，click 落到按钮上
    env.clock.t += 1000;
    drag(env, mainOf(w), line(200, 180, 3));
    env.clock.t += 5;
    dispatch(del, 'click');
    // 在按钮上按下去拖开 12 px 再松手
    env.flush();
    w.swipe.open(-1);
    env.clock.t += 1000;
    const pt = (x, id = 1) => ({ pointerId: id, pointerType: 'touch', clientX: x, clientY: 300, button: 0, isPrimary: id === 1 });
    dispatch(del, 'pointerdown', pt(300));
    dispatch(del, 'pointermove', pt(312));
    dispatch(del, 'pointerup', pt(312));
    dispatch(del, 'click');
    // 一根手指按着别处，另一根点按钮
    env.clock.t += 1000;
    dispatch(env.main, 'pointerdown', pt(50, 1));
    dispatch(del, 'pointerdown', pt(300, 2));
    dispatch(del, 'pointerup', pt(300, 2));
    dispatch(del, 'click');
    dispatch(env.main, 'pointerup', pt(50, 1));
    env.flush();
    await tick();
    assert.deepEqual(snapshot(), before, '都没删');
    // 按钮那边关着时（拿着旧的按钮）点了也不算
    w.swipe.close();
    env.clock.t += 1000;
    dispatch(del, 'click', { detail: 0 });
    env.flush();
    assert.equal(!!raw('i_milk').deleted, false);
    // 真的点一下才算
    w.swipe.open(-1);
    env.clock.t += 1000;
    tap(env, del, 300);
    env.flush();
    assert.equal(!!raw('i_milk').deleted, true);
  } finally { env.done(); }
});

test('上下滚动、从屏幕左边缘开始的、鼠标拖都不滑；触控板两指横扫能开能关，惯性再大也只是开着', async () => {
  const env = setup({ params: { id: 'l_tobuy' } });
  try {
    const before = snapshot();
    const w = env.row('台灯');
    drag(env, mainOf(w), [[200, 300], [196, 320], [190, 380]]);
    assert.equal(w.swipe.side, 0, '竖着的');
    drag(env, mainOf(w), line(10, 200));
    assert.equal(w.swipe.side, 0, '从左边 20 px 以内开始的');
    drag(env, mainOf(w), line(300, 100), { type: 'mouse' });
    assert.equal(w.swipe.side, 0, '鼠标不拖');
    // 触控板：两指往左（deltaX 为正）连惯性一共扫了上千 px
    let t0 = env.clock.t;
    for (let i = 0; i < 40; i++) { env.clock.t = t0 + i * 16; dispatch(mainOf(w), 'wheel', { deltaX: 40, deltaY: 0, deltaMode: 0 }); }
    assert.ok(-offsetOf(w) <= Math.ceil(A * 1.2), String(offsetOf(w)));   // 橡皮筋以后不到 1.2 个按钮宽（取整）
    env.flush();
    assert.equal(w.swipe.side, -1, '开着');
    t0 = env.clock.t + 1000;
    for (let i = 0; i < 10; i++) { env.clock.t = t0 + i * 16; dispatch(mainOf(w), 'wheel', { deltaX: -30, deltaY: 0, deltaMode: 0 }); }
    env.flush();
    assert.equal(w.swipe.side, 0, '往回扫关上，不会扫到另一边');
    await tick();
    assert.deepEqual(snapshot(), before);
  } finally { env.done(); }
});

test('触控板扫开、惯性还没停（wheelGap 以内）就点这一行（圆圈、别处；鼠标、手指、笔）：只是停好、关上，不勾掉、不打开面板，也不停在半中间', async () => {
  const env = setup({ params: { id: 'l_tobuy' } });
  try {
    const before = snapshot();
    const w = env.row('台灯');
    const scan = () => {
      const t0 = env.clock.t + 1000;
      for (let i = 0; i < 20; i++) { env.clock.t = t0 + i * 16; dispatch(mainOf(w), 'wheel', { deltaX: 40, deltaY: 0, deltaMode: 0 }); }
      env.clock.t += 40;                               // 惯性还在：离最后一个 wheel 不到 wheelGap
    };
    for (const [type, part] of [['mouse', 'item-tick'], ['touch', 'item-tick'], ['pen', 'item-tick'], ['mouse', 'item-main'], ['touch', 'item-main'], ['pen', 'item-main']]) {
      scan();
      assert.ok(offsetOf(w) < -A, '扫开着（看起来开着，还没停好）');
      const target = byCls(w, part);
      drag(env, target, [[200, 300]], { type, rest: 60 });
      env.clock.t += 10;
      dispatch(target, 'click', { clientX: 200, clientY: 300 });
      env.flush();
      await tick();
      assert.deepEqual(snapshot(), before, `${type} 点 ${part}：不勾掉`);
      assert.equal(env.sheets.length, 0, `${type} 点 ${part}：不打开面板`);
      assert.deepEqual([w.swipe.side, offsetOf(w)], [0, 0], `${type} 点 ${part}：关上，不停在半中间`);
    }
    // 之后照常：扫开、停好，再点「删除」才删
    scan();
    env.flush();
    assert.equal(w.swipe.side, -1);
    env.clock.t += 1000;
    tap(env, btnOf(w, 'sw-del'), 300);
    env.flush();
    assert.equal(!!raw('i_lamp').deleted, true);
  } finally { env.done(); }
});

test('拖着的时候数据变了（同步进来）：滑完再重画，手底下的行不换掉；最多等几秒', async () => {
  const env = setup();
  try {
    const w = env.row('牛奶');
    drag(env, mainOf(w), line(320, 250), { up: false });
    state.mutate(s => { s.data.items.i_bread = { ...s.data.items.i_bread, name: '全麦面包', updatedAt: 9 }; });
    await tick();
    assert.equal(env.row('牛奶'), w, '还没重画');
    assert.ok(env.row('面包'));
    dispatch(mainOf(w), 'pointerup', { pointerId: 1, pointerType: 'touch', clientX: 250, clientY: 300 });
    env.flush();
    await tick();
    assert.ok(env.row('全麦面包'), '滑完重画了');
    const w2 = env.row('牛奶');
    assert.notEqual(w2, w);
    assert.equal(w2.swipe.side, 0, '别处改的数据：重画以后关上');
    // 手指一直按着不放：最多等 hold 毫秒
    drag(env, mainOf(w2), line(320, 250), { up: false });
    state.mutate(s => { s.data.items.i_bread = { ...s.data.items.i_bread, name: '黑麦面包', updatedAt: 10 }; });
    await tick();
    assert.ok(env.row('全麦面包'));
    env.flush(SWIPE.hold + 10);
    assert.ok(env.row('黑麦面包'), '等太久就照样重画');
  } finally { env.done(); }
});

test('商店页、搜索的行也一样能滑：往右编辑、往左删除；离开页面时等动画的删除马上做完', async () => {
  const store = setup({ page: 'store', params: { id: 's_wholefoods' } });
  try {
    const w = store.row('台灯');
    openRow(store, w, 1);
    tap(store, btnOf(w, 'sw-edit'));
    assert.equal(store.sheets.length, 1, '打开编辑面板');
    store.sheets[0].close();
    const milk = store.row('牛奶');
    store.clock.t += 1000;
    openRow(store, milk, -1);
    tap(store, btnOf(milk, 'sw-del'));
    store.flush();
    assert.equal(!!raw('i_milk').deleted, true);
  } finally { store.done(); }
  const search = setup({ page: 'search', params: { query: { q: '书' } } });
  try {
    const w = search.row('书桌');
    assert.ok(w, search.rows().join());
    openRow(search, w, 1);
    assert.equal(btnOf(w, 'sw-edit').attrs['aria-label'], '编辑「书桌」', '以后再说的也是编辑');
    w.swipe.close();
    search.clock.t += 1000;
    openRow(search, w, -1);
    tap(search, btnOf(w, 'sw-del'));
    search.flush();
    assert.equal(!!raw('i_desk').deleted, true);
  } finally { search.done(); }
  // 离开页面时等动画的删除马上做完，不会丢（清单页的 cleanup）
  const lp = setup({ page: 'list', params: { id: 'l_tobuy' } });
  try {
    const w = lp.row('椅子');
    openRow(lp, w, 1);
    tap(lp, btnOf(w, 'sw-edit'));
    assert.equal(lp.sheets.length, 1, '往右照样打开编辑面板');
    lp.sheets[0].close();
    lp.clock.t += 1000;
    openRow(lp, w, -1);
    tap(lp, btnOf(w, 'sw-del'));
    lp.handle.cleanup();
    lp.handle = null;
    assert.equal(!!raw('i_chair').deleted, true);
  } finally { lp.done(); }
});
test('和勾选的节奏一起：勾了马上滑开，勾在滑的时候就到时间、照常改成已买（重画等滑完）；接着点「删除」删的是已买的那一样，撤销回到已买；在别的行上滑着的时候，勾的那一行等滑完再挪；切到后台时等动画的删除马上做', async () => {
  const env = setup();
  const mm = Object.getOwnPropertyDescriptor(globalThis, 'matchMedia');
  globalThis.matchMedia = () => ({ matches: false });   // 没有减少动态效果：勾了以后停 320 ms 再挪（真的计时器）
  try {
    // 真实的先后：滑一下要两三百毫秒，勾的 320 ms 在手指还没抬起时就到了
    let w = env.row('牛奶');
    tap(env, tickOf(w), 30);
    assert.ok(cls(w, 'ticking'), '先在原地打勾');
    assert.equal(raw('i_milk').status, 'need');
    env.clock.t += 1000;
    drag(env, mainOf(w), line(320, 160), { up: false });
    await new Promise(r => setTimeout(r, 400));
    assert.equal(raw('i_milk').status, 'done', '勾照常改了（看到的就是勾上的）');
    assert.equal(env.row('牛奶'), w, '滑着：还没重画');
    dispatch(mainOf(w), 'pointerup', { pointerId: 1, pointerType: 'touch', clientX: 160, clientY: 300 });
    assert.equal(w.swipe.side, -1, '松手：开着');
    tap(env, btnOf(w, 'sw-del'));                    // 弹开的动画还没完（重画还在等）就点了「删除」
    env.flush();
    await tick();
    assert.deepEqual([raw('i_milk').status, !!raw('i_milk').deleted], ['done', true], '删掉的是勾过的那一样');
    env.toasts[env.toasts.length - 1].action.run();
    await tick();
    assert.deepEqual([raw('i_milk').status, !!raw('i_milk').deleted], ['done', false], '撤销以后回到已买');
    assert.ok(cls(env.row('牛奶').parent.parent, 'sec-done'));

    // 勾了面包，马上在牛奶上横着滑（手指没抬起）：面包到时间了也等滑完再挪，牛奶这一行不在手底下换掉
    env.clock.t += 1000;
    tap(env, tickOf(env.row('面包')), 30);
    w = env.row('牛奶');
    env.clock.t += 1000;
    drag(env, mainOf(w), line(320, 250), { up: false });
    await new Promise(r => setTimeout(r, 400));
    assert.equal(raw('i_bread').status, 'done', '数据照常改了');
    assert.equal(env.row('牛奶'), w, '还没重画');
    dispatch(mainOf(w), 'pointerup', { pointerId: 1, pointerType: 'touch', clientX: 250, clientY: 300 });
    env.flush();
    await tick();
    assert.ok(cls(env.row('面包').parent.parent, 'sec-done'), '滑完重画：面包挪到已买');
    assert.equal(env.row('牛奶').swipe.side, 0, '别处的改动（勾掉了别的）引起的重画：滑开的这一行关上');

    // 切到后台（页面的 flush）：滑出去还没删的马上删
    w = env.row('牛奶');
    env.clock.t += 1000;
    openRow(env, w, -1);
    tap(env, btnOf(w, 'sw-del'));
    assert.equal(!!raw('i_milk').deleted, false);
    env.handle.flush();
    assert.equal(!!raw('i_milk').deleted, true);
  } finally {
    if (mm) Object.defineProperty(globalThis, 'matchMedia', mm); else delete globalThis.matchMedia;
    env.done();
  }
});

test('别处改了数据（同步进来）时开着的行：重画以后关上，焦点在按钮上的回到这一行的圆圈；之后半秒内点行不算（是冲着刚才的按钮去的）', async () => {
  const env = setup();
  try {
    const w = env.row('牛奶');
    openRow(env, w, -1);
    btnOf(w, 'sw-del').focus();
    state.mutate(s => { s.data.items.i_bread = { ...s.data.items.i_bread, name: '全麦面包', updatedAt: 9 }; });
    await tick();
    const w2 = env.row('牛奶');
    assert.notEqual(w2, w, '重画了');
    env.flush();
    assert.equal(w2.swipe.side, 0, '关上');
    assert.equal(globalThis.document.activeElement, tickOf(w2), '焦点回到新画的这一行的圆圈，不丢');
    tap(env, tickOf(w2), 30);
    await tick();
    assert.equal(raw('i_milk').status, 'need', '刚关上：这一下不勾');
    env.clock.t += SWIPE.block + 100;
    tap(env, tickOf(env.row('牛奶')), 30);
    await tick();
    assert.equal(raw('i_milk').status, 'done', '过了半秒照常勾掉');
  } finally { env.done(); }
});

test('捏合放大着不滑；页面滚动了关上开着的行；键盘点「编辑」：焦点先回到这一行的圆圈，再打开编辑面板', async () => {
  const env = setup({ params: { id: 'l_tobuy' } });
  try {
    const w = env.row('台灯');
    globalThis.window.visualViewport = { scale: 2 };
    drag(env, mainOf(w), line(320, 160));
    env.flush();
    assert.equal(w.swipe.side, 0, '放大着：横着拖是在看放大的页面');
    delete globalThis.window.visualViewport;

    openRow(env, w, -1);
    assert.equal(w.swipe.side, -1);
    env.main.scrollTop = 30;
    dispatch(env.main, 'scroll');
    env.flush();
    assert.equal(w.swipe.side, 0, '滚动了：关上');
    env.main.scrollTop = 0;

    w.swipe.open(1);
    const edit = btnOf(w, 'sw-edit');
    edit.focus();
    dispatch(edit, 'click', { detail: 0 });          // 键盘
    assert.equal(w.swipe.side, 0);
    assert.equal(globalThis.document.activeElement, tickOf(w), '先回到这一行的圆圈（按钮藏起来了），面板关上以后回到这里');
    assert.equal(env.sheets.length, 1);
    assert.equal(find(env.sheets[0].el, el => el.tag === 'input').value, '台灯');
  } finally { env.done(); }
});
