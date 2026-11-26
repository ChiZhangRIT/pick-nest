// 测试用的最小的假 IndexedDB（只有 core/blobStore.js 用到的：open 带升级、get / put / delete / count / getAll；
// 请求按发出的顺序异步完成，事务最后完成；一个请求出错整个事务 abort）。rejectBlobs：不收 Blob（Safari 无痕浏览那样）
import assert from 'node:assert/strict';

/** 最小的假 IndexedDB（get / put / delete / count / getAll；请求按发出的顺序异步完成，事务最后完成）；rejectBlobs：不收 Blob（无痕浏览） */
export function fakeIDB({ rejectBlobs = false } = {}) {
  const stores = new Map();
  let opened = 0;
  const db = {
    objectStoreNames: { contains: (n) => stores.has(n) }, createObjectStore: (n, o) => { stores.set(n, { key: o && o.keyPath, m: new Map() }); }, close() {},
    transaction() {
      const tx = {};
      let pending = 1, failed = false;
      const done = () => { if (--pending === 0) setTimeout(() => (failed ? tx.onabort && tx.onabort() : tx.oncomplete && tx.oncomplete())); };
      const req = (fn) => { pending++; const r = {}; setTimeout(() => { try { r.result = fn(); if (r.onsuccess) r.onsuccess(); } catch (e) { failed = true; tx.error = e; } done(); }); return r; };
      tx.objectStore = (n) => {
        const s = stores.get(n);
        return {
          get: k => req(() => s.m.get(k)), count: k => req(() => (s.m.has(k) ? 1 : 0)), delete: k => req(() => { s.m.delete(k); }),
          put: (v) => req(() => { if (rejectBlobs && v.blob) throw new Error('Error preparing Blob/File data to be stored in object store'); s.m.set(v[s.key], v); }),
          getAll: () => req(() => [...s.m.values()]),
        };
      };
      setTimeout(done);
      return tx;
    },
  };
  return { stores, get opened() { return opened; },
    open(name, v) { opened++; assert.equal(name, 'picknest-blobs'); assert.equal(v, 1); const r = {}; setTimeout(() => { r.result = db; r.onupgradeneeded({ oldVersion: 0 }); r.onsuccess(); }); return r; } };
}

