// 屏幕常亮（ui/keepAwake.js）在清单页、商店页上：⋯ 里的开关（本机记住）、开着时顶栏上的「屏幕常亮中」、请求 / 切回来再要 / 放掉、
// 不支持时那一行说清做不到、被拒绝时淡淡地说一句；还有去掉购物模式以后没留下的东西。假 DOM + 真的 state.js + 假的 navigator.wakeLock。全是编的数据
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as listView from '../src/views/list.js';
import * as storeView from '../src/views/store.js';
import * as state from '../src/core/state.js';
import { normalizeRecord } from '../src/core/store.js';
import { setLang, t, STRINGS } from '../src/i18n.js';
import { Element, all, find, installDom, fakeStorage } from './helpers/dom.mjs';
import { fakeWake } from './helpers/wake.mjs';

const settle = async (n = 5) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)); };
const cls = (el, c) => (el.className || el.attrs.class || '').split(' ').includes(c);
const byCls = (root, c) => find(root, el => cls(el, c));
const btn = (root, label) => find(root, el => el.tag === 'button' && el.textContent === label);
const S = () => state.getState();

/** 编的数据：食材清单上要买牛奶、已买鸡蛋（都在 Whole Foods）；Costco 什么也没有 */
function seed(s) {
  s.data.items.i_t1 = normalizeRecord('items', { id: 'i_t1', listId: 'l_groceries', name: '牛奶', status: 'need', storeId: 's_wholefoods', updatedAt: 1 });
  s.data.items.i_t2 = normalizeRecord('items', { id: 'i_t2', listId: 'l_groceries', name: '鸡蛋', status: 'done', doneAt: 5000, storeId: 's_wholefoods', updatedAt: 1 });
}

/** 假 ctx（照 app.js）；wake：fakeWake() 的结果，交给页面的 deps.wake。remount() = 离开这一页再进来（同一份本机设置） */
function setup({ page = 'list', id = 'l_groceries', lang = 'zh-Hans', wake = fakeWake(), storage = null } = {}) {
  const dom = installDom();
  setLang(lang);
  state.load({ storage });
  state.mutate(seed);
  const views = { list: listView, store: storeView };
  const env = { ...dom, wake, toasts: [], sheets: [], handle: null };
  const ctx = env.ctx = {
    t, lang: () => lang, layout: () => 'phone',
    get state() { return S(); }, get local() { return state.getLocal(); },
    setLocal: (p) => state.setLocal(p),
    mutate: (fn, o) => state.mutate(fn, o),
    toast: (msg, o = {}) => env.toasts.push({ msg, ...o }),
    confirm: async () => true, navigate: () => {}, back: () => {}, backLabel: (x) => x, refresh: () => {},
    sheet(content, opts = {}) {
      const el = new Element('dialog');
      const api = { el, body: el, opts, open: true, close() { if (!api.open) return; api.open = false; env.sheets = env.sheets.filter(x => x !== api); } };
      const node = typeof content === 'function' ? content(api) : content;
      if (node) el.append(node);
      env.sheets.push(api);
      return api;
    },
  };
  const off = state.subscribe((st, info) => {
    if (info.undoLabel) ctx.toast(info.undoLabel, { ms: 10000, action: { label: t('common.undo'), run: () => state.undo() } });
    queueMicrotask(() => { if (env.handle && env.handle.onChange) env.handle.onChange(info); });
  });
  const mount = env.mount = () => {
    env.main = new Element('section');
    env.handle = views[page].render(env.main, { name: page, id, query: {} }, ctx, { wake: { wakeLock: wake.wakeLock, doc: wake.doc } });
  };
  mount();
  Object.assign(env, {
    chip: () => byCls(env.main, 'awake-chip'),
    more: () => find(env.main, el => el.tag === 'button' && el.attrs['aria-label'] === t('common.more')),
    async menu() { await env.more().fire('click'); return env.sheets.at(-1); },
    toggle: (sh) => find(sh.el, el => el.attrs.role === 'switch'),
    leave() { env.handle.cleanup(); env.handle = null; },
    remount() { env.leave(); mount(); },
    done() { if (env.handle && env.handle.cleanup) env.handle.cleanup(); off(); dom.restore(); setLang('zh-Hans'); },
  });
  return env;
}

test('清单页：默认关着（不要常亮、没有小标签）；⋯ 里「屏幕常亮」是开关，打开 → 马上要、顶栏「屏幕常亮中」，这台设备记住（存进 picknest.local）', async () => {
  const storage = fakeStorage();
  const env = setup({ storage });
  try {
    await settle();
    assert.deepEqual([env.wake.requests, env.chip().hidden], [0, true]);
    const sh = await env.menu();
    // 上面一组照旧是清单的操作，下面一组是开关
    assert.deepEqual(all(sh.el, el => cls(el, 'menu-row')).map(b => b.textContent), ['编辑清单', '清除已买']);
    const sw = env.toggle(sh);
    assert.deepEqual([sw.attrs['aria-checked'], sw.attrs['aria-label'], byCls(sw, 'awake-hint').textContent],
      ['false', '屏幕常亮', '在清单页和商店页上不让屏幕变暗。只记在这台设备上']);
    assert.equal(sw.attrs['aria-describedby'], byCls(sw, 'awake-hint').id, '读屏念完名字再念说明');
    await sw.fire('click');
    assert.equal(env.sheets.length, 0, '点了先关菜单（和别的一行一样）');
    await settle();
    assert.equal(state.getLocal().keepAwake, true);
    assert.equal(JSON.parse(storage.getItem('picknest.local')).keepAwake, true, '存进本机设置（不进同步的数据）');
    assert.equal('keepAwake' in S().settings, false);
    assert.equal(env.wake.requests, 1);
    const chip = env.chip();
    assert.deepEqual([chip.hidden, chip.textContent, chip.attrs['aria-label'], cls(chip, 'denied')], [false, '屏幕常亮中', '屏幕常亮中，点一下关掉', false]);
    assert.equal(env.toggle(await env.menu()).attrs['aria-checked'], 'true', '再打开菜单：开着');
  } finally { env.done(); }
  // 重新打开 App（同一份本机存储）：一进清单页就要，不用再点
  const again = setup({ storage });
  try {
    await settle();
    assert.equal(state.getLocal().keepAwake, true);
    assert.deepEqual([again.wake.requests, again.chip().hidden], [1, false]);
  } finally { again.done(); }
});

test('开着时：切到后台系统收回、切回来再要；离开这一页放掉（不再听切回来）；再进来又要；点小标签 / 菜单里关掉 → 放掉、不再要', async () => {
  const env = setup();
  const w = env.wake;
  try {
    state.setLocal({ keepAwake: true });
    env.remount();
    await settle();
    assert.deepEqual([w.requests, w.released], [1, 0]);
    // 切到后台：系统收回；小标签不缩回去（看不见，也免得切回来一闪）；切回来再要
    w.doc.visibilityState = 'hidden';
    w.sentinels[0].lose();
    w.doc.show('hidden');
    await settle();
    assert.deepEqual([w.requests, env.chip().hidden], [1, false]);
    w.doc.show('visible');
    await settle();
    assert.equal(w.requests, 2, '切回来再要');
    // 离开这一页：放掉，切回来也不要
    env.leave();
    await settle();
    assert.deepEqual([w.released, w.doc.listeners], [1, 0]);
    w.doc.show('visible');
    await settle();
    assert.equal(w.requests, 2);
    // 再进来：又要
    env.mount();
    await settle();
    assert.equal(w.requests, 3);
    // 点小标签：关掉、放掉，提示一句，焦点给 ⋯
    env.chip().focus();
    await env.chip().fire('click');
    await settle();
    assert.deepEqual([state.getLocal().keepAwake, w.released, env.chip().hidden], [false, 2, true]);
    assert.equal(env.toasts.at(-1).msg, '已关掉屏幕常亮');
    assert.equal(document.activeElement, env.more(), '点掉的小标签不见了：焦点给 ⋯');
    w.doc.show('visible');
    await settle();
    assert.equal(w.requests, 3, '关掉以后切回来不再要');
    // 菜单里打开、再关掉
    await env.toggle(await env.menu()).fire('click');
    await settle();
    assert.deepEqual([w.requests, env.chip().hidden], [4, false]);
    await env.toggle(await env.menu()).fire('click');
    await settle();
    assert.deepEqual([state.getLocal().keepAwake, w.released, env.chip().hidden], [false, 3, true]);
  } finally { env.done(); }
});

test('商店页：顶栏也有 ⋯（和清单页一样：有已买时「清除已买」，下面是「屏幕常亮」）；开着进来就要，离开放掉；英文界面', async () => {
  const env = setup({ page: 'store', id: 's_wholefoods', lang: 'en' });
  try {
    let sh = await env.menu();
    assert.equal(sh.opts.title, 'Whole Foods');
    assert.deepEqual(all(sh.el, el => cls(el, 'menu-row')).map(b => b.textContent), ['Clear Bought']);
    assert.equal(byCls(sh.el, 'awake-t').textContent, 'Keep Screen On');
    await btn(sh.el, 'Clear Bought').fire('click');
    await settle();
    assert.equal(S().data.items.i_t2.deleted, true, '和「已买」旁边的「清除已买」一样');
    assert.equal(env.toasts.at(-1).action.label, 'Undo', '能撤销');
    sh = await env.menu();
    assert.deepEqual(all(sh.el, el => cls(el, 'menu-row')).length, 0, '没有已买的：只有开关');
    await env.toggle(sh).fire('click');
    await settle();
    assert.deepEqual([env.wake.requests, env.chip().textContent], [1, 'Screen On']);
    env.leave();
    await settle();
    assert.equal(env.wake.released, 1);
  } finally { env.done(); }
  // 「未指定」也一样，标题写「未指定」
  const none = setup({ page: 'store', id: 'none', wake: fakeWake() });
  try {
    state.setLocal({ keepAwake: true });
    none.remount();
    await settle();
    assert.equal(none.wake.requests, 1);
    assert.equal((await none.menu()).opts.title, '未指定');
  } finally { none.done(); }
});

test('不支持（没有 navigator.wakeLock）：⋯ 里那一行不是开关，说清做不到；开着也不显示小标签；繁体用台湾的说法', async () => {
  const env = setup({ wake: fakeWake({ supported: false }), lang: 'zh-Hant-TW' });
  try {
    state.setLocal({ keepAwake: true });
    env.remount();
    await settle();
    assert.equal(env.chip().hidden, true);
    const sh = await env.menu();
    assert.equal(env.toggle(sh), undefined, '没有点了也做不到的开关');
    const row = byCls(sh.el, 'awake-na');
    assert.equal(row.tag, 'div');
    assert.equal(row.textContent, '螢幕保持開啟這臺裝置不支援讓螢幕保持開啟。可以在系統設定裡把「自動鎖定」調長一點');
  } finally { env.done(); }
});

test('被拒绝（低电量模式之类）：顶栏淡淡地写「没能常亮」，菜单里说一句；点一下页面（或小标签）再要，给了就换成「屏幕常亮中」', async () => {
  const env = setup({ wake: fakeWake({ deny: true }) });
  const w = env.wake;
  try {
    await env.toggle(await env.menu()).fire('click');
    await settle();
    const chip = env.chip();
    assert.deepEqual([w.requests, chip.hidden, chip.textContent, cls(chip, 'denied'), chip.attrs['aria-label']],
      [1, false, '没能常亮', true, '没能让屏幕常亮，点一下再试一次']);
    const sh = await env.menu();
    assert.deepEqual([env.toggle(sh).attrs['aria-checked'], byCls(sh.el, 'awake-hint').textContent], ['true', '刚才没能让屏幕常亮（比如开着低电量模式）']);
    sh.close();
    // 点一下页面：再要一次（还是被拒绝：字不换来换去）
    await env.main.fire('click');
    await settle();
    assert.deepEqual([w.requests, env.chip().textContent], [2, '没能常亮']);
    // 点小标签：再要，这次给了
    w.deny = false;
    await env.chip().fire('click');
    await settle();
    assert.deepEqual([w.requests, env.chip().textContent, cls(env.chip(), 'denied'), state.getLocal().keepAwake], [3, '屏幕常亮中', false, true]);
  } finally { env.done(); }
});

test('去掉购物模式以后没留下的：页面、路由、规则、文案、样式；sw.js 不再缓存它们', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  for (const f of ['src/views/shop.js', 'src/core/shop.js', 'src/strings/shop.js']) assert.equal(fs.existsSync(path.join(root, f)), false, f);
  const walk = (dir) => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(d => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]));
  const files = [...walk('src').filter(f => f.endsWith('.js') && !f.startsWith(path.join('src', 'data'))), 'styles.css', 'sw.js', 'index.html'];
  const banned = ['购物模式', '購物模式', '开始购物', '開始購物', '完成购物', '完成購物', 'Start Shopping', 'Done Shopping', 'views/shop', 'core/shop', 'strings/shop', 'shopProgress', "'shop'", 'shop.', 'shop-', 'view-shop', 'data-route="shop"'];
  for (const f of files) {
    const text = fs.readFileSync(path.join(root, f), 'utf8');
    for (const word of banned) assert.equal(text.includes(word), false, `${f} 里还有「${word}」`);
  }
  for (const lang of Object.keys(STRINGS)) assert.deepEqual(Object.keys(STRINGS[lang]).filter(k => k.startsWith('shop.')), [], lang);
});
