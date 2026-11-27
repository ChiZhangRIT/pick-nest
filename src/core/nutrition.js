// @ts-check
// 内置营养表（src/data/nutrition.js，USDA FoodData Central SR Legacy）的查法：食谱里写的食材名字 → 表里的哪一样（findFood），
// 「3 个」「2 勺」「半斤」→ 多少克（gramsFor）。都是纯函数，不看 state；按食谱估算每人份是第 15 步的 core/estimate.js（estimateRecipe），用的就是这两样。
// 第 15 步还加了：自己的说法按哪个名字记（nameHead）、「一个多重」记在哪个单位上（unitKey、isWeightUnit）、「指定成表里的哪一样」的搜索（searchTable）。
// 估出来的数一律当「约」：同一样东西的品种、做法、牌子差得不少，宁可认不出（列出来让人指定）也不要认错。
import { NUTRITION } from '../data/nutrition.js';
import { normName } from './store.js';
import { own, str } from './util.js';

/** @typedef {import('../data/nutrition.js').NutritionFood} NutritionFood */
/** 能换算克数的一样：表里的一样，或者以后 foods 里自己填的（同样的 grams / density；volume: false = 按体积量没有意义） @typedef {{ grams?: Record<string, number> | null, density?: number | null, volume?: boolean }} Weighable */

// ---------- 认名字 ----------
// 名字先按 normName 折（简繁、大小写、全角、空白），拉丁字母的附加符号也去掉（jalapeño → jalapeno）；再只看第一个逗号、顿号、括号前面那段
// （后面是说明：「ham, pork」是火腿、「鸡蛋，牛奶」是鸡蛋；前面那段什么也认不出时才看整段：「(optional) cilantro」）：
//   1. 整个是表里的一个名字；英文去掉前后的切法、说明再比一次（「melted butter」「pepper to taste」）
//   2. 名字里包含的最长的那个（中文至少两个字，英文按整个词、复数也算）；一样长取靠后的。中文、英文都是后面的词说了算：
//      「鸡蛋面」是面不是蛋、「番茄酱」是酱，所以包含的那个名字后面只能是切法（丝、片、丁、末……「五花肉片」「土豆泥」）、
//      英文还可以是 chopped、cloves 这种词；后面还跟着别的字的不算（「鸡蛋面」不会认成鸡蛋）。
//      最长的那个前面紧挨着说大小、做法的词（小、干、腌、baby、dried、smoked……，PREFIX_WORDS）时整个认不出：小番茄一个 17 g 不是 123 g，
//      晒干的番茄、dried apricots 每 100 g 是鲜的好几倍
//   3. 一个字的名字（葱、蒜、姜、盐）只认整个名字，或者开头是它、后面只有切法（葱花、蒜末、姜丝）：「油条」不是油
// 看着包含表里的名字、其实是别的东西的（鱼豆腐、水淀粉，LOOKALIKES）当成表里「有这个名字、但没有这一样」：比包含的那个长，所以认不出
const CJK = /[㐀-鿿豈-﫿]/;
// 切法、形状：「肉」也算（牛腩肉、虾肉、蛤蜊肉还是那一样）；不收「条」（油条、薯条是别的东西）、「汁」（柠檬汁和柠檬差得远）
const CUT_CHARS = '丝片丁块末蓉茸碎泥段粒花肉儿';
const SEPARATORS = ',，、;；(（/:：';
// 英文名字后面可以跟着的词：切法、部位、「to taste」「for garnish」
const TAIL_WORDS = new Set(['chopped', 'minced', 'diced', 'sliced', 'cubed', 'grated', 'shredded', 'crushed', 'julienned', 'peeled', 'halved',
  'quartered', 'trimmed', 'rinsed', 'drained', 'softened', 'melted', 'beaten', 'fresh', 'leaf', 'leaves', 'sprig', 'sprigs', 'stalk', 'stalks',
  'rib', 'ribs', 'floret', 'florets', 'clove', 'cloves', 'slice', 'slices', 'piece', 'pieces', 'chunk', 'chunks', 'cube', 'cubes', 'strip',
  'strips', 'wedge', 'wedges', 'half', 'halves', 'to', 'taste', 'for', 'garnish', 'serving', 'frying', 'optional', 'divided', 'sifted', 'warmed']);
// 比整个名字时，前后可以去掉的英文词：上面那些，加上冷的、温的、现磨的（「cold butter」「freshly ground pepper」；不收 hot：hot pepper 是辣椒）
const BARE_WORDS = new Set([...TAIL_WORDS, 'cold', 'warm', 'freshly', 'ground']);
// 太笼统的英文名字只认整个名字（去掉前后的切法、说明以后）：「oat milk」不是牛奶、「feta cheese」不是切达、「almond flour」不是面粉、
// 「jalapeno pepper」不是黑胡椒、「fried rice」不是生米、「tuna steak」不是牛排、「turkey bacon」「chicken sausage」不是猪肉做的、
// 「apple butter」不是黄油、「vegetable stock」不是鸡汤、「banana chips」不是薯片、「tonic water」「sugar water」「italian ice」不是 0 千卡的水
// （中文的单字名字本来就只认整个的；水的「hot water」「ice water」「ice cubes」是表里的整个名字，照样认）
export const EXACT_ONLY = new Set(['pepper', 'milk', 'cheese', 'flour', 'rice', 'steak', 'sausage', 'bacon', 'ham', 'butter', 'stock', 'broth', 'chips', 'water', 'ice']);
// 包含的名字前面紧挨着这些，就是另一种东西：小的品种（一个的重量差好几倍：小番茄、小土豆、baby corn、pearl onions），
// 干的、腌的、熏的、卤的（每 100 g 差好几倍：干豆腐、干鱿鱼、dried apricots、smoked salmon），泡发、水发的（干货泡过水：「水发腐竹」
// 每 100 g 是干腐竹的几分之一，不能按干的算）。表里本来就有的写法（小葱、干香菇、泡发木耳）是整个名字，不受影响
export const PREFIX_WORDS = {
  zh: ['小', '迷你', '干', '腌', '熏', '酱', '卤', '泡发', '水发'],
  en: new Set(['baby', 'mini', 'petite', 'pearl', 'cocktail', 'dried', 'dehydrated', 'candied', 'crystallized', 'pickled', 'smoked']),
};
// 看着包含表里的名字、其实是别的东西（营养差得多），认不出：鱼豆腐是鱼糜做的、杏仁豆腐是甜点、鸡蛋豆腐是蛋做的；水淀粉大半是水；
// 贝贝南瓜、板栗南瓜（日本南瓜）每 100 g 是普通南瓜的两三倍；樱桃番茄、cherry / grape tomatoes 一个十几克（「小」开头的 PREFIX_WORDS 管）；
// salt pork 是腌过的肥膘（不是猪肉）
export const LOOKALIKES = ['鱼豆腐', '杏仁豆腐', '鸡蛋豆腐', '日本豆腐', '玉子豆腐', '千叶豆腐', '臭豆腐', '水淀粉', '樱桃番茄', '贝贝南瓜', '板栗南瓜',
  '日本南瓜', 'cherry tomato', 'grape tomato', 'salt pork'];

/** 比较用的写法：normName，再把拉丁字母的附加符号去掉（é → e、ñ → n）。汉字不动 @param {unknown} s */
const foldName = s => normName(s).replace(/[\u00c0-\u024f]/g, ch => ch.normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
const esc = (/** @type {string} */ s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SEPARATOR_RE = new RegExp('[' + esc(SEPARATORS) + ']');
/** 英文的名字按整个词找，复数也算（tomato → tomatoes、berry → berries） @param {string} k */
const wordRe = k => new RegExp('(?:^|[^a-z0-9])(' + (k.endsWith('y') ? esc(k.slice(0, -1)) + '(?:y|ies)' : esc(k) + '(?:s|es)?') + ')(?=$|[^a-z0-9])', 'g');

/** food 是 null 的是 LOOKALIKES（有这个名字、表里没有这一样） @typedef {{ key: string, food: NutritionFood | null, re: RegExp | null }} Alias */
/** @typedef {{ exact: Map<string, NutritionFood | null>, inside: Alias[], single: Map<string, NutritionFood> }} Index */
/** 每张表算一次的索引（表是常量，测试会传编出来的小表） @type {WeakMap<readonly NutritionFood[], Index>} */
const INDEX = new WeakMap();
/** @param {readonly NutritionFood[]} table */
function indexOf(table) {
  let idx = INDEX.get(table);
  if (idx) return idx;
  /** @type {Index} */
  const made = { exact: new Map(), inside: [], single: new Map() };
  /** @param {string} name @param {NutritionFood | null} food */
  const add = (name, food) => {
    const key = foldName(name);
    if (!key || made.exact.has(key)) return;   // 同一个名字给了两样的话前面的为准（测试保证没有）
    made.exact.set(key, food);
    if (EXACT_ONLY.has(key)) return;
    if (!CJK.test(key)) made.inside.push({ key, food, re: wordRe(key) });
    else if ([...key].length >= 2) made.inside.push({ key, food, re: null });
    else if (food) made.single.set(key, food);
  };
  for (const food of table) for (const name of [...food.zh, ...food.en]) add(name, food);
  for (const name of LOOKALIKES) add(name, null);
  INDEX.set(table, made);
  return made;
}

/** 包含的名字后面剩下的那段能不能不管（切法、说明） @param {string} rest @param {boolean} cjk */
function tailOk(rest, cjk) {
  if (cjk) {
    let i = 0;
    while (i < rest.length && CUT_CHARS.includes(rest[i])) i++;
    const after = rest.slice(i).trimStart();
    return !after || SEPARATORS.includes(after[0]);
  }
  const s = rest.trim();
  if (!s || SEPARATORS.includes(s[0])) return true;
  const head = s.split(SEPARATOR_RE)[0];
  return head.split(/[\s-]+/).filter(Boolean).every(w => TAIL_WORDS.has(w));
}

/** 包含的名字前面紧挨着的是不是说大小、做法的词（PREFIX_WORDS） @param {string} before @param {boolean} cjk */
function prefixed(before, cjk) {
  if (cjk) return PREFIX_WORDS.zh.some(p => before.endsWith(p));
  const words = before.split(/[^a-z]+/).filter(Boolean);
  return words.length > 0 && PREFIX_WORDS.en.has(words[words.length - 1]);
}

/**
 * 名字里最后一次出现、后面剩下的能不管的位置（end：结束的下标），和它前面是不是紧挨着 PREFIX_WORDS（prefixed）；没有 → null
 * @param {string} name @param {Alias} a @returns {{ end: number, prefixed: boolean } | null}
 */
function endAt(name, a) {
  if (!a.re) {
    const i = name.lastIndexOf(a.key);
    for (let j = i; j >= 0; j = j ? name.lastIndexOf(a.key, j - 1) : -1) {
      if (tailOk(name.slice(j + a.key.length), true)) return { end: j + a.key.length, prefixed: prefixed(name.slice(0, j), true) };
    }
    return null;
  }
  /** @type {{ end: number, prefixed: boolean } | null} */
  let found = null;
  a.re.lastIndex = 0;
  for (let m = a.re.exec(name); m; m = a.re.exec(name)) {
    const e = m.index + m[0].length;
    if (tailOk(name.slice(e), false)) found = { end: e, prefixed: prefixed(name.slice(0, e - m[1].length), false) };
  }
  return found;
}

/** 英文名字去掉前后的切法、说明（「melted butter」→ butter、「pepper to taste」→ pepper）；中文原样 @param {string} s */
function bare(s) {
  if (CJK.test(s)) return s;
  const words = s.split(' ');
  let i = 0, j = words.length;
  while (i < j && BARE_WORDS.has(words[i])) i++;
  while (j > i && BARE_WORDS.has(words[j - 1])) j--;
  return words.slice(i, j).join(' ');
}

/**
 * 一段名字在索引里认成什么：表里的一样；LOOKALIKES（认得、表里没有）→ null；什么也没认出 → undefined
 * @param {string} s @param {Index} idx @returns {NutritionFood | null | undefined}
 */
function matchIn(s, idx) {
  if (idx.exact.has(s)) return idx.exact.get(s);
  const b = bare(s);
  if (b && b !== s && idx.exact.has(b)) return idx.exact.get(b);
  // 最长的（一样长取靠后的）那个说了算：它前面是「小」「干」这些（PREFIX_WORDS）就整个认不出，不再退到它里面更短的名字
  // （「熏鱼豆腐」是熏过的鱼豆腐，不能因为「鱼豆腐」前面有「熏」就退成「豆腐」）
  /** @type {Alias | null} */
  let best = null;
  let bestLen = 0, bestEnd = -1, bestPrefixed = false;
  for (const a of idx.inside) {
    if (a.key.length < bestLen) continue;
    const at = endAt(s, a);
    if (!at) continue;
    // 一样长的：前面没有 PREFIX_WORDS 的优先（「小葱段」是小葱 + 段，不是「小」+ 葱段），再取靠后的
    const better = a.key.length > bestLen || (bestPrefixed && !at.prefixed) || (bestPrefixed === at.prefixed && at.end > bestEnd);
    if (better) { best = a; bestLen = a.key.length; bestEnd = at.end; bestPrefixed = at.prefixed; }
  }
  if (best) return bestPrefixed ? null : best.food;
  const first = [...s][0];
  const one = idx.single.get(first);
  return one && s.length > first.length && tailOk(s.slice(first.length), true) ? one : undefined;
}

/**
 * 食材名字 → 内置表里的一样；认不出 → null（第 15 步列出来，让人「指定成表里的哪一样」或者自己填）
 * @param {unknown} name
 * @param {readonly NutritionFood[]} [table] 默认是内置的表（测试传编出来的）
 * @returns {NutritionFood | null}
 */
export function findFood(name, table = NUTRITION) {
  const key = foldName(name);
  if (!key) return null;
  const idx = indexOf(table);
  const cut = key.search(SEPARATOR_RE);
  if (cut > 0) {
    const head = key.slice(0, cut).trim();
    const got = head ? matchIn(head, idx) : undefined;
    if (got !== undefined) return got;
  }
  return matchIn(key, idx) ?? null;
}
/**
 * 内置表里 id 是这个的一样；没有 → null。foods 的 ref 存的是写成字符串的 id（store.js 的 normalizeFood 只留字符串），所以数字、数字的字符串都认
 * @param {unknown} id @param {readonly NutritionFood[]} [table]
 */
export function foodById(id, table = NUTRITION) {
  const n = typeof id === 'string' && /^[1-9]\d*$/.test(id) ? Number(id) : id;
  return typeof n === 'number' ? table.find(f => f.id === n) || null : null;
}

/**
 * 自己的说法（foods 里 kind 'ingredient' 的那一条）按哪个名字记：和 findFood 一样只看第一个逗号、括号前面那段（原样的写法、去掉前后空白）——
 * 「鱼豆腐（切块）」「鱼豆腐, 切块」和「鱼豆腐」是同一样，指定一次所有食谱都认；前面那段是空的（「(可选) 香菜」）用整个名字
 * @param {unknown} name @returns {string}
 */
export function nameHead(name) {
  const s = str(name).trim();
  const cut = s.search(SEPARATOR_RE);
  if (cut > 0) { const head = s.slice(0, cut).trim(); if (normName(head)) return head; }
  return s;
}

// 繁体（台湾）界面上，表里的一样对不上写的名字时先用台湾的说法：表里第一个名字多是大陆的说法，台湾听着不对，
// 甚至是别的东西（「土豆」在台湾是花生）。写的是表里的写法（简体），显示时再 toTraditional；测试查每一个都在表里
export const TW_NAMES = new Set(['马铃薯', '酱油', '优格', '起司', '鲑鱼', '鲔鱼', '高丽菜', '青花菜', '花椰菜', '凤梨', '地瓜', '奇异果', '芭乐', '柳橙',
  '猪绞肉', '美乃滋', '鲜奶油', '太白粉']);

/**
 * 表里这一样在界面上叫什么（估算的明细、「指定成…」的搜索）：食材写的名字（只看 nameHead 那段；搜索时是对上的那个名字）对上的别名优先——
 * 写「马铃薯」就是「马铃薯」，不写成这一样的第一个名字「土豆」；「鲅鱼」不写成同一条的「带鱼」。整个一样的 > 名字里包含的最长的那个；
 * 都对不上（指定成的、换了语言写的）用第一个名字，tw 时先用台湾的说法（TW_NAMES）。en 用英文名。返回表里的写法（简体、小写）
 * @param {NutritionFood} food @param {unknown} [name] @param {{ en?: boolean, tw?: boolean }} [opts]
 */
export function foodAlias(food, name = '', { en = false, tw = false } = {}) {
  const list = en && food.en.length ? food.en : food.zh;
  const key = foldName(nameHead(name)), b = bare(key);
  let best = '', bestLen = 0;
  for (const a of list) {
    const k = foldName(a);
    if (!k) continue;
    if (k === key || k === b) return a;
    const inside = CJK.test(k) ? key.includes(k) : wordRe(k).test(key);
    if (inside && k.length > bestLen) { best = a; bestLen = k.length; }
  }
  if (best) return best;
  return (tw && !en && list.find(a => TW_NAMES.has(a))) || list[0] || food.zh[0] || '';
}

/** 搜索用的每个名字（英文按整个词：搜「rice」不该出来「licorice」，名字「ice」也不该算在「rice」里） @type {WeakMap<readonly NutritionFood[], { food: NutritionFood, key: string, re: RegExp | null }[]>} */
const NAMES = new WeakMap();
/**
 * 「指定成表里的哪一样」的搜索：表里的名字（中文、英文，normName 折过，简繁都行）一样的最前，再是开头对上的、包含搜索词的（短的在前：更接近），
 * 最后是搜索词里包含的（「鱼豆腐」里有「豆腐」：长的在前）。每样只出一次。返回 [{ food, name：对上的那个名字 }]
 * @param {unknown} query @param {{ limit?: number }} [opts] @param {readonly NutritionFood[]} [table]
 * @returns {{ food: NutritionFood, name: string }[]}
 */
export function searchTable(query, { limit = 30 } = {}, table = NUTRITION) {
  const q = foldName(query);
  if (!q) return [];
  let names = NAMES.get(table);
  if (!names) {
    names = [];
    for (const food of table) for (const name of [...food.zh, ...food.en]) {
      const key = foldName(name);
      if (key) names.push({ food, key, re: CJK.test(key) ? null : new RegExp(wordRe(key).source) });
    }
    NAMES.set(table, names);
  }
  /** @type {Map<NutritionFood, { name: string, rank: number, len: number }>} */
  const best = new Map();
  for (const { food, key, re } of names) {
    const rank = key === q ? 0 : key.startsWith(q) ? 1 : key.includes(q) ? 2 : (re ? re.test(q) : [...key].length >= 2 && q.includes(key)) ? 3 : -1;
    if (rank < 0) continue;
    const len = rank === 3 ? -key.length : key.length;
    const b = best.get(food);
    if (!b || rank < b.rank || (rank === b.rank && len < b.len)) best.set(food, { name: key, rank, len });
  }
  return [...best].sort(([fa, a], [fb, b]) => a.rank - b.rank || a.len - b.len || fa.id - fb.id)
    .slice(0, Math.max(0, limit)).map(([food, b]) => ({ food, name: b.name }));
}

// ---------- 单位 → 克 ----------
/**
 * 通用的单位：重量的直接是克（g），体积的是毫升（ml），按这一样的密度换成克（不知道密度的按 1 g/ml，结果标成猜的）。
 * 「勺」「杯」这些按中国家里常说的：一勺（汤匙、大匙）15 ml、一小勺（茶匙、小匙）5 ml、一杯 240 ml、一碗 250 ml。
 * 键是 normName 以后的写法（繁体折成简体、小写）
 * @type {Record<string, { g?: number, ml?: number }>}
 */
export const GENERIC_UNITS = {
  g: { g: 1 }, gram: { g: 1 }, grams: { g: 1 }, 克: { g: 1 }, 公克: { g: 1 }, mg: { g: 0.001 },
  kg: { g: 1000 }, 公斤: { g: 1000 }, 千克: { g: 1000 },
  // 「斤」按大陆的 500 g：一个字看不出是哪里写的（繁体也折成同一个字）；台湾的一斤是 600 g，写「台斤」才按 600 g，「台两」37.5 g
  斤: { g: 500 }, 两: { g: 50 }, 台斤: { g: 600 }, 台两: { g: 37.5 },
  kilogram: { g: 1000 }, kilograms: { g: 1000 }, kilo: { g: 1000 }, kilos: { g: 1000 },
  oz: { g: 28.35 }, ounce: { g: 28.35 }, ounces: { g: 28.35 }, 盎司: { g: 28.35 },
  lb: { g: 453.6 }, lbs: { g: 453.6 }, pound: { g: 453.6 }, pounds: { g: 453.6 }, 磅: { g: 453.6 },
  ml: { ml: 1 }, 毫升: { ml: 1 }, cc: { ml: 1 }, l: { ml: 1000 }, 升: { ml: 1000 }, 公升: { ml: 1000 },
  milliliter: { ml: 1 }, milliliters: { ml: 1 }, millilitre: { ml: 1 }, millilitres: { ml: 1 },
  liter: { ml: 1000 }, liters: { ml: 1000 }, litre: { ml: 1000 }, litres: { ml: 1000 },
  'fl oz': { ml: 29.57 }, qt: { ml: 946.4 }, quart: { ml: 946.4 }, quarts: { ml: 946.4 }, pt: { ml: 473.2 }, pint: { ml: 473.2 }, pints: { ml: 473.2 },
  gal: { ml: 3785.4 }, gallon: { ml: 3785.4 }, gallons: { ml: 3785.4 },
  勺: { ml: 15 }, 汤匙: { ml: 15 }, 大勺: { ml: 15 }, 大匙: { ml: 15 }, 汤勺: { ml: 15 }, tbsp: { ml: 15 }, tablespoon: { ml: 15 }, tablespoons: { ml: 15 },
  小勺: { ml: 5 }, 茶匙: { ml: 5 }, 小匙: { ml: 5 }, tsp: { ml: 5 }, teaspoon: { ml: 5 }, teaspoons: { ml: 5 },
  杯: { ml: 240 }, cup: { ml: 240 }, cups: { ml: 240 },
  碗: { ml: 250 },
};

/**
 * 写的单位 → 去这一样的 grams 里找哪几个（按顺序，先找到的为准）。表里的单位只有这几个：杯 勺 小勺 片 瓣 根 块 把 张 朵 个 条 包。
 * 「一条黄瓜」是一根、「一颗鸡蛋」「一只鸡」「一棵白菜」是一个、「香菇 3 朵」没有「朵」时是 3 个；没写单位（「鸡蛋 3」）就是几个。
 * 只往「一样大或者更小」的退：「一块西瓜 / 冬瓜」是切下来的一块，不能退成「个」（一整个四五千克）；「一棵芹菜」是一整棵，不能退成「根」（一根 40 g）；
 * 「一朵花菜」是一小朵（表里的「朵」13 g），没有「朵」的花菜、西兰花不退成一整颗（花菜的「个」）
 * @type {Record<string, string[]>}
 */
const UNIT_KEYS = {
  '': ['个'], 个: ['个'], 只: ['个'], 颗: ['个'], 枚: ['个'], 粒: ['个'], 头: ['个'], 棵: ['个'], 朵: ['朵', '个'],
  根: ['根', '个'], 条: ['条', '根', '个'], 块: ['块'], 片: ['片'], 瓣: ['瓣'], 张: ['张', '片'], 把: ['把'], 包: ['包'], 袋: ['包'],
  勺: ['勺'], 汤匙: ['勺'], 大勺: ['勺'], 大匙: ['勺'], 汤勺: ['勺'], 小勺: ['小勺'], 茶匙: ['小勺'], 小匙: ['小勺'], 杯: ['杯'],
  piece: ['个'], pieces: ['个'], pc: ['个'], pcs: ['个'], each: ['个'], ea: ['个'], whole: ['个'], large: ['个'], medium: ['个'], small: ['个'],
  head: ['个'], heads: ['个'], slice: ['片'], slices: ['片'], leaf: ['片'], leaves: ['片'], clove: ['瓣'], cloves: ['瓣'],
  stalk: ['根'], stalks: ['根'], spear: ['根'], spears: ['根'], ear: ['根'], ears: ['根'], link: ['根'], links: ['根'], sheet: ['张'], sheets: ['张'],
  floret: ['朵'], florets: ['朵'], wedge: ['块'], wedges: ['块'], chunk: ['块'], chunks: ['块'],
  bunch: ['把'], bunches: ['把'], stick: ['条'], sticks: ['条'], package: ['包'], pack: ['包'], packs: ['包'], pkg: ['包'], bag: ['包'], bags: ['包'],
  tbsp: ['勺'], tablespoon: ['勺'], tablespoons: ['勺'], tsp: ['小勺'], teaspoon: ['小勺'], teaspoons: ['小勺'], cup: ['杯'], cups: ['杯'],
};

/** 单位的比较写法：normName，去掉结尾的点（tbsp.、oz.） @param {unknown} unit */
export const normUnit = unit => normName(unit).replace(/\.$/, '');
/**
 * 自己填的「一个多重」记在哪个单位上（foods 的 grams 的键）：和 gramsFor 找的第一个一样——没写单位、只、颗记在「个」上，clove 记在「瓣」上，
 * 认不出的（盒、罐）就是写的那个（gramsFor 认不出的单位也先找它自己）
 * @param {unknown} unit
 */
export function unitKey(unit) {
  const u = normUnit(unit), keys = own(UNIT_KEYS, u);
  return keys ? keys[0] : u;
}
/**
 * 「自己填」要不要问一{unit}多重：没写单位、个、根、勺、杯、认不出的（盒）要问；克、斤、毫升这种通用的不用（勺、杯虽然有通用的毫升数，
 * 不知道密度的按 1 g/ml 猜，自己知道一勺多重的照样能填）
 * @param {unknown} unit
 */
export function asksWeight(unit) {
  const u = normUnit(unit);
  return !!own(UNIT_KEYS, u) || !own(GENERIC_UNITS, u);
}
/** 是重量的单位（克、斤、oz……）：换算不用知道这一样一个多重 @param {unknown} unit */
export function isWeightUnit(unit) {
  const g = own(GENERIC_UNITS, normUnit(unit));
  return !!(g && g.g);
}

/**
 * @typedef {{ grams: number, reason: null, guess: boolean } | { grams: null, reason: 'qty' | 'unit' | 'weight', guess: false }} GramsResult
 * grams：多少克（一位小数）；guess：体积按 1 g/ml 猜的（这一样不知道密度）。换算不了时 grams 是 null，reason：
 *   'qty' 没写数量（适量、少许）、'weight' 认得这个单位但不知道这一样一个有多重（「香菜 2 根」）、'unit' 认不出的单位（盒、罐）
 */

/**
 * 几个什么单位的这一样 → 多少克。先看这一样自己的单位重量（表里的 grams：一个鸡蛋 50 g、一勺盐 18 g），再看通用的重量、体积单位
 * @param {Weighable | null | undefined} food
 * @param {unknown} qty
 * @param {unknown} unit
 * @returns {GramsResult}
 */
export function gramsFor(food, qty, unit) {
  const q = typeof qty === 'number' ? qty : NaN;
  if (!Number.isFinite(q) || q <= 0) return { grams: null, reason: 'qty', guess: false };
  const u = normUnit(unit);
  const g1 = (/** @type {number} */ x) => Math.round(x * 10) / 10;
  // 单位是用户写的字：「constructor」「__proto__」不能摸到原型上去，一律只看自己的键
  const keys = own(UNIT_KEYS, u);
  for (const k of keys || [u]) {
    const each = own(food && food.grams, k);
    if (typeof each === 'number' && each > 0) return { grams: g1(q * each), reason: null, guess: false };
  }
  const generic = own(GENERIC_UNITS, u);
  if (generic && generic.g) return { grams: g1(q * generic.g), reason: null, guess: false };
  if (generic && generic.ml) {
    // 干紫菜、海苔这种按体积量没有意义的（表里 volume: false）：一杯是多少克说不出来，按 1 g/ml 猜差好几倍
    if (food && food.volume === false) return { grams: null, reason: 'weight', guess: false };
    const d = food && typeof food.density === 'number' && food.density > 0 ? food.density : null;
    return { grams: g1(q * generic.ml * (d || 1)), reason: null, guess: d == null };
  }
  return { grams: null, reason: keys ? 'weight' : 'unit', guess: false };
}
