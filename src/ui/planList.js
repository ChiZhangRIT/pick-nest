// 「生成购物清单」的面板（「计划」页右上角）：
//   从哪天到哪天（一开始是页面上正在看的这一周，周一到周日；也能自己选）、加到哪张食材清单（默认「食材」，core/recipes.js 的 groceryLists / defaultTarget）、
//   这几天连着食谱的菜的食材，同名同单位合成一行（core/plan.js 的 planLines：按各道菜的人数换算，写着来自哪几道菜），每行一个勾：
//   常备品、可选的、已经为这几道菜买过的默认不勾；清单上已经有的写出来；这几道菜已经在清单上的照样勾着（再生成一次是替换，不会加成两份；去掉勾就拿掉，
//   一个也不勾时按钮变成「拿掉（N 样）」）。
//   每行能标 / 取消「常备品」（和「加到清单」一样：按名字记，标上顺手取消勾；确认时才记下）。没连食谱的菜说一声不算在里面。
// 确认 = 一次 ctx.mutate（generateList：每道菜用自己的来源 'p:<id>' 加进清单），能撤销。
// 换日子、换清单只重画下面的几行，勾和常备品按行的 key / 名字记着。面板不在页面里：数据变了页面重画不会打断它。
import { h } from './dom.js';
import { t } from '../i18n.js';
import { field, showErr } from './form.js';
import { planLines, generateList } from '../core/plan.js';
import { groceryLists, defaultTarget } from '../core/recipes.js';
import { qtyLabel } from '../core/parse.js';
import { listName, normName, hash64 } from '../core/store.js';
import { isDay, weekdayName, fmtPlanDay, dayDiff } from '../core/dates.js';

/** planListSheet(ctx, { from, to })：打开面板（from / to 是一开始的那一周） */
export function planListSheet(ctx, { from, to }) {
  const lang = ctx.lang();
  const lists = groceryLists(ctx.state);
  let target = defaultTarget(ctx.state);
  const checked = new Map();          // 行的 key → 勾没勾（没碰过的按默认）
  const staples = new Map();          // normName → { name, on }（这次标 / 取消的）

  const fromIn = h('input.f-in', { type: 'date', value: from, min: '2000-01-01', max: '2999-12-31', dataset: { fid: 'pl-from' }, onchange: () => draw(), oninput: () => draw() });
  const toIn = h('input.f-in', { type: 'date', value: to, min: '2000-01-01', max: '2999-12-31', dataset: { fid: 'pl-to' }, onchange: () => draw(), oninput: () => draw() });
  const fromRow = field(t('plan.from'), fromIn), toRow = field(t('plan.to'), toIn);
  const listSel = h('select.f-in', { dataset: { fid: 'pl-list' }, onchange: () => { target = listSel.value; draw(); } },
    lists.map(l => h('option', { value: l.id }, listName(l, t))));
  if (target) listSel.value = target;

  const skippedEl = h('p.f-help.pl-skipped');
  const list = h('ul.group.atl-list.pl-list');
  const againHelp = h('p.f-help.pl-again', null, t('plan.genAgainHint'));
  const stapleHelp = h('p.f-help', null, t('rcp.atlStapleHint'));
  const emptyEl = h('p.f-help.pl-empty', null, t('plan.genEmpty'));
  const ings = h('div.f-row.atl-ings', null, h('div.f-label', null, t('plan.genIngs')), list, againHelp, stapleHelp);
  const err = h('p.f-err.atl-err', { role: 'alert', hidden: true });
  const goBtn = h('button.btn.primary', { type: 'button', dataset: { fid: 'pl-go' }, onclick: () => go() });

  const range = () => ({ from: fromIn.value, to: toIn.value });
  const rangeOk = () => { const r = range(); return isDay(r.from) && isDay(r.to) && r.from <= r.to; };
  const current = () => (rangeOk() ? planLines(ctx.state, range().from, range().to, { listId: target }) : { lines: [], dishes: [], skipped: [] });
  /** 现在画着的几行（每次 draw 算一遍；勾一下只数这几行，不重算） */
  let shown = /** @type {ReturnType<typeof current>} */ ({ lines: [], dishes: [], skipped: [] });
  const stapleOf = (ln) => { const x = staples.get(normName(ln.name)); return x ? x.on : ln.staple; };
  const isOn = (ln) => (checked.has(ln.key) ? checked.get(ln.key) : ln.checked);
  /**
   * 来自哪几道：「红烧肉（周一）、咖喱（周三）」；同一道做了几天的写在一起「燕麦粥（周一、周五）」（不然窄屏上折成好几行）。
   * 选的日子超过一周时写日期「红烧肉（11月23日、11月30日）」：只写星期几会是「（周一、周一）」
   * @param {{ title: string, date: string }[]} srcs
   */
  const dishes = (srcs) => {
    const r = range(), long = rangeOk() && dayDiff(r.from, r.to) >= 7;
    const by = new Map();
    for (const x of srcs) { if (!by.has(x.title)) by.set(x.title, []); by.get(x.title).push(long ? fmtPlanDay(x.date, lang, { weekday: false }) : weekdayName(x.date, lang)); }
    return [...by].map(([title, wds]) => (lang === 'en' ? `${title} (${wds.join(', ')})` : `${title}（${wds.join('、')}）`)).join(lang === 'en' ? ', ' : '、');
  };

  // 行的 key 里有换行（名字 + 单位），不能直接放进 data-fid 再拿去 querySelector：用它的 hash
  function row(ln) {
    const box = h('input.atl-box', { type: 'checkbox', checked: isOn(ln), dataset: { fid: 'pl-' + hash64(ln.key) },
      onchange: () => { checked.set(ln.key, box.checked); err.hidden = true; paintGo(); } });
    const bought = ln.sources.filter(x => x.state === 'bought');
    // 这几道菜已经加过的：说加过多少（确认是换掉这一份，不是再加上去）；清单上还有别的（自己加的、别的菜）再说一共多少
    const hint = ln.bought ? t('plan.bought') : bought.length ? t('plan.boughtFor', { names: dishes(bought) })
      : ln.added ? (ln.addedLabel && ln.haveLabel !== ln.addedLabel ? t('plan.addedTotal', { qty: ln.addedLabel, total: ln.haveLabel })
        : ln.addedLabel ? t('plan.addedQty', { qty: ln.addedLabel }) : t('plan.addedNoQty'))
      : ln.have ? (ln.haveLabel ? t('rcp.atlHave', { qty: ln.haveLabel }) : t('rcp.atlHaveNoQty')) : '';
    const chip = h('button.chip.atl-staple', { type: 'button', 'aria-label': t('rcp.atlStapleOn', { name: ln.name }), 'aria-pressed': String(stapleOf(ln)),
      dataset: { fid: 'pl-st-' + hash64(ln.key) },
      onclick: () => {
        const on = !stapleOf(ln), key = normName(ln.name);
        staples.set(key, { name: ln.name, on });
        // 和「加到清单」一样：标成常备品 = 家里有，同名的几行一起先不勾；取消了照默认勾回来（已经在清单上的、还没买过的、不是可选的）
        for (const x of shown.lines) if (normName(x.name) === key) checked.set(x.key, !on && (x.added || (!x.optional && !x.bought)));
        draw();
      } }, t('rcp.staple'));
    return h('li.atl-row', null,
      h('label.atl-check', null, box,
        h('span.atl-text', null,
          h('span.atl-name', null, ln.name, ln.optional ? h('span.tag', null, t('rcp.optional')) : null),
          h('span.atl-sub', null,
            ln.qty != null ? h('span.atl-qty', null, qtyLabel(ln.qty, ln.unit)) : null,
            h('span.pl-from', null, t('plan.forDishes', { names: dishes(ln.sources) })),
            hint ? h('span.atl-have', null, hint) : null))),
      chip);
  }
  /** 换日子、换清单、标常备品以后重画下面的几行（焦点在哪一行的勾 / 常备品上，重画后放回去） */
  function draw() {
    const a = document.activeElement, fid = a && a.dataset && list.contains(a) ? a.dataset.fid : null;
    const ok = rangeOk();
    showErr(toRow, isDay(fromIn.value) && isDay(toIn.value) && !ok ? 'plan.err.range' : null);
    shown = current();
    const { lines, skipped } = shown;
    list.replaceChildren(...lines.map(row));
    ings.hidden = !lines.length;
    emptyEl.hidden = !!lines.length || !ok;
    againHelp.hidden = !lines.some(l => l.added || l.sources.some(x => x.state === 'bought'));
    skippedEl.hidden = !skipped.length;
    if (skipped.length) skippedEl.textContent = t('plan.genSkipped', { n: skipped.length, name: skipped[0].title.trim() || t('plan.untitled') });
    if (fid) { const el = list.querySelector(`[data-fid="${fid}"]`); if (el) el.focus(); }
    paintGo();
  }
  const picked = () => shown.lines.filter(isOn);
  /** 已经加过、这次去掉了勾的：确认时从清单上拿掉 */
  const dropped = () => shown.lines.filter(l => l.added && !isOn(l));
  const countNames = (/** @type {{ name: string }[]} */ ls) => new Set(ls.map(l => normName(l.name))).size;
  function paintGo() {
    const n = countNames(picked()), off = countNames(dropped());
    // 一个也没勾、但有加过的去掉了勾：确认就是把它们拿掉（去掉勾就拿掉，全去掉也一样），按钮照实说
    goBtn.textContent = !n && off ? t('plan.takeOff', { n: off }) : t('rcp.atlGo', { n });
    goBtn.setAttribute('aria-disabled', String(!(n || off) || !target || !rangeOk()));
  }

  const body = h('div.form.atl.pl', null,
    h('div.pl-range', null, fromRow, toRow),
    h('p.f-help.pl-range-help', null, t('plan.rangeHelp')),
    lists.length ? field(t('rcp.atlList'), listSel) : h('p.f-help.atl-nolist', { role: 'note' }, t('rcp.atlNoList')),
    skippedEl, emptyEl, ings, err);
  const s = ctx.sheet(body, {
    title: t('plan.generate'), cls: 'atl-sheet pl-sheet',
    foot: [h('button.btn', { type: 'button', onclick: () => s.close() }, t('common.cancel')), goBtn],
  });
  draw();

  function go() {
    if (!target || !rangeOk()) { if (!rangeOk()) toIn.focus(); return; }
    const p = picked(), off = countNames(dropped());
    if (!p.length && !off) { err.textContent = t('rcp.atlPickOne'); err.hidden = false; return; }
    const n = countNames(p);
    const changes = Object.fromEntries([...staples.values()].map(x => [x.name, x.on]));
    const l = lists.find(x => x.id === target);
    const { from: f, to: tt } = range();
    ctx.mutate(st => generateList(st, { from: f, to: tt, listId: /** @type {string} */ (target), keys: p.map(x => x.key), staples: changes }, Date.now()),
      { undoLabel: n ? t('rcp.added', { n, name: l ? listName(l, t) : '' }) : t('plan.tookOff', { n: off }) });
    s.close();
  }
  return s;
}
