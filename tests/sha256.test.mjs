// 内容哈希（src/core/sha256.js，从 babble 移植）：和 Node 的 crypto 一样；块边界、填充边界、带偏移的二进制；大文件分块（不整份读进内存）。只用编出来的字节
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sha256Hex, sha256Js, HASH_CHUNK_BYTES } from '../src/core/sha256.js';

test('SHA-256 与独立实现一致：块边界、填充边界、带偏移的二进制输入', async () => {
  for (const n of [0, 1, 55, 56, 63, 64, 65, 127, 128, 129, 1025]) {
    const backing = Uint8Array.from({ length: n + 13 }, (_, i) => (i * 37 + 19) % 256), x = backing.subarray(7, 7 + n);
    const want = createHash('sha256').update(x).digest('hex');
    assert.equal(sha256Js(x), want, String(n));
    assert.equal(await sha256Hex(x), want, String(n));
  }
  assert.equal(sha256Js(new Uint8Array(0)), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});

test('Blob / ArrayBuffer / 视图一样；没有 crypto.subtle 时纯 JS 版结果一样；不是二进制的报错', async () => {
  const bytes = new TextEncoder().encode('测试图片：红烧肉 🍖');
  const want = createHash('sha256').update(bytes).digest('hex');
  assert.equal(await sha256Hex(new Blob([bytes])), want);
  assert.equal(await sha256Hex(bytes.buffer), want);
  const had = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {} });     // 局域网 http 打开时没有 subtle
  try { assert.equal(await sha256Hex(bytes), want); }
  finally { Object.defineProperty(globalThis, 'crypto', had); }
  await assert.rejects(sha256Hex(/** @type {any} */ ('不是二进制')), TypeError);
});

test('大文件哈希分块：不读整个 Blob，多个分片和最后的 SHA 填充仍与 Node crypto 一致', async () => {
  for (const tail of [55, 56, 64, 65]) {
    const x = Uint8Array.from({ length: 5 * HASH_CHUNK_BYTES + tail }, (_, i) => (i * 37 + 19) % 256), source = new Blob([x]), sizes = [];
    const file = { size: source.size,
      arrayBuffer() { assert.fail('不得整份读入'); },
      slice(a, b) { sizes.push(Math.min(b, source.size) - a); return source.slice(a, b); } };
    assert.equal(await sha256Hex(file), createHash('sha256').update(x).digest('hex'));
    assert.ok(sizes.length > 1 && sizes.every(n => n <= HASH_CHUNK_BYTES));
  }
});
