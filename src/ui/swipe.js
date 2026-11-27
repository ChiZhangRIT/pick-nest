// 一行左右滑出按钮（照 ../babble 的 src/ui/swipe.js，手势、参数、安全规则都一样；像「邮件」「提醒事项」）：
// 手指往右滑，左边露出「编辑」；往左滑，右边露出红色的「删除」（babble 往左也是删除，往右是它的「收藏」）。哪一行给哪几个按钮是 core/items.js 的 swipeActions 定的。
// 现在每边一个按钮（和 babble 一样）；这里还能一边放几个：这一边露出来的宽 = 几个按钮宽加起来，下面所有「一个按钮宽」的规则都换成「这一边的宽」。
// 滑只是把按钮露出来：要再点一下露出来的按钮才会做。拖得再远、甩得再快、松手时在哪儿，都只是开着或者关上，从来不直接做。
//   怎么保证的：按钮的事只在 act() 里做，act() 只有按钮自己的 click 调用（手势的代码里没有一处调它；松手的结果只有开 / 关）；
//   按钮那一边没露着（关着、正在关上、这一行正被手指拖着或者触控板在扫）的时候点了不算；
//   手指、笔、鼠标的 click 要「按下去就在这个按钮上、按着的时候没移开 10 px、没被打断、没有别的手指同时按着」才算（见 tapped）：
//   滑这一行、在别处按下以后落到按钮上的 click，在按钮上按下去拖开再松手的（有的浏览器照样给 click），一根手指在滑、另一根按在按钮上的，
//   都不算；滑完马上来的 click 一律吞掉（不会顺手把这一行勾掉）。键盘 Enter / 空格照常。
// 这一行最多移开这一边宽的 1.5 倍：宽以内跟手，再往外橡皮筋、越拉越跟不动（不会超过 1.5 倍），看起来不会像「松手就删」。同一时间只开一行。
// 上半部分是手势的状态机（createSwipeModel：只算数，时间由调用的地方给，Node 里能测），
// 下半部分接到页面上（createSwipes：一页一组；ui/checklist.js 的行用，清单页、商店页、搜索都是它）。
// 不妨碍上下滚动：手指移动超过 10 px 才定方向，|dx| > 1.5·|dy| 才算横着滑，定成竖着的这一下后面都不管；可滑的那层 CSS 是 touch-action: pan-y。
// 松手按距离（过这一边宽的一半就开）或者速度（甩的方向）开 / 关。从开着的一边拉过中间：甩不算，拉够另一边的宽才开另一边。
// 从屏幕左边 20 px 以内开始的不管（iOS 的系统手势）；页面被捏合放大时整个不管（单指横着拖是在看放大的页面）。
// 触控、笔走 pointer 事件（在 document 上听，一页一份）；鼠标不拖（会和选字、拖链接打架），
// Mac / iPad 触控板两指横扫走 wheel 事件：也是只开、关（松开手指以后的惯性也算在 wheel 里）；
// 惯性再大这一行也只移开一点多一个这一边宽，开着的往回扫只会关上、不会扫到另一边。
// 惯性还没停就按下去（手放回触控板，惯性就停了）：这一下扫完，先按位置停好；按在露出来的按钮上，停在按钮这一边这一下点才算；
// 按在这一行别的地方，和点开着的行一样只关上（不勾掉、不打开面板）。
// 关着时没有按钮（第一次滑动时才建；之后关着时 hidden）：读屏、Tab 都碰不到，点这一行打开的编辑面板里的「删除」「状态」照旧；
// 开着时能 Tab 到，名字是「删除「牛奶」」这样的，按 Enter / 空格和点一下一样。
// 系统设了「减少动态效果」：不做动画，直接到位；点了按钮马上做。
import { h, icon } from './dom.js';

/**
 * 手势参数（px、毫秒），除了 gap 都和 babble 一样。
 * action：一个按钮多宽（一边露出来的宽 = 这一边按钮宽加起来；开着时这一行移开这么多）
 * gap：按钮和行之间留的缝。babble 的卡片是一张张分开的，按钮也是单独的圆角块（8）；这里的行在一整块分组里，按钮和 iOS 的列表一样贴着行、铺满一行高（0）
 * 没有「滑到底直接做」「甩出去直接做」：松手只会开着或者关上。
 */
export const SWIPE = {
  slop: 10,          // 移动超过这么多才定方向（在按钮上按下去移动超过这么多：不算点）
  ratio: 1.5,        // 横着滑：|dx| > ratio·|dy|
  edge: 20,          // 从屏幕左边这么近开始的不管
  action: 84, gap: 0,
  rubber: 0.5,       // 超过这一边宽以后行先只跟手指的一半（橡皮筋），越往外越跟不动
  pull: 1.5,         // 行最多移开这一边宽的这么多倍（越拉越接近，不会超过）
  fling: 0.3,        // px/ms：松手时这么快 → 按甩的方向开 / 关（只开关，不做）
  sample: 100,       // 速度看最后这么多毫秒
  rest: 80,          // 停住超过这么久才松手：速度算 0
  wheelGap: 160,     // 触控板：隔这么久没有 wheel 事件 = 这一下滑完了
  wheelMax: 1.5,     // 触控板最多拉到这一边宽的这么多倍（橡皮筋以后行移开不到 1.2 倍）
  anim: 240, collapse: 200,   // 回弹 / 滑出去的动画、删掉的行收起高度的动画（和 styles.css 一致）
  hold: 4000,        // 手势、动画没完时数据变了：重画等到做完，最多等这么久
  block: 500,        // 开着的行被重画关上以后这么久以内，点行不算（是冲着刚才的按钮去的）
};
const SIDES = [1, -1];

/**
 * 一行的手势状态机。位置 p 是手指拖到的地方（正 = 往右，露出左边的按钮；负 = 往左，露出右边的按钮），
 * 行实际移动 offset = view(p)：这一边宽以内跟手，再往外橡皮筋，最多接近 pull 倍。
 * open：-1（右边的按钮露着）/ 0 / 1（左边的露着）。松手、被打断、触控板滑完都只会改 open，没有「做」这种结果。
 * @param {{ widths?: Record<string, number> }} [o]  widths：每一边露出来的宽（1 左、-1 右；没有或 0 = 这一边没有按钮），默认两边各一个按钮；其余参数见 SWIPE
 */
export function createSwipeModel({ widths = { 1: SWIPE.action, '-1': SWIPE.action }, ...o } = {}) {
  const P = { ...SWIPE, ...o };
  const wid = (s) => (s === 1 || s === -1 ? Math.max(0, Number(widths[s]) || 0) : 0);
  let open = 0, g = null, w = null;
  const ok = (s) => wid(s) > 0;
  const at = (s) => s * wid(s);                            // 开着这一边时行在哪（0 → 0）
  function view(p) {
    const s = Math.sign(p), d = Math.abs(p);
    if (!s) return 0;
    if (!ok(s)) return s * Math.min(d * 0.2, 16);          // 这边没有按钮：只能拉动一点点
    const A = wid(s), room = A * (P.pull - 1);
    if (d <= A) return p;
    if (!(room > 0)) return s * A;
    return s * (A + room * (1 - Math.exp(-(d - A) * P.rubber / room)));   // 刚过这一边宽时跟一半，越往外越慢，不会超过 A + room
  }
  function speed(gg, t) {
    const last = gg.pts[gg.pts.length - 1];
    if (t - last.t > P.rest) return 0;
    const first = gg.pts.find(q => last.t - q.t <= P.sample) || gg.pts[0];
    return last.t > first.t ? (last.x - first.x) / (last.t - first.t) : 0;
  }
  const settleBy = (p) => { const s = Math.sign(p); return ok(s) && Math.abs(p) >= wid(s) / 2 ? s : 0; };
  /** 从开着的一边拉过了中间（往另一边） */
  const crossed = (gg) => gg.base !== 0 && Math.sign(gg.p) === -Math.sign(gg.base);
  /** 按位置停：拉过中间的要够另一边的整个宽才开另一边 */
  const rest = (gg) => { const s = Math.sign(gg.p); return crossed(gg) ? (ok(s) && Math.abs(gg.p) >= wid(s) ? s : 0) : settleBy(gg.p); };
  return {
    get open() { return open; },
    /** 这一边露出来的宽（没有按钮 → 0） */
    width: wid,
    /** 正在横着拖（手指或触控板） */
    get busy() { return !!((g && g.axis === 'h') || (w && w.axis === 'h')); },
    /** 直接开 / 关（点按钮、点别处、截图） */
    set(s) { open = ok(s) ? s : 0; g = w = null; },
    /** 按下：从屏幕左边缘开始的不管 → false */
    down(x, y, t) {
      w = null;
      if (x < P.edge) { g = null; return false; }
      g = { x0: x, y0: y, base: at(open), axis: null, p: at(open), pts: [{ x, t }] };
      return true;
    },
    /** 移动 → null（这一下不归我管）| { axis: null }（还没定方向）| { axis: 'v' }（竖着的：交给页面滚动）| { axis: 'h', offset, side } */
    move(x, y, t) {
      if (!g || g.axis === 'v') return null;
      const dx = x - g.x0, dy = y - g.y0;
      if (!g.axis) {
        if (Math.abs(dx) < P.slop && Math.abs(dy) < P.slop) return { axis: null };
        g.axis = Math.abs(dx) > P.ratio * Math.abs(dy) ? 'h' : 'v';
        if (g.axis === 'v') return { axis: 'v' };
      }
      g.p = g.base + dx;
      g.pts.push({ x, t });
      while (g.pts.length > 2 && t - g.pts[1].t > P.sample) g.pts.shift();
      return { axis: 'h', offset: view(g.p), side: Math.sign(g.p) };
    },
    /**
     * 松手 → { kind: 'tap', open }（没动：点了一下）| { kind: 'settle', to }（开着 / 关上）| { kind: 'none' }。
     * 拖得再远、甩得再快也只是 settle：没有「直接做」。
     */
    up(t) {
      const gg = g;
      g = null;
      if (!gg) return { kind: 'none' };
      if (!gg.axis) return { kind: 'tap', open };
      if (gg.axis === 'v') return { kind: 'none' };
      const s = Math.sign(gg.p), v = speed(gg, t);
      let to;
      if (crossed(gg)) to = Math.abs(v) >= P.fling && Math.sign(v) !== s ? 0 : rest(gg);
      else to = Math.abs(v) >= P.fling ? (Math.sign(v) === s ? s : 0) : settleBy(gg.p);
      if (!ok(to)) to = 0;
      open = to;
      return { kind: 'settle', to };
    },
    /** 被系统打断（pointercancel）、第二根手指：按位置开 / 关 */
    cancel() {
      const gg = g;
      g = null;
      if (!gg || gg.axis !== 'h') return { kind: 'none' };
      open = rest(gg);
      return { kind: 'settle', to: open };
    },
    /**
     * 触控板 / 横向滚轮：dx、dy 是 wheel 事件的 delta（px；两指往左 → deltaX 为正 → 露出右边的按钮）。
     * 隔 wheelGap 没有事件算新的一下；先攒够 slop 再定方向，竖着的整下都不管。
     * 最多拉到这一边宽的 wheelMax 倍（没有按钮的一边按一个按钮宽算，反正只能拉动一点点）；开着的这一下只能往关的方向走到中间（惯性不会把它扫到另一边）。
     * → { consumed（要 preventDefault）, axis, offset?, side? }
     */
    wheel(dx, dy, t) {
      if (g) return { consumed: false, axis: null };
      if (!w || t - w.t > P.wheelGap) w = { sx: 0, sy: 0, axis: null, base: at(open), p: at(open), t };
      w.t = t;
      if (w.axis === 'v') return { consumed: false, axis: 'v' };
      let step = dx;
      if (!w.axis) {
        w.sx += dx; w.sy += dy;
        if (Math.abs(w.sx) < P.slop && Math.abs(w.sy) < P.slop) return { consumed: Math.abs(dx) > P.ratio * Math.abs(dy), axis: null };
        w.axis = Math.abs(w.sx) > P.ratio * Math.abs(w.sy) ? 'h' : 'v';
        if (w.axis === 'v') return { consumed: false, axis: 'v' };
        step = w.sx;                                       // 定方向以前攒的一起算上
      }
      const max = (s) => (wid(s) || P.action) * P.wheelMax;
      const lo = w.base > 0 ? 0 : -max(-1), hi = w.base < 0 ? 0 : max(1);
      w.p = Math.min(hi, Math.max(lo, w.p - step));
      return { consumed: true, axis: 'h', offset: view(w.p), side: Math.sign(w.p) };
    },
    /** 触控板这一下滑完了：关着的按位置开 / 关；开着的往回扫了这一边宽的三分之一就关上 */
    wheelEnd() {
      const ww = w;
      w = null;
      if (!ww || ww.axis !== 'h') return { kind: 'none' };
      const s0 = Math.sign(ww.base), back = (ww.base - ww.p) * s0;
      open = s0 ? (back >= wid(s0) / 3 ? 0 : s0) : settleBy(ww.p);
      return { kind: 'settle', to: open };
    },
  };
}

/**
 * 一页的可滑的行（同一时间只开一行）。点别处、滚动、在别的行上开始滑、按 Esc 都会关上开着的那行；
 * 点开着的行（圆圈、别处都一样）只是关上（不勾掉、不打开编辑面板）；点到别的行也只是关上开着的那行（不勾掉点到的这一行）；滑过以后松手不算点。
 * 按钮的事只在点了露出来的按钮时做（act()，只有按钮的 click 调）；手势（拖、甩、被打断、触控板）只开关。
 * 页面重画行前调 reset()（ui/checklist.js 的 draw 调）；数据变了（onChange）用 whenIdle(重画)：有手指按着行（或者按在按钮上）、触控板在扫、行在动、
 * 删除 / 移动在等动画时，等做完再重画（不然手底下的行换成新的，这一下就丢了）。重画以后：
 *   这一页自己点按钮引起的 → 开着的那行照样开着（接着一行行删）；别的（同步进来、别处改了、勾掉了别的）→ 关上，之后 block 毫秒以内点行不算。
 *   焦点在露出来的按钮上 → 放回新画的那一行的同一个按钮（圆圈、这一行的编辑按钮带 data-fid，由 checklist 的 keepFocus 放回去，这里不抢）。
 * 离开页面调 destroy()（等动画的删除、移动马上做完，不会丢）；切到后台调 settle()（同上，页面照常）。
 * @param {object} [env]  测试用：{ doc, win, now, setTimeout, clearTimeout, reduceMotion: () => bool, width: (el) => px }
 * @returns {{ wrap(card, opts): HTMLElement, whenIdle(fn): void, close(): void, reset(): void, settle(): void, destroy(): void, readonly current: object|null, readonly busy: boolean }}
 */
export function createSwipes(env = {}) {
  const E = {
    doc: globalThis.document, win: globalThis.window,
    now: () => (globalThis.performance ? performance.now() : Date.now()),
    setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (id) => clearTimeout(id),
    reduceMotion: () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
    width: (el) => el.offsetWidth || 0,
    ...env,
  };
  const P = SWIPE;
  const recs = new WeakMap(), jobs = new Set();     // recs：.swipe 那一层 → 这一行
  let rows = [];                                     // 这一次画的行（按顺序：键盘删掉一行，焦点挪到下一行）
  let cur = null;                                    // 开着（或者正在拖）的那行
  let live = null;                                   // 有手指 / 笔按着的那行
  let swallowUntil = 0, blockUntil = 0;
  // 正按着的（手指、笔、鼠标，按 pointerId 分开记；抬起、被打断就拿掉）：
  // { type, b 按在哪个按钮上（不是按钮 null）, c 那一行, s 按钮在哪一边, k 按钮是哪一个（key）, x, y, t 按下的时间, moved }
  // moved：按着的时候移开了 slop 以上、被打断、或者和别的手指同时按着（捏合、手掌、一根在滑另一根按）——这一下不算点按钮
  const presses = new Map();
  let lastUp = null;                                 // 最近抬起（或者被打断）的那一下：接下来的 click 是它的
  let lastPtr = -Infinity;                           // 最近一次按下、抬起、被打断（不管哪根手指）的时间
  let queued = null, queueT = 0;                     // 等着做的重画（whenIdle）
  let own = false;                                   // 这一页自己点按钮刚改了数据（接下来的重画不关开着的那行）
  let carry = null;                                  // reset() 记下的：{ open: { id, side, y0, keep }, focus: { id, side, key } }，新画的同一条接着用
  const swallow = () => { swallowUntil = E.now() + 700; };
  const inRow = (el) => (el && typeof el.closest === 'function' ? el.closest('.swipe') : null);
  const rowOf = (el) => { const w = inRow(el); return (w && recs.get(w)) || null; };
  const scrollPos = (el) => { let y = 0; for (let n = el; n; n = n.parentNode) y += Number(n.scrollTop) || 0; return y; };
  const vv = () => (E.win && E.win.visualViewport) || null;
  const zoomed = () => { const v = vv(); return !!(v && v.scale > 1.01); };
  const isBusy = (c) => c.dragging || c.wheeling;
  /** 按着超过 hold 还没抬起：多半是漏了抬起，不再算按着 */
  const fresh = (p) => E.now() - p.t <= P.hold;
  const pressing = (onBtn) => { for (const p of presses.values()) if (fresh(p) && (!onBtn || p.b)) return true; return false; };
  // 有手指按在按钮上也算忙：等抬起（和它的 click）以后再重画，按钮不在手指底下换成新的
  const busy = () => !!(live || jobs.size || pressing(true) || (cur && (isBusy(cur) || cur.moving)));
  /** 动画做完再做的事（删除、移动）：离开页面、切到后台时马上做 */
  function later(ms, fn) {
    const job = { run: () => { if (!jobs.delete(job)) return; E.clearTimeout(job.timer); fn(); queueMicrotask(idle); } };
    jobs.add(job);
    job.timer = E.setTimeout(job.run, ms);
  }
  /** 真的去改数据：记下是自己改的 */
  const commit = (run) => { own = true; run(); };
  /** 闲下来了：等着的重画现在做 */
  function idle() {
    if (!queued || busy()) return;
    const fn = queued;
    queued = null; E.clearTimeout(queueT); queueT = 0;
    fn();
  }
  function whenIdle(fn) {
    if (!busy()) { queued = null; E.clearTimeout(queueT); queueT = 0; fn(); return; }
    queued = fn;
    if (!queueT) queueT = E.setTimeout(() => { queueT = 0; const f = queued; queued = null; if (f) f(); }, P.hold);   // 保险：手指一直按着不放（或者漏了抬起）
  }
  function claim(c) {
    if (c.dead) return;                                // 已经重画掉的行不再算开着
    if (cur && cur !== c) close(cur, true);
    cur = c;
    c.y0 = scrollPos(c.el);
  }

  // ---------- 一行：建按钮、画、开、关、做 ----------
  const acts = (c, s) => (s > 0 ? c.left : c.right);
  /** 这一边露出来的宽：按钮宽加起来 */
  const wid = (c, s) => acts(c, s).reduce((n, o) => n + (o.width || P.action), 0);
  const model = (c) => c.model || (c.model = createSwipeModel({ widths: { 1: wid(c, 1), '-1': wid(c, -1) } }));
  /** 按钮第一次要露出来时才建（关着的行只有原来那一层）。一边的几个按钮放在一个 .sw-side 里，按各自的宽（flex-grow）分这一边露出来的地方 */
  function build(c) {
    c.side = { 1: null, '-1': null };
    for (const s of SIDES) {
      const list = acts(c, s);
      if (!list.length) continue;
      const box = h('div.sw-side.' + (s > 0 ? 'sw-l' : 'sw-r'), { hidden: true });
      const btns = list.map((o) => {
        const w = o.width || P.action;
        const inner = h('span.sw-in', null, o.icon ? icon(o.icon) : null, h('span.sw-t', null, o.label));
        const b = h('button.sw-btn' + (o.cls ? '.' + o.cls : ''), {
          type: 'button', hidden: true, 'aria-label': o.aria || null, style: { flexGrow: String(w) },
          onclick: (ev) => { ev.preventDefault(); ev.stopPropagation(); if (tapped(c, s, o.key, b, ev)) act(c, s, o); },   // 唯一会做事的地方
        }, inner);
        box.append(b);
        return { b, inner, o, w };
      });
      c.side[s] = { box, btns, width: wid(c, s) };
      c.el.append(box);
    }
  }
  /**
   * 这个 click 是不是真的点了这个按钮：键盘（detail 0）算；读屏模拟的点（没有手指按着、近 1 秒谁都没有按下、抬起过）算；
   * 手指、笔、鼠标的看最近抬起的那一下：要「按下去就在这个按钮上、按着的时候没移开 slop、没被打断、没有别的手指同时按着」。
   * 按着的时候列表还是重画了（新画的同一条、同一边照样开着）：按在旧的同一个按钮上也算。别处按下（滑这一行、点别的）以后来的 click 落到按钮上：不算。
   */
  function tapped(c, s, key, b, ev) {
    if (ev.detail === 0) return true;
    if (!pressing(false) && E.now() - lastPtr > 1000) return true;
    const p = lastUp;
    if (!p || !p.b || p.moved) return false;
    return p.b === b || (!!p.c && p.c.dead && p.c.id != null && p.c.id === c.id && p.s === s && p.k === key);
  }
  /** t 在这一行的哪个按钮上 → { s, k } | null */
  function btnAt(c, t) {
    if (!c.side || !t) return null;
    for (const s of SIDES) {
      const sd = c.side[s];
      const bt = sd && sd.btns.find(x => x.b.contains(t));
      if (bt) return { s, k: bt.o.key };
    }
    return null;
  }
  const sideAt = (c, t) => { const a = btnAt(c, t); return a ? a.s : 0; };
  function show(sd, on) { sd.box.hidden = !on; for (const bt of sd.btns) bt.b.hidden = !on; }
  function paint(c, x, anim = false) {
    const moving = anim && !E.reduceMotion();
    E.clearTimeout(c.animT);
    if (x && !c.side) build(c);
    c.el.classList.toggle('sw-anim', moving);
    c.card.style.transform = x ? `translateX(${Math.round(x)}px)` : '';
    if (c.side) {
      for (const s of SIDES) {
        const sd = c.side[s];
        if (!sd) continue;
        const on = Math.sign(x) === s, d = on ? Math.max(0, Math.abs(x) - P.gap) : 0;
        if (on) show(sd, true);
        sd.box.style.width = Math.round(d) + 'px';
        // 每个按钮按自己的宽分到这么多，字和图标露出来一大半才看得清
        for (const bt of sd.btns) {
          const dd = (d * bt.w) / sd.width;
          bt.inner.style.opacity = String(Math.round(Math.min(1, Math.max(0, (dd - 24) / (bt.w - 24))) * 100) / 100);
        }
      }
    }
    const done = () => {
      c.moving = false;
      c.el.classList.remove('sw-anim');
      if (c.side) for (const s of SIDES) if (c.side[s] && Math.sign(x) !== s) show(c.side[s], false);
    };
    c.moving = moving;
    if (moving) c.animT = E.setTimeout(() => { done(); idle(); }, P.anim + 30); else done();
  }
  function settle(c, to) {
    model(c).set(to);
    paint(c, to * wid(c, to), true);
    if (to) claim(c);
    else if (cur === c) cur = null;
  }
  /** 关上；焦点在按钮上（键盘用户）就挪回这一行的勾，不丢 */
  function close(c, anim = true) {
    const had = sideAt(c, E.doc.activeElement);
    if (c.pointer != null) stop(c);
    if (c.model) c.model.set(0);
    paint(c, 0, anim);
    if (cur === c) cur = null;
    if (had && c.focus) c.focus.focus({ preventScroll: true });
  }
  function open(c, s) {
    if (!(s === 1 || s === -1) || !acts(c, s).length || c.dead || c.gone) return;
    claim(c);
    model(c).set(s);
    paint(c, s * wid(c, s));
  }
  /**
   * 键盘删掉一行：焦点挪到下一行（没有就上一行）的勾，不掉回页面开头。
   * 这是这一页最后一行：先放在这一行自己的勾上（不 blur：落到 <body> 就回到页首了）——
   * 勾带 data-fid，删掉重画以后 checklist 的 keepFocus 找不到它，就给页面标题，和编辑面板里的「删除」一样
   */
  function focusNext(c) {
    const i = rows.indexOf(c), ok = (x) => x && !x.gone && !x.dead && x.focus;
    let n = null;
    for (let j = i + 1; j < rows.length && !n; j++) if (ok(rows[j])) n = rows[j];
    for (let j = i - 1; j >= 0 && !n; j--) if (ok(rows[j])) n = rows[j];
    const to = n ? n.focus : c.focus;
    if (to) to.focus({ preventScroll: true });
  }
  /**
   * 点了露出来的按钮（手指、鼠标点，键盘 Enter / 空格）：只有按钮的 click 调这里，手势从来不调。
   * 这一边要正露着（model.open === s：松手停好了、或者正弹开）；关着、正在关上、这一行正被拖着 / 触控板在扫的时候点了不算。
   * 三种做法（按钮给的）：
   *   instant（编辑）：弹回去，同时就打开面板（不改数据，不用等动画）；
   *   out（删除）：这一行滑出去、收起来以后再删（数据一变列表就重画了）；
   *   别的（现在没有；以前的「以后再说」）：弹回去以后再改。
   */
  function act(c, s, o) {
    if (!o || c.dead || c.gone || !c.model || c.model.open !== s || isBusy(c)) return;
    const refocus = sideAt(c, E.doc.activeElement) === s;
    if (cur === c) cur = null;
    model(c).set(0);
    if (o.instant) {
      paint(c, 0, true);
      if (refocus && c.focus) c.focus.focus({ preventScroll: true });   // 面板关上以后焦点回到这一行（按钮关着时藏起来了）
      o.run();
      return;
    }
    if (!o.out) {
      paint(c, 0, true);
      if (refocus && c.focus) c.focus.focus({ preventScroll: true });
      if (E.reduceMotion()) commit(o.run); else later(P.anim, () => commit(o.run));
      return;
    }
    c.gone = true;
    if (refocus) focusNext(c);
    c.el.classList.add('sw-out');
    if (E.reduceMotion()) { commit(o.run); return; }
    // 滑出去的时候点的那个按钮占满这一边（同一边别的按钮收起来），像「邮件」
    const sd = c.side && c.side[s];
    if (sd) for (const bt of sd.btns) if (bt.o !== o) bt.b.style.flexGrow = '0';
    paint(c, s * ((E.width(c.el) || 400) + 24), true);
    later(P.anim, () => {
      const el = c.el;
      el.style.height = (el.offsetHeight || 0) + 'px';
      void el.offsetHeight;                            // 先定住现在的高度，再收到 0（才有过渡）
      el.classList.add('sw-gone');
      el.style.height = '0px';
      later(P.collapse, () => commit(o.run));
    });
  }
  function stop(c) {
    c.pointer = null;
    c.dragging = false;
    if (live === c) live = null;
    c.el.classList.remove('sw-drag');
  }
  function finish(c, r) {
    const dragged = c.dragging;
    stop(c);
    if (c.dead) { if (c.model) c.model.set(0); idle(); return; }   // 拖着的时候列表还是重画了（等太久的保险）：旧的那一行什么都不做
    if (r.kind === 'tap') { if (r.open) { swallow(); close(c, true); } }
    else {
      if (dragged) swallow();                          // 滑过以后松手不算点（圆圈、编辑、按钮都不触发）
      if (r.kind === 'settle') settle(c, r.to);        // 松手只开 / 关：没有别的结果
    }
    idle();
  }
  function kill(c) {
    c.dead = true;
    E.clearTimeout(c.animT); E.clearTimeout(c.wheelT);
    if (live === c) live = null;
  }

  // ---------- 手指、笔（document 上听：一页一份，不是每一行一份） ----------
  function onDown(e) {
    swallowUntil = 0;                                  // 新的一下：上一下的 click 早就来过了
    const now = E.now(), t = e.target, onBtn = t && typeof t.closest === 'function' ? t.closest('.sw-btn') : null;
    const w = inRow(t), c = w ? recs.get(w) || null : null;
    const at = onBtn && c ? btnAt(c, onBtn) : null;
    const p = { type: e.pointerType, b: onBtn, c, s: at ? at.s : 0, k: at ? at.k : null, x: e.clientX, y: e.clientY, t: now, moved: false };
    for (const [id, q] of presses) {
      // 漏了抬起的不再算按着：同一个 id 又按下了、按了太久、浏览器说这是这一种（手指 / 笔 / 鼠标）里唯一按着的
      if (id === e.pointerId || !fresh(q) || (e.isPrimary === true && q.type === e.pointerType)) presses.delete(id);
      else q.moved = p.moved = true;                   // 同时按着两根以上（捏合、手掌、一根在滑另一根按）：哪一根都不算点
    }
    presses.set(e.pointerId, p);
    lastPtr = now;
    // 触控板惯性还没停（隔 wheelGap 以内）就按下去：手放回去惯性就停了，这一下先按位置停好。
    // 按在按钮上：停在这边，接下来的 click 才算。按在行上：这时 model 还没记成开着（wheelEnd 才改），
    // 不先停好的话鼠标的 click 会勾掉这一行、手指的按下会把扫到一半的这一下扔掉（行停在半中间、按钮点了不算）；
    // 看起来是开着的，就和点开着的行一样只关上：惯性永远不变成勾掉、打开面板
    if (c && c.wheeling && !c.dead && !c.gone) {
      wheelDone(c);
      if (!onBtn) { swallow(); close(c, true); return; }
    }
    if (w && now < blockUntil) swallow();              // 开着的那行刚被重画关上：这一下多半是冲着它的按钮去的
    if (live) {                                        // 已经有一根手指按在行上：第二根（捏合、手掌）这一下不算，按着的那行按位置停住
      if (e.pointerId !== live.pointer) { p.moved = true; finish(live, live.model.cancel()); if (w) swallow(); }
      return;
    }
    if (cur && cur !== c) { close(cur, true); if (w) swallow(); }   // 点别处：关上开着的那行；点到别的行只是关上，不勾掉这一行
    if (!c || c.dead || c.gone) return;
    if (onBtn) return;                                 // 按在按钮上：等 click（手指没移开才算，见 tapped）
    if (e.button != null && e.button > 0) return;
    const m = model(c), wasOpen = m.open;
    if (e.pointerType === 'mouse' || zoomed() || !m.down(e.clientX, e.clientY, E.now())) {
      if (wasOpen) { swallow(); close(c, true); }      // 鼠标不拖；从屏幕边缘开始的、放大着的不管——开着的话照样是「点一下关上」
      return;
    }
    c.pointer = e.pointerId;
    live = c;
  }
  /** 按着的时候移开了 slop 以上：这一下不算点按钮（抬起以后笔、鼠标悬着移动不算：那时候已经不在 presses 里了） */
  function pressMoved(e) {
    const p = presses.get(e.pointerId);
    if (p && (Math.abs(e.clientX - p.x) >= P.slop || Math.abs(e.clientY - p.y) >= P.slop)) p.moved = true;
    return p;
  }
  /** 抬起、被打断：记成最近的一下（接下来的 click 看它）；按在按钮上的，等着的重画放到这一下的 click 以后 */
  function lift(e, cancelled) {
    lastPtr = E.now();
    const p = pressMoved(e);
    if (!p) return;
    presses.delete(e.pointerId);
    if (cancelled) p.moved = true;
    lastUp = p;
    if (p.b) {
      if (p.moved) swallow();
      if (queued) E.setTimeout(idle, 0);
    }
  }
  function onMove(e) {
    pressMoved(e);
    const c = live;
    if (!c || e.pointerId !== c.pointer) return;
    const r = c.model.move(e.clientX, e.clientY, E.now());
    if (!r || !r.axis) return;
    if (r.axis === 'v') {                              // 竖着滑：这一下交给页面滚动；开着的关上
      const was = c.model.open;
      c.model.cancel();
      stop(c);
      if (was) close(c, true);
      idle();
      return;
    }
    if (!c.dragging) {
      c.dragging = true;
      claim(c);
      c.el.classList.add('sw-drag');
      try { if (c.el.setPointerCapture) c.el.setPointerCapture(e.pointerId); } catch (err) { /* 已经抬起 */ }
    }
    paint(c, r.offset);
  }
  function onUp(e) {
    lift(e, false);
    if (live && e.pointerId === live.pointer) finish(live, live.model.up(E.now()));
  }
  function onCancel(e) {
    lift(e, true);
    if (live && e.pointerId === live.pointer) finish(live, live.model.cancel());
  }
  // iOS：定成横着滑以后不让页面跟着上下动（touch-action: pan-y 管开头，这里管中途）。每一行都挂（只挡行上开始的），同一个函数
  function onTouchMove(e) { if (live && live.dragging && e.cancelable !== false) e.preventDefault(); }

  // ---------- 触控板（每一行挂同一个函数） ----------
  function onWheel(e) {
    const c = rowOf(e.target);
    if (!c || c.dead || c.gone || live || zoomed()) return;
    const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? (E.width(c.el) || 400) : 1;
    const r = model(c).wheel((e.deltaX || 0) * k, (e.deltaY || 0) * k, E.now());
    if (r.consumed) e.preventDefault();
    if (r.axis !== 'h') return;
    if (!c.wheeling) { c.wheeling = true; claim(c); }
    paint(c, r.offset);
    E.clearTimeout(c.wheelT);
    c.wheelT = E.setTimeout(() => { wheelDone(c); idle(); }, P.wheelGap);
  }
  /** 触控板这一下滑完了（隔 wheelGap 没有事件，或者按在了这一行的按钮上）：按位置开 / 关 */
  function wheelDone(c) {
    E.clearTimeout(c.wheelT);
    c.wheeling = false;
    if (!c.dead && !c.gone && c.model) { const s = c.model.wheelEnd(); if (s.kind === 'settle') settle(c, s.to); }
  }

  // ---------- 页面上的：点别处、点开着的那行、滚动、Esc、捏合放大 ----------
  // 刚才那一下（滑过、点开着的行、在按钮上拖开）带来的 click 都吞掉，不只第一个：
  // 一直到下一次按下（onDown 清掉）或者 700 ms 以后。真的点按钮总是先有一次按下，所以不会被吞
  function onClick(e) {
    if (!swallowUntil) return;
    if (E.now() > swallowUntil) { swallowUntil = 0; return; }
    if (e.detail === 0) return;                        // 键盘（Enter、空格）、读屏点的：不是刚才那一下手指
    if (inRow(e.target)) { e.preventDefault(); e.stopPropagation(); }
  }
  function onKey(e) {
    if (e.key !== 'Escape' || !cur || isBusy(cur)) return;
    if (E.doc.querySelector && E.doc.querySelector('dialog[open]')) return;
    close(cur, true);
  }
  function onScroll() {
    if (cur && !isBusy(cur) && Math.abs(scrollPos(cur.el) - cur.y0) > 8) close(cur, true);
  }
  // 捏合放大着：可滑的那层改回 touch-action: auto（单指横着拖要能移动放大的页面）
  function onZoom() { const r = E.doc.documentElement; if (r && r.classList) r.classList.toggle('sw-zoomed', zoomed()); }
  E.doc.addEventListener('pointerdown', onDown, true);
  E.doc.addEventListener('pointermove', onMove, true);
  E.doc.addEventListener('pointerup', onUp, true);
  E.doc.addEventListener('pointercancel', onCancel, true);
  E.doc.addEventListener('click', onClick, true);
  E.doc.addEventListener('keydown', onKey);
  E.win.addEventListener('scroll', onScroll, { capture: true, passive: true });
  const vp = vv();
  if (vp && typeof vp.addEventListener === 'function') { vp.addEventListener('resize', onZoom); onZoom(); }

  /**
   * 把一行的内容（card：会跟着手指动的那一层）放进可滑的一层，返回这一层（.swipe；按钮第一次露出来时才加进去）。
   * el：用页面已经建好的元素当这一层（行是 <li>，要留在 <ul> 里）；不给就新建一个 div
   * id：这一样的 id（重画以后认出同一条：开着的接着开着、焦点放回来）
   * left / right：这一边的按钮，从左往右（右边最外面的是最后一个）：
   *   [{ key, icon, label 按钮上的字, aria 读屏念的完整名字, cls, width?, instant / out（见 act）, run() }]，没有按钮给 [] 或 null
   * focus：关上时焦点在按钮上就挪到这里（这一行的勾）
   */
  function wrap(card, { el = null, id = null, left = null, right = null, focus = null } = {}) {
    const box = el || h('div');
    box.classList.add('swipe');
    box.append(card);
    const c = { el: box, card, id, left: left || [], right: right || [], focus, side: null, model: null, y0: 0, pointer: null, dragging: false, wheeling: false, moving: false,
      dead: false, gone: false, animT: 0, wheelT: 0 };
    recs.set(box, c);
    rows.push(c);
    box.addEventListener('touchmove', onTouchMove, { passive: false });
    box.addEventListener('wheel', onWheel, { passive: false });
    /** 给测试、截图用：el.swipe.open(-1) 直接打开右边（删除），open(1) 左边（编辑）——只是露出按钮，不做 */
    box.swipe = { open: (s) => open(c, s), close: () => close(c, false), get side() { return c.model ? c.model.open : 0; },
      get offset() { const s = c.model ? c.model.open : 0; return s * wid(c, s); } };
    const cy = carry;
    if (cy && id != null) {
      if (cy.open && cy.open.id === id && acts(c, cy.open.side).length) {
        open(c, cy.open.side);                         // 重画前开着：先照样开着（没有动画）
        c.y0 = cy.open.y0;
        if (!cy.open.keep) queueMicrotask(() => { if (!c.dead && cur === c) { void c.el.offsetWidth; close(c, true); } });   // 别处改了数据：画好以后再关上（有动画）
      }
      if (cy.focus && cy.focus.id === id) {
        const { side: fs, key: fk } = cy.focus;
        queueMicrotask(() => {                         // 等页面把新的一行放进去才能拿到焦点
          if (c.dead) return;
          const sd = fs && c.model && c.model.open === fs && c.side ? c.side[fs] : null;
          const bt = sd ? sd.btns.find(x => x.o.key === fk) || sd.btns[0] : null;
          const b = bt ? bt.b : c.focus;
          if (b && b !== E.doc.activeElement) b.focus({ preventScroll: true });
        });
      }
    }
    return box;
  }

  /** 页面要重画行了：旧的行都不再管（等动画的删除、移动照样做；刚滑完、click 还没来时重画了，那个 click 照样吞掉） */
  function reset() {
    const ae = E.doc.activeElement, fc = rowOf(ae), at = fc ? btnAt(fc, ae) : null;
    const was = cur && !cur.dead && !cur.gone && !isBusy(cur) && cur.model && cur.model.open ? cur : null;
    carry = {
      open: was && was.id != null ? { id: was.id, side: was.model.open, y0: was.y0, keep: own } : null,
      focus: fc && fc.id != null && at ? { id: fc.id, side: at.s, key: at.k } : null,
    };
    if (was && !own) blockUntil = E.now() + P.block;
    own = false;
    for (const c of rows) kill(c);
    rows = []; cur = null; live = null;
    queueMicrotask(() => { carry = null; });           // 只给这一次重画用
  }
  /** 等动画的删除、移动马上做完（离开页面、切到后台） */
  function settleJobs() { while (jobs.size) [...jobs][0].run(); }
  return {
    wrap, reset, whenIdle,
    settle: settleJobs,
    get current() { return cur ? cur.el : null; },
    get busy() { return busy(); },
    close() { if (cur) close(cur, true); },
    destroy() {
      settleJobs();
      queued = null; E.clearTimeout(queueT); queueT = 0;
      presses.clear(); lastUp = null;
      reset();
      carry = null;
      E.doc.removeEventListener('pointerdown', onDown, true);
      E.doc.removeEventListener('pointermove', onMove, true);
      E.doc.removeEventListener('pointerup', onUp, true);
      E.doc.removeEventListener('pointercancel', onCancel, true);
      E.doc.removeEventListener('click', onClick, true);
      E.doc.removeEventListener('keydown', onKey);
      E.win.removeEventListener('scroll', onScroll, { capture: true, passive: true });
      if (vp && typeof vp.removeEventListener === 'function') vp.removeEventListener('resize', onZoom);
    },
  };
}
