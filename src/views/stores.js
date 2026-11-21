// 「商店」（#/stores）：每家店还要买几样（跨所有清单；数法在 core/stores.js 的 storeRows），点一行进这家店的页面（#/s/<id>）。
// 没归档的店按顺序都列出来，0 样的淡一点（还是能点进去看「已买」）；归档了的店还有要买的东西时也列出来、标着「已归档」，
// 不然指定给它的东西就在哪儿都看不到了；没指定商店的（还有商店删掉了的）在最后的「未指定」里（#/s/none）。
// 右上角「管理商店」去设置 → 商店。没有输入框，数据变了由 app 整页重画。
// 宽屏双栏时在左栏（params.pane === 'list'）：右栏正在看的那家店（params.selected，「未指定」是 'none'）高亮。
import { h } from '../ui/dom.js';
import { t } from '../i18n.js';
import { storeRows } from '../core/stores.js';
import { NO_STORE } from '../core/group.js';

export function render(main, params, ctx) {
  const rows = storeRows(ctx.state);
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
      h('h1.lt', null, t('nav.stores'))),
    h('div.page', null, rows.length
      ? h('ul.group.stores', { 'aria-label': t('nav.stores') }, rows.map(row))
      : h('p.empty', null, t('store.empty'))));
}
