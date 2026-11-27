// 屏幕常亮的规则（core/wake.js）：本机开关 keepAwakeOn / keepAwakePatch，请求、切回来再要、放掉（screenWake，假的 navigator.wakeLock 和 document）。
// 页面上的开关和小标签在 tests/keepAwakeView.test.mjs。全是编的数据
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { screenWake, keepAwakeOn, keepAwakePatch } from '../src/core/wake.js';
import { fakeWake } from './helpers/wake.mjs';

const settle = async (n = 5) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)); };

test('本机开关：只有 true 算开（没有这一项、认不出的值都是关着），改的时候只给 keepAwake 一项', () => {
  assert.equal(keepAwakeOn(null), false);
  assert.equal(keepAwakeOn(undefined), false);
  assert.equal(keepAwakeOn({}), false, '旧版存的本机设置没有这一项：关着');
  for (const v of ['true', 1, 'on', {}, null]) assert.equal(keepAwakeOn({ keepAwake: v }), false, String(v));
  assert.equal(keepAwakeOn({ keepAwake: true }), true);
  assert.deepEqual(keepAwakePatch(true), { keepAwake: true });
  assert.deepEqual(keepAwakePatch(false), { keepAwake: false });
  assert.deepEqual(keepAwakePatch(/** @type {any} */ ('yes')), { keepAwake: false }, '只认 true');
  assert.equal(keepAwakeOn({ lang: 'en', ...keepAwakePatch(true) }), true);
});

test('屏幕常亮：进这一页时要一次；系统收回后切回来再要；离开时放掉、不再听切回来', async () => {
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
