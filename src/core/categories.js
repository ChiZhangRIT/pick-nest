// @ts-check
// 分类：设置里按「用在哪种清单」分三组管理（食材 / 一般 / 两边都用）：新增（名字 + 用在哪种）、改名、组内排顺序、删除。
// 预置分类和自己加的一样能改名、排顺序、删除（删掉的预置分类 ensureSeeds 不会补回来）；预置的名字可以空着，显示界面语言的名字。
// 名字不能和同一张清单上会一起出现的分类重名（和商店一样：选择列表里两个一样的分不清）。
// 删除是软删除：东西的 categoryId 不动，分类不在了就归到「未分类」（group.js 的分组、编辑面板都这么看），恢复时回来。
// 「用在哪种」只在新增时选：改了的话，已经分在这一类的东西会突然「不合适」（items.js 的 categoryFits）。
// 写法和 items.js 一样：直接改传进来的 state（在 ctx.mutate 里调用），记录经过 writeRecord（没变的不盖新时间）。
import { newId, byOrder, writeRecord, deletedRecord, live, moveInOrder, normName, categoryName, LIST_KINDS } from './store.js';
import { own, isObj, str } from './util.js';

/** @typedef {import('./store.js').State} State */
/** @typedef {import('./store.js').Category} Category */
/** @typedef {import('./store.js').ListKind} ListKind */
/** @typedef {import('./store.js').Translate} Translate */

/** 设置里的三组：kind 'grocery' 只给食材清单、'general' 只给一般清单、null 两边都用 */
export const CATEGORY_SECTIONS = /** @type {const} */ (['grocery', 'general', 'both']);
/** 组名 → kind @param {unknown} sec @returns {ListKind | null} */
export const kindOfSection = sec => (LIST_KINDS.includes(/** @type {any} */ (sec)) ? /** @type {ListKind} */ (sec) : null);
/** kind → 组名 @param {ListKind | null} kind */
export const sectionOf = kind => (kind == null ? 'both' : kind);

/** 没删除的分类；没有 → null @param {State} state @param {unknown} id @returns {Category | null} */
export function liveCategory(state, id) {
  const c = typeof id === 'string' ? own(isObj(state.data.categories) ? state.data.categories : {}, id) : null;
  return c && !c.deleted ? c : null;
}
/** 没删除的分类按顺序（所有组穿插在一起：组内的先后就是清单里分组的先后） @param {State} state @returns {Category[]} */
const ordered = state => live(state, 'categories').sort(byOrder);

/** 设置里的三组，各自按顺序 @param {State} state @returns {{ grocery: Category[], general: Category[], both: Category[] }} */
export function categorySections(state) {
  /** @type {{ grocery: Category[], general: Category[], both: Category[] }} */
  const out = { grocery: [], general: [], both: [] };
  for (const c of ordered(state)) out[sectionOf(c.kind)].push(c);
  return out;
}
/** 能给这种清单用的分类（kind 一样或两边都用），按顺序 @param {State} state @param {ListKind} kind @returns {Category[]} */
export const categoriesFor = (state, kind) => ordered(state).filter(c => c.kind == null || c.kind === kind);

/**
 * 名字和别的（没删除的）分类重名吗：只比会出现在同一个选择列表、同一张清单上的（同一种，或者有一边是两边都用的）——
 * 编辑面板里两个「宠物用品」分不清；食材的「其他」和一般的「其他」碰不到一起，可以同名。删掉的不算。
 * 预置分类没改过名的按显示的名字比：t 由页面给（core 不管界面语言），没给就只比写了名字的
 * @param {State} state @param {string} name 要显示的名字 @param {ListKind | null} kind @param {string | null} self 改名时自己的 id @param {Translate} [t]
 */
function nameTaken(state, name, kind, self, t) {
  const key = normName(name);
  return live(state, 'categories').some(c => c.id !== self && (c.kind == null || kind == null || c.kind === kind)
    && normName(t ? categoryName(c, t) : c.name) === key);
}

/** 这个分类的名字（显示的那个）和会一起出现的别的分类撞了吗（最近删除里恢复之前查）。没给 t 时没改过名的预置分类不算撞 @param {State} state @param {Category} cat @param {Translate} [t] */
export function categoryNameTaken(state, cat, t) {
  const shown = t ? categoryName(cat, t) : str(cat.name).trim();
  return !!shown && nameTaken(state, shown, cat.kind, cat.id, t);
}

/**
 * 新增分类：用在哪种清单（'grocery' | 'general'，别的都是两边都用），排在最后（order = 现有的最大值 + 1：在它那一组的最后）。
 * 名字不能空，不能和同一种清单上的分类重名（nameTaken）
 * @param {State} state @param {{ name?: unknown, kind?: unknown }} f @param {number} [now] @param {Translate} [t]
 * @returns {{ ok: true, id: string } | { ok: false, errors: Record<string, string> }}
 */
export function createCategory(state, f, now = Date.now(), t) {
  const name = str(f.name).trim(), kind = kindOfSection(f.kind);
  if (!name) return { ok: false, errors: { name: 'cat.err.name' } };
  if (nameTaken(state, name, kind, null, t)) return { ok: false, errors: { name: 'cat.err.taken' } };
  const all = live(state, 'categories');
  const id = newId('c_');
  writeRecord(state, 'categories', { id, sys: null, name, kind, order: all.length ? Math.max(...all.map(c => c.order)) + 1 : 0, createdAt: now }, now);
  return { ok: true, id };
}

/**
 * 改名。预置分类的名字可以空着（显示界面语言的名字，换语言跟着换）；自己加的不能空。不能和同一种清单上的分类重名（清空了的按自带的名字比）
 * @param {State} state @param {string} id @param {unknown} name @param {number} [now] @param {Translate} [t]
 * @returns {{ ok: true, category: Category } | { ok: false, errors: Record<string, string> }}
 */
export function renameCategory(state, id, name, now = Date.now(), t) {
  const c = liveCategory(state, id);
  if (!c) return { ok: false, errors: { name: 'cat.gone' } };
  const nm = str(name).trim();
  if (!nm && !c.sys) return { ok: false, errors: { name: 'cat.err.name' } };
  const shown = nm || (t ? categoryName({ ...c, name: '' }, t) : '');
  if (shown && nameTaken(state, shown, c.kind, id, t)) return { ok: false, errors: { name: 'cat.err.taken' } };
  return { ok: true, category: /** @type {Category} */ (writeRecord(state, 'categories', { ...c, name: nm }, now)) };
}

/** 删除分类（软删除；东西归到「未分类」，恢复时回来）。删掉了返回 true @param {State} state @param {string} id @param {number} [now] */
export function deleteCategory(state, id, now = Date.now()) {
  const c = liveCategory(state, id);
  if (!c) return false;
  state.data.categories[id] = deletedRecord(c, now);
  return true;
}

/**
 * 设置里的 ↑↓：挪到同一组里上一个 / 下一个的另一边（跳过中间别的组的）。所有分类是一套顺序（两边都用的和食材的会在同一张清单上），
 * 只改这一个的 order（store.js 的 moveInOrder），别的分类不盖新时间
 * @param {State} state @param {string} id @param {1 | -1} dir @param {number} [now]
 */
export function moveCategory(state, id, dir, now = Date.now()) {
  const c = liveCategory(state, id);
  if (!c) return false;
  return moveInOrder(state, 'categories', ordered(state), id, dir, x => sectionOf(x.kind) === sectionOf(c.kind), now);
}
