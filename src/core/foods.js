// @ts-check
// foods：常吃的（第三版）。记饮食时手动写过的东西（「拿铁 190 千卡」「公司食堂的午饭」）按名字记一条，下次输入时联想、点一下就填好。
//   id = 'f_' + hash64(normName)：和 memory 一样，两台设备各自记同一样不会变成两条（合并补字段，store.js 的 mergeRecord）。
//   kind 'food' 的 per 是每份；'ingredient'（第 15 步：食材每 100 g 的营养）也放在这里，记饮食不碰它。
// 营养数的读法也在这里（readNutrition：输入框里的字 → 千卡整数、克一位小数；饮食记录、食谱的每人份、饮食目标共用）、乘份数 scaleNutrition。
// 写法和 memory.js 一样：直接改传进来的 state（在 ctx.mutate 里调用），记录经过 writeRecord（内容没变不盖新时间）。
import { normName, hash64, writeRecord, normalizeNutrition, nutrValue, NUTRIENTS } from './store.js';
import { own, isObj, str } from './util.js';
import { readQty } from './parse.js';

/** @typedef {import('./store.js').State} State */
/** @typedef {import('./store.js').Food} Food */
/** @typedef {import('./store.js').Nutrition} Nutrition */

// ---------- 营养数 ----------
/** 一份（或一天）的热量最多写多少千卡、营养素最多多少克：再大多半是多打了一个 0 */
export const KCAL_MAX = 9999;
export const GRAM_MAX = 999;
/**
 * 输入框里的营养（字或数，{ kcal, protein, carbs, fat }）→ { ok, value, errors }。空的是没填（null）；读不出来、负数 → 'log.err.num'；
 * 超过上限 → 'log.err.kcalMax' / 'log.err.gramMax'（错误按营养的键放）。value 整理过：千卡整数、克最多一位小数，有错的那一样是 null
 * @param {unknown} input
 * @returns {{ ok: boolean, value: Nutrition, errors: Record<string, string> }}
 */
export function readNutrition(input) {
  /** @type {Record<string, string>} */
  const errors = {};
  /** @type {Record<string, number | null>} */
  const value = {};
  for (const k of NUTRIENTS) {
    const raw = isObj(input) ? input[k] : null;
    const n = typeof raw === 'number' ? raw : readQty(raw);
    value[k] = null;
    if (n == null) continue;
    if (!Number.isFinite(n) || n < 0) errors[k] = 'log.err.num';
    else if (n > (k === 'kcal' ? KCAL_MAX : GRAM_MAX)) errors[k] = k === 'kcal' ? 'log.err.kcalMax' : 'log.err.gramMax';
    else value[k] = nutrValue(k, n);
  }
  return { ok: !Object.keys(errors).length, value: /** @type {Nutrition} */ (value), errors };
}
/** 填了至少一样 @param {unknown} n */
export const hasNutrition = (n) => isObj(n) && NUTRIENTS.some(k => typeof n[k] === 'number');
/**
 * 每份 × 份数 = 合计：每样乘完再整理（千卡整数、克一位小数），没填的还是 null。份数不对的当 1
 * @param {unknown} per @param {number} servings @returns {Nutrition}
 */
export function scaleNutrition(per, servings) {
  const p = normalizeNutrition(per), sv = Number.isFinite(servings) && servings > 0 ? servings : 1;
  return /** @type {Nutrition} */ (Object.fromEntries(NUTRIENTS.map(k => [k, p[k] == null ? null : nutrValue(k, /** @type {number} */ (p[k]) * sv)])));
}

// ---------- 常吃的 ----------
/** 按名字算的 id（简繁、大小写、空白不同的是同一条） @param {unknown} name */
export const foodId = (name) => 'f_' + hash64(normName(name));
const col = (/** @type {State} */ s) => (isObj(own(s.data, 'foods')) ? s.data.foods : {});

/** 没删除的一条；没有 → null @param {State} state @param {unknown} id @returns {Food | null} */
export function liveFood(state, id) {
  const f = typeof id === 'string' ? own(col(state), id) : null;
  return f && !f.deleted ? f : null;
}
/** 这个名字的常吃的（kind 'food'，没删除的）；没有 → null @param {State} state @param {unknown} name @returns {Food | null} */
export function foodOf(state, name) {
  if (!normName(name)) return null;
  const f = liveFood(state, foodId(name));
  return f && f.kind === 'food' ? f : null;
}

/**
 * 记住一样常吃的（记饮食时手动写的、从常吃的选了又改过数的）：名字用这次的写法；每份营养**只改 per 里给了的那几样**（给了、是空的 = 用户删掉了，
 * 照写成没填），没给的留着记住的。给哪几样由调的地方定（core/log.js）：面板是从这一条填好的（点了它、打的名字正好是它时自动填上、计划里只写一句的）
 * → 四样都给（空着就是删掉了）；不是从它填的（打名字时它还没同步过来、别处调用）→ 只给填了的（空着是没填，不能把记住的 190 千卡冲成没填：
 * 同一条记录，冲掉的那份更新，同步以后每台设备上都没了）；改一条旧记录 → 只给改了的。
 * use：这次是真的记了一次（uses + 1、lastAt）；改一条旧记录时只更新数，不算又吃了一次。
 * 同名的是食材的营养（kind 'ingredient'，第 15 步）时不盖掉它（那是每 100 g 的，混进每份的数就错了），返回 null。名字空的 → null
 * @param {State} state @param {string} name @param {Partial<Record<string, unknown>> | null} per 每份的营养（给了的几样）
 * @param {{ use?: boolean }} [opts] @param {number} [now]
 * @returns {Food | null}
 */
export function rememberFood(state, name, per, { use = true } = {}, now = Date.now()) {
  const nm = str(name).trim();
  if (!normName(nm)) return null;
  const id = foodId(nm), prev = own(col(state), id);
  if (prev && !prev.deleted && prev.kind !== 'food') return null;
  // 改的时候保留原来的 createdAt（不然合并时会被当成「各自从头建的」）；没有或删掉了就从头开始一条（writeRecord 保证比删除新）
  const f = prev && !prev.deleted ? structuredClone(prev)
    : { id, name: nm, kind: 'food', per: normalizeNutrition(null), perUnit: 'serving', grams: {}, ref: null, uses: 0, lastAt: 0, createdAt: now };
  f.name = nm;
  if (isObj(per)) { const p = normalizeNutrition(per); for (const k of NUTRIENTS) if (own(per, k) !== undefined) f.per[k] = p[k]; }
  if (use) { f.uses = (f.uses || 0) + 1; f.lastAt = now; }
  return /** @type {Food} */ (writeRecord(state, 'foods', f, now));
}
/** 只留填了的几样（不是从这一条常吃的填好的：空着的是没填，不是删掉） @param {Record<string, number | null>} per */
export const filledOnly = (per) => Object.fromEntries(NUTRIENTS.filter(k => per[k] != null).map(k => [k, per[k]]));

/**
 * 输入时联想常吃的（只有 kind 'food'）：名字开头就对上的在中间对上的前面，再按记过的次数、最近一次；
 * 空的搜索词 → 「常吃的」：按次数、最近一次排的前几样（面板一打开就列出来，点一下就填好）
 * @param {State} state @param {unknown} query @param {{ limit?: number }} [opts]
 * @returns {Food[]}
 */
export function foodSuggestions(state, query, { limit = 8 } = {}) {
  const q = normName(query);
  /** @type {{ f: Food, key: string, rank: number }[]} */
  const hits = [];
  for (const f of Object.values(col(state))) {
    if (!f || f.deleted || f.kind !== 'food') continue;
    const key = normName(f.name);
    if (!key) continue;
    const rank = !q ? 0 : key.startsWith(q) ? 0 : key.includes(q) ? 1 : -1;
    if (rank >= 0) hits.push({ f, key, rank });
  }
  hits.sort((a, b) => a.rank - b.rank || b.f.uses - a.f.uses || b.f.lastAt - a.f.lastAt || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return hits.slice(0, Math.max(0, limit)).map(x => x.f);
}
