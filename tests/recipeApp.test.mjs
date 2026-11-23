// 真实 App（src/app.js）里的食谱：底栏 / 侧栏的「食谱」、#/recipes 是顶层页面、一道食谱和编辑是推入的页面、双栏左栏是「食谱」、
// 编辑食谱改了没保存时换页先问（ctx.guard：ctx.navigate、App 里的链接、浏览器后退），放弃了删掉草稿；最近删除里能恢复食谱。全是编的数据
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Element, all, find, fakeStorage, installDom } from './helpers/dom.mjs';

const cls = (el, c) => (el.className || el.attrs.class || '').split(' ').includes(c);
const byCls = (root, c) => find(root, el => cls(el, c));

test('食谱的路由、三种布局、离开前先问、最近删除', async () => {
  const storage = fakeStorage();
  // 地址：App 自己设 location.hash 是推一格历史（记下几次），replaceState 是换掉这一格；浏览器后退直接改 hashNow
  let hashNow = '#/recipes', pushes = 0;
  const replaced = [];
  const loc = { protocol: 'http:', get hash() { return hashNow; }, set hash(v) { hashNow = v; pushes++; } };
  const media = {};
  const mq = q => (media[q] ||= { matches: false, listeners: [], addEventListener(type, fn) { this.listeners.push(fn); } });
  let backs = 0;
  const dom = installDom({ localStorage: storage, location: loc, history: { state: {}, replaceState(s, title, hash) { hashNow = hash; replaced.push(hash); }, back() { backs++; } },
    navigator: { languages: ['zh-CN'], locks: { request: async (name, fn) => fn() } },
    matchMedia: mq, setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, getComputedStyle: () => ({ bottom: '24px' }), requestAnimationFrame: () => 0,
    MutationObserver: class { observe() {} disconnect() {} }, CSS: { escape: String } });
  // <dialog>：补上 showModal / close（确认框要用）；链接的 closest（App 拦链接时找 <a>）
  const make = dom.doc.createElement;
  dom.doc.createElement = (tag) => {
    const el = make(tag);
    if (tag === 'dialog') { el.showModal = () => { el.open = true; el.attrs.open = ''; }; el.close = () => { el.open = false; delete el.attrs.open; el.fire('close'); }; }
    return el;
  };
  const proto = Element.prototype, hadClosest = 'closest' in proto;
  proto.closest = function (sel) {
    for (let el = this; el; el = el.parent) {
      if (sel === 'dialog' && el.tag === 'dialog') return el;
      if (sel === 'a[href^="#"]' && el.tag === 'a' && String(el.attrs.href || '').startsWith('#')) return el;
    }
    return null;
  };
  try {
    const shell = new Element('div'); shell.className = 'app';
    for (const id of ['side', 'main']) { const el = new Element('div'); el.id = id; shell.append(el); }
    const tabs = new Element('nav'); tabs.id = 'tabs';
    dom.doc.body.append(shell, tabs);
    await import('../src/app.js?test=recipes');
    const { ctx } = window.__picknest;
    const main = dom.doc.querySelector('#main'), body = dom.doc.body;
    const settle = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise(r => queueMicrotask(r)); };
    const go = async hash => { loc.hash = hash; await window.fire('hashchange'); await settle(); };
    const resize = (w) => {
      mq('(min-width: 720px)').matches = w >= 720;
      mq('(min-width: 1000px)').matches = w >= 1000;
      for (const m of Object.values(media)) for (const fn of m.listeners) fn();
    };
    const panes = () => main.children.map(el => el.className);
    const dialog = () => find(body, el => el.tag === 'dialog' && el.open);
    const answer = async (label) => { const d = dialog(); await find(d, el => el.tag === 'button' && el.textContent === label).click(); await settle(); };

    // 手机：「食谱」是底栏的第三个，顶层页面（有底栏）
    assert.deepEqual([body.dataset.route, body.dataset.tabs], ['recipes', '1']);
    assert.deepEqual(tabs.children.map(a => a.attrs['aria-current'] || null), [null, null, 'page', null]);
    assert.ok(byCls(main, 'rcp-empty'), '还没有食谱');
    const r = ctx.put('recipes', { name: '红烧肉', servings: 2, ings: [{ name: '五花肉', qty: 500, unit: 'g' }] });
    assert.match(r.id, /^r_/);
    assert.equal(r.ings[0].key, 'g_0', '整理时补上食材的 key');
    await settle();
    assert.equal(byCls(main, 'rcp-name').textContent, '红烧肉', '数据变了：页面自己更新');

    // 一道食谱：推入的页面（没有底栏，返回写「食谱」），底栏 / 侧栏算在「食谱」下面
    await go('#/r/' + r.id);
    assert.deepEqual([body.dataset.route, body.dataset.tabs], ['recipe', '0']);
    assert.equal(byCls(main, 'back').textContent, '食谱');
    assert.equal(byCls(dom.doc.querySelector('#side'), 'on').attrs.href, '#/recipes');

    // 编辑：改了名字没保存，ctx.navigate 先问；继续编辑就留着
    await go('#/r/' + r.id + '/edit');
    assert.equal(body.dataset.route, 'recipeEdit');
    const name = main.querySelector('[data-fid="re-name"]');
    name.value = '红烧肉（少糖）'; await name.fire('input');
    assert.equal(ctx.navigate('/stores'), false, '先问，不马上换页');
    assert.equal(byCls(dialog(), 'confirm-msg').textContent, '放弃没保存的修改？');
    await answer('继续编辑');
    assert.equal(body.dataset.route, 'recipeEdit');
    assert.equal(main.querySelector('[data-fid="re-name"]'), name, '页面没动');
    // App 里的链接（底栏）：浏览器换地址之前就拦下来问
    let prevented = false;
    const ev = { target: tabs.children[0].children[1], button: 0, preventDefault() { prevented = true; }, stopPropagation() {} };
    for (const fn of dom.doc.events.click) fn(ev);
    await settle();
    assert.equal(prevented, true);
    assert.ok(dialog(), '问了');
    await answer('继续编辑');
    assert.equal(loc.hash, '#/r/' + r.id + '/edit', '地址没变');
    // 浏览器后退：地址先改回来，问过再走；放弃 → 草稿删掉、换页
    storage.setItem('picknest.draft.recipe.' + r.id, JSON.stringify({ w: { name: '旧草稿', ings: [] } }));
    const pushed = pushes;
    hashNow = '#/r/' + r.id; await window.fire('popstate'); await settle();
    assert.equal(loc.hash, '#/r/' + r.id + '/edit', '先回到原地址');
    await answer('放弃');
    assert.equal(body.dataset.route, 'recipe');
    assert.deepEqual([pushes - pushed, replaced.slice(-2)], [0, ['#/r/' + r.id + '/edit', '#/r/' + r.id]],
      '放弃了：后退到的那一格换回它本来的地址，不再推一格（不然历史是「食谱、编辑、食谱」，点「‹ 食谱」又回到编辑页）');
    assert.equal(storage.getItem('picknest.draft.recipe.' + r.id), null, '放弃了：另存的草稿删掉');
    assert.equal(ctx.state.data.recipes[r.id].name, '红烧肉', '没保存');
    assert.equal(ctx.navigate('/recipes'), true, '没有要问的：照常马上换页');

    // 双栏：左栏「食谱」，右栏那道食谱（返回藏起来）/ 编辑（「取消」照样有）；还没选时右栏是提示
    resize(1180);
    assert.deepEqual(panes(), ['pane pane-list view view-recipes', 'pane pane-detail view view-empty']);
    assert.equal(main.children[1].textContent, '选一道食谱，或者新建一道。');
    await go('#/r/' + r.id);
    assert.deepEqual(panes(), ['pane pane-list view view-recipes', 'pane pane-detail view view-recipe']);
    assert.ok(cls(byCls(main.children[0], 'rcp-row'), 'sel'), '左栏高亮右边正在看的那道');
    await go('#/r/new');
    assert.deepEqual(panes(), ['pane pane-list view view-recipes', 'pane pane-detail view view-recipeEdit']);
    assert.ok(cls(byCls(main.children[1], 'back'), 'text'), '「取消」（.back.text，CSS 不藏）');
    // 新建：打了字以后换布局，编辑页整个搬过去（字还在），不问
    const nm = main.querySelector('[data-fid="re-name"]');
    nm.value = '番茄炒蛋'; await nm.fire('input');
    resize(390);
    assert.deepEqual(panes(), ['pane pane-main view view-recipeEdit']);
    assert.equal(main.querySelector('[data-fid="re-name"]'), nm);
    await main.querySelector('[data-fid="re-save"]').click();
    await settle();
    const egg = Object.values(ctx.state.data.recipes).find(x => x.name === '番茄炒蛋');
    assert.ok(egg);
    assert.equal(loc.hash, '#/r/' + egg.id, '存好换成那道食谱（替换 #/r/new）');

    // 删掉以后在最近删除里，能恢复
    ctx.remove('recipes', egg.id);
    await go('#/deleted');
    const sec = find(main, el => el.dataset && el.dataset.kind === 'recipes');
    assert.equal(byCls(sec, 'del-name').textContent, '番茄炒蛋');
    assert.ok(byCls(sec, 'del-sub').textContent.includes('0 样食材'));
    await find(sec, el => el.tag === 'button').click();
    await settle();
    assert.equal(ctx.state.data.recipes[egg.id].deleted, undefined);
  } finally {
    if (!hadClosest) delete proto.closest;
    dom.restore();
  }
});
