// 最近删除（#/deleted，从设置 → 数据进来）：删掉的清单、东西、商店、分类，分组列出，各自新删的在前（core/deleted.js 的 recentlyDeleted）。
// 每一行：名字（清单带图标，下面说里面的东西会一起回来；东西下面是来自哪张清单，「清除已买」清掉的标「已买」）、什么时候删的、「恢复」。
// 恢复前先问 core 会不会撞名（restoreBlock），撞了就说为什么、不恢复；能恢复就 ctx.restore（弹「已恢复」，同步时别的设备也跟着恢复）。
// 东西可能很多（「清除已买」清掉的也在这里）：先列 50 样，「再显示 50 样」。
// 没有输入框，数据变了由 app 整页重画；恢复之前焦点先给下一行的「恢复」（没有了给标题），重画后 app 按 data-fid 放回，键盘、读屏不掉回页首。
import { h, pushFrame } from '../ui/dom.js';
import { t } from '../i18n.js';
import { listName, listIcon, categoryName } from '../core/store.js';
import { liveList } from '../core/items.js';
import { recentlyDeleted, restoreBlock, itemsWithList, DELETED_KINDS } from '../core/deleted.js';
import { fmtWhen } from '../core/dates.js';

const STEP = 50;
// 这次打开 App 期间记住：东西那一组显示到第几样
const ui = { shown: STEP };

export function render(main, params, ctx) {
  const lang = ctx.lang();
  const page = pushFrame(main, ctx, t('deleted.title'), { back: '/settings/data', backLabel: t('set.data'), cls: 'deleted' });
  const groups = recentlyDeleted(ctx.state);
  const nameOf = (c, r) => (c === 'lists' ? listName(r, t) : c === 'categories' ? categoryName(r, t) : r.name);
  const fid = (c, r) => `del-${c}-${r.id}`;

  /** 这一行下面那一小行：来自哪张清单 / 一起回来几样 / 已买，再加删掉的时间 */
  function sub(c, r) {
    const bits = [];
    if (c === 'items') {
      const l = liveList(ctx.state, r.listId);
      if (l) bits.push(h('span.store-chip.list-chip', null, h('span.list-chip-ic', { 'aria-hidden': 'true' }, listIcon(l)), listName(l, t)));
      if (r.status === 'done') bits.push(h('span.tag', null, t('deleted.cleared')));
    }
    if (c === 'lists') { const n = itemsWithList(ctx.state, r.id); if (n) bits.push(h('span', null, t('deleted.withItems', { n }))); }
    bits.push(h('span.del-at', null, fmtWhen(r.deletedAt || r.updatedAt, lang)));
    return h('span.item-sub.del-sub', null, bits);
  }
  function row(c, r, i, arr) {
    const name = nameOf(c, r);
    return h('li.group-row.del-row', { dataset: { id: r.id } },
      c === 'lists' ? h('span.list-icon', { 'aria-hidden': 'true' }, listIcon(r)) : null,
      h('span.del-text', null, h('span.del-name', null, name), sub(c, r)),
      h('button.btn.small', { type: 'button', 'aria-label': t('deleted.restoreName', { name }), dataset: { fid: fid(c, r) },
        onclick: () => restore(c, r, name, arr[i + 1] || arr[i - 1] || null) }, t('deleted.restore')));
  }
  function restore(c, r, name, next) {
    const why = restoreBlock(ctx.state, c, r.id, t);
    // 这一页上没有打开的清单：撞名的东西要说是哪张清单上的
    const l = c === 'items' ? liveList(ctx.state, r.listId) : null;
    if (why) { ctx.toast(t('deleted.block.' + why, { name, list: l ? listName(l, t) : '' }), { ms: 8000 }); return; }
    // 这一行马上就没了：焦点先给同一组的下一行（没有就上一行，整组都没了给标题），重画后放回同一个按钮
    const el = main.querySelector(`[data-fid="${next ? fid(c, next) : 'del-title'}"]`);
    if (el) el.focus({ preventScroll: true });
    ctx.restore(c, r.id);
  }

  const title = main.querySelector('.push-title');
  if (title) { title.tabIndex = -1; title.dataset.fid = 'del-title'; }
  page.append(h('p.del-lead', null, t('deleted.lead')));
  if (!DELETED_KINDS.some(c => groups[c].length)) { page.append(h('p.empty', null, t('deleted.empty'))); return; }
  for (const c of DELETED_KINDS) if (groups[c].length) page.append(section(c));

  /** 一组。东西那一组先列 ui.shown 样：「再显示」就地换掉这一组（不整页重画：滚动位置不动），焦点给新列出来的第一样 */
  function section(c) {
    const arr = groups[c];
    const shown = c === 'items' ? arr.slice(0, ui.shown) : arr;
    const more = arr.length - shown.length;
    const el = h('section.set-sec.del-sec', { dataset: { kind: c } },
      h('h2.group-h', null, t('deleted.sec.' + c)),
      h('ul.group.del-list', { 'aria-label': t('deleted.sec.' + c) }, shown.map((r, i) => row(c, r, i, shown))),
      more ? h('button.link-btn.del-more', { type: 'button', dataset: { fid: 'del-more' }, onclick: () => {
        const first = arr[ui.shown];
        ui.shown += STEP;
        const next = section(c);
        el.replaceWith(next);
        const f = first && next.querySelector(`[data-fid="${fid(c, first)}"]`);
        if (f) f.focus({ preventScroll: true });
      } }, t('deleted.more', { n: Math.min(STEP, more) })) : null);
    return el;
  }
}
