// 新建 / 编辑清单的面板（首页「新建清单」、清单页「⋯ → 编辑清单」共用）。面板不在页面里：数据变了页面重画也不会打断输入。
// 名字、图标、默认商店点「完成」才存；类型只在新建时选（里面的东西的分类、「以后再说」都跟着类型）。
// 归档、删除马上生效，由调用的页面做（它要先离开这一页，再改数据、弹「撤销」）。
import { h } from './dom.js';
import { t } from '../i18n.js';
import { field, showErr, discardGuard, closeThen, onEnter } from './form.js';
import { createList, editList, LIST_ICONS, firstGrapheme } from '../core/lists.js';
import { listName, live, byOrder, DEFAULT_LIST_ICON } from '../core/store.js';
import { liveStore } from '../core/stores.js';

/**
 * listSheet(ctx, { list })：list 给了就是编辑，否则新建。
 * onCreated(id) 新建好了；onArchive() 点了归档 / 取消归档；onDelete() 确认了删除（只有自建清单有这个按钮）
 */
export function listSheet(ctx, { list = null, onCreated = null, onArchive = null, onDelete = null } = {}) {
  const editing = !!list;
  let kind = editing ? list.kind : 'general';          // 预置的「食材」已经有了，自己建的多半是一般清单（木工、衣服……）
  let chosen = editing ? list.icon : '';
  // 默认商店删掉了：显示「未指定」，不动它就不算修改（存的时候也不交这一项：商店恢复了，默认商店跟着回来）
  const init = { name: editing ? list.name : '', icon: chosen, store: (editing && list.defaultStoreId && liveStore(ctx.state, list.defaultStoreId) && list.defaultStoreId) || '', kind };

  const nameIn = h('input.f-in', { type: 'text', value: init.name, maxlength: 80, autocomplete: 'off', enterkeyhint: 'done',
    placeholder: editing && list.sys ? listName({ ...list, name: '' }, t) : t('list.namePh'),
    onkeydown: onEnter(() => save()) });
  const nameRow = field(t('list.name'), nameIn);

  const kindRow = editing ? null : field(t('list.kind'), h('div.kind-pick', { role: 'radiogroup' }, ['general', 'grocery'].map(k =>
    h('label.kind-opt', null,
      h('input', { type: 'radio', name: 'list-kind', value: k, checked: k === kind, onchange: () => { kind = k; paintIcons(); } }),
      h('span.kind-text', null, h('b', null, t('list.kind.' + k)), h('small', null, t('list.kind.' + k + 'Hint')))))),
  { help: t('list.kindFixed') });

  // 图标：16 个常用的 + 自己输入一个 emoji。没选的显示成按类型的默认图标（存的是空的，换了类型跟着变）
  const iconBtns = LIST_ICONS.map(e => h('button.icon-opt', { type: 'button', onclick: () => { chosen = e; customIn.value = ''; paintIcons(); } }, e));
  const customIn = h('input.f-in.icon-custom', { type: 'text', value: chosen && !LIST_ICONS.includes(chosen) ? chosen : '', autocomplete: 'off',
    placeholder: t('list.iconCustom'), 'aria-label': t('list.iconCustom'),
    oninput: () => { const g = firstGrapheme(customIn.value); if (g) { chosen = g; paintIcons(); } },
    onblur: () => { customIn.value = firstGrapheme(customIn.value); if (!customIn.value && !LIST_ICONS.includes(chosen)) { chosen = ''; paintIcons(); } } });
  function paintIcons() {
    const cur = chosen || DEFAULT_LIST_ICON[kind];
    for (const b of iconBtns) { const on = b.textContent === cur; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
  }
  paintIcons();
  const iconRow = field(t('list.icon'), h('div.icon-pick', null, h('div.icon-grid', { role: 'group' }, iconBtns), customIn));

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

  const vals = () => ({ name: nameIn.value.trim(), icon: chosen, store: storeSel.value, kind });
  const dirty = () => { const v = vals(); return v.name !== init.name.trim() || v.icon !== init.icon || v.store !== init.store || v.kind !== init.kind; };
  const s = ctx.sheet(h('div.form', null, nameRow, kindRow, iconRow, storeRow, actions), {
    title: editing ? t('list.editTitle') : t('list.new'), cls: 'list-sheet',
    beforeClose: discardGuard(ctx, dirty, () => s),
    foot: [
      h('button.btn', { type: 'button', onclick: () => s.close() }, t('common.cancel')),
      h('button.btn.primary', { type: 'button', onclick: () => save() }, editing ? t('common.done') : t('list.create')),
    ],
  });
  if (!editing) setTimeout(() => nameIn.focus(), 0);

  function save() {
    const v = vals(), now = Date.now();
    const res = editing
      ? ctx.mutate(st => editList(st, list.id, { name: v.name, icon: v.icon, ...(v.store !== init.store ? { defaultStoreId: v.store || null } : {}) }, now))
      : ctx.mutate(st => createList(st, { name: v.name, kind: v.kind, icon: v.icon, defaultStoreId: v.store || null }, now));
    if (!res.ok) { showErr(nameRow, res.errors.name || res.errors.list); if (res.errors.name) nameIn.focus(); return; }
    s.close();
    if (!editing && onCreated) onCreated(res.id);
  }
  return s;
}
