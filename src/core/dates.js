// @ts-check
// 时间的显示（最近删除、同步状态、上次备份、令牌到期）：按本机时区，三种语言。界面语言由页面传进来（core 不管界面语言状态），
// 所以「今天」「昨天」这几个字写在这里，不进文案表。中文用 24 小时制，英文用 AM / PM。
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WORDS = {
  'zh-Hans': { today: '今天', yesterday: '昨天' },
  'zh-Hant-TW': { today: '今天', yesterday: '昨天' },
  en: { today: 'Today', yesterday: 'Yesterday' },
};
const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
const isEn = (/** @type {string} */ lang) => lang === 'en';
/** @param {unknown} ms @returns {Date | null} */
const dateOf = ms => { const n = Number(ms); if (!Number.isFinite(n) || n <= 0) return null; const d = new Date(n); return Number.isNaN(d.getTime()) ? null : d; };
/** 本机的日历日（比较是不是同一天） @param {Date} d */
const dayKey = d => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();

/** 14:05 / 2:05 PM @param {unknown} ms @param {string} [lang] */
export function fmtClock(ms, lang = 'zh-Hans') {
  const d = dateOf(ms);
  if (!d) return '';
  const H = d.getHours(), mm = pad(d.getMinutes());
  return isEn(lang) ? `${H % 12 || 12}:${mm} ${H < 12 ? 'AM' : 'PM'}` : `${H}:${mm}`;
}
/** 2026年11月4日 / Nov 4, 2026；year: false → 11月4日 / Nov 4 @param {unknown} ms @param {string} [lang] @param {{ year?: boolean }} [opts] */
export function fmtDay(ms, lang = 'zh-Hans', { year = true } = {}) {
  const d = dateOf(ms);
  if (!d) return '';
  const y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
  if (isEn(lang)) return year ? `${MON[m - 1]} ${day}, ${y}` : `${MON[m - 1]} ${day}`;
  return year ? `${y}年${m}月${day}日` : `${m}月${day}日`;
}
/**
 * 某一刻，说给人听的：今天 → 今天 14:05 / Today at 2:05 PM；昨天 → 昨天 14:05；今年 → 11月4日 14:05 / Nov 4 at 2:05 PM；更早 → 2025年11月4日 / Nov 4, 2025
 * @param {unknown} ms @param {string} [lang] @param {number} [now]
 */
export function fmtWhen(ms, lang = 'zh-Hans', now = Date.now()) {
  const d = dateOf(ms), n = dateOf(now) || new Date();
  if (!d) return '';
  const w = WORDS[/** @type {keyof typeof WORDS} */ (lang)] || WORDS['zh-Hans'];
  const yest = new Date(n.getFullYear(), n.getMonth(), n.getDate() - 1);
  const head = dayKey(d) === dayKey(n) ? w.today : dayKey(d) === dayKey(yest) ? w.yesterday : d.getFullYear() === n.getFullYear() ? fmtDay(ms, lang, { year: false }) : null;
  if (!head) return fmtDay(ms, lang);
  return isEn(lang) ? `${head} at ${fmtClock(ms, lang)}` : `${head} ${fmtClock(ms, lang)}`;
}
/** 很短的（同步标签里）：今天 → 14:05；今年 → 11月4日 / Nov 4；更早 → 带年份 @param {unknown} ms @param {string} [lang] @param {number} [now] */
export function fmtShort(ms, lang = 'zh-Hans', now = Date.now()) {
  const d = dateOf(ms), n = dateOf(now) || new Date();
  if (!d) return '';
  if (dayKey(d) === dayKey(n)) return fmtClock(ms, lang);
  return fmtDay(ms, lang, { year: d.getFullYear() !== n.getFullYear() });
}
/** 完整的日期和时间（句子中间用，不说「今天」）：2026年11月4日 14:05 / Nov 4, 2026, 2:05 PM @param {unknown} ms @param {string} [lang] */
export function fmtFull(ms, lang = 'zh-Hans') {
  if (!dateOf(ms)) return '';
  return isEn(lang) ? `${fmtDay(ms, lang)}, ${fmtClock(ms, lang)}` : `${fmtDay(ms, lang)} ${fmtClock(ms, lang)}`;
}
/** 隔了几个日历日（本机时区；今天 0、昨天 1，「上次备份：3 天前」）：按日子数，不按 24 小时算；没有 / 不对 → null @param {unknown} ms @param {number} [now] */
export function daysAgo(ms, now = Date.now()) {
  const d = dateOf(ms), n = dateOf(now) || new Date();
  if (!d) return null;
  // 用 UTC 算两个本机日期之间差几天：夏令时那天只有 23 / 25 小时，直接除 24 小时会差一天
  const utc = (/** @type {Date} */ x) => Date.UTC(x.getFullYear(), x.getMonth(), x.getDate());
  return Math.max(0, Math.round((utc(n) - utc(d)) / 86400000));
}
/** 本机日期 YYYYMMDD（备份的文件名） @param {Date} [d] */
export const ymd = (d = new Date()) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
/**
 * <input type=date> 的值 'YYYY-MM-DD' → 那天本机时间 23:59 的毫秒（令牌到期日：当天还能用）；不对 → null。
 * 用键盘填日期时年份是一位一位进去的（0002 → 0020 → 0202 → 2027），每一步都是「合法」的日期：2000 年以前的不收
 * @param {unknown} s
 */
export function endOfDay(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof s === 'string' ? s : '');
  if (!m || +m[1] < 2000) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], 23, 59);
  return d.getMonth() === +m[2] - 1 && d.getDate() === +m[3] ? d.getTime() : null;     // 2月30日这种不收
}
/** 毫秒 → 那天的 'YYYY-MM-DD'（本机日期；endOfDay 反过来：<input type=date> 的值、同步码里的到期日）；没有 → '' @param {unknown} ms */
export function dayValue(ms) {
  const d = dateOf(ms);
  return d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : '';
}
