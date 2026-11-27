// 界面小工具：建元素（文字一律用 textContent，不拼 HTML：清单名、商品名、粘贴的链接都是用户内容）、图标、提示条、面板、确认框、
// 推入的页面的顶栏、↑↓ 按完让按钮留在手指下面、在点按里马上换页的链接、复制、下载。
import { t } from '../i18n.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * h('div.card#main', { onclick, title }, '文字', 子元素, [数组也行], null 跳过)
 * 标签名后可跟 .class 和 #id；attrs 里 on* 是事件，class / style（对象）/ dataset 特殊处理，
 * value / checked / selected / disabled / hidden 设成属性值，其余写成 HTML 属性（true → 空字符串，false/null 跳过）。
 * svg：标签名是 svg 或 attrs.svg 为 true 时用 SVG 命名空间（svg 的子元素也要带 svg: true）。
 */
export function h(tag, attrs, ...kids) {
  if (attrs == null || typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs)) { kids.unshift(attrs); attrs = {}; }
  const m = /^([a-zA-Z][\w-]*)?(.*)$/.exec(tag);
  const name = m[1] || 'div';
  const el = name === 'svg' || attrs.svg ? document.createElementNS(SVG_NS, name) : document.createElement(name);
  const cls = [];
  for (const [, kind, val] of m[2].matchAll(/([.#])([^.#]+)/g)) { if (kind === '.') cls.push(val); else el.id = val; }
  if (cls.length) el.setAttribute('class', cls.join(' '));
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false || k === 'svg') continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.setAttribute('class', ((el.getAttribute('class') || '') + ' ' + v).trim());
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'value' || k === 'checked' || k === 'selected' || k === 'disabled' || k === 'hidden') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, kids);
  return el;
}
function append(el, kids) {
  for (const k of kids) {
    if (k == null || k === false) continue;
    if (Array.isArray(k)) append(el, k);
    else el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---------- 图标（24×24 线条图标，跟着文字颜色；和 babble 同一套画法） ----------
const P = d => ['path', { d }];
const C = (cx, cy, r) => ['circle', { cx, cy, r }];
const ICONS = {
  // 清单：三行，前两行打了勾
  list: { kids: [P('M4 7l1.8 1.8L9 5.6'), P('M12.5 7.2H20'), P('M4 12.6l1.8 1.8L9 11.2'), P('M12.5 12.8H20'), C(6.4, 18.4, 1.5), P('M12.5 18.4H20')] },
  // 商店：带波浪边的雨棚、门
  store: { kids: [P('M5 4.5h14l1.8 4.5a2.2 2.2 0 01-4.4 0 2.2 2.2 0 01-4.4 0 2.2 2.2 0 01-4.4 0 2.2 2.2 0 01-4.4 0z'), P('M5 11.6v7.9h14v-7.9'), P('M10 19.5V15h4v4.5')] },
  gear: { kids: [C(12, 12, 3), P('M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z')] },
  x: { kids: [P('M6.5 6.5l11 11M17.5 6.5l-11 11')] },
  back: { kids: [P('M15 4.5L7.5 12l7.5 7.5')] },
  chev: { kids: [P('M9 5.5l6.5 6.5L9 18.5')] },
  chevDown: { kids: [P('M6 9.5l6 6 6-6')] },
  up: { kids: [P('M12 19V5.5M6 11.5l6-6 6 6')] },
  down: { kids: [P('M12 5v13.5M6 12.5l6 6 6-6')] },
  more: { kids: [C(5.5, 12, 1.2), C(12, 12, 1.2), C(18.5, 12, 1.2)] },
  plus: { kids: [P('M12 5v14M5 12h14')] },
  minus: { kids: [P('M5 12h14')] },
  check: { kids: [P('M5 12.5l4.5 4.5L19 7.5')] },
  // 在新标签页打开（商品链接）
  open: { kids: [P('M13.5 4.5h6v6'), P('M19.5 4.5l-8 8'), P('M17.5 13.5v4a2 2 0 01-2 2h-9a2 2 0 01-2-2v-9a2 2 0 012-2h4')] },
  // 搜索：放大镜
  search: { kids: [C(10.5, 10.5, 6), P('M15 15l5 5')] },
  trash: { kids: [P('M4.5 7h15M9.5 7V5a1.5 1.5 0 011.5-1.5h2A1.5 1.5 0 0114.5 5v2M6.5 7l1 12a1.5 1.5 0 001.5 1.4h6a1.5 1.5 0 001.5-1.4l1-12')] },
  // 往右滑露出的「编辑」：笔（和 babble 同一个）
  pencil: { kids: [P('M4.5 19.5l1-4.2L15.8 5a2 2 0 012.9 0l.3.3a2 2 0 010 2.9L8.7 18.5z')] },
  // 购物车：食谱「加到清单」、日历「生成购物清单」
  cart: { kids: [P('M3 4.5h2.6l2.2 10.2a1.5 1.5 0 001.5 1.2h8.3a1.5 1.5 0 001.5-1.1L21 8H6.6'), C(10, 19.6, 1.3), C(17, 19.6, 1.3)] },
  // 食谱：冒着热气的锅（底栏、侧栏、联想里的「用到它的食谱」）
  recipe: { kids: [P('M4 11h16'), P('M5.5 11v5.5a3 3 0 003 3h7a3 3 0 003-3V11'), P('M5.5 13H3.2M18.5 13h2.3'), P('M9 4.2c-.7.8-.7 1.7 0 2.5s.7 1.7 0 2.5'), P('M15 4.2c-.7.8-.7 1.7 0 2.5s.7 1.7 0 2.5')] },
  // 计划：日历（底栏、侧栏、食谱页的「加到计划」）
  calendar: { kids: [P('M5.5 5.5h13a2 2 0 012 2v11a2 2 0 01-2 2h-13a2 2 0 01-2-2v-11a2 2 0 012-2z'), P('M3.5 10h17'), P('M8 3.5v4M16 3.5v4'), C(8.5, 14.5, .9), C(12, 14.5, .9)] },
  // 成品图：一张照片（山和太阳）。添加成品图、图还没到时的占位
  photo: { kids: [P('M5.5 4.5h13a2 2 0 012 2v11a2 2 0 01-2 2h-13a2 2 0 01-2-2v-11a2 2 0 012-2z'), C(9, 9.5, 1.6), P('M3.8 16.8l4.7-4.7 3.8 3.8 2.6-2.6 5 5')] },
  // 屏幕常亮：太阳（清单页、商店页的 ⋯ 里和顶栏上的小标签）
  sun: { kids: [C(12, 12, 3.8), P('M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4')] },
  // 粘贴食材：剪贴板
  paste: { kids: [P('M9 4.5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-12a2 2 0 00-2-2h-2'), P('M9.5 3h5a.5.5 0 01.5.5v2a.5.5 0 01-.5.5h-5a.5.5 0 01-.5-.5v-2a.5.5 0 01.5-.5z'), P('M8.5 11h7M8.5 15h5')] },
};

/**
 * icon('gear') → <svg class="ic ic-gear">。label 给了就是有名字的图片（读屏会念），否则 aria-hidden。
 * 线条图标用 currentColor 描边；大小由 CSS（.ic 默认 22px）或 size 决定。
 */
export function icon(name, { cls = '', label = null, size = null } = {}) {
  const def = ICONS[name] || ICONS.x;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', ['ic', 'ic-' + name, cls].filter(Boolean).join(' '));
  if (size) { svg.setAttribute('width', size); svg.setAttribute('height', size); }
  if (label) { svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', label); } else svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const [tag, attrs] of def.kids) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.appendChild(el);
  }
  return svg;
}

// ---------- 提示条 ----------
let toastTimer = null, toastDeadline = 0, toastHover = false, toastFocus = false, toastReturn = null;
/**
 * toast('已删除', { ms: 10000, action: { label: '撤销', run: fn } })，返回 { close }
 * 提示条不挡按钮：显示期间跟着页面变化（换页、转屏）重新找位置，见 placeToast。
 * 读屏念的是一直在页面里的 #toast-live（见 announce）。用键盘、读屏走到「撤销」上（或者手指 / 鼠标停在上面）时不倒计时，
 * 离开了再接着数；按了「撤销」焦点回到原来的地方，不掉回页首
 */
export function toast(msg, { ms = 4000, action = null } = {}) {
  let el = $('#toast');
  if (!el) { el = h('div', { id: 'toast' }); document.body.appendChild(el); }
  wireToast(el);
  const close = () => {
    el.classList.remove('on'); el.setAttribute('inert', '');
    toastHover = toastFocus = false;
    unwatch();
    setTimeout(() => { if (!el.classList.contains('on')) el.replaceChildren(); }, 300);
  };
  const hadFocus = el.contains(document.activeElement);
  el.replaceChildren(h('span.toast-msg', null, msg));
  if (action && action.label) el.appendChild(h('button', { type: 'button', onclick: () => {
    const from = toastReturn;
    clearTimeout(toastTimer); close();
    if (action.run) action.run();
    // 撤销以后页面在微任务里重画（app.js）：排在它后面，焦点还在提示条里（或者掉到了 <body>）就放回原来的地方
    queueMicrotask(() => refocus(el, from));
  } }, action.label));
  // 新的提示顶掉了焦点所在的旧提示（按钮没了，焦点掉到 <body>）：焦点也回去
  if (hadFocus) refocus(el, toastReturn);
  el.classList.add('on');
  el.removeAttribute('inert');
  placeToast(el);
  watch(el);
  announce(msg);
  toastFocus = el.contains(document.activeElement);
  armToast(close, ms);
  return { close: () => { clearTimeout(toastTimer); close(); } };
}
let toastClose = null;
function armToast(close, ms) {
  clearTimeout(toastTimer);
  toastClose = close;
  toastDeadline = Date.now() + ms;
  toastTimer = toastHover || toastFocus ? null : setTimeout(close, ms);
}
/** 停在提示条上（焦点、手指、鼠标）：不倒计时；离开了接着数（至少再留 3 秒，看得清楚、按得到） */
function holdToast() { clearTimeout(toastTimer); toastTimer = null; }
function releaseToast() {
  if (toastHover || toastFocus || !toastClose || toastTimer) return;
  toastTimer = setTimeout(toastClose, Math.max(3000, toastDeadline - Date.now()));
}
function wireToast(el) {
  if (el.dataset.wired) return;
  el.dataset.wired = '1';
  el.addEventListener('focusin', e => {
    if (e.relatedTarget && !el.contains(e.relatedTarget)) toastReturn = e.relatedTarget;
    toastFocus = true; holdToast();
  });
  el.addEventListener('focusout', e => { if (!e.relatedTarget || !el.contains(e.relatedTarget)) { toastFocus = false; releaseToast(); } });
  el.addEventListener('pointerenter', () => { toastHover = true; holdToast(); });
  el.addEventListener('pointerleave', () => { toastHover = false; releaseToast(); });
}
/** 焦点放回提示条之前的地方；那个控件没了就给页面标题（data-fid="lp-title"），再不行给内容栏 */
function refocus(el, from) {
  const a = document.activeElement;
  if (a && a !== document.body && !el.contains(a)) return;
  const main = $('#main');
  const pane = main && main.querySelector('.pane');
  for (const c of [from, main && main.querySelector('[data-fid="lp-title"]'), pane]) {
    if (!c || !c.isConnected || typeof c.focus !== 'function' || el.contains(c)) continue;
    if (c === pane && c.tabIndex < 0) c.tabIndex = -1;
    c.focus({ preventScroll: true });
    if (document.activeElement === c) return;
  }
}
/**
 * 读屏念提示：写进一直在页面里的 #toast-live（role=status）。提示条本身空着时是 display: none + inert，不在读屏的「树」里，
 * 内容和它一起出现时很多读屏不念；先清空、隔一会儿再写，同样的话连着出现两次也会再念
 */
function announce(msg) {
  let live = $('#toast-live');
  if (!live) { live = h('div.sr-only', { id: 'toast-live', role: 'status', 'aria-live': 'polite' }); document.body.appendChild(live); }
  live.textContent = '';
  setTimeout(() => { live.textContent = String(msg); }, 100);
}

// 提示条要让开的按钮：手机底栏、页面底部的按钮条、顶栏。页面里别的固定按钮可以加 data-toast-avoid
const TOAST_AVOID = '#tabs, .bottom-bar, .navbar, [data-toast-avoid]';
let safeProbe = null;
/** 顶部安全区（刘海 / 灵动岛）多高：env() 只能在 CSS 里用，放一个看不见的元素量一下 */
function safeTop() {
  if (!safeProbe || !safeProbe.isConnected) {
    safeProbe = h('div', { 'aria-hidden': 'true', style: { position: 'fixed', top: '0', left: '0', width: '0', height: 'env(safe-area-inset-top, 0px)', visibility: 'hidden', pointerEvents: 'none' } });
    document.body.appendChild(safeProbe);
  }
  return safeProbe.offsetHeight || 0;
}
/**
 * 放提示条：先放在 CSS 定的底部位置；挡住了上面那些按钮就往上挪到按钮上方（一层层往上找）；
 * 下半屏都放不下就放到顶部安全区下面、顶上的按钮下方
 */
function placeToast(el = $('#toast')) {
  if (!el) return;
  el.style.top = ''; el.style.bottom = '';
  el.classList.remove('at-top');
  if (!el.classList.contains('on')) return;
  // iPhone 弹出键盘时 innerHeight（layout viewport）不变，看得见的只有键盘上面那一截（visualViewport）：提示条要在键盘上面
  const vh = window.innerHeight, vv = window.visualViewport;
  const viewTop = vv ? vv.offsetTop : 0, viewBottom = vv ? Math.min(vh, vv.offsetTop + vv.height) : vh;
  const gap = 8, th = el.offsetHeight, tw = el.offsetWidth;
  const left = (window.innerWidth - tw) / 2, right = left + tw;
  const rects = [...document.querySelectorAll(TOAST_AVOID)].filter(n => !el.contains(n)).map(n => n.getBoundingClientRect())
    .filter(r => r.width > 0 && r.height > 0 && r.bottom > viewTop && r.top < viewBottom && r.left < right && r.right > left);
  const hits = (top) => rects.filter(r => r.top < top + th && r.bottom > top);
  const minTop = Math.max(safeTop(), viewTop) + gap;
  const css = vh - (parseFloat(getComputedStyle(el).bottom) || 24) - th;
  const base = viewBottom < vh ? Math.min(css, viewBottom - gap - th) : css;
  let top = base;
  for (let i = 0; i < 12 && top >= minTop; i++) {
    const hit = hits(top);
    if (!hit.length) break;
    top = Math.min(...hit.map(r => r.top)) - gap - th;
  }
  if (top >= minTop && top >= viewTop + (viewBottom - viewTop) * 0.2) {
    if (top !== css) el.style.bottom = Math.round(vh - top - th) + 'px';
    return;
  }
  // 下面放不下：从顶上往下找
  top = minTop;
  for (let i = 0; i < 12; i++) {
    const hit = hits(top);
    if (!hit.length) break;
    top = Math.max(...hit.map(r => r.bottom)) + gap;
  }
  el.classList.add('at-top');
  el.style.bottom = 'auto';
  el.style.top = Math.round(Math.min(top, viewBottom - th - gap)) + 'px';
}
// 显示期间：页面内容变了（换页、重画）、窗口大小变了、滚动了 → 下一帧重新放
let toastObs = null, toastRaf = 0;
const placeSoon = () => { if (!toastRaf) toastRaf = requestAnimationFrame(() => { toastRaf = 0; placeToast(); }); };
function watch(el) {
  if (toastObs) return;
  toastObs = new MutationObserver(muts => { if (muts.some(m => !el.contains(m.target))) placeSoon(); });
  toastObs.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('resize', placeSoon);
  window.addEventListener('scroll', placeSoon, { passive: true, capture: true });
  const vv = window.visualViewport;
  if (vv) { vv.addEventListener('resize', placeSoon); vv.addEventListener('scroll', placeSoon); }
}
function unwatch() {
  if (!toastObs) return;
  toastObs.disconnect(); toastObs = null;
  window.removeEventListener('resize', placeSoon);
  window.removeEventListener('scroll', placeSoon, { capture: true });
  const vv = window.visualViewport;
  if (vv) { vv.removeEventListener('resize', placeSoon); vv.removeEventListener('scroll', placeSoon); }
}

// ---------- 面板（手机上从底部弹出，宽屏居中） ----------
/**
 * sheet(内容, { title, foot: [按钮…], wide, cls, onClose, beforeClose, closeLabel })
 * 内容可以是 Node，也可以是 (sheet) => Node。返回 { el, body, close, tryClose, setTitle }。
 * beforeClose() 返回 false 时不关（比如有没保存的修改）；点遮罩、按 Esc、点 ✕ 都走 tryClose。
 */
export function sheet(content, { title = '', foot = null, wide = false, cls = '', onClose = null, beforeClose = null, closeLabel = t('common.close') } = {}) {
  const dlg = h('dialog.sheet' + (wide ? '.wide' : ''), { class: cls || null, 'aria-label': title || null });
  const bodyEl = h('div.sheet-body');
  const close = () => { if (dlg.open) dlg.close(); };
  const tryClose = () => { if (!beforeClose || beforeClose() !== false) close(); };
  const titleEl = h('h2', null, title);
  dlg.append(h('div.sheet-head', null, titleEl, h('button.icon-btn', { type: 'button', 'aria-label': closeLabel, onclick: tryClose }, icon('x'))), bodyEl);
  const api = { el: dlg, body: bodyEl, close, tryClose, setTitle: (x) => { titleEl.textContent = x; } };
  const node = typeof content === 'function' ? content(api) : content;
  if (node) bodyEl.append(node);
  if (foot && foot.length) dlg.append(h('div.sheet-foot', null, foot));
  dlg.addEventListener('cancel', e => { e.preventDefault(); tryClose(); });
  dlg.addEventListener('close', () => { dlg.remove(); if (onClose) onClose(); });
  // 点遮罩关闭：按下和松开都在遮罩上才算（在输入框里拖选文字、松手落到遮罩上不算）
  let downOnBackdrop = false;
  dlg.addEventListener('pointerdown', e => { downOnBackdrop = e.target === dlg; });
  dlg.addEventListener('click', e => { if (e.target === dlg && downOnBackdrop) tryClose(); downOnBackdrop = false; });
  document.body.appendChild(dlg);
  dlg.showModal();
  return api;
}

/**
 * 确认框 → Promise<boolean>
 * confirmDialog('确定删除？') 或 confirmDialog({ title, message, confirmLabel, cancelLabel, danger })
 */
let confirmSeq = 0;
/**
 * 读屏打开确认框时要听得到问的是什么：有标题时标题是名字、那句话是说明（aria-describedby）；只有一句话时那句话就是名字。
 * 焦点先给「确定」；会删东西、放弃修改的（danger）先给「取消」：连按两下回车不会直接删掉
 */
export function confirmDialog(opts) {
  const o = typeof opts === 'string' ? { message: opts } : (opts || {});
  return new Promise(resolve => {
    let answer = false;
    const msgId = 'confirm-msg-' + (++confirmSeq);
    const cancel = h('button.btn', { type: 'button', onclick: () => s.close() }, o.cancelLabel || t('common.cancel'));
    const ok = h('button.btn' + (o.danger ? '.danger-fill' : '.primary'), { type: 'button', onclick: () => { answer = true; s.close(); } }, o.confirmLabel || t('common.confirm'));
    const s = sheet(o.message ? h('p.confirm-msg', { id: msgId }, o.message) : null, {
      title: o.title || '', cls: 'confirm',
      onClose: () => resolve(answer),
      foot: [cancel, ok],
    });
    if (o.message) {
      if (o.title) s.el.setAttribute('aria-describedby', msgId);
      else { s.el.removeAttribute('aria-label'); s.el.setAttribute('aria-labelledby', msgId); }
    }
    (o.danger ? cancel : ok).focus();
  });
}

/**
 * ↑↓ 排顺序的按钮（首页、设置 → 商店 / 分类）：按完这一行换了位置，手指下面换成了另一行的按钮，紧接着再按一下就把它挪回去了。
 * fn 改完数据以后，等页面重画好，把页面滚一下，让刚按的按钮（data-fid）回到屏幕上原来的位置：连着按挪的还是同一样。
 * 页面不够长、滚不动时就算了（键盘、读屏不受影响：焦点本来就按 data-fid 放回同一个按钮）
 */
export function keepUnderFinger(ctx, main, fid, fn) {
  const top = () => { const el = main.querySelector(`[data-fid="${fid}"]`); return el && el.getBoundingClientRect ? el.getBoundingClientRect().top : null; };
  const before = top();
  fn();
  if (before == null) return;
  // app.js 收到修改通知时把重画排进了微任务，这个排在它后面
  queueMicrotask(() => {
    const after = top();
    const sc = ctx.layout() === 'phone' ? document.scrollingElement : main;     // 手机整页滚，宽屏内容栏自己滚
    if (after != null && sc && Math.abs(after - before) >= 1) sc.scrollTop += after - before;
  });
}

/**
 * 返回按钮上的字：ctx.back 有上一页时是后退，写后退回去的那一页（app.js 的 ctx.backLabel）；直接打开的（没有上一页）写 fallback，
 * 那时 ctx.back 去的就是它。读屏念的和按了去的地方要一样
 */
export const backText = (ctx, fallback) => h('span.back-label', null, ctx && typeof ctx.backLabel === 'function' ? ctx.backLabel(fallback) : fallback);

/**
 * 推入的页面（设置 → 商店 / 分类 / 多设备同步 / 备份与恢复、最近删除）：吸顶的顶栏，和 Babble 一样左边返回、中间标题（h1.nb-title，长了省略）、
 * 右边可选一个按钮 add = { label, run, fid }（窄的手机上只显示 +）；返回放内容的容器（div.page.<cls>）。长的一页滚下去也要能返回、新增。
 * 这些页面不管哪种布局都是一栏、没有左栏可回，所以宽屏也显示返回（只有双栏右栏的清单页、一家店、搜索把返回藏起来：左栏就是上一页）
 */
export function pushFrame(main, ctx, title, { add = null, back = '/settings', backLabel = t('nav.settings'), cls = '' } = {}) {
  const page = h('div.page' + (cls ? '.' + cls : ''));
  main.append(
    h('header.navbar.lp-nav.push-nav', null,
      h('button.back', { type: 'button', onclick: () => ctx.back(back) }, icon('back'), backText(ctx, backLabel)),
      h('h1.nb-title', null, title),
      // 字放在 span 里：窄的手机（375 以下）上只留 +（英文的「+ Add Category」会折成两行、贴着中间的标题），读屏照样念 aria-label
      add ? h('button.tb-btn', { type: 'button', 'aria-label': add.label, dataset: { fid: add.fid || 'push-add' }, onclick: add.run },
        icon('plus'), h('span.tb-label', null, add.label)) : h('span')),
    page);
  return page;
}

/**
 * 链接的 onclick：不等浏览器的 hashchange，在这一下点按里就换页（ctx.navigate 马上画出新页面）。
 * 新页面要把焦点给输入框（搜索）：iPhone 只在点按里弹出键盘，等到 hashchange 再 focus() 只有光标、没有键盘。
 * here()：已经在那一页上时返回那一页的输入框（双栏时搜索页在右栏，左栏的入口还看得见）：不换页，焦点给它——
 * 换页会把那一页上的状态（搜索词、结果）清掉。也是在点按里 focus，iPad 的键盘弹得出来。
 * 按着 ⌘ / Ctrl / Shift 点的（在新标签页打开）照浏览器自己的来
 */
export const linkTo = (ctx, path, here = null) => (e) => {
  if (e && (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button)) return;
  if (e && e.preventDefault) e.preventDefault();
  const input = here ? here() : null;
  if (input) input.focus(); else ctx.navigate(path);
};

/** 复制文字（剪贴板 API 不行就退回到选中一个看不见的文本框） → Promise<boolean> */
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* 退回下面的办法 */ }
  const ta = h('textarea', { style: { position: 'fixed', opacity: '0', top: '0' }, readonly: true });
  ta.value = text; document.body.appendChild(ta);
  let ok = false;
  try { ta.select(); ok = document.execCommand('copy'); } catch (e) { ok = false; }
  ta.remove();
  return ok;
}

/** 下载一个文件：data 是 Blob 或字符串 */
export function download(name, data, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name, hidden: true });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
