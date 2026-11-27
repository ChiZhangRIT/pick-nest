import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeStates, normalizeState, canon, ensureSeeds, blankState } from '../src/core/store.js';
import { rememberFood, foodId } from '../src/core/foods.js';
import { findFood } from '../src/core/nutrition.js';
import { saveIngredientFood, clearIngredientFood, estimateRecipe } from '../src/core/estimate.js';

// 合并规则的整体性质（见 docs/DATA_MODEL.md「合并」）：items、memory、foods 各自从头建的同一条要补字段，这让合并不满足结合律，
// 所以这里不查结合律，查真正要紧的：顺序无关、重复合并不变，以及三台设备经过同一个仓库轮流同步时会收敛、不来回上传、不丢补过来的字段。
// 随机数据用固定种子（每次跑一样），只用编出来的内容。

// mulberry32（32 位整数运算）。以前用的 (s * 1103515245 + 12345) % 2^31 在浮点数里乘出来超过 2^53、丢了精度，一万来个数就转回原处，
// 几百组里来来回回是同样的几种数据，有的情况一次也碰不到（各自从头建的、买过以后才写的那种就没碰到过）
function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function maker(rnd) {
  const pickOf = a => a[Math.floor(rnd() * a.length)];
  const item = created => ({
    id: 'i_x', listId: 'l_groceries', name: '牛奶', qty: pickOf([1, 2, null]), unit: pickOf(['', '盒']),
    note: pickOf(['', '要低脂', '大瓶的']), url: pickOf(['', 'https://example.com/a']), price: pickOf([null, 3.5]),
    categoryId: pickOf([null, 'c_dairy']), storeId: pickOf([null, 's_costco', 's_target']), status: pickOf(['need', 'done']),
    doneAt: null, needs: {}, createdAt: created, updatedAt: created + Math.floor(rnd() * 5000),
  });
  const mem = created => ({
    id: 'm_x', name: '牛奶', kind: 'grocery', categoryId: pickOf([null, 'c_dairy']), unit: pickOf(['', '盒']), qty: null,
    stores: Object.fromEntries(pickOf([[], [['s_costco', { n: 2, at: 1500 }]], [['s_target', { n: 1, at: 2500 }]]])),
    uses: Math.floor(rnd() * 5), lastAt: Math.floor(rnd() * 5000), createdAt: created, updatedAt: created + Math.floor(rnd() * 5000),
  });
  return (created = pickOf([1000, 2000, 3000])) =>
    ensureSeeds(normalizeState({ app: 'picknest', v: 1, data: { items: { i_x: item(created) }, memory: { m_x: mem(created) } } }));
}
const merged = (a, b) => ensureSeeds(normalizeState(mergeStates(a, b)));

test('合并：顺序无关、重复合并结果不变（随机数据）', () => {
  const make = maker(prng(7));
  for (let k = 0; k < 500; k++) {
    const a = make(), b = make();
    const ab = merged(a, b);
    assert.equal(canon(ab), canon(merged(b, a)), `第 ${k} 组：merge(a,b) ≠ merge(b,a)`);
    assert.equal(canon(merged(ab, a)), canon(ab), `第 ${k} 组：再合并 a 变了`);
    assert.equal(canon(merged(ab, b)), canon(ab), `第 ${k} 组：再合并 b 变了`);
    assert.equal(canon(merged(ab, ab)), canon(ab), `第 ${k} 组：和自己合并变了`);
  }
});

test('三台设备经过同一个仓库轮流同步：会收敛、上传次数有限、各自建的那几份上的备注不丢', () => {
  const rnd = prng(11), make = maker(rnd);
  for (let k = 0; k < 400; k++) {
    const created = [1000, 2000, 3000];
    // 一半的组三份都是各自从头建的（createdAt 都不一样），另一半随机（有的是同一条的不同版本）
    const independent = k % 2 === 0;
    const devs = [0, 1, 2].map(i => make(independent ? created[i] : undefined));
    const notes = devs.map(d => d.data.items.i_x.note).filter(Boolean);
    let remote = null, pushes = 0, quiet = 0, rounds = 0, last = 0;
    // 同步一轮 = 拉取、合并、和云端不一样就上传。随机挑设备，直到三台轮着来都没有变化
    while (quiet < 3 && rounds < 300) {
      rounds++;
      const i = quiet > 0 ? (last + 1) % 3 : Math.floor(rnd() * 3);
      last = i;
      const m = remote ? merged(devs[i], remote) : devs[i];
      devs[i] = m;
      if (!remote || canon(m) !== canon(remote)) { remote = m; pushes++; quiet = 0; } else quiet++;
    }
    assert.ok(rounds < 300, `第 ${k} 组没有收敛`);
    assert.ok(pushes <= 6, `第 ${k} 组上传了 ${pushes} 次`);
    for (const d of devs) assert.equal(canon(d), canon(remote), `第 ${k} 组：设备和云端不一样`);
    if (independent && notes.length) assert.ok(remote.data.items.i_x.note, `第 ${k} 组：各自建的备注丢了`);
  }
});

// ---------- items 的状态、各道菜的那几份、买过的（第 10 步以后的字段）----------
// 一台勾成已买、另一台不知道又改了（boughtMeanwhile）这条规则，各自从头建的两条（createdAt 不一样）和同一条要定得一样：
// 第一次合并后 createdAt 取了早的，再和原来那两份合并时走的是同一条的路，定得不一样就会改判（重复合并结果会变）。
// 这里的数据照实际的样子编：状态改过才有 statusAt（在 createdAt 和 updatedAt 之间，已买的 doneAt 就是那一刻），约 15% 是旧版改的、没有 statusAt；
// needs 有计划的（p:）和食谱页加的（a:）来源，boughtFor 记着以前买过的几道菜；有删除的、不写数量的
const SOURCES = ['p:mon', 'p:tue', 'p:tue#2', 'p:fri', 'a:k1', 'a:k2'];
function itemMaker(rnd) {
  const pickOf = a => a[Math.floor(rnd() * a.length)];
  const needs = () => Object.fromEntries(SOURCES.filter(() => rnd() < 0.3)
    .map(k => [k, { qty: pickOf([1, 2, 200, null]), unit: pickOf(['个', 'g']), label: pickOf(['红烧肉', '咖喱']), recipeId: null }]));
  /** 在 from 之后写的一个版本：status 改了才盖 statusAt（from 和 updatedAt 之间） */
  const version = (r, from) => {
    r.updatedAt = from + 100 * (1 + Math.floor(rnd() * 30));   // 整百：各自从头建的两条常常一样新（按内容排的那条路也要走到）
    const status = pickOf(['need', 'need', 'done', 'done', 'later']);
    if (status !== r.status || rnd() < 0.2) {
      const at = from + 1 + Math.floor(rnd() * (r.updatedAt - from));
      if (rnd() < 0.85) r.statusAt = at; else delete r.statusAt;      // 旧版改的状态：没有 statusAt
      r.doneAt = status === 'done' ? at : null;
    }
    r.status = status;
    if (status !== 'done') r.doneAt = null;
    if (rnd() < 0.5) r.needs = needs();
    if (rnd() < 0.4) r.qty = pickOf([1, 2, null]);
    if (rnd() < 0.3) r.unit = pickOf(['', '个', 'g']);
    if (rnd() < 0.3) r.note = pickOf(['', '红的', '要小的']);
    if (rnd() < 0.3) r.boughtFor = Object.fromEntries(pickOf([[['p:mon', from]], [['p:tue', from]], [['p:mon', from], ['a:k1', from]]]));
    if (rnd() < 0.15) Object.assign(r, { deleted: true, deletedAt: r.updatedAt }); else { delete r.deleted; delete r.deletedAt; }
    return r;
  };
  /** 从头建的一条（新建时是要买 / 以后再说，没有 statusAt），之后可能改过几次 */
  const fresh = created => {
    const r = { id: 'i_x', listId: 'l_groceries', name: '洋葱', qty: pickOf([1, 2, null]), unit: pickOf(['', '个']), note: pickOf(['', '红的']),
      url: '', price: null, categoryId: null, storeId: pickOf([null, 's_hmart']), status: pickOf(['need', 'need', 'later']), doneAt: null,
      needs: needs(), createdAt: created, updatedAt: created };
    return rnd() < 0.25 ? r : version(r, created);
  };
  const wrap = r => ensureSeeds(normalizeState({ app: 'picknest', v: 1, data: { items: { i_x: r } } }));
  return {
    fresh: (created = pickOf([1000, 2000, 3000])) => wrap(fresh(created)),
    /** 同一条记录（同步过的一份）在一台设备上接着改 */
    edit: s => wrap(version(structuredClone(s.data.items.i_x), s.data.items.i_x.updatedAt)),
  };
}

test('合并 items（状态、needs、boughtFor、statusAt）：顺序无关、重复合并结果不变——各自从头建的、同一条的两个版本都是', () => {
  const rnd = prng(29), m = itemMaker(rnd);
  for (let k = 0; k < 900; k++) {
    let a, b;
    if (k % 3 === 0) [a, b] = [m.fresh(1000 + Math.floor(rnd() * 3) * 1000), m.fresh(4000)];   // 各自从头建的
    else if (k % 3 === 1) { const base = m.fresh(); [a, b] = [m.edit(base), m.edit(base)]; } // 同一条，两台设备各自改
    else [a, b] = [m.fresh(), m.fresh()];                                                     // 随便两份（createdAt 可能碰巧一样）
    const ab = merged(a, b);
    assert.equal(canon(ab), canon(merged(b, a)), `第 ${k} 组：merge(a,b) ≠ merge(b,a)`);
    assert.equal(canon(merged(ab, a)), canon(ab), `第 ${k} 组：再合并 a 变了`);
    assert.equal(canon(merged(ab, b)), canon(ab), `第 ${k} 组：再合并 b 变了`);
    assert.equal(canon(merged(ab, ab)), canon(ab), `第 ${k} 组：和自己合并变了`);
  }
});

test('合并 items（状态、needs、boughtFor、statusAt）：三台设备经过同一个仓库轮流同步会收敛，最多上传 6 次', () => {
  const rnd = prng(31), m = itemMaker(rnd);
  for (let k = 0; k < 450; k++) {
    let devs;
    if (k % 3 === 0) devs = [1000, 2000, 3000].map(c => m.fresh(c));                     // 三台各自从头建的
    else if (k % 3 === 1) { const base = m.fresh(); devs = [m.edit(base), m.edit(base), m.edit(base)]; }   // 同一条，各自改
    else { const base = m.fresh(1000); devs = [m.edit(base), m.edit(base), m.fresh(2000 + Math.floor(rnd() * 2) * 1000)]; } // 两台同一条、一台从头建的
    let remote = null, pushes = 0, quiet = 0, rounds = 0, last = 0;
    while (quiet < 3 && rounds < 300) {
      rounds++;
      const i = quiet > 0 ? (last + 1) % 3 : Math.floor(rnd() * 3);
      last = i;
      const next = remote ? merged(devs[i], remote) : devs[i];
      devs[i] = next;
      if (!remote || canon(next) !== canon(remote)) { remote = next; pushes++; quiet = 0; } else quiet++;
    }
    assert.ok(rounds < 300, `第 ${k} 组没有收敛`);
    assert.ok(pushes <= 6, `第 ${k} 组上传了 ${pushes} 次`);
    for (const d of devs) assert.equal(canon(d), canon(remote), `第 ${k} 组：设备和云端不一样`);
  }
});

test('各自从头建的两条和同一条一样定：一台买过以后另一台（新设备）才快速添加——购买算数、自己写的数量留着；合并出来的再和哪一份合并都不变', () => {
  const L = 'l_groceries', base = { id: 'i_x', listId: L, name: '洋葱', unit: '个', note: '', url: '', price: null, categoryId: null, storeId: null };
  const st = r => ensureSeeds(normalizeState({ app: 'picknest', v: 1, data: { items: { i_x: { ...base, ...r } } } }));
  // B：周一、汤要的洋葱，4106 勾成已买、7933 又改过别的；A：新设备 2000 建的，5787（买过以后、没见过）快速添加「洋葱 1」
  const B = st({ status: 'done', qty: null, needs: { 'p:a': { qty: 2, unit: '个', label: '红烧肉' }, 'a:x': { qty: 1, unit: '个', label: '汤' } },
    createdAt: 3000, updatedAt: 7933, statusAt: 4106, doneAt: 4106 });
  const A = st({ status: 'need', qty: 1, needs: {}, createdAt: 2000, updatedAt: 5787 });
  const ab = merged(A, B), it = ab.data.items.i_x;
  assert.deepEqual([it.status, it.qty, it.needs, it.createdAt, it.statusAt], ['need', 1, {}, 2000, 4106], '新的一轮：只剩自己写的 1 个');
  assert.deepEqual(it.boughtFor, { 'p:a': 4106, 'a:x': 4106 }, '买过的几份记着（计划只看 p:）');
  for (const x of [A, B, ab]) assert.equal(canon(merged(ab, x)), canon(ab));
  // 买过的那一份是 createdAt 早的：合并出来的和还没买那份的 createdAt 还是不一样，再合并也不能把买过的几份补回来
  const D = st({ status: 'done', qty: null, needs: { 'p:a': { qty: 2, unit: '个' }, 'a:x': { qty: 1, unit: '个' } }, createdAt: 1000, updatedAt: 4200, statusAt: 4100, doneAt: 4100 });
  const P = st({ status: 'need', qty: null, needs: { 'p:a': { qty: 2, unit: '个' }, 'a:x': { qty: 1, unit: '个' }, 'p:b': { qty: 1, unit: '个' } }, createdAt: 2000, updatedAt: 5000 });
  const dp = merged(D, P);
  assert.deepEqual([dp.data.items.i_x.status, Object.keys(dp.data.items.i_x.needs)], ['need', ['p:b']], '只剩周二新加的');
  for (const x of [D, P]) assert.equal(canon(merged(dp, x)), canon(dp));
  // 没有多出来的（还没买那份没写自己的数量、菜都买过了）→ 已买
  const Q = st({ status: 'need', qty: null, needs: { 'p:a': { qty: 2, unit: '个' } }, createdAt: 2000, updatedAt: 5000 });
  const dq = merged(D, Q);
  assert.deepEqual([dq.data.items.i_x.status, dq.data.items.i_x.doneAt], ['done', 4100]);
  for (const x of [D, Q]) assert.equal(canon(merged(dq, x)), canon(dq));
  // 两条一样新、没补到东西，只是 createdAt 换成了早的：结果也要晚 1 毫秒，不然再和另一条合并时（createdAt 一样了）按内容排可能取了另一条
  const E = st({ status: 'need', qty: null, needs: {}, note: '红的', createdAt: 3000, updatedAt: 3300, statusAt: 3081, deleted: true, deletedAt: 3300 });
  const F = st({ status: 'later', qty: 1, needs: { 'p:a': { qty: 2, unit: '个' } }, note: '红的', createdAt: 1000, updatedAt: 3300, statusAt: 1205 });
  const ef = merged(E, F);
  assert.deepEqual([ef.data.items.i_x.createdAt, ef.data.items.i_x.updatedAt], [1000, 3301]);
  for (const x of [E, F]) assert.equal(canon(merged(ef, x)), canon(ef));
});

test('买过的按来源、按谁知道的那次购买晚来认：同一道菜不算两遍，买过的不会经过中间的一次合并、或者从更早的一轮回到清单上', () => {
  const L = 'l_groceries', base = { id: 'i_x', listId: L, name: '洋葱', unit: '', note: '', url: '', price: null, categoryId: null, storeId: null };
  const st = r => ensureSeeds(normalizeState({ app: 'picknest', v: 1, data: { items: { i_x: { ...base, ...r } } } }));
  const it = s => s.data.items.i_x;
  const stable = (m, ...xs) => { for (const x of [...xs, m]) assert.equal(canon(merged(m, x)), canon(m)); };
  // 两台设备各自生成了周一的红烧肉：一台是「1 个 + 200 g」（'p:a'、'p:a#2'），另一台改过食谱、后生成的只有「300 g」。
  // 同一个来源只用较新那条的：按键一个一个取会合成「300 g + 200 g」
  const A = st({ status: 'need', qty: null, needs: { 'p:a': { qty: 1, unit: '个', label: '红烧肉' }, 'p:a#2': { qty: 200, unit: 'g', label: '红烧肉' } }, createdAt: 1000, updatedAt: 2000 });
  const B = st({ status: 'need', qty: null, needs: { 'p:a': { qty: 300, unit: 'g', label: '红烧肉' } }, createdAt: 1500, updatedAt: 3000 });
  const ab = merged(A, B);
  assert.deepEqual(it(ab).needs, { 'p:a': { qty: 300, unit: 'g', label: '红烧肉' } });
  stable(ab, A, B);
  // D 4200 买了周二、周五的（'p:b'、'p:z'）；P1、P2 是两台新设备各自建的，都是买过以后才写的（没见过）：P1 加了周一的、P2 加了周一和周五的。
  // P2 上周五那份就是买过的那份：直接和 D 合并会拿掉，先和 P1 合并出来的（记着周五买过）再和 P2 合并也要拿掉——三台怎么先后同步都一样
  const D = st({ status: 'done', qty: null, needs: { 'p:b': { qty: 2, unit: '个' }, 'p:z': { qty: 3, unit: '个' } }, createdAt: 1000, updatedAt: 5200, statusAt: 4200, doneAt: 4200 });
  const P1 = st({ status: 'need', qty: 1, needs: { 'p:a': { qty: 1, unit: '个' } }, createdAt: 1500, updatedAt: 8700 });
  const P2 = st({ status: 'need', qty: 2, needs: { 'p:a': { qty: 1, unit: '个' }, 'p:z': { qty: 3, unit: '个' } }, createdAt: 2000, updatedAt: 10000 });
  for (const [x, y, z] of [[D, P1, P2], [D, P2, P1], [P1, P2, D]]) {
    const m = merged(merged(x, y), z);
    assert.deepEqual([it(m).status, Object.keys(it(m).needs)], ['need', ['p:a']], '周五的买过了，只剩周一的');
  }
  // 同一条：P 在周五那份第一轮买（1300）之前就分开了，D 后来又加回来（boughtFor 记着 1300）、4000 买了周二的。
  // P 5000 加了周三的：周五那份 P 没见过那次购买，是买过的；只留周三的
  const D2 = st({ status: 'done', qty: null, needs: { 'p:b': { qty: 2, unit: '个' } }, boughtFor: { 'p:z': 1300 }, createdAt: 1000, updatedAt: 4100, statusAt: 4000, doneAt: 4000 });
  const Pz = st({ status: 'need', qty: null, needs: { 'p:z': { qty: 3, unit: '个' }, 'p:c': { qty: 1, unit: '个' } }, createdAt: 1000, updatedAt: 5000, statusAt: 1000 });
  const dp = merged(D2, Pz);
  assert.deepEqual([it(dp).status, Object.keys(it(dp).needs)], ['need', ['p:c']]);
  stable(dp, D2, Pz);
  // P 自己也记着那次购买（1300）：周五那份是买过以后又自己加的，留着
  const Pk = st({ status: 'need', qty: null, needs: { 'p:z': { qty: 3, unit: '个' } }, boughtFor: { 'p:z': 1300 }, createdAt: 1000, updatedAt: 5000, statusAt: 2000 });
  const dk = merged(D2, Pk);
  assert.deepEqual([it(dk).status, Object.keys(it(dk).needs)], ['need', ['p:z']]);
  stable(dk, D2, Pk);
});

// ---------- foods（第三版：常吃的，按名字算 id，和 memory 一样各自从头建的补字段）----------
// 照实际的样子编：每份的营养有的填了有的没填，偶尔是食材的营养（每 100 g，和每份的不互相补），单位重量、次数、最近一次
function foodMaker(rnd) {
  const pickOf = a => a[Math.floor(rnd() * a.length)];
  const per = () => Object.fromEntries(['kcal', 'protein', 'carbs', 'fat'].map(k => [k, pickOf([null, null, 5, 190, 7.5])]));
  return (created = pickOf([1000, 2000, 3000])) => ensureSeeds(normalizeState({ app: 'picknest', v: 1, data: { foods: { f_x: {
    id: 'f_x', name: pickOf(['拿铁', '拿鐵']), kind: rnd() < 0.15 ? 'ingredient' : 'food', per: per(),
    grams: Object.fromEntries(pickOf([[], [['杯', 350]], [['杯', 400], ['小杯', 240]]])), ref: pickOf([null, null, 'usda:1']),
    uses: Math.floor(rnd() * 5), lastAt: Math.floor(rnd() * 5000), createdAt: created, updatedAt: created + 100 * Math.floor(rnd() * 30),
    ...(rnd() < 0.1 ? { deleted: true, deletedAt: created + 50 } : {}),
  } } } }));
}

test('合并 foods：顺序无关、重复合并结果不变（随机数据）', () => {
  const make = foodMaker(prng(41));
  for (let k = 0; k < 500; k++) {
    const a = make(), b = make();
    const ab = merged(a, b);
    assert.equal(canon(ab), canon(merged(b, a)), `第 ${k} 组：merge(a,b) ≠ merge(b,a)`);
    assert.equal(canon(merged(ab, a)), canon(ab), `第 ${k} 组：再合并 a 变了`);
    assert.equal(canon(merged(ab, b)), canon(ab), `第 ${k} 组：再合并 b 变了`);
    assert.equal(canon(merged(ab, ab)), canon(ab), `第 ${k} 组：和自己合并变了`);
  }
});

test('合并 foods：三台设备经过同一个仓库轮流同步会收敛，最多上传 6 次，填过的营养不丢', () => {
  const rnd = prng(43), make = foodMaker(rnd);
  for (let k = 0; k < 400; k++) {
    const devs = (k % 2 === 0 ? [1000, 2000, 3000] : [undefined, undefined, undefined]).map(c => make(c));
    const kinds = new Set(devs.map(d => d.data.foods.f_x.kind));
    // 删掉的（食材「用回自动认的」）不往别的上面补，删掉以后的那几样从头来：只查都没删过的
    const kcalSomewhere = devs.some(d => d.data.foods.f_x.per.kcal != null) && !devs.some(d => d.data.foods.f_x.deleted);
    let remote = null, pushes = 0, quiet = 0, rounds = 0, last = 0;
    while (quiet < 3 && rounds < 300) {
      rounds++;
      const i = quiet > 0 ? (last + 1) % 3 : Math.floor(rnd() * 3);
      last = i;
      const next = remote ? merged(devs[i], remote) : devs[i];
      devs[i] = next;
      if (!remote || canon(next) !== canon(remote)) { remote = next; pushes++; quiet = 0; } else quiet++;
    }
    assert.ok(rounds < 300, `第 ${k} 组没有收敛`);
    assert.ok(pushes <= 6, `第 ${k} 组上传了 ${pushes} 次`);
    for (const d of devs) assert.equal(canon(d), canon(remote), `第 ${k} 组：设备和云端不一样`);
    if (k % 2 === 0 && kinds.size === 1 && kcalSomewhere) assert.ok(remote.data.foods.f_x.per.kcal != null, `第 ${k} 组：各自记的热量丢了`);
  }
});

// ---------- foods 里食材的说法（第 15 步：按名字算 id，「指定成…」「自己填」「用回自动认的」）----------
// 照实际的操作编：每台设备上先可能记过同名的常吃的（每份），再随机做几次指定成表里的、自己填每 100 g、自己填一个多重、用回自动认的
// （存不了的——表里没有、也没填营养——什么也不改）。合并以后每台设备上的估算一样
function ingredientMaker(rnd) {
  const pickOf = a => a[Math.floor(rnd() * a.length)];
  const tofu = [findFood('豆腐').id, findFood('嫩豆腐').id];
  return (created = pickOf([1000, 2000, 3000])) => {
    const s = ensureSeeds(blankState());
    let at = created;
    if (rnd() < 0.2) rememberFood(s, '鱼豆腐', { kcal: 150 }, { use: true }, at);
    for (let i = 0, n = 1 + Math.floor(rnd() * 3); i < n; i++) {
      at += 100 * (1 + Math.floor(rnd() * 20));
      const op = rnd();
      if (op < 0.3) saveIngredientFood(s, pickOf(['鱼豆腐', '魚豆腐（切块）']), { ref: pickOf(tofu) }, at);
      else if (op < 0.6) saveIngredientFood(s, '鱼豆腐', { per: { kcal: pickOf(['', '200', '210']), protein: pickOf(['', '12']), carbs: '', fat: pickOf(['', '10']) } }, at);
      else if (op < 0.85) saveIngredientFood(s, '鱼豆腐', { grams: pickOf(['15', '20', '']), unit: pickOf(['个', '块']) }, at);
      else clearIngredientFood(s, '鱼豆腐', at);
    }
    return ensureSeeds(normalizeState(s));
  };
}
const RECIPE = { servings: 2, ings: [{ key: 'a', name: '鱼豆腐', qty: 200, unit: 'g' }, { key: 'b', name: '鱼豆腐', qty: 6, unit: '个' }, { key: 'c', name: '五花肉', qty: 300, unit: 'g' }] };

test('合并 foods 里食材的说法：顺序无关、重复合并结果不变（随机操作）', () => {
  const make = ingredientMaker(prng(47));
  for (let k = 0; k < 500; k++) {
    const a = make(), b = make();
    const ab = merged(a, b);
    assert.equal(canon(ab), canon(merged(b, a)), `第 ${k} 组：merge(a,b) ≠ merge(b,a)`);
    assert.equal(canon(merged(ab, a)), canon(ab), `第 ${k} 组：再合并 a 变了`);
    assert.equal(canon(merged(ab, b)), canon(ab), `第 ${k} 组：再合并 b 变了`);
  }
});

test('合并 foods 里食材的说法：三台设备轮流同步会收敛，最多上传 6 次，每台设备的估算一样', () => {
  const rnd = prng(53), make = ingredientMaker(rnd);
  for (let k = 0; k < 300; k++) {
    const devs = (k % 2 === 0 ? [1000, 2000, 3000] : [undefined, undefined, undefined]).map(c => make(c));
    let remote = null, pushes = 0, quiet = 0, rounds = 0, last = 0;
    while (quiet < 3 && rounds < 300) {
      rounds++;
      const i = quiet > 0 ? (last + 1) % 3 : Math.floor(rnd() * 3);
      last = i;
      const next = remote ? merged(devs[i], remote) : devs[i];
      devs[i] = next;
      if (!remote || canon(next) !== canon(remote)) { remote = next; pushes++; quiet = 0; } else quiet++;
    }
    assert.ok(rounds < 300 && pushes <= 6, `第 ${k} 组：没有收敛或上传了 ${pushes} 次`);
    const want = canon(estimateRecipe(remote, RECIPE).perServing);
    for (const d of devs) assert.equal(canon(estimateRecipe(d, RECIPE).perServing), want, `第 ${k} 组：估算不一样`);
  }
});

test('合并 foods 里食材的说法：各自从头建的，较新的是「指定成…」时不补另一条自己填的每 100 g；较新的是自己填的，空着的 ref 照补', () => {
  const dev = (fn) => { const s = ensureSeeds(blankState()); fn(s); return s; };
  const tofu = findFood('豆腐').id;
  const own = dev(s => saveIngredientFood(s, '鱼豆腐', { per: { kcal: '200', protein: '12' } }, 1000));
  const pick = dev(s => saveIngredientFood(s, '鱼豆腐', { ref: tofu, grams: '20', unit: '个' }, 2000));
  const m = merged(own, pick), f = m.data.foods[foodId('鱼豆腐')];
  assert.deepEqual([f.ref, f.per.kcal, f.grams.个, f.createdAt], [String(tofu), null, 20, 1000]);
  assert.equal(line0(m), 'manual', '后来的「指定成」算数');
  const own2 = dev(s => saveIngredientFood(s, '鱼豆腐', { per: { kcal: '200' } }, 3000));
  const m2 = merged(own2, pick), f2 = m2.data.foods[foodId('鱼豆腐')];
  assert.deepEqual([f2.ref, f2.per.kcal, f2.grams.个], [String(tofu), 200, 20]);
  assert.equal(line0(m2), 'mine');
  assert.equal(canon(merged(m2, own2)), canon(m2));
  assert.equal(canon(merged(m2, pick)), canon(m2));
});
const line0 = (s) => estimateRecipe(s, RECIPE).lines[0].source;

// 「用回自动认的」以后再存：撤掉的指定、自己填的每 100 g、一个多重不能在下一次同步时回来。同一台设备删了再存是同一条（createdAt 照旧，
// 整条取较新的）；另一台设备从头建的同名那条也不从删掉的那条补（store.js 的 blend）
test('合并 foods 里食材的说法：用回自动认的 → 同步 → 再自己填 → 同步，撤掉的指定、每 100 g 不回来', () => {
  const dev = () => ensureSeeds(blankState());
  const leg = { servings: 1, ings: [{ key: 'a', name: '鸡腿', qty: 1, unit: '个' }] };
  const belly = { servings: 1, ings: [{ key: 'a', name: '五花肉', qty: 100, unit: 'g' }, { key: 'b', name: '五花肉', qty: 1, unit: '片' }] };
  const breast = String(findFood('鸡胸肉').id);
  // 一：鸡腿指定成鸡胸肉 → 同步 → 用回自动认的 → 同步 → 自己填一个 150 g → 同步
  let a = dev(), cloud = null;
  saveIngredientFood(a, '鸡腿', { ref: breast }, 1000);
  cloud = a = merged(a, cloud || dev());
  clearIngredientFood(a, '鸡腿', 2000);
  cloud = a = merged(a, cloud);
  saveIngredientFood(a, '鸡腿', { grams: '150', unit: '个' }, 3000);
  const local = estimateRecipe(a, leg).lines[0];
  assert.deepEqual([local.source, local.food.zh[0], local.status], ['table', '鸡腿', 'ok']);
  const m = merged(a, cloud), f = m.data.foods[foodId('鸡腿')];
  assert.deepEqual([f.ref, f.grams.个, f.deleted], [null, 150, undefined], '指定的鸡胸肉没回来');
  assert.equal(estimateRecipe(m, leg).lines[0].source, 'table');
  assert.equal(canon(merged(cloud, a)), canon(m));
  // 删了还没同步就又存（云端还是删之前的那条）：一样
  let b = dev();
  saveIngredientFood(b, '鸡腿', { ref: breast }, 1000);
  const before = merged(b, dev());
  clearIngredientFood(b, '鸡腿', 2000);
  saveIngredientFood(b, '鸡腿', { grams: '150', unit: '个' }, 3000);
  assert.equal(merged(b, before).data.foods[foodId('鸡腿')].ref, null);
  // 二：五花肉自己填 300 / 15 / 0 / 25 → 同步 → 用回自动认的 → 同步 → 只填一片 20 g → 同步：每 100 g 照表里的
  let c = dev();
  saveIngredientFood(c, '五花肉', { per: { kcal: '300', protein: '15', carbs: '0', fat: '25' } }, 1000);
  cloud = c = merged(c, dev());
  clearIngredientFood(c, '五花肉', 2000);
  cloud = c = merged(c, cloud);
  saveIngredientFood(c, '五花肉', { grams: '20', unit: '片' }, 3000);
  const m2 = merged(c, cloud), e2 = estimateRecipe(m2, belly);
  assert.deepEqual(m2.data.foods[foodId('五花肉')].per, { kcal: null, protein: null, carbs: null, fat: null });
  assert.deepEqual([e2.lines[0].source, e2.lines[0].nutrition.kcal, e2.lines[1].grams], ['table', findFood('五花肉').per100.kcal, 20]);
  // 三：另一台设备（没见过那一条）从头填的同名那条，也不从云端删掉的那条补
  let d = dev();
  saveIngredientFood(d, '鸡腿', { ref: breast, grams: '150', unit: '个' }, 1000);
  clearIngredientFood(d, '鸡腿', 2000);
  const fresh = dev();
  saveIngredientFood(fresh, '鸡腿', { per: { kcal: '180' } }, 4000);
  const m3 = merged(fresh, d), f3 = m3.data.foods[foodId('鸡腿')];
  assert.deepEqual([f3.ref, f3.per.kcal, f3.grams.个, f3.deleted], [null, 180, undefined, undefined], '删掉的那条什么也不补');
  assert.equal(canon(merged(d, fresh)), canon(m3));
  assert.equal(canon(merged(m3, d)), canon(m3));
  assert.equal(canon(merged(m3, fresh)), canon(m3));
});

// 随机操作，中间穿插同步（有时先拉一次再改，改完推上去）：会收敛；先拉过再改的，推上去以后的估算和它本机的一样
// （刚做的不被云端旧的、删掉的那条补回来）。没先拉的是没见过云端那条，各自建的照旧互相补
test('合并 foods 里食材的说法：操作和同步穿插着来（用回自动认的以后再存），收敛，刚做的不被补回旧的', () => {
  const rnd = prng(59);
  const pickOf = a => a[Math.floor(rnd() * a.length)];
  const tofu = [findFood('豆腐').id, findFood('嫩豆腐').id];
  const op = (s, at) => {
    const x = rnd();
    if (x < 0.25) saveIngredientFood(s, '鱼豆腐', { ref: pickOf(tofu) }, at);
    else if (x < 0.5) saveIngredientFood(s, '鱼豆腐', { per: { kcal: pickOf(['', '200', '210']), protein: pickOf(['', '12']), carbs: '', fat: pickOf(['', '10']) } }, at);
    else if (x < 0.75) saveIngredientFood(s, '鱼豆腐', { grams: pickOf(['15', '20', '']), unit: pickOf(['个', '块']) }, at);
    else clearIngredientFood(s, '鱼豆腐', at);
  };
  for (let k = 0; k < 200; k++) {
    const devs = [0, 1, 2].map(() => ensureSeeds(blankState()));
    let cloud = ensureSeeds(blankState()), at = 1000;
    for (let step = 0; step < 12; step++) {
      const i = Math.floor(rnd() * 3);
      const pulled = rnd() < 0.6;
      if (pulled) devs[i] = merged(devs[i], cloud);
      at += 100;
      op(devs[i], at);
      const mine = canon(estimateRecipe(devs[i], RECIPE).perServing);
      cloud = devs[i] = merged(devs[i], cloud);
      if (pulled) assert.equal(canon(estimateRecipe(cloud, RECIPE).perServing), mine, `第 ${k} 组第 ${step} 步：刚做的被合并改了`);
    }
    for (let r = 0; r < 2; r++) for (let i = 0; i < 3; i++) cloud = devs[i] = merged(devs[i], cloud);
    for (const d of devs) assert.equal(canon(d), canon(cloud), `第 ${k} 组：没有收敛`);
  }
});
