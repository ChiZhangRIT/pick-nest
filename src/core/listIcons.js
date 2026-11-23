// @ts-check
// 清单的图标：一套画好的线条图标（存在 glyph 里）或者自己写的（一个 emoji、一两个字，存在 icon 里），放在带底色的圆角方块上，颜色从一组色调里选。
// 这里只管规则（存什么、显示成什么、默认是什么）；图标的线条在 ui/listTile.js，色调的深浅两套颜色在 styles.css。
// glyph、icon、color 存空的 = 按清单类型的默认（预置的两张清单一直是空的，不用改数据；以后换默认样子也跟着变）。
// 画好的图标不放进 icon（不写成 'i:saw' 之类）：旧版（picknest-v15 和更早的）保存编辑面板时总会交回 icon、再截成第一个字，
// 放在 icon 里的话，旧设备上改个名字，图标就变成字母「i」了。旧版不认识 glyph，原样留着（只显示成默认的 emoji）。
import { str } from './util.js';

/** @typedef {'grocery' | 'general'} ListKind */
/**
 * 显示用：glyph 是画好的图标名，否则显示 text（自己写的一个 emoji 或一两个字；emoji 为真时按 emoji 的大小画，two：两个字，字要小一号）
 * @typedef {{ glyph: string | null, text: string, emoji: boolean, two: boolean, color: string }} ListLook
 */

// 画好的图标，按面板里的顺序：先买东西常用的，再按家、人、爱好、出门排。名字存进数据里（glyph: 'basket'），只能加、不能改名
export const LIST_GLYPHS = [
  'basket', 'carrot', 'bag', 'gift', 'pot', 'coffee',
  'wine', 'pill', 'baby', 'paw', 'shirt', 'shoe',
  'home', 'sofa', 'plant', 'flower', 'hammer', 'saw',
  'roller', 'box', 'book', 'pencil', 'laptop', 'phone',
  'car', 'suitcase', 'ball', 'calendar', 'star', 'heart',
];
// 色调：第一个是 App 的绿。名字存进数据里，只能加、不能改名
export const LIST_COLORS = ['green', 'teal', 'blue', 'indigo', 'rose', 'amber', 'clay', 'graphite'];
/** 按类型的默认样子：食材是绿底菜篮，一般清单是琥珀底购物袋 @type {Record<ListKind, { glyph: string, color: string }>} */
export const LIST_DEFAULTS = { grocery: { glyph: 'basket', color: 'green' }, general: { glyph: 'bag', color: 'amber' } };

/** @param {unknown} kind @returns {ListKind} */
const kindOf = kind => (kind === 'grocery' ? 'grocery' : 'general');

// emoji 认法：图形符号、国旗（两个地区字母）、数字键帽（1️⃣ 的基字是普通数字，要看后面的 20E3）
const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3/u;
/** 这一个字形是不是 emoji @param {string} g */
export const isEmoji = g => EMOJI.test(g);

/** 按「字形」切（一个 emoji 可能由好几个码位组成：👨‍👩‍👧、🇹🇼、1️⃣） @param {string} s @returns {string[]} */
function graphemes(s) {
  if (typeof Intl !== 'undefined' && Intl.Segmenter) return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)].map(x => x.segment);
  return [...s];
}

/**
 * 自己写的图标：一个 emoji，或者开头的一两个字（「木」「木工」「AB」）。方块只有图标那么大，再多就看不清了。
 * 空格、emoji 前面截断（「木 工」→「木」，「木🪵」→「木」）
 * @param {unknown} s
 */
export function customIcon(s) {
  const gs = graphemes(str(s).trim());
  if (!gs.length) return '';
  if (isEmoji(gs[0])) return gs[0];
  const out = [];
  for (const g of gs) { if (/\s/u.test(g) || isEmoji(g) || out.length === 2) break; out.push(g); }
  return out.join('');
}

/** 认得的图标名 → 它；空的、别的（新版才有的名字）→ null @param {unknown} glyph */
export function glyphOf(glyph) {
  const s = str(glyph).trim();
  return LIST_GLYPHS.includes(s) ? s : null;
}

/**
 * 清单显示成什么样：自己写的（icon）在前，再画好的图标（glyph），都没有按类型的默认。
 * 自己写的在前：旧版只会写 icon（选个 emoji），那是这张清单最后一次换的图标；新版换图标时两样一起交，另一样清空（lookFields），不会两样都有。
 * 认不出的（新版才有的图标名、色调）按类型的默认显示，记录里原样留着（旧版改别的不会把它冲掉）；旧版存的 emoji（🪵）照样是自己写的图标
 * @param {{ kind?: unknown, icon?: unknown, glyph?: unknown, color?: unknown } | null | undefined} list
 * @returns {ListLook}
 */
export function listLook(list) {
  const d = LIST_DEFAULTS[kindOf(list && list.kind)];
  const color = LIST_COLORS.includes(/** @type {any} */ (list && list.color)) ? /** @type {string} */ (list && list.color) : d.color;
  const text = customIcon(list && list.icon);
  if (text) return { glyph: null, text, emoji: isEmoji(text), two: graphemes(text).length > 1, color };
  return { glyph: glyphOf(list && list.glyph) || d.glyph, text: '', emoji: false, two: false, color };
}

/**
 * 新建 / 换图标时存什么：图标是一个选择，自己写的（icon，按 customIcon 截）和画好的（glyph，只收认得的名字）只留一样，自己写的优先；
 * 和这一类的默认一样的存成空的（没改过的预置清单还是空的、不盖新时间；默认的样子以后换了也跟着变）。认不出的色调存成空的
 * @param {unknown} kind @param {{ icon?: unknown, glyph?: unknown, color?: unknown }} f
 * @returns {{ icon: string, glyph: string, color: string }}
 */
export function lookFields(kind, f) {
  const d = LIST_DEFAULTS[kindOf(kind)];
  const icon = customIcon(f.icon);
  const g = icon ? null : glyphOf(f.glyph);
  const color = typeof f.color === 'string' && LIST_COLORS.includes(f.color) && f.color !== d.color ? f.color : '';
  return { icon, glyph: g && g !== d.glyph ? g : '', color };
}
