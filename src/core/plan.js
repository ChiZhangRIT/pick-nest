// @ts-check
// 计划（第二版）：某一天某一顿吃什么，一条是一道菜（plan 集合，store.js 的 normalizePlan）。
//   看：哪几天有哪几道（entriesIn / entriesOn，一天里按早饭、午饭、晚饭、加餐，再按加进来的先后）、月历上每天几道（dayCounts）、菜名（dishName）；
//   改：加一道（addEntry：连着食谱，或者只写一句「出去吃」）、改 / 挪到别的日子 / 改人数 / 换食谱（editEntry）、删掉（deleteEntry，软删除）；
//   生成购物清单：这几天连着食谱的菜按人数换算、同名同单位的合成一行、写着来自哪几道（planLines），确认后每道菜用自己的来源
//   'p:<这一道的 id>' 加进清单（generateList → items.js 的 addNeeds）。同一段日子再生成一次是替换，不会重复加。
// 已经加进清单的那一份跟着菜走（「来自食谱的数量」的规则，docs/DATA_MODEL.md）：删掉 → 拿掉；改人数 → 还没买的按新人数重算；
// 换食谱 → 旧的拿掉、新的加上（已经为这道菜买过的不再加）；挪日子 → 还是同一道菜，清单不动。已买、已清除的一律不动，
// 拿掉以后什么都不剩（没有自己加的、也没有别的菜）的东西软删除。都在调用的地方的一次 ctx.mutate 里，一起撤销。
// 写法和 items.js 一样：操作函数直接改传进来的 state，记录经过 writeRecord / deletedRecord。日子是本地日期 'YYYY-MM-DD'（dates.js）。
import { normName, writeRecord, deletedRecord, newId, live, itemId, MEALS } from './store.js';
import { own, isObj, str } from './util.js';
import { readQty } from './parse.js';
import { isDay } from './dates.js';
import { liveList, addNeeds, removeNeeds, sourceItems, needsFrom, needName, totalLabel, NEED_MAX } from './items.js';
import { liveRecipe, scaleIngredients, SERVINGS_MAX } from './recipes.js';
import { isStaple, setStaple } from './memory.js';

/** @typedef {import('./store.js').State} State */
/** @typedef {import('./store.js').PlanEntry} PlanEntry */
/** @typedef {import('./store.js').Meal} Meal */
/** @typedef {import('./store.js').Recipe} Recipe */
/** @typedef {import('./store.js').Item} Item */
/** @typedef {import('./store.js').Translate} Translate */

export { MEALS };
/** 这道菜加进清单的那一份的来源（items.needs 的键） @param {string} id */
export const planSource = (id) => 'p:' + id;

const col = (/** @type {State} */ s) => (isObj(own(s.data, 'plan')) ? s.data.plan : {});
/** 没删除的一道菜；没有 → null @param {State} state @param {unknown} id @returns {PlanEntry | null} */
export function liveEntry(state, id) {
  const e = typeof id === 'string' ? own(col(state), id) : null;
  return e && !e.deleted ? e : null;
}
/** 本机记着的看法：一周 / 一个月（picknest.local 的 planView，认不出的按一周） @param {any} local @returns {'week' | 'month'} */
export const planView = (local) => (local && local.planView === 'month' ? 'month' : 'week');

/** 排顺序：日子，再一天里的哪一顿，再 order（加进来的先后），再 createdAt、id（每台设备一样） @param {PlanEntry} a @param {PlanEntry} b */
const byPlan = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || MEALS.indexOf(a.meal) - MEALS.indexOf(b.meal)
  || (a.order - b.order) || (a.createdAt - b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
/** from 到 to（都算）这几天的菜，排好顺序；日子认不出的不算 @param {State} state @param {string} from @param {string} to @returns {PlanEntry[]} */
export function entriesIn(state, from, to) {
  return /** @type {PlanEntry[]} */ (live(state, 'plan')).filter(e => isDay(e.date) && e.date >= from && e.date <= to).sort(byPlan);
}
/** 这一天的菜 @param {State} state @param {string} day */
export const entriesOn = (state, day) => entriesIn(state, day, day);
/** 月历上每天几道菜：日子 → 几道（没有的不在里面） @param {State} state @param {string} from @param {string} to */
export function dayCounts(state, from, to) {
  /** @type {Map<string, number>} */
  const m = new Map();
  for (const e of entriesIn(state, from, to)) m.set(e.date, (m.get(e.date) || 0) + 1);
  return m;
}
/** 菜名：连着的食谱还在 → 食谱现在的名字（改名了跟着变）；食谱删掉了、只写一句的 → 抄下来的 title @param {State} state @param {PlanEntry} e @param {Translate} t */
export function dishName(state, e, t) {
  const r = liveRecipe(state, e.recipeId);
  if (r) return r.name.trim() || t('rcp.untitled');
  return e.title.trim() || t('plan.untitled');
}

// ---------- 加、改、删 ----------
/**
 * @typedef {{ date?: unknown, meal?: unknown, recipeId?: unknown, title?: unknown, servings?: unknown, note?: unknown }} EntryInput
 * 加一道菜、改一道菜的面板交来的（几人份可以是输入框里的字）
 */
/**
 * 检查一道菜：日子要是真的日子；哪一顿认得；连着食谱的要那道食谱还在（改的时候原来就连着、后来被删掉的照留），title 抄下食谱的名字；
 * 不连食谱的要写一句；几人份空着或 0 < n ≤ 99（只有连着食谱才有）。错误是文案的键（errors.date / meal / dish / servings）
 * @param {State} state @param {EntryInput} input @param {PlanEntry | null} [prev]
 * @returns {{ ok: boolean, clean: { date: string, meal: Meal, recipeId: string | null, title: string, servings: number | null, note: string }, errors: Record<string, string> }}
 */
export function validateEntry(state, input, prev = null) {
  /** @type {Record<string, string>} */
  const errors = {};
  const date = str(input.date).trim();
  if (!isDay(date)) errors.date = 'plan.err.date';
  const meal = /** @type {Meal} */ (MEALS.includes(/** @type {any} */ (input.meal)) ? input.meal : 'dinner');
  const rid = typeof input.recipeId === 'string' && input.recipeId ? input.recipeId : null;
  const r = rid ? liveRecipe(state, rid) : null;
  let title = str(input.title).trim();
  if (rid && r) title = r.name.trim();
  else if (rid && !(prev && prev.recipeId === rid)) errors.dish = 'plan.err.recipeGone';
  else if (!rid && !title) errors.dish = 'plan.err.dish';
  let servings = null;
  if (rid) {
    const sv = readQty(input.servings);
    if (sv !== null && !(Number.isFinite(sv) && sv > 0 && sv <= SERVINGS_MAX)) errors.servings = 'plan.err.servings';
    else servings = sv;
  }
  return { ok: !Object.keys(errors).length, clean: { date, meal, recipeId: rid, title, servings, note: str(input.note) }, errors };
}
/** 放到这一天这一顿的最后 @param {State} state @param {string} date @param {string} meal @param {string | null} [except] */
function nextOrder(state, date, meal, except = null) {
  let max = -1;
  for (const e of live(state, 'plan')) if (e.id !== except && e.date === date && e.meal === meal && e.order > max) max = e.order;
  return max + 1;
}

/**
 * 加一道菜（计划页的「+」、食谱页的「加到计划」）。只记在计划里，不动清单：要买的等「生成购物清单」
 * @param {State} state @param {EntryInput} input @param {number} [now]
 * @returns {{ ok: true, id: string, entry: PlanEntry } | { ok: false, errors: Record<string, string> }}
 */
export function addEntry(state, input, now = Date.now()) {
  const v = validateEntry(state, input);
  if (!v.ok) return { ok: false, errors: v.errors };
  const id = newId('p_');
  const entry = /** @type {PlanEntry} */ (writeRecord(state, 'plan', { id, createdAt: now, ...v.clean, order: nextOrder(state, v.clean.date, v.clean.meal) }, now));
  return { ok: true, id, entry };
}

/**
 * 改一道菜（点一道菜打开的面板的「保存」）：patch 只放改了的（date、meal、recipeId + title、servings、note）。
 * 换了日子或哪一顿 = 挪过去（排在那一顿的最后），清单不动；换了食谱 / 改了人数：已经加进清单的那一份跟着变（见文件开头）。
 * 返回 { ok, entry, listChanged：清单上动了几样 }
 * @param {State} state @param {string} id @param {EntryInput} patch @param {number} [now]
 * @returns {{ ok: true, entry: PlanEntry, listChanged: number } | { ok: false, errors: Record<string, string> }}
 */
export function editEntry(state, id, patch, now = Date.now()) {
  const prev = liveEntry(state, id);
  if (!prev) return { ok: false, errors: { entry: 'plan.err.gone' } };
  const v = validateEntry(state, { ...prev, ...patch }, prev);
  if (!v.ok) return { ok: false, errors: v.errors };
  const next = { ...prev, ...v.clean };
  if (next.date !== prev.date || next.meal !== prev.meal) next.order = nextOrder(state, next.date, next.meal, id);
  const entry = /** @type {PlanEntry} */ (writeRecord(state, 'plan', next, now));
  let listChanged = 0;
  if (entry.recipeId !== prev.recipeId) listChanged = swapRecipe(state, entry, now);
  else if (entry.servings !== prev.servings) listChanged = rescale(state, entry, now);
  return { ok: true, entry, listChanged };
}
/** 挪到别的日子（或者别的一顿）：还是同一道菜，清单不动 @param {State} state @param {string} id @param {string} date @param {Meal} [meal] @param {number} [now] */
export const moveEntry = (state, id, date, meal, now = Date.now()) => {
  const e = liveEntry(state, id);
  return e ? editEntry(state, id, { date, meal: meal || e.meal }, now) : { ok: false, errors: { entry: 'plan.err.gone' } };
};

/**
 * 删掉一道菜：软删除（不进最近删除，撤销靠提示条），已经加进清单还没买的那一份拿掉（removeNeeds：只为它加的东西软删除，
 * 已买、已清除的不动）。返回 { entry：删掉前的, removed：清单上拿掉了几样（软删除的）}；不在了 → null
 * @param {State} state @param {string} id @param {number} [now]
 */
export function deleteEntry(state, id, now = Date.now()) {
  const e = liveEntry(state, id);
  if (!e) return null;
  col(state)[id] = deletedRecord(e, now);
  const source = planSource(id);
  const before = sourceItems(state, source).filter(it => isOpen(state, it));
  removeNeeds(state, source, now);
  const removed = before.filter(it => state.data.items[it.id] && state.data.items[it.id].deleted).length;
  return { entry: e, removed };
}

// ---------- 清单上这道菜的那一份 ----------
/**
 * 还没买（要买 / 以后再说，没删除），而且在看得到的清单上：删掉的清单里的东西没有删除标记、只是跟着隐藏，不能算「已经加过」——
 * 不然生成到「食材」时全写着加过了，确认后要买的都还藏在删掉的那张清单上
 * @param {State} state @param {Item} it
 */
const isOpen = (state, it) => !it.deleted && (it.status === 'need' || it.status === 'later') && !!liveList(state, it.listId);
/**
 * 这道菜在这样东西上的那几份是食谱里的哪一样、什么单位：normName(食谱里的名字) + '\n' + normName(单位)。同名不同单位的分开记成 'p:<id>'、'p:<id>#2'；
 * 名字用 needName：清单上改过名的（有机五花肉）还认得是「五花肉」
 * @param {Item} it @param {string} source
 */
const portionKeys = (it, source) => new Set(needsFrom(it, source).map(([, n]) => normName(needName(it, n)) + '\n' + normName(str(n.unit))));
/** 这道菜在这样东西上的那几份是食谱里的哪几样（normName） @param {Item} it @param {string} source */
const portionNames = (it, source) => new Set(needsFrom(it, source).map(([, n]) => normName(needName(it, n))));
/**
 * 这几道菜在这张清单上的那几份落在哪几样「改过名的」东西上：食谱里的名字（normName）→ 那样东西（还没买的）。
 * 「五花肉」在清单上改成了「有机五花肉」（换了商店、写了备注）：还是这一样，再生成、换食谱时就地换它上面的那一份，
 * 不另加一条「五花肉」（一道菜算在两行上），也不把它当成这几道菜不要了的拿掉（备注、商店跟着没了）
 * @param {State} state @param {string[]} sources @param {string} listId @returns {Map<string, Item>}
 */
function renamedHomes(state, sources, listId) {
  /** @type {Map<string, Item>} */
  const m = new Map();
  for (const it of Object.values(isObj(state.data.items) ? state.data.items : {})) {
    if (!it || it.listId !== listId || !isOpen(state, it)) continue;
    const self = normName(it.name);
    for (const src of sources) for (const k of portionNames(it, src)) if (k !== self && !m.has(k)) m.set(k, it);
  }
  return m;
}
/** 一行要放到清单上的哪一样：改过名的那一样（renamedHomes）；没有就按食谱里的名字（addNeeds 按名字找、没有就新建） @param {Map<string, Item>} homes @param {{ name: string, qty: number | null, unit: string }} ln */
const toHome = (homes, ln) => { const it = homes.get(normName(ln.name)); return it ? { ...ln, name: it.name, ing: ln.name } : ln; };
/**
 * 这道菜现在在清单上的那一份：
 *   open：还没买的（清单 → 那几样东西）；
 *   bought：已经为它买过的名字（normName）——已买、已清除的东西上还带着它的那一份，或者买过以后又加回来、记在 boughtFor 里的（items.js 的 newRound）；哪张清单都算；
 *   lists：在哪几张清单上（还没买的在前）。
 * 要买的时候自己删掉的（软删除、状态还是要买）不算还要买，也不算买过
 * @param {State} state @param {string} source
 */
function portionOf(state, source) {
  /** @type {Map<string, Item[]>} */
  const open = new Map();
  /** @type {Set<string>} */
  const bought = new Set();
  /** @type {Set<string>} */
  const boughtLists = new Set();
  for (const it of Object.values(isObj(state.data.items) ? state.data.items : {})) {
    if (!it) continue;
    const mine = needsFrom(it, source).length > 0;
    if (mine && isOpen(state, it)) { if (!open.has(it.listId)) open.set(it.listId, []); /** @type {Item[]} */ (open.get(it.listId)).push(it); }
    if ((mine && it.status === 'done') || (isObj(it.boughtFor) && own(it.boughtFor, source) != null)) {
      bought.add(normName(it.name));
      if (it.status === 'done') for (const k of portionNames(it, source)) bought.add(k);   // 改过名以后买的：食谱里的名字也算买过
      boughtLists.add(it.listId);
    }
  }
  const lists = [...open.keys()].sort();
  for (const l of [...boughtLists].sort()) if (!open.has(l)) lists.push(l);
  return { open, bought, lists };
}
/** 这道菜按它的人数换算过的食材（没名字的不算）；食谱不在 → [] @param {State} state @param {PlanEntry} e */
function dishIngredients(state, e) {
  const r = liveRecipe(state, e.recipeId);
  return r ? scaleIngredients(r, e.servings ?? r.servings).filter(g => g.name.trim()) : [];
}
/** @param {{ name: string, qty: number | null, unit: string }} g @returns {{ name: string, qty: number | null, unit: string, ing?: string }} */
const needLine = (g) => ({ name: g.name.trim(), qty: g.qty, unit: g.unit.trim() });
/** 抄在清单上的菜名（食谱的名字；只写一句的用那一句） @param {State} state @param {PlanEntry} e */
const dishLabel = (state, e) => { const r = liveRecipe(state, e.recipeId); return (r ? r.name : e.title).trim(); };
/** 记下现在的每样东西（只是引用）：writeRecord 内容没变时不换记录，事后按记录换没换数这次动了几样 @param {State} state */
const snapshot = (state) => ({ ...(isObj(state.data.items) ? state.data.items : {}) });
/** 和 snapshot 比，动了几样（真的变了的才算：内容一样的写入不算，提示条不会说「改了」） @param {State} state @param {Record<string, Item>} before */
const changedSince = (state, before) => Object.entries(isObj(state.data.items) ? state.data.items : {}).filter(([id, it]) => before[id] !== it).length;
/**
 * 把这道菜新的那一份放到清单上：targets 是「清单 → 这几行」，addNeeds 就地换掉这个来源的键（已经在清单上的不先删再加：
 * 删掉再加回来是恢复成新的一条，商店按默认的重新定，memory 也多记一次）
 * @param {State} state @param {PlanEntry} e @param {Map<string, { name: string, qty: number | null, unit: string, ing?: string }[]>} targets @param {number} now
 */
function putPortion(state, e, targets, now) {
  const meta = { label: dishLabel(state, e), recipeId: e.recipeId };
  for (const [listId, lines] of targets) if (lines.length && liveList(state, listId)) addNeeds(state, listId, lines, planSource(e.id), meta, now);
}
/**
 * 拿掉这道菜在别处的旧的那一份（别的清单上的、这次不要了的名字；只动还没买的，只为它加的软删除）：targets 里的那几样不动。
 * 要在 putPortion 之后：几道菜一起换时（generateList），前一道不要了的洋葱后一道还要，先放上后一道的再拿掉前一道的，这样东西就不会先删掉再恢复成新的一条
 * @param {State} state @param {PlanEntry} e @param {Map<string, { name: string }[]>} targets @param {number} now
 */
function dropPortion(state, e, targets, now) {
  /** @type {Map<string, Set<string>>} */
  const keep = new Map([...targets].map(([l, lines]) => [l, new Set(lines.map(x => normName(x.name)))]));
  removeNeeds(state, planSource(e.id), now, { skip: it => !!(keep.get(it.listId) && /** @type {Set<string>} */ (keep.get(it.listId)).has(normName(it.name))) });
}
/**
 * 改了人数：还没买、已经在清单上的那几样按新的人数就地重算，别的一概不动——只认清单上已经有的那几份（名字 + 单位）：
 * 生成时没勾的（包括同名不同单位的那一行）、后来自己拿掉的不会冒出来；清单上改了名的、食谱里后来删掉 / 改了单位的那一样
 * 对不上，照原来的用量留着（食谱改了不自动跟着变，再生成一次才是新的）。已买的不动；食谱删掉了算不出来：不动。返回动了几样
 * @param {State} state @param {PlanEntry} e @param {number} now
 */
function rescale(state, e, now) {
  if (!liveRecipe(state, e.recipeId)) return 0;
  const source = planSource(e.id);
  const { open } = portionOf(state, source);
  if (!open.size) return 0;
  const ings = dishIngredients(state, e);
  const before = snapshot(state);
  /** @type {Map<string, { name: string, qty: number | null, unit: string }[]>} */
  const targets = new Map();
  for (const [listId, its] of open) {
    const lines = [];
    for (const it of its) {
      // 按食谱里的名字 + 单位对（needName：清单上改过名的还认得）；放回去时按这样东西现在的名字（addNeeds 按名字找它），食谱里的名字另记着
      const parts = needsFrom(it, source), keys = portionKeys(it, source);
      const fresh = ings.filter(g => keys.has(normName(g.name) + '\n' + normName(g.unit.trim())));
      if (!fresh.length) continue;
      lines.push(...fresh.map(g => ({ ...needLine(g), name: it.name, ing: g.name.trim() })));
      // 同一样东西上这道菜别的单位的那一份，食谱里已经没有了：照原来的留着（addNeeds 会换掉这个来源所有的键，不放回去就丢了）
      for (const [, n] of parts) {
        if (!fresh.some(g => normName(g.name) === normName(needName(it, n)) && normName(g.unit.trim()) === normName(str(n.unit)))) lines.push({ name: it.name, qty: n.qty, unit: str(n.unit), ing: needName(it, n) });
      }
    }
    targets.set(listId, lines);
  }
  putPortion(state, e, targets, now);
  return changedSince(state, before);
}
/**
 * 换了食谱（或者改成只写一句）：这道菜已经加进清单的话（还没买的、已经买过的都算），旧的那一份拿掉（还没买的），新食谱的食材加到同一张清单
 * （照「生成购物清单」的默认：常备品、可选的不加；已经为这道菜买过的不再加——除非它现在还在清单上要买，那是自己勾上要再买一次的，就地换成新的用量）。
 * 还没加进过清单的什么也不动。返回动了几样
 * @param {State} state @param {PlanEntry} e @param {number} now
 */
function swapRecipe(state, e, now) {
  const { open, bought, lists } = portionOf(state, planSource(e.id));
  if (!lists.length) return 0;
  const source = planSource(e.id);
  const to = lists.find(l => liveList(state, l));
  const openNames = new Set([...open.values()].flat().flatMap(it => [...portionNames(it, source)]));
  // 现在还在清单上要买的（新旧都要的）一律就地换成新的用量：常备品、可选的、买过的那几条默认只管还没在清单上的——
  // 自己勾上的生抽、香菜（家里没了）换一道也用它们的菜，不能被拿掉
  const ings = dishIngredients(state, e).filter(g => {
    const nk = normName(g.name);
    return openNames.has(nk) || (!g.optional && !isStaple(state, g.name) && !bought.has(nk));
  }).map(needLine);
  const before = snapshot(state);
  const homes = to ? renamedHomes(state, [source], to) : new Map();
  const targets = to ? new Map([[to, ings.map(ln => toHome(homes, ln))]]) : new Map();
  putPortion(state, e, targets, now);
  dropPortion(state, e, targets, now);
  return changedSince(state, before);
}

// ---------- 生成购物清单 ----------
/**
 * @typedef {{ entryId: string, date: string, meal: Meal, title: string, qty: number | null, unit: string, state: 'new' | 'added' | 'bought' }} LineSource
 * 一行里一道菜的那一份：state 'added' 这道菜的这一样已经在清单上（还没买：再生成是替换）；'bought' 已经为这道菜买过（已买、已清除）
 * @typedef {{ key: string, name: string, unit: string, qty: number | null, sources: LineSource[], optional: boolean, staple: boolean,
 *   have: Item | null, haveLabel: string, added: boolean, addedLabel: string, bought: boolean, checked: boolean }} PlanLine
 * key：normName(名字) + '\n' + normName(单位)（同名同单位的合成一行）；qty：这一行勾上会加多少（还没买过的那几道加起来；都买过了就是全部）；
 * optional：每道菜里都是可选的；staple：常备品；have / haveLabel：要加到的清单上已经有的（要买、以后再说）和它现在显示的数量；
 * added：有一道菜的已经在清单上；addedLabel：have 上这几道菜加过的一共多少（再生成就是换掉这一份，页面要和「清单上一共」分开说）；
 * bought：每道菜的都已经买过；checked：默认勾不勾
 */
/** 两个用量相加（没写数量的不算；都没写 → null），和 addNeeds 合同名的几行一样 @param {number | null} a @param {number | null} b */
const plus = (a, b) => (a == null ? b : b == null ? a : Math.min(NEED_MAX, Math.round((a + b) * 1000) / 1000));
/** 这一份勾上时加哪几道：还没买过的；都买过了（自己又勾上了，就是要再买一次）→ 全部 @param {PlanLine | { sources: LineSource[] }} line */
const addingSources = (line) => { const fresh = line.sources.filter(s => s.state !== 'bought'); return fresh.length ? fresh : line.sources; };

/**
 * 「生成购物清单」面板里的每一行：from 到 to 这几天连着食谱（还在）的菜，按各自的人数换算（scaleIngredients），同名（normName）同单位的合成一行，
 * 写着来自哪几道菜；单位不一样的分开。默认勾不勾（checked）：
 *   这道菜的这一样已经在清单上（added）→ 勾着（再生成是替换，不会多；不勾就是不要了，确认时拿掉）；
 *   常备品、可选的不勾；每道菜的都已经买过的（bought）不勾（买完了再生成一次，不会又把买过的放回清单上）；别的勾着。
 * listId 给了就写出这张清单上已经有的（have）。返回 { lines（按第一次出现的先后：日子、哪一顿、食谱里的顺序）, dishes：算进来的菜, skipped：没连食谱（或者食谱删掉了）的菜 }
 * @param {State} state @param {string} from @param {string} to @param {{ listId?: string | null }} [opts]
 * @returns {{ lines: PlanLine[], dishes: PlanEntry[], skipped: PlanEntry[] }}
 */
export function planLines(state, from, to, { listId = null } = {}) {
  const list = listId ? liveList(state, listId) : null;
  const items = isObj(state.data.items) ? state.data.items : {};
  const dishes = [], skipped = [];
  /** @type {Map<string, PlanLine>} */
  const byKey = new Map();
  for (const e of entriesIn(state, from, to)) {
    const r = liveRecipe(state, e.recipeId);
    if (!r) { skipped.push(e); continue; }
    dishes.push(e);
    const source = planSource(e.id);
    const { open, bought } = portionOf(state, source);
    // 这道菜已经在清单上（还没买）的那几行：名字 + 单位。同名不同单位的分开算：生成时只勾了「牛奶 ml」，「牛奶 杯」不算加过
    /** @type {Set<string>} */
    const addedKeys = new Set();
    for (const its of open.values()) for (const it of its) for (const k of portionKeys(it, source)) addedKeys.add(k);
    for (const g of dishIngredients(state, e)) {
      const name = g.name.trim(), unit = g.unit.trim(), nk = normName(name), key = nk + '\n' + normName(unit);
      let line = byKey.get(key);
      if (!line) {
        line = { key, name, unit, qty: null, sources: [], optional: true, staple: false, have: null, haveLabel: '', added: false, addedLabel: '', bought: false, checked: false };
        byKey.set(key, line);
      }
      line.optional = line.optional && g.optional;
      let src = line.sources.find(x => x.entryId === e.id);
      if (!src) {
        // 还在清单上要买的先算：买过、又自己勾上再买一次的是「加过」（再生成是替换），不能当成买过的不勾、确认时拿掉
        src = { entryId: e.id, date: e.date, meal: e.meal, title: r.name.trim(), qty: null, unit, state: addedKeys.has(key) ? 'added' : bought.has(nk) ? 'bought' : 'new' };
        line.sources.push(src);
      }
      src.qty = plus(src.qty, g.qty);
    }
  }
  const lines = [...byKey.values()];
  const homes = list ? renamedHomes(state, dishes.map(e => planSource(e.id)), list.id) : new Map();
  for (const line of lines) {
    line.staple = isStaple(state, line.name);
    // 这几道菜的这一样已经在一样改过名的东西上：就是它（确认时就地换它的那一份）；不然按名字找
    const it = list ? homes.get(normName(line.name)) || own(items, itemId(state, list.id, line.name)) : null;
    line.have = it && isOpen(state, it) ? it : null;
    line.haveLabel = line.have ? totalLabel(line.have) : '';
    line.added = line.sources.some(s => s.state === 'added');
    if (line.have && line.added) {
      // 只算这一行的单位：同一样东西上这几道菜别的单位的那一份是另一行
      const uk = normName(line.unit);
      const needs = Object.fromEntries(line.sources.flatMap(s => needsFrom(/** @type {Item} */ (line.have), planSource(s.entryId))).filter(([, n]) => normName(str(n.unit)) === uk));
      line.addedLabel = totalLabel({ qty: null, unit: '', needs });
    }
    line.bought = line.sources.every(s => s.state === 'bought');
    line.qty = addingSources(line).reduce((q, s) => plus(q, s.qty), /** @type {number | null} */ (null));
    line.checked = line.added || (!line.staple && !line.optional && !line.bought);
  }
  return { lines, dishes, skipped };
}

/**
 * 删掉了的菜在清单上还没买的那一份拿掉（只为它加的软删除）。平常删菜时就拿掉了（deleteEntry），可还有两条路会剩下：
 * 勾掉以后删菜（已买的不动）、30 分钟内又取消勾选（点错了照原样放回去，连同那道菜的那一份）；另一台设备还不知道删了，
 * 又生成了一次（它那份更新，合并后那道菜的那一份回来了）。这时没有哪个计划的操作会再碰它，只好每次生成时顺手清掉。
 * 只认计划里还记着、标了删除的菜：计划里根本没有的来源不知道是什么，原样留着
 * @param {State} state @param {number} now
 */
function dropOrphans(state, now) {
  const plan = col(state);
  /** @type {Set<string>} */
  const gone = new Set();
  for (const it of Object.values(isObj(state.data.items) ? state.data.items : {})) {
    if (!it || it.deleted || (it.status !== 'need' && it.status !== 'later') || !isObj(it.needs)) continue;
    for (const k of Object.keys(it.needs)) {
      if (!k.startsWith('p:')) continue;
      const id = k.slice(2).replace(/#\d+$/, ''), e = own(plan, id);
      if (e && e.deleted) gone.add(id);
    }
  }
  for (const id of gone) removeNeeds(state, planSource(id), now);
}

/**
 * 「生成购物清单」的确认：先记下这次标 / 取消的常备品（staples：名字 → 是不是），再按勾上的（keys：PlanLine 的 key；不给 = 默认勾的）
 * 每道菜分开加：这道菜自己的来源 'p:<id>'（addNeeds，label 抄菜名），所以以后删掉其中一道只减它那一份。
 * 每一道（这几天连着食谱的）都换成这次的：已经在清单上的就地换成新的用量，这次没勾的、在别的清单上的旧的拿掉（只动还没买的）——
 * 同一段日子再生成一次是替换，不会重复加。一行里有几道菜已经买过的，只加还没买过的那几道（都买过了还勾上，就是要再买一次）。
 * 先把每道菜要的都放上，再拿掉不要的：前一道不要了、后一道还要的东西不会先删掉再恢复成新的一条（商店变回默认、memory 多记一次）。
 * 一个也没勾也行：这几道菜已经在清单上的那一份全拿掉。
 * 在一次 ctx.mutate 里，一起撤销。返回 { items：加进 / 改了几样东西（勾上的）, dishes：几道菜, changed：清单上真的变了几样 }；清单不在 → null
 * @param {State} state @param {{ from: string, to: string, listId: string, keys?: string[] | null, staples?: Record<string, boolean> }} opts @param {number} [now]
 */
export function generateList(state, { from, to, listId, keys = null, staples = {} }, now = Date.now()) {
  if (!liveList(state, listId)) return null;
  for (const [name, on] of Object.entries(staples || {})) setStaple(state, name, on, now);
  const { lines, dishes } = planLines(state, from, to, { listId });
  const pick = keys ? new Set(keys) : new Set(lines.filter(l => l.checked).map(l => l.key));
  /** @type {Map<string, { name: string, qty: number | null, unit: string }[]>} */
  const per = new Map(dishes.map(e => [e.id, []]));
  for (const line of lines) {
    if (!pick.has(line.key)) continue;
    // 放到 have 上（改过名的那一样就是它）；食谱里的名字另记着（addNeeds 的 ing），下次还认得
    const name = line.have ? line.have.name : line.name;
    for (const s of addingSources(line)) /** @type {any[]} */ (per.get(s.entryId)).push({ name, qty: s.qty, unit: s.unit, ing: line.name });
  }
  const before = snapshot(state);
  /** @param {PlanEntry} e */
  const targetsOf = (e) => new Map([[listId, /** @type {{ name: string, qty: number | null, unit: string }[]} */ (per.get(e.id))]]);
  for (const e of dishes) putPortion(state, e, targetsOf(e), now);
  for (const e of dishes) dropPortion(state, e, targetsOf(e), now);
  dropOrphans(state, now);
  const touched = new Set();
  for (const e of dishes) for (const ln of /** @type {any[]} */ (per.get(e.id))) touched.add(itemId(state, listId, ln.name));
  return { items: touched.size, dishes: dishes.length, changed: changedSince(state, before) };
}

// ---------- 先算一遍（不改数据）：页面在确认之前要知道提示条怎么说 ----------
/** 删掉这道菜会从清单上拿掉几样（deleteEntry 在一份拷贝上做一遍） @param {State} state @param {string} id */
export function previewDelete(state, id) {
  const r = deleteEntry(structuredClone(state), id, Date.now());
  return r ? r.removed : 0;
}
/** 这样改会不会动到清单（editEntry 在一份拷贝上做一遍；有错 → false） @param {State} state @param {string} id @param {EntryInput} patch */
export function previewEdit(state, id, patch) {
  const r = editEntry(structuredClone(state), id, patch, Date.now());
  return r.ok ? r.listChanged > 0 : false;
}
