// 真实 App（src/app.js）里的计划：底栏五个（清单 · 商店 · 食谱 · 计划 · 设置）每个都去对的页面、对的那个亮着；侧栏的「计划」；
// #/plan 是顶层页面（手机上有底栏）；不管哪种布局都是一栏（双栏只给清单、商店、食谱）；从计划点一道菜「打开食谱」再返回，还是那一周。全是编的数据
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Element, all, find, fakeStorage, installDom } from './helpers/dom.mjs';
import { todayDay, addDays, weekStart } from '../src/core/dates.js';

const cls = (el, c) => (el.className || el.attrs.class || '').split(' ').includes(c);
const byCls = (root, c) => find(root, el => cls(el, c));

test('底栏五个都去对的页面；计划页是顶层页面、一栏；侧栏有「计划」', async () => {
  const storage = fakeStorage();
  let hashNow = '#/';
  const loc = { protocol: 'http:', get hash() { return hashNow; }, set hash(v) { hashNow = v; } };
  const media = {};
  const mq = q => (media[q] ||= { matches: false, listeners: [], addEventListener(type, fn) { this.listeners.push(fn); } });
  const dom = installDom({ localStorage: storage, location: loc, history: { state: {}, replaceState(s, title, hash) { hashNow = hash; }, back() {} },
    navigator: { languages: ['zh-CN'], locks: { request: async (name, fn) => fn() } },
    matchMedia: mq, setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, getComputedStyle: () => ({ bottom: '24px' }), requestAnimationFrame: () => 0,
    MutationObserver: class { observe() {} disconnect() {} }, CSS: { escape: String } });
  // <dialog>：补上 showModal / close（面板要用）
  const make = dom.doc.createElement;
  dom.doc.createElement = (tag) => {
    const el = make(tag);
    if (tag === 'dialog') { el.showModal = () => { el.open = true; el.attrs.open = ''; }; el.close = () => { el.open = false; delete el.attrs.open; el.fire('close'); }; }
    return el;
  };
  try {
    const shell = new Element('div'); shell.className = 'app';
    for (const id of ['side', 'main']) { const el = new Element('div'); el.id = id; shell.append(el); }
    const tabs = new Element('nav'); tabs.id = 'tabs';
    dom.doc.body.append(shell, tabs);
    await import('../src/app.js?test=plan');
    const { ctx } = window.__picknest;
    const main = dom.doc.querySelector('#main'), body = dom.doc.body, side = dom.doc.querySelector('#side');
    const settle = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise(r => queueMicrotask(r)); };
    const go = async hash => { loc.hash = hash; await window.fire('hashchange'); await settle(); };
    const resize = (w) => {
      mq('(min-width: 720px)').matches = w >= 720;
      mq('(min-width: 1000px)').matches = w >= 1000;
      for (const m of Object.values(media)) for (const fn of m.listeners) fn();
    };
    const panes = () => main.children.map(el => el.className);
    const current = () => tabs.children.map(a => a.attrs['aria-current'] || null);

    // 手机：底栏五个，每个都是顶层页面（有底栏），点了那个亮着
    assert.deepEqual(tabs.children.map(a => [a.attrs.href, a.textContent]), [['#/', '清单'], ['#/stores', '商店'], ['#/recipes', '食谱'], ['#/plan', '计划'], ['#/settings', '设置']]);
    const want = { '#/': 'lists', '#/stores': 'stores', '#/recipes': 'recipes', '#/plan': 'plan', '#/settings': 'settings' };
    for (const [i, a] of tabs.children.entries()) {
      await go(a.attrs.href);
      assert.deepEqual([body.dataset.route, body.dataset.tabs], [want[a.attrs.href], '1'], a.attrs.href);
      assert.deepEqual(current(), tabs.children.map((x, j) => (j === i ? 'page' : null)), a.attrs.href);
    }
    await go('#/plan');
    assert.equal(main.querySelector('h1').textContent, '计划');
    assert.equal(main.querySelectorAll('.plan-day').length, 7);

    // 加一道菜（连着食谱），点它「打开食谱」：推进去的食谱页，底栏、侧栏算在「食谱」下面；返回写「计划」
    const r = ctx.put('recipes', { name: '红烧肉', servings: 2, ings: [{ name: '五花肉', qty: 500, unit: 'g' }] });
    const next = addDays(weekStart(todayDay()), 9);
    const p = ctx.put('plan', { date: next, meal: 'dinner', recipeId: r.id, title: '红烧肉', servings: 2 });
    assert.match(p.id, /^p_/);
    await settle();
    main.querySelector('[data-fid="plan-next"]').click();
    await settle();
    assert.ok(main.querySelector(`[data-fid="pd-${p.id}"]`), '下一周里有这道菜');
    main.querySelector(`[data-fid="pd-${p.id}"]`).click();
    const dlg = find(body, el => el.tag === 'dialog' && el.open);
    await dlg.querySelector('[data-fid="dish-open"]').click();
    await settle();
    assert.equal(body.dataset.route, 'recipe');
    assert.equal(byCls(main, 'back').textContent, '计划', '返回写回去的那一页');
    assert.equal(byCls(side, 'on').attrs.href, '#/recipes');
    await go('#/plan');
    assert.ok(main.querySelector(`[data-fid="pd-${p.id}"]`), '回来还是那一周（这次打开期间记着）');

    // 宽屏：侧栏里「计划」在食谱下面、搜索上面，亮着；双栏的宽度也只有一栏
    resize(800);
    assert.deepEqual(all(side.querySelector('nav'), el => el.tag === 'a').map(a => a.attrs.href), ['#/', '#/stores', '#/recipes', '#/plan', '#/search']);
    assert.equal(byCls(side, 'on').attrs.href, '#/plan');
    resize(1200);
    assert.deepEqual(panes(), ['pane pane-main view view-plan']);
    await go('#/recipes');
    assert.deepEqual(panes(), ['pane pane-list view view-recipes', 'pane pane-detail view view-empty'], '食谱照旧两栏');
    await go('#/plan');
    assert.deepEqual(panes(), ['pane pane-main view view-plan']);
  } finally { dom.restore(); }
});
