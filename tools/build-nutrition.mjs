// 营养数据表的生成脚本（第 14 步）：node tools/build-nutrition.mjs <SR Legacy CSV 的目录> [--out 输出文件] [--map 对照表]
//   读 USDA FoodData Central SR Legacy 的 CSV（food.csv、food_nutrient.csv、food_portion.csv、measure_unit.csv、nutrient.csv），
//   按 tools/nutrition-map.mjs 的对照表挑出常见食材，写成 src/data/nutrition.js（默认）。
//   下载的 CSV 是外来的数据：这里只当文本读，不执行、不 import 那个目录里的任何东西；数据不进仓库，只进生成的那一份。
//   输出是确定的（按 id 排、数字按同一套规则取整），重跑一次结果一样，所以生成的文件可以直接比 diff。
// 解析和换算的函数都导出了，tests/nutritionBuild.test.mjs 用编出来的小 CSV 测（不读真的数据）。
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 四样营养在 nutrient.csv 里的 id（按名字和单位核对一遍，不对就停下：USDA 换过编号的话宁可不生成也不要错的数） */
export const NUTRIENT_IDS = { kcal: '1008', protein: '1003', fat: '1004', carbs: '1005' };
const NUTRIENT_CHECK = { kcal: [/^Energy$/, 'KCAL'], protein: [/^Protein$/, 'G'], fat: [/^Total lipid \(fat\)$/, 'G'], carbs: [/^Carbohydrate, by difference$/, 'G'] };

export const SOURCE = {
  attribution: 'U.S. Department of Agriculture, Agricultural Research Service. FoodData Central (SR Legacy, 2018).',
  dataset: 'USDA FoodData Central SR Legacy',
  date: '2018-04',
  license: 'CC0 1.0 (public domain)',
  url: 'https://fdc.nal.usda.gov/',
};

// ---------- CSV ----------
/**
 * 一边读一边拆的 CSV（RFC 4180：双引号括起来的字段里可以有逗号、换行，"" 是一个引号）。
 * food_nutrient.csv 有 36 MB，整个读进来再拆也行，但一块一块地喂不用占两份内存；块的边界落在引号、\r\n 中间也没关系
 */
export function csvParser() {
  let field = '', row = /** @type {string[]} */ ([]), inQ = false, afterQ = false, any = false, started = false;
  /** @param {string} text @returns {string[][]} 这一块里拆完了的几行 */
  function push(text) {
    const rows = [];
    // 有的导出（Excel 存的 UTF-8）开头有一个 BOM：留着的话第一列的列名是「\uFEFF"id"」，后面按列名找就全找不到了
    if (!started && text) { started = true; if (text[0] === '\uFEFF') text = text.slice(1); }
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"') { inQ = false; afterQ = true; } else field += c;
        continue;
      }
      if (afterQ) {
        afterQ = false;
        if (c === '"') { field += '"'; inQ = true; continue; }
      }
      if (c === '"' && field === '') { inQ = true; any = true; continue; }
      if (c === ',') { row.push(field); field = ''; any = true; continue; }
      if (c === '\n') {
        row.push(field); field = '';
        // 空行（文件结尾多一个换行）不算一行
        if (any || row.length > 1 || row[0] !== '') rows.push(row);
        row = []; any = false;
        continue;
      }
      if (c === '\r') continue;
      field += c; any = true;
    }
    return rows;
  }
  /** 最后一行没有换行时，在这里交出来 */
  function end() {
    const rows = push('\n');
    field = ''; row = []; inQ = false; afterQ = false; any = false; started = false;
    return rows;
  }
  return { push, end };
}

/** 整段文字 → 每一行一个对象（按第一行的列名） @param {string} text */
export function parseCsv(text) {
  const p = csvParser();
  return toObjects([...p.push(text), ...p.end()]);
}

/** @param {string[][]} rows */
function toObjects(rows) {
  const [head, ...rest] = rows;
  if (!head) return [];
  return rest.map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

/**
 * 一行一行地读一个大 CSV，每行交给 onRow（列名 → 值）
 * @param {string} file @param {(row: Record<string, string>) => void} onRow
 */
export async function streamCsv(file, onRow) {
  const p = csvParser();
  /** @type {string[] | null} */
  let head = null;
  const take = (/** @type {string[][]} */ rows) => {
    for (const r of rows) {
      if (!head) { head = r; continue; }
      const h = head;
      onRow(Object.fromEntries(h.map((k, i) => [k, r[i] ?? ''])));
    }
  };
  for await (const chunk of fs.createReadStream(file, { encoding: 'utf8' })) take(p.push(/** @type {string} */ (chunk)));
  take(p.end());
}

// ---------- 数字的取法 ----------
// 千卡取整、营养素一位小数（和 store.js 的 nutrValue 一样的精度），克数 10 g 以上取整、以下一位小数，密度两位小数
const round = (/** @type {number} */ x, /** @type {number} */ d) => { const f = 10 ** d; return Math.round(x * f + Number.EPSILON * f) / f; };
/** @param {number} g */
export const roundGrams = g => (g >= 10 ? Math.round(g) : round(g, 1));

/** food_nutrient 的几行（只要四样）→ 每 100 g 的营养；缺了哪样是 null @param {Record<string, string>[]} rows */
export function per100Of(rows) {
  /** @type {Record<string, number | null>} */
  const out = { kcal: null, protein: null, carbs: null, fat: null };
  for (const [k, id] of Object.entries(NUTRIENT_IDS)) {
    const r = rows.find(x => x.nutrient_id === id);
    const n = r ? Number(r.amount) : NaN;
    if (r && r.amount !== '' && Number.isFinite(n) && n >= 0) out[k] = k === 'kcal' ? Math.round(n) : round(n, 1);
  }
  return out;
}

// ---------- 单位：USDA 的「1 cup, chopped」「1 medium (2-1/2" dia)」「10 beans (4" long)」→ 中文的单位 ----------
// 看 modifier（SR Legacy 的 measure_unit 都是 9999「undetermined」，单位写在 modifier 里）的第一个词（复数折成单数）。
// 一个中文单位按词的顺序找，同一个词有几条（cup, chopped / cup, sliced）时中等大小的（写着 medium）优先，再按 seq_num（USDA 排在前面的、最常用的）。
// 「个」没有固定的词：除了下面这些量具、包装、切法的词，剩下的（medium、large、fruit、pepper、head、0.5 chicken……）都是「一整个」，
// 中等大小的优先（spec），没写大小的（1 fruit、1 pepper）其次，再是 large、small
/** @type {[string, string[]][]} */
export const UNIT_RULES = [
  ['杯', ['cup']],
  ['勺', ['tbsp', 'tablespoon']],
  ['小勺', ['tsp', 'teaspoon']],
  ['片', ['slice', 'leaf']],
  ['瓣', ['clove']],
  ['根', ['stalk', 'spear', 'ear', 'root', 'stem', 'shoot', 'link']],
  ['块', ['block', 'chop', 'steak', 'cube', 'piece', 'wedge']],   // wedge：切下来的一块（一块西瓜 286 g 是 1/16 个，一块番茄是 1/4 个）
  ['把', ['bunch']],
  ['张', ['sheet']],
  ['朵', ['floweret', 'floret']],   // 花菜的一小朵
  ['个', []],
];
const UNIT_ORDER = [...UNIT_RULES.map(([zh]) => zh), '条', '包'];
// 不是「一整个」的词：量具、重量、包装、一部分（这些要么换算不了，要么不是中文里的「一个」）
const NOT_PIECE = new Set([...UNIT_RULES.flatMap(([, w]) => w).filter(w => w !== 'piece'),
  'oz', 'lb', 'g', 'gram', 'kg', 'fl', 'quart', 'pint', 'gallon', 'liter', 'ml', 'cubic', 'inch', 'serving', 'nlea', 'package', 'pack',
  'can', 'container', 'jar', 'bottle', 'box', 'packet', 'envelope', 'bag', 'pat', 'strip', 'sprig', 'dash', 'jigger', 'drink',
  'individual', 'portion', 'unit', 'roast', 'fillet', 'patty', 'bar', 'loaf', 'stick', 'extra']);
// 体积的单位（算密度用）：US cup 236.6 ml、tbsp 14.79 ml、tsp 4.93 ml、fl oz 29.57 ml。量得最准的在前：液体的 fl oz，再是勺、杯
/** @type {[string, number][]} */
const VOLUME_ML = [['fl', 29.574], ['tbsp', 14.787], ['tablespoon', 14.787], ['cup', 236.588], ['tsp', 4.929], ['teaspoon', 4.929]];

/** 复数折成单数：cloves → clove、berries → berry、leaves → leaf、pieces → piece @param {string} w */
function singular(w) {
  if (w === 'leaves') return 'leaf';
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (/(?:ch|sh|ss|x)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}
/** modifier 的第一个词（小写、单数；「cup, chopped」→ cup，「medium (2" dia)」→ medium，「cloves」→ clove） @param {string} s */
export function firstWord(s) {
  const m = String(s || '').trim().toLowerCase().match(/^[a-z]+/);
  return m ? singular(m[0]) : '';
}

/** @typedef {{ seq: number, id: number, amount: number, mod: string, word: string, each: number }} PortionRow */
/**
 * 几条里挑一条：「1 cup, with hulls, edible yield」「1 cup, with pits, yields」「1 pint as purchased, yields」这种按带壳、带核、买来的量
 * 量的（yields）排在后面，只有这种的时候才用；再是写着 medium 的，再是量了一个的（「1 package」比「0.33 package」准：
 * 除出来 288 g，实际一包 284 g），再按 USDA 的顺序。
 * 玉米的「1 ear, medium … yields」102 g 其实就是一根能吃的部分，比没写 yields 的「1 ear, small」73 g 准：对照表里指定了（'根': 'ear, medium'）
 * @param {PortionRow[]} list
 */
function pickRow(list) {
  const plain = list.filter(r => !/\byields?\b/.test(r.mod));
  const from = plain.length ? plain : list;
  return from.find(r => /\bmedium\b/.test(r.mod)) || from.find(r => r.amount === 1) || from[0];
}
const SIZE = /\b(?:large|small|extra|jumbo|mini)\b/;

/**
 * 一样食材的 food_portion 几行 → 每个中文单位多少克、密度（g/ml；没有体积的 portion、或者算出来不像密度 → null）
 * @param {Record<string, string>[]} portions 这一样的几行
 * @param {Map<string, string>} unitNames measure_unit 的 id → 名字（modifier 空着时才用）
 * @param {Record<string, string | null>} [pick] 对照表里这一样的指定：中文单位 → 用 modifier 这样开头的那条（不按默认的词找），null = 不要这个单位
 */
export function portionsOf(portions, unitNames, pick = {}) {
  /** @type {PortionRow[]} */
  const rows = portions
    .map(p => {
      const amount = Number(p.amount), g = Number(p.gram_weight);
      const unit = unitNames.get(p.measure_unit_id) || '';
      const mod = String(p.modifier || '').trim().toLowerCase() || (unit === 'undetermined' ? '' : unit.toLowerCase());
      return { seq: Number(p.seq_num) || 0, id: Number(p.id) || 0, amount, mod, word: firstWord(mod), each: amount > 0 && g > 0 ? g / amount : NaN };
    })
    .filter(r => r.word && Number.isFinite(r.each))
    .sort((a, b) => a.seq - b.seq || a.id - b.id);
  /** @type {Record<string, number>} */
  const grams = {};
  const put = (/** @type {string} */ zh, /** @type {PortionRow | undefined} */ r) => { if (r) grams[zh] = roundGrams(r.each); };
  for (const [zh, words] of UNIT_RULES) {
    if (Object.prototype.hasOwnProperty.call(pick, zh)) continue;
    if (zh === '个') {
      const whole = rows.filter(r => !NOT_PIECE.has(r.word) && !/\byields?\b/.test(r.mod));
      put(zh, whole.find(r => /\bmedium\b/.test(r.mod)) || whole.find(r => !SIZE.test(r.mod)) || whole.find(r => /\blarge\b/.test(r.mod)) || whole[0]);
      continue;
    }
    for (const w of words) {
      const list = rows.filter(r => r.word === w);
      if (list.length) { put(zh, pickRow(list)); break; }
    }
  }
  // 对照表指定的（也可以是 UNIT_RULES 以外的单位：黄油的「条」= 1 stick、方便面的「包」）
  for (const [zh, want] of Object.entries(pick)) {
    if (typeof want !== 'string') continue;
    const list = rows.filter(r => r.mod.startsWith(want.toLowerCase()));
    if (!list.length) throw new Error(`portion 里没有「${want}」开头的（${zh}）`);
    put(zh, pickRow(list));
  }
  let density = null;
  for (const [w, ml] of VOLUME_ML) {
    const list = rows.filter(r => r.word === w);
    if (list.length) { density = round(list[0].each / ml, 2); break; }
  }
  // 一杯切碎的生菜只有几十克（0.15 g/ml）：这不是密度，拿它换算「100 ml」没有意义，宁可按 1 估（core/nutrition.js 会标出是猜的）
  if (density != null && !(density >= 0.3 && density <= 2)) density = null;
  return { grams: sortKeys(grams), density };
}

/** 单位按 UNIT_RULES 的顺序写（杯、勺、小勺……个，再是对照表另加的），每次生成一样 @param {Record<string, number>} o */
function sortKeys(o) {
  const at = (/** @type {string} */ k) => { const i = UNIT_ORDER.indexOf(k); return i < 0 ? UNIT_ORDER.length : i; };
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => at(a) - at(b) || (a < b ? -1 : a > b ? 1 : 0)));
}

// ---------- 拼起来 ----------
/**
 * volume: false = 按体积（杯、勺、毫升）量没有意义，换算不了：USDA 的体积 portion 是别的形态量的（紫菜按螺旋藻粉，一杯粉 112 g，干紫菜、海苔片轻得多），
 * 按 1 g/ml 猜更差。这时不写密度、不要体积的单位
 * @typedef {{ zh: string[], en: string[], fdc: number, note?: string, units?: Record<string, string | null>, volume?: false }} MapEntry
 * @typedef {{ id: number, zh: string[], en: string[], per100: Record<string, number | null>, grams: Record<string, number>, density: number | null, volume?: false, note?: string }} Built
 */

/**
 * 对照表 + 读出来的几张表 → 输出的每一样（按 id 排）。对照表里的 fdc 在 food.csv 里找不到、四样营养缺了，都直接报错：
 * 不能悄悄少一样（之后认食材时就认不出来了），也不能写成 0
 * @param {MapEntry[]} map
 * @param {{ foods: Map<string, Record<string, string>>, nutrients: Map<string, Record<string, string>[]>, portions: Map<string, Record<string, string>[]>, unitNames: Map<string, string> }} data
 * @returns {Built[]}
 */
export function buildEntries(map, data) {
  const seen = new Set();
  const out = map.map(m => {
    const id = String(m.fdc);
    if (seen.has(id)) throw new Error(`对照表里 fdc ${id} 出现了两次（${m.zh[0]}）：别名并到一条里`);
    seen.add(id);
    if (!data.foods.has(id)) throw new Error(`food.csv 里没有 fdc ${id}（${m.zh[0]}）`);
    const per100 = per100Of(data.nutrients.get(id) || []);
    const missing = Object.entries(per100).filter(([, v]) => v == null).map(([k]) => k);
    if (missing.length) throw new Error(`fdc ${id}（${m.zh[0]}）缺 ${missing.join('、')}`);
    const noVolume = m.volume === false;
    const { grams, density } = portionsOf(data.portions.get(id) || [], data.unitNames, noVolume ? { 杯: null, 勺: null, 小勺: null, ...m.units } : m.units);
    /** @type {Built} */
    const e = { id: Number(id), zh: [...new Set(m.zh)], en: [...new Set(m.en)], per100, grams, density: noVolume ? null : density };
    if (noVolume) e.volume = false;
    if (m.note) e.note = m.note;
    return e;
  });
  return out.sort((a, b) => a.id - b.id);
}

/**
 * 对照表和换单位的规则的指纹（写进生成的文件，测试拿它和现在的对照表比：改了对照表、UNIT_RULES 不重新生成，测试会失败）
 * @param {MapEntry[]} map
 */
export const inputHash = map => createHash('sha256').update(JSON.stringify({ map, rules: UNIT_RULES })).digest('hex');

/** 输出的文件：一样一行，键的顺序固定（JSON.stringify 按写进去的顺序），重跑结果一样 @param {Built[]} entries @param {string} hash inputHash(对照表) */
export function render(entries, hash) {
  const line = (/** @type {Built} */ e) => {
    const o = { id: e.id, zh: e.zh, en: e.en, per100: { kcal: e.per100.kcal, protein: e.per100.protein, carbs: e.per100.carbs, fat: e.per100.fat }, grams: e.grams, density: e.density,
      ...(e.volume === false ? { volume: false } : {}), ...(e.note ? { note: e.note } : {}) };
    return '  ' + JSON.stringify(o) + ',';
  };
  return [
    '// @ts-check',
    '// 生成的文件，不要手改：node tools/build-nutrition.mjs <SR Legacy CSV 的目录>（挑哪些、中文名和别名在 tools/nutrition-map.mjs）。',
    `// 来源：${SOURCE.attribution} 公共领域（CC0）。`,
    '// 每 100 g 可食部分的热量（千卡）、蛋白质 / 碳水 / 脂肪（克）；grams 是一个单位多少克（USDA 的 portion），density 是 g/ml（没有 → null），',
    '// volume: false 是按体积量没有意义（杯、勺、毫升换算不了）。',
    '// 都是估算用的：同一样东西的品种、做法、牌子差得不少，界面上一律写「约」。',
    '',
    '/** @typedef {{ kcal: number, protein: number, carbs: number, fat: number }} Per100 */',
    '/** @typedef {{ id: number, zh: string[], en: string[], per100: Per100, grams: Record<string, number>, density: number | null, volume?: false, note?: string }} NutritionFood */',
    '',
    `export const NUTRITION_SOURCE = ${JSON.stringify(SOURCE)};`,
    '// 生成时的对照表和单位规则的指纹（tools/build-nutrition.mjs 的 inputHash），测试拿它查这份文件是不是按现在的对照表生成的',
    `export const NUTRITION_INPUT = ${JSON.stringify(hash)};`,
    '',
    '/** @type {NutritionFood[]} */',
    'export const NUTRITION = [',
    ...entries.map(line),
    '];',
    '',
  ].join('\n');
}

/** nutrient.csv 里那四个 id 是不是还是那四样 @param {Record<string, string>[]} rows */
export function checkNutrientIds(rows) {
  for (const [k, id] of Object.entries(NUTRIENT_IDS)) {
    const r = rows.find(x => x.id === id);
    const [name, unit] = NUTRIENT_CHECK[/** @type {keyof typeof NUTRIENT_CHECK} */ (k)];
    if (!r || !name.test(r.name) || r.unit_name !== unit) throw new Error(`nutrient.csv 里 ${id} 不是 ${k}（${r ? r.name + ' ' + r.unit_name : '没有这一行'}）`);
  }
}

/**
 * 读一个目录里的 CSV → buildEntries 要的几张表。只留对照表用到的那几样（food_nutrient 有 64 万行）
 * @param {string} dir @param {MapEntry[]} map
 */
export async function readData(dir, map) {
  const file = (/** @type {string} */ f) => path.join(dir, f);
  const want = new Set(map.map(m => String(m.fdc)));
  const nutrientIds = new Set(Object.values(NUTRIENT_IDS));
  checkNutrientIds(parseCsv(fs.readFileSync(file('nutrient.csv'), 'utf8')));
  const foods = new Map(parseCsv(fs.readFileSync(file('food.csv'), 'utf8')).filter(r => want.has(r.fdc_id)).map(r => [r.fdc_id, r]));
  const unitNames = new Map(parseCsv(fs.readFileSync(file('measure_unit.csv'), 'utf8')).map(r => [r.id, r.name]));
  /** @type {Map<string, Record<string, string>[]>} */
  const portions = new Map();
  for (const r of parseCsv(fs.readFileSync(file('food_portion.csv'), 'utf8'))) {
    if (!want.has(r.fdc_id)) continue;
    if (!portions.has(r.fdc_id)) portions.set(r.fdc_id, []);
    /** @type {Record<string, string>[]} */ (portions.get(r.fdc_id)).push(r);
  }
  /** @type {Map<string, Record<string, string>[]>} */
  const nutrients = new Map();
  await streamCsv(file('food_nutrient.csv'), r => {
    if (!want.has(r.fdc_id) || !nutrientIds.has(r.nutrient_id)) return;
    if (!nutrients.has(r.fdc_id)) nutrients.set(r.fdc_id, []);
    /** @type {Record<string, string>[]} */ (nutrients.get(r.fdc_id)).push(r);
  });
  return { foods, nutrients, portions, unitNames };
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (/** @type {string} */ name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const values = new Set(['--out', '--map'].map(o => args.indexOf(o) + 1).filter(i => i > 0));
  const out = path.resolve(opt('--out') || path.join(root, 'src/data/nutrition.js'));
  const dir = args.find((a, i) => !a.startsWith('--') && !values.has(i));
  if (!dir) { console.error('用法：node tools/build-nutrition.mjs <FoodData_Central_sr_legacy_food_csv 目录> [--out 文件] [--map 对照表]'); process.exitCode = 2; return; }
  // --map 只给测试用（编出来的小对照表）；平常用仓库里的 tools/nutrition-map.mjs
  const mapFile = opt('--map');
  const { MAP } = await import(mapFile ? pathToFileURL(path.resolve(mapFile)).href : './nutrition-map.mjs');
  const entries = buildEntries(MAP, await readData(path.resolve(dir), MAP));
  const text = render(entries, inputHash(MAP));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, text);
  const shown = out.startsWith(root + path.sep) ? path.relative(root, out) : out;
  console.log(`写好了 ${shown}：${entries.length} 样，${(Buffer.byteLength(text) / 1024).toFixed(1)} KB`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
