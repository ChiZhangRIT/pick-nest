// @ts-check
// 食谱（第二版）：粘贴一整段食材拆成一行一样（parseIngredients）、按人数换算（scaleIngredients）、「食谱」页的搜索（searchRecipes）、
// 用到某样食材的食谱（recipesUsing：快速添加时的联想）、新建 / 改（validateRecipe、saveRecipe）、删除（deleteRecipe，软删除）、
// 「加到清单」面板里的每一行（recipeLines：常备品、可选的默认不勾，清单上已有的写出来）和确认（addRecipeToList → items.js 的 addNeeds）。
// 写法和 items.js 一样：操作函数直接改传进来的 state（页面在 ctx.mutate 里调用），记录经过 writeRecord / deletedRecord。
// 确定性的规则，不用 AI：粘贴的食材拆不出来就整段当名字（宁可不认，也不认错），加进去以后还能改。
import { normName, writeRecord, deletedRecord, newId, live, homeLists, itemId } from './store.js';
import { own, isObj, str, safeKey } from './util.js';
import { parseQuickAdd, readQty, isRecipeUnit, QTY_MAX } from './parse.js';
import { searchTerms } from './search.js';
import { collatorFor } from './group.js';
import { liveList, addNeeds, totalLabel, needsOf, NEED_MAX } from './items.js';
import { isStaple, setStaple } from './memory.js';

/** @typedef {import('./store.js').State} State */
/** @typedef {import('./store.js').Recipe} Recipe */
/** @typedef {import('./store.js').Ingredient} Ingredient */
/** @typedef {import('./store.js').Item} Item */
/** @typedef {import('./store.js').List} List */
/** @typedef {import('./store.js').Translate} Translate */

/** 几人份最多写到多少（再多多半是写错了，比如把克数写进来） */
export const SERVINGS_MAX = 99;

const col = (/** @type {State} */ s) => (isObj(own(s.data, 'recipes')) ? s.data.recipes : {});
/** 没删除的食谱；没有 → null @param {State} state @param {unknown} id @returns {Recipe | null} */
export function liveRecipe(state, id) {
  const r = typeof id === 'string' ? own(col(state), id) : null;
  return r && !r.deleted ? r : null;
}
/** 食谱的显示名：写的名字 → 「未命名食谱」 @param {Recipe} r @param {Translate} t */
export const recipeName = (r, t) => str(r && r.name).trim() || t('rcp.untitled');

// ---------- 粘贴食材 ----------
// 表情（小红书的笔记里到处都是）：「✅食材：」「✨用料✨」「💡做法：」「🥩五花肉 500g」「1️⃣ 鸡蛋 2个」「▪️牛腩」……每一行先把表情换成空格再拆：
// 开头的就和列表符号一样去掉了，标题、「做法」照样认得出来。名字里留着表情的话，和清单上的「五花肉」、常备品、用到它的食谱都对不上
// （normName 不去表情），加到清单还会多出一条「🥩五花肉」。连着的变体选择符（U+FE0F）、零宽连接（👩‍🍳）、肤色、旗帜、按键数字（1️⃣、写反了的 1⃣️）一起去掉
const PICTO = /(?:[0-9#*]\uFE0F?\u20E3|[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}\uFE0E\uFE0F\u200D\u20E3\u{E0020}-\u{E007F}])+/gu;
// 开头的「食材：」「【调料】」「Ingredients:」这类（后面要跟冒号、空白或者结束：「调料包 1 个」是一样东西）
const HEAD_WORDS = '(?:食材|用料|配料|材料|主料|辅料|调料|调味料|ingredients?)(?:清单|表)?';
const HEAD = new RegExp('^\\s*(?:[【\\[（(]\\s*' + HEAD_WORDS + '\\s*[】\\]）)]\\s*[:：]?\\s*|' + HEAD_WORDS + '\\s*(?:[:：]\\s*|\\s+|$))', 'i');
// 到了「做法」「步骤」这一行，后面就不是食材了（整篇笔记贴进来时，做法不要拆成一堆「食材」）
const STOP = /^[\s【\[（(#]*(?:做法|步骤|制作方法|制作步骤|烹饪步骤|烹饪方法|方法|instructions?|directions?|method|steps?)\s*\d*[\s】\]）)]*(?:[:：]|$)/i;
// 序号和列表符号：「1.」「1、」「(1)」「①」「-」「•」「·」「★」……；「1.5斤」的「1.」不是序号（表情在这之前已经换成空格了）
const BULLET = /^\s*(?:\d{1,2}[.、)）](?!\d)|[（(]\d{1,2}[）)]|[①-⑳❶-❿]|[-–—•·*●○▪◦✓✔☐□▶►★☆◆◇▸▹※])\s*/;
const stripBullets = (/** @type {string} */ s) => { for (let i = 0; i < 3; i++) s = s.replace(BULLET, ''); return s; };
// 不算数量的说法：写进备注
const VAGUE = ['适量', '少许', '若干', '少量', '适当', '一些', '酌量', '些许', '一小撮', '一点点', '一点', 'to taste', 'as needed'];
const VAGUE_RE = VAGUE.map(v => v.replace(/ /g, '\\s+')).join('|');
const VAGUE_END = new RegExp('^(.*?)\\s*(' + VAGUE_RE + ')$', 'i');
const VAGUE_START = new RegExp('^(' + VAGUE_RE + ')\\s*(.+)$', 'i');
const OPTIONAL = /^(?:可选|可不放|可省略|可加可不加|选用|optional)$/i;
const CJK = /[㐀-鿿豈-﫿]/;
const PAREN = /[（(]([^（）()]*)[）)]/g;
// 一行里的几样：「、」「，」「；」「｜」；有汉字的行英文逗号也算，「柠檬汁 15ml / 蜂蜜 10g」的斜杠后面是汉字时也算（「250ml / 1杯」是同一样的两种写法，不拆）
const SPLIT_CJK = /[、，；;,｜|]|\s+[/／]\s*(?=[㐀-鿿豈-﫿])/;
const SPLIT_LATIN = /[、，；;｜|]/;
// 空格连着的几样（「五花肉500g 冰糖20g」）：左边以数量结尾、右边是汉字开头才拆；「约」「各」这种开头的是左边那样的补充
const JOIN_NEXT = /^(?:约|大约|共|各|每|左右)/;
// 连着写的「鸡翅8个约400g」：「约…」也是补充；「牛奶 250ml / 1杯」斜杠后面是同一样的另一种写法
const APPROX = /(?:大约|约)\s*\d|\s[/／]\s*\d/;
const trimPunct = (/** @type {string} */ s) => s.replace(/^[\s。.!！~～]+|[\s。.!！~～]+$/g, '');
const asRecipe = { kind: 'grocery', recipe: true };

/**
 * @typedef {{ name: string, qty: number | null, unit: string, note: string, optional: boolean }} ParsedIng
 * qty：null = 没写数量（「适量」「少许」在 note 里）；unit 是原文的写法；optional：写了「可选」「optional」
 */

/**
 * 一段（一样食材）→ ParsedIng；什么也没有 → null。each：名字结尾是「各」（「生抽、老抽各1勺」「葱、姜各适量」）；
 * vague：数量是「适量」这种时的原话（没有数量才有）
 * @param {string} seg @param {boolean} cjkLine
 */
function parseSegment(seg, cjkLine) {
  let s = trimPunct(seg.replace(HEAD, ''));
  if (!s || s.startsWith('#') || !/[\p{L}\p{N}]/u.test(s)) return null;      // 话题标签、只有标点 / 表情的
  const notes = [];
  let optional = false;
  // 括号里的是补充：「五花肉 500g（带皮）」「生抽2勺(约30ml)」；「（可选）」是可选
  s = s.replace(PAREN, (m, inner) => {
    const x = inner.trim();
    if (OPTIONAL.test(x)) optional = true; else if (x) notes.push(x);
    return ' ';
  }).replace(/\s+/g, ' ').trim();
  // 英文的逗号后面多半是怎么处理（「1 onion, diced」）：当备注
  if (!cjkLine && s.includes(',')) { const i = s.indexOf(','); notes.push(s.slice(i + 1).trim()); s = s.slice(0, i).trim(); }
  // 「鸡翅8个约400g」「牛奶 250ml / 1杯」：左边已经是数量 + 单位，「约400g」「1杯」进备注（不然认成 400 g、名字是「鸡翅8个约」）
  const ax = APPROX.exec(s);
  if (ax && ax.index > 0) {
    const left = s.slice(0, ax.index).trim(), lp = parseQuickAdd(left, asRecipe);
    if (lp.qty != null && lp.name !== left) { notes.push(s.slice(ax.index).replace(/^\s*[/／]\s*/, '').trim()); s = left; }
  }
  let vague = '';
  let m = VAGUE_END.exec(s);
  if (m && m[1].trim()) { vague = m[2]; s = m[1]; }
  else if ((m = VAGUE_START.exec(s))) { vague = m[1]; s = m[2]; }
  if (vague) s = s.replace(/[\s:：]+$/, '');                                   // 「盐：适量」的冒号不是名字
  s = trimPunct(s);
  if (!s) return null;
  const p = parseQuickAdd(s, asRecipe);
  let name = p.name, each = false;
  if ((p.qty != null || vague) && /.各$/.test(name)) { name = name.slice(0, -1).replace(/[\s:：]+$/, ''); each = true; }
  if (!name) return null;
  return { name, qty: p.qty, unit: p.unit, note: [vague, ...notes].filter(Boolean).join(' '), optional, each, vague: p.qty == null ? vague : '' };
}

/**
 * 一行汉字的里面再按空格拆（左边以数量 / 「适量」结尾、右边是汉字开头才拆）：「五花肉500g 冰糖20g」→ 两样；「五花肉 500g」还是一样；
 * 「鸡蛋 3 个」「五花肉 500 克」的单位也是汉字开头，但它是左边那个数量的单位，不是下一样
 * @param {string} seg
 */
function splitSpaces(seg) {
  const toks = seg.split(/\s+/).filter(Boolean);
  const out = [];
  let cur = '';
  for (const tok of toks) {
    if (!cur) { cur = tok; continue; }
    const p = parseQuickAdd(cur, asRecipe);
    const hasQty = p.qty != null && p.name !== cur;
    const endsQty = hasQty || VAGUE_END.test(cur);
    if (hasQty && !p.unit && isRecipeUnit(tok.replace(PAREN, ''))) cur += ' ' + tok;
    // 「猪蹄 2只 约1kg」：后面的「约1kg」是补充，放进括号（parseSegment 当备注），不然数量会认成 1 kg
    else if (endsQty && JOIN_NEXT.test(tok)) cur += '（' + tok + '）';
    else if (endsQty && CJK.test(tok[0])) { out.push(cur); cur = tok; }
    else cur += ' ' + tok;
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * 粘贴的一整段食材 → 一行一样。表情先换成空格；按换行拆，一行里再按「、」「，」「；」「｜」拆（有汉字的行英文逗号、后面是汉字的「 / 」也算；
 * 英文的行逗号后面当备注），有汉字的行里「五花肉500g 冰糖20g」这样空格隔开的几样也拆开；去掉开头的「食材：」「主料」「【调料】」、
 * 序号（「1.」「1、」「①」「-」「•」）；每段用 parseQuickAdd（食材清单的规则，多认食谱的单位：勺、两、cup……）拆出数量和单位；
 * 「适量」「少许」「若干」「一点」不算数量，写进备注；括号里的、连着写的「约400g」写进备注（「可选」是可选）。
 * 「葱、姜、蒜 适量」「生抽、老抽各1勺」：写了「适量」/「各…」的那一段，也给紧挨在它前面、什么也没写的几段（往前到写了数量或备注的就停）。
 * 到了「做法」「步骤」那一行就停。拆不出数量就整段当名字（不猜）；空的、只有标点和表情的、#话题 扔掉
 * @param {unknown} text
 * @returns {ParsedIng[]}
 */
export function parseIngredients(text) {
  /** @type {ParsedIng[]} */
  const out = [];
  for (const raw of str(text).split(/\r?\n/)) {
    let line = raw.replace(PICTO, ' ').trim();
    if (STOP.test(stripBullets(line))) break;
    for (let i = 0; i < 3; i++) line = line.replace(BULLET, '').replace(HEAD, '');
    if (!line) continue;
    const cjk = CJK.test(line);
    const segs = line.split(cjk ? SPLIT_CJK : SPLIT_LATIN).flatMap(x => (cjk ? splitSpaces(x.trim()) : [x.trim()]));
    /** @type {any[]} */
    const got = segs.map(x => parseSegment(x.replace(BULLET, ''), cjk)).filter(Boolean);
    // 往前给：「生抽、老抽各1勺，蚝油1勺，盐少许」的生抽是 1 勺（不是后面盐的「少许」），「葱、姜、蒜 适量，盐 1小勺」的葱、姜是适量
    got.forEach((g, i) => {
      const share = g.each && g.qty != null;
      if (!share && !g.vague) return;
      for (let j = i - 1; j >= 0 && got[j].qty == null && !got[j].note; j--) {
        if (share) { got[j].qty = g.qty; got[j].unit = g.unit; } else got[j].note = g.vague;
      }
    });
    for (const g of got) out.push({ name: g.name, qty: g.qty, unit: g.unit, note: g.note, optional: g.optional });
    if (out.length >= 200) break;
  }
  return out.slice(0, 200);
}

// ---------- 按人数换算 ----------
/**
 * 用量按人数换算：qty × servings / recipe.servings，四舍五入到两位小数（太小的至少 0.01）；qty 是 null 的、食谱没写人数的、servings 不对的原样。
 * 换算出来的可以超过 9999（那是输入框的上限：2000 ml 水 2 人份 → 10 人份就是 10000 ml），只在 NEED_MAX 封顶（防写坏的数据）
 * @param {{ servings: number | null, ings: Ingredient[] }} recipe @param {unknown} servings
 * @returns {Ingredient[]}
 */
export function scaleIngredients(recipe, servings) {
  const base = recipe && recipe.servings;
  const want = typeof servings === 'number' && Number.isFinite(servings) && servings > 0 ? servings : null;
  const f = base && base > 0 && want ? want / base : 1;
  return ((recipe && recipe.ings) || []).map(g => ({ ...g, qty: g.qty == null ? null : f === 1 ? g.qty : Math.min(NEED_MAX, Math.max(0.01, Math.round(g.qty * f * 100) / 100)) }));
}

// ---------- 搜索、联想 ----------
/** @param {Intl.Collator} collator */
const byRecipeName = (collator) => (/** @type {Recipe} */ a, /** @type {Recipe} */ b) => collator.compare(a.name.trim(), b.name.trim()) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * 「食谱」页的搜索：名字和食材都搜，normName 折过再比（简繁、大小写、全角半角）。几个词（空格隔开）每个都要出现在名字或某一样食材里。
 * 返回 [{ recipe, ings：命中的食材名（原文，名字里没命中时页面写「用到：…」）}]，按名字排（collator）；空的搜索词 → 全部。
 * nameFirst（计划里选一道菜）：名字开头就是它的在最前，再是名字里有的，只是食材里有的在最后（各自还按名字排）——
 * 搜「鸡」回车选第一道，要的是鸡胸肉沙拉，不是只因为用到鸡蛋排在前面的番茄炒蛋
 * @param {State} state @param {unknown} query @param {Intl.Collator} [collator] @param {{ nameFirst?: boolean }} [opts]
 * @returns {{ recipe: Recipe, ings: string[] }[]}
 */
export function searchRecipes(state, query, collator = collatorFor('zh-Hans'), { nameFirst = false } = {}) {
  const terms = searchTerms(query);
  const all = /** @type {Recipe[]} */ (live(state, 'recipes')).sort(byRecipeName(collator));
  if (!terms.length) return all.map(recipe => ({ recipe, ings: [] }));
  const out = [];
  for (const recipe of all) {
    const name = normName(recipe.name), ings = recipe.ings.map(g => normName(g.name));
    if (!terms.every(w => name.includes(w) || ings.some(x => x.includes(w)))) continue;
    const rank = !terms.every(w => name.includes(w)) ? 2 : name.startsWith(terms.join(' ')) || name.startsWith(terms[0]) ? 0 : 1;
    out.push({ recipe, ings: recipe.ings.filter((g, i) => terms.some(w => ings[i].includes(w))).map(g => g.name), rank });
  }
  // sort 是稳定的：同一档里还是按名字
  if (nameFirst) out.sort((a, b) => a.rank - b.rank);
  return out.map(({ recipe, ings }) => ({ recipe, ings }));
}

/**
 * 用到这样食材的食谱（快速添加时联想「用到它的食谱」）：食谱里有一样的 normName 和它一样，或者包含它（它至少两个字：「肉」不联想「五花肉」）。
 * 没删除的，按名字排
 * @param {State} state @param {unknown} name @param {Intl.Collator} [collator]
 * @returns {Recipe[]}
 */
export function recipesUsing(state, name, collator = collatorFor('zh-Hans')) {
  const key = normName(name);
  if (!key) return [];
  const long = [...key].length >= 2;
  return /** @type {Recipe[]} */ (live(state, 'recipes'))
    .filter(r => r.ings.some(g => { const k = normName(g.name); return k === key || (long && k.includes(key)); }))
    .sort(byRecipeName(collator));
}

// ---------- 新建、改、删 ----------
/**
 * @typedef {{ key?: unknown, name?: unknown, qty?: unknown, unit?: unknown, note?: unknown, optional?: unknown }} IngInput
 * @typedef {{ name?: unknown, servings?: unknown, steps?: unknown, source?: unknown, note?: unknown, ings?: IngInput[] }} RecipeInput
 * 编辑页交来的（数量、几人份可以是输入框里的字）
 */
const blankRow = (/** @type {IngInput} */ g) => !str(g.name).trim() && !str(g.qty).trim() && !str(g.unit).trim() && !str(g.note).trim();

/**
 * 检查编辑页交来的食谱：名字不能空；几人份空着（没写）或 0 < n ≤ 99；食材一行一样：全空的行扔掉，有别的没名字的报错，
 * 数量空着（适量）或 0 < q ≤ 9999。返回整理好的（clean）或错误（文案的键；食材的错误按交来的第几行：errors.ings[i]）
 * @param {RecipeInput} input
 * @returns {{ ok: boolean, clean: { name: string, servings: number | null, steps: string, source: string, note: string, ings: IngInput[] },
 *   errors: { name?: string, servings?: string, ings?: Record<number, string> } }}
 */
export function validateRecipe(input) {
  /** @type {{ name?: string, servings?: string, ings?: Record<number, string> }} */
  const errors = {};
  const name = str(input.name).trim();
  if (!name) errors.name = 'rcp.err.name';
  const sv = readQty(input.servings);
  if (sv !== null && !(Number.isFinite(sv) && sv > 0 && sv <= SERVINGS_MAX)) errors.servings = 'rcp.err.servings';
  /** @type {Record<number, string>} */
  const ingErr = {};
  const ings = [];
  (Array.isArray(input.ings) ? input.ings : []).forEach((g, i) => {
    if (!isObj(g) || blankRow(g)) return;
    const q = readQty(g.qty);
    if (!str(g.name).trim()) ingErr[i] = 'rcp.err.ingName';
    else if (q !== null && !(Number.isFinite(q) && q > 0 && q <= QTY_MAX)) ingErr[i] = 'rcp.err.ingQty';
    else ings.push({ key: g.key, name: str(g.name).trim(), qty: q, unit: str(g.unit).trim(), note: str(g.note).trim(), optional: g.optional === true });
  });
  if (Object.keys(ingErr).length) errors.ings = ingErr;
  const clean = { name, servings: sv !== null && Number.isFinite(sv) ? sv : null, steps: str(input.steps), source: str(input.source).trim(), note: str(input.note), ings };
  return { ok: !Object.keys(errors).length, clean, errors };
}

/**
 * 保存食谱（编辑页的「保存」）：id 是 null 就新建（newId('r_')）。食材的 key 照留（排顺序、改名都不变），新的行给一个新的；
 * 原来那一行上不认识的字段（新版加的）照样留着。有错什么也不改，返回错误。这道食谱已经删了 → errors.recipe
 * @param {State} state @param {string | null} id @param {RecipeInput} input @param {number} [now]
 * @returns {{ ok: true, id: string, recipe: Recipe } | { ok: false, errors: Record<string, any> }}
 */
export function saveRecipe(state, id, input, now = Date.now()) {
  const prev = id ? liveRecipe(state, id) : null;
  if (id && !prev) return { ok: false, errors: { recipe: 'rcp.err.gone' } };
  const v = validateRecipe(input);
  if (!v.ok) return { ok: false, errors: v.errors };
  /** @type {Map<string, Ingredient>} */
  const old = new Map((prev ? prev.ings : []).map(g => [g.key, g]));
  const seen = new Set();
  const ings = v.clean.ings.map(g => {
    let key = typeof g.key === 'string' && safeKey(g.key) && !seen.has(g.key) ? g.key : '';
    if (!key) do key = newId('g_'); while (seen.has(key));
    seen.add(key);
    return { ...(old.get(key) || {}), ...g, key };
  });
  const rid = prev ? prev.id : newId('r_');
  const rec = prev ? { ...prev, ...v.clean, ings } : { id: rid, createdAt: now, ...v.clean, ings };
  const recipe = /** @type {Recipe} */ (writeRecord(state, 'recipes', rec, now));
  return { ok: true, id: rid, recipe };
}

/** 删除食谱：软删除（进最近删除，能恢复；加进清单的东西不动）。不在了 → null @param {State} state @param {string} id @param {number} [now] */
export function deleteRecipe(state, id, now = Date.now()) {
  const r = liveRecipe(state, id);
  if (!r) return null;
  return (col(state)[id] = deletedRecord(r, now));
}

// ---------- 加到清单 ----------
/** 能加食材的清单：首页上的食材清单（没删除、没归档，首页的顺序） @param {State} state @returns {List[]} */
export const groceryLists = (state) => homeLists(state).filter(l => l.kind === 'grocery');
/** 默认加到哪张：给了的（快速添加时那张清单）→ 预置的「食材」→ 第一张食材清单；一张都没有 → null @param {State} state @param {string | null} [prefer] */
export function defaultTarget(state, prefer = null) {
  const ls = groceryLists(state);
  return (ls.find(l => l.id === prefer) || ls.find(l => l.id === 'l_groceries') || ls[0] || null)?.id ?? null;
}

/**
 * @typedef {Ingredient & { staple: boolean, have: Item | null, haveLabel: string, added: boolean, addedLabel: string, checked: boolean }} RecipeLine
 * staple：常备品；have：这张清单上已经有的（要买、以后再说）；haveLabel：它现在显示的数量（「1 个 + 200 g」，没写数量是 ''）；
 * added：have 上已经有这道食谱加过的那一份（needs 里 recipeId 是它）；addedLabel：这道食谱加过的一共多少（「600 g」）；
 * checked：默认勾不勾（常备品、可选的、这道菜已经加过的不勾）
 */
/**
 * 「加到清单」面板里的每一行：按人数换算过的用量（scaleIngredients）、是不是常备品、清单上是不是已经有了、是不是这道菜已经加过。没名字的行不列。
 * 这道菜已经加过的默认不勾：再打开面板多半是来看看加了什么，一下点「加到清单」就把用量翻倍了；真要再做一次，勾上就是再加一份
 * @param {State} state @param {Recipe} recipe @param {{ servings?: number | null, listId?: string | null }} [opts]
 * @returns {RecipeLine[]}
 */
export function recipeLines(state, recipe, { servings = null, listId = null } = {}) {
  const items = isObj(state.data.items) ? state.data.items : {};
  const list = listId ? liveList(state, listId) : null;
  return scaleIngredients(recipe, servings ?? recipe.servings).filter(g => g.name.trim()).map(g => {
    const staple = isStaple(state, g.name);
    const it = list ? own(items, itemId(state, list.id, g.name)) : null;
    const have = it && !it.deleted && (it.status === 'need' || it.status === 'later') ? it : null;
    const mine = have ? needsOf(have).filter(([, n]) => n.recipeId === recipe.id) : [];
    const addedLabel = mine.length ? totalLabel({ qty: null, unit: '', needs: Object.fromEntries(mine) }) : '';
    return { ...g, staple, have, haveLabel: have ? totalLabel(have) : '', added: mine.length > 0, addedLabel, checked: !staple && !g.optional && !mine.length };
  });
}

/**
 * 「加到清单」的确认：先记下这次标 / 取消的常备品（staples：名字 → 是不是），再把勾上的（keys）按人数换算后加进清单（addNeeds，
 * 来源 source 由页面给 'a:<随机>'：每加一次是新的一份，label 抄下食谱名字）。在一次 ctx.mutate 里，一起撤销。
 * 返回 addNeeds 的结果（{ added, updated, ids }）；清单不在 → null
 * @param {State} state @param {Recipe} recipe
 * @param {{ listId: string, servings?: number | null, keys: string[], staples?: Record<string, boolean>, source: string }} opts @param {number} [now]
 */
export function addRecipeToList(state, recipe, { listId, servings = null, keys, staples = {}, source }, now = Date.now()) {
  if (!liveList(state, listId)) return null;
  for (const [name, on] of Object.entries(staples)) setStaple(state, name, on, now);
  const pick = new Set(keys);
  const lines = recipeLines(state, recipe, { servings, listId }).filter(l => pick.has(l.key)).map(l => ({ name: l.name, qty: l.qty, unit: l.unit }));
  if (!lines.length) return { added: 0, updated: 0, ids: [] };
  return addNeeds(state, listId, lines, source, { label: recipe.name.trim(), recipeId: recipe.id }, now);
}
