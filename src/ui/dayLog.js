// 日历里每一天的「吃了什么」（第 13 步；views/plan.js 的每张卡片、一个月里选中的那天都用它）：
//   按早饭、午饭、晚饭、加餐列出这一天记的（名字；几份、蛋白质 / 碳水 / 脂肪（短写法 macroShort，读屏念全的）、备注；右边千卡，估算的写「约」），
//   点一条打开面板改它（ui/logSheet.js）；
//   下面是合计，设了目标的和目标比（还差多少 / 超了多少，热量和每样营养素各一条细进度条）；右上角「+ 记一样吃的」。
//   一周的平均（weekAvgLine，不算还没过完的今天）也在这里。数怎么算都在 core/log.js（sumEntries、goalProgress、weekAverage），这里只画。
// 显示的数：千卡整数、克最多一位小数（存的时候已经整理过，formatQty 不再四舍五入出别的）；写法（kcalText、macroText）在 ui/logSheet.js。
import { h, icon } from './dom.js';
import { t } from '../i18n.js';
import { logOn, sumEntries, goalProgress, goalsOf, weekAverage, MEALS } from '../core/log.js';
import { formatQty } from '../core/parse.js';
import { fmtPlanDay, todayDay } from '../core/dates.js';
import { logSheet, kcalText, macroText, macroShort, dot } from './logSheet.js';

/** 细进度条（读屏不念：旁边的字已经写了多少 / 目标多少） @param {{ ratio: number | null, over: number | null }} p */
const bar = (p) => (p.ratio == null ? null
  : h('div.lg-bar' + (p.over ? '.over' : ''), { 'aria-hidden': 'true' }, h('span', { style: { width: Math.round(p.ratio * 100) + '%' } })));

/** 合计和目标：热量一行（「1450 / 1800 千卡」「还差 350」/「超了 120」），营养素一样一格（有数或者设了目标的才画） */
function totalsBlock(tot, goals) {
  const [kc, ...macs] = goalProgress(tot, goals);
  const kcalVal = kc.goal != null ? t(tot.estimated ? 'log.kcalApprox' : 'log.kcal', { n: `${formatQty(tot.kcal)} / ${formatQty(kc.goal)}` }) : kcalText(tot.kcal, tot.estimated);
  const shown = macs.filter(p => p.goal != null || tot.missing[p.key] < tot.n);
  return h('div.lg-totals', null,
    h('div.lg-tot-k', null,
      h('span.lg-tot-label', null, t('log.total')),
      h('span.lg-tot-val', null, kcalVal),
      kc.goal != null ? h('span.lg-tot-goal' + (kc.over ? '.over' : ''), null, kc.over ? t('log.over', { n: formatQty(kc.over) }) : t('log.left', { n: formatQty(kc.left) })) : null),
    bar(kc),
    shown.length ? h('div.lg-macs', null, shown.map(p => h('div.lg-mac' + (p.over ? '.over' : ''), null,
      h('span.lg-mac-label', null, t('log.' + p.key)),
      h('span.lg-mac-val', null, p.goal != null ? `${formatQty(p.value)} / ${formatQty(p.goal)} g` : `${formatQty(p.value)} g`),
      bar(p)))) : null,
    tot.missing.kcal ? h('p.lg-missing', null, t('log.missingN', { n: tot.missing.kcal })) : null);
}

/**
 * 一天的「吃了什么」：标题 + 「+」、按顿列出的每一条、合计和目标。onSaved(entry)：面板存好以后（页面用来翻到那一天）
 * @param {any} ctx @param {string} day @param {{ lang: string, onSaved?: (e: any) => void }} opts
 */
export function logSection(ctx, day, { lang, onSaved = null }) {
  const entries = logOn(ctx.state, day);
  // 写着字（不只是一个「+」）：卡片右上角那个「+」是加一道菜，两个一样的「+」分不清
  const add = h('button.link-btn.lg-add', { type: 'button', 'aria-label': t('log.addTo', { date: fmtPlanDay(day, lang) }), dataset: { fid: 'lg-add-' + day },
    onclick: () => logSheet(ctx, { date: day, onSaved }) }, icon('plus'), h('span', null, t('log.add')));
  const head = h('div.lg-head', null, h('h4.lg-title', null, t('log.eaten')), entries.length ? null : h('span.lg-none', null, t('log.none')), add);
  if (!entries.length) return h('div.lg', null, head);
  const rows = [];
  for (const m of MEALS) {
    entries.filter(e => e.meal === m).forEach((e, i) => {
      const meal = t('plan.meal.' + m);
      // 每一样一个不折开的小段（「脂肪 9 g」不会折成「脂 / 肪 9 g」），放不下一行时在「 · 」后面折。营养素是短写法（「蛋白 14 · 碳水 48 · 脂肪 9 g」）：
      // 看的是这一行（aria-hidden），读屏念全写的那一句
      const sv = e.servings !== 1 ? t('log.servingsN', { n: formatQty(e.servings) }) : null, note = e.note.trim().split('\n')[0] || null;
      const short = macroShort(e), parts = [sv, ...(short ? short.split(' · ') : []), note].filter(Boolean);
      const sub = parts.length ? [h('span', { 'aria-hidden': 'true' }, parts.flatMap((x, j) => [...(j ? dot() : []), h('span.lg-nw', null, x)])),
        h('span.sr-only', null, [sv, macroText(e) || null, note].filter(Boolean).join(' · '))] : null;
      // 同一顿的第二条起不再写「午饭」（看着是一组），读屏照样念
      rows.push(h('li', null, h('button.group-row.go.lg-row', { type: 'button', dataset: { fid: 'lg-' + e.id, id: e.id }, onclick: () => logSheet(ctx, { id: e.id, onSaved }) },
        i === 0 ? h('span.pd-meal', null, meal) : h('span.pd-meal.cont', null, h('span.sr-only', null, meal)),
        h('span.pd-text', null, h('span.pd-name', null, e.title.trim() || t('plan.untitled')), sub ? h('span.pd-sub', null, sub) : null),
        h('span.lg-kcal' + (e.kcal == null ? '.none' : ''), null, kcalText(e.kcal, e.estimated)))));
    });
  }
  return h('div.lg', null, head, h('ul.group.pd-list.lg-list', null, rows), totalsBlock(sumEntries(entries), goalsOf(ctx.state)));
}

/**
 * 一周的平均（周视图最上面）：记了热量的日子平均每天多少，设了目标写上目标。今天还没过完、不算（记了东西就写「不算今天」）；
 * 这一周今天以前还没记 → null
 * @param {any} ctx @param {string} day
 */
export function weekAvgLine(ctx, day) {
  const a = weekAverage(ctx.state, day, { today: todayDay() });
  if (!a.days || a.kcal == null) return null;
  const goal = goalsOf(ctx.state).kcal;
  return h('p.lg-week', null, t(a.skipsToday ? 'log.weekAvgNoToday' : 'log.weekAvg', { kcal: formatQty(a.kcal), n: a.days }),
    goal != null ? h('span.lg-week-goal', null, ...dot(), h('span.lg-nw', null, t('log.goalKcal', { n: formatQty(goal) }))) : null);
}
