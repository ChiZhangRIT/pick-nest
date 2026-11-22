import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeStates, normalizeState, canon, ensureSeeds } from '../src/core/store.js';

// 合并规则的整体性质（见 docs/DATA_MODEL.md「合并」）：items、memory 各自从头建的同一条要补字段，这让合并不满足结合律，
// 所以这里不查结合律，查真正要紧的：顺序无关、重复合并不变，以及三台设备经过同一个仓库轮流同步时会收敛、不来回上传、不丢补过来的字段。
// 随机数据用固定种子（每次跑一样），只用编出来的内容。

function prng(seed) {
  let s = seed;
  return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
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
