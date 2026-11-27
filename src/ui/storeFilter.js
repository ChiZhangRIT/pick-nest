// 按商店看时只看一张清单：「商店」页、一家店上面那个「所有清单 ▾」/「木工 ▾」按钮，点开是选清单的面板。
// 选的是哪张记在本机（picknest.local 的 storeFilter，不同步：手机上只看「木工」、iPad 上看全部都可以），几个页面共用一个：
// 换一家店还是同一张，不用每家各选一次。规则（记着的清单删掉、归档了按所有清单显示，各行的数）在 core/stores.js。
// 选了以后由页面决定怎么重画（onPicked）：「商店」页和一家店整个重画（双栏时左右两栏都要跟着变）。
import { h, icon } from './dom.js';
import { t } from '../i18n.js';
import { listName } from '../core/store.js';
import { storeFilter, storeFilterPatch, storeFilterOptions } from '../core/stores.js';
import { listTile } from './listTile.js';

/** 选项前面的方块：清单用自己的图标方块；「所有清单」是 App 的清单图标放在中性的底上（它不是一张清单，不给色调） */
const tile = (list, cls) => (list ? listTile(list, cls) : h('span.list-tile.sf-all-tile.' + cls, { 'aria-hidden': 'true' }, icon('list')));
const nameOf = (list) => (list ? listName(list, t) : t('store.filterAll'));

/** 现在筛的那张清单（null = 所有清单）和它的名字：页面的空状态、说明里用 @returns {{ id: string | null, list: object | null, name: string }} */
export function currentFilter(ctx) {
  const id = storeFilter(ctx.state, ctx.local);
  const list = id ? ctx.state.data.lists[id] : null;
  return { id, list, name: nameOf(list) };
}

/**
 * 按钮：方块 + 名字 + ▾。只看一张清单时带 .on（换成强调色），一眼看得出这一页少了东西。
 * fid：每个页面各用各的（双栏时左右两栏各有一个，重画后焦点要回到按过的那一个）。
 * storeId：在一家店的页面上（null = 未指定）面板里的数只算这家店的；「商店」页不给
 * @param {object} ctx @param {{ fid: string, storeId?: string | null, onPicked: () => void }} o
 */
export function filterButton(ctx, { fid, storeId, onPicked }) {
  const cur = currentFilter(ctx);
  const btn = h('button.sf-btn' + (cur.id ? '.on' : ''), {
    type: 'button', 'aria-haspopup': 'dialog', 'aria-label': t('store.filterAria', { name: cur.name }), dataset: { fid },
    onclick: () => openPicker(ctx, { storeId, onPicked, from: btn }),
  }, tile(cur.list, 'sf-ic'), h('span.sf-name', null, cur.name), icon('chevDown', { cls: 'sf-chev' }));
  return btn;
}

/**
 * 选清单的面板：「所有清单」+ 首页上的每张清单（没删除、没归档，首页的顺序），各带还要买几样（0 的淡一点）；现在选的那一行打勾（aria-current）。
 * 点一行就关上；和记着的不一样就记下，看到的变了才让页面重画（点的还是原来那一行只关上）。
 * 比的是记着的值、不是现在生效的：记着的「木工」归档了，面板上勾的是「所有清单」，点「所有清单」也要记下来，
 * 不然取消归档以后又悄悄只看「木工」了
 * @param {object} ctx @param {{ storeId?: string | null, onPicked: () => void, from?: HTMLElement }} o
 */
export function openPicker(ctx, { storeId, onPicked, from }) {
  const cur = storeFilter(ctx.state, ctx.local);
  const opts = storeFilterOptions(ctx.state, storeId === undefined ? {} : { storeId });
  let s = null;
  function pick(id) {
    s.close();
    // 面板关上时焦点回到按钮上（app 重画以后照 data-fid 放回新的那个按钮）
    if (from && from.isConnected) from.focus();
    const patch = storeFilterPatch(id);
    if (patch.storeFilter !== storeFilterPatch(ctx.local && ctx.local.storeFilter).storeFilter) ctx.setLocal(patch);
    if (id !== cur) onPicked();
  }
  const rows = opts.map(({ id, list, n }) => h('li', null, h('button.group-row.sf-opt', {
    type: 'button', 'aria-current': id === cur ? 'true' : null, dataset: { fid: 'sf-opt-' + (id || 'all') }, onclick: () => pick(id),
  },
  tile(list, 'sf-opt-ic'),
  h('span.sf-opt-name', null, nameOf(list)),
  // 数字给眼睛看；读屏念整句「还要买 3 样」（和「商店」页一样）
  h('span.list-count' + (n ? '' : '.zero'), { 'aria-hidden': 'true' }, String(n)),
  h('span.sr-only', null, t('list.needN', { n })),
  h('span.sf-mark', { 'aria-hidden': 'true' }, id === cur ? icon('check') : null))));
  s = ctx.sheet(h('div.sf-sheet', null,
    h('p.f-help.sf-help', null, t(storeId === undefined ? 'store.filterHelp' : 'store.filterHelpHere')),
    h('ul.group.sf-list', null, rows)), { title: t('store.filterTitle'), cls: 'sf-picker' });
  // 焦点先给现在选的那一行（不是 ✕）：键盘、读屏一打开就知道现在看的是哪张
  const on = s.el.querySelector('[aria-current="true"]');
  if (on) on.focus();
  return s;
}
