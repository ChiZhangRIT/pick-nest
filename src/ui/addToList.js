// 「加到清单」的面板（一道食谱的页面上的按钮；清单页快速添加时联想到的「用到它的食谱」也打开它，那时默认加到那张清单）：
//   加到哪张（首页上的食材清单，默认「食材」，core/recipes.js 的 groceryLists / defaultTarget）、几人份（−/+，用量按比例算，没写数量的不变；
//   食谱没写人数就不能换算，只说一句；写的不对标在下面、不让加，免得按一个看不见的人数加）、每样食材一个勾（常备品、可选的、这道菜已经加过的默认不勾），
//   清单上已经有的写出来「清单上已有 2 个」，这道菜加过的写「这道菜已经加过 600 g」（再打开面板多半是来看的，一下点确认就翻倍了）；
//   每行能标 / 取消「常备品」（按名字记，以后所有食谱都认；标上就顺手取消勾，取消就勾回来；同名的几行一起）。
// 确认 = 一次 ctx.mutate（addRecipeToList：先记常备品，再按 items.js 的 addNeeds 加，来源 'a:<随机>'：每加一次是新的一份），能撤销。
// 换人数、换清单只就地改每行的用量和「已有」，勾和常备品照留（按 key / 名字记着）。面板不在页面里：数据变了页面重画不会打断它。
import { h, icon } from './dom.js';
import { t } from '../i18n.js';
import { field, showErr } from './form.js';
import { liveRecipe, recipeName, recipeLines, addRecipeToList, groceryLists, defaultTarget, SERVINGS_MAX } from '../core/recipes.js';
import { qtyLabel, formatQty, readQty } from '../core/parse.js';
import { listName, newId, normName } from '../core/store.js';

/** addToListSheet(ctx, recipeId, { listId })：打开面板；食谱不在了 → null */
export function addToListSheet(ctx, recipeId, { listId = null } = {}) {
  const r0 = liveRecipe(ctx.state, recipeId);
  if (!r0) return null;
  const lists = groceryLists(ctx.state);
  let target = defaultTarget(ctx.state, listId);
  let servings = r0.servings;
  const checked = new Map();          // key → 勾没勾（没碰过的按默认）
  const staples = new Map();          // normName → { name, on }（这次标 / 取消的）
  const rows = new Map();             // key → { li, box, qty, have, chip }

  const lines = () => recipeLines(ctx.state, liveRecipe(ctx.state, recipeId) || r0, { servings, listId: target });
  const isOn = (ln) => (checked.has(ln.key) ? checked.get(ln.key) : ln.checked);
  const stapleOf = (ln) => { const s = staples.get(normName(ln.name)); return s ? s.on : ln.staple; };

  // 加到哪张
  const listSel = h('select.f-in', { dataset: { fid: 'atl-list' }, onchange: () => { target = listSel.value; paint(); } },
    lists.map(l => h('option', { value: l.id }, listName(l, t))));
  if (target) listSel.value = target;

  // 几人份：−/+ 每次 1，最少 1（食谱没写人数时不能换算，不画）。框里的字读不出来（空的、0、100）时标在下面、「加到清单」不让点：
  // 不然用的是上一次读得出来的人数（打「100」路过「10」），加进去的用量对不上框里写的
  let svBad = false;
  const svIn = h('input.f-in.qty-in', { type: 'text', inputmode: 'decimal', value: servings ? formatQty(servings) : '', autocomplete: 'off', enterkeyhint: 'done',
    dataset: { fid: 'atl-sv' }, oninput: () => {
      const q = readQty(svIn.value);
      svBad = !(q != null && Number.isFinite(q) && q > 0 && q <= SERVINGS_MAX);
      if (!svBad) servings = q;
      if (svRow) showErr(svRow, svBad ? 'rcp.err.servings' : null);
      paint();
    } });
  const step = (dir) => {
    const next = Math.min(SERVINGS_MAX, Math.max(1, Math.round(((servings || 1) + dir) * 100) / 100));
    if (next === servings && !svBad) return;
    servings = next; svIn.value = formatQty(next); svBad = false;
    if (svRow) showErr(svRow, null);
    paint();
  };
  const dec = h('button.icon-btn.step-btn', { type: 'button', 'aria-label': t('rcp.servingsDec'), onclick: () => step(-1) }, icon('minus'));
  const inc = h('button.icon-btn.step-btn', { type: 'button', 'aria-label': t('rcp.servingsInc'), onclick: () => step(1) }, icon('plus'));

  const err = h('p.f-err.atl-err', { role: 'alert', hidden: true });
  const list = h('ul.group.atl-list');
  const goBtn = h('button.btn.primary', { type: 'button', dataset: { fid: 'atl-go' }, onclick: () => go() });

  function row(ln) {
    const box = h('input.atl-box', { type: 'checkbox', checked: isOn(ln), dataset: { fid: 'atl-' + ln.key },
      onchange: () => { checked.set(ln.key, box.checked); err.hidden = true; paintGo(); } });
    const qty = h('span.atl-qty');
    const have = h('span.atl-have');
    const chip = h('button.chip.atl-staple', { type: 'button', 'aria-label': t('rcp.atlStapleOn', { name: ln.name }), dataset: { fid: 'atl-st-' + ln.key },
      onclick: () => {
        const on = !stapleOf(ln), key = normName(ln.name);
        staples.set(key, { name: ln.name, on });
        // 标成常备品 = 家里有，这次先不勾；取消了就勾回来（可选的照样不勾）。同名的几行（腌料、调味里各一行「盐」）一起：常备品是按名字记的
        for (const x of lines()) if (normName(x.name) === key) checked.set(x.key, !on && !x.optional);
        paint();
      } }, t('rcp.staple'));
    const li = h('li.atl-row', null,
      h('label.atl-check', null, box,
        h('span.atl-text', null,
          h('span.atl-name', null, ln.name, ln.optional ? h('span.tag', null, t('rcp.optional')) : null),
          h('span.atl-sub', null, qty, ln.note ? h('span.atl-note', null, ln.note) : null, have))),
      chip);
    rows.set(ln.key, { li, box, qty, have, chip });
    return li;
  }
  /** 换人数、换清单、标常备品以后：每行就地改用量、「已有」、勾和常备品（不重建，焦点、读屏的位置不丢） */
  function paint() {
    const all = lines();
    againHelp.hidden = !all.some(ln => ln.added);
    for (const ln of all) {
      const r = rows.get(ln.key);
      if (!r) continue;
      r.qty.textContent = qtyLabel(ln.qty, ln.unit);
      r.qty.hidden = !r.qty.textContent;
      r.have.textContent = ln.added ? (ln.addedLabel ? t('rcp.atlHaveThis', { qty: ln.addedLabel }) : t('rcp.atlHaveThisNoQty'))
        : ln.have ? (ln.haveLabel ? t('rcp.atlHave', { qty: ln.haveLabel }) : t('rcp.atlHaveNoQty')) : '';
      r.have.hidden = !ln.have;
      r.box.checked = isOn(ln);
      r.chip.setAttribute('aria-pressed', String(stapleOf(ln)));
    }
    paintGo();
  }
  function count() { return lines().filter(isOn).length; }
  function paintGo() {
    const n = count();
    goBtn.textContent = t('rcp.atlGo', { n });
    goBtn.setAttribute('aria-disabled', String(!n || !target || svBad));
  }

  const first = lines();
  for (const ln of first) list.append(row(ln));
  // 这道菜已经加过的默认不勾：说一句，要再做一次的知道勾上就是再加一份
  const againHelp = h('p.f-help.atl-again', null, t('rcp.atlAgainHint'));
  const svRow = r0.servings ? field(t('rcp.servings'), svIn, { wrap: h('div.stepper', null, dec, svIn, inc), help: t('rcp.atlScale', { n: formatQty(r0.servings) }) }) : null;
  const body = h('div.form.atl', null,
    lists.length ? field(t('rcp.atlList'), listSel) : h('p.f-help.atl-nolist', { role: 'note' }, t('rcp.atlNoList')),
    svRow || h('p.f-help.atl-noscale', null, t('rcp.atlNoScale')),
    first.length
      ? h('div.f-row.atl-ings', null, h('div.f-label', null, t('rcp.atlIngs')), list, againHelp, h('p.f-help', null, t('rcp.atlStapleHint')))
      : h('p.f-help', null, t('rcp.atlEmpty')),
    err);
  const s = ctx.sheet(body, {
    title: recipeName(r0, t), cls: 'atl-sheet',
    foot: [h('button.btn', { type: 'button', onclick: () => s.close() }, t('common.cancel')), goBtn],
  });
  paint();

  function go() {
    const r = liveRecipe(ctx.state, recipeId);
    if (!r) { s.close(); ctx.toast(t('rcp.gone')); return; }
    if (!target) return;
    if (svBad) { svIn.focus(); return; }
    const keys = lines().filter(isOn).map(ln => ln.key);
    if (!keys.length) { err.textContent = t('rcp.atlPickOne'); err.hidden = false; return; }
    const changes = Object.fromEntries([...staples.values()].map(x => [x.name, x.on]));
    const l = lists.find(x => x.id === target);
    const n = keys.length;
    ctx.mutate(st => addRecipeToList(st, r, { listId: /** @type {string} */ (target), servings, keys, staples: changes, source: newId('a:') }, Date.now()),
      { undoLabel: t('rcp.added', { n, name: l ? listName(l, t) : '' }) });
    s.close();
  }
  return s;
}
