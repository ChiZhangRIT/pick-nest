// 购物模式的规则：进度怎么数（core/shop.js，和清单页 / 商店页同一个数法）、屏幕常亮（core/wake.js，假的 navigator.wakeLock 和 document）。全是编的数据
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureSeeds, blankState, normalizeRecord, deletedRecord } from '../src/core/store.js';
import { createList, setArchived } from '../src/core/lists.js';
import { deleteStore } from '../src/core/stores.js';
import { setStatus, clearDone } from '../src/core/items.js';
import { shopProgress } from '../src/core/shop.js';
import { screenWake } from '../src/core/wake.js';

const settle = async (n = 5) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)); };

function seeded() {
  const s = ensureSeeds(blankState());
  const old = createList(s, { name: '去年的', kind: 'grocery' }, 1000).id;
  let n = 0;
  const add = (listId, name, f = {}) => { const id = 'i_t' + n++; s.data.items[id] = normalizeRecord('items', { id, listId, name, status: 'need', updatedAt: 1, ...f }); return id; };
  const ids = {
    milk: add('l_groceries', '牛奶', { storeId: 's_wholefoods' }),
    egg: add('l_groceries', '鸡蛋', { storeId: 's_wholefoods', status: 'done', doneAt: 5 }),
    tofu: add('l_groceries', '豆腐', { storeId: 's_hmart' }),
    gone: add('l_groceries', '删掉的', { storeId: 's_wholefoods' }),
    lamp: add('l_tobuy', '台灯', { storeId: 's_wholefoods' }),
    umbrella: add('l_tobuy', '雨伞', { storeId: 's_wholefoods', status: 'later' }),
    box: add('l_tobuy', '纸箱'),
    cake: add(old, '月饼', { storeId: 's_wholefoods' }),
  };
  s.data.items[ids.gone] = deletedRecord(s.data.items[ids.gone], 2000);
  setArchived(s, old, true, 1001);
  return { s, ids };
}

test('进度（清单）：已买 = 这张清单上已买的，还剩 = 要买的；以后再说、删掉的不算；买齐了才 finished，空的不算', () => {
  const { s, ids } = seeded();
  assert.deepEqual(shopProgress(s, 'list', 'l_groceries'), { done: 1, left: 2, total: 3, finished: false });
  assert.deepEqual(shopProgress(s, 'list', 'l_tobuy'), { done: 0, left: 2, total: 2, finished: false }, '雨伞「以后再说」：这次不买，不算');
  setStatus(s, ids.milk, 'done', 6000);
  setStatus(s, ids.tofu, 'done', 6001);
  assert.deepEqual(shopProgress(s, 'list', 'l_groceries'), { done: 3, left: 0, total: 3, finished: true });
  setStatus(s, ids.tofu, 'need', 6002);
  assert.equal(shopProgress(s, 'list', 'l_groceries').left, 1, '放回去又是还剩一样');
  setStatus(s, ids.tofu, 'done', 6003);
  clearDone(s, 'l_groceries', 7000);
  assert.deepEqual(shopProgress(s, 'list', 'l_groceries'), { done: 0, left: 0, total: 0, finished: false }, '清除已买以后从头算，空的不是「买齐了」');
  assert.deepEqual(shopProgress(s, 'list', 'l_nope'), { done: 0, left: 0, total: 0, finished: false });
});

test('进度（商店）：所有清单里在这家买的（和商店页一样：归档的清单、以后再说不算）；未指定 = null，删掉的商店算未指定', () => {
  const { s, ids } = seeded();
  assert.deepEqual(shopProgress(s, 'store', 's_wholefoods'), { done: 1, left: 2, total: 3, finished: false }, '牛奶、台灯要买，鸡蛋已买；月饼在归档的清单上，雨伞以后再说');
  assert.deepEqual(shopProgress(s, 'store', null), { done: 0, left: 1, total: 1, finished: false }, '纸箱没指定商店');
  deleteStore(s, 's_hmart', 3000);
  assert.equal(shopProgress(s, 'store', null).left, 2, '豆腐的商店删掉了：算未指定');
  assert.equal(shopProgress(s, 'store', 's_hmart').left, 0);
  setStatus(s, ids.milk, 'done', 6000);
  setStatus(s, ids.lamp, 'done', 6001);
  assert.deepEqual(shopProgress(s, 'store', 's_wholefoods'), { done: 3, left: 0, total: 3, finished: true });
});

test('进度（商店，只看一张清单）：只数这张清单上在这家买的，和商店页一样；不给是所有清单', () => {
  const { s, ids } = seeded();
  assert.deepEqual(shopProgress(s, 'store', 's_wholefoods', { listId: 'l_tobuy' }), { done: 0, left: 1, total: 1, finished: false }, '台灯；雨伞以后再说');
  assert.deepEqual(shopProgress(s, 'store', 's_wholefoods', { listId: 'l_groceries' }), { done: 1, left: 1, total: 2, finished: false }, '牛奶要买、鸡蛋已买');
  assert.deepEqual(shopProgress(s, 'store', 's_wholefoods', {}), shopProgress(s, 'store', 's_wholefoods'));
  setStatus(s, ids.lamp, 'done', 6000);
  assert.equal(shopProgress(s, 'store', 's_wholefoods', { listId: 'l_tobuy' }).finished, true, '这张清单在这家买齐了');
  assert.equal(shopProgress(s, 'store', 's_wholefoods').finished, false, '所有清单还剩牛奶');
  assert.deepEqual(shopProgress(s, 'list', 'l_groceries', { listId: 'l_tobuy' }), shopProgress(s, 'list', 'l_groceries'), '清单的购物模式不筛');
});

/** 假的 navigator.wakeLock 和 document：记下要了几次、放了几次；系统收回 = 调 sentinel 的 release 监听 */
function fakeWake({ supported = true, deny = false, hold = false } = {}) {
  const env = { requests: 0, released: 0, sentinels: [], pending: [], doc: null };
  const listeners = new Set();
  env.doc = { visibilityState: 'visible',
    addEventListener: (type, fn) => { if (type === 'visibilitychange') listeners.add(fn); },
    removeEventListener: (type, fn) => { if (type === 'visibilitychange') listeners.delete(fn); },
    get listeners() { return listeners.size; },
    show(state) { this.visibilityState = state; for (const fn of [...listeners]) fn(); } };
  const sentinel = () => {
    const ons = [];
    const s = { released: false, addEventListener: (type, fn) => { if (type === 'release') ons.push(fn); },
      release: async () => { if (s.released) return; s.released = true; env.released++; for (const fn of ons) fn(); },
      lose() { s.released = true; for (const fn of ons) fn(); } };      // 系统收回（切到后台、低电量）
    env.sentinels.push(s);
    return s;
  };
  env.wakeLock = supported ? { request: (type) => {
    assert.equal(type, 'screen');
    env.requests++;
    if (deny) return Promise.reject(Object.assign(new Error('not allowed'), { name: 'NotAllowedError' }));
    if (hold) return new Promise((res) => env.pending.push(() => res(sentinel())));
    return Promise.resolve(sentinel());
  } } : undefined;
  return env;
}

test('屏幕常亮：进购物模式时要一次；系统收回后切回来再要；离开时放掉、不再听切回来', async () => {
  const env = fakeWake();
  const seen = [];
  const w = screenWake({ wakeLock: env.wakeLock, doc: env.doc, onChange: (st) => seen.push(st) });
  assert.equal(w.status(), 'off');
  w.start();
  w.start();                                     // 重复开始不多要
  await settle();
  assert.deepEqual([env.requests, w.status()], [1, 'on']);
  // 切到后台：系统收回；在后台不要（要了也会被拒绝）；切回来再要一次
  env.doc.visibilityState = 'hidden';
  env.sentinels[0].lose();
  assert.equal(w.status(), 'off');
  env.doc.show('hidden');
  await settle();
  assert.equal(env.requests, 1);
  env.doc.show('visible');
  await settle();
  assert.deepEqual([env.requests, w.status()], [2, 'on']);
  env.doc.show('visible');                       // 已经有了：不重复要
  await settle();
  assert.equal(env.requests, 2);
  // 离开：放掉，切回来也不再要
  w.stop();
  await settle();
  assert.deepEqual([env.released, w.status(), env.doc.listeners], [1, 'off', 0]);
  env.doc.show('visible');
  await settle();
  assert.equal(env.requests, 2);
  assert.deepEqual(seen, ['asking', 'on', 'off', 'asking', 'on', 'off']);
});

test('屏幕常亮：不支持 → unsupported，什么也不做；被拒绝 → denied，点一下页面（retry）再要；一开始就在后台 → 等切回来', async () => {
  const none = fakeWake({ supported: false });
  const a = screenWake({ wakeLock: none.wakeLock, doc: none.doc });
  a.start();
  assert.equal(a.status(), 'unsupported');
  assert.equal(none.doc.listeners, 0, '不支持就不用听切回来');
  a.retry(); a.stop();
  assert.equal(a.status(), 'unsupported');
  assert.equal(screenWake({ wakeLock: { request: 'no' }, doc: none.doc }).status(), 'unsupported', 'request 不是函数也算不支持');

  const deny = fakeWake({ deny: true });
  const b = screenWake({ wakeLock: deny.wakeLock, doc: deny.doc });
  b.start();
  await settle();
  assert.deepEqual([deny.requests, b.status()], [1, 'denied']);
  b.retry();
  await settle();
  assert.equal(deny.requests, 2);
  b.stop();
  b.retry();
  await settle();
  assert.equal(deny.requests, 2, '离开以后不再要');

  const hidden = fakeWake();
  hidden.doc.visibilityState = 'hidden';
  const c = screenWake({ wakeLock: hidden.wakeLock, doc: hidden.doc });
  c.start();
  await settle();
  assert.deepEqual([hidden.requests, c.status()], [0, 'off']);
  hidden.doc.show('visible');
  await settle();
  assert.deepEqual([hidden.requests, c.status()], [1, 'on']);
  c.stop();
});

test('屏幕常亮：还没要到就离开了 → 要到以后马上放掉；正在要的时候不重复要', async () => {
  const env = fakeWake({ hold: true });
  const w = screenWake({ wakeLock: env.wakeLock, doc: env.doc });
  w.start();
  assert.equal(w.status(), 'asking');
  env.doc.show('visible');
  w.retry();
  assert.equal(env.requests, 1, '正在要：不再要');
  w.stop();
  env.pending.shift()();
  await settle();
  assert.deepEqual([env.released, w.status()], [1, 'off']);
});

test('屏幕常亮：navigator.wakeLock、document 由调用的地方给，不自己去找全局的；没给 document 就当一直在前台', async () => {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, writable: true, value: { wakeLock: { request: async () => { throw new Error('不该用全局的'); } } } });
  try { assert.equal(screenWake().status(), 'unsupported'); }
  finally { if (had) Object.defineProperty(globalThis, 'navigator', had); else delete globalThis.navigator; }
  const env = fakeWake();
  const w = screenWake({ wakeLock: env.wakeLock });
  w.start();
  await settle();
  assert.deepEqual([env.requests, w.status()], [1, 'on']);
  w.stop();
  await settle();
  assert.equal(env.released, 1);
});
