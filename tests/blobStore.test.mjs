// 本机的图片库（src/core/blobStore.js，从 babble 的 audioStore 移植、只留按内容存的文件）：扩展名 / mime（不认识的不再当成 .m4a）、
// 内存版和假的 IndexedDB 一样的行为（同样内容只存一份、记在哪个仓库里上传过、待上传按加入的先后、只删没上传过的、用了多少）、
// 不收 Blob 的环境改存 ArrayBuffer、没有 IndexedDB 时 import 不出错。IndexedDB 版在浏览器里才有，这里用最小的假的；只用编出来的字节
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { extForMime, baseMime, memoryStore, idbStore, blobStore, DB_NAME } from '../src/core/blobStore.js';
import { fakeIDB } from './helpers/idb.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');

test('mime → 扩展名：图片各是各的；不认识的是 bin（babble 的会写成 .m4a）；mime 去参数、小写', () => {
  for (const [m, ext] of [['image/jpeg', 'jpg'], ['IMAGE/JPEG; q=1', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp'], ['image/heic', 'heic'], ['image/gif', 'gif'],
    ['image/avif', 'avif'], ['audio/mp4', 'bin'], ['application/octet-stream', 'bin'], ['', 'bin'], [null, 'bin']]) assert.equal(extForMime(m), ext, String(m));
  assert.equal(baseMime(' Image/PNG ;x=1'), 'image/png');
  assert.equal(DB_NAME, 'picknest-blobs');
});

/** 两种实现一样的行为 */
async function storeCase(s) {
  const realNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  try {
    const a = await s.putBlob(new Blob(['测试图片 A'], { type: 'image/jpeg' }));
    assert.deepEqual(a, { sha256: sha('测试图片 A'), mime: 'image/jpeg', bytes: new Blob(['测试图片 A']).size });
    now += 1000;
    const again = await s.putBlob(new Blob(['测试图片 A'], { type: 'image/png' }));
    assert.equal(again.sha256, a.sha256, '同样内容只存一份');
    assert.equal(again.mime, 'image/jpeg', '去重时留第一次的类型');
    assert.equal((await s.listBlobs()).length, 1);
    now += 1000;
    const b = await s.putBlob(new Blob(['测试图片 B']), { mime: 'image/webp' });
    assert.equal(b.mime, 'image/webp', '给了 mime 用给的');
    const c = await s.putBlob(new Blob(['测试图片 C'], { type: 'image/jpeg' }), { uploaded: 'me/data' });   // 同步下载来的
    assert.equal(await s.hasBlob(a.sha256), true);
    assert.equal(await s.hasBlob('0'.repeat(64)), false);
    assert.equal(await s.getBlob('0'.repeat(64)), null);
    const got = await s.getBlob(a.sha256);
    assert.equal(got.blob instanceof Blob, true);
    assert.equal(await got.blob.text(), '测试图片 A');
    assert.equal(got.uploaded, null);
    assert.ok((await s.listBlobs()).every(r => !('blob' in r) && !('data' in r)), '列表里没有图片本身');
    // 待上传：按仓库算，旧的在前；换了仓库以前的「已上传」不算
    assert.deepEqual((await s.pendingUploads('me/data')).map(r => r.sha256), [a.sha256, b.sha256]);
    await s.markUploaded(a.sha256, 'me/data');
    assert.deepEqual((await s.pendingUploads('me/data')).map(r => r.sha256), [b.sha256]);
    assert.deepEqual((await s.pendingUploads('me/other')).map(r => r.sha256).sort(), [a.sha256, b.sha256, c.sha256].sort(), '换了仓库：都要重新传');
    await s.putBlob(new Blob(['测试图片 B']), { uploaded: 'me/data' });    // 下载到了同一张：记上
    assert.deepEqual(await s.pendingUploads('me/data'), []);
    // 只删从来没上传过的
    const d = await s.putBlob(new Blob(['测试图片 D：加了又放弃']), { mime: 'image/jpeg' });
    assert.equal(await s.deleteBlob(d.sha256), true);
    assert.equal(await s.deleteBlob(d.sha256), false, '已经没有了');
    assert.equal(await s.deleteBlob(a.sha256), false, '上传过的不删');
    assert.equal(await s.hasBlob(a.sha256), true);
    await s.markUploaded(a.sha256, null);
    assert.equal((await s.getBlob(a.sha256)).uploaded, null);
    const u = await s.usage();
    assert.equal(u.count, 3);
    assert.equal(u.bytes, ['测试图片 A', '测试图片 B', '测试图片 C'].reduce((n, x) => n + new Blob([x]).size, 0));
  } finally { Date.now = realNow; }
}

test('内存版：同样内容只存一份、记在哪个仓库上传过、待上传、只删没上传过的、用了多少', async () => {
  await storeCase(memoryStore());
});

test('IndexedDB 版（假的 IndexedDB）：和内存版一样；只开一次库', async () => {
  const idb = fakeIDB(), s = idbStore(() => idb);
  await storeCase(s);
  assert.equal(idb.opened, 1, '连接留着重用');
  assert.equal(idb.stores.get('blobs').m.size, 3);
});

test('IndexedDB 不收 Blob（无痕浏览）：改存 ArrayBuffer，读出来照样是带类型的 Blob', async () => {
  const idb = fakeIDB({ rejectBlobs: true }), s = idbStore(() => idb);
  const a = await s.putBlob(new Blob(['测试图片：无痕'], { type: 'image/jpeg' }));
  const rec = idb.stores.get('blobs').m.get(a.sha256);
  assert.ok(rec.data instanceof ArrayBuffer && !rec.blob, '存的是 ArrayBuffer');
  const got = await s.getBlob(a.sha256);
  assert.equal(got.blob.type, 'image/jpeg');
  assert.equal(await got.blob.text(), '测试图片：无痕');
  await s.putBlob(new Blob(['测试图片：第二张']));          // 之后直接存 ArrayBuffer
  assert.equal(idb.stores.get('blobs').m.size, 2);
});

test('没有 IndexedDB（Node、个别 WebView）：import 不出错，用的时候才报错', async () => {
  await assert.rejects(idbStore(() => undefined).listBlobs(), /no-indexeddb/);
  await assert.rejects(blobStore.getBlob('x'), /no-indexeddb/);
});
