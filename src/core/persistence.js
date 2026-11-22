// @ts-check
// 本机数据：每次改动先写一条独立日志（picknest.pending.*），才算保存成功。各标签页不覆盖彼此的日志。
// picknest.state 是快照；只有持有 Web Lock 的整理任务能更新它，写成功后才删已合并的日志。
// 整理前被关掉、快照写不下或浏览器没有 Web Locks 都不丢数据：下次读取仍会合并日志。
// 同一个 github.io 域名下还有别的 App（babble、房屋账本……），所有键都带 picknest. 前缀。
import { canon, mergeStates, normalizeState } from './store.js';
import { isObj, own } from './util.js';

/** @typedef {import('./store.js').State} State */
/** @typedef {Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>} StorageLike */
/** @typedef {{ request: (name: string, fn: () => any) => Promise<any> }} LocksLike */

export const STATE_KEY = 'picknest.state';
export const PENDING_PREFIX = 'picknest.pending.';
export const STATE_LOCK = 'picknest-state-write';
export const ARCHIVE_PREFIX = 'picknest.recovery.';
const APP = 'picknest';

/** 本机数据读不出来（坏了）：带着读得出来的部分（state）和原件（records），给恢复页用 */
export class LocalDataError extends Error {
  /** @param {State} state @param {{ key: string, raw: string }[]} records @param {string[]} issues */
  constructor(state, records, issues) {
    super('local-data-damaged');
    this.code = 'corrupt'; this.state = state; this.records = records; this.issues = issues;
  }
}
/** @param {any} value */
const validState = value => isObj(value) && (value.app === undefined || value.app === APP)
  && (value.v === undefined || value.v === 1) && (value.data === undefined || isObj(value.data))
  && (value.settings === undefined || isObj(value.settings)) && (value.settingsAt === undefined || isObj(value.settingsAt));
/** @param {string} raw @param {string} key @param {string[]} issues @param {boolean} [log] */
function decode(raw, key, issues, log = false) {
  try {
    const value = JSON.parse(raw);
    if (log ? !(isObj(value) && value.app === APP && value.v === 1 && validState(value.patch)) : !validState(value)) throw new Error('shape');
    const state = log ? value.patch : value;
    if (Object.values(state.data || {}).some(collection => !isObj(collection) || Object.values(collection).some(record => !isObj(record)))) issues.push(key);
    return state;                             // 局部结构坏了时仍能整理出完好的记录，原始文件保留供恢复
  } catch (e) { issues.push(key); return null; }
}
/** @param {any} value @param {string} key @param {string[]} issues */
function readable(value, key, issues) {
  try { return normalizeState(value); }
  catch (e) { issues.push(key); return normalizeState(null); } // 格式有效但字段无法整理，也保留整份原件供恢复
}

/** @param {StorageLike | null} storage */
function snapshot(storage) {
  if (!storage) return { state: normalizeState(null), logs: [], records: [], issues: [] };
  // 整理任务可能在另一个标签页更新快照、删除日志。快照变过就重读，不能拿旧快照搭配删过的日志。
  for (let attempt = 0; attempt < 5; attempt++) {
    const raw = storage.getItem(STATE_KEY);
    /** @type {string[]} */
    const issues = [];
    const records = raw === null ? [] : [{ key: STATE_KEY, raw }];
    let state = readable(raw === null ? null : decode(raw, STATE_KEY, issues), STATE_KEY, issues);
    const keys = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key && key.startsWith(PENDING_PREFIX)) keys.push(key);
    }
    const logs = [];
    for (const key of keys) {
      const value = storage.getItem(key);
      if (value === null) continue;
      records.push({ key, raw: value });
      const valuePatch = decode(value, key, issues, true);
      if (!valuePatch) continue;
      const count = issues.length;
      const patch = readable(valuePatch, key, issues);
      if (issues.length !== count) continue;
      // 日志没改的设置沿用当前值；缺省键不能在时间戳同为 0 时参与「谁赢」的比较。
      patch.settings = { ...state.settings, ...valuePatch.settings };
      patch.settingsAt = { ...state.settingsAt };
      for (const k of Object.keys(valuePatch.settings || {})) patch.settingsAt[k] = valuePatch.settingsAt?.[k] || 0;
      state = mergeStates(state, patch);
      logs.push(key);
    }
    if (storage.getItem(STATE_KEY) === raw) return { state: normalizeState(state), logs, records, issues };
  }
  throw new Error('local-state-busy');
}

/** @param {StorageLike | null} storage */
function checked(storage) {
  const result = snapshot(storage);
  if (result.issues.length) throw new LocalDataError(result.state, result.records, result.issues);
  return result;
}
/** 快照 + 所有日志合并后的数据；有读不出来的就抛 LocalDataError @param {StorageLike | null} storage */
export const readStoredState = storage => checked(storage).state;

/** 只记录还没落盘的记录和设置；不重复保存整本，令牌也不在这里（在 picknest.local） @param {State} before @param {State} after */
function changes(before, after) {
  /** @type {{ data: Record<string, Record<string, any>>, settings: Record<string, any>, settingsAt: Record<string, number> }} */
  const patch = { data: {}, settings: {}, settingsAt: {} };
  for (const [collection, records] of Object.entries(after.data)) {
    const changed = Object.fromEntries(Object.entries(records).filter(([id, value]) => canon(value) !== canon(own(own(before.data, collection), id))));   // 集合名可能是 toString 之类：只认自有的
    if (Object.keys(changed).length) patch.data[collection] = changed;
  }
  for (const key of Object.keys(after.settings)) {
    if (canon(after.settings[key]) === canon(before.settings[key]) && after.settingsAt[key] === before.settingsAt[key]) continue;
    patch.settings[key] = after.settings[key];
    if (after.settingsAt[key]) patch.settingsAt[key] = after.settingsAt[key];
  }
  return Object.keys(patch.data).length || Object.keys(patch.settings).length ? patch : null;
}

/**
 * @param {StorageLike | null} storage
 * @param {{ locks?: LocksLike | null }} [opts]
 */
export function createPersistence(storage, { locks = /** @type {any} */ (globalThis.navigator)?.locks } = {}) {
  const writer = globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2);
  let seq = 0, again = false;
  /** @type {Promise<void> | null} */
  let job = null;

  function compact() {
    if (!storage) return;
    const { state, logs } = checked(storage);
    if (!logs.length) return;
    storage.setItem(STATE_KEY, JSON.stringify(state));
    // 只删这次确实读到的日志；别的标签页此刻新写的日志留给下一次。
    for (const key of logs) storage.removeItem(key);
  }
  function schedule() {
    if (!storage || !locks?.request) return;
    const lk = locks;
    again = true;
    if (job) return;
    job = Promise.resolve().then(async () => {
      do {
        again = false;
        await lk.request(STATE_LOCK, compact);
      } while (again);
    }).catch(() => { /* 整理失败：已保存的日志原样保留，下次再试 */ }).finally(() => { job = null; });
  }

  return {
    /** @returns {State} */
    read() { const result = readStoredState(storage); schedule(); return result; },
    /** 写一条日志（只含和磁盘上不一样的记录），返回磁盘和内存合并后的数据 @param {State} state @returns {State} */
    save(state) {
      if (!storage) return state;
      const disk = readStoredState(storage);
      const merged = mergeStates(disk, state);
      const patch = changes(disk, merged);
      if (patch) storage.setItem(PENDING_PREFIX + writer + '.' + (++seq), JSON.stringify({ app: APP, v: 1, patch }));
      schedule();
      return merged;
    },
    /** 恢复页「下载原始数据」：读得出来的部分 + 每个键的原件 */
    evidence() {
      const { state, records, issues } = snapshot(storage);
      return { app: APP, v: 1, kind: 'local-recovery', exportedAt: new Date().toISOString(), state, records, issues };
    },
    /** 最近一次恢复前存的原始数据（没有 → null） */
    archive() {
      if (!storage) return null;
      const keys = [];
      for (let i = 0; i < storage.length; i++) { const key = storage.key(i); if (key?.startsWith(ARCHIVE_PREFIX)) keys.push(key); }
      for (const key of keys.sort().reverse()) {
        try { const data = JSON.parse(storage.getItem(key) || 'null'); if (data?.kind === 'local-recovery' && Array.isArray(data.records)) return data; } catch (e) { /* 保留损坏的旧存档，试下一份 */ }
      }
      return null;
    },
    /** 用读得出来的部分（和给的数据合并）换掉坏了的本机数据；先存档原件 @param {State} state @returns {Promise<State>} */
    async recover(state) {
      if (!storage || !locks?.request) throw new Error('recovery-unavailable');
      const st = storage;
      return locks.request(STATE_LOCK, () => {
        const { state: readableState, records, issues } = snapshot(st);
        const merged = mergeStates(readableState, normalizeState(state));
        const archive = { app: APP, v: 1, kind: 'local-recovery', exportedAt: new Date().toISOString(), state: readableState, records, issues };
        // 原始数据存档成功、并且新快照真正落盘后，才移走损坏的日志；任一步失败都留下原件。
        const archiveKey = ARCHIVE_PREFIX + Date.now() + '.' + writer + '.' + (++seq);
        st.setItem(archiveKey, JSON.stringify(archive));
        st.setItem(STATE_KEY, JSON.stringify(merged));
        for (const { key } of records) if (key.startsWith(PENDING_PREFIX)) st.removeItem(key);
        // 只留这一份存档：archive() 和「设置 → 备份与恢复」只给最新的，旧的下载不到，只占空间（同一个域名下的 App 共用一份配额，
        // 占满了以后每次保存都失败，连下一次恢复要写的存档也写不进去）
        const old = [];
        for (let i = 0; i < st.length; i++) { const key = st.key(i); if (key && key.startsWith(ARCHIVE_PREFIX) && key !== archiveKey) old.push(key); }
        for (const key of old) st.removeItem(key);
        return readStoredState(st);            // 整理期间新写入的日志也读回来
      });
    },
    async idle() { while (job) await job; },
  };
}
