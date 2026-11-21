// @ts-check
// memory：买过的东西（跨清单的习惯），每个 normName 一条，id = 'm_' + hash64(normName)。
//   加进清单时 recordUse（uses + 1、lastAt、最近一次的写法、kind）；勾成已买时 recordPurchase（这次的商店 n + 1）；
//   改分类、单位时 recordPrefs（下次同名的东西直接用，改成「未分类」也记得）。常去的商店 usualStore 按「买的次数」算：偶尔换一家买一次不改习惯。
//   输入联想 suggestions 也从这里来。
// 写法和 items.js 一样：直接改传进来的 state（在 ctx.mutate 里调用），记录经过 writeRecord 盖时间。
import { normName, hash64, writeRecord } from './store.js';
import { own, isObj, str } from './util.js';

/** @typedef {import('./store.js').State} State */
/** @typedef {import('./store.js').Memory} Memory */
/** @typedef {import('./store.js').ListKind} ListKind */

/** @param {unknown} name */
export const memoryId = name => 'm_' + hash64(normName(name));
const mems = (/** @type {State} */ s) => (isObj(s.data.memory) ? s.data.memory : {});

/** 这个名字的记录（没删除的）；没有 → null @param {State} state @param {unknown} name @returns {Memory | null} */
export function memoryOf(state, name) {
  if (!normName(name)) return null;
  const m = own(mems(state), memoryId(name));
  return m && !m.deleted ? m : null;
}

/** 改一条记录：没有（或删掉了）就从头开始一条（writeRecord 保证修改时间比删除新） @param {State} state @param {string} name @param {ListKind | null} kind @param {(m: Record<string, any>) => void} fn @param {number} now */
function change(state, name, kind, fn, now) {
  if (!normName(name)) return null;
  const id = memoryId(name), prev = own(mems(state), id);
  const m = prev && !prev.deleted ? structuredClone(prev)
    : { id, name, kind: kind || 'grocery', categoryId: null, unit: '', qty: null, stores: {}, uses: 0, lastAt: 0, createdAt: now };
  fn(m);
  return /** @type {Memory} */ (writeRecord(state, 'memory', m, now));
}

/** 加进清单（新加或恢复）时：uses + 1、lastAt、最近一次的写法、清单的类型 @param {State} state @param {string} name @param {ListKind} kind @param {number} [now] */
export function recordUse(state, name, kind, now = Date.now()) {
  return change(state, str(name).trim(), kind, m => { m.uses = (m.uses || 0) + 1; m.lastAt = now; m.name = str(name).trim(); m.kind = kind; }, now);
}

/** 勾成已买：这次的商店 n + 1、at 更新；没指定商店不计 @param {State} state @param {string} name @param {string | null} storeId @param {ListKind} kind @param {number} [now] */
export function recordPurchase(state, name, storeId, kind, now = Date.now()) {
  if (!storeId) return null;
  return change(state, name, kind, m => { const cur = own(m.stores, storeId); m.stores[storeId] = { ...(cur || {}), n: ((cur && cur.n) || 0) + 1, at: now }; }, now);
}

/**
 * 取消刚才那次购买（点错了又点回来；什么时候算「刚才」由 items.js 的 UNTICK_MS 定）：n - 1，减到 0 就去掉，不然点两下就多算一次。
 * at 不动（不知道上一次是什么时候）
 * @param {State} state @param {string} name @param {string | null} storeId @param {number} [now]
 */
export function unrecordPurchase(state, name, storeId, now = Date.now()) {
  const m = memoryOf(state, name);
  if (!storeId || !m || !own(m.stores, storeId) || !(m.stores[storeId].n > 0)) return null;
  return change(state, name, m.kind, x => { const n = x.stores[storeId].n - 1; if (n > 0) x.stores[storeId] = { ...x.stores[storeId], n }; else delete x.stores[storeId]; }, now);
}

/**
 * 改了分类、单位：记下来，下次同名的东西直接用。只记给了的键（prefs 里没有 unit 就不动单位）。
 * 分类记一个 categorySet：改成「未分类」（categoryId 是 null）和「没改过」（也是 null）要分得开，不然分错的又猜回来
 * @param {State} state @param {string} name @param {ListKind} kind @param {{ categoryId?: string | null, unit?: string }} prefs @param {number} [now]
 */
export function recordPrefs(state, name, kind, prefs, now = Date.now()) {
  return change(state, name, kind, m => {
    if ('categoryId' in prefs) { m.categoryId = prefs.categoryId || null; m.categorySet = true; }
    if ('unit' in prefs) m.unit = str(prefs.unit).trim();
  }, now);
}

/**
 * 常去的商店：买的次数 n 最多的，一样多取最近买的（at 新的），再一样按 id（每台设备一样）。
 * 跳过已删除、已归档、不存在的商店：归档了的店不该再被默认选上
 * @param {State} state @param {Memory | null | undefined} mem
 * @returns {string | null}
 */
export function usualStore(state, mem) {
  if (!mem || !isObj(mem.stores)) return null;
  const stores = isObj(state.data.stores) ? state.data.stores : {};
  let best = null, bn = 0, bat = -1;
  for (const [id, v] of Object.entries(mem.stores)) {
    const s = own(stores, id);
    if (!s || s.deleted || s.archived || !v || !(v.n > 0)) continue;
    if (v.n > bn || (v.n === bn && (v.at > bat || (v.at === bat && best !== null && id < best)))) { best = id; bn = v.n; bat = v.at; }
  }
  return best;
}

/**
 * @typedef {object} Suggestion
 * @property {string} id         memory 的 id
 * @property {string} name       最近一次的写法
 * @property {string | null} storeId  常去的商店
 * @property {boolean} inList    已经是这张清单上「要买」的（没删除）
 */

/**
 * 打字时的联想：从买过的东西（所有清单）里找。名字开头就对上的排在中间对上的前面；再按加过的次数、最近加的时间。空的 → 没有
 * @param {State} state @param {string} listId @param {unknown} query @param {{ limit?: number }} [opts]
 * @returns {Suggestion[]}
 */
export function suggestions(state, listId, query, { limit = 8 } = {}) {
  const q = normName(query);
  if (!q) return [];
  const need = new Set();
  for (const it of Object.values(isObj(state.data.items) ? state.data.items : {})) if (it && !it.deleted && it.listId === listId && it.status === 'need') need.add(normName(it.name));
  /** @type {{ m: Memory, key: string, rank: number }[]} */
  const hits = [];
  for (const m of Object.values(mems(state))) {
    if (!m || m.deleted) continue;
    const key = normName(m.name);
    if (!key) continue;
    const rank = key.startsWith(q) ? 0 : key.includes(q) ? 1 : -1;
    if (rank >= 0) hits.push({ m, key, rank });
  }
  hits.sort((a, b) => a.rank - b.rank || b.m.uses - a.m.uses || b.m.lastAt - a.m.lastAt || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return hits.slice(0, Math.max(0, limit)).map(({ m, key }) => ({ id: m.id, name: m.name, storeId: usualStore(state, m), inList: need.has(key) }));
}
