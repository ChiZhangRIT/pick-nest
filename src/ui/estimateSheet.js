// 估算的明细（第 15 步）：食谱页「每人份约 …（估算，2 样没算进去）」点进来、编辑食谱里「按食材估算」的「明细」。
//   上面是每人份和整道的合计；下面「没算进去的」（没写用量、表里没有、不知道一个多重 / 认不出单位，各写原因）、「算进去的」（每样多少克、
//   按表里的哪一样 / 指定的 / 自己填的，约多少千卡）、「可选的，没算」；最下面是准确度的说明和数据来源。
//   每一样能「指定成…」（搜内置营养表：pickSheet）或者「自己填」（每 100 g、一个多重：ownSheet），自己说过的还能「用回自动认的」——
//   都存进 foods（core/estimate.js 的 saveIngredientFood / clearIngredientFood），所有食谱里的这一样都按它算；10 秒内能撤销。
//   食谱页打开的还有「用手动的」（useEstimate：估算抄成手动的每人份营养，再到「编辑」里改）；编辑页打开的没有（编辑页有自己的「填进去」）。
// 面板不在页面里：数据变了（撤销、别的设备同步来的）由打开它的页面调返回的 refresh() 重画；自己存了的马上重画。
// 内置表里的名字是简体写的：繁体界面按字转成繁体显示（core/hanzi.js 的 toTraditional，只是写法），英文界面用英文名。
//   写的是食材对上的那个别名（nutrition.js 的 foodAlias：写「马铃薯」就是「马铃薯」，不是这一样的第一个名字「土豆」——台湾的土豆是花生），
//   对不上的繁体界面先用台湾的说法。
// 估算拿去用的（「用手动的」）先过 usableEstimate：一整道（没写几人份）、算进去的只有水和盐、超过一份上限的不给抄。
import { h } from './dom.js';
import { t, getLang, listJoin } from '../i18n.js';
import { field, showErr, discardGuard, onEnter } from './form.js';
import { nutritionLine, kcalText, nowrapParts } from './logSheet.js';
import { estimateRecipe, ingredientRecord, saveIngredientFood, clearIngredientFood, useEstimate, usableEstimate } from '../core/estimate.js';
import { searchTable, nameHead, unitKey, asksWeight, isWeightUnit, foodAlias } from '../core/nutrition.js';
import { NUTRITION_SOURCE } from '../data/nutrition.js';
import { foodOf } from '../core/foods.js';
import { liveRecipe } from '../core/recipes.js';
import { formatQty, qtyLabel } from '../core/parse.js';
import { toTraditional } from '../core/hanzi.js';
import { NUTRIENTS } from '../core/store.js';

const FIELD = { kcal: 'log.kcalField', protein: 'log.proteinField', carbs: 'log.carbsField', fat: 'log.fatField' };

/**
 * 内置表里的一样叫什么（界面语言）：食材写的名字（搜索时是对上的那个名字）对上的别名，对不上用第一个名字（繁体界面先用台湾的说法）；
 * 英文界面用英文名，繁体界面按字转成繁体 @param {any} food @param {string} lang @param {string} [name]
 */
export function tableName(food, lang, name = '') {
  if (!food) return '';
  if (lang === 'en') return foodAlias(food, name, { en: true });
  const tw = lang === 'zh-Hant-TW';
  const a = foodAlias(food, name, { tw });
  return tw ? toTraditional(a) : a;
}

/**
 * 估算那一行的字：{ main：「每人份约 520 千卡 · …」/「整道菜约 …」/「还估算不出来：…」, note：「（估算，2 样没算进去）」}；
 * 一样能算的食材也没有（没写食材、全是可选的）→ null。算进去的只有水、盐（blank）也是「还估算不出来」，不写「约 0 千卡」
 * @param {ReturnType<typeof estimateRecipe>} est
 */
export function estimateText(est) {
  const n = est.lines.length - est.optional.length;
  if (!n) return null;
  if (!est.counted) return { main: t('est.none', { n }), note: '' };
  if (est.blank) return { main: t('est.noneZero', { n: est.missing.length }), note: '' };
  return { main: t(est.whole ? 'est.wholeLine' : 'est.perLine', { line: nutritionLine(est.perServing) }),
    note: est.missing.length ? t('est.noteMissing', { n: est.missing.length }) : t('est.note') };
}

/** 克数的写法：10 g 以上取整（「32 g」），再小的一位小数（「4.5 g」） @param {number} g */
const gramsText = (g) => t('est.grams', { g: formatQty(g >= 10 ? Math.round(g) : Math.round(g * 10) / 10) });
/** 英文界面上单位跟在「1」后面（「1 clove」）：英文食谱多半写复数（cloves、slices、bunches），换成单数 @param {string} u */
const singular = (u) => (!/^[a-z]+$/i.test(u) || u.length < 4 ? u : /^(leaves|loaves)$/i.test(u) ? u.slice(0, -3) + 'f'
  : /(ch|sh|x)es$/i.test(u) ? u.slice(0, -2) : /[^s]s$/i.test(u) ? u.slice(0, -1) : u);
/** 这一样写的单位怎么念：没写单位的是「个」；英文界面换成单数 @param {string} unit */
const unitWord = (unit) => { const u = unit.trim(); return !u ? t('est.unitPiece') : getLang() === 'en' ? singular(u) : u; };
/** 没有数的那几样营养素的名字（「蛋白质、碳水、脂肪」） @param {string[]} keys */
const nutrientNames = (keys) => listJoin(keys.map(k => t(k === 'kcal' ? 'log.kcalName' : 'log.' + k)));

/**
 * estimateSheet(ctx, { recipeId })：食谱页打开的（有「用手动的」）；estimateSheet(ctx, { recipe: () => 编辑页现在的食材, editing: true })：编辑页打开的。
 * 返回 { refresh, isOpen }
 */
export function estimateSheet(ctx, { recipeId = null, recipe = null, editing = false } = {}) {
  const lang = ctx.lang();
  const current = () => (recipe ? recipe() : liveRecipe(ctx.state, recipeId));
  const box = h('div.est');
  let open = true;

  /** @param {any} l */
  function lineRow(l) {
    const head = h('div.est-line-top', null, h('span.est-name', null, l.name), l.qty != null ? h('span.est-qty', null, qtyLabel(l.qty, l.unit)) : null,
      l.status === 'ok' && l.nutrition && l.nutrition.kcal != null ? h('span.est-kcal', null, kcalText(l.nutrition.kcal, true)) : null);
    /** @type {string[]} */
    const why = [];
    if (l.status === 'vague') why.push(t(editing ? 'est.why.vagueHere' : 'est.why.vague'));
    else if (l.status === 'unknown-food') why.push(t('est.why.food'));
    // 认不出的单位照写的原样写出来（英文不换成单数）；「不知道 1 clove 有多重」跟在数字后面，换成单数
    else if (l.status === 'unknown-unit') why.push(l.reason === 'unit' ? t('est.why.unit', { unit: l.unit }) : t('est.why.weight', { unit: unitWord(l.unit) }));
    if (l.status === 'ok') {
      // 写的就是克（「500 g」）：不再写一遍「500 g」
      if (!(isWeightUnit(l.unit) && Math.abs(l.grams - l.qty) < 0.05)) why.push(gramsText(l.grams));
      const k = unitKey(l.unit);
      if (l.mine && l.mine.grams && l.mine.grams[k] != null && asksWeight(l.unit)) why.push(t('est.gramsMine', { unit: unitWord(l.unit), g: formatQty(l.mine.grams[k]) }));
      if (l.guess) why.push(t('est.guess'));
    }
    if (l.status !== 'optional' && l.source) {
      why.push(l.source === 'mine' ? t('est.src.mine') : t(l.source === 'manual' ? 'est.src.manual' : 'est.src.table', { name: tableName(l.food, lang, l.name) }));
    }
    // 表里没有的、自己只填了热量：另外几样没有数，合计里少了它的
    if (l.status === 'ok' && l.gaps.length) why.push(t('est.gaps', { name: nutrientNames(l.gaps) }));
    const name = nameHead(l.name);
    const acts = l.status === 'optional' || l.status === 'vague' ? null : h('div.est-acts', null,
      h('button.link-btn', { type: 'button', 'aria-label': t('est.pickLabel', { name }), dataset: { fid: 'est-pick-' + l.key }, onclick: () => pickSheet(ctx, l, refresh) }, t('est.pick')),
      h('button.link-btn', { type: 'button', 'aria-label': t('est.ownLabel', { name }), dataset: { fid: 'est-own-' + l.key }, onclick: () => ownSheet(ctx, l, refresh) }, t('est.own')),
      l.mine ? h('button.link-btn', { type: 'button', 'aria-label': t('est.autoLabel', { name }), dataset: { fid: 'est-auto-' + l.key },
        onclick: () => { ctx.mutate(s => clearIngredientFood(s, l.name, Date.now()), { undoLabel: t('est.cleared', { name }) }); refresh(); } }, t('est.auto')) : null);
    return h('li.est-line', { dataset: { key: l.key } }, head, why.length ? h('p.est-why', null, why.join(' · ')) : null, acts);
  }
  /** @param {string} title @param {any[]} lines @param {string} cls */
  const section = (title, lines, cls) => (lines.length ? h('section.est-sec' + cls, null, h('h3.group-h', null, title), h('ul.group.est-lines', null, lines.map(lineRow))) : null);

  function draw() {
    const r = current();
    if (!r) { s.close(); return; }
    const est = estimateRecipe(ctx.state, r);
    const text = estimateText(est);
    const counted = est.lines.filter(l => l.status === 'ok');
    box.replaceChildren(...[
      text ? h('div.card.est-sum', null,
        h('p.est-main', null, ...nowrapParts(text.main)),
        est.counted && !est.blank && !est.whole ? h('p.est-total', null, ...nowrapParts(t('est.totalFor', { n: formatQty(est.servings), line: nutritionLine(est.total) }))) : null) : null,
      section(t('est.missingH', { n: est.missing.length }), est.missing, '.est-missing'),
      section(t('est.countedH', { n: counted.length }), counted, '.est-counted'),
      section(t('est.optionalH', { n: est.optional.length }), est.optional, '.est-optional'),
      // 「用手动的」：手动的是每人份，一整道（没写几人份）的不抄，说一句写上几人份
      !editing && usableEstimate(est) && !est.whole ? h('div.est-manual', null,
        h('button.btn.block', { type: 'button', dataset: { fid: 'est-manual' }, onclick: () => toManual() }, t('est.useManual')),
        h('p.f-help', null, t('est.useManualHelp'))) : null,
      !editing && est.whole && est.counted && !est.blank ? h('p.f-help.est-whole', null, t('est.wholeHelp')) : null,
      h('p.f-help.est-caveat', null, t('est.caveat')),
      h('p.f-help.est-source', null, t('est.source', { source: NUTRITION_SOURCE.attribution })),
    ].filter(Boolean));
  }
  function toManual() {
    const done = ctx.mutate(st => useEstimate(st, /** @type {string} */ (recipeId), Date.now()), { undoLabel: t('est.usedManual') });
    if (done) s.close();
  }
  function refresh() {
    if (!open) return;
    const a = document.activeElement, fid = a && a.dataset && box.contains(a) ? a.dataset.fid : null;
    draw();
    const el = fid ? box.querySelector(`[data-fid="${fid}"]`) : null;
    if (el) el.focus({ preventScroll: true });
  }
  const s = ctx.sheet(box, { title: t('est.title'), cls: 'est-sheet', onClose: () => { open = false; } });
  draw();
  return { refresh, isOpen: () => open };
}

/** 「指定成…」：搜内置营养表，点一样就存（ref），所有食谱里的这一样都按它算 @param {any} ctx @param {any} line @param {() => void} done */
export function pickSheet(ctx, line, done) {
  const lang = ctx.lang();
  const name = nameHead(line.name);
  const q = h('input.f-in.est-q', { type: 'search', value: name, maxlength: 100, placeholder: t('est.searchPh'), 'aria-label': t('est.search'), autocomplete: 'off',
    // 回车（iPhone 上的「搜索」）只收起键盘：选哪一样要点一下——直接存第一个的话，「鱼豆腐」一回车就存成了「豆腐」
    autocorrect: 'off', enterkeyhint: 'search', dataset: { fid: 'est-q' }, oninput: () => drawHits(), onkeydown: onEnter(() => q.blur()) });
  const list = h('ul.dish-results.est-hits', { 'aria-label': t('est.search') });
  const none = h('p.f-help.est-nohits', null, t('est.noHits'));
  function drawHits() {
    const hits = searchTable(q.value, { limit: 30 });
    // 名字写对上的那个（搜「马铃薯」出来的是「马铃薯」，不是表里第一个名字「土豆」）
    list.replaceChildren(...hits.map(({ food, name: hit }) => h('li', null, h('button.dish-opt', { type: 'button', dataset: { fid: 'est-hit-' + food.id }, onclick: () => pick(food, hit) },
      h('span.dish-opt-text', null, h('span.dish-opt-name', null, tableName(food, lang, hit)),
        h('span.dish-opt-meta', null, ...nowrapParts(t('est.per100', { line: nutritionLine(food.per100) }))))))));
    list.hidden = !hits.length;
    none.hidden = !!hits.length || !q.value.trim();
  }
  function pick(food, hit) {
    const res = ctx.mutate(st => saveIngredientFood(st, line.name, { ref: food.id }, Date.now()), { undoLabel: t('est.picked', { name, food: tableName(food, lang, hit) }) });
    s.close();
    if (res && res.ok) done();
  }
  const s = ctx.sheet(h('div.form.est-pick', null, q, list, none, h('p.f-help', null, t('est.pickHelp', { name }))), {
    title: t('est.pickTitle', { name }), cls: 'est-pick-sheet',
    foot: [h('button.btn', { type: 'button', onclick: () => s.close() }, t('common.cancel'))],
  });
  drawHits();
  q.focus();
  return s;
}

/** 「自己填」：每 100 g 的营养（四样都能不填）、一{unit}多重（单位不是克、毫升这种通用的才问）；存进 foods @param {any} ctx @param {any} line @param {() => void} done */
export function ownSheet(ctx, line, done) {
  const lang = ctx.lang();
  const name = nameHead(line.name);
  const mine = line.mine, base = line.food;
  const ask = asksWeight(line.unit), k = unitKey(line.unit);
  /** @type {Record<string, any>} */
  const rows = {}, ins = {};
  const num = (/** @type {any} */ v) => (v == null ? '' : formatQty(v));
  for (const key of NUTRIENTS) {
    // 表里有这一样的，格子里淡淡写着表里的数（不填的那一格就照它算：resolveIngredient 一格一格补）
    ins[key] = h('input.f-in.nut-in', { type: 'text', inputmode: key === 'kcal' ? 'numeric' : 'decimal', value: mine && line.source === 'mine' ? num(mine.per[key]) : '',
      placeholder: base ? num(base.per100[key]) : '', autocomplete: 'off', enterkeyhint: 'done', dataset: { fid: 'est-own-' + key },
      onkeydown: onEnter(() => save()), oninput: () => showErr(rows[key], null) });
    rows[key] = field(t(FIELD[key]), ins[key]);
  }
  const gIn = ask ? h('input.f-in.nut-in', { type: 'text', inputmode: 'decimal', value: mine && mine.grams[k] != null ? num(mine.grams[k]) : '',
    placeholder: base && base.grams[k] != null ? num(base.grams[k]) : '', autocomplete: 'off', enterkeyhint: 'done', dataset: { fid: 'est-own-grams' },
    onkeydown: onEnter(() => save()), oninput: () => showErr(rows.grams, null) }) : null;
  if (gIn) rows.grams = field(t('est.unitWeight', { unit: unitWord(line.unit) }), gIn);
  const vals = () => NUTRIENTS.map(x => ins[x].value.trim()).concat(gIn ? [gIn.value.trim()] : []).join('\n');
  const init = vals();
  const dirty = () => vals() !== init;
  const isFood = !!foodOf(ctx.state, name);
  const body = h('div.form.est-own', null,
    h('div.f-row', null, h('h3.group-h', null, t('est.per100H')), h('div.lg-nut-grid', null, NUTRIENTS.map(x => rows[x]))),
    rows.grams || null,
    h('p.f-help', null, t('est.ownHelp', { name }) + t(base ? 'est.ownHelpTable' : 'est.ownHelpNone', { food: base ? tableName(base, lang, line.name) : '' })),
    isFood ? h('p.f-help.est-converted', null, t('est.converted', { name })) : null);
  const input = () => ({ per: Object.fromEntries(NUTRIENTS.map(x => [x, ins[x].value])), ...(gIn ? { grams: gIn.value, unit: line.unit } : {}) });
  function save() {
    const check = ingredientRecord(ctx.state, line.name, input(), Date.now());
    if (!check.ok) {
      for (const [x, row] of Object.entries(rows)) showErr(row, check.errors[x] || null);
      const bad = [...NUTRIENTS, 'grams'].find(x => check.errors[x] && rows[x]);
      if (bad) rows[bad].control.focus();
      return;
    }
    if (dirty()) ctx.mutate(st => saveIngredientFood(st, line.name, input(), Date.now()), { undoLabel: t('est.saved', { name }) });
    s.close();
    done();
  }
  const s = ctx.sheet(body, {
    title: t('est.ownTitle', { name }), cls: 'est-own-sheet',
    beforeClose: discardGuard(ctx, dirty, () => s),
    foot: [h('button.btn', { type: 'button', onclick: () => s.tryClose() }, t('common.cancel')),
      h('button.btn.primary', { type: 'button', dataset: { fid: 'est-own-save' }, onclick: () => save() }, t('common.save'))],
  });
  ins.kcal.focus();
  return s;
}
