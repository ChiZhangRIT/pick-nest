// 一家店（#/s/<storeId>；#/s/none 是「未指定」）：所有清单里要在这家买的东西，按分类分组（和清单页同一套规则，core/stores.js 的 groupStore），
// 每一行标着来自哪张清单（图标 + 名字）；点一行勾掉（记下这次在这家买的，core/items.js 的 setStatus），› 打开同一个编辑面板；
// 下面「已买（N）」可以折起来（每家店在这台设备上各自记住），「清除已买」能撤销。归档的清单上的东西不在这里，「以后再说」的也不在。
// 商店不在了（地址错了、删掉了）→ 回「商店」并提示。
// 自己管更新（返回 onChange）：勾掉的行挪走以后焦点给谁、刚挪过的行这一下不算，都要跨重画记着（ui/checklist.js，和清单页一样）。
// 顶栏右边「开始购物」进购物模式（#/s/<id>?shop=1，views/shop.js）。
import { h, icon, backText } from '../ui/dom.js';
import { t } from '../i18n.js';
import { liveStore, storeCounts, groupStore, clearStoreDone, setStoreArchived } from '../core/stores.js';
import { collatorFor, storeView, storeViewPatch, NO_STORE } from '../core/group.js';
import { checklist, foldSec, listChip, groupSections } from '../ui/checklist.js';

export function render(main, params, ctx) {
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

  const cl = checklist(ctx, main);
  const view = () => storeView(ctx.local, storeId);
  const setView = (patch) => ctx.setLocal(storeViewPatch(ctx.local, storeId, patch));

  // 顶栏吸顶（和清单页一样）：长的一页滚下去也能返回；双栏右栏里 CSS 把返回藏起来（左栏就是上一页）
  const navbar = h('header.navbar.lp-nav', null, h('button.back', { type: 'button', onclick: () => ctx.back('/stores') }, icon('back'), backText(ctx, t('nav.stores'))),
    h('button.tb-btn.shop-btn', { type: 'button', dataset: { fid: 'lp-shop' }, onclick: () => ctx.navigate('/s/' + encodeURIComponent(params.id) + '?shop=1') }, icon('cart'), t('shop.start')));
  const head = h('div.page.lp-head');
  function drawHead() {
    const s = store();
    const n = storeCounts(ctx.state).get(storeId) || 0;     // 和「商店」页同一个数法
    head.replaceChildren(...[
      // 标题能接焦点（tabindex -1）：按过的按钮重画后没了（取消归档），焦点给它（ui/checklist.js 的 keepFocus）
      h('div.lp-title', null, h('span.lp-icon.sp-icon', { 'aria-hidden': 'true' }, icon('store')), h('h1.lp-name', { tabindex: -1, dataset: { fid: 'lp-title' } }, s ? s.name : t('store.none'))),
      h('div.lp-sub', null, h('span.lp-count', null, t('list.needN', { n }))),
      storeId ? null : h('p.sp-hint', null, t('store.noneHint')),
      s && s.archived ? h('div.lp-banner', { role: 'status' }, h('span', null, t('store.archivedBanner')),
        h('button.btn.small', { type: 'button', dataset: { fid: 'lp-unarchive' }, onclick: () => ctx.mutate(st => setStoreArchived(st, s.id, false, Date.now()), { undoLabel: t('store.unarchived', { name: s.name }) }) },
          t('store.unarchive'))) : null,
    ].filter(Boolean));
  }

  const body = h('div.page.lp-body');
  // 每行标来自哪张清单（ui/checklist.js 的 listChip）
  const items = (arr) => h('ul.group.items', null, arr.map(it => cl.row(it, listChip(ctx, it))));
  function drawBody() {
    const v = view();
    const { groups, done } = groupStore(ctx.state, storeId, collatorFor(ctx.lang()));
    cl.draw(() => {
      const kids = [];
      if (!groups.length) {
        kids.push(done.length ? h('p.empty.lp-empty', null, t('store.allDone'))
          : h('div.empty.lp-empty', null, h('p', null, h('b', null, t('store.nothing'))), storeId ? h('p.small', null, t('store.nothingHint')) : null));
      }
      kids.push(...groupSections(ctx, groups, 'category', items));
      if (done.length) {
        kids.push(foldSec('done', t('list.doneN', { n: done.length }), v.showDone, () => { setView({ showDone: !view().showDone }); cl.keepFocus(drawBody); }, () => items(done),
          h('button.link-btn.clear-done', { type: 'button', dataset: { fid: 'lp-clear' }, onclick: () => clear() }, t('list.clearDone'))));
      }
      body.replaceChildren(...kids);
    });
  }
  // 清掉的是在这家买的（各自清单的「已买」里也就没了），10 秒内可以撤销
  function clear() {
    const n = groupStore(ctx.state, storeId).done.length;
    if (n) ctx.mutate(s => clearStoreDone(s, storeId, Date.now()), { undoLabel: t('list.cleared', { n }) });
  }

  main.append(navbar, head, body);
  drawHead();
  drawBody();
  return {
    onChange: () => {
      if (storeId && !store()) { gone(); return; }
      cl.keepFocus(() => { drawHead(); drawBody(); });
    },
    // 离开时点过、还没挪的，马上改：点过的不能丢（商店删掉了也一样：东西还在各自的清单上）
    cleanup: () => cl.flush(),
    flush: () => cl.flush(),        // 切到后台：同上，app 接着把它传上去
  };
}
