// 饮食记录的页面（第 13 步，假 DOM + 真的 state.js，只用内存）：日历每天的「吃了什么」（按顿、几份、营养、合计和目标、没填热量的、一周的平均）、
// 月历上每天的千卡；记一样吃的面板（计划里的菜「吃了」、食谱没填营养时也记到食谱里、常吃的、从食谱选、手动写、写错标出来）、改一条（只改份数按比例变）、删除并撤销；
// 编辑食谱的「每人份营养」和食谱页上的那一块；设置 → 饮食目标（一格一格地存、写错不存）和设置首页下面那句。全是编的数据
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as planView from '../src/views/plan.js';
import * as recipeView from '../src/views/recipe.js';
import * as editView from '../src/views/recipeEdit.js';
import * as settingsView from '../src/views/settings.js';
import { weekAvgLine } from '../src/ui/dayLog.js';
import * as state from '../src/core/state.js';
import { saveRecipe } from '../src/core/recipes.js';
import { addEntry } from '../src/core/plan.js';
import { addLogEntry, logOn, liveLog, setGoals, goalsOf } from '../src/core/log.js';
import { foodOf } from '../src/core/foods.js';
import { todayDay, addDays, weekStart } from '../src/core/dates.js';
import { setLang, t } from '../src/i18n.js';
import { Element, all, find, installDom, fakeStorage } from './helpers/dom.mjs';

const settle = async (n = 5) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)); };
const cls = (el, c) => (el.className || el.attrs.class || '').split(' ').includes(c);
const byCls = (root, c) => find(root, el => cls(el, c));
const allCls = (root, c) => all(root, el => cls(el, c));
const fid = (root, f) => root.querySelector(`[data-fid="${f}"]`);
const type = async (el, text) => { el.focus(); el.value = text; await el.fire('input'); };
const S = () => state.getState();
const TODAY = todayDay(), MON = weekStart(TODAY);
let clock = Date.now() - 3600_000;
const now = () => (clock += 1000);

/** 红烧肉（填了每人份营养）、燕麦粥（没填、也估算不出来：食材没写用量）；今天晚饭红烧肉、早饭燕麦粥；常吃的牛肉面、拿铁 */
function seed(s) {
  const hsr = saveRecipe(s, null, { name: '红烧肉', servings: '2', ings: [{ name: '五花肉', qty: '500', unit: 'g' }], nutrition: { kcal: '620', protein: '22', carbs: '18', fat: '50' } }, now()).id;
  const oat = saveRecipe(s, null, { name: '燕麦粥', servings: '1', ings: [{ name: '燕麦' }, { name: '牛奶' }] }, now()).id;
  const pHsr = addEntry(s, { date: TODAY, meal: 'dinner', recipeId: hsr, servings: '3' }, now()).id;
  const pOat = addEntry(s, { date: TODAY, meal: 'breakfast', recipeId: oat, servings: '1' }, now()).id;
  addLogEntry(s, { date: addDays(TODAY, -20), title: '牛肉面', per: { kcal: '650', protein: '32' } }, now());
  addLogEntry(s, { date: addDays(TODAY, -20), title: '拿铁', per: { kcal: '190' } }, now());
  addLogEntry(s, { date: addDays(TODAY, -19), title: '拿铁', per: { kcal: '190' } }, now());
  return { hsr, oat, pHsr, pOat };
}

/** 假 ctx（照 app.js，和 planView.test.mjs 的一样）：面板记下内容和按钮，不开真的 <dialog>；数据变了在微任务里调页面的 onChange */
function setup({ lang = 'zh-Hans' } = {}) {
  const dom = installDom();
  setLang(lang);
  state.load({ storage: null });
  planView.resetPlanView();
  let ids = {};
  state.mutate(s => { ids = seed(s) || {}; });
  const env = { ...dom, ids, toasts: [], navs: [], sheets: [], confirms: [], answer: true, handle: null, storage: fakeStorage() };
  const ctx = env.ctx = {
    t, lang: () => lang, layout: () => 'phone', build: 'picknest-test',
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
  env.mount = (view, params, deps) => {
    if (env.handle && env.handle.cleanup) env.handle.cleanup();
    env.main = new Element('section');
    const ret = view.render(env.main, params, ctx, deps);
    env.handle = ret && typeof ret === 'object' ? ret : null;
    return env.main;
  };
  env.sheet = () => env.sheets.at(-1);
  env.done = () => { const h = env.handle; env.handle = null; if (h && h.cleanup) h.cleanup(); off(); dom.restore(); };
  return env;
}
const dayEl = (main, day) => find(main, el => cls(el, 'plan-day') && el.dataset.day === day);
// pd-sub：看的那一行（短写法，aria-hidden）+ 读屏念的（sr-only，全写）；这里取看的那一行，读屏的用 srSub
const logRows = (root) => allCls(root, 'lg-row').map(b => [byCls(b, 'pd-meal').textContent, byCls(b, 'pd-name').textContent, byCls(b, 'pd-sub')?.children[0].textContent ?? '', byCls(b, 'lg-kcal').textContent]);
const srSub = (root) => allCls(root, 'lg-row').map(b => (byCls(b, 'pd-sub') ? byCls(byCls(b, 'pd-sub'), 'sr-only').textContent : ''));
const errOf = (input) => { let p = input.parent; while (p && !cls(p, 'f-row')) p = p.parent; const e = p && byCls(p, 'f-err'); return e && !e.hidden ? e.textContent : null; };

test('日历的一天：吃了什么按顿列出（几份、营养素、没填热量的），合计和目标比（还差 / 超了、细进度条），没记的那天写「还没记」；一周的平均', async () => {
  const env = setup();
  try {
    state.mutate(s => {
      addLogEntry(s, { date: TODAY, meal: 'lunch', title: '牛肉面', servings: '2', per: { kcal: '650', protein: '32' } }, now());
      addLogEntry(s, { date: TODAY, meal: 'breakfast', title: '燕麦粥', per: { kcal: '330', protein: '14' } }, now());
      addLogEntry(s, { date: TODAY, meal: 'lunch', title: '饼干', per: {} }, now());
      setGoals(s, { kcal: '1800', protein: '90' }, now());
    });
    const main = env.mount(planView, { name: 'plan' });
    const td = dayEl(main, TODAY);
    assert.equal(byCls(td, 'lg-title').textContent, '吃了什么');
    assert.deepEqual(logRows(td), [['早饭', '燕麦粥', '蛋白\u00a014\u00a0g', '330\u00a0千卡'], ['午饭', '牛肉面', '2 份 · 蛋白\u00a064\u00a0g', '1300\u00a0千卡'], ['午饭', '饼干', '', '没填热量']]);
    assert.deepEqual(srSub(td), ['蛋白质\u00a014\u00a0g', '2 份 · 蛋白质\u00a064\u00a0g', ''], '读屏念全写的');
    assert.equal(byCls(allCls(td, 'lg-row')[0], 'pd-sub').children[0].attrs['aria-hidden'], 'true');
    assert.ok(cls(allCls(td, 'lg-row')[2].querySelector('.pd-meal'), 'cont'), '同一顿的第二条：「午饭」只给读屏念');
    assert.deepEqual([byCls(td, 'lg-tot-val').textContent, byCls(td, 'lg-tot-goal').textContent, cls(byCls(td, 'lg-tot-goal'), 'over')], ['1630 / 1800\u00a0千卡', '还差 170', false]);
    assert.equal(byCls(td, 'lg-bar').querySelector('span').style.width, '91%');
    assert.deepEqual(allCls(td, 'lg-mac').map(m => [byCls(m, 'lg-mac-label').textContent, byCls(m, 'lg-mac-val').textContent]), [['蛋白质', '78 / 90 g']], '没数也没目标的碳水、脂肪不画');
    assert.equal(byCls(td, 'lg-missing').textContent, '1 样没填热量，没算进去');
    assert.ok(!byCls(main, 'lg-week'), '只有今天记了：今天还没过完，没有一周的平均');
    const other = dayEl(main, TODAY === MON ? addDays(MON, 1) : MON);
    assert.equal(byCls(other, 'lg-none').textContent, '还没记');
    assert.ok(!byCls(other, 'lg-totals'));
    assert.equal(fid(other, 'lg-add-' + other.dataset.day).attrs['aria-label'].startsWith('给 '), true);
    // 超了：琥珀色
    state.mutate(s => addLogEntry(s, { date: TODAY, meal: 'snack', title: '蛋糕', per: { kcal: '300', protein: '20' } }, now()));
    await settle();
    const td2 = dayEl(env.main, TODAY);
    assert.deepEqual([byCls(td2, 'lg-tot-goal').textContent, cls(byCls(td2, 'lg-tot-goal'), 'over'), cls(byCls(td2, 'lg-bar'), 'over')], ['超了 130', true, true]);
    assert.equal(byCls(td2, 'lg-mac-val').textContent, '98 / 90 g');
    // 一个月：每天吃了多少千卡，超过目标的琥珀色，读屏念出来
    fid(env.main, 'plan-v-month').click();
    const cell = fid(env.main, 'pm-' + TODAY);
    assert.deepEqual([byCls(cell, 'pm-kcal').textContent, cls(byCls(cell, 'pm-kcal'), 'over')], ['1930', true]);
    assert.match(cell.attrs['aria-label'], /，2 道菜，吃了 1930\u00a0千卡$/);
    const empty = fid(env.main, 'pm-' + addDays(TODAY, TODAY.endsWith('-01') ? 1 : -1));
    assert.equal(byCls(empty, 'pm-kcal').textContent, '', '没记的那天也占着一行（每格一样高）');
    assert.ok(byCls(env.main, 'lg'), '选中的那天下面照样有「吃了什么」');
  } finally { env.done(); }
});

test('计划里的菜「吃了」：食谱已经选好、1 份、营养是食谱的每人份；改成 1.5 份下面写合计；添加以后能撤销，那道菜标「已记」', async () => {
  const env = setup();
  try {
    const main = env.mount(planView, { name: 'plan' });
    const eat = fid(dayEl(main, TODAY), 'pd-eat-' + env.ids.pHsr);
    assert.equal(eat.attrs['aria-label'], '吃了「红烧肉」，记下来');
    await eat.click();
    const sh = env.sheet();
    assert.equal(sh.title, '记一样吃的');
    assert.equal(byCls(sh.el, 'dish-chosen-name').textContent, '红烧肉');
    assert.deepEqual(['lg-sv', 'lg-kcal', 'lg-protein', 'lg-carbs', 'lg-fat'].map(f => fid(sh.el, f).value), ['1', '620', '22', '18', '50']);
    assert.equal(fid(sh.el, 'lg-meal-dinner').attrs['aria-pressed'], 'true', '计划里的那一顿');
    assert.equal(byCls(sh.el, 'lg-save-to').hidden, true, '食谱填了营养：不问记不记到食谱');
    assert.equal(byCls(sh.el, 'lg-sum').hidden, true, '1 份不写合计');
    await type(fid(sh.el, 'lg-sv'), '1.5');
    assert.equal(byCls(sh.el, 'lg-sum').textContent, '合计：930\u00a0千卡 · 蛋白质\u00a033\u00a0g · 碳水\u00a027\u00a0g · 脂肪\u00a075\u00a0g');
    await fid(sh.el, 'lg-save').click();
    assert.equal(sh.open, false);
    const [e] = logOn(S(), TODAY);
    assert.deepEqual([e.title, e.servings, e.kcal, e.fat, e.planId, e.recipeId, e.meal], ['红烧肉', 1.5, 930, 75, env.ids.pHsr, env.ids.hsr, 'dinner']);
    assert.match(env.toasts.at(-1).msg, /^已记到 .+的晚饭$/);
    await settle();
    assert.equal(byCls(dayEl(env.main, TODAY), 'pd-logged').textContent, '已记');
    state.undo();
    assert.equal(logOn(S(), TODAY).length, 0, '撤销');
  } finally { env.done(); }
});

test('食谱还没填每人份营养：说一句，「也记到食谱里」默认勾着；不勾只记这一次，勾着下次「吃了」直接带上', async () => {
  const env = setup();
  try {
    const main = env.mount(planView, { name: 'plan' });
    await fid(main, 'pd-eat-' + env.ids.pOat).click();
    let sh = env.sheet();
    assert.deepEqual([byCls(sh.el, 'lg-recipe-empty').hidden, byCls(sh.el, 'lg-save-to').hidden, fid(sh.el, 'lg-save-recipe').checked], [false, false, true]);
    assert.equal(fid(sh.el, 'lg-kcal').value, '');
    await type(fid(sh.el, 'lg-kcal'), '330');
    fid(sh.el, 'lg-save-recipe').checked = false;
    await fid(sh.el, 'lg-save').click();
    assert.equal(S().data.recipes[env.ids.oat].nutrition, null, '没勾：只记这一次');
    assert.equal(logOn(S(), TODAY)[0].kcal, 330);
    await fid(env.main, 'pd-eat-' + env.ids.pOat).click();
    sh = env.sheet();
    await type(fid(sh.el, 'lg-kcal'), '320');
    await type(fid(sh.el, 'lg-protein'), '12.5');
    await fid(sh.el, 'lg-save').click();
    assert.deepEqual(S().data.recipes[env.ids.oat].nutrition, { kcal: 320, protein: 12.5, carbs: null, fat: null });
    assert.equal(foodOf(S(), '燕麦粥'), null, '从食谱记的不进常吃的');
    await fid(env.main, 'pd-eat-' + env.ids.pOat).click();
    assert.equal(fid(env.sheet().el, 'lg-kcal').value, '320', '下次直接带上');
    assert.equal(byCls(env.sheet().el, 'lg-save-to').hidden, true);
  } finally { env.done(); }
});

test('记一样：框空着列常吃的（记得多的在前）；打字联想常吃的和食谱；点常吃的填好名字和营养，−/+ 每次半份；点食谱选上、「换一个」', async () => {
  const env = setup();
  try {
    const main = env.mount(planView, { name: 'plan' });
    await fid(dayEl(main, TODAY), 'lg-add-' + TODAY).click();
    const sh = env.sheet();
    const opts = () => allCls(sh.el, 'dish-opt').map(b => byCls(b, 'dish-opt-name').textContent);
    assert.equal(byCls(sh.el, 'sug-h').textContent, '常吃的');
    assert.deepEqual(opts(), ['拿铁', '牛肉面'], '拿铁记了两次');
    assert.equal(byCls(allCls(sh.el, 'dish-opt')[1], 'dish-opt-meta').textContent, '650\u00a0千卡 · 蛋白质\u00a032\u00a0g');
    await type(fid(sh.el, 'lg-q'), '牛');
    assert.deepEqual(opts(), ['牛肉面', '燕麦粥'], '食谱也搜（燕麦粥用到牛奶）');
    assert.deepEqual(allCls(sh.el, 'sug-h').map(x => x.textContent), ['常吃的', '食谱']);
    // 点常吃的：名字和每份营养填好，联想收起来
    await find(sh.el, el => el.tag === 'button' && el.dataset.fid && el.dataset.fid.startsWith('lg-f-')).click();
    assert.deepEqual([fid(sh.el, 'lg-q').value, fid(sh.el, 'lg-kcal').value, fid(sh.el, 'lg-protein').value, fid(sh.el, 'lg-carbs').value], ['牛肉面', '650', '32', '']);
    assert.equal(byCls(sh.el, 'dish-results').hidden, true);
    assert.equal(env.doc.activeElement, fid(sh.el, 'lg-save'), '焦点给「添加」：不给份数框（iPhone 的数字键盘没有换行键、挡着「添加」）');
    assert.deepEqual(['lg-kcal', 'lg-protein'].map(f => fid(sh.el, f).attrs.inputmode), ['numeric', 'decimal'], '热量是整数的键盘');
    const inc = find(sh.el, el => el.attrs['aria-label'] === '多半份'), dec = find(sh.el, el => el.attrs['aria-label'] === '少半份');
    await inc.click(); await inc.click();
    assert.equal(fid(sh.el, 'lg-sv').value, '2');
    await dec.click();
    assert.equal(fid(sh.el, 'lg-sv').value, '1.5');
    await fid(sh.el, 'lg-save').click();
    const e = logOn(S(), TODAY)[0];
    assert.deepEqual([e.title, e.servings, e.kcal, e.protein, e.recipeId], ['牛肉面', 1.5, 975, 48, null]);
    assert.equal(foodOf(S(), '牛肉面').uses, 2, '又记了一次');
    // 从食谱选：选上、营养用食谱的；「换一个」回到搜索框、营养清空
    await fid(dayEl(env.main, TODAY), 'lg-add-' + TODAY).click();
    const s2 = env.sheet();
    await type(fid(s2.el, 'lg-q'), '红烧');
    await fid(s2.el, 'lg-r-' + env.ids.hsr).click();
    assert.equal(byCls(s2.el, 'dish-chosen-name').textContent, '红烧肉');
    assert.equal(fid(s2.el, 'lg-kcal').value, '620');
    await fid(s2.el, 'lg-change').click();
    assert.deepEqual([byCls(s2.el, 'dish-pick').hidden, fid(s2.el, 'lg-q').value, fid(s2.el, 'lg-kcal').value], [false, '', '']);
  } finally { env.done(); }
});

test('手动写：没写名字、写错的数标在那一格下面，面板不关；写好了添加，记进常吃的；写了东西再关先问', async () => {
  const env = setup();
  try {
    const main = env.mount(planView, { name: 'plan' });
    await fid(dayEl(main, TODAY), 'lg-add-' + TODAY).click();
    const sh = env.sheet();
    await fid(sh.el, 'lg-save').click();
    assert.equal(sh.open, true);
    assert.equal(errOf(fid(sh.el, 'lg-q')), '写一下吃了什么');
    await type(fid(sh.el, 'lg-q'), '酸奶');
    await type(fid(sh.el, 'lg-kcal'), '-5');
    assert.equal(errOf(fid(sh.el, 'lg-kcal')), '写一个数（不能是负数）', '打字时就标出来');
    await type(fid(sh.el, 'lg-fat'), '1000');
    assert.equal(errOf(fid(sh.el, 'lg-fat')), '最多 999 克');
    await fid(sh.el, 'lg-save').click();
    assert.equal(sh.open, true);
    assert.equal(logOn(S(), TODAY).length, 0);
    await type(fid(sh.el, 'lg-kcal'), '120');
    await type(fid(sh.el, 'lg-fat'), '3.5');
    // 关面板先问（写了东西）；继续编辑
    env.answer = false;
    sh.tryClose();
    await settle();
    assert.equal(sh.open, true);
    assert.equal(env.confirms.at(-1).danger, true);
    await fid(sh.el, 'lg-save').click();
    assert.equal(sh.open, false);
    assert.deepEqual(foodOf(S(), '酸奶').per, { kcal: 120, protein: null, carbs: null, fat: 3.5 });
  } finally { env.done(); }
});

test('改一条：框里是每份；只改份数，合计按比例变；挪到别的一顿说一句；删除不问、能撤销', async () => {
  const env = setup();
  try {
    let id = '';
    state.mutate(s => { id = addLogEntry(s, { date: TODAY, meal: 'lunch', title: '牛肉面', servings: '2', per: { kcal: '650', protein: '32' } }, now()).id; });
    const main = env.mount(planView, { name: 'plan' });
    await fid(dayEl(main, TODAY), 'lg-' + id).click();
    let sh = env.sheet();
    assert.equal(sh.title, '牛肉面');
    assert.deepEqual([fid(sh.el, 'lg-q').value, fid(sh.el, 'lg-sv').value, fid(sh.el, 'lg-kcal').value, fid(sh.el, 'lg-protein').value], ['牛肉面', '2', '650', '32']);
    assert.equal(byCls(sh.el, 'dish-results').hidden, true, '改的时候不联想');
    await type(fid(sh.el, 'lg-sv'), '1');
    fid(sh.el, 'lg-meal-dinner').click();
    await fid(sh.el, 'lg-save').click();
    assert.deepEqual([liveLog(S(), id).servings, liveLog(S(), id).kcal, liveLog(S(), id).protein, liveLog(S(), id).meal], [1, 650, 32, 'dinner']);
    assert.match(env.toasts.at(-1).msg, /^已挪到 .+的晚饭$/);
    await settle();
    await fid(dayEl(env.main, TODAY), 'lg-' + id).click();
    sh = env.sheet();
    await fid(sh.el, 'lg-del').click();
    assert.equal(sh.open, false);
    assert.equal(liveLog(S(), id), null);
    assert.equal(env.toasts.at(-1).msg, '已删除「牛肉面」');
    state.undo();
    assert.ok(liveLog(S(), id));
  } finally { env.done(); }
});

test('写的名字正好是常吃的（没点它）：自动填上记住的、改成别的名字就拿掉；直接添加记的是记住的数，常吃的不被冲掉；计划里只写一句的「吃了」也带上', async () => {
  const env = setup();
  try {
    const main = env.mount(planView, { name: 'plan' });
    await fid(dayEl(main, TODAY), 'lg-add-' + TODAY).click();
    let sh = env.sheet();
    await type(fid(sh.el, 'lg-q'), '拿');
    assert.equal(fid(sh.el, 'lg-kcal').value, '');
    await type(fid(sh.el, 'lg-q'), '拿铁');
    assert.equal(fid(sh.el, 'lg-kcal').value, '190', '写全了：填上记住的');
    await type(fid(sh.el, 'lg-q'), '拿铁大杯');
    assert.equal(fid(sh.el, 'lg-kcal').value, '', '改成别的名字、框没动过：拿掉');
    await type(fid(sh.el, 'lg-q'), '拿鐵');
    assert.equal(fid(sh.el, 'lg-kcal').value, '190', '简繁是同一样');
    await fid(sh.el, 'lg-save').click();
    assert.equal(sh.open, false);
    assert.deepEqual(logOn(S(), TODAY).map(e => [e.title, e.kcal]), [['拿鐵', 190]]);
    assert.deepEqual([foodOf(S(), '拿铁').per.kcal, foodOf(S(), '拿铁').uses], [190, 3]);
    // 自己先写了数：不盖掉写的
    await fid(dayEl(env.main, TODAY), 'lg-add-' + TODAY).click();
    sh = env.sheet();
    await type(fid(sh.el, 'lg-kcal'), '230');
    await type(fid(sh.el, 'lg-q'), '拿铁');
    assert.equal(fid(sh.el, 'lg-kcal').value, '230');
    sh.close();
    // 计划里只写一句的「出去吃」：第一次自己填，下一次「吃了」直接带上记住的，点「添加」就好
    let pid = '';
    state.mutate(s => { pid = addEntry(s, { date: TODAY, meal: 'lunch', title: '出去吃' }, now()).id; });
    await settle();
    await fid(dayEl(env.main, TODAY), 'pd-eat-' + pid).click();
    sh = env.sheet();
    assert.deepEqual([fid(sh.el, 'lg-q').value, fid(sh.el, 'lg-kcal').value], ['出去吃', '']);
    await type(fid(sh.el, 'lg-kcal'), '720');
    await type(fid(sh.el, 'lg-protein'), '30');
    await fid(sh.el, 'lg-save').click();
    await settle();
    await fid(dayEl(env.main, TODAY), 'pd-eat-' + pid).click();
    sh = env.sheet();
    assert.deepEqual([fid(sh.el, 'lg-kcal').value, fid(sh.el, 'lg-protein').value], ['720', '30'], '记住的带上');
    await fid(sh.el, 'lg-save').click();
    assert.deepEqual(logOn(S(), TODAY).filter(e => e.planId === pid).map(e => e.kcal), [720, 720]);
    assert.deepEqual([foodOf(S(), '出去吃').per.kcal, foodOf(S(), '出去吃').per.protein, foodOf(S(), '出去吃').uses], [720, 30, 2]);
    // 从记住的填好以后自己删掉一个数：就是删掉了（这一次和常吃的都没有蛋白质）
    await fid(dayEl(env.main, TODAY), 'pd-eat-' + pid).click();
    sh = env.sheet();
    await type(fid(sh.el, 'lg-protein'), '');
    await fid(sh.el, 'lg-save').click();
    assert.deepEqual([logOn(S(), TODAY).filter(e => e.planId === pid).at(-1).protein, foodOf(S(), '出去吃').per.protein], [null, null]);
  } finally { env.done(); }
});

test('改一条：只改了份数以后再只改脂肪，热量、蛋白质不变（框里的每份是四舍五入过的）；下面写的合计和存的一样', async () => {
  const env = setup();
  try {
    let id = '';
    state.mutate(s => { id = addLogEntry(s, { date: TODAY, meal: 'lunch', title: '包子', servings: '1.5', per: { kcal: '101', protein: '3.4' } }, now()).id; });
    const main = env.mount(planView, { name: 'plan' });
    const open = async () => { await fid(dayEl(env.main, TODAY), 'lg-' + id).click(); return env.sheet(); };
    let sh = await open();
    await type(fid(sh.el, 'lg-sv'), '2');
    await fid(sh.el, 'lg-save').click();
    assert.deepEqual([liveLog(S(), id).kcal, liveLog(S(), id).protein], [203, 6.8]);
    await settle();
    sh = await open();
    assert.equal(fid(sh.el, 'lg-kcal').value, '101.5', '框里是每份（203 ÷ 2）');
    await type(fid(sh.el, 'lg-fat'), '10');
    assert.equal(byCls(sh.el, 'lg-sum').textContent, '合计：203\u00a0千卡 · 蛋白质\u00a06.8\u00a0g · 脂肪\u00a020\u00a0g');
    await fid(sh.el, 'lg-save').click();
    assert.deepEqual(['kcal', 'protein', 'carbs', 'fat'].map(k => liveLog(S(), id)[k]), [203, 6.8, null, 20], '没动的不变');
    assert.deepEqual(foodOf(S(), '包子').per, { kcal: 101, protein: 3.4, carbs: null, fat: 10 }, '常吃的只改了脂肪');
    await settle();
    sh = await open();
    await type(fid(sh.el, 'lg-sv'), '3');
    assert.equal(byCls(sh.el, 'lg-sum').textContent, '合计：305\u00a0千卡 · 蛋白质\u00a010.2\u00a0g · 脂肪\u00a030\u00a0g');
    await fid(sh.el, 'lg-save').click();
    assert.deepEqual(['kcal', 'protein', 'fat'].map(k => liveLog(S(), id)[k]), [305, 10.2, 30], '存的就是写的合计');
  } finally { env.done(); }
});

test('编辑食谱的每人份营养：填了保存；写错标在那一格下面、焦点给它、不存；食谱页上一块「每人份营养」', async () => {
  const env = setup();
  try {
    let main = env.mount(editView, { name: 'recipeEdit', id: env.ids.oat }, { storage: env.storage });
    assert.equal(find(main, el => cls(el, 're-nut')).querySelector('h2').textContent, '每人份营养');
    assert.deepEqual(['kcal', 'protein', 'carbs', 'fat'].map(k => fid(main, 're-nut-' + k).value), ['', '', '', '']);
    assert.deepEqual(['re-nut-kcal', 're-nut-fat'].map(f => fid(main, f).attrs.inputmode), ['numeric', 'decimal'], '热量是整数的键盘（和面板、饮食目标一样）');
    await type(fid(main, 're-nut-kcal'), 'abc');
    await type(fid(main, 're-nut-fat'), '9');
    await fid(main, 're-save').click();
    await settle();
    assert.equal(errOf(fid(main, 're-nut-kcal')), '写一个数（不能是负数）');
    assert.equal(env.doc.activeElement, fid(main, 're-nut-kcal'));
    assert.equal(S().data.recipes[env.ids.oat].nutrition, null);
    await type(fid(main, 're-nut-kcal'), '330');
    assert.equal(errOf(fid(main, 're-nut-kcal')), null, '改了就不标了');
    await fid(main, 're-save').click();
    await settle();
    assert.deepEqual(S().data.recipes[env.ids.oat].nutrition, { kcal: 330, protein: null, carbs: null, fat: 9 });
    // 草稿里也记着（App 被关掉也不丢）
    main = env.mount(editView, { name: 'recipeEdit', id: env.ids.oat }, { storage: env.storage });
    await type(fid(main, 're-nut-protein'), '14');
    env.handle.flush();
    assert.equal(JSON.parse(env.storage.getItem(editView.DRAFT_PREFIX + env.ids.oat)).w.nutrition.protein, '14');
    // 食谱页
    main = env.mount(recipeView, { name: 'recipe', id: env.ids.hsr });
    const sec = find(main, el => el.tag === 'section' && el.querySelector('h2') && el.querySelector('h2').textContent === '每人份营养');
    assert.equal(byCls(sec, 'rcp-nut').textContent, '620\u00a0千卡 · 蛋白质\u00a022\u00a0g · 碳水\u00a018\u00a0g · 脂肪\u00a050\u00a0g');
    assert.deepEqual(allCls(byCls(sec, 'rcp-nut'), 'lg-nw').map(x => x.textContent), ['620\u00a0千卡', '蛋白质\u00a022\u00a0g', '碳水\u00a018\u00a0g', '脂肪\u00a050\u00a0g'],
      '每一样不折开（「脂肪」不会折成「脂 / 肪」），放不下时在「 · 」那里折');
    main = env.mount(recipeView, { name: 'recipe', id: env.ids.oat });
    assert.ok(byCls(main, 'rcp-nut'));
  } finally { env.done(); }
});

test('设置 → 饮食目标：一格写完就存（离开输入框），写错标出来不存，0 是不设；别的设备改了只换没在打字的格；设置首页下面写着设了多少', async () => {
  const env = setup();
  try {
    let main = env.mount(settingsView, { name: 'settings', sub: 'goals' });
    assert.equal(main.querySelector('h1').textContent, '饮食目标');
    const kcal = fid(main, 'gl-kcal'), fat = fid(main, 'gl-fat');
    assert.equal(kcal.value, '');
    kcal.value = '1800'; await kcal.fire('change');
    assert.deepEqual(goalsOf(S()), { kcal: 1800, protein: null, carbs: null, fat: null });
    assert.equal(byCls(main, 'gl-status').textContent, '已保存');
    fat.value = '-1'; await fat.fire('change');
    assert.equal(errOf(fat), '写一个数（不能是负数）');
    assert.equal(goalsOf(S()).fat, null);
    fat.value = '60.25'; await fat.fire('change');
    assert.deepEqual([goalsOf(S()).fat, fat.value, errOf(fat)], [60.3, '60.3', null]);
    kcal.value = '0'; await kcal.fire('change');
    assert.deepEqual([goalsOf(S()).kcal, kcal.value], [null, ''], '0 是不设');
    // 别的设备同步来的
    fat.focus();
    state.mutate(s => setGoals(s, { kcal: '2000', fat: '70' }, now()));
    await settle();
    assert.deepEqual([kcal.value, fat.value], ['2000', '60.3'], '正在打字的那一格不冲掉');
    // 设置首页
    main = env.mount(settingsView, { name: 'settings' });
    const sec = main.querySelector('#set-food');
    assert.equal(sec.querySelector('h2').textContent, '饮食');
    assert.equal(byCls(sec, 'group-foot').textContent, '每天 2000\u00a0千卡 · 脂肪\u00a070\u00a0g');
  } finally { env.done(); }
});

test('一周的平均：不算还没过完的今天（记了就写「不算今天」）；过去的一周照常；「 · 」的点和前面连着（第 16 步检查）', () => {
  const env = setup();
  try {
    const last = addDays(MON, -7);
    state.mutate(s => {
      addLogEntry(s, { date: last, title: 'a', per: { kcal: '1500' } }, now());
      addLogEntry(s, { date: addDays(last, 2), title: 'b', per: { kcal: '2100' } }, now());
      addLogEntry(s, { date: TODAY, title: '早饭', per: { kcal: '400' } }, now());
      setGoals(s, { kcal: '1800' }, now());
    });
    const past = weekAvgLine({ state: S() }, last);
    assert.equal(past.textContent, '这一周平均每天 1800\u00a0千卡（记了 2 天） · 目标 1800\u00a0千卡');
    assert.deepEqual(byCls(past, 'lg-week-goal').children.map(x => x.textContent), [' ·', ' ', '目标 1800\u00a0千卡'], '点和前面的空格不折开');
    assert.equal(weekAvgLine({ state: S() }, TODAY), null, '这一周只有今天记了');
    if (TODAY !== MON) {
      state.mutate(s => addLogEntry(s, { date: MON, title: 'c', per: { kcal: '1600' } }, now()));
      assert.equal(weekAvgLine({ state: S() }, TODAY).textContent, '这一周平均每天 1600\u00a0千卡（记了 1 天，不算今天） · 目标 1800\u00a0千卡', '今天的 400 不拉低平均');
    }
  } finally { env.done(); }
});

test('记饮食的面板（第 16 步检查）：改一条估算记下的写着是估算的；常吃的是钟表不是对勾；估算的食谱后面那一句折行、不截掉', async () => {
  const env = setup();
  try {
    let rid = '';
    state.mutate(s => {
      rid = /** @type {any} */ (saveRecipe(s, null, { name: '鱼豆腐炒蛋', servings: 2, ings: [{ name: '鸡蛋', qty: 4, unit: '个' }, { name: '鱼豆腐', qty: 6, unit: '个' }] }, now())).recipe.id;
      addLogEntry(s, { date: TODAY, meal: 'lunch', title: '鱼豆腐炒蛋', recipeId: rid, per: { kcal: '143', protein: '12.6' }, estimated: true }, now());
    });
    const est = logOn(S(), TODAY).find(e => e.recipeId === rid);
    assert.equal(est.estimated, true);
    const main = env.mount(planView, { name: 'plan' });
    await fid(dayEl(main, TODAY), 'lg-' + est.id).click();
    let sh = env.sheet();
    assert.equal(byCls(sh.el, 'lg-was-est').textContent, '记的时候是按食材估算的（约），改了就算自己填的。');
    sh.close();
    // 自己填的那一条没有这一句
    state.mutate(s => addLogEntry(s, { date: TODAY, meal: 'dinner', title: '拿铁', per: { kcal: '190' } }, now()));
    await settle();
    const own = logOn(S(), TODAY).find(e => e.title === '拿铁');
    await fid(dayEl(env.main, TODAY), 'lg-' + own.id).click();
    assert.ok(!byCls(env.sheet().el, 'lg-was-est'));
    env.sheet().close();
    // 新记一样：常吃的用钟表；打字搜到估算的食谱，营养后面的「（估算，1 样没算进去）」不被省略号截掉
    await fid(dayEl(env.main, TODAY), 'lg-add-' + TODAY).click();
    sh = env.sheet();
    const first = allCls(sh.el, 'dish-opt')[0];
    assert.ok(byCls(first, 'ic-history') && !byCls(first, 'ic-check'), '常吃的不是一列对勾');
    await type(fid(sh.el, 'lg-q'), '鱼豆腐');
    const r = find(sh.el, el => el.dataset && el.dataset.fid === 'lg-r-' + rid), meta = byCls(r, 'dish-opt-meta');
    assert.ok(cls(meta, 'wrap'));
    assert.match(meta.textContent, /^约\u00a0\d+\u00a0千卡 · .*（估算，1 样没算进去）$/);
  } finally { env.done(); }
});

test('英文界面、繁体界面：千卡 / 大卡、份数的单复数', async () => {
  for (const [lang, kcal, sv] of [['en', '1300\u00a0kcal', '2 servings · P\u00a064\u00a0g'], ['zh-Hant-TW', '1300\u00a0大卡', '2 份 · 蛋白\u00a064\u00a0g']]) {
    const env = setup({ lang });
    try {
      state.mutate(s => addLogEntry(s, { date: TODAY, meal: 'lunch', title: '牛肉面', servings: '2', per: { kcal: '650', protein: '32' } }, now()));
      const main = env.mount(planView, { name: 'plan' });
      const [row] = logRows(dayEl(main, TODAY));
      assert.deepEqual([row[2], row[3]], [sv, kcal], lang);
    } finally { env.done(); }
  }
});
