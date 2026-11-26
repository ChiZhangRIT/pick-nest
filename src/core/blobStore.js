// @ts-check
// 本机的图片库（IndexedDB picknest-blobs，第 1 版；第 12 步的成品图）：从 babble 的 core/audioStore.js 移植、改成通用的「按内容存的文件」，
// 只留 clips 那一张表（没有录音分片、永久删除的清理）：
//   blobs   sha256 → { sha256, blob, mime, bytes, addedAt, uploaded }
//     blob 直接存（不转 base64）；Safari 无痕浏览等不让存 Blob 的环境改存 data: ArrayBuffer，读出来时包回 Blob。
//     uploaded：已经确认在哪个同步仓库里（仓库全名；还没传 / 不知道 → null）。babble 记的是 true / false，换了仓库要另外记一份「上次的仓库」
//     再整个清掉；这里直接记仓库名，换了仓库自然就都是「还没传」，不用另存本机设置
// 图片只增不改：同一张图（同样的内容）只存一份；删图片只删从来没上传过的（编辑页里加了又放弃的），上传过的留着（别的设备、旧的记录还可能指着它）。
// 模块导出的函数用浏览器的 indexedDB（import 时不碰它，Node 测试能 import）；memoryStore() 是同样接口的内存版，测试用。
import { sha256Hex } from './sha256.js';

export const DB_NAME = 'picknest-blobs';
export const DB_VERSION = 1;
const STORE = 'blobs';

/**
 * @typedef {{ sha256: string, mime: string, bytes: number, addedAt: number, uploaded: string | null }} BlobMeta
 * @typedef {BlobMeta & { blob: Blob }} BlobRecord
 * @typedef {{ sha256: string, mime: string, bytes: number }} PutResult
 * @typedef {{
 *   putBlob(blob: Blob, opts?: { mime?: string, uploaded?: string | null }): Promise<PutResult>,
 *   getBlob(sha: string): Promise<BlobRecord | null>,
 *   hasBlob(sha: string): Promise<boolean>,
 *   listBlobs(): Promise<BlobMeta[]>,
 *   markUploaded(sha: string, repo: string | null): Promise<void>,
 *   pendingUploads(repo: string): Promise<BlobMeta[]>,
 *   deleteBlob(sha: string): Promise<boolean>,
 *   usage(): Promise<{ count: number, bytes: number }>,
 * }} BlobStore
 */

/** 'image/jpeg; charset=x' → 'image/jpeg'（小写，去参数） @param {unknown} mime */
export const baseMime = (mime) => String(mime || '').toLowerCase().split(';')[0].trim();
/** @type {Record<string, string>} */
const MIME_EXT = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/pjpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'image/heic': 'heic', 'image/heif': 'heif', 'image/avif': 'avif' };
/**
 * mime → 仓库里的扩展名。babble 的 extForMime 把不认识的都当成 m4a（图片会变成 .m4a）：这里只认图片，不认识的是 bin，不冒充别的格式
 * @param {unknown} mime
 */
export const extForMime = (mime) => MIME_EXT[baseMime(mime)] || 'bin';

/** @param {Record<string, any>} r @returns {BlobMeta} */
const metaOf = ({ blob, data, ...r }) => /** @type {BlobMeta} */ ({ ...r, uploaded: typeof r.uploaded === 'string' ? r.uploaded : null });
/** 记录 → 一定带 blob（存的是 ArrayBuffer 的包回 Blob） @param {any} r @returns {BlobRecord | null} */
function fromRecord(r) {
  if (!r) return null;
  const meta = metaOf(r);
  if (r.blob) return { ...meta, blob: r.blob };
  return r.data ? { ...meta, blob: new Blob([r.data], { type: r.mime || '' }) } : null;
}
/** @param {BlobMeta[]} list @param {string} repo */
const pendingIn = (list, repo) => list.filter(r => r.uploaded !== repo).sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));
/** @param {BlobMeta[]} list */
const sumUsage = (list) => ({ count: list.length, bytes: list.reduce((n, r) => n + (Number(r.bytes) || 0), 0) });
/** @param {Blob} blob @param {string | undefined} mime */
const typeOf = (blob, mime) => baseMime(mime || blob.type) || 'application/octet-stream';

// ---------- IndexedDB 版 ----------
/** @param {() => IDBFactory | undefined} [getIDB] 测试可以注入假的 indexedDB @returns {BlobStore} */
export function idbStore(getIDB = () => globalThis.indexedDB) {
  /** @type {Promise<IDBDatabase> | null} */
  let opening = null;
  function open() {
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      const idb = getIDB();
      if (!idb) { reject(new Error('no-indexeddb')); return; }
      /** @type {IDBOpenDBRequest} */
      let req;
      try { req = idb.open(DB_NAME, DB_VERSION); } catch (e) { reject(e); return; }
      req.onupgradeneeded = (ev) => {
        const db = req.result;
        // 按版本一步步升级；以后加 store 写成 if (ev.oldVersion < 2) { … }
        if (ev.oldVersion < 1 && !db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'sha256' });
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => { db.close(); opening = null; };   // 别的标签页要升级：先让路
        db.onclose = () => { opening = null; };                       // 系统把连接关了（iOS 后台久了会）：下次重开
        resolve(db);
      };
      req.onerror = () => { opening = null; reject(req.error || new Error('idb-open')); };
      req.onblocked = () => { /* 旧连接还开着：等它们关掉后会继续 */ };
    });
    return opening;
  }

  /**
   * 跑一个事务：fn(tx) 发请求，返回「取结果」的函数（或直接返回值）。等事务 complete 才 resolve（真写进去了才算）。
   * iOS 偶尔会断开 IndexedDB 连接（transaction() 抛 InvalidStateError）：重开一次再试
   * @template T @param {IDBTransactionMode} mode @param {(tx: IDBTransaction) => T | (() => T)} fn @returns {Promise<T>}
   */
  async function run(mode, fn) {
    for (let attempt = 0; ; attempt++) {
      const db = await open();
      /** @type {IDBTransaction} */
      let tx;
      try { tx = db.transaction(STORE, mode); }
      catch (e) {
        if (attempt === 0 && e && /** @type {any} */ (e).name === 'InvalidStateError') { opening = null; try { db.close(); } catch (_) { /* 已经断了 */ } continue; }
        throw e;
      }
      return new Promise((resolve, reject) => {
        /** @type {any} */
        let out;
        tx.oncomplete = () => { try { resolve(typeof out === 'function' ? out() : out); } catch (e) { reject(e); } };
        tx.onabort = () => reject(tx.error || new Error('idb-abort'));
        try { out = fn(tx); } catch (e) { try { tx.abort(); } catch (_) { /* 已经结束 */ } reject(e); }
      });
    }
  }
  // 有的环境（Safari 无痕浏览、临时 WebView）IndexedDB 不收 Blob（"Error preparing Blob/File data…"）：
  // 失败一次就改存 ArrayBuffer，之后都这样；改存也失败说明不是 Blob 的问题，抛原来的错
  let blobsOk = true;
  /** @template T @param {(asBuffer: boolean) => Promise<T>} write @returns {Promise<T>} */
  async function storing(write) {
    if (!blobsOk) return write(true);
    try { return await write(false); }
    catch (e) {
      let r;
      try { r = await write(true); } catch (e2) { throw e; }
      blobsOk = false;
      return r;
    }
  }
  const list = () => run('readonly', (tx) => { const r = tx.objectStore(STORE).getAll(); return () => (r.result || []).map(metaOf); });

  /** @type {BlobStore} */
  const api = {
    /** 存一张图（同样内容只存一份）→ { sha256, mime, bytes }。uploaded：已知在这个仓库里（同步下载来的） */
    async putBlob(blob, { mime, uploaded = null } = {}) {
      const sha256 = await sha256Hex(blob);
      const type = typeOf(blob, mime);
      return storing(async (asBuffer) => {
        // 存成带正确类型的 Blob（不复制内容）；不收 Blob 的环境存 ArrayBuffer（要在事务外先读出来）
        const body = asBuffer ? { data: await blob.arrayBuffer() } : { blob: blob.type === type ? blob : new Blob([blob], { type }) };
        return run('readwrite', (tx) => {
          const st = tx.objectStore(STORE);
          let res = { sha256, mime: type, bytes: blob.size };
          const g = st.get(sha256);
          g.onsuccess = () => {
            const old = g.result;
            if (old) {
              res = { sha256, mime: old.mime || type, bytes: old.bytes ?? blob.size };
              if (uploaded && old.uploaded !== uploaded) st.put({ ...old, uploaded });
            } else st.put({ sha256, ...body, mime: type, bytes: blob.size, addedAt: Date.now(), uploaded: uploaded || null });
          };
          return () => res;
        });
      });
    },
    getBlob: (sha) => run('readonly', (tx) => { const r = tx.objectStore(STORE).get(sha); return () => fromRecord(r.result); }),
    hasBlob: (sha) => run('readonly', (tx) => { const r = tx.objectStore(STORE).count(sha); return () => r.result > 0; }),
    listBlobs: list,
    markUploaded: (sha, repo) => run('readwrite', (tx) => {
      const st = tx.objectStore(STORE), g = st.get(sha), v = repo || null;
      g.onsuccess = () => { if (g.result && (g.result.uploaded || null) !== v) st.put({ ...g.result, uploaded: v }); };
    }),
    pendingUploads: async (repo) => pendingIn(await list(), repo),
    /** 删掉一张从来没上传过的（编辑页里加了又放弃的）→ 删了没有。上传过的不删；有没有食谱在用由调用的人查 */
    deleteBlob: (sha) => run('readwrite', (tx) => {
      const st = tx.objectStore(STORE), g = st.get(sha);
      let ok = false;
      g.onsuccess = () => { if (g.result && !g.result.uploaded) { st.delete(sha); ok = true; } };
      return () => ok;
    }),
    usage: async () => sumUsage(await list()),
  };
  return api;
}

// ---------- 内存版（同样接口） ----------
/** @returns {BlobStore & { blobs: Map<string, BlobRecord> }} */
export function memoryStore() {
  /** @type {Map<string, BlobRecord>} */
  const blobs = new Map();
  const tick = () => Promise.resolve();
  const list = async () => { await tick(); return [...blobs.values()].map(metaOf); };
  return {
    blobs,     // 测试直接看里面
    async putBlob(blob, { mime, uploaded = null } = {}) {
      const sha256 = await sha256Hex(blob);
      const type = typeOf(blob, mime);
      const old = blobs.get(sha256);
      if (old) { if (uploaded) old.uploaded = uploaded; return { sha256, mime: old.mime, bytes: old.bytes }; }
      blobs.set(sha256, { sha256, blob, mime: type, bytes: blob.size, addedAt: Date.now(), uploaded: uploaded || null });
      return { sha256, mime: type, bytes: blob.size };
    },
    async getBlob(sha) { await tick(); const r = blobs.get(sha); return r ? { ...r } : null; },
    async hasBlob(sha) { await tick(); return blobs.has(sha); },
    listBlobs: list,
    async markUploaded(sha, repo) { await tick(); const r = blobs.get(sha); if (r) r.uploaded = repo || null; },
    pendingUploads: async (repo) => pendingIn(await list(), repo),
    async deleteBlob(sha) { await tick(); const r = blobs.get(sha); if (!r || r.uploaded) return false; blobs.delete(sha); return true; },
    usage: async () => sumUsage(await list()),
  };
}

// ---------- 模块级接口（浏览器里的 picknest-blobs；app.js 用这个） ----------
export const blobStore = idbStore();
