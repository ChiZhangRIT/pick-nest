// 商店（core/stores.js）和分类（core/categories.js）：「商店」页的数法、一家店的分组、清除已买，设置里的新增、改名、归档、删除、排顺序。全是编的数据
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureSeeds, blankState, normalizeRecord, deletedRecord, restoredRecord, mergeStates, SEED_STORES, GROCERY_CATEGORIES, GENERAL_CATEGORIES } from '../src/core/store.js';
import { storeCounts, storeRows, emptyStoresIn, groupStore, clearStoreDone, storeFilter, storeFilterPatch, storeFilterOptions, shoppingItems, storeKeyOf, activeStores, archivedStores, createStore, renameStore, setStoreArchived, deleteStore, moveStore } from '../src/core/stores.js';
import { categorySections, categoriesFor, createCategory, renameCategory, deleteCategory, moveCategory } from '../src/core/categories.js';
import { groupNeed, collatorFor, storeView, storeViewPatch } from '../src/core/group.js';
import { createList, setArchived, deleteList } from '../src/core/lists.js';
import { toggleDone, countUsing } from '../src/core/items.js';
import { memoryOf } from '../src/core/memory.js';
import * as state from '../src/core/state.js';

const T0 = 1_700_000_000_000;
let clock = T0;
const now = () => (clock += 1000);
const seeded = () => ensureSeeds(blankState());
const names = (arr) => arr.map(it => it.name);
const zh = collatorFor('zh-Hans');
/** 名字 → id（记录 id 只能用 safeKey 的字符：编的 i_0、i_1……） @type {Record<string, string>} */
const ID = {};
const item = (s, name) => s.data.items[ID[name]];

/** 食材清单、想买、一张自建的木工清单和一张归档的清单，东西分在几家店（编的） */
function shopState() {
  const s = seeded();
  const wood = createList(s, { name: '木工', kind: 'general' }, now()).id;
  const old = createList(s, { name: '去年的', kind: 'grocery' }, now()).id;
  setArchived(s, old, true, now());
  let n = 0;
  const add = (listId, name, f = {}) => { const id = ID[name] = 'i_' + n++; s.data.items[id] = normalizeRecord('items', { id, listId, name, status: 'need', updatedAt: 1, ...f }); };
  add('l_groceries', '牛奶', { storeId: 's_wholefoods', categoryId: 'c_dairy' });
  add('l_groceries', '苹果', { storeId: 's_wholefoods', categoryId: 'c_produce' });
  add('l_groceries', '鸡蛋', { storeId: 's_wholefoods', categoryId: 'c_dairy', status: 'done', doneAt: T0 + 5 });
  add('l_groceries', '面包', { storeId: 's_wholefoods', categoryId: 'c_bakery', status: 'done', doneAt: T0 + 9 });
  add('l_groceries', '豆腐', { storeId: 's_hmart', categoryId: 'c_produce' });
  add('l_groceries', '没听说过的', { storeId: 's_wholefoods' });
  add('l_tobuy', '电池', { storeId: 's_costco', categoryId: 'c_electronics' });
  add('l_tobuy', '雨伞', { storeId: 's_costco', status: 'later' });
  add('l_tobuy', '台灯', {});
  add(wood, '砂纸', { storeId: 's_homedepot', categoryId: 'c_tools' });
  add(wood, '木胶', { storeId: 's_wholefoods' });                     // 一般清单上的东西也可以在这家买
  add(old, '月饼', { storeId: 's_wholefoods' });                     // 归档的清单：不算
  add('l_groceries', '删掉的', { storeId: 's_wholefoods', deleted: true });
  return { s, wood, old };
}

// ---------- 「商店」页 ----------
test('storeCounts：跨所有清单只数「要买」的；以后再说、已买、删掉的、归档的清单上的不算；没指定的在 null 下', () => {
  const { s } = shopState();
  const c = storeCounts(s);
  assert.deepEqual(Object.fromEntries(c), { s_wholefoods: 4, s_hmart: 1, s_costco: 1, null: 1, s_homedepot: 1 });
  assert.equal(c.get(null), 1, '台灯');
});

test('storeCounts：商店删掉了（或者根本没有）→ 算「未指定」；归档了的照常算自己的；删掉的清单上的不算', () => {
  const { s, wood } = shopState();
  s.data.stores.s_hmart = deletedRecord(s.data.stores.s_hmart, now());
  s.data.items[ID.台灯] = { ...item(s, '台灯'), storeId: 's_nope' };
  setStoreArchived(s, 's_costco', true, now());
  deleteList(s, wood, now());
  const c = storeCounts(s);
  assert.deepEqual([c.get('s_hmart'), c.get(null), c.get('s_costco'), c.get('s_homedepot'), c.get('s_wholefoods')], [undefined, 2, 1, undefined, 3]);
  assert.equal(storeKeyOf(s, item(s, '豆腐')), null);
  assert.equal(item(s, '豆腐').storeId, 's_hmart', 'storeId 不改：商店恢复了就回来');
  s.data.stores.s_hmart = restoredRecord(s.data.stores.s_hmart, now());
  assert.equal(storeCounts(s).get('s_hmart'), 1);
});

test('storeRows：没归档的店按顺序（0 样的也列）；归档的店只在还有要买的时候列，排在后面；「未指定」有要买的才列，在最后', () => {
  const { s } = shopState();
  const rows = (st) => storeRows(st).map(r => [r.id, r.n]);
  assert.deepEqual(rows(s), [...SEED_STORES.map(([id]) => [id, { s_wholefoods: 4, s_hmart: 1, s_costco: 1, s_homedepot: 1 }[id] || 0]), [null, 1]]);
  setStoreArchived(s, 's_hmart', true, now());          // 还有豆腐要买
  setStoreArchived(s, 's_target', true, now());         // 没有要买的
  s.data.items[ID.台灯] = { ...item(s, '台灯'), storeId: 's_amazon' };
  const r = rows(s);
  assert.deepEqual(r.at(-1), ['s_hmart', 1], '归档的还有东西：列在后面');
  assert.ok(!r.some(([id]) => id === 's_target' || id === null));
  assert.equal(storeRows(s).at(-1).store.archived, true);
});

// ---------- 一家店的页面 ----------
test('groupStore：这家店要买的（跨清单）按分类分组，组按分类的顺序，未分类在最后；已买新的在前；以后再说、归档的清单不在', () => {
  const { s } = shopState();
  const g = groupStore(s, 's_wholefoods', zh);
  assert.deepEqual(g.groups.map(x => [x.id, names(x.items)]), [['c_produce', ['苹果']], ['c_dairy', ['牛奶']], [null, ['没听说过的', '木胶']]]);
  assert.deepEqual(names(g.done), ['面包', '鸡蛋']);
  assert.deepEqual(groupStore(s, 's_costco', zh).groups.map(x => [x.id, names(x.items)]), [['c_electronics', ['电池']]], '雨伞是以后再说');
  assert.deepEqual(groupStore(s, null, zh).groups.map(x => names(x.items)), [['台灯']]);
  // 删掉的分类归到未分类；删掉的商店的东西到「未指定」那一页
  s.data.categories.c_dairy = deletedRecord(s.data.categories.c_dairy, now());
  assert.deepEqual(names(groupStore(s, 's_wholefoods', zh).groups.at(-1).items), ['没听说过的', '木胶', '牛奶']);
  s.data.stores.s_hmart = deletedRecord(s.data.stores.s_hmart, now());
  assert.deepEqual(groupStore(s, null, zh).groups.flatMap(x => names(x.items)), ['豆腐', '台灯']);
  assert.deepEqual(groupStore(s, 's_hmart', zh), { groups: [], done: [] });
});

test('商店页勾掉：记下这次在这家买的（memory），算进已买；「清除已买」只清这家的，撤销能回来', () => {
  const { s } = shopState();
  state.load({ storage: null });
  state.mutate(st => { Object.assign(st.data, structuredClone(s.data)); });
  state.mutate(st => toggleDone(st, ID.电池, now()));
  const S = () => state.getState();
  assert.deepEqual(names(groupStore(S(), 's_costco').done), ['电池']);
  assert.equal(memoryOf(S(), '电池').stores.s_costco.n, 1);
  assert.equal(state.mutate(st => clearStoreDone(st, 's_wholefoods', now()), { undoLabel: '清除' }), 2);
  assert.deepEqual(groupStore(S(), 's_wholefoods').done, []);
  assert.equal(item(S(), '鸡蛋').deleted, true);
  assert.equal(item(S(), '电池').deleted, undefined, '别家的已买不动');
  state.undo();
  assert.deepEqual(names(groupStore(S(), 's_wholefoods', zh).done), ['面包', '鸡蛋']);
});

// ---------- 只看一张清单（本机的 storeFilter） ----------
test('只看一张清单：storeCounts / storeRows 只数这张，只列这张在那儿有东西的店（emptyStoresIn 是没列的几家）；不给 / null 是所有清单', () => {
  const { s, wood } = shopState();
  assert.deepEqual(Object.fromEntries(storeCounts(s, { listId: wood })), { s_homedepot: 1, s_wholefoods: 1 }, '砂纸、木胶');
  assert.deepEqual(Object.fromEntries(storeCounts(s, { listId: 'l_tobuy' })), { s_costco: 1, null: 1 }, '雨伞是以后再说');
  assert.deepEqual(storeCounts(s, { listId: null }), storeCounts(s));
  assert.deepEqual(storeCounts(s, {}), storeCounts(s));
  setStoreArchived(s, 's_hmart', true, now());          // 只有食材清单上的豆腐在那儿
  const rows = (f) => storeRows(s, f).map(r => [r.id, r.n]);
  const woodRows = rows({ listId: wood });
  assert.deepEqual(woodRows, activeStores(s).filter(st => ['s_homedepot', 's_wholefoods'].includes(st.id)).map(st => [st.id, 1]), '只列有东西的两家（按商店的顺序）；0 样的、H Mart、未指定都不列');
  assert.equal(emptyStoresIn(s, { listId: wood }), activeStores(s).length - 2, '没列的：没归档、在木工里 0 样的店');
  assert.equal(emptyStoresIn(s, {}), 0, '所有清单：都列着');
  assert.equal(emptyStoresIn(s, { listId: null }), 0);
  assert.equal(rows({}).length, activeStores(s).length + 2, '所有清单：0 样的也列（加上归档的 H Mart、未指定）');
  assert.deepEqual(rows({ listId: 'l_groceries' }).slice(-1), [['s_hmart', 1]], '食材清单在 H Mart 有豆腐：归档的店照样列');
  assert.deepEqual(rows({ listId: 'l_tobuy' }).at(-1), [null, 1], '想买：台灯没指定商店');
  // 删掉的、归档的清单：直接给它的 id 什么都数不到（页面先过 storeFilter，不会这样给）
  assert.equal(storeCounts(s, { listId: 'l_nope' }).size, 0);
  const { old } = shopState();
  assert.equal(shoppingItems(s, { listId: old }).length, 0);
});

test('只看一张清单：groupStore 的要买、已买都只有这张上的；清除已买只清看得到的，别的清单在这家买到的不动', () => {
  const { s, wood } = shopState();
  s.data.items[ID.木胶] = { ...item(s, '木胶'), status: 'done', doneAt: T0 + 20 };
  const g = groupStore(s, 's_wholefoods', zh, { listId: wood });
  assert.deepEqual([g.groups, names(g.done)], [[], ['木胶']]);
  const gg = groupStore(s, 's_wholefoods', zh, { listId: 'l_groceries' });
  assert.deepEqual([gg.groups.flatMap(x => names(x.items)), names(gg.done)], [['苹果', '牛奶', '没听说过的'], ['面包', '鸡蛋']]);
  assert.deepEqual(groupStore(s, 's_wholefoods', zh, {}), groupStore(s, 's_wholefoods', zh), '不给就是所有清单');
  assert.equal(clearStoreDone(s, 's_wholefoods', now(), { listId: wood }), 1);
  assert.equal(item(s, '木胶').deleted, true);
  assert.deepEqual([item(s, '鸡蛋').deleted, item(s, '面包').deleted], [undefined, undefined], '食材清单上在 Whole Foods 买到的没看见，不清');
  assert.equal(clearStoreDone(s, 's_wholefoods', now()), 2, '所有清单：剩下的都清');
});

test('storeFilter：记着的清单还在、没归档才用它；没记、认不出、删掉了、归档了 → 所有清单（null），记着的值不动，撤销删除 / 取消归档后又按它筛', () => {
  const { s, wood, old } = shopState();
  assert.equal(storeFilter(s, {}), null);
  assert.equal(storeFilter(s, null), null);
  assert.equal(storeFilter(s, undefined), null);
  assert.equal(storeFilter(s, { storeFilter: wood }), wood);
  assert.equal(storeFilter(s, { storeFilter: 'l_groceries' }), 'l_groceries');
  for (const junk of ['l_nope', 42, ['l_groceries'], { id: wood }, '__proto__', 'toString', '']) assert.equal(storeFilter(s, { storeFilter: junk }), null, String(junk));
  assert.equal(storeFilter(s, { storeFilter: old }), null, '归档的清单');
  const local = { storeFilter: wood };
  deleteList(s, wood, now());
  assert.equal(storeFilter(s, local), null, '删掉的清单');
  assert.deepEqual(local, { storeFilter: wood }, '只读，不改记着的');
  s.data.lists[wood] = restoredRecord(s.data.lists[wood], now());
  assert.equal(storeFilter(s, local), wood, '恢复了又按它筛');
  setArchived(s, 'l_groceries', true, now());
  assert.equal(storeFilter(s, { storeFilter: 'l_groceries' }), null, '自带的清单归档了也一样');
  assert.deepEqual(storeFilterPatch(wood), { storeFilter: wood });
  assert.deepEqual(storeFilterPatch(null), { storeFilter: null });
  assert.deepEqual(storeFilterPatch(undefined), { storeFilter: null });
});

test('storeFilterOptions：「所有清单」在最前（各张加起来），然后首页上的清单（首页的顺序，归档、删掉的不列）；给了店只数这家的（null = 未指定）', () => {
  const { s, wood } = shopState();
  const rows = (at) => storeFilterOptions(s, at).map(o => [o.id, o.n]);
  assert.deepEqual(rows(), [[null, 8], ['l_groceries', 4], ['l_tobuy', 2], [wood, 2]], '月饼在归档的清单上，不算也不列');
  assert.deepEqual(rows({ storeId: 's_wholefoods' }), [[null, 4], ['l_groceries', 3], ['l_tobuy', 0], [wood, 1]]);
  assert.deepEqual(rows({ storeId: null }), [[null, 1], ['l_groceries', 0], ['l_tobuy', 1], [wood, 0]], '未指定：台灯');
  assert.equal(storeFilterOptions(s)[0].list, null);
  assert.equal(storeFilterOptions(s)[3].list.name, '木工');
  deleteList(s, wood, now());
  setArchived(s, 'l_tobuy', true, now());
  assert.deepEqual(rows(), [[null, 4], ['l_groceries', 4]]);
});

test('一家店的显示方式（本机）：「已买」默认展开；「未指定」的键是 none；认不出的值按默认', () => {
  assert.deepEqual(storeView({}, 's_costco'), { showDone: true });
  assert.deepEqual(storeView({ storeView: { s_costco: { showDone: false } } }, 's_costco'), { showDone: false });
  assert.deepEqual(storeView({ storeView: { none: { showDone: false } } }, null), { showDone: false });
  assert.deepEqual(storeView({ storeView: { s_costco: 'x' } }, 's_costco'), { showDone: true });
  assert.deepEqual(storeView(null, 's_costco'), { showDone: true });
});

test('改一家店的显示方式（storeViewPatch）：整个 storeView 换掉，别的店的原样留着；「未指定」（null）写在 none 下', () => {
  const local = { storeView: { s_costco: { showDone: false }, none: { showDone: false } } };
  assert.deepEqual(storeViewPatch(local, 's_hmart', { showDone: false }), { storeView: { s_costco: { showDone: false }, none: { showDone: false }, s_hmart: { showDone: false } } });
  assert.deepEqual(storeViewPatch(local, null, { showDone: true }), { storeView: { s_costco: { showDone: false }, none: { showDone: true } } });
  assert.deepEqual(local, { storeView: { s_costco: { showDone: false }, none: { showDone: false } } }, '不改传进来的');
  assert.deepEqual(storeViewPatch(undefined, 's_costco', { showDone: false }), { storeView: { s_costco: { showDone: false } } });
});

// ---------- 设置 → 商店 ----------
test('新增商店：排在最后；名字不能空，不能和别的（没删除的）店同名（大小写、繁简算同名）；删掉的不算', () => {
  const s = seeded();
  const r = createStore(s, { name: '  农贸市场 ' }, now());
  assert.ok(r.ok);
  assert.match(r.id, /^s_/);
  assert.deepEqual([s.data.stores[r.id].name, s.data.stores[r.id].order, activeStores(s).at(-1).id], ['农贸市场', SEED_STORES.length, r.id]);
  assert.deepEqual(createStore(s, { name: ' ' }, now()), { ok: false, errors: { name: 'store.err.name' } });
  assert.deepEqual(createStore(s, { name: 'costco' }, now()), { ok: false, errors: { name: 'store.err.taken' } });
  assert.deepEqual(createStore(s, { name: '農貿市場' }, now()).ok, false);
  deleteStore(s, 's_costco', now());
  assert.ok(createStore(s, { name: 'Costco' }, now()).ok, '删掉的那家不挡名字');
});

test('改名、归档、删除商店：只改这一家；删除是软删除，预置的也能删，ensureSeeds 不补回来；东西的 storeId 不动', () => {
  const { s } = shopState();
  assert.equal(renameStore(s, 's_costco', ' Costco Wholesale ', now()).store.name, 'Costco Wholesale');
  assert.deepEqual(renameStore(s, 's_costco', '', now()), { ok: false, errors: { name: 'store.err.name' } });
  assert.deepEqual(renameStore(s, 's_costco', 'h mart', now()), { ok: false, errors: { name: 'store.err.taken' } });
  assert.equal(renameStore(s, 's_costco', 'costco wholesale', now()).ok, true, '只改大小写不算和自己重名');
  setStoreArchived(s, 's_target', true, now());
  assert.ok(!activeStores(s).some(x => x.id === 's_target'));
  assert.deepEqual(archivedStores(s).map(x => x.id), ['s_target']);
  assert.equal(countUsing(s, 'storeId', 's_wholefoods'), 7, '没删除的清单上的（归档的也算）、什么状态都算');
  assert.equal(deleteStore(s, 's_wholefoods', now()), true);
  assert.equal(deleteStore(s, 's_wholefoods', now()), false, '已经删了');
  ensureSeeds(s);
  assert.equal(s.data.stores.s_wholefoods.deleted, true, '删掉的预置商店不会回来');
  assert.equal(item(s, '牛奶').storeId, 's_wholefoods');
  assert.equal(storeCounts(s).get(null), 5, '台灯和原来在 Whole Foods 要买的四样');
  assert.equal(setStoreArchived(s, 's_wholefoods', false, now()), null);
  assert.equal(renameStore(s, 's_wholefoods', 'x', now()).ok, false);
});

test('商店排顺序：挪到上一家 / 下一家（没归档的）的另一边，只改这一家的 order（别的、预置的都还是 updatedAt 0）；到头了挪不动', () => {
  const s = seeded();
  const at = (id) => s.data.stores[id].updatedAt;
  const stamps = () => Object.fromEntries(Object.values(s.data.stores).map(x => [x.id, x.updatedAt]));
  assert.equal(moveStore(s, 's_costco', -1, now()), true);
  assert.deepEqual(activeStores(s).slice(0, 4).map(x => x.id), ['s_wholefoods', 's_costco', 's_traderjoes', 's_target']);
  assert.deepEqual(SEED_STORES.map(([id]) => at(id) > 0), [false, false, true, false, false, false, false, false], '越过的 Trader Joe\'s 也不盖新时间');
  assert.equal(moveStore(s, 's_wholefoods', -1, now()), false);
  assert.equal(moveStore(s, 's_homedepot', 1, now()), false);
  assert.equal(moveStore(s, 's_nope', 1, now()), false);
  // 归档的不参与：H Mart 归档了，Target 往下挪一下就到 99 Ranch 后面；中间夹着归档的，后面的店也不跟着改
  setStoreArchived(s, 's_hmart', true, now());
  assert.equal(moveStore(s, 's_hmart', 1, now()), false, '归档的不排');
  const was = stamps();
  moveStore(s, 's_target', 1, now());
  assert.deepEqual(activeStores(s).map(x => x.id), ['s_wholefoods', 's_costco', 's_traderjoes', 's_99ranch', 's_target', 's_amazon', 's_homedepot']);
  assert.deepEqual(Object.entries(stamps()).filter(([id, t]) => t !== was[id]).map(([id]) => id), ['s_target'], '只有挪的那一家');
  // 取消归档：H Mart 回到原来的位置（order 没被别的店占掉）
  setStoreArchived(s, 's_hmart', false, now());
  assert.deepEqual(activeStores(s).map(x => x.id).slice(2, 5), ['s_traderjoes', 's_hmart', 's_99ranch']);
});

test('排顺序和合并：挪一家 / 一个分类不会让别的设备上的删除被盖掉（只有挪的那一条盖了新时间）', () => {
  const base = seeded();
  setStoreArchived(base, 's_hmart', true, now());
  const A = structuredClone(base), B = structuredClone(base);
  deleteStore(B, 's_amazon', now());              // B 先删了 Amazon
  moveStore(A, 's_costco', 1, now());             // A 后来把 Costco 往下挪（越过 Target，后面隔着归档的 H Mart）
  assert.equal(A.data.stores.s_amazon.updatedAt, 0);
  const m = ensureSeeds(mergeStates(A, B));
  assert.equal(m.data.stores.s_amazon.deleted, true, '删除还在');
  assert.deepEqual(activeStores(m).map(x => x.id).slice(0, 4), ['s_wholefoods', 's_traderjoes', 's_target', 's_costco'], '挪的也在');
  // 分类：新加的食材分类排在所有一般分类后面，往上挪一下就越过了它们——它们不能跟着盖新时间
  const C = seeded(), D = structuredClone(C);
  deleteCategory(D, 'c_books', now());
  const pet = createCategory(C, { name: '宠物', kind: 'grocery' }, now()).id;
  moveCategory(C, pet, -1, now());
  const mc = mergeStates(C, D);
  assert.equal(mc.data.categories.c_books.deleted, true);
  assert.deepEqual(categorySections(mc).grocery.slice(-2).map(c => c.id), [pet, 'c_household']);
});

test('排顺序：前后两条的 order 一样（两台设备各自新建的）或者中间值分不开时，才整个写成 0、1、2……（只盖变了的）', () => {
  const s = blankState();
  for (const [id, order] of [['s_a', 0], ['s_b', 5], ['s_c', 5], ['s_d', 5]]) s.data.stores[id] = normalizeRecord('stores', { id, name: id, order, createdAt: 1, updatedAt: 1 });
  assert.equal(moveStore(s, 's_d', -1, now()), true);       // 要插到 b 和 c（都是 5）中间
  assert.deepEqual(activeStores(s).map(x => [x.id, x.order]), [['s_a', 0], ['s_b', 1], ['s_d', 2], ['s_c', 3]]);
  assert.equal(s.data.stores.s_a.updatedAt, 1, 'order 没变的不盖');
  // 同一个地方来回挪很多次：每次都还是挪对了，小数分不开时重新编号
  const ids = () => activeStores(s).map(x => x.id);
  let renumbered = false;
  for (let k = 0; k < 1200; k++) {
    const second = ids()[1];
    moveStore(s, ids()[2], -1, now());
    assert.equal(ids()[2], second, '挪了一格');
    if (k > 0 && activeStores(s).every(x => Number.isInteger(x.order))) renumbered = true;
  }
  assert.ok(renumbered);
});

// ---------- 设置 → 分类 ----------
test('分类分三组：食材 / 一般 / 两边都用，各自按顺序；清单能用的是自己那一种加两边都用的；删掉的不在', () => {
  const s = seeded();
  const both = createCategory(s, { name: '礼物', kind: 'both' }, now()).id;
  const pet = createCategory(s, { name: '宠物', kind: 'grocery' }, now()).id;
  const sec = categorySections(s);
  assert.deepEqual(sec.grocery.map(c => c.id), [...GROCERY_CATEGORIES.map(x => 'c_' + x), pet]);
  assert.deepEqual(sec.general.map(c => c.id), GENERAL_CATEGORIES.map(x => 'c_' + x));
  assert.deepEqual(sec.both.map(c => c.id), [both]);
  assert.equal(s.data.categories[both].kind, null, '「两边都用」存成 null');
  assert.deepEqual(categoriesFor(s, 'general').map(c => c.id), [...GENERAL_CATEGORIES.map(x => 'c_' + x), both]);
  assert.ok(categoriesFor(s, 'grocery').some(c => c.id === both) && !categoriesFor(s, 'grocery').some(c => c.id === 'c_books'));
  deleteCategory(s, 'c_books', now());
  assert.ok(!categorySections(s).general.some(c => c.id === 'c_books'));
  assert.equal(createCategory(s, { name: 'x', kind: 'project' }, now()).ok, true);
  assert.equal(categorySections(s).both.length, 2, '认不出的种类当成两边都用');
});

test('新增 / 改名分类：名字不能空；预置分类的名字可以清空（显示界面语言的名字），自建的不行', () => {
  const s = seeded();
  assert.deepEqual(createCategory(s, { name: '  ', kind: 'grocery' }, now()), { ok: false, errors: { name: 'cat.err.name' } });
  const id = createCategory(s, { name: '宠物', kind: 'grocery' }, now()).id;
  assert.equal(s.data.categories[id].order, 14, '排在最后');
  assert.equal(renameCategory(s, 'c_dairy', ' 奶制品 ', now()).category.name, '奶制品');
  assert.equal(renameCategory(s, 'c_dairy', '', now()).category.name, '');
  assert.deepEqual(renameCategory(s, id, '', now()), { ok: false, errors: { name: 'cat.err.name' } });
  assert.deepEqual(renameCategory(s, 'c_nope', 'x', now()), { ok: false, errors: { name: 'cat.gone' } });
});

test('分类重名：同一种清单上会一起出现的（同一种、或者有一边是两边都用）不能同名；食材和一般的可以；没改名的预置分类按显示的名字比（给了 t 才比）', () => {
  const s = seeded();
  const tr = (k) => ({ 'cat.sys.dairy': '蛋奶', 'cat.sys.books': '书籍' })[k] || k;
  assert.equal(createCategory(s, { name: '其他', kind: 'grocery' }, now()).ok, true);
  assert.equal(createCategory(s, { name: '其他', kind: 'general' }, now()).ok, true, '食材的和一般的碰不到一起');
  assert.deepEqual(createCategory(s, { name: ' 其他 ', kind: 'both' }, now()), { ok: false, errors: { name: 'cat.err.taken' } }, '两边都用的会和两边的都碰上');
  assert.deepEqual(createCategory(s, { name: '蛋奶', kind: 'grocery' }, now(), tr), { ok: false, errors: { name: 'cat.err.taken' } }, '预置分类没改过名：按显示的名字');
  assert.equal(createCategory(s, { name: '蛋奶', kind: 'general' }, now(), tr).ok, true);
  const gift = createCategory(s, { name: 'Gift', kind: 'both' }, now()).id;
  assert.deepEqual(renameCategory(s, 'c_books', 'gift', now(), tr), { ok: false, errors: { name: 'cat.err.taken' } }, '大小写不算不同');
  assert.equal(renameCategory(s, gift, 'GIFT', now(), tr).ok, true, '只改大小写不算和自己重名');
  // 预置分类清空名字 = 显示自带的名字：和那个名字的自建分类撞了也不行
  const books = createCategory(s, { name: '书籍', kind: 'both' }, now(), tr).ok;
  assert.equal(books, false, '「书籍」已经是一般分类显示的名字');
  renameCategory(s, 'c_books', '图书', now(), tr);
  const mine = createCategory(s, { name: '书籍', kind: 'general' }, now(), tr).id;
  assert.deepEqual(renameCategory(s, 'c_books', '', now(), tr), { ok: false, errors: { name: 'cat.err.taken' } });
  deleteCategory(s, mine, now());
  assert.equal(renameCategory(s, 'c_books', '', now(), tr).ok, true, '删掉的不算');
});

test('删除分类：软删除，东西留着 categoryId、归到未分类，恢复后回来；删掉的预置分类不会被补回来', () => {
  const { s } = shopState();
  assert.equal(countUsing(s, 'categoryId', 'c_dairy'), 2);
  assert.equal(deleteCategory(s, 'c_dairy', now()), true);
  assert.equal(deleteCategory(s, 'c_dairy', now()), false);
  const g = groupNeed(s, 'l_groceries', 'category', zh);
  assert.deepEqual(names(g.groups.at(-1).items), ['没听说过的', '牛奶']);
  assert.equal(item(s, '牛奶').categoryId, 'c_dairy');
  ensureSeeds(s);
  assert.equal(s.data.categories.c_dairy.deleted, true);
  s.data.categories.c_dairy = restoredRecord(s.data.categories.c_dairy, now());
  assert.ok(groupNeed(s, 'l_groceries', 'category', zh).groups.some(x => x.id === 'c_dairy'));
});

test('分类排顺序：只在同一组里挪（跳过中间别的组的），只改挪的这一个；到头了挪不动', () => {
  const s = seeded();
  const at = (id) => s.data.categories[id].updatedAt;
  assert.equal(moveCategory(s, 'c_meat', -1, now()), true);
  assert.deepEqual(categorySections(s).grocery.slice(0, 3).map(c => c.id), ['c_meat', 'c_produce', 'c_dairy']);
  const stamped = () => Object.values(s.data.categories).filter(c => c.updatedAt > 0).map(c => c.id).sort();
  assert.deepEqual(stamped(), ['c_meat'], '只有挪的那一个盖新时间，越过的「蔬果」和别的分类还是 updatedAt 0');
  assert.equal(moveCategory(s, 'c_meat', -1, now()), false, '组里第一个');
  assert.equal(moveCategory(s, 'c_household', 1, now()), false, '组里最后一个：下面是一般的分类，不跨过去');
  assert.equal(moveCategory(s, 'c_clothing', -1, now()), false);
  // 新加的食材分类排在所有分类的最后（一般的后面）：往上挪一下就到「日用清洁」前面，一般的分类不动
  const pet = createCategory(s, { name: '宠物', kind: 'grocery' }, now()).id;
  assert.equal(moveCategory(s, pet, -1, now()), true);
  assert.deepEqual(categorySections(s).grocery.slice(-2).map(c => c.id), [pet, 'c_household']);
  assert.deepEqual(categorySections(s).general.map(c => c.id), GENERAL_CATEGORIES.map(x => 'c_' + x));
  assert.equal(at('c_snacks'), 0, '没挪的不盖新时间');
  assert.deepEqual(stamped(), ['c_meat', pet].sort(), '越过的一般分类也不盖');
  assert.deepEqual([s.data.categories.c_snacks.order, s.data.categories[pet].order, s.data.categories.c_household.order], [7, 7.5, 8], '只改这一个：取前后两个的中间值');
  assert.equal(moveCategory(s, 'c_nope', 1, now()), false);
});
