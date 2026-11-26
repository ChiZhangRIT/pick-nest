// @ts-check
// 食谱（第二版）：粘贴一整段食材拆成一行一样（parseIngredients）、按人数换算（scaleIngredients）、「食谱」页的搜索（searchRecipes）、
// 用到某样食材的食谱（recipesUsing：快速添加时的联想）、新建 / 改（validateRecipe、saveRecipe）、删除（deleteRecipe，软删除）、
// 「加到清单」面板里的每一行（recipeLines：常备品、可选的默认不勾，清单上已有的写出来）和确认（addRecipeToList → items.js 的 addNeeds）。
// 写法和 items.js 一样：操作函数直接改传进来的 state（页面在 ctx.mutate 里调用），记录经过 writeRecord / deletedRecord。
// 确定性的规则，不用 AI：粘贴的食材拆不出来就整段当名字（宁可不认，也不认错），加进去以后还能改。
// 第 11 步：标签（菜系、风格；tagChoices、usedTags、筛选在 searchRecipes 的 tags）、食材的默认顺序（ingredientGroup、sortIngredients、placeIngredients）、
// 重复的食材（duplicateOf、mergeIngredient）、食材替换（ingredientNames、replacePreview、replaceDuplicates、replaceIngredient）。
// 第 12 步：成品图 photo（{ sha256, mime, w, h, bytes }）跟着 saveRecipe 存，给了才改；图片本身不在这里（core/blobStore.js、core/photo.js）。
import { normName, writeRecord, deletedRecord, newId, live, homeLists, itemId, normalizeTags, normalizePhoto, TAG_GROUPS, GROCERY_CATEGORIES } from './store.js';
import { own, isObj, str, safeKey } from './util.js';
import { parseQuickAdd, readQty, isRecipeUnit, qtyLabel, QTY_MAX } from './parse.js';
import { searchTerms } from './search.js';
import { collatorFor } from './group.js';
import { catalogSys } from './catalog.js';
import { liveList, addNeeds, totalLabel, needsOf, NEED_MAX } from './items.js';
import { isStaple, setStaple, memoryOf } from './memory.js';

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
// 空格隔开的几样：「约」「每」这种开头的是左边那样的补充（左边写了数量时放进括号当备注），「各」开头的是左边那几样共用的数量
const APPROX_NEXT = /^(?:约|大约|共|每|左右)/;
const EACH_NEXT = /^各/;
// 一整个空格隔开的词就是「适量」「to taste」这种：它不是一样食材，是左边那样的用量
const VAGUE_ONLY = new RegExp('^(?:' + VAGUE_RE + ')$', 'i');
// 单独一个「约」「大约」：后面那个词才是它说的用量（「鸡翅 8 个 约 400g」），先连成一个「约400g」
const APPROX_ALONE = /^(?:约|大约|共|每)$/;
// 写在用量后面的处理方法（「葱 1 根 切段」「大蒜 3 瓣 拍碎」）：是左边那样的备注，不是一样食材。只认这些固定的说法——
// 「切达芝士」也是「切」开头的
const PREP = /^(?:切(?:成)?(?:小|大|薄|厚|细|粗)?[段块丝片末丁碎条圈花半粒]|拍(?:碎|扁|松)|剁(?:碎|末|蓉|成末)|去(?:骨|皮|籽|核|壳|蒂|头|筋|根|虾线)|打散|洗净|泡(?:发|软)|焯水|备用|剥(?:皮|壳)|磨(?:碎|粉)|擦丝|撕(?:碎|开)|掰(?:开|碎))$/;
// 单独的连接词（「淀粉 1 勺 加 水 2 勺」「葱 和 姜」）：前后是两样，它自己不是一样
const JOINER = /^(?:加|和|与|與|及|以及|还有|還有|跟|[+＋&])$/;
// 认不出的用量（「一小把」「几颗」「小半碗」「两三个」）：左边还没写数量时接着左边——整段当名字（不猜），不要拆出一样叫「几颗」的。
// 不认「千」「百」开头的（千张、百叶是食材），去掉前面的数字和大小以后要正好是一个单位（小葱、大米、八角都不算）
const ROUGH_QTY = /^(?:[一二两三四五六七八九十几半]+[小大]?|[小大]半?)(.+)$/;
const roughQty = (/** @type {string} */ w) => { const m = ROUGH_QTY.exec(w); return !!m && isRecipeUnit(m[1]); };
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

/** 这个词自己就是一个数量（「500」「500g」「两个」「半斤」「1/4」），可以接在一样东西的名字后面 @param {string} tok */
const qtyTok = (tok) => { const p = parseQuickAdd('料 ' + tok, asRecipe); return p.qty != null && p.name === '料'; };
/** 还没有名字：只有数量、单位、「适量」（「3」「3 个」「两个」）——后面的词是它的名字（「3 个 鸡蛋」） @param {string} s */
const nameless = (s) => VAGUE_ONLY.test(s) || s.split(' ').every(x => /^[\d./]+$/.test(x) || isRecipeUnit(x) || qtyTok(x));
const LATIN_END = /[A-Za-z]$/, LATIN_START = /^[A-Za-z]/, WORD_START = /^[\p{L}]/u;

/**
 * 一行汉字的里面再按空格拆：每个空格都能拆（「葱 姜 蒜」是三样，「五花肉 500 葱 2 姜 3」是三样、数量是各自后面的数字），
 * 只有接着左边那样的词不拆——左边还没写数量时它的数量（「五花肉 500」「鸡蛋 两个」）、左边那个数量的单位（「鸡蛋 3 个」）、
 * 带分数的后一半（「面粉 1 1/2 杯」）、「适量」「少许」、「约」「各」开头的补充、括号这种不是字开头的；左边还只有数量（「3 个 鸡蛋」）；
 * 两个英文词中间（「chicken breast」：一行里有汉字，英文的名字也照样是一个）。左边写了数量以后又是数字开头的，是下一样（「五花肉 500g 2 个 鸡蛋」）。
 * 「可选」「optional」、用量后面的处理方法（「切段」「拍碎」）放进左边那样的括号（可选 / 备注）；单独的「加」「和」只是隔开两样；
 * 左边还没认出数量时，认不出的用量（「2-3 个」「一小把」「几颗」）也接着左边，整段当名字（不猜，也不拆出一样叫「个」「几颗」的）
 * @param {string} seg
 */
function splitSpaces(seg) {
  const toks = seg.split(/\s+/).filter(Boolean);
  // 「to taste」「as needed」是两个词的一个说法：先连起来，不然 to 会被当成一样
  for (let i = 0; i < toks.length - 1; i++) if (VAGUE_ONLY.test(toks[i] + ' ' + toks[i + 1])) toks.splice(i, 2, toks[i] + ' ' + toks[i + 1]);
  // 「约 400g」「约 400 g」：连成「约400g」，下面整个放进左边的括号（不然「约」进了备注、400g 成了下一样）
  for (let i = 0; i < toks.length - 1; i++) {
    if (!APPROX_ALONE.test(toks[i])) continue;
    let x = toks[i] + toks[i + 1], n = 2;
    if (/\d$/.test(x) && i + 2 < toks.length && isRecipeUnit(toks[i + 2])) { x += toks[i + 2]; n = 3; }
    toks.splice(i, n, x);
  }
  const out = [];
  let cur = '';
  for (const tok of toks) {
    if (!cur) { if (!JOINER.test(tok)) cur = tok; continue; }
    const bare = cur.replace(PAREN, ' ').replace(/\s+/g, ' ').trim();       // 括号里的备注不影响认数量：「五花肉 500g（带皮）」
    const p = parseQuickAdd(bare, asRecipe);
    const hasQty = p.qty != null && p.name !== bare;
    const vm = !hasQty ? VAGUE_END.exec(bare) : null;
    const vague = !!(vm && vm[1].trim());
    // 认的时候看去掉括号的：「适量（可选）」也是「适量」
    const word = tok.replace(PAREN, '').trim();
    const parens = (tok.match(PAREN) || []).join('');
    let join = true;
    if (JOINER.test(tok)) { out.push(cur); cur = ''; continue; }                              // 「淀粉 1 勺 加 水 2 勺」
    if (word && (OPTIONAL.test(word) || PREP.test(word))) { cur += '（' + word + '）' + parens; continue; }   // 「香菜 可选」「葱 1 根 切段」
    if (nameless(bare)) join = true;
    else if (VAGUE_ONLY.test(word)) join = true;                                               // 「盐 适量」「盐 适量（可选）」
    else if (hasQty && !p.unit && /^\d+\/\d+$/.test(tok) && /(?:^|\s)\d+$/.test(bare)) join = true;   // 「面粉 1 1/2 杯」
    else if (hasQty && !p.unit && word && isRecipeUnit(word)) join = true;                     // 「鸡蛋 3 个」
    else if (!hasQty && !vague && word && qtyTok(word)) join = true;                           // 「五花肉 500」
    else if (!hasQty && !vague && word && (isRecipeUnit(word) || roughQty(word))) join = true; // 「鸡蛋 2-3 个」「花椒 一小把」：整段当名字
    else if (EACH_NEXT.test(tok)) join = true;                                                 // 「葱 姜 各适量」
    // 「猪蹄 2只 约1kg」：后面的「约1kg」是补充，放进括号（parseSegment 当备注），不然数量会认成 1 kg
    else if (APPROX_NEXT.test(tok)) { if (hasQty || vague) { cur += '（' + tok + '）'; continue; } }
    else if (hasQty && /^\d/.test(tok)) join = false;                                         // 数字开头的下一样
    else if (WORD_START.test(tok)) join = LATIN_END.test(bare) && LATIN_START.test(tok);
    if (join) cur += ' ' + tok;
    else { out.push(cur); cur = tok; }
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
 * 用量按人数换算：qty × servings / recipe.servings（太小的至少 0.01）；qty 是 null 的、食谱没写人数的、servings 不对的原样。
 * 只去掉浮点的零头（六位小数），不在这里按两位四舍五入：每道菜各记一份，加起来才显示（qtyParts / qtyLabel 再四舍五入）——
 * 3 人份的炒饭（洋葱 1 个）做三天、每天 1 人份，先各自四舍五入成 0.33 再相加就是「0.99 个」
 * 换算出来的可以超过 9999（那是输入框的上限：2000 ml 水 2 人份 → 10 人份就是 10000 ml），只在 NEED_MAX 封顶（防写坏的数据）
 * @param {{ servings: number | null, ings: Ingredient[] }} recipe @param {unknown} servings
 * @returns {Ingredient[]}
 */
export function scaleIngredients(recipe, servings) {
  const base = recipe && recipe.servings;
  const want = typeof servings === 'number' && Number.isFinite(servings) && servings > 0 ? servings : null;
  const f = base && base > 0 && want ? want / base : 1;
  return ((recipe && recipe.ings) || []).map(g => ({ ...g, qty: g.qty == null ? null : f === 1 ? g.qty : Math.min(NEED_MAX, Math.max(0.01, Math.round(g.qty * f * 1e6) / 1e6)) }));
}

// ---------- 搜索、联想 ----------
/** @param {Intl.Collator} collator */
const byRecipeName = (collator) => (/** @type {Recipe} */ a, /** @type {Recipe} */ b) => collator.compare(a.name.trim(), b.name.trim()) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * 「食谱」页的搜索：名字、食材、标签都搜，normName 折过再比（简繁、大小写、全角半角）。几个词（空格隔开）每个都要出现在名字、某一样食材或某个标签里。
 * 返回 [{ recipe, ings：命中的食材名（原文，名字里没命中时页面写「用到：…」）}]，按名字排（collator）；空的搜索词 → 全部。
 * nameFirst（计划里选一道菜）：名字开头就是它的在最前，再是名字里有的，只是食材、标签里有的在最后（各自还按名字排）——
 * 搜「鸡」回车选第一道，要的是鸡胸肉沙拉，不是只因为用到鸡蛋排在前面的番茄炒蛋。
 * tags（「食谱」页按标签筛选）：{ cuisine: [...], style: [...] }，见 matchesTags
 * @param {State} state @param {unknown} query @param {Intl.Collator} [collator] @param {{ nameFirst?: boolean, tags?: Partial<Record<string, string[]>> | null }} [opts]
 * @returns {{ recipe: Recipe, ings: string[] }[]}
 */
export function searchRecipes(state, query, collator = collatorFor('zh-Hans'), { nameFirst = false, tags = null } = {}) {
  const terms = searchTerms(query);
  const all = /** @type {Recipe[]} */ (live(state, 'recipes')).filter(r => !tags || matchesTags(r, tags)).sort(byRecipeName(collator));
  if (!terms.length) return all.map(recipe => ({ recipe, ings: [] }));
  const out = [];
  for (const recipe of all) {
    const name = normName(recipe.name), ings = recipe.ings.map(g => normName(g.name)), tg = allTags(recipe).map(normName);
    if (!terms.every(w => name.includes(w) || ings.some(x => x.includes(w)) || tg.some(x => x.includes(w)))) continue;
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

// ---------- 标签（第 11 步） ----------
/**
 * 预设的标签（菜系、风格）：这里是文案的键（rcp.tag.<组>.<键>），显示、存的都是界面语言写出来的那个字
 * （换了界面语言，已经存的不改；同一个意思两种写法时，在编辑页、筛选里各是一个）。只能加，不要改名（键只用来找文案）
 */
export const RECIPE_TAG_PRESETS = Object.freeze({
  cuisine: ['sichuan', 'cantonese', 'hunan', 'shandong', 'jiangzhe', 'dongbei', 'taiwanese', 'homeChinese', 'japanese', 'korean', 'seAsian', 'western', 'italian', 'mexican'],
  style: ['homestyle', 'quick', 'withRice', 'lean', 'vegetarian', 'soup', 'cold', 'breakfast', 'bento', 'dessert', 'baking', 'guests'],
});
/** 食谱的两组标签（整理过的：旧的食谱、坏的数据都是两个数组） @param {Recipe} r @returns {import('./store.js').RecipeTags} */
export const recipeTags = (r) => normalizeTags(r && r.tags);
/** 一道食谱的所有标签（菜系在前） @param {Recipe} r */
const allTags = (r) => { const t = recipeTags(r); return [...t.cuisine, ...t.style]; };

/**
 * 加一个标签（编辑页「自己加」、点预设）：前后的空白去掉；空的 → { ok: false, error }；这一组里已经有 normName 一样的 → 照旧（不重复加）
 * @param {unknown} tags @param {string} group @param {unknown} name
 * @returns {{ ok: true, tags: import('./store.js').RecipeTags } | { ok: false, error: string }}
 */
export function addTag(tags, group, name) {
  const t = normalizeTags(tags);
  const x = str(name).trim();
  if (!x) return { ok: false, error: 'rcp.err.tag' };
  if (!TAG_GROUPS.includes(/** @type {any} */ (group))) return { ok: false, error: 'rcp.err.tag' };
  const k = normName(x);
  const list = /** @type {string[]} */ (t[/** @type {'cuisine' | 'style'} */ (group)]);
  if (!list.some(y => normName(y) === k)) list.push(x);
  return { ok: true, tags: t };
}
/** 去掉一个标签（normName 一样的） @param {unknown} tags @param {string} group @param {unknown} name */
export function removeTag(tags, group, name) {
  const t = normalizeTags(tags), k = normName(name);
  if (TAG_GROUPS.includes(/** @type {any} */ (group))) {
    const g = /** @type {'cuisine' | 'style'} */ (group);
    t[g] = t[g].filter(y => normName(y) !== k);
  }
  return t;
}
/** 这一组里有没有这个标签（normName 比） @param {unknown} tags @param {string} group @param {unknown} name */
export function hasTag(tags, group, name) {
  const t = /** @type {Record<string, string[]>} */ (normalizeTags(tags)), k = normName(name);
  return !!k && (t[group] || []).some(y => normName(y) === k);
}

/**
 * 没删除的食谱用到的标签：{ cuisine: [{ name, n }], style: [...] }，n 是几道食谱用了它。normName 一样的算一个（写法用最多的那个，一样多取排在前面的）；
 * 按用得多的在前、再按名字（collator）。「食谱」页的筛选只列这些（没有食谱用的标签筛了也是空的）
 * @param {State} state @param {Intl.Collator} [collator]
 */
export function usedTags(state, collator = collatorFor('zh-Hans')) {
  /** @type {Record<string, { name: string, n: number }[]>} */
  const out = {};
  for (const g of TAG_GROUPS) {
    /** @type {Map<string, { n: number, names: Map<string, number> }>} */
    const m = new Map();
    for (const r of /** @type {Recipe[]} */ (live(state, 'recipes'))) {
      for (const x of recipeTags(r)[g]) {
        const k = normName(x);
        const e = m.get(k) || { n: 0, names: new Map() };
        e.n++; e.names.set(x.trim(), (e.names.get(x.trim()) || 0) + 1);
        m.set(k, e);
      }
    }
    out[g] = [...m.values()].map(e => {
      const name = [...e.names].sort((a, b) => b[1] - a[1] || collator.compare(a[0], b[0]))[0][0];
      return { name, n: e.n };
    }).sort((a, b) => b.n - a.n || collator.compare(a.name, b.name));
  }
  return /** @type {{ cuisine: { name: string, n: number }[], style: { name: string, n: number }[] }} */ (out);
}

/**
 * 编辑页一组标签里列哪些：预设（presets，页面按界面语言用 t() 写出来的字，按原来的顺序）→ 别的食谱用过的（usedTags 的顺序）→
 * 这一道自己有、上面都没有的（mine，刚加的）；normName 一样的只列一个（先来的）
 * @param {State} state @param {string} group @param {string[]} presets @param {string[]} [mine] @param {Intl.Collator} [collator]
 * @returns {string[]}
 */
export function tagChoices(state, group, presets, mine = [], collator = collatorFor('zh-Hans')) {
  const used = /** @type {Record<string, { name: string }[]>} */ (usedTags(state, collator))[group] || [];
  const seen = new Set(), out = [];
  for (const x of [...presets, ...used.map(u => u.name), ...mine]) {
    const k = normName(x);
    if (!k || seen.has(k)) continue;
    seen.add(k); out.push(str(x).trim());
  }
  return out;
}

/**
 * 按标签筛选：sel 是 { cuisine: [...], style: [...] }（选了的标签）。一组里选了几个是「任一」（川菜或湘菜），两组之间是「都要」
 * （川菜里的快手菜）；一组什么也没选就不管这一组。normName 比
 * @param {Recipe} r @param {Partial<Record<string, string[]>>} sel
 */
export function matchesTags(r, sel) {
  const t = /** @type {Record<string, string[]>} */ (recipeTags(r));
  return TAG_GROUPS.every(g => {
    const want = (sel && Array.isArray(sel[g]) ? sel[g] : []).map(normName).filter(Boolean);
    if (!want.length) return true;
    const have = new Set(t[g].map(normName));
    return want.some(k => have.has(k));
  });
}

// ---------- 食材的默认顺序（第 11 步） ----------
/** 食材的几组，按这个顺序排：肉类海鲜 → 蔬果 → 蛋奶豆制品 → 粮油干货 → 调料酱料 → 其他 */
export const ING_GROUPS = /** @type {const} */ (['meat', 'produce', 'dairy', 'pantry', 'condiments', 'other']);
/** @typedef {typeof ING_GROUPS[number]} IngGroup */
// 清单的分类（core/catalog.js 的对照、预置分类的 sys）→ 食材的组。面包、冷冻、零食饮料、日用都归「其他」（做菜时少见：面包糠在粮油干货里）
/** @type {Record<string, IngGroup>} */
const SYS_GROUP = { meat: 'meat', produce: 'produce', dairy: 'dairy', bakery: 'pantry', pantry: 'pantry', condiments: 'condiments' };
// 对照表里没有、做菜常见、靠「最长的键」会分错的（小米辣里有「小米」，干辣椒里有「辣椒」，蒸鱼豉油的结尾是「油」，黄豆酱里有「黄豆」，
// 土豆淀粉里有「土豆」，鱼丸在对照表的冷冻里、做菜时是肉类海鲜，面筋的结尾是「筋」，新鲜的豆子（毛豆、豌豆）不是干货）
/** @type {Map<string, IngGroup>} */
const GROUP_EXTRA = new Map(/** @type {[string, IngGroup][]} */ ([
  ...['牛百叶', '鱼丸', '虾丸', '牛肉丸', '猪肉丸', '虾滑', '鱼滑'].map(k => [k, 'meat']),
  ...['小米辣', '葱姜蒜', '葱姜', '二荆条', '毛豆', '豌豆', '荷兰豆', '青豆', '豇豆', '扁豆', '蚕豆', '甜豆'].map(k => [k, 'produce']),
  ...['粉条', '宽粉', '红薯粉', '淀粉', '玉米淀粉', '土豆淀粉', '红薯淀粉', '生粉', '太白粉', '酵母', '泡打粉', '小苏打', '芝麻', '白芝麻', '黑芝麻', '枸杞', '红枣', '花生米',
    '面筋', '烤麸', '海带', '银耳',
    'cornstarch', 'baking powder', 'baking soda', 'yeast', 'breadcrumbs', 'vanilla extract'].map(k => [k, 'pantry']),
  ...['干辣椒', '辣椒面', '剁椒', '泡椒', '腐乳', '豆腐乳', '豆豉', '豉油', '蒸鱼豉油', '鱼露', '味淋', '味醂', '味噌', '孜然', '桂皮', '香叶', '草果', '丁香', '陈皮',
    '小茴香', '白胡椒', '黑胡椒', '胡椒', '十三香', '红油', '藤椒油', '黄豆酱', '郫县豆瓣', '豆瓣', '腐乳汁', 'cumin', 'paprika', 'cinnamon', 'oregano', 'chili flakes', 'fish sauce', 'mirin', 'miso'].map(k => [k, 'condiments']),
]));
// 豆制品和蛋奶一组（对照表里豆腐在蔬果：超市里它常和菜放在一起；做菜时它是「蛋奶豆制品」）。
// 带「牛」「羊」「猪」的不算：牛百叶是牛肚，不是豆制品
const SOY = ['豆腐', '豆干', '豆皮', '腐竹', '千张', '百叶', '素鸡', '豆泡', 'tofu'];
const OFFAL = /[牛羊猪]/;
// 对照表也猜不出时，看中文名字的结尾 / 开头（鲫鱼、肋排、菜籽油、蒜末、葱花……）；猜不出的是「其他」
/** @type {[string, IngGroup][]} */
const ENDS = [['盐', 'condiments'], ['糖', 'condiments'], ['醋', 'condiments'], ['酱', 'condiments'], ['酒', 'condiments'], ['粉', 'condiments'],
  ['油', 'pantry'], ['米', 'pantry'], ['饭', 'pantry'], ['面', 'pantry'],
  ['肉', 'meat'], ['鱼', 'meat'], ['虾', 'meat'], ['蟹', 'meat'], ['排', 'meat'], ['腩', 'meat'], ['蹄', 'meat'], ['爪', 'meat'], ['鸡', 'meat'], ['鹅', 'meat'],
  ['肠', 'meat'], ['肝', 'meat'], ['血', 'meat'], ['肚', 'meat'], ['筋', 'meat'], ['丸', 'meat'], ['滑', 'meat'], ['胗', 'meat'],   // 腊肠、猪肝、鸭血、毛肚、牛筋、虾滑：火锅、卤味常见
  ['蛋', 'dairy'], ['奶', 'dairy'],
  ['菜', 'produce'], ['菇', 'produce'], ['笋', 'produce'], ['瓜', 'produce'], ['椒', 'produce'], ['葱', 'produce'], ['姜', 'produce'], ['蒜', 'produce']];
const STARTS = ['葱', '姜', '蒜'];
const HAN = /[㐀-鿿豈-﫿]/;

/**
 * 一样食材归哪一组（默认顺序用）：清单上自己选过分类的（memory 的 categorySet，选的是预置分类）→ 上面几个做菜常见的 →
 * 豆制品 → core/catalog.js 的对照（和清单上的分类同一张表）→ 中文名字的结尾（「…鱼」「…油」）、开头（「葱花」「姜片」）→ 其他
 * @param {State} state @param {unknown} name @returns {IngGroup}
 */
export function ingredientGroup(state, name) {
  const key = normName(name);
  if (!key) return 'other';
  // 分错了改一次就记住了：在清单上把它改到哪个分类，食谱里也按那个排
  const m = memoryOf(state, key);
  if (m && m.categorySet && m.categoryId) {
    const c = own(isObj(state.data.categories) ? state.data.categories : {}, m.categoryId);
    if (c && !c.deleted && GROCERY_CATEGORIES.includes(c.sys)) return SYS_GROUP[c.sys] || 'other';
  }
  const extra = GROUP_EXTRA.get(key);
  if (extra) return extra;
  const sys = catalogSys(key);
  if (sys !== 'condiments' && !OFFAL.test(key) && SOY.some(w => key.includes(w))) return 'dairy';
  if (sys) return SYS_GROUP[sys] || 'other';
  if (HAN.test(key)) {
    for (const [end, g] of ENDS) if (key.endsWith(end)) return g;
    if ([...key].length <= 3 && STARTS.includes(key[0])) return 'produce';
  }
  return 'other';
}

/**
 * 按组排（ING_GROUPS 的顺序），同一组里保持原来的先后（稳定）。返回新的数组，里面还是原来那几个对象
 * @template {{ name: string }} T @param {State} state @param {T[]} ings @returns {T[]}
 */
export function sortIngredients(state, ings) {
  return ings.map((g, i) => ({ g, i, k: ING_GROUPS.indexOf(ingredientGroup(state, g.name)) })).sort((a, b) => a.k - b.k || a.i - b.i).map(x => x.g);
}

/**
 * 新加的几样放到哪（编辑页：粘贴进来的马上放，「加一样」写的保存时放）：ordered 不是 true（新建的食谱、还没手动排过）→ 整张按组排；
 * 是 true（手动 ↑↓ 排过，或者是已经存过的食谱：原来的几行不自己挪）→ 别的不动，新的（keys）一样一样插到它那一组的最后（这一组还没有的，放在前面几组的最后；前面也没有就放最前）。
 * keys 里一个也不在 ings 里 → 原样。返回新的数组
 * @template {{ key: string, name: string }} T @param {State} state @param {T[]} ings @param {Iterable<string>} keys @param {boolean} ordered @returns {T[]}
 */
export function placeIngredients(state, ings, keys, ordered) {
  const add = new Set(keys);
  if (!ings.some(g => add.has(g.key))) return ings.slice();
  if (!ordered) return sortIngredients(state, ings);
  const rank = (/** @type {T} */ g) => ING_GROUPS.indexOf(ingredientGroup(state, g.name));
  const out = ings.filter(g => !add.has(g.key));
  for (const g of ings) {
    if (!add.has(g.key)) continue;
    const k = rank(g);
    let at = -1;
    out.forEach((x, i) => { if (rank(x) === k) at = i + 1; });
    if (at < 0) out.forEach((x, i) => { if (rank(x) < k) at = i + 1; });
    out.splice(Math.max(0, at), 0, g);
  }
  return out;
}

// ---------- 重复的食材（第 11 步） ----------
/**
 * 这道食谱里已经有的同一样（normName 一样，跳过 skipKey 那一行自己）：第一行；没有、名字空着 → null
 * @template {{ key: string, name: string }} T @param {{ ings: T[] }} recipe @param {unknown} name @param {string | null} [skipKey] @returns {T | null}
 */
export function duplicateOf(recipe, name, skipKey = null) {
  const k = normName(name);
  if (!k) return null;
  return ((recipe && recipe.ings) || []).find(g => g.key !== skipKey && normName(g.name) === k) || null;
}

/** 两段备注接起来：有一边空的就是另一边；已经写着的不重复写；有汉字用「；」，英文用「; 」 @param {string} a @param {string} b */
function joinNote(a, b) {
  const x = str(a).trim(), y = str(b).trim();
  if (!y || normName(x).includes(normName(y))) return x;
  if (!x) return y;
  return x + (HAN.test(x + y) ? '；' : '; ') + y;
}

/**
 * 「合并」重复的一行（编辑页的提醒）：原来那一行的数量、单位一直留着——两边都写了数量、单位一样（normName 比，「ML」「ml」一样）就相加；
 * 这次没写数量（多半是刚写了名字就点「合并」）只接上这次的备注；单位不一样、原来那一行没写数量、加起来超过 9999（QTY_MAX，保存时会报错）时
 * 这次的数量和单位写进那一行的备注（「2 勺」+「15 ml」→ 2 勺，备注「15 ml」），不悄悄丢掉。这次的备注接在后面。
 * 返回合并好的 { qty, unit, note }（into 的名字、key、别的字段不动）
 * @param {{ qty: number | null, unit: string, note: string }} into @param {{ qty: number | null, unit: string, note: string }} add
 */
export function mergeIngredient(into, add) {
  const keep = { qty: into.qty, unit: into.unit };
  if (add.qty == null) return { ...keep, note: joinNote(into.note, add.note) };
  const sum = into.qty != null && normName(into.unit) === normName(add.unit) ? Math.round((into.qty + add.qty) * 1e6) / 1e6 : null;
  if (sum != null && sum <= QTY_MAX) return { qty: sum, unit: into.unit, note: joinNote(into.note, add.note) };
  return { ...keep, note: joinNote(into.note, [qtyLabel(add.qty, add.unit), str(add.note).trim()].filter(Boolean).join(' ')) };
}

// ---------- 食材替换（第 11 步） ----------
/**
 * 「食材替换」第一步的搜索：没删除的食谱里用到的食材（normName 一样的算一样；写法用最多的那个），名字里有每个搜索词的；
 * [{ name, n：几道食谱用到 }]，名字开头就是搜索词的在前，再按用得多的、名字（collator）。最多 limit 个；空的搜索词列全部
 * @param {State} state @param {unknown} query @param {Intl.Collator} [collator] @param {{ limit?: number }} [opts]
 */
export function ingredientNames(state, query, collator = collatorFor('zh-Hans'), { limit = 50 } = {}) {
  const terms = searchTerms(query);
  /** @type {Map<string, { recipes: Set<string>, names: Map<string, number> }>} */
  const m = new Map();
  for (const r of /** @type {Recipe[]} */ (live(state, 'recipes'))) {
    for (const g of r.ings) {
      const k = normName(g.name);
      if (!k || !terms.every(w => k.includes(w))) continue;
      const e = m.get(k) || { recipes: new Set(), names: new Map() };
      e.recipes.add(r.id); e.names.set(g.name.trim(), (e.names.get(g.name.trim()) || 0) + 1);
      m.set(k, e);
    }
  }
  const head = terms.join(' ');
  return [...m].map(([k, e]) => ({ k, name: [...e.names].sort((a, b) => b[1] - a[1] || collator.compare(a[0], b[0]))[0][0], n: e.recipes.size }))
    .sort((a, b) => (head ? Number(!a.k.startsWith(head)) - Number(!b.k.startsWith(head)) : 0) || b.n - a.n || collator.compare(a.name, b.name))
    .slice(0, limit).map(({ name, n }) => ({ name, n }));
}

/**
 * 换之前先看看：用到这样食材（normName 一样，不是包含）的没删除的食谱和那几行，按食谱名字排
 * @param {State} state @param {unknown} from @param {Intl.Collator} [collator]
 * @returns {{ recipe: Recipe, rows: Ingredient[] }[]}
 */
export function replacePreview(state, from, collator = collatorFor('zh-Hans')) {
  const k = normName(from);
  if (!k) return [];
  return /** @type {Recipe[]} */ (live(state, 'recipes')).sort(byRecipeName(collator))
    .map(recipe => ({ recipe, rows: recipe.ings.filter(g => normName(g.name) === k) })).filter(x => x.rows.length);
}

/**
 * 换成 to 以后哪几道食谱里会有两行一样的：这道食谱里本来就有一行叫 to 的（normName 一样、不是要换的那几行）。按食谱名字排。
 * 只是换个写法（normName(to) 和 from 一样）、to 空着 → []。面板上提醒一句，不拦着（腌料、调味各一份盐本来就可以两行）
 * @param {State} state @param {unknown} from @param {unknown} to @param {Intl.Collator} [collator]
 * @returns {Recipe[]}
 */
export function replaceDuplicates(state, from, to, collator = collatorFor('zh-Hans')) {
  const k = normName(from), t = normName(to);
  if (!k || !t || t === k) return [];
  return replacePreview(state, from, collator).filter(({ recipe }) => recipe.ings.some(g => normName(g.name) === t)).map(x => x.recipe);
}

/**
 * 食材替换：所有没删除的食谱里 normName 和 from 一样的那几行改名成 to（数量、单位、备注、key 都不动）。在一次 ctx.mutate 里（能撤销）。
 * from 是常备品的话，to 也标上、from 的去掉（只是换了写法、normName 一样的是同一条，不动）。清单上的东西、已经加进清单的用量不改
 * （那是当时加的，改名字会让「这道菜已经加过」对不上，也不该悄悄改清单）。返回 { recipes：改了几道, rows：几行 }；to 空着什么也不改
 * @param {State} state @param {unknown} from @param {unknown} to @param {number} [now]
 */
export function replaceIngredient(state, from, to, now = Date.now()) {
  const k = normName(from), name = str(to).trim();
  if (!k || !name) return { recipes: 0, rows: 0 };
  let recipes = 0, rows = 0;
  for (const { recipe } of replacePreview(state, from)) {
    let n = 0;
    const ings = recipe.ings.map(g => (normName(g.name) === k && g.name !== name ? (n++, { ...g, name }) : g));
    if (!n) continue;
    writeRecord(state, 'recipes', { ...recipe, ings }, now);
    recipes++; rows += n;
  }
  if (normName(name) !== k && isStaple(state, from)) {
    setStaple(state, name, true, now);
    setStaple(state, /** @type {string} */ (from), false, now);
  }
  return { recipes, rows };
}

// ---------- 新建、改、删 ----------
/**
 * @typedef {{ key?: unknown, name?: unknown, qty?: unknown, unit?: unknown, note?: unknown, optional?: unknown }} IngInput
 * @typedef {{ name?: unknown, servings?: unknown, steps?: unknown, source?: unknown, note?: unknown, ings?: IngInput[], tags?: unknown, ordered?: unknown, place?: unknown, photo?: unknown }} RecipeInput
 * 编辑页交来的（数量、几人份可以是输入框里的字）。tags、ordered、photo 没给就不动原来的（别处调 saveRecipe、旧版的草稿不会冲掉成品图）；
 * photo: null 是删掉成品图；place：「加一样」新写的那几行的 key（保存时按类别放好，见 placeIngredients）
 */
const blankRow = (/** @type {IngInput} */ g) => !str(g.name).trim() && !str(g.qty).trim() && !str(g.unit).trim() && !str(g.note).trim();

/**
 * 检查编辑页交来的食谱：名字不能空；几人份空着（没写）或 0 < n ≤ 99；食材一行一样：全空的行扔掉，有别的没名字的报错，
 * 数量空着（适量）或 0 < q ≤ 9999。返回整理好的（clean）或错误（文案的键；食材的错误按交来的第几行：errors.ings[i]）。
 * 给了 tags / ordered / photo 才放进 clean（没给的保存时照原来的）
 * @param {RecipeInput} input
 * @returns {{ ok: boolean, clean: { name: string, servings: number | null, steps: string, source: string, note: string, ings: IngInput[], tags?: import('./store.js').RecipeTags, ordered?: boolean, photo?: import('./store.js').Photo | null },
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
  /** @type {ReturnType<typeof validateRecipe>['clean']} */
  const clean = { name, servings: sv !== null && Number.isFinite(sv) ? sv : null, steps: str(input.steps), source: str(input.source).trim(), note: str(input.note), ings };
  if (input.tags !== undefined) clean.tags = normalizeTags(input.tags);
  if (input.ordered !== undefined) clean.ordered = input.ordered === true;
  if (input.photo !== undefined) clean.photo = normalizePhoto(input.photo);
  return { ok: !Object.keys(errors).length, clean, errors };
}

/**
 * 保存食谱（编辑页的「保存」）：id 是 null 就新建（newId('r_')）。食材的 key 照留（排顺序、改名都不变），新的行给一个新的；
 * 原来那一行上不认识的字段（新版加的）照样留着。input.place 里的（「加一样」新写的）按类别放好：新建的、没手动排过的整张按组排，
 * 已经存过的、手动排过的只把它们放进各自那一组的最后（placeIngredients），原来的几行不动。有错什么也不改，返回错误。这道食谱已经删了 → errors.recipe
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
  let ings = v.clean.ings.map(g => {
    let key = typeof g.key === 'string' && safeKey(g.key) && !seen.has(g.key) ? g.key : '';
    if (!key) do key = newId('g_'); while (seen.has(key));
    seen.add(key);
    return /** @type {Ingredient} */ ({ ...(old.get(key) || {}), ...g, key });
  });
  const ordered = v.clean.ordered !== undefined ? v.clean.ordered : !!(prev && prev.ordered);
  // 已经存过的食谱，原来那几行不自己挪（第 11 步以前存的没有 ordered，可能是以前用 ↑↓ 排好的，悄悄整张重排就找不回来了）：
  // 只把新的放进它那一组的最后；整张排只在新建的（还没手动排过）和「按类别重新排」
  if (Array.isArray(input.place)) ings = placeIngredients(state, ings, input.place.filter(k => typeof k === 'string'), ordered || !!prev);
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
