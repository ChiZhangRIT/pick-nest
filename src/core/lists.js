// @ts-check
// 清单本身：新建、改名 / 换图标和颜色 / 默认商店、归档、删除（只有自建的；软删除，里面的东西留着、跟着隐藏，恢复清单时一起回来）、排顺序。
// 写法和 items.js 一样：直接改传进来的 state（在 ctx.mutate 里调用），记录经过 writeRecord（没变的不盖新时间）。
import { newId, byOrder, writeRecord, deletedRecord, live, moveInOrder, LIST_KINDS } from './store.js';
import { own, isObj, str } from './util.js';
import { liveList } from './items.js';
import { lookFields } from './listIcons.js';

/** @typedef {import('./store.js').State} State */
/** @typedef {import('./store.js').List} List */

/** 归档了的清单（没删除），按顺序 @param {State} state @returns {List[]} */
export const archivedLists = state => live(state, 'lists').filter(l => l.archived).sort(byOrder);
/** 没删除的清单上的、没删除的东西（删掉的清单里的东西跟着隐藏）。商店页再去掉归档的清单上的（core/stores.js 的 shoppingItems） @param {State} state */
export const visibleItems = state => live(state, 'items').filter(it => liveList(state, it.listId));

/** 默认商店只收在的、没归档的；别的 → null @param {State} state @param {unknown} id */
const storeOrNull = (state, id) => { const s = typeof id === 'string' ? own(isObj(state.data.stores) ? state.data.stores : {}, id) : null; return s && !s.deleted && !s.archived ? s.id : null; };

/**
 * 新建清单：排在最后（order = 现有的最大值 + 1），类型只在这时候选。名字不能空；图标、颜色按 listIcons.js 的 lookFields 整理（和默认一样的存成空的）
 * @param {State} state @param {{ name?: unknown, kind?: unknown, icon?: unknown, glyph?: unknown, color?: unknown, defaultStoreId?: unknown }} f @param {number} [now]
 * @returns {{ ok: true, id: string } | { ok: false, errors: Record<string, string> }}
 */
export function createList(state, f, now = Date.now()) {
  const name = str(f.name).trim();
  if (!name) return { ok: false, errors: { name: 'list.err.name' } };
  const lists = live(state, 'lists');
  const order = lists.length ? Math.max(...lists.map(l => l.order)) + 1 : 0;
  const id = newId('l_');
  const kind = LIST_KINDS.includes(/** @type {any} */ (f.kind)) ? f.kind : 'grocery';
  writeRecord(state, 'lists', { id, sys: null, name, kind, ...lookFields(kind, f),
    order, defaultStoreId: storeOrNull(state, f.defaultStoreId), archived: false, createdAt: now }, now);
  return { ok: true, id };
}

/**
 * 改清单：名字、图标、颜色、默认商店（类型不能改：里面的东西的分类、「以后再说」都跟着类型）。
 * 预置清单名字可以空着（显示界面语言的名字）；自建的不能空。默认商店不存在或归档了的不改。
 * 图标、颜色只改交进来的（面板只交改了的：新版才有的图标、色调，没动就原样留着）。图标是一个选择：交了 icon 或 glyph 就是换了图标，
 * 两样一起按交进来的存（没交的那样清空：自己写的显示在前，留着旧的会盖住新选的）
 * @param {State} state @param {string} id @param {{ name?: unknown, icon?: unknown, glyph?: unknown, color?: unknown, defaultStoreId?: unknown }} f @param {number} [now]
 * @returns {{ ok: true, list: List } | { ok: false, errors: Record<string, string> }}
 */
export function editList(state, id, f, now = Date.now()) {
  const l = liveList(state, id);
  if (!l) return { ok: false, errors: { list: 'list.gone' } };
  const next = { ...l };
  if ('name' in f) {
    const name = str(f.name).trim();
    if (!name && !l.sys) return { ok: false, errors: { name: 'list.err.name' } };
    next.name = name;
  }
  if ('icon' in f || 'glyph' in f) { const lf = lookFields(l.kind, { icon: f.icon, glyph: f.glyph }); next.icon = lf.icon; next.glyph = lf.glyph; }
  if ('color' in f) next.color = lookFields(l.kind, { color: f.color }).color;
  if ('defaultStoreId' in f && (!f.defaultStoreId || storeOrNull(state, f.defaultStoreId) || f.defaultStoreId === l.defaultStoreId)) next.defaultStoreId = /** @type {string | null} */ (f.defaultStoreId || null);
  return { ok: true, list: /** @type {List} */ (writeRecord(state, 'lists', next, now)) };
}

/** 归档 / 取消归档（预置清单也可以） @param {State} state @param {string} id @param {boolean} archived @param {number} [now] */
export function setArchived(state, id, archived, now = Date.now()) {
  const l = liveList(state, id);
  return l ? /** @type {List} */ (writeRecord(state, 'lists', { ...l, archived: !!archived }, now)) : null;
}

/**
 * 删除清单：只有自建的能删（预置的只能归档）。软删除：里面的东西不动，只是跟着隐藏；恢复清单（撤销、最近删除）时一起回来。
 * 删掉了返回 true
 * @param {State} state @param {string} id @param {number} [now]
 */
export function deleteList(state, id, now = Date.now()) {
  const l = liveList(state, id);
  if (!l || l.sys) return false;
  state.data.lists[id] = deletedRecord(l, now);
  return true;
}

/**
 * 首页「编辑」里的 ↑↓：挪到上一张 / 下一张（首页显示的、没归档的）的另一边。只改这一张的 order（store.js 的 moveInOrder），
 * 别的清单不盖新时间（预置清单没动就还是 updatedAt 0）。归档的也交进去：它们的 order 还占着位置，取消归档后回到原处。
 * 挪不动（已经在最前 / 最后、归档了）返回 false
 * @param {State} state @param {string} id @param {1 | -1} dir @param {number} [now]
 */
export function moveList(state, id, dir, now = Date.now()) {
  return moveInOrder(state, 'lists', live(state, 'lists').sort(byOrder), id, dir, l => !l.archived, now);
}
