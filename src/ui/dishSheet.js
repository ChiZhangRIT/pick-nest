// 加一道菜 / 改一道菜的面板：「计划」页每天的「+」（那一天、晚饭）、点一道菜（改它）、食谱页的「加到计划」（那道食谱、今天、晚饭）。
//   菜：搜食谱（名字和食材，简繁互通：core/recipes.js 的 searchRecipes，名字对上的在前），点一道选上；不选食谱就记下框里写的那句（「出去吃」；
//       打的正好是一道食谱的名字就连上它）；选上的可以「换一道」；
//   哪一天（<input type=date>）、哪一顿（早饭 / 午饭 / 晚饭 / 加餐）、几人份（连着食谱才有：−/+，默认食谱的人数，用量按它换算）、备注。
//   改的时候还有「打开食谱」和「删除这道菜」（10 秒内能撤销）。换了日子、哪一顿 = 挪过去；换了食谱、人数，已经加进清单的那一份跟着变（core/plan.js）。
// 「添加」/「保存」才存；有改动时关面板先问「放弃没保存的修改？」（和别的编辑面板一样），面板里马上生效的「删除」「打开食谱」也先问（closeThen）。
// 面板不在页面里：数据变了页面重画不会打断输入。
import { h, icon } from './dom.js';
import { t } from '../i18n.js';
import { field, showErr, discardGuard, closeThen, onEnter, composing } from './form.js';
import { liveEntry, validateEntry, addEntry, editEntry, deleteEntry, previewDelete, previewEdit, dishName, MEALS } from '../core/plan.js';
import { liveRecipe, recipeName, searchRecipes, SERVINGS_MAX } from '../core/recipes.js';
import { collatorFor } from '../core/group.js';
import { normName } from '../core/store.js';
import { formatQty, readQty } from '../core/parse.js';
import { todayDay, fmtPlanDay } from '../core/dates.js';
import { recipeMeta } from '../views/recipes.js';

/** 搜出来最多列几道（框里能滚，再多就再搜几个字） */
const SHOW_MAX = 40;

/**
 * dishSheet(ctx, { id })：改这一道；dishSheet(ctx, { date, meal, recipeId })：加一道（recipeId 给了就是已经选好的食谱）。
 * onSaved(entry)：存好以后（计划页用来翻到那一周）。这道菜已经不在了 → null
 */
export function dishSheet(ctx, { id = null, date = null, meal = 'dinner', recipeId = null, onSaved = null } = {}) {
  const prev = id ? liveEntry(ctx.state, id) : null;
  if (id && !prev) return null;
  const lang = ctx.lang();
  const init = prev
    ? { recipeId: prev.recipeId, title: prev.recipeId ? '' : prev.title.trim(), date: prev.date, meal: prev.meal, servings: formatQty(prev.servings), note: prev.note }
    : { recipeId: liveRecipe(ctx.state, recipeId) ? recipeId : null, title: '', date: date || todayDay(), meal: MEALS.includes(meal) ? meal : 'dinner', servings: '', note: '' };
  if (!prev && init.recipeId) init.servings = formatQty(/** @type {any} */ (liveRecipe(ctx.state, init.recipeId)).servings);
  let chosen = init.recipeId, curMeal = init.meal;
  /** @type {Record<string, any>} */
  const rows = {};

  // ---------- 菜：选好的那道（「换一道」），或者搜索框 + 搜到的食谱 ----------
  const q = h('input.f-in.dish-q', { type: 'text', value: init.title, maxlength: 200, placeholder: t('plan.dishPh'), autocomplete: 'off', autocorrect: 'off', enterkeyhint: 'done',
    'aria-label': t('plan.dish'), dataset: { fid: 'dish-q' },
    oninput: (e) => { if (!composing(e)) drawResults(); }, oncompositionend: () => drawResults(),
    // 回车：搜到了就选第一道（名字对上的在前）；没搜到就是写的这句，直接存
    onkeydown: onEnter(() => { const hits = results(); if (hits.length && q.value.trim()) choose(hits[0].recipe.id); else save(); }) });
  const list = h('ul.dish-results', { 'aria-label': t('nav.recipes') });
  const help = h('p.f-help.dish-help');
  const picker = h('div.dish-pick', null, q, list, help);
  const chosenBox = h('div.dish-chosen');
  const dishBox = h('div.dish-box', null, chosenBox, picker);
  rows.dish = field(t('plan.dish'), dishBox);
  rows.dish.control = q;                      // 错误标在搜索框上（选好了食谱就没有这一项的错）

  // 名字对上的排在只是食材对上的前面（nameFirst）：回车选的是第一道
  const results = () => searchRecipes(ctx.state, q.value, collatorFor(lang), { nameFirst: true }).slice(0, SHOW_MAX);
  function drawResults() {
    const hits = results(), typed = q.value.trim(), any = searchRecipes(ctx.state, '').length > 0;
    list.replaceChildren(...hits.map(({ recipe: r, ings }) => h('li', null,
      h('button.dish-opt', { type: 'button', 'aria-label': t('plan.pickRecipe', { name: recipeName(r, t) }), dataset: { fid: 'dish-r-' + r.id }, onclick: () => choose(r.id) },
        icon('recipe'), h('span.dish-opt-text', null, h('span.dish-opt-name', null, recipeName(r, t)),
          h('span.dish-opt-meta', null, ings.length ? t('rcp.uses', { names: ings.join('、') }) : recipeMeta(r)))))));
    list.hidden = !hits.length;
    help.textContent = !any ? t('plan.noRecipes') : typed && !hits.length ? t('plan.noMatch', { q: typed }) : t('plan.dishHelp');
  }
  function drawDish() {
    const r = chosen ? liveRecipe(ctx.state, chosen) : null;
    picker.hidden = !!chosen;
    chosenBox.hidden = !chosen;
    if (chosen) {
      // 连着的食谱后来被删掉了：显示抄下来的名字，照样能换
      const name = r ? recipeName(r, t) : (prev && prev.title.trim()) || t('plan.untitled');
      chosenBox.replaceChildren(icon('recipe'), h('span.dish-chosen-name', null, name),
        h('button.link-btn.dish-change', { type: 'button', 'aria-label': t('plan.changeLabel', { name }), dataset: { fid: 'dish-change' },
          onclick: () => { chosen = null; q.value = ''; drawDish(); drawResults(); showErr(rows.dish, null); q.focus(); } }, t('plan.change')));
    }
    drawServings();
  }
  function choose(rid) {
    const r = liveRecipe(ctx.state, rid);
    if (!r) { drawResults(); return; }
    chosen = rid;
    svIn.value = formatQty(r.servings);
    svBad = false;
    showErr(rows.dish, null);
    drawDish();
    const btn = chosenBox.querySelector('[data-fid="dish-change"]');
    if (btn) btn.focus();
  }

  // ---------- 哪一天、哪一顿 ----------
  const dateIn = h('input.f-in.dish-date', { type: 'date', value: init.date, min: '2000-01-01', max: '2999-12-31', dataset: { fid: 'dish-date' } });
  rows.date = field(t('plan.date'), dateIn);
  const mealBtns = MEALS.map(m => h('button', { type: 'button', dataset: { fid: 'dish-meal-' + m }, onclick: () => { curMeal = m; paintMeal(); } }, t('plan.meal.' + m)));
  function paintMeal() { mealBtns.forEach((b, i) => { const on = MEALS[i] === curMeal; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }); }
  paintMeal();
  rows.meal = field(t('plan.meal'), h('div.seg.meal-seg', { role: 'group' }, mealBtns));

  // ---------- 几人份（连着食谱、食谱写了人数才有）：和「加到清单」一样 −/+ 每次 1，写的不对标在下面 ----------
  let svBad = false;
  const svIn = h('input.f-in.qty-in', { type: 'text', inputmode: 'decimal', value: init.servings, autocomplete: 'off', enterkeyhint: 'done', dataset: { fid: 'dish-sv' },
    'aria-label': t('rcp.servings'), onkeydown: onEnter(() => save()),
    oninput: () => { const v = readQty(svIn.value); svBad = svIn.value.trim() !== '' && !(v != null && Number.isFinite(v) && v > 0 && v <= SERVINGS_MAX); showErr(rows.servings, svBad ? 'plan.err.servings' : null); } });
  const step = (dir) => {
    const cur = readQty(svIn.value);
    const next = Math.min(SERVINGS_MAX, Math.max(1, Math.round(((Number.isFinite(cur) && cur ? cur : 1) + dir) * 100) / 100));
    svIn.value = formatQty(next); svBad = false; showErr(rows.servings, null);
  };
  const dec = h('button.icon-btn.step-btn', { type: 'button', 'aria-label': t('rcp.servingsDec'), onclick: () => step(-1) }, icon('minus'));
  const inc = h('button.icon-btn.step-btn', { type: 'button', 'aria-label': t('rcp.servingsInc'), onclick: () => step(1) }, icon('plus'));
  const svHelp = h('p.f-help');
  rows.servings = field(t('rcp.servings'), svIn, { wrap: h('div.stepper', null, dec, svIn, inc), extra: svHelp });
  const noScale = h('p.f-help.dish-noscale', null, t('rcp.atlNoScale'));
  function drawServings() {
    const r = chosen ? liveRecipe(ctx.state, chosen) : null;
    rows.servings.hidden = !(r && r.servings);
    noScale.hidden = !(r && !r.servings);
    if (r && r.servings) svHelp.textContent = t('rcp.atlScale', { n: formatQty(r.servings) });
  }

  const noteIn = h('input.f-in', { type: 'text', value: init.note, maxlength: 500, placeholder: t('plan.notePh'), autocomplete: 'off', enterkeyhint: 'done',
    dataset: { fid: 'dish-note' }, onkeydown: onEnter(() => save()) });
  rows.note = field(t('plan.note'), noteIn);

  const vals = () => ({ recipeId: chosen, title: chosen ? '' : q.value.trim(), date: dateIn.value, meal: curMeal, servings: chosen ? svIn.value.trim() : '', note: noteIn.value });
  const changed = () => { const v = vals(); return Object.keys(init).filter(k => /** @type {any} */ (v)[k] !== /** @type {any} */ (init)[k]); };
  const dirty = () => changed().length > 0;

  const openR = prev && liveRecipe(ctx.state, prev.recipeId)
    ? h('button.btn.block.dish-open', { type: 'button', dataset: { fid: 'dish-open' }, onclick: closeThen(ctx, dirty, () => s, () => ctx.navigate('/r/' + encodeURIComponent(/** @type {string} */ (prev.recipeId)))) },
      icon('recipe'), t('plan.openRecipe'))
    : null;
  const body = h('div.form.dish-form', null, openR, rows.dish, rows.date, rows.meal, rows.servings, noScale, rows.note,
    prev ? h('div.sheet-actions', null, h('button.btn.block.danger', { type: 'button', dataset: { fid: 'dish-del' }, onclick: closeThen(ctx, dirty, () => s, () => remove()) }, t('plan.deleteDish'))) : null);
  const s = ctx.sheet(body, {
    title: prev ? dishName(ctx.state, prev, t) : t('plan.addDish'), cls: 'dish-sheet',
    beforeClose: discardGuard(ctx, dirty, () => s),
    foot: [
      h('button.btn', { type: 'button', onclick: () => s.close() }, t('common.cancel')),
      h('button.btn.primary', { type: 'button', dataset: { fid: 'dish-save' }, onclick: () => save() }, t(prev ? 'common.save' : 'plan.add')),
    ],
  });
  drawDish();
  drawResults();
  if (!prev && !chosen) q.focus();

  const where = (e) => ({ date: fmtPlanDay(e.date, lang), meal: t('plan.meal.' + e.meal) });
  function remove() {
    const cur = liveEntry(ctx.state, /** @type {string} */ (id));
    if (!cur) { ctx.toast(t('plan.gone')); return; }
    const name = dishName(ctx.state, cur, t), n = previewDelete(ctx.state, cur.id);
    ctx.mutate(st => deleteEntry(st, cur.id, Date.now()), { undoLabel: n ? t('plan.deletedList', { name, n }) : t('plan.deleted', { name }) });
  }
  function save() {
    if (svBad) { svIn.focus(); return; }
    // 打了一道食谱的完整名字、没点上面那一行就按「添加」（手机上顺手就是这样）：就是那道食谱，连上（不然看着是一道菜，生成购物清单时才发现没连食谱）。
    // 改一道只写一句的菜时，没动过那句话不算（只改备注不会悄悄连上食谱）
    if (!chosen && (!prev || q.value.trim() !== init.title)) {
      const typed = normName(q.value);
      const same = typed ? searchRecipes(ctx.state, q.value, collatorFor(lang)).find(x => normName(x.recipe.name) === typed) : null;
      if (same) { chosen = same.recipe.id; svIn.value = formatQty(same.recipe.servings); svBad = false; drawDish(); }
    }
    const v = vals();
    const input = { ...v, servings: v.recipeId ? v.servings : null };
    const cur = id ? liveEntry(ctx.state, id) : null;
    if (id && !cur) { s.close(); ctx.toast(t('plan.gone')); return; }
    // 先在不改数据的情况下查一遍：有错标在那一项下面，面板不关
    const check = validateEntry(ctx.state, input, cur);
    for (const [k, row] of Object.entries(rows)) showErr(row, check.errors[k] || null);
    const bad = Object.keys(check.errors)[0];
    if (bad) { (bad === 'dish' && chosen ? chosenBox.querySelector('[data-fid="dish-change"]') : rows[bad].control).focus(); return; }
    if (!cur) {
      const res = ctx.mutate(st => addEntry(st, input, Date.now()), { undoLabel: t('plan.added', where(check.clean)) });
      s.close();
      if (res && res.ok && onSaved) onSaved(res.entry);
      return;
    }
    /** @type {Record<string, any>} */
    const patch = {};
    for (const k of changed()) {
      if (k === 'recipeId' || k === 'title') { patch.recipeId = input.recipeId; patch.title = input.title; }
      else patch[k] = /** @type {any} */ (input)[k];
    }
    if (!Object.keys(patch).length) { s.close(); return; }
    // 提示条：动到清单的要能撤销（清单上的数量悄悄变了）；挪到别的日子说挪到哪了（这一页上可能就看不到它了）；只改了备注什么也不说
    const moved = 'date' in patch || 'meal' in patch;
    const label = previewEdit(ctx.state, cur.id, patch) ? t('plan.listUpdated') : moved ? t('plan.moved', where(check.clean)) : null;
    const res = ctx.mutate(st => editEntry(st, cur.id, patch, Date.now()), { undoLabel: label });
    if (!res.ok) { for (const [k, row] of Object.entries(rows)) showErr(row, res.errors[k] || null); if (res.errors.entry) { s.close(); ctx.toast(t('plan.gone')); } return; }
    s.close();
    if (onSaved) onSaved(res.entry);
  }
  return s;
}
