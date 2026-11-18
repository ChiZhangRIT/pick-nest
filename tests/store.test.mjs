import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  blankState, normalizeState, normalizeRecord, mergeStates, canon, pick, stamp, deletedRecord, restoredRecord, newId, setSetting,
  ensureSeeds, seedRecords, normName, hash64, itemId, listName, categoryName, listIcon, byOrder, live, homeLists, needCounts,
  COLLECTIONS, SEED_STORES, SYS_CATEGORIES, DEFAULT_LIST_ICON,
} from '../src/core/store.js';

// 测试只用编出来的数据（仓库是公开的）
const T = (key, vars) => '«' + key + (vars ? JSON.stringify(vars) : '') + '»';
const seeded = () => ensureSeeds(blankState());
/** FNV-1a 64 的参考实现（BigInt），用来核对 store.js 里不用 BigInt 的写法 */
const fnvRef = s => {
  let h = 0xcbf29ce484222325n;
  for (const b of new TextEncoder().encode(s)) { h ^= BigInt(b); h = (h * 0x100000001b3n) & 0xffffffffffffffffn; }
  return h.toString(36);
};

// ---------- 整理 ----------
test('blankState：五个集合、app 标识 picknest', () => {
  const s = blankState();
  assert.equal(s.app, 'picknest');
  assert.equal(s.v, 1);
  assert.deepEqual(Object.keys(s.data), COLLECTIONS);
  assert.deepEqual(COLLECTIONS, ['lists', 'items', 'stores', 'categories', 'memory']);
});

test('整理 items：用户写的文字一个字不改，needs 和不认识的字段原样保留，字段补齐，可重复整理', () => {
  const needs = { 'recipe:r_1': { qty: 2, unit: '个', label: '番茄炒蛋' }, 'plan:2026-11-20': { qty: 1, unit: '', label: '周五' } };
  const s = normalizeState({ data: { items: { i_1: {
    listId: 'l_groceries', name: '  雞蛋  ', unit: '盒 ', note: '要 散养的\n别买错', qty: '12', price: '3.5', status: 'weird',
    needs, futureField: { keep: true }, updatedAt: '7',
  } } } });
  const it = s.data.items.i_1;
  assert.equal(it.name, '  雞蛋  ');
  assert.equal(it.unit, '盒 ');
  assert.equal(it.note, '要 散养的\n别买错');
  assert.deepEqual(it.needs, needs);
  assert.deepEqual(it.futureField, { keep: true });
  assert.deepEqual([it.qty, it.price, it.status, it.updatedAt, it.createdAt], [12, 3.5, 'need', 7, 7]);
  assert.deepEqual([it.categoryId, it.storeId, it.doneAt, it.url], [null, null, null, '']);
  assert.equal(canon(normalizeState(s)), canon(s));
});

test('整理 items：qty 没写当默认 1，写了 null 是「不写数量」要保留，乱写的 → null；needs 不是对象 → {}', () => {
  const s = normalizeState({ data: { items: { a: { name: 'a' }, b: { name: 'b', qty: null }, c: { name: 'c', qty: 'x' }, d: { name: 'd', needs: [1] } } } });
  assert.deepEqual(['a', 'b', 'c'].map(id => s.data.items[id].qty), [1, null, null]);
  assert.deepEqual(s.data.items.d.needs, {});
});

test('整理 lists / stores / categories / memory：补齐字段，预置标记和名字不改', () => {
  const s = normalizeState({ data: {
    lists: { l_x: { name: '木工 ', sys: 'future-sys', kind: 'project', archived: 'yes', defaultStoreId: '__proto__' }, l_groceries: { sys: 'groceries' } },
    stores: { s_x: { name: ' 本地 小店', order: '3' } },
    categories: { c_x: { name: '烘焙材料', kind: 'other' } },
    memory: { m_x: { name: '砂纸', kind: 'general', stores: { s_homedepot: { n: '3', at: 5, extra: 1 }, bad: 7, __proto__: { n: 1 } }, uses: -2 } },
  } });
  const l = s.data.lists.l_x;
  assert.deepEqual([l.name, l.sys, l.kind, l.archived, l.defaultStoreId, l.icon, l.order], ['木工 ', 'future-sys', 'general', false, null, '', 0]);
  assert.equal(s.data.lists.l_groceries.kind, 'grocery', '旧数据缺 kind：食材清单还是食材');
  assert.deepEqual([s.data.stores.s_x.name, s.data.stores.s_x.order, s.data.stores.s_x.archived], [' 本地 小店', 3, false]);
  assert.deepEqual([s.data.categories.c_x.kind, s.data.categories.c_x.sys], [null, null]);
  const m = s.data.memory.m_x;
  assert.deepEqual(m.stores, { s_homedepot: { n: 3, at: 5, extra: 1 } });
  assert.deepEqual([m.uses, m.lastAt, m.qty, m.unit, m.categoryId], [0, 0, null, '', null]);
  assert.equal(canon(normalizeState(s)), canon(s));
});

test('预置记录的 createdAt 0 改过以后还是 0（清单按 order、createdAt 排）；缺了才补成 updatedAt', () => {
  const s = normalizeState({ data: { lists: { l_groceries: { sys: 'groceries', createdAt: 0, updatedAt: 1731900000000, name: '吃的' }, l_x: { updatedAt: 9 } } } });
  assert.equal(s.data.lists.l_groceries.createdAt, 0);
  assert.equal(s.data.lists.l_x.createdAt, 9);
});

test('同步来的坏数据：__proto__ 不污染原型，不是对象的记录丢掉，危险的字段名去掉，不认识的集合保留并合并', () => {
  const evil = JSON.parse('{"data":{"__proto__":{"k":{"id":"k"}},"items":{"__proto__":{"x":1},"ok":{"name":"牛奶","__proto__":{"polluted":1},"needs":{"__proto__":{"p":1},"r_1":{"qty":1}}},"bad":"x","n":null,"arr":[1]},"future":{"x":{"v":1,"updatedAt":5}},"junk":3},"settings":{"__proto__":{"polluted":1},"future":true}}');
  const s = normalizeState(evil);
  assert.equal(({}).k, undefined);
  assert.equal(({}).polluted, undefined);
  assert.equal(({}).p, undefined);
  assert.deepEqual(Object.keys(s.data.items), ['ok']);
  assert.ok(!Object.prototype.hasOwnProperty.call(s.data.items.ok, '__proto__'));
  assert.deepEqual(Object.keys(s.data.items.ok.needs), ['r_1']);
  assert.equal(s.data.future.x.v, 1);
  assert.equal(s.data.junk, undefined);
  assert.equal(s.settings.future, true, '不认识的设置保留');
  const b = normalizeState({ data: { future: { x: { v: 2, updatedAt: 9 } } } });
  assert.equal(mergeStates(s, b).data.future.x.v, 2);
  assert.ok(!Object.prototype.hasOwnProperty.call(mergeStates(blankState(), s).data.items, 'constructor'));
});

test('集合名是 toString、hasOwnProperty 这种原型上就有的名字：不碰内置函数，集合照样保留、能合并、存得下', () => {
  const evil = JSON.parse('{"data":{"toString":{"call":{"v":1,"updatedAt":5}},"hasOwnProperty":{"x":{"v":2,"updatedAt":5}},"valueOf":{"name":{"v":3,"updatedAt":5}}}}');
  const s = normalizeState(evil);
  const m = mergeStates(s, normalizeState({ data: { hasOwnProperty: { x: { v: 9, updatedAt: 9 } } } }));
  mergeStates(blankState(), m);
  assert.equal(Object.prototype.toString.call([]), '[object Array]', 'Object.prototype.toString.call 还是原来的');
  assert.equal(Object.prototype.hasOwnProperty.x, undefined);
  assert.equal(Object.prototype.valueOf.name, 'valueOf');
  const back = JSON.parse(JSON.stringify(m));
  assert.deepEqual([back.data.toString.call.v, back.data.hasOwnProperty.x.v, back.data.valueOf.name.v], [1, 9, 3]);
});

test('normalizeRecord：不认识的集合只修 id 和 updatedAt，其余原样', () => {
  assert.deepEqual(normalizeRecord('recipes', { title: '番茄炒蛋', updatedAt: '3', x: [1] }, 'r_1'), { title: '番茄炒蛋', updatedAt: 3, x: [1], id: 'r_1' });
});

// ---------- 合并 ----------
test('合并：每条取较新的一份，两边顺序无关；时间相同内容不同每台设备结果一样；合并两次不变', () => {
  const a = blankState(), b = blankState();
  a.data.items.i1 = { id: 'i1', name: '旧', updatedAt: 100 };
  b.data.items.i1 = { id: 'i1', name: '新', updatedAt: 200 };
  a.data.items.i2 = { id: 'i2', name: '只在 a', updatedAt: 50 };
  a.data.stores.s1 = { id: 's1', name: '甲', updatedAt: 100 };
  b.data.stores.s1 = { id: 's1', name: '乙', updatedAt: 100 };
  const ab = mergeStates(a, b), ba = mergeStates(b, a);
  assert.equal(canon(ab), canon(ba));
  assert.equal(ab.data.items.i1.name, '新');
  assert.equal(ab.data.items.i2.name, '只在 a');
  assert.equal(canon(mergeStates(ab, b)), canon(ab), '再合并一次结果不变');
  assert.equal(canon(mergeStates(ab, ab)), canon(ab));
  assert.equal(pick(null, a.data.items.i1), a.data.items.i1);
});

test('合并：删除标记比旧的修改新 → 合并后仍是删除，不会复活', () => {
  const a = blankState(), b = blankState();
  a.data.items.i1 = { id: 'i1', name: '牛奶', updatedAt: 100 };
  b.data.items.i1 = { id: 'i1', name: '牛奶', deleted: true, deletedAt: 150, updatedAt: 150 };
  for (const m of [mergeStates(a, b), mergeStates(b, a)]) assert.equal(live(m, 'items').length, 0);
});

test('设置按键合并，各键看自己的修改时间；setSetting 盖新时间', () => {
  const a = blankState(), b = blankState();
  a.settings.x = 1; a.settingsAt.x = 300;
  b.settings.x = 2; b.settingsAt.x = 200;
  b.settings.y = 'b'; b.settingsAt.y = 250;
  const m = mergeStates(a, b);
  assert.deepEqual([m.settings.x, m.settings.y], [1, 'b']);
  const s = blankState();
  s.settingsAt.z = 5000;
  assert.equal(setSetting(s, 'z', true, 1000), true);
  assert.equal(s.settingsAt.z, 5001);
  assert.equal(setSetting(s, 'z', true, 9000), false, '值没变不算修改');
  assert.equal(setSetting(s, '__proto__', 1), false);
});

// ---------- 修改时间、软删除 ----------
test('stamp 总比上一版新；newId 带前缀且不重复', () => {
  assert.equal(stamp({ id: 'x' }, { id: 'x', updatedAt: 5000 }, 1000).updatedAt, 5001);
  assert.equal(stamp({ id: 'x' }, null, 1000).updatedAt, 1000);
  assert.equal(stamp({ id: 'x' }, { updatedAt: 0 }, 1000).updatedAt, 1000, '预置记录（updatedAt 0）一改就是现在的时间');
  let prev = { updatedAt: 0 };
  for (let i = 0; i < 5; i++) { const next = stamp({}, prev, 42); assert.ok(next.updatedAt > prev.updatedAt); prev = next; }   // 同一毫秒连改也递增
  assert.ok(newId('i_').startsWith('i_'));
  assert.notEqual(newId('i_'), newId('i_'));
});

test('软删除保留全部内容；恢复后同一个 id，比删除新，同步后不会被删除盖回去', () => {
  const original = normalizeRecord('items', { id: 'i1', listId: 'l_groceries', name: '牛奶', note: '全脂', needs: { r_1: { qty: 1 } }, updatedAt: 10 });
  const removed = deletedRecord(original, 20);
  assert.equal(removed.name, '牛奶');
  assert.deepEqual(removed.needs, original.needs);
  assert.deepEqual([removed.deleted, removed.deletedAt], [true, 20]);
  assert.equal(deletedRecord(removed, 30), null, '已经删除的不再删一次');
  const restored = restoredRecord(removed, 15);
  assert.equal(restored.id, 'i1');
  assert.equal(restored.deleted, undefined);
  assert.equal(restored.deletedAt, undefined);
  assert.ok(restored.updatedAt > removed.updatedAt);
  assert.equal(restoredRecord(original), null, '没删除的不能「恢复」');
  const a = blankState(), b = blankState();
  a.data.items.i1 = removed; b.data.items.i1 = restored;
  for (const m of [mergeStates(a, b), mergeStates(b, a)]) assert.equal(live(m, 'items').length, 1);
  assert.equal(normalizeRecord('items', { ...restored, deletedAt: 5 }).deletedAt, undefined, '没删除的不留 deletedAt');
});

// ---------- 预置数据 ----------
test('ensureSeeds：两张清单、八家商店、十四个分类，固定 id，createdAt / updatedAt 都是 0', () => {
  const s = seeded();
  assert.deepEqual(Object.keys(s.data.lists), ['l_groceries', 'l_tobuy']);
  assert.deepEqual(Object.keys(s.data.stores), SEED_STORES.map(([id]) => id));
  assert.deepEqual(Object.values(s.data.stores).map(x => x.name), ['Whole Foods', "Trader Joe's", 'Costco', 'Target', 'H Mart', '99 Ranch', 'Amazon', 'The Home Depot']);
  assert.equal(Object.keys(s.data.categories).length, 14);
  assert.deepEqual(Object.values(s.data.categories).map(c => c.sys), SYS_CATEGORIES);
  const g = s.data.lists.l_groceries, b = s.data.lists.l_tobuy;
  assert.deepEqual([g.sys, g.name, g.kind, g.defaultStoreId], ['groceries', '', 'grocery', 's_wholefoods']);
  assert.deepEqual([b.sys, b.name, b.kind, b.defaultStoreId], ['tobuy', '', 'general', null]);
  assert.equal(s.data.categories.c_produce.kind, 'grocery');
  assert.equal(s.data.categories.c_books.kind, 'general');
  for (const c of ['lists', 'stores', 'categories']) for (const r of Object.values(s.data[c])) assert.deepEqual([r.createdAt, r.updatedAt], [0, 0], r.id);
  assert.equal(Object.keys(s.data.items).length, 0);
  assert.equal(Object.keys(s.data.memory).length, 0);
  assert.equal(canon(s), canon(normalizeState(JSON.parse(JSON.stringify(s)))), '预置记录本身就是整理好的');
});

test('ensureSeeds：重复调用结果不变；返回同一个 state；seedRecords 每次是新对象', () => {
  const s = seeded(), before = canon(s);
  assert.equal(ensureSeeds(s), s);
  assert.equal(canon(ensureSeeds(ensureSeeds(s))), before);
  const one = seedRecords(); one.lists[0].name = '改了';
  assert.equal(seedRecords().lists[0].name, '');
});

test('ensureSeeds：已经有的不动——删掉的预置商店不复活，改过名的清单不被盖回去', () => {
  const s = seeded();
  s.data.stores.s_amazon = deletedRecord(s.data.stores.s_amazon, 1000);
  s.data.lists.l_tobuy = stamp({ ...s.data.lists.l_tobuy, name: '想要的', archived: true }, s.data.lists.l_tobuy, 2000);
  delete s.data.categories.c_books;                      // 真的没了（比如旧数据）才补
  ensureSeeds(s);
  assert.equal(s.data.stores.s_amazon.deleted, true);
  assert.deepEqual([s.data.lists.l_tobuy.name, s.data.lists.l_tobuy.archived], ['想要的', true]);
  assert.equal(s.data.categories.c_books.updatedAt, 0);
});

test('两台设备各自初始化：用户在一台上的修改（updatedAt > 0）合并后赢过另一台刚补的预置记录，删除也不会被补回来', () => {
  const phone = seeded();
  phone.data.lists.l_groceries = stamp({ ...phone.data.lists.l_groceries, name: '吃的', icon: '🍎' }, phone.data.lists.l_groceries, 1731900000000);
  phone.data.stores.s_target = deletedRecord(phone.data.stores.s_target, 1731900000001);
  const ipad = seeded();                                  // 晚些才第一次打开
  for (const m of [mergeStates(phone, ipad), mergeStates(ipad, phone)]) {
    ensureSeeds(m);
    assert.equal(m.data.lists.l_groceries.name, '吃的');
    assert.equal(m.data.stores.s_target.deleted, true);
    assert.equal(Object.keys(m.data.lists).length, 2, '不会有两份「食材」');
  }
  assert.equal(canon(ensureSeeds(mergeStates(phone, ipad))), canon(ensureSeeds(mergeStates(ipad, phone))));
});

// ---------- 名字和固定 id ----------
test('normName：NFKC、去首尾空格、连续空白合一、小写、繁体折成简体；不改原文', () => {
  assert.equal(normName('雞蛋'), normName('鸡蛋'));
  assert.equal(normName('麵粉'), '面粉');
  assert.equal(normName('  Oat   Milk '), 'oat milk');
  assert.equal(normName('ＯＡＴ　ＭＩＬＫ'), 'oat milk', '全角字母和全角空格');
  assert.equal(normName('Oat\t\nMilk'), 'oat milk');
  assert.equal(normName('１２ 個'), '12 个');
  assert.equal(normName(null), '');
  const name = ' 雞蛋 ';
  normName(name);
  assert.equal(name, ' 雞蛋 ');
});

test('hash64：FNV-1a 64 位 base36，结果确定，和参考实现一致，不同的输入结果不同', () => {
  assert.equal(hash64(''), BigInt('0xcbf29ce484222325').toString(36));       // FNV-1a 64 的公开测试值
  assert.equal(hash64('a'), BigInt('0xaf63dc4c8601ec8c').toString(36));
  assert.equal(hash64('foobar'), BigInt('0x85944171f73967e8').toString(36));
  for (const s of ['牛奶', 'l_groceries\n鸡蛋', '🥬🛍️', 'x'.repeat(1000), 'é', '\u0000']) assert.equal(hash64(s), fnvRef(s), s);
  assert.equal(hash64('牛奶'), hash64('牛奶'));
  const seen = new Set();
  for (let i = 0; i < 2000; i++) seen.add(hash64('l_groceries\n商品' + i));
  assert.equal(seen.size, 2000);
  assert.match(hash64('牛奶'), /^[0-9a-z]{1,13}$/);
});

test('itemId：同一张清单同名（简繁、大小写、空格不同）是同一个 id；不同清单不同', () => {
  const s = seeded();
  const id = itemId(s, 'l_groceries', '雞蛋');
  assert.equal(id, 'i_' + hash64('l_groceries\n鸡蛋'));
  assert.equal(itemId(s, 'l_groceries', ' 鸡蛋 '), id);
  assert.equal(itemId(s, 'l_groceries', 'Oat Milk'), itemId(s, 'l_groceries', 'oat  milk'));
  assert.notEqual(itemId(s, 'l_tobuy', '鸡蛋'), id);
  s.data.items[id] = normalizeRecord('items', { id, listId: 'l_groceries', name: '鸡蛋', deleted: true, updatedAt: 5 });
  assert.equal(itemId(s, 'l_groceries', '雞蛋'), id, '已经清掉的那条也算：再加就恢复同一条');
});

test('itemId：固定 id 被改过名（或移到别的清单）的记录占了 → 先找同名的那条，没有才用随机 id', () => {
  const s = seeded();
  const id = itemId(s, 'l_groceries', '牛奶');
  s.data.items[id] = normalizeRecord('items', { id, listId: 'l_groceries', name: '燕麦奶', updatedAt: 5 });   // 原来叫牛奶，改了名
  const fresh = itemId(s, 'l_groceries', '牛奶');
  assert.notEqual(fresh, id);
  assert.match(fresh, /^i_/);
  s.data.items[fresh] = normalizeRecord('items', { id: fresh, listId: 'l_groceries', name: '牛奶', updatedAt: 6 });
  assert.equal(itemId(s, 'l_groceries', '牛奶'), fresh, '之前分到随机 id 的那条牛奶，再加还是它');
  const moved = itemId(s, 'l_tobuy', '剪刀');
  s.data.items[moved] = normalizeRecord('items', { id: moved, listId: 'l_groceries', name: '剪刀', updatedAt: 7 });   // 移到了食材清单
  const again = itemId(s, 'l_tobuy', '剪刀');
  assert.notEqual(again, moved);
  assert.match(again, /^i_/);
});

test('itemId：清单里已经有同名的（改名改成的、从别的清单移来的）→ 就是它，即使固定 id 那一格空着', () => {
  const s = seeded();
  const oat = 'i_' + hash64('l_groceries\n燕麦奶');
  s.data.items[oat] = normalizeRecord('items', { id: oat, listId: 'l_groceries', name: '牛奶', updatedAt: 5 });        // 原来叫燕麦奶，改成了牛奶
  assert.equal(itemId(s, 'l_groceries', '牛奶'), oat, '不能再多出一条牛奶');
  const scissors = 'i_' + hash64('l_tobuy\n剪刀');
  s.data.items[scissors] = normalizeRecord('items', { id: scissors, listId: 'l_groceries', name: '剪刀', updatedAt: 6 }); // 从想买移到食材
  assert.equal(itemId(s, 'l_groceries', '剪刀'), scissors);
  assert.equal(itemId(s, 'l_tobuy', '剪刀') === scissors, false, '原来那张清单里已经没有它了');
});

test('itemId：同名的有几条时没删除的优先，再固定 id 优先，再按 id 排', () => {
  const s = seeded();
  const fixed = 'i_' + hash64('l_groceries\n牛奶');
  const put = (id, extra = {}) => { s.data.items[id] = normalizeRecord('items', { id, listId: 'l_groceries', name: '牛奶', updatedAt: 5, ...extra }); };
  put(fixed, { deleted: true });                        // 固定 id 那条清掉了
  put('i_zzz');                                         // 另一条还在（移进来的、以前分到随机 id 的）
  assert.equal(itemId(s, 'l_groceries', '牛奶'), 'i_zzz', '恢复删掉的那条，清单上就有两条牛奶了');
  put('i_aaa');
  assert.equal(itemId(s, 'l_groceries', '牛奶'), 'i_aaa', '都没删除：按 id 排，每台设备选的一样');
  put(fixed);
  assert.equal(itemId(s, 'l_groceries', '牛奶'), fixed, '都没删除：固定 id 优先');
  for (const id of [fixed, 'i_aaa', 'i_zzz']) put(id, { deleted: true });
  assert.equal(itemId(s, 'l_groceries', '牛奶'), fixed, '都删了：固定 id 优先');
  delete s.data.items[fixed];
  assert.equal(itemId(s, 'l_groceries', '牛奶'), 'i_aaa', '都删了、没有固定 id 那条：按 id 排');
});

test('itemId：少传 state（以前的写法 itemId(listId, name)）直接报错，不悄悄算出一个错的 id', () => {
  assert.throws(() => itemId('l_groceries', '牛奶'), TypeError);
  assert.throws(() => itemId(null, 'l_groceries', '牛奶'), TypeError);
});

// ---------- 显示和排序 ----------
test('显示名：用户写的名字 → 预置的文案 → 未命名；图标：选的 emoji → 按 kind 的默认图标', () => {
  const s = seeded();
  assert.equal(listName(s.data.lists.l_groceries, T), '«list.sys.groceries»');
  assert.equal(listName(s.data.lists.l_tobuy, T), '«list.sys.tobuy»');
  assert.equal(listName({ ...s.data.lists.l_groceries, name: '  吃的 ' }, T), '吃的');
  assert.equal(listName({ ...s.data.lists.l_groceries, name: '   ' }, T), '«list.sys.groceries»');
  assert.equal(listName({ sys: null, name: '' }, T), '«list.untitled»');
  assert.equal(listName({ sys: 'future-sys', name: '' }, T), '«list.untitled»');
  assert.equal(categoryName(s.data.categories.c_dairy, T), '«cat.sys.dairy»');
  assert.equal(categoryName({ ...s.data.categories.c_dairy, name: '奶制品' }, T), '奶制品');
  assert.equal(categoryName({ sys: null, name: '' }, T), '«cat.untitled»');
  assert.equal(listIcon(s.data.lists.l_groceries), DEFAULT_LIST_ICON.grocery);
  assert.equal(listIcon(s.data.lists.l_tobuy), DEFAULT_LIST_ICON.general);
  assert.equal(listIcon({ ...s.data.lists.l_tobuy, icon: '🪵' }), '🪵');
});

test('首页清单：没删除、没归档，按 order、createdAt、id 排；还要买几样只数 need 且没删除的', () => {
  const s = seeded();
  s.data.lists.l_wood = normalizeRecord('lists', { id: 'l_wood', name: '木工', order: 1, createdAt: 5, updatedAt: 5 });
  s.data.lists.l_old = normalizeRecord('lists', { id: 'l_old', name: '旧的', order: 0, archived: true, updatedAt: 5 });
  s.data.lists.l_gone = normalizeRecord('lists', { id: 'l_gone', name: '删了', order: 0, deleted: true, updatedAt: 5 });
  assert.deepEqual(homeLists(s).map(l => l.id), ['l_groceries', 'l_tobuy', 'l_wood']);
  const add = (id, listId, status, extra = {}) => { s.data.items[id] = normalizeRecord('items', { id, listId, name: id, status, updatedAt: 1, ...extra }); };
  add('a', 'l_groceries', 'need'); add('b', 'l_groceries', 'need'); add('c', 'l_groceries', 'done');
  add('d', 'l_groceries', 'need', { deleted: true }); add('e', 'l_tobuy', 'later'); add('f', 'l_wood', 'need');
  const n = needCounts(s);
  assert.deepEqual([n.get('l_groceries'), n.get('l_tobuy'), n.get('l_wood')], [2, undefined, 1]);
  assert.equal(byOrder({ order: 0, createdAt: 0, id: 'b' }, { order: 0, createdAt: 0, id: 'a' }) > 0, true);
});
