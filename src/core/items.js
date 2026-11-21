// @ts-check
// 清单里的东西：快速添加（同一张清单里同名的是同一条，再加一次就恢复它）、勾掉 / 取消、以后再说、清除已买、移到别的清单、改一样东西。
// 写法统一：函数直接改传进来的 state（页面在 ctx.mutate 里调用，撤销、保存由 state.js 管），返回结果；
// 记录经过 writeRecord（内容没变的不盖新时间）或 deletedRecord（软删除），买过的东西的习惯记在 memory（memory.js）。
import { itemId, normName, writeRecord, deletedRecord, ITEM_STATUS } from './store.js';
import { own, isObj, str } from './util.js';
import { parseQuickAdd, readQty, QTY_MAX } from './parse.js';
import { catalogCategory } from './catalog.js';
import { memoryOf, usualStore, recordUse, recordPurchase, unrecordPurchase, recordPrefs } from './memory.js';

/** @typedef {import('./store.js').State} State */
/** @typedef {import('./store.js').Item} Item */
/** @typedef {import('./store.js').List} List */
/** @typedef {import('./store.js').ItemStatus} ItemStatus */

const col = (/** @type {State} */ s, /** @type {string} */ c) => (isObj(own(s.data, c)) ? s.data[c] : {});
/** 没删除的清单；没有 → null @param {State} state @param {unknown} id @returns {List | null} */
export function liveList(state, id) {
  const l = typeof id === 'string' ? own(col(state, 'lists'), id) : null;
  return l && !l.deleted ? l : null;
}
/** 没删除的东西；没有 → null @param {State} state @param {unknown} id @returns {Item | null} */
export function liveItem(state, id) {
  const it = typeof id === 'string' ? own(col(state, 'items'), id) : null;
  return it && !it.deleted ? it : null;
}
/** 商店在（没删除；归档的也算：已经指定给它的东西照常显示它的名字） @param {State} state @param {unknown} id */
export const storeExists = (state, id) => { const s = typeof id === 'string' ? own(col(state, 'stores'), id) : null; return !!s && !s.deleted; };
/** 能默认选上的商店：在、没归档 @param {State} state @param {unknown} id */
const pickableStore = (state, id) => { const s = typeof id === 'string' ? own(col(state, 'stores'), id) : null; return !!s && !s.deleted && !s.archived; };
/** 分类在（没删除） @param {State} state @param {unknown} id */
export const categoryExists = (state, id) => { const c = typeof id === 'string' ? own(col(state, 'categories'), id) : null; return !!c && !c.deleted; };
/** 分类能给这种清单用：在，而且 kind 是 null（两边都用）或和清单一样 @param {State} state @param {unknown} id @param {string} kind */
export function categoryFits(state, id, kind) {
  const c = typeof id === 'string' ? own(col(state, 'categories'), id) : null;
  return !!c && !c.deleted && (c.kind == null || c.kind === kind);
}

/**
 * 新加（或恢复）一样东西时的默认值，见 docs/DATA_MODEL.md 的表：
 *   商店：常去的商店 → 清单的默认商店（没删除、没归档）→ 未指定
 *   分类：记住的分类（改成过「未分类」的就是未分类）→ 这条记录上次的分类（恢复时）→ 内置对照（只给食材清单）→ 未分类；都要能给这种清单用
 *   单位：记住的单位 → 这条记录上次的单位 → 空（输入里写了单位由调用的地方优先用）
 * @param {State} state @param {List} list @param {string} name @param {Item | null} [prev]
 */
export function defaultsFor(state, list, name, prev = null) {
  const mem = memoryOf(state, name);
  const storeId = usualStore(state, mem) || (pickableStore(state, list.defaultStoreId) ? list.defaultStoreId : null);
  const fits = (/** @type {unknown} */ id) => (categoryFits(state, id, list.kind) ? /** @type {string} */ (id) : null);
  // 改成过「未分类」也算记住了（categorySet）：不然下次又按对照表猜回那个分错的分类
  const chosenNone = !!(mem && mem.categorySet && mem.categoryId == null);
  const categoryId = chosenNone ? null : fits(mem && mem.categoryId) || fits(prev && prev.categoryId) || catalogCategory(state, name, list.kind) || null;
  const unit = (mem && mem.unit) || (prev && prev.unit) || '';
  return { storeId, categoryId, unit };
}

/**
 * @typedef {'added' | 'restored' | 'exists' | 'empty' | 'nolist'} AddOutcome
 * @typedef {{ outcome: AddOutcome, id: string | null, item: Item | null }} AddResult
 */

/**
 * 加一样东西（名字已经拆好了）。id 用 itemId（先找这张清单里同名的，已买、已清除的也算）：
 *   已经是「要买」→ 'exists'（什么也不改，页面提示「已经在清单上了」）；
 *   已买、以后再说、已清除 → 'restored'（同一条恢复成要买：带着上次的分类、单位、备注、链接，商店按常去的重新定，数量用这次写的或 1）；
 *   没有 → 'added'（按默认值新建）。加进去的都记一次 memory（uses + 1）；输入里写了单位也记成这样东西的单位
 * @param {State} state @param {string} listId @param {{ name: string, qty?: number | null, unit?: string }} input @param {number} [now]
 * @returns {AddResult}
 */
export function addItem(state, listId, input, now = Date.now()) {
  const list = liveList(state, listId);
  if (!list) return { outcome: 'nolist', id: null, item: null };
  const name = str(input.name).trim();
  if (!name) return { outcome: 'empty', id: null, item: null };
  const id = itemId(state, listId, name);
  const prev = own(col(state, 'items'), id) || null;
  if (prev && !prev.deleted && prev.status === 'need') return { outcome: 'exists', id, item: prev };
  const d = defaultsFor(state, list, name, prev);
  const typedUnit = str(input.unit).trim();
  const fields = { listId, name, qty: input.qty != null && input.qty > 0 && input.qty <= QTY_MAX ? input.qty : 1, unit: typedUnit || d.unit,
    storeId: d.storeId, categoryId: d.categoryId, status: 'need', doneAt: null };
  let rec;
  if (prev) { const { deleted, deletedAt, ...rest } = prev; rec = { ...rest, ...fields }; }
  else rec = { id, note: '', url: '', price: null, needs: {}, createdAt: now, ...fields };
  const item = /** @type {Item} */ (writeRecord(state, 'items', rec, now));
  recordUse(state, name, list.kind, now);
  if (typedUnit) recordPrefs(state, name, list.kind, { unit: typedUnit }, now);
  return { outcome: prev ? 'restored' : 'added', id, item };
}

/**
 * 快速添加：拆出数量和单位（parse.js），再 addItem
 * @param {State} state @param {string} listId @param {unknown} text @param {number} [now]
 * @returns {AddResult}
 */
export function addFromInput(state, listId, text, now = Date.now()) {
  const list = liveList(state, listId);
  if (!list) return { outcome: 'nolist', id: null, item: null };
  return addItem(state, listId, parseQuickAdd(text, { kind: list.kind }), now);
}

/**
 * 勾上以后这么久之内又取消，算点错了（或者最后没买成）：把那次购买减回去。隔久了再取消是又要买了，那次购买照样算——
 * 不然每次从「已买」点回来都减掉一次，常去的商店永远只记得最近一次（半小时够一次购物，又远短于「又要买了」）
 */
export const UNTICK_MS = 30 * 60 * 1000;
/** 已买的这一样是不是刚勾上的。别的设备的时钟快了（doneAt 在将来）也算刚勾上 @param {Item} it @param {number} now */
const justBought = (it, now) => it.status === 'done' && it.doneAt != null && now - it.doneAt < UNTICK_MS;

/**
 * 改状态：need 要买 / later 以后再说（只有一般清单）/ done 已买（记下 doneAt）。
 * 勾成已买时这次的商店记一次（memory）；刚勾上（UNTICK_MS 之内）又改回去时把那次减掉（点错了又点回来不多算）。
 * 不能改（没有这条、清单不在、食材清单的「以后再说」）→ null
 * @param {State} state @param {string} id @param {ItemStatus} status @param {number} [now]
 * @returns {Item | null}
 */
export function setStatus(state, id, status, now = Date.now()) {
  const it = liveItem(state, id);
  const list = it && liveList(state, it.listId);
  if (!it || !list || !ITEM_STATUS.includes(status) || (status === 'later' && list.kind !== 'general')) return null;
  if (it.status === status) return it;
  const out = /** @type {Item} */ (writeRecord(state, 'items', { ...it, status, doneAt: status === 'done' ? now : null }, now));
  if (status === 'done') recordPurchase(state, it.name, it.storeId, list.kind, now);
  else if (justBought(it, now)) unrecordPurchase(state, it.name, it.storeId, now);
  return out;
}

/** 点一下：要买 / 以后再说 → 已买；已买 → 要买 @param {State} state @param {string} id @param {number} [now] */
export function toggleDone(state, id, now = Date.now()) {
  const it = liveItem(state, id);
  return it ? setStatus(state, id, it.status === 'done' ? 'need' : 'done', now) : null;
}

/**
 * 这张清单里没删除的东西有几样；给了 status 只数这种状态的（「已买（N）」、删除清单时的提示）。
 * 首页的「还要买几样」用 store.js 的 needCounts，数法一样
 * @param {State} state @param {string} listId @param {ItemStatus} [status]
 */
export function countItems(state, listId, status) {
  let n = 0;
  for (const it of Object.values(col(state, 'items'))) if (it && !it.deleted && it.listId === listId && (!status || it.status === status)) n++;
  return n;
}

/** 「清除已买」：这张清单里已买的都软删除（不是改状态：以后再加同名的会恢复同一条）。返回清掉了几样 @param {State} state @param {string} listId @param {number} [now] */
export function clearDone(state, listId, now = Date.now()) {
  let n = 0;
  const items = col(state, 'items');
  for (const it of Object.values(items)) {
    if (!it || it.deleted || it.listId !== listId || it.status !== 'done') continue;
    items[it.id] = deletedRecord(it, now);
    n++;
  }
  return n;
}

/**
 * 移到别的清单之前先问：那张清单上已经有同名的（没删除的）？有 → 那一条（页面要先确认「合并」），没有 → null。
 * name 给了就按这个名字查（编辑面板里同时改了名字）
 * @param {State} state @param {string} id @param {string} toListId @param {string} [name]
 * @returns {Item | null}
 */
export function moveConflict(state, id, toListId, name) {
  const it = liveItem(state, id);
  if (!it || it.listId === toListId || !liveList(state, toListId)) return null;
  const nm = name == null ? it.name : name;
  const other = own(col(state, 'items'), itemId(state, toListId, nm));
  return other && !other.deleted && other.listId === toListId && normName(other.name) === normName(nm) ? other : null;
}

/**
 * 移到别的清单（同一条记录换 listId）。目标清单已经有同名的：合并成那一条（恢复成要买），这一条软删除——
 * 同一张清单里同名的只能有一条（固定 id 的规则）。分类不能给目标清单用时按默认值重新定；去食材清单时「以后再说」变成要买
 * @param {State} state @param {string} id @param {string} toListId @param {number} [now]
 * @returns {{ outcome: 'moved' | 'merged' | 'same' | 'none', id: string | null }}
 */
export function moveItem(state, id, toListId, now = Date.now()) {
  const it = liveItem(state, id), to = liveList(state, toListId);
  if (!it || !to) return { outcome: 'none', id: null };
  if (it.listId === toListId) return { outcome: 'same', id };
  const other = moveConflict(state, id, toListId);
  if (other) {
    writeRecord(state, 'items', { ...other, status: 'need', doneAt: null }, now);
    col(state, 'items')[id] = deletedRecord(it, now);
    return { outcome: 'merged', id: other.id };
  }
  const categoryId = categoryFits(state, it.categoryId, to.kind) ? it.categoryId : defaultsFor(state, to, it.name).categoryId;
  const status = it.status === 'later' && to.kind !== 'general' ? 'need' : it.status;
  writeRecord(state, 'items', { ...it, listId: toListId, categoryId, status }, now);
  return { outcome: 'moved', id };
}

// ---------- 改一样东西 ----------
/** 价格输入：空的 → null；「12.99」「$12.99」「1,299」→ 数字；读不出来 → NaN @param {unknown} v */
export function readPrice(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  const s = str(v).trim().replace(/^[$¥￥€£]\s*/, '').replace(/,/g, '');
  if (!s) return null;
  return /^\d+(?:\.\d+)?$|^\.\d+$/.test(s) ? Number(s) : NaN;
}
/** 链接只收 http / https（javascript: 之类的不能点开）；空的 → '' ；不行 → null @param {unknown} v */
export function cleanUrl(v) {
  const s = str(v).trim();
  if (!s) return '';
  try { const u = new URL(s); return u.protocol === 'http:' || u.protocol === 'https:' ? s : null; } catch (e) { return null; }
}

/**
 * @typedef {{ name?: unknown, qty?: unknown, unit?: unknown, note?: unknown, storeId?: unknown, categoryId?: unknown,
 *   status?: unknown, url?: unknown, price?: unknown }} ItemPatch
 * 编辑面板交来的改动：只放改过的字段（没动的字段不覆盖，别的设备同时改的留着）。qty、price 可以是输入框里的字
 */
/**
 * 检查改动，返回整理好的字段（clean）或者每个字段的错误（文案的键）：
 *   名字不能空，也不能和这张清单上别的（没删除的）同名；数量空着（不写）或 0 < q ≤ 9999；链接只能是 http / https；价格空着或 ≥ 0。
 *   商店、分类不存在的、食材清单的「以后再说」：不报错，直接不改
 * @param {State} state @param {Item} item @param {ItemPatch} patch
 * @returns {{ ok: boolean, clean: Record<string, any>, errors: Record<string, string> }}
 */
export function validateItemPatch(state, item, patch) {
  /** @type {Record<string, any>} */
  const clean = {};
  /** @type {Record<string, string>} */
  const errors = {};
  const list = liveList(state, item.listId);
  const has = (/** @type {string} */ k) => Object.prototype.hasOwnProperty.call(patch, k);
  if (has('name')) {
    const name = str(patch.name).trim(), key = normName(name);
    if (!name) errors.name = 'item.err.name';
    else if (Object.values(col(state, 'items')).some(o => o && !o.deleted && o.id !== item.id && o.listId === item.listId && normName(o.name) === key)) errors.name = 'item.err.nameTaken';
    else clean.name = name;
  }
  if (has('qty')) {
    const q = readQty(patch.qty);
    if (q === null) clean.qty = null;
    else if (!Number.isFinite(q) || q <= 0 || q > QTY_MAX) errors.qty = 'item.err.qty';
    else clean.qty = q;
  }
  if (has('unit')) clean.unit = str(patch.unit).trim();
  if (has('note')) clean.note = str(patch.note);
  if (has('storeId') && (patch.storeId == null || patch.storeId === '' || storeExists(state, patch.storeId))) clean.storeId = patch.storeId || null;
  if (has('categoryId') && (patch.categoryId == null || patch.categoryId === '' || categoryExists(state, patch.categoryId))) clean.categoryId = patch.categoryId || null;
  if (has('status') && ITEM_STATUS.includes(/** @type {any} */ (patch.status)) && (patch.status !== 'later' || (list && list.kind === 'general'))) clean.status = patch.status;
  if (has('url')) { const u = cleanUrl(patch.url); if (u === null) errors.url = 'item.err.url'; else clean.url = u; }
  if (has('price')) {
    const p = readPrice(patch.price);
    if (p === null) clean.price = null;
    else if (!Number.isFinite(p) || p < 0) errors.price = 'item.err.price';
    else clean.price = p;
  }
  return { ok: !Object.keys(errors).length, clean, errors };
}

/**
 * 改一样东西（编辑面板的「完成」）。先检查，有错就什么也不改、返回错误；改了分类、单位记进 memory（下次同名的直接用）；
 * 改状态时已买的记账和 setStatus 一样；已买的东西改了商店或者名字，那次购买跟着挪过去（从旧的名字 / 商店减掉，记到新的上）
 * @param {State} state @param {string} id @param {ItemPatch} patch @param {number} [now]
 * @returns {{ ok: true, item: Item } | { ok: false, errors: Record<string, string> }}
 */
export function editItem(state, id, patch, now = Date.now()) {
  const it = liveItem(state, id);
  const list = it && liveList(state, it.listId);
  if (!it || !list) return { ok: false, errors: { item: 'item.err.gone' } };
  const v = validateItemPatch(state, it, patch);
  if (!v.ok) return { ok: false, errors: v.errors };
  const next = { ...it, ...v.clean };
  if (next.status !== it.status) next.doneAt = next.status === 'done' ? now : null;
  const item = /** @type {Item} */ (writeRecord(state, 'items', next, now));
  const wasDone = it.status === 'done', isDone = next.status === 'done';
  if (wasDone && isDone) {
    // 还是已买，改的是买的那一次（在哪家买的、买的叫什么）：不挪的话取消勾选时会从新名字下面减掉一次
    if (next.storeId !== it.storeId || normName(next.name) !== normName(it.name)) {
      unrecordPurchase(state, it.name, it.storeId, now);
      recordPurchase(state, next.name, next.storeId, list.kind, now);
    }
  } else if (wasDone) { if (justBought(it, now)) unrecordPurchase(state, it.name, it.storeId, now); }
  else if (isDone) recordPurchase(state, next.name, next.storeId, list.kind, now);
  /** @type {{ categoryId?: string | null, unit?: string }} */
  const prefs = {};
  if ('categoryId' in v.clean && v.clean.categoryId !== it.categoryId) prefs.categoryId = v.clean.categoryId;
  if ('unit' in v.clean && v.clean.unit !== it.unit) prefs.unit = v.clean.unit;
  if (Object.keys(prefs).length) recordPrefs(state, next.name, list.kind, prefs, now);
  return { ok: true, item };
}
