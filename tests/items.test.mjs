// 清单里的东西（core/items.js）和买过的东西的习惯（core/memory.js）：加、恢复、已经在清单上、默认值、勾掉、清除已买、移动、编辑、联想。
// 函数直接改传进来的 state（页面在 ctx.mutate 里调用）；撤销用真的 state.js。全是编的数据
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureSeeds, blankState, normalizeRecord, itemId, hash64, normName, deletedRecord, restoredRecord } from '../src/core/store.js';
import { addFromInput, addItem, defaultsFor, toggleDone, setStatus, clearDone, moveItem, moveConflict, validateItemPatch, editItem,
  readPrice, cleanUrl, liveItem, countItems, UNTICK_MS } from '../src/core/items.js';
import { memoryOf, memoryId, usualStore, recordUse, recordPurchase, recordPrefs, suggestions } from '../src/core/memory.js';
import * as state from '../src/core/state.js';

const T0 = 1_700_000_000_000;
let clock = T0;
const now = () => (clock += 1000);
const seeded = () => ensureSeeds(blankState());
const items = (s, listId = 'l_groceries') => Object.values(s.data.items).filter(it => it.listId === listId);
const add = (s, text, listId = 'l_groceries') => addFromInput(s, listId, text, now());
/** 一条已经在数据里的东西（模拟以前留下的、别的设备同步来的） */
const put = (s, id, f) => { s.data.items[id] = normalizeRecord('items', { id, listId: 'l_groceries', name: id, status: 'need', updatedAt: T0, createdAt: T0, ...f }); return s.data.items[id]; };
const custom = (s, id, f = {}) => { s.data.lists[id] = normalizeRecord('lists', { id, name: id, kind: 'general', order: 9, updatedAt: T0, ...f }); return s.data.lists[id]; };

// ---------- 加 ----------
test('加：新的 → added（固定 id、数量默认 1、状态要买）；再加一次 → exists，什么也不改', () => {
  const s = seeded();
  const r = add(s, '牛奶');
  assert.equal(r.outcome, 'added');
  assert.equal(r.id, 'i_' + hash64('l_groceries\n牛奶'));
  assert.deepEqual([r.item.name, r.item.qty, r.item.unit, r.item.status, r.item.doneAt, r.item.note, r.item.url, r.item.price], ['牛奶', 1, '', 'need', null, '', '', null]);
  assert.deepEqual(r.item.needs, {});
  const before = structuredClone(s);
  const again = add(s, ' 牛奶 3 ');
  assert.equal(again.outcome, 'exists');
  assert.equal(again.id, r.id);
  assert.deepEqual(s, before, '已经在清单上：数量、memory 都不动');
  // 繁体、大小写、多余的空格：同一样
  assert.equal(add(s, '牛奶').outcome, 'exists');
  add(s, 'Oat Milk');
  assert.equal(add(s, 'oat  milk').outcome, 'exists');
  add(s, '雞蛋');
  assert.equal(add(s, '鸡蛋').outcome, 'exists');
  assert.equal(items(s).length, 3);
});

test('加：已买的、已清除的 → restored，同一条恢复成要买（数量用这次写的或 1，带着上次的单位、备注、分类）', () => {
  const s = seeded();
  const { id } = add(s, '面粉 2袋');
  s.data.items[id] = { ...s.data.items[id], note: '高筋', categoryId: 'c_pantry' };
  toggleDone(s, id, now());
  const r = add(s, '面粉');
  assert.equal(r.outcome, 'restored');
  assert.equal(r.id, id);
  assert.deepEqual([r.item.status, r.item.doneAt, r.item.qty, r.item.unit, r.item.note], ['need', null, 1, '袋', '高筋']);
  // 清除（软删除）以后再加：还是同一条，删除标记去掉
  toggleDone(s, id, now());
  clearDone(s, 'l_groceries', now());
  assert.equal(s.data.items[id].deleted, true);
  const r2 = add(s, '面粉 3');
  assert.equal(r2.outcome, 'restored');
  assert.equal(r2.id, id);
  assert.deepEqual([r2.item.deleted, r2.item.deletedAt, r2.item.qty, r2.item.unit, r2.item.note, r2.item.categoryId], [undefined, undefined, 3, '袋', '高筋', 'c_pantry']);
  assert.equal(items(s).length, 1, '记录不会越加越多');
  // 一般清单的「以后再说」再加一次：变成要买
  custom(s, 'l_wood');
  const w = add(s, '砂纸', 'l_wood');
  setStatus(s, w.id, 'later', now());
  assert.equal(add(s, '砂纸', 'l_wood').outcome, 'restored');
  assert.equal(s.data.items[w.id].status, 'need');
});

test('加：改名改成同名的、从别的清单移过来的、以前分到随机 id 的，都已经是「这张清单里的这一样」', () => {
  const s = seeded();
  put(s, 'i_old', { name: '豆腐' });                                      // 随机 id、要买
  assert.equal(add(s, '豆腐').outcome, 'exists');
  put(s, 'i_renamed', { name: '牛奶', status: 'done', doneAt: T0 });        // 别的东西改名成了「牛奶」，已买
  const r = add(s, '牛奶');
  assert.deepEqual([r.outcome, r.id], ['restored', 'i_renamed']);
  custom(s, 'l_wood');
  const glue = add(s, '木胶', 'l_wood');
  moveItem(s, glue.id, 'l_groceries', now());
  const g = add(s, '木胶');
  assert.deepEqual([g.outcome, g.id], ['exists', glue.id]);
  // 固定 id 那一格被占了（那条移到了别的清单）：用随机 id，不顶掉它
  const fixed = 'i_' + hash64('l_wood\n木胶');
  assert.equal(glue.id, fixed);
  const again = add(s, '木胶', 'l_wood');
  assert.equal(again.outcome, 'added');
  assert.notEqual(again.id, fixed);
  assert.equal(s.data.items[fixed].listId, 'l_groceries');
  assert.equal(itemId(s, 'l_wood', '木胶'), again.id);
});

test('加：空的、清单不在了 → 什么也不做', () => {
  const s = seeded();
  assert.equal(add(s, '   ').outcome, 'empty');
  assert.equal(addFromInput(s, 'l_nope', '牛奶', now()).outcome, 'nolist');
  custom(s, 'l_gone', { deleted: true, deletedAt: T0 });
  assert.equal(addFromInput(s, 'l_gone', '牛奶', now()).outcome, 'nolist');
  assert.equal(Object.keys(s.data.items).length, 0);
  assert.equal(Object.keys(s.data.memory).length, 0);
});

// ---------- 默认值 ----------
test('默认商店：常去的 → 清单的默认商店 → 未指定；归档、删除的商店不当默认', () => {
  const s = seeded();
  assert.equal(add(s, '牛奶').item.storeId, 's_wholefoods', '没买过：食材清单的默认商店');
  assert.equal(add(s, '台灯', 'l_tobuy').item.storeId, null, '想买没有默认商店');
  // 在 H Mart 买过两次、Costco 一次：常去 H Mart
  recordPurchase(s, '豆腐', 's_hmart', 'grocery', now());
  recordPurchase(s, '豆腐', 's_hmart', 'grocery', now());
  recordPurchase(s, '豆腐', 's_costco', 'grocery', now());
  assert.equal(add(s, '豆腐').item.storeId, 's_hmart');
  // 砂纸在 Home Depot 买过：放进哪张清单都记得
  recordPurchase(s, '砂纸', 's_homedepot', 'general', now());
  assert.equal(add(s, '砂纸', 'l_tobuy').item.storeId, 's_homedepot');
  // H Mart 归档了：退回清单的默认商店（Costco 那一次也算常去的：跳过归档的，剩下的里 n 最大的）
  s.data.stores.s_hmart = { ...s.data.stores.s_hmart, archived: true, updatedAt: now() };
  assert.equal(defaultsFor(s, s.data.lists.l_groceries, '豆腐').storeId, 's_costco');
  s.data.stores.s_costco = deletedRecord(s.data.stores.s_costco, now());
  assert.equal(defaultsFor(s, s.data.lists.l_groceries, '豆腐').storeId, 's_wholefoods');
  s.data.stores.s_wholefoods = { ...s.data.stores.s_wholefoods, archived: true, updatedAt: now() };
  assert.equal(defaultsFor(s, s.data.lists.l_groceries, '豆腐').storeId, null, '清单的默认商店归档了：未指定');
});

test('默认分类：记住的 → 内置对照（只给食材清单）→ 未分类；单位：输入里写的 → 记住的 → 空；数量：写的 → 1', () => {
  const s = seeded();
  const milk = add(s, '牛奶 2盒').item;
  assert.deepEqual([milk.categoryId, milk.qty, milk.unit], ['c_dairy', 2, '盒']);
  assert.equal(add(s, '苹果').item.categoryId, 'c_produce');
  assert.equal(add(s, '鳳梨').item.categoryId, 'c_produce', '繁体也认得');
  assert.equal(add(s, '没听说过的东西').item.categoryId, null);
  assert.equal(add(s, '牛奶', 'l_tobuy').item.categoryId, null, '一般清单不按食材对照分类');
  // 改过一次分类：以后都记得（比对照表优先）
  recordPrefs(s, '香菜', 'grocery', { categoryId: 'c_condiments' }, now());
  assert.equal(add(s, '香菜').item.categoryId, 'c_condiments');
  // 记住的分类不能给这种清单用（一般清单的「书籍」）、被删掉了：不用它
  recordPrefs(s, '番茄', 'grocery', { categoryId: 'c_books' }, now());
  assert.equal(add(s, '番茄').item.categoryId, 'c_produce');
  s.data.categories.c_snacks = deletedRecord(s.data.categories.c_snacks, now());
  assert.equal(add(s, '薯片').item.categoryId, null, '对照出的分类被删了：未分类');
  // 单位：上次写过「盒」，这次不写也是盒；数量默认 1
  const { id } = add(s, '酸奶 4盒');
  toggleDone(s, id, now()); clearDone(s, 'l_groceries', now());
  s.data.memory[memoryId('酸奶')] = { ...s.data.memory[memoryId('酸奶')], unit: '杯' };
  const y = add(s, '酸奶').item;
  assert.deepEqual([y.qty, y.unit], [1, '杯'], '记住的单位比这条记录上次的优先');
  assert.equal(add(s, '鸡蛋 12个').item.unit, '个');
  assert.equal(memoryOf(s, '鸡蛋').unit, '个', '输入里写了单位也记下来');
});

// ---------- memory ----------
test('memory：加进清单（新加、恢复）uses + 1、记下最近的写法和类型；已经在清单上的不算；名字繁简、大小写算同一条', () => {
  const s = seeded();
  const t1 = now();
  addFromInput(s, 'l_groceries', '雞蛋', t1);
  const m = memoryOf(s, '鸡蛋');
  assert.equal(m.id, 'm_' + hash64(normName('鸡蛋')));
  assert.deepEqual([m.name, m.kind, m.uses, m.lastAt, m.categoryId, m.unit], ['雞蛋', 'grocery', 1, t1, null, '']);
  add(s, '鸡蛋');
  assert.equal(memoryOf(s, '鸡蛋').uses, 1, 'exists 不算');
  const id = itemId(s, 'l_groceries', '鸡蛋');
  toggleDone(s, id, now());
  add(s, '鸡蛋');
  assert.deepEqual([memoryOf(s, '鸡蛋').uses, memoryOf(s, '鸡蛋').name], [2, '鸡蛋']);
  // 删掉的 memory：再用时重新开始一条（修改时间比删除新）
  const del = deletedRecord(s.data.memory[m.id], now());
  s.data.memory[m.id] = del;
  assert.equal(memoryOf(s, '鸡蛋'), null);
  recordUse(s, '鸡蛋', 'grocery', now());
  assert.equal(memoryOf(s, '鸡蛋').uses, 1);
  assert.ok(s.data.memory[m.id].updatedAt > del.updatedAt);
  assert.equal(recordUse(s, '  ', 'grocery', now()), null);
});

test('memory：勾成已买时这次的商店 n + 1（没指定不计）；取消勾选减回去；改了商店的已买挪过去', () => {
  const s = seeded();
  const { id } = add(s, '牛奶');
  const t1 = now();
  toggleDone(s, id, t1);
  assert.deepEqual(memoryOf(s, '牛奶').stores, { s_wholefoods: { n: 1, at: t1 } });
  toggleDone(s, id, now());
  assert.deepEqual(memoryOf(s, '牛奶').stores, {}, '点错了又点回来：不多算');
  const { id: tid } = add(s, '台灯', 'l_tobuy');
  toggleDone(s, tid, now());
  assert.deepEqual(memoryOf(s, '台灯').stores, {}, '没指定商店：不计');
  toggleDone(s, id, now());
  editItem(s, id, { storeId: 's_costco' }, now());
  assert.deepEqual(Object.keys(memoryOf(s, '牛奶').stores), ['s_costco'], '已买的改了商店：那一次算到新商店');
  assert.equal(recordPurchase(s, '牛奶', null, 'grocery', now()), null);
});

test('memory：指定的商店删掉了（显示成「未指定」）时勾掉不计到那家店，编辑面板里勾成已买、改名也一样；商店恢复后照常计', () => {
  const s = seeded();
  const { id } = add(s, '牛奶');
  assert.equal(s.data.items[id].storeId, 's_wholefoods');
  s.data.stores.s_wholefoods = deletedRecord(s.data.stores.s_wholefoods, now());
  toggleDone(s, id, now());
  assert.deepEqual(memoryOf(s, '牛奶').stores, {}, '删掉期间当未指定：不计');
  toggleDone(s, id, now());
  editItem(s, id, { status: 'done' }, now());
  assert.deepEqual(memoryOf(s, '牛奶').stores, {});
  editItem(s, id, { name: '全脂牛奶' }, now());
  assert.equal(memoryOf(s, '全脂牛奶'), null, '已买的改名：没记过的那一次也不挪');
  assert.equal(usualStore(s, memoryOf(s, '牛奶')), null);
  // 恢复了：东西的 storeId 一直没动，再勾就算回 Whole Foods
  s.data.stores.s_wholefoods = restoredRecord(s.data.stores.s_wholefoods, now());
  setStatus(s, id, 'need', now());
  toggleDone(s, id, now());
  assert.equal(memoryOf(s, '全脂牛奶').stores.s_wholefoods.n, 1);
});

test('memory：隔久了再取消勾选（又要买了）不减；几周都在 Costco 买，偶尔在 H Mart 买一次，常去的还是 Costco', () => {
  const s = seeded();
  const DAY = 24 * 3600 * 1000;
  let t = T0 + 100 * DAY;
  const { id } = addFromInput(s, 'l_groceries', '鸡蛋', t);
  editItem(s, id, { storeId: 's_costco' }, t);
  for (let week = 0; week < 3; week++) {
    toggleDone(s, id, (t += 1000));             // 买了
    toggleDone(s, id, (t += 7 * DAY));          // 一周后在「已买」里点回来：又要买了
  }
  assert.deepEqual(memoryOf(s, '鸡蛋').stores.s_costco.n, 3, '每次购买都算');
  editItem(s, id, { storeId: 's_hmart' }, t);
  toggleDone(s, id, (t += 1000));
  assert.deepEqual([memoryOf(s, '鸡蛋').stores.s_costco.n, memoryOf(s, '鸡蛋').stores.s_hmart.n], [3, 1]);
  assert.equal(usualStore(s, memoryOf(s, '鸡蛋')), 's_costco', '偶尔换一家不改习惯');
  // 清掉以后再加：商店是常去的那家
  clearDone(s, 'l_groceries', (t += 1000));
  assert.equal(addFromInput(s, 'l_groceries', '鸡蛋', (t += 1000)).item.storeId, 's_costco');
  // 刚勾上又取消（UNTICK_MS 之内）：点错了，减回去；刚好到时间就不减了
  toggleDone(s, id, (t += 1000));
  toggleDone(s, id, t + UNTICK_MS - 1);
  assert.equal(memoryOf(s, '鸡蛋').stores.s_costco.n, 3);
  t += UNTICK_MS;
  toggleDone(s, id, (t += 1000));
  toggleDone(s, id, t + UNTICK_MS);
  assert.equal(memoryOf(s, '鸡蛋').stores.s_costco.n, 4);
  // 编辑面板里改状态也一样：刚勾上的减回去，隔久了不减
  t += UNTICK_MS + 1000;
  editItem(s, id, { status: 'done' }, (t += 1000));
  editItem(s, id, { status: 'need' }, (t += 1000));
  assert.equal(memoryOf(s, '鸡蛋').stores.s_costco.n, 4);
  editItem(s, id, { status: 'done' }, (t += 1000));
  editItem(s, id, { status: 'need' }, (t += DAY));
  assert.equal(memoryOf(s, '鸡蛋').stores.s_costco.n, 5);
});

test('memory：已买的改了名字，那次购买跟着挪到新名字下面；之后取消勾选从新名字减', () => {
  const s = seeded();
  const { id } = add(s, '牛奶');
  editItem(s, id, { storeId: 's_costco' }, now());
  toggleDone(s, id, now());
  assert.equal(memoryOf(s, '牛奶').stores.s_costco.n, 1);
  editItem(s, id, { name: '有机牛奶' }, now());
  assert.deepEqual(memoryOf(s, '牛奶').stores, {}, '旧名字下面那次挪走了');
  assert.equal(memoryOf(s, '有机牛奶').stores.s_costco.n, 1);
  toggleDone(s, id, now());
  assert.deepEqual(memoryOf(s, '有机牛奶').stores, {}, '点错了：从新名字下面减');
  // 只改大小写、繁简（还是同一样）：不挪
  const { id: b } = add(s, 'Oat Milk');
  toggleDone(s, b, now());
  const before = structuredClone(memoryOf(s, 'oat milk').stores);
  editItem(s, b, { name: 'oat milk' }, now());
  assert.deepEqual(memoryOf(s, 'oat milk').stores, before);
});

test('memory：改成「未分类」也记得（categorySet）：清掉再加、加到别的食材清单都不再按对照表猜', () => {
  const s = seeded();
  const { id } = add(s, '冻顶乌龙');
  custom(s, 'l_more', { kind: 'grocery' });
  // 对照表猜不出也好、猜错了也好，用户改成未分类就是未分类
  editItem(s, id, { categoryId: 'c_frozen' }, now());
  editItem(s, id, { categoryId: null }, now());
  assert.deepEqual([memoryOf(s, '冻顶乌龙').categoryId, memoryOf(s, '冻顶乌龙').categorySet], [null, true]);
  toggleDone(s, id, now()); clearDone(s, 'l_groceries', now());
  assert.equal(add(s, '冻顶乌龙').item.categoryId, null);
  // 内置对照猜得出的（牛奶 → 蛋奶）改成未分类：别的清单也是未分类
  const milk = add(s, '牛奶').item;
  assert.equal(milk.categoryId, 'c_dairy');
  editItem(s, milk.id, { categoryId: null }, now());
  assert.equal(add(s, '牛奶', 'l_more').item.categoryId, null);
  // 没改过的照样按对照表猜；记录上的 categorySet 只在 true 时留着
  assert.equal(add(s, '酸奶', 'l_more').item.categoryId, 'c_dairy');
  assert.equal('categorySet' in memoryOf(s, '酸奶'), false);
  assert.equal('categorySet' in normalizeRecord('memory', { id: 'm_x', name: 'x', categorySet: 'yes', updatedAt: 1 }), false);
  assert.equal(normalizeRecord('memory', { id: 'm_x', name: 'x', categorySet: true, updatedAt: 1 }).categorySet, true);
});

test('usualStore：次数最多的；一样多取最近买的，再一样按 id；跳过已删除、已归档、不存在的商店', () => {
  const s = seeded();
  const mem = (stores) => ({ stores });
  assert.equal(usualStore(s, mem({ s_costco: { n: 1, at: 9 }, s_hmart: { n: 3, at: 1 } })), 's_hmart', '偶尔换一家买一次不改习惯');
  assert.equal(usualStore(s, mem({ s_costco: { n: 2, at: 9 }, s_hmart: { n: 2, at: 5 } })), 's_costco');
  assert.equal(usualStore(s, mem({ s_target: { n: 2, at: 5 }, s_costco: { n: 2, at: 5 } })), 's_costco');
  assert.equal(usualStore(s, mem({ s_nope: { n: 5, at: 5 }, s_target: { n: 1, at: 1 } })), 's_target');
  s.data.stores.s_hmart = { ...s.data.stores.s_hmart, archived: true };
  s.data.stores.s_costco = deletedRecord(s.data.stores.s_costco, now());
  assert.equal(usualStore(s, mem({ s_hmart: { n: 5, at: 5 }, s_costco: { n: 4, at: 4 }, s_target: { n: 1, at: 1 } })), 's_target');
  assert.equal(usualStore(s, mem({ s_hmart: { n: 5, at: 5 } })), null);
  assert.equal(usualStore(s, mem({ s_target: { n: 0, at: 5 } })), null);
  assert.equal(usualStore(s, null), null);
});

test('联想：开头对上的在中间对上的前面，再按加过的次数、最近的时间；标出常去的商店、已经在这张清单上要买的', () => {
  const s = seeded();
  for (const [name, uses, at] of [['牛奶', 2, 10], ['燕麦牛奶', 9, 20], ['牛奶糖', 2, 30], ['牛肉', 2, 40], ['牛油果', 5, 5], ['酸奶', 1, 1]]) {
    for (let i = 0; i < uses; i++) recordUse(s, name, 'grocery', T0 + at);
  }
  recordPurchase(s, '牛奶', 's_costco', 'grocery', now());
  add(s, '牛奶');                                                           // 加进清单：牛奶 uses 3
  const names = (q) => suggestions(s, 'l_groceries', q).map(x => x.name);
  // 开头对上的：uses 5、3、2、2（一样多的，最近加的牛肉在前），然后才是中间对上的燕麦牛奶（uses 再多也在后面）
  assert.deepEqual(names('牛'), ['牛油果', '牛奶', '牛肉', '牛奶糖', '燕麦牛奶']);
  assert.deepEqual(names('牛奶'), ['牛奶', '牛奶糖', '燕麦牛奶']);
  const milk = suggestions(s, 'l_groceries', '牛奶').find(x => x.name === '牛奶');
  assert.deepEqual([milk.storeId, milk.inList], ['s_costco', true]);
  assert.equal(suggestions(s, 'l_tobuy', '牛奶').find(x => x.name === '牛奶').inList, false, '别的清单上的不算');
  assert.deepEqual(names('奶'), ['燕麦牛奶', '牛奶', '牛奶糖', '酸奶']);
  assert.deepEqual(names(''), []);
  assert.equal(suggestions(s, 'l_groceries', '奶', { limit: 2 }).length, 2);
  // 繁体输入也能找到简体的
  recordUse(s, '鸡蛋', 'grocery', now());
  assert.deepEqual(names('雞'), ['鸡蛋']);
});

// ---------- 勾掉、状态、清除已买 ----------
test('勾掉 / 取消：要买 → 已买（记 doneAt）→ 要买；以后再说只有一般清单能用', () => {
  const s = seeded();
  const { id } = add(s, '牛奶');
  const t1 = now();
  assert.deepEqual([toggleDone(s, id, t1).status, s.data.items[id].doneAt], ['done', t1]);
  assert.deepEqual([toggleDone(s, id, now()).status, s.data.items[id].doneAt], ['need', null]);
  assert.equal(setStatus(s, id, 'later', now()), null, '食材清单没有以后再说');
  const { id: lamp } = add(s, '台灯', 'l_tobuy');
  assert.equal(setStatus(s, lamp, 'later', now()).status, 'later');
  assert.equal(toggleDone(s, lamp, now()).status, 'done', '以后再说的点一下也是买到了');
  assert.equal(setStatus(s, lamp, 'bogus', now()), null);
  assert.equal(toggleDone(s, 'i_nope', now()), null);
  // 没变的不盖新时间
  const at = s.data.items[lamp].updatedAt;
  setStatus(s, lamp, 'done', now());
  assert.equal(s.data.items[lamp].updatedAt, at);
});

test('countItems：这张清单里没删除的有几样（可以只数一种状态）；别的清单、删掉的不算', () => {
  const s = seeded();
  for (const x of ['牛奶', '鸡蛋', '面包']) add(s, x);
  add(s, '台灯', 'l_tobuy');
  toggleDone(s, itemId(s, 'l_groceries', '鸡蛋'), now());
  s.data.items[itemId(s, 'l_groceries', '面包')] = deletedRecord(s.data.items[itemId(s, 'l_groceries', '面包')], now());
  assert.deepEqual([countItems(s, 'l_groceries'), countItems(s, 'l_groceries', 'need'), countItems(s, 'l_groceries', 'done'), countItems(s, 'l_tobuy')], [2, 1, 1, 1]);
});

test('清除已买：只软删除这张清单里已买的，返回几样；用 state.js 撤销能全部回来', () => {
  state.load({ storage: null });
  try {
    state.mutate(s => { add(s, '牛奶'); add(s, '鸡蛋'); add(s, '面包'); add(s, '台灯', 'l_tobuy'); });
    const id = (n, l = 'l_groceries') => itemId(state.getState(), l, n);
    state.mutate(s => { toggleDone(s, id('牛奶'), now()); toggleDone(s, id('面包'), now()); toggleDone(s, id('台灯', 'l_tobuy'), now()); });
    const n = state.mutate(s => clearDone(s, 'l_groceries', now()), { undoLabel: '已清除 2 样' });
    assert.equal(n, 2);
    const S = () => state.getState().data.items;
    assert.deepEqual([S()[id('牛奶')].deleted, S()[id('面包')].deleted, S()[id('鸡蛋')].deleted, S()[id('台灯', 'l_tobuy')].deleted], [true, true, undefined, undefined]);
    assert.equal(S()[id('牛奶')].status, 'done', '是软删除，不是改状态');
    assert.equal(state.undo(), '已清除 2 样');
    assert.deepEqual([S()[id('牛奶')].deleted, S()[id('面包')].deleted, S()[id('牛奶')].status], [undefined, undefined, 'done']);
    assert.equal(state.mutate(s => clearDone(s, 'l_tobuy', now())), 1);
    assert.equal(state.mutate(s => clearDone(s, 'l_tobuy', now())), 0);
  } finally { state.load({ storage: null }); }
});

// ---------- 移到别的清单 ----------
test('移动：同一条换清单；分类不合适的重新定；以后再说去食材清单变成要买；目标有同名的先报出来，确认后合并成那一条', () => {
  const s = seeded();
  custom(s, 'l_wood');
  const { id } = add(s, '苹果', 'l_tobuy');
  setStatus(s, id, 'later', now());
  s.data.items[id] = { ...s.data.items[id], categoryId: 'c_books', note: '红的' };
  assert.equal(moveConflict(s, id, 'l_groceries'), null);
  assert.deepEqual(moveItem(s, id, 'l_groceries', now()), { outcome: 'moved', id });
  const it = s.data.items[id];
  assert.deepEqual([it.listId, it.status, it.categoryId, it.note], ['l_groceries', 'need', 'c_produce', '红的']);
  assert.equal(moveItem(s, id, 'l_groceries', now()).outcome, 'same');
  assert.equal(moveItem(s, id, 'l_nope', now()).outcome, 'none');
  // 目标清单已经有「牛奶」（已买）：报出那一条；合并 = 那一条恢复成要买，这一条软删除
  const milk = add(s, '牛奶').id;
  toggleDone(s, milk, now());
  const other = add(s, '牛奶', 'l_wood').id;
  assert.equal(moveConflict(s, other, 'l_groceries').id, milk);
  assert.equal(moveConflict(s, other, 'l_groceries', '酸奶'), null, '编辑时同时改了名字：按新名字查');
  assert.deepEqual(moveItem(s, other, 'l_groceries', now()), { outcome: 'merged', id: milk });
  assert.deepEqual([s.data.items[milk].status, s.data.items[other].deleted], ['need', true]);
  assert.equal(items(s).filter(x => !x.deleted && normName(x.name) === '牛奶').length, 1, '同一张清单里同名的只有一条');
  // 已删除的同名记录不算冲突
  const bread = add(s, '面包').id;
  toggleDone(s, bread, now()); clearDone(s, 'l_groceries', now());
  const b2 = add(s, '面包', 'l_wood').id;
  assert.equal(moveConflict(s, b2, 'l_groceries'), null);
});

// ---------- 改一样东西 ----------
test('检查改动：名字不能空、不能和同清单别的重名；数量空着或 0 < q ≤ 9999；链接只收 http / https；价格空着或 ≥ 0', () => {
  const s = seeded();
  const it = add(s, '牛奶').item;
  add(s, '酸奶');
  const v = (patch) => validateItemPatch(s, it, patch);
  assert.deepEqual(v({ name: '  ' }).errors, { name: 'item.err.name' });
  assert.deepEqual(v({ name: '酸奶' }).errors, { name: 'item.err.nameTaken' });
  assert.deepEqual(v({ name: '  牛奶（低脂） ' }).clean, { name: '牛奶（低脂）' });
  assert.ok(v({ name: '牛奶' }).ok, '自己的名字不算重名');
  assert.deepEqual(['', '3', '0.5', '9999'].map(q => v({ qty: q }).clean.qty), [null, 3, 0.5, 9999]);
  for (const q of ['0', '-1', '10000', 'abc', '1/0']) assert.deepEqual(v({ qty: q }).errors, { qty: 'item.err.qty' }, q);
  assert.equal(v({ url: '' }).clean.url, '');
  assert.equal(v({ url: ' https://example.com/a?b=1 ' }).clean.url, 'https://example.com/a?b=1');
  for (const u of ['javascript:alert(1)', 'ftp://example.com', 'example.com', 'data:text/html,x']) assert.deepEqual(v({ url: u }).errors, { url: 'item.err.url' }, u);
  assert.deepEqual(['', '0', '12.99', '$1,299'].map(p => v({ price: p }).clean.price), [null, 0, 12.99, 1299]);
  for (const p of ['-1', 'abc']) assert.deepEqual(v({ price: p }).errors, { price: 'item.err.price' }, p);
  // 不存在的商店、分类：不改（不报错）；食材清单的「以后再说」：不改
  assert.deepEqual(v({ storeId: 's_nope', categoryId: 'c_nope', status: 'later' }).clean, {});
  assert.deepEqual(v({ storeId: '', categoryId: null }).clean, { storeId: null, categoryId: null });
  assert.equal(readPrice(null), null);
  assert.equal(cleanUrl('http://x.test'), 'http://x.test');
});

test('编辑：有错什么也不改；只改交来的字段；改分类、单位记进 memory；改状态记 doneAt；这一样不在了 → 报错', () => {
  const s = seeded();
  const { id } = add(s, '牛奶');
  const before = structuredClone(s.data.items[id]);
  assert.deepEqual(editItem(s, id, { name: '', qty: '2' }, now()), { ok: false, errors: { name: 'item.err.name' } });
  assert.deepEqual(s.data.items[id], before);
  const r = editItem(s, id, { qty: '2', unit: '瓶', categoryId: 'c_snacks', note: '要冷藏\n放门上' }, now());
  assert.equal(r.ok, true);
  assert.deepEqual([r.item.qty, r.item.unit, r.item.categoryId, r.item.note, r.item.storeId], [2, '瓶', 'c_snacks', '要冷藏\n放门上', 's_wholefoods']);
  assert.deepEqual([memoryOf(s, '牛奶').categoryId, memoryOf(s, '牛奶').unit], ['c_snacks', '瓶']);
  // 只改商店：不影响 memory 里记住的分类、单位，也不改常去的商店
  editItem(s, id, { storeId: 's_target' }, now());
  assert.deepEqual([memoryOf(s, '牛奶').categoryId, memoryOf(s, '牛奶').stores], ['c_snacks', {}]);
  const t1 = now();
  editItem(s, id, { status: 'done' }, t1);
  assert.deepEqual([s.data.items[id].status, s.data.items[id].doneAt], ['done', t1]);
  assert.deepEqual(memoryOf(s, '牛奶').stores, { s_target: { n: 1, at: t1 } });
  // 什么也没改：不盖新时间
  const at = s.data.items[id].updatedAt;
  editItem(s, id, { qty: '2' }, now());
  assert.equal(s.data.items[id].updatedAt, at);
  s.data.items[id] = deletedRecord(s.data.items[id], now());
  assert.deepEqual(editItem(s, id, { qty: '3' }, now()), { ok: false, errors: { item: 'item.err.gone' } });
  assert.equal(liveItem(s, id), null);
});
