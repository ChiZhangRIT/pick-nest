// 购物模式（#/l/<listId>?shop=1、#/s/<storeId>?shop=1；app.js 里的页面名是 'shop'，params.sub 'list' | 'store'）：在店里边走边勾。
// 字和勾更大（行至少 60px），没有底栏、侧栏、⋯，宽屏上也占满整个窗口；最上面一直是名字、「完成购物」、「已买 N · 还剩 M」和一条细的进度条。
// 已买的收到最下面紧凑的「已买（N）」里，每次进购物模式都是折起来的（点开只管这一次，不用普通页面「已买」折没折的设置；点一下放回去）；
// 都买齐了换成「都买齐了」，带「完成购物」「清除已买」（能撤销）。「以后再说」的不出现（这次不打算买）。
// 和普通页面同一套：分组（core/group.js 的 groupNeed、core/stores.js 的 groupStore）、能勾的行和勾选的节奏（ui/checklist.js）、
// 进度（core/shop.js 的 shopProgress）、清除已买（items.js 的 clearDone、stores.js 的 clearStoreDone）。
// 屏幕常亮：core/wake.js（离开时放掉；不支持、被拒绝时最下面淡淡地说一句，拿到了不说）。地址里带着 ?shop=1：重新载入还在购物模式；数据都在本机，没网照常用。
// 清单 / 商店不在了 → 回首页 / 「商店」并提示（和普通页面一样）。
// 自己管更新（返回 onChange）：勾掉的行挪走以后焦点给谁、刚挪过的行这一下不算，都要跨重画记着。
// 行能左右滑（ui/checklist.js，和普通页面一样：编辑、删除、以后再说）；正在滑时数据变了，滑完再重画。
import { h, icon } from '../ui/dom.js';
import { t } from '../i18n.js';
import { listName, listIcon } from '../core/store.js';
import { liveList, clearDone } from '../core/items.js';
import { liveStore, groupStore, clearStoreDone } from '../core/stores.js';
import { groupNeed, collatorFor, listView, NO_STORE } from '../core/group.js';
import { shopProgress } from '../core/shop.js';
import { screenWake } from '../core/wake.js';
import { checklist, foldSec, storeChip, listChip, groupSections } from '../ui/checklist.js';

// 常亮拿到了不说（少一行字；有的 iOS 版本在主屏幕 App 里给了也不管用，说了反而不对），没拿到才淡淡地说一句
const WAKE_TEXT = { unsupported: 'shop.noWake', denied: 'shop.wakeFail' };

/** @param {{ swipe?: object }} [deps]  测试用：交给 ui/swipe.js 的 createSwipes 的 env */
export function render(main, params, ctx, deps = {}) {
  const kind = params.sub === 'store' ? 'store' : 'list';
  const listId = kind === 'list' ? params.id : null;
  const storeId = kind === 'store' && params.id !== NO_STORE ? params.id : null;
  const list = () => (listId ? liveList(ctx.state, listId) : null);
  const store = () => (storeId ? liveStore(ctx.state, storeId) : null);
  const exists = () => (kind === 'list' ? !!list() : !storeId || !!store());
  // 「完成购物」回到的普通页面
  const normal = (kind === 'list' ? '/l/' : '/s/') + encodeURIComponent(params.id);
  let leaving = false;
  // 清单 / 商店不在了：等这次挂载做完再换页（挂载中途换页会把别的页面画进同一个容器）
  function gone() {
    if (leaving) return;
    leaving = true;
    queueMicrotask(() => { ctx.navigate(kind === 'list' ? '/' : '/stores', { replace: true }); ctx.toast(t(kind === 'list' ? 'list.gone' : 'store.gone')); });
  }
  if (!exists()) { gone(); return undefined; }

  const cl = checklist(ctx, main, deps.swipe);
  const progress = () => shopProgress(ctx.state, kind, kind === 'list' ? listId : storeId);
  // 「已买」一进来是折起来的：在店里要看的是还剩什么，勾掉的就收走（普通页面的「已买」默认展开，所以不用它的设置）。
  // 点开了只管这一次购物（不存）：重新载入、下次进来又是折起来的
  let doneOpen = false;
  const toggleDone = () => { doneOpen = !doneOpen; cl.keepFocus(drawBody); };
  const finish = () => ctx.back(normal);
  const finishBtn = (fid) => h('button.btn.primary.shop-finish', { type: 'button', dataset: { fid }, onclick: finish }, t('shop.finish'));

  // ---------- 上面：名字、完成购物、进度（吸顶；只换字和进度条的长短，按钮不换掉） ----------
  const nameEl = h('span.shop-name');
  const progText = h('span.shop-prog-text');
  const barFill = h('span.shop-bar-fill');
  const bar = h('div.shop-bar', { role: 'progressbar', 'aria-label': t('shop.progressLabel'), 'aria-valuemin': '0' }, barFill);
  const top = h('header.shop-top', null, h('div.shop-top-in', null,
    h('div.shop-row', null,
      // 标题能接焦点（tabindex -1）：按过的按钮重画后没了（清除已买），焦点给它（ui/checklist.js 的 keepFocus）
      h('h1.shop-title', { tabindex: -1, dataset: { fid: 'lp-title' } },
        h('span.shop-icon', { 'aria-hidden': 'true' }, kind === 'list' ? listIcon(list()) : icon('store')), nameEl),
      finishBtn('shop-finish')),
    h('div.shop-prog', null, progText), bar));
  function drawTop() {
    const p = progress(), s = store();
    nameEl.textContent = kind === 'list' ? listName(list(), t) : s ? s.name : t('store.none');
    const text = t('shop.progress', { done: p.done, left: p.left });
    progText.textContent = text;
    bar.setAttribute('aria-valuemax', String(p.total));
    bar.setAttribute('aria-valuenow', String(p.done));
    bar.setAttribute('aria-valuetext', text);
    barFill.style.width = (p.total ? Math.round((p.done / p.total) * 100) : 0) + '%';
  }

  // ---------- 列表 ----------
  const body = h('div.page.lp-body.shop-body');
  function clear() {
    const n = progress().done;
    if (n) ctx.mutate(s => (kind === 'list' ? clearDone(s, listId, Date.now()) : clearStoreDone(s, storeId, Date.now())), { undoLabel: t('list.cleared', { n }) });
  }
  const clearBtn = (fid, tag = 'button.btn') => h(tag + '.shop-clear', { type: 'button', dataset: { fid }, onclick: () => clear() }, t('list.clearDone'));
  function drawBody() {
    const coll = collatorFor(ctx.lang());
    const groupBy = kind === 'list' ? listView(ctx.local, listId).groupBy : 'category';
    const { groups, done } = kind === 'list' ? groupNeed(ctx.state, listId, groupBy, coll) : groupStore(ctx.state, storeId, coll);
    // 小标签和普通页面一样：清单的标不在默认商店买的（按商店分组时组名就是店，不标），商店的标来自哪张清单
    const ds = kind === 'list' ? list().defaultStoreId : null;
    const chip = (it, needRow) => (kind === 'store' ? listChip(ctx, it) : needRow && groupBy === 'store' ? null : storeChip(ctx, it, ds));
    const rows = (arr, needRow) => h('ul.group.items', null, arr.map(it => cl.row(it, chip(it, needRow))));
    const p = progress();
    cl.draw(() => {
      const kids = [];
      if (p.finished) {
        kids.push(h('section.card.shop-end', null,
          h('div.shop-end-ic', { 'aria-hidden': 'true' }, icon('check')),
          h('h2.shop-end-t', null, t('shop.allDone')),
          h('p.shop-end-hint', null, t('shop.allDoneHint', { n: p.done })),
          h('div.shop-end-btns', null, finishBtn('shop-finish-end'), clearBtn('shop-clear-end'))));
      } else if (!p.total) {
        kids.push(h('section.empty.lp-empty.shop-none', null, h('p', null, h('b', null, t('shop.nothing'))),
          h('p.small', null, t('shop.nothingHint')), h('div.shop-end-btns', null, finishBtn('shop-finish-end'))));
      }
      kids.push(...groupSections(ctx, groups, groupBy, arr => rows(arr, true)));
      // 都买齐了时上面已经有「清除已买」，这里不再放一个
      if (done.length) kids.push(foldSec('done', t('list.doneN', { n: done.length }), doneOpen, toggleDone, () => rows(done, false),
        p.finished ? null : clearBtn('lp-clear', 'button.link-btn.clear-done')));
      body.replaceChildren(...kids);
    });
  }

  // ---------- 屏幕常亮 ----------
  const wakeLine = h('p.shop-wake', { hidden: true });
  const wake = screenWake({ wakeLock: navigator.wakeLock, doc: document, onChange: () => paintWake() });
  function paintWake() {
    const st = wake.status();
    // 正在要（点一下再要的时候）不动这一行：先藏起来、被拒绝了再出来，页面最下面一缩一伸，滚到底时手指下面的行会跳开
    if (st === 'asking') return;
    const key = WAKE_TEXT[st];
    wakeLine.textContent = key ? t(key) : '';
    wakeLine.hidden = !key;
  }
  // 有的浏览器只在点按里才给常亮：之前没要到（被拒绝、被系统收回）时，点一下页面再要一次。
  // 听 click 不听 pointerdown：手指按下还不算「点过」（只有鼠标按下算），松开以后才算；键盘按的按钮也有 click
  const retry = () => wake.retry();
  main.addEventListener('click', retry);

  main.append(top, body, h('div.page', null, wakeLine));
  drawTop();
  drawBody();
  wake.start();
  paintWake();

  return {
    onChange: () => cl.whenIdle(() => {
      if (!exists()) { gone(); return; }
      cl.keepFocus(() => { drawTop(); drawBody(); });
    }),
    cleanup: () => {
      wake.stop();
      main.removeEventListener('click', retry);
      // 离开时点过、还没挪的，马上改：点过的不能丢（清单删掉了的不改；商店删掉了照改，东西还在各自的清单上）
      if (leaving && kind === 'list') cl.drop(); else cl.flush();
      cl.destroy();
    },
    flush: () => { if (!(leaving && kind === 'list')) cl.flush(); },       // 切到后台：同上，app 接着把它传上去
  };
}
