// @ts-check
// App 的数据中心（浏览器里用）：读写本机日志与快照、改数据、撤销、通知页面重画。
// load({ storage: null }) 可只用内存（Node 测试）；假的 storage 需实现标准 Storage 接口。
//
//   load()                       读入本机数据（启动时调一次），补上缺的预置记录
//   getState()                   当前数据（只读；要改用 mutate）
//   mutate(fn, { undoLabel })    fn(state) 直接改 state（必须是同步函数），返回 fn 的返回值。
//                                改过的记录会自动补盖修改时间、按集合整理字段；硬删除的记录自动改成软删除（不然同步会把它带回来）。
//                                有改动才保存、editVersion +1、通知订阅者；给了 undoLabel 就能 undo()。
//   undo()                       撤销最近一次带 undoLabel 的修改（只改回那次改过的字段），返回它的 label（没有可撤销的 → null）
//   applyRemote(merged, info)    同步合并出的新数据（core/sync.js 拉取以后）：补预置记录、保存、通知，但不算本机修改（editVersion 不变）。返回有没有存进本机
//   saveOk()                     最近一次保存数据是否成功（存不下时本机存的比内存里旧，同步不能把云端版本号记下来）
//   mergeIn(other)               从备份恢复：逐条合并（较新的为准）、补预置记录，算本机修改（开着同步会传上去）。返回 { changed: 条数 }
//   subscribe(fn)                fn(state, info)；info = { source: 'local'|'undo'|'remote'|'merge'|'storage', undoLabel?, label?, saved, ids, changed? }
//   getLocal() / setLocal(patch) 本机设置 picknest.local（语言、主题、同步令牌…，不进数据、不同步、不进备份）；setLocal 不通知订阅者
//   editVersion()                本机修改计数（同步用：上传期间又改过，上传完仍算有改动）
//   reload()                     别的标签页改了数据（storage 事件）：重新读入、合并、通知
//   storageIssue()               本机数据读不出来 / 存储用不了 → { code: 'corrupt'|'unavailable', count }，正常 → null。这时改数据会抛错
//   recoveryExport() / recoveryArchive() / recoverFrom(other)   恢复页用（见 ui/recovery.js）
import { normalizeState, normalizeRecord, mergeStates, canon, stamp, deletedRecord, setSetting, ensureSeeds } from './store.js';
import { isObj, own, safeKey } from './util.js';
import { createPersistence, LocalDataError, PENDING_PREFIX } from './persistence.js';
export { PENDING_PREFIX };

/** @typedef {import('./store.js').State} State */
/** @typedef {import('./persistence.js').StorageLike} StorageLike */
/** @typedef {import('./persistence.js').LocksLike} LocksLike */
/** @typedef {{ source: string, undoLabel?: string | null, label?: string, saved: boolean, ids: string[], changed?: boolean | number, [k: string]: any }} ChangeInfo */

export const KEY = 'picknest.state', LKEY = 'picknest.local';
// view：各清单的显示方式 { [listId]: { groupBy, showDone, showLater } }；storeView：各家店的页面 { [storeId | 'none']: { showDone } }（core/group.js 读）
// tabNoteOff：在浏览器标签页里打开时首页那句「和主屏幕上的不是同一份数据」点过「知道了」（views/lists.js）
export const LOCAL_DEFAULTS = Object.freeze({ lang: null, theme: 'auto', device: null, sync: null, lastBackupAt: null, view: {}, storeView: {}, tabNoteOff: false });
const UNDO_MAX = 20;

/** @type {StorageLike | null} */
let storage = null;
let persistence = createPersistence(null);
let memoryOnly = false;
let usesBrowserStorage = true;
/** @type {LocksLike | null | undefined} */
let persistenceLocks;
/** @type {State} */
let S = normalizeState(null);
/** @type {Record<string, any>} */
let L = { ...LOCAL_DEFAULTS, view: {}, storeView: {} };
let version = 0;
let lastSaveOk = true;
/** @type {any} */
let storageFault = null;
/** @type {Set<(state: State, info: ChangeInfo) => void>} */
const subs = new Set();
/** @type {{ label: string, recs: { c: string, id: string, prev: any, keys: string[] | null }[], settings: { k: string, had: boolean, prev: any }[] }[]} */
const undoStack = [];

function defaultStorage() { try { return globalThis.localStorage || null; } catch (e) { return null; } }
/** @param {string} k */
function readJSON(k) { try { return JSON.parse((storage && storage.getItem(k)) || 'null'); } catch (e) { return null; } }
function readLocal() { const l = readJSON(LKEY); return { ...LOCAL_DEFAULTS, view: {}, storeView: {}, ...(isObj(l) ? l : {}) }; }

/**
 * 读入本机数据。storage 不传就用 localStorage；只有显式传 null 的测试模式允许纯内存保存。
 * 读不出来时不补预置记录：恢复页显示「能读出几张清单」，补进去的预置清单会让人以为读到了
 * @param {{ storage?: StorageLike | null, locks?: LocksLike | null }} [opts]
 */
export function load({ storage: st, locks } = {}) {
  usesBrowserStorage = st === undefined;
  persistenceLocks = locks;
  storage = st !== undefined ? st : defaultStorage();
  memoryOnly = st === null;                   // 仅显式的 storage:null（Node 测试）允许把内存当成保存成功
  persistence = createPersistence(storage, { locks });           // locks 没给（undefined）就用 navigator.locks
  try {
    const read = persistence.read();
    // 存储用不了时读到的是一本空白：同样不补预置记录（恢复页会说「能读出 2 张清单」）；存储恢复后 reload() 再补
    S = storage || memoryOnly ? ensureSeeds(read) : read;
    lastSaveOk = !!storage || memoryOnly; storageFault = !storage && !memoryOnly ? new Error('storage-unavailable') : null;
  }
  catch (e) { S = e instanceof LocalDataError ? e.state : normalizeState(null); lastSaveOk = false; storageFault = e; }
  L = readLocal();
  undoStack.length = 0;
  return S;
}
/** 别的标签页改了数据（storage 事件），或恢复页点了「重新读取」：重新读入并通知 */
export function reload() {
  const before = S;
  const retrying = !lastSaveOk;
  try {
    if (usesBrowserStorage) {
      // 权限恢复后必须重新拿浏览器的存储对象；仍不可访问时继续保护，不能当成读到了一本空白记录。
      const next = defaultStorage();
      if (!next) throw new Error('storage-unavailable');
      if (next !== storage) { storage = next; persistence = createPersistence(storage, { locks: persistenceLocks }); }
    }
    S = ensureSeeds(mergeStates(S, persistence.read()));
    L = readLocal();
    storageFault = null;
  }
  catch (e) { lastSaveOk = false; storageFault = e; if (e instanceof LocalDataError) S = mergeStates(S, e.state); }
  const changed = canon(before) !== canon(S);
  const saved = saveState();                 // 内存里上次没存下的修改也保留、重试，不用别的标签页覆盖它
  if (changed || retrying) { version++; markDirty(); } // 重试落盘时，磁盘上旧的同步配置也不能清掉「待上传」
  emit({ source: 'storage', saved, changed: changed || retrying, ids: [] });
  return S;
}

export const getState = () => S;
export const getLocal = () => L;
export const editVersion = () => version;
export const saveOk = () => lastSaveOk;
export const storageIssue = () => storageFault ? { code: storageFault.code || 'unavailable', count: storageFault.issues?.length || 0 } : null;
export function recoveryExport() {
  if (!storage) return null;
  try { return storageFault ? persistence.evidence() : persistence.archive(); } catch (e) { return null; }
}
export function recoveryArchive() { try { return persistence.archive(); } catch (e) { return null; } }
/** 用读得出来的部分和 other 合并后换掉坏了的本机数据（原件先存档），解除保护 @param {any} other */
export async function recoverFrom(other) {
  const next = await persistence.recover(mergeStates(S, normalizeState(other)));
  S = ensureSeeds(next); storageFault = null; lastSaveOk = true; version++;
  if (L.sync) { L.sync.sha = L.sync.etag = null; markDirty(); }
  emit({ source: 'merge', saved: true, ids: [] });
  return S;
}

/** 保存数据；存不下（空间满）返回 false */
export function saveState() {
  if (storageFault) return (lastSaveOk = false);
  if (!storage) return (lastSaveOk = memoryOnly);
  try { S = persistence.save(S); lastSaveOk = true; }
  catch (e) { lastSaveOk = false; if (e instanceof LocalDataError) storageFault = e; }
  return lastSaveOk;
}
export const idle = () => persistence.idle();
/**
 * 存本机设置。数据最近一次没存进本机（空间满）时不写云端版本号（sync.sha / etag）：内存里的版本号对的是内存里的数据，
 * 磁盘上的数据比它旧——这时被系统关掉，下次启动带着它拉取会得到 304 / 同一个 sha，那一版云端的修改就再也合并不进来了，
 * 接着上传还会把它盖掉。不写就是下次完整拉取、合并。哪条路径存的（同步一轮结束、改显示方式、改数据时标「待同步」）都一样
 */
export function saveLocal() {
  if (!storage) return true;
  const out = !lastSaveOk && isObj(L.sync) && (L.sync.sha || L.sync.etag) ? { ...L, sync: { ...L.sync, sha: null, etag: null } } : L;
  try { storage.setItem(LKEY, JSON.stringify(out)); return true; } catch (e) { return false; }   // 本机设置存不下也不影响使用
}
/** 改本机设置（浅合并）并保存，返回新的本机设置 @param {Record<string, any>} [patch] */
export function setLocal(patch = {}) {
  Object.assign(L, patch);
  saveLocal();
  return L;
}

/** @param {(state: State, info: ChangeInfo) => void} fn */
export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
/** @param {ChangeInfo} info */
function emit(info) {
  for (const fn of [...subs]) { try { fn(S, info); } catch (e) { console.error(e); } }
}

function markDirty() { if (L.sync) { L.sync.dirty = true; saveLocal(); } }

/** 合并前后有变化的记录 id（所有集合） @param {State} before @param {State} after */
function changedIds(before, after) {
  const ids = [];
  for (const c of Object.keys(after.data)) for (const id of Object.keys(after.data[c])) if (canon(own(own(before.data, c), id)) !== canon(after.data[c][id])) ids.push(id);
  return ids;
}

/**
 * 比较改动前后：补盖修改时间、按集合整理，记下每条的旧版本和改了哪些字段（撤销用）。
 * 新建的记录自带修改时间就照用（以后导入旧数据时可以故意用很早的时间：别的设备上真正改过的都比它新）。
 * 整理后除了修改时间都一样的（写了一遍同样的值，或者 order '0' 这种整理后一样的）不算修改：不盖新时间、不保存、不进撤销。
 * 预置记录靠 updatedAt 0 表示「没人改过」，白盖一个新时间会让它在合并时盖过别的设备上的删除
 * @param {State} before @param {State} after @param {number} now
 */
function diff(before, after, now) {
  /** @type {{ c: string, id: string, prev: any, keys: string[] | null }[]} */
  const recs = [];
  /** @type {{ k: string, had: boolean, prev: any }[]} */
  const settings = [];
  const cols = new Set([...Object.keys(before.data || {}), ...Object.keys(after.data || {})]);
  for (const c of cols) {
    // 存不下的名字（带空格、__proto__ 之类）保存时会被 mergeStates 悄悄丢掉：在这里就报错，mutate 会整个撤回
    if (!safeKey(c)) throw new Error('bad-collection: ' + c);
    const A = own(before.data, c) || {};
    if (!isObj(after.data[c])) after.data[c] = {};
    const B = after.data[c];
    for (const id of new Set([...Object.keys(A), ...Object.keys(B)])) {
      const a = own(A, id), b = own(B, id);
      if (b !== undefined && !isObj(b)) throw new Error('bad-record: ' + c + '/' + id);   // 先查：新 id 写成 null 时 canon 和「没有」一样，会漏过去
      if (canon(a) === canon(b)) continue;
      if (!safeKey(id)) throw new Error('bad-id: ' + id);
      let next = b;
      if (b === undefined) next = a.deleted ? a : deletedRecord(a, now);        // 硬删除 → 软删除
      else if (a && canon({ ...a, updatedAt: 0 }) === canon({ ...normalizeRecord(c, b, id), updatedAt: 0 })) { B[id] = a; continue; }
      else if (a ? (b.updatedAt || 0) <= (a.updatedAt || 0) : !(Number(b.updatedAt) > 0)) next = stamp(b, a, now);
      next = normalizeRecord(c, next, id);
      B[id] = next;
      if (canon(a) === canon(next)) continue;
      // 撤销只改回这些字段（修改时间不算：撤销本身会重新盖）
      const keys = a ? [...new Set([...Object.keys(a), ...Object.keys(next)])].filter(k => k !== 'updatedAt' && canon(a[k]) !== canon(next[k])) : null;
      recs.push({ c, id, prev: a === undefined ? null : a, keys });
    }
  }
  for (const k of new Set([...Object.keys(before.settings || {}), ...Object.keys(after.settings || {})])) {
    if (canon(before.settings[k]) === canon(after.settings[k])) continue;
    const prevAt = (before.settingsAt && before.settingsAt[k]) || 0;
    if (((after.settingsAt && after.settingsAt[k]) || 0) <= prevAt) after.settingsAt[k] = Math.max(now, prevAt + 1);
    settings.push({ k, had: Object.prototype.hasOwnProperty.call(before.settings, k), prev: before.settings[k] });
  }
  return { recs, settings };
}

/**
 * 改数据。fn(state) 直接改 state.data.<集合>[id] / state.settings[key]（同步函数）。
 * @template T
 * @param {(state: State) => T} fn
 * @param {{ undoLabel?: string | null }} [opts]
 * @returns {T}
 */
export function mutate(fn, { undoLabel = null } = {}) {
  if (storageFault) throw storageFault;
  const before = structuredClone(S);
  let result;
  try { result = fn(S); } catch (e) { S = before; throw e; }
  let d;
  try { d = diff(before, S, Date.now()); } catch (e) { S = before; throw e; }   // 记录写坏了（null、存不下的 id）：整个撤回，不留半整理的数据
  if (!d.recs.length && !d.settings.length) {
    // 上次保存失败后再改一次（内存已经是新值），也仍须重试落盘。
    if (!lastSaveOk) emit({ source: 'local', saved: saveState(), ids: [] });
    return result;
  }
  version++;
  const saved = saveState();
  markDirty();
  if (undoLabel) {
    undoStack.push({ label: undoLabel, recs: d.recs, settings: d.settings });
    if (undoStack.length > UNDO_MAX) undoStack.shift();
  }
  emit({ source: 'local', undoLabel, saved, ids: d.recs.map(r => r.id) });
  return result;
}

/** 最近一次可撤销的修改的 label（没有 → null） */
export const peekUndo = () => (undoStack.length ? undoStack[undoStack.length - 1].label : null);

/** 撤销：把那次改过的字段改回旧值（盖上新的修改时间，同步时会赢）；之后别的设备改的其它字段留着。撤销「新建」= 软删除 */
export function undo() {
  if (storageFault) return null;
  const u = undoStack.pop();
  if (!u) return null;
  const now = Date.now();
  const ids = [];
  for (const { c, id, prev, keys } of u.recs) {
    if (!isObj(S.data[c])) S.data[c] = {};
    const cur = S.data[c][id];
    let next;
    if (prev && cur && keys) {
      next = { ...cur };
      for (const k of keys) { if (prev[k] === undefined) delete next[k]; else next[k] = structuredClone(prev[k]); }
      next = stamp(next, cur, now);
    } else if (prev) next = stamp(structuredClone(prev), cur, now);
    else if (cur && !cur.deleted) next = deletedRecord(cur, now);
    else continue;
    S.data[c][id] = normalizeRecord(c, next, id);
    ids.push(id);
  }
  for (const { k, had, prev } of u.settings) setSetting(S, k, had ? prev : undefined, now);
  version++;
  const saved = saveState();
  markDirty();
  emit({ source: 'undo', label: u.label, saved, ids });
  return u.label;
}

/** 同步合并出的新数据（已经包含本机的修改）：不算本机修改 @param {any} merged @param {Record<string, any>} [info] */
export function applyRemote(merged, info = {}) {
  if (storageFault) return false;
  S = ensureSeeds(normalizeState(merged));
  const saved = saveState();
  emit({ ...info, source: 'remote', saved, ids: [] });
  return saved;
}

/** 导入备份：逐条合并，较新的为准，不会删掉本机的记录 @param {any} other */
export function mergeIn(other) {
  if (storageFault) throw storageFault;
  const before = S;
  const next = ensureSeeds(mergeStates(S, normalizeState(other)));
  const ids = changedIds(before, next);
  const settingsChanged = canon(before.settings) !== canon(next.settings);
  if (!ids.length && !settingsChanged) return { changed: 0 };
  S = next;
  version++;
  const saved = saveState();
  markDirty();
  emit({ source: 'merge', saved, ids });
  return { changed: ids.length };
}
