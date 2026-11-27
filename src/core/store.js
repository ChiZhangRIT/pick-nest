// @ts-check
// 数据层：state.data 下每个集合都是「id → 记录」——lists 清单、items 清单里的东西、stores 商店、categories 分类、memory 买过的东西、recipes 食谱、plan 计划（第二版）、
// foods 常吃的、log 吃了什么（第三版）。
// 每条记录有 updatedAt（毫秒）；删除只打 deleted 标记、内容保留（「最近删除」里能恢复，也照样同步）。
// 多台设备合并时逐条比较 updatedAt 取较新的一整条；时间相同内容不同时按 canon() 排序取一份，保证每台设备结果一样。
// 例外：items、memory、foods 的 id 是算出来的，两台设备各自从头建的同一条（createdAt 不一样）要补上空着的字段（mergeRecord）。
// 设置按键合并，各键有自己的修改时间（settingsAt）。不认识的字段、集合原样保留：旧版 App 同步时不会弄丢新版的数据。
// 预置的清单、商店、分类用固定 id、updatedAt 0，由 ensureSeeds() 补。细节见 docs/DATA_MODEL.md。
import { isObj, str, own, safeKey } from './util.js';
import { toSimplified } from './hanzi.js';
// 预设标签三种语言的写法（只读文案表里 rcp.tag.* 那几条）：存进食谱的是键，读到任何一种语言写出来的字都要认回这个键（normalizeTags）
import { STRINGS as RECIPE_STRINGS } from '../strings/recipes.js';

/**
 * @typedef {object} Base 所有记录都有的字段
 * @property {string} id
 * @property {number} createdAt
 * @property {number} updatedAt   改动一律经过 stamp()：比上一版至少新 1 毫秒；预置记录是 0
 * @property {true} [deleted]     软删除：内容保留，照样同步
 * @property {number} [deletedAt]
 */
/** @typedef {'grocery' | 'general'} ListKind */
/** @typedef {'need' | 'done' | 'later'} ItemStatus */
/**
 * @typedef {Base & { sys: string | null, name: string, kind: ListKind, icon: string, glyph: string, color: string, order: number,
 *   defaultStoreId: string | null, archived: boolean }} List
 * 清单。sys：预置清单的标记（'groceries' | 'tobuy'），name 为空时显示界面语言的文案。
 * icon：自己写的图标（一个 emoji 或一两个字）；glyph：画好的图标名；都空的按类型默认；color：色调名，空的按类型默认（core/listIcons.js）
 */
/**
 * @typedef {Base & { listId: string, name: string, qty: number | null, unit: string, note: string,
 *   categoryId: string | null, storeId: string | null, status: ItemStatus, doneAt: number | null,
 *   url: string, price: number | null, needs: Record<string, any>, boughtFor?: Record<string, number>, fromLater?: true, statusAt?: number }} Item
 * 清单里的一样东西。qty / unit 是自己加的；needs 是食谱、计划加进来的用量：来源 → { qty, unit, label, recipeId, name? }（core/items.js 的 addNeeds；
 * name 只在清单上改过名时有：这一份是食谱里的哪一样），
 * 显示的数量是两样加起来（qtyParts）。不认识的来源和字段原样保留。
 * boughtFor：买过以后又加回来时，上一轮计划里哪几道菜的这一样已经买过（来源 'p:<id>' → 买的时间，boughtAfter）；不算在数量里，只给计划看
 * fromLater：从「以后再说」勾成已买的（取消勾选时回以后再说）；只在已买时有
 * statusAt：状态最后一次改的时间（stampRecord 记；以前的记录没有，当 0）。合并时看另一台设备勾成已买的时候，这一份知不知道（boughtMeanwhile）
 */
/** @typedef {Base & { name: string, order: number, archived: boolean }} Store 商店 */
/** @typedef {Base & { sys: string | null, name: string, kind: ListKind | null, order: number }} Category 分类 */
/**
 * @typedef {Base & { name: string, kind: ListKind, categoryId: string | null, categorySet?: true, unit: string, qty: number | null,
 *   stores: Record<string, { n: number, at: number }>, uses: number, lastAt: number }} Memory
 * 买过的东西（跨清单的习惯），每个 normName 一条，id = 'm_' + hash64(normName)。
 * categorySet：用户在编辑面板里选过分类（包括「未分类」）；没选过的记录上没有这个键。
 * staple：常备品（盐、油、生抽……，加食谱的食材时默认不勾）；不是的记录上没有这个键
 */
/**
 * @typedef {{ key: string, name: string, qty: number | null, unit: string, note: string, optional: boolean }} Ingredient
 * 食谱里的一样食材。key 在这道食谱里不重复（排顺序、改名都不变）；qty 是 null 时是「适量」「少许」这种（原话在 note 里）
 */
/**
 * @typedef {{ cuisine: string[], style: string[] }} RecipeTags
 * 食谱的标签（第 11 步）：菜系、风格两组，存的是写出来的字（预设的也是），同一组里 normName 一样的只有一个
 */
/**
 * @typedef {{ sha256: string, mime: string, w: number | null, h: number | null, bytes: number | null }} Photo
 * 食谱的成品图（第 12 步）：sha256 是图片内容的哈希（小写 64 位十六进制），图片本身在本机的 IndexedDB（core/blobStore.js）和同步仓库的 images/ 里
 */
/**
 * @typedef {Base & { name: string, servings: number | null, steps: string, source: string, note: string, ings: Ingredient[], tags: RecipeTags, photo: Photo | null,
 *   nutrition: Nutrition | null, ordered?: true }} Recipe
 * 食谱（第二版）。servings：几人份，null = 没写（加到清单时不能按人数换算）；steps 做法、source 来源（链接或一句话）、note 备注；
 * ordered：食材手动 ↑↓ 排过（第 11 步：新加的只放进它那一组的最后，不再整张按类别排），没排过的记录上没有这个键；photo：成品图（第 12 步），没有是 null；
 * nutrition：每人份营养（第 13 步，手动填的），一个也没填是 null
 */
/**
 * @typedef {{ kcal: number | null, protein: number | null, carbs: number | null, fat: number | null }} Nutrition
 * 营养（第三版）：热量千卡（整数）、蛋白质 / 碳水 / 脂肪克（最多一位小数），没填的是 null，都不是负数
 */
/**
 * @typedef {Base & { name: string, kind: 'food' | 'ingredient', per: Nutrition, perUnit: 'serving' | '100g', grams: Record<string, number>,
 *   ref: string | null, uses: number, lastAt: number }} Food
 * 常吃的和自己填的营养（第三版），每个 normName 一条，id = 'f_' + hash64(normName)（core/foods.js 的 foodId）。
 * kind 'food'：记饮食时手动写过的（per 是每份）；'ingredient'：食材的营养（第 15 步，per 是每 100 g）
 */
/**
 * @typedef {Base & { date: string, meal: Meal, title: string, servings: number, kcal: number | null, protein: number | null, carbs: number | null, fat: number | null,
 *   recipeId: string | null, planId: string | null, foodId: string | null, estimated: boolean, note: string, order: number }} LogEntry
 * 吃了什么（第三版）：某一天某一顿吃的一样。营养是记的时候抄下来的合计（已经乘过份数）：以后改了食谱、常吃的，过去的记录不变
 */
/** @typedef {'breakfast' | 'lunch' | 'dinner' | 'snack'} Meal */
/**
 * @typedef {Base & { date: string, meal: Meal, recipeId: string | null, title: string, servings: number | null, note: string, order: number }} PlanEntry
 * 计划里的一道菜（第二版）：某一天（本地日期 'YYYY-MM-DD'）某一顿。连着食谱的 recipeId 有值、title 抄下食谱名字（食谱删掉了照样看得懂）；
 * 只写一句的（「出去吃」）recipeId 是 null。servings：这一顿几人份（换算用量），null = 照食谱的
 */
/**
 * @typedef {object} State
 * @property {'picknest'} app
 * @property {1} v
 * @property {{ lists: Record<string, List>, items: Record<string, Item>, stores: Record<string, Store>,
 *   categories: Record<string, Category>, memory: Record<string, Memory>, recipes: Record<string, Recipe>, plan: Record<string, PlanEntry>,
 *   foods: Record<string, Food>, log: Record<string, LogEntry>, [collection: string]: Record<string, any> }} data
 * @property {Record<string, any>} settings     同步的设置（按键合并）
 * @property {Record<string, number>} settingsAt 各设置键的修改时间
 */
/** @typedef {(key: string, vars?: Record<string, any>) => string} Translate */

export const COLLECTIONS = ['lists', 'items', 'stores', 'categories', 'memory', 'recipes', 'plan', 'foods', 'log'];
// kind、status 认不出的取值按默认值读（下面的整理函数），改过以后会照默认值写回去。
// 以后要加新的取值（比如「项目」清单）：用新字段表达，或者同时升 v（旧版会拒绝读、不会改坏），不要直接往这几个字段里塞新值
/** @type {ListKind[]} */
export const LIST_KINDS = ['grocery', 'general'];
/** @type {ItemStatus[]} */
export const ITEM_STATUS = ['need', 'done', 'later'];
/** 计划、饮食记录里的几顿，也是一天里排的顺序；认不出的按晚饭读 @type {Meal[]} */
export const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'];
/** 计划里一道菜加进清单的那一份的来源前缀（'p:<计划里那一道的 id>'，core/plan.js 的 planSource）；同一张清单上不同单位的另记 'p:<id>#2'…… */
export const PLAN_SOURCE = 'p:';
/** 一样东西上最多记几道菜「买过」（items.boughtFor） */
export const BOUGHT_MAX = 50;
/**
 * 已买 / 已清除的这一样又要买了（新的一轮：再加回来、隔久了取消勾选、合并成另一条）：上一轮的 needs 要清空（不然买过的用量又成了要买的），
 * 可上面计划的那几道菜「这一样已经买过了」得留着——不然再生成一次购物清单，这道菜的这一样又成了没买过的，默认勾上放回清单（core/plan.js）。
 * 返回新的 boughtFor：原来记着的 + 这一轮 needs 里计划的来源（'p:<id>#2' 算 'p:<id>'）→ 买的时间（doneAt，缺了用 fallback）；不是已买的只返回原来记着的
 * @param {any} it @param {number} fallback @returns {Record<string, number>}
 */
export function boughtAfter(it, fallback) {
  /** @type {Record<string, number>} */
  const out = isObj(it && it.boughtFor) ? copySafe(it.boughtFor) : {};
  if (!it || it.status !== 'done' || !isObj(it.needs)) return out;
  const at = numOrNull(it.doneAt) ?? fallback;
  for (const k of Object.keys(it.needs)) {
    if (!k.startsWith(PLAN_SOURCE)) continue;
    const src = k.replace(/#\d+$/, '');
    out[src] = Math.max(numOrNull(out[src]) ?? 0, at);
  }
  return out;
}
// V1 还没有同步的设置（语言、主题这些是本机设置，在 picknest.local）；以后加的设置在这里给默认值
export const DEFAULT_SETTINGS = Object.freeze({});

/** @param {any[]} states */
const collectionsOf = (...states) => [...new Set([...COLLECTIONS, ...states.flatMap(s => Object.keys((s && isObj(s.data) && s.data) || {}))])].filter(safeKey);

/** @returns {State} */
export function blankState() {
  return { app: 'picknest', v: 1, data: { lists: {}, items: {}, stores: {}, categories: {}, memory: {}, recipes: {}, plan: {}, foods: {}, log: {} }, settings: { ...DEFAULT_SETTINGS }, settingsAt: {} };
}

/** 和键的顺序无关的序列化：判断两份数据是否一样，以及打平时决定取哪一份 @param {any} v @returns {string} */
export function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  }
  return JSON.stringify(v === undefined ? null : v);
}

// ---------- 整理一条记录：修得好的修好，用户写的文字一个字都不改 ----------
const DANGER = new Set(['__proto__', 'constructor', 'prototype']);
/**
 * 复制自有字段，去掉 __proto__ 之类：JSON.parse 会把 "__proto__" 当成普通的键，再赋值给别的对象就成了改原型
 * @param {Record<string, any>} o
 * @returns {Record<string, any>}
 */
function copySafe(o) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const k of Object.keys(o)) if (!DANGER.has(k)) out[k] = o[k];
  return out;
}
/** 数字或能读成数字的字符串 → 数字；别的 → null @param {unknown} v @returns {number | null} */
const numOrNull = v => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
/** 毫秒时刻：不是非负数就当 0 @param {unknown} v */
const time = v => { const n = numOrNull(v); return n != null && n >= 0 ? n : 0; };
/** 次数：非负整数 @param {unknown} v */
const count = v => { const n = numOrNull(v); return n != null && n > 0 ? Math.floor(n) : 0; };
/** @param {unknown} v */
const idOrNull = v => (safeKey(v) ? v : null);
/** @param {unknown} v */
const sysOrNull = v => (typeof v === 'string' && v ? v : null);      // 新版可能有新的预置标记：认不出也留着，显示时退回「未命名」

/**
 * 所有记录共同的字段。createdAt 只在缺了 / 坏了时补成 updatedAt：预置记录的 createdAt 是 0，用户改过以后也要还是 0（清单按 order、createdAt 排）
 * @param {Record<string, any>} rec
 * @param {string} id
 */
function base(rec, id) {
  const r = copySafe(rec);
  r.id = id;
  r.updatedAt = time(rec.updatedAt);
  const c = numOrNull(rec.createdAt);
  r.createdAt = c != null && c >= 0 ? c : r.updatedAt;
  if (r.deleted) { r.deleted = true; r.deletedAt = time(rec.deletedAt) || r.updatedAt; }
  else { delete r.deleted; delete r.deletedAt; }
  return r;
}

/** @param {Record<string, any>} rec @param {string} [id] @returns {List} */
export function normalizeList(rec, id = rec && rec.id) {
  const r = base(rec, /** @type {string} */ (id));
  r.sys = sysOrNull(r.sys);
  r.name = str(r.name);
  r.kind = LIST_KINDS.includes(r.kind) ? r.kind : r.sys === 'groceries' ? 'grocery' : 'general';
  r.icon = str(r.icon);
  // 画好的图标单独一个字段（旧版只认 icon，见 core/listIcons.js 开头）；认不出的名字也原样留着
  r.glyph = str(r.glyph);
  // 色调认不出的（新版才有的）也原样留着，显示时按默认（core/listIcons.js 的 listLook）：旧版改名字时不会把它冲掉
  r.color = str(r.color);
  r.order = numOrNull(r.order) ?? 0;
  r.defaultStoreId = idOrNull(r.defaultStoreId);
  r.archived = r.archived === true;
  return /** @type {List} */ (r);
}

/** qty 没写（旧记录、手写的数据）当成新加的默认 1；写了 null 是「不写数量」，要保留 @param {Record<string, any>} rec @param {string} [id] @returns {Item} */
export function normalizeItem(rec, id = rec && rec.id) {
  const r = base(rec, /** @type {string} */ (id));
  r.listId = str(r.listId);
  r.name = str(r.name);
  r.qty = r.qty === undefined ? 1 : numOrNull(r.qty);
  r.unit = str(r.unit);
  r.note = str(r.note);
  r.categoryId = idOrNull(r.categoryId);
  r.storeId = idOrNull(r.storeId);
  r.status = ITEM_STATUS.includes(r.status) ? r.status : 'need';
  r.doneAt = numOrNull(r.doneAt);
  r.url = str(r.url);
  r.price = numOrNull(r.price);
  r.needs = isObj(r.needs) ? copySafe(r.needs) : {};     // 食谱 / 计划加进来的用量（core/items.js 的 addNeeds）：里面是什么都原样留着，新版的来源、字段旧版也不丢
  // 买过以后又加回来时记下的「这几道菜的这一样已经买过」（计划的来源 → 买的时间，boughtAfter）：只留时间是数字的，最多 BOUGHT_MAX 道
  // （最近买的；再早的菜不会再生成，记录不越积越大）；一道也没有就不放这个键（没有这段历史的记录和以前一模一样）
  const bf = isObj(r.boughtFor) ? Object.entries(r.boughtFor).filter(([k, v]) => safeKey(k) && typeof v === 'number' && Number.isFinite(v) && v >= 0) : [];
  if (bf.length) r.boughtFor = Object.fromEntries(bf.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, BOUGHT_MAX));
  else delete r.boughtFor;
  if (r.fromLater !== true || r.status !== 'done') delete r.fromLater;   // 从「以后再说」勾掉的已买（items.js 的 untickStatus）：只在已买时有
  // 状态最后一次改的时间（stampRecord）：没改过状态的、以前的记录上没有这个键（不白白多一个字段，也不让旧数据看着像改过）
  const sa = numOrNull(r.statusAt);
  if (sa != null && sa >= 0) r.statusAt = sa; else delete r.statusAt;
  return /** @type {Item} */ (r);
}

/** @param {Record<string, any>} rec @param {string} [id] @returns {Store} */
export function normalizeStore(rec, id = rec && rec.id) {
  const r = base(rec, /** @type {string} */ (id));
  r.name = str(r.name);
  r.order = numOrNull(r.order) ?? 0;
  r.archived = r.archived === true;
  return /** @type {Store} */ (r);
}

/** @param {Record<string, any>} rec @param {string} [id] @returns {Category} */
export function normalizeCategory(rec, id = rec && rec.id) {
  const r = base(rec, /** @type {string} */ (id));
  r.sys = sysOrNull(r.sys);
  r.name = str(r.name);
  r.kind = LIST_KINDS.includes(r.kind) ? r.kind : null;
  r.order = numOrNull(r.order) ?? 0;
  return /** @type {Category} */ (r);
}

/** @param {Record<string, any>} rec @param {string} [id] @returns {Memory} */
export function normalizeMemory(rec, id = rec && rec.id) {
  const r = base(rec, /** @type {string} */ (id));
  r.name = str(r.name);
  r.kind = LIST_KINDS.includes(r.kind) ? r.kind : 'grocery';
  r.categoryId = idOrNull(r.categoryId);
  if (r.categorySet !== true) delete r.categorySet;     // 只在选过时才有：没选过的记录不用每条都多一个 false
  if (r.staple !== true) delete r.staple;               // 常备品也一样：只有标过的才有
  r.unit = str(r.unit);
  r.qty = numOrNull(r.qty);
  /** @type {Record<string, any>} */
  const stores = {};
  if (isObj(r.stores)) for (const [sid, v] of Object.entries(r.stores)) if (safeKey(sid) && isObj(v)) stores[sid] = { ...copySafe(v), n: count(v.n), at: time(v.at) };
  r.stores = stores;
  r.uses = count(r.uses);
  r.lastAt = time(r.lastAt);
  return /** @type {Memory} */ (r);
}

/**
 * 食谱。食材的 key 缺了、坏了、重了时按位置补一个（'g_' + 第几样，被占了再加后缀）：整理要每台设备算得一样，不能用随机的，
 * 不然同一份数据在两台设备上整理出来不一样，同步时来回改。食材里不认识的字段原样留着；不是对象的食材扔掉
 * @param {Record<string, any>} rec @param {string} [id] @returns {Recipe}
 */
export function normalizeRecipe(rec, id = rec && rec.id) {
  const r = base(rec, /** @type {string} */ (id));
  r.name = str(r.name);
  r.tags = normalizeTags(r.tags);
  r.photo = normalizePhoto(r.photo);
  r.nutrition = normalizeNutrition(r.nutrition, true);
  if (r.ordered !== true) delete r.ordered;          // 只有 true 有意思；没排过的记录上不放这个键（以前的食谱和原来一模一样）
  const sv = numOrNull(r.servings);
  r.servings = sv != null && sv > 0 ? sv : null;
  r.steps = str(r.steps);
  r.source = str(r.source);
  r.note = str(r.note);
  const src = (Array.isArray(r.ings) ? r.ings : []).filter(isObj);
  const seen = new Set();
  const taken = new Set(src.map(g => g.key).filter(k => safeKey(k)));
  r.ings = src.map((g, i) => {
    const x = copySafe(g);
    let key = safeKey(x.key) && !seen.has(x.key) ? x.key : null;
    if (!key) {
      key = 'g_' + i;
      for (let n = 1; seen.has(key) || taken.has(key); n++) key = 'g_' + i + '_' + n;
    }
    seen.add(key);
    const q = numOrNull(x.qty);
    return { ...x, key, name: str(x.name), qty: q != null && q > 0 ? q : null, unit: str(x.unit), note: str(x.note), optional: x.optional === true };
  });
  return /** @type {Recipe} */ (r);
}

/** 正整数（像素、字节数）；不是 → null @param {unknown} v */
const posInt = v => { const n = numOrNull(v); return n != null && n > 0 ? Math.round(n) : null; };
/**
 * 整理成品图（第 12 步）：不是对象、sha256 不是 64 位十六进制的 → null（指不到哪张图，留着只会一直显示「没有这张图」）；
 * sha256 转小写（文件名、本机的键都是小写）；mime 去掉参数、转小写，没写的是 image/jpeg；宽高、字节数不是正整数的 → null；别的字段（新版加的）原样留着
 * @param {unknown} p @returns {Photo | null}
 */
export function normalizePhoto(p) {
  if (!isObj(p) || typeof p.sha256 !== 'string') return null;
  const sha256 = p.sha256.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sha256)) return null;
  const mime = str(p.mime).toLowerCase().split(';')[0].trim() || 'image/jpeg';
  return /** @type {Photo} */ ({ ...copySafe(p), sha256, mime, w: posInt(p.w), h: posInt(p.h), bytes: posInt(p.bytes) });
}

/** 食谱标签的两组（第 11 步） */
export const TAG_GROUPS = /** @type {const} */ (['cuisine', 'style']);
/**
 * 预设的标签（菜系、风格）：文案的键 rcp.tag.<组>.<键>。存进食谱的是 '#' + 键（'#italian'），显示时按当前界面语言 t() 写出来：
 * 换了界面语言、改了某种语言的写法（繁体「義式」→「意式」），已经存的标签跟着变，也不会一个意思两种写法各算一个。
 * 只能加，不要改名、不要删（旧的数据里存着这些键；认不出的键当自己写的字原样显示）
 */
export const RECIPE_TAG_PRESETS = Object.freeze({
  cuisine: Object.freeze(['sichuan', 'cantonese', 'hunan', 'shandong', 'jiangzhe', 'dongbei', 'taiwanese', 'homeChinese', 'japanese', 'korean', 'seAsian', 'western', 'italian', 'mexican']),
  style: Object.freeze(['homestyle', 'quick', 'withRice', 'lean', 'vegetarian', 'soup', 'cold', 'breakfast', 'bento', 'dessert', 'baking', 'guests']),
});
// 预设以前用过、后来改掉的写法：以前存的就是当时显示出来的字，照样认回那个键（文案表里已经没有这些字了）
/** @type {Record<string, Record<string, string[]>>} */
const OLD_PRESET_TEXT = { cuisine: { italian: ['義式'] } };
/** @type {Map<string, Map<string, string>> | null} 组 → (normName(写法) → '#键')；第一次用时才建（和文案表的 import 顺序无关） */
let presetIndex = null;
function presetMap(/** @type {string} */ group) {
  if (!presetIndex) {
    presetIndex = new Map();
    for (const g of TAG_GROUPS) {
      const m = new Map();
      for (const k of RECIPE_TAG_PRESETS[g]) {
        // 键本身也认大小写、全角（'#Quick'、'＃quick'）：不然自己写的「#Quick」按 normName 比是 '#quick'，和预设的键撞成同一个，
        // 卡片上写「#Quick」、编辑页上预设「快手」却是按下的，「没用到的预设」里也没有它
        const texts = ['#' + k, ...Object.values(RECIPE_STRINGS).map(tb => /** @type {Record<string, unknown>} */ (tb)[`rcp.tag.${g}.${k}`]), ...((OLD_PRESET_TEXT[g] || {})[k] || [])];
        // 先来的不被后来的盖掉：万一两个预设在某种语言里写法一样，还是认成前面那个（测试查了现在没有这种情况）
        for (const x of texts) { const n = typeof x === 'string' ? normName(x) : ''; if (n && !m.has(n)) m.set(n, '#' + k); }
      }
      presetIndex.set(g, m);
    }
  }
  return presetIndex.get(group) || new Map();
}
/** 是不是这一组预设的键（'#italian'） @param {string} group @param {unknown} tag */
export const isPresetTag = (group, tag) => typeof tag === 'string' && tag[0] === '#' && /** @type {Record<string, readonly string[]>} */ (RECIPE_TAG_PRESETS)[group] != null
  && /** @type {Record<string, readonly string[]>} */ (RECIPE_TAG_PRESETS)[group].includes(tag.slice(1));
/**
 * 一个标签（存的值或输入的字）是不是这一组的某个预设：是键本身（'#Quick' 这样大小写、全角不同的也算）、或者等于它在任何一种语言里写出来的字（normName 比，简繁一样；也认以前的写法）→ '#键'；不是 → null
 * @param {string} group @param {unknown} tag @returns {string | null}
 */
export function presetTagKey(group, tag) {
  if (typeof tag !== 'string') return null;
  if (isPresetTag(group, tag.trim())) return tag.trim();
  return presetMap(group).get(normName(tag)) || null;
}
/** 同一组里两个标签是不是同一个：预设按键，自己写的按 normName（「粵菜」「粤菜」「Cantonese」都是 '#cantonese'） @param {string} group @param {unknown} tag */
export const tagId = (group, tag) => presetTagKey(group, tag) || normName(tag);
/** 搜索时这个标签算哪些字：预设是三种语言（和以前的）写法都算（搜「Italian」「意式」都找得到），自己写的就是它 @param {string} group @param {unknown} tag @returns {string[]} */
export function tagTexts(group, tag) {
  const k = presetTagKey(group, tag);
  if (!k) return [normName(tag)];
  return [...presetMap(group)].filter(([n, v]) => v === k && n[0] !== '#').map(([n]) => n);
}
/**
 * 整理标签：两组都是字符串数组（不是数组的当空的），空白的、不是字符串的扔掉；预设的（任何一种语言写出来的字、以前的写法）换成键 '#…'，
 * 自己写的字原样（不做简繁转换、不截）；同一组里是同一个的（tagId 一样：「粵菜」「粤菜」「Cantonese」）只留第一个。别的组（新版才有的）原样留着。
 * 每台设备读进来都这样整理，结果一样：合并时两边是同一种写法，再整理一遍也不变
 * @param {unknown} tags @returns {RecipeTags}
 */
export function normalizeTags(tags) {
  const out = isObj(tags) ? copySafe(tags) : {};
  for (const g of TAG_GROUPS) {
    const seen = new Set(), list = [];
    for (const x of (Array.isArray(out[g]) ? out[g] : [])) {
      if (typeof x !== 'string' || !normName(x)) continue;
      const key = presetTagKey(g, x), id = key || normName(x);
      if (seen.has(id)) continue;
      seen.add(id);
      list.push(key || x);
    }
    out[g] = list;
  }
  return /** @type {RecipeTags} */ (out);
}

/**
 * 计划里的一道菜。date 认不出的（不是 'YYYY-MM-DD'）原样留着：哪一天都不显示，但不改用户的数据（新版也许有别的写法）；
 * meal 认不出的按晚饭读（和 kind、status 一样，改过以后照晚饭写回去）
 * @param {Record<string, any>} rec @param {string} [id] @returns {PlanEntry}
 */
export function normalizePlan(rec, id = rec && rec.id) {
  const r = base(rec, /** @type {string} */ (id));
  r.date = str(r.date);
  r.meal = MEALS.includes(r.meal) ? r.meal : 'dinner';
  r.recipeId = idOrNull(r.recipeId);
  r.title = str(r.title);
  const sv = numOrNull(r.servings);
  r.servings = sv != null && sv > 0 ? sv : null;
  r.note = str(r.note);
  r.order = numOrNull(r.order) ?? 0;
  return /** @type {PlanEntry} */ (r);
}

// ---------- 第三版：营养、常吃的、吃了什么 ----------
/** 营养的几样，也是显示的顺序：热量（千卡）、蛋白质、碳水、脂肪（克） */
export const NUTRIENTS = /** @type {const} */ (['kcal', 'protein', 'carbs', 'fat']);
/**
 * 一个营养数：热量取整数千卡、营养素最多一位小数克（再多的位数是假的精确：估算本来就是大概的）；不是数、负数 → null（没填）
 * @param {string} k @param {unknown} v @returns {number | null}
 */
export function nutrValue(k, v) {
  const n = numOrNull(v);
  if (n == null || n < 0) return null;
  return k === 'kcal' ? Math.round(n) : Math.round(n * 10) / 10;
}
/**
 * 整理一组营养 { kcal, protein, carbs, fat }：每样是数或 null（nutrValue）；别的字段（新版也许有纤维、钠）原样留着。
 * orNull：一样也没填时是 null（食谱的每人份：没填和填了 0 分得开——0 千卡的黑咖啡是填了的）
 * @param {unknown} v @param {boolean} [orNull] @returns {Nutrition | null}
 */
export function normalizeNutrition(v, orNull = false) {
  const src = isObj(v) ? copySafe(v) : {};
  for (const k of NUTRIENTS) src[k] = nutrValue(k, src[k]);
  if (orNull && (!isObj(v) || NUTRIENTS.every(k => src[k] == null))) return null;
  return /** @type {Nutrition} */ (src);
}
/** 常吃的那一条是哪种：认不出的按 'food' 读（和 kind、status 一样） */
export const FOOD_KINDS = ['food', 'ingredient'];
/**
 * 常吃的 / 食材的营养（第三版）。per 一直是四样都有的对象（没填的是 null）；perUnit 认不出的按 kind 定（每份 / 每 100 g）；
 * grams（这一样的单位重量）只留正数；ref（第 15 步：指定成内置表的哪一样）不是字符串 → null
 * @param {Record<string, any>} rec @param {string} [id] @returns {Food}
 */
export function normalizeFood(rec, id = rec && rec.id) {
  const r = base(rec, /** @type {string} */ (id));
  r.name = str(r.name);
  r.kind = FOOD_KINDS.includes(r.kind) ? r.kind : 'food';
  r.per = normalizeNutrition(r.per);
  r.perUnit = r.perUnit === 'serving' || r.perUnit === '100g' ? r.perUnit : r.kind === 'ingredient' ? '100g' : 'serving';
  /** @type {Record<string, number>} */
  const grams = {};
  if (isObj(r.grams)) for (const [u, g] of Object.entries(r.grams)) { const n = numOrNull(g); if (u && !DANGER.has(u) && n != null && n > 0) grams[u] = Math.round(n * 10) / 10; }
  r.grams = grams;
  r.ref = typeof r.ref === 'string' && r.ref ? r.ref : null;
  r.uses = count(r.uses);
  r.lastAt = time(r.lastAt);
  return /** @type {Food} */ (r);
}
/**
 * 吃了什么的一条（第三版）。date 认不出的原样留着（和计划一样：哪一天都不显示，不改用户的数据）；meal 认不出的按晚饭读；
 * servings 不是正数的当 1 份；营养是合计（nutrValue：千卡整数、克一位小数、没填 null）
 * @param {Record<string, any>} rec @param {string} [id] @returns {LogEntry}
 */
export function normalizeLog(rec, id = rec && rec.id) {
  const r = base(rec, /** @type {string} */ (id));
  r.date = str(r.date);
  r.meal = MEALS.includes(r.meal) ? r.meal : 'dinner';
  r.title = str(r.title);
  const sv = numOrNull(r.servings);
  r.servings = sv != null && sv > 0 ? sv : 1;
  for (const k of NUTRIENTS) r[k] = nutrValue(k, r[k]);
  r.recipeId = idOrNull(r.recipeId);
  r.planId = idOrNull(r.planId);
  r.foodId = idOrNull(r.foodId);
  r.estimated = r.estimated === true;
  r.note = str(r.note);
  r.order = numOrNull(r.order) ?? 0;
  return /** @type {LogEntry} */ (r);
}

/** @type {Record<string, (rec: Record<string, any>, id?: string) => any>} */
const NORMALIZERS = { lists: normalizeList, items: normalizeItem, stores: normalizeStore, categories: normalizeCategory, memory: normalizeMemory, recipes: normalizeRecipe, plan: normalizePlan,
  foods: normalizeFood, log: normalizeLog };

/**
 * 按集合整理一条记录。不认识的集合（新版才有的）只修 id 和 updatedAt，别的原样保留
 * @param {string} collection
 * @param {Record<string, any>} rec
 * @param {string} [id]
 */
export function normalizeRecord(collection, rec, id = rec && rec.id) {
  const fn = own(NORMALIZERS, collection);
  return fn ? fn(rec, id) : { ...copySafe(rec), id, updatedAt: time(rec.updatedAt) };
}

/** 设置补齐默认值；不认识的键原样保留 @param {unknown} src */
function normSettings(src) {
  /** @type {Record<string, any>} */
  const s = { ...DEFAULT_SETTINGS };
  if (isObj(src)) for (const [k, v] of Object.entries(src)) if (safeKey(k)) s[k] = v;
  return s;
}

/**
 * 读入本地、云端或备份里的数据时的整理：丢掉不是对象的记录和危险的键，补齐字段。不补预置记录（那是 ensureSeeds 的事）
 * @param {any} s
 * @returns {State}
 */
export function normalizeState(s) {
  const out = blankState();
  if (!isObj(s)) return out;
  const data = isObj(s.data) ? s.data : {};
  for (const c of collectionsOf(s)) {
    const src = own(data, c);
    if (src !== undefined && !isObj(src)) continue;
    // 集合名可能是 toString、hasOwnProperty 这种原型上就有的名字：只认自有的，不然会把记录写到内置函数上
    out.data[c] = own(out.data, c) || {};
    for (const [id, rec] of Object.entries(src || {})) {
      if (!isObj(rec) || !safeKey(id)) continue;
      out.data[c][id] = normalizeRecord(c, rec, id);
    }
  }
  out.settings = normSettings(s.settings);
  if (isObj(s.settingsAt)) for (const [k, t] of Object.entries(s.settingsAt)) if (safeKey(k) && Number(t) > 0) out.settingsAt[k] = Number(t);
  return out;
}

/**
 * 一个数据文件的外壳对不对：{ app, v: 1, state: { data… } }——同步仓库里的 picknest.json、备份、出错时下载的原始数据都是这个形状。
 * 不是这个 App 的（或者根本读不出来）→ 'notApp'；新版 App 写的（v 比 1 大：旧版读了会改坏，见 docs/DATA_MODEL.md）→ 'newer'；
 * 缺了 state、版本号不对 → 'bad'；能读 → null。里面的记录由 normalizeState 整理
 * @param {any} d @param {string} [app]
 */
export function fileProblem(d, app = 'picknest') {
  if (!isObj(d) || d.app !== app) return 'notApp';
  if (Number(d.v) > 1 || (isObj(d.state) && Number(d.state.v) > 1)) return 'newer';
  if (d.v !== 1 || !isObj(d.state) || (d.state.app !== undefined && d.state.app !== app) || (d.state.v !== undefined && d.state.v !== 1)) return 'bad';
  if (d.state.data !== undefined && !isObj(d.state.data)) return 'bad';
  return null;
}

/** 同一条记录的两份取哪份：新的；一样新就按内容排，每台设备选的都一样 @param {any} a @param {any} b */
export function pick(a, b) {
  if (!a) return b;
  if (!b) return a;
  if ((b.updatedAt || 0) !== (a.updatedAt || 0)) return (b.updatedAt || 0) > (a.updatedAt || 0) ? b : a;
  return canon(b) > canon(a) ? b : a;
}

// ---------- 各自从头建的同一条（固定 id） ----------
// items（按清单 + 名字）和 memory、foods（按名字）的 id 是算出来的：一台设备还没拉到云端那条（新 iPad 还没粘贴同步码、Safari 清掉了存储、
// 店里离线）就又加了同名的，建的是一条空白的新记录，时间更新。整条取较新的话，云端那条的备注、链接、价格、常去的商店、记住的单位
// 就永远没了——云端那条可能是几个月前的，不是「两台设备同时改」。
// 认法：createdAt 不一样（同一条记录改来改去、恢复、移动，createdAt 都不变）。这时以较新的为底，它空着的字段用另一条的补上
// （memory 的次数、常去的商店取两边大的，选过的分类以较新的为准；items 的状态、数量、needs 先照同一条的规则定，见 blend）；createdAt 取早的，以后两边就是同一条。
// 结果和较新的那条不一样（补到了东西、购买算数，或者只是 createdAt 换成了早的）就比它晚 1 毫秒：还拿着较新那条的设备合并时它赢；
// 完全一样就是较新的那条（再合并几次结果都一样）
const blank = (/** @type {unknown} */ v) => v == null || v === '' || (isObj(v) && !Object.keys(v).length);
const ITEM_CARRY = ['note', 'url', 'price', 'unit', 'storeId', 'categoryId'];
/** 还没买的（要买、以后再说，没删除）：只有这种上面的 needs 是还要买的用量 @param {any} r */
const openItem = (r) => !r.deleted && (r.status === 'need' || r.status === 'later');
/** @param {string} c @param {any} w 较新的 @param {any} o 另一条 @returns {any} */
function blend(c, w, o) {
  if (c === 'items') {
    // 同一个 id 上是另一样东西（那条改过名、移到了别的清单）：不是同一样，照旧整条取较新的
    if (w.listId !== o.listId || normName(w.name) !== normName(o.name)) return null;
    // 状态、自己加的数量、needs、boughtFor 和同一条记录一样定（boughtMeanwhile：一条勾成已买、另一条是在那以后写的还没买的，购买算数，
    // 多出来的还要买）。不一样定的话，合并一次以后 createdAt 取了早的，两边成了「同一条」，再和原来那两份里的一份合并就走同一条的路、
    // 改判（新设备上买过以后才快速添加的「洋葱 1」：第一次合并成已买、自己写的 1 丢了，再合并一次又成了要买）——重复合并结果会变
    const bm = boughtMeanwhile(w, o, true);
    const out = bm ? { ...bm } : { ...w };
    // 空着的从另一条补；购买算数时单位换成了还没买那份的（可能是空的），较新那条自己的也算（不然再和它合并一次又补上，结果会变）
    for (const k of ITEM_CARRY) if (blank(out[k])) { const from = [o, w].find(r => !blank(r[k])); if (from) out[k] = from[k]; }
    // 各道菜的那几份（needs）只在两条都还没买时合在一起：两台设备从来没拿到过对方这一条，谁也不是有意拿掉对方的那几份——
    // 一台生成了第一周、另一台离线生成了第二周，合并后两周的洋葱都要算上。另一条已买、已清除，那是买过的一轮，补过来就又成了要买的；
    // 较新的已买、已清除，补了也没用（再加回来时会清空），只是白白多改一次（购买算数时一条是已买的，也不合：买过的几份已经拿掉了）。
    // 一条记着某个来源买过（boughtFor）、比另一条记着的晚（另一条没记着当最早），另一条上这个来源的那几份是没见过那次购买时加的，算买过了、不要：
    // 较新那条可能就是把另一条（或者带着同样几份的一份）合并进来、购买算数以后的结果，不跳过的话再合并一次买过的又回来（重复合并结果会变）；
    // 反过来较新那条上的也一样，不然经过一次中间的合并，买过的会从另一份各自建的那条上回来（先合并哪两份结果不一样）。
    // 同一个来源（连同不同单位另记的 '#2'）只用一条的，较新那条有就整个用它的：按键一个一个取的话，一条是「1 个 + 200 g」、
    // 另一条改成了「300 g」，合出来是「300 g + 200 g」，同一道菜算了两遍
    if (openItem(w) && openItem(o)) {
      const wb = isObj(w.boughtFor) ? w.boughtFor : {}, ob = isObj(o.boughtFor) ? o.boughtFor : {};
      const mine = Object.entries(copySafe(isObj(w.needs) ? w.needs : {})).filter(([k]) => !unseen(k, ob, wb));
      const srcs = new Set(mine.map(([k]) => shareKey(k)));
      const theirs = Object.entries(copySafe(isObj(o.needs) ? o.needs : {})).filter(([k]) => !unseen(k, wb, ob) && !srcs.has(shareKey(k)));
      out.needs = { ...Object.fromEntries(theirs), ...Object.fromEntries(mine) };
    }
    // 买过的那几道菜（boughtFor）是历史：两条的都留着；另一条已买、已清除，它那一轮计划的来源这里不带过来，也记成买过的
    // （较新的这条自己还是已买、needs 里还带着的不重复记：再合并一次结果一样）
    const still = out.status === 'done' ? new Set(Object.keys(isObj(out.needs) ? out.needs : {}).map(shareKey)) : new Set();
    const bf = isObj(out.boughtFor) ? copySafe(out.boughtFor) : {};
    for (const [k, v] of Object.entries(boughtAfter(o, time(o.updatedAt)))) if (!still.has(k)) bf[k] = Math.max(numOrNull(bf[k]) ?? 0, numOrNull(v) ?? 0);
    if (Object.keys(bf).length) out.boughtFor = bf;
    // 合并出来的这一条两份都见过了：另一条后来勾成的已买也算见过（不然以后和还留着那一份的设备合并，boughtMeanwhile 会以为没见过、把买过的又标回已买）
    const sa = Math.max(time(w.statusAt), time(o.statusAt));
    if (sa) out.statusAt = sa;
    return out;
  }
  if (c === 'foods') {
    // 常吃的（第三版）和 memory 一样按名字算 id：新设备上又记了一次「拿铁」，云端那条（几个月前填好的蛋白质、脂肪）不能被一条只写了热量的盖掉。
    // 次数、最近一次取大的；较新那条没填的营养用另一条的补——只在同一种、同一个「每多少」时补（每份的 190 千卡补到每 100 g 上就错了）；
    // 单位重量两条的都留（同一个单位以较新的为准）；ref 空着就补。
    // 例外（第 15 步）：较新那条是食材「指定成表里的哪一样」（kind 'ingredient'、有 ref）时不补每 100 g：指定的时候就清掉了自己填的数，
    // 补回来就又成了按自己填的算（估算里自己填的比指定的优先），后来的「指定成」白做了。
    // 两条里有一条是删掉的（食材「用回自动认的」）：营养、单位重量、ref 都不从它补，也不往删掉的上面补——删掉的是用户撤掉的说法，
    // 补进另一台设备从头建的那条，指定的、自己填的就又回来了（同一台设备删了再存用的是同一个 createdAt，见 estimate.js 的 ingredientRecord）
    const out = { ...w, uses: Math.max(w.uses || 0, o.uses || 0), lastAt: Math.max(w.lastAt || 0, o.lastAt || 0) };
    if (w.deleted || o.deleted) return out;
    if (w.kind === o.kind && w.perUnit === o.perUnit && isObj(o.per) && !(w.kind === 'ingredient' && !blank(w.ref))) {
      const per = { ...(isObj(w.per) ? w.per : {}) };
      for (const k of NUTRIENTS) if (per[k] == null && o.per[k] != null) per[k] = o.per[k];
      out.per = per;
    }
    out.grams = { ...(isObj(o.grams) ? copySafe(o.grams) : {}), ...(isObj(w.grams) ? w.grams : {}) };
    if (blank(out.ref) && !blank(o.ref)) out.ref = o.ref;
    return out;
  }
  const ws = isObj(w.stores) ? w.stores : {}, os = isObj(o.stores) ? o.stores : {};
  /** @type {Record<string, any>} */
  const stores = { ...ws };
  for (const [sid, v] of Object.entries(os)) {
    if (!safeKey(sid) || !isObj(v)) continue;
    const cur = own(ws, sid);
    stores[sid] = isObj(cur) ? { ...cur, n: Math.max(cur.n || 0, v.n || 0), at: Math.max(cur.at || 0, v.at || 0) } : v;
  }
  const out = { ...w, stores, uses: Math.max(w.uses || 0, o.uses || 0), lastAt: Math.max(w.lastAt || 0, o.lastAt || 0) };
  if (w.categorySet !== true && o.categorySet === true) { out.categoryId = o.categoryId; out.categorySet = true; }
  // 常备品和选过的分类一样：较新的那条是从头建的（没标过），另一条标过就留着
  if (w.staple !== true && o.staple === true) out.staple = true;
  if (blank(out.unit) && !blank(o.unit)) out.unit = o.unit;
  if (out.qty == null && o.qty != null) out.qty = o.qty;
  return out;
}

// ---------- 同一条记录：一台设备勾成已买，另一台不知道，又改了它 ----------
// 两个人一起：一个在店里勾掉洋葱、五花肉，一个在家里还没拉到，加了周五的菜、再生成一次购物清单——同一份清单上共用的几样一下全改写了，
// 时间更新。整条取较新的话，买过的又回到「要买」，数量还是全部的（每道菜的都算没买），再生成也认不出来。
// 认法：状态有自己的时间（statusAt，stampRecord 记）。已买的那份 statusAt 比还没买的那份新 = 还没买的那份写的时候没见过这次购买
// （见过了再改，statusAt 是抄过来的；自己取消勾选、撤销，statusAt 是更新的）；还没买的那份又是在勾掉以后写的（updatedAt 更晚）
// = 不是单纯的旧版本，是同时改的。这时购买算数：那一轮的 needs（键）、自己加的数量（一样的）算买过了；还没买的那份上多出来的（新加的菜、
// 新写的数量）是还要买的：有 → 新的一轮（和买过以后又加回来一样，买过的那几道菜记进 boughtFor）；没有 → 已买（买完清除了就还是清除的）。
// 别的字段照旧用较新的那份
/** @param {Record<string, any>[]} xs @returns {Record<string, number>} */
function boughtUnion(...xs) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const x of xs) for (const [k, v] of Object.entries(isObj(x) ? x : {})) if (safeKey(k) && numOrNull(v) != null) out[k] = Math.max(out[k] ?? 0, /** @type {number} */ (numOrNull(v)));
  return out;
}
/** 'p:<id>#2'、'a:<id>#2'（同名不同单位另记的一份）算它的来源 @param {string} k */
const shareKey = k => k.replace(/#\d+$/, '');
/**
 * 这一份（needs 的键）对方记着它的来源买过、比自己记着的晚（自己没记着当最早）：自己是没见过那次购买时加的，算买过了。
 * 自己记着一样晚或更晚的，是买过以后又自己加的，留着
 * @param {string} k @param {Record<string, unknown>} theirs 对方知道的（boughtFor，已买的还有这一轮） @param {Record<string, unknown>} mine 自己的 boughtFor
 */
const unseen = (k, theirs, mine) => (numOrNull(own(theirs, shareKey(k))) ?? -1) > (numOrNull(own(mine, shareKey(k))) ?? -1);
/**
 * 购买算数（boughtMeanwhile）时买过的那几份记进 boughtFor：计划的来源照 boughtAfter（计划要认「这道菜已经买过」），
 * 别的来源（食谱页加的 a:<随机>，以后新的来源）也记——只给合并认（unseen：别的那份上这几份不要），计划不看，数量也不算它。
 * 以前买过、这一轮又买了的取这一轮的时间（unseen 比的是谁知道的那次购买晚）
 * @param {any} d 已买的那份 @returns {Record<string, number>}
 */
function boughtShares(d) {
  const out = boughtAfter(d, time(d.updatedAt));
  const at = numOrNull(d.doneAt) ?? time(d.updatedAt);
  for (const k of Object.keys(isObj(d.needs) ? d.needs : {})) if (safeKey(shareKey(k))) out[shareKey(k)] = Math.max(numOrNull(own(out, shareKey(k))) ?? 0, at);
  return out;
}
/**
 * @param {any} w 较新的 @param {any} o 另一份
 * @param {boolean} [fresh] 两份是各自从头建的（blend）：还没买那份自己加的数量是它自己写的（没见过买的那份，不会是抄过来的），一样也留着
 * （新设备上快速添加的「跑鞋」，就是又要买了）；同一条里和买的那份一样的数量是买之前就有的，算买过了
 * @returns {any} 合并结果；不是这种情况 → null
 */
function boughtMeanwhile(w, o, fresh = false) {
  const [d, p] = w.status === 'done' ? [w, o] : [o, w];
  if (d.status !== 'done' || !openItem(p) || !(time(d.statusAt) > time(p.statusAt)) || !(time(p.updatedAt) > time(d.statusAt))) return null;
  // 还没买那份上，已买那份知道买过的（这一轮的 needs 按来源算：'p:x#2' 是 'p:x' 的另一个单位，同一道菜，一起买过了；还有它记着的以前买过的）、
  // 比还没买那份知道的晚的，都算买过了（unseen）。和 blend 里两条都还没买时的认法一样，不然先合并哪两份，买过的会不会回到清单上就不一样
  const pb = isObj(p.boughtFor) ? p.boughtFor : {};
  const knew = boughtShares(d);
  const left = Object.fromEntries(Object.entries(isObj(p.needs) ? p.needs : {}).filter(([k]) => !unseen(k, knew, pb)));
  const sameOwn = p.qty === d.qty && normName(str(p.unit)) === normName(str(d.unit));
  const ownLeft = p.qty != null && (fresh || !sameOwn) ? p.qty : null;
  if (!Object.keys(left).length && ownLeft == null) {
    if (d === w) return null;              // 较新的就是买过的那份，照旧整条取它
    const out = { ...w, status: 'done', doneAt: d.doneAt, statusAt: d.statusAt, needs: d.needs, fromLater: d.fromLater };
    const bf = boughtUnion(w.boughtFor, d.boughtFor);
    if (Object.keys(bf).length) out.boughtFor = bf; else delete out.boughtFor;
    if (d.deleted) Object.assign(out, { deleted: true, deletedAt: d.deletedAt });
    return out;
  }
  const { deleted, deletedAt, fromLater, ...rest } = w;
  // 留下的自己加的数量是还没买那份的，单位跟着它（较新的是买的那份时，不能写成那份的单位：「2 斤」变成「2 g」）
  const out = { ...rest, status: p.status, doneAt: null, statusAt: d.statusAt, needs: left, qty: ownLeft, unit: ownLeft != null ? p.unit : w.unit,
    boughtFor: boughtUnion(w.boughtFor, p.boughtFor, boughtShares(d)) };
  if (!Object.keys(out.boughtFor).length) delete out.boughtFor;
  return out;
}

/**
 * 同一条记录的两份合并成一份（顺序无关）：一般是 pick（较新的一整条）；items、memory、foods 里各自从头建的两条（createdAt 不一样）补上空着的字段，
 * items 的同一条（createdAt 一样）里一台设备勾成已买、另一台不知道又改了的，购买算数（boughtMeanwhile），见上面
 * @param {string} c @param {any} a @param {any} b
 */
export function mergeRecord(c, a, b) {
  const w = pick(a, b);
  if (!a || !b || (c !== 'items' && c !== 'memory' && c !== 'foods')) return w;
  const o = w === a ? b : a;
  const wc = Number(w.createdAt), oc = Number(o.createdAt);
  if (!(wc >= 0) || !(oc >= 0)) return w;
  if (wc === oc) {
    const out = c === 'items' ? boughtMeanwhile(w, o) : null;
    if (!out || canon(out) === canon(w)) return w;
    out.updatedAt = (w.updatedAt || 0) + 1;
    return out;
  }
  const out = blend(c, w, o);
  if (!out) return w;
  out.createdAt = Math.min(wc, oc);
  // 和较新那条不一样（补到了东西，或者只是 createdAt 换成了早的）就晚 1 毫秒：两条 updatedAt 一样时只换了 createdAt 的结果不比另一条新，
  // 再和另一条合并（createdAt 已经一样，走同一条的路）按内容排可能就取了另一条——重复合并结果会变
  if (canon(out) !== canon(w)) out.updatedAt = (w.updatedAt || 0) + 1;
  return out;
}

/**
 * 两份数据逐条合并（顺序无关：merge(a,b) 和 merge(b,a) 结果一样）。不补预置记录：合并完由调用的地方 ensureSeeds
 * @param {any} a
 * @param {any} b
 * @returns {State}
 */
export function mergeStates(a, b) {
  const out = blankState();
  const da = (a && isObj(a.data) && a.data) || {}, db = (b && isObj(b.data) && b.data) || {};
  for (const c of collectionsOf(a, b)) {
    out.data[c] = own(out.data, c) || {};
    const ids = new Set([...Object.keys(own(da, c) || {}), ...Object.keys(own(db, c) || {})]);
    for (const id of ids) if (safeKey(id)) out.data[c][id] = mergeRecord(c, own(own(da, c), id), own(own(db, c), id));
  }
  const sa = (a && a.settings) || {}, sb = (b && b.settings) || {}, ta0 = (a && a.settingsAt) || {}, tb0 = (b && b.settingsAt) || {};
  /** @type {Record<string, any>} */
  const settings = {};
  const keys = new Set([...Object.keys(sa), ...Object.keys(sb), ...Object.keys(ta0), ...Object.keys(tb0)]);
  for (const k of keys) {
    if (!safeKey(k)) continue;
    const ta = own(ta0, k) || 0, tb = own(tb0, k) || 0;
    const from = tb > ta ? sb : ta > tb ? sa : (canon(own(sb, k)) > canon(own(sa, k)) ? sb : sa);
    if (own(from, k) !== undefined) settings[k] = own(from, k);
    if (ta || tb) out.settingsAt[k] = Math.max(ta, tb);
  }
  out.settings = normSettings(settings);
  return out;
}

/**
 * 新的或改过的记录：盖上修改时间（比旧的至少新 1 毫秒，同一毫秒改两次也分得出先后）
 * @template {Record<string, any>} T
 * @param {T} rec
 * @param {{ updatedAt?: number } | null | undefined} prev
 * @param {number} [now]
 * @returns {T & { updatedAt: number }}
 */
export function stamp(rec, prev, now = Date.now()) {
  return { ...rec, updatedAt: Math.max(now, ((prev && prev.updatedAt) || 0) + 1) };
}
/**
 * 盖修改时间（stamp），items 的状态变了还记下 statusAt（和 updatedAt 一样）：合并时要分得出「改的时候知不知道别的设备勾成了已买」
 * （boughtMeanwhile）。写记录（writeRecord）、撤销（state.js）都走这里：撤销把状态改回去也是改状态，不能把旧的 statusAt 也搬回来
 * @param {string} collection @param {Record<string, any>} rec @param {any} prev @param {number} [now]
 */
export function stampRecord(collection, rec, prev, now = Date.now()) {
  const out = stamp(rec, prev, now);
  if (collection === 'items' && prev && prev.status !== out.status) out.statusAt = out.updatedAt;
  return out;
}

/**
 * core 里的操作函数（items.js、lists.js、memory.js，都在 ctx.mutate 里调用）写一条记录：整理字段；
 * 内容和原来一样就不动（不盖新时间，重新排序时没挪动的清单不算修改），变了才 stamp。返回存好的记录
 * @param {State} state @param {string} collection @param {Record<string, any>} rec 整条记录（改的时候是 { ...旧的, ...改动 }）
 * @param {number} [now]
 */
export function writeRecord(state, collection, rec, now = Date.now()) {
  const id = rec.id;
  if (!safeKey(collection) || !safeKey(id)) throw new Error('bad-id');
  if (!isObj(own(state.data, collection))) state.data[collection] = {};
  const col = state.data[collection];
  const prev = own(col, id);
  const next = normalizeRecord(collection, { ...rec, id, updatedAt: prev ? prev.updatedAt : now }, id);
  if (prev && canon(next) === canon(prev)) return prev;
  return (col[id] = normalizeRecord(collection, stampRecord(collection, next, prev, now), id));
}

/** 软删除：内容保留，照样同步，在「最近删除」里能恢复 @param {any} rec @param {number} [now] */
export function deletedRecord(rec, now = Date.now()) {
  return rec && !rec.deleted ? stamp({ ...rec, deleted: true, deletedAt: now }, rec, now) : null;
}

/** 恢复：去掉删除标记，修改时间晚于删除（别的设备上旧的删除不会再盖过来） @param {any} rec @param {number} [now] */
export function restoredRecord(rec, now = Date.now()) {
  if (!rec || !rec.deleted) return null;
  const { deleted, deletedAt, ...r } = rec;
  return stamp(r, rec, now);
}

/** 生成记录 id：前缀 + 时间 + 随机，几台设备同时新建也不会撞 @param {string} prefix */
export function newId(prefix) {
  const rnd = (globalThis.crypto && crypto.getRandomValues) ? [...crypto.getRandomValues(new Uint8Array(6))].map(b => b.toString(36).padStart(2, '0')).join('') : Math.random().toString(36).slice(2, 12);
  return prefix + Date.now().toString(36) + rnd;
}

/**
 * 改一项设置（直接改 state），修改时间比旧的至少新 1 毫秒。返回是否真的变了
 * @param {State} state @param {string} key @param {any} value @param {number} [now]
 */
export function setSetting(state, key, value, now = Date.now()) {
  if (!safeKey(key) || canon(state.settings[key]) === canon(value)) return false;
  if (value === undefined) delete state.settings[key]; else state.settings[key] = value;
  state.settingsAt[key] = Math.max(now, (state.settingsAt[key] || 0) + 1);
  return true;
}

// ---------- 预置数据 ----------
export const SYS_LISTS = ['groceries', 'tobuy'];
// 商店名是专有名词，直接写名字（不经过 t()）
export const SEED_STORES = [
  ['s_wholefoods', 'Whole Foods'], ['s_traderjoes', "Trader Joe's"], ['s_costco', 'Costco'], ['s_target', 'Target'],
  ['s_hmart', 'H Mart'], ['s_99ranch', '99 Ranch'], ['s_amazon', 'Amazon'], ['s_homedepot', 'The Home Depot'],
];
export const GROCERY_CATEGORIES = ['produce', 'meat', 'dairy', 'bakery', 'frozen', 'pantry', 'condiments', 'snacks', 'household'];
export const GENERAL_CATEGORIES = ['clothing', 'books', 'tools', 'electronics', 'home'];
export const SYS_CATEGORIES = [...GROCERY_CATEGORIES, ...GENERAL_CATEGORIES];

/**
 * 预置记录（每次调用都是新对象，改了不影响下次）。固定 id：两台设备各自初始化，同步后不会有两份「食材」；
 * createdAt / updatedAt 都是 0：用户的任何修改都比它新，另一台设备晚些初始化也盖不掉
 * @returns {{ lists: List[], stores: Store[], categories: Category[] }}
 */
export function seedRecords() {
  const at = { createdAt: 0, updatedAt: 0 };
  return {
    lists: [
      { id: 'l_groceries', sys: 'groceries', name: '', kind: 'grocery', icon: '', glyph: '', color: '', order: 0, defaultStoreId: 's_wholefoods', archived: false, ...at },
      { id: 'l_tobuy', sys: 'tobuy', name: '', kind: 'general', icon: '', glyph: '', color: '', order: 1, defaultStoreId: null, archived: false, ...at },
    ],
    stores: SEED_STORES.map(([id, name], i) => ({ id, name, order: i, archived: false, ...at })),
    categories: SYS_CATEGORIES.map((sys, i) => ({ id: 'c_' + sys, sys, name: '', kind: GROCERY_CATEGORIES.includes(sys) ? 'grocery' : 'general', order: i, ...at })),
  };
}

/**
 * 补上缺的预置记录（直接改 state，返回同一个 state）。已经有的——包括删掉的、改过的——都不动，所以删掉的预置商店不会自己回来；
 * 重复调用结果不变。加载后、每次合并后调用；不要放在 mutate 里（mutate 会给 updatedAt 0 的新记录盖上现在的时间）
 * @param {State} state
 */
export function ensureSeeds(state) {
  for (const [c, recs] of Object.entries(seedRecords())) {
    if (!isObj(state.data[c])) state.data[c] = {};
    const col = state.data[c];
    for (const rec of recs) if (own(col, rec.id) === undefined) col[rec.id] = normalizeRecord(c, rec, rec.id);
  }
  return state;
}

// ---------- 名字和固定 id ----------
/**
 * 比较名字用：NFKC（全角字母数字、全角空格变半角）→ 去首尾空格 → 连续空白合成一个 → 小写 → 繁体折成简体。
 * 只用来比较和算 id，不改用户写的名字
 * @param {unknown} s
 */
export function normName(s) {
  return toSimplified(str(s).normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase());
}

const B36 = '0123456789abcdefghijklmnopqrstuvwxyz';
/**
 * FNV-1a 64 位（按 UTF-8 字节），结果写成 base36。用两个 32 位的半边算，不用 BigInt：
 * 乘以 FNV 质数 2^40 + 0x1b3 = 低半边 × 0x1b3（不超过 2^41，double 算得准）再把低半边左移 8 位加到高半边
 * @param {string} s
 */
export function hash64(s) {
  let hi = 0xcbf29ce4, lo = 0x84222325;
  for (const b of new TextEncoder().encode(str(s))) {
    lo = (lo ^ b) >>> 0;
    const p = lo * 0x1b3;
    hi = (Math.imul(hi, 0x1b3) + Math.floor(p / 0x100000000) + (lo << 8)) >>> 0;
    lo = p >>> 0;
  }
  // 64 位整数超出 double 的精度：拆成四段 16 位，做长除法转 base36
  let parts = [hi >>> 16, hi & 0xffff, lo >>> 16, lo & 0xffff], out = '';
  while (parts.some(x => x)) {
    let rem = 0;
    parts = parts.map(x => { const cur = rem * 0x10000 + x; rem = cur % 36; return Math.floor(cur / 36); });
    out = B36[rem] + out;
  }
  return out || '0';
}

/**
 * 同一张清单里同名的东西用同一条记录，返回它的 id（调用的地方拿到后：有这条就恢复 / 提示已经在清单上，没有就新建）。
 * 先找这张清单里同名的记录（已买、已清除也算），而不是只看固定 id 那一格：改名改成「牛奶」的、从别的清单移过来的、
 * 以前固定 id 被占时分到随机 id 的，都已经是「这张清单里的牛奶」，再加一次不能又多出一条。
 * 同名的有几条时：没删除的优先（不然恢复一条删掉的，清单上就有两条一样的），再固定 id 优先，再按 id 排（每台设备选的一样）。
 * 都没有：用固定 id 'i_' + hash64(listId + '\n' + normName(name))（两台设备离线各加一次，同步后还是一条）；
 * 这一格被别的东西占了（那条改过名或移走了）：hash64(listId + '\n' + 名字 + '\n' + n) 里第一个空着的（同样每台设备算的一样）
 * @param {State} state
 * @param {string} listId
 * @param {string} name
 * @returns {string}
 */
export function itemId(state, listId, name) {
  // 以前的写法是 itemId(listId, name)：少传 state 不会报错，只会算出一个看着正常、其实不对的 id，所以这里直接拦下
  if (!isObj(state) || !isObj(state.data) || typeof listId !== 'string') throw new TypeError('itemId(state, listId, name)');
  const key = normName(name);
  const id = 'i_' + hash64(listId + '\n' + key);
  const items = isObj(state.data.items) ? state.data.items : {};
  /** @type {[string, any][]} */
  const same = Object.entries(items).filter(([, r]) => isObj(r) && r.listId === listId && normName(r.name) === key);
  /** @param {[string, any][]} recs */
  const choose = recs => (!recs.length ? null : recs.some(([k]) => k === id) ? id : recs.map(([k]) => k).sort()[0]);
  const found = choose(same.filter(([, r]) => !r.deleted)) || choose(same.filter(([, r]) => r.deleted));
  if (found) return found;
  if (!own(items, id)) return id;
  // 固定 id 被别的东西占了：也用算出来的（第 1、2…… 个空位），不用随机的——两台设备同步过的数据一样，离线各加一次还是同一个 id，同步后是一条
  for (let n = 1; n < 1000; n++) { const alt = 'i_' + hash64(listId + '\n' + key + '\n' + n); if (!own(items, alt)) return alt; }
  return newId('i_');
}

// ---------- 显示和排序 ----------
/** 清单的显示名：用户写的名字 → 预置清单的文案 → 「未命名清单」。t 由调用的地方给（core 不依赖界面语言） @param {List} list @param {Translate} t */
export function listName(list, t) {
  const name = str(list && list.name).trim();
  if (name) return name;
  return list && list.sys && SYS_LISTS.includes(list.sys) ? t('list.sys.' + list.sys) : t('list.untitled');
}
/** 分类的显示名：用户写的名字 → 预置分类的文案 → 「未命名分类」 @param {Category} cat @param {Translate} t */
export function categoryName(cat, t) {
  const name = str(cat && cat.name).trim();
  if (name) return name;
  return cat && cat.sys && SYS_CATEGORIES.includes(cat.sys) ? t('cat.sys.' + cat.sys) : t('cat.untitled');
}

/** 排序：order，再 createdAt，再 id（保证每台设备一样） @param {{ order: number, createdAt: number, id: string }} a @param {{ order: number, createdAt: number, id: string }} b */
export function byOrder(a, b) {
  return (a.order - b.order) || (a.createdAt - b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
/**
 * 「编辑」里的 ↑↓（首页的清单、设置里的商店和分类共用）：arr 是一起排顺序的全部记录（没删除的，归档的也在里面，按 byOrder 排好），
 * id 这一条挪到它前面 / 后面第一条 peer 为真的记录（首页、商店：没归档的；分类：同一组的，几组在 arr 里是穿插的）的另一边。
 * 只改这一条的 order：取新位置前后两条的中间值（可以是小数），别的记录一条也不动。合并是整条取较新的，白盖一个新时间
 * 就会盖过别的设备上对那一条的删除（预置记录靠 updatedAt 0 表示没人改过）；按 0、1、2…… 重写的话，中间夹着一条归档的
 * 或者跳过了别的组，后面的就全跟着变。归档的也要在 arr 里：不然它占着的 order 会被当成空位，取消归档以后和挪过来的撞在一起。
 * 前后两条的 order 一样（两台设备各自新建了一条）或者中间值已经分不开（同一处挪了很多次）时，才把 arr 写成 0、1、2……（只盖变了的）。
 * 挪不动（到头了、不在 arr 里、自己不是 peer：归档的清单 / 商店不排）返回 false
 * @param {State} state @param {string} collection @param {{ id: string, order: number }[]} arr @param {string} id @param {1 | -1} dir
 * @param {(r: any) => boolean} [peer] @param {number} [now]
 */
export function moveInOrder(state, collection, arr, id, dir, peer = () => true, now = Date.now()) {
  const list = [...arr];
  const i = list.findIndex(r => r.id === id);
  if (i < 0 || !peer(list[i])) return false;
  let j = i + dir;
  while (j >= 0 && j < list.length && !peer(list[j])) j += dir;
  if (j < 0 || j >= list.length) return false;
  const [r] = list.splice(i, 1);
  // 拿掉它以后插到 j：往下挪时 list[j - 1] 是越过的那一条，往上挪时 list[j] 是
  const lo = list[j - 1], hi = list[j];
  const order = lo && hi ? (lo.order + hi.order) / 2 : lo ? lo.order + 1 : hi ? hi.order - 1 : 0;
  if ((!lo || lo.order < order) && (!hi || order < hi.order)) {
    writeRecord(state, collection, { ...r, order }, now);
    return true;
  }
  list.splice(j, 0, r);
  list.forEach((x, k) => { if (x.order !== k) writeRecord(state, collection, { ...x, order: k }, now); });
  return true;
}

/** 一个集合里没删除的记录（数组，无序） @param {State} state @param {string} collection */
export const live = (state, collection) => Object.values((state && state.data && state.data[collection]) || {}).filter(r => !r.deleted);
/** 首页显示的清单：没删除、没归档，按顺序 @param {State} state @returns {List[]} */
export const homeLists = state => live(state, 'lists').filter(l => !l.archived).sort(byOrder);
/** 每张清单还要买几样（status 'need'、没删除）：listId → 数量 @param {State} state */
export function needCounts(state) {
  /** @type {Map<string, number>} */
  const m = new Map();
  for (const it of live(state, 'items')) if (it.status === 'need') m.set(it.listId, (m.get(it.listId) || 0) + 1);
  return m;
}
