// @ts-check
// 自动估算（第 15 步）：按食谱的食材用量估算每人份的热量和营养素（estimateRecipe）。每一样食材：认成内置营养表（src/data/nutrition.js，
//   USDA FoodData Central SR Legacy）的哪一样（nutrition.js 的 findFood），用量换成克（gramsFor），乘上每 100 g 的营养，加起来再除以几人份。
// 自己的说法比表优先：foods 里 kind 'ingredient' 的那一条（按食材名字算 id，所有食谱共用，记一次以后都认）——
//   ref：「指定成表里的哪一样」（认不出的、认错了的）→ 营养和单位重量用那一样的；
//   per：自己填的每 100 g → 营养用自己的（没填的那几样照表里那一样的：只抄了包装上的热量，蛋白质、脂肪不能就这么没了；
//   单位重量照样用表里那一样的）；grams：自己填的「一个多重」→ 比表里的优先。
// 算不了的不瞎猜，列出来（missing）：没写用量的（适量、少许）、表里没有的、不知道一个多重 / 认不出单位的；可选的不算（也列出来，optional）。
// 食谱填了每人份营养（recipe.nutrition，手动的）时一律以手动的为准（recipeNutrition）；估算出来的数界面上一律写「约」：炸、煎吸进去的油、
//   做的时候的损耗都没算，品种、牌子也差得不少，差个 20–30% 很正常。
// 估算拿去用（记饮食时填进框里、「用手动的」、编辑页「填进去」）之前先过 usableEstimate：算进去的只有水、盐（0 千卡）、又有没算进去的，
//   那是「还算不出来」，不是 0 千卡；超过一份能写的上限（没写几人份的一整锅卤肉）的不填，不然记不上、存不了。
// 写法和 foods.js 一样：saveIngredientFood / clearIngredientFood 直接改传进来的 state（在 ctx.mutate 里调用），记录经过 writeRecord / deletedRecord。
import { NUTRIENTS, nutrValue, normalizeNutrition, normName, writeRecord, deletedRecord } from './store.js';
import { own, isObj, str } from './util.js';
import { readQty } from './parse.js';
import { findFood, foodById, gramsFor, nameHead, unitKey } from './nutrition.js';
import { foodId, liveFood, hasNutrition, KCAL_MAX, GRAM_MAX } from './foods.js';

/** @typedef {import('./store.js').State} State */
/** @typedef {import('./store.js').Food} Food */
/** @typedef {import('./store.js').Nutrition} Nutrition */
/** @typedef {import('./store.js').Ingredient} Ingredient */
/** @typedef {import('../data/nutrition.js').NutritionFood} NutritionFood */
/**
 * @typedef {'table' | 'manual' | 'mine'} EstSource
 * 营养是从哪来的：table 表里自动认出来的；manual 自己指定成表里的哪一样（foods 的 ref）；mine 自己填的每 100 g
 */
/**
 * @typedef {'ok' | 'vague' | 'unknown-food' | 'unknown-unit' | 'optional'} EstStatus
 * ok 算进去了；vague 没写用量（适量、少许）；unknown-food 表里没有、也没自己说过；unknown-unit 认得这一样、换不成克
 * （reason 'weight'：不知道一个多重；'unit'：认不出单位）；optional 可选的，不算
 */
/**
 * @typedef {{ key: string, name: string, qty: number | null, unit: string, grams: number | null, guess: boolean, food: NutritionFood | null,
 *   mine: Food | null, source: EstSource | null, status: EstStatus, reason: 'weight' | 'unit' | null, nutrition: Nutrition | null, gaps: string[] }} EstLine
 * 一样食材：qty 按人数换算过的用量（没四舍五入）；grams 换成多少克；guess 体积按 1 g/ml 猜的（这一样不知道密度）；
 * food 用的是表里的哪一样（自动认的或者指定的）；mine 自己的说法（foods 里那一条）；nutrition 这一样算进去的营养（只有 ok 的有）；
 * gaps：算进去了、但没有数的那几样营养素（表里没有的食材自己只填了热量：明细里写着，合计里少了它的）
 */
/**
 * @typedef {{ servings: number, whole: boolean, perServing: Nutrition, total: Nutrition, lines: EstLine[], missing: EstLine[], optional: EstLine[],
 *   counted: number, guess: boolean, blank: boolean }} Estimate
 * servings：按几人份算的（total 是这么多份的）；whole：食谱没写几人份，一整道当一份；counted：算进去了几样；
 * blank：算进去的都是 0（水、盐）、又有没算进去的——算不出来，不是 0 千卡（麻辣烫：底料、鱼豆腐没算进去，只剩水和盐）；
 * perServing / total：千卡整数、克一位小数，算进去的里面一样也没有这一项的是 null
 */

/** 食材自己的说法：这个名字（只看逗号、括号前面那段，和 findFood 一样）的 foods 里 kind 'ingredient'、没删除的那一条；没有 → null @param {State} state @param {unknown} name */
export function ingredientFood(state, name) {
  const full = str(name).trim(), head = nameHead(full);
  for (const n of head === full ? [full] : [head, full]) {
    if (!normName(n)) continue;
    const f = liveFood(state, foodId(n));
    if (f && f.kind === 'ingredient') return f;
  }
  return null;
}

/**
 * 一样食材按什么算：自己填的每 100 g（mine）→ 指定成的表里那一样（manual）→ 表里自动认的（table）；单位重量自己填的优先，再是表里那一样的。
 * 自己填的只填了几样（照包装抄了热量）：没填的那几样照表里那一样的（「自己填」的格子里淡淡写着的就是它），表里也没有的才是 null。
 * 都没有 → per100 是 null（列成「表里没有」）
 * @param {State} state @param {unknown} name
 */
export function resolveIngredient(state, name) {
  const mine = ingredientFood(state, name);
  const ref = mine && mine.ref ? foodById(mine.ref) : null;
  const auto = findFood(name);
  // 指定的那一样（以后的版本表里没有了）找不到：照自动认的算，不当成认不出
  const food = ref || auto;
  const ownPer = !!mine && hasNutrition(mine.per);
  /** @type {Nutrition | null} */
  let per100 = food ? food.per100 : null;
  if (ownPer) {
    const p = /** @type {Record<string, number | null>} */ (normalizeNutrition(/** @type {Food} */ (mine).per));
    per100 = /** @type {Nutrition} */ (Object.fromEntries(NUTRIENTS.map(k => [k, p[k] ?? (food ? food.per100[k] : null) ?? null])));
  }
  /** @type {EstSource | null} */
  const source = ownPer ? 'mine' : ref ? 'manual' : auto ? 'table' : null;
  const weighable = { grams: { ...(food ? food.grams : {}), ...(mine ? mine.grams : {}) }, density: food ? food.density : null, volume: food && food.volume === false ? false : undefined };
  return { mine, food, auto, per100, source, weighable };
}

/** 算不进去、但这道菜里确实有的（可选的另外列） */
const MISSING = new Set(['vague', 'unknown-food', 'unknown-unit']);

/**
 * 按食材用量估算：每一样换成克、乘每 100 g 的营养，加起来是 total（servings 份的），除以份数是 perServing。
 * servings：要算几人份的（默认食谱写的几人份；用量按比例换算，每人份不变）；食谱没写几人份时一整道当一份（whole）。
 * 合计按没四舍五入的数加完、除完再整理（千卡整数、克一位小数），每人份不是四舍五入过的合计再除的
 * @param {State} state @param {{ servings?: number | null, ings?: Ingredient[] } | null} recipe @param {{ servings?: number | null }} [opts]
 * @returns {Estimate}
 */
export function estimateRecipe(state, recipe, { servings = null } = {}) {
  const sv = recipe && recipe.servings;
  const base = typeof sv === 'number' && Number.isFinite(sv) && sv > 0 ? sv : null;
  const want = typeof servings === 'number' && Number.isFinite(servings) && servings > 0 ? servings : base || 1;
  const f = want / (base || 1);
  /** @type {Record<string, number>} */
  const sum = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  const has = new Set();
  /** @type {EstLine[]} */
  const lines = [];
  for (const g of recipe && Array.isArray(recipe.ings) ? recipe.ings : []) {
    const name = str(g && g.name).trim();
    if (!name) continue;
    const qty = typeof g.qty === 'number' && Number.isFinite(g.qty) && g.qty > 0 ? g.qty * f : null;
    const r = resolveIngredient(state, name);
    /** @type {EstLine} */
    const line = { key: str(g.key), name, qty, unit: str(g.unit).trim(), grams: null, guess: false, food: r.food, mine: r.mine, source: r.source,
      status: 'ok', reason: null, nutrition: null, gaps: [] };
    if (g.optional === true) line.status = 'optional';
    else if (qty == null) line.status = 'vague';
    else if (!r.per100) line.status = 'unknown-food';
    else {
      const w = gramsFor(r.weighable, qty, line.unit);
      if (w.grams == null) { line.status = 'unknown-unit'; line.reason = w.reason === 'unit' ? 'unit' : 'weight'; }
      else {
        line.grams = w.grams; line.guess = w.guess;
        const p = /** @type {Nutrition} */ (r.per100);
        /** @type {Record<string, number | null>} */
        const n = {};
        for (const k of NUTRIENTS) {
          const v = p[k];
          if (v == null) { n[k] = null; line.gaps.push(k); continue; }
          const x = v * w.grams / 100;
          sum[k] += x; has.add(k);
          n[k] = nutrValue(k, x);
        }
        line.nutrition = /** @type {Nutrition} */ (n);
      }
    }
    lines.push(line);
  }
  const out = (/** @type {number} */ div) => /** @type {Nutrition} */ (Object.fromEntries(NUTRIENTS.map(k => [k, has.has(k) ? nutrValue(k, sum[k] / div) : null])));
  const counted = lines.filter(l => l.status === 'ok');
  const missing = lines.filter(l => MISSING.has(l.status));
  return { servings: want, whole: base == null, perServing: out(want), total: out(1), lines,
    missing, optional: lines.filter(l => l.status === 'optional'),
    counted: counted.length, guess: counted.some(l => l.guess),
    blank: !!counted.length && !!missing.length && NUTRIENTS.every(k => !(sum[k] > 0)) };
}

/**
 * 估算能不能拿去当这道菜的营养用（记饮食时填进框里、「用手动的」、编辑页「填进去」）：至少算进去一样、有数；不是 blank（算进去的只有 0 千卡的水、盐，
 * 又有没算进去的：记成 0 千卡，一天的合计就当这顿没吃）；每人份不超过一份能写的上限（foods.js 的 KCAL_MAX、GRAM_MAX：没写几人份的一整锅卤肉
 * 一万多千卡，填进去记不上、抄成手动的以后食谱改个名字都存不了）
 * @param {Estimate} est
 */
export function usableEstimate(est) {
  if (!est.counted || est.blank || !hasNutrition(est.perServing)) return false;
  return NUTRIENTS.every(k => { const v = est.perServing[k]; return v == null || v <= (k === 'kcal' ? KCAL_MAX : GRAM_MAX); });
}

/**
 * 这道食谱的每人份营养：手动填了的（recipe.nutrition）以手动的为准；没填的用估算（usableEstimate 过了的才算）；都没有 → null。
 * estimated：是估算的（界面上写「约」，记饮食时记成 estimated）；estimate：估算的全部（没算进去的 missing、一整道当一份的 whole：
 * 记饮食的面板上说一句）
 * @param {State} state @param {any} recipe
 * @returns {{ per: Nutrition, estimated: boolean, estimate: Estimate | null } | null}
 */
export function recipeNutrition(state, recipe) {
  if (!recipe) return null;
  if (hasNutrition(recipe.nutrition)) return { per: /** @type {Nutrition} */ (normalizeNutrition(recipe.nutrition)), estimated: false, estimate: null };
  const est = estimateRecipe(state, recipe);
  return usableEstimate(est) ? { per: est.perServing, estimated: true, estimate: est } : null;
}

// ---------- 自己的说法（存进 foods，所有食谱都认） ----------
/** 自己填的每 100 g：热量最多 900 千卡（纯油是 884）、每样营养素最多 100 g；「一个多重」最多 10 kg（一个西瓜） */
export const PER100_KCAL_MAX = 900;
export const PER100_GRAM_MAX = 100;
export const UNIT_GRAMS_MAX = 10000;

/**
 * 检查「自己填」面板交来的：per（每 100 g，输入框里的字，空的是没填）、grams（一个多重，空的 = 不要了）。
 * 错误是文案的键：读不出来、负数 'log.err.num'，太大 'est.err.kcal100' / 'est.err.gram100' / 'est.err.grams'，按 kcal / protein / carbs / fat / grams 放
 * @param {{ per?: unknown, grams?: unknown }} input
 * @returns {{ ok: boolean, per: Nutrition | undefined, grams: number | null | undefined, errors: Record<string, string> }}
 */
export function validateIngredientInput(input) {
  /** @type {Record<string, string>} */
  const errors = {};
  /** @type {Nutrition | undefined} */
  let per;
  if (isObj(input.per)) {
    /** @type {Record<string, number | null>} */
    const v = {};
    for (const k of NUTRIENTS) {
      const raw = input.per[k];
      const n = typeof raw === 'number' ? raw : readQty(raw);
      v[k] = null;
      if (n == null) continue;
      if (!Number.isFinite(n) || n < 0) errors[k] = 'log.err.num';
      else if (n > (k === 'kcal' ? PER100_KCAL_MAX : PER100_GRAM_MAX)) errors[k] = k === 'kcal' ? 'est.err.kcal100' : 'est.err.gram100';
      else v[k] = nutrValue(k, n);
    }
    per = /** @type {Nutrition} */ (v);
  }
  /** @type {number | null | undefined} */
  let grams;
  if (input.grams !== undefined) {
    const n = typeof input.grams === 'number' ? input.grams : readQty(input.grams);
    if (n == null) grams = null;
    else if (!Number.isFinite(n) || n <= 0 || n > UNIT_GRAMS_MAX) errors.grams = 'est.err.grams';
    else grams = Math.round(n * 10) / 10;
  }
  return { ok: !Object.keys(errors).length, per, grams, errors };
}

/**
 * 记下一样食材自己的说法（估算的明细里「指定成…」「自己填」）：按名字（nameHead）一条，以后所有食谱里的这一样都按它算。
 *   ref：指定成表里的这一样（id），自己填过的每 100 g 不再用（清掉：指定就是说「按表里那一样算」）；
 *   per：自己填的每 100 g（四样都照这次的，空着的是没填）；grams + unit：一{unit}多重（null = 不要了），记在 unitKey(unit) 上。
 * 只给了的才改；改的时候保留 createdAt（不然合并时会被当成「各自从头建的」）；「用回自动认的」以后再存，也用删掉的那一条的 createdAt
 * （是同一条又回来了，合并时整条取较新的。从头建一条的话，合并会拿云端删掉的那一条补字段：指定的、每 100 g、一个多重都回来了——正是用户刚撤掉的）。同名的是常吃的（kind 'food'，记饮食时写过的）：
 * 变成食材的这一条（每份的营养不再用、记饮食时不再联想它；过去的记录是抄下来的，不变）。存了也算不出来的（表里没有、也没指定、
 * 没填每 100 g 的营养）→ errors.kcal 'est.err.needPer'。有错什么也不改
 * @param {State} state @param {unknown} name
 * @param {{ ref?: unknown, per?: unknown, grams?: unknown, unit?: unknown }} input @param {number} [now]
 * @returns {{ ok: true, food: Food } | { ok: false, errors: Record<string, string> }}
 */
export function saveIngredientFood(state, name, input, now = Date.now()) {
  const r = ingredientRecord(state, name, input, now);
  return r.ok ? { ok: true, food: /** @type {Food} */ (writeRecord(state, 'foods', r.rec, now)) } : r;
}
/**
 * saveIngredientFood 要写的那一条（不改数据）：面板先拿它查一遍，有错标在那一格下面，没错再在 ctx.mutate 里存
 * @param {State} state @param {unknown} name @param {{ ref?: unknown, per?: unknown, grams?: unknown, unit?: unknown }} input @param {number} [now]
 * @returns {{ ok: true, rec: Record<string, any> } | { ok: false, errors: Record<string, string> }}
 */
export function ingredientRecord(state, name, input, now = Date.now()) {
  const key = nameHead(name);
  if (!normName(key)) return { ok: false, errors: { name: 'est.err.name' } };
  const v = validateIngredientInput({ per: input.per, grams: input.grams });
  /** @type {Record<string, string>} */
  const errors = { ...v.errors };
  /** @type {string | undefined} */
  let ref;
  if (input.ref !== undefined) { const t = foodById(input.ref); if (t) ref = String(t.id); else errors.ref = 'est.err.ref'; }
  const u = v.grams !== undefined ? unitKey(input.unit) : '';
  if (v.grams !== undefined && !u) errors.grams = 'est.err.grams';
  if (Object.keys(errors).length) return { ok: false, errors };
  const id = foodId(key), prev = liveFood(state, id);
  const dead = prev ? null : own(isObj(state.data.foods) ? state.data.foods : {}, id);
  const born = dead && Number(dead.createdAt) >= 0 ? Number(dead.createdAt) : now;
  /** @type {Record<string, any>} */
  const rec = prev && prev.kind === 'ingredient' ? structuredClone(prev)
    : prev ? { ...structuredClone(prev), kind: 'ingredient', perUnit: '100g', per: normalizeNutrition(null), grams: {}, ref: null }
    : { id, name: key, kind: 'ingredient', per: normalizeNutrition(null), perUnit: '100g', grams: {}, ref: null, uses: 0, lastAt: 0, createdAt: born };
  rec.name = key;
  if (ref !== undefined) { rec.ref = ref; rec.per = normalizeNutrition(null); }
  if (v.per !== undefined) rec.per = v.per;
  if (v.grams !== undefined) { if (v.grams == null) delete rec.grams[u]; else rec.grams[u] = v.grams; }
  if (!hasNutrition(rec.per) && !(rec.ref && foodById(rec.ref)) && !findFood(key) && !findFood(name)) return { ok: false, errors: { kcal: 'est.err.needPer' } };
  return { ok: true, rec };
}

/**
 * 不用自己的说法了，回到表里自动认的（估算的明细里「用回自动认的」）：软删除那一条（撤销靠提示条，不进最近删除）。
 * 以后再指定、再填从空的开始，但还是这一条（createdAt 照旧，见 ingredientRecord）。没有 → null；返回删掉前的
 * @param {State} state @param {unknown} name @param {number} [now]
 */
export function clearIngredientFood(state, name, now = Date.now()) {
  const f = ingredientFood(state, name);
  if (!f) return null;
  state.data.foods[f.id] = /** @type {Food} */ (deletedRecord(f, now));
  return f;
}

/**
 * 估算抄成手动的每人份营养（「用手动的」：抄过去以后在「编辑」里改）：食谱已经填了的不改；usableEstimate 不过的不抄；
 * 没写几人份的（一整道）也不抄：手动的是「每人份」，以后写上 4 人份，抄过去的一整锅就成了每人份、还比估算的优先。返回 true = 抄了
 * @param {State} state @param {string} recipeId @param {number} [now]
 */
export function useEstimate(state, recipeId, now = Date.now()) {
  const r = own(state.data.recipes, recipeId);
  if (!r || r.deleted || hasNutrition(r.nutrition)) return false;
  const est = estimateRecipe(state, r);
  if (est.whole || !usableEstimate(est)) return false;
  writeRecord(state, 'recipes', { ...r, nutrition: est.perServing }, now);
  return true;
}
