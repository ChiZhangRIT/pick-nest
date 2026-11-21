// 真实 App（src/app.js）在假 DOM 里的三种布局：手机 / 侧栏 / 双栏（≥1000），换布局时有输入框的页面整个搬过去（打了一半的字、焦点不丢），
// 双栏左栏高亮右边正在看的那一张 / 那一家，搜索在右栏、打字只换地址栏不重画，购物模式不管哪种布局都是一栏。全是编的数据
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Element, all, fakeStorage, installDom } from './helpers/dom.mjs';

test('换布局、双栏、搜索、购物模式：页面不被拆掉，左栏高亮，地址栏跟着搜索词', async () => {
  const storage = fakeStorage();
  const loc = { hash: '#/l/l_groceries', protocol: 'http:' };
  const media = {};
  const mq = q => (media[q] ||= { matches: false, listeners: [], addEventListener(type, fn) { this.listeners.push(fn); } });
  const dom = installDom({ localStorage: storage, location: loc, history: { state: {}, replaceState(s, title, hash) { loc.hash = hash; }, back() {} },
    navigator: { languages: ['zh-CN'], locks: { request: async (name, fn) => fn() } },
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
    // #/ 时右栏是提示；商店那一边左栏是「商店」
    await go('#/');
    assert.deepEqual(panes(), ['pane pane-list view view-lists', 'pane pane-detail view view-empty']);
    assert.equal(main.children[1].querySelector('p').textContent, '选一张清单，里面的东西显示在这里');
    assert.deepEqual(selected(), []);
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
    await go('#/settings');
    assert.deepEqual(panes(), ['pane pane-main view view-settings']);
    // 按着 ⌘ 点侧栏的「搜索」（在新标签页打开）：照浏览器自己的来，这一页不动
    let prevented = false;
    for (const fn of dom.doc.querySelector('#side').querySelector('nav').children[2].events.click) fn({ metaKey: true, preventDefault() { prevented = true; } });
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

    // 购物模式：双栏也是一栏、没有底栏；地址里带着 ?shop=1
    await go('#/l/l_groceries?shop=1');
    assert.deepEqual([body.dataset.route, main.dataset.panes], ['shop', '1']);
    assert.deepEqual(panes(), ['pane pane-main view view-shop']);
    assert.equal(main.querySelector('.shop-name').textContent, '食材');
    resize(390);
    assert.deepEqual([body.dataset.route, body.dataset.tabs], ['shop', '0']);
    assert.equal(dom.doc.querySelector('#tabs').querySelector('.on').attrs.href, '#/', '购物模式算在清单这一边');
    await go('#/s/s_wholefoods?shop=1');
    assert.equal(main.querySelector('.shop-name').textContent, 'Whole Foods');
    // 清单页、商店页（含「未指定」）的「开始购物」进的就是这个地址
    await go('#/l/l_groceries');
    main.querySelector('.shop-btn').fire('click');
    assert.equal(loc.hash, '#/l/l_groceries?shop=1');
    assert.equal(body.dataset.route, 'shop');
    for (const id of ['s_costco', 'none']) {
      await go('#/s/' + id);
      assert.equal(body.dataset.route, 'store');
      main.querySelector('.shop-btn').fire('click');
      assert.equal(loc.hash, '#/s/' + id + '?shop=1');
      assert.deepEqual([body.dataset.route, main.querySelector('.shop-name').textContent], ['shop', id === 'none' ? '未指定' : 'Costco']);
    }
  } finally { dom.restore(); }
});
