// @ts-check
// log：吃了什么（第三版）。一条是某一天某一顿吃的一样：名字、几份、营养的合计（记的时候抄下来的、已经乘过份数）。
//   看：一天的 logOn / 几天的 logIn（按早饭、午饭、晚饭、加餐，再按加进来的先后）、合计 sumEntries / dayTotals、和目标比 goalProgress、
//       月历上每天吃了多少 totalsByDay、一周的平均 weekAverage；
//   记：addLogEntry（从计划里的菜「吃了」、从食谱、从常吃的、手动写）。面板一开始的样子由 logFromPlan / logFromRecipe / logFromFood 给；
//   改：editLogEntry（只改份数时合计按比例跟着变）；删：deleteLogEntry（软删除，不进最近删除，撤销靠提示条，和计划一样）。
//   没连食谱的（手动写的、常吃的、计划里只写一句的「出去吃」）记进常吃的（foods.js 的 rememberFood），下次输入时联想。
// 营养是抄下来的：以后改了食谱的每人份、常吃的（第 15 步还有营养表），过去的记录不变（要改就改这一条）。
// 第 15 步：连着的食谱没填每人份营养时用按食材估算的（core/estimate.js 的 recipeNutrition），记成 estimated（界面上写「约」），记的时候照样抄下来。
// 目标在同步的设置 settings.goals（goalsOf / setGoals，按 settingsAt 合并）。日子是本地日期 'YYYY-MM-DD'（dates.js）。
// 写法和 plan.js 一样：操作函数直接改传进来的 state（在 ctx.mutate 里调用），记录经过 writeRecord / deletedRecord。
import { MEALS, NUTRIENTS, nutrValue, normalizeNutrition, live, writeRecord, deletedRecord, newId, setSetting, canon } from './store.js';
import { own, isObj, str } from './util.js';
import { readQty } from './parse.js';
import { isDay, weekDays } from './dates.js';
import { liveRecipe, SERVINGS_MAX } from './recipes.js';
import { liveEntry } from './plan.js';
import { rememberFood, liveFood, foodOf, filledOnly, readNutrition, scaleNutrition, hasNutrition } from './foods.js';
import { recipeNutrition } from './estimate.js';

/** @typedef {import('./store.js').State} State */
/** @typedef {import('./store.js').LogEntry} LogEntry */
/** @typedef {import('./store.js').Meal} Meal */
/** @typedef {import('./store.js').Nutrition} Nutrition */

export { MEALS, NUTRIENTS };
/** 一条最多记几份（和几人份一样） */
export const LOG_SERVINGS_MAX = SERVINGS_MAX;

const col = (/** @type {State} */ s) => (isObj(own(s.data, 'log')) ? s.data.log : {});
/** 没删除的一条；没有 → null @param {State} state @param {unknown} id @returns {LogEntry | null} */
export function liveLog(state, id) {
  const e = typeof id === 'string' ? own(col(state), id) : null;
  return e && !e.deleted ? e : null;
}

/** 排顺序：日子、哪一顿、order（加进来的先后）、createdAt、id（每台设备一样） @param {LogEntry} a @param {LogEntry} b */
const byLog = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || MEALS.indexOf(a.meal) - MEALS.indexOf(b.meal)
  || (a.order - b.order) || (a.createdAt - b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
/** from 到 to（都算）这几天吃的，排好顺序；日子认不出的不算 @param {State} state @param {string} from @param {string} to @returns {LogEntry[]} */
export function logIn(state, from, to) {
  return /** @type {LogEntry[]} */ (live(state, 'log')).filter(e => isDay(e.date) && e.date >= from && e.date <= to).sort(byLog);
}
/** 这一天吃的 @param {State} state @param {string} day */
export const logOn = (state, day) => logIn(state, day, day);
/** 从计划里这一道菜记过几次（「吃了」可以记几次：两个人分着吃、第二天吃剩的） @param {State} state @param {string} planId */
export const loggedFrom = (state, planId) => live(state, 'log').filter(e => e.planId === planId).length;

/**
 * 现在是哪一顿（面板的默认）：凌晨 4 点前、下午 2 点半到 5 点、晚上 9 点以后是加餐，早上 10 点半前早饭，再到 2 点半午饭，5 点到 9 点晚饭。看本机时间
 * @param {Date} [d] @returns {Meal}
 */
export function mealAt(d = new Date()) {
  const m = d.getHours() * 60 + d.getMinutes();
  return m < 240 ? 'snack' : m < 630 ? 'breakfast' : m < 870 ? 'lunch' : m < 1020 ? 'snack' : m < 1260 ? 'dinner' : 'snack';
}

// ---------- 面板一开始的样子（不改数据） ----------
/**
 * @typedef {{ date?: unknown, meal?: unknown, title?: unknown, servings?: unknown, per?: unknown, recipeId?: unknown, planId?: unknown,
 *   note?: unknown, estimated?: unknown, saveToRecipe?: unknown, fromFood?: unknown, estNote?: { missing: string[], whole: boolean } | null }} LogInput
 * 记一样吃的面板交来的（份数、营养可以是输入框里的字）。per 是**每份**的营养，存的时候乘上份数；
 * fromFood：营养框是从哪一条常吃的填好的（点了它、打的名字正好是它、计划里只写一句的）——是这次的名字那一条时，空着的框才算用户删掉了；
 * estNote：营养是估算的时候，没算进去的那几样的名字、是不是一整道（食谱没写几人份）——面板上说一句（logFromPlan / logFromRecipe 给，存的时候不看）
 */
/**
 * 食谱现在的每人份营养：手动填的为准，没填的用按食材估算的（estimated: true）；都没有 → per 是 null（空着让人填）
 * @param {State} state @param {any} r @returns {{ per: Nutrition | null, estimated: boolean, estNote: { missing: string[], whole: boolean } | null }}
 */
function recipePer(state, r) {
  const n = recipeNutrition(state, r);
  const e = n && n.estimate;
  return n ? { per: n.per, estimated: n.estimated, estNote: e ? { missing: e.missing.map(l => l.name), whole: e.whole } : null } : { per: null, estimated: false, estNote: null };
}
/**
 * 从计划里这一道菜「吃了」：那一天、那一顿，默认 1 份（计划的人数是做几人份，吃的是其中一份）；连着食谱的用食谱现在的每人份营养
 * （没填的用估算的，estimated），都没有的空着让人填。只写一句的（「出去吃」）名字是那句话，记过这个名字的（常吃的）用记住的每份（不然点两下「添加」就记成没填、还把记住的冲掉）。
 * 这道菜不在了 → null
 * @param {State} state @param {string} planId @returns {LogInput | null}
 */
export function logFromPlan(state, planId) {
  const e = liveEntry(state, planId);
  if (!e) return null;
  const r = liveRecipe(state, e.recipeId);
  const f = r ? null : foodOf(state, e.title);
  const rp = r ? recipePer(state, r) : { per: f && hasNutrition(f.per) ? normalizeNutrition(f.per) : null, estimated: false, estNote: null };
  return { date: e.date, meal: e.meal, title: r ? r.name.trim() : e.title.trim(), recipeId: r ? r.id : null, planId: e.id, servings: 1,
    per: rp.per, estimated: rp.estimated, estNote: rp.estNote, fromFood: f ? f.id : null };
}
/** 从食谱选：1 份、食谱的每人份营养（没填的用估算的，都没有空着）。食谱不在了 → null @param {State} state @param {string} recipeId @returns {LogInput | null} */
export function logFromRecipe(state, recipeId) {
  const r = liveRecipe(state, recipeId);
  return r ? { title: r.name.trim(), recipeId: r.id, servings: 1, ...recipePer(state, r) } : null;
}
/** 从常吃的选：1 份、记住的每份营养 @param {State} state @param {string} foodId @returns {LogInput | null} */
export function logFromFood(state, foodId) {
  const f = liveFood(state, foodId);
  return f ? { title: f.name, recipeId: null, servings: 1, per: normalizeNutrition(f.per), fromFood: f.id } : null;
}

// ---------- 记、改、删 ----------
/**
 * 检查一条：日子要是真的日子；名字不能空（连着食谱没写名字的用食谱的名字）；份数空着是 1 份，不然 0 < n ≤ 99；营养见 readNutrition（每份）。
 * 连着的食谱已经删了：照样能记（名字是抄下来的），只是不再连着。错误是文案的键（errors.date / title / servings / kcal / protein / carbs / fat）
 * @param {State} state @param {LogInput} input
 * @returns {{ ok: boolean, clean: { date: string, meal: Meal, title: string, servings: number, per: Nutrition, recipeId: string | null, planId: string | null, note: string, estimated: boolean }, errors: Record<string, string> }}
 */
export function validateLogEntry(state, input) {
  /** @type {Record<string, string>} */
  const errors = {};
  const date = str(input.date).trim();
  if (!isDay(date)) errors.date = 'log.err.date';
  const meal = /** @type {Meal} */ (MEALS.includes(/** @type {any} */ (input.meal)) ? input.meal : 'dinner');
  const r = typeof input.recipeId === 'string' && input.recipeId ? liveRecipe(state, input.recipeId) : null;
  const title = str(input.title).trim() || (r ? r.name.trim() : '');
  if (!title) errors.title = 'log.err.title';
  const sv = readQty(input.servings);
  const servings = sv == null ? 1 : sv;
  if (!(Number.isFinite(servings) && servings > 0 && servings <= LOG_SERVINGS_MAX)) errors.servings = 'log.err.servings';
  const nut = readNutrition(input.per);
  Object.assign(errors, nut.errors);
  const planId = typeof input.planId === 'string' && input.planId ? input.planId : null;
  return { ok: !Object.keys(errors).length,
    clean: { date, meal, title, servings, per: nut.value, recipeId: r ? r.id : null, planId, note: str(input.note), estimated: input.estimated === true && hasNutrition(nut.value) }, errors };
}
/** 放到这一天这一顿的最后 @param {State} state @param {string} date @param {string} meal @param {string | null} [except] */
function nextOrder(state, date, meal, except = null) {
  let max = -1;
  for (const e of live(state, 'log')) if (e.id !== except && e.date === date && e.meal === meal && e.order > max) max = e.order;
  return max + 1;
}

/**
 * 记一样吃的。营养存的是合计（每份 × 份数，乘完再整理：千卡整数、克一位小数）——记的时候抄下来，以后改了食谱、常吃的也不变。
 * 没连食谱的记进常吃的（这次的名字和每份营养，uses + 1）：营养框是从这个名字的那一条填好的（fromFood）→ 四样都照这次的（空着是删掉了）；
 * 不是 → 只记填了的，没填的留着记住的；名字就是常吃的、一个数也没填 = 和点了它一样，这一条用记住的每份。
 * 连着食谱、食谱还没填每人份、这次填了、saveToRecipe 是 true：也记到食谱上（下次「吃了」直接带上；已经填了的不改）。
 * 这次的数是估算的、没改过（estimated）不记到食谱上：食谱没填的本来就用估算，抄成手动的以后改了食材、指定了食材也不跟着变了。有错什么也不改
 * @param {State} state @param {LogInput} input @param {number} [now]
 * @returns {{ ok: true, id: string, entry: LogEntry } | { ok: false, errors: Record<string, string> }}
 */
export function addLogEntry(state, input, now = Date.now()) {
  const v = validateLogEntry(state, input);
  if (!v.ok) return { ok: false, errors: v.errors };
  const c = v.clean;
  let foodId = null;
  if (!c.recipeId) {
    const known = foodOf(state, c.title), filled = !!known && input.fromFood === known.id;
    if (known && !filled && !hasNutrition(c.per)) c.per = /** @type {Nutrition} */ (normalizeNutrition(known.per));
    const f = rememberFood(state, c.title, filled ? c.per : filledOnly(c.per), { use: true }, now);
    foodId = f ? f.id : null;
  } else if (input.saveToRecipe === true && !c.estimated && hasNutrition(c.per)) {
    const r = liveRecipe(state, c.recipeId);
    if (r && !hasNutrition(r.nutrition)) writeRecord(state, 'recipes', { ...r, nutrition: c.per }, now);
  }
  const id = newId('e_');
  const entry = /** @type {LogEntry} */ (writeRecord(state, 'log', {
    id, createdAt: now, date: c.date, meal: c.meal, title: c.title, servings: c.servings, ...scaleNutrition(c.per, c.servings),
    recipeId: c.recipeId, planId: c.planId, foodId, estimated: c.estimated, note: c.note, order: nextOrder(state, c.date, c.meal),
  }, now));
  return { ok: true, id, entry };
}

/** 这一条的每份（合计 ÷ 份数，不四舍五入：只改份数时按它乘回去） @param {LogEntry} e @returns {Record<string, number | null>} */
export const perServing = (e) => Object.fromEntries(NUTRIENTS.map(k => [k, e[k] == null ? null : /** @type {number} */ (e[k]) / (e.servings || 1)]));

/**
 * 改一条以后的合计：per 里给了的那几样（改了的，每份）= 每份 × 份数；没给的照原来的合计，份数变了按比例变（按没四舍五入的每份：
 * 100 千卡 3 份改成 2 份是 67，不是 33 × 2）。只改了脂肪，热量、蛋白质不会因为框里的每份是四舍五入过的就变一点。
 * 面板里的「合计」也用它算：显示的就是存的
 * @param {LogEntry} prev @param {number} servings @param {Partial<Record<string, unknown>> | null} per
 * @returns {Nutrition}
 */
export function editedTotals(prev, servings, per) {
  return /** @type {Nutrition} */ (Object.fromEntries(NUTRIENTS.map(k => {
    if (isObj(per) && own(per, k) !== undefined) { const p = nutrValue(k, per[k]); return [k, p == null ? null : nutrValue(k, p * servings)]; }
    const was = prev[k];
    return [k, was == null ? null : servings === prev.servings ? was : nutrValue(k, /** @type {number} */ (was) * servings / prev.servings)];
  })));
}

/**
 * 改一条（点一条打开的面板的「保存」）：patch 只放改了的（date、meal、title、servings、per、note；per 里也只放改了的那几样，空的 = 清掉）。
 * 合计见 editedTotals：改了的那几样 = 新的每份 × 份数，别的照原来的（份数变了按比例变）；都没给 → 合计不动。
 * 换了日子或哪一顿 = 挪过去（排在那一顿的最后）。连着的食谱、计划不改（是哪道菜记下的就是哪道）。
 * 没连食谱的改了名字或营养：常吃的跟着更新（多半是记错了在改），不算又吃了一次——只改了营养的只改那几样（别的可能已经在别处改过了）；
 * 改了名字的，这一条填了的每份都记到新名字上
 * @param {State} state @param {string} id @param {LogInput} patch @param {number} [now]
 * @returns {{ ok: true, entry: LogEntry } | { ok: false, errors: Record<string, string> }}
 */
export function editLogEntry(state, id, patch, now = Date.now()) {
  const prev = liveLog(state, id);
  if (!prev) return { ok: false, errors: { entry: 'log.err.gone' } };
  const given = isObj(patch.per) ? NUTRIENTS.filter(k => own(patch.per, k) !== undefined) : [];
  const v = validateLogEntry(state, { date: prev.date, meal: prev.meal, title: prev.title, servings: prev.servings, note: prev.note, ...patch, recipeId: null, per: given.length ? patch.per : null });
  if (!v.ok) return { ok: false, errors: v.errors };
  const c = v.clean;
  /** @type {Record<string, number | null>} 改了的那几样的每份（读好、整理过的） */
  const per = Object.fromEntries(given.map(k => [k, c.per[k]]));
  const totals = editedTotals(prev, c.servings, per);
  /** @type {Record<string, any>} */
  const next = { ...prev, date: c.date, meal: c.meal, title: c.title, servings: c.servings, note: c.note, ...totals };
  // 自己改了营养：就是自己填的数了，不再是估算（第 15 步的估算带 estimated 进来）
  if (given.length) next.estimated = c.estimated;
  if (next.date !== prev.date || next.meal !== prev.meal) next.order = nextOrder(state, next.date, next.meal, id);
  if (!prev.recipeId && (given.length || c.title !== prev.title)) {
    const each = c.title !== prev.title ? filledOnly(perServing(/** @type {LogEntry} */ (next))) : {};
    const f = rememberFood(state, c.title, { ...each, ...per }, { use: false }, now);
    next.foodId = f ? f.id : null;
  }
  return { ok: true, entry: /** @type {LogEntry} */ (writeRecord(state, 'log', next, now)) };
}

/** 删掉一条：软删除（不进最近删除，撤销靠提示条）。返回删掉前的；不在了 → null @param {State} state @param {string} id @param {number} [now] */
export function deleteLogEntry(state, id, now = Date.now()) {
  const e = liveLog(state, id);
  if (!e) return null;
  col(state)[id] = deletedRecord(e, now);
  return e;
}

// ---------- 合计、目标、平均 ----------
/**
 * @typedef {{ kcal: number, protein: number, carbs: number, fat: number, n: number, missing: Record<string, number>, estimated: boolean }} Totals
 * 几条加起来：每样的合计（千卡整数、克一位小数；没填的那几条不算进去）、几条（n）、每样有几条没填（missing）、有没有估算的
 */
/** @param {LogEntry[]} entries @returns {Totals} */
export function sumEntries(entries) {
  /** @type {Record<string, number>} */
  const sum = { kcal: 0, protein: 0, carbs: 0, fat: 0 }, missing = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  let estimated = false;
  for (const e of entries) {
    for (const k of NUTRIENTS) { if (e[k] == null) missing[k]++; else sum[k] += /** @type {number} */ (e[k]); }
    if (e.estimated) estimated = true;
  }
  // 一条条加完再整理：0.1 + 0.2 这种浮点的零头不显示出来
  for (const k of NUTRIENTS) sum[k] = /** @type {number} */ (nutrValue(k, sum[k]));
  return /** @type {Totals} */ ({ ...sum, n: entries.length, missing, estimated });
}
/** 这一天的合计 @param {State} state @param {string} day */
export const dayTotals = (state, day) => sumEntries(logOn(state, day));
/** 月历：from 到 to 每天的合计（记了的日子才有） @param {State} state @param {string} from @param {string} to @returns {Map<string, Totals>} */
export function totalsByDay(state, from, to) {
  /** @type {Map<string, LogEntry[]>} */
  const by = new Map();
  for (const e of logIn(state, from, to)) { const a = by.get(e.date); if (a) a.push(e); else by.set(e.date, [e]); }
  return new Map([...by].map(([d, es]) => [d, sumEntries(es)]));
}

/**
 * 这一天所在的一周（周一到周日）平均每天多少：只算记了的日子（每样只算有这一样的日子：没记的那天不是吃了 0 千卡）。
 * 返回 { from, to, days：记了热量的有几天, kcal, protein, carbs, fat（平均，千卡整数、克一位小数；一天也没有是 null）}
 * @param {State} state @param {string} day
 */
export function weekAverage(state, day) {
  const days = weekDays(day);
  if (!days.length) return { from: '', to: '', days: 0, kcal: null, protein: null, carbs: null, fat: null };
  const by = totalsByDay(state, days[0], days[6]);
  /** @type {Record<string, number | null>} */
  const avg = {};
  let kcalDays = 0;
  for (const k of NUTRIENTS) {
    let sum = 0, n = 0;
    for (const t of by.values()) if (t.missing[k] < t.n) { sum += t[k]; n++; }
    avg[k] = n ? nutrValue(k, sum / n) : null;
    if (k === 'kcal') kcalDays = n;
  }
  return { from: days[0], to: days[6], days: kcalDays, ...avg };
}

/** 同步的设置里的饮食目标：每样是正数或 null（没设）；认不出的当没设 @param {State} state @returns {Nutrition} */
export function goalsOf(state) {
  const g = isObj(state.settings) && isObj(state.settings.goals) ? state.settings.goals : {};
  return /** @type {Nutrition} */ (Object.fromEntries(NUTRIENTS.map(k => { const v = nutrValue(k, g[k]); return [k, v != null && v > 0 ? v : null]; })));
}
/**
 * 检查饮食目标（设置 → 饮食目标，输入框里的字）：空的、0 是不设；别的照 readNutrition（读不出来、负数、太大报错）
 * @param {unknown} input @returns {{ ok: boolean, clean: Nutrition, errors: Record<string, string> }}
 */
export function validateGoals(input) {
  const r = readNutrition(input);
  const clean = /** @type {Nutrition} */ (Object.fromEntries(NUTRIENTS.map(k => [k, r.value[k] ? r.value[k] : null])));
  return { ok: r.ok, clean, errors: r.errors };
}
/**
 * 存饮食目标（settings.goals，整个一份按 settingsAt 合并）。只给了几样就只改那几样（页面一个框一个框地存）；有错什么也不改。
 * 意思没变（没设的写 0、清空，1800 写成 1800.4）不写、不盖新时间：整份按时间合并，空写一次就比别的设备刚设、还没同步过来的目标新，把它冲掉。
 * 不认识的（以后的版本加的纤维）原样留着。返回 { ok, changed, errors }
 * @param {State} state @param {Partial<Record<string, unknown>>} input @param {number} [now]
 */
export function setGoals(state, input, now = Date.now()) {
  const give = Object.fromEntries(NUTRIENTS.filter(k => isObj(input) && k in input).map(k => [k, input[k]]));
  const v = validateGoals(give);
  if (!v.ok) return { ok: false, changed: false, errors: v.errors };
  const was = goalsOf(state);
  /** @type {Record<string, any>} */
  const next = { ...(isObj(state.settings) && isObj(state.settings.goals) ? state.settings.goals : {}), ...was };
  for (const k of Object.keys(give)) next[k] = v.clean[/** @type {keyof Nutrition} */ (k)];
  if (canon(goalsOf(/** @type {any} */ ({ settings: { goals: next } }))) === canon(was)) return { ok: true, changed: false, errors: {} };
  return { ok: true, changed: setSetting(state, 'goals', next, now), errors: {} };
}

/**
 * 和目标比：每样一行 { key, value, goal, left（还差多少，到了是 0）, over（超了多少）, ratio（进度条，0–1，超了是 1）}；
 * 没设目标的那一样 goal、left、over、ratio 都是 null
 * @param {Totals} totals @param {Nutrition} goals
 */
export function goalProgress(totals, goals) {
  return NUTRIENTS.map(k => {
    const value = totals[k] || 0, goal = goals[k];
    if (goal == null) return { key: k, value, goal: null, left: null, over: null, ratio: null };
    return { key: k, value, goal, left: value < goal ? nutrValue(k, goal - value) : 0, over: value > goal ? nutrValue(k, value - goal) : 0, ratio: Math.min(1, value / goal) };
  });
}
