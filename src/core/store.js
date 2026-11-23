// @ts-check
// 数据层：state.data 下每个集合都是「id → 记录」——lists 清单、items 清单里的东西、stores 商店、categories 分类、memory 买过的东西。
// 每条记录有 updatedAt（毫秒）；删除只打 deleted 标记、内容保留（「最近删除」里能恢复，也照样同步）。
// 多台设备合并时逐条比较 updatedAt 取较新的一整条；时间相同内容不同时按 canon() 排序取一份，保证每台设备结果一样。
// 例外：items、memory 的 id 是算出来的，两台设备各自从头建的同一条（createdAt 不一样）要补上空着的字段（mergeRecord）。
// 设置按键合并，各键有自己的修改时间（settingsAt）。不认识的字段、集合原样保留：旧版 App 同步时不会弄丢新版的数据。
// 预置的清单、商店、分类用固定 id、updatedAt 0，由 ensureSeeds() 补。细节见 docs/DATA_MODEL.md。
import { isObj, str, own, safeKey } from './util.js';
import { toSimplified } from './hanzi.js';

/**
 * @typedef {object} Base 所有记录都有的字段
 * @property {string} id
 * @property {number} createdAt
 * @property {number} updatedAt   改动一律经过 stamp()：比上一版至少新 1 毫秒；预置记录是 0
 * @property {true} [deleted]     软删除：内容保留，照样同步
 * @property {number} [deletedAt]
 */
/** @typedef {'grocery' | 'general'} ListKind */
/** @typedef {'need' | 'done' | 'later'} ItemStatus */
/**
 * @typedef {Base & { sys: string | null, name: string, kind: ListKind, icon: string, glyph: string, color: string, order: number,
 *   defaultStoreId: string | null, archived: boolean }} List
 * 清单。sys：预置清单的标记（'groceries' | 'tobuy'），name 为空时显示界面语言的文案。
 * icon：自己写的图标（一个 emoji 或一两个字）；glyph：画好的图标名；都空的按类型默认；color：色调名，空的按类型默认（core/listIcons.js）
 */
/**
 * @typedef {Base & { listId: string, name: string, qty: number | null, unit: string, note: string,
 *   categoryId: string | null, storeId: string | null, status: ItemStatus, doneAt: number | null,
 *   url: string, price: number | null, needs: Record<string, any>, fromLater?: true }} Item
 * 清单里的一样东西。needs 是给以后的食谱 / 计划预留的（来源 → { qty, unit, label }），V1 不用但原样保留。
 * fromLater：从「以后再说」勾成已买的（取消勾选时回以后再说）；只在已买时有
 */
/** @typedef {Base & { name: string, order: number, archived: boolean }} Store 商店 */
/** @typedef {Base & { sys: string | null, name: string, kind: ListKind | null, order: number }} Category 分类 */
/**
 * @typedef {Base & { name: string, kind: ListKind, categoryId: string | null, categorySet?: true, unit: string, qty: number | null,
 *   stores: Record<string, { n: number, at: number }>, uses: number, lastAt: number }} Memory
 * 买过的东西（跨清单的习惯），每个 normName 一条，id = 'm_' + hash64(normName)。
 * categorySet：用户在编辑面板里选过分类（包括「未分类」）；没选过的记录上没有这个键
 */
/**
 * @typedef {object} State
 * @property {'picknest'} app
 * @property {1} v
 * @property {{ lists: Record<string, List>, items: Record<string, Item>, stores: Record<string, Store>,
 *   categories: Record<string, Category>, memory: Record<string, Memory>, [collection: string]: Record<string, any> }} data
 * @property {Record<string, any>} settings     同步的设置（按键合并）
 * @property {Record<string, number>} settingsAt 各设置键的修改时间
 */
/** @typedef {(key: string, vars?: Record<string, any>) => string} Translate */

export const COLLECTIONS = ['lists', 'items', 'stores', 'categories', 'memory'];
// kind、status 认不出的取值按默认值读（下面的整理函数），改过以后会照默认值写回去。
// 以后要加新的取值（比如「项目」清单）：用新字段表达，或者同时升 v（旧版会拒绝读、不会改坏），不要直接往这几个字段里塞新值
/** @type {ListKind[]} */
export const LIST_KINDS = ['grocery', 'general'];
/** @type {ItemStatus[]} */
export const ITEM_STATUS = ['need', 'done', 'later'];
// V1 还没有同步的设置（语言、主题这些是本机设置，在 picknest.local）；以后加的设置在这里给默认值
export const DEFAULT_SETTINGS = Object.freeze({});

/** @param {any[]} states */
const collectionsOf = (...states) => [...new Set([...COLLECTIONS, ...states.flatMap(s => Object.keys((s && isObj(s.data) && s.data) || {}))])].filter(safeKey);

/** @returns {State} */
export function blankState() {
  return { app: 'picknest', v: 1, data: { lists: {}, items: {}, stores: {}, categories: {}, memory: {} }, settings: { ...DEFAULT_SETTINGS }, settingsAt: {} };
}

/** 和键的顺序无关的序列化：判断两份数据是否一样，以及打平时决定取哪一份 @param {any} v @returns {string} */
export function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  }
  return JSON.stringify(v === undefined ? null : v);
}

// ---------- 整理一条记录：修得好的修好，用户写的文字一个字都不改 ----------
const DANGER = new Set(['__proto__', 'constructor', 'prototype']);
/**
 * 复制自有字段，去掉 __proto__ 之类：JSON.parse 会把 "__proto__" 当成普通的键，再赋值给别的对象就成了改原型
 * @param {Record<string, any>} o
 * @returns {Record<string, any>}
 */
function copySafe(o) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const k of Object.keys(o)) if (!DANGER.has(k)) out[k] = o[k];
  return out;
}
/** 数字或能读成数字的字符串 → 数字；别的 → null @param {unknown} v @returns {number | null} */
const numOrNull = v => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
/** 毫秒时刻：不是非负数就当 0 @param {unknown} v */
const time = v => { const n = numOrNull(v); return n != null && n >= 0 ? n : 0; };
/** 次数：非负整数 @param {unknown} v */
const count = v => { const n = numOrNull(v); return n != null && n > 0 ? Math.floor(n) : 0; };
/** @param {unknown} v */
const idOrNull = v => (safeKey(v) ? v : null);
/** @param {unknown} v */
const sysOrNull = v => (typeof v === 'string' && v ? v : null);      // 新版可能有新的预置标记：认不出也留着，显示时退回「未命名」

/**
 * 所有记录共同的字段。createdAt 只在缺了 / 坏了时补成 updatedAt：预置记录的 createdAt 是 0，用户改过以后也要还是 0（清单按 order、createdAt 排）
 * @param {Record<string, any>} rec
 * @param {string} id
 */
function base(rec, id) {
  const r = copySafe(rec);
  r.id = id;
  r.updatedAt = time(rec.updatedAt);
  const c = numOrNull(rec.createdAt);
  r.createdAt = c != null && c >= 0 ? c : r.updatedAt;
  if (r.deleted) { r.deleted = true; r.deletedAt = time(rec.deletedAt) || r.updatedAt; }
  else { delete r.deleted; delete r.deletedAt; }
  return r;
}

/** @param {Record<string, any>} rec @param {string} [id] @returns {List} */
export function normalizeList(rec, id = rec && rec.id) {
  const r = base(rec, /** @type {string} */ (id));
  r.sys = sysOrNull(r.sys);
  r.name = str(r.name);
  r.kind = LIST_KINDS.includes(r.kind) ? r.kind : r.sys === 'groceries' ? 'grocery' : 'general';
  r.icon = str(r.icon);
  // 画好的图标单独一个字段（旧版只认 icon，见 core/listIcons.js 开头）；认不出的名字也原样留着
  r.glyph = str(r.glyph);
  // 色调认不出的（新版才有的）也原样留着，显示时按默认（core/listIcons.js 的 listLook）：旧版改名字时不会把它冲掉
  r.color = str(r.color);
  r.order = numOrNull(r.order) ?? 0;
  r.defaultStoreId = idOrNull(r.defaultStoreId);
  r.archived = r.archived === true;
  return /** @type {List} */ (r);
}

/** qty 没写（旧记录、手写的数据）当成新加的默认 1；写了 null 是「不写数量」，要保留 @param {Record<string, any>} rec @param {string} [id] @returns {Item} */
export function normalizeItem(rec, id = rec && rec.id) {
  const r = base(rec, /** @type {string} */ (id));
  r.listId = str(r.listId);
  r.name = str(r.name);
  r.qty = r.qty === undefined ? 1 : numOrNull(r.qty);
  r.unit = str(r.unit);
  r.note = str(r.note);
  r.categoryId = idOrNull(r.categoryId);
  r.storeId = idOrNull(r.storeId);
  r.status = ITEM_STATUS.includes(r.status) ? r.status : 'need';
  r.doneAt = numOrNull(r.doneAt);
  r.url = str(r.url);
  r.price = numOrNull(r.price);
  r.needs = isObj(r.needs) ? copySafe(r.needs) : {};     // 预留给食谱 / 计划：里面是什么都原样留着
  if (r.fromLater !== true || r.status !== 'done') delete r.fromLater;   // 从「以后再说」勾掉的已买（items.js 的 untickStatus）：只在已买时有
  return /** @type {Item} */ (r);
}

/** @param {Record<string, any>} rec @param {string} [id] @returns {Store} */
export function normalizeStore(rec, id = rec && rec.id) {
  const r = base(rec, /** @type {string} */ (id));
  r.name = str(r.name);
  r.order = numOrNull(r.order) ?? 0;
  r.archived = r.archived === true;
  return /** @type {Store} */ (r);
}

/** @param {Record<string, any>} rec @param {string} [id] @returns {Category} */
export function normalizeCategory(rec, id = rec && rec.id) {
  const r = base(rec, /** @type {string} */ (id));
  r.sys = sysOrNull(r.sys);
  r.name = str(r.name);
  r.kind = LIST_KINDS.includes(r.kind) ? r.kind : null;
  r.order = numOrNull(r.order) ?? 0;
  return /** @type {Category} */ (r);
}

/** @param {Record<string, any>} rec @param {string} [id] @returns {Memory} */
export function normalizeMemory(rec, id = rec && rec.id) {
  const r = base(rec, /** @type {string} */ (id));
  r.name = str(r.name);
  r.kind = LIST_KINDS.includes(r.kind) ? r.kind : 'grocery';
  r.categoryId = idOrNull(r.categoryId);
  if (r.categorySet !== true) delete r.categorySet;     // 只在选过时才有：没选过的记录不用每条都多一个 false
  r.unit = str(r.unit);
  r.qty = numOrNull(r.qty);
  /** @type {Record<string, any>} */
  const stores = {};
  if (isObj(r.stores)) for (const [sid, v] of Object.entries(r.stores)) if (safeKey(sid) && isObj(v)) stores[sid] = { ...copySafe(v), n: count(v.n), at: time(v.at) };
  r.stores = stores;
  r.uses = count(r.uses);
  r.lastAt = time(r.lastAt);
  return /** @type {Memory} */ (r);
}

/** @type {Record<string, (rec: Record<string, any>, id?: string) => any>} */
const NORMALIZERS = { lists: normalizeList, items: normalizeItem, stores: normalizeStore, categories: normalizeCategory, memory: normalizeMemory };

/**
 * 按集合整理一条记录。不认识的集合（新版才有的）只修 id 和 updatedAt，别的原样保留
 * @param {string} collection
 * @param {Record<string, any>} rec
 * @param {string} [id]
 */
export function normalizeRecord(collection, rec, id = rec && rec.id) {
  const fn = own(NORMALIZERS, collection);
  return fn ? fn(rec, id) : { ...copySafe(rec), id, updatedAt: time(rec.updatedAt) };
}

/** 设置补齐默认值；不认识的键原样保留 @param {unknown} src */
function normSettings(src) {
  /** @type {Record<string, any>} */
  const s = { ...DEFAULT_SETTINGS };
  if (isObj(src)) for (const [k, v] of Object.entries(src)) if (safeKey(k)) s[k] = v;
  return s;
}

/**
 * 读入本地、云端或备份里的数据时的整理：丢掉不是对象的记录和危险的键，补齐字段。不补预置记录（那是 ensureSeeds 的事）
 * @param {any} s
 * @returns {State}
 */
export function normalizeState(s) {
  const out = blankState();
  if (!isObj(s)) return out;
  const data = isObj(s.data) ? s.data : {};
  for (const c of collectionsOf(s)) {
    const src = own(data, c);
    if (src !== undefined && !isObj(src)) continue;
    // 集合名可能是 toString、hasOwnProperty 这种原型上就有的名字：只认自有的，不然会把记录写到内置函数上
    out.data[c] = own(out.data, c) || {};
    for (const [id, rec] of Object.entries(src || {})) {
      if (!isObj(rec) || !safeKey(id)) continue;
      out.data[c][id] = normalizeRecord(c, rec, id);
    }
  }
  out.settings = normSettings(s.settings);
  if (isObj(s.settingsAt)) for (const [k, t] of Object.entries(s.settingsAt)) if (safeKey(k) && Number(t) > 0) out.settingsAt[k] = Number(t);
  return out;
}

/**
 * 一个数据文件的外壳对不对：{ app, v: 1, state: { data… } }——同步仓库里的 picknest.json、备份、出错时下载的原始数据都是这个形状。
 * 不是这个 App 的（或者根本读不出来）→ 'notApp'；新版 App 写的（v 比 1 大：旧版读了会改坏，见 docs/DATA_MODEL.md）→ 'newer'；
 * 缺了 state、版本号不对 → 'bad'；能读 → null。里面的记录由 normalizeState 整理
 * @param {any} d @param {string} [app]
 */
export function fileProblem(d, app = 'picknest') {
  if (!isObj(d) || d.app !== app) return 'notApp';
  if (Number(d.v) > 1 || (isObj(d.state) && Number(d.state.v) > 1)) return 'newer';
  if (d.v !== 1 || !isObj(d.state) || (d.state.app !== undefined && d.state.app !== app) || (d.state.v !== undefined && d.state.v !== 1)) return 'bad';
  if (d.state.data !== undefined && !isObj(d.state.data)) return 'bad';
  return null;
}

/** 同一条记录的两份取哪份：新的；一样新就按内容排，每台设备选的都一样 @param {any} a @param {any} b */
export function pick(a, b) {
  if (!a) return b;
  if (!b) return a;
  if ((b.updatedAt || 0) !== (a.updatedAt || 0)) return (b.updatedAt || 0) > (a.updatedAt || 0) ? b : a;
  return canon(b) > canon(a) ? b : a;
}

// ---------- 各自从头建的同一条（固定 id） ----------
// items（按清单 + 名字）和 memory（按名字）的 id 是算出来的：一台设备还没拉到云端那条（新 iPad 还没粘贴同步码、Safari 清掉了存储、
// 店里离线）就又加了同名的，建的是一条空白的新记录，时间更新。整条取较新的话，云端那条的备注、链接、价格、常去的商店、记住的单位
// 就永远没了——云端那条可能是几个月前的，不是「两台设备同时改」。
// 认法：createdAt 不一样（同一条记录改来改去、恢复、移动，createdAt 都不变）。这时以较新的为底，它空着的字段用另一条的补上
// （memory 的次数、常去的商店取两边大的，选过的分类以较新的为准）；createdAt 取早的，以后两边就是同一条。
// 补到了东西的结果比较新的那条晚 1 毫秒：还拿着较新那条的设备合并时它赢；没补到东西就是较新的那条（再合并几次结果都一样）
const blank = (/** @type {unknown} */ v) => v == null || v === '' || (isObj(v) && !Object.keys(v).length);
const ITEM_CARRY = ['note', 'url', 'price', 'unit', 'storeId', 'categoryId', 'needs'];
/** @param {string} c @param {any} w 较新的 @param {any} o 另一条 @returns {any} */
function blend(c, w, o) {
  if (c === 'items') {
    // 同一个 id 上是另一样东西（那条改过名、移到了别的清单）：不是同一样，照旧整条取较新的
    if (w.listId !== o.listId || normName(w.name) !== normName(o.name)) return null;
    const out = { ...w };
    for (const k of ITEM_CARRY) if (blank(out[k]) && !blank(o[k])) out[k] = o[k];
    return out;
  }
  const ws = isObj(w.stores) ? w.stores : {}, os = isObj(o.stores) ? o.stores : {};
  /** @type {Record<string, any>} */
  const stores = { ...ws };
  for (const [sid, v] of Object.entries(os)) {
    if (!safeKey(sid) || !isObj(v)) continue;
    const cur = own(ws, sid);
    stores[sid] = isObj(cur) ? { ...cur, n: Math.max(cur.n || 0, v.n || 0), at: Math.max(cur.at || 0, v.at || 0) } : v;
  }
  const out = { ...w, stores, uses: Math.max(w.uses || 0, o.uses || 0), lastAt: Math.max(w.lastAt || 0, o.lastAt || 0) };
  if (w.categorySet !== true && o.categorySet === true) { out.categoryId = o.categoryId; out.categorySet = true; }
  if (blank(out.unit) && !blank(o.unit)) out.unit = o.unit;
  if (out.qty == null && o.qty != null) out.qty = o.qty;
  return out;
}

/**
 * 同一条记录的两份合并成一份（顺序无关）：一般是 pick（较新的一整条）；items、memory 里各自从头建的两条（createdAt 不一样）补上空着的字段，见上面
 * @param {string} c @param {any} a @param {any} b
 */
export function mergeRecord(c, a, b) {
  const w = pick(a, b);
  if (!a || !b || (c !== 'items' && c !== 'memory')) return w;
  const o = w === a ? b : a;
  const wc = Number(w.createdAt), oc = Number(o.createdAt);
  if (!(wc >= 0) || !(oc >= 0) || wc === oc) return w;
  const out = blend(c, w, o);
  if (!out) return w;
  out.createdAt = Math.min(wc, oc);
  if (canon({ ...out, createdAt: w.createdAt }) !== canon(w)) out.updatedAt = (w.updatedAt || 0) + 1;
  return out;
}

/**
 * 两份数据逐条合并（顺序无关：merge(a,b) 和 merge(b,a) 结果一样）。不补预置记录：合并完由调用的地方 ensureSeeds
 * @param {any} a
 * @param {any} b
 * @returns {State}
 */
export function mergeStates(a, b) {
  const out = blankState();
  const da = (a && isObj(a.data) && a.data) || {}, db = (b && isObj(b.data) && b.data) || {};
  for (const c of collectionsOf(a, b)) {
    out.data[c] = own(out.data, c) || {};
    const ids = new Set([...Object.keys(own(da, c) || {}), ...Object.keys(own(db, c) || {})]);
    for (const id of ids) if (safeKey(id)) out.data[c][id] = mergeRecord(c, own(own(da, c), id), own(own(db, c), id));
  }
  const sa = (a && a.settings) || {}, sb = (b && b.settings) || {}, ta0 = (a && a.settingsAt) || {}, tb0 = (b && b.settingsAt) || {};
  /** @type {Record<string, any>} */
  const settings = {};
  const keys = new Set([...Object.keys(sa), ...Object.keys(sb), ...Object.keys(ta0), ...Object.keys(tb0)]);
  for (const k of keys) {
    if (!safeKey(k)) continue;
    const ta = own(ta0, k) || 0, tb = own(tb0, k) || 0;
    const from = tb > ta ? sb : ta > tb ? sa : (canon(own(sb, k)) > canon(own(sa, k)) ? sb : sa);
    if (own(from, k) !== undefined) settings[k] = own(from, k);
    if (ta || tb) out.settingsAt[k] = Math.max(ta, tb);
  }
  out.settings = normSettings(settings);
  return out;
}

/**
 * 新的或改过的记录：盖上修改时间（比旧的至少新 1 毫秒，同一毫秒改两次也分得出先后）
 * @template {Record<string, any>} T
 * @param {T} rec
 * @param {{ updatedAt?: number } | null | undefined} prev
 * @param {number} [now]
 * @returns {T & { updatedAt: number }}
 */
export function stamp(rec, prev, now = Date.now()) {
  return { ...rec, updatedAt: Math.max(now, ((prev && prev.updatedAt) || 0) + 1) };
}

/**
 * core 里的操作函数（items.js、lists.js、memory.js，都在 ctx.mutate 里调用）写一条记录：整理字段；
 * 内容和原来一样就不动（不盖新时间，重新排序时没挪动的清单不算修改），变了才 stamp。返回存好的记录
 * @param {State} state @param {string} collection @param {Record<string, any>} rec 整条记录（改的时候是 { ...旧的, ...改动 }）
 * @param {number} [now]
 */
export function writeRecord(state, collection, rec, now = Date.now()) {
  const id = rec.id;
  if (!safeKey(collection) || !safeKey(id)) throw new Error('bad-id');
  if (!isObj(own(state.data, collection))) state.data[collection] = {};
  const col = state.data[collection];
  const prev = own(col, id);
  const next = normalizeRecord(collection, { ...rec, id, updatedAt: prev ? prev.updatedAt : now }, id);
  if (prev && canon(next) === canon(prev)) return prev;
  return (col[id] = normalizeRecord(collection, stamp(next, prev, now), id));
}

/** 软删除：内容保留，照样同步，在「最近删除」里能恢复 @param {any} rec @param {number} [now] */
export function deletedRecord(rec, now = Date.now()) {
  return rec && !rec.deleted ? stamp({ ...rec, deleted: true, deletedAt: now }, rec, now) : null;
}

/** 恢复：去掉删除标记，修改时间晚于删除（别的设备上旧的删除不会再盖过来） @param {any} rec @param {number} [now] */
export function restoredRecord(rec, now = Date.now()) {
  if (!rec || !rec.deleted) return null;
  const { deleted, deletedAt, ...r } = rec;
  return stamp(r, rec, now);
}

/** 生成记录 id：前缀 + 时间 + 随机，几台设备同时新建也不会撞 @param {string} prefix */
export function newId(prefix) {
  const rnd = (globalThis.crypto && crypto.getRandomValues) ? [...crypto.getRandomValues(new Uint8Array(6))].map(b => b.toString(36).padStart(2, '0')).join('') : Math.random().toString(36).slice(2, 12);
  return prefix + Date.now().toString(36) + rnd;
}

/**
 * 改一项设置（直接改 state），修改时间比旧的至少新 1 毫秒。返回是否真的变了
 * @param {State} state @param {string} key @param {any} value @param {number} [now]
 */
export function setSetting(state, key, value, now = Date.now()) {
  if (!safeKey(key) || canon(state.settings[key]) === canon(value)) return false;
  if (value === undefined) delete state.settings[key]; else state.settings[key] = value;
  state.settingsAt[key] = Math.max(now, (state.settingsAt[key] || 0) + 1);
  return true;
}

// ---------- 预置数据 ----------
export const SYS_LISTS = ['groceries', 'tobuy'];
// 商店名是专有名词，直接写名字（不经过 t()）
export const SEED_STORES = [
  ['s_wholefoods', 'Whole Foods'], ['s_traderjoes', "Trader Joe's"], ['s_costco', 'Costco'], ['s_target', 'Target'],
  ['s_hmart', 'H Mart'], ['s_99ranch', '99 Ranch'], ['s_amazon', 'Amazon'], ['s_homedepot', 'The Home Depot'],
];
export const GROCERY_CATEGORIES = ['produce', 'meat', 'dairy', 'bakery', 'frozen', 'pantry', 'condiments', 'snacks', 'household'];
export const GENERAL_CATEGORIES = ['clothing', 'books', 'tools', 'electronics', 'home'];
export const SYS_CATEGORIES = [...GROCERY_CATEGORIES, ...GENERAL_CATEGORIES];

/**
 * 预置记录（每次调用都是新对象，改了不影响下次）。固定 id：两台设备各自初始化，同步后不会有两份「食材」；
 * createdAt / updatedAt 都是 0：用户的任何修改都比它新，另一台设备晚些初始化也盖不掉
 * @returns {{ lists: List[], stores: Store[], categories: Category[] }}
 */
export function seedRecords() {
  const at = { createdAt: 0, updatedAt: 0 };
  return {
    lists: [
      { id: 'l_groceries', sys: 'groceries', name: '', kind: 'grocery', icon: '', glyph: '', color: '', order: 0, defaultStoreId: 's_wholefoods', archived: false, ...at },
      { id: 'l_tobuy', sys: 'tobuy', name: '', kind: 'general', icon: '', glyph: '', color: '', order: 1, defaultStoreId: null, archived: false, ...at },
    ],
    stores: SEED_STORES.map(([id, name], i) => ({ id, name, order: i, archived: false, ...at })),
    categories: SYS_CATEGORIES.map((sys, i) => ({ id: 'c_' + sys, sys, name: '', kind: GROCERY_CATEGORIES.includes(sys) ? 'grocery' : 'general', order: i, ...at })),
  };
}

/**
 * 补上缺的预置记录（直接改 state，返回同一个 state）。已经有的——包括删掉的、改过的——都不动，所以删掉的预置商店不会自己回来；
 * 重复调用结果不变。加载后、每次合并后调用；不要放在 mutate 里（mutate 会给 updatedAt 0 的新记录盖上现在的时间）
 * @param {State} state
 */
export function ensureSeeds(state) {
  for (const [c, recs] of Object.entries(seedRecords())) {
    if (!isObj(state.data[c])) state.data[c] = {};
    const col = state.data[c];
    for (const rec of recs) if (own(col, rec.id) === undefined) col[rec.id] = normalizeRecord(c, rec, rec.id);
  }
  return state;
}

// ---------- 名字和固定 id ----------
/**
 * 比较名字用：NFKC（全角字母数字、全角空格变半角）→ 去首尾空格 → 连续空白合成一个 → 小写 → 繁体折成简体。
 * 只用来比较和算 id，不改用户写的名字
 * @param {unknown} s
 */
export function normName(s) {
  return toSimplified(str(s).normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase());
}

const B36 = '0123456789abcdefghijklmnopqrstuvwxyz';
/**
 * FNV-1a 64 位（按 UTF-8 字节），结果写成 base36。用两个 32 位的半边算，不用 BigInt：
 * 乘以 FNV 质数 2^40 + 0x1b3 = 低半边 × 0x1b3（不超过 2^41，double 算得准）再把低半边左移 8 位加到高半边
 * @param {string} s
 */
export function hash64(s) {
  let hi = 0xcbf29ce4, lo = 0x84222325;
  for (const b of new TextEncoder().encode(str(s))) {
    lo = (lo ^ b) >>> 0;
    const p = lo * 0x1b3;
    hi = (Math.imul(hi, 0x1b3) + Math.floor(p / 0x100000000) + (lo << 8)) >>> 0;
    lo = p >>> 0;
  }
  // 64 位整数超出 double 的精度：拆成四段 16 位，做长除法转 base36
  let parts = [hi >>> 16, hi & 0xffff, lo >>> 16, lo & 0xffff], out = '';
  while (parts.some(x => x)) {
    let rem = 0;
    parts = parts.map(x => { const cur = rem * 0x10000 + x; rem = cur % 36; return Math.floor(cur / 36); });
    out = B36[rem] + out;
  }
  return out || '0';
}

/**
 * 同一张清单里同名的东西用同一条记录，返回它的 id（调用的地方拿到后：有这条就恢复 / 提示已经在清单上，没有就新建）。
 * 先找这张清单里同名的记录（已买、已清除也算），而不是只看固定 id 那一格：改名改成「牛奶」的、从别的清单移过来的、
 * 以前固定 id 被占时分到随机 id 的，都已经是「这张清单里的牛奶」，再加一次不能又多出一条。
 * 同名的有几条时：没删除的优先（不然恢复一条删掉的，清单上就有两条一样的），再固定 id 优先，再按 id 排（每台设备选的一样）。
 * 都没有：用固定 id 'i_' + hash64(listId + '\n' + normName(name))（两台设备离线各加一次，同步后还是一条）；
 * 这一格被别的东西占了（那条改过名或移走了）：hash64(listId + '\n' + 名字 + '\n' + n) 里第一个空着的（同样每台设备算的一样）
 * @param {State} state
 * @param {string} listId
 * @param {string} name
 * @returns {string}
 */
export function itemId(state, listId, name) {
  // 以前的写法是 itemId(listId, name)：少传 state 不会报错，只会算出一个看着正常、其实不对的 id，所以这里直接拦下
  if (!isObj(state) || !isObj(state.data) || typeof listId !== 'string') throw new TypeError('itemId(state, listId, name)');
  const key = normName(name);
  const id = 'i_' + hash64(listId + '\n' + key);
  const items = isObj(state.data.items) ? state.data.items : {};
  /** @type {[string, any][]} */
  const same = Object.entries(items).filter(([, r]) => isObj(r) && r.listId === listId && normName(r.name) === key);
  /** @param {[string, any][]} recs */
  const choose = recs => (!recs.length ? null : recs.some(([k]) => k === id) ? id : recs.map(([k]) => k).sort()[0]);
  const found = choose(same.filter(([, r]) => !r.deleted)) || choose(same.filter(([, r]) => r.deleted));
  if (found) return found;
  if (!own(items, id)) return id;
  // 固定 id 被别的东西占了：也用算出来的（第 1、2…… 个空位），不用随机的——两台设备同步过的数据一样，离线各加一次还是同一个 id，同步后是一条
  for (let n = 1; n < 1000; n++) { const alt = 'i_' + hash64(listId + '\n' + key + '\n' + n); if (!own(items, alt)) return alt; }
  return newId('i_');
}

// ---------- 显示和排序 ----------
/** 清单的显示名：用户写的名字 → 预置清单的文案 → 「未命名清单」。t 由调用的地方给（core 不依赖界面语言） @param {List} list @param {Translate} t */
export function listName(list, t) {
  const name = str(list && list.name).trim();
  if (name) return name;
  return list && list.sys && SYS_LISTS.includes(list.sys) ? t('list.sys.' + list.sys) : t('list.untitled');
}
/** 分类的显示名：用户写的名字 → 预置分类的文案 → 「未命名分类」 @param {Category} cat @param {Translate} t */
export function categoryName(cat, t) {
  const name = str(cat && cat.name).trim();
  if (name) return name;
  return cat && cat.sys && SYS_CATEGORIES.includes(cat.sys) ? t('cat.sys.' + cat.sys) : t('cat.untitled');
}

/** 排序：order，再 createdAt，再 id（保证每台设备一样） @param {{ order: number, createdAt: number, id: string }} a @param {{ order: number, createdAt: number, id: string }} b */
export function byOrder(a, b) {
  return (a.order - b.order) || (a.createdAt - b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
/**
 * 「编辑」里的 ↑↓（首页的清单、设置里的商店和分类共用）：arr 是一起排顺序的全部记录（没删除的，归档的也在里面，按 byOrder 排好），
 * id 这一条挪到它前面 / 后面第一条 peer 为真的记录（首页、商店：没归档的；分类：同一组的，几组在 arr 里是穿插的）的另一边。
 * 只改这一条的 order：取新位置前后两条的中间值（可以是小数），别的记录一条也不动。合并是整条取较新的，白盖一个新时间
 * 就会盖过别的设备上对那一条的删除（预置记录靠 updatedAt 0 表示没人改过）；按 0、1、2…… 重写的话，中间夹着一条归档的
 * 或者跳过了别的组，后面的就全跟着变。归档的也要在 arr 里：不然它占着的 order 会被当成空位，取消归档以后和挪过来的撞在一起。
 * 前后两条的 order 一样（两台设备各自新建了一条）或者中间值已经分不开（同一处挪了很多次）时，才把 arr 写成 0、1、2……（只盖变了的）。
 * 挪不动（到头了、不在 arr 里、自己不是 peer：归档的清单 / 商店不排）返回 false
 * @param {State} state @param {string} collection @param {{ id: string, order: number }[]} arr @param {string} id @param {1 | -1} dir
 * @param {(r: any) => boolean} [peer] @param {number} [now]
 */
export function moveInOrder(state, collection, arr, id, dir, peer = () => true, now = Date.now()) {
  const list = [...arr];
  const i = list.findIndex(r => r.id === id);
  if (i < 0 || !peer(list[i])) return false;
  let j = i + dir;
  while (j >= 0 && j < list.length && !peer(list[j])) j += dir;
  if (j < 0 || j >= list.length) return false;
  const [r] = list.splice(i, 1);
  // 拿掉它以后插到 j：往下挪时 list[j - 1] 是越过的那一条，往上挪时 list[j] 是
  const lo = list[j - 1], hi = list[j];
  const order = lo && hi ? (lo.order + hi.order) / 2 : lo ? lo.order + 1 : hi ? hi.order - 1 : 0;
  if ((!lo || lo.order < order) && (!hi || order < hi.order)) {
    writeRecord(state, collection, { ...r, order }, now);
    return true;
  }
  list.splice(j, 0, r);
  list.forEach((x, k) => { if (x.order !== k) writeRecord(state, collection, { ...x, order: k }, now); });
  return true;
}

/** 一个集合里没删除的记录（数组，无序） @param {State} state @param {string} collection */
export const live = (state, collection) => Object.values((state && state.data && state.data[collection]) || {}).filter(r => !r.deleted);
/** 首页显示的清单：没删除、没归档，按顺序 @param {State} state @returns {List[]} */
export const homeLists = state => live(state, 'lists').filter(l => !l.archived).sort(byOrder);
/** 每张清单还要买几样（status 'need'、没删除）：listId → 数量 @param {State} state */
export function needCounts(state) {
  /** @type {Map<string, number>} */
  const m = new Map();
  for (const it of live(state, 'items')) if (it.status === 'need') m.set(it.listId, (m.get(it.listId) || 0) + 1);
  return m;
}
