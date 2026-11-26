// 「计划」（#/plan，第二版）：一周吃什么。两种看法（本机记住：picknest.local 的 planView，core/plan.js 的 planView）：
//   一周：周一到周日七天，‹ › 换一周、「今天」回到这一周；每天一张卡片，按早饭、午饭、晚饭、加餐列出这一天的菜（连着食谱的写食谱名，
//         没连的写写的那句，比如「出去吃」；下面几人份、备注），右上角「+」给这一天加一道菜；
//   一个月：月历（周一开头，每天有几道菜就几个点，最多 3 个），点一天在下面列出那一天的菜（和一周里的卡片一样）。
// 点一道菜打开面板（ui/dishSheet.js）：打开食谱、改人数、挪到别的日子（页面翻过去、滚到那一天）、删除（10 秒内能撤销）。右上角「生成购物清单」（ui/planList.js），
// 一开始是正在看的这一周（看一个月时是选中的那天所在的一周）。
// 看到哪一周、选的哪一天记在这次打开 App 期间（ui，不放地址里）：点进一道食谱再返回，还是刚才那一周。
// 自己管更新（返回 onChange）：数据变了（同步来的、撤销、面板里存的）只重画下面的日子，焦点按 data-fid 放回去。
// ⌘N 加一道菜。不管哪种布局都是一栏（双栏只给清单、商店、食谱三边）。日子是本地日期（core/dates.js：按日历算，夏令时不差一天）。
// 第 12 步：连着的食谱有成品图时，这一行右边一张小图（ui/photo.js；这一页的 object URL 页面清理时放掉）。
import { h, icon } from '../ui/dom.js';
import { t } from '../i18n.js';
import { entriesOn, dayCounts, dishName, planView, MEALS } from '../core/plan.js';
import { liveRecipe } from '../core/recipes.js';
import { formatQty } from '../core/parse.js';
import { todayDay, addDays, weekStart, weekDays, addMonths, monthStart, monthGrid, weekdayName, weekdayLetters, fmtPlanDay, fmtDayRange, fmtMonth } from '../core/dates.js';
import { dishSheet } from '../ui/dishSheet.js';
import { photoPool } from '../ui/photo.js';
import { planListSheet } from '../ui/planList.js';
import { isNewKey, isTextField } from '../ui/form.js';

/** 这次打开 App 期间记着：正在看的那一周（或那个月）里的一天、一个月里选的那一天 */
const ui = { anchor: '', sel: '' };
/** 测试用：回到今天 */
export function resetPlanView() { ui.anchor = ''; ui.sel = ''; }

/** 月历上一天最多画几个点（再多也是 3 个，读屏念几道菜） */
const DOTS_MAX = 3;
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function render(main, params, ctx) {
  const lang = ctx.lang();
  const today = () => todayDay();
  if (!ui.anchor) ui.anchor = today();
  if (!ui.sel) ui.sel = ui.anchor;
  const view = () => planView(ctx.local);

  // ---------- 顶上：生成购物清单、大标题、一周 / 一个月、‹ 哪一周 › 今天 ----------
  const genBtn = h('button.tb-btn', { type: 'button', dataset: { fid: 'plan-gen' }, onclick: () => { const w = weekStart(view() === 'week' ? ui.anchor : ui.sel); planListSheet(ctx, { from: w, to: addDays(w, 6) }); } },
    icon('cart'), h('span.tb-label', null, t('plan.generate')));
  const segBtns = ['week', 'month'].map(v => h('button', { type: 'button', dataset: { v, fid: 'plan-v-' + v }, onclick: () => setView(v) }, t('plan.' + v)));
  const seg = h('div.seg.plan-seg', { role: 'group', 'aria-label': t('plan.view') }, segBtns);
  const prev = h('button.icon-btn.plan-prev', { type: 'button', dataset: { fid: 'plan-prev' }, onclick: () => shift(-1) }, icon('back'));
  const next = h('button.icon-btn.plan-next', { type: 'button', dataset: { fid: 'plan-next' }, onclick: () => shift(1) }, icon('chev'));
  const title = h('h2.plan-range', { 'aria-live': 'polite' });
  const todayBtn = h('button.btn.small.plan-today', { type: 'button', dataset: { fid: 'plan-today' }, onclick: () => goToday() }, t('plan.today'));
  const body = h('div.page.plan-body');
  const photos = photoPool(ctx, main);

  function setView(v) {
    if (view() === v) return;
    // 一周 ↔ 一个月接着看同一处：一周里看的那一天所在的月；一个月里选的那一天所在的一周
    if (v === 'month') ui.sel = ui.anchor; else ui.anchor = ui.sel;
    ctx.setLocal({ planView: v });
    draw();
  }
  function shift(dir) {
    if (view() === 'week') ui.anchor = addDays(weekStart(ui.anchor), dir * 7);
    else {
      ui.anchor = addMonths(ui.anchor, dir);
      // 换到的月里有今天就选今天，没有选 1 号
      ui.sel = monthStart(today()) === ui.anchor ? today() : ui.anchor;
    }
    draw();
  }
  function goToday() { ui.anchor = ui.sel = today(); draw(); }
  const showsToday = () => (view() === 'week' ? weekStart(ui.anchor) === weekStart(today()) : monthStart(ui.anchor) === monthStart(today()));

  function drawHead() {
    const v = view();
    for (const b of segBtns) { const on = b.dataset.v === v; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
    const w = weekStart(ui.anchor);
    // aria-live：只在真的换了一周 / 一个月时改字，不然每次加、删一道菜读屏都把日子重念一遍
    const range = v === 'week' ? fmtDayRange(w, addDays(w, 6), lang) : fmtMonth(ui.anchor, lang);
    if (title.textContent !== range) title.textContent = range;
    prev.setAttribute('aria-label', t(v === 'week' ? 'plan.prevWeek' : 'plan.prevMonth'));
    next.setAttribute('aria-label', t(v === 'week' ? 'plan.nextWeek' : 'plan.nextMonth'));
    // 已经在今天这一周 / 这个月：「今天」点了也不动，灰掉（不藏：藏起来标题会左右跳）
    todayBtn.setAttribute('aria-disabled', String(showsToday() && (v === 'week' || ui.sel === today())));
  }

  // ---------- 一天：卡片 ----------
  function dayCard(day) {
    const isToday = day === today();
    const list = entriesOn(ctx.state, day);
    const add = h('button.icon-btn.pd-add', { type: 'button', 'aria-label': t('plan.addTo', { date: fmtPlanDay(day, lang) }), dataset: { fid: 'pd-add-' + day },
      onclick: () => dishSheet(ctx, { date: day, meal: 'dinner', onSaved: follow }) }, icon('plus'));
    const head = h('div.pd-head', null,
      h('h3.pd-title', null, h('span.pd-wd', null, weekdayName(day, lang)), h('span.pd-date', null, fmtPlanDay(day, lang, { weekday: false })),
        isToday ? h('span.tag.pd-today', null, t('plan.today')) : null),
      add);
    if (!list.length) return h('section.plan-day' + (isToday ? '.today' : ''), { dataset: { day } }, head, h('p.pd-empty', null, t('plan.empty')));
    const rows = [];
    for (const m of MEALS) {
      const mine = list.filter(e => e.meal === m);
      mine.forEach((e, i) => {
        const r = liveRecipe(ctx.state, e.recipeId);
        const name = dishName(ctx.state, e, t);
        const sub = [r && e.servings ? t('rcp.servingsN', { n: formatQty(e.servings) }) : null, e.note.trim().split('\n')[0] || null].filter(Boolean).join(' · ');
        // 同一顿的第二道起不再写「晚饭」（看着是一组），读屏照样念
        rows.push(h('li', null, h('button.group-row.go.pd-dish', { type: 'button', dataset: { fid: 'pd-' + e.id, id: e.id }, onclick: () => dishSheet(ctx, { id: e.id, onSaved: follow }) },
          i === 0 ? h('span.pd-meal', null, t('plan.meal.' + m)) : h('span.pd-meal.cont', null, h('span.sr-only', null, t('plan.meal.' + m))),
          h('span.pd-text', null, h('span.pd-name' + (r ? '' : '.plain'), null, name), sub ? h('span.pd-sub', null, sub) : null),
          // 连着的食谱有成品图：右边一张小图（第 12 步；看一眼就认得是哪道）
          r && r.photo ? photos.view(r.photo, { cls: '.pd-thumb' }) : null)));
      });
    }
    return h('section.plan-day' + (isToday ? '.today' : ''), { dataset: { day } }, head, h('ul.group.pd-list', null, rows));
  }
  /**
   * 存好的菜在别的日子（挪过去了、加到了别的一周）：翻到那一天，并滚到看得见——停在原来的位置的话，周日挪到下周一，
   * 翻过去以后还在页面底下，挪过去的那道和这一周的标题都在屏幕外面。翻到别的一周 / 月先回到顶上（看得到是哪一周），再把那一天滚进来
   */
  function follow(entry) {
    if (!entry || !entry.date) return;
    let flipped = false;
    if (view() === 'week' && weekStart(entry.date) !== weekStart(ui.anchor)) { ui.anchor = entry.date; flipped = true; }
    else if (view() === 'month') { ui.sel = entry.date; if (monthStart(entry.date) !== monthStart(ui.anchor)) { ui.anchor = monthStart(entry.date); flipped = true; } }
    draw();
    const card = body.querySelector(`section[data-day="${entry.date}"]`);
    if (flipped && head.scrollIntoView) head.scrollIntoView({ block: 'start' });
    if (card && card.scrollIntoView) card.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
  }

  // ---------- 一周、一个月 ----------
  function drawWeek() {
    body.replaceChildren(h('div.plan-week', null, weekDays(ui.anchor).map(dayCard)));
  }
  function drawMonth() {
    const grid = monthGrid(ui.anchor);
    const counts = dayCounts(ctx.state, grid[0][0].day, grid.at(-1)[6].day);
    if (monthStart(ui.sel) !== monthStart(ui.anchor)) ui.sel = monthStart(today()) === monthStart(ui.anchor) ? today() : monthStart(ui.anchor);
    const cell = ({ day, inMonth }) => {
      const n = counts.get(day) || 0, on = day === ui.sel;
      const label = n ? t('plan.cellN', { name: fmtPlanDay(day, lang), n }) : fmtPlanDay(day, lang);
      return h('button.pm-cell' + (inMonth ? '' : '.out') + (day === today() ? '.today' : '') + (on ? '.sel' : ''),
        { type: 'button', 'aria-label': label, 'aria-pressed': String(on), dataset: { fid: 'pm-' + day, day },
          // 别的月的日子（前后补上的）：翻到那个月再选上
          // 这个月里的：只换下面那天的卡片，顶上「今天」灰不灰也跟着变（选了别的一天，「今天」又能点了）
          onclick: () => { ui.sel = day; if (!inMonth) ui.anchor = monthStart(day); draw(); } },
        h('span.pm-num', null, String(+day.slice(8))),
        h('span.pm-dots', { 'aria-hidden': 'true' }, Array.from({ length: Math.min(n, DOTS_MAX) }, () => h('span.pm-dot'))));
    };
    const a = document.activeElement, fid = a && a.dataset && body.contains(a) ? a.dataset.fid : null;
    body.replaceChildren(
      h('div.pm', null,
        h('div.pm-head', { 'aria-hidden': 'true' }, weekdayLetters(lang).map(x => h('span', null, x))),
        h('div.pm-grid', null, grid.flat().map(cell))),
      dayCard(ui.sel));
    if (fid) { const el = body.querySelector(`[data-fid="${fid}"]`); if (el) el.focus({ preventScroll: true }); }
  }
  function draw() {
    const a = document.activeElement, fid = a && a.dataset && body.contains(a) ? a.dataset.fid : null;
    drawHead();
    if (view() === 'week') drawWeek(); else drawMonth();
    if (fid) { const el = body.querySelector(`[data-fid="${fid}"]`); if (el && document.activeElement !== el) el.focus({ preventScroll: true }); }
  }

  // ⌘N（别的系统 Ctrl+N）= 加一道菜（和「食谱」页的 ⌘N 新建食谱一样）：一周里加到今天（不在这一周就是这一周的周一），一个月里加到选中的那天；
  // 面板开着、正在别的输入框里打字时不管
  function onShortcut(e) {
    if (!isNewKey(e) || document.querySelector('dialog[open]') || isTextField(document.activeElement)) return;
    e.preventDefault();
    const day = view() === 'month' ? ui.sel : weekStart(ui.anchor) === weekStart(today()) ? today() : weekStart(ui.anchor);
    dishSheet(ctx, { date: day, meal: 'dinner', onSaved: follow });
  }
  document.addEventListener('keydown', onShortcut);

  const head = h('header.page-head', null,
    h('div.toolbar', null, h('span'), genBtn),
    h('div.lt-row', null, h('h1.lt', null, t('nav.plan')), seg),
    h('div.plan-nav', null, prev, title, next, todayBtn));
  main.append(head, body);
  draw();
  return { onChange: () => draw(), cleanup: () => { document.removeEventListener('keydown', onShortcut); photos.revoke(); } };
}
