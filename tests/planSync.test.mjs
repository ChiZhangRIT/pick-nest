// 第 10 步检查找到的多步问题（食谱、计划、清单、两台设备一起用）：每个都按实际的步骤走一遍。全是编的数据。
//   两台设备：一台在店里勾掉、另一台不知道又再生成一次（买过的不能回到要买）；两台各自生成不同的一周（两周的用量都要算上）；
//   清单上改了名的东西再生成、换食谱时还认得（不删掉、不另加一条）；换一道也用常备品、可选的菜时自己勾上的留着；
//   删掉的菜的那一份从别的路回到清单上以后，再生成时清掉；删掉的清单上的不算「已经加过」；按人数换算不先四舍五入再相加
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureSeeds, blankState, normalizeRecord, mergeStates, itemId, canon } from '../src/core/store.js';
import { planSource, addEntry, editEntry, deleteEntry, planLines, generateList } from '../src/core/plan.js';
import { saveRecipe } from '../src/core/recipes.js';
import { setStatus, totalLabel, editAndMove } from '../src/core/items.js';
import { setStaple, memoryOf } from '../src/core/memory.js';
import { deleteList } from '../src/core/lists.js';
import * as state from '../src/core/state.js';

const T0 = 1_790_000_000_000;
let clock = T0;
const now = (ms = 1000) => (clock += ms);
const L = 'l_groceries';
const W = { from: '2026-11-23', to: '2026-11-29', listId: L };
const itemOf = (s, name, listId = L) => s.data.items[itemId(s, listId, name)];
const label = (s, name, listId = L) => { const it = itemOf(s, name, listId); return it ? (it.deleted ? 'deleted' : it.status + ' ' + totalLabel(it)) : 'none'; };
const sheet = (s, listId = L) => planLines(s, W.from, W.to, { listId }).lines.map(l => [l.name, l.unit, l.qty, l.checked, l.sources.map(x => x.state).join(',')]);
const add = (s, input) => { const r = addEntry(s, input, now()); assert.ok(r.ok, JSON.stringify(r)); return r.id; };
/** 两台设备各自的一份（同步过的同一份数据） */
const fork = (s) => [structuredClone(s), structuredClone(s)];

/** 红烧肉（2 人份：五花肉 500 g、洋葱 1 个、生抽 2 勺（常备品）、香菜（可选））、咖喱（4 人份：洋葱 2 个、五花肉 200 g、咖喱块 1 盒） */
function world() {
  const s = ensureSeeds(blankState());
  const rid = (name, servings, ings) => saveRecipe(s, null, { name, servings, ings }, now()).id;
  const hsr = rid('红烧肉', '2', [{ name: '五花肉', qty: '500', unit: 'g' }, { name: '洋葱', qty: '1', unit: '个' }, { name: '生抽', qty: '2', unit: '勺' }, { name: '香菜', optional: true }]);
  const curry = rid('咖喱', '4', [{ name: '洋葱', qty: '2', unit: '个' }, { name: '咖喱块', qty: '1', unit: '盒' }, { name: '五花肉', qty: '200', unit: 'g' }]);
  setStaple(s, '生抽', true, now());
  return { s, hsr, curry };
}
/** 这一周：周一红烧肉 2 人份、周二咖喱 4 人份，生成好了：洋葱 3 个、五花肉 700 g */
function week() {
  const w = world();
  const mon = add(w.s, { date: '2026-11-23', meal: 'dinner', recipeId: w.hsr, servings: 2 });
  const tue = add(w.s, { date: '2026-11-24', meal: 'dinner', recipeId: w.curry, servings: 4 });
  generateList(w.s, W, now());
  assert.deepEqual([label(w.s, '洋葱'), label(w.s, '五花肉')], ['need 3 个', 'need 700 g']);
  return { ...w, mon, tue };
}

// ---------- 一台在店里勾掉，另一台不知道又改了 ----------
test('两台设备：B 在店里勾掉洋葱、五花肉，A 还没拉到就加了周五的菜、再生成一次：合并后买过的还是买过的，只剩周五要的', () => {
  const { s, hsr, mon, tue } = week();
  const [A, B] = fork(s);
  setStatus(B, itemOf(B, '洋葱').id, 'done', now());
  setStatus(B, itemOf(B, '五花肉').id, 'done', now());
  const fri = add(A, { date: '2026-11-27', meal: 'dinner', recipeId: hsr, servings: 2 });
  generateList(A, W, now());
  assert.deepEqual([label(A, '洋葱'), label(A, '五花肉')], ['need 4 个', 'need 1200 g'], 'A 不知道买过了：整条改写');
  const m = mergeStates(A, B);
  assert.equal(canon(mergeStates(B, A)), canon(m), '顺序无关');
  assert.equal(canon(mergeStates(m, A)), canon(m), '再合并一次不变');
  assert.equal(canon(mergeStates(m, B)), canon(m));
  assert.deepEqual([label(m, '洋葱'), label(m, '五花肉')], ['need 1 个', 'need 500 g'], '只剩周五的');
  const onion = itemOf(m, '洋葱');
  assert.deepEqual(Object.keys(onion.needs), [planSource(fri)]);
  assert.deepEqual(Object.keys(onion.boughtFor).sort(), [planSource(mon), planSource(tue)].sort(), '周一、周二的记成买过的');
  // 再生成认得出来：周一、周二的是买过的，周五的是加过的；再生成一次清单不变
  const row = planLines(m, W.from, W.to, { listId: L }).lines.find(l => l.name === '洋葱');
  assert.deepEqual(row.sources.map(x => x.state), ['bought', 'bought', 'added']);
  const before = canon(m.data.items);
  generateList(m, W, now());
  assert.equal(canon(m.data.items), before, '再生成一次是替换，不会把买过的放回去');
});

test('两台设备：A 不知道买过了，只是改了备注 / 改写成同样的用量 → 还是已买（备注用 A 的）；A 写了自己要的数量 → 新的一轮', () => {
  const { s } = week();
  const [A, B] = fork(s);
  const onion = itemOf(B, '洋葱').id, pork = itemOf(B, '五花肉').id;
  setStatus(B, onion, 'done', now());
  setStatus(B, pork, 'done', now());
  editAndMove(A, onion, { note: '要紫的' }, null, now());
  editAndMove(A, pork, { qty: '2', unit: '斤' }, null, now());
  const m = mergeStates(A, B);
  assert.equal(canon(mergeStates(B, A)), canon(m));
  assert.deepEqual([m.data.items[onion].status, m.data.items[onion].note, m.data.items[onion].doneAt], ['done', '要紫的', B.data.items[onion].doneAt]);
  assert.deepEqual([label(m, '五花肉'), m.data.items[pork].needs], ['need 2 斤', {}], '自己写的 2 斤是买完以后的：留着，买过的那几道菜的不算了');
});

test('两台设备：B 勾掉、又「清除已买」，A 不知道又加了一道菜 → 新加的那份还在清单上；没新加东西 → 还是清除了的', () => {
  const { s, hsr } = week();
  const [A, B] = fork(s);
  for (const n of ['洋葱', '咖喱块']) setStatus(B, itemOf(B, n).id, 'done', now());
  for (const n of ['洋葱', '咖喱块']) B.data.items[itemOf(B, n).id] = { ...itemOf(B, n), deleted: true, deletedAt: now(), updatedAt: clock };
  add(A, { date: '2026-11-27', meal: 'dinner', recipeId: hsr, servings: 2 });
  generateList(A, W, now());
  editAndMove(A, itemOf(A, '咖喱块').id, { note: '中辣' }, null, now());
  // B 清除得比 A 还晚：较新的是清除了的那份，A 新加的周五那份照样留着
  const later = structuredClone(B);
  for (const n of ['洋葱', '咖喱块']) later.data.items[itemOf(later, n).id].updatedAt = clock + 5000;
  for (const b of [B, later]) {
    const m = mergeStates(A, b);
    assert.equal(canon(mergeStates(b, A)), canon(m));
    assert.deepEqual([label(m, '洋葱'), label(m, '咖喱块')], ['need 1 个', 'deleted'], b === B ? 'A 较新' : '清除的较新');
    assert.equal(itemOf(m, '咖喱块').status, 'done');
  }
});

test('两台设备：见过购买以后才改的不算「不知道」——点错了取消勾选、撤销勾选，合并后照样是要买', () => {
  const { s } = week();
  const [A, B] = fork(s);
  const onion = itemOf(B, '洋葱').id;
  setStatus(B, onion, 'done', now());
  const A2 = mergeStates(A, B);                                        // A 拉到了
  setStatus(A2, onion, 'need', now());                                 // 30 分钟内取消：点错了
  assert.equal(label(A2, '洋葱'), 'need 3 个');
  for (const m of [mergeStates(A2, B), mergeStates(B, A2)]) assert.equal(label(m, '洋葱'), 'need 3 个', '取消勾选不会被合并改回已买');
  // 撤销勾选（state.js 的 undo）：状态改回去也要记成新的改动
  state.load({ storage: null });
  state.mutate(x => { Object.assign(x.data, structuredClone(s.data)); });
  state.mutate(x => setStatus(x, onion, 'done', Date.now()), { undoLabel: '勾掉' });
  const ticked = structuredClone(state.getState());                   // 另一台拉到了已买的那份
  state.undo();
  const undone = state.getState();
  assert.equal(undone.data.items[onion].status, 'need');
  for (const m of [mergeStates(undone, ticked), mergeStates(ticked, undone)]) assert.equal(m.data.items[onion].status, 'need', '撤销了就是没买');
});

test('两台设备各自生成了不同的一周（还没同步过清单）：合并后两周的洋葱、五花肉都算上', () => {
  const w = world();
  const wk1 = add(w.s, { date: '2026-11-23', meal: 'dinner', recipeId: w.hsr, servings: 2 });
  const wk2 = add(w.s, { date: '2026-12-01', meal: 'dinner', recipeId: w.curry, servings: 4 });
  const [A, B] = fork(w.s);
  generateList(A, W, now());
  generateList(B, { from: '2026-11-30', to: '2026-12-06', listId: L }, now());
  const m = mergeStates(A, B);
  assert.equal(canon(mergeStates(B, A)), canon(m));
  assert.deepEqual([label(m, '洋葱'), label(m, '五花肉')], ['need 3 个', 'need 700 g']);
  assert.deepEqual(Object.keys(itemOf(m, '洋葱').needs).sort(), [planSource(wk1), planSource(wk2)].sort());
});

// ---------- 清单上改了名的 ----------
test('清单上把五花肉改成「有机五花肉」（换了商店、写了备注）：加一道菜再生成，就地换它的那一份，不删掉、不另加一条「五花肉」', () => {
  const { s, hsr, mon, tue } = week();
  const pork = itemOf(s, '五花肉');
  editAndMove(s, pork.id, { name: '有机五花肉', storeId: 's_costco', note: '要瘦一点' }, null, now());
  const uses = memoryOf(s, '五花肉').uses;
  const fri = add(s, { date: '2026-11-27', meal: 'dinner', recipeId: hsr, servings: 2 });
  const row = planLines(s, W.from, W.to, { listId: L }).lines.find(l => l.name === '五花肉');
  assert.deepEqual([row.have && row.have.id, row.added, row.sources.map(x => x.state).join(',')], [pork.id, true, 'added,added,new'], '面板认得清单上的有机五花肉');
  generateList(s, W, now());
  const it = s.data.items[pork.id];
  assert.deepEqual([it.deleted, it.name, it.storeId, it.note, totalLabel(it)], [undefined, '有机五花肉', 's_costco', '要瘦一点', '1200 g']);
  assert.deepEqual(Object.keys(it.needs).sort(), [planSource(mon), planSource(tue), planSource(fri)].sort());
  assert.equal(it.needs[planSource(fri)].name, '五花肉', '新加的那份也记着食谱里的名字');
  assert.equal(Object.values(s.data.items).filter(x => !x.deleted && x.listId === L && /五花肉/.test(x.name)).length, 1, '没有另加一条五花肉');
  assert.equal(memoryOf(s, '五花肉').uses, uses, 'memory 没多记一次');
  const again = canon(s.data.items);
  generateList(s, W, now());
  assert.equal(canon(s.data.items), again, '再生成一次不变');
  // 改回原来的名字：不再记着
  editAndMove(s, pork.id, { name: '五花肉' }, null, now());
  assert.equal(s.data.items[pork.id].needs[planSource(fri)].name, undefined);
});

test('食谱里把洋葱改成红洋葱（不是清单上改名）：再生成照旧是替换——洋葱那一份拿掉，加上红洋葱', () => {
  const { s, hsr } = week();
  const r = s.data.recipes[hsr];
  saveRecipe(s, hsr, { ...r, servings: '2', ings: r.ings.map(g => (g.name === '洋葱' ? { ...g, name: '红洋葱', qty: String(g.qty) } : { ...g, qty: g.qty == null ? '' : String(g.qty) })) }, now());
  generateList(s, W, now());
  assert.deepEqual([label(s, '洋葱'), label(s, '红洋葱')], ['need 2 个', 'need 1 个']);
});

// ---------- 换食谱 ----------
test('换食谱：自己勾上的常备品（生抽）和可选的（香菜），新的菜也用 → 留着，换成新菜的用量', () => {
  const w = world();
  const cuc = saveRecipe(w.s, null, { name: '凉拌黄瓜', servings: '2', ings: [{ name: '黄瓜', qty: '2', unit: '根' }, { name: '生抽', qty: '1', unit: '勺' }, { name: '香菜', optional: true }] }, now()).id;
  const mon = add(w.s, { date: '2026-11-23', meal: 'dinner', recipeId: w.hsr, servings: 2 });
  const keys = planLines(w.s, W.from, W.to, { listId: L }).lines.map(l => l.key);   // 生抽、香菜也勾上（家里没了）
  generateList(w.s, { ...W, keys }, now());
  assert.deepEqual([label(w.s, '生抽'), label(w.s, '香菜')], ['need 2 勺', 'need ']);
  const r = editEntry(w.s, mon, { recipeId: cuc }, now());
  assert.ok(r.ok && r.listChanged > 0);
  assert.deepEqual([label(w.s, '生抽'), label(w.s, '香菜'), label(w.s, '黄瓜'), label(w.s, '五花肉')], ['need 1 勺', 'need ', 'need 2 根', 'deleted']);
  assert.equal(itemOf(w.s, '生抽').needs[planSource(mon)].qty, 1);
});

test('换食谱：清单上改了名的那一样，新菜也用 → 就地换成新的用量（不另加、不拿掉）', () => {
  const w = world();
  const stew = saveRecipe(w.s, null, { name: '土豆炖肉', servings: '2', ings: [{ name: '五花肉', qty: '300', unit: 'g' }, { name: '土豆', qty: '2', unit: '个' }] }, now()).id;
  const mon = add(w.s, { date: '2026-11-23', meal: 'dinner', recipeId: w.hsr, servings: 2 });
  generateList(w.s, W, now());
  const pork = itemOf(w.s, '五花肉');
  editAndMove(w.s, pork.id, { name: '有机五花肉' }, null, now());
  editEntry(w.s, mon, { recipeId: stew }, now());
  const it = w.s.data.items[pork.id];
  assert.deepEqual([it.deleted, it.name, totalLabel(it)], [undefined, '有机五花肉', '300 g']);
  assert.equal(Object.values(w.s.data.items).filter(x => !x.deleted && x.listId === L && /五花肉/.test(x.name)).length, 1);
});

// ---------- 删掉的菜、删掉的清单 ----------
test('勾掉洋葱 → 删掉那道菜（已买的不动）→ 30 分钟内又取消勾选（点错了，照原样放回去）：再生成任何一段日子时清掉删掉的那道菜的那一份', () => {
  const w = world();
  const mon = add(w.s, { date: '2026-11-23', meal: 'dinner', recipeId: w.hsr, servings: 2 });
  const tue = add(w.s, { date: '2026-11-24', meal: 'dinner', recipeId: w.curry, servings: 4 });
  generateList(w.s, W, now());
  const onion = itemOf(w.s, '洋葱').id;
  setStatus(w.s, onion, 'done', now());
  deleteEntry(w.s, mon, now());
  setStatus(w.s, onion, 'need', now(60_000));
  assert.ok(w.s.data.items[onion].needs[planSource(mon)], '点错了照原样放回去，连同删掉的那道菜的那一份');
  generateList(w.s, { from: '2026-12-07', to: '2026-12-13', listId: L }, now());   // 别的一周：一道菜也没有
  assert.deepEqual([label(w.s, '洋葱'), Object.keys(w.s.data.items[onion].needs)], ['need 2 个', [planSource(tue)]]);
});

test('两台设备：A 删掉红烧肉，B 不知道、加了一道菜再生成（B 那份更新，红烧肉的又回来了）→ 合并后再生成一次就清掉', () => {
  const { s, curry, mon } = week();
  const [A, B] = fork(s);
  deleteEntry(A, mon, now());
  assert.deepEqual([label(A, '洋葱'), label(A, '五花肉')], ['need 2 个', 'need 200 g']);
  add(B, { date: '2026-11-27', meal: 'dinner', recipeId: curry, servings: 4 });
  generateList(B, W, now());
  const m = mergeStates(A, B);
  assert.equal(m.data.plan[mon].deleted, true);
  assert.equal(label(m, '洋葱'), 'need 5 个', '合并后红烧肉的 1 个回来了');
  generateList(m, W, now());
  assert.deepEqual([label(m, '洋葱'), label(m, '五花肉')], ['need 4 个', 'need 400 g']);
  assert.equal(Object.values(m.data.items).some(it => !it.deleted && it.needs[planSource(mon)]), false);
});

test('生成到「聚会」以后删掉这张清单（东西跟着隐藏）：再生成到「食材」不算「已经加过」，确认后都在「食材」上，藏着的那几份拿掉', () => {
  const w = world();
  const party = 'l_party';
  w.s.data.lists[party] = normalizeRecord('lists', { id: party, name: '聚会', kind: 'grocery', order: 3, updatedAt: now() });
  add(w.s, { date: '2026-11-23', meal: 'dinner', recipeId: w.hsr, servings: 2 });
  generateList(w.s, { ...W, listId: party }, now());
  deleteList(w.s, party, now());
  assert.deepEqual(sheet(w.s).filter(r => r[0] === '洋葱' || r[0] === '五花肉').map(r => [r[0], r[3], r[4]]), [['五花肉', true, 'new'], ['洋葱', true, 'new']]);
  generateList(w.s, W, now());
  assert.deepEqual([label(w.s, '洋葱'), label(w.s, '五花肉')], ['need 1 个', 'need 500 g']);
  assert.equal(label(w.s, '洋葱', party), 'deleted', '删掉的清单上那份拿掉了（恢复清单时不会冒出来算两遍）');
});

// ---------- 按人数换算 ----------
test('3 人份的炒饭，周一到周三每天 1 人份：面板和清单上是洋葱 1 个、鸡蛋 2 个（不是 0.99、2.01）', () => {
  const w = world();
  const rice = saveRecipe(w.s, null, { name: '炒饭', servings: '3', ings: [{ name: '洋葱', qty: '1', unit: '个' }, { name: '鸡蛋', qty: '2', unit: '个' }] }, now()).id;
  for (const d of ['2026-11-23', '2026-11-24', '2026-11-25']) add(w.s, { date: d, meal: 'lunch', recipeId: rice, servings: 1 });
  assert.deepEqual(sheet(w.s).map(r => [r[0], r[2]]), [['洋葱', 1], ['鸡蛋', 2]]);
  generateList(w.s, W, now());
  assert.deepEqual([label(w.s, '洋葱'), label(w.s, '鸡蛋')], ['need 1 个', 'need 2 个']);
});
