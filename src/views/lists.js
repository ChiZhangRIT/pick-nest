// 首页「清单」（#/）：没归档、没删除的清单，按顺序排，每张显示还要买几样。
// 现在只能看：清单页在第 3 步才有，所以每一行画成普通的列表行，不做成链接或按钮（不放点了没反应的东西）。
import { h } from '../ui/dom.js';
import { t } from '../i18n.js';
import { homeLists, needCounts, listName, listIcon } from '../core/store.js';

export function render(main, params, ctx) {
  const lists = homeLists(ctx.state);
  const counts = needCounts(ctx.state);
  main.append(
    h('header.page-head', null, h('h1.lt', null, t('nav.lists'))),
    h('div.page', null, lists.length
      ? h('ul.group.lists', { 'aria-label': t('nav.lists') }, lists.map(l => {
        const n = counts.get(l.id) || 0;
        return h('li.group-row.list-row', { dataset: { id: l.id } },
          h('span.list-icon', { 'aria-hidden': 'true' }, listIcon(l)),
          h('span.list-name', null, listName(l, t)),
          // 数字给眼睛看；读屏念整句「还要买 3 样」
          h('span.list-count' + (n ? '' : '.zero'), { 'aria-hidden': 'true' }, String(n)),
          h('span.sr-only', null, t('list.needN', { n })));
      }))
      : h('p.empty', null, t('list.none'))));
}
