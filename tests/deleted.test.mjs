// 最近删除：core/deleted.js（列哪些、能不能恢复）和页面 views/deleted.js（假 DOM + 真的 state.js，只用内存）。全是编的数据
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as state from '../src/core/state.js';
import { ensureSeeds, blankState, normalizeRecord, deletedRecord, restoredRecord } from '../src/core/store.js';
import { createList, deleteList, visibleItems } from '../src/core/lists.js';
import { addItem, clearDone, setStatus, liveItem } from '../src/core/items.js';
import { deleteStore, createStore } from '../src/core/stores.js';
import { deleteCategory, createCategory } from '../src/core/categories.js';
import { recentlyDeleted, deletedCount, restoreBlock, itemsWithList } from '../src/core/deleted.js';
import { render } from '../src/views/deleted.js';
import { setLang, t } from '../src/i18n.js';
import { Element, all, find, installDom } from './helpers/dom.mjs';

const S = () => state.getState();
const cls = (el, c) => (el.className || el.attrs.class || '').split(' ').includes(c);
const allCls = (root, c) => all(root, el => cls(el, c));

/** 编出来的一份：一张自建清单（里面两样，删掉了清单）、删掉的东西、清除的已买、删掉的商店和分类 */
function seed(now = 1_700_000_000_000) {
  state.load({ storage: null });
  const ids = {};
  state.mutate(s => {
    ids.wood = createList(s, { name: '木工', kind: 'general' }, now).id;
    addItem(s, ids.wood, { name: '砂纸' }, now); addItem(s, ids.wood, { name: '木胶' }, now);
    addItem(s, 'l_groceries', { name: '牛奶' }, now); addItem(s, 'l_groceries', { name: '鸡蛋' }, now); addItem(s, 'l_groceries', { name: '面包' }, now);
  });
  const id = (name, list = 'l_groceries') => Object.values(S().data.items).find(it => it.name === name && it.listId === list).id;
  ids.milk = id('牛奶'); ids.egg = id('鸡蛋'); ids.bread = id('面包'); ids.sand = id('砂纸', ids.wood);
  state.mutate(s => { s.data.items[ids.egg] = deletedRecord(s.data.items[ids.egg], now + 1000); });
  state.mutate(s => { setStatus(s, ids.bread, 'done', now + 1500); clearDone(s, 'l_groceries', now + 2000); });
  state.mutate(s => { s.data.items[ids.sand] = deletedRecord(s.data.items[ids.sand], now + 2500); deleteList(s, ids.wood, now + 3000); });
  state.mutate(s => { deleteStore(s, 's_costco', now + 4000); deleteCategory(s, 'c_books', now + 5000); });
  return ids;
}

test('列出来的：删掉的清单、东西（只列清单还在的）、商店、分类，各自新删的在前；数一共几项', () => {
  const ids = seed();
  const d = recentlyDeleted(S());
  assert.deepEqual(d.lists.map(l => l.name), ['木工']);
  assert.deepEqual(d.items.map(it => it.name), ['面包', '鸡蛋'], '新删的在前；砂纸在删掉的清单里，跟着清单');
  assert.equal(d.items[0].status, 'done', '「清除已买」清掉的还是已买');
  assert.deepEqual(d.stores.map(s => s.id), ['s_costco']);
  assert.deepEqual(d.categories.map(c => c.id), ['c_books']);
  assert.equal(deletedCount(S()), 5);
  assert.equal(itemsWithList(S(), ids.wood), 1, '木胶会跟着清单回来；分开删掉的砂纸不算');
});

test('恢复清单：里面的东西一起回来（它们本来就没删）；分开删掉的那样还在最近删除里，可以单独恢复', () => {
  const ids = seed();
  assert.equal(visibleItems(S()).some(it => it.listId === ids.wood), false, '清单删了：东西跟着隐藏');
  assert.equal(restoreBlock(S(), 'items', ids.sand), 'list', '清单还删着：先恢复清单');
  assert.equal(restoreBlock(S(), 'lists', ids.wood), null);
  state.mutate(s => { s.data.lists[ids.wood] = restoredRecord(s.data.lists[ids.wood]); });
  assert.deepEqual(visibleItems(S()).filter(it => it.listId === ids.wood).map(it => it.name), ['木胶']);
  assert.deepEqual(recentlyDeleted(S()).items.map(it => it.name), ['砂纸', '面包', '鸡蛋'], '砂纸现在列出来了');
  assert.equal(restoreBlock(S(), 'items', ids.sand), null);
});

test('不能恢复的：清单上已经有同名的（改名改出来的、别的设备加的）、已经有同名的商店 / 会一起出现的同名分类、已经不在最近删除里的', () => {
  const ids = seed();
  assert.equal(restoreBlock(S(), 'items', ids.egg), null);
  // 又加了一个「鸡蛋」：addItem 会恢复同一条（不会有两条）；改名改出来的同名就是两条了
  state.mutate(s => { s.data.items.i_other = normalizeRecord('items', { id: 'i_other', listId: 'l_groceries', name: '雞蛋', status: 'need', updatedAt: 1 }); });
  assert.equal(restoreBlock(S(), 'items', ids.egg), 'item', '简繁算同名');
  state.mutate(s => { createStore(s, { name: 'costco' }); });
  assert.equal(restoreBlock(S(), 'stores', 's_costco'), 'store');
  assert.equal(restoreBlock(S(), 'categories', 'c_books', t), null);
  setLang('zh-Hans');
  state.mutate(s => { createCategory(s, { name: '书籍', kind: 'general' }, Date.now(), t); });
  assert.equal(restoreBlock(S(), 'categories', 'c_books', t), 'category', '没改过名的预置分类按显示的名字比');
  assert.equal(restoreBlock(S(), 'items', ids.milk), 'gone', '没删的');
  assert.equal(restoreBlock(S(), 'items', 'i_nope'), 'gone');
  assert.equal(restoreBlock(S(), 'memory', 'm_x'), 'gone', '别的集合不在这里恢复');
});

test('删掉的预置商店恢复以后，ensureSeeds 也不会再多补一份；再加一次已清除的东西就是恢复那一条（不在最近删除里了）', () => {
  const ids = seed();
  state.mutate(s => { s.data.stores.s_costco = restoredRecord(s.data.stores.s_costco); });
  ensureSeeds(S());
  assert.equal(Object.values(S().data.stores).filter(s => s.name === 'Costco').length, 1);
  state.mutate(s => { addItem(s, 'l_groceries', { name: '面包' }); });
  assert.ok(liveItem(S(), ids.bread));
  assert.ok(!recentlyDeleted(S()).items.some(it => it.id === ids.bread));
});

// ---------- 页面 ----------
function page({ lang = 'zh-Hans', seedFn = seed } = {}) {
  const dom = installDom();
  setLang(lang);
  const ids = seedFn();
  const env = { ...dom, ids, toasts: [], navs: [] };
  const main = env.main = new Element('section');
  const ctx = env.ctx = {
    t, lang: () => lang, get state() { return S(); }, get local() { return state.getLocal(); },
    toast: (msg, o = {}) => env.toasts.push({ msg, ...o }), back: (p) => env.navs.push('back:' + p),
    restore(c, id) { const r = restoredRecord(S().data[c][id]); state.mutate(s => { s.data[c][id] = r; }); env.toasts.push({ msg: t('common.restored') }); return r; },
    refresh() { main.replaceChildren(); render(main, { name: 'deleted' }, ctx); },
  };
  // 和 app.js 一样：页面没有 onChange，数据变了整页重画（焦点按 data-fid 放回）
  const off = state.subscribe(() => queueMicrotask(() => {
    const fid = dom.doc.activeElement && dom.doc.activeElement.dataset ? dom.doc.activeElement.dataset.fid : null;
    main.replaceChildren(); render(main, { name: 'deleted' }, ctx);
    const el = fid && main.querySelector(`[data-fid="${fid}"]`); if (el) el.focus();
  }));
  render(main, { name: 'deleted' }, ctx);
  env.done = () => { off(); dom.restore(); };
  env.rows = () => allCls(main, 'del-sec').map(sec => [sec.dataset.kind, allCls(sec, 'del-name').map(x => x.textContent)]);
  return env;
}
const settle = () => new Promise(r => setTimeout(r, 0));

test('页面：一句说明、四组（新删的在前）、每行一个「恢复」（读屏念名字）；清单那一行说里面几样会回来，清除的已买标「已买」，东西带清单名', () => {
  const env = page();
  try {
    const { main } = env;
    assert.equal(main.querySelector('.nb-title').textContent, '最近删除', '标题在顶栏中间');
    assert.ok(main.textContent.includes(t('deleted.lead')));
    assert.deepEqual(env.rows(), [['lists', ['木工']], ['items', ['面包', '鸡蛋']], ['stores', ['Costco']], ['categories', ['书籍']]]);
    const restoreBtns = all(main, el => el.tag === 'button' && el.textContent === '恢复');
    assert.equal(restoreBtns.length, 5);
    assert.equal(restoreBtns[0].attrs['aria-label'], '恢复「木工」');
    assert.ok(main.querySelector('.del-row').textContent.includes('里面的 1 样东西会一起回来'));
    const bread = allCls(main, 'del-row').find(r => r.textContent.includes('面包'));
    assert.ok(bread.textContent.includes('已买') && bread.textContent.includes('食材'));
    assert.ok(allCls(main, 'del-at').every(el => el.textContent.length > 0), '都写着什么时候删的');
    find(main, el => el.tag === 'button' && el.classList.contains('back')).fire('click');
    assert.deepEqual(env.navs, ['back:/settings'], '从设置首页「数据」那一组进来：返回设置');
  } finally { env.done(); }
});

test('页面：点「恢复」→ ctx.restore、这一行没了、焦点给同一组的下一行；撞名的不恢复，说为什么（两家同名的删掉的商店只能恢复一家）', async () => {
  const env = page();
  try {
    const { main } = env;
    const btnOf = name => find(allCls(main, 'del-row').find(r => r.textContent.includes(name)), el => el.tag === 'button');
    await btnOf('面包').fire('click');
    await settle();
    assert.deepEqual(env.rows()[1], ['items', ['鸡蛋']]);
    assert.equal(env.doc.activeElement, btnOf('鸡蛋'), '焦点给下一行');
    assert.equal(env.toasts.at(-1).msg, '已恢复');
    assert.equal(S().data.items[env.ids.bread].deleted, undefined);
    // 撞名：本机又有了一家 Costco
    state.mutate(s => { createStore(s, { name: 'Costco' }); });
    await settle();
    await btnOf('Costco').fire('click');
    assert.equal(env.toasts.at(-1).msg, '已经有一家叫「Costco」的商店了。先把那家改个名字再恢复。');
    assert.equal(S().data.stores.s_costco.deleted, true);
    state.mutate(s => { for (const st of Object.values(s.data.stores)) if (st.name === 'Costco' && st.id !== 's_costco') s.data.stores[st.id] = deletedRecord(st); });
    await settle();
    // 撞名的东西：这一页上没有打开的清单，说是哪张清单上的、怎么办
    state.mutate(s => { s.data.items.i_egg2 = normalizeRecord('items', { id: 'i_egg2', listId: 'l_groceries', name: '雞蛋', status: 'need', updatedAt: Date.now() }); });
    await settle();
    await btnOf('鸡蛋').fire('click');
    assert.equal(env.toasts.at(-1).msg, '「食材」上已经有「鸡蛋」了。先把那一样改个名字再恢复。');
    assert.equal(S().data.items[env.ids.egg].deleted, true);
    state.mutate(s => { s.data.items.i_egg2 = { ...s.data.items.i_egg2, name: '鸭蛋' }; });    // 照它说的改个名字，就能恢复了
    await settle();
    for (const name of ['木工', '鸡蛋', '书籍', '砂纸']) { await btnOf(name).fire('click'); await settle(); }
    // 剩下刚才新建又删掉的那家 Costco 和原来的：恢复一家以后另一家就撞名了
    await btnOf('Costco').fire('click'); await settle();
    assert.equal(allCls(main, 'del-row').length, 1);
    assert.equal(restoreBlock(S(), 'stores', allCls(main, 'del-row')[0].dataset.id), 'store');
  } finally { env.done(); }
});

test('页面：什么都没删 → 一句「没有删掉的东西」；东西很多时先列 50 样，「再显示」就地多列 50 样、焦点给新列出来的第一样', async () => {
  const empty = page({ seedFn: () => { state.load({ storage: null }); return {}; } });
  try {
    const box = empty.main.querySelector('.del-empty');
    assert.equal(box.children[0].tag, 'svg', '和 Babble 一样：一个淡淡的图标');
    assert.equal(box.children[1].textContent, '没有删掉的东西。');
    assert.equal(allCls(empty.main, 'del-sec').length, 0);
  } finally { empty.done(); }
  const env = page({ lang: 'en', seedFn: () => {
    state.load({ storage: null });
    state.mutate(s => { for (let i = 0; i < 120; i++) s.data.items['i_' + i] = deletedRecord(normalizeRecord('items', { id: 'i_' + i, listId: 'l_groceries', name: 'thing ' + i, updatedAt: 1000 + i }), 2000 + i); });
    return {};
  } });
  try {
    const { main } = env;
    assert.equal(allCls(main, 'del-row').length, 50);
    assert.equal(allCls(main, 'del-name')[0].textContent, 'thing 119', '新删的在前');
    const more = () => main.querySelector('.del-more');
    assert.equal(more().textContent, 'Show 50 more');
    await more().fire('click');
    assert.equal(allCls(main, 'del-row').length, 100);
    assert.equal(env.doc.activeElement.dataset.fid, 'del-items-i_69');
    assert.equal(more().textContent, 'Show 20 more');
    await more().fire('click');
    assert.equal(allCls(main, 'del-row').length, 120);
    assert.equal(more(), null);
  } finally { env.done(); }
});
