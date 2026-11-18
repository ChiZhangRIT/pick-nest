// 界面小工具：建元素（文字一律用 textContent，不拼 HTML：清单名、商品名、粘贴的链接都是用户内容）、图标、提示条、面板、确认框、下载。
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

// ---------- 图标（24×24 线条图标，跟着文字颜色） ----------
const P = d => ['path', { d }];
const C = (cx, cy, r) => ['circle', { cx, cy, r }];
const ICONS = {
  // 清单：三行，前两行打了勾
  list: { kids: [P('M4 7l1.8 1.8L9 5.6'), P('M12.5 7.2H20'), P('M4 12.6l1.8 1.8L9 11.2'), P('M12.5 12.8H20'), C(6.4, 18.4, 1.5), P('M12.5 18.4H20')] },
  gear: { kids: [C(12, 12, 3), P('M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z')] },
  x: { kids: [P('M6.5 6.5l11 11M17.5 6.5l-11 11')] },
};
export const ICON_NAMES = Object.keys(ICONS);

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
let toastTimer = null;
/**
 * toast('已删除', { ms: 10000, action: { label: '撤销', run: fn } })，返回 { close }
 * 提示条不挡按钮：显示期间跟着页面变化（换页、转屏）重新找位置，见 placeToast
 */
export function toast(msg, { ms = 4000, action = null } = {}) {
  let el = $('#toast');
  if (!el) { el = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' }); document.body.appendChild(el); }
  const close = () => {
    el.classList.remove('on'); el.setAttribute('inert', '');
    unwatch();
    setTimeout(() => { if (!el.classList.contains('on')) el.replaceChildren(); }, 300);
  };
  el.replaceChildren(h('span.toast-msg', null, msg));
  if (action && action.label) el.appendChild(h('button', { type: 'button', onclick: () => { clearTimeout(toastTimer); close(); if (action.run) action.run(); } }, action.label));
  el.classList.add('on');
  el.removeAttribute('inert');
  placeToast(el);
  watch(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(close, ms);
  return { close: () => { clearTimeout(toastTimer); close(); } };
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
export function placeToast(el = $('#toast')) {
  if (!el) return;
  el.style.top = ''; el.style.bottom = '';
  el.classList.remove('at-top');
  if (!el.classList.contains('on')) return;
  const vh = window.innerHeight, gap = 8, th = el.offsetHeight, tw = el.offsetWidth;
  const left = (window.innerWidth - tw) / 2, right = left + tw;
  const rects = [...document.querySelectorAll(TOAST_AVOID)].filter(n => !el.contains(n)).map(n => n.getBoundingClientRect())
    .filter(r => r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < vh && r.left < right && r.right > left);
  const hits = (top) => rects.filter(r => r.top < top + th && r.bottom > top);
  const minTop = safeTop() + gap;
  const base = vh - (parseFloat(getComputedStyle(el).bottom) || 24) - th;
  let top = base;
  for (let i = 0; i < 12 && top >= minTop; i++) {
    const hit = hits(top);
    if (!hit.length) break;
    top = Math.min(...hit.map(r => r.top)) - gap - th;
  }
  if (top >= minTop && top >= vh * 0.2) {
    if (top !== base) el.style.bottom = Math.round(vh - top - th) + 'px';
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
  el.style.top = Math.round(Math.min(top, vh - th - gap)) + 'px';
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
}
function unwatch() {
  if (!toastObs) return;
  toastObs.disconnect(); toastObs = null;
  window.removeEventListener('resize', placeSoon);
  window.removeEventListener('scroll', placeSoon, { capture: true });
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
export function confirmDialog(opts) {
  const o = typeof opts === 'string' ? { message: opts } : (opts || {});
  return new Promise(resolve => {
    let answer = false;
    const s = sheet(o.message ? h('p.confirm-msg', null, o.message) : null, {
      title: o.title || '', cls: 'confirm',
      onClose: () => resolve(answer),
      foot: [
        h('button.btn', { type: 'button', onclick: () => s.close() }, o.cancelLabel || t('common.cancel')),
        h('button.btn' + (o.danger ? '.danger-fill' : '.primary'), { type: 'button', onclick: () => { answer = true; s.close(); } }, o.confirmLabel || t('common.confirm')),
      ],
    });
    s.el.querySelector('.sheet-foot .btn:last-child').focus();
  });
}

/** 下载一个文件：data 是 Blob 或字符串 */
export function download(name, data, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name, hidden: true });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
