// @ts-check
// 时间的显示（最近删除、同步状态、上次备份、令牌到期）：按本机时区，三种语言。计划的日子（本地日期 YYYY-MM-DD）怎么算、怎么写也在这里（文件后半）。界面语言由页面传进来（core 不管界面语言状态），
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

// ---------- 本地日期（计划用：'YYYY-MM-DD'，不带时区） ----------
// 计划里的日子是「哪一天」，不是某一刻：存成本地日期的字符串。算日子（加几天、哪一周、哪个月）一律按日历用 Date.UTC 算——
// UTC 没有夏令时，那一天只有 23 / 25 小时也不会多一天、少一天；只有「今天是哪天」看本机时区（todayDay）。一周从周一开始
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86400000;
/** 'YYYY-MM-DD' → [年, 月, 日]；不是真的日子（2月30日）、2000 年以前、3000 年以后的不收（用键盘填日期时年份是一位一位进去的：0002 也是「合法」的日子） @param {unknown} s @returns {[number, number, number] | null} */
export function parseDay(s) {
  const m = DAY_RE.exec(typeof s === 'string' ? s : '');
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (y < 2000 || y > 2999) return null;
  const u = new Date(Date.UTC(y, mo - 1, d));
  return u.getUTCMonth() === mo - 1 && u.getUTCDate() === d ? [y, mo, d] : null;
}
/** 是不是一个能用的日子 @param {unknown} s */
export const isDay = (s) => parseDay(s) != null;
/** @param {Date} u UTC 午夜 */
const dayOfUtc = (u) => `${u.getUTCFullYear()}-${pad(u.getUTCMonth() + 1)}-${pad(u.getUTCDate())}`;
/** 日历上的第几天（UTC 午夜的毫秒）；不是日子 → NaN @param {unknown} s */
const utcOf = (s) => { const p = parseDay(s); return p ? Date.UTC(p[0], p[1] - 1, p[2]) : NaN; };
/** 今天（本机时区的日期） @param {number} [now] */
export const todayDay = (now = Date.now()) => dayValue(now) || dayValue(Date.now());
/** 往后 n 天（n 可以是负的）；不是日子 → '' @param {string} s @param {number} n */
export function addDays(s, n) {
  const p = parseDay(s);
  return p ? dayOfUtc(new Date(Date.UTC(p[0], p[1] - 1, p[2] + Math.trunc(n)))) : '';
}
/** 星期几：周一 0 … 周日 6（一周从周一开始）；不是日子 → -1 @param {string} s */
export function weekdayOf(s) {
  const u = utcOf(s);
  return Number.isFinite(u) ? (new Date(u).getUTCDay() + 6) % 7 : -1;
}
/** 这一周的周一 @param {string} s */
export const weekStart = (s) => (isDay(s) ? addDays(s, -weekdayOf(s)) : '');
/** 这一周七天（周一到周日） @param {string} s @returns {string[]} */
export const weekDays = (s) => (isDay(s) ? Array.from({ length: 7 }, (_, i) => addDays(weekStart(s), i)) : []);
/** 这个月的 1 号 @param {string} s */
export const monthStart = (s) => { const p = parseDay(s); return p ? `${p[0]}-${pad(p[1])}-01` : ''; };
/** 往后 n 个月的 1 号（换月看的时候用：1 月 31 日加一个月不会跑到 3 月） @param {string} s @param {number} n */
export function addMonths(s, n) {
  const p = parseDay(s);
  return p ? dayOfUtc(new Date(Date.UTC(p[0], p[1] - 1 + Math.trunc(n), 1))) : '';
}
/** b 比 a 晚几天（同一天 0，早了是负的）；不是日子 → NaN @param {string} a @param {string} b */
export const dayDiff = (a, b) => Math.round((utcOf(b) - utcOf(a)) / DAY_MS);
/**
 * 月历：盖住这个月的几周（每周七天，周一开头），前后补上个月、下个月的日子
 * @param {string} s 这个月里的任何一天
 * @returns {{ day: string, inMonth: boolean }[][]}
 */
export function monthGrid(s) {
  if (!isDay(s)) return [];
  const first = monthStart(s), last = addDays(addMonths(s, 1), -1), mo = first.slice(0, 7);
  const weeks = [];
  for (let w = weekStart(first); w <= last; w = addDays(w, 7)) weeks.push(Array.from({ length: 7 }, (_, i) => { const day = addDays(w, i); return { day, inMonth: day.slice(0, 7) === mo }; }));
  return weeks;
}

const WEEKDAYS = {
  'zh-Hans': ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
  'zh-Hant-TW': ['週一', '週二', '週三', '週四', '週五', '週六', '週日'],
  en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
};
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** @param {string} lang */
const wdOf = (lang) => WEEKDAYS[/** @type {keyof typeof WEEKDAYS} */ (lang)] || WEEKDAYS['zh-Hans'];
/** 星期几的短名：周一 / 週一 / Mon；i 是 0（周一）… 6，或者一个日子 @param {number | string} i @param {string} [lang] */
export const weekdayName = (i, lang = 'zh-Hans') => wdOf(lang)[typeof i === 'number' ? i : weekdayOf(i)] || '';
/** 月历顶上一排的字：一 二 … 日 / M T … S（中文去掉「周」「週」） @param {string} [lang] */
export const weekdayLetters = (lang = 'zh-Hans') => (isEn(lang) ? ['M', 'T', 'W', 'T', 'F', 'S', 'S'] : wdOf(lang).map(x => x.slice(1)));
/**
 * 计划里的一天：11月23日 周一 / Mon, Nov 23；year 带年份：2026年11月23日 周一 / Mon, Nov 23, 2026；weekday: false 不写星期几
 * @param {string} s @param {string} [lang] @param {{ weekday?: boolean, year?: boolean }} [opts]
 */
export function fmtPlanDay(s, lang = 'zh-Hans', { weekday = true, year = false } = {}) {
  const p = parseDay(s);
  if (!p) return '';
  const [y, m, d] = p, wd = weekday ? weekdayName(s, lang) : '';
  if (isEn(lang)) return (wd ? wd + ', ' : '') + `${MON[m - 1]} ${d}` + (year ? `, ${y}` : '');
  return (year ? `${y}年` : '') + `${m}月${d}日` + (wd ? ' ' + wd : '');
}
/**
 * 一段日子：11月23日 – 29日 / 11月30日 – 12月6日 / Nov 23 – 29 / Nov 30 – Dec 6；不在今年的带年份（跨年的两头都带）。同一天就是那一天
 * @param {string} from @param {string} to @param {string} [lang] @param {number} [now]
 */
export function fmtDayRange(from, to, lang = 'zh-Hans', now = Date.now()) {
  const a = parseDay(from), b = parseDay(to);
  if (!a || !b) return '';
  if (from === to) return fmtPlanDay(from, lang, { weekday: false, year: a[0] !== +todayDay(now).slice(0, 4) });
  const thisYear = +todayDay(now).slice(0, 4);
  const sameYear = a[0] === b[0], showYear = !sameYear || a[0] !== thisYear;
  const sameMonth = sameYear && a[1] === b[1];
  if (isEn(lang)) {
    const left = `${MON[a[1] - 1]} ${a[2]}` + (showYear && !sameYear ? `, ${a[0]}` : '');
    const right = (sameMonth ? '' : `${MON[b[1] - 1]} `) + b[2] + (showYear ? `, ${b[0]}` : '');
    return `${left} – ${right}`;
  }
  const left = (showYear ? `${a[0]}年` : '') + `${a[1]}月${a[2]}日`;
  const right = (showYear && !sameYear ? `${b[0]}年` : '') + (sameMonth ? '' : `${b[1]}月`) + `${b[2]}日`;
  return `${left} – ${right}`;
}
/** 一个月：2026年11月 / November 2026 @param {string} s @param {string} [lang] */
export function fmtMonth(s, lang = 'zh-Hans') {
  const p = parseDay(s);
  if (!p) return '';
  return isEn(lang) ? `${MONTHS_LONG[p[1] - 1]} ${p[0]}` : `${p[0]}年${p[1]}月`;
}
