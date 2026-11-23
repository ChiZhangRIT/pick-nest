// 真实 App（src/app.js）在假 DOM 里冷启动：外壳、路由、首页、改数据后重画、换语言和外观、进清单页、清单不在了回首页、商店页、设置 → 商店。全是编的数据
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readStoredState, STATE_KEY } from '../src/core/persistence.js';
import { BUILD } from '../src/version.js';
import { Element, all, find, fakeStorage, installDom } from './helpers/dom.mjs';

test('冷启动：首页是预置的两张清单；底栏是清单、商店、设置；改数据自动重画并保存；换页、换语言、换外观、撤销都生效', async () => {
  const storage = fakeStorage();
  const loc = { hash: '', protocol: 'http:' };
  const media = {};
  const dom = installDom({ localStorage: storage, location: loc, history: { state: {}, replaceState(s, title, hash) { loc.hash = hash; }, back() {} },
    navigator: { languages: ['zh-CN'], locks: { request: async (name, fn) => fn() } },
    matchMedia: q => (media[q] = { matches: false, listeners: [], addEventListener(type, fn) { this.listeners.push(fn); } }),
    setTimeout: () => 0, setInterval: () => 0, getComputedStyle: () => ({ bottom: '24px' }), requestAnimationFrame: () => 0,
    MutationObserver: class { observe() {} disconnect() {} }, CSS: { escape: String } });
  try {
    const shell = new Element('div'); shell.className = 'app';
    for (const id of ['side', 'main']) { const el = new Element('div'); el.id = id; shell.append(el); }
    const tabs = new Element('nav'); tabs.id = 'tabs';
    dom.doc.body.append(shell, tabs);
    await import('../src/app.js?test=start');
    const app = window.__picknest;
    const { ctx } = app;
    const main = dom.doc.querySelector('#main');
    const body = dom.doc.body, root = dom.doc.documentElement;
    const rows = () => main.querySelectorAll('.list-row').map(r => [r.querySelector('.list-name').textContent, r.querySelector('.list-count').textContent]);
    const go = async hash => { loc.hash = hash; await window.fire('hashchange'); };
    const settle = () => new Promise(r => queueMicrotask(r));

    // 外壳和首页
    assert.deepEqual(rows(), [['食材', '0'], ['想买', '0']]);
    assert.deepEqual([body.dataset.route, body.dataset.layout, body.dataset.tabs], ['lists', 'phone', '1']);
    assert.deepEqual([root.lang, root.dataset.theme, dom.doc.title], ['zh-Hans', 'light', 'PickNest']);
    assert.deepEqual(tabs.children.map(a => [a.attrs.href, a.textContent, a.attrs['aria-current'] || null]), [['#/', '清单', 'page'], ['#/stores', '商店', null], ['#/settings', '设置', null]]);
    assert.deepEqual(all(dom.doc.querySelector('#side'), el => el.tag === 'a').map(a => a.attrs.href), ['#/', '#/stores', '#/search', '#/settings', '#/settings/sync'], '侧栏底部设置下面是同步状态，和 Babble 一样');
    assert.equal(dom.doc.querySelector('.side-foot').children[1].textContent, '未开同步');
    assert.equal(storage.m.size, 0, '只是打开看看，不写存储');

    // 改数据：存进本机、首页自动重画
    const milk = ctx.put('items', { listId: 'l_groceries', name: '牛奶', status: 'need' });
    assert.match(milk.id, /^i_/);
    assert.deepEqual([milk.qty, milk.unit, milk.status], [1, '', 'need']);
    await settle();
    assert.deepEqual(rows(), [['食材', '1'], ['想买', '0']]);
    const disk = readStoredState(storage);
    assert.equal(disk.data.items[milk.id].name, '牛奶');
    assert.equal(Object.keys(disk.data.lists).length, 2, '第一次保存时预置记录也一起存下');
    assert.equal(disk.data.lists.l_groceries.updatedAt, 0);
    assert.equal(ctx.update('items', milk.id, { status: 'done' }).status, 'done');
    await settle();
    assert.deepEqual(rows()[0], ['食材', '0']);
    assert.equal(ctx.update('items', 'no-such', { status: 'done' }), null);
    ctx.update('lists', 'l_tobuy', { name: '想要的' });
    await settle();
    assert.deepEqual(rows()[1], ['想要的', '0']);
    assert.equal(ctx.state.data.lists.l_tobuy.createdAt, 0);

    // 值没变的修改：什么也不做（预置商店还是 updatedAt 0，不算本机修改，不弹撤销）
    const v = ctx.editVersion;
    assert.equal(ctx.update('stores', 's_amazon', { archived: false }, { undoLabel: '没改' }).updatedAt, 0);
    assert.equal(ctx.editVersion, v);
    assert.equal(app.state.peekUndo(), null);
    // 存不下的 id：直接报错，不是存了以后悄悄丢掉
    for (const id of ['milk 2', '__proto__']) assert.throws(() => ctx.put('items', { id, listId: 'l_groceries', name: '牛奶' }), /bad-id/);
    assert.equal(Object.getPrototypeOf(ctx.state.data.items), Object.prototype);
    assert.equal(ctx.editVersion, v);

    // 软删除 + 撤销
    const egg = ctx.put('items', { listId: 'l_groceries', name: '鸡蛋', status: 'need' });
    await settle();
    assert.equal(rows()[0][1], '1');
    assert.equal(ctx.remove('items', egg.id, { undoLabel: '已删除' }).name, '鸡蛋');
    await settle();
    assert.equal(ctx.state.data.items[egg.id].deleted, true);
    assert.equal(rows()[0][1], '0');
    assert.equal(ctx.remove('items', egg.id), null, '已经删了的不再删');
    assert.equal(ctx.undo(), '已删除');
    await settle();
    assert.equal(rows()[0][1], '1');
    assert.equal(ctx.remove('items', egg.id).id, egg.id);
    assert.equal(ctx.restore('items', egg.id).deleted, undefined);

    // 换页：设置；不认识的地址回到清单
    await go('#/settings');
    assert.equal(body.dataset.route, 'settings');
    assert.deepEqual(tabs.children.map(a => a.attrs['aria-current'] || null), [null, null, 'page']);
    assert.ok(main.querySelector('.set-version').textContent.includes(BUILD));
    await go('#/nope');
    assert.equal(body.dataset.route, 'lists');
    assert.equal(main.querySelectorAll('.list-row').length, 2);
    // 设置 → 商店是推入的页面（不显示底栏，有返回）；设置里还没有的子页面当成设置首页（有底栏）
    await go('#/settings/stores');
    assert.deepEqual([body.dataset.route, body.dataset.tabs], ['settings', '0']);
    assert.ok(main.querySelector('.back'));
    assert.equal(main.querySelectorAll('.manage-row').length, 8, '八家预置商店');
    assert.equal(main.querySelector('.back').textContent, '清单', '返回写的是真的会回到的那一页（上一页是首页），不是固定的「设置」');
    await go('#/settings/nope');
    assert.deepEqual([body.dataset.route, body.dataset.tabs], ['settings', '1']);
    assert.ok(main.querySelector('.set-version'));
    await go('#/stores');
    await go('#/settings/stores');
    assert.equal(main.querySelector('.back').textContent, '商店', '从「商店」的「管理商店」进来：返回写「商店」');

    // 换外观：马上生效、记在本机设置里
    await go('#/settings');
    const seg = () => main.querySelector('.seg');
    await find(seg(), el => el.tag === 'button' && el.textContent === '深色').fire('click');
    assert.equal(root.dataset.theme, 'dark');
    assert.equal(JSON.parse(storage.getItem('picknest.local')).theme, 'dark');
    await find(seg(), el => el.tag === 'button' && el.textContent === '自动').fire('click');
    assert.equal(root.dataset.theme, 'light', '自动 = 跟系统（测试里系统是浅色）');

    // 换外观：按钮就地更新，不换掉（焦点和读屏的位置不丢）
    const dark = find(seg(), el => el.tag === 'button' && el.textContent === '深色');
    await dark.fire('click');
    assert.ok(seg().contains(dark));
    assert.equal(dark.attrs['aria-pressed'], 'true');
    await find(seg(), el => el.tag === 'button' && el.textContent === '自动').fire('click');

    // 后台数据变化不重建设置控件（下拉框还是同一个、焦点不丢），只改「最近删除」后面的数
    const select = () => main.querySelector('select');
    const language = select();
    language.focus();
    const deletedCount = () => find(main, el => el.tag === 'a' && el.attrs.href === '#/deleted').querySelector('.set-count').textContent;
    assert.equal(deletedCount(), '');
    ctx.update('items', milk.id, { note: 'test note' });
    ctx.remove('stores', 's_target');
    await settle();
    assert.equal(select(), language);
    assert.equal(dom.doc.activeElement, language);
    assert.equal(deletedCount(), '1');
    ctx.restore('stores', 's_target');
    await settle();
    assert.equal(deletedCount(), '');
    // 换语言（下拉框）：就地重画，页面容器、滚动不丢，焦点回到（新画的）下拉框
    const settingsPane = main.children[0];
    dom.doc.scrollingElement.scrollTop = 180;
    language.value = 'en'; await language.fire('change');
    assert.equal(main.children[0], settingsPane, '换语言不拆掉页面容器');
    assert.equal(dom.doc.scrollingElement.scrollTop, 180, '保留手机滚动位置');
    assert.notEqual(select(), language, '重画过');
    assert.equal(dom.doc.activeElement, select(), '焦点回到语言下拉框');
    assert.equal(select().attrs['aria-label'], 'Language / 语言', '读屏的名字跟着界面');
    assert.equal(root.lang, 'en');
    assert.equal(JSON.parse(storage.getItem('picknest.local')).lang, 'en');
    assert.ok(main.textContent.includes('Appearance'));
    assert.deepEqual(tabs.children.map(a => a.textContent), ['Lists', 'Stores', 'Settings']);
    const current = select();
    ctx.setLang('en');
    assert.equal(select(), current, '重复选当前语言不用重画');
    assert.equal(dom.doc.querySelector('.side-foot').children[1].textContent, 'Sync off', '侧栏同步状态一起换语言');
    for (const [lang, appearance, label] of [['zh-Hant-TW', '外觀', '語言 / Language'], ['zh-Hans', '外观', '语言 / Language'], ['en', 'Appearance', 'Language / 语言']]) {
      select().value = lang; await select().fire('change');
      assert.equal(root.lang, lang);
      assert.ok(main.textContent.includes(appearance));
      assert.equal(dom.doc.activeElement, select());
      assert.equal(select().attrs['aria-label'], label);
    }
    // 设置入口在同一次点按里换页，不等 hashchange；修饰键点按照浏览器自己的来。
    const dataLink = find(main, el => el.tag === 'a' && el.attrs.href === '#/settings/data');
    let prevented = false;
    for (const fn of dataLink.events.click) fn({ metaKey: true, preventDefault() { prevented = true; } });
    assert.deepEqual([prevented, loc.hash], [false, '#/settings']);
    await dataLink.fire('click');
    assert.equal(loc.hash, '#/settings/data');
    assert.ok(main.textContent.includes('Export backup'));
    assert.equal(main.querySelector('.nb-title').textContent, 'Backup & Restore');
    await go('#/');
    assert.deepEqual(rows(), [['Groceries', '1'], ['想要的', '0']]);

    // 宽屏：换布局时重画外壳
    media['(min-width: 720px)'].matches = true;
    for (const fn of media['(min-width: 720px)'].listeners) fn();
    assert.equal(body.dataset.layout, 'side');
    media['(min-width: 720px)'].matches = false;
    for (const fn of media['(min-width: 720px)'].listeners) fn();

    // 别的标签页改了数据：storage 事件 → 重新读入、重画
    const other = readStoredState(storage);
    other.data.items.i_other = { id: 'i_other', listId: 'l_tobuy', name: '台灯', status: 'need', updatedAt: Date.now() + 10 };
    storage.setItem(STATE_KEY, JSON.stringify(other));
    for (const fn of window.events.storage) fn({ key: STATE_KEY });      // 假 DOM 的 fire 不带 key，直接调监听函数
    await settle();
    assert.deepEqual(rows(), [['Groceries', '1'], ['想要的', '1']]);

    // 点首页的一行进清单页：手机上不显示底栏（推入的页面自己画返回）；侧栏和底栏还是「清单」亮着
    const href = main.querySelector('.list-row').attrs.href;
    assert.equal(href, '#/l/l_groceries');
    await go(href);
    assert.deepEqual([body.dataset.route, body.dataset.tabs], ['list', '0']);
    assert.equal(main.querySelector('.lp-name').textContent, 'Groceries');
    assert.ok(main.querySelector('.back'));
    assert.equal(tabs.children[0].attrs['aria-current'], 'page');
    // 快速添加走 app 的 onChange：只重画列表，输入框还是同一个
    const input = main.querySelector('.add-input');
    input.focus(); input.value = 'oat milk 2';
    for (const fn of input.events.keydown) fn({ key: 'Enter', preventDefault() {} });
    await settle();
    assert.equal(main.querySelector('.add-input'), input, '没有整页重画');
    assert.equal(dom.doc.activeElement, input);
    const names = () => main.querySelectorAll('.item-name').map(el => el.textContent);
    assert.deepEqual(names(), ['oat milk', '鸡蛋', '牛奶'], '蛋奶、未分类，最后是已买');
    assert.equal(readStoredState(storage).data.items[Object.keys(ctx.state.data.items).find(id => ctx.state.data.items[id].name === 'oat milk')].qty, 2);
    // 地址里的清单不在了：换回首页（不留在历史里），提示一句
    await go('#/l/l_nope');
    await settle();
    assert.deepEqual([loc.hash, body.dataset.route], ['#/', 'lists']);
    assert.equal(dom.doc.querySelector('#toast').querySelector('.toast-msg').textContent, 'That list no longer exists');

    // 「商店」：每家店还要买几样（快速添加的 oat milk 默认在食材清单的 Whole Foods；没指定商店的两样在最后的「未指定」）
    await go('#/stores');
    assert.deepEqual([body.dataset.route, body.dataset.tabs], ['stores', '1']);
    assert.deepEqual(tabs.children.map(a => a.attrs['aria-current'] || null), [null, 'page', null]);
    const storeRows = () => main.querySelectorAll('.store-row').map(r => [r.querySelector('.store-name').textContent, r.querySelector('.list-count').textContent]);
    assert.equal(storeRows().length, 9);
    assert.deepEqual([storeRows()[0], storeRows().at(-1)], [['Whole Foods', '1'], ['No Store', '2']]);
    // 点进一家店：推入的页面（不显示底栏，有返回），「商店」还亮着
    await go(main.querySelector('.store-row').attrs.href);
    assert.deepEqual([loc.hash, body.dataset.route, body.dataset.tabs], ['#/s/s_wholefoods', 'store', '0']);
    assert.equal(main.querySelector('.lp-name').textContent, 'Whole Foods');
    assert.deepEqual(main.querySelectorAll('.item-name').map(el => el.textContent), ['oat milk']);
    assert.ok(main.querySelector('.back'));
    assert.equal(tabs.children[1].attrs['aria-current'], 'page');
    // 地址里的商店不在了：换回「商店」，提示一句
    await go('#/s/s_nope');
    await settle();
    assert.deepEqual([loc.hash, body.dataset.route], ['#/stores', 'stores']);
    assert.equal(dom.doc.querySelector('#toast').querySelector('.toast-msg').textContent, 'That store no longer exists');
  } finally { dom.restore(); }
});

test('装好的 App：启动后、切回来时（最多半小时一次）自己检查新版（registration.update()），下载好了在设置 → 关于里说；第一次改数据时请浏览器别清掉本机数据', async () => {
  const storage = fakeStorage();
  const loc = { hash: '#/settings', protocol: 'http:' };
  let updates = 0, persists = 0;
  const reg = { waiting: null, installing: null, events: {}, addEventListener(type, fn) { (this.events[type] ||= []).push(fn); },
    async update() {
      updates++;
      if (updates === 1) return;                                     // 第一次：还没有新版
      const w = { state: 'installing', events: [], addEventListener(type, fn) { this.events.push(fn); } };
      reg.installing = w;
      for (const fn of reg.events.updatefound || []) fn();
      w.state = 'installed'; reg.waiting = w; reg.installing = null;
      for (const fn of w.events) fn();
    } };
  const dom = installDom({ localStorage: storage, location: loc, history: { state: {}, replaceState(s, title, hash) { loc.hash = hash; }, back() {} },
    navigator: { languages: ['zh-CN'], locks: { request: async (name, fn) => fn() },
      serviceWorker: { controller: {}, getRegistration: async () => reg }, storage: { persist: async () => { persists++; return true; } } },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    setTimeout: () => 0, setInterval: () => 0, getComputedStyle: () => ({ bottom: '24px' }), requestAnimationFrame: () => 0,
    MutationObserver: class { observe() {} disconnect() {} }, CSS: { escape: String } });
  const realNow = Date.now;
  try {
    const shell = new Element('div'); shell.className = 'app';
    for (const id of ['side', 'main']) { const el = new Element('div'); el.id = id; shell.append(el); }
    const tabs = new Element('nav'); tabs.id = 'tabs';
    dom.doc.body.append(shell, tabs);
    dom.doc.visibilityState = 'visible';
    await import('../src/app.js?test=update');
    const { ctx } = window.__picknest;
    const main = dom.doc.querySelector('#main');
    const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(r => queueMicrotask(r)); };   // 假的 setTimeout 不会跑
    await settle();
    assert.equal(updates, 1, '启动后检查一次');
    assert.equal(main.querySelector('.set-update').hidden, true);
    await dom.doc.fire('visibilitychange'); await settle();
    assert.equal(updates, 1, '半小时内切回来不再查');
    Date.now = () => realNow() + 31 * 60 * 1000;
    await dom.doc.fire('visibilitychange'); await settle();
    assert.equal(updates, 2);
    assert.equal(ctx.updateReady(), true);
    assert.equal(main.querySelector('.set-update').hidden, false, '设置 → 关于：新版下载好了');
    assert.equal(persists, 0, '只是打开看看：不要');
    ctx.put('items', { listId: 'l_groceries', name: '牛奶', status: 'need' });
    ctx.put('items', { listId: 'l_groceries', name: '鸡蛋', status: 'need' });
    assert.equal(persists, 1, '第一次改数据时要一次（在点按里），之后不再要');
    await settle();
  } finally { Date.now = realNow; dom.restore(); }
});

test('冷启动时浏览器已经在装新版（updatefound 在 App 载入前就过去了）：装好以后照样在设置 → 关于里说', async () => {
  const storage = fakeStorage();
  const loc = { hash: '#/settings', protocol: 'http:' };
  const w = { state: 'installing', events: [], addEventListener(type, fn) { this.events.push(fn); } };
  const reg = { waiting: null, installing: w, events: {}, addEventListener(type, fn) { (this.events[type] ||= []).push(fn); },
    async update() {} };
  const dom = installDom({ localStorage: storage, location: loc, history: { state: {}, replaceState(s, title, hash) { loc.hash = hash; }, back() {} },
    navigator: { languages: ['zh-CN'], locks: { request: async (name, fn) => fn() },
      serviceWorker: { controller: {}, getRegistration: async () => reg }, storage: { persist: async () => true } },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    setTimeout: () => 0, setInterval: () => 0, getComputedStyle: () => ({ bottom: '24px' }), requestAnimationFrame: () => 0,
    MutationObserver: class { observe() {} disconnect() {} }, CSS: { escape: String } });
  try {
    const shell = new Element('div'); shell.className = 'app';
    for (const id of ['side', 'main']) { const el = new Element('div'); el.id = id; shell.append(el); }
    const tabs = new Element('nav'); tabs.id = 'tabs';
    dom.doc.body.append(shell, tabs);
    dom.doc.visibilityState = 'visible';
    await import('../src/app.js?test=update-cold');
    const { ctx } = window.__picknest;
    const main = dom.doc.querySelector('#main');
    const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(r => queueMicrotask(r)); };
    await settle();
    assert.equal(ctx.updateReady(), false, '还在装：先不说');
    w.state = 'installed'; reg.waiting = w; reg.installing = null;
    for (const fn of w.events) fn();
    assert.equal(ctx.updateReady(), true, '装好了：说');
    assert.equal(main.querySelector('.set-update').hidden, false);
  } finally { dom.restore(); }
});
