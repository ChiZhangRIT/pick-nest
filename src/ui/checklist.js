// 能勾的一行和勾选的节奏：清单页（views/list.js）和商店页（views/store.js）共用。
// 一行：大圆勾 + 名字（下面一行是页面给的小标签——清单页标商店、商店页标来自哪张清单——和备注的第一行）+ 数量；点整行勾掉 / 取消，右边的 › 打开编辑面板（ui/itemEditor.js）。
// 网页 App 没有震动，用动画代替：先在原地打勾、划线（或者在「已买」里去掉勾），约 0.3 秒后再挪过去；
// 连着点几样时等最后一下之后一起挪（挪的时候行会动，手指下面换了一样东西）；减少动态效果时马上挪。
// 刚挪了位置的行，紧接着的一下不算（连点两下不会改掉两样）；用键盘、读屏勾掉一样以后，焦点给顶替它位置的那一样。
// 规则在 core/items.js（setStatus：勾成已买时记下这次的商店）。
import { h, icon } from './dom.js';
import { t } from '../i18n.js';
import { liveItem, setStatus } from '../core/items.js';
import { qtyLabel } from '../core/parse.js';
import { itemSheet } from './itemEditor.js';

const TICK_MS = 320;          // 点了以后在原地停多久再挪
const SETTLE_MS = 350;        // 刚挪过位置的行，这么久之内点到的不算：手指多半是冲着原来在那儿的那一行去的
const firstLine = (s) => String(s || '').split('\n').map(x => x.trim()).find(Boolean) || '';

/**
 * checklist(ctx, main) → { row, draw, keepFocus, flash, flashNow, flush, drop }
 *   row(it, chip)   画一行（chip：页面给的小标签元素，或 null）
 *   draw(fn)        重画列表：fn 里调 row() 把行放进页面；前后比一比哪些行挪了位置，画完闪一下要闪的那一行
 *   keepFocus(fn)   重画以后焦点放回同一个控件（带 data-fid 的）；勾掉的那一行挪走了就给顶替它的那一行，控件没了给页面标题
 *   flash(id)       下次画完闪这一行；flashNow() 现在就闪（数据没变、不会重画的时候）
 *   flush()         点过、还没挪的马上改（离开页面时）；drop() 不改了（清单删掉、归档了）
 */
export function checklist(ctx, main) {
  const reduced = () => !globalThis.matchMedia || matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pending = new Map();            // 点过、还没挪的：id → 要改成的状态（'done' | 'need'）
  let tickTimer = null;
  let rowEls = new Map();               // id → { li, check, sec }，按页面上的顺序（闪一下、滚到看得见、挪走以后焦点给谁）
  let moved = new Set(), movedUntil = 0;  // 上次重画时挪了位置的行（SETTLE_MS 之内点它不算）
  let focusTo = null;                   // 下次重画后焦点给谁（勾掉的那一行挪走了）
  let flashId = null;

  /** 打勾的样子：点过还没挪的按要改成的状态画（「已买」里去掉了勾的、要买里打上了勾的） */
  const checkedNow = (it) => (pending.has(it.id) ? pending.get(it.id) === 'done' : it.status === 'done');
  function row(it, chip = null) {
    const was = it.status === 'done', checked = checkedNow(it);
    const q = qtyLabel(it.qty, it.unit);
    const note = firstLine(it.note);
    const check = h('button.item-main', { type: 'button', role: 'checkbox', 'aria-checked': String(checked), dataset: { fid: 'it-' + it.id },
      onclick: () => tap(it.id) },
    h('span.check', { 'aria-hidden': 'true' }, icon('check')),
    h('span.item-text', null,
      h('span.item-name', null, it.name),
      chip || note ? h('span.item-sub', null, chip, note ? h('span.item-note', null, note) : null) : null),
    q ? h('span.item-qty', null, q) : null);
    const li = h('li.item-row' + (was && checked ? '.done' : '') + (!was && checked ? '.ticking' : ''), { dataset: { id: it.id } }, check,
      h('button.item-more', { type: 'button', 'aria-label': t('item.edit', { name: it.name }), title: t('item.edit', { name: it.name }), dataset: { fid: 'more-' + it.id },
        onclick: () => itemSheet(ctx, it.id) }, icon('chev')));
    rowEls.set(it.id, { li, check, sec: it.status });
    return li;
  }

  function draw(fn) {
    const tops = rowTops();
    rowEls = new Map();
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
   * 重画以后焦点放回同一个控件（带 data-fid 的：同一样东西的勾和 ›、同一个折叠按钮），读屏和键盘不用从头找。
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

  // 要买、以后再说 → 已买；已买 → 要买。先只改这一行的样子，停一下（TICK_MS）再一起改数据、挪位置；还没挪之前再点一下 = 不改了
  function tap(id) {
    const it = liveItem(ctx.state, id);
    if (!it) return;
    if (moved.has(id) && Date.now() < movedUntil) return;
    if (pending.has(id)) pending.delete(id);
    else pending.set(id, it.status === 'done' ? 'need' : 'done');
    paintRow(id);
    clearTimeout(tickTimer);
    tickTimer = null;
    if (!pending.size) return;
    if (reduced()) flush(); else tickTimer = setTimeout(flush, TICK_MS);
  }
  function paintRow(id) {
    const r = rowEls.get(id), it = liveItem(ctx.state, id);
    if (!r || !it) return;
    const was = it.status === 'done', checked = checkedNow(it);
    r.li.classList.toggle('done', was && checked);
    r.li.classList.toggle('ticking', !was && checked);
    r.check.setAttribute('aria-checked', String(checked));
  }
  function flush() {
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
        if (was && was.status !== st && setStatus(s, id, st, now) && st === 'need') last = id;
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
    row, draw, keepFocus, flashNow, flush,
    flash(id) { flashId = id; },
    drop() { clearTimeout(tickTimer); tickTimer = null; pending.clear(); },
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
