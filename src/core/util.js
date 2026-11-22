// @ts-check
// 小工具：不碰 DOM，Node 里也能用（测试、各个 core 模块共用）。

/** @param {unknown} v @returns {v is Record<string, any>} */
export const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
/** @param {unknown} v */
export const str = v => (typeof v === 'string' ? v : v == null ? '' : String(v));
/** 只取自有属性（不顺着原型链找到 toString 之类） @param {any} o @param {string} k */
export const own = (o, k) => (o && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);

// 记录 id、设置的键：不许用 __proto__ 之类（同步来的文件或备份可能被人改过）
const SAFE_KEY = /^[A-Za-z0-9_.:@-]{1,200}$/;
/** @param {unknown} k @returns {k is string} */
export const safeKey = k => typeof k === 'string' && SAFE_KEY.test(k) && k !== '__proto__' && k !== 'constructor' && k !== 'prototype';

/**
 * 连续调用只执行最后一次：debounce(fn, 3000) → f()；f.cancel()、f.flush()
 * @template {any[]} A
 * @param {(...a: A) => void} fn
 * @param {number} ms
 */
export function debounce(fn, ms) {
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;
  /** @type {A | null} */
  let args = null;
  const f = (/** @type {A} */ ...a) => { args = a; if (timer) clearTimeout(timer); timer = setTimeout(() => { timer = null; fn(...(/** @type {A} */ (args))); }, ms); };
  f.cancel = () => { if (timer) clearTimeout(timer); timer = null; };
  f.flush = () => { if (timer) { f.cancel(); fn(...(/** @type {A} */ (args))); } };
  f.pending = () => timer !== null;
  return f;
}
