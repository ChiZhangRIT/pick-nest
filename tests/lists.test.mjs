// 内置的常见食材对照（core/catalog.js）、分组排序（core/group.js）、清单本身（core/lists.js）。全是编的数据
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureSeeds, blankState, normalizeRecord, deletedRecord, restoredRecord, homeLists, needCounts, GROCERY_CATEGORIES, SYS_CATEGORIES, DEFAULT_LIST_ICON } from '../src/core/store.js';
import { CATALOG, catalogSys, catalogCategory, isCatalogName } from '../src/core/catalog.js';
import { groupNeed, collatorFor, listView } from '../src/core/group.js';
import { createList, editList, setArchived, deleteList, moveList, archivedLists, visibleItems, firstGrapheme, LIST_ICONS } from '../src/core/lists.js';
import { addFromInput, toggleDone, setStatus } from '../src/core/items.js';
import { normName } from '../src/core/store.js';
import * as state from '../src/core/state.js';

const T0 = 1_700_000_000_000;
let clock = T0;
const now = () => (clock += 1000);
const seeded = () => ensureSeeds(blankState());

// ---------- 对照表 ----------
test('对照表：一百多样常见的东西（中英文），键都是 normName 的样子，分类都是预置的食材分类', () => {
  assert.ok(CATALOG.size >= 150, String(CATALOG.size));
  for (const [k, sys] of CATALOG) {
    assert.equal(normName(k), k, k);
    assert.ok(GROCERY_CATEGORIES.includes(sys), `${k} → ${sys}`);
  }
});

test('猜分类：整个名字 → 冻干、冷冻优先 → 名字里最长的键（中文至少两个字，英文按整个词、复数也算）；繁体、大小写都认', () => {
  const table = [
    ['牛奶', 'dairy'], ['雞蛋', 'dairy'], ['鳳梨', 'produce'], ['黃油', 'dairy'], ['Whole Milk', 'dairy'], ['EGGS', 'dairy'],
    ['有机牛奶', 'dairy'], ['希腊酸奶', 'dairy'], ['猪肉水饺', 'frozen'], ['冷冻草莓', 'frozen'], ['冻虾仁', 'frozen'], ['Frozen Strawberries', 'frozen'],
    ['strawberries', 'produce'], ['tomatoes', 'produce'], ['green onions', 'produce'], ['花生酱', 'condiments'], ['花生', 'snacks'],
    ['盐', 'condiments'], ['葱', 'produce'], ['纸巾', 'household'], ['rice vinegar', 'condiments'], ['chicken broth', 'pantry'],
    // 「冻」开头只在后面整个是一样吃的时才算冷冻；冻顶乌龙是茶、冻柠茶是冰饮料、冻干的是零食
    ['冻豆腐', 'frozen'], ['冻肉', 'frozen'], ['冻顶乌龙茶', 'snacks'], ['凍頂烏龍茶', 'snacks'], ['冻柠茶', 'snacks'], ['冻奶茶', 'snacks'],
    ['冻干草莓', 'snacks'], ['Freeze-Dried Strawberries', 'snacks'], ['鸡蛋面', 'pantry'], ['牛奶糖', 'snacks'],
  ];
  for (const [name, sys] of table) assert.equal(catalogSys(name), sys, name);
  // 单字的键只认整个名字；英文要整个词（price 里有 rice、eggplant 不是 egg）
  for (const name of ['海盐', 'price', 'iPhone', '没听说过的东西', '', 'berries']) assert.equal(catalogSys(name), null, name);
  assert.equal(catalogSys('eggplant'), 'produce');
  assert.ok(isCatalogName('包子') && isCatalogName('包 子') === false);
});

test('分类 id：只给食材清单；预置分类被删了、改成只给一般清单用了 → null', () => {
  const s = seeded();
  assert.equal(catalogCategory(s, '牛奶'), 'c_dairy');
  assert.equal(catalogCategory(s, '牛奶', 'general'), null);
  assert.equal(catalogCategory(s, '没听说过的东西'), null);
  s.data.categories.c_dairy = deletedRecord(s.data.categories.c_dairy, now());
  assert.equal(catalogCategory(s, '牛奶'), null);
  s.data.categories.c_produce = { ...s.data.categories.c_produce, kind: 'general' };
  assert.equal(catalogCategory(s, '苹果'), null);
  s.data.categories.c_meat = { ...s.data.categories.c_meat, kind: null };
  assert.equal(catalogCategory(s, '牛肉'), 'c_meat', '两边都用的也行');
});

// ---------- 分组 ----------
function groceryState() {
  const s = seeded();
  for (const text of ['牛奶', '苹果', '香蕉', '鸡蛋', '豆腐', '酱油', '没听说过的', '薯片']) addFromInput(s, 'l_groceries', text, now());
  return s;
}
const names = arr => arr.map(it => it.name);

test('按分类分组：组按分类的 order，未分类在最后；组内按拼音；已删除的分类归到未分类', () => {
  const s = groceryState();
  const g = groupNeed(s, 'l_groceries', 'category', collatorFor('zh-Hans'));
  assert.deepEqual(g.groups.map(x => [x.id, names(x.items)]), [
    ['c_produce', ['豆腐', '苹果', '香蕉']], ['c_dairy', ['鸡蛋', '牛奶']], ['c_condiments', ['酱油']], ['c_snacks', ['薯片']], [null, ['没听说过的']],
  ]);
  assert.deepEqual([g.later, g.done], [[], []]);
  s.data.categories.c_dairy = deletedRecord(s.data.categories.c_dairy, now());
  const g2 = groupNeed(s, 'l_groceries', 'category', collatorFor('zh-Hans'));
  assert.deepEqual(g2.groups.at(-1).id, null);
  assert.deepEqual(names(g2.groups.at(-1).items), ['鸡蛋', '没听说过的', '牛奶']);
  // 分类换了顺序
  s.data.categories.c_snacks = { ...s.data.categories.c_snacks, order: -1 };
  assert.equal(groupNeed(s, 'l_groceries', 'category').groups[0].id, 'c_snacks');
});

test('按商店分组：组按商店的 order，未指定在最后；归档的商店照常一组；删掉的商店归到未指定', () => {
  const s = groceryState();
  const id = (n) => Object.values(s.data.items).find(it => it.name === n).id;
  s.data.items[id('豆腐')].storeId = 's_hmart';
  s.data.items[id('酱油')].storeId = 's_99ranch';
  s.data.items[id('薯片')].storeId = null;
  s.data.items[id('苹果')].storeId = 's_costco';
  s.data.stores.s_hmart = { ...s.data.stores.s_hmart, archived: true };
  s.data.stores.s_costco = deletedRecord(s.data.stores.s_costco, now());
  const g = groupNeed(s, 'l_groceries', 'store', collatorFor('zh-Hans'));
  assert.deepEqual(g.groups.map(x => [x.id, names(x.items)]), [
    ['s_wholefoods', ['鸡蛋', '没听说过的', '牛奶', '香蕉']], ['s_hmart', ['豆腐']], ['s_99ranch', ['酱油']], [null, ['苹果', '薯片']],
  ]);
});

test('以后再说、已买单独列：已买的新的在前；组内一样的名字按 id；删除的、别的清单的不算；英文和繁体的排序规则', () => {
  const s = seeded();
  for (const text of ['台灯', '雨伞', '书架', '袜子']) addFromInput(s, 'l_tobuy', text, now());
  const id = (n) => Object.values(s.data.items).find(it => it.name === n).id;
  setStatus(s, id('雨伞'), 'later', now());
  setStatus(s, id('书架'), 'later', now());
  toggleDone(s, id('台灯'), now());
  toggleDone(s, id('袜子'), now());
  const g = groupNeed(s, 'l_tobuy', 'category', collatorFor('zh-Hans'));
  assert.deepEqual(g.groups, []);
  assert.deepEqual(names(g.later), ['书架', '雨伞']);
  assert.deepEqual(names(g.done), ['袜子', '台灯']);
  s.data.items[id('袜子')] = deletedRecord(s.data.items[id('袜子')], now());
  assert.deepEqual(names(groupNeed(s, 'l_tobuy').done), ['台灯']);
  // 英文按字母、数字按大小（「Size 2」在「Size 10」前）
  for (const text of ['Size 10', 'banana', 'Apple', 'Size 2']) addFromInput(s, 'l_tobuy', text + ' x1', now());
  assert.deepEqual(names(groupNeed(s, 'l_tobuy', 'category', collatorFor('en')).groups[0].items), ['Apple', 'banana', 'Size 2', 'Size 10']);
  assert.equal(collatorFor('zh-Hant-TW').resolvedOptions().locale.startsWith('zh'), true);
  assert.equal(collatorFor('xx'), collatorFor('zh-Hans'));
  // 同名（别的设备同步来的两条）按 id 排，每台设备一样
  s.data.items.i_b = normalizeRecord('items', { id: 'i_b', listId: 'l_tobuy', name: 'Twin', updatedAt: 1 });
  s.data.items.i_a = normalizeRecord('items', { id: 'i_a', listId: 'l_tobuy', name: 'Twin', updatedAt: 1 });
  assert.deepEqual(groupNeed(s, 'l_tobuy', 'category', collatorFor('en')).groups[0].items.filter(it => it.name === 'Twin').map(it => it.id), ['i_a', 'i_b']);
});

test('各清单的显示方式（本机）：默认按分类、已买和以后再说展开；认不出的值按默认', () => {
  assert.deepEqual(listView({ view: {} }, 'l_x'), { groupBy: 'category', showDone: true, showLater: true });
  assert.deepEqual(listView({ view: { l_x: { groupBy: 'store', showDone: false } } }, 'l_x'), { groupBy: 'store', showDone: false, showLater: true });
  assert.deepEqual(listView({ view: { l_x: { groupBy: 'aisle', showDone: 'no' } } }, 'l_x'), { groupBy: 'category', showDone: true, showLater: true });
  assert.deepEqual(listView(null, 'l_x').groupBy, 'category');
  assert.deepEqual(listView({ view: { l_x: 'bad' } }, 'l_x').groupBy, 'category');
});

// ---------- 清单 ----------
test('新建清单：排在最后，名字不能空，类型认不出按食材，图标只留一个字形，默认商店只收在的、没归档的', () => {
  const s = seeded();
  assert.deepEqual(createList(s, { name: '  ' }, now()), { ok: false, errors: { name: 'list.err.name' } });
  const r = createList(s, { name: ' 木工 ', kind: 'general', icon: '🪵🔨', defaultStoreId: 's_homedepot' }, now());
  assert.equal(r.ok, true);
  const l = s.data.lists[r.id];
  assert.match(r.id, /^l_/);
  assert.deepEqual([l.name, l.kind, l.icon, l.order, l.defaultStoreId, l.sys, l.archived], ['木工', 'general', '🪵', 2, 's_homedepot', null, false]);
  assert.deepEqual(homeLists(s).map(x => x.id), ['l_groceries', 'l_tobuy', r.id]);
  s.data.stores.s_target = { ...s.data.stores.s_target, archived: true };
  const r2 = createList(s, { name: '别的', kind: 'project', defaultStoreId: 's_target' }, now());
  assert.deepEqual([s.data.lists[r2.id].kind, s.data.lists[r2.id].defaultStoreId, s.data.lists[r2.id].order], ['grocery', null, 3]);
  assert.equal(firstGrapheme('👨‍👩‍👧 家'), '👨‍👩‍👧');
  assert.equal(firstGrapheme('🇹🇼'), '🇹🇼');
  assert.equal(firstGrapheme('  '), '');
  assert.equal(LIST_ICONS.length, 16);
  assert.equal(new Set(LIST_ICONS).size, 16);
  // 两个默认图标都在可选的里面（不然编辑时默认的那个不会标成选中；FE0F 被编辑器弄丢了也会在这里发现）
  for (const icon of Object.values(DEFAULT_LIST_ICON)) assert.ok(LIST_ICONS.includes(icon), icon);
});

test('改清单：名字、图标、默认商店；预置清单名字可以清空（显示界面语言的名字），自建的不行；类型不改', () => {
  const s = seeded();
  const r = editList(s, 'l_groceries', { name: '  ', icon: '🛒', defaultStoreId: 's_costco', kind: 'general' }, now());
  assert.deepEqual([r.list.name, r.list.icon, r.list.defaultStoreId, r.list.kind], ['', '🛒', 's_costco', 'grocery']);
  const { id } = createList(s, { name: '木工', kind: 'general' }, now());
  assert.deepEqual(editList(s, id, { name: '' }, now()), { ok: false, errors: { name: 'list.err.name' } });
  assert.equal(editList(s, id, { defaultStoreId: 's_nope' }, now()).list.defaultStoreId, null, '不存在的商店不改');
  assert.equal(editList(s, 'l_nope', { name: 'x' }, now()).ok, false);
  // 没改的不盖新时间（预置清单还是 updatedAt 0）
  assert.equal(editList(s, 'l_tobuy', { name: '', icon: '' }, now()).list.updatedAt, 0);
});

test('归档：首页不显示、收进「已归档」，取消归档回来；预置清单也能归档', () => {
  const s = seeded();
  setArchived(s, 'l_tobuy', true, now());
  assert.deepEqual(homeLists(s).map(l => l.id), ['l_groceries']);
  assert.deepEqual(archivedLists(s).map(l => l.id), ['l_tobuy']);
  setArchived(s, 'l_tobuy', false, now());
  assert.deepEqual(homeLists(s).map(l => l.id), ['l_groceries', 'l_tobuy']);
  assert.equal(setArchived(s, 'l_nope', true, now()), null);
});

test('删除清单：只有自建的；软删除，里面的东西留着、跟着隐藏；恢复（撤销）时一起回来', () => {
  state.load({ storage: null });
  try {
    const { id } = state.mutate(s => createList(s, { name: '木工', kind: 'general' }, now()));
    state.mutate(s => { addFromInput(s, id, '砂纸 2张', now()); addFromInput(s, id, '木胶 x1', now()); addFromInput(s, 'l_tobuy', '台灯', now()); });
    const S = () => state.getState();
    assert.equal(visibleItems(S()).length, 3);
    assert.equal(state.mutate(s => deleteList(s, 'l_groceries', now())), false, '预置的只能归档');
    assert.equal(state.mutate(s => deleteList(s, id, now()), { undoLabel: '已删除「木工」' }), true);
    assert.equal(S().data.lists[id].deleted, true);
    assert.deepEqual(homeLists(S()).map(l => l.id), ['l_groceries', 'l_tobuy']);
    assert.deepEqual(visibleItems(S()).map(it => it.name), ['台灯'], '东西跟着隐藏');
    assert.equal(Object.values(S().data.items).filter(it => it.listId === id && !it.deleted).length, 2, '东西本身没删');
    assert.equal(state.undo(), '已删除「木工」');
    assert.deepEqual(homeLists(S()).map(l => l.id), ['l_groceries', 'l_tobuy', id]);
    assert.equal(visibleItems(S()).length, 3, '恢复清单时一起回来');
    // 「最近删除」里恢复也一样
    state.mutate(s => deleteList(s, id, now()));
    state.mutate(s => { s.data.lists[id] = restoredRecord(s.data.lists[id], now()); });
    assert.equal(visibleItems(S()).length, 3);
    assert.equal(needCounts(S()).get(id), 2);
  } finally { state.load({ storage: null }); }
});

test('排顺序：挪到上一张 / 下一张的另一边，只改这一张的 order（别的清单不盖新时间）；归档的不排、位置留着；到头了挪不动', () => {
  const s = seeded();
  const a = createList(s, { name: 'A' }, now()).id;
  const b = createList(s, { name: 'B' }, now()).id;
  const at = (id) => s.data.lists[id].updatedAt;
  const before = { a: at(a), b: at(b) };
  assert.equal(moveList(s, b, -1, now()), true);
  assert.deepEqual(homeLists(s).map(l => l.id), ['l_groceries', 'l_tobuy', b, a]);
  assert.deepEqual([at('l_groceries'), at('l_tobuy'), at(a)], [0, 0, before.a], '只有挪的那一张盖新时间：预置清单还是 updatedAt 0');
  assert.ok(at(b) > before.b);
  assert.deepEqual(homeLists(s).map(l => l.order), [0, 1, 1.5, 2], '取前后两张的中间值');
  assert.equal(moveList(s, 'l_groceries', -1, now()), false);
  assert.equal(moveList(s, a, 1, now()), false);
  assert.equal(moveList(s, 'l_nope', 1, now()), false);
  moveList(s, 'l_tobuy', -1, now());
  assert.deepEqual(homeLists(s).map(l => l.id), ['l_tobuy', 'l_groceries', b, a]);
  assert.equal(at('l_groceries'), 0);
  // 归档的不参与（首页上看不到它），但 order 还占着：取消归档后回到原处，不和挪过来的撞在一起
  setArchived(s, 'l_groceries', true, now());
  assert.equal(moveList(s, 'l_groceries', 1, now()), false, '归档的不排');
  const g = at('l_groceries');
  moveList(s, b, -1, now());
  assert.deepEqual(homeLists(s).map(l => l.id), [b, 'l_tobuy', a]);
  assert.equal(at('l_groceries'), g);
  setArchived(s, 'l_groceries', false, now());
  assert.deepEqual(homeLists(s).map(l => l.id), [b, 'l_tobuy', 'l_groceries', a]);
});

test('预置分类都有：九个食材、五个一般', () => {
  assert.equal(SYS_CATEGORIES.length, 14);
});
