// 真实 App（src/app.js）里的日历（第 13 步以前叫「计划」）：底栏五个（清单 · 商店 · 食谱 · 日历 · 设置）每个都去对的页面、对的那个亮着；侧栏的「日历」；
// #/calendar 是顶层页面（手机上有底栏），以前的 #/plan 照样打开同一页；不管哪种布局都是一栏（双栏只给清单、商店、食谱）；
// 从日历点一道菜「打开食谱」再返回，还是那一周；计划里的菜「吃了」记进饮食记录、这一天下面列出来；设置 → 饮食目标是推入的页面。全是编的数据
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Element, all, find, fakeStorage, installDom } from './helpers/dom.mjs';
import { todayDay, addDays, weekStart } from '../src/core/dates.js';
import { goalsOf } from '../src/core/log.js';

const cls = (el, c) => (el.className || el.attrs.class || '').split(' ').includes(c);
const byCls = (root, c) => find(root, el => cls(el, c));

test('底栏五个都去对的页面；日历是顶层页面、一栏，#/plan 照样能打开；侧栏有「日历」；「吃了」记下来；饮食目标', async () => {
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
  // 滚到哪：记下滚进来的是哪一天的卡片
  const scrolls = [];
  Element.prototype.scrollIntoView = function () { scrolls.push(this.dataset.day || this.tag); };
  const TODAY = todayDay(), MON = weekStart(TODAY);
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
    assert.deepEqual(tabs.children.map(a => [a.attrs.href, a.textContent]), [['#/', '清单'], ['#/stores', '商店'], ['#/recipes', '食谱'], ['#/calendar', '日历'], ['#/settings', '设置']]);
    const want = { '#/': 'lists', '#/stores': 'stores', '#/recipes': 'recipes', '#/calendar': 'plan', '#/settings': 'settings' };
    for (const [i, a] of tabs.children.entries()) {
      await go(a.attrs.href);
      assert.deepEqual([body.dataset.route, body.dataset.tabs], [want[a.attrs.href], '1'], a.attrs.href);
      assert.deepEqual(current(), tabs.children.map((x, j) => (j === i ? 'page' : null)), a.attrs.href);
    }
    // 以前的地址（主屏幕上、书签里）照样打开日历，底栏上「日历」亮着
    await go('#/plan');
    assert.deepEqual([body.dataset.route, body.dataset.tabs, current()[3]], ['plan', '1', 'page']);
    assert.equal(main.querySelector('h1').textContent, '日历');
    assert.equal(main.querySelectorAll('.plan-day').length, 7);
    await go('#/calendar');
    // 点底栏进来（新打开）：滚到今天的卡片（周一本来就在上面，不滚）
    assert.deepEqual(scrolls.slice(-1), TODAY === MON ? [] : [TODAY]);

    // 加一道菜（连着食谱），点它「打开食谱」：推进去的食谱页，底栏、侧栏算在「食谱」下面；返回写「日历」
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
    assert.equal(byCls(main, 'back').textContent, '日历', '返回写回去的那一页');
    assert.equal(byCls(side, 'on').attrs.href, '#/recipes');
    await go('#/calendar');
    assert.ok(main.querySelector(`[data-fid="pd-${p.id}"]`), '回来还是那一周（这次打开期间记着）');
    // 这一周的菜点进食谱再后退回来：恢复原来的位置，不再滚到今天（app 只在新打开时调 land）
    main.querySelector('[data-fid="plan-today"]').click();
    const p2 = ctx.put('plan', { date: TODAY, meal: 'lunch', recipeId: r.id, title: '红烧肉', servings: 2 });
    await settle();
    main.querySelector(`[data-fid="pd-${p2.id}"]`).click();
    await find(body, el => el.tag === 'dialog' && el.open).querySelector('[data-fid="dish-open"]').click();
    await settle();
    assert.equal(body.dataset.route, 'recipe');
    const before = scrolls.length;
    await go('#/calendar');
    assert.ok(main.querySelector(`[data-fid="pd-${p2.id}"]`));
    assert.equal(scrolls.length, before, '后退回来不滚');
    ctx.remove('plan', p2.id);
    main.querySelector('[data-fid="plan-next"]').click();
    await settle();

    // 「吃了」：面板里食谱已经选好、1 份；食谱还没填每人份营养，框里是按食材估算的（第 15 步：五花肉 500 g、2 人份 → 一份约 1295 千卡）；
    // 改了热量就是自己填的，记下来（也记到食谱上，没改的几格照估算的），这一天下面列出来
    main.querySelector(`[data-fid="pd-eat-${p.id}"]`).click();
    const eat = find(body, el => el.tag === 'dialog' && el.open);
    assert.equal(eat.querySelector('.dish-chosen-name').textContent, '红烧肉');
    const kcal = eat.querySelector('[data-fid="lg-kcal"]');
    assert.equal(kcal.value, '1295', '没填每人份营养的用估算的');
    kcal.value = '520'; await kcal.fire('input');
    await eat.querySelector('[data-fid="lg-save"]').click();
    await settle();
    const logged = Object.values(ctx.state.data.log);
    assert.deepEqual(logged.map(e => [e.date, e.meal, e.title, e.servings, e.kcal, e.planId, e.recipeId]), [[next, 'dinner', '红烧肉', 1, 520, p.id, r.id]]);
    assert.deepEqual(ctx.state.data.recipes[r.id].nutrition, { kcal: 520, protein: 23.3, carbs: 0, fat: 132.5 }, '也记到食谱上了');
    assert.equal(logged[0].estimated, false, '改过的是自己填的');
    assert.ok(main.querySelector(`[data-fid="lg-${logged[0].id}"]`), '这一天的「吃了什么」里有它');
    assert.equal(byCls(main, 'lg-tot-val').textContent, '520\u00a0千卡');

    // 设置 → 饮食目标：推入的页面（没有底栏），返回写「设置」；写了目标，日历里和它比
    await go('#/settings');
    await go('#/settings/goals');
    assert.deepEqual([body.dataset.route, body.dataset.tabs], ['settings', '0']);
    assert.equal(main.querySelector('h1').textContent, '饮食目标');
    const goal = main.querySelector('[data-fid="gl-kcal"]');
    goal.value = '1800'; await goal.fire('change');
    assert.deepEqual([goalsOf(ctx.state), ctx.state.settings['goals.kcal']], [{ kcal: 1800, protein: null, carbs: null, fat: null }, 1800], '一样一个键');
    await go('#/calendar');
    assert.equal(byCls(main, 'lg-tot-val').textContent, '520 / 1800\u00a0千卡');
    assert.equal(byCls(main, 'lg-tot-goal').textContent, '还差 1280');

    // 宽屏：侧栏里「日历」在食谱下面、搜索上面，亮着；双栏的宽度也只有一栏
    resize(800);
    assert.deepEqual(all(side.querySelector('nav'), el => el.tag === 'a').map(a => [a.attrs.href, a.textContent]),
      [['#/', '清单'], ['#/stores', '商店'], ['#/recipes', '食谱'], ['#/calendar', '日历'], ['#/search', '搜索']]);
    assert.equal(byCls(side, 'on').attrs.href, '#/calendar');
    resize(1200);
    assert.deepEqual(panes(), ['pane pane-main view view-plan']);
    await go('#/recipes');
    assert.deepEqual(panes(), ['pane pane-list view view-recipes', 'pane pane-detail view view-empty'], '食谱照旧两栏');
    await go('#/calendar');
    assert.deepEqual(panes(), ['pane pane-main view view-plan']);
  } finally { dom.restore(); delete Element.prototype.scrollIntoView; }
});
