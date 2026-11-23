// @ts-check
// 清单里的东西：快速添加（同一张清单里同名的是同一条，再加一次就恢复它）、勾掉 / 取消、以后再说、清除已买、移到别的清单、改一样东西。
// 写法统一：函数直接改传进来的 state（页面在 ctx.mutate 里调用，撤销、保存由 state.js 管），返回结果；
// 记录经过 writeRecord（内容没变的不盖新时间）或 deletedRecord（软删除），买过的东西的习惯记在 memory（memory.js）。
import { itemId, normName, writeRecord, deletedRecord, boughtAfter, ITEM_STATUS } from './store.js';
import { own, isObj, str } from './util.js';
import { parseQuickAdd, readQty, qtyLabel, QTY_MAX } from './parse.js';
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
/**
 * 东西算在哪家店：指定的商店在（归档的也算）→ 它的 id；没指定、删掉了、不存在 → null（「未指定」）。
 * 商店页、「商店」页的数法（core/stores.js）和勾掉时记在哪家（setStatus、editItem）都用它：显示成「未指定」的东西勾掉了，
 * 不能偷偷记到那家删掉的店上（恢复以后它就成了「常去的」）
 * @param {State} state @param {{ storeId: string | null }} it
 */
export const storeKeyOf = (state, it) => (it.storeId && storeExists(state, it.storeId) ? it.storeId : null);
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
 * @typedef {'added' | 'restored' | 'exists' | 'own' | 'empty' | 'nolist'} AddOutcome
 * @typedef {{ outcome: AddOutcome, id: string | null, item: Item | null }} AddResult
 */

/**
 * 加一样东西（名字已经拆好了）。id 用 itemId（先找这张清单里同名的，已买、已清除的也算）：
 *   已经是「要买」→ 'exists'（什么也不改，页面提示「已经在清单上了」）；只是因为食谱在清单上（自己加的是空的）、这次又写了数量（「洋葱 2」）
 *     → 'own'：把写的数量记成自己加的（各道菜的不动）——明明写了要几个，不能只说一句「已经在了」就丢掉；
 *   已买、以后再说、已清除 → 'restored'（同一条恢复成要买：带着上次的分类、单位、备注、链接，商店按常去的重新定，数量用这次写的或 1；
 *     已买、已清除的连上一轮各道菜的那几份（needs）一起清空：那一轮已经买过了，不然再从食谱加一次会算两遍；计划的那几道记进 boughtFor，见 newRound）；
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
  const typedQty = input.qty != null && input.qty > 0 && input.qty <= QTY_MAX ? input.qty : null;
  const typedUnit = str(input.unit).trim();
  if (prev && !prev.deleted && prev.status === 'need') {
    if (typedQty == null || qtyOrNull(prev.qty) != null || !needsOf(prev).length) return { outcome: 'exists', id, item: prev };
    const item = /** @type {Item} */ (writeRecord(state, 'items', { ...prev, qty: typedQty, unit: typedUnit || prev.unit }, now));
    if (typedUnit) recordPrefs(state, name, list.kind, { unit: typedUnit }, now);
    return { outcome: 'own', id, item };
  }
  const d = defaultsFor(state, list, name, prev);
  const fields = { listId, name, qty: typedQty ?? 1, unit: typedUnit || d.unit,
    storeId: d.storeId, categoryId: d.categoryId, status: 'need', doneAt: null };
  let rec;
  if (prev) {
    const { deleted, deletedAt, ...rest } = prev;
    rec = { ...rest, ...fields };
    if (prev.status === 'done') Object.assign(rec, newRound(prev, now));
    else if (prev.deleted) rec.needs = {};                              // 要买的时候删掉的：没买过，那几份不要了
  } else rec = { id, note: '', url: '', price: null, needs: {}, createdAt: now, ...fields };
  const item = /** @type {Item} */ (writeRecord(state, 'items', rec, now));
  recordUse(state, name, list.kind, now);
  if (typedUnit) recordPrefs(state, name, list.kind, { unit: typedUnit }, now);
  return { outcome: prev ? 'restored' : 'added', id, item };
}

// ---------- 来自食谱的数量（needs） ----------
// 一样东西要买的量分两部分：自己加的（qty + unit，快速添加、编辑面板里改的就是它）和各道菜的（needs，每个来源一份：
// 从食谱页「加到清单」一次是 'a:<随机>'，计划里的一道菜是 'p:<那一道的 id>'，core/plan.js）。分开记：删掉一道菜只减它那一份，自己加的不动。
// 见 docs/DATA_MODEL.md 的「来自食谱的数量」。

/**
 * 算出来的用量（按人数换算过的、几道菜加在一起的）最多到多少。QTY_MAX（9999）是输入框的上限：2 人份的 2000 ml 水换算成 10 人份是 10000 ml，
 * 卡在 9999 就是一个悄悄算错的数；这里只防 Infinity、写坏的数据
 */
export const NEED_MAX = 999999;
/** 能当数量的：0 < q ≤ NEED_MAX 的数；别的 → null @param {unknown} q */
const qtyOrNull = (q) => (typeof q === 'number' && Number.isFinite(q) && q > 0 && q <= NEED_MAX ? q : null);
/** 这个键是不是这个来源的（同一次加的同名食材单位不一样时另记一份 '<来源>#2'） @param {string} key @param {string} source */
const ofSource = (key, source) => key === source || key.startsWith(source + '#');

/**
 * @typedef {{ name: string, qty?: number | null, unit?: string }} NeedLine
 * @typedef {{ qty: number | null, unit: string, label: string, recipeId: string | null }} Need
 */

/**
 * 把一道菜（一个来源）的食材加进一张清单（食谱页「加到清单」、计划的「生成购物清单」）。每一行按 itemId 找这张清单上同名的：
 *   有、而且是「要买」或「以后再说」→ 在它的 needs 里放这个来源（已经有同一个键就替换），状态变成「要买」，自己加的不动；
 *   有、但已买或已清除，或者没有 → 新建 / 恢复成「要买」：自己加的设成 null、needs 清空后只放这个来源（上一次买过的那一轮不算了），
 *     商店、分类、单位照「新加一样东西时的默认值」（defaultsFor），memory 记一次用过（和 addItem 一样：已经在清单上的不算）。
 * 同一次里同名（normName）的几行：单位一样的相加，单位不一样的另记一份（键 '<来源>#2'、'#3'…，removeNeeds 一起拿掉）。
 * 返回 { added：新建 / 恢复了几样, updated：记进已有的几样, ids }；清单不在 → null
 * @param {State} state @param {string} listId @param {NeedLine[]} lines @param {string} source
 * @param {{ label?: string, recipeId?: string | null }} [meta] @param {number} [now]
 */
export function addNeeds(state, listId, lines, source, { label = '', recipeId = null } = {}, now = Date.now()) {
  const list = liveList(state, listId);
  if (!list || !source) return null;
  // 先把同名的几行合在一起：同一张清单里同名的是同一条记录，一行一行加的话后一行会把前一行的那份替换掉
  /** @type {Map<string, { name: string, parts: { qty: number | null, unit: string }[] }>} */
  const byName = new Map();
  for (const ln of lines || []) {
    const name = str(ln && ln.name).trim();
    if (!name) continue;
    const key = normName(name), qty = qtyOrNull(ln.qty), unit = str(ln.unit).trim();
    if (!byName.has(key)) byName.set(key, { name, parts: [] });
    const g = /** @type {{ name: string, parts: { qty: number | null, unit: string }[] }} */ (byName.get(key));
    const same = g.parts.find(p => normName(p.unit) === normName(unit));
    if (same) same.qty = same.qty == null ? qty : qty == null ? same.qty : Math.round((same.qty + qty) * 1000) / 1000;
    else g.parts.push({ qty, unit });
  }
  let added = 0, updated = 0;
  /** @type {string[]} */
  const ids = [];
  for (const { name, parts } of byName.values()) {
    /** @type {Record<string, Need>} */
    const mine = {};
    parts.forEach((p, i) => { mine[i ? source + '#' + (i + 1) : source] = { qty: p.qty, unit: p.unit, label: str(label), recipeId: recipeId || null }; });
    const id = itemId(state, listId, name);
    const prev = own(col(state, 'items'), id) || null;
    if (prev && !prev.deleted && (prev.status === 'need' || prev.status === 'later')) {
      const needs = Object.fromEntries(Object.entries(isObj(prev.needs) ? prev.needs : {}).filter(([k]) => !ofSource(k, source)));
      writeRecord(state, 'items', { ...prev, needs: { ...needs, ...mine }, status: 'need', doneAt: null }, now);
      updated++;
    } else {
      const d = defaultsFor(state, list, name, prev);
      const fields = { listId, name, qty: null, unit: d.unit, storeId: d.storeId, categoryId: d.categoryId, status: 'need', doneAt: null, needs: mine };
      let rec;
      if (prev) {
        const { deleted, deletedAt, ...rest } = prev;
        rec = { ...rest, ...fields };
        if (prev.status === 'done') rec.boughtFor = boughtAfter(prev, now);   // 上一轮买过的那几道菜记着（newRound）
      } else rec = { id, note: '', url: '', price: null, createdAt: now, ...fields };
      writeRecord(state, 'items', rec, now);
      recordUse(state, name, list.kind, now);
      added++;
    }
    ids.push(id);
  }
  return { added, updated, ids };
}

/**
 * 拿掉一个来源（计划里删掉一道菜；改人数、换食谱、再生成一次时先拿掉旧的，见 core/plan.js）：只动「要买」「以后再说」的东西，已买、已清除的不动（买过的历史留着）。
 * 拿掉以后自己加的是 null 或 0、needs 也空了 → 这样东西本来就只是为这道菜加的，软删除；还有别的就留着。返回动了几样。
 * skip(it)：这几样先不动（接着要用 addNeeds 换成新的用量：先删掉再加回来会恢复成一条新的，商店按默认的重新定，用过的次数也多记一次）
 * @param {State} state @param {string} source @param {number} [now] @param {{ skip?: ((it: Item) => boolean) | null }} [opts]
 */
export function removeNeeds(state, source, now = Date.now(), { skip = null } = {}) {
  if (!source) return 0;
  let n = 0;
  const items = col(state, 'items');
  for (const it of Object.values(items)) {
    if (!it || it.deleted || (it.status !== 'need' && it.status !== 'later') || !isObj(it.needs)) continue;
    if (skip && skip(it)) continue;
    const keys = Object.keys(it.needs);
    if (!keys.some(k => ofSource(k, source))) continue;
    const needs = Object.fromEntries(Object.entries(it.needs).filter(([k]) => !ofSource(k, source)));
    if (!qtyOrNull(it.qty) && !Object.keys(needs).length) items[it.id] = deletedRecord(it, now);
    else writeRecord(state, 'items', { ...it, needs }, now);
    n++;
  }
  return n;
}

/**
 * 带着这个来源（needs 里有它的键，含 '<来源>#2'）的东西，什么状态都算、删掉的也算（计划要分清这道菜的哪几样还没买、哪几样已经买过）
 * @param {State} state @param {string} source @returns {Item[]}
 */
export function sourceItems(state, source) {
  if (!source) return [];
  return Object.values(col(state, 'items')).filter(it => it && isObj(it.needs) && Object.keys(it.needs).some(k => ofSource(k, source)));
}
/** 这样东西上这个来源的那几份（'<来源>'、'<来源>#2'……，单位不一样的各一份）：[[键, { qty, unit, label, recipeId }]] @param {Item} it @param {string} source */
export const needsFrom = (it, source) => needsOf(it).filter(([k]) => ofSource(k, source));

/**
 * 显示的数量拆成几份：自己加的和各来源里单位一样的（normName 比单位：「個」「个」一样）相加，单位不一样的分开；
 * 自己加的那一份在前，别的按 needs 里出现的先后。没写数量的（null）不算；都没写 → []
 * @param {{ qty: number | null, unit: string, needs?: Record<string, any> }} it
 * @returns {{ qty: number, unit: string }[]}
 */
export function qtyParts(it) {
  /** @type {{ key: string, unit: string, qty: number }[]} */
  const parts = [];
  const add = (/** @type {unknown} */ q, /** @type {unknown} */ u) => {
    const qty = qtyOrNull(typeof q === 'string' ? Number(q) : q);
    if (qty == null) return;
    const unit = str(u).trim(), key = normName(unit);
    const p = parts.find(x => x.key === key);
    if (p) p.qty += qty; else parts.push({ key, unit, qty });
  };
  add(it.qty, it.unit);
  for (const n of Object.values(isObj(it.needs) ? it.needs : {})) if (isObj(n)) add(n.qty, n.unit);
  return parts.map(p => ({ qty: Math.round(p.qty * 1000) / 1000, unit: p.unit }));
}
/** 一行上显示的数量：「2.5 个 + 200 g」；都没写数量 → '' @param {{ qty: number | null, unit: string, needs?: Record<string, any> }} it */
export const totalLabel = (it) => qtyParts(it).map(p => qtyLabel(p.qty, p.unit)).join(' + ');
/** 这样东西上各道菜的那几份（编辑面板列出来）：[[键, { qty, unit, label, recipeId }]]，按 needs 里的先后 @param {Item} it @returns {[string, Need][]} */
export const needsOf = (it) => Object.entries(isObj(it && it.needs) ? it.needs : {}).filter(([, n]) => isObj(n))
  .map(([k, n]) => [k, { qty: qtyOrNull(n.qty), unit: str(n.unit), label: str(n.label), recipeId: typeof n.recipeId === 'string' ? n.recipeId : null }]);

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
 * 已买的隔久了（UNTICK_MS 以后）才放回要买 / 以后再说：是「又要买了」，上一轮各道菜的那几份（needs）已经买过了，要清空——
 * 和再加一次已买的东西一样（addItem、addNeeds）。留着的话再从食谱加一次会算两遍，计划里删掉那道旧菜（removeNeeds）
 * 还会把这样又要买的东西从清单上拿掉。刚勾上就取消是点错了，照原样放回去
 * @param {Item} it @param {string} status @param {number} now
 */
const roundOver = (it, status, now) => it.status === 'done' && status !== 'done' && !justBought(it, now);
/**
 * 已买 / 已清除的这一样开始新的一轮（再加回来、隔久了取消勾选）：上一轮各道菜的那几份清空，但计划里那几道菜「这一样已经买过」记进 boughtFor
 * （store.js 的 boughtAfter）——不然再生成一次购物清单，周一已经为红烧肉买过的洋葱，因为周三的咖喱又加回清单以后，又算成红烧肉还没买的
 * @param {Item} it @param {number} now
 */
const newRound = (it, now) => ({ needs: {}, boughtFor: boughtAfter(it, now) });

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
  // fromLater：从「以后再说」勾掉的（取消勾选时回哪，见 untickStatus）；不是已买时 normalizeItem 会去掉它
  const out = /** @type {Item} */ (writeRecord(state, 'items', { ...it, status, doneAt: status === 'done' ? now : null,
    fromLater: status === 'done' && it.status === 'later' ? true : undefined, ...(roundOver(it, status, now) ? newRound(it, now) : {}) }, now));
  const at = storeKeyOf(state, it);
  if (status === 'done') recordPurchase(state, it.name, at, list.kind, now);
  else if (justBought(it, now)) unrecordPurchase(state, it.name, at, now);
  return out;
}

/**
 * 已买的取消勾选回到哪：刚从「以后再说」勾掉的（UNTICK_MS 之内）回「以后再说」——点错了再点一下就是没点过，不能悄悄变成「要买」
 * （进了「还要买 N」、购物模式）；别的、隔久了的回「要买」（又要买了）
 * @param {State} state @param {Item} it @param {number} [now] @returns {ItemStatus}
 */
export function untickStatus(state, it, now = Date.now()) {
  const list = liveList(state, it.listId);
  return it.fromLater === true && justBought(it, now) && !!list && list.kind === 'general' ? 'later' : 'need';
}

/** 点一下：要买 / 以后再说 → 已买；已买 → 要买（刚从以后再说勾掉的回以后再说，见 untickStatus） @param {State} state @param {string} id @param {number} [now] */
export function toggleDone(state, id, now = Date.now()) {
  const it = liveItem(state, id);
  return it ? setStatus(state, id, it.status === 'done' ? untickStatus(state, it, now) : 'done', now) : null;
}

/**
 * @typedef {'edit' | 'delete'} SwipeAction
 * 一行左右滑露出哪些按钮（ui/checklist.js 照这个画，清单页、商店页、搜索、购物模式一样；按钮都要点一下才做，见 ui/swipe.js）：
 *   往右滑（左边）：「编辑」——和点这一行打开的是同一个面板；
 *   往左滑（右边）：红色的「删除」——和编辑面板里的「删除」是同一件事（进最近删除、能撤销）。
 * 每一行都一样（哪张清单、什么状态都是）：以前往右是「以后再说」/「移回要买」、往左是「编辑」「删除」两个，
 * 一边一个好记，也和 babble 一样（往左删除，往右是它的「收藏」）；「以后再说」在编辑面板的「状态」里改。
 * 不在了（删掉了、清单不在）→ 两边都没有
 * @param {State} state @param {Item | null} it
 * @returns {{ left: SwipeAction[], right: SwipeAction[] }}
 */
export function swipeActions(state, it) {
  const list = it && !it.deleted ? liveList(state, it.listId) : null;
  if (!it || !list) return { left: [], right: [] };
  return { left: ['edit'], right: ['delete'] };
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

/**
 * 「清除已买」：match 的已买的东西都软删除（不是改状态：以后再加同名的会恢复同一条）。清单页按清单、商店页按商店（core/stores.js）。
 * 返回清掉了几样
 * @param {State} state @param {(it: Item) => boolean} match @param {number} [now]
 */
export function clearDoneWhere(state, match, now = Date.now()) {
  let n = 0;
  const items = col(state, 'items');
  for (const it of Object.values(items)) {
    if (!it || it.deleted || it.status !== 'done' || !match(it)) continue;
    items[it.id] = deletedRecord(it, now);
    n++;
  }
  return n;
}
/** 清单页的「清除已买」：这张清单里已买的都清掉 @param {State} state @param {string} listId @param {number} [now] */
export const clearDone = (state, listId, now = Date.now()) => clearDoneWhere(state, it => it.listId === listId, now);

/**
 * 有几样东西（没删除、所在的清单没删除，什么状态都算）指定了这家店 / 这个分类：删除商店、分类之前的提示用
 * @param {State} state @param {'storeId' | 'categoryId'} field @param {string} id
 */
export function countUsing(state, field, id) {
  let n = 0;
  for (const it of Object.values(col(state, 'items'))) if (it && !it.deleted && it[field] === id && liveList(state, it.listId)) n++;
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

const blankField = (/** @type {unknown} */ v) => v == null || (typeof v === 'string' && !v.trim());
/**
 * 合并进目标清单上同名的那一条（other）：它恢复成要买（这次在面板里改了状态就用改的），移过来的这一条（it）软删除。
 * 这一条上的东西不丢：这次改过的字段（typed）以它为准；没改的，那一条空着的用它的补上；两条的备注都有、不一样，接在后面
 * @param {State} state @param {Item} it @param {Item} other @param {List} to @param {string[]} typed @param {number} now
 */
function mergeMoved(state, it, other, to, typed, now) {
  const next = { ...other };
  const take = (/** @type {string} */ k) => typed.includes(k) || blankField(/** @type {any} */ (other)[k]);
  for (const k of ['url', 'price', 'storeId']) if (take(k)) /** @type {any} */ (next)[k] = /** @type {any} */ (it)[k];
  if (take('categoryId') && (it.categoryId == null || categoryFits(state, it.categoryId, to.kind))) next.categoryId = it.categoryId;
  const a = str(other.note).trim(), b = str(it.note).trim();
  next.note = !b ? other.note : !a ? it.note : normName(a) === normName(b) ? other.note : a + '\n' + b;
  // 自己加的数量：这次改过就用改的；那一条本来就在要买、而且自己写了数量，用它的；不然（已买、只是因为食谱才在清单上）用移过来的这一条的。
  // 单位跟着数量走：「2 个」移过去不能变成那一条的「2 g」
  const mine = typed.includes('qty') || other.status !== 'need' || qtyOrNull(other.qty) == null;
  next.qty = mine ? it.qty : other.qty;
  if (typed.includes('unit') || (mine && it.qty != null) || blankField(other.unit)) next.unit = it.unit;
  // 各道菜的那几份：只带还没买的（要买、以后再说）。已买的那一条上的是上一轮的（已经买过了），移过来的这一条是已买的也一样，
  // 不然合并成要买以后，上周买过的用量又回到清单上
  const open = (/** @type {Item} */ x) => (!x.deleted && (x.status === 'need' || x.status === 'later') && isObj(x.needs) ? x.needs : {});
  next.needs = { ...open(it), ...open(other) };
  if (other.status === 'done') next.boughtFor = boughtAfter(other, now);  // 那一条上一轮买过的计划的菜记着（newRound）；移过来的这一条软删除后自己带着
  const status = typed.includes('status') ? (it.status === 'later' && to.kind !== 'general' ? 'need' : it.status) : 'need';
  Object.assign(next, { status, doneAt: status === 'done' ? (it.doneAt ?? now) : null, fromLater: undefined });
  writeRecord(state, 'items', next, now);
  col(state, 'items')[it.id] = deletedRecord(it, now);
}

/**
 * 移到别的清单（同一条记录换 listId）。目标清单已经有同名的：合并成那一条（恢复成要买，这一条上的备注、链接、价格……带过去，见 mergeMoved），
 * 这一条软删除——同一张清单里同名的只能有一条（固定 id 的规则）。分类不能给目标清单用时按默认值重新定；去食材清单时「以后再说」变成要买。
 * typed：编辑面板这次改过的字段（editAndMove 给），合并时以这一条的为准
 * @param {State} state @param {string} id @param {string} toListId @param {number} [now] @param {string[]} [typed]
 * @returns {{ outcome: 'moved' | 'merged' | 'same' | 'none', id: string | null }}
 */
export function moveItem(state, id, toListId, now = Date.now(), typed = []) {
  const it = liveItem(state, id), to = liveList(state, toListId);
  if (!it || !to) return { outcome: 'none', id: null };
  if (it.listId === toListId) return { outcome: 'same', id };
  const other = moveConflict(state, id, toListId);
  if (other) {
    mergeMoved(state, it, other, to, typed, now);
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
 *   status?: unknown, url?: unknown, price?: unknown, dropNeeds?: unknown }} ItemPatch
 * 编辑面板交来的改动：只放改过的字段（没动的字段不覆盖，别的设备同时改的留着）。qty、price 可以是输入框里的字；
 * dropNeeds：拿掉的几道菜的那一份（needs 的键），存成 clean.needs（这时的 needs 去掉它们，别的设备刚加的照样留着）
 */
/**
 * 检查改动，返回整理好的字段（clean）或者每个字段的错误（文案的键）：
 *   名字不能空，也不能和这张清单上别的（没删除的）同名；数量空着（不写）或 0 < q ≤ 9999；链接只能是 http / https；价格空着或 ≥ 0。
 *   商店、分类不存在的、食材清单的「以后再说」：不报错，直接不改。
 *   moving：同时移到别的清单（editAndMove）：名字不和这张清单比（移走以后这里不会重名），那边有同名的是合并，由页面先问
 * @param {State} state @param {Item} item @param {ItemPatch} patch @param {{ moving?: boolean }} [opts]
 * @returns {{ ok: boolean, clean: Record<string, any>, errors: Record<string, string> }}
 */
export function validateItemPatch(state, item, patch, { moving = false } = {}) {
  /** @type {Record<string, any>} */
  const clean = {};
  /** @type {Record<string, string>} */
  const errors = {};
  const list = liveList(state, item.listId);
  const has = (/** @type {string} */ k) => Object.prototype.hasOwnProperty.call(patch, k);
  if (has('name')) {
    const name = str(patch.name).trim(), key = normName(name);
    if (!name) errors.name = 'item.err.name';
    else if (!moving && Object.values(col(state, 'items')).some(o => o && !o.deleted && o.id !== item.id && o.listId === item.listId && normName(o.name) === key)) errors.name = 'item.err.nameTaken';
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
  if (has('dropNeeds') && Array.isArray(patch.dropNeeds) && isObj(item.needs)) {
    const drop = new Set(patch.dropNeeds.map(String));
    if (Object.keys(item.needs).some(k => drop.has(k))) clean.needs = Object.fromEntries(Object.entries(item.needs).filter(([k]) => !drop.has(k)));
  }
  return { ok: !Object.keys(errors).length, clean, errors };
}

/**
 * 改一样东西（编辑面板的「保存」）。先检查，有错就什么也不改、返回错误；改了分类、单位记进 memory（下次同名的直接用）；
 * 改状态时已买的记账和 setStatus 一样；已买的东西改了商店或者名字，那次购买跟着挪过去（从旧的名字 / 商店减掉，记到新的上）
 * @param {State} state @param {string} id @param {ItemPatch} patch @param {number} [now]
 * @returns {{ ok: true, item: Item } | { ok: false, errors: Record<string, string> }}
 */
export function editItem(state, id, patch, now = Date.now(), { moving = false } = {}) {
  const it = liveItem(state, id);
  const list = it && liveList(state, it.listId);
  if (!it || !list) return { ok: false, errors: { item: 'item.err.gone' } };
  const v = validateItemPatch(state, it, patch, { moving });
  if (!v.ok) return { ok: false, errors: v.errors };
  const next = { ...it, ...v.clean };
  if (next.status !== it.status) next.doneAt = next.status === 'done' ? now : null;
  if (roundOver(it, next.status, now)) Object.assign(next, newRound(it, now));   // 和勾选一样：隔久了才改回要买是新的一轮
  const item = /** @type {Item} */ (writeRecord(state, 'items', next, now));
  const wasDone = it.status === 'done', isDone = next.status === 'done';
  // 和 setStatus 一样按「算在哪家」记：删掉的商店当未指定，不计
  const was = storeKeyOf(state, it), will = storeKeyOf(state, next);
  if (wasDone && isDone) {
    // 还是已买，改的是买的那一次（在哪家买的、买的叫什么）：不挪的话取消勾选时会从新名字下面减掉一次
    if (will !== was || normName(next.name) !== normName(it.name)) {
      unrecordPurchase(state, it.name, was, now);
      recordPurchase(state, next.name, will, list.kind, now);
    }
  } else if (wasDone) { if (justBought(it, now)) unrecordPurchase(state, it.name, was, now); }
  else if (isDone) recordPurchase(state, next.name, will, list.kind, now);
  /** @type {{ categoryId?: string | null, unit?: string }} */
  const prefs = {};
  if ('categoryId' in v.clean && v.clean.categoryId !== it.categoryId) prefs.categoryId = v.clean.categoryId;
  if ('unit' in v.clean && v.clean.unit !== it.unit) prefs.unit = v.clean.unit;
  if (Object.keys(prefs).length) recordPrefs(state, next.name, list.kind, prefs, now);
  return { ok: true, item };
}

/**
 * 编辑面板的「保存」：改一样东西，同时换了清单就移过去（toListId；没换给 null）。在一起做：那边有同名的要合并时，
 * 这次改的（数量、备注……）要落在留下来的那一条上，不能改在随后被删掉的这一条上（页面先用 moveConflict 问过要不要合并）
 * @param {State} state @param {string} id @param {ItemPatch} patch @param {string | null} toListId @param {number} [now]
 * @returns {{ ok: true, item: Item, outcome: 'edited' | 'moved' | 'merged', id: string } | { ok: false, errors: Record<string, string> }}
 */
export function editAndMove(state, id, patch, toListId, now = Date.now()) {
  const it = liveItem(state, id);
  const moving = !!(it && toListId && toListId !== it.listId && liveList(state, toListId));
  const typed = it ? Object.keys(validateItemPatch(state, it, patch, { moving }).clean) : [];
  const r = editItem(state, id, patch, now, { moving });
  if (!r.ok) return r;
  if (!moving) return { ok: true, item: r.item, outcome: 'edited', id };
  const m = moveItem(state, id, /** @type {string} */ (toListId), now, typed);
  const kept = liveItem(state, m.id) || r.item;
  return { ok: true, item: kept, outcome: m.outcome === 'merged' ? 'merged' : 'moved', id: kept.id };
}
