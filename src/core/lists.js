// @ts-check
// 清单本身：新建、改名 / 换图标 / 默认商店、归档、删除（只有自建的；软删除，里面的东西留着、跟着隐藏，恢复清单时一起回来）、排顺序。
// 写法和 items.js 一样：直接改传进来的 state（在 ctx.mutate 里调用），记录经过 writeRecord（没变的不盖新时间）。
import { newId, byOrder, writeRecord, deletedRecord, live, LIST_KINDS } from './store.js';
import { own, isObj, str } from './util.js';
import { liveList } from './items.js';

/** @typedef {import('./store.js').State} State */
/** @typedef {import('./store.js').List} List */

// 新建清单时可以选的图标（写成转义：编辑器不会弄丢变体选择符 FE0F）。两个默认图标（store.js 的 DEFAULT_LIST_ICON）都要在里面，测试会查
export const LIST_ICONS = [
  '\u{1F96C}', '\u{1F6D2}', '\u{1F6CD}\uFE0F', '\u{1F34E}', '\u{1F969}', '\u{1F35E}', '\u{1F9C0}', '\u{1F377}',
  '\u{1F9F4}', '\u{1F9FB}', '\u{1F455}', '\u{1F4DA}', '\u{1F527}', '\u{1FAB5}', '\u{1F381}', '\u{1F43E}',
];

/** 自己输入的图标只留第一个字（一个 emoji 可能由好几个码位组成：👨‍👩‍👧、🇹🇼，按「字形」切） @param {unknown} s */
export function firstGrapheme(s) {
  const t = str(s).trim();
  if (!t) return '';
  if (typeof Intl !== 'undefined' && Intl.Segmenter) { for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(t)) return segment; }
  return [...t][0];
}

/** 归档了的清单（没删除），按顺序 @param {State} state @returns {List[]} */
export const archivedLists = state => live(state, 'lists').filter(l => l.archived).sort(byOrder);
/** 没删除的清单上的、没删除的东西（删掉的清单里的东西跟着隐藏）。第 4 步的商店页用 @param {State} state */
export const visibleItems = state => live(state, 'items').filter(it => liveList(state, it.listId));

/** 默认商店只收在的、没归档的；别的 → null @param {State} state @param {unknown} id */
const storeOrNull = (state, id) => { const s = typeof id === 'string' ? own(isObj(state.data.stores) ? state.data.stores : {}, id) : null; return s && !s.deleted && !s.archived ? s.id : null; };

/**
 * 新建清单：排在最后（order = 现有的最大值 + 1），类型只在这时候选。名字不能空
 * @param {State} state @param {{ name?: unknown, kind?: unknown, icon?: unknown, defaultStoreId?: unknown }} f @param {number} [now]
 * @returns {{ ok: true, id: string } | { ok: false, errors: Record<string, string> }}
 */
export function createList(state, f, now = Date.now()) {
  const name = str(f.name).trim();
  if (!name) return { ok: false, errors: { name: 'list.err.name' } };
  const lists = live(state, 'lists');
  const order = lists.length ? Math.max(...lists.map(l => l.order)) + 1 : 0;
  const id = newId('l_');
  writeRecord(state, 'lists', { id, sys: null, name, kind: LIST_KINDS.includes(/** @type {any} */ (f.kind)) ? f.kind : 'grocery',
    icon: firstGrapheme(f.icon), order, defaultStoreId: storeOrNull(state, f.defaultStoreId), archived: false, createdAt: now }, now);
  return { ok: true, id };
}

/**
 * 改清单：名字、图标、默认商店（类型不能改：里面的东西的分类、「以后再说」都跟着类型）。
 * 预置清单名字可以空着（显示界面语言的名字）；自建的不能空。默认商店不存在或归档了的不改
 * @param {State} state @param {string} id @param {{ name?: unknown, icon?: unknown, defaultStoreId?: unknown }} f @param {number} [now]
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
  if ('icon' in f) next.icon = firstGrapheme(f.icon);
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
 * 首页「编辑」里的 ↑↓：和上一张 / 下一张（首页显示的、没归档的）换位置，再按新顺序把 order 写成 0、1、2……
 * 只有 order 真的变了的清单才盖新时间（预置清单没动就还是 updatedAt 0）。挪不动（已经在最前 / 最后）返回 false
 * @param {State} state @param {string} id @param {1 | -1} dir @param {number} [now]
 */
export function moveList(state, id, dir, now = Date.now()) {
  const arr = live(state, 'lists').filter(l => !l.archived).sort(byOrder);
  const i = arr.findIndex(l => l.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= arr.length) return false;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  arr.forEach((l, k) => { if (l.order !== k) writeRecord(state, 'lists', { ...l, order: k }, now); });
  return true;
}
