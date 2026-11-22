// 改一样东西的面板（清单页每一行右边的 ›）：名字、数量（−/+）、单位（常用单位的快捷选项）、商店、分类、备注；
// 一般清单还有状态（要买 / 以后再说 / 已买）、商品链接（只收 http / https，「打开」在新标签页）、价格；所在的清单（换一张就移过去）；删除（可撤销）。
// 点「完成」才存，只交改过的字段（别的设备同时改的其它字段留着）；规则在 core/items.js（validateItemPatch、editAndMove：改和移在一起做，
// 合并到那边同名的一条时这次改的落在留下来的那条上）。删除和关面板一样，有没存的修改先问（closeThen）。
// 面板不在页面里：数据变了页面重画不会打断输入。
import { h, icon } from './dom.js';
import { t } from '../i18n.js';
import { field, showErr, discardGuard, closeThen, onEnter } from './form.js';
import { liveItem, liveList, validateItemPatch, editAndMove, moveConflict, categoryFits, cleanUrl } from '../core/items.js';
import { formatQty, readQty, stepQty, UNIT_SUGGESTIONS } from '../core/parse.js';
import { listName, categoryName, live, byOrder } from '../core/store.js';

const STATUSES = ['need', 'later', 'done'];

/** itemSheet(ctx, itemId)：打开面板；这一样已经不在了 → null */
export function itemSheet(ctx, itemId) {
  const st = ctx.state;
  const it = liveItem(st, itemId), list = it && liveList(st, it.listId);
  if (!it || !list) return null;
  const general = list.kind === 'general';
  // 面板里的值（字符串，和输入框里一样的写法），「完成」时和它比，只交改过的
  const init = { name: it.name.trim(), qty: formatQty(it.qty), unit: it.unit.trim(), storeId: it.storeId || '', categoryId: it.categoryId || '', note: it.note,
    status: it.status, url: it.url.trim(), price: it.price == null ? '' : String(it.price), listId: it.listId };
  /** @type {Record<string, any>} */
  const rows = {};
  const enter = onEnter(() => save());

  const nameIn = h('input.f-in', { type: 'text', value: init.name, maxlength: 200, autocomplete: 'off', enterkeyhint: 'done', onkeydown: enter });
  rows.name = field(t('item.name'), nameIn);

  // 数量：可以空着（不写数量）；−/+ 每次 1，减到 0 就是空的
  const qtyIn = h('input.f-in.qty-in', { type: 'text', inputmode: 'decimal', value: init.qty, placeholder: t('item.qtyPh'), autocomplete: 'off', enterkeyhint: 'done',
    onkeydown: enter, oninput: () => paintStep() });
  const step = (dir) => { const q = readQty(qtyIn.value); qtyIn.value = formatQty(stepQty(Number.isFinite(q) ? q : null, dir)); paintStep(); };
  const dec = h('button.icon-btn.step-btn', { type: 'button', 'aria-label': t('item.qtyDec'), onclick: () => step(-1) }, icon('minus'));
  const inc = h('button.icon-btn.step-btn', { type: 'button', 'aria-label': t('item.qtyInc'), onclick: () => step(1) }, icon('plus'));
  // 空着时「−」没有可减的：aria-disabled（不用 disabled，焦点不会突然丢掉）
  function paintStep() { const empty = !qtyIn.value.trim(); dec.setAttribute('aria-disabled', String(empty)); }
  paintStep();
  rows.qty = field(t('item.qty'), qtyIn, { wrap: h('div.stepper', null, dec, qtyIn, inc) });

  // 单位：随便写；下面是常用单位，点一下填进去（再点一下清掉）
  const unitIn = h('input.f-in', { type: 'text', value: init.unit, maxlength: 20, placeholder: t('item.unitPh'), autocomplete: 'off', enterkeyhint: 'done',
    onkeydown: enter, oninput: () => paintChips() });
  const chips = (UNIT_SUGGESTIONS[ctx.lang()] || UNIT_SUGGESTIONS['zh-Hans']).map(u => h('button.chip', { type: 'button',
    onclick: () => { unitIn.value = unitIn.value.trim() === u ? '' : u; paintChips(); } }, u));
  function paintChips() { for (const c of chips) c.setAttribute('aria-pressed', String(c.textContent === unitIn.value.trim())); }
  paintChips();
  rows.unit = field(t('item.unit'), unitIn, { extra: h('div.chips.unit-chips', null, chips) });

  // 商店：没归档的按顺序；现在指定的那家归档了也留着（标出来），不然一打开就悄悄换成「未指定」
  const stores = live(st, 'stores').filter(s => !s.archived || s.id === init.storeId).sort(byOrder);
  const storeSel = h('select.f-in', null, h('option', { value: '' }, t('item.storeNone')),
    stores.map(s => h('option', { value: s.id }, s.archived ? t('item.storeArchived', { name: s.name }) : s.name)));
  storeSel.value = stores.some(s => s.id === init.storeId) ? init.storeId : '';
  init.storeId = storeSel.value;            // 指定的商店删掉了：显示「未指定」，不动它就不算修改
  rows.storeId = field(t('item.store'), storeSel, { help: t('item.storeHelp') });

  // 分类：能给这种清单用的（kind 一样或两边都用），按顺序；现在的分类不合适也留着
  const cats = live(st, 'categories').filter(c => categoryFits(st, c.id, list.kind) || c.id === init.categoryId).sort(byOrder);
  const catSel = h('select.f-in', null, h('option', { value: '' }, t('item.catNone')), cats.map(c => h('option', { value: c.id }, categoryName(c, t))));
  catSel.value = cats.some(c => c.id === init.categoryId) ? init.categoryId : '';
  init.categoryId = catSel.value;
  rows.categoryId = field(t('item.category'), catSel);

  const noteIn = h('textarea.f-in', { rows: 2, value: init.note });
  rows.note = field(t('item.note'), noteIn);

  // 一般清单：状态、链接、价格
  let status = init.status;
  const statusBtns = STATUSES.map(v => h('button', { type: 'button', onclick: () => { status = v; paintStatus(); } }, t('item.st.' + v)));
  function paintStatus() { statusBtns.forEach((b, i) => { b.classList.toggle('on', STATUSES[i] === status); b.setAttribute('aria-pressed', String(STATUSES[i] === status)); }); }
  paintStatus();
  const urlIn = h('input.f-in', { type: 'url', value: init.url, placeholder: 'https://', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', enterkeyhint: 'done',
    onkeydown: enter, oninput: () => paintOpen() });
  // 打开：新标签页，不带来源（rel=noopener noreferrer），链接是用户粘贴的
  const openA = h('a.btn.open-link', { target: '_blank', rel: 'noopener noreferrer' }, icon('open'), t('item.open'));
  function paintOpen() { const u = cleanUrl(urlIn.value); openA.hidden = !u; if (u) openA.setAttribute('href', u); else openA.removeAttribute('href'); }
  paintOpen();
  const priceIn = h('input.f-in.price-in', { type: 'text', inputmode: 'decimal', value: init.price, autocomplete: 'off', enterkeyhint: 'done', onkeydown: enter });
  if (general) {
    rows.status = field(t('item.status'), h('div.seg.status-seg', { role: 'group' }, statusBtns));
    rows.url = field(t('item.url'), urlIn, { wrap: h('div.url-row', null, urlIn, openA) });
    rows.price = field(t('item.price'), priceIn);
  }

  // 在哪张清单上：换一张就移过去。没归档的清单按顺序（现在这张归档了也在）。标题写「清单」不写「移到…」：选着的是现在这张，不是要移去的
  const lists = live(st, 'lists').filter(l => !l.archived || l.id === it.listId).sort(byOrder);
  const listSel = h('select.f-in', null, lists.map(l => h('option', { value: l.id }, listName(l, t))));
  listSel.value = it.listId;
  rows.listId = field(t('item.list'), listSel, { help: t('item.listHelp') });

  const vals = () => ({ name: nameIn.value.trim(), qty: qtyIn.value.trim(), unit: unitIn.value.trim(), storeId: storeSel.value, categoryId: catSel.value,
    note: noteIn.value, status: general ? status : init.status, url: urlIn.value.trim(), price: priceIn.value.trim(), listId: listSel.value });
  const changed = () => { const v = vals(); return Object.keys(init).filter(k => v[k] !== init[k]); };
  const dirty = () => changed().length > 0;

  const s = ctx.sheet(h('div.form', null, Object.values(rows),
    h('div.sheet-actions', null, h('button.btn.block.danger', { type: 'button', onclick: closeThen(ctx, dirty, () => s, remove) }, t('item.delete')))), {
    title: t('item.editTitle'), cls: 'item-sheet',
    beforeClose: discardGuard(ctx, dirty, () => s),
    foot: [
      h('button.btn', { type: 'button', onclick: () => s.close() }, t('common.cancel')),
      h('button.btn.primary', { type: 'button', onclick: () => save() }, t('common.done')),
    ],
  });

  function remove() {
    const cur = liveItem(ctx.state, itemId);
    if (cur) ctx.remove('items', itemId, { undoLabel: t('item.deleted', { name: cur.name }) });
  }

  let saving = false;
  async function save() {
    if (saving) return;
    const v = vals();
    /** @type {Record<string, any>} */
    const patch = {};
    for (const k of changed()) if (k !== 'listId') patch[k] = k === 'storeId' || k === 'categoryId' ? v[k] || null : v[k];
    const cur = liveItem(ctx.state, itemId);
    if (!cur) { s.close(); ctx.toast(t('item.err.gone')); return; }
    const to = v.listId !== cur.listId ? liveList(ctx.state, v.listId) : null;
    // 先在不改数据的情况下查一遍：有错就标在字段下面，面板不关。同时换了清单的，名字不和这张清单比（移走了不会重名）
    const check = validateItemPatch(ctx.state, cur, patch, { moving: !!to });
    for (const [k, row] of Object.entries(rows)) showErr(row, check.errors[k]);
    const bad = Object.keys(check.errors)[0];
    if (bad) { rows[bad].control.focus(); return; }
    if (to) {
      const name = check.clean.name ?? cur.name;
      const other = moveConflict(ctx.state, itemId, to.id, name);
      saving = true;
      const ok = !other || await ctx.confirm({ message: t('item.moveQ', { list: listName(to, t), name }), confirmLabel: t('item.merge') });
      saving = false;
      if (!ok) return;
    }
    const now = Date.now();
    const res = ctx.mutate(state => editAndMove(state, itemId, patch, to ? to.id : null, now), { undoLabel: to ? t('item.moved', { list: listName(to, t) }) : null });
    if (!res.ok) { for (const [k, row] of Object.entries(rows)) showErr(row, res.errors[k]); if (res.errors.item) { s.close(); ctx.toast(t('item.err.gone')); } return; }
    s.close();
  }
  return s;
}
