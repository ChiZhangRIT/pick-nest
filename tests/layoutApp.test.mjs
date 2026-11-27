// 真实 App（src/app.js）在假 DOM 里的三种布局：手机 / 侧栏 / 双栏（≥1000），换布局时有输入框的页面整个搬过去（打了一半的字、焦点不丢），
// 双栏左栏高亮右边正在看的那一张 / 那一家，搜索在右栏、打字只换地址栏不重画；以前的购物模式地址打开普通的页面，屏幕常亮跟着清单页、商店页。全是编的数据
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Element, all, fakeStorage, installDom } from './helpers/dom.mjs';
import { fakeWake } from './helpers/wake.mjs';

test('换布局、双栏、搜索、旧的购物模式地址、屏幕常亮：页面不被拆掉，左栏高亮，地址栏跟着搜索词', async () => {
  const storage = fakeStorage();
  const loc = { hash: '#/l/l_groceries', protocol: 'http:' };
  const media = {};
  const mq = q => (media[q] ||= { matches: false, listeners: [], addEventListener(type, fn) { this.listeners.push(fn); } });
  const wake = fakeWake();
  const dom = installDom({ localStorage: storage, location: loc, history: { state: {}, replaceState(s, title, hash) { loc.hash = hash; }, back() {} },
    navigator: { languages: ['zh-CN'], locks: { request: async (name, fn) => fn() }, wakeLock: wake.wakeLock },
    matchMedia: mq, setTimeout: () => 0, setInterval: () => 0, getComputedStyle: () => ({ bottom: '24px' }), requestAnimationFrame: () => 0,
    MutationObserver: class { observe() {} disconnect() {} }, CSS: { escape: String } });
  try {
    const shell = new Element('div'); shell.className = 'app';
    for (const id of ['side', 'main']) { const el = new Element('div'); el.id = id; shell.append(el); }
    const tabs = new Element('nav'); tabs.id = 'tabs';
    dom.doc.body.append(shell, tabs);
    await import('../src/app.js?test=layout');
    const { ctx, mounted } = window.__picknest;
    const main = dom.doc.querySelector('#main'), body = dom.doc.body;
    const settle = () => new Promise(r => queueMicrotask(r));
    const go = async hash => { loc.hash = hash; await window.fire('hashchange'); };
    const resize = (w) => {
      mq('(min-width: 720px)').matches = w >= 720;
      mq('(min-width: 1000px)').matches = w >= 1000;
      for (const m of Object.values(media)) for (const fn of m.listeners) fn();
    };
    const panes = () => main.children.map(el => el.className);
    const selected = () => all(main, el => (el.className || el.attrs.class || '').split(' ').includes('sel')).map(el => el.dataset.id);

    // 手机：清单页一栏；快速添加里打了一半的字
    assert.deepEqual([body.dataset.layout, main.dataset.panes], ['phone', '1']);
    assert.deepEqual(panes(), ['pane pane-main view view-list']);
    const input = main.querySelector('.add-input');
    input.focus(); input.value = '燕麦';

    // 转成双栏：左栏首页（食材高亮），右栏还是原来那个清单页（没重画：输入框是同一个，字和焦点都在）
    resize(1180);
    assert.deepEqual([body.dataset.layout, main.dataset.panes], ['two', '2']);
    assert.deepEqual(panes(), ['pane pane-list view view-lists', 'pane pane-detail view view-list']);
    assert.equal(main.querySelector('.add-input'), input);
    assert.equal(input.value, '燕麦');
    assert.equal(dom.doc.activeElement, input);
    assert.deepEqual(selected(), ['l_groceries']);
    assert.equal(main.querySelector('.list-row').attrs['aria-current'], 'page');
    assert.equal(mounted.detail.params.pane, 'detail', '页面拿到的 params 原地更新');
    // 侧栏宽度（720–999）：一栏 + 侧栏，同一个页面又搬回来
    resize(800);
    assert.deepEqual([body.dataset.layout, main.dataset.panes], ['side', '1']);
    assert.deepEqual(panes(), ['pane pane-main view view-list']);
    assert.equal(main.querySelector('.add-input'), input);
    assert.equal(input.value, '燕麦');
    resize(1180);
    assert.equal(main.querySelector('.add-input'), input);

    // 双栏里换一张清单：左栏跟着高亮，右栏是新的
    await go('#/l/l_tobuy');
    assert.deepEqual(selected(), ['l_tobuy']);
    assert.equal(main.children[1].querySelector('.lp-name').textContent, '想买');
    // ⌘N（测试里不是 Mac：Ctrl+N）：光标放进右栏这张清单的快速添加；不在清单页上时不拦浏览器的快捷键
    const pressNew = () => { let prevented = false; for (const fn of dom.doc.events.keydown || []) fn({ key: 'n', ctrlKey: true, preventDefault() { prevented = true; } }); return prevented; };
    main.children[0].querySelector('.list-row').focus();
    assert.equal(pressNew(), true);
    assert.equal(dom.doc.activeElement, main.children[1].querySelector('.add-input'), '右栏的快速添加');
    // #/ 时右栏是提示；商店那一边左栏是「商店」
    await go('#/');
    assert.deepEqual(panes(), ['pane pane-list view view-lists', 'pane pane-detail view view-empty']);
    assert.equal(main.children[1].querySelector('p').textContent, '选一张清单，里面的东西显示在这里');
    assert.deepEqual(selected(), []);
    assert.equal(pressNew(), false, '右栏还没有清单：⌘N 照浏览器自己的来');
    assert.deepEqual([main.children[1].querySelector('img').attrs.src, main.children[1].querySelector('img').attrs.width], ['icons/icon.svg', '96'], '右栏空着时是 App 图标 + 一句话');
    // 同步状态：宽屏只在侧栏「设置」下面有一个，首页标题旁边不重复；手机上在标题旁边（侧栏藏着）
    assert.equal(main.querySelectorAll('.sync-badge').length, 0);
    assert.equal(dom.doc.querySelector('#side').querySelectorAll('.sync-badge').length, 1);
    resize(390);
    assert.equal(main.querySelectorAll('.sync-badge').length, 1, '手机：标题旁边');
    resize(800);
    assert.equal(main.querySelectorAll('.sync-badge').length, 0, '侧栏布局：只在侧栏');
    resize(1180);
    // 设置的子页面在宽屏也是一栏、有返回，标题在顶栏中间
    await go('#/settings/stores');
    assert.deepEqual(panes(), ['pane pane-main view view-settings']);
    assert.deepEqual([main.querySelector('.back').textContent, main.querySelector('.nb-title').textContent], ['清单', '商店']);
    await go('#/');
    await go('#/s/s_costco');
    assert.deepEqual(panes(), ['pane pane-list view view-stores', 'pane pane-detail view view-store']);
    assert.deepEqual(selected(), ['s_costco']);
    // 商店页也是整个搬过去（自己管更新）：一栏 ↔ 双栏右边
    const storeEl = mounted.detail.el;
    resize(390);
    assert.deepEqual(panes(), ['pane pane-main view view-store']);
    assert.equal(mounted.main.el, storeEl);
    resize(1180);
    assert.equal(mounted.detail.el, storeEl);
    assert.deepEqual(selected(), ['s_costco']);
    // 后退回来时每一栏回到各自的滚动位置（不把右栏的套到左栏上）
    mounted.list.el.scrollTop = 300; mounted.detail.el.scrollTop = 1500;
    await go('#/settings');
    assert.deepEqual(panes(), ['pane pane-main view view-settings'], '设置是一栏');
    await go('#/s/s_costco');                              // 后退
    assert.deepEqual([mounted.list.el.scrollTop, mounted.detail.el.scrollTop], [300, 1500]);
    await go('#/stores');
    assert.equal(main.children[1].querySelector('p').textContent, '选一家店，在那儿要买的东西显示在这里');
    mounted.list.el.scrollTop = 200;                       // 右栏只是提示：记的是左栏的
    await go('#/settings');
    await go('#/stores');                                  // 后退
    assert.equal(mounted.list.el.scrollTop, 200);
    const leftPane = mounted.list.el, rightPane = mounted.detail.el;
    ctx.setLang('en');
    assert.equal(mounted.list.el, leftPane, '双栏切语言保留左栏容器');
    assert.equal(mounted.detail.el, rightPane, '双栏切语言保留右栏容器');
    assert.equal(leftPane.scrollTop, 200, '左栏滚动不跳回顶部');
    assert.equal(rightPane.querySelector('p').textContent, 'Pick a store to see what to buy there');
    ctx.setLang('zh-Hans');
    await go('#/settings');
    assert.deepEqual(panes(), ['pane pane-main view view-settings']);
    // 按着 ⌘ 点侧栏的「搜索」（在新标签页打开）：照浏览器自己的来，这一页不动
    let prevented = false;
    for (const fn of dom.doc.querySelector('#side').querySelector('nav').children[4].events.click) fn({ metaKey: true, preventDefault() { prevented = true; } });
    assert.deepEqual([prevented, loc.hash], [false, '#/settings']);

    // 搜索：ctx.navigate 马上画（不等 hashchange，在点按里 focus 搜索框 iPhone 才弹键盘）；双栏时左栏是首页，侧栏「搜索」亮着
    ctx.navigate('/search');
    assert.equal(loc.hash, '#/search');
    assert.deepEqual(panes(), ['pane pane-list view view-lists', 'pane pane-detail view view-search']);
    const q = main.querySelector('.search-input');
    assert.equal(dom.doc.activeElement, q, '焦点在搜索框');
    assert.equal(dom.doc.querySelector('#side').querySelector('.on').attrs.href, '#/search');
    assert.ok(main.children[0].querySelector('.search-entry').attrs.class.split(' ').includes('on'), '左栏的搜索入口亮着');
    await window.fire('hashchange');                       // 随后到的 hashchange：同一个地址，不再画一遍
    assert.equal(main.querySelector('.search-input'), q);
    q.value = '牛奶'; await q.fire('input');
    assert.equal(loc.hash, '#/search?q=' + encodeURIComponent('牛奶'), '地址栏跟着换（重新载入还是这次搜的）');
    // 已经在搜索页上：再点左栏的入口、侧栏的「搜索」只是把焦点给右栏的搜索框，不换成空的 #/search
    for (const link of [main.children[0].querySelector('.search-entry'), dom.doc.querySelector('#side').querySelector('.on')]) {
      q.blur();
      await link.fire('click');
      assert.equal(loc.hash, '#/search?q=' + encodeURIComponent('牛奶'));
      assert.equal(main.querySelector('.search-input'), q);
      assert.equal(q.value, '牛奶');
      assert.equal(dom.doc.activeElement, q);
    }
    resize(390);                                           // 换布局：搜索页搬到一栏，搜索框还是同一个
    assert.deepEqual(panes(), ['pane pane-main view view-search']);
    assert.equal(main.querySelector('.search-input'), q);
    assert.equal(q.value, '牛奶');
    assert.equal(body.dataset.tabs, '0', '手机上搜索是推入的页面');
    resize(1180);
    assert.equal(main.querySelector('.search-input'), q);

    // 以前的购物模式地址（#/l/<id>?shop=1、#/s/<id>?shop=1；历史记录、书签里可能还有）：打开的就是普通的清单页 / 商店页，不出错
    await go('#/l/l_groceries?shop=1');
    assert.deepEqual([body.dataset.route, main.dataset.panes], ['list', '2']);
    assert.deepEqual(panes(), ['pane pane-list view view-lists', 'pane pane-detail view view-list']);
    assert.equal(main.children[1].querySelector('.lp-name').textContent, '食材');
    await go('#/s/s_wholefoods?shop=1');
    assert.deepEqual(panes(), ['pane pane-list view view-stores', 'pane pane-detail view view-store']);
    assert.equal(main.children[1].querySelector('.lp-name').textContent, 'Whole Foods');
    resize(390);
    await go('#/s/none?shop=1');
    assert.deepEqual([body.dataset.route, body.dataset.tabs, main.querySelector('.lp-name').textContent], ['store', '0', '未指定']);
    assert.equal(main.querySelector('.shop-btn'), null, '没有「开始购物」了');

    // 屏幕常亮（本机开关，默认关）：开着时清单页、商店页上要常亮；清单页 ↔ 商店页换页时先放掉再要；去别的页面放掉
    const many = async () => { for (let i = 0; i < 10; i++) await settle(); };
    await go('#/l/l_groceries');
    await many();
    assert.deepEqual([wake.requests, main.querySelector('.awake-chip').hidden], [0, true], '默认关着：不要');
    window.__picknest.state.setLocal({ keepAwake: true });
    await go('#/s/s_costco');
    await many();
    assert.deepEqual([wake.requests, wake.released, main.querySelector('.awake-chip').hidden], [1, 0, false]);
    await go('#/l/l_tobuy');
    await many();
    assert.deepEqual([wake.requests, wake.released], [2, 1]);
    await go('#/recipes');
    await many();
    assert.deepEqual([wake.requests, wake.released], [2, 2], '离开清单页、商店页：放掉');
  } finally { dom.restore(); }
});
