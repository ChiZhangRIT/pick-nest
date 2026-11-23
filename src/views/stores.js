// 「商店」（#/stores）：每家店还要买几样（跨所有清单；数法在 core/stores.js 的 storeRows），点一行进这家店的页面（#/s/<id>）。
// 没归档的店按顺序都列出来，0 样的淡一点（还是能点进去看「已买」）；归档了的店还有要买的东西时也列出来、标着「已归档」，
// 不然指定给它的东西就在哪儿都看不到了；没指定商店的（还有商店删掉了的）在最后的「未指定」里（#/s/none）。
// 右上角「管理商店」去设置 → 商店。没有输入框，数据变了由 app 整页重画。
// 大标题下面「所有清单 ▾」可以只看一张清单（ui/storeFilter.js，本机记住，和每家店的页面共用）：数的就只是这张清单上的，只列这张清单在那儿有东西的店，
// 下面说一句另外几家没列（选一张清单是要看它要去哪几家，一排 0 会把有东西的埋在中间）。
// 换了以后整个 App 重画（ctx.refresh）：双栏时右栏那家店也要跟着换。
// 宽屏双栏时在左栏（params.pane === 'list'）：右栏正在看的那家店（params.selected，「未指定」是 'none'）高亮。
import { h } from '../ui/dom.js';
import { t } from '../i18n.js';
import { storeRows, emptyStoresIn } from '../core/stores.js';
import { NO_STORE } from '../core/group.js';
import { filterButton, currentFilter } from '../ui/storeFilter.js';

export function render(main, params, ctx) {
  const f = currentFilter(ctx);
  const rows = storeRows(ctx.state, { listId: f.id });
  const hidden = emptyStoresIn(ctx.state, { listId: f.id });
  const count = (n) => [
    // 数字给眼睛看；读屏念整句「还要买 3 样」
    h('span.list-count' + (n ? '' : '.zero'), { 'aria-hidden': 'true' }, String(n)),
    h('span.sr-only', null, t('list.needN', { n })),
  ];
  const sel = (id) => !!params.selected && params.selected === (id || NO_STORE);
  const row = ({ id, store, n }) => h('li', null, h('a.group-row.store-row.go' + (n ? '' : '.zero') + (sel(id) ? '.sel' : ''),
    { href: '#/s/' + encodeURIComponent(id || NO_STORE), dataset: { id: id || NO_STORE }, 'aria-current': sel(id) ? 'page' : null },
    h('span.store-name', null, store ? store.name : t('store.none')),
    store && store.archived ? h('span.tag', null, t('store.archivedTag')) : null,
    count(n)));

  main.append(
    h('header.page-head', null,
      h('div.toolbar', null, h('span'), h('a.tb-btn', { href: '#/settings/stores' }, t('store.manage'))),
      h('h1.lt', null, t('nav.stores')),
      h('div.sf-row', null, filterButton(ctx, { fid: 'sf-stores', onPicked: () => ctx.refresh() }))),
    h('div.page', null, rows.length
      ? [h('ul.group.stores', { 'aria-label': t('nav.stores') }, rows.map(row)),
        hidden ? h('p.group-foot.sf-hidden', null, t('store.hiddenN', { n: hidden, name: f.name })) : null]
      : h('p.empty', null, f.id ? t('store.emptyIn', { name: f.name }) : t('store.empty'))));
}
