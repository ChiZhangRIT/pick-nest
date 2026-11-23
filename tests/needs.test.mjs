// 来自食谱的数量（core/items.js 的 addNeeds、removeNeeds、qtyParts / totalLabel、needsOf、编辑面板拿掉一份）和常备品（core/memory.js 的 staple），
// 还有 needs、staple 的整理与多设备合并。函数直接改传进来的 state；撤销用真的 state.js。全是编的数据
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureSeeds, blankState, normalizeRecord, normalizeState, mergeStates, mergeRecord, itemId, canon } from '../src/core/store.js';
import { addNeeds, removeNeeds, qtyParts, totalLabel, needsOf, addFromInput, addItem, setStatus, toggleDone, clearDone, validateItemPatch, editAndMove, moveItem, liveItem, UNTICK_MS, NEED_MAX } from '../src/core/items.js';
import { memoryOf, isStaple, setStaple, recordUse } from '../src/core/memory.js';
import * as state from '../src/core/state.js';

const T0 = 1_700_000_000_000;
let clock = T0;
const now = () => (clock += 1000);
const seeded = () => ensureSeeds(blankState());
const L = 'l_groceries';
const itemOf = (s, name, listId = L) => s.data.items[itemId(s, listId, name)];
const meta = { label: '红烧肉', recipeId: 'r_hsr' };

// ---------- addNeeds ----------
test('addNeeds：清单上没有 → 新建成要买，自己加的是 null，needs 只有这一份（带着菜名和食谱）；按默认值定商店和分类；memory 记一次', () => {
  const s = seeded();
  const r = addNeeds(s, L, [{ name: '五花肉', qty: 500, unit: 'g' }, { name: '冰糖', qty: 20, unit: 'g' }], 'a:1', meta, now());
  assert.deepEqual(r, { added: 2, updated: 0, ids: [itemId(s, L, '五花肉'), itemId(s, L, '冰糖')] });
  const it = itemOf(s, '五花肉');
  assert.deepEqual([it.status, it.qty, it.unit, it.storeId, it.categoryId], ['need', null, '', 's_wholefoods', 'c_meat']);
  assert.deepEqual(it.needs, { 'a:1': { qty: 500, unit: 'g', label: '红烧肉', recipeId: 'r_hsr' } });
  assert.equal(totalLabel(it), '500 g');
  assert.equal(memoryOf(s, '五花肉').uses, 1);
  assert.equal(addNeeds(s, 'l_nope', [{ name: 'x' }], 'a:2'), null, '清单不在');
  assert.equal(addNeeds(s, L, [{ name: 'x' }], ''), null, '没有来源');
});

test('addNeeds：已经在要买 / 以后再说 → 记进它的 needs，自己加的不动，以后再说变成要买；memory 不再多记', () => {
  const s = seeded();
  s.data.lists.l_mix = normalizeRecord('lists', { id: 'l_mix', name: '杂货', kind: 'grocery', order: 5, updatedAt: T0 });
  addFromInput(s, L, '洋葱 2个', now());
  const before = memoryOf(s, '洋葱').uses;
  const r = addNeeds(s, L, [{ name: '洋葱', qty: 1, unit: '个' }], 'a:1', meta, now());
  assert.deepEqual([r.added, r.updated], [0, 1]);
  const it = itemOf(s, '洋葱');
  assert.deepEqual([it.qty, it.unit, it.status], [2, '个', 'need'], '自己加的 2 个不动');
  assert.equal(totalLabel(it), '3 个');
  assert.equal(memoryOf(s, '洋葱').uses, before, '已经在清单上的不算又加了一次');
  // 一般清单的「以后再说」也一样（食材面板只给食材清单，但 core 不挑）
  s.data.items.i_x = normalizeRecord('items', { id: 'i_x', listId: 'l_tobuy', name: '剪刀', status: 'later', qty: 1, updatedAt: T0, createdAt: T0 });
  addNeeds(s, 'l_tobuy', [{ name: '剪刀', qty: 1 }], 'a:9', meta, now());
  assert.equal(s.data.items.i_x.status, 'need');
  assert.equal(totalLabel(s.data.items.i_x), '2');
});

test('addNeeds：已买、已清除的 → 恢复成要买，自己加的设成 null、needs 清空后只放这一份（上一轮买过的不算），带着上次的备注', () => {
  const s = seeded();
  addFromInput(s, L, '生抽 1瓶', now());
  const id = itemOf(s, '生抽').id;
  s.data.items[id] = { ...s.data.items[id], note: '要老字号的', needs: { 'a:old': { qty: 2, unit: '勺', label: '旧菜', recipeId: null } } };
  setStatus(s, id, 'done', now());
  addNeeds(s, L, [{ name: '生抽', qty: 3, unit: '勺' }], 'a:new', meta, now());
  let it = s.data.items[id];
  assert.deepEqual([it.status, it.doneAt, it.qty, it.note], ['need', null, null, '要老字号的']);
  assert.deepEqual(Object.keys(it.needs), ['a:new']);
  assert.equal(totalLabel(it), '3 勺');
  // 清除（软删除）以后：同一条恢复
  setStatus(s, id, 'done', now());
  clearDone(s, L, now());
  assert.equal(s.data.items[id].deleted, true);
  const r = addNeeds(s, L, [{ name: '生抽', qty: 1, unit: '勺' }], 'a:third', meta, now());
  it = s.data.items[id];
  assert.deepEqual([r.added, it.deleted, it.deletedAt, it.qty, Object.keys(it.needs)], [1, undefined, undefined, null, ['a:third']]);
  assert.equal(Object.values(s.data.items).filter(x => x.name === '生抽').length, 1, '记录不会越加越多');
});

test('addNeeds：同一个来源再加一次是替换（不会重复）；别的来源各自留着', () => {
  const s = seeded();
  addNeeds(s, L, [{ name: '鸡蛋', qty: 2, unit: '个' }], 'p:1', meta, now());
  addNeeds(s, L, [{ name: '鸡蛋', qty: 3, unit: '个' }], 'p:2', { label: '蛋糕' }, now());
  addNeeds(s, L, [{ name: '鸡蛋', qty: 4, unit: '个' }], 'p:1', meta, now());
  const it = itemOf(s, '鸡蛋');
  assert.deepEqual(Object.keys(it.needs).sort(), ['p:1', 'p:2']);
  assert.equal(it.needs['p:1'].qty, 4);
  assert.equal(totalLabel(it), '7 个');
});

test('addNeeds：同一次里同名的几行：单位一样相加（没写数量的不算），单位不一样另记一份 <来源>#2；繁体也是同名', () => {
  const s = seeded();
  addNeeds(s, L, [{ name: '盐', qty: null, unit: '' }, { name: '鹽', qty: 1, unit: '' }, { name: '盐', qty: 2, unit: '' },
    { name: '生抽', qty: 2, unit: '勺' }, { name: '生抽', qty: 10, unit: 'ml' }, { name: ' ', qty: 1 }], 'a:1', meta, now());
  assert.deepEqual(itemOf(s, '盐').needs, { 'a:1': { qty: 3, unit: '', label: '红烧肉', recipeId: 'r_hsr' } });
  const soy = itemOf(s, '生抽');
  assert.deepEqual(Object.keys(soy.needs), ['a:1', 'a:1#2']);
  assert.equal(totalLabel(soy), '2 勺 + 10 ml');
  assert.equal(Object.values(s.data.items).length, 2, '空名字的行不加');
  // 拿掉这个来源：两份一起拿掉
  removeNeeds(s, 'a:1', now());
  assert.equal(itemOf(s, '生抽').deleted, true);
});

test('addNeeds：数量不对的（0、负数、太大、不是数）当没写；超过 9999 的照记（那是输入框的上限，换算出来的可以更多）；在一次 mutate 里能整个撤销', () => {
  const big = seeded();
  addNeeds(big, L, [{ name: '水', qty: 10000, unit: 'ml' }, { name: '水', qty: 500, unit: 'ml' }], 'a:1', meta, now());
  assert.equal(totalLabel(itemOf(big, '水')), '10500 ml');
  assert.equal(NEED_MAX >= 999999, true);
  state.load({ storage: null });
  state.mutate(s => addNeeds(s, L, [{ name: '葱', qty: 0 }, { name: '姜', qty: -1 }, { name: '蒜', qty: 1e9 }, { name: '香菜', qty: 'x' }], 'a:1', meta, now()), { undoLabel: '已加到清单' });
  const S = state.getState();
  for (const n of ['葱', '姜', '蒜', '香菜']) assert.equal(itemOf(S, n).needs['a:1'].qty, null, n);
  assert.equal(totalLabel(itemOf(S, '葱')), '');
  state.undo();
  for (const n of ['葱', '姜', '蒜', '香菜']) assert.equal(itemOf(state.getState(), n).deleted, true, '撤销新建 = 软删除');
});

test('快速添加再加回已买 / 已清除的：上一轮各道菜的那几份一起清空（不然再从食谱加一次算两遍）；从「以后再说」恢复的留着', () => {
  const s = seeded();
  addNeeds(s, L, [{ name: '洋葱', qty: 200, unit: 'g' }], 'a:1', meta, now());
  const id = itemOf(s, '洋葱').id;
  setStatus(s, id, 'done', now());
  clearDone(s, L, now());
  const r = addFromInput(s, L, '洋葱', now());
  assert.deepEqual([r.outcome, s.data.items[id].needs, totalLabel(s.data.items[id])], ['restored', {}, '1'], '下一周再加：只有这次的 1');
  addNeeds(s, L, [{ name: '洋葱', qty: 200, unit: 'g' }], 'a:2', meta, now());
  assert.equal(totalLabel(s.data.items[id]), '1 + 200 g', '再从食谱加一次：只算这一次的 200 g');
  // 已买（没清除）的点联想加回来也一样
  setStatus(s, id, 'done', now());
  addItem(s, L, { name: '洋葱' }, now());
  assert.deepEqual(s.data.items[id].needs, {});
  // 一般清单的「以后再说」：还没买过，各道菜的留着
  s.data.items.i_x = normalizeRecord('items', { id: 'i_x', listId: 'l_tobuy', name: '剪刀', status: 'later', qty: null, updatedAt: T0, createdAt: T0,
    needs: { 'a:9': { qty: 1, unit: '', label: '手工' } } });
  assert.equal(addFromInput(s, 'l_tobuy', '剪刀', now()).outcome, 'restored');
  assert.deepEqual(Object.keys(s.data.items.i_x.needs), ['a:9']);
});

test('快速添加：只是因为食谱在清单上（自己加的是空的）、这次写了数量 → 记成自己加的（own）；没写数量、自己已经写过数量的照旧 exists', () => {
  const s = seeded();
  addNeeds(s, L, [{ name: '洋葱', qty: 200, unit: 'g' }], 'p:a', meta, now());
  const id = itemOf(s, '洋葱').id, at = s.data.items[id].updatedAt;
  assert.equal(addFromInput(s, L, '洋葱', now()).outcome, 'exists');
  assert.equal(s.data.items[id].updatedAt, at, '没写数量：什么也不改');
  const r = addFromInput(s, L, '洋葱 2个', now());
  assert.deepEqual([r.outcome, s.data.items[id].qty, s.data.items[id].unit, totalLabel(s.data.items[id])], ['own', 2, '个', '2 个 + 200 g']);
  assert.equal(memoryOf(s, '洋葱').unit, '个', '写了单位照样记进 memory');
  assert.equal(addFromInput(s, L, '洋葱 5', now()).outcome, 'exists', '已经有自己加的：不盖掉');
  assert.equal(s.data.items[id].qty, 2);
  // 以后计划里删掉这道菜：自己要的还留着
  removeNeeds(s, 'p:a', now());
  assert.deepEqual([liveItem(s, id) && true, totalLabel(s.data.items[id])], [true, '2 个']);
  // 普通的要买（没有 needs、自己的是空的）照旧 exists
  addFromInput(s, L, '牛奶', now());
  s.data.items[itemOf(s, '牛奶').id] = { ...itemOf(s, '牛奶'), qty: null };
  assert.equal(addFromInput(s, L, '牛奶 2', now()).outcome, 'exists');
});

test('已买的隔久了才取消勾选（又要买了）：各道菜的那几份清空；刚勾上就取消（点错了）照原样；编辑面板里改回要买也一样', () => {
  const s = seeded();
  addNeeds(s, L, [{ name: '五花肉', qty: 500, unit: 'g' }, { name: '冰糖', qty: 20, unit: 'g' }], 'a:1', meta, now());
  const pork = itemOf(s, '五花肉').id, sugar = itemOf(s, '冰糖').id;
  const t0 = now();
  setStatus(s, pork, 'done', t0);
  toggleDone(s, pork, t0 + 60_000);
  assert.deepEqual([s.data.items[pork].status, Object.keys(s.data.items[pork].needs)], ['need', ['a:1']], '一分钟内：点错了，照原样');
  setStatus(s, pork, 'done', t0 + 120_000);
  toggleDone(s, pork, t0 + 120_000 + UNTICK_MS + 1);
  assert.deepEqual([s.data.items[pork].status, s.data.items[pork].needs, totalLabel(s.data.items[pork])], ['need', {}, ''], '一周后又要买：上周那份不算了');
  addNeeds(s, L, [{ name: '五花肉', qty: 500, unit: 'g' }], 'a:2', meta, t0 + 2 * UNTICK_MS);
  assert.equal(totalLabel(s.data.items[pork]), '500 g', '再从食谱加：不会变成 1000 g');
  setStatus(s, sugar, 'done', t0);
  const r = editAndMove(s, sugar, { status: 'need' }, null, t0 + UNTICK_MS + 5);
  assert.deepEqual([r.ok, s.data.items[sugar].needs], [true, {}]);
});

// ---------- removeNeeds ----------
test('removeNeeds：只动要买 / 以后再说；什么都不剩的软删除，有自己加的或别的菜的留着；已买、已清除的不动', () => {
  const s = seeded();
  addNeeds(s, L, [{ name: '五花肉', qty: 500, unit: 'g' }, { name: '洋葱', qty: 1, unit: '个' }, { name: '姜', qty: 1, unit: '块' }, { name: '可乐', qty: 1, unit: '瓶' }], 'p:a', meta, now());
  addFromInput(s, L, '洋葱 2个', now());                  // 已经在清单上：自己加的不变（还是 null），exists
  s.data.items[itemOf(s, '洋葱').id] = { ...itemOf(s, '洋葱'), qty: 2 };   // 在编辑面板里改了「自己加的」
  addNeeds(s, L, [{ name: '姜', qty: 2, unit: '片' }], 'p:b', { label: '可乐鸡翅' }, now());
  const coke = itemOf(s, '可乐').id;
  setStatus(s, coke, 'done', now());
  const n = removeNeeds(s, 'p:a', now());
  assert.equal(n, 3, '五花肉、洋葱、姜；已买的可乐不动');
  assert.equal(itemOf(s, '五花肉').deleted, true, '只为这道菜加的 → 拿掉');
  assert.deepEqual([itemOf(s, '洋葱').deleted, itemOf(s, '洋葱').qty, itemOf(s, '洋葱').needs], [undefined, 2, {}], '自己加的留着');
  assert.deepEqual([itemOf(s, '姜').deleted, Object.keys(itemOf(s, '姜').needs)], [undefined, ['p:b']], '别的菜的留着');
  assert.deepEqual(Object.keys(s.data.items[coke].needs), ['p:a'], '已买的留着这一轮是为哪道菜买的');
  assert.equal(removeNeeds(s, 'p:a', now()), 0, '再拿一次什么也不动');
  assert.equal(removeNeeds(s, '', now()), 0);
});

test('removeNeeds：自己加的是 0 也算没有；拿掉的东西和数量在一次 mutate 里能撤销', () => {
  state.load({ storage: null });
  state.mutate(s => addNeeds(s, L, [{ name: '牛肉', qty: 1, unit: 'kg' }], 'p:x', meta, now()));
  state.mutate(s => { const it = itemOf(s, '牛肉'); s.data.items[it.id] = { ...it, qty: 0 }; });
  state.mutate(s => removeNeeds(s, 'p:x', now()), { undoLabel: '删掉了' });
  assert.equal(itemOf(state.getState(), '牛肉').deleted, true);
  state.undo();
  const it = itemOf(state.getState(), '牛肉');
  assert.deepEqual([it.deleted, Object.keys(it.needs)], [undefined, ['p:x']]);
});

// ---------- 显示的数量 ----------
test('显示的数量：自己加的 + 各道菜的，同单位相加（简繁、大小写算同一个单位），不同单位分开写，自己的在前；没写数量的不算；都没写 → 空', () => {
  const item = (qty, unit, needs = {}) => normalizeRecord('items', { id: 'i', listId: L, name: '洋葱', qty, unit, needs, updatedAt: 1 });
  assert.equal(totalLabel(item(2, '个', { a: { qty: 0.5, unit: '個' }, b: { qty: 200, unit: 'g' } })), '2.5 个 + 200 g');
  assert.equal(totalLabel(item(null, '个', { a: { qty: 200, unit: 'G' }, b: { qty: 100, unit: 'g' } })), '300 G', '自己加的是 null：只算各道菜的（单位用先出现的写法）');
  assert.equal(totalLabel(item(null, '', { a: { qty: null, unit: '' } })), '', '都没写数量');
  assert.equal(totalLabel(item(null, '')), '');
  assert.equal(totalLabel(item(3, '')), '3', '没有 needs 的和以前一样');
  assert.equal(totalLabel(item(1, '', { a: { qty: 2, unit: '个' } })), '1 + 2 个', '没单位和「个」是不同的单位');
  assert.equal(totalLabel(item(0.1, 'kg', { a: { qty: 0.2, unit: 'kg' } })), '0.3 kg', '小数相加不出 0.30000000000000004');
  assert.equal(totalLabel(item(1, 'lb', { a: { qty: 1 / 3, unit: 'lb' } })), '1.33 lb', '最多两位小数');
  assert.deepEqual(qtyParts(item(2, '个', { a: { qty: 200, unit: 'g' }, bad: 'x', b: { qty: '3', unit: '个' } })), [{ qty: 5, unit: '个' }, { qty: 200, unit: 'g' }], '坏的来源跳过；字符串数字也认');
  assert.deepEqual(needsOf(item(1, '', { a: { qty: 2, unit: 'g', label: '红烧肉', recipeId: 'r1' }, bad: 'x', c: { qty: -1, label: 7 } })),
    [['a', { qty: 2, unit: 'g', label: '红烧肉', recipeId: 'r1' }], ['c', { qty: null, unit: '', label: '7', recipeId: null }]]);
});

// ---------- 编辑面板拿掉一份 ----------
test('编辑面板：dropNeeds 拿掉某一道菜的那一份（东西留着，即使什么都不剩）；不存在的键什么也不改；移到别的清单合并时带过去', () => {
  const s = seeded();
  addNeeds(s, L, [{ name: '土豆', qty: 2, unit: '个' }], 'a:1', meta, now());
  addNeeds(s, L, [{ name: '土豆', qty: 300, unit: 'g' }], 'a:2', { label: '咖喱' }, now());
  const id = itemOf(s, '土豆').id;
  assert.deepEqual(validateItemPatch(s, s.data.items[id], { dropNeeds: ['nope'] }).clean, {}, '不存在的键：不算改');
  const r = editAndMove(s, id, { dropNeeds: ['a:1'], qty: '1' }, null, now());
  assert.equal(r.ok, true);
  assert.deepEqual([Object.keys(s.data.items[id].needs), s.data.items[id].qty, totalLabel(s.data.items[id])], [['a:2'], 1, '1 + 300 g']);
  editAndMove(s, id, { dropNeeds: ['a:2'], qty: '' }, null, now());
  assert.deepEqual([liveItem(s, id) && true, s.data.items[id].needs, totalLabel(s.data.items[id])], [true, {}, ''], '面板里点了保存：留着（要删用「删除」）');
  // 移到另一张食材清单、那边有同名的：两边的 needs 合在一起
  s.data.lists.l_two = normalizeRecord('lists', { id: 'l_two', name: '周末', kind: 'grocery', order: 5, updatedAt: T0 });
  addNeeds(s, 'l_two', [{ name: '土豆', qty: 1, unit: '个' }], 'a:3', meta, now());
  addNeeds(s, L, [{ name: '土豆', qty: 100, unit: 'g' }], 'a:4', { label: '炖菜' }, now());
  const m = editAndMove(s, id, {}, 'l_two', now());
  assert.equal(m.outcome, 'merged');
  assert.deepEqual(Object.keys(itemOf(s, '土豆', 'l_two').needs).sort(), ['a:3', 'a:4']);
});

test('移到别的清单、那边有同名的：那一条只是因为食谱才在（自己的是空的）→ 用移过来的数量和单位；那一条已买 → 它上一轮的 needs 不回来；移过来的已买 → 它的也不回来', () => {
  const s = seeded();
  s.data.lists.l_two = normalizeRecord('lists', { id: 'l_two', name: '周末', kind: 'grocery', order: 5, updatedAt: T0 });
  // (a) 目标只是因为食谱在清单上
  addNeeds(s, 'l_two', [{ name: '洋葱', qty: 200, unit: 'g' }], 'a:t', meta, now());
  s.data.items[itemOf(s, '洋葱', 'l_two').id] = { ...itemOf(s, '洋葱', 'l_two'), unit: 'g' };     // 那一条记着的单位
  addFromInput(s, L, '洋葱 2个', now());
  assert.equal(moveItem(s, itemOf(s, '洋葱').id, 'l_two', now()).outcome, 'merged');
  let it = itemOf(s, '洋葱', 'l_two');
  assert.deepEqual([it.qty, it.unit, totalLabel(it)], [2, '个', '2 个 + 200 g'], '自己的 2 个没丢，也没变成 2 g');
  // 目标自己写了数量：还是用它的（和以前一样）
  addFromInput(s, L, '葱 3根', now());
  addFromInput(s, 'l_two', '葱 1根', now());
  moveItem(s, itemOf(s, '葱').id, 'l_two', now());
  assert.equal(totalLabel(itemOf(s, '葱', 'l_two')), '1 根');
  // (b) 目标已买（上周为旧菜买的）
  addNeeds(s, 'l_two', [{ name: '土豆', qty: 1, unit: '个' }], 'a:old', meta, now());
  setStatus(s, itemOf(s, '土豆', 'l_two').id, 'done', now());
  addNeeds(s, L, [{ name: '土豆', qty: 300, unit: 'g' }], 'a:new', { label: '咖喱' }, now());
  moveItem(s, itemOf(s, '土豆').id, 'l_two', now());
  it = itemOf(s, '土豆', 'l_two');
  assert.deepEqual([it.status, Object.keys(it.needs), totalLabel(it)], ['need', ['a:new'], '300 g'], '上周买过的 1 个不回来');
  // (c) 移过来的是已买的：它那一轮的不回来
  addNeeds(s, L, [{ name: '姜', qty: 1, unit: '块' }], 'a:x', meta, now());
  setStatus(s, itemOf(s, '姜').id, 'done', now());
  addFromInput(s, 'l_two', '姜', now());
  moveItem(s, itemOf(s, '姜').id, 'l_two', now());
  it = itemOf(s, '姜', 'l_two');
  assert.deepEqual([it.status, it.needs, totalLabel(it)], ['need', {}, '1']);
});

// ---------- 常备品 ----------
test('常备品：按名字记在 memory（简繁同一个），没有记录就建一条（不算买过）；取消就去掉这个键；值没变不盖新时间', () => {
  const s = seeded();
  assert.equal(isStaple(s, '盐'), false);
  setStaple(s, '盐', true, now());
  assert.deepEqual([isStaple(s, '鹽'), memoryOf(s, '盐').uses, memoryOf(s, '盐').staple], [true, 0, true]);
  const at = memoryOf(s, '盐').updatedAt;
  setStaple(s, '鹽', true, now());
  assert.equal(memoryOf(s, '盐').updatedAt, at, '已经是常备品：不改');
  setStaple(s, '盐', false, now());
  assert.equal(isStaple(s, '盐'), false);
  assert.equal('staple' in memoryOf(s, '盐'), false, '取消 = 去掉这个键');
  recordUse(s, '酱油', 'grocery', now());
  setStaple(s, '酱油', true, now());
  assert.deepEqual([memoryOf(s, '酱油').uses, memoryOf(s, '酱油').staple], [1, true], '已有的记录：只加一个键');
  assert.equal(setStaple(s, '  ', true, now()), null);
});

// ---------- 整理和合并 ----------
test('整理：needs 里不认识的来源和字段原样留着，危险的键去掉；staple 只认 true', () => {
  const it = normalizeRecord('items', { id: 'i', listId: L, name: 'x', updatedAt: 1, needs: JSON.parse('{"p:9":{"qty":1,"future":"新版字段"},"__proto__":{"x":1},"weird":7}') });
  assert.deepEqual(it.needs, { 'p:9': { qty: 1, future: '新版字段' }, weird: 7 });
  assert.equal(Object.getPrototypeOf(it.needs), Object.prototype);
  assert.equal(normalizeRecord('memory', { id: 'm', name: '盐', staple: 'yes', updatedAt: 1 }).staple, undefined);
  assert.equal(normalizeRecord('memory', { id: 'm', name: '盐', staple: true, updatedAt: 1 }).staple, true);
  const twice = normalizeRecord('items', it);
  assert.equal(canon(twice), canon(it), '可重复整理');
});

test('合并：needs 是记录的一个字段，同一条整条取较新的（拿掉的一份不会被旧的补回来）；各自从头建的同一条，较新的 needs 空着才用另一条的', () => {
  const base = { id: 'i_x', listId: L, name: '洋葱', status: 'need', createdAt: 100 };
  const old = normalizeRecord('items', { ...base, updatedAt: 200, needs: { 'a:1': { qty: 1, unit: '个', label: '红烧肉' } } });
  const cleared = normalizeRecord('items', { ...base, updatedAt: 300, needs: {} });
  assert.deepEqual(mergeRecord('items', old, cleared).needs, {}, '同一条（createdAt 一样）：取较新的整条');
  const fresh = normalizeRecord('items', { ...base, createdAt: 250, updatedAt: 260, qty: 2, needs: {} });
  const m = mergeRecord('items', old, fresh);
  assert.deepEqual([m.qty, Object.keys(m.needs), m.createdAt], [2, ['a:1'], 100], '新设备从头建的那条 needs 空着：补上云端那条的');
  assert.equal(canon(mergeRecord('items', fresh, old)), canon(m), '顺序无关');
  const fresh2 = normalizeRecord('items', { ...base, createdAt: 250, updatedAt: 260, needs: { 'a:2': { qty: 3, unit: 'g' } } });
  assert.deepEqual(Object.keys(mergeRecord('items', old, fresh2).needs), ['a:2'], '较新的有自己的：不混在一起');
});

test('合并：各自从头建的同一条，另一条已买 / 已清除 → 它上一轮的 needs 不补过来（不然买过的又成了要买的）；较新的已买、已清除也不补', () => {
  const base = { id: 'i_x', listId: L, name: '洋葱', createdAt: 100 };
  const needs = { 'a:1': { qty: 200, unit: 'g', label: '红烧肉' } };
  const fresh = normalizeRecord('items', { ...base, status: 'need', createdAt: 250, updatedAt: 260, qty: 1, needs: {} });
  const cleared = normalizeRecord('items', { ...base, status: 'done', updatedAt: 200, needs, deleted: true, deletedAt: 200 });
  const bought = normalizeRecord('items', { ...base, status: 'done', updatedAt: 200, needs });
  for (const [o, why] of [[cleared, '云端那条清除了'], [bought, '云端那条已买']]) {
    const m = mergeRecord('items', o, fresh);
    assert.deepEqual([m.status, m.deleted, m.needs, totalLabel(m)], ['need', undefined, {}, '1'], why);
    assert.equal(canon(mergeRecord('items', fresh, o)), canon(m), '顺序无关');
  }
  const open = normalizeRecord('items', { ...base, status: 'need', updatedAt: 200, needs });
  const freshDone = normalizeRecord('items', { ...base, status: 'done', createdAt: 250, updatedAt: 260, needs: {} });
  assert.deepEqual(mergeRecord('items', open, freshDone).needs, {}, '较新的已买：不补');
  // 从备份恢复走同一条路（mergeStates）
  const a = normalizeState({ data: { items: { i_x: cleared } } }), b = normalizeState({ data: { items: { i_x: fresh } } });
  assert.deepEqual(mergeStates(a, b).data.items.i_x.needs, {});
});

test('合并：常备品在各自从头建的同一条 memory 里留着（较新的没标过）；同一条取较新的（取消了就是取消了）', () => {
  const a = normalizeState({ data: { memory: { m_1: { id: 'm_1', name: '盐', staple: true, createdAt: 10, updatedAt: 20 } } } });
  const b = normalizeState({ data: { memory: { m_1: { id: 'm_1', name: '盐', uses: 2, createdAt: 30, updatedAt: 40 } } } });
  const m = mergeStates(a, b);
  assert.deepEqual([m.data.memory.m_1.staple, m.data.memory.m_1.uses], [true, 2]);
  assert.equal(canon(mergeStates(b, a)), canon(m));
  const off = normalizeState({ data: { memory: { m_1: { id: 'm_1', name: '盐', createdAt: 10, updatedAt: 50 } } } });
  assert.equal(mergeStates(a, off).data.memory.m_1.staple, undefined);
});
