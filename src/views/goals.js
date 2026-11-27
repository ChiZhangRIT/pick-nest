// 设置 → 饮食目标（#/settings/goals，第 13 步）：每天热量（千卡）、蛋白质 / 碳水 / 脂肪（克），都可以不填。推入的页面（ui/dom.js 的 pushFrame）。
// 存在同步的设置里，一样一个键 goals.kcal…（core/log.js 的 setGoals：一个框一个框地存，各自按 settingsAt 合并），日历里每天的合计和它比。
// 一个框写完（离开输入框、回车）就存，不用找「保存」：写错的（读不出来、负数、太大）标在那一格下面、不存；空着、0 是不设。存上了下面说一句「已保存」。
// 自己管更新（返回 onChange）：别的设备同步来的目标只改没在打字的那几格，正在写的不被冲掉。
import { h, pushFrame } from '../ui/dom.js';
import { t } from '../i18n.js';
import { field, showErr, onEnter } from '../ui/form.js';
import { goalsOf, setGoals, NUTRIENTS } from '../core/log.js';
import { formatQty } from '../core/parse.js';

const LABEL = { kcal: 'log.goalKcalField', protein: 'log.proteinField', carbs: 'log.carbsField', fat: 'log.fatField' };
const shown = (/** @type {number | null} */ v) => (v == null ? '' : formatQty(v));

export function goalsPage(main, params, ctx) {
  const page = pushFrame(main, ctx, t('log.goals'), { cls: 'goals' });
  const status = h('p.small.muted.gl-status', { role: 'status' });
  /** @type {Record<string, any>} */
  const ins = {}, rows = {};
  const g0 = goalsOf(ctx.state);
  for (const k of NUTRIENTS) {
    ins[k] = h('input.f-in.nut-in', { type: 'text', inputmode: k === 'kcal' ? 'numeric' : 'decimal', value: shown(g0[k]), autocomplete: 'off', enterkeyhint: 'done',
      dataset: { fid: 'gl-' + k }, onkeydown: onEnter(() => ins[k].blur()), onchange: () => commit(k),
      oninput: () => { showErr(rows[k], null); status.textContent = ''; } });
    rows[k] = field(t(LABEL[k]), ins[k]);
  }
  function commit(k) {
    const res = ctx.mutate(st => setGoals(st, { [k]: ins[k].value }, Date.now()));
    if (!res.ok) { showErr(rows[k], res.errors[k] || null); return; }
    showErr(rows[k], null);
    ins[k].value = shown(goalsOf(ctx.state)[k]);      // 写成存下来的样子（「0」是不设、「1800.4」是 1800）
    if (res.changed) status.textContent = t('log.saved');
  }
  page.append(h('div.form.gl-form', null,
    rows.kcal,
    h('div.lg-nut-grid', null, rows.protein, rows.carbs, rows.fat),
    h('p.f-help', null, t('log.goalsHelp')),
    status,
    h('p.group-foot.gl-note', null, t('log.goalsNote'))));
  return {
    onChange() {
      const g = goalsOf(ctx.state);
      for (const k of NUTRIENTS) if (document.activeElement !== ins[k]) ins[k].value = shown(g[k]);
    },
  };
}
