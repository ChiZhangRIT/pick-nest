// 食谱的几页（假 DOM + 真的 state.js，只用内存）：「食谱」页的卡片和搜索、一道食谱、编辑食谱（含粘贴食材的预览和修改、草稿、离开前先问）、
// 「加到清单」面板（常备品不勾、清单上已有的、人数）、编辑面板里来自食谱的那几份（显示、拿掉）、快速添加联想到的「用到它的食谱」。全是编的数据
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as recipesView from '../src/views/recipes.js';
import * as recipeView from '../src/views/recipe.js';
import * as editView from '../src/views/recipeEdit.js';
import * as listView from '../src/views/list.js';
import * as state from '../src/core/state.js';
import { deletedRecord, itemId, normalizeRecord, hash64, normName } from '../src/core/store.js';
import { saveRecipe, addRecipeToList, liveRecipe, tagId, isTagHidden } from '../src/core/recipes.js';
import { addFromInput, totalLabel } from '../src/core/items.js';
import { setStaple, isStaple } from '../src/core/memory.js';
import { itemSheet } from '../src/ui/itemEditor.js';
import { setLang, t } from '../src/i18n.js';
import { Element, all, find, installDom, fakeStorage } from './helpers/dom.mjs';

const settle = async (n = 5) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)); };
const cls = (el, c) => (el.className || el.attrs.class || '').split(' ').includes(c);
const byCls = (root, c) => find(root, el => cls(el, c));
const allCls = (root, c) => all(root, el => cls(el, c));
const btn = (root, label) => find(root, el => el.tag === 'button' && el.textContent === label);
const fid = (root, f) => root.querySelector(`[data-fid="${f}"]`);
const key = (el, k, extra = {}) => { for (const fn of el.events.keydown || []) fn({ key: k, target: el, preventDefault() {}, ...extra }); };
const type = async (el, text) => { el.focus(); el.value = text; await el.fire('input'); };
const S = () => state.getState();
const L = 'l_groceries';
let clock = Date.now() - 3600_000;
const now = () => (clock += 1000);

/** 编几道食谱：红烧肉（2 人份，生抽是常备品，香菜可选）、番茄炒蛋、Pancakes */
function seedRecipes(s) {
  const id = (name, servings, ings, extra = {}) => saveRecipe(s, null, { name, servings, ings, ...extra }, now()).id;
  const hsr = id('红烧肉', '2', [{ name: '五花肉', qty: '500', unit: 'g', note: '带皮' }, { name: '洋葱', qty: '1', unit: '个' }, { name: '生抽', qty: '2', unit: '勺' },
    { name: '香菜', optional: true }, { name: '盐', note: '适量' }], { steps: '切块\n炖', source: 'https://example.com/r1', note: '别糊锅' });
  const egg = id('番茄炒蛋', '', [{ name: '番茄', qty: '2', unit: '个' }, { name: '雞蛋', qty: '3', unit: '个' }], { source: '妈妈教的' });
  const pan = id('Pancakes', '3', [{ name: 'flour', qty: '1.5', unit: 'cups' }]);
  setStaple(s, '生抽', true, now());
  return { hsr, egg, pan };
}

/** 假 ctx（照 app.js）：面板记下内容和按钮，不开真的 <dialog>；数据变了在微任务里调页面的 onChange */
function setup({ seed = null, lang = 'zh-Hans', storage = null } = {}) {
  const dom = installDom();
  setLang(lang);
  state.load({ storage: null });
  let ids = {};
  if (seed) state.mutate(s => { ids = seed(s) || {}; });
  const env = { ...dom, ids, toasts: [], navs: [], sheets: [], confirms: [], answer: true, handle: null, guard: null, storage: storage || fakeStorage() };
  const ctx = env.ctx = {
    t, lang: () => lang, layout: () => 'phone',
    get state() { return S(); }, get local() { return state.getLocal(); },
    setLocal: (p) => state.setLocal(p),
    mutate: (fn, o) => state.mutate(fn, o),
    remove(c, id, o) { const prev = S().data[c][id]; if (!prev || prev.deleted) return null; state.mutate(s => { s.data[c][id] = deletedRecord(prev); }, o); return prev; },
    toast: (msg, o = {}) => env.toasts.push({ msg, ...o }),
    confirm: async (o) => { env.confirms.push(o); return env.answer; },
    navigate: (p, o) => env.navs.push(o && o.replace ? 'replace:' + p : p), back: (p) => env.navs.push('back:' + p),
    backLabel: (f) => f,
    guard: (fn, onDiscard) => { env.guard = fn; env.onDiscard = onDiscard; },
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
  env.main = new Element('section');
  env.mount = (view, params, deps) => {
    if (env.handle && env.handle.cleanup) env.handle.cleanup();
    env.main = new Element('section');
    const ret = view.render(env.main, params, ctx, deps);
    env.handle = ret && typeof ret === 'object' ? ret : null;
    return env.main;
  };
  env.sheet = () => env.sheets.at(-1);
  // 收尾时页面先拿掉：最后一次修改排在微任务里的 onChange 不会在假 DOM 拆掉以后才跑
  env.done = () => { const h = env.handle; env.handle = null; if (h && h.cleanup) h.cleanup(); off(); dom.restore(); };
  return env;
}

// ---------- 「食谱」页 ----------
test('「食谱」页：卡片按名字排（名字、几人份 · 几样食材），点了去那道食谱；新建去 #/r/new；没有食谱时说怎么开始', async () => {
  let env = setup();
  try {
    const main = env.mount(recipesView, { name: 'recipes' });
    assert.equal(main.querySelector('h1').textContent, '食谱');
    assert.equal(byCls(main, 'rcp-empty').textContent, t('rcp.none') + t('rcp.noneHint'));
    assert.equal(fid(main, 'rcp-new').attrs.href, '#/r/new');
  } finally { env.done(); }
  env = setup({ seed: seedRecipes });
  try {
    const main = env.mount(recipesView, { name: 'recipes', pane: 'list', selected: env.ids.hsr });
    const cards = () => allCls(env.main, 'rcp-row').map(r => [byCls(r, 'rcp-name').textContent, byCls(r, 'rcp-meta').textContent]);
    assert.deepEqual(cards(), [['番茄炒蛋', '2 样食材'], ['红烧肉', '2 人份 · 5 样食材'], ['Pancakes', '3 人份 · 1 样食材']], '没写人数的只写几样');
    assert.equal(allCls(main, 'rcp-row')[1].attrs.href, '#/r/' + env.ids.hsr);
    assert.ok(cls(allCls(main, 'rcp-row')[1], 'sel'), '双栏：右栏正在看的那道高亮');
    // 数据变了（别的设备加了一道）：只重画卡片
    state.mutate(s => saveRecipe(s, null, { name: '咖喱鸡', servings: '4', ings: [] }, now()));
    await settle();
    assert.equal(cards().length, 4);
  } finally { env.done(); }
});

test('「食谱」页：边打边搜（名字和食材，简繁互通），食材搜到的写「用到：…」；没找到说清楚；搜索框不重画，搜索词在这次打开期间记着', async () => {
  const env = setup({ seed: seedRecipes });
  try {
    let main = env.mount(recipesView, { name: 'recipes' });
    const input = byCls(main, 'rcp-search');
    const cards = () => allCls(env.main, 'rcp-row').map(r => [byCls(r, 'rcp-name').textContent, byCls(r, 'rcp-meta').textContent]);
    await type(input, '五花');
    assert.deepEqual(cards(), [['红烧肉', '用到：五花肉']]);
    await type(input, '鸡蛋');
    assert.deepEqual(cards(), [['番茄炒蛋', '用到：雞蛋']], '简体搜繁体');
    await type(input, '紅燒');
    assert.deepEqual(cards(), [['红烧肉', '2 人份 · 5 样食材']], '名字搜到的照常写几人份');
    assert.equal(main.querySelector('[role="status"]').textContent, '找到 1 道食谱');
    state.mutate(s => saveRecipe(s, null, { name: '红烧排骨', ings: [] }, now()));
    await settle();
    assert.equal(byCls(env.main, 'rcp-search'), input, '数据变了：搜索框还是同一个（打字不被打断）');
    assert.deepEqual(cards().map(c => c[0]), ['红烧排骨', '红烧肉']);
    await type(input, '佛跳墙');
    assert.equal(byCls(main, 'lp-empty').textContent, '没有找到「佛跳墙」' + t('rcp.notFoundHint'));
    // 进一道食谱再回来（或者双栏时左栏跟着右栏重新挂载）：还是刚才搜的
    main = env.mount(recipesView, { name: 'recipes' });
    assert.equal(byCls(main, 'rcp-search').value, '佛跳墙');
    key(byCls(main, 'rcp-search'), 'Escape');
    assert.equal(byCls(main, 'rcp-search').value, '');
    assert.equal(cards().length, 4, 'Esc 清空');
  } finally { env.done(); }
});

// ---------- 一道食谱 ----------
test('一道食谱：名字、几人份、来源链接（新标签页）、食材（备注、常备品、可选）、做法、备注；没写人数、来源不是链接的照写', async () => {
  const env = setup({ seed: seedRecipes });
  try {
    const main = env.mount(recipeView, { name: 'recipe', id: env.ids.hsr });
    assert.equal(byCls(main, 'lp-name').textContent, '红烧肉');
    assert.equal(byCls(main, 'rcp-sub').textContent, '2 人份 · 5 样食材');
    const src = byCls(main, 'rcp-source');
    assert.deepEqual([src.tag, src.attrs.href, src.attrs.target, src.attrs.rel], ['a', 'https://example.com/r1', '_blank', 'noopener noreferrer']);
    assert.deepEqual(allCls(main, 'rcp-ing').map(r => [byCls(r, 'rcp-ing-name').textContent, byCls(r, 'rcp-ing-qty').textContent, byCls(r, 'rcp-ing-note')?.textContent ?? '']),
      [['五花肉', '500 g', '带皮'], ['洋葱', '1 个', ''], ['生抽常备品', '2 勺', ''], ['香菜可选', '', ''], ['盐', '', '适量']]);
    assert.deepEqual(allCls(main, 'rcp-prose').map(x => x.textContent), ['切块\n炖', '别糊锅']);
    assert.ok(fid(main, 'rcp-plan'), '「加到计划」在「加到清单」旁边（面板的测试在 planView.test.mjs）');
    fid(main, 'rcp-edit').click();
    assert.equal(env.navs.at(-1), '/r/' + env.ids.hsr + '/edit');
    const m2 = env.mount(recipeView, { name: 'recipe', id: env.ids.egg });
    assert.equal(byCls(m2, 'rcp-sub').textContent, '2 样食材');
    assert.deepEqual([byCls(m2, 'rcp-source').tag, byCls(m2, 'rcp-source').textContent], ['p', '妈妈教的']);
    assert.equal(allCls(m2, 'rcp-prose').length, 0, '没写做法、备注的不画');
    assert.ok(!m2.textContent.includes('null'), '也不画成字「null」（replaceChildren 不跳过 null）');
  } finally { env.done(); }
});

test('一道食谱：删除先问（焦点给取消），离开这一页再软删除、能撤销，不多提示「不在了」；别的设备删掉了 → 回「食谱」并提示', async () => {
  const env = setup({ seed: seedRecipes });
  try {
    const main = env.mount(recipeView, { name: 'recipe', id: env.ids.hsr });
    env.answer = false;
    await btn(main, '删除食谱').click();
    assert.equal(liveRecipe(S(), env.ids.hsr).name, '红烧肉', '取消了不删');
    assert.equal(env.confirms.at(-1).danger, true);
    env.answer = true;
    await btn(main, '删除食谱').click();
    await settle();
    assert.equal(S().data.recipes[env.ids.hsr].deleted, true);
    assert.deepEqual(env.navs, ['back:/recipes']);
    assert.deepEqual(env.toasts.map(x => x.msg), [], '这一页不提示「不在了」（撤销的提示条由 app 弹）');
    state.undo();
    assert.ok(liveRecipe(S(), env.ids.hsr));
    // 开着的时候别的设备删掉了
    env.mount(recipeView, { name: 'recipe', id: env.ids.egg });
    state.mutate(s => { s.data.recipes[env.ids.egg] = deletedRecord(s.data.recipes[env.ids.egg]); });
    await settle();
    assert.deepEqual([env.navs.at(-1), env.toasts.at(-1).msg], ['replace:/recipes', '这道食谱不在了']);
    env.mount(recipeView, { name: 'recipe', id: 'r_nope' });
    await settle();
    assert.equal(env.navs.at(-1), 'replace:/recipes');
  } finally { env.done(); }
});

// ---------- 加到清单 ----------
test('加到清单：常备品、可选的默认不勾，清单上已有的写出来；换人数用量跟着变；标常备品顺手取消勾；确认后按人数加进去，能撤销', async () => {
  const env = setup({ seed: (s) => { const ids = seedRecipes(s); addFromInput(s, L, '洋葱 2个', now()); return ids; } });
  try {
    const main = env.mount(recipeView, { name: 'recipe', id: env.ids.hsr });
    fid(main, 'rcp-add').click();
    const sh = env.sheet();
    assert.equal(sh.opts.title, '红烧肉');
    const rows = () => allCls(sh.el, 'atl-row').map(r => [byCls(r, 'atl-name').textContent, byCls(r, 'atl-box').checked, byCls(r, 'atl-qty').textContent,
      byCls(r, 'atl-have').hidden ? '' : byCls(r, 'atl-have').textContent, byCls(r, 'atl-staple').attrs['aria-pressed']]);
    assert.deepEqual(rows(), [
      ['五花肉', true, '500 g', '', 'false'],
      ['洋葱', true, '1 个', '清单上已有 2 个', 'false'],
      ['生抽', false, '2 勺', '', 'true'],
      ['香菜可选', false, '', '', 'false'],
      ['盐', true, '', '', 'false'],
    ]);
    assert.equal(fid(sh.el, 'atl-list').value, L, '默认加到「食材」');
    assert.equal(fid(sh.el, 'atl-go').textContent, '加到清单（3 样）');
    // 多一人份：2 → 3
    find(sh.el, el => el.tag === 'button' && el.attrs['aria-label'] === '多一人份').click();
    assert.deepEqual(rows().map(r => r[2]), ['750 g', '1.5 个', '3 勺', '', '']);
    // 盐标成常备品：取消勾
    const saltRow = allCls(sh.el, 'atl-row')[4];
    byCls(saltRow, 'atl-staple').click();
    assert.deepEqual(rows()[4], ['盐', false, '', '', 'true']);
    assert.equal(fid(sh.el, 'atl-go').textContent, '加到清单（2 样）');
    // 自己勾上香菜
    const box = byCls(allCls(sh.el, 'atl-row')[3], 'atl-box');
    box.checked = true; await box.fire('change');
    fid(sh.el, 'atl-go').click();
    assert.equal(sh.open, false);
    const it = (n) => S().data.items[itemId(S(), L, n)];
    assert.equal(totalLabel(it('五花肉')), '750 g');
    assert.equal(totalLabel(it('洋葱')), '3.5 个', '自己加的 2 个 + 这道菜的 1.5 个');
    assert.equal(it('香菜').status, 'need');
    assert.equal(it('生抽'), undefined, '常备品没勾的不加');
    assert.equal(isStaple(S(), '盐'), true, '标的常备品记下来了');
    const src = Object.keys(it('五花肉').needs)[0];
    assert.match(src, /^a:/);
    assert.deepEqual(it('五花肉').needs[src], { qty: 750, unit: 'g', label: '红烧肉', recipeId: env.ids.hsr });
    state.undo();
    assert.equal(S().data.items[itemId(S(), L, '五花肉')].deleted, true, '一起撤销');
    assert.equal(isStaple(S(), '盐'), false);
  } finally { env.done(); }
});

test('加到清单：这道菜已经加过的写出来、默认不勾（再打开看看不会一下翻倍，勾上就是再加一份）；同名的几行标常备品一起取消勾；人数写得不对标出来、不让加', async () => {
  const env = setup({ seed: (s) => {
    const ids = seedRecipes(s);
    ids.cuke = saveRecipe(s, null, { name: '凉拌黄瓜', servings: '2', ings: [{ name: '黄瓜', qty: '2', unit: '根' }, { name: '盐', note: '腌' }, { name: '鹽', note: '调味' }] }, now()).id;
    return ids;
  } });
  try {
    const main = env.mount(recipeView, { name: 'recipe', id: env.ids.hsr });
    fid(main, 'rcp-add').click();
    fid(env.sheet().el, 'atl-go').click();                     // 五花肉、洋葱、盐
    await settle();
    fid(env.main, 'rcp-add').click();
    let sh = env.sheet();
    const rows = () => allCls(sh.el, 'atl-row').map(r => [byCls(r, 'atl-name').textContent, byCls(r, 'atl-box').checked, byCls(r, 'atl-have').hidden ? '' : byCls(r, 'atl-have').textContent]);
    assert.deepEqual(rows(), [['五花肉', false, '这道菜已经加过 500 g'], ['洋葱', false, '这道菜已经加过 1 个'], ['生抽', false, ''], ['香菜可选', false, ''], ['盐', false, '这道菜已经加过']]);
    assert.equal(byCls(sh.el, 'atl-again').hidden, false, '说一句：勾上就是再加一份');
    assert.deepEqual([fid(sh.el, 'atl-go').textContent, fid(sh.el, 'atl-go').attrs['aria-disabled']], ['加到清单（0 样）', 'true']);
    const box = byCls(allCls(sh.el, 'atl-row')[0], 'atl-box');
    box.checked = true; await box.fire('change');
    // 人数写得不对（打「100」路过「10」、清空）：标在下面，「加到清单」不让点，焦点回到人数
    const sv = fid(sh.el, 'atl-sv');
    await type(sv, '100');
    const svErr = () => find(sh.el, el => cls(el, 'f-err') && !el.hidden && !cls(el, 'atl-err'));
    assert.deepEqual([sv.attrs['aria-invalid'], svErr() && svErr().textContent, fid(sh.el, 'atl-go').attrs['aria-disabled']], ['true', '几人份要大于 0，最多 99', 'true']);
    fid(sh.el, 'atl-go').click();
    assert.deepEqual([sh.open, document.activeElement], [true, sv], '没加');
    assert.equal(totalLabel(S().data.items[itemId(S(), L, '五花肉')]), '500 g');
    await type(sv, '');
    assert.equal(fid(sh.el, 'atl-go').attrs['aria-disabled'], 'true', '空着也不行');
    await type(sv, '4');
    assert.deepEqual([sv.attrs['aria-invalid'], svErr(), fid(sh.el, 'atl-go').attrs['aria-disabled']], [undefined, undefined, 'false']);
    fid(sh.el, 'atl-go').click();
    assert.equal(totalLabel(S().data.items[itemId(S(), L, '五花肉')]), '1500 g', '上次的 500 g + 这次 4 人份的 1000 g');
    // 同名的几行（腌的盐、调味的鹽）：标一行常备品，两行一起取消勾、一起显示成常备品
    env.mount(recipeView, { name: 'recipe', id: env.ids.cuke });
    fid(env.main, 'rcp-add').click();
    sh = env.sheet();
    byCls(allCls(sh.el, 'atl-row')[1], 'atl-staple').click();
    assert.deepEqual(allCls(sh.el, 'atl-row').map(r => [byCls(r, 'atl-box').checked, byCls(r, 'atl-staple').attrs['aria-pressed']]), [[true, 'false'], [false, 'true'], [false, 'true']]);
    fid(sh.el, 'atl-go').click();
    assert.equal(S().data.items[itemId(S(), L, '盐')].needs[Object.keys(S().data.items[itemId(S(), L, '盐')].needs)[0]].label, '红烧肉', '盐没再加（还是红烧肉那一份）');
    assert.equal(Object.keys(S().data.items[itemId(S(), L, '盐')].needs).length, 1);
    assert.equal(isStaple(S(), '鹽'), true);
  } finally { env.done(); }
});

test('加到清单：一样都没勾时说一句、不加；没写人数的食谱不能换算；没有食材清单时说怎么办', async () => {
  const env = setup({ seed: seedRecipes });
  try {
    const main = env.mount(recipeView, { name: 'recipe', id: env.ids.egg });
    fid(main, 'rcp-add').click();
    let sh = env.sheet();
    assert.ok(byCls(sh.el, 'atl-noscale'), '番茄炒蛋没写人数');
    assert.equal(find(sh.el, el => el.attrs['aria-label'] === '多一人份'), undefined);
    for (const b of allCls(sh.el, 'atl-box')) { b.checked = false; await b.fire('change'); }
    assert.equal(fid(sh.el, 'atl-go').attrs['aria-disabled'], 'true');
    fid(sh.el, 'atl-go').click();
    assert.equal(byCls(sh.el, 'atl-err').hidden, false);
    assert.equal(sh.open, true, '没加，面板还开着');
    sh.close();
    state.mutate(s => { s.data.lists[L] = { ...s.data.lists[L], archived: true }; });
    fid(env.main, 'rcp-add').click();
    sh = env.sheet();
    assert.equal(byCls(sh.el, 'atl-nolist').textContent, t('rcp.atlNoList'));
  } finally { env.done(); }
});

// ---------- 编辑食谱 ----------
test('新建食谱：名字、几人份、一行一样的食材（加一样、↑↓、可选、删掉一行）；名字空着、数量不对标在那一项下面；存好换成那道食谱的页面', async () => {
  const env = setup();
  try {
    const main = env.mount(editView, { name: 'recipeEdit', sub: 'new' }, { storage: env.storage });
    assert.equal(main.querySelector('h1').textContent, '新建食谱');
    assert.equal(btn(main, '取消').attrs.class, 'back text', '照 Babble：「取消 · 标题 · 保存」');
    assert.equal(document.activeElement, fid(main, 're-name'), '新建时焦点给名字');
    assert.equal(env.guard(), false, '没改不用问');
    // 名字空着就保存
    fid(main, 're-save').click();
    await settle();
    assert.equal(byCls(main, 'f-err').textContent, '名字不能空着');
    await type(fid(main, 're-name'), '可乐鸡翅');
    assert.equal(env.guard(), true, '改了：离开前要问');
    await type(fid(main, 're-sv'), '2');
    const add = () => fid(env.main, 're-add').click();
    add(); add(); add();
    const rows = () => allCls(main, 're-row');
    assert.equal(rows().length, 3);
    const fill = async (row, name, qty, unit) => { await type(byCls(row, 're-name'), name); await type(byCls(row, 're-qty'), qty); await type(byCls(row, 're-unit'), unit); };
    await fill(rows()[0], '可乐', '1', '罐');
    await fill(rows()[1], '鸡翅', 'abc', '个');
    await fill(rows()[2], '姜', '3', '片');
    // ↑：鸡翅挪到第一行（焦点还在同一个按钮上）
    const upKey = rows()[1].dataset.key;
    fid(main, 're-up-' + upKey).click();
    assert.deepEqual(rows().map(r => byCls(r, 're-name').value), ['鸡翅', '可乐', '姜']);
    assert.equal(document.activeElement, fid(main, 're-up-' + upKey));
    assert.equal(fid(main, 're-up-' + upKey).attrs['aria-disabled'], 'true', '到顶了');
    // 姜可选，然后删掉可乐
    byCls(rows()[2], 're-opt').click();
    assert.equal(byCls(rows()[2], 're-opt').attrs['aria-pressed'], 'true');
    byCls(rows()[1], 're-del').click();
    assert.deepEqual(rows().map(r => byCls(r, 're-name').value), ['鸡翅', '姜']);
    assert.equal(document.activeElement, byCls(rows()[1], 're-del'), '焦点给顶上来的那一行');
    // 数量不对：标在那一行，焦点给它
    fid(main, 're-save').click();
    await settle();
    assert.equal(byCls(rows()[0], 'f-err').textContent, '数量要大于 0，最多 9999');
    assert.equal(document.activeElement, byCls(rows()[0], 're-qty'));
    assert.equal(Object.keys(S().data.recipes).length, 0, '有错什么也没存');
    await type(byCls(rows()[0], 're-qty'), '10');
    await type(fid(main, 're-steps'), '焯水\n加可乐炖');
    fid(main, 're-save').click();
    await settle();
    const [r] = Object.values(S().data.recipes);
    assert.deepEqual([r.name, r.servings, r.steps, r.ings.map(g => [g.name, g.qty, g.unit, g.optional])],
      ['可乐鸡翅', 2, '焯水\n加可乐炖', [['鸡翅', 10, '个', false], ['姜', 3, '片', true]]]);
    assert.equal(env.navs.at(-1), 'replace:/r/' + r.id, '换成那道食谱的页面（替换掉 #/r/new）');
    assert.equal(env.storage.getItem(editView.DRAFT_PREFIX + 'new'), null, '存好了：草稿删掉');
  } finally { env.done(); }
});

test('编辑食谱：回车（iPhone 键盘的「下一项」「完成」）不保存——名字 → 几人份，几人份、来源收起键盘；⌘S / Ctrl+回车才保存', async () => {
  const env = setup();
  try {
    const main = env.mount(editView, { name: 'recipeEdit', sub: 'new' }, { storage: env.storage });
    const S = () => state.getState();
    await type(fid(main, 're-name'), '麻婆豆腐');
    key(fid(main, 're-name'), 'Enter');
    await settle();
    assert.equal(Object.keys(S().data.recipes).length, 0, '没存');
    assert.equal(env.navs.length, 0, '还在编辑页');
    assert.equal(document.activeElement, fid(main, 're-sv'), '焦点给几人份');
    await type(fid(main, 're-sv'), '2');
    key(fid(main, 're-sv'), 'Enter');
    key(fid(main, 're-source'), 'Enter');
    await settle();
    assert.equal(Object.keys(S().data.recipes).length, 0);
    for (const fn of main.events.keydown || []) fn({ key: 's', metaKey: true, target: fid(main, 're-sv'), preventDefault() {} });
    await settle();
    const [r] = Object.values(S().data.recipes);
    assert.deepEqual([r && r.name, r && r.servings], ['麻婆豆腐', 2], '⌘S 保存');
  } finally { env.done(); }
});

test('粘贴食材：贴一整段 → 先看拆成什么样（能改、能去掉）→ 加进去接在后面；没认出来的说一句；贴了字关面板先问', async () => {
  const env = setup();
  try {
    const main = env.mount(editView, { name: 'recipeEdit', sub: 'new' }, { storage: env.storage });
    await type(fid(main, 're-name'), '红烧肉');
    fid(main, 're-add').click();                                  // 一行空的：粘贴后换掉它
    fid(main, 're-paste').click();
    const sh = env.sheet();
    const ta = byCls(sh.el, 'paste-in');
    await type(ta, '！！！');
    fid(sh.el, 'paste-go').click();
    assert.equal(byCls(sh.el, 'paste-err').textContent, '没认出食材，看看是不是贴对了。');
    await type(ta, '食材：五花肉500g、生抽2勺、冰糖20g\n葱、姜 适量');
    fid(sh.el, 'paste-go').click();
    assert.equal(sh.title, '拆成了 5 样');
    assert.equal(document.activeElement, byCls(sh.el, 'paste-help'), '焦点给说明那一句，不给输入框（iPhone 不弹键盘盖住单子）');
    const prev = () => allCls(sh.el, 'paste-row').map(r => [byCls(r, 'paste-name').value, byCls(r, 'paste-qty').value, byCls(r, 'paste-unit').value, byCls(r, 'paste-note')?.value ?? '']);
    assert.deepEqual(prev(), [['五花肉', '500', 'g', ''], ['生抽', '2', '勺', ''], ['冰糖', '20', 'g', ''], ['葱', '', '', '适量'], ['姜', '', '', '适量']]);
    // 改一样、去掉一样
    await type(byCls(allCls(sh.el, 'paste-row')[2], 'paste-name'), '黄冰糖');
    fid(sh.el, 'paste-x-1').click();
    assert.equal(sh.title, '拆成了 4 样');
    assert.equal(fid(sh.el, 'paste-go').textContent, '加进去', '几样写在标题上，按钮在窄手机上不折行');
    assert.equal(document.activeElement, fid(sh.el, 'paste-x-1'), '焦点给顶上来的那一行的 ×');
    // 返回修改：字还在；再拆一次是从字重新拆
    fid(sh.el, 'paste-back').click();
    assert.equal(byCls(sh.el, 'paste-1').hidden, false);
    assert.equal(ta.value, '食材：五花肉500g、生抽2勺、冰糖20g\n葱、姜 适量');
    fid(sh.el, 'paste-go').click();
    fid(sh.el, 'paste-x-1').click();
    await type(byCls(allCls(sh.el, 'paste-row')[1], 'paste-name'), '黄冰糖');
    fid(sh.el, 'paste-go').click();
    assert.equal(sh.open, false);
    assert.deepEqual(allCls(main, 're-row').map(r => [byCls(r, 're-name').value, byCls(r, 're-qty').value, byCls(r, 're-unit').value, byCls(r, 're-note').value]),
      [['五花肉', '500', 'g', ''], ['葱', '', '', '适量'], ['姜', '', '', '适量'], ['黄冰糖', '20', 'g', '']], '空的那一行换掉了；粘贴进来的按类别放好（肉类、蔬果、调料）');
    assert.equal(env.toasts.at(-1).msg, '加了 4 样食材');
    assert.equal(document.activeElement, fid(main, 're-paste'), '焦点回到「粘贴食材」，不弹键盘');
    assert.equal(Object.keys(S().data.recipes).length, 0, '还没保存');
    // 再开一次，贴了字点 ✕：先问
    fid(main, 're-paste').click();
    const sh2 = env.sheet();
    await type(byCls(sh2.el, 'paste-in'), '鸡蛋 2个');
    env.answer = false;
    sh2.tryClose();
    await settle();
    assert.equal(sh2.open, true, '继续编辑');
    assert.equal(env.confirms.at(-1).danger, true);
    env.answer = true;
    sh2.tryClose();
    await settle();
    assert.equal(sh2.open, false);
    fid(main, 're-save').click();
    await settle();
    const [r] = Object.values(S().data.recipes);
    assert.deepEqual(r.ings.map(g => [g.name, g.qty, g.unit, g.note]), [['五花肉', 500, 'g', ''], ['葱', null, '', '适量'], ['姜', null, '', '适量'], ['黄冰糖', 20, 'g', '']]);
  } finally { env.done(); }
});

test('编辑食谱：改了没保存——「取消」先问（焦点给继续编辑）；随手另存草稿，下次打开接着改（能放弃）；在别处放弃了草稿就删掉', async () => {
  const storage = fakeStorage();
  const env = setup({ seed: seedRecipes, storage });
  try {
    const id = env.ids.hsr, k = editView.DRAFT_PREFIX + id;
    let main = env.mount(editView, { name: 'recipeEdit', id }, { storage });
    assert.equal(main.querySelector('h1').textContent, '编辑食谱');
    assert.deepEqual(allCls(main, 're-row').map(r => byCls(r, 're-name').value), ['五花肉', '洋葱', '生抽', '香菜', '盐']);
    assert.equal(fid(main, 're-sv').value, '2');
    await type(fid(main, 're-name'), '红烧肉（少糖）');
    env.answer = false;
    await btn(main, '取消').click();
    assert.deepEqual([env.confirms.at(-1).message, env.confirms.at(-1).cancelLabel, env.confirms.at(-1).danger], ['放弃没保存的修改？', '继续编辑', true]);
    assert.deepEqual(env.navs, [], '继续编辑：留着');
    // 页面被关掉（iOS 在后台杀掉 App 也一样：打字时已经另存了）
    env.handle.cleanup(); env.handle = null;
    assert.equal(JSON.parse(storage.getItem(k)).w.name, '红烧肉（少糖）');
    main = env.mount(editView, { name: 'recipeEdit', id }, { storage });
    assert.equal(fid(main, 're-name').value, '红烧肉（少糖）', '接着改');
    assert.ok(byCls(main, 're-draft'));
    assert.equal(env.guard(), true);
    btn(main, '放弃修改').click();
    assert.equal(fid(main, 're-name').value, '红烧肉');
    assert.equal(byCls(main, 're-draft'), undefined);
    assert.equal(storage.getItem(k), null);
    assert.equal(env.guard(), false);
    // 在别处换页、点了「放弃」（app 的 ctx.guard）：草稿删掉，下次打开是原样
    await type(fid(main, 're-name'), '又改了');
    env.onDiscard();
    env.handle.cleanup(); env.handle = null;
    assert.equal(storage.getItem(k), null);
    main = env.mount(editView, { name: 'recipeEdit', id }, { storage });
    assert.equal(fid(main, 're-name').value, '红烧肉');
    // 改了保存：回到上一页
    await type(fid(main, 're-name'), '红烧肉 2');
    fid(main, 're-save').click();
    await settle();
    assert.equal(liveRecipe(S(), id).name, '红烧肉 2');
    assert.equal(env.navs.at(-1), 'back:/r/' + id);
    assert.equal(liveRecipe(S(), id).ings.length, 5, '食材原样');
  } finally { env.done(); }
});

test('编辑食谱：切到后台（app 调 flush）、页面被收起（pagehide）马上另存草稿，不等 0.4 秒；保存了、放弃了不再存', async () => {
  const storage = fakeStorage();
  const env = setup({ seed: seedRecipes, storage });
  const win = window;
  try {
    const id = env.ids.hsr, k = editView.DRAFT_PREFIX + id;
    const main = env.mount(editView, { name: 'recipeEdit', id }, { storage });
    await type(fid(main, 're-name'), '红烧肉（贴到一半）');
    assert.equal(storage.getItem(k), null, '还在 0.4 秒的防抖里');
    env.handle.flush();
    assert.equal(JSON.parse(storage.getItem(k)).w.name, '红烧肉（贴到一半）', 'iOS 一隐藏就停掉计时器：切走时马上存');
    await type(fid(main, 're-name'), '红烧肉（又改了）');
    await window.fire('pagehide');
    assert.equal(JSON.parse(storage.getItem(k)).w.name, '红烧肉（又改了）');
    fid(main, 're-save').click();
    await settle();
    assert.equal(storage.getItem(k), null);
    env.handle.flush();
    await window.fire('pagehide');
    assert.equal(storage.getItem(k), null, '存好了：不再另存');
  } finally { env.done(); }
  assert.equal(win.events.pagehide.size, 0, '离开这一页时拿掉 pagehide 的监听');
});

test('编辑食谱：Esc 只听这一页（双栏左栏搜索框里的 Esc 不取消右栏的编辑）；别处已经处理过的 Esc 不管', async () => {
  const env = setup({ seed: seedRecipes });
  try {
    const main = env.mount(editView, { name: 'recipeEdit', id: env.ids.hsr }, { storage: env.storage });
    for (const fn of document.events.keydown || []) fn({ key: 'Escape', target: document.body, preventDefault() {} });
    await settle();
    assert.deepEqual(env.navs, [], '页面外面的 Esc：不管');
    key(main, 'Escape', { defaultPrevented: true });
    await settle();
    assert.deepEqual(env.navs, [], '搜索框已经用掉的 Esc：不管');
    key(main, 'Escape');
    await settle();
    assert.deepEqual(env.navs, ['back:/r/' + env.ids.hsr], '这一页里的 Esc = 取消（没改，直接回去）');
  } finally { env.done(); }
});

test('编辑食谱：删掉写过东西的一行给 10 秒「撤销」，放回原来的位置；空行不给', async () => {
  const env = setup({ seed: seedRecipes });
  try {
    const main = env.mount(editView, { name: 'recipeEdit', id: env.ids.hsr }, { storage: env.storage });
    const names = () => allCls(main, 're-row').map(r => byCls(r, 're-name').value);
    const gone = allCls(main, 're-row')[1].dataset.key;
    byCls(allCls(main, 're-row')[1], 're-del').click();
    assert.deepEqual(names(), ['五花肉', '生抽', '香菜', '盐']);
    const tst = env.toasts.at(-1);
    assert.deepEqual([tst.msg, tst.ms, tst.action.label], ['删掉了「洋葱」', 10000, '撤销']);
    tst.action.run();
    assert.deepEqual(names(), ['五花肉', '洋葱', '生抽', '香菜', '盐'], '放回原来的位置');
    assert.equal(document.activeElement, fid(main, 're-del-' + gone));
    tst.action.run();
    assert.equal(names().length, 5, '再点一次不会多出一行');
    const n = env.toasts.length;
    fid(main, 're-add').click();
    byCls(allCls(main, 're-row')[5], 're-del').click();
    assert.equal(env.toasts.length, n, '空行删掉不用撤销');
  } finally { env.done(); }
});

test('编辑食谱：保存前这道食谱在别的设备上删掉了 → 问要不要存成新的；地址里的食谱不在 → 回「食谱」', async () => {
  const env = setup({ seed: seedRecipes });
  try {
    const id = env.ids.pan;
    const main = env.mount(editView, { name: 'recipeEdit', id }, { storage: env.storage });
    await type(fid(main, 're-name'), 'Fluffy Pancakes');
    state.mutate(s => { s.data.recipes[id] = deletedRecord(s.data.recipes[id]); });
    await settle();
    assert.equal(fid(env.main, 're-name').value, 'Fluffy Pancakes', '数据变了不重画：打的字还在');
    fid(main, 're-save').click();
    await settle();
    assert.equal(env.confirms.at(-1).confirmLabel, '存成新的');
    const fresh = Object.values(S().data.recipes).find(r => r.name === 'Fluffy Pancakes');
    assert.ok(fresh && fresh.id !== id && !fresh.deleted);
    assert.equal(env.navs.at(-1), 'replace:/r/' + fresh.id);
    env.mount(editView, { name: 'recipeEdit', id: 'r_nope' }, { storage: env.storage });
    await settle();
    assert.deepEqual([env.navs.at(-1), env.toasts.at(-1).msg], ['replace:/recipes', '这道食谱不在了']);
  } finally { env.done(); }
});

// ---------- 清单页：数量、编辑面板、联想 ----------
test('清单页：数量是自己加的 + 各道菜的（同单位相加，不同单位分开写）；编辑面板分开显示「自己加的」和「来自食谱」，能拿掉一份，保存才算', async () => {
  const env = setup({ seed: (s) => {
    const ids = seedRecipes(s);
    addFromInput(s, L, '洋葱 2个', now());
    const r = s.data.recipes[ids.hsr];
    addRecipeToList(s, r, { listId: L, keys: r.ings.filter(g => ['五花肉', '洋葱'].includes(g.name)).map(g => g.key), source: 'a:1' }, now());
    const c = s.data.recipes[saveRecipe(s, null, { name: '咖喱', ings: [{ name: '洋葱', qty: '200', unit: 'g' }] }, now()).id];
    addRecipeToList(s, c, { listId: L, keys: [c.ings[0].key], source: 'a:2' }, now());
    return ids;
  } });
  try {
    const main = env.mount(listView, { name: 'list', id: L });
    const qty = (name) => byCls(allCls(env.main, 'item-row').find(r => byCls(r, 'item-name').textContent === name), 'item-qty');
    assert.equal(qty('洋葱').textContent, '3 个 + 200 g');
    assert.deepEqual(allCls(qty('洋葱'), 'qty-part').map(x => x.textContent), ['3 个', '200 g'], '每份不拆开折行');
    assert.equal(qty('五花肉').textContent, '500 g', '只有这道菜的');
    // 编辑面板
    itemSheet(env.ctx, itemId(S(), L, '洋葱'));
    const sh = env.sheet();
    assert.ok(find(sh.el, el => el.tag === 'label' && el.textContent === '自己加的'));
    const needs = () => allCls(sh.el, 'need-row').filter(r => !r.hidden).map(r => [byCls(r, 'need-label').textContent, byCls(r, 'need-qty').textContent]);
    assert.deepEqual(needs(), [['红烧肉', '1 个'], ['咖喱', '200 g']]);
    assert.equal(byCls(sh.el, 'need-total').textContent, '清单上显示一共：3 个 + 200 g');
    // 改自己加的：一共跟着变
    const qtyIn = byCls(sh.el, 'qty-in');
    qtyIn.value = '4'; await qtyIn.fire('input');
    assert.equal(byCls(sh.el, 'need-total').textContent, '清单上显示一共：5 个 + 200 g');
    // 拿掉红烧肉那一份
    find(sh.el, el => el.attrs['aria-label'] === '拿掉「红烧肉」的这一份').click();
    assert.deepEqual(needs(), [['咖喱', '200 g']]);
    assert.equal(byCls(sh.el, 'need-total').textContent, '清单上显示一共：4 个 + 200 g');
    assert.equal(document.activeElement, find(sh.el, el => el.attrs['aria-label'] === '拿掉「咖喱」的这一份'), '焦点给下一份');
    assert.equal(Object.keys(S().data.items[itemId(S(), L, '洋葱')].needs).length, 2, '还没保存：数据没变');
    btn(sh.el, '保存').click();
    await settle();
    const it = S().data.items[itemId(S(), L, '洋葱')];
    assert.deepEqual([it.qty, Object.keys(it.needs)], [4, ['a:2']]);
    assert.equal(qty('洋葱').textContent, '4 个 + 200 g');
    // 没有食谱的东西：照旧叫「数量」，没有「来自食谱」
    state.mutate(s => addFromInput(s, L, '牛奶', now()));
    itemSheet(env.ctx, itemId(S(), L, '牛奶'));
    assert.ok(find(env.sheet().el, el => el.tag === 'label' && el.textContent === '数量'));
    assert.equal(byCls(env.sheet().el, 'need-list'), undefined);
  } finally { env.done(); }
});

test('快速添加：只是因为食谱在清单上的东西，再写一次带数量的（「洋葱 2」）记成自己加的、说一句；不带数量照旧「已经在清单上了」', async () => {
  const env = setup({ seed: (s) => {
    const ids = seedRecipes(s);
    const r = s.data.recipes[ids.hsr];
    addRecipeToList(s, r, { listId: L, keys: [r.ings[1].key], source: 'a:1' }, now());     // 洋葱 1 个
    return ids;
  } });
  try {
    const main = env.mount(listView, { name: 'list', id: L });
    const input = byCls(main, 'add-input');
    const qty = () => byCls(allCls(env.main, 'item-row').find(r => byCls(r, 'item-name').textContent === '洋葱'), 'item-qty').textContent;
    await type(input, '洋葱');
    key(input, 'Enter');
    await settle();
    assert.equal(env.toasts.at(-1).msg, '「洋葱」已经在清单上了');
    assert.equal(qty(), '1 个');
    await type(input, '洋葱 2个');
    key(input, 'Enter');
    await settle();
    assert.equal(env.toasts.at(-1).msg, '「洋葱」已经因为食谱在清单上了，另记了你自己要的 2 个');
    assert.equal(qty(), '3 个', '自己加的 2 个 + 红烧肉的 1 个');
    assert.equal(input.value, '');
  } finally { env.done(); }
});

test('快速添加：食材清单上打字时联想「用到它的食谱」（方向键能选到），点了打开「加到清单」、默认加到这张清单；一般清单不联想食谱', async () => {
  const env = setup({ seed: (s) => {
    const ids = seedRecipes(s);
    s.data.lists.l_week = normalizeRecord('lists', { id: 'l_week', name: '这周', kind: 'grocery', order: 5, updatedAt: 1 });
    return ids;
  } });
  try {
    const main = env.mount(listView, { name: 'list', id: 'l_week' });
    const input = byCls(main, 'add-input');
    await type(input, '五花');
    const box = byCls(main, 'sugs');
    assert.equal(box.hidden, false);
    assert.equal(byCls(box, 'sug-h').textContent, '用到它的食谱');
    assert.equal(byCls(box, 'sug-h').attrs.role, 'presentation');
    const opts = allCls(box, 'sug');
    assert.deepEqual(opts.map(o => byCls(o, 'sug-name').textContent), ['红烧肉']);
    assert.ok(cls(opts[0], 'sug-recipe') && opts[0].attrs.role === 'option');
    key(input, 'ArrowDown');
    assert.equal(input.attrs['aria-activedescendant'], 'lp-sug-0');
    key(input, 'Enter');
    const sh = env.sheet();
    assert.equal(sh.opts.title, '红烧肉');
    assert.equal(fid(sh.el, 'atl-list').value, 'l_week', '默认加到正在看的这张');
    assert.equal(byCls(main, 'sugs').hidden, true, '联想收起来');
    fid(sh.el, 'atl-go').click();
    await settle();
    assert.equal(totalLabel(S().data.items[itemId(S(), 'l_week', '五花肉')]), '500 g');
    // 买过的东西在前，食谱在后
    state.mutate(s => addFromInput(s, 'l_week', '五花肉丝', now()));
    await type(input, '五花');
    assert.deepEqual(allCls(byCls(env.main, 'sugs'), 'sug').map(o => [cls(o, 'sug-recipe'), byCls(o, 'sug-name').textContent]), [[false, '五花肉'], [false, '五花肉丝'], [true, '红烧肉']]);
    // 一般清单
    const m2 = env.mount(listView, { name: 'list', id: 'l_tobuy' });
    await type(byCls(m2, 'add-input'), '五花');
    assert.equal(byCls(byCls(m2, 'sugs'), 'sug-recipe'), undefined);
  } finally { env.done(); }
});

// ---------- 第 11 步：标签、卡片上的「加到清单」、食材替换、编辑页的标签 / 排序 / 重复、粘贴预览里的重复 ----------
/** 三道带标签的：水煮鱼（川菜 · 下饭）、剁椒鱼头（湘菜 · 宴客）、番茄炒蛋（快手 · 下饭）；再加 seedRecipes 的三道（没标签） */
function seedTagged(s) {
  const ids = seedRecipes(s);
  const id = (name, tags) => saveRecipe(s, null, { name, ings: [{ name: '鱼', qty: '1', unit: '条' }], tags }, now()).id;
  return { ...ids, fish: id('水煮鱼', { cuisine: ['川菜'], style: ['下饭'] }), head: id('剁椒鱼头', { cuisine: ['湘菜'], style: ['宴客'] }),
    quick: id('快手番茄蛋', { cuisine: [], style: ['快手', '下饭'] }) };
}

test('「食谱」页：卡片上写着标签；按标签筛选（一组里任一、两组之间都要），点了焦点还在那个标签上；没符合的说一句、能清除；选的标签没人用了自己去掉', async () => {
  const env = setup({ seed: seedTagged });
  try {
    const main = env.mount(recipesView, { name: 'recipes' });
    const names = () => allCls(env.main, 'rcp-row').map(r => byCls(r, 'rcp-name').textContent);
    const tagsOf = (name) => allCls(allCls(env.main, 'rcp-li').find(li => byCls(li, 'rcp-name').textContent === name), 'rcp-tag').map(x => x.textContent);
    assert.deepEqual(tagsOf('水煮鱼'), ['川菜', '下饭']);
    assert.deepEqual(tagsOf('红烧肉'), [], '没标签的不画');
    const rows = allCls(main, 'rcp-frow');
    assert.deepEqual(rows.map(r => r.attrs['aria-label']), ['菜系', '风格']);
    assert.deepEqual(allCls(rows[1], 'rcp-fchip').map(c => c.textContent), ['下饭', '快手', '宴客'], '用得多的在前，一样多按名字（拼音）');
    const chip = (g, name) => fid(env.main, `rcp-f-${g}-${hash64(tagId(g, name))}`);
    chip('cuisine', '川菜').click();
    chip('cuisine', '湘菜').click();
    assert.deepEqual(names(), ['剁椒鱼头', '水煮鱼'], '一组里任一');
    assert.equal(document.activeElement, chip('cuisine', '湘菜'), '焦点还在刚点的标签上');
    assert.equal(chip('cuisine', '湘菜').attrs['aria-pressed'], 'true');
    chip('style', '下饭').click();
    assert.deepEqual(names(), ['水煮鱼'], '两组之间都要');
    assert.equal(main.querySelector('[role="status"]').textContent, '找到 1 道食谱');
    chip('style', '下饭').click();
    chip('style', '快手').click();
    assert.equal(byCls(env.main, 'lp-empty').textContent, '没有符合筛选的食谱' + t('rcp.filterNoneHint') + '清除筛选');
    fid(env.main, 'rcp-fclear2').click();
    assert.equal(names().length, 6, '清除筛选');
    assert.equal(document.activeElement, byCls(env.main, 'rcp-search'));
    assert.equal(fid(env.main, 'rcp-fclear').hidden, true, '没筛的时候没有「清除筛选」');
    assert.ok(!byCls(env.main, 'rcp-filter').textContent.includes('null'), '没有写成字的 null');
    // 选了湘菜，然后那道菜的标签被改掉了（别的设备）：不再筛着一个看不见的标签
    chip('cuisine', '湘菜').click();
    assert.deepEqual(names(), ['剁椒鱼头']);
    state.mutate(s => saveRecipe(s, env.ids.head, { name: '剁椒鱼头', tags: { cuisine: [], style: [] } }, now()));
    await settle();
    assert.equal(names().length, 6);
    assert.equal(chip('cuisine', '湘菜'), null);
  } finally { env.done(); }
});

test('「食谱」页：每张卡片右边的购物车直接打开「加到清单」（点卡片别的地方照旧去那道食谱）；加完不重画卡片，焦点不丢；没有食谱时没有「食材替换」', async () => {
  let env = setup();
  try {
    const main = env.mount(recipesView, { name: 'recipes' });
    assert.equal(fid(main, 'rcp-replace').hidden, true, '没有食谱：不画「食材替换」');
  } finally { env.done(); }
  env = setup({ seed: seedRecipes });
  try {
    const main = env.mount(recipesView, { name: 'recipes' });
    assert.equal(fid(main, 'rcp-replace').hidden, false);
    const cart = fid(main, 'rcp-cart-' + env.ids.hsr);
    assert.equal(cart.tag, 'button');
    assert.equal(cart.attrs['aria-label'], '把「红烧肉」加到清单');
    assert.ok(cls(cart, 'icon-btn'), '44px 的点按区域（.icon-btn）');
    assert.equal(fid(main, 'rcp-open-' + env.ids.hsr).attrs.href, '#/r/' + env.ids.hsr);
    assert.ok(!fid(main, 'rcp-open-' + env.ids.hsr).contains(cart), '按钮不在链接里面');
    cart.focus();
    cart.click();
    const sh = env.sheet();
    assert.equal(sh.title, '红烧肉');
    fid(sh.el, 'atl-go').click();
    assert.equal(sh.open, false);
    await settle();
    assert.equal(Object.values(S().data.items).filter(i => i.needs && Object.keys(i.needs).length).length, 3, '五花肉、洋葱、盐加进清单');
    assert.equal(fid(env.main, 'rcp-cart-' + env.ids.hsr), cart, '和食谱无关的修改：卡片不重画');
    assert.equal(document.activeElement, cart);
  } finally { env.done(); }
});

test('食材替换：搜一样 → 看用到它的食谱和那几行 → 写新名字 → 一次改完（常备品跟着换）、能撤销；空的、一样的不让换；「返回」回到搜索', async () => {
  const env = setup({ seed: (s) => {
    const ids = seedRecipes(s);
    saveRecipe(s, null, { name: '凉拌黄瓜', ings: [{ name: '黄瓜', qty: '2', unit: '根' }, { name: '生抽', qty: '1', unit: '勺', note: '最后淋' }] }, now());
    return ids;
  } });
  try {
    const main = env.mount(recipesView, { name: 'recipes' });
    fid(main, 'rcp-replace').click();
    const sh = env.sheet();
    assert.equal(sh.title, '食材替换');
    assert.equal(document.activeElement, fid(sh.el, 'rep-q'));
    assert.equal(fid(sh.el, 'rep-go').hidden, true, '先选一样');
    await type(fid(sh.el, 'rep-q'), '抽');
    assert.deepEqual(allCls(sh.el, 'rep-hit').map(b => [byCls(b, 'rep-name').textContent, byCls(b, 'rep-n').textContent]), [['生抽', '2 道食谱']]);
    await type(fid(sh.el, 'rep-q'), '佛跳墙');
    assert.equal(byCls(sh.el, 'rep-none').textContent, '食谱里没有「佛跳墙」');
    await type(fid(sh.el, 'rep-q'), '生抽');
    fid(sh.el, 'rep-hit-0').click();
    assert.equal(sh.title, '替换「生抽」');
    assert.deepEqual(allCls(sh.el, 'rep-rec').map(r => [byCls(r, 'rep-rec-name').textContent, allCls(r, 'rep-row').map(x => x.textContent)]),
      [['红烧肉', ['生抽 · 2 勺']], ['凉拌黄瓜', ['生抽 · 1 勺 · 最后淋']]]);
    assert.equal(byCls(sh.el, 'rep-staple').textContent, '「生抽」是常备品，新名字也会标上。');
    const to = fid(sh.el, 'rep-to');
    assert.equal(to.value, '生抽');
    assert.equal(document.activeElement, to);
    fid(sh.el, 'rep-go').click();
    assert.equal(byCls(sh.el, 'f-err').textContent, '和原来的一样');
    await type(to, '  ');
    fid(sh.el, 'rep-go').click();
    assert.equal(byCls(sh.el, 'f-err').textContent, '写一个新名字');
    // 返回：回到搜索，字还在
    fid(sh.el, 'rep-back').click();
    assert.deepEqual([byCls(sh.el, 'rep-1').hidden, fid(sh.el, 'rep-q').value, sh.title], [false, '生抽', '食材替换']);
    fid(sh.el, 'rep-hit-0').click();
    // 「换成」在食谱列表上面（几十道食谱用到时输入框、出错的提示不会在屏幕外面）
    const step2 = byCls(sh.el, 'rep-2').children;
    const at = (el) => step2.indexOf(el);
    assert.ok(at(byCls(sh.el, 'rep-to').parent) >= 0 && at(byCls(sh.el, 'rep-to').parent) < at(byCls(sh.el, 'rep-in')), '「换成」在前');
    // 新名字这道菜里已经有了：说一句会有两行（不拦着）
    const dup = byCls(sh.el, 'rep-dup');
    assert.equal(dup.hidden, true);
    await type(fid(sh.el, 'rep-to'), '盐');
    assert.deepEqual([dup.hidden, dup.textContent], [false, '「红烧肉」里已经有「盐」，换了以后会有两行。']);
    await type(fid(sh.el, 'rep-to'), '酱油');
    assert.equal(dup.hidden, true);
    key(fid(sh.el, 'rep-to'), 'Enter');
    assert.equal(sh.open, false);
    const all = () => Object.values(S().data.recipes).flatMap(r => r.ings.map(g => g.name));
    assert.equal(all().filter(n => n === '酱油').length, 2);
    assert.equal(all().includes('生抽'), false);
    assert.ok(isStaple(S(), '酱油') && !isStaple(S(), '生抽'));
    assert.equal(state.peekUndo(), '已在 2 道食谱里换掉「生抽」');
    state.undo();
    assert.equal(all().filter(n => n === '生抽').length, 2, '撤销：全回来');
    assert.ok(isStaple(S(), '生抽') && !isStaple(S(), '酱油'));
  } finally { env.done(); }
});

const tagFid = (g, name) => `re-tag-${g}-${hash64(tagId(g, name))}`;
test('编辑食谱：标签——预设（界面语言）和别的食谱用过的都列出来，点一下选上、再点取消；「自己加」开名字面板；保存进食谱，食谱页上看得到', async () => {
  const env = setup({ seed: seedTagged });
  try {
    let main = env.mount(editView, { name: 'recipeEdit', id: env.ids.hsr }, { storage: env.storage });
    const chips = (g) => allCls(find(main, el => el.dataset && el.dataset.group === g), 're-tag').map(c => c.textContent);
    assert.deepEqual(chips('cuisine').slice(0, 3), ['川菜', '粤菜', '湘菜']);
    assert.equal(chips('cuisine').length, 14, '预设 14 个（别的食谱用过的川菜、湘菜就是预设）');
    assert.ok(chips('style').includes('下饭') && chips('style').includes('宴客'));
    fid(main, tagFid('cuisine', '川菜')).click();
    assert.equal(fid(main, tagFid('cuisine', '川菜')).attrs['aria-pressed'], 'true');
    fid(main, tagFid('style', '快手')).click();
    fid(main, tagFid('style', '快手')).click();
    assert.equal(fid(main, tagFid('style', '快手')).attrs['aria-pressed'], 'false', '再点一下取消');
    fid(main, 're-tag-add-style').click();
    const sh = env.sheet();
    assert.equal(sh.title, '加一个风格');
    const nameIn = find(sh.el, el => el.tag === 'input');
    btn(sh.el, '添加').click();
    assert.equal(sh.open, true, '空的不加');
    assert.equal(byCls(sh.el, 'f-err').textContent, '名字不能空着');
    nameIn.value = ' 空气炸锅 ';
    btn(sh.el, '添加').click();
    assert.equal(sh.open, false);
    assert.equal(fid(main, tagFid('style', '空气炸锅')).attrs['aria-pressed'], 'true', '自己加的列在最后、选上了');
    fid(main, 're-save').click();
    await settle();
    assert.deepEqual(liveRecipe(S(), env.ids.hsr).tags, { cuisine: ['#sichuan'], style: ['空气炸锅'] }, '预设存键，自己加的存字');
    main = env.mount(recipeView, { name: 'recipe', id: env.ids.hsr });
    assert.deepEqual(allCls(byCls(main, 'rcp-page-tags'), 'rcp-tag').map(x => x.textContent), ['川菜', '空气炸锅']);
    // 别的食谱的编辑页：「空气炸锅」是用过的，也列出来（没选上）
    main = env.mount(editView, { name: 'recipeEdit', id: env.ids.egg }, { storage: env.storage });
    assert.equal(fid(main, tagFid('style', '空气炸锅')).attrs['aria-pressed'], 'false');
  } finally { env.done(); }
});

// ---------- 管理标签 ----------
/** seedTagged 再加一道存着旧写法的：番茄意面（「義式」· 空气炸锅） */
function seedManaged(s) {
  const ids = seedTagged(s);
  return { ...ids, pasta: saveRecipe(s, null, { name: '番茄意面', ings: [{ name: '意面', qty: '200', unit: 'g' }], tags: { cuisine: ['義式'], style: ['空气炸锅'] } }, now()).id };
}
const tmRows = (sh, g) => allCls(find(sh.el, el => el.tag === 'section' && el.attrs['aria-label'] === t('rcp.tag.' + g)), 'tm-row')
  .map(r => [byCls(r, 'tm-name').textContent, (byCls(r, 'tm-n') || byCls(r, 'tm-hidden') || { textContent: '' }).textContent]);
const tmBtn = (sh, kind, g, tag) => fid(sh.el, `tm-${kind}-${g}-${hash64(tagId(g, tag))}`);

test('管理标签：筛选下面「管理标签」打开面板，每组列用着的标签和几道、没用到的预设；改名（合并、一样的不改）一次改完能撤销，筛选和面板跟着变', async () => {
  const env = setup({ seed: seedManaged });
  try {
    const main = env.mount(recipesView, { name: 'recipes' });
    const mgr = fid(main, 'rcp-tagmgr');
    assert.equal(mgr.textContent, '管理标签');
    assert.equal(byCls(main, 'rcp-ftools').hidden, false);
    mgr.click();
    const sh = env.sheet();
    assert.equal(sh.title, '管理标签');
    assert.deepEqual(tmRows(sh, 'cuisine').slice(0, 3), [['川菜', '1 道食谱'], ['湘菜', '1 道食谱'], ['意式', '1 道食谱']], '旧的「義式」显示成现在的写法');
    assert.deepEqual(tmRows(sh, 'style').slice(0, 4), [['下饭', '2 道食谱'], ['空气炸锅', '1 道食谱'], ['快手', '1 道食谱'], ['宴客', '1 道食谱']]);
    assert.equal(byCls(sh.el, 'tm-sub').textContent, '没用到的预设');
    assert.ok(tmRows(sh, 'cuisine').some(([n, x]) => n === '墨西哥' && x === ''), '没用到的预设也列出来');
    assert.equal(tmBtn(sh, 'ren', 'style', '空气炸锅').attrs['aria-label'], '给「空气炸锅」改名');
    assert.equal(tmBtn(sh, 'del', 'style', '空气炸锅').attrs['aria-label'], '删除「空气炸锅」');
    assert.equal(tmBtn(sh, 'ren', 'cuisine', '墨西哥'), null, '没用到的没有改名、删除');
    // 改成和原来一样：不改，说一句
    tmBtn(sh, 'ren', 'style', '下饭').click();
    let ns = env.sheet();
    assert.equal(ns.title, '给「下饭」改名');
    const nameIn = () => find(env.sheet().el, el => el.tag === 'input');
    assert.equal(nameIn().value, '下饭');
    btn(ns.el, '保存').click();
    assert.deepEqual([ns.open, byCls(ns.el, 'f-err').textContent], [true, '和原来的一样']);
    ns.close();
    // 自己写的「空气炸锅」改成「快手」（预设的字）：番茄意面上变成快手，和已有的合并
    tmBtn(sh, 'ren', 'style', '空气炸锅').click();
    ns = env.sheet();
    nameIn().value = '快手';
    btn(ns.el, '保存').click();
    assert.equal(ns.open, false);
    assert.equal(state.peekUndo(), '已把「空气炸锅」合并到「快手」');
    assert.deepEqual(liveRecipe(S(), env.ids.pasta).tags.style, ['#quick']);
    await settle();
    assert.deepEqual(tmRows(sh, 'style').slice(0, 3), [['快手', '2 道食谱'], ['下饭', '2 道食谱'], ['宴客', '1 道食谱']], '一样多的按拼音');
    assert.equal(document.activeElement, tmBtn(sh, 'ren', 'style', '快手'), '焦点回到改好的那一行');
    assert.equal(fid(env.main, `rcp-f-style-${hash64('空气炸锅')}`), null, '筛选里也没有了');
    // 撤销：全回来，面板跟着重画
    state.undo();
    await settle();
    assert.deepEqual(liveRecipe(S(), env.ids.pasta).tags.style, ['空气炸锅']);
    assert.ok(tmRows(sh, 'style').some(([n]) => n === '空气炸锅'));
  } finally { env.done(); }
});

test('管理标签：删除先问（说几道、焦点给取消），确定了所有食谱上去掉、能撤销，删掉的预设挪到「没用到的预设」；预设能「不在选项里显示」/「恢复」，编辑页跟着变', async () => {
  const env = setup({ seed: seedManaged });
  try {
    let main = env.mount(recipesView, { name: 'recipes' });
    fid(main, 'rcp-tagmgr').click();
    const sh = env.sheet();
    env.answer = false;
    tmBtn(sh, 'del', 'style', '下饭').click();
    await settle();
    assert.deepEqual(env.confirms.at(-1), { title: '删除标签「下饭」？', message: '2 道食谱上的这个标签会去掉，食谱本身不删。', confirmLabel: '删除', danger: true });
    assert.deepEqual(liveRecipe(S(), env.ids.fish).tags.style, ['#withRice'], '取消了：不改');
    env.answer = true;
    tmBtn(sh, 'del', 'style', '下饭').click();
    await settle();
    assert.deepEqual([liveRecipe(S(), env.ids.fish).tags.style, liveRecipe(S(), env.ids.quick).tags.style], [[], ['#quick']]);
    assert.equal(liveRecipe(S(), env.ids.fish).name, '水煮鱼', '食谱本身还在');
    assert.equal(state.peekUndo(), '已删除标签「下饭」');
    assert.ok(!tmRows(sh, 'style').some(([n, x]) => n === '下饭' && x), '用着的里没有了');
    assert.equal(document.activeElement, tmBtn(sh, 'hide', 'style', '下饭'), '焦点给它的「不在选项里显示」');
    state.undo();
    await settle();
    assert.deepEqual(tmRows(sh, 'style')[0], ['下饭', '2 道食谱']);
    // 藏起「墨西哥」：设置里记下，按钮变成「恢复」，焦点不丢；编辑页的选项里没有它
    const hideBtn = () => tmBtn(sh, 'hide', 'cuisine', '#mexican');
    assert.deepEqual([hideBtn().textContent, hideBtn().attrs['aria-label']], ['不在选项里显示', '「墨西哥」不在选项里显示']);
    hideBtn().focus();
    hideBtn().click();
    assert.ok(isTagHidden(S(), 'cuisine', '#mexican'));
    assert.deepEqual([hideBtn().textContent, document.activeElement === hideBtn()], ['恢复', true]);
    assert.ok(tmRows(sh, 'cuisine').some(([n, x]) => n === '墨西哥' && x === '不在选项里'));
    sh.close();
    main = env.mount(editView, { name: 'recipeEdit', id: env.ids.hsr }, { storage: env.storage });
    const chips = () => allCls(find(main, el => el.dataset && el.dataset.group === 'cuisine'), 're-tag').map(c => c.textContent);
    assert.ok(!chips().includes('墨西哥') && chips().includes('意式'), '藏起来的预设不在编辑页的选项里');
    state.mutate(s => { s.settings['hiddenTags.cuisine.mexican'] = null; s.settingsAt['hiddenTags.cuisine.mexican'] = now(); });
    await settle();
    main = env.mount(editView, { name: 'recipeEdit', id: env.ids.hsr }, { storage: env.storage });
    assert.ok(chips().includes('墨西哥'), '恢复了又列出来');
  } finally { env.done(); }
});

test('预设标签按界面语言显示：旧数据里的「義式」在繁体是「意式」、英文是 Italian；编辑页上是同一个开关（按下了）', async () => {
  for (const [lang, word] of [['zh-Hant-TW', '意式'], ['en', 'Italian'], ['zh-Hans', '意式']]) {
    const env = setup({ seed: seedManaged, lang });
    try {
      let main = env.mount(recipesView, { name: 'recipes' });
      const card = allCls(main, 'rcp-li').find(li => byCls(li, 'rcp-name').textContent === '番茄意面');
      assert.deepEqual(allCls(card, 'rcp-tag').map(x => x.textContent)[0], word, lang);
      main = env.mount(recipeView, { name: 'recipe', id: env.ids.pasta });
      assert.equal(allCls(byCls(main, 'rcp-page-tags'), 'rcp-tag')[0].textContent, word);
      main = env.mount(editView, { name: 'recipeEdit', id: env.ids.pasta }, { storage: env.storage });
      const on = allCls(find(main, el => el.dataset && el.dataset.group === 'cuisine'), 're-tag').filter(c => c.attrs['aria-pressed'] === 'true').map(c => c.textContent);
      assert.deepEqual(on, [word], '只有一个，不会「義式」「意式」各一个');
    } finally { env.done(); }
  }
});

test('编辑食谱：「按类别重新排」整张按组排；↑↓ 排过以后「加一样」写的保存时只放进它那一组的最后；新建的「加一样」写的保存时整张按组排', async () => {
  const env = setup({ seed: seedRecipes });
  try {
    let main = env.mount(editView, { name: 'recipeEdit', id: env.ids.hsr }, { storage: env.storage });
    const rowNames = () => allCls(env.main, 're-row').map(r => byCls(r, 're-name').value);
    assert.deepEqual(rowNames(), ['五花肉', '洋葱', '生抽', '香菜', '盐'], '以前存的顺序不动');
    fid(main, 're-sort').click();
    assert.deepEqual(rowNames(), ['五花肉', '洋葱', '香菜', '生抽', '盐']);
    assert.equal(document.activeElement, fid(main, 're-sort'));
    assert.match(env.toasts.at(-1).msg, /^已按类别排好/);
    const salt = allCls(main, 're-row')[4].dataset.key;
    fid(main, 're-up-' + salt).click();                             // 盐挪到生抽前面：手动排过
    assert.deepEqual(rowNames(), ['五花肉', '洋葱', '香菜', '盐', '生抽']);
    fid(main, 're-add').click();
    await type(allCls(main, 're-name').at(-1), '排骨');
    assert.equal(rowNames().at(-1), '排骨', '写着的时候不挪');
    fid(main, 're-save').click();
    await settle();
    const r = liveRecipe(S(), env.ids.hsr);
    assert.deepEqual(r.ings.map(g => g.name), ['五花肉', '排骨', '洋葱', '香菜', '盐', '生抽'], '排过：别的不动，排骨放进肉那一组的最后');
    assert.equal(r.ordered, true);
    // 再「按类别重新排」：去掉 ordered
    main = env.mount(editView, { name: 'recipeEdit', id: env.ids.hsr }, { storage: env.storage });
    fid(main, 're-sort').click();
    fid(main, 're-save').click();
    await settle();
    assert.equal('ordered' in liveRecipe(S(), env.ids.hsr), false);
    // 新建：一样一样加的，保存时按类别排
    main = env.mount(editView, { name: 'recipeEdit', sub: 'new' }, { storage: env.storage });
    await type(fid(main, 're-name'), '炒青菜');
    for (const n of ['盐', '青菜', '蒜']) { fid(main, 're-add').click(); await type(allCls(main, 're-name').at(-1), n); }
    fid(main, 're-save').click();
    await settle();
    const made = Object.values(S().data.recipes).find(x => x.name === '炒青菜');
    assert.deepEqual(made.ings.map(g => g.name), ['青菜', '蒜', '盐']);
  } finally { env.done(); }
});

test('编辑食谱：手动加的这道菜里已经有 → 那一行下面提醒（就地插进去，不重画）；「合并」单位一样数量相加、能撤销；「仍然加一行」不再提醒', async () => {
  const env = setup({ seed: seedRecipes });
  try {
    const main = env.mount(editView, { name: 'recipeEdit', id: env.ids.hsr }, { storage: env.storage });
    fid(main, 're-add').click();
    const row = () => allCls(main, 're-row').at(-1);
    const k = row().dataset.key;
    await type(fid(main, 're-name-' + k), '生抽');
    await type(fid(main, 're-qty-' + k), '1');
    await type(fid(main, 're-unit-' + k), '勺');
    const qtyIn = fid(main, 're-qty-' + k);
    await fid(main, 're-name-' + k).fire('change');
    assert.equal(byCls(row(), 're-dup-msg').textContent, '这道菜里已经有「生抽」了');
    assert.equal(fid(main, 're-qty-' + k), qtyIn, '提醒是插进去的：这一行的输入框还是原来的（刚点的下一个框不丢）');
    fid(main, 're-merge-' + k).click();
    const rows = () => allCls(main, 're-row').map(r => [byCls(r, 're-name').value, byCls(r, 're-qty').value, byCls(r, 're-unit').value]);
    assert.deepEqual(rows().find(r => r[0] === '生抽'), ['生抽', '3', '勺'], '2 勺 + 1 勺');
    assert.equal(rows().length, 5, '这一行并进去了');
    const soy = allCls(main, 're-row').find(r => byCls(r, 're-name').value === '生抽').dataset.key;
    assert.equal(document.activeElement, fid(main, 're-qty-' + soy), '焦点给合并到的那一行的数量');
    assert.equal(env.toasts.at(-1).msg, '已合并到「生抽」');
    env.toasts.at(-1).action.run();
    assert.deepEqual(rows().slice(2), [['生抽', '2', '勺'], ['香菜', '', ''], ['盐', '', ''], ['生抽', '1', '勺']], '撤销：两行都回来，原样');
    assert.ok(!byCls(allCls(main, 're-row').at(-1), 're-dup-msg'), '撤销回来的不再提醒');
    // 「仍然加一行」：腌料、调味各一份盐
    fid(main, 're-add').click();
    const k2 = row().dataset.key;
    await type(fid(main, 're-name-' + k2), '鹽');
    await fid(main, 're-name-' + k2).fire('change');
    assert.equal(byCls(row(), 're-dup-msg').textContent, '这道菜里已经有「盐」了', '简繁一样算重复');
    fid(main, 're-keep-' + k2).click();
    assert.ok(!byCls(row(), 're-dup-msg'));
    assert.equal(document.activeElement, fid(main, 're-qty-' + k2));
    await fid(main, 're-name-' + k2).fire('change');
    assert.ok(!byCls(row(), 're-dup-msg'), '同一个名字不再提醒');
    await type(fid(main, 're-name-' + k2), '冰糖');
    await fid(main, 're-name-' + k2).fire('change');
    assert.ok(!byCls(row(), 're-dup-msg'), '不重复了');
    fid(main, 're-save').click();
    await settle();
    assert.equal(liveRecipe(S(), env.ids.hsr).ings.filter(g => g.name === '生抽').length, 2);
  } finally { env.done(); }
});

test('粘贴食材：这道菜里已经有的、这次贴的上面已经有的标「重复」、默认不加，「仍然加一行」勾上才加；改了名字就地重新认', async () => {
  const env = setup({ seed: seedRecipes });
  try {
    const main = env.mount(editView, { name: 'recipeEdit', id: env.ids.hsr }, { storage: env.storage });
    fid(main, 're-paste').click();
    const sh = env.sheet();
    await type(byCls(sh.el, 'paste-in'), '生抽 1勺、蚝油 1勺、冰糖 20g、蚝油 2勺');
    fid(sh.el, 'paste-go').click();
    const dups = () => allCls(sh.el, 'paste-row').map(r => { const d = byCls(r, 'paste-dup'); return d.hidden ? null : byCls(d, 'paste-dup-msg').textContent; });
    assert.deepEqual(dups(), ['这道菜里已经有「生抽」了', null, null, '上面已经有「蚝油」了']);
    assert.equal(byCls(sh.el, 'paste-duphelp').hidden, false);
    assert.deepEqual([!!fid(sh.el, 'paste-keep-0').checked, !!fid(sh.el, 'paste-keep-3').checked], [false, false], '重复的默认不加');
    // 第一样改成老抽：不重复了（就地认，不重画）
    const first = byCls(allCls(sh.el, 'paste-row')[0], 'paste-name');
    await type(first, '老抽');
    await first.fire('change');
    assert.equal(byCls(allCls(sh.el, 'paste-row')[0], 'paste-name'), first, '输入框还是原来的');
    assert.deepEqual(dups(), [null, null, null, '上面已经有「蚝油」了']);
    // 第二份蚝油也要
    fid(sh.el, 'paste-keep-3').checked = true;
    await fid(sh.el, 'paste-keep-3').fire('change');
    fid(sh.el, 'paste-go').click();
    assert.equal(sh.open, false);
    const names = allCls(main, 're-row').map(r => byCls(r, 're-name').value);
    assert.deepEqual(names, ['五花肉', '洋葱', '生抽', '香菜', '盐', '老抽', '蚝油', '冰糖', '蚝油'], '已经存过的食谱：原来的几行不挪（香菜还在生抽后面），粘贴的放进各自那一组的最后');
  } finally { env.done(); }
});
