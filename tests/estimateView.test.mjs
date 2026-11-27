// 自动估算的页面（第 15 步，假 DOM + 真的 state.js，只用内存）：食谱页「每人份约 …（估算，n 样没算进去）」、估算的明细（没算进去的、算进去的、可选的、
// 来源和准确度）、「指定成…」（搜营养表、点一样）、「自己填」（每 100 g、一个多重、写错标出来、表里没有的要填热量）、「用回自动认的」、撤销后明细跟着变、
// 「用手动的」；编辑食谱里「按食材估算」（跟着食材变、「填进去」）；日历里「吃了」没填每人份的食谱用估算的（约、没改过不记到食谱上）；英文、繁体界面。全是编的数据
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as recipeView from '../src/views/recipe.js';
import * as editView from '../src/views/recipeEdit.js';
import * as planView from '../src/views/plan.js';
import * as state from '../src/core/state.js';
import { saveRecipe } from '../src/core/recipes.js';
import { addEntry } from '../src/core/plan.js';
import { logOn } from '../src/core/log.js';
import { foodId, liveFood } from '../src/core/foods.js';
import { estimateRecipe } from '../src/core/estimate.js';
import { findFood } from '../src/core/nutrition.js';
import { todayDay } from '../src/core/dates.js';
import { setLang, t } from '../src/i18n.js';
import { Element, all, find, installDom, fakeStorage } from './helpers/dom.mjs';

const settle = async (n = 5) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)); };
const cls = (el, c) => (el.className || el.attrs.class || '').split(' ').includes(c);
const byCls = (root, c) => find(root, el => cls(el, c));
const allCls = (root, c) => all(root, el => cls(el, c));
const fid = (root, f) => root.querySelector(`[data-fid="${f}"]`);
const type = async (el, text) => { el.focus(); el.value = text; await el.fire('input'); };
const S = () => state.getState();
const TODAY = todayDay();
let clock = Date.now() - 3600_000;
const now = () => (clock += 1000);
const food = (n) => /** @type {any} */ (findFood(n));
const NB = ' ';

/** 红烧肉（2 人份，没填每人份营养：五花肉、生抽算得出来，油没写用量，鱼豆腐表里没有，鸡腿不知道一个多重，香菜可选）；番茄炒蛋（填了的）；今天晚饭红烧肉 */
function seed(s) {
  const hsr = saveRecipe(s, null, { name: '红烧肉', servings: '2', ings: [
    { name: '五花肉', qty: '500', unit: 'g' }, { name: '生抽', qty: '2', unit: '勺' }, { name: '油' }, { name: '鱼豆腐', qty: '200', unit: 'g' },
    { name: '鸡腿', qty: '2', unit: '个' }, { name: '香菜', qty: '1', unit: '把', optional: true }] }, now()).recipe;
  const egg = saveRecipe(s, null, { name: '番茄炒蛋', servings: '2', ings: [{ name: '鸡蛋', qty: '3' }], nutrition: { kcal: '260', protein: '14' } }, now()).id;
  const p = addEntry(s, { date: TODAY, meal: 'dinner', recipeId: hsr.id, servings: '2' }, now()).id;
  const key = Object.fromEntries(hsr.ings.map(g => [g.name, g.key]));
  return { hsr: hsr.id, egg, p, key };
}

/** 假 ctx（照 app.js，和 logView.test.mjs 的一样）：面板记下内容和按钮，不开真的 <dialog>；数据变了在微任务里调页面的 onChange */
function setup({ lang = 'zh-Hans' } = {}) {
  const dom = installDom();
  setLang(lang);
  state.load({ storage: null });
  planView.resetPlanView();
  let ids = {};
  state.mutate(s => { ids = seed(s); });
  const env = { ...dom, ids, toasts: [], navs: [], sheets: [], handle: null, storage: fakeStorage() };
  const ctx = env.ctx = {
    t, lang: () => lang, layout: () => 'phone', build: 'picknest-test',
    get state() { return S(); }, get local() { return state.getLocal(); },
    setLocal: (p) => state.setLocal(p),
    mutate: (fn, o) => { const v = state.editVersion(); const r = state.mutate(fn, o); if (o && o.undoLabel && state.editVersion() !== v) env.toasts.push({ msg: o.undoLabel, undo: true }); return r; },
    toast: (msg, o = {}) => env.toasts.push({ msg, ...o }),
    confirm: async () => true,
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
const errOf = (input) => { let p = input.parent; while (p && !cls(p, 'f-row')) p = p.parent; const e = p && byCls(p, 'f-err'); return e && !e.hidden ? e.textContent : null; };
/** 明细里一节的每一行：[名字, 用量, 约多少千卡, 下面那行小字] */
const rowsIn = (sh, c) => { const sec = byCls(sh.el, c); return sec ? allCls(sec, 'est-line').map(li => [byCls(li, 'est-name').textContent, byCls(li, 'est-qty')?.textContent ?? '',
  byCls(li, 'est-kcal')?.textContent ?? '', byCls(li, 'est-why')?.textContent ?? '']) : []; };
const perOf = (id) => estimateRecipe(S(), S().data.recipes[id]).perServing;
const key = (el, k) => { for (const fn of el.events.keydown || []) fn({ key: k, target: el, preventDefault() {} }); };

test('食谱页：没填每人份的写「每人份约 …（估算，3 样没算进去）」，点了看明细（没算进去的、算进去的、可选的，原因、多少克、按什么算）；填了的照写手动的', async () => {
  const env = setup();
  try {
    let main = env.mount(recipeView, { name: 'recipe', id: env.ids.hsr });
    const per = perOf(env.ids.hsr);
    const btn = fid(main, 'rcp-est');
    assert.equal(byCls(btn, 'rcp-est-main').textContent, `每人份约 ${per.kcal}${NB}千卡 · 蛋白质${NB}${per.protein}${NB}g · 碳水${NB}${per.carbs}${NB}g · 脂肪${NB}${per.fat}${NB}g`);
    assert.equal(byCls(btn, 'rcp-est-note').textContent, '（估算，3 样没算进去）');
    assert.equal(byCls(btn, 'sr-only').textContent, '看估算的明细');
    assert.equal(btn.parent.querySelector('h2').textContent, '每人份营养');
    await btn.click();
    const sh = env.sheet();
    assert.equal(sh.title, '估算的明细');
    const total = estimateRecipe(S(), S().data.recipes[env.ids.hsr]).total;
    assert.equal(byCls(sh.el, 'est-total').textContent, `2 人份一共约 ${total.kcal}${NB}千卡 · 蛋白质${NB}${total.protein}${NB}g · 碳水${NB}${total.carbs}${NB}g · 脂肪${NB}${total.fat}${NB}g`);
    assert.equal(byCls(byCls(sh.el, 'est-missing'), 'group-h').textContent, '没算进去的（3 样）');
    assert.deepEqual(rowsIn(sh, 'est-missing'), [
      ['油', '', '', '没写用量（适量、少许）：在「编辑」里写上就能算 · 按表里的「油」'],   // 写的名字对上的那个（不是表里第一个名字「植物油」）
      ['鱼豆腐', '200 g', '', '营养表里没有这一样'],
      ['鸡腿', '2 个', '', '不知道一个有多重 · 按表里的「鸡腿」']]);
    assert.deepEqual(rowsIn(sh, 'est-counted'), [
      ['五花肉', '500 g', `约${NB}${food('五花肉').per100.kcal * 5}${NB}千卡`, '按表里的「五花肉」'],   // 写的就是克：不再写一遍
      ['生抽', '2 勺', `约${NB}${Math.round(food('生抽').per100.kcal * 2 * food('生抽').grams.勺 / 100)}${NB}千卡`, `${2 * food('生抽').grams.勺}${NB}g · 按表里的「生抽」`]]);
    assert.deepEqual(rowsIn(sh, 'est-optional'), [['香菜', '1 把', '', '']]);
    assert.ok(!fid(sh.el, 'est-pick-' + env.ids.key.油), '没写用量的不用指定（写上用量才算）');
    assert.ok(fid(sh.el, 'est-pick-' + env.ids.key.鱼豆腐) && fid(sh.el, 'est-own-' + env.ids.key.鸡腿) && fid(sh.el, 'est-pick-' + env.ids.key.五花肉), '认得的也能改');
    assert.equal(fid(sh.el, 'est-pick-' + env.ids.key.鱼豆腐).attrs['aria-label'], '把「鱼豆腐」指定成营养表里的一样');
    assert.match(byCls(sh.el, 'est-caveat').textContent, /20–30%/);
    assert.equal(byCls(sh.el, 'est-source').textContent, '营养数据：U.S. Department of Agriculture, Agricultural Research Service. FoodData Central (SR Legacy, 2018).');
    // 填了每人份的：照写手动的，不显示估算
    main = env.mount(recipeView, { name: 'recipe', id: env.ids.egg });
    assert.equal(fid(main, 'rcp-est'), null);
    assert.equal(byCls(main, 'rcp-nut').textContent, `260${NB}千卡 · 蛋白质${NB}14${NB}g`);
  } finally { env.done(); }
});

test('指定成…：搜营养表（先写着这一样的名字）、点一样就存，所有食谱都认；明细和食谱页跟着变；撤销以后也跟着变', async () => {
  const env = setup();
  try {
    const main = env.mount(recipeView, { name: 'recipe', id: env.ids.hsr });
    await fid(main, 'rcp-est').click();
    const sh = env.sheet();
    await fid(sh.el, 'est-pick-' + env.ids.key.鱼豆腐).click();
    const pk = env.sheet();
    assert.equal(pk.title, '「鱼豆腐」按哪一样算');
    assert.equal(fid(pk.el, 'est-q').value, '鱼豆腐');
    assert.equal(env.doc.activeElement, fid(pk.el, 'est-q'));
    const hits = () => allCls(pk.el, 'dish-opt').map(b => byCls(b, 'dish-opt-name').textContent);
    assert.deepEqual(hits(), ['豆腐'], '鱼豆腐里有「豆腐」');
    assert.equal(byCls(pk.el, 'dish-opt-meta').textContent, `每 100${NB}g：${food('豆腐').per100.kcal}${NB}千卡 · 蛋白质${NB}${food('豆腐').per100.protein}${NB}g · 碳水${NB}${food('豆腐').per100.carbs}${NB}g · 脂肪${NB}${food('豆腐').per100.fat}${NB}g`);
    await type(fid(pk.el, 'est-q'), '嫩豆');
    assert.deepEqual(hits(), ['嫩豆腐']);
    await type(fid(pk.el, 'est-q'), '没有这种东西');
    assert.deepEqual([hits(), byCls(pk.el, 'est-nohits').hidden], [[], false]);
    await type(fid(pk.el, 'est-q'), '豆腐');
    await fid(pk.el, 'est-hit-' + food('豆腐').id).click();
    assert.equal(pk.open, false);
    assert.deepEqual(env.toasts.at(-1), { msg: '「鱼豆腐」按「豆腐」算', undo: true });
    assert.deepEqual([liveFood(S(), foodId('鱼豆腐')).kind, liveFood(S(), foodId('鱼豆腐')).ref], ['ingredient', String(food('豆腐').id)]);
    assert.equal(rowsIn(sh, 'est-missing').length, 2, '明细马上重画');
    assert.deepEqual(rowsIn(sh, 'est-counted').find(r => r[0] === '鱼豆腐'), ['鱼豆腐', '200 g', `约${NB}${food('豆腐').per100.kcal * 2}${NB}千卡`, '指定成「豆腐」']);
    assert.ok(fid(sh.el, 'est-auto-' + env.ids.key.鱼豆腐), '自己说过的能「用回自动认的」');
    await settle();
    assert.equal(byCls(fid(main, 'rcp-est'), 'rcp-est-note').textContent, '（估算，2 样没算进去）', '食谱页跟着变');
    // 撤销：页面重画，开着的明细也跟着变
    state.undo();
    await settle();
    assert.equal(rowsIn(sh, 'est-missing').length, 3);
    assert.equal(byCls(fid(main, 'rcp-est'), 'rcp-est-note').textContent, '（估算，3 样没算进去）');
  } finally { env.done(); }
});

test('自己填：一个多重（写错标出来）、每 100 g（表里没有的至少填热量）；用回自动认的；关面板时改了的先问', async () => {
  const env = setup();
  try {
    env.mount(recipeView, { name: 'recipe', id: env.ids.hsr });
    await fid(env.main, 'rcp-est').click();
    const sh = env.sheet();
    // 鸡腿：表里有营养，不知道一个多重
    await fid(sh.el, 'est-own-' + env.ids.key.鸡腿).click();
    let own = env.sheet();
    assert.equal(own.title, '自己填「鸡腿」');
    assert.equal(byCls(own.el, 'est-own').querySelector('h3').textContent, `每 100${NB}g 的营养`);
    assert.equal(fid(own.el, 'est-own-kcal').attrs.placeholder ?? fid(own.el, 'est-own-kcal').placeholder, String(food('鸡腿').per100.kcal), '格子里淡淡写着表里的数');
    const gIn = fid(own.el, 'est-own-grams');
    assert.equal(find(own.el, el => cls(el, 'f-label') && el.attrs.for === gIn.id)?.textContent ?? byCls(gIn.parent, 'f-label').textContent, '一个有多重（克）');
    assert.match(byCls(own.el, 'est-own').textContent, /没填的那几格照表里的「鸡腿」算/);
    await type(gIn, '0');
    await fid(own.el, 'est-own-save').click();
    assert.equal(errOf(gIn), '写一个大于 0 的数（最多 10000 克）');
    assert.equal(own.open, true);
    await type(gIn, '150');
    await fid(own.el, 'est-own-save').click();
    assert.equal(own.open, false);
    assert.deepEqual(liveFood(S(), foodId('鸡腿')).grams, { 个: 150 });
    assert.deepEqual(env.toasts.at(-1), { msg: '已保存「鸡腿」的营养', undo: true });
    assert.deepEqual(rowsIn(sh, 'est-counted').find(r => r[0] === '鸡腿')[3], `300${NB}g · 一个 150${NB}g 是自己填的 · 按表里的「鸡腿」`);
    // 鱼豆腐：表里没有，只能自己填每 100 g；一个数也没填存不了
    await fid(sh.el, 'est-own-' + env.ids.key.鱼豆腐).click();
    own = env.sheet();
    assert.equal(fid(own.el, 'est-own-grams'), null, '写的是克：不用问一个多重');
    await fid(own.el, 'est-own-save').click();
    assert.equal(errOf(fid(own.el, 'est-own-kcal')), '表里没有这一样，至少填上热量');
    await type(fid(own.el, 'est-own-kcal'), '1000');
    await fid(own.el, 'est-own-save').click();
    assert.equal(errOf(fid(own.el, 'est-own-kcal')), '每 100 g 最多 900 千卡');
    await type(fid(own.el, 'est-own-kcal'), '200');
    await type(fid(own.el, 'est-own-protein'), '12');
    await fid(own.el, 'est-own-save').click();
    assert.equal(own.open, false);
    assert.deepEqual(rowsIn(sh, 'est-counted').find(r => r[0] === '鱼豆腐'), ['鱼豆腐', '200 g', `约${NB}400${NB}千卡`, `按自己填的每 100${NB}g · 没填碳水、脂肪，合计里没算`],
      '表里没有的：没填的那几样写出来');
    assert.equal(rowsIn(sh, 'est-missing').length, 1);
    // 再打开：框里是自己填的；改了再关先问
    await fid(sh.el, 'est-own-' + env.ids.key.鱼豆腐).click();
    own = env.sheet();
    assert.deepEqual(['kcal', 'protein', 'carbs'].map(k => fid(own.el, 'est-own-' + k).value), ['200', '12', '']);
    await type(fid(own.el, 'est-own-kcal'), '210');
    own.tryClose();
    await settle();
    assert.equal(own.open, false, '确认放弃以后关上（假的确认框答应了）');
    assert.equal(liveFood(S(), foodId('鱼豆腐')).per.kcal, 200, '没存');
    // 用回自动认的：又是表里没有
    await fid(sh.el, 'est-auto-' + env.ids.key.鱼豆腐).click();
    assert.deepEqual(env.toasts.at(-1), { msg: '「鱼豆腐」用回自动认的了', undo: true });
    assert.equal(liveFood(S(), foodId('鱼豆腐')), null);
    assert.equal(rowsIn(sh, 'est-missing').length, 2);
  } finally { env.done(); }
});

test('用手动的：估算抄成手动的每人份营养（能撤销），食谱页改成照写手动的', async () => {
  const env = setup();
  try {
    const main = env.mount(recipeView, { name: 'recipe', id: env.ids.hsr });
    const per = perOf(env.ids.hsr);
    await fid(main, 'rcp-est').click();
    const sh = env.sheet();
    assert.match(byCls(sh.el, 'est-manual').textContent, /在「编辑」里可以改/);
    await fid(sh.el, 'est-manual').click();
    assert.equal(sh.open, false);
    assert.deepEqual(S().data.recipes[env.ids.hsr].nutrition, per);
    assert.deepEqual(env.toasts.at(-1), { msg: '已经抄成手动的每人份营养', undo: true });
    await settle();
    assert.equal(fid(main, 'rcp-est'), null);
    assert.ok(byCls(main, 'rcp-nut'));
    state.undo();
    await settle();
    assert.equal(S().data.recipes[env.ids.hsr].nutrition, null);
    assert.ok(fid(main, 'rcp-est'));
  } finally { env.done(); }
});

test('编辑食谱：「按食材估算」跟着这一页的食材变（没保存的也算），「填进去」填进四格（保存才算），「明细」里没有「用手动的」', async () => {
  const env = setup();
  try {
    const main = env.mount(editView, { name: 'recipeEdit', id: env.ids.hsr }, { storage: env.storage });
    const box = byCls(main, 're-est');
    assert.equal(box.hidden, false);
    assert.equal(byCls(box, 're-est-label').textContent, '按食材估算');
    const per = perOf(env.ids.hsr);
    assert.equal(byCls(box, 're-est-line').textContent, `每人份约 ${per.kcal}${NB}千卡 · 蛋白质${NB}${per.protein}${NB}g · 碳水${NB}${per.carbs}${NB}g · 脂肪${NB}${per.fat}${NB}g（估算，3 样没算进去）`);
    // 改五花肉的用量：马上重算
    await type(fid(main, 're-qty-' + env.ids.key.五花肉), '250');
    const half = estimateRecipe(S(), { servings: 2, ings: [{ name: '五花肉', qty: 250, unit: 'g' }, { name: '生抽', qty: 2, unit: '勺' }] }).perServing;
    assert.match(byCls(box, 're-est-line').textContent, new RegExp(`^每人份约 ${half.kcal}${NB}千卡`));
    assert.equal(S().data.recipes[env.ids.hsr].ings.find(g => g.name === '五花肉').qty, 500, '没保存');
    await fid(main, 're-est-fill').click();
    assert.deepEqual(['kcal', 'protein', 'carbs', 'fat'].map(k => fid(main, 're-nut-' + k).value), [half.kcal, half.protein, half.carbs, half.fat].map(String));
    assert.equal(S().data.recipes[env.ids.hsr].nutrition, null, '保存才算');
    await fid(main, 're-est-open').click();
    const sh = env.sheet();
    assert.equal(sh.title, '估算的明细');
    assert.equal(fid(sh.el, 'est-manual'), null, '编辑页有自己的「填进去」');
    assert.equal(rowsIn(sh, 'est-counted')[0][1], '250 g', '按这一页现在的食材');
    await fid(main, 're-save').click();
    await settle();
    assert.deepEqual(S().data.recipes[env.ids.hsr].nutrition, half);
  } finally { env.done(); }
});

test('日历里「吃了」没填每人份的食谱：框里是估算的、说一句，没有「也记到食谱里」；直接添加记成估算的（约），食谱不变；改了数又有「也记到食谱里」', async () => {
  const env = setup();
  try {
    const main = env.mount(planView, { name: 'plan' });
    const per = perOf(env.ids.hsr);
    await fid(main, 'pd-eat-' + env.ids.p).click();
    let sh = env.sheet();
    assert.deepEqual(['kcal', 'protein', 'fat'].map(k => fid(sh.el, 'lg-' + k).value), [per.kcal, per.protein, per.fat].map(String));
    const note = byCls(sh.el, 'lg-recipe-empty');
    assert.deepEqual([note.hidden, note.textContent, cls(note, 'est')], [false, '这道食谱没填每人份营养，下面是按食材估算的（约），可以改。3 样没算进去：油、鱼豆腐、鸡腿。', true],
      '没算进去的写上是哪几样');
    assert.equal(byCls(sh.el, 'lg-save-to').hidden, true);
    await fid(sh.el, 'lg-save').click();
    const e = logOn(S(), TODAY)[0];
    assert.deepEqual([e.kcal, e.estimated], [per.kcal, true]);
    assert.equal(S().data.recipes[env.ids.hsr].nutrition, null);
    await settle();
    assert.equal(byCls(fid(env.main, 'lg-' + e.id), 'lg-kcal').textContent, `约${NB}${per.kcal}${NB}千卡`, '日历上写「约」');
    // 再记一次，改了热量：自己填的，「也记到食谱里」回来了（默认勾着）
    await fid(env.main, 'pd-eat-' + env.ids.p).click();
    sh = env.sheet();
    await type(fid(sh.el, 'lg-kcal'), '800');
    assert.equal(byCls(sh.el, 'lg-save-to').hidden, false);
    await type(fid(sh.el, 'lg-kcal'), String(per.kcal));
    assert.equal(byCls(sh.el, 'lg-save-to').hidden, true, '改回估算的数：又是估算的');
    await type(fid(sh.el, 'lg-kcal'), '800');
    await fid(sh.el, 'lg-save').click();
    const e2 = logOn(S(), TODAY).find(x => x.kcal === 800);
    assert.equal(e2.estimated, false);
    assert.equal(S().data.recipes[env.ids.hsr].nutrition.kcal, 800);
  } finally { env.done(); }
});

test('记一样吃的：联想里的食谱写着每人份（没填的是估算的「约」）', async () => {
  const env = setup();
  try {
    const main = env.mount(planView, { name: 'plan' });
    await fid(main, 'lg-add-' + TODAY).click();
    const sh = env.sheet();
    await type(fid(sh.el, 'lg-q'), '红烧');
    const per = perOf(env.ids.hsr);
    const opt = fid(sh.el, 'lg-r-' + env.ids.hsr);
    assert.match(byCls(opt, 'dish-opt-meta').textContent, new RegExp(`^约${NB}${per.kcal}${NB}千卡.*（估算，3 样没算进去）$`));
    await opt.click();
    assert.equal(fid(sh.el, 'lg-kcal').value, String(per.kcal));
    await fid(sh.el, 'lg-save').click();
    assert.equal(logOn(S(), TODAY)[0].estimated, true);
  } finally { env.done(); }
});

test('英文界面、繁体界面：每人份的那一行、明细里表里的名字（英文名 / 繁体的写法）', async () => {
  let env = setup({ lang: 'en' });
  try {
    const main = env.mount(recipeView, { name: 'recipe', id: env.ids.hsr });
    const per = perOf(env.ids.hsr);
    assert.equal(byCls(fid(main, 'rcp-est'), 'rcp-est-main').textContent, `Per serving: ~${per.kcal}${NB}kcal · Protein${NB}${per.protein}${NB}g · Carbs${NB}${per.carbs}${NB}g · Fat${NB}${per.fat}${NB}g`);
    assert.equal(byCls(fid(main, 'rcp-est'), 'rcp-est-note').textContent, ' (estimate; 3 items not counted)');
    await fid(main, 'rcp-est').click();
    const sh = env.sheet();
    assert.deepEqual(rowsIn(sh, 'est-missing').map(r => r[3]), ['No amount (to taste). Add one in Edit to count it · Matched “vegetable oil”', 'Not in the nutrition table',
      'Don’t know what 1 个 weighs · Matched “chicken drumstick”'.replace('chicken drumstick', food('鸡腿').en[0])]);
    assert.equal(byCls(byCls(sh.el, 'est-missing'), 'group-h').textContent, 'Not Counted (3)');
  } finally { env.done(); }
  env = setup({ lang: 'zh-Hant-TW' });
  try {
    const main = env.mount(recipeView, { name: 'recipe', id: env.ids.hsr });
    assert.equal(byCls(fid(main, 'rcp-est'), 'rcp-est-note').textContent, '（估算，3 項沒算進去）');
    await fid(main, 'rcp-est').click();
    assert.equal(rowsIn(env.sheet(), 'est-missing')[2][3], '不知道一个有多重 · 依表裡的「雞腿」', '表裡的名字按字轉成繁體；用戶寫的單位照原樣');
  } finally { env.done(); }
});

test('没写几人份的（一整道）：标题写「营养（整道菜）」，不给抄成每人份；编辑页不「填进去」；记饮食时说是一整道、哪几样没算进去', async () => {
  const env = setup();
  try {
    let pot = '', p = '';
    state.mutate(s => {
      pot = saveRecipe(s, null, { name: '卤鸡腿', ings: [{ name: '鸡腿', qty: '4', unit: '个' }, { name: '生抽', qty: '2', unit: '勺' }, { name: '冰糖', qty: '10', unit: 'g' }] }, now()).id;
      p = addEntry(s, { date: TODAY, meal: 'lunch', recipeId: pot }, now()).id;
    });
    const per = perOf(pot);
    const main = env.mount(recipeView, { name: 'recipe', id: pot });
    const btn = fid(main, 'rcp-est');
    assert.equal(btn.parent.querySelector('h2').textContent, '营养（整道菜）');
    assert.match(byCls(btn, 'rcp-est-main').textContent, /^整道菜约 /);
    await btn.click();
    const sh = env.sheet();
    assert.equal(fid(sh.el, 'est-manual'), null, '一整道不抄成每人份');
    assert.match(byCls(sh.el, 'est-whole').textContent, /写上几人份/);
    sh.close();
    // 编辑页：没有「填进去」，说一句
    const ed = env.mount(editView, { name: 'recipeEdit', id: pot }, { storage: env.storage });
    assert.equal(fid(ed, 're-est-fill').hidden, true);
    assert.deepEqual([byCls(ed, 're-est-why').hidden, byCls(ed, 're-est-why').textContent], [false, t('est.fillWhole')]);
    await type(fid(ed, 're-sv'), '2');
    assert.deepEqual([fid(ed, 're-est-fill').hidden, byCls(ed, 're-est-why').hidden], [false, true], '写上几人份就能填');
    // 日历里「吃了」：框里是一整道的估算，说是一整道、鸡腿没算进去
    const cal = env.mount(planView, { name: 'plan' });
    await fid(cal, 'pd-eat-' + p).click();
    const lg = env.sheet();
    assert.equal(fid(lg.el, 'lg-kcal').value, String(per.kcal));
    assert.equal(byCls(lg.el, 'lg-recipe-empty').textContent, '这道食谱没写几人份：下面是按食材估算的一整道菜（约），只吃了一部分就改份数（比如 0.5）。1 样没算进去：鸡腿。');
  } finally { env.done(); }
});

test('算进去的只有水、盐：写「还估算不出来」，不给抄、记饮食不填 0；明细里「指定成」回车不存第一个；编辑页打开的没写用量说「写上用量」', async () => {
  const env = setup();
  try {
    let soup = '';
    state.mutate(s => {
      soup = saveRecipe(s, null, { name: '麻辣烫', servings: '2', ings: [{ name: '火锅底料', qty: '1', unit: '包' }, { name: '水', qty: '1', unit: 'L' },
        { name: '鱼豆腐', qty: '200', unit: 'g' }, { name: '盐', qty: '1', unit: '小勺' }, { name: '花椒' }] }, now()).id;
    });
    const main = env.mount(recipeView, { name: 'recipe', id: soup });
    assert.equal(byCls(fid(main, 'rcp-est'), 'rcp-est-main').textContent, '还估算不出来：3 样没算进去，算进去的（水、盐这些）没有热量');
    await fid(main, 'rcp-est').click();
    const sh = env.sheet();
    assert.deepEqual([fid(sh.el, 'est-manual') ?? null, byCls(sh.el, 'est-total') ?? null], [null, null]);
    // 指定成…：回车（iPhone 的「搜索」）只收起键盘，不存第一个（鱼豆腐不是豆腐）
    await fid(sh.el, 'est-pick-' + S().data.recipes[soup].ings.find(g => g.name === '鱼豆腐').key).click();
    const pk = env.sheet();
    key(fid(pk.el, 'est-q'), 'Enter');
    assert.deepEqual([pk.open, liveFood(S(), foodId('鱼豆腐')), env.doc.activeElement === fid(pk.el, 'est-q')], [true, null, false]);
    pk.close();
    sh.close();
    // 记一样吃的：联想里这道没有数，点了框是空的
    const cal = env.mount(planView, { name: 'plan' });
    await fid(cal, 'lg-add-' + TODAY).click();
    const lg = env.sheet();
    await type(fid(lg.el, 'lg-q'), '麻辣');
    assert.equal(byCls(fid(lg.el, 'lg-r-' + soup), 'dish-opt-meta') ?? null, null);
    await fid(lg.el, 'lg-r-' + soup).click();
    assert.deepEqual([fid(lg.el, 'lg-kcal').value, byCls(lg.el, 'lg-recipe-empty').textContent], ['', t('log.perRecipeEmpty')]);
    lg.close();
    // 编辑页打开的明细：没写用量的不说「在「编辑」里」
    const ed = env.mount(editView, { name: 'recipeEdit', id: soup }, { storage: env.storage });
    await fid(ed, 're-est-open').click();
    assert.equal(rowsIn(env.sheet(), 'est-missing').find(r => r[0] === '花椒')[3], '没写用量（适量、少许）：写上用量就能算');
  } finally { env.done(); }
});

test('繁体界面写对上的名字（馬鈴薯，不是「土豆」）、和营养素一行的克数写 g；英文界面的单位换成单数（1 clove）', async () => {
  let env = setup({ lang: 'zh-Hant-TW' });
  try {
    let id = '';
    state.mutate(s => { id = saveRecipe(s, null, { name: '馬鈴薯燉肉', servings: '2', ings: [{ name: '馬鈴薯', qty: '2', unit: '顆' }, { name: '醬油', qty: '1', unit: '大匙' }] }, now()).id; });
    env.mount(recipeView, { name: 'recipe', id });
    await fid(env.main, 'rcp-est').click();
    const rows = rowsIn(env.sheet(), 'est-counted');
    const g = Math.round(2 * food('土豆').grams.个);
    assert.equal(rows[0][3], `${g}${NB}g · 依表裡的「馬鈴薯」`);
    assert.match(rows[1][3], /依表裡的「醬油」$/);
  } finally { env.done(); }
  env = setup({ lang: 'en' });
  try {
    let id = '';
    state.mutate(s => { id = saveRecipe(s, null, { name: 'Shallot rice', servings: '2', ings: [{ name: 'shallots', qty: '3', unit: 'cloves' }] }, now()).id; });
    env.mount(recipeView, { name: 'recipe', id });
    await fid(env.main, 'rcp-est').click();
    const sh = env.sheet();
    const row = rowsIn(sh, 'est-missing')[0];
    assert.match(row[3], /^Don’t know what 1 clove weighs/);
    await fid(sh.el, 'est-own-' + S().data.recipes[id].ings[0].key).click();
    assert.match(byCls(env.sheet().el, 'est-own').textContent, /Weight of 1 clove \(g\)/);
  } finally { env.done(); }
});
