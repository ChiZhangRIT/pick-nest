// 假的屏幕常亮（navigator.wakeLock）和 document 的前后台：core/wake.js 的测试、清单页 / 商店页的测试共用。不碰真的浏览器
import assert from 'node:assert/strict';

/** 假的 navigator.wakeLock 和 document：记下要了几次、放了几次；系统收回 = 调 sentinel 的 release 监听；env.deny 可以中途改（先拒绝、再给） */
export function fakeWake({ supported = true, deny = false, hold = false } = {}) {
  const env = { requests: 0, released: 0, sentinels: [], pending: [], doc: null, deny };
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
    if (env.deny) return Promise.reject(Object.assign(new Error('not allowed'), { name: 'NotAllowedError' }));
    if (hold) return new Promise((res) => env.pending.push(() => res(sentinel())));
    return Promise.resolve(sentinel());
  } } : undefined;
  return env;
}
