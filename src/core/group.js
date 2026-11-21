// @ts-check
// 清单页怎么排：「要买」的按分类（或按商店）分组，组按 order，「未分类 / 未指定」在最后；组内按名字（中文按拼音）；
// 「以后再说」单独一组；「已买」新的在前。还有各清单的显示方式（picknest.local 的 view）。
import { byOrder } from './store.js';
import { own, isObj } from './util.js';

/** @typedef {import('./store.js').State} State */
/** @typedef {import('./store.js').Item} Item */
/** @typedef {'category' | 'store'} GroupBy */

// 各界面语言排名字的规则：简体按拼音，繁体（台湾）用 zh-Hant-TW 默认的（笔画），英文按字母；数字按大小（「2 号」在「10 号」前）
const COLLATION = { 'zh-Hans': 'zh-Hans-u-co-pinyin', 'zh-Hant-TW': 'zh-Hant-TW', en: 'en' };
/** @type {Map<string, Intl.Collator>} */
const collators = new Map();
/** @param {string} lang @returns {Intl.Collator} */
export function collatorFor(lang) {
  const loc = own(COLLATION, lang) || COLLATION['zh-Hans'];
  if (!collators.has(loc)) collators.set(loc, new Intl.Collator(loc, { numeric: true }));
  return /** @type {Intl.Collator} */ (collators.get(loc));
}

/**
 * @typedef {object} Group
 * @property {string | null} id   分类或商店的 id；null = 未分类 / 未指定
 * @property {Item[]} items
 */
/**
 * 一张清单里没删除的东西分好组：
 *   groups：「要买」的，按分类或商店分组。已删除的分类 / 商店当作没有（归到「未分类 / 未指定」）；归档的商店照常是一组
 *   later：「以后再说」（一般清单）；done：「已买」，doneAt 新的在前
 * 组内和 later 按名字（collator）排，一样的按 id（每台设备一样）
 * @param {State} state @param {string} listId @param {GroupBy} [groupBy] @param {Intl.Collator} [collator]
 * @returns {{ groups: Group[], later: Item[], done: Item[] }}
 */
export function groupNeed(state, listId, groupBy = 'category', collator = collatorFor('zh-Hans')) {
  const cols = groupBy === 'store' ? 'stores' : 'categories';
  const owners = isObj(own(state.data, cols)) ? state.data[cols] : {};
  const byName = (/** @type {Item} */ a, /** @type {Item} */ b) => collator.compare(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  /** @type {Map<string | null, Item[]>} */
  const buckets = new Map();
  /** @type {Item[]} */
  const later = [], done = [];
  for (const it of Object.values(isObj(state.data.items) ? state.data.items : {})) {
    if (!it || it.deleted || it.listId !== listId) continue;
    if (it.status === 'done') { done.push(it); continue; }
    if (it.status === 'later') { later.push(it); continue; }
    const key = groupBy === 'store' ? it.storeId : it.categoryId;
    const owner = key ? own(owners, key) : null;
    const gid = owner && !owner.deleted ? key : null;
    if (!buckets.has(gid)) buckets.set(gid, []);
    /** @type {Item[]} */ (buckets.get(gid)).push(it);
  }
  const ids = /** @type {string[]} */ ([...buckets.keys()].filter(k => k !== null)).sort((a, b) => byOrder(owners[a], owners[b]));
  if (buckets.has(null)) ids.push(/** @type {any} */ (null));
  const groups = ids.map(id => ({ id, items: /** @type {Item[]} */ (buckets.get(id)).sort(byName) }));
  later.sort(byName);
  done.sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0) || byName(a, b));
  return { groups, later, done };
}

/**
 * 这张清单在这台设备上的显示方式（picknest.local 的 view[listId]，不同步）：
 * groupBy 按分类 / 按商店，showDone「已买」展开着，showLater「以后再说」展开着。认不出的值按默认
 * @param {{ view?: Record<string, any> } | null | undefined} local @param {string} listId
 * @returns {{ groupBy: GroupBy, showDone: boolean, showLater: boolean }}
 */
export function listView(local, listId) {
  const v = own(isObj(local && local.view) ? /** @type {any} */ (local).view : {}, listId);
  const o = isObj(v) ? v : {};
  return { groupBy: o.groupBy === 'store' ? 'store' : 'category', showDone: o.showDone !== false, showLater: o.showLater !== false };
}
