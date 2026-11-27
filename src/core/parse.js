// @ts-check
// 快速添加的解析：「鸡蛋 12」「2 牛奶」「两盒牛奶」「面粉 1袋」「milk 2 gal」→ { name, qty, unit }。确定性的规则，不用 AI。
// 宁可不认也不认错：认不出的整句原样当名字（加进去以后还能改），认错了会悄悄改掉用户写的名字（「维生素B12」变成 12 个「维生素B」）。
//   - 数字在前：「2 牛奶」（要空格）「2盒牛奶」「2 lb beef」「2 bags of rice」「2x 牛奶」；中文数字只在后面跟着单位时才算（「两盒牛奶」「半斤肉」，「五花肉」「三明治」不算）
//   - 数字在后：「鸡蛋 12」「鸡蛋12个」「鸡蛋 x12」「面粉 1袋」「milk 2 gal」「肉一斤半」；数字前面要是空格、汉字或 x，
//     「B12」「V8」「iPhone15」这种连着字母的数字是名字的一部分
//   - 一般清单（衣服、书、工具……）：前后光秃秃的数字都不算数量（「iPhone 15」「100 Years of Solitude」「AA 电池 4」），要写单位或 x
//   - 数量要 > 0、≤ 9999，不然整句当名字；拆完名字空了（只写了「12」「两盒」）也整句当名字
import { str } from './util.js';
import { toSimplified } from './hanzi.js';
import { isCatalogName } from './catalog.js';

export const QTY_MAX = 9999;

// 认得的单位（比较时不分大小写、繁体折成简体：「個」「LB」都认）。「两」不当单位：它更常是数字（两盒牛奶）
const ZH_UNITS = ['个', '只', '袋', '盒', '瓶', '包', '罐', '听', '把', '根', '条', '块', '片', '颗', '粒', '头', '棵', '串', '束', '捆', '扎',
  '打', '斤', '公斤', '千克', '克', '磅', '盎司', '升', '毫升', '加仑', '箱', '板', '卷', '提', '桶', '杯', '份', '支', '双', '对', '件', '本',
  '套', '张', '节', '台', '盘', '公克', '公升', '台斤'];   // 公克、公升、台斤：台湾的写法（「豬肉 300公克」）
const EN_UNITS = ['lb', 'lbs', 'oz', 'g', 'kg', 'mg', 'ml', 'l', 'gal', 'gallon', 'gallons', 'qt', 'quart', 'quarts', 'pt', 'pint', 'pints',
  'ct', 'count', 'pc', 'pcs', 'piece', 'pieces', 'pk', 'pack', 'packs', 'bag', 'bags', 'box', 'boxes', 'bottle', 'bottles', 'can', 'cans',
  'jar', 'jars', 'bunch', 'bunches', 'dozen', 'doz', 'loaf', 'loaves', 'roll', 'rolls', 'carton', 'cartons', 'head', 'heads', 'ea', 'each',
  'pair', 'pairs', 'set', 'sets', 'sheet', 'sheets'];
// 这几个英文单位也常是名字的一部分（sheet masks、set screws）：写在数字后面、名字前面时要跟着 of 才算（「3 pairs of socks」），
// 写在名字后面照常（「socks 3 pairs」）
const OF_UNITS = new Set(['pair', 'pairs', 'set', 'sets', 'sheet', 'sheets']);
export const UNITS = [...ZH_UNITS, ...EN_UNITS];
// 食谱里常见、买东西时很少写的单位：只在拆食谱的食材时认（core/recipes.js 的 parseIngredients）。
// 「两」在这里是单位（「猪肉二两」「二两酒」）：快速添加里它更常是数字（「两盒牛奶」），所以那边不认。
// 大匙、小匙、cc 是台湾食谱的写法（「醬油 2大匙」「水 200cc」）；cc 只在这里认：买东西时「鮮奶 936cc」说的是一瓶的大小。
// 朵（「香菇 5朵」「花菜 5朵」）只在这里认：快速添加里「一朵花」的朵不是用量。英文食谱把重量写成整个词（2 pounds chicken thighs、
// 8 ounces cream cheese、500 grams flour）：不认的话单位成了名字的一部分（「pounds chicken thighs」2 个），估算按两只鸡腿算。
// pound 不放进快速添加：「2 pound cakes」是两个磅蛋糕
export const RECIPE_UNITS = ['两', '勺', '汤匙', '大勺', '汤勺', '小勺', '茶匙', '大匙', '小匙', '碗', '瓣', '撮', '滴', '朵', 'cc', 'cup', 'cups', 'tbsp', 'tsp', 'tablespoon', 'tablespoons',
  'teaspoon', 'teaspoons', 'clove', 'cloves', 'pinch', 'slice', 'slices', 'stalk', 'stalks', 'sprig', 'sprigs', 'floret', 'florets',
  'pound', 'pounds', 'ounce', 'ounces', 'fl oz', 'gram', 'grams', 'kilogram', 'kilograms', 'kilo', 'kilos',
  'liter', 'liters', 'litre', 'litres', 'milliliter', 'milliliters', 'millilitre', 'millilitres'];

/**
 * 编辑时单位输入框下面的快捷选项（按界面语言；都在 UNITS 里，测试会查）。是填进数据的值，不是界面文案，所以不经过 t()
 * @type {Record<string, string[]>}
 */
export const UNIT_SUGGESTIONS = {
  'zh-Hans': ['个', '袋', '盒', '瓶', '包', '罐', '把', '根', '斤', '打', 'lb', 'oz', 'g', 'kg', 'mL', 'L'],
  'zh-Hant-TW': ['個', '袋', '盒', '瓶', '包', '罐', '把', '根', '斤', '打', 'lb', 'oz', 'g', 'kg', 'mL', 'L'],
  en: ['pc', 'bag', 'box', 'bottle', 'pack', 'can', 'jar', 'bunch', 'dozen', 'lb', 'oz', 'g', 'kg', 'mL', 'L', 'gal'],
};

// ---------- 比较用的写法：和原文一个字对一个字（下标一样），名字从原文里截，不改用户写的字 ----------
/** 全角 ASCII（２、ｘ、：）→ 半角，全角空格 → 空格，ASCII 字母小写，繁体 → 简体。长度不变 @param {string} s */
function fold(s) {
  let out = '';
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    let x = c >= 0xff01 && c <= 0xff5e ? String.fromCharCode(c - 0xfee0) : c === 0x3000 ? ' ' : ch;
    if (x >= 'A' && x <= 'Z') x = x.toLowerCase();
    out += x;
  }
  return toSimplified(out);
}
/** @param {string} u */
const foldUnit = u => fold(u.trim());
const keysOf = (/** @type {string[]} */ units) => [...new Set(units.map(foldUnit))].sort((a, b) => b.length - a.length);   // 长的先试：「毫升」不能认成「升」
const UNIT_KEYS = keysOf(UNITS);
const RECIPE_KEYS = keysOf([...UNITS, ...RECIPE_UNITS]);
const LATIN = /[a-z]/;
const CJK = /[㐀-鿿豈-﫿]/;
const SPACE = /\s/;
const SEP = /[\s,，、:：]/;                       // 数字前面可以是这些（「牛奶，2盒」）；拆出来的名字结尾去掉它们

/** 认不认得这个单位（不分大小写，简繁都认） @param {unknown} u */
export const isUnit = u => UNIT_KEYS.includes(foldUnit(str(u)));
/** 拆食谱时认不认得这个单位（多认 RECIPE_UNITS：勺、两、cup……；英文的结尾可以有点：tbsp.）：「鸡蛋 3 个」的「个」是左边数量的单位，不是下一样食材 @param {unknown} u */
export const isRecipeUnit = u => RECIPE_KEYS.includes(foldUnit(str(u)).replace(/(?<=[a-z])\.$/, ''));

const CN_DIGIT = /** @type {Record<string, number>} */ ({ 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 });
/** 中文数字：一到九、两、十、十二、二十、二十四、半 → 数字；别的 → null @param {string} s */
export function cnNumber(s) {
  if (s === '半') return 0.5;
  if (s.length === 1 && CN_DIGIT[s]) return CN_DIGIT[s];
  const m = /^([一二三四五六七八九])?十([一二三四五六七八九])?$/.exec(s);
  return m ? (m[1] ? CN_DIGIT[m[1]] : 1) * 10 + (m[2] ? CN_DIGIT[m[2]] : 0) : null;
}
/** 阿拉伯数字：整数、小数、简单分数（1/2）→ 数字；分母是 0 → null @param {string} s */
function arabic(s) {
  if (s.includes('/')) { const [a, b] = s.split('/').map(Number); return b ? a / b : null; }
  return Number(s);
}
const roundQty = (/** @type {number} */ q) => Math.round(q * 1000) / 1000;
const okQty = (/** @type {number | null} */ q) => q != null && Number.isFinite(q) && q > 0 && q <= QTY_MAX;

/**
 * f 从 i 开始的单位（最长的那个）；英文单位后面必须是空格或结尾（「2 gala apples」的 gal 不算）。英文单位后面可以跟一个点（「2 Tbsp. olive oil」
 * 「1 lb. pork」：缩写的点），点后面也要是空格或结尾；返回的单位不带点，用 unitEnd 跳过它
 * @param {string} f @param {number} i @param {string[]} keys
 */
function unitAt(f, i, keys) {
  for (const u of keys) {
    if (!f.startsWith(u, i)) continue;
    const after = f[i + u.length];
    if (LATIN.test(u) && after !== undefined && !SPACE.test(after) && !(after === '.' && (f[i + u.length + 1] === undefined || SPACE.test(f[i + u.length + 1])))) continue;
    if (OF_UNITS.has(u) && !OF.test(f.slice(i + u.length))) continue;
    return u;
  }
  return null;
}
const OF = /^\s+of\s+/;                         // 「2 bags of rice」：名字是 rice，不是「of rice」
/** unitAt 认出的单位 u 在 f 的 i 开始：单位后面到哪（英文缩写的点也跳过） @param {string} f @param {number} i @param {string} u */
const unitEnd = (f, i, u) => i + u.length + (LATIN.test(u) && f[i + u.length] === '.' ? 1 : 0);
/** f 在 end 结束的单位（最长的那个）；英文单位前面必须是数字或空格（「Small」的 l 不算） @param {string} f @param {number} end @param {string[]} keys */
function unitBefore(f, end, keys) {
  for (const u of keys) {
    const start = end - u.length;
    if (start < 1 || f.slice(start, end) !== u) continue;
    if (LATIN.test(u) && !/[\d\s.]/.test(f[start - 1])) continue;
    return u;
  }
  return null;
}
const skipBack = (/** @type {string} */ f, /** @type {number} */ i) => { while (i > 0 && SPACE.test(f[i - 1])) i--; return i; };
const skipFwd = (/** @type {string} */ f, /** @type {number} */ i) => { while (i < f.length && SPACE.test(f[i])) i++; return i; };
const cleanName = (/** @type {string} */ s) => s.replace(/[\s,，、:：]+$/u, '').replace(/^[\s,，、:：]+/u, '');

/**
 * @typedef {{ name: string, qty: number | null, unit: string }} Parsed
 * qty: null = 输入里没写数量（加的时候用默认的 1）；unit: '' = 没写单位。unit 是原文里的写法（「個」「LB」原样保留）
 */

// 带分数「1 1/2」（食谱里常见：1 1/2 cups）：只在拆食谱时认。快速添加里「2 1/2 gal milk」更可能是 2 桶「半加仑」的牛奶，照旧
const MIXED = /^(\d+)\s+(\d+)\/(\d+)(?![\d./])/;
const MIXED_END = /(?:^|[\s,，、:：㐀-鿿豈-﫿])(\d+)\s+$/;
/** 带分数的值：分子要比分母小（「1 3/2」不是带分数）；不是 → null @param {string} whole @param {string} a @param {string} b */
const mixedValue = (whole, a, b) => (Number(b) > 0 && Number(a) < Number(b) ? Number(whole) + Number(a) / Number(b) : null);

/** 数字在前 @param {string} raw @param {string} f @param {boolean} grocery @param {string[]} keys @param {boolean} recipe @returns {Parsed | null} */
function leading(raw, f, grocery, keys, recipe) {
  const out = (/** @type {number | null} */ q, /** @type {number} */ restAt, unit = '') => {
    const name = cleanName(raw.slice(restAt));
    return name && okQty(q) ? { name, qty: roundQty(/** @type {number} */ (q)), unit } : null;
  };
  const mx = recipe ? MIXED.exec(f) : null;
  const m = mx ? [mx[0], mx[0]] : /^(\d+\/\d+|\d+(?:\.\d+)?|\.\d+)/.exec(f);
  if (mx && mixedValue(mx[1], mx[2], mx[3]) == null) return null;               // 「1 3/2」：不猜
  if (m) {
    const n = mx ? mixedValue(mx[1], mx[2], mx[3]) : arabic(m[1]), i = m[1].length, j = skipFwd(f, i);
    const u = unitAt(f, j, keys);
    // 「2 包子」：包后面连着的「包子」本身是常见的东西，不拆成「2 包 / 子」
    if (u && !(CJK.test(u) && isCatalogName(f.slice(j)))) {
      let k = unitEnd(f, j, u), q = n;
      if (f[k] === '半' && Number.isInteger(n)) { q = /** @type {number} */ (n) + 0.5; k++; }
      if (LATIN.test(u)) { const of = OF.exec(f.slice(k)); if (of) k += of[0].length; }
      return out(q, k, raw.slice(j, j + u.length));                // 「2 斤」后面没有名字：不认，整句当名字
    }
    if (/[x×*]/.test(f[j] || '') && (SPACE.test(f[j + 1] || '') || CJK.test(f[j + 1] || ''))) return out(n, j + 1);   // 「2x 牛奶」；「3x3 魔方」不算
    if (grocery && j > i) return out(n, j);                                                                       // 「2 牛奶」
    return null;
  }
  // 中文数字：后面必须是单位（「两盒牛奶」「半斤肉」「一斤半排骨」）。取最长的、读得通的一段
  const run = /^([一二两三四五六七八九十]+|半)/.exec(f);
  if (!run) return null;
  for (let len = run[1].length; len > 0; len--) {
    const n = cnNumber(f.slice(0, len));
    if (n == null) continue;
    const j = skipFwd(f, len), u = unitAt(f, j, keys);
    if (!u || isCatalogName(f.slice(j))) continue;
    let k = j + u.length, q = n;
    if (f[k] === '半' && Number.isInteger(n)) { q = n + 0.5; k++; }
    return out(q, k, raw.slice(j, j + u.length));
  }
  return null;
}

/** 数字在后 @param {string} raw @param {string} f @param {boolean} grocery @param {string[]} keys @param {boolean} recipe @returns {Parsed | null} */
function trailing(raw, f, grocery, keys, recipe) {
  // 结尾可能是「…斤半」：先去掉「半」再找单位
  for (const half of f.endsWith('半') ? [false, true] : [false]) {
    const end = half ? f.length - 1 : f.length;
    const u = unitBefore(f, end, keys);
    if (half && !u) continue;
    const unitStart = u ? end - u.length : end;
    const p = skipBack(f, unitStart);
    const unit = u ? raw.slice(unitStart, end) : '';
    /** @param {number} numStart @param {number | null} n @param {boolean} cn */
    const finish = (numStart, n, cn) => {
      if (n == null || (half && !Number.isInteger(n))) return null;
      let q = half ? n + 0.5 : n;
      let nameEnd = numStart, explicit = false;
      const b = skipBack(f, numStart);
      if (!cn && b > 0 && /[x×*]/.test(f[b - 1]) && (b - 1 === 0 || SEP.test(f[b - 2]) || CJK.test(f[b - 2]))) { explicit = true; nameEnd = b - 1; }
      else if (!cn && numStart > 0 && !SEP.test(f[numStart - 1]) && !CJK.test(f[numStart - 1])) return null;   // 「B12」「V8」：连着字母的数字是名字
      if (!u && !explicit && !grocery) return null;                                                             // 一般清单：光秃秃的数字不算
      const name = cleanName(raw.slice(0, nameEnd));
      return name && okQty(q) ? { name, qty: roundQty(q), unit } : null;
    };
    const m = /(\d+\/\d+|\d+(?:\.\d+)?|\.\d+)$/.exec(f.slice(0, p));
    if (m) {
      // 「sugar 1 1/2 cups」：前面还有一个整数是带分数（只在拆食谱时；不然名字会是「sugar 1」）
      const fr = recipe && /^(\d+)\/(\d+)$/.exec(m[1]);
      const before = f.slice(0, p - m[1].length), w = fr ? MIXED_END.exec(before) : null;
      if (fr && w) {
        const v = mixedValue(w[1], fr[1], fr[2]);
        const r = v == null ? null : finish(before.trimEnd().length - w[1].length, v, false);
        if (r) return r;
        continue;
      }
      const r = finish(p - m[1].length, arabic(m[1]), false); if (r) return r; continue;
    }
    if (!u) continue;                                                                                           // 中文数字后面必须有单位
    if (f[p - 1] === '半') { const r = finish(p - 1, 0.5, true); if (r) return r; continue; }                   // 「肉半斤」
    const run = /[一二两三四五六七八九十]+$/.exec(f.slice(0, p));
    if (!run) continue;
    for (let len = run[0].length; len > 0; len--) {                                                             // 「十三香两包」：读得通的最长一段
      const n = cnNumber(f.slice(p - len, p));
      if (n == null) continue;
      const r = finish(p - len, n, true);
      if (r) return r;
    }
  }
  return null;
}

/**
 * 解析快速添加的一行字。kind：清单的类型（'grocery' 食材 | 'general' 一般）；recipe：拆食谱的食材，多认 RECIPE_UNITS（勺、两、cup……）
 * @param {unknown} text
 * @param {{ kind?: string, recipe?: boolean }} [opts]
 * @returns {Parsed}
 */
export function parseQuickAdd(text, { kind = 'grocery', recipe = false } = {}) {
  const raw = str(text).trim();
  if (!raw) return { name: '', qty: null, unit: '' };
  const f = fold(raw), grocery = kind !== 'general', keys = recipe ? RECIPE_KEYS : UNIT_KEYS;
  return leading(raw, f, grocery, keys, recipe) || trailing(raw, f, grocery, keys, recipe) || { name: raw, qty: null, unit: '' };
}

/**
 * 编辑面板里数量输入框的字 → 数字；空的 → null（不写数量）；读不出来 → NaN（由 validateItemPatch 报错）
 * @param {unknown} v
 */
export function readQty(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  const s = fold(str(v)).trim();
  if (!s) return null;
  if (!/^(\d+\/\d+|\d+(?:\.\d+)?|\.\d+)$/.test(s)) return NaN;
  const n = arabic(s);
  return n == null ? NaN : roundQty(n);
}

/** 数量 −/+：+ 从空的开始是 1；− 减到 0 或以下就是空的（不写数量）@param {number | null} q @param {1 | -1} dir */
export function stepQty(q, dir) {
  if (dir > 0) return q == null || !Number.isFinite(q) ? 1 : Math.min(QTY_MAX, roundQty(q + 1));
  if (q == null || !Number.isFinite(q)) return null;
  const n = roundQty(q - 1);
  return n > 0 ? n : null;
}

/** 显示的数量：null → ''；整数原样；小数最多两位（不加千分位） @param {number | null} qty */
export function formatQty(qty) {
  if (qty == null || !Number.isFinite(qty)) return '';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2, useGrouping: false }).format(qty);
}
/** 一行上的「12」「1 袋」「0.5 lb」；没写数量的什么也不显示 @param {number | null} qty @param {string} unit */
export const qtyLabel = (qty, unit) => { const q = formatQty(qty); return q ? (unit ? q + ' ' + unit : q) : ''; };
