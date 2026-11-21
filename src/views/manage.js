// 设置 → 商店（#/settings/stores）、设置 → 分类（#/settings/categories）。推入的页面：顶栏（吸顶）左边返回「设置」，右边「新增」。
// 商店：没归档的按顺序，每行右边一对 ↑↓（44px，读屏念「上移『Costco』」；到头了的标 aria-disabled，按到头时焦点不丢）；
//   点名字（右边有 ›，读屏念「编辑『Costco』」）打开面板：改名、归档 / 取消归档、删除（先问一句，10 秒内可以撤销）。
//   归档的收在下面「已归档（N）」里（没有 ↑↓）。
// 分类：按用在哪种清单分三组（食材 / 一般 / 两边都用），组内 ↑↓（组里的顺序就是清单里分组的顺序）；点名字改名、删除；新增时选名字和用在哪种。
// 预置的商店、分类和自己加的一样，都能改、能删（删掉的预置记录不会自己回来）。
// 规则在 core/stores.js、core/categories.js。面板不在页面里，数据变了由 app 整页重画；↑↓ 和名字带 data-fid，重画后焦点还在同一个按钮上，
// 页面也滚到按过的按钮还在手指下面，可以连着按；删掉一行之前焦点先给同一组的下一行。
import { h, icon, keepUnderFinger } from '../ui/dom.js';
import { t } from '../i18n.js';
import { categoryName } from '../core/store.js';
import { countUsing } from '../core/items.js';
import { activeStores, archivedStores, liveStore, createStore, renameStore, setStoreArchived, deleteStore, moveStore } from '../core/stores.js';
import { categorySections, CATEGORY_SECTIONS, sectionOf, liveCategory, createCategory, renameCategory, deleteCategory, moveCategory } from '../core/categories.js';
import { nameSheet } from '../ui/nameSheet.js';

/** 推入的页面的顶栏（返回、新增；和清单页一样吸顶：分类那一页很长，滚下去也要能返回、新增）和标题，返回放内容的容器 */
function frame(main, ctx, title, addLabel, onAdd) {
  const page = h('div.page.manage');
  main.append(
    h('header.navbar.lp-nav', null,
      h('button.back', { type: 'button', onclick: () => ctx.back('/settings') }, icon('back'), t('nav.settings')),
      h('button.tb-btn', { type: 'button', dataset: { fid: 'mg-add' }, onclick: onAdd }, icon('plus'), addLabel)),
    h('div.page.push-head', null, h('h1.push-title', null, title)),
    page);
  return page;
}

/** 一对 ↑↓（move 是 core 里的 moveStore / moveCategory） */
function movers(main, ctx, id, name, first, last, move) {
  const mv = (dir, ic, key, edge) => {
    const fid = `mv-${dir > 0 ? 'down' : 'up'}-${id}`;
    return h('button.icon-btn.mv-btn', { type: 'button', 'aria-label': t(key, { name }), 'aria-disabled': String(edge), dataset: { fid },
      onclick: () => { if (!edge) keepUnderFinger(ctx, main, fid, () => ctx.mutate(s => move(s, id, dir, Date.now()))); } }, icon(ic));
  };
  return h('span.mv', null, mv(-1, 'up', 'list.moveUp', first), mv(1, 'down', 'list.moveDown', last));
}
/**
 * 一行：名字是按钮（打开面板），右边是 ↑↓（归档的那一组没有：组名已经说了「已归档」）。
 * 名字后面画一个 ›、读屏念「编辑『Costco』」：不然看不出点名字能改（归档的那一组只有名字，像是一行字）
 */
const nameRow = (id, name, onOpen, extra) => h('li.group-row.manage-row', { dataset: { id } },
  h('button.manage-name', { type: 'button', 'aria-label': t('item.edit', { name }), 'aria-haspopup': 'dialog', dataset: { fid: 'nm-' + id }, onclick: onOpen },
    h('span', null, name)), extra);

/**
 * 删除前问一句：会影响几样东西（数法在 core/items.js 的 countUsing），确定了才删，10 秒内可以撤销。
 * 删之前焦点先给同一组里下面的一行（没有就上面的，整组没了给「新增」）：重画后 app 按 data-fid 放回，不掉回页首
 */
async function confirmDelete(main, ctx, { title, message, run, undoLabel, ids, id }) {
  if (!(await ctx.confirm({ title, message, confirmLabel: t('common.delete'), danger: true }))) return;
  const k = ids.indexOf(id), next = k < 0 ? null : ids[k + 1] || ids[k - 1];
  const el = main.querySelector(`[data-fid="${next ? 'nm-' + next : 'mg-add'}"]`);
  if (el) el.focus({ preventScroll: true });
  ctx.mutate(run, { undoLabel });
}

// ======================================================================
// 设置 → 商店
// ======================================================================
export function storesPage(main, params, ctx) {
  const page = frame(main, ctx, t('set.stores'), t('store.add'), () => addStore());
  const active = activeStores(ctx.state), archived = archivedStores(ctx.state);
  page.append(
    active.length
      ? h('ul.group.manage-list', { 'aria-label': t('set.stores') },
        active.map((s, i) => nameRow(s.id, s.name, () => editStore(s.id), movers(main, ctx, s.id, s.name, i === 0, i === active.length - 1, moveStore))))
      : h('p.empty', null, t('store.noActive')),
    h('p.group-foot', null, t('store.manageHelp')),
    archived.length ? h('section.set-sec.manage-arch', null, h('h2.group-h', null, t('store.archivedN', { n: archived.length })),
      h('ul.group.manage-list.archived', { 'aria-label': t('store.archivedN', { n: archived.length }) },
        archived.map(s => nameRow(s.id, s.name, () => editStore(s.id), null)))) : null);

  function addStore() {
    nameSheet(ctx, { title: t('store.add'), label: t('store.name'), placeholder: t('store.namePh'), submitLabel: t('store.create'), focus: true,
      save: ({ name }) => ctx.mutate(s => createStore(s, { name }, Date.now())) });
  }
  function editStore(id) {
    const s = liveStore(ctx.state, id);
    if (!s) return;
    nameSheet(ctx, { title: t('store.editTitle'), label: t('store.name'), value: s.name, placeholder: t('store.namePh'),
      save: ({ name }) => ctx.mutate(st => renameStore(st, id, name, Date.now())),
      actions: (act) => [
        h('button.btn.block', { type: 'button', onclick: act(() => archive(s)) }, t(s.archived ? 'store.unarchive' : 'store.archive')),
        s.archived ? null : h('p.f-help', null, t('store.archiveHelp')),
        h('button.btn.block.danger', { type: 'button', onclick: act(() => remove(s)) }, t('store.delete')),
      ] });
  }
  function archive(s) {
    ctx.mutate(st => setStoreArchived(st, s.id, !s.archived, Date.now()), { undoLabel: t(s.archived ? 'store.unarchived' : 'store.archived', { name: s.name }) });
  }
  // 东西的 storeId 不动：删掉以后显示成「未指定」，撤销（以后还有最近删除）时回到这家
  const remove = (s) => confirmDelete(main, ctx, { title: t('store.deleteQ', { name: s.name }), message: t('store.deleteMsg', { n: countUsing(ctx.state, 'storeId', s.id) }),
    run: st => deleteStore(st, s.id, Date.now()), undoLabel: t('store.deleted', { name: s.name }), ids: (s.archived ? archived : active).map(x => x.id), id: s.id });
}

// ======================================================================
// 设置 → 分类
// ======================================================================
export function categoriesPage(main, params, ctx) {
  const page = frame(main, ctx, t('set.categories'), t('cat.add'), () => addCategory());
  const secs = categorySections(ctx.state);
  for (const sec of CATEGORY_SECTIONS) {
    const arr = secs[sec];
    page.append(h('section.set-sec.cat-sec', { dataset: { sec } }, h('h2.group-h', null, t('cat.sec.' + sec)),
      arr.length
        ? h('ul.group.manage-list', { 'aria-label': t('cat.sec.' + sec) }, arr.map((c, i) => {
          const name = categoryName(c, t);
          return nameRow(c.id, name, () => editCategory(c.id), movers(main, ctx, c.id, name, i === 0, i === arr.length - 1, moveCategory));
        }))
        : h('p.group-foot.cat-empty', null, t('cat.secEmpty'))));
  }
  page.append(h('p.group-foot', null, t('cat.manageHelp')));

  function addCategory() {
    nameSheet(ctx, { title: t('cat.add'), label: t('cat.name'), placeholder: t('cat.namePh'), submitLabel: t('cat.create'), focus: true,
      kinds: { label: t('cat.kind'), value: 'grocery', options: CATEGORY_SECTIONS.map(sec => [sec, t('cat.kind.' + sec)]), help: t('cat.kindFixed') },
      // 给 t：没改过名的预置分类按显示的名字比重名
      save: ({ name, kind }) => ctx.mutate(s => createCategory(s, { name, kind }, Date.now(), t)) });
  }
  function editCategory(id) {
    const c = liveCategory(ctx.state, id);
    if (!c) return;
    const name = categoryName(c, t);
    // 预置分类的名字可以清空：占位文字就是自带的名字，清空了就显示它。说明是一整句（各语言自己的标点），不在这里拼
    const kind = t('cat.kindName.' + sectionOf(c.kind));
    nameSheet(ctx, { title: t('cat.editTitle'), label: t('cat.name'), value: c.name, placeholder: c.sys ? categoryName({ ...c, name: '' }, t) : t('cat.namePh'),
      help: t(c.sys ? 'cat.sysKindIs' : 'cat.kindIs', { kind }),
      save: ({ name: nm }) => ctx.mutate(s => renameCategory(s, id, nm, Date.now(), t)),
      actions: (act) => [h('button.btn.block.danger', { type: 'button', onclick: act(() => remove(c, name)) }, t('cat.delete'))] });
  }
  // 东西的 categoryId 不动：删掉以后归到「未分类」，撤销时回来
  const remove = (c, name) => confirmDelete(main, ctx, { title: t('cat.deleteQ', { name }), message: t('cat.deleteMsg', { n: countUsing(ctx.state, 'categoryId', c.id) }),
    run: s => deleteCategory(s, c.id, Date.now()), undoLabel: t('cat.deleted', { name }), ids: secs[sectionOf(c.kind)].map(x => x.id), id: c.id });
}
