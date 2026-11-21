// @ts-check
// 搜索（#/search?q=）：所有没删除的清单（归档的也算，页面标出来）里没删除的东西，搜名字和备注；要买、以后再说、已买都列（已买的页面画淡）。
// 比较用 store.js 的 normName（全角半角、大小写、繁体折成简体）：搜「雞蛋」找得到「鸡蛋」，搜「鸡蛋」也找得到「雞蛋」。
// 用户写的原文一个字都不改；标出命中的部分（highlight）也是在原文上标，拆成几段交给页面（页面用 textContent 画，不拼 HTML）。
import { normName, live, byOrder } from './store.js';
import { toSimplified } from './hanzi.js';
import { liveList } from './items.js';
import { byName, collatorFor } from './group.js';
import { str } from './util.js';

/** @typedef {import('./store.js').State} State */
/** @typedef {import('./store.js').Item} Item */
/** @typedef {import('./store.js').List} List */

/**
 * 搜索词：折好（normName）以后按空格拆开。每个词都要出现在名字或备注里（可以一个在名字、一个在备注）：
 * 「牛奶 燕麦」找得到「燕麦牛奶」，不要求挨着、按顺序
 * @param {unknown} query @returns {string[]}
 */
export const searchTerms = (query) => normName(query).split(' ').filter(Boolean);

// 「要买」在前，「以后再说」，「已买」最后（和清单页从上到下的顺序一样）
const RANK = { need: 0, later: 1, done: 2 };

/**
 * @typedef {object} Hit
 * @property {Item} item
 * @property {string} note  备注里命中的那一行（原文，去掉首尾空白）；备注里没有命中 → ''（页面照常显示备注的第一行）
 */
/**
 * @typedef {object} HitGroup  一张清单里的结果
 * @property {List} list
 * @property {boolean} archived
 * @property {Hit[]} hits
 */
/**
 * 搜所有清单。空的搜索词 → []。清单按首页的顺序，归档的排在后面；每张里「要买 → 以后再说 → 已买」，同一种按名字（collator）。
 * 删掉的清单里的东西不算（跟着隐藏，和最近删除的规则一样）
 * @param {State} state @param {unknown} query @param {Intl.Collator} [collator]
 * @returns {HitGroup[]}
 */
export function searchItems(state, query, collator = collatorFor('zh-Hans')) {
  const terms = searchTerms(query);
  if (!terms.length) return [];
  /** @type {Map<string, Hit[]>} */
  const byList = new Map();
  for (const it of live(state, 'items')) {
    if (!liveList(state, it.listId)) continue;
    const name = normName(it.name), note = normName(it.note);
    if (!terms.every(w => name.includes(w) || note.includes(w))) continue;
    if (!byList.has(it.listId)) byList.set(it.listId, []);
    /** @type {Hit[]} */ (byList.get(it.listId)).push({ item: it, note: noteLine(it.note, terms) });
  }
  const n = byName(collator);
  const rank = (/** @type {Item} */ it) => RANK[it.status] ?? 0;
  return [...byList.keys()].map(id => /** @type {List} */ (liveList(state, id)))
    .sort((a, b) => Number(a.archived) - Number(b.archived) || byOrder(a, b))
    .map(list => ({ list, archived: list.archived, hits: /** @type {Hit[]} */ (byList.get(list.id)).sort((a, b) => rank(a.item) - rank(b.item) || n(a.item, b.item)) }));
}

/** 一共几样（「找到 N 样」） @param {HitGroup[]} groups */
export const hitCount = (groups) => groups.reduce((k, g) => k + g.hits.length, 0);

/** 备注里第一行有命中的（原文）；没有 → '' @param {unknown} note @param {string[]} terms */
function noteLine(note, terms) {
  for (const line of str(note).split('\n')) {
    const f = normName(line);
    if (f && terms.some(w => f.includes(w))) return line.trim();
  }
  return '';
}

// ---------- 标出命中的部分 ----------
/** @type {Map<string, string>} */
const charCache = new Map();
/**
 * 一个字（码位）折好的样子，和 normName 同一套：NFKC、小写、繁体折成简体。可能不止一个字（「㎏」→「kg」），也可能是空的
 * @param {string} ch
 */
function foldChar(ch) {
  let f = charCache.get(ch);
  if (f === undefined) { f = toSimplified(ch.normalize('NFKC').toLowerCase()); charCache.set(ch, f); }
  return f;
}

/**
 * 把命中的部分标出来 → [{ text, hit }]，拼起来就是原文。简繁、大小写、全角半角都算命中，标的是原文那几个字。
 * 按一个个字折（normName 是整句折）：极少数要连起来才折得成的写法（先写字母再写附加的重音符号）搜得到、标不出来，不影响结果
 * @param {unknown} text @param {unknown} query
 * @returns {{ text: string, hit: boolean }[]}
 */
export function highlight(text, query) {
  const s = str(text);
  const terms = searchTerms(query);
  if (!s || !terms.length) return [{ text: s, hit: false }];
  // 折好的字符串里每个位置对应原文的哪一段
  let folded = '';
  /** @type {number[]} */
  const start = [], end = [];
  let i = 0;
  for (const ch of s) {
    const f = foldChar(ch);
    for (let k = 0; k < f.length; k++) { start.push(i); end.push(i + ch.length); }
    folded += f;
    i += ch.length;
  }
  /** @type {[number, number][]} */
  const ranges = [];
  for (const w of terms) {
    for (let p = folded.indexOf(w); p >= 0; p = folded.indexOf(w, p + 1)) ranges.push([start[p], end[p + w.length - 1]]);
  }
  if (!ranges.length) return [{ text: s, hit: false }];
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  /** @type {[number, number][]} */
  const merged = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  /** @type {{ text: string, hit: boolean }[]} */
  const out = [];
  let at = 0;
  for (const [a, b] of merged) {
    if (a > at) out.push({ text: s.slice(at, a), hit: false });
    out.push({ text: s.slice(a, b), hit: true });
    at = b;
  }
  if (at < s.length) out.push({ text: s.slice(at), hit: false });
  return out;
}
