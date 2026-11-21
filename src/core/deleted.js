// @ts-check
// 最近删除（#/deleted）：删掉的清单、东西、商店、分类，各自新删的在前。删除一律是软删除（内容留着，照样同步、进备份），
// 所以这里一直列着、随时能恢复；恢复由页面调 ctx.restore（store.js 的 restoredRecord：修改时间晚于删除，别的设备上旧的删除盖不回来）。
// 东西只列所在的清单还在的：删掉的清单里的东西没有被删，只是跟着清单隐藏，恢复清单时一起回来（列在清单那一行，说一声有几样）。
// 「清除已买」清掉的也是删掉的东西（status 还是 done），恢复后回到那张清单的「已买」里；以后再加同名的也会恢复同一条（items.js 的 addItem）。
// 恢复前先看会不会撞名（restoreBlock）：同一张清单上已经有同名的东西（同一张清单里同名的只能有一条）、已经有同名的商店、会一起出现的同名分类。
import { normName } from './store.js';
import { own, isObj } from './util.js';
import { liveList } from './items.js';
import { storeNameTaken } from './stores.js';
import { categoryNameTaken } from './categories.js';

/** @typedef {import('./store.js').State} State */
/** @typedef {import('./store.js').Translate} Translate */

/** 列出来的几种，也是页面上分组的顺序 */
export const DELETED_KINDS = /** @type {const} */ (['lists', 'items', 'stores', 'categories']);
/** @typedef {typeof DELETED_KINDS[number]} DeletedKind */

/** @param {State} state @param {string} c @returns {any[]} */
const all = (state, c) => Object.values(isObj(own(state && state.data, c)) ? state.data[c] : {}).filter(isObj);
/** 新删的在前；一样就按 id（每台设备排得一样） @param {any} a @param {any} b */
const newest = (a, b) => (b.deletedAt || b.updatedAt || 0) - (a.deletedAt || a.updatedAt || 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * 最近删除里的：{ lists, items, stores, categories }，各自新删的在前
 * @param {State} state
 */
export function recentlyDeleted(state) {
  /** @type {Record<DeletedKind, any[]>} */
  const out = { lists: [], items: [], stores: [], categories: [] };
  for (const c of DELETED_KINDS) {
    out[c] = all(state, c).filter(r => r.deleted && (c !== 'items' || liveList(state, r.listId))).sort(newest);
  }
  return out;
}
/** 一共几项（设置 → 数据「最近删除」后面的数） @param {State} state */
export const deletedCount = state => Object.values(recentlyDeleted(state)).reduce((n, arr) => n + arr.length, 0);

/** 删掉的清单恢复时一起回来的东西有几样（没删除的；分开删掉的不算，它们在「东西」里自己列着） @param {State} state @param {string} listId */
export const itemsWithList = (state, listId) => all(state, 'items').filter(it => !it.deleted && it.listId === listId).length;

/**
 * 能不能恢复：能 → null；不能 → 原因（文案 deleted.block.<原因>）：
 *   'gone' 不在最近删除里了（别的设备已经恢复、地址不对）；'list' 东西所在的清单也删了（先恢复清单）；
 *   'item' 这张清单上已经有同名的了；'store' 已经有同名的商店；'category' 已经有会一起出现的同名分类
 * @param {State} state @param {string} collection @param {string} id @param {Translate} [t] 分类比显示的名字（没改过名的预置分类）要用
 */
export function restoreBlock(state, collection, id, t) {
  const r = own(own(state && state.data, collection), id);
  if (!isObj(r) || !r.deleted || !(/** @type {readonly string[]} */ (DELETED_KINDS)).includes(collection)) return 'gone';
  if (collection === 'items') {
    if (!liveList(state, r.listId)) return 'list';
    const key = normName(r.name);
    return all(state, 'items').some(o => !o.deleted && o.id !== id && o.listId === r.listId && normName(o.name) === key) ? 'item' : null;
  }
  if (collection === 'stores') return storeNameTaken(state, r.name, id) ? 'store' : null;
  if (collection === 'categories') return categoryNameTaken(state, /** @type {any} */ (r), t) ? 'category' : null;
  return null;
}
