// PickNest：启动、外壳（手机底栏 / 宽屏侧栏）、路由、主题、本机数据坏了时的恢复页。页面在 views/，计算在 core/。
//
// ===== 页面接口 =====
// export function render(main, params, ctx) → 清理函数 | { cleanup?(), onChange?(info) } | undefined
//   main    空的容器（<section class="pane view view-<name>">），页面自己画标题和内容
//   params  { name, path, id, sub, query, hash }
//           name: 'lists' | 'list' | 'stores' | 'store' | 'settings'
//           #/ → lists（首页「清单」）；#/l/<listId> → list（一张清单，id；清单不在了由页面自己回首页）；
//           #/stores → stores（「商店」）；#/s/<storeId> → store（一家店，id；#/s/none 是「未指定」；商店不在了由页面自己回「商店」）；
//           #/settings → settings（sub null）；#/settings/stores、#/settings/categories → settings（sub 'stores' | 'categories'）；不认识的地址 → lists
//   数据变了：页面返回了 onChange 就只调 onChange(info)，页面自己更新（清单页这样做：快速添加的输入框不能被打断）；
//            否则 app 把这个页面整个重画一遍（保留滚动位置；带 data-fid 的控件重画后恢复焦点）。
//   手机（<720px）：顶层页面（#/、#/stores、#/settings）显示底栏；推入的页面（#/l/…、#/s/…、#/settings/…）不显示底栏，自己画返回按钮（ctx.back）。
//   宽屏（≥720px，iPad、Mac）：左边侧栏，内容栏自己滚动。要随布局变化的页面听 ctx.on('layout')。
//
// ===== ctx =====
// 数据（src/core/state.js 的包装；改数据一律走这些，app 会保存、重画）
//   ctx.state                  当前数据（只读）：{ app, v, data: { lists, items, stores, categories, memory }, settings, settingsAt }
//   ctx.local                  本机设置 picknest.local（只读）：{ lang, theme, device, sync, lastBackupAt, view, storeView }
//   ctx.mutate(fn, { undoLabel })  fn(state) 直接改（同步函数），返回 fn 的返回值；修改时间自动补；给 undoLabel 会弹 10 秒「撤销」提示
//   ctx.put(collection, rec, { undoLabel })   新建（没有 id 就生成）或整条替换：整理字段、盖修改时间，返回存好的记录。
//                              内容和原来一样就什么也不做（不盖新时间、不进撤销）；id 不符合 safeKey 直接抛错
//   ctx.update(collection, id, patch, { undoLabel })  改几个字段，返回存好的记录（没有这条 → null）
//   ctx.remove(collection, id, { undoLabel })  软删除，返回删除前的记录（没有 / 已经删了 → null）
//   ctx.restore(collection, id)  从「最近删除」恢复（弹「已恢复」提示），返回恢复后的记录
//   ctx.undo()                 撤销最近一次带 undoLabel 的修改
//   ctx.setSetting(key, value) 改一项同步的设置
//   ctx.mergeIn(otherState)    导入备份（逐条合并、补预置记录），返回 { changed }
//   ctx.setLocal(patch)        改本机设置（不重画页面）；浅合并，改 view / storeView 要整个传（{ view: { ...ctx.local.view, [listId]: {...} } }）
//   ctx.editVersion            本机修改计数
//   ctx.saveOk()               最近一次数据写入是否成功
// 导航
//   ctx.navigate(path, { replace })  path 如 '/settings'（前面的 # 可有可无）；同一地址 = 重画
//   ctx.back(fallback = '/')   App 内有上一页就后退，否则换成 fallback
//   ctx.route                  当前路由（同 params 的结构）；ctx.params 是这个页面挂载时的路由
//   ctx.refresh()              重画当前页面（焦点在带 data-fid 的控件上时，重画后放回去）
//   ctx.layout()               'phone'（<720）| 'side'（≥720，有侧栏）
// 界面
//   ctx.t(key, vars)、ctx.lang()、ctx.setLang(l)、ctx.setTheme('auto'|'light'|'dark')、ctx.theme()（当前生效的 'light'|'dark'）
//   ctx.toast(msg, { ms, action: { label, run } })、ctx.sheet(content, opts)、ctx.confirm(opts) → Promise<boolean>（见 ui/dom.js）
//   ctx.on(event, fn)          'change'(info) | 'layout'(layout) | 'theme'(theme)；返回取消函数，页面清理时自动取消
//   ctx.onChange(fn)           = ctx.on('change', fn)
//   ctx.build                  当前版本（src/version.js，和 sw.js 的 CACHE 一样）
// 恢复页（ui/recovery.js）用
//   ctx.storageIssue()         本机数据读不出来 / 存储用不了 → { code, count }，正常 → null
//   ctx.recoveryExport() / ctx.recoveryArchive()   原始数据（下载用）
//   ctx.repairData(next)       用读得出来的部分（合并 next）换掉坏了的数据；ctx.retryData() 重新读取
import * as state from './core/state.js';
import { stamp, deletedRecord, restoredRecord, setSetting, normalizeRecord, newId } from './core/store.js';
import { isObj, own, safeKey } from './core/util.js';
import { t, setLang, getLang, guessLang, LANGS } from './i18n.js';
import { h, $, icon, toast, sheet, confirmDialog, download } from './ui/dom.js';
import { recoveryPanel } from './ui/recovery.js';
import { BUILD } from './version.js';
import * as lists from './views/lists.js';
import * as list from './views/list.js';
import * as stores from './views/stores.js';
import * as store from './views/store.js';
import * as settings from './views/settings.js';

const VIEWS = { lists, list, stores, store, settings };
const SETTINGS_SUBS = ['stores', 'categories'];
const THEME_COLOR = { light: '#f6f5f0', dark: '#121412' };          // 和 styles.css 的 --bg 一样：状态栏和页面连成一片
const ID_PREFIX = { lists: 'l_', items: 'i_', stores: 's_', categories: 'c_', memory: 'm_' };

state.load();
const S = () => state.getState();
const L = () => state.getLocal();

// ---------- 小事件总线（页面订阅，页面清理时自动取消） ----------
const bus = new Map();
function on(ev, fn) { if (!bus.has(ev)) bus.set(ev, new Set()); bus.get(ev).add(fn); return () => bus.get(ev).delete(fn); }
function emit(ev, arg) { for (const fn of [...(bus.get(ev) || [])]) { try { fn(arg); } catch (e) { console.error(e); } } }

// ---------- 路由 ----------
const dec = s => { try { return decodeURIComponent(s); } catch (e) { return s; } };   // 截断的链接（%E0）不要让整个 app 白屏
function parseRoute(hash) {
  const raw = String(hash || '').replace(/^#\/?/, '');
  const qi = raw.indexOf('?');
  const path = (qi < 0 ? raw : raw.slice(0, qi)).split('/').filter(Boolean).map(dec);
  const query = Object.fromEntries(new URLSearchParams(qi < 0 ? '' : raw.slice(qi + 1)));
  const [a] = path;
  let r;
  // 设置里还没有的子页面（比如以后才有的 #/settings/sync 的旧链接）当成设置首页：不然既没有底栏、也没有返回
  if (a === 'settings') r = { name: 'settings', sub: SETTINGS_SUBS.includes(path[1]) ? path[1] : null };
  else if (a === 'l' && path[1]) r = { name: 'list', id: path[1] };
  else if (a === 'stores') r = { name: 'stores' };
  else if (a === 's' && path[1]) r = { name: 'store', id: path[1] };
  else r = { name: 'lists' };                  // #/ 和不认识的地址（比如以后才有的页面的旧链接）
  return { id: null, sub: null, ...r, path, query, hash: '#/' + raw };
}
const route = () => parseRoute(location.hash);

const mqSide = matchMedia('(min-width: 720px)');
const layout = () => (mqSide.matches ? 'side' : 'phone');
const TOP_LEVEL = r => r.name === 'lists' || r.name === 'stores' || (r.name === 'settings' && !r.sub);

// ---------- 导航（带 App 内历史：判断 ctx.back 能不能真的后退，后退时回到原来的滚动位置） ----------
const navStack = [];
let lastWasBack = false;
const scrollMemory = new Map();
function track(hash) {
  lastWasBack = navStack.length >= 2 && navStack[navStack.length - 2] === hash;
  if (lastWasBack) navStack.pop();
  else if (navStack[navStack.length - 1] !== hash) navStack.push(hash);
}
const norm = p => '#/' + String(p || '').replace(/^#?\/?/, '');
let currentHash = null;

function navigate(path, { replace = false } = {}) {
  if (state.storageIssue()) return false;
  const target = norm(path);
  if ((location.hash || '#/') === target && !replace) { refresh(); return true; }
  if (replace) {
    history.replaceState(history.state, '', target);
    if (navStack.length) navStack[navStack.length - 1] = target; else navStack.push(target);
    currentHash = target; lastWasBack = false;
    render();
  } else location.hash = target;
  return true;
}
function back(fallback = '/') {
  if (navStack.length > 1) history.back();
  else navigate(fallback, { replace: true });
}
// 地址变了（点链接、后退前进）：hashchange 和 popstate 都听（WebKit 后退时有时只先来 popstate），同一个地址只处理一次
function onUrlChange() {
  const target = location.hash || '#/';
  if (target === currentHash) return;
  if (currentHash) scrollMemory.set(currentHash, scrollTop());
  currentHash = target;
  track(target);
  render();
}
window.addEventListener('hashchange', onUrlChange);
window.addEventListener('popstate', onUrlChange);

// ---------- 主题 ----------
const prefersDark = matchMedia('(prefers-color-scheme: dark)');
function resolvedTheme() {
  const th = L().theme;
  if (th === 'light' || th === 'dark') return th;
  return prefersDark.matches ? 'dark' : 'light';
}
function applyTheme() {
  const th = resolvedTheme(), root = document.documentElement;
  const changed = root.dataset.theme !== th;
  root.dataset.theme = th;
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.content = THEME_COLOR[th];
  if (changed) emit('theme', th);
  return changed;
}

// ---------- ctx ----------
/** 取一个集合（不存在就是空的），put / update 用。集合名只认自有的（toString 之类不顺着原型找到内置函数） */
const col = (s, c) => { if (!isObj(own(s.data, c))) s.data[c] = {}; return s.data[c]; };
const recOf = (c, id) => own(own(S().data, c), id);
// 存不下的 id（带空格的、__proto__）保存时会被悄悄丢掉，__proto__ 还会改掉集合的原型：在改数据之前就报错
const checkKeys = (c, id) => { if (!safeKey(c)) throw new Error('bad-collection'); if (!safeKey(id)) throw new Error('bad-id'); };
const ctx = {
  get state() { return S(); },
  get local() { return L(); },
  get editVersion() { return state.editVersion(); },
  saveOk: state.saveOk,
  storageIssue: state.storageIssue,
  recoveryExport: state.recoveryExport,
  recoveryArchive: state.recoveryArchive,
  async repairData(next) { await state.recoverFrom(next); },
  retryData() { state.reload(); },
  get route() { return route(); },
  mutate: (fn, opts) => state.mutate(fn, opts),
  put(c, rec, opts) {
    const id = rec.id || newId(own(ID_PREFIX, c) || 'r_');
    checkKeys(c, id);
    // 值和原来一样的（只是重新存一遍）由 mutate 认出来，不盖新时间、不算修改
    state.mutate(s => { const all = col(s, c); all[id] = normalizeRecord(c, stamp({ ...rec, id }, own(all, id)), id); }, opts);
    return recOf(c, id);
  },
  update(c, id, patch, opts) {
    checkKeys(c, id);
    const prev = recOf(c, id);
    return prev ? ctx.put(c, { ...prev, ...patch, id }, opts) : null;
  },
  remove(c, id, opts) {
    checkKeys(c, id);
    const prev = recOf(c, id);
    if (!prev || prev.deleted) return null;
    state.mutate(s => { col(s, c)[id] = deletedRecord(prev); }, opts);
    return prev;
  },
  restore(c, id) {
    checkKeys(c, id);
    const r = restoredRecord(recOf(c, id));
    if (!r) return null;
    state.mutate(s => { col(s, c)[id] = r; });
    toast(t('common.restored'));
    return recOf(c, id);
  },
  undo() { const label = state.undo(); if (label) toast(t('common.undone')); return label; },
  setSetting: (key, value) => state.mutate(s => setSetting(s, key, value)),
  mergeIn: (other) => state.mergeIn(other),
  setLocal: (patch) => state.setLocal(patch),

  navigate, back, refresh: () => refresh(), layout,
  t, lang: getLang,
  setLang(l) { state.setLocal({ lang: l }); setLang(l); refresh(); },
  setTheme(th) { state.setLocal({ theme: th }); applyTheme(); },
  theme: () => document.documentElement.dataset.theme || 'light',
  toast, sheet, confirm: confirmDialog,
  on, onChange: (fn) => on('change', fn),
  build: BUILD,
};

// ---------- 外壳 ----------
function renderShell(r) {
  document.title = t('common.appName');
  $('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', t('common.appName'));
  $('link[rel="manifest"]')?.setAttribute('href', getLang() === 'zh-Hant-TW' ? 'manifest.zh-Hant-TW.webmanifest' : 'manifest.webmanifest');   // 添加到主屏幕时的语言跟着界面
  document.body.dataset.route = r.name;
  document.body.dataset.layout = layout();
  document.body.dataset.tabs = TOP_LEVEL(r) ? '1' : '0';
  const cur = r.name === 'list' ? 'lists' : r.name === 'store' ? 'stores' : r.name;     // 清单页算在「清单」下面，一家店算在「商店」下面
  const item = (id, href, ic, label) => h('a.nav-item' + (cur === id ? '.on' : ''), { href, 'aria-current': cur === id ? 'page' : null }, ic, h('span', null, label));
  const tab = (id, href, ic, label) => h('a.tab' + (cur === id ? '.on' : ''), { href, 'aria-current': cur === id ? 'page' : null }, ic, h('span', null, label));
  $('#side').replaceChildren(
    h('div.brand', null, h('img', { src: 'icons/icon-180.png', alt: '', width: 32, height: 32, onerror: e => { e.target.style.visibility = 'hidden'; } }), h('b', null, t('common.appName'))),
    h('nav', { 'aria-label': t('nav.label') }, item('lists', '#/', icon('list'), t('nav.lists')), item('stores', '#/stores', icon('store'), t('nav.stores'))),
    h('div.side-foot', null, h('nav', { 'aria-label': t('nav.settings') }, item('settings', '#/settings', icon('gear'), t('nav.settings')))),
  );
  const tabs = $('#tabs');
  tabs.setAttribute('aria-label', t('nav.label'));
  tabs.replaceChildren(tab('lists', '#/', icon('list'), t('nav.lists')), tab('stores', '#/stores', icon('store'), t('nav.stores')), tab('settings', '#/settings', icon('gear'), t('nav.settings')));
}

// ---------- 页面挂载（现在只有一栏） ----------
let current = null;           // { name, key, params, el, handle, offs }
const scrollTop = () => (layout() === 'phone' ? window.scrollY || 0 : current ? current.el.scrollTop : 0);
const scroller = (el) => (layout() === 'phone' ? document.scrollingElement : el);

function viewCtx(m) {
  const c = Object.create(ctx);
  c.on = (ev, fn) => { const off = on(ev, fn); m.offs.push(off); return off; };
  c.onChange = (fn) => c.on('change', fn);
  c.params = m.params;
  return c;
}
function runView(m) {
  m.offs = []; m.handle = null;
  try {
    const ret = VIEWS[m.name].render(m.el, m.params, viewCtx(m));
    m.handle = typeof ret === 'function' ? { cleanup: ret } : ret && typeof ret === 'object' ? ret : null;
  } catch (e) { safeMode(m.el, e); }
}
function cleanupView(m) {
  for (const off of m.offs || []) off();
  m.offs = [];
  try { if (m.handle && m.handle.cleanup) m.handle.cleanup(); } catch (e) { console.error(e); }
  m.handle = null;
}
function unmount() {
  if (!current) return;
  cleanupView(current);
  current.el.remove();
  current = null;
}
/** 换页：同一个地址不重画；换了就清理旧页面、在同一个容器里画新页面，后退回来时恢复滚动位置 */
function mount(r, main) {
  const key = r.name + '|' + r.hash;
  if (current && current.key === key) return false;
  const old = current;
  if (old) cleanupView(old);
  const el = old ? old.el : h('section.pane');
  el.className = `pane view view-${r.name}`;
  el.replaceChildren();
  current = { name: r.name, key, params: r, el, handle: null, offs: [] };
  if (!old) main.append(el);
  runView(current);
  const saved = lastWasBack && scrollMemory.get(r.hash);
  const top = saved != null && saved !== false ? saved : 0;
  if (layout() === 'phone') window.scrollTo(0, top); else el.scrollTop = top;
  return true;
}
/** 数据变了：带 onChange 的页面自己更新，其余整个重画（保留滚动和焦点） */
function rerender(m) {
  const sc = scroller(m.el), top = sc ? sc.scrollTop : 0;
  const active = document.activeElement, fid = active && active.dataset ? active.dataset.fid : null;
  cleanupView(m);
  m.el.replaceChildren();
  runView(m);
  if (sc) sc.scrollTop = top;
  if (fid) { const el = m.el.querySelector(`[data-fid="${CSS.escape(fid)}"]`); if (el) el.focus({ preventScroll: true }); }
}

// 本机数据坏了 / 存储用不了：恢复页盖在最上面，底下的 App 设成 inert（不能点、读屏跳过），修好后再画回来
let recoveryRoot = null;
function recoveryScreen() {
  if (state.storageIssue()) {
    if (!recoveryRoot) {
      recoveryRoot = h('section.recovery-screen', { tabindex: -1, role: 'region', 'aria-label': t('recovery.title') });
      document.body.append(recoveryRoot);
      recoveryPanel(recoveryRoot, ctx);
      $('.app')?.setAttribute('inert', '');
      $('#tabs')?.setAttribute('inert', '');
      recoveryRoot.focus();
    }
    return true;
  }
  if (recoveryRoot) { recoveryRoot.remove(); recoveryRoot = null; $('.app')?.removeAttribute('inert'); $('#tabs')?.removeAttribute('inert'); }
  return false;
}
function render() {
  // 恢复页也要用对的语言（读屏按 lang 选发音）和状态栏颜色，所以在它之前定
  document.documentElement.lang = getLang();
  applyTheme();
  if (recoveryScreen()) return;
  const r = route();
  renderShell(r);
  const changed = mount(r, $('#main'));
  if (changed && !document.querySelector('dialog[open]') && !current.el.contains(document.activeElement)) {
    current.el.tabIndex = -1; current.el.focus({ preventScroll: true });   // 换页后读屏、键盘从新页面开始
  }
}
/** 整页重画（换语言之类）：之前焦点在带 data-fid 的控件上（比如语言下拉框）就放回去，键盘和读屏不用从页首重新找 */
function refresh() {
  const active = document.activeElement, fid = active && active.dataset ? active.dataset.fid : null;
  unmount();
  render();
  const el = fid && current ? current.el.querySelector(`[data-fid="${CSS.escape(fid)}"]`) : null;
  if (el) el.focus({ preventScroll: true });
}

// 数据变化 → 提示撤销 / 存储满 → 页面更新
let rerenderQueued = false;
state.subscribe((st, info) => {
  const wasBlocked = !!recoveryRoot;
  if (recoveryScreen()) return;
  if (wasBlocked) { refresh(); return; }       // 本页或别的标签页修好数据后，重新挂载页面
  if (info.saved === false) toast(t('common.storageFull'), { ms: 10000 });
  else if (info.undoLabel) toast(info.undoLabel, { ms: 10000, action: { label: t('common.undo'), run: () => ctx.undo() } });
  emit('change', info);
  if (rerenderQueued) return;
  rerenderQueued = true;
  queueMicrotask(() => {
    rerenderQueued = false;
    if (recoveryScreen() || !current) return;
    if (current.handle && typeof current.handle.onChange === 'function') { try { current.handle.onChange(info); } catch (e) { console.error(e); } }
    else rerender(current);
  });
});

// ---------- 出错时的安全模式：页面画不出来也能把数据下载下来 ----------
function safeMode(el, e) {
  console.error(e);
  el.replaceChildren(h('div.page', null, h('section.card.safe-mode', null,
    h('p.err', null, t('common.renderError'), ' ', String((e && e.message) || e)),
    h('p.muted', null, t('common.safeMode')),
    h('div.row', null,
      h('button.btn', { type: 'button', onclick: () => download('picknest-data.json', JSON.stringify({ app: 'picknest', v: 1, kind: 'raw', exportedAt: new Date().toISOString(), state: S() }), 'application/json') }, t('common.exportRaw'))))));
}

// ---------- 系统事件 ----------
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') applyTheme(); });
window.addEventListener('storage', e => { if (e.key === state.KEY || e.key === state.LKEY || e.key?.startsWith(state.PENDING_PREFIX)) state.reload(); });   // 别的标签页改了数据
prefersDark.addEventListener('change', () => applyTheme());
mqSide.addEventListener('change', () => { render(); emit('layout', layout()); });

// ---------- 启动 ----------
setLang(L().lang && LANGS.includes(L().lang) ? L().lang : guessLang());
currentHash = location.hash || '#/';
track(currentHash);
render();
window.__picknest = { state, ctx, get current() { return current; }, get S() { return S(); } };   // 方便在浏览器控制台里查看；boot.js 的看门狗也靠它判断启动好了
