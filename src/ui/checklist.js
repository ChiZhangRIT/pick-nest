// 能勾的一行和勾选的节奏：清单页（views/list.js）、商店页（views/store.js）、购物模式（views/shop.js）、搜索（views/search.js）共用。
// 一行：左边的大圆勾 + 名字（下面一行是页面给的小标签——清单页标商店、商店页标来自哪张清单——和备注的第一行）+ 数量 + ›。
// 只有点左边的圆圈才勾掉 / 取消（以前点整行就勾，推着车、滚着页面很容易误勾）；点这一行别的地方打开编辑面板（ui/itemEditor.js），› 只是提示。
// 圆圈是单独的按钮，占满左边一栏、整行高（≥ 48 × 48，在店里单手也点得中）。
// 小标签（storeChip、listChip）、组名（groupTitle）和分好的组（groupSections）也在这里，几个页面画得一样。
// 网页 App 没有震动，用动画代替：先在原地打勾、划线（或者在「已买」里去掉勾），约 0.3 秒后再挪过去；
// 连着点几样时等最后一下之后一起挪（挪的时候行会动，手指下面换了一样东西）；减少动态效果时马上挪。
// 刚挪了位置的行，紧接着点它的圆圈不算（连点两下不会改掉两样）；用键盘、读屏勾掉一样以后，焦点给顶替它位置的那一样的圆圈。
// 规则在 core/items.js（setStatus：勾成已买时记下这次的商店）。
// 每一行能左右滑（ui/swipe.js，照 babble）：往右露出「编辑」，往左露出红色的「删除」（core/items.js 的 swipeActions）。
// 滑开只是露出按钮，点了按钮才做；点开着的行（圆圈也好、别处也好）只是关上，不勾掉、不打开面板。
// 删除和编辑面板里的「删除」同一条路（进「最近删除」，10 秒内能撤销），编辑就是点这一行打开的那个面板。
// 一行是 <li.item-row>（可滑的那一层）> <div.item-in>（跟着手指动的：圆圈 + 这一行的编辑按钮）+ 露出来时才建的按钮。
import { h, icon } from './dom.js';
import { t } from '../i18n.js';
import { liveItem, liveList, setStatus, untickStatus, storeExists, swipeActions } from '../core/items.js';
import { listName, listIcon, categoryName } from '../core/store.js';
import { qtyLabel } from '../core/parse.js';
import { itemSheet, removeItem } from './itemEditor.js';
import { createSwipes } from './swipe.js';

const TICK_MS = 320;          // 点了以后在原地停多久再挪
const SETTLE_MS = 350;        // 刚挪过位置的行，这么久之内点到的不算：手指多半是冲着原来在那儿的那一行去的
const firstLine = (s) => String(s || '').split('\n').map(x => x.trim()).find(Boolean) || '';

/**
 * checklist(ctx, main, swipeEnv) → { row, draw, keepFocus, flash, flashNow, flush, drop, whenIdle, destroy }
 *   swipeEnv：测试用，交给 ui/swipe.js 的 createSwipes（时钟、计时器、宽度、减少动态效果）
 *   row(it, chip, { name, note })  画一行（chip：页面给的小标签元素（可以是几个的数组），或 null；
 *                   name / note：代替名字、备注第一行的内容（搜索把命中的字标出来），不给就是原文）
 *   draw(fn)        重画列表：fn 里调 row() 把行放进页面；前后比一比哪些行挪了位置，画完闪一下要闪的那一行
 *   keepFocus(fn)   重画以后焦点放回同一个控件（带 data-fid 的）；勾掉的那一行挪走了就给顶替它的那一行，控件没了给页面标题
 *   flash(id)       下次画完闪这一行；flashNow() 现在就闪（数据没变、不会重画的时候）
 *   flush()         点过、还没挪的马上改，滑开以后点了、还在等动画的删除也马上做（离开页面、切到后台时）；drop() 勾过的不改了（清单删掉、归档了）
 *   whenIdle(fn)    数据变了要重画（页面的 onChange）：正在滑、行在动、删除在等动画时等做完再画（最多等几秒），不然手底下的行换成新的
 *   destroy()       离开页面（页面的 cleanup 里，flush / drop 之后）：不再听手势
 */
export function checklist(ctx, main, swipeEnv) {
  const reduced = () => !globalThis.matchMedia || matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pending = new Map();            // 点过、还没挪的：id → 要改成的状态（'done' | 'need' | 'later'：刚从以后再说勾掉的放回去，core 的 untickStatus）
  let tickTimer = null;
  let rowEls = new Map();               // id → { li, check, sec }，按页面上的顺序（闪一下、滚到看得见、挪走以后焦点给谁）
  let moved = new Set(), movedUntil = 0;  // 上次重画时挪了位置的行（SETTLE_MS 之内点它不算）
  let focusTo = null;                   // 下次重画后焦点给谁（勾掉的那一行挪走了）
  let flashId = null;
  const swipes = createSwipes(swipeEnv);

  /** 打勾的样子：点过还没挪的按要改成的状态画（「已买」里去掉了勾的、要买里打上了勾的） */
  const checkedNow = (it) => (pending.has(it.id) ? pending.get(it.id) === 'done' : it.status === 'done');
  function row(it, chip = null, { name = null, note = null } = {}) {
    const was = it.status === 'done', checked = checkedNow(it);
    const q = qtyLabel(it.qty, it.unit);
    const nt = note || firstLine(it.note);
    const hasChip = Array.isArray(chip) ? chip.some(Boolean) : !!chip;
    // 圆圈的名字只是东西的名字（读屏：「牛奶，复选框，未勾选」），数量、小标签、备注当说明念（这一行的按钮名字是「编辑「牛奶」」，那里念不到）。
    // id 一页里不会重：一样东西在一页上只画一次
    const sub = hasChip || nt ? h('span.item-sub', { id: 'pn-sub-' + it.id }, chip, nt ? h('span.item-note', null, nt) : null) : null;
    const qty = q ? h('span.item-qty', { id: 'pn-qty-' + it.id }, q) : null;
    const desc = [qty, sub].filter(Boolean).map(x => x.id).join(' ');
    const check = h('button.item-tick', { type: 'button', role: 'checkbox', 'aria-checked': String(checked), 'aria-label': it.name,
      'aria-describedby': desc || null, dataset: { fid: 'it-' + it.id }, onclick: () => tap(it.id) },
    h('span.check', { 'aria-hidden': 'true' }, icon('check')));
    const body = h('button.item-main', { type: 'button', 'aria-label': t('item.edit', { name: it.name }), 'aria-haspopup': 'dialog', dataset: { fid: 'ed-' + it.id },
      onclick: () => itemSheet(ctx, it.id) },
    h('span.item-text', null, h('span.item-name', null, name || it.name), sub),
    qty,
    h('span.item-chev', { 'aria-hidden': 'true' }, icon('chev')));
    const inner = h('div.item-in', null, check, body);
    const li = h('li.item-row' + (was && checked ? '.done' : '') + (!was && checked ? '.ticking' : ''), { dataset: { id: it.id } });
    swipes.wrap(inner, { el: li, id: it.id, focus: check, ...swipeButtons(it) });
    rowEls.set(it.id, { li, check, sec: it.status });
    return li;
  }
  /** 左右滑露出的按钮（core/items.js 的 swipeActions 定）：往右「编辑」，往左「删除」；按钮上的字短，读屏念的带上名字 */
  function swipeButtons(it) {
    const id = it.id, name = it.name;
    const make = {
      edit: () => ({ key: 'edit', cls: 'sw-edit', icon: 'pencil', label: t('item.swEdit'), aria: t('item.edit', { name }), instant: true, run: () => itemSheet(ctx, id) }),
      delete: () => ({ key: 'delete', cls: 'sw-del', icon: 'trash', label: t('common.delete'), aria: t('item.swDelete', { name }), out: true,
        run: () => { pending.delete(id); removeItem(ctx, id); } }),
    };
    const a = swipeActions(ctx.state, it);
    return { left: a.left.map(k => make[k]()), right: a.right.map(k => make[k]()) };
  }

  function draw(fn) {
    const tops = rowTops();
    rowEls = new Map();
    swipes.reset();                     // 重画：开着的那行关上（这一页自己点按钮引起的重画除外，见 ui/swipe.js）
    fn();
    markMoved(tops);
    flashNow();
  }
  // 重画前后每一行在屏幕上的位置：挪了的行记下来，刚挪到手指下面的那一行这一下不算点它（连点两下不会改掉两样）
  function rowTops() {
    const m = new Map();
    for (const [id, r] of rowEls) if (r.li.getBoundingClientRect) m.set(id, r.li.getBoundingClientRect().top);
    return m;
  }
  function markMoved(tops) {
    moved = new Set();
    if (!tops.size) return;
    for (const [id, r] of rowEls) if (!tops.has(id) || Math.abs(tops.get(id) - r.li.getBoundingClientRect().top) > 1) moved.add(id);
    movedUntil = Date.now() + SETTLE_MS;
  }
  /**
   * 重画以后焦点放回同一个控件（带 data-fid 的：同一样东西的圆圈和这一行的编辑按钮、同一个折叠按钮），读屏和键盘不用从头找。
   * 例外：勾掉（或放回去）的那一行挪到别的区了，焦点给顶替它位置的那一行（focusTo），键盘、读屏接着往下走；
   * 没有可给的就跟着它走，而且滚过去（不然焦点在看不见的地方）。
   * 那个控件没了（这一样删掉了、移到别的清单了，「取消归档」「清除已买」按完那一块就没了）：给页面标题（data-fid="lp-title"），不掉回页首的 <body>
   */
  function keepFocus(fn) {
    const a = document.activeElement, fid = a && a.dataset && main.contains(a) ? a.dataset.fid : null;
    const to = focusTo;
    focusTo = null;
    fn();
    if (!fid) return;
    if (to && to.from === fid) {
      const el = main.querySelector(`[data-fid="${to.to || fid}"]`);
      if (el) { el.focus(); return; }
    }
    const el = main.querySelector(`[data-fid="${fid}"]`) || main.querySelector('[data-fid="lp-title"]');
    if (el && document.activeElement !== el) el.focus({ preventScroll: true });
  }
  function flashNow() {
    const r = flashId && rowEls.get(flashId);
    if (!r) return;
    flashId = null;
    const el = r.li;
    el.classList.remove('flash');
    void el.offsetWidth;                // 重新开始动画
    el.classList.add('flash');
    // 吸顶的顶栏（清单页还有快速添加）和底下的提示条让开多少，在 CSS 的 scroll-margin 里
    if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
  }

  // 点了圆圈：要买、以后再说 → 已买；已买 → 要买（刚从以后再说勾掉的回以后再说）。先只改这一行的样子，停一下（TICK_MS）再一起改数据、挪位置；还没挪之前再点一下 = 不改了
  function tap(id) {
    const it = liveItem(ctx.state, id);
    if (!it) return;
    if (moved.has(id) && Date.now() < movedUntil) return;
    if (pending.has(id)) pending.delete(id);
    else pending.set(id, it.status === 'done' ? untickStatus(ctx.state, it) : 'done');
    paintRow(id);
    clearTimeout(tickTimer);
    tickTimer = null;
    if (!pending.size) return;
    if (reduced()) flushTicks(); else tickTimer = setTimeout(flushTicks, TICK_MS);
  }
  function paintRow(id) {
    const r = rowEls.get(id), it = liveItem(ctx.state, id);
    if (!r || !it) return;
    const was = it.status === 'done', checked = checkedNow(it);
    r.li.classList.toggle('done', was && checked);
    r.li.classList.toggle('ticking', !was && checked);
    r.check.setAttribute('aria-checked', String(checked));
  }
  function flushTicks() {
    clearTimeout(tickTimer);
    tickTimer = null;
    if (!pending.size) return;
    const batch = new Map(pending);
    pending.clear();
    focusTo = nextFocus(batch);
    const now = Date.now();
    const back = ctx.mutate(s => {
      let last = null;
      for (const [id, st] of batch) {
        const was = liveItem(s, id);
        if (was && was.status !== st && setStatus(s, id, st, now) && st !== 'done') last = id;
      }
      return last;
    });
    if (back) flashId = back;     // 从「已买」放回来：重画后在新位置闪一下（不闪「已买」里那一行旧的）
    // 重画在微任务里（app.js），排在这个前面；什么也没改（不重画）时也别留到下一次不相干的重画
    queueMicrotask(() => { focusTo = null; });
  }
  /** 焦点在要挪走的一行上：重画后给同一区里它下面的一行（没有就上面的），这一批一起挪走的不算 */
  function nextFocus(batch) {
    const a = document.activeElement, fid = a && a.dataset && main.contains(a) ? a.dataset.fid : '';
    const id = fid && fid.startsWith('it-') ? fid.slice(3) : null;
    if (!id || !batch.has(id) || !rowEls.has(id)) return null;
    const sec = rowEls.get(id).sec;
    const ids = [...rowEls.keys()].filter(x => rowEls.get(x).sec === sec);
    const i = ids.indexOf(id), stays = (x) => !batch.has(x);
    const next = ids.slice(i + 1).find(stays) || ids.slice(0, i).reverse().find(stays);
    return { from: fid, to: next ? 'it-' + next : null };
  }

  return {
    row, draw, keepFocus, flashNow,
    flush() { swipes.settle(); flushTicks(); },
    flash(id) { flashId = id; },
    drop() { clearTimeout(tickTimer); tickTimer = null; pending.clear(); },
    whenIdle: (fn) => swipes.whenIdle(fn),
    destroy: () => swipes.destroy(),
  };
}

/**
 * 可以折起来的一组（以后再说、已买）：标题是按钮（aria-expanded），折起来时不画里面的行。
 * onToggle 由页面改记住的状态、重画；extra 是标题右边的按钮（清除已买）
 */
export function foldSec(key, title, open, onToggle, content, extra = null) {
  return h('section.lp-sec.sec-' + key, null,
    h('div.sec-head', null,
      h('button.sec-toggle', { type: 'button', 'aria-expanded': String(open), dataset: { fid: 'sec-' + key }, onclick: onToggle },
        icon('chev', { cls: 'sec-chev' }), h('span', null, title)),
      extra),
    open ? content() : null);
}

// ---------- 行里的小标签、组名、分好的组（清单页、商店页、购物模式、搜索一样） ----------
const storeNameOf = (ctx, id) => (storeExists(ctx.state, id) ? ctx.state.data.stores[id].name : '');
/**
 * 商店小标签：只标和清单默认商店不一样的（每行都写「Whole Foods」等于没写，例外的「H Mart」反而看不出来）。
 * 删掉的商店不标（算「未指定」）
 */
export function storeChip(ctx, it, defaultStoreId) {
  const name = it.storeId && it.storeId !== defaultStoreId ? storeNameOf(ctx, it.storeId) : '';
  return name ? h('span.store-chip', null, name) : null;
}
/** 来自哪张清单：图标给眼睛看（aria-hidden），读屏念清单名 */
export function listChip(ctx, it) {
  const l = liveList(ctx.state, it.listId);
  return l ? h('span.store-chip.list-chip', null, h('span.list-chip-ic', { 'aria-hidden': 'true' }, listIcon(l)), listName(l, t)) : null;
}
/** 组名：按分类分组时是分类名，按商店分组时是店名；null 是「未分类 / 未指定商店」 */
export function groupTitle(ctx, id, groupBy = 'category') {
  if (!id) return t(groupBy === 'store' ? 'list.noStoreGroup' : 'list.uncategorized');
  return groupBy === 'store' ? storeNameOf(ctx, id) : categoryName(ctx.state.data.categories[id], t);
}
/**
 * 「要买」的几组（core/group.js 的 groupItems 分好的）画成 <section.grp>：组名 + 一组行（rows(items) 画）。
 * 只有一组而且是「未分类 / 未指定」时不写组名（一般清单常常都没分类，写一个「未分类」只是噪音）
 */
export function groupSections(ctx, groups, groupBy, rows) {
  const bare = groups.length === 1 && groups[0].id === null;
  return groups.map(g => h('section.grp', null, bare ? null : h('h2.group-h', null, groupTitle(ctx, g.id, groupBy)), rows(g.items)));
}
