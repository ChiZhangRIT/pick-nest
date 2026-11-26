// 「食材替换」的面板（「食谱」页左上角）：两步——
//   1. 搜一样食材：食谱里用到的食材按名字搜（core/recipes.js 的 ingredientNames：简繁、大小写一样的算一样，后面写几道食谱用到），点一个；
//   2. 先看用到它的食谱和那几行（replacePreview：名字一样的，不是包含——换「生抽」不会动「生抽王」），写新名字，「替换」=
//      一次 ctx.mutate（replaceIngredient：所有食谱里这几行一起改名，数量、单位、备注不变；常备品跟着换到新名字），能撤销。
//      清单上的东西不改（那是当时加的；面板上说一句）。「返回」回到第 1 步，搜的字还在。
//      「换成」放在食谱列表上面：常用的调料几十道食谱都用，列表在上面的话输入框、出错的提示都在屏幕外面，点「替换」像没反应。
//      写的新名字有的食谱里已经有了（replaceDuplicates）→ 说一句「会有两行」，不拦着（腌料、调味各一份盐本来就可以两行）。
// 写了新名字再关面板先问（和别的编辑面板一样）。面板不在页面里：数据变了页面重画不打断它；点「替换」时按那时的数据算。
import { h, icon } from './dom.js';
import { t, listJoin } from '../i18n.js';
import { field, showErr, discardGuard, onEnter, composing } from './form.js';
import { ingredientNames, replacePreview, replaceIngredient, replaceDuplicates, recipeName } from '../core/recipes.js';
import { isStaple } from '../core/memory.js';
import { live } from '../core/store.js';
import { collatorFor } from '../core/group.js';
import { qtyLabel } from '../core/parse.js';

/** replaceSheet(ctx)：打开面板，返回面板 */
export function replaceSheet(ctx) {
  let step = 1, picked = '';
  const collator = () => collatorFor(ctx.lang());
  const q = h('input.f-in.rep-q', { type: 'search', placeholder: t('rcp.replacePh'), 'aria-label': t('rcp.replaceLabel'), autocomplete: 'off', autocorrect: 'off',
    autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'search', maxlength: 200, dataset: { fid: 'rep-q' },
    oninput: (e) => { if (!composing(e)) drawHits(); }, oncompositionend: () => drawHits(),
    // 回车选第一个（搜到的只有一样时最顺手）
    onkeydown: onEnter(() => { const first = ingredientNames(ctx.state, q.value, collator(), { limit: 1 })[0]; if (first) pick(first.name); }) });
  const hitsEl = h('ul.group.rep-hits');
  const hitsNote = h('p.f-help.rep-none', { role: 'status' });
  const step1 = h('div.form.rep-1', null, h('div.add-wrap.rep-search', null, icon('search', { cls: 'add-ic' }), q), hitsNote, hitsEl);

  const previewEl = h('ul.group.rep-preview');
  const toIn = h('input.f-in.rep-to', { type: 'text', autocomplete: 'off', maxlength: 200, enterkeyhint: 'done', dataset: { fid: 'rep-to' },
    onkeydown: onEnter(() => go()), oninput: () => { showErr(toRow, null); drawDup(); } });
  const toRow = field(t('rcp.replaceTo'), toIn, { help: t('rcp.replaceHelp') });
  const dupNote = h('p.f-help.rep-dup', { role: 'status', hidden: true });
  const stapleNote = h('p.f-help.rep-staple', { hidden: true });
  const step2 = h('div.form.rep-2', { hidden: true }, toRow, dupNote, stapleNote, h('div.f-row.rep-in', null, h('div.f-label', null, t('rcp.replaceIn')), previewEl));

  const back = h('button.btn', { type: 'button', dataset: { fid: 'rep-back' }, onclick: () => (step === 1 ? s.tryClose() : toStep1()) }, t('common.cancel'));
  const goBtn = h('button.btn.primary', { type: 'button', hidden: true, dataset: { fid: 'rep-go' }, onclick: () => go() }, t('rcp.replaceGo'));
  const dirty = () => step === 2 && toIn.value.trim() !== picked.trim();
  const s = ctx.sheet(h('div', null, step1, step2), {
    title: t('rcp.replace'), cls: 'rep-sheet',
    beforeClose: discardGuard(ctx, dirty, () => s),
    foot: [back, goBtn],
  });

  function drawHits() {
    const hits = ingredientNames(ctx.state, q.value, collator());
    const any = live(ctx.state, 'recipes').some(r => r.ings.some(g => g.name.trim()));
    hitsNote.textContent = !any ? t('rcp.replaceEmpty') : hits.length ? '' : t('rcp.replaceNone', { q: q.value.trim() });
    hitsNote.hidden = !hitsNote.textContent;
    hitsEl.hidden = !hits.length;
    hitsEl.replaceChildren(...hits.map(({ name, n }, i) => h('li', null,
      h('button.group-row.rep-hit.go', { type: 'button', dataset: { fid: 'rep-hit-' + i }, onclick: () => pick(name) },
        h('span.rep-name', null, name), h('span.rep-n', null, t('rcp.replaceUsedN', { n }))))));
  }
  function pick(name) {
    picked = name;
    step = 2;
    step1.hidden = true; step2.hidden = false;
    back.textContent = t('rcp.replaceBack');
    goBtn.hidden = false;
    s.setTitle(t('rcp.replaceFrom', { name }));
    previewEl.replaceChildren(...replacePreview(ctx.state, name, collator()).map(({ recipe, rows }) => h('li.group-row.rep-rec', null,
      h('span.rep-rec-text', null,
        h('span.rep-rec-name', null, recipeName(recipe, t)),
        rows.map(g => h('span.rep-row', null, [g.name.trim(), qtyLabel(g.qty, g.unit), g.note].filter(Boolean).join(' · ')))))));
    const staple = isStaple(ctx.state, name);
    stapleNote.hidden = !staple;
    stapleNote.textContent = staple ? t('rcp.replaceStaple', { name }) : '';
    toIn.value = name;
    showErr(toRow, null);
    drawDup();
    // 光标放进「换成」、选中原来的名字：直接打新的就是替换（第 1 步的列表长、往下滚过的话，面板还停在下面）
    toIn.focus();
    if (toIn.select) toIn.select();
    if (toIn.scrollIntoView) toIn.scrollIntoView({ block: 'nearest' });
  }
  /** 新名字在哪几道食谱里已经有了：换了会有两行，说一句（三道以内写名字，多了写几道） */
  function drawDup() {
    const to = toIn.value.trim();
    const dup = step === 2 && to ? replaceDuplicates(ctx.state, picked, to, collator()) : [];
    dupNote.hidden = !dup.length;
    dupNote.textContent = !dup.length ? '' : dup.length <= 3
      ? t('rcp.replaceDup', { name: to, recipes: listJoin(dup.map(r => t('rcp.replaceDupName', { name: recipeName(r, t) })), ctx.lang()) })
      : t('rcp.replaceDupN', { name: to, n: dup.length });
  }
  function toStep1() {
    step = 1;
    step1.hidden = false; step2.hidden = true;
    back.textContent = t('common.cancel');
    goBtn.hidden = true;
    s.setTitle(t('rcp.replace'));
    drawHits();
    q.focus();
  }
  function go() {
    if (step !== 2) return;
    const to = toIn.value.trim();
    if (!to) { showErr(toRow, 'rcp.err.replaceTo'); toIn.focus(); return; }
    // 按现在的数据算（面板开着时别的设备可能改过）：一行也不会变 = 和原来的一样
    const n = replacePreview(ctx.state, picked).filter(x => x.rows.some(g => g.name !== to)).length;
    if (!n) { showErr(toRow, 'rcp.err.replaceSame'); toIn.focus(); return; }
    const from = picked;
    ctx.mutate(st => replaceIngredient(st, from, to, Date.now()), { undoLabel: t('rcp.replaced', { n, name: from }) });
    s.close();
  }

  drawHits();
  q.focus();
  return s;
}
