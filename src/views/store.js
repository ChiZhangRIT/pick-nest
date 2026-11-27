// 一家店（#/s/<storeId>；#/s/none 是「未指定」）：所有清单里要在这家买的东西，按分类分组（和清单页同一套规则，core/stores.js 的 groupStore），
// 每一行标着来自哪张清单（图标 + 名字）；点圆圈勾掉（记下这次在这家买的，core/items.js 的 setStatus），点这一行别的地方打开同一个编辑面板；
// 下面「已买（N）」可以折起来（每家店在这台设备上各自记住），「清除已买」能撤销。归档的清单上的东西不在这里，「以后再说」的也不在。
// 商店不在了（地址错了、删掉了）→ 回「商店」并提示。
// 自己管更新（返回 onChange）：勾掉的行挪走以后焦点给谁、刚挪过的行这一下不算，都要跨重画记着（ui/checklist.js，和清单页一样）。
// 顶栏右边 ⋯（和清单页一样）：清除已买、「屏幕常亮」开关（ui/keepAwake.js，和清单页共用；开着时 ⋯ 左边一个「屏幕常亮中」的小标签）。
// 行能左右滑（ui/checklist.js，和清单页一样）；正在滑时数据变了，滑完再重画。
// 「还要买 N 样」右边「所有清单 ▾」可以只看一张清单（ui/storeFilter.js，本机记住，和「商店」页共用）：数、要买的、已买的、清除已买都只算这张，
// 行上不再标来自哪张清单（都是同一张）；空的时候说清是「在「木工」里」没有。换了以后整个 App 重画（双栏时左栏「商店」的数也要跟着变）。
import { h, icon, backText } from '../ui/dom.js';
import { t } from '../i18n.js';
import { liveStore, storeCounts, groupStore, clearStoreDone, setStoreArchived } from '../core/stores.js';
import { collatorFor, storeView, storeViewPatch, NO_STORE } from '../core/group.js';
import { checklist, foldSec, listChip, groupSections } from '../ui/checklist.js';
import { filterButton, currentFilter } from '../ui/storeFilter.js';
import { keepAwake } from '../ui/keepAwake.js';

/** @param {{ swipe?: object, wake?: object }} [deps]  测试用：交给 ui/swipe.js 的 createSwipes 的 env；wake 交给 ui/keepAwake.js（假的 wakeLock、document） */
export function render(main, params, ctx, deps = {}) {
  const storeId = params.id === NO_STORE ? null : params.id;
  const store = () => (storeId ? liveStore(ctx.state, storeId) : null);
  let leaving = false;
  // 商店不在了：等这次挂载做完再换页（挂载中途换页会把「商店」画进同一个容器）
  function gone() {
    if (leaving) return;
    leaving = true;
    queueMicrotask(() => { ctx.navigate('/stores', { replace: true }); ctx.toast(t('store.gone')); });
  }
  if (storeId && !store()) { gone(); return undefined; }

  const cl = checklist(ctx, main, deps.swipe);
  const view = () => storeView(ctx.local, storeId);
  const setView = (patch) => ctx.setLocal(storeViewPatch(ctx.local, storeId, patch));

  // 顶栏吸顶（和清单页一样）：长的一页滚下去也能返回；双栏右栏里 CSS 把返回藏起来（左栏就是上一页）
  const moreBtn = h('button.icon-btn', { type: 'button', 'aria-label': t('common.more'), title: t('common.more'), dataset: { fid: 'lp-more' }, onclick: () => menu() }, icon('more'));
  const awake = keepAwake(ctx, main, { ...deps.wake, focusTo: () => moreBtn });
  const navbar = h('header.navbar.lp-nav', null, h('button.back', { type: 'button', onclick: () => ctx.back('/stores') }, icon('back'), backText(ctx, t('nav.stores'))),
    h('div.nav-acts', null, awake.chip, moreBtn));
  const head = h('div.page.lp-head');
  // 筛哪张清单每次画的时候重新读：那张清单在别的设备上删掉、归档了，下一次画就是所有清单
  const only = () => ({ listId: currentFilter(ctx).id });
  function drawHead() {
    const s = store();
    const n = storeCounts(ctx.state, only()).get(storeId) || 0;     // 和「商店」页同一个数法
    head.replaceChildren(...[
      // 标题能接焦点（tabindex -1）：按过的按钮重画后没了（取消归档），焦点给它（ui/checklist.js 的 keepFocus）
      h('div.lp-title', null, h('span.lp-icon.sp-icon', { 'aria-hidden': 'true' }, icon('store')), h('h1.lp-name', { tabindex: -1, dataset: { fid: 'lp-title' } }, s ? s.name : t('store.none'))),
      h('div.lp-sub', null, h('span.lp-count', null, t('list.needN', { n })),
        filterButton(ctx, { fid: 'sf-store', storeId, onPicked: () => ctx.refresh() })),
      storeId ? null : h('p.sp-hint', null, t('store.noneHint')),
      s && s.archived ? h('div.lp-banner', { role: 'status' }, h('span', null, t('store.archivedBanner')),
        h('button.btn.small', { type: 'button', dataset: { fid: 'lp-unarchive' }, onclick: () => ctx.mutate(st => setStoreArchived(st, s.id, false, Date.now()), { undoLabel: t('store.unarchived', { name: s.name }) }) },
          t('store.unarchive'))) : null,
    ].filter(Boolean));
  }

  const body = h('div.page.lp-body');
  function drawBody() {
    const v = view();
    const f = currentFilter(ctx);
    const { groups, done } = groupStore(ctx.state, storeId, collatorFor(ctx.lang()), { listId: f.id });
    // 每行标来自哪张清单（ui/checklist.js 的 listChip）；只看一张清单时都是它，不标
    const items = (arr) => h('ul.group.items', null, arr.map(it => cl.row(it, f.id ? null : listChip(ctx, it))));
    cl.draw(() => {
      const kids = [];
      if (!groups.length) {
        const hint = f.id ? t('store.filterHint', { name: f.name }) : storeId ? t('store.nothingHint') : null;
        kids.push(done.length ? h('p.empty.lp-empty', null, f.id ? t('store.allDoneIn', { name: f.name }) : t('store.allDone'))
          : h('div.empty.lp-empty', null, h('p', null, h('b', null, f.id ? t('store.nothingIn', { name: f.name }) : t('store.nothing'))), hint ? h('p.small', null, hint) : null));
      }
      kids.push(...groupSections(ctx, groups, 'category', items));
      if (done.length) {
        kids.push(foldSec('done', t('list.doneN', { n: done.length }), v.showDone, () => { setView({ showDone: !view().showDone }); cl.keepFocus(drawBody); }, () => items(done),
          h('button.link-btn.clear-done', { type: 'button', dataset: { fid: 'lp-clear' }, onclick: () => clear() }, t('list.clearDone'))));
      }
      body.replaceChildren(...kids);
    });
  }
  // 清掉的是在这家买的（各自清单的「已买」里也就没了；只看一张清单时只清看得到的），10 秒内可以撤销
  const doneCount = () => groupStore(ctx.state, storeId, undefined, only()).done.length;
  function clear() {
    const f = only();
    const n = doneCount();
    if (n) ctx.mutate(s => clearStoreDone(s, storeId, Date.now(), f), { undoLabel: t('list.cleared', { n }) });
  }
  // ⋯：和清单页同一个样子（上面一组是操作，下面一组是屏幕常亮）。商店本身的改名、归档在「设置 → 商店」里，这里不重复
  function menu() {
    const s = store();
    if (storeId && !s) return;
    ctx.sheet((api) => {
      const item = (label, fn) => h('button.group-row.menu-row', { type: 'button', onclick: () => { api.close(); fn(); } }, h('span', null, label));
      return h('div.menu-groups', null, doneCount() ? h('div.group.menu', null, item(t('list.clearDone'), () => clear())) : null, awake.menuGroup(api));
    }, { title: s ? s.name : t('store.none'), cls: 'menu-sheet' });
  }

  main.append(navbar, head, body);
  drawHead();
  drawBody();
  return {
    onChange: () => cl.whenIdle(() => {
      if (storeId && !store()) { gone(); return; }
      cl.keepFocus(() => { drawHead(); drawBody(); });
    }),
    // 离开时点过、还没挪的，马上改：点过的不能丢（商店删掉了也一样：东西还在各自的清单上）
    cleanup: () => { awake.stop(); cl.flush(); cl.destroy(); },
    flush: () => cl.flush(),        // 切到后台：同上，app 接着把它传上去
  };
}
