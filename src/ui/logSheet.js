// 记一样吃的 / 改一条的面板（第 13 步）：日历里每天「吃了什么」的「+」、计划里一道菜的「吃了」、点一条记过的（改它）。
//   吃了什么：上面一个框，打字时联想常吃的（core/foods.js 的 foodSuggestions：开头对上的在前，再按记过几次、最近一次；框空着时列「常吃的」）
//       和食谱（searchRecipes，名字对上的在前）；点常吃的 = 名字和每份营养填好；点食谱 = 选上这道（「换一个」），营养用食谱的每人份；
//       都不点就是自己写的（存的时候记进常吃的，下次联想）；写的正好是常吃的名字（没点它）、营养框还空着：自动填上记住的（再改成别的名字、框没动过，就拿掉）。
//       计划里的菜「吃了」：那道食谱已经选好（只写一句的「出去吃」是框里的字，记过的用记住的营养）、那一天那一顿、1 份。
//   哪一天、哪一顿（新记的默认现在这一顿：core/log.js 的 mealAt）、几份（−/+ 每次半份）、每份营养（热量千卡、蛋白质 / 碳水 / 脂肪克，都能不填），
//   不是 1 份时下面写合计；食谱还没填每人份营养时多一个「也记到食谱里」（默认勾着：下次「吃了」直接带上）；备注。
//   改的时候名字是普通的输入框（是抄下来的，改了也不连到别的上），还有「删除这一条」（不用确认，10 秒内能撤销）。
// 营养是记的时候抄下来的：存的是每份 × 份数的合计（core/log.js 的 addLogEntry）；改的时候框里是每份（合计 ÷ 份数，最多一位小数），
//   只交改了的那几个框（core 的 editedTotals：没动的照原来的合计、份数变了按比例变，不会因为框里四舍五入过就变一点；下面的合计也这样算）。
// 「添加」/「保存」才存；有改动时关面板先问「放弃没保存的修改？」，面板里马上生效的「删除」也先问（closeThen）。面板不在页面里：页面重画不打断输入。
// 显示营养的几个小函数（kcalText、macroText、nutritionLine，画进页面时套 nowrapParts）也在这里：日历的每一天（ui/dayLog.js）、食谱页、设置共用。
import { h, icon } from './dom.js';
import { t } from '../i18n.js';
import { field, showErr, discardGuard, closeThen, onEnter, composing } from './form.js';
import { liveLog, validateLogEntry, addLogEntry, editLogEntry, deleteLogEntry, logFromPlan, logFromRecipe, logFromFood, perServing, editedTotals, mealAt, MEALS, NUTRIENTS, LOG_SERVINGS_MAX } from '../core/log.js';
import { foodSuggestions, foodOf, hasNutrition, scaleNutrition, readNutrition } from '../core/foods.js';
import { liveRecipe, recipeName, searchRecipes } from '../core/recipes.js';
import { collatorFor } from '../core/group.js';
import { formatQty, readQty } from '../core/parse.js';
import { todayDay, fmtPlanDay } from '../core/dates.js';

const MACROS = ['protein', 'carbs', 'fat'];
/** 「520 千卡」「约 520 千卡」；没填 → 「没填热量」 @param {number | null | undefined} n @param {boolean} [approx] */
export const kcalText = (n, approx = false) => (n == null ? t('log.noKcal') : t(approx ? 'log.kcalApprox' : 'log.kcal', { n: formatQty(n) }));
/**
 * 「蛋白质 25 g · 碳水 30 g · 脂肪 35 g」（没填的那几样不写；一样也没有 → ''）。名字、数、单位之间是不折行的空格（U+00A0）：
 * 放不下一行时只在「 · 」那里折，不会折成「脂肪 50 / g」（热量的「620 千卡」在文案里也是）
 * @param {Record<string, any> | null | undefined} x
 */
export const macroText = (x) => MACROS.filter(k => x && x[k] != null).map(k => `${t('log.' + k)}\u00a0${formatQty(/** @type {any} */ (x)[k])}\u00a0g`).join(' · ');
/** 一组营养写成一行：「520 千卡 · 蛋白质 25 g · …」（食谱页的每人份、面板里的合计、联想里的常吃的）；一样也没有 → '' @param {Record<string, any> | null | undefined} n */
export const nutritionLine = (n) => [n && n.kcal != null ? kcalText(n.kcal) : null, macroText(n) || null].filter(Boolean).join(' · ');
/**
 * 一行营养画成几个不折开的小段（span.lg-nw，和 ui/dayLog.js 的一样）：放不下一行时只在「 · 」那里折。只靠不折行的空格不够：
 * 中文字之间本来就能折，「脂肪 50 g」会折成「脂 / 肪 50 g」。字还是那一行（textContent 不变）
 * @param {string} line
 */
export const nowrapParts = (line) => (line ? line.split(' · ').flatMap((x, i) => [i ? ' · ' : null, h('span.lg-nw', null, x)]).filter(Boolean) : []);

/** 搜出来每种最多列几样（框里能滚，再多就再打几个字） */
const SHOW_MAX = 6;
/** 框里的每份：最多一位小数（合计 ÷ 份数可能除不尽：100 千卡 3 份是 33.3） @param {number | null | undefined} v */
const numIn = (v) => (v == null ? '' : formatQty(Math.round(v * 10) / 10));
const FIELD = { kcal: 'log.kcalField', protein: 'log.proteinField', carbs: 'log.carbsField', fat: 'log.fatField' };

/**
 * logSheet(ctx, { id })：改这一条；logSheet(ctx, { planId })：计划里这一道菜「吃了」；logSheet(ctx, { date, meal, recipeId })：记一样（recipeId 给了是已经选好的食谱）。
 * onSaved(entry)：存好以后（日历用来翻到那一天）。要改的、计划里的那道不在了 → null（说一句）
 */
export function logSheet(ctx, { id = null, date = null, meal = null, planId = null, recipeId = null, onSaved = null } = {}) {
  const prev = id ? liveLog(ctx.state, id) : null;
  if (id && !prev) { ctx.toast(t('log.gone')); return null; }
  const lang = ctx.lang();
  /** @type {Record<string, any>} 一开始的样子 */
  let d;
  if (prev) d = { title: prev.title, recipeId: prev.recipeId, planId: prev.planId, date: prev.date, meal: prev.meal, servings: prev.servings, per: perServing(prev), note: prev.note };
  else if (planId) {
    d = logFromPlan(ctx.state, planId);
    if (!d) { ctx.toast(t('plan.gone')); return null; }
  } else d = { ...((recipeId && logFromRecipe(ctx.state, recipeId)) || { title: '', recipeId: null, servings: 1, per: null }), date: date || todayDay(), meal: meal || mealAt() };
  const perStr = (/** @type {any} */ per) => Object.fromEntries(NUTRIENTS.map(k => [k, numIn(per && per[k])]));
  let chosen = !prev && d.recipeId ? d.recipeId : null;
  let chosenName = chosen ? d.title : '';
  let curMeal = MEALS.includes(d.meal) ? d.meal : 'dinner';
  let listOff = false;              // 刚点了一样常吃的：联想先收起来，再打字才出来
  // 营养框是从哪一条常吃的填好的（点了它、写的名字正好是它、计划里只写一句的）：存的时候告诉 core（fromFood），这时空着的框才算用户删掉了；
  // 不是从它填的，空着是没填（不然写「拿铁」直接添加，就把记住的 190 千卡冲成没填）。auto：是写名字时自动填的，vals 是填上的样子
  /** @type {{ id: string, auto: boolean, vals: string } | null} */
  let filled = !prev && d.fromFood ? { id: d.fromFood, auto: false, vals: '' } : null;
  /** @type {Record<string, any>} */
  const rows = {};

  // ---------- 吃了什么：选好的食谱（「换一个」），或者输入框 + 联想 ----------
  const q = h('input.f-in.dish-q', { type: 'text', value: chosen ? '' : d.title, maxlength: 200, placeholder: prev ? '' : t('log.namePh'), autocomplete: 'off', autocorrect: 'off',
    enterkeyhint: 'done', 'aria-label': t('log.name'), dataset: { fid: 'lg-q' },
    oninput: (e) => { listOff = false; if (!composing(e)) { autoFill(); drawResults(); } }, oncompositionend: () => { autoFill(); drawResults(); },
    onkeydown: onEnter(() => save()) });
  const list = h('ul.dish-results', { 'aria-label': t('log.name') });
  const help = h('p.f-help.dish-help', null, prev ? '' : t('log.nameHelp'));
  help.hidden = !!prev;
  const picker = h('div.dish-pick', null, q, list, help);
  const chosenBox = h('div.dish-chosen');
  rows.title = field(t('log.name'), h('div.dish-box', null, chosenBox, picker));
  rows.title.control = q;

  function drawResults() {
    if (prev || chosen || listOff) { list.replaceChildren(); list.hidden = true; return; }
    const typed = q.value.trim();
    const foods = foodSuggestions(ctx.state, typed, { limit: SHOW_MAX });
    const recs = typed ? searchRecipes(ctx.state, typed, collatorFor(lang), { nameFirst: true }).slice(0, SHOW_MAX) : [];
    const opt = (fid, ic, label, name, meta, run) => h('li', null, h('button.dish-opt', { type: 'button', 'aria-label': label, dataset: { fid }, onclick: run },
      icon(ic), h('span.dish-opt-text', null, h('span.dish-opt-name', null, name), meta ? h('span.dish-opt-meta', null, nowrapParts(meta)) : null)));
    list.replaceChildren(...[
      foods.length ? h('li.sug-h', { 'aria-hidden': 'true' }, t('log.frequent')) : null,
      ...foods.map(f => opt('lg-f-' + f.id, 'check', t('plan.pickRecipe', { name: f.name }), f.name, nutritionLine(f.per), () => pickFood(f.id))),
      recs.length ? h('li.sug-h', { 'aria-hidden': 'true' }, t('nav.recipes')) : null,
      ...recs.map(({ recipe: r }) => opt('lg-r-' + r.id, 'recipe', t('plan.pickRecipe', { name: recipeName(r, t) }), recipeName(r, t),
        hasNutrition(r.nutrition) ? nutritionLine(r.nutrition) : '', () => pickRecipe(r.id))),
    ].filter(Boolean));
    list.hidden = !foods.length && !recs.length;
  }
  function drawChosen() {
    picker.hidden = !!chosen;
    chosenBox.hidden = !chosen;
    if (chosen) {
      const r = liveRecipe(ctx.state, chosen);
      const name = r ? recipeName(r, t) : chosenName;
      chosenBox.replaceChildren(icon('recipe'), h('span.dish-chosen-name', null, name),
        h('button.link-btn.dish-change', { type: 'button', 'aria-label': t('plan.changeLabel', { name }), dataset: { fid: 'lg-change' },
          onclick: () => { chosen = null; chosenName = ''; q.value = ''; setPer(null); filled = null; drawChosen(); drawResults(); q.focus(); } }, t('log.change')));
    }
    drawSaveTo();
  }
  function pickRecipe(rid) {
    const x = logFromRecipe(ctx.state, rid);
    if (!x) { drawResults(); return; }
    chosen = rid; chosenName = /** @type {string} */ (x.title);
    setPer(x.per); filled = null;
    showErr(rows.title, null);
    drawChosen(); drawResults();
    const btn = chosenBox.querySelector('[data-fid="lg-change"]');
    if (btn) btn.focus();
  }
  function pickFood(fid) {
    const x = logFromFood(ctx.state, fid);
    if (!x) { drawResults(); return; }
    q.value = /** @type {string} */ (x.title);
    setPer(x.per);
    filled = { id: fid, auto: false, vals: '' };
    listOff = true;
    showErr(rows.title, null);
    drawResults();
    // 焦点给「添加」（最常见的下一步），不给份数框：iPhone 上数字键盘没有换行键、又挡着面板下面的「添加」；改份数有 −/+
    saveBtn.focus();
  }
  /** 写的名字正好是常吃的（没点它）、框还空着：填上记住的；名字又改成别的、自动填的没动过：拿掉 */
  function autoFill() {
    if (prev || chosen) return;
    const f = foodOf(ctx.state, q.value);
    if (filled && f && filled.id === f.id) return;
    const untouched = !!filled && filled.auto && boxVals() === filled.vals;
    if (f && hasNutrition(f.per) && (untouched || NUTRIENTS.every(k => !nutIns[k].value.trim()))) {
      setPer(f.per);
      filled = { id: f.id, auto: true, vals: boxVals() };
    } else if (untouched) { setPer(null); filled = null; }
  }

  // ---------- 哪一天、哪一顿 ----------
  const dateIn = h('input.f-in.dish-date', { type: 'date', value: d.date, min: '2000-01-01', max: '2999-12-31', dataset: { fid: 'lg-date' } });
  rows.date = field(t('plan.date'), dateIn);
  const mealBtns = MEALS.map(m => h('button', { type: 'button', dataset: { fid: 'lg-meal-' + m }, onclick: () => { curMeal = m; paintMeal(); } }, t('plan.meal.' + m)));
  function paintMeal() { mealBtns.forEach((b, i) => { const on = MEALS[i] === curMeal; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }); }
  paintMeal();
  rows.meal = field(t('plan.meal'), h('div.seg.meal-seg', { role: 'group' }, mealBtns));

  // ---------- 几份：−/+ 每次半份（「半碗」「吃了一块半」常有），写的不对标在下面 ----------
  const svIn = h('input.f-in.qty-in', { type: 'text', inputmode: 'decimal', value: formatQty(d.servings), autocomplete: 'off', enterkeyhint: 'done', dataset: { fid: 'lg-sv' },
    'aria-label': t('log.servings'), onkeydown: onEnter(() => save()), oninput: () => { checkSv(); drawSum(); } });
  const svOk = () => { const v = readQty(svIn.value); return svIn.value.trim() === '' || (v != null && Number.isFinite(v) && v > 0 && v <= LOG_SERVINGS_MAX); };
  const checkSv = () => showErr(rows.servings, svOk() ? null : 'log.err.servings');
  const step = (dir) => {
    const cur = readQty(svIn.value);
    svIn.value = formatQty(Math.min(LOG_SERVINGS_MAX, Math.max(0.5, Math.round(((Number.isFinite(cur) && cur ? cur : 1) + dir * 0.5) * 100) / 100)));
    checkSv(); drawSum();
  };
  rows.servings = field(t('log.servings'), svIn, { wrap: h('div.stepper', null,
    h('button.icon-btn.step-btn', { type: 'button', 'aria-label': t('log.svDec'), onclick: () => step(-1) }, icon('minus')),
    svIn,
    h('button.icon-btn.step-btn', { type: 'button', 'aria-label': t('log.svInc'), onclick: () => step(1) }, icon('plus'))) });

  // ---------- 每份营养 ----------
  /** @type {Record<string, any>} */
  const nutIns = {};
  for (const k of NUTRIENTS) {
    // 热量存的是整数：整数的数字键盘（和设置 → 饮食目标、编辑食谱一样）
    nutIns[k] = h('input.f-in.nut-in', { type: 'text', inputmode: k === 'kcal' ? 'numeric' : 'decimal', autocomplete: 'off', enterkeyhint: 'done', dataset: { fid: 'lg-' + k },
      onkeydown: onEnter(() => save()), oninput: () => { const r = readNutrition({ [k]: nutIns[k].value }); showErr(rows[k], r.errors[k] || null); drawSum(); } });
    rows[k] = field(t(FIELD[k]), nutIns[k]);
  }
  const perIn = perStr(d.per);
  /** 改的时候动过的营养框（和打开时不一样的） */
  const nutChanged = () => NUTRIENTS.filter(k => nutIns[k].value.trim() !== perIn[k]);
  function setPer(per) { const s = perStr(per); for (const k of NUTRIENTS) { nutIns[k].value = s[k]; showErr(rows[k], null); } drawSum(); }
  const boxVals = () => NUTRIENTS.map(k => nutIns[k].value.trim()).join('\n');
  const recipeEmpty = h('p.f-help.lg-recipe-empty', null, t('log.perRecipeEmpty'));
  const saveBox = h('input.atl-box', { type: 'checkbox', checked: true, dataset: { fid: 'lg-save-recipe' } });
  const saveTo = h('label.atl-check.lg-save-to', null, saveBox, h('span', null, t('log.saveToRecipe')));
  /** 选上的食谱还没填每人份营养（新记的才有）：说一句，「也记到食谱里」 */
  function drawSaveTo() {
    const r = chosen ? liveRecipe(ctx.state, chosen) : null;
    const show = !!(r && !hasNutrition(r.nutrition));
    recipeEmpty.hidden = !show; saveTo.hidden = !show;
  }
  const sumLine = h('p.f-help.lg-sum', { 'aria-live': 'polite' });
  /** 不是 1 份：下面写合计（存的就是它：新记的是每份 × 份数；改的时候和 core 一样，没动的框照原来的合计按份数比例变） */
  function drawSum() {
    const sv = readQty(svIn.value), per = readNutrition(Object.fromEntries(NUTRIENTS.map(k => [k, nutIns[k].value])));
    const ok = sv != null && Number.isFinite(sv) && sv > 0 && sv !== 1 && svOk();
    const tot = !ok ? null : prev ? editedTotals(prev, sv, Object.fromEntries(nutChanged().map(k => [k, per.value[k]]))) : scaleNutrition(per.value, sv);
    const text = tot && hasNutrition(tot) ? t('log.totalIs', { name: nutritionLine(tot) }) : '';
    if (sumLine.textContent !== text) sumLine.replaceChildren(...nowrapParts(text));
    sumLine.hidden = !text;
  }
  const perBox = h('div.f-row.lg-per', null, h('h3.group-h', null, t('log.per')), recipeEmpty,
    h('div.lg-nut-grid', null, NUTRIENTS.map(k => rows[k])), sumLine, saveTo, h('p.f-help', null, t('log.perHelp')));

  const noteIn = h('input.f-in', { type: 'text', value: d.note || '', maxlength: 500, autocomplete: 'off', enterkeyhint: 'done', dataset: { fid: 'lg-note' }, onkeydown: onEnter(() => save()) });
  rows.note = field(t('plan.note'), noteIn);

  setPer(d.per);
  const vals = () => ({ title: q.value.trim(), chosen, date: dateIn.value, meal: curMeal, servings: svIn.value.trim(), note: noteIn.value,
    ...Object.fromEntries(NUTRIENTS.map(k => [k, nutIns[k].value.trim()])) });
  const init = vals();
  const changed = () => { const v = vals(); return Object.keys(init).filter(k => /** @type {any} */ (v)[k] !== /** @type {any} */ (init)[k]); };
  const dirty = () => changed().length > 0;

  const saveBtn = h('button.btn.primary', { type: 'button', dataset: { fid: 'lg-save' }, onclick: () => save() }, t(prev ? 'common.save' : 'plan.add'));
  const body = h('div.form.dish-form.lg-form', null, rows.title, rows.date, rows.meal, rows.servings, perBox, rows.note,
    prev ? h('div.sheet-actions', null, h('button.btn.block.danger', { type: 'button', dataset: { fid: 'lg-del' }, onclick: closeThen(ctx, dirty, () => s, () => remove()) }, t('log.delete'))) : null);
  const s = ctx.sheet(body, {
    title: prev ? (prev.title.trim() || t('plan.untitled')) : t('log.add'), cls: 'dish-sheet lg-sheet',
    beforeClose: discardGuard(ctx, dirty, () => s),
    foot: [
      h('button.btn', { type: 'button', onclick: () => s.close() }, t('common.cancel')),
      saveBtn,
    ],
  });
  drawChosen();
  drawResults();
  if (!prev && !chosen && !planId) q.focus();

  const where = (e) => ({ date: fmtPlanDay(e.date, lang), meal: t('plan.meal.' + e.meal) });
  function remove() {
    const cur = liveLog(ctx.state, /** @type {string} */ (id));
    if (!cur) { ctx.toast(t('log.gone')); return; }
    ctx.mutate(st => deleteLogEntry(st, cur.id, Date.now()), { undoLabel: t('log.deleted', { name: cur.title.trim() || t('plan.untitled') }) });
  }
  function save() {
    const v = vals();
    const r = chosen ? liveRecipe(ctx.state, chosen) : null;
    const per = Object.fromEntries(NUTRIENTS.map(k => [k, /** @type {any} */ (v)[k]]));
    const input = { date: v.date, meal: v.meal, title: chosen ? (r ? r.name.trim() : chosenName) : v.title, recipeId: chosen, planId: (d.planId) || null,
      servings: v.servings, per, note: v.note, saveToRecipe: !saveTo.hidden && saveBox.checked, fromFood: !chosen && filled ? filled.id : null };
    // 先在不改数据的情况下查一遍：有错标在那一项下面，面板不关，焦点给第一个错的
    const check = validateLogEntry(ctx.state, input);
    for (const [k, row] of Object.entries(rows)) showErr(row, check.errors[k] || null);
    const bad = ['title', 'date', 'servings', ...NUTRIENTS].find(k => check.errors[k]);
    if (bad) { rows[bad].control.focus(); return; }
    if (!prev) {
      const res = ctx.mutate(st => addLogEntry(st, input, Date.now()), { undoLabel: t('log.added', where(check.clean)) });
      s.close();
      if (res && res.ok && onSaved) onSaved(res.entry);
      return;
    }
    if (!liveLog(ctx.state, prev.id)) { s.close(); ctx.toast(t('log.gone')); return; }
    /** @type {Record<string, any>} 只放改了的：营养也只放动过的那几格（一格也没动就不给 per：合计不重算，只改份数时按比例变） */
    const patch = {};
    for (const k of changed()) {
      if (NUTRIENTS.includes(/** @type {any} */ (k))) (patch.per ||= {})[k] = /** @type {any} */ (per)[k];
      else if (k !== 'chosen') patch[k] = /** @type {any} */ (input)[k];
    }
    if (!Object.keys(patch).length) { s.close(); return; }
    const moved = 'date' in patch || 'meal' in patch;
    const res = ctx.mutate(st => editLogEntry(st, prev.id, patch, Date.now()), { undoLabel: moved ? t('log.moved', where(check.clean)) : null });
    if (!res.ok) { if (res.errors.entry) { s.close(); ctx.toast(t('log.gone')); } return; }
    s.close();
    if (onSaved) onSaved(res.entry);
  }
  return s;
}
