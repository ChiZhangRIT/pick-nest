// 新建 / 编辑清单的面板（首页「新建清单」、清单页「⋯ → 编辑清单」共用）。面板不在页面里：数据变了页面重画也不会打断输入。
// 名字、颜色、图标、默认商店点「保存」才存；类型只在新建时选（里面的东西的分类、「以后再说」都跟着类型）。
// 归档、删除马上生效，由调用的页面做（它要先离开这一页，再改数据、弹「撤销」）。
import { h } from './dom.js';
import { t } from '../i18n.js';
import { field, showErr, discardGuard, closeThen, onEnter } from './form.js';
import { createList, editList } from '../core/lists.js';
import { listName, live, byOrder } from '../core/store.js';
import { liveStore } from '../core/stores.js';
import { LIST_GLYPHS, LIST_COLORS, customIcon, listLook } from '../core/listIcons.js';
import { listTile, glyph as drawGlyph } from './listTile.js';

/**
 * listSheet(ctx, { list })：list 给了就是编辑，否则新建。
 * onCreated(id) 新建好了；onArchive() 点了归档 / 取消归档；onDelete() 确认了删除（只有自建清单有这个按钮）
 */
export function listSheet(ctx, { list = null, onCreated = null, onArchive = null, onDelete = null } = {}) {
  const editing = !!list;
  let kind = editing ? list.kind : 'general';          // 预置的「食材」已经有了，自己建的多半是一般清单（木工、衣服……）
  // icon（自己写的）/ glyph（画好的）/ color 是要存的值（空的 = 按类型默认，见 core/listIcons.js）；面板上选中哪个按 listLook 显示，和首页看到的一样。
  // 写自定义时 glyph 不清：显示时自己写的在前，字删光了就回到之前选的图标；存的时候 lookFields 只留一样
  let icon = editing ? list.icon : '', glyph = editing ? list.glyph : '', color = editing ? list.color : '';
  // 默认商店删掉了：显示「未指定」，不动它就不算修改（存的时候也不交这一项：商店恢复了，默认商店跟着回来）
  const init = { name: editing ? list.name : '', icon, glyph, color, store: (editing && list.defaultStoreId && liveStore(ctx.state, list.defaultStoreId) && list.defaultStoreId) || '', kind };

  const nameIn = h('input.f-in', { type: 'text', value: init.name, maxlength: 80, autocomplete: 'off', enterkeyhint: 'done',
    placeholder: editing && list.sys ? listName({ ...list, name: '' }, t) : t('list.namePh'),
    onkeydown: onEnter(() => save()) });
  const nameRow = field(t('list.name'), nameIn);

  const kindRow = editing ? null : field(t('list.kind'), h('div.kind-pick', { role: 'radiogroup' }, ['general', 'grocery'].map(k =>
    h('label.kind-opt', null,
      h('input', { type: 'radio', name: 'list-kind', value: k, checked: k === kind, onchange: () => { kind = k; paint(); } }),
      h('span.kind-text', null, h('b', null, t('list.kind.' + k)), h('small', null, t('list.kind.' + k + 'Hint')))))),
  { help: t('list.kindFixed') });

  // 最上面的预览：和首页的方块一样（同一个 listTile），选什么马上变
  const preview = h('div.le-head');
  // 颜色：一排色块（名字给读屏）；图标：画好的一格一格，选中的那格用选的颜色；「自定义」：一个 emoji 或一两个字
  const swatches = LIST_COLORS.map(c => h('button.swatch.tint-' + c, { type: 'button', 'aria-label': t('list.tint.' + c), title: t('list.tint.' + c), dataset: { fid: 'tint-' + c },
    onclick: () => { color = c; paint(); } }, h('span.swatch-dot')));
  const glyphBtns = LIST_GLYPHS.map(k => h('button.glyph-opt', { type: 'button', 'aria-label': t('list.glyph.' + k), title: t('list.glyph.' + k), dataset: { fid: 'glyph-' + k },
    onclick: () => { glyph = k; icon = ''; customIn.value = ''; paint(); } }, drawGlyph(k)));
  const customIn = h('input.f-in.icon-custom', { type: 'text', value: customIcon(icon), autocomplete: 'off', autocapitalize: 'off', enterkeyhint: 'done',
    placeholder: t('list.iconCustomPh'), dataset: { fid: 'icon-custom' },
    oninput: () => { icon = customIcon(customIn.value); paint(); },
    onblur: () => { customIn.value = customIcon(customIn.value); },
    onkeydown: onEnter(() => save()) });
  // 整组的名字是字段的标题「图标」（field 给 aria-labelledby）
  const iconPick = h('div.icon-pick', { role: 'group' }, h('div.glyph-grid', null, glyphBtns),
    h('label.icon-custom-row', null, h('span.icon-custom-label', null, t('list.iconCustom')), customIn));
  function paint() {
    const look = listLook({ kind, icon, glyph, color });
    preview.replaceChildren(listTile({ kind, icon, glyph, color }, 'le-preview'));
    iconPick.setAttribute('class', 'icon-pick tint-' + look.color);
    LIST_GLYPHS.forEach((k, n) => { const on = look.glyph === k; glyphBtns[n].classList.toggle('on', on); glyphBtns[n].setAttribute('aria-pressed', String(on)); });
    LIST_COLORS.forEach((c, n) => { const on = look.color === c; swatches[n].classList.toggle('on', on); swatches[n].setAttribute('aria-pressed', String(on)); });
    customIn.classList.toggle('on', !look.glyph);
  }
  paint();
  const colorRow = field(t('list.color'), h('div.swatches', { role: 'group' }, swatches));
  const iconRow = field(t('list.icon'), iconPick);

  // 默认商店：没归档的，按顺序；现在选着的那家归档了也留在选项里（不然一打开就悄悄改掉了）
  const stores = live(ctx.state, 'stores').filter(s => !s.archived || s.id === init.store).sort(byOrder);
  const storeSel = h('select.f-in', null, h('option', { value: '' }, t('list.noStore')),
    stores.map(s => h('option', { value: s.id, selected: s.id === init.store }, s.archived ? t('item.storeArchived', { name: s.name }) : s.name)));
  storeSel.value = init.store;
  const storeRow = field(t('list.defaultStore'), storeSel, { help: t('list.defaultStoreHelp') });

  // 归档、删除马上生效：先关面板（改了名字、图标还没存时先问「放弃修改？」），再交给页面
  const act = (fn) => closeThen(ctx, () => dirty(), () => s, () => fn && fn());
  const actions = editing ? h('div.sheet-actions', null,
    h('button.btn.block', { type: 'button', onclick: act(onArchive) }, t(list.archived ? 'list.unarchive' : 'list.archive')),
    list.archived ? null : h('p.f-help', null, t('list.archiveHelp')),
    list.sys
      ? h('p.f-help', null, t('list.sysNoDelete'))
      : h('button.btn.block.danger', { type: 'button', onclick: act(onDelete) }, t('list.delete'))) : null;

  const vals = () => ({ name: nameIn.value.trim(), icon, glyph, color, store: storeSel.value, kind });
  const lookChanged = (v) => v.icon !== init.icon || v.glyph !== init.glyph;
  const dirty = () => { const v = vals(); return v.name !== init.name.trim() || lookChanged(v) || v.color !== init.color || v.store !== init.store || v.kind !== init.kind; };
  const s = ctx.sheet(h('div.form', null, preview, nameRow, kindRow, colorRow, iconRow, storeRow, actions), {
    title: editing ? t('list.editTitle') : t('list.new'), cls: 'list-sheet',
    beforeClose: discardGuard(ctx, dirty, () => s),
    foot: [
      h('button.btn', { type: 'button', onclick: () => s.close() }, t('common.cancel')),
      h('button.btn.primary', { type: 'button', onclick: () => save() }, editing ? t('common.save') : t('list.create')),
    ],
  });
  if (!editing) setTimeout(() => nameIn.focus(), 0);

  function save() {
    const v = vals(), now = Date.now();
    const res = editing
      // 图标、颜色、默认商店只交改了的：新版才有的图标、色调（这里显示成默认的）没动就原样留着；换了图标两样一起交（只留一样在 core 里做）
      ? ctx.mutate(st => editList(st, list.id, { name: v.name, ...(lookChanged(v) ? { icon: v.icon, glyph: v.glyph } : {}), ...(v.color !== init.color ? { color: v.color } : {}),
        ...(v.store !== init.store ? { defaultStoreId: v.store || null } : {}) }, now))
      : ctx.mutate(st => createList(st, { name: v.name, kind: v.kind, icon: v.icon, glyph: v.glyph, color: v.color, defaultStoreId: v.store || null }, now));
    if (!res.ok) { showErr(nameRow, res.errors.name || res.errors.list); if (res.errors.name) nameIn.focus(); return; }
    s.close();
    if (!editing && onCreated) onCreated(res.id);
  }
  return s;
}
