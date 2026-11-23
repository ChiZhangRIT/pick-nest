// @ts-check
// 商店：「商店」页每家店还要买几样（storeCounts、storeRows）、一家店的页面（groupStore、clearStoreDone），设置里管商店（新增、改名、归档、删除、排顺序）。
// 「这家店的东西」：没删除、所在的清单没删除也没归档的东西里，storeId 是这家店的。商店删掉了（或者根本没有这家）的东西算「未指定」（key null）：
// storeId 不改，商店恢复了就回到原来那家（和清单页按商店分组、编辑面板显示「未指定」是同一个规则）。归档的商店照常算，只是不再出现在选择里。
// 「商店」页、一家店、从商店进的购物模式可以只看一张清单（本机记住的 storeFilter，见 storeFilter）：下面这些都收一个 { listId }，null / 不给 = 所有清单。
// 写法和 items.js 一样：直接改传进来的 state（在 ctx.mutate 里调用），记录经过 writeRecord（没变的不盖新时间）或 deletedRecord。
// （store.js 是数据层：整理、合并、预置记录；这里是商店这件事本身。）
import { newId, byOrder, writeRecord, deletedRecord, live, normName, moveInOrder, homeLists } from './store.js';
import { own, isObj, str } from './util.js';
import { liveList, storeKeyOf, clearDoneWhere } from './items.js';
import { visibleItems } from './lists.js';
import { groupItems, byDoneAt, collatorFor } from './group.js';

/** @typedef {import('./store.js').State} State */
/** @typedef {import('./store.js').Item} Item */
/** @typedef {import('./store.js').Store} Store */
/** @typedef {import('./group.js').Group} Group */

/** 没删除的商店（归档的也算）；没有 → null @param {State} state @param {unknown} id @returns {Store | null} */
export function liveStore(state, id) {
  const s = typeof id === 'string' ? own(isObj(state.data.stores) ? state.data.stores : {}, id) : null;
  return s && !s.deleted ? s : null;
}
// 东西算在哪家店（删掉的、不存在的商店算「未指定」）：规则在 items.js，勾掉时记在哪家也用它
export { storeKeyOf };
/** @typedef {{ listId?: string | null }} ListFilter  只看哪张清单的东西；null / 不给 = 所有清单 */

/**
 * 商店页看得到的东西：没删除，所在的清单没删除、没归档（归档的清单收起来了，里面的东西也不催着买）；给了 listId 只要这张清单上的。
 * listId 不再替调用的地方检查（删掉、归档的清单上本来就什么都看不到）：记着的清单不在了按所有清单显示，是 storeFilter 的事
 * @param {State} state @param {ListFilter} [f] @returns {Item[]}
 */
export function shoppingItems(state, { listId = null } = {}) {
  return visibleItems(state).filter(it => (listId == null || it.listId === listId) && !(/** @type {any} */ (liveList(state, it.listId)).archived));
}

/**
 * 每家店还要买几样（跨所有清单，或者只数 listId 这张）：只数「要买」的，不算以后再说、已买。storeId → 数量；未指定的数在 null 下
 * @param {State} state @param {ListFilter} [f] @returns {Map<string | null, number>}
 */
export function storeCounts(state, f = {}) {
  /** @type {Map<string | null, number>} */
  const m = new Map();
  for (const it of shoppingItems(state, f)) if (it.status === 'need') { const k = storeKeyOf(state, it); m.set(k, (m.get(k) || 0) + 1); }
  return m;
}

// ---------- 只看一张清单（picknest.local 的 storeFilter，不同步） ----------
/**
 * 现在按哪张清单筛：「商店」页、每家店、从商店进的购物模式共用本机记住的一个（换了一家店还是看同一张清单，不用每家各选一次）。
 * 记着的清单还在、没归档 → 它的 id；没记、认不出、删掉了、归档了 → null（所有清单），不提示：那张清单在店里本来就什么也看不到，
 * 留着「木工」只会让每家店都显示成空的。记着的值不在这里改（读的时候不写）：撤销删除、取消归档以后又按它筛
 * @param {State} state @param {{ storeFilter?: unknown } | null | undefined} local @returns {string | null}
 */
export function storeFilter(state, local) {
  const l = liveList(state, isObj(local) ? local.storeFilter : null);
  return l && !(/** @type {any} */ (l).archived) ? l.id : null;
}
/** 换筛哪张清单：给 ctx.setLocal 的 { storeFilter }（null = 所有清单） @param {unknown} listId */
export const storeFilterPatch = (listId) => ({ storeFilter: typeof listId === 'string' ? listId : null });

/**
 * 选清单的面板里的几行：最前面「所有清单」（id null），然后首页上的清单（没删除、没归档，首页的顺序），各带还要买几样。
 * 给了 storeId（null = 未指定）就只数在这家店要买的（一家店的页面上选，看得出哪张清单在这儿有东西）；不给是所有店加起来（「商店」页）。
 * 「所有清单」那一行就是各张加起来（归档的清单本来就不算）
 * @param {State} state @param {{ storeId?: string | null }} [at]
 * @returns {{ id: string | null, list: import('./store.js').List | null, n: number }[]}
 */
export function storeFilterOptions(state, at = {}) {
  const here = at.storeId !== undefined;
  /** @type {Map<string, number>} */
  const per = new Map();
  for (const it of shoppingItems(state)) {
    if (it.status === 'need' && (!here || storeKeyOf(state, it) === at.storeId)) per.set(it.listId, (per.get(it.listId) || 0) + 1);
  }
  const lists = homeLists(state).map(l => ({ id: l.id, list: l, n: per.get(l.id) || 0 }));
  return [{ id: null, list: null, n: lists.reduce((n, x) => n + x.n, 0) }, ...lists];
}

/** 没归档的商店，按顺序（商店页、设置、各个选择列表的顺序） @param {State} state @returns {Store[]} */
export const activeStores = state => live(state, 'stores').filter(s => !s.archived).sort(byOrder);
/** 归档了的商店（没删除），按顺序 @param {State} state @returns {Store[]} */
export const archivedStores = state => live(state, 'stores').filter(s => s.archived).sort(byOrder);

/**
 * 「商店」页的行：没归档的商店按顺序，0 样的也列出来（页面画淡一点）；归档的商店只在还有要买的时候列出来（排在后面，页面标「已归档」），
 * 不然归档以后，指定给它的东西就在哪儿都看不到了；最后是「未指定」（id null，有要买的才列）。
 * 只看一张清单时数的、「有没有要买的」都只算这张，而且 0 样的店不列：选一张清单是要看「这张清单要去哪几家」，
 * 一排 0 只会把有东西的那一两家埋在中间（列不出来的有几家用 emptyStoresIn，页面说一句）
 * @param {State} state @param {ListFilter} [f] @returns {{ id: string | null, store: Store | null, n: number }[]}
 */
export function storeRows(state, f = {}) {
  const counts = storeCounts(state, f);
  const rows = [...activeStores(state).filter(s => !f.listId || counts.get(s.id)), ...archivedStores(state).filter(s => counts.get(s.id))]
    .map(s => ({ id: s.id, store: s, n: counts.get(s.id) || 0 }));
  if (counts.get(null)) rows.push({ id: null, store: null, n: /** @type {number} */ (counts.get(null)) });
  return rows;
}

/** 只看一张清单时「商店」页上没列出来的店有几家（没归档、在这张清单里没有要买的）；所有清单时是 0（都列着） @param {State} state @param {ListFilter} [f] */
export function emptyStoresIn(state, f = {}) {
  if (!f.listId) return 0;
  const counts = storeCounts(state, f);
  return activeStores(state).filter(s => !counts.get(s.id)).length;
}

/** 在这家店（null = 未指定）的页面上的东西（什么状态都算） @param {State} state @param {string | null} storeId @param {ListFilter} [f] */
const itemsAt = (state, storeId, f) => shoppingItems(state, f).filter(it => storeKeyOf(state, it) === storeId);

/**
 * 一家店（null = 未指定）的页面：要买的按分类分组（规则和清单页一样：组按分类的 order，未分类在最后，组内按名字）；
 * 已买的新的在前。以后再说的不在这里（还不打算买）。只看一张清单时只有这张上的（已买的也是）
 * @param {State} state @param {string | null} storeId @param {Intl.Collator} [collator] @param {ListFilter} [f]
 * @returns {{ groups: Group[], done: Item[] }}
 */
export function groupStore(state, storeId, collator = collatorFor('zh-Hans'), f = {}) {
  /** @type {Item[]} */
  const need = [], done = [];
  for (const it of itemsAt(state, storeId, f)) { if (it.status === 'need') need.push(it); else if (it.status === 'done') done.push(it); }
  return { groups: groupItems(state, need, 'category', collator), done: done.sort(byDoneAt(collator)) };
}

/**
 * 商店页的「清除已买」：在这家店的页面上的已买都清掉（各自清单的「已买」里也就没了），返回几样。
 * 只看一张清单时只清看得到的这些（别的清单上在这家买到的不动：没看见的不该跟着清掉）
 * @param {State} state @param {string | null} storeId @param {number} [now] @param {ListFilter} [f]
 */
export function clearStoreDone(state, storeId, now = Date.now(), f = {}) {
  const here = new Set(itemsAt(state, storeId, f).map(it => it.id));
  return clearDoneWhere(state, it => here.has(it.id), now);
}

// ---------- 设置 → 商店 ----------
/**
 * 名字：不能空，也不能和别的（没删除的）商店同名（选择列表里两个「Costco」分不清）。删掉的不算：删了「Costco」再加一个就是新的一家
 * @param {State} state @param {unknown} name @param {string | null} self 改名时自己的 id
 */
function nameError(state, name, self) {
  const nm = str(name).trim();
  if (!nm) return 'store.err.name';
  return storeNameTaken(state, nm, self) ? 'store.err.taken' : null;
}
/** 别的（没删除的）商店已经叫这个名字了吗（最近删除里恢复一家店之前也查：恢复出两个「Costco」就分不清了） @param {State} state @param {unknown} name @param {string | null} self */
export function storeNameTaken(state, name, self) {
  const key = normName(name);
  return live(state, 'stores').some(s => s.id !== self && normName(s.name) === key);
}

/**
 * 新增商店：排在最后（order = 现有的最大值 + 1，归档的也算）
 * @param {State} state @param {{ name?: unknown }} f @param {number} [now]
 * @returns {{ ok: true, id: string } | { ok: false, errors: Record<string, string> }}
 */
export function createStore(state, f, now = Date.now()) {
  const err = nameError(state, f.name, null);
  if (err) return { ok: false, errors: { name: err } };
  const all = live(state, 'stores');
  const id = newId('s_');
  writeRecord(state, 'stores', { id, name: str(f.name).trim(), order: all.length ? Math.max(...all.map(s => s.order)) + 1 : 0, archived: false, createdAt: now }, now);
  return { ok: true, id };
}

/**
 * 改名（预置的商店也一样：商店名是专有名词，没有「系统的名字」可以退回去，所以不能空）
 * @param {State} state @param {string} id @param {unknown} name @param {number} [now]
 * @returns {{ ok: true, store: Store } | { ok: false, errors: Record<string, string> }}
 */
export function renameStore(state, id, name, now = Date.now()) {
  const s = liveStore(state, id);
  if (!s) return { ok: false, errors: { name: 'store.gone' } };
  const err = nameError(state, name, id);
  if (err) return { ok: false, errors: { name: err } };
  return { ok: true, store: /** @type {Store} */ (writeRecord(state, 'stores', { ...s, name: str(name).trim() }, now)) };
}

/** 归档 / 取消归档。归档的不出现在选择里、不当默认，已经指定给它的东西照常显示它 @param {State} state @param {string} id @param {boolean} archived @param {number} [now] */
export function setStoreArchived(state, id, archived, now = Date.now()) {
  const s = liveStore(state, id);
  return s ? /** @type {Store} */ (writeRecord(state, 'stores', { ...s, archived: !!archived }, now)) : null;
}

/**
 * 删除商店（预置的也能删；ensureSeeds 不会把删掉的补回来）。软删除：东西的 storeId、清单的默认商店、memory 里的次数都不动，
 * 只是这家店不在了以后都当「未指定」；恢复（撤销、最近删除）时一起回来。删掉了返回 true
 * @param {State} state @param {string} id @param {number} [now]
 */
export function deleteStore(state, id, now = Date.now()) {
  const s = liveStore(state, id);
  if (!s) return false;
  state.data.stores[id] = deletedRecord(s, now);
  return true;
}

/**
 * 设置里的 ↑↓：挪到上一家 / 下一家（没归档的）的另一边，只改这一家的 order（和首页排清单一样，store.js 的 moveInOrder）。
 * 归档的也交进去：它们的 order 还占着位置，取消归档后回到原处，不和挪过来的撞在一起
 * @param {State} state @param {string} id @param {1 | -1} dir @param {number} [now]
 */
export const moveStore = (state, id, dir, now = Date.now()) => moveInOrder(state, 'stores', live(state, 'stores').sort(byOrder), id, dir, s => !s.archived, now);
