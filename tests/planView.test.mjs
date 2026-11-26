// 「计划」页（假 DOM + 真的 state.js，只用内存）：一周（七天、按早午晚加餐、今天、‹ › 今天）、一个月（月历的点、点一天看那天的菜、别的月的日子翻过去、本机记住看法）；
// 加一道菜（搜食谱选上、几人份默认食谱的、只写一句、写错了标出来）、点一道菜（改人数时清单跟着变并能撤销、挪到别的日子翻过去、删除并撤销、打开食谱）；
// 「生成购物清单」面板（合在一起的每一行、常备品不勾、清单上已有、日子范围、确认后每道菜分开记、再生成不翻倍）；食谱页的「加到计划」。全是编的数据
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as planView from '../src/views/plan.js';
import * as recipeView from '../src/views/recipe.js';
import * as state from '../src/core/state.js';
import { itemId } from '../src/core/store.js';
import { saveRecipe } from '../src/core/recipes.js';
import { addEntry, entriesOn, planSource, liveEntry, generateList } from '../src/core/plan.js';
import { addFromInput, totalLabel, setStatus } from '../src/core/items.js';
import { setStaple } from '../src/core/memory.js';
import { todayDay, addDays, weekStart, monthStart, addMonths, fmtPlanDay, fmtDayRange, fmtMonth } from '../src/core/dates.js';
import { setLang, t } from '../src/i18n.js';
import { Element, all, find, installDom } from './helpers/dom.mjs';
import { itemSheet } from '../src/ui/itemEditor.js';

const settle = async (n = 5) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)); };
const cls = (el, c) => (el.className || el.attrs.class || '').split(' ').includes(c);
const byCls = (root, c) => find(root, el => cls(el, c));
const allCls = (root, c) => all(root, el => cls(el, c));
const btn = (root, label) => find(root, el => el.tag === 'button' && el.textContent === label);
const fid = (root, f) => root.querySelector(`[data-fid="${f}"]`);
const key = (el, k) => { for (const fn of el.events.keydown || []) fn({ key: k, target: el, preventDefault() {} }); };
const type = async (el, text) => { el.focus(); el.value = text; await el.fire('input'); };
const S = () => state.getState();
const L = 'l_groceries';
const TODAY = todayDay(), MON = weekStart(TODAY);
let clock = Date.now() - 3600_000;
const now = () => (clock += 1000);

/** 红烧肉（2 人份）、咖喱（4 人份）、番茄炒蛋（没写人数）；生抽是常备品 */
function seed(s) {
  const id = (name, servings, ings) => saveRecipe(s, null, { name, servings, ings }, now()).id;
  const hsr = id('红烧肉', '2', [{ name: '五花肉', qty: '500', unit: 'g' }, { name: '洋葱', qty: '1', unit: '个' }, { name: '生抽', qty: '2', unit: '勺' }]);
  const curry = id('咖喱', '4', [{ name: '洋葱', qty: '2', unit: '个' }, { name: '咖喱块', qty: '1', unit: '盒' }]);
  const egg = id('番茄炒蛋', '', [{ name: '番茄', qty: '2', unit: '个' }]);
  setStaple(s, '生抽', true, now());
  return { hsr, curry, egg };
}

/** 假 ctx（照 app.js，和 recipeView.test.mjs 的一样）：面板记下内容和按钮，不开真的 <dialog>；数据变了在微任务里调页面的 onChange */
function setup({ seed: sd = seed, lang = 'zh-Hans', extraDom = {} } = {}) {
  const dom = installDom(extraDom);
  setLang(lang);
  state.load({ storage: null });
  planView.resetPlanView();
  let ids = {};
  if (sd) state.mutate(s => { ids = sd(s) || {}; });
  const env = { ...dom, ids, toasts: [], navs: [], sheets: [], confirms: [], answer: true, handle: null };
  const ctx = env.ctx = {
    t, lang: () => lang, layout: () => 'phone',
    get state() { return S(); }, get local() { return state.getLocal(); },
    setLocal: (p) => state.setLocal(p),
    mutate: (fn, o) => { const r = state.mutate(fn, o); if (o && o.undoLabel) env.toasts.push({ msg: o.undoLabel, undo: true }); return r; },
    toast: (msg, o = {}) => env.toasts.push({ msg, ...o }),
    confirm: async (o) => { env.confirms.push(o); return env.answer; },
    navigate: (p, o) => env.navs.push(o && o.replace ? 'replace:' + p : p), back: (p) => env.navs.push('back:' + p),
    backLabel: (f) => f, guard: () => {},
    sheet(content, opts = {}) {
      const el = new Element('dialog');
      const api = { el, body: el, opts, open: true, title: opts.title,
        close() { if (!api.open) return; api.open = false; env.sheets = env.sheets.filter(x => x !== api); if (opts.onClose) opts.onClose(); },
        tryClose() { if (!opts.beforeClose || opts.beforeClose() !== false) api.close(); },
        setTitle(x) { api.title = x; } };
      const node = typeof content === 'function' ? content(api) : content;
      if (node) el.append(node);
      if (opts.foot) el.append(...opts.foot);
      env.sheets.push(api);
      return api;
    },
  };
  const off = state.subscribe(() => queueMicrotask(() => { if (env.handle && env.handle.onChange) env.handle.onChange(); }));
  env.mount = (view, params) => {
    if (env.handle && env.handle.cleanup) env.handle.cleanup();
    env.main = new Element('section');
    const ret = view.render(env.main, params, ctx);
    env.handle = ret && typeof ret === 'object' ? ret : null;
    return env.main;
  };
  env.sheet = () => env.sheets.at(-1);
  env.done = () => { const h = env.handle; env.handle = null; if (h && h.cleanup) h.cleanup(); off(); dom.restore(); };
  return env;
}
const days = (main) => allCls(main, 'plan-day').map(d => d.dataset.day);
const dayEl = (main, day) => find(main, el => cls(el, 'plan-day') && el.dataset.day === day);
const dishes = (root) => allCls(root, 'pd-dish').map(b => [byCls(b, 'pd-meal').textContent, byCls(b, 'pd-name').textContent, byCls(b, 'pd-sub')?.textContent ?? '']);

// ---------- 一周 ----------
test('一周：周一到周日七张卡片，今天标出来；每天按早饭、午饭、晚饭、加餐列菜（同一顿第二道不再写「晚饭」）；‹ › 换周、「今天」回来', async () => {
  const env = setup();
  try {
    state.mutate(s => {
      addEntry(s, { date: TODAY, meal: 'dinner', recipeId: env.ids.hsr, servings: 3 }, now());
      addEntry(s, { date: TODAY, meal: 'dinner', title: '凉拌黄瓜', note: '少放醋\n第二行' }, now());
      addEntry(s, { date: TODAY, meal: 'breakfast', recipeId: env.ids.egg }, now());
    });
    const main = env.mount(planView, { name: 'plan' });
    assert.equal(main.querySelector('h1').textContent, '日历', '第 13 步改名「日历」');
    assert.equal(days(main).length, 7);
    assert.equal(days(main)[0], MON, '从周一开始');
    assert.equal(byCls(main, 'plan-range').textContent, fmtDayRange(MON, addDays(MON, 6), 'zh-Hans'));
    const td = dayEl(main, TODAY);
    assert.ok(cls(td, 'today'));
    assert.equal(byCls(td, 'pd-today').textContent, '今天');
    assert.deepEqual(dishes(td), [['早饭', '番茄炒蛋', ''], ['晚饭', '红烧肉', '3 人份'], ['晚饭', '凉拌黄瓜', '少放醋']]);
    assert.ok(cls(allCls(td, 'pd-meal')[2], 'cont'), '同一顿的第二道：「晚饭」只给读屏念');
    const other = dayEl(main, TODAY === MON ? addDays(MON, 1) : MON);
    assert.equal(byCls(other, 'pd-empty').textContent, '还没安排');
    assert.equal(fid(main, 'plan-today').attrs['aria-disabled'], 'false', '已经在这一周也能点（滚到今天）');
    fid(main, 'plan-next').click();
    assert.equal(days(main)[0], addDays(MON, 7));
    assert.equal(fid(main, 'plan-today').attrs['aria-disabled'], 'false');
    assert.equal(fid(main, 'plan-next').attrs['aria-label'], '下一周');
    fid(main, 'plan-prev').click(); fid(main, 'plan-prev').click();
    assert.equal(days(main)[0], addDays(MON, -7));
    fid(main, 'plan-today').click();
    assert.equal(days(main)[0], MON);
    // 看到哪一周记在这次打开期间：点进食谱再回来还是那一周
    fid(main, 'plan-next').click();
    const again = env.mount(planView, { name: 'plan' });
    assert.equal(days(again)[0], addDays(MON, 7));
    // 数据变了（别的设备加了一道）：只重画日子
    const nav = byCls(again, 'plan-nav');
    state.mutate(s => addEntry(s, { date: addDays(MON, 8), meal: 'lunch', title: '出去吃' }, now()));
    await settle();
    assert.deepEqual(dishes(dayEl(env.main, addDays(MON, 8))), [['午饭', '出去吃', '']]);
    assert.equal(byCls(env.main, 'plan-nav'), nav, '顶上不重画');
  } finally { env.done(); }
});

// ---------- 一个月 ----------

test('一周：新打开（land）滚到今天的卡片（周一不滚）；「今天」滚到今天；数据变了的重画不滚；看的不是这一周不滚', async () => {
  const scrolls = [];
  Element.prototype.scrollIntoView = function (o) { scrolls.push([this, o]); };
  const env = setup();
  const last = () => { const [el, o] = scrolls.at(-1); return [el.dataset.day || el.tag, o.block]; };
  try {
    const main = env.mount(planView, { name: 'plan' });
    assert.equal(scrolls.length, 0, 'render 里不滚：app 放好滚动位置以后才调 land（后退回来恢复位置的不调）');
    env.handle.land();
    if (TODAY === MON) assert.equal(scrolls.length, 0, '周一：卡片本来就在上面');
    else assert.deepEqual(last(), [TODAY, 'start']);
    const n = scrolls.length;
    state.mutate(s => { addEntry(s, { date: TODAY, meal: 'lunch', title: '公司食堂' }); });
    await settle();
    assert.equal(scrolls.length, n, '数据变了的重画不滚');
    fid(main, 'plan-today').click();
    assert.deepEqual(last(), TODAY === MON ? ['header', 'start'] : [TODAY, 'start'], '「今天」：滚到今天（周一滚回顶上）');
    fid(main, 'plan-next').click();
    const m = scrolls.length;
    env.mount(planView, { name: 'plan' });
    env.handle.land();
    assert.equal(scrolls.length, m, '看的是别的一周：不滚');
    fid(env.main, 'plan-today').click();
    assert.equal(days(env.main)[0], MON);
    assert.equal(scrolls.length, m + 1, '从别的一周点「今天」：翻回来也滚到今天');
  } finally { env.done(); delete Element.prototype.scrollIntoView; }
});
test('一个月：月历周一开头，每天几道菜几个点（最多 3 个），点一天在下面列出那天的菜；本机记住看法；别的月的日子点了翻过去；切回一周接着看选的那天', async () => {
  const env = setup();
  try {
    state.mutate(s => {
      for (let i = 0; i < 5; i++) addEntry(s, { date: TODAY, meal: 'snack', title: '水果 ' + i }, now());
      addEntry(s, { date: addDays(TODAY, 1), meal: 'dinner', recipeId: env.ids.curry }, now());
    });
    const main = env.mount(planView, { name: 'plan' });
    fid(main, 'plan-v-month').click();
    assert.equal(state.getLocal().planView, 'month', '本机记住');
    assert.equal(fid(main, 'plan-v-month').attrs['aria-pressed'], 'true');
    assert.equal(byCls(main, 'plan-range').textContent, fmtMonth(TODAY, 'zh-Hans'));
    assert.deepEqual(byCls(main, 'pm-head').children.map(x => x.textContent), ['一', '二', '三', '四', '五', '六', '日']);
    const cells = allCls(main, 'pm-cell');
    assert.equal(cells.length % 7, 0);
    const cellOf = (day) => find(env.main, el => cls(el, 'pm-cell') && el.dataset.day === day);
    assert.equal(allCls(cellOf(TODAY), 'pm-dot').length, 3, '5 道菜也只画 3 个点');
    assert.equal(cellOf(TODAY).attrs['aria-label'], fmtPlanDay(TODAY, 'zh-Hans') + '，5 道菜');
    assert.ok(cls(cellOf(TODAY), 'today') && cls(cellOf(TODAY), 'sel'), '一开始选今天');
    assert.equal(allCls(main, 'plan-day').length, 1);
    assert.equal(dishes(byCls(main, 'plan-day')).length, 5);
    assert.equal(fid(env.main, 'plan-today').attrs['aria-disabled'], 'true', '选着今天：「今天」灰着');
    allCls(env.main, 'pm-cell').find(c => !cls(c, 'out') && c.dataset.day !== TODAY).click();
    assert.equal(fid(env.main, 'plan-today').attrs['aria-disabled'], 'false', '选了这个月别的一天：「今天」又能点了（读屏不念「灰掉」）');
    cellOf(TODAY).click();
    assert.equal(fid(env.main, 'plan-today').attrs['aria-disabled'], 'true');
    const tomorrow = addDays(TODAY, 1);
    if (monthStart(tomorrow) === monthStart(TODAY)) {
      cellOf(tomorrow).click();
      assert.ok(cls(cellOf(tomorrow), 'sel'));
      assert.deepEqual(dishes(byCls(env.main, 'plan-day')), [['晚饭', '咖喱', '']]);
    }
    // 前面补上的上个月的日子：点了翻到上个月、选上那天
    const out = allCls(env.main, 'pm-cell').find(c => cls(c, 'out'));
    if (out) {
      const day = out.dataset.day;
      out.click();
      assert.equal(byCls(env.main, 'plan-range').textContent, fmtMonth(day, 'zh-Hans'));
      assert.ok(cls(cellOf(day), 'sel'));
    }
    fid(env.main, 'plan-next').click();
    const nextMonth = addMonths(out ? out.dataset.day : TODAY, 1);
    assert.equal(byCls(env.main, 'plan-range').textContent, fmtMonth(nextMonth, 'zh-Hans'));
    fid(env.main, 'plan-today').click();
    assert.equal(byCls(env.main, 'plan-range').textContent, fmtMonth(TODAY, 'zh-Hans'));
    // 再打开还是一个月（本机记着）；切回一周是选中那天的那一周
    const again = env.mount(planView, { name: 'plan' });
    assert.ok(byCls(again, 'pm-grid'));
    fid(again, 'plan-v-week').click();
    assert.equal(days(again)[0], MON);
    assert.equal(state.getLocal().planView, 'week');
  } finally { env.done(); }
});

// ---------- 加一道菜 ----------
test('加一道菜：搜食谱（食材也搜）点一道选上，几人份默认食谱的；选哪一顿；存好提示「已加到…」能撤销；回车选第一道', async () => {
  const env = setup();
  try {
    const main = env.mount(planView, { name: 'plan' });
    const day = addDays(MON, 2);
    fid(main, 'pd-add-' + day).click();
    const sh = env.sheet();
    assert.equal(sh.title, '加一道菜');
    const q = fid(sh.el, 'dish-q');
    assert.equal(env.doc.activeElement, q, '搜索框拿到焦点（iPhone 弹出键盘）');
    assert.equal(fid(sh.el, 'dish-date').value, day);
    assert.equal(fid(sh.el, 'dish-meal-dinner').attrs['aria-pressed'], 'true', '默认晚饭');
    assert.deepEqual(allCls(sh.el, 'dish-opt-name').map(x => x.textContent), ['番茄炒蛋', '红烧肉', '咖喱'], '没打字时列出全部');
    await type(q, '洋葱');
    assert.deepEqual(allCls(sh.el, 'dish-opt').map(b => b.textContent), ['红烧肉用到：洋葱', '咖喱用到：洋葱']);
    assert.ok(fid(sh.el, 'dish-sv').parent.parent.hidden, '还没选食谱：没有几人份');
    await fid(sh.el, 'dish-r-' + env.ids.curry).click();
    assert.equal(byCls(sh.el, 'dish-chosen-name').textContent, '咖喱');
    assert.equal(env.doc.activeElement, fid(sh.el, 'dish-change'), '焦点给「换一道」（点的按钮没了）');
    assert.equal(fid(sh.el, 'dish-sv').value, '4');
    fid(sh.el, 'dish-sv').value = '120'; await fid(sh.el, 'dish-sv').fire('input');
    await fid(sh.el, 'dish-save').click();
    assert.equal(env.sheets.length, 1, '人数写错：不存');
    assert.equal(entriesOn(S(), day).length, 0);
    await find(sh.el, el => el.attrs['aria-label'] === '少一人份').click();
    assert.equal(fid(sh.el, 'dish-sv').value, '99', '从写错的 120 往下减：先回到最多的 99');
    fid(sh.el, 'dish-sv').value = '3'; await fid(sh.el, 'dish-sv').fire('input');
    await fid(sh.el, 'dish-meal-lunch').click();
    await fid(sh.el, 'dish-save').click();
    assert.equal(env.sheets.length, 0);
    const [e] = entriesOn(S(), day);
    assert.deepEqual([e.recipeId, e.title, e.meal, e.servings], [env.ids.curry, '咖喱', 'lunch', 3]);
    assert.deepEqual(env.toasts.at(-1), { msg: '已加到 ' + fmtPlanDay(day, 'zh-Hans') + '的午饭', undo: true });
    await settle();
    assert.deepEqual(dishes(dayEl(env.main, day)), [['午饭', '咖喱', '3 人份']]);
    state.undo();
    assert.equal(entriesOn(S(), day).length, 0, '能撤销');
    // 回车：搜到了就选第一道
    fid(env.main, 'pd-add-' + day).click();
    const q2 = fid(env.sheet().el, 'dish-q');
    await type(q2, '番茄');
    key(q2, 'Enter');
    assert.equal(byCls(env.sheet().el, 'dish-chosen-name').textContent, '番茄炒蛋');
    assert.ok(fid(env.sheet().el, 'dish-sv').parent.parent.hidden, '番茄炒蛋没写人数：没有几人份');
    assert.equal(byCls(env.sheet().el, 'dish-noscale').hidden, false);
  } finally { env.done(); }
});

test('加一道菜：不选食谱就记下写的那句（回车直接存）；什么都没写标出来；写了东西再关先问', async () => {
  const env = setup();
  try {
    const main = env.mount(planView, { name: 'plan' });
    fid(main, 'pd-add-' + MON).click();
    let sh = env.sheet();
    await fid(sh.el, 'dish-save').click();
    assert.equal(byCls(sh.el, 'f-err').textContent, '选一道食谱，或者写一句');
    const q = fid(sh.el, 'dish-q');
    await type(q, '出去吃');
    assert.equal(byCls(sh.el, 'dish-help').textContent, '没有找到食谱，就记成「出去吃」。');
    env.answer = false;
    sh.tryClose();
    await settle();
    assert.equal(env.confirms.at(-1).message, '放弃没保存的修改？');
    assert.equal(env.sheets.length, 1, '继续编辑');
    key(q, 'Enter');
    assert.equal(env.sheets.length, 0);
    const [e] = entriesOn(S(), MON);
    assert.deepEqual([e.recipeId, e.title, e.servings, e.meal], [null, '出去吃', null, 'dinner']);
  } finally { env.done(); }
});

// ---------- 点一道菜 ----------
test('点一道菜：改人数 → 清单上这道菜的用量跟着变，提示能撤销；挪到下一周的日子 → 翻到那一周、提示挪到哪；打开食谱', async () => {
  const env = setup();
  try {
    let id;
    state.mutate(s => {
      id = addEntry(s, { date: MON, meal: 'dinner', recipeId: env.ids.hsr, servings: 2 }, now()).id;
      generateList(s, { from: MON, to: addDays(MON, 6), listId: L }, now());
    });
    const pork = () => S().data.items[itemId(S(), L, '五花肉')];
    assert.equal(totalLabel(pork()), '500 g');
    let main = env.mount(planView, { name: 'plan' });
    fid(main, 'pd-' + id).click();
    let sh = env.sheet();
    assert.equal(sh.title, '红烧肉');
    assert.equal(fid(sh.el, 'dish-sv').value, '2');
    await find(sh.el, el => el.attrs['aria-label'] === '多一人份').click();
    await fid(sh.el, 'dish-save').click();
    assert.equal(totalLabel(pork()), '750 g');
    assert.deepEqual(env.toasts.at(-1), { msg: '清单上这道菜的用量也跟着改了', undo: true });
    state.undo();
    assert.deepEqual([totalLabel(pork()), liveEntry(S(), id).servings], ['500 g', 2], '一起撤销');
    await settle();
    // 挪到下一周
    fid(env.main, 'pd-' + id).click();
    sh = env.sheet();
    const to = addDays(MON, 9);
    fid(sh.el, 'dish-date').value = to;
    await fid(sh.el, 'dish-meal-lunch').click();
    await fid(sh.el, 'dish-save').click();
    assert.deepEqual([liveEntry(S(), id).date, liveEntry(S(), id).meal], [to, 'lunch']);
    assert.equal(totalLabel(pork()), '500 g', '挪日子不动清单');
    assert.equal(env.toasts.at(-1).msg, '已挪到 ' + fmtPlanDay(to, 'zh-Hans') + '的午饭');
    await settle();
    assert.equal(days(env.main)[0], addDays(MON, 7), '翻到那一周，看得到挪过去的');
    assert.deepEqual(dishes(dayEl(env.main, to)), [['午饭', '红烧肉', '2 人份']]);
    // 只改备注：不提示
    const n = env.toasts.length;
    fid(env.main, 'pd-' + id).click();
    fid(env.sheet().el, 'dish-note').value = '多放糖';
    await fid(env.sheet().el, 'dish-save').click();
    assert.equal(env.toasts.length, n);
    // 打开食谱（没改过：不问）
    fid(env.main, 'pd-' + id).click();
    await fid(env.sheet().el, 'dish-open').click();
    await settle();
    assert.equal(env.navs.at(-1), '/r/' + env.ids.hsr);
    assert.equal(env.sheets.length, 0);
  } finally { env.done(); }
});

test('点一道菜：删除（不问，10 秒内能撤销），只为它加的从清单上拿掉并在提示里说；换成只写一句', async () => {
  const env = setup();
  try {
    let a, b;
    state.mutate(s => {
      a = addEntry(s, { date: MON, meal: 'dinner', recipeId: env.ids.curry, servings: 4 }, now()).id;
      b = addEntry(s, { date: addDays(MON, 1), meal: 'dinner', recipeId: env.ids.hsr }, now()).id;
      generateList(s, { from: MON, to: addDays(MON, 6), listId: L }, now());
    });
    const item = (n) => S().data.items[itemId(S(), L, n)];
    const main = env.mount(planView, { name: 'plan' });
    fid(main, 'pd-' + a).click();
    await fid(env.sheet().el, 'dish-del').click();
    await settle();
    assert.equal(env.confirms.length, 0, '没改过：不问');
    assert.equal(S().data.plan[a].deleted, true);
    assert.deepEqual(env.toasts.at(-1), { msg: '已删除「咖喱」，清单上拿掉了 1 样', undo: true });
    assert.equal(item('咖喱块').deleted, true);
    assert.equal(totalLabel(item('洋葱')), '1 个', '洋葱红烧肉也要：只减咖喱那一份');
    assert.equal(dayEl(env.main, MON).querySelector('.pd-dish'), null);
    state.undo();
    await settle();
    assert.equal(liveEntry(S(), a).title, '咖喱');
    assert.deepEqual([item('咖喱块').deleted, totalLabel(item('洋葱'))], [undefined, '3 个']);
    // 换成只写一句：红烧肉那一份拿掉
    fid(env.main, 'pd-' + b).click();
    const sh = env.sheet();
    await fid(sh.el, 'dish-change').click();
    assert.equal(env.doc.activeElement, fid(sh.el, 'dish-q'));
    await type(fid(sh.el, 'dish-q'), '外卖');
    await fid(sh.el, 'dish-save').click();
    assert.deepEqual([liveEntry(S(), b).recipeId, liveEntry(S(), b).title], [null, '外卖']);
    assert.equal(item('五花肉').deleted, true);
    assert.equal(env.toasts.at(-1).msg, '清单上这道菜的用量也跟着改了');
  } finally { env.done(); }
});

// ---------- 生成购物清单 ----------
test('生成购物清单：一开始是这一周；同名同单位合成一行写着来自哪几道；常备品不勾；清单上已有的写出来；确认后每道菜分开记，再生成一次不翻倍', async () => {
  const env = setup();
  try {
    let a, b;
    state.mutate(s => {
      a = addEntry(s, { date: MON, meal: 'dinner', recipeId: env.ids.hsr, servings: 4 }, now()).id;
      b = addEntry(s, { date: addDays(MON, 2), meal: 'lunch', recipeId: env.ids.curry, servings: 2 }, now()).id;
      addEntry(s, { date: addDays(MON, 3), meal: 'dinner', title: '出去吃' }, now());
      addEntry(s, { date: addDays(MON, 8), meal: 'dinner', recipeId: env.ids.egg }, now());     // 下一周
      addFromInput(s, L, '咖喱块', now());
    });
    const main = env.mount(planView, { name: 'plan' });
    fid(main, 'plan-gen').click();
    const sh = env.sheet();
    assert.equal(sh.title, '生成购物清单');
    assert.deepEqual([fid(sh.el, 'pl-from').value, fid(sh.el, 'pl-to').value], [MON, addDays(MON, 6)]);
    assert.equal(fid(sh.el, 'pl-list').value, L);
    const rows = () => allCls(env.sheet().el, 'atl-row').map(r => [byCls(r, 'atl-name').textContent, byCls(r, 'atl-qty')?.textContent ?? '', byCls(r, 'pl-from').textContent,
      byCls(r, 'atl-have')?.textContent ?? '', !!byCls(r, 'atl-box').checked]);
    const wd = (d) => ['周一', '周二', '周三', '周四', '周五', '周六', '周日'][(new Date(d + 'T12:00').getDay() + 6) % 7];
    assert.deepEqual(rows(), [
      ['五花肉', '1000 g', '来自 红烧肉（周一）', '', true],
      ['洋葱', '3 个', `来自 红烧肉（周一）、咖喱（${wd(addDays(MON, 2))}）`, '', true],
      ['生抽', '4 勺', '来自 红烧肉（周一）', '', false],
      ['咖喱块', '0.5 盒', `来自 咖喱（${wd(addDays(MON, 2))}）`, '清单上已有 1', true]]);
    assert.equal(byCls(sh.el, 'pl-skipped').textContent, '有 1 道菜没连着食谱（比如「出去吃」），不算在里面。');
    assert.equal(fid(sh.el, 'pl-go').textContent, '加到清单（3 样）');
    // 标常备品：顺手取消勾
    const onionRow = allCls(sh.el, 'atl-row')[1];
    await byCls(onionRow, 'atl-staple').click();
    assert.equal(rows()[1][4], false);
    assert.equal(fid(env.sheet().el, 'pl-go').textContent, '加到清单（2 样）');
    await byCls(allCls(env.sheet().el, 'atl-row')[1], 'atl-staple').click();
    assert.equal(rows()[1][4], true, '取消常备品就勾回来');
    // 日子范围：结束早于开始标出来、不让加；换到两周就多了番茄
    fid(sh.el, 'pl-to').value = addDays(MON, -1); await fid(sh.el, 'pl-to').fire('change');
    assert.equal(find(sh.el, el => cls(el, 'f-err') && !el.hidden).textContent, '结束的日子不能早于开始的日子');
    assert.equal(fid(sh.el, 'pl-go').attrs['aria-disabled'], 'true');
    fid(sh.el, 'pl-to').value = addDays(MON, 13); await fid(sh.el, 'pl-to').fire('change');
    assert.deepEqual(rows().map(r => r[0]), ['五花肉', '洋葱', '生抽', '咖喱块', '番茄']);
    await fid(sh.el, 'pl-go').click();
    assert.equal(env.sheets.length, 0);
    assert.deepEqual(env.toasts.at(-1), { msg: '已把 4 样加到「食材」', undo: true });
    const onion = S().data.items[itemId(S(), L, '洋葱')];
    assert.deepEqual(Object.keys(onion.needs).sort(), [planSource(a), planSource(b)].sort(), '每道菜分开记');
    assert.equal(totalLabel(S().data.items[itemId(S(), L, '咖喱块')]), '1 + 0.5 盒', '自己加的 1（没写单位）+ 咖喱的半盒');
    // 再生成一次：已经在清单上的照样勾着，确认后数量不翻倍
    fid(env.main, 'plan-gen').click();
    assert.equal(byCls(env.sheet().el, 'pl-again').hidden, false);
    assert.deepEqual(rows().map(r => [r[0], r[3], r[4]]), [['五花肉', '已经加过 1000 g', true], ['洋葱', '已经加过 3 个', true], ['生抽', '', false],
      ['咖喱块', '已经加过 0.5 盒，清单上一共 1 + 0.5 盒', true]], '加过的说加过多少（确认是换掉），清单上还有别的再说一共');
    assert.equal(rows()[1][2], `来自 红烧肉（周一）、咖喱（${wd(addDays(MON, 2))}）`);
    assert.equal(fid(env.sheet().el, 'pl-go').textContent, '更新清单（3 样）', '勾着的都加过了：是更新，不是再加一遍');
    const n0 = env.toasts.length;
    await fid(env.sheet().el, 'pl-go').click();
    assert.equal(totalLabel(S().data.items[itemId(S(), L, '洋葱')]), '3 个');
    assert.deepEqual(env.toasts.slice(n0).map(x => x.msg), ['已更新「食材」上的 3 样', '清单上已经是这些了，没有要改的'], '什么也没变：说一句');
    state.undo();
    assert.equal(totalLabel(S().data.items[itemId(S(), L, '洋葱')]), '3 个', '撤销再生成：回到生成前（一样）');
  } finally { env.done(); }
});

test('生成购物清单：买过的不勾、写着已经买过；这几天没有连着食谱的菜时说一声', async () => {
  const env = setup();
  try {
    state.mutate(s => {
      addEntry(s, { date: MON, meal: 'dinner', recipeId: env.ids.hsr }, now());
      generateList(s, { from: MON, to: addDays(MON, 6), listId: L }, now());
      setStatus(s, itemId(s, L, '五花肉'), 'done', now());
    });
    const main = env.mount(planView, { name: 'plan' });
    fid(main, 'plan-gen').click();
    const pork = allCls(env.sheet().el, 'atl-row')[0];
    assert.deepEqual([byCls(pork, 'atl-name').textContent, byCls(pork, 'atl-have').textContent, !!byCls(pork, 'atl-box').checked], ['五花肉', '已经买过', false]);
    env.sheet().close();
    fid(main, 'plan-next').click();
    fid(main, 'plan-gen').click();
    assert.deepEqual([fid(env.sheet().el, 'pl-from').value, byCls(env.sheet().el, 'pl-empty').hidden], [addDays(MON, 7), false], '翻到下一周：从下一周开始');
    assert.equal(byCls(env.sheet().el, 'pl-empty').textContent, '这几天还没有连着食谱的菜。');
    await fid(env.sheet().el, 'pl-go').click();
    assert.equal(env.sheets.length, 1, '没有可加的：点不了');
  } finally { env.done(); }
});

// ---------- 食谱页的「加到计划」 ----------
test('改一样东西的面板：同一道菜排了两天，「来自食谱」的两份写上哪一天（拿掉的是哪天的分得清，读屏也一样）', async () => {
  const env = setup({ seed: (s) => {
    const oat = saveRecipe(s, null, { name: '燕麦粥', servings: '1', ings: [{ name: '牛奶', qty: '250', unit: 'mL' }] }, now()).id;
    for (const d of [MON, addDays(MON, 4)]) addEntry(s, { date: d, meal: 'breakfast', recipeId: oat, servings: 1 }, now());
    generateList(s, { from: MON, to: addDays(MON, 6), listId: L }, now());
  } });
  try {
    itemSheet(env.ctx, itemId(S(), L, '牛奶'));
    const sh = env.sheet();
    const days = [MON, addDays(MON, 4)].map(d => '燕麦粥 · ' + fmtPlanDay(d, 'zh-Hans'));
    assert.deepEqual(allCls(sh.el, 'need-row').map(r => byCls(r, 'need-label').textContent), days);
    assert.deepEqual(allCls(sh.el, 'need-x').map(x => x.attrs['aria-label']), days.map(d => `拿掉「${d}」的这一份`));
  } finally { env.done(); }
});

test('食谱页「加到计划」：同一个面板，食谱已经选好、默认今天的晚饭、几人份是食谱的；选哪一天哪一顿就加上', async () => {
  const env = setup();
  try {
    const main = env.mount(recipeView, { name: 'recipe', id: env.ids.hsr });
    assert.equal(fid(main, 'rcp-plan').textContent, '加到日历');
    fid(main, 'rcp-plan').click();
    const sh = env.sheet();
    assert.equal(sh.title, '加一道菜');
    assert.equal(byCls(sh.el, 'dish-chosen-name').textContent, '红烧肉');
    assert.deepEqual([fid(sh.el, 'dish-date').value, fid(sh.el, 'dish-sv').value], [TODAY, '2']);
    assert.equal(fid(sh.el, 'dish-meal-dinner').attrs['aria-pressed'], 'true');
    sh.tryClose();
    assert.equal(env.sheets.length, 0, '没改过：直接关');
    fid(main, 'rcp-plan').click();
    const sh2 = env.sheet();
    fid(sh2.el, 'dish-date').value = addDays(TODAY, 3);
    await fid(sh2.el, 'dish-meal-lunch').click();
    await fid(sh2.el, 'dish-save').click();
    const [e] = entriesOn(S(), addDays(TODAY, 3));
    assert.deepEqual([e.recipeId, e.meal, e.servings], [env.ids.hsr, 'lunch', 2]);
    assert.equal(env.toasts.at(-1).msg, '已加到 ' + fmtPlanDay(addDays(TODAY, 3), 'zh-Hans') + '的午饭');
  } finally { env.done(); }
});

test('⌘N 加一道菜：一周里加到今天、一个月里加到选中的那天；面板开着、在输入框里打字时不管；离开页面就不再听', async () => {
  const env = setup({ extraDom: { navigator: { platform: 'MacIntel' } } });
  try {
    const main = env.mount(planView, { name: 'plan' });
    const press = (extra = {}) => { let prevented = false; for (const fn of env.doc.events.keydown || []) fn({ key: 'n', metaKey: true, preventDefault() { prevented = true; }, ...extra }); return prevented; };
    assert.equal(press({ metaKey: false, ctrlKey: true }), false, 'Mac 上 Ctrl+N 不算');
    assert.equal(press(), true);
    assert.equal(fid(env.sheet().el, 'dish-date').value, TODAY);
    env.sheet().close();
    const input = new Element('input'); input.type = 'text'; input.focus();
    assert.equal(press(), false, '正在别的输入框里打字');
    input.blur();
    fid(main, 'plan-v-month').click();
    const other = allCls(main, 'pm-cell').find(c => !cls(c, 'out') && c.dataset.day !== TODAY);
    other.click();
    press();
    assert.equal(fid(env.sheet().el, 'dish-date').value, other.dataset.day);
    env.sheet().close();
    env.handle.cleanup(); env.handle = null;
    assert.equal(press(), false, '离开页面：不再听');
  } finally { env.done(); }
});

test('英文界面：日子、哪一顿、按钮都是英文', () => {
  const env = setup({ lang: 'en' });
  try {
    const main = env.mount(planView, { name: 'plan' });
    assert.equal(main.querySelector('h1').textContent, 'Calendar');
    assert.equal(byCls(main, 'plan-range').textContent, fmtDayRange(MON, addDays(MON, 6), 'en'));
    assert.equal(byCls(dayEl(main, MON), 'pd-wd').textContent, 'Mon');
    assert.deepEqual(['plan-v-week', 'plan-v-month', 'plan-today'].map(f => fid(main, f).textContent), ['Week', 'Month', 'Today']);
    assert.equal(fid(main, 'plan-gen').textContent, 'Make Shopping List');
    fid(main, 'pd-add-' + MON).click();
    assert.deepEqual(['breakfast', 'lunch', 'dinner', 'snack'].map(m => fid(env.sheet().el, 'dish-meal-' + m).textContent), ['Breakfast', 'Lunch', 'Dinner', 'Snack']);
  } finally { env.done(); }
});

// ---------- 检查后修正 ----------
test('加一道菜：打了食谱的完整名字直接按「添加」也连上那道食谱；改只写一句的菜时没动那句话不会悄悄连上；回车选的是名字对上的', async () => {
  const env = setup();
  try {
    let plain;
    state.mutate(s => {
      saveRecipe(s, null, { name: '鸡胸肉沙拉', servings: '1', ings: [{ name: '鸡胸肉', qty: '150', unit: 'g' }] }, now());
      saveRecipe(s, null, { name: '蛋炒饭', servings: '2', ings: [{ name: '鸡蛋', qty: '2', unit: '个' }] }, now());
      plain = addEntry(s, { date: addDays(MON, 1), meal: 'dinner', title: '咖喱' }, now()).id;
    });
    const main = env.mount(planView, { name: 'plan' });
    fid(main, 'pd-add-' + MON).click();
    let sh = env.sheet();
    await type(fid(sh.el, 'dish-q'), '紅燒肉 ');
    await fid(sh.el, 'dish-save').click();
    assert.equal(env.sheets.length, 0);
    const [e] = entriesOn(S(), MON);
    assert.deepEqual([e.recipeId, e.title, e.servings], [env.ids.hsr, '红烧肉', 2], '繁体、多打的空格也算同一个名字；几人份是食谱的');
    // 只写一句的「咖喱」（和食谱同名）只改备注：还是只写一句
    await settle();
    fid(env.main, 'pd-' + plain).click();
    fid(env.sheet().el, 'dish-note').value = '去楼下那家';
    await fid(env.sheet().el, 'dish-save').click();
    assert.deepEqual([liveEntry(S(), plain).recipeId, liveEntry(S(), plain).note], [null, '去楼下那家']);
    // 「鸡」+ 回车：名字里有鸡的鸡胸肉沙拉，不是按拼音排在前面、只因为用到鸡蛋的蛋炒饭
    await settle();
    fid(env.main, 'pd-add-' + MON).click();
    sh = env.sheet();
    const q = fid(sh.el, 'dish-q');
    await type(q, '鸡');
    assert.deepEqual(allCls(sh.el, 'dish-opt-name').map(x => x.textContent), ['鸡胸肉沙拉', '蛋炒饭']);
    key(q, 'Enter');
    assert.equal(byCls(sh.el, 'dish-chosen-name').textContent, '鸡胸肉沙拉');
  } finally { env.done(); }
});

test('生成购物清单：加过的全去掉勾也能确认（按钮说拿掉几样），确认后从清单上拿掉；什么都没加过又全没勾时点不了；选的日子超过一周时「来自」写日期', async () => {
  const env = setup();
  try {
    state.mutate(s => {
      addEntry(s, { date: MON, meal: 'dinner', recipeId: env.ids.curry }, now());
      addEntry(s, { date: addDays(MON, 7), meal: 'dinner', recipeId: env.ids.curry }, now());
      generateList(s, { from: MON, to: addDays(MON, 6), listId: L }, now());
    });
    const main = env.mount(planView, { name: 'plan' });
    fid(main, 'plan-gen').click();
    let sh = env.sheet();
    for (const box of allCls(sh.el, 'atl-box')) { box.checked = false; await box.fire('change'); }
    assert.deepEqual([fid(sh.el, 'pl-go').textContent, fid(sh.el, 'pl-go').attrs['aria-disabled']], ['拿掉（2 样）', 'false']);
    await fid(sh.el, 'pl-go').click();
    assert.equal(env.sheets.length, 0);
    assert.deepEqual(env.toasts.at(-1), { msg: '已从清单上拿掉这几道菜的 2 样', undo: true });
    assert.deepEqual(['洋葱', '咖喱块'].map(n => S().data.items[itemId(S(), L, n)].deleted), [true, true]);
    // 两周：同一道菜做了两个周一，写日期
    fid(env.main, 'plan-gen').click();
    sh = env.sheet();
    fid(sh.el, 'pl-to').value = addDays(MON, 13); await fid(sh.el, 'pl-to').fire('change');
    const day = (d) => fmtPlanDay(d, 'zh-Hans', { weekday: false });
    assert.equal(byCls(allCls(sh.el, 'atl-row')[0], 'pl-from').textContent, `来自 咖喱（${day(MON)}、${day(addDays(MON, 7))}）`);
    for (const box of allCls(sh.el, 'atl-box')) { box.checked = false; await box.fire('change'); }
    assert.deepEqual([fid(sh.el, 'pl-go').textContent, fid(sh.el, 'pl-go').attrs['aria-disabled']], ['加到清单（0 样）', 'true']);
    await fid(sh.el, 'pl-go').click();
    assert.equal(env.sheets.length, 1);
    assert.equal(find(sh.el, el => cls(el, 'atl-err')).textContent, '先勾上要加的食材。');
  } finally { env.done(); }
});

test('点一道菜挪到别的一周：翻过去以后先回到顶上（看得到是哪一周），再把那一天滚进来；同一周里挪只滚到那一天', async () => {
  const scrolls = [];
  Element.prototype.scrollIntoView = function (o) { scrolls.push([this, o]); };
  const env = setup();
  try {
    let id;
    state.mutate(s => { id = addEntry(s, { date: addDays(MON, 6), meal: 'dinner', title: '出去吃' }, now()).id; });
    env.mount(planView, { name: 'plan' });
    fid(env.main, 'pd-' + id).click();
    fid(env.sheet().el, 'dish-date').value = addDays(MON, 7);
    await fid(env.sheet().el, 'dish-save').click();
    assert.equal(days(env.main)[0], addDays(MON, 7));
    assert.deepEqual(scrolls.map(([el, o]) => [el.tag, el.dataset.day || null, o.block]), [['header', null, 'start'], ['section', addDays(MON, 7), 'nearest']]);
    scrolls.length = 0;
    await settle();
    fid(env.main, 'pd-' + id).click();
    fid(env.sheet().el, 'dish-date').value = addDays(MON, 13);
    await fid(env.sheet().el, 'dish-save').click();
    assert.deepEqual(scrolls.map(([el, o]) => [el.tag, el.dataset.day, o.block]), [['section', addDays(MON, 13), 'nearest']]);
  } finally { env.done(); delete Element.prototype.scrollIntoView; }
});
