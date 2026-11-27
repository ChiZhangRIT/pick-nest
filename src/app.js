// PickNest：启动、外壳（手机底栏 / 宽屏侧栏）、路由、主题、同步什么时候跑、本机数据坏了时的恢复页。页面在 views/，计算在 core/。
//
// ===== 页面接口 =====
// export function render(main, params, ctx) → 清理函数 | { cleanup?(), onChange?(info), flush?(), land?() } | undefined
//   main    空的容器（<section class="pane view view-<name>">，双栏时 .pane-list / .pane-detail，一栏 .pane-main），页面自己画标题和内容
//   params  { name, path, id, sub, query, pane, selected, hash }
//           name: 'lists' | 'list' | 'stores' | 'store' | 'search' | 'recipes' | 'recipe' | 'recipeEdit' | 'plan' | 'settings' | 'deleted'
//           #/ → lists（首页「清单」）；#/l/<listId> → list（一张清单，id；清单不在了由页面自己回首页）；
//           #/stores → stores（「商店」）；#/s/<storeId> → store（一家店，id；#/s/none 是「未指定」；商店不在了由页面自己回「商店」）；
//           以前的 #/l/<listId>?shop=1、#/s/<storeId>?shop=1（第 6 步的大字页面，已经去掉）→ 照样是 list / store（不看 query）；
//           #/search、#/search?q=<词> → search（query.q）；
//           #/recipes → recipes（「食谱」）；#/r/<recipeId> → recipe（一道食谱，id；不在了由页面自己回「食谱」）；
//           #/r/new → recipeEdit（新建，sub 'new'）；#/r/<recipeId>/edit → recipeEdit（改，id）；
//           #/calendar（以前的 #/plan 照样认）→ plan（「日历」，第 13 步以前叫「计划」：一周 / 一个月，计划的菜和吃了什么，看到哪一周页面自己记着，不放地址里）；
//           #/settings → settings（sub null）；#/settings/stores、/categories、/sync、/data、/goals → settings（sub 'stores' | 'categories' | 'sync' | 'data' | 'goals'）；
//           #/deleted → deleted（最近删除，从设置首页「数据」那一组进去）；不认识的地址 → lists
//           pane: 'main'（一栏）| 'list'（双栏左）| 'detail'（双栏右）；selected: 双栏时右栏正在看的清单 / 商店的 id（左栏高亮那一行）
//   数据变了：页面返回了 onChange 就只调 onChange(info)，页面自己更新（清单页、一家店、搜索、设置 → 多设备同步这样做：输入框不能被打断，勾选的节奏要跨重画记着；
//            设置首页也是：只改「最近删除」的数和下面那几句，不整页重画，键盘、读屏走到一半不被打断）；
//            否则 app 把这个页面整个重画一遍（保留滚动位置；带 data-fid 的控件重画后恢复焦点）。
//   flush：页面上点过、还没写进数据的（勾选要停一下才改数据）马上写进去。切到后台时 app 先调它，再决定要不要马上上传
//   land：新打开这一页（点底栏、链接进来；不是后退回来恢复位置、不是重画）时，app 放好滚动位置以后调一次：页面自己滚到要看的地方（日历滚到今天）
//   三种布局（照 babble）：
//     手机（<720px）：顶层页面（#/、#/stores、#/recipes、#/calendar、#/settings）显示底栏；推入的页面（#/l/…、#/s/…、#/r/…、#/search、#/settings/…、#/deleted）不显示底栏，自己画返回按钮（ctx.back）。
//     侧栏（720–999px）：左边侧栏（清单、商店、食谱、日历、搜索、设置），内容栏自己滚动；推入的页面照样有返回（和 babble 一样）。
//     双栏（≥1000px，iPad 横放、Mac）：侧栏 + 两栏。#/、#/l/…、#/search 左栏是首页，右栏是那张清单 / 搜索（#/ 时右栏是提示）；
//            #/stores、#/s/… 左栏是「商店」，右栏是那家店（#/stores 时是 App 图标 + 提示）；#/recipes、#/r/… 左栏是「食谱」，右栏是那道食谱 / 编辑食谱。
//            右栏的返回由 CSS 藏起来（左栏就是上一页；编辑食谱的「取消」是 .back.text，照样显示）；别的页面（「日历」、设置……）一栏。
//   换布局（转 iPad、拉窗口）：同一栏的页面原样留着；要换栏时，有 onChange 的页面（清单页、一家店、搜索）整个搬过去（params.pane / selected 原地更新），
//            输入框里打了一半的字、焦点都不丢；其余重画。要随布局变化的页面听 ctx.on('layout')。
//
// ===== ctx =====
// 数据（src/core/state.js 的包装；改数据一律走这些，app 会保存、重画）
//   ctx.state                  当前数据（只读）：{ app, v, data: { lists, items, stores, categories, memory, recipes, plan, foods, log }, settings, settingsAt }
//   ctx.local                  本机设置 picknest.local（只读）：{ lang, theme, device, sync, lastBackupAt, view, storeView, storeFilter, planView, keepAwake }
//   ctx.mutate(fn, { undoLabel })  fn(state) 直接改（同步函数），返回 fn 的返回值；修改时间自动补；给 undoLabel 会弹 10 秒「撤销」提示
//   ctx.put(collection, rec, { undoLabel })   新建（没有 id 就生成）或整条替换：整理字段、盖修改时间，返回存好的记录。
//                              内容和原来一样就什么也不做（不盖新时间、不进撤销）；id 不符合 safeKey 直接抛错
//   ctx.update(collection, id, patch, { undoLabel })  改几个字段，返回存好的记录（没有这条 → null）
//   ctx.remove(collection, id, { undoLabel })  软删除，返回删除前的记录（没有 / 已经删了 → null）
//   ctx.restore(collection, id)  从「最近删除」恢复（弹「已恢复」提示），返回恢复后的记录
//   ctx.undo()                 撤销最近一次带 undoLabel 的修改
//   ctx.setSetting(key, value) 改一项同步的设置
//   ctx.mergeIn(otherState)    从备份恢复（逐条合并、较新的为准、补预置记录，算本机修改：开着同步会传上去），返回 { changed: 改了几条 }
//   ctx.setLocal(patch)        改本机设置（不重画页面）；浅合并，改 view / storeView 要整个传（{ view: { ...ctx.local.view, [listId]: {...} } }）
//   ctx.editVersion            本机修改计数
//   ctx.saveOk()               最近一次数据写入是否成功
// 导航
//   ctx.navigate(path, { replace })  path 如 '/settings'（前面的 # 可有可无）；同一地址 = 重画。马上画出新页面（不等 hashchange）：
//                              在点按里调用时，新页面 focus() 输入框 iPhone 才会弹出键盘（ui/dom.js 的 linkTo）
//   ctx.replaceHash(path)      页面自己换了状态（搜索框里打的字）：只换地址栏，不重画、不加历史记录；挂着的页面记下新地址（下次画不当成换页）
//   ctx.back(fallback = '/')   App 内有上一页就后退，否则换成 fallback
//   ctx.backLabel(fallbackLabel)  返回按钮上写什么：后退回去的那一页的名字（从「商店」点「管理商店」进来的写「商店」）；没有上一页 → fallbackLabel
//   ctx.route                  当前路由（同 params 的结构，不含 pane / selected）；ctx.params 是这个页面挂载时的路由（双栏时 pane / selected 原地更新）
//   ctx.refresh()              重画当前所有页面（保留滚动，焦点在带 data-fid 的控件上时重画后放回去）
//   ctx.layout()               'phone'（<720）| 'side'（720–999，有侧栏）| 'two'（≥1000，侧栏 + 双栏）
//   ctx.guard(isDirty, onDiscard)  离开前检查（照 babble；编辑食谱用）：isDirty() 为 true 时，换页（链接、底栏、侧栏、ctx.navigate、ctx.back、浏览器后退）、
//                              关掉标签页之前先问「放弃没保存的修改？」[继续编辑] [放弃]，放弃了先调 onDiscard()；ctx.guard(null) 取消；页面清理时自动取消
// 同步（core/sync.js；令牌只在 picknest.local 的 sync 里）
//   ctx.sync.now(opts)         立即同步一轮 → Promise<{ ok, skipped?, error?, offline? }>（本机数据有问题时不同步 → { ok: false, skipped: true }）
//   ctx.sync.connect({ repo, token, tokenExp })  保存同步设置（只存本机）并马上同步一次 → 同上（tokenExp：用户填的令牌到期时刻，可选）
//   ctx.sync.stop()            停止同步（只清本机的设置；本机数据、云端都不动）
//   ctx.sync.checkRepo(repo, token) → Promise<仓库全名>（仓库名不对、经典令牌、找不到、没权限、不是私有的都抛 SyncError）
//   ctx.sync.status()          { on, running, repo, at, err, offline, dirty, tokenExp }（at：上次同步成功；dirty：有没上传的修改）
//   ctx.syncBadge({ link })    同步状态的小标签（元素；默认是去 #/settings/sync 的链接，link: false 是 <span>）。状态变了 app 自己换，页面不用管。
//                              侧栏「设置」下面一直有一个；首页标题旁边的只在手机上画（宽屏有侧栏那个就够了）
//   ctx.on('sync', fn)         同步状态变了（开始、结束一轮，连接、停止，成品图传 / 下载的进度）
//   ctx.sync.status() 里还有成品图的：uploading、downloading、pendingUp、pendingDown（还剩几张）、blobErr（最近一次没传上 / 没下载成，不算同步出错）
// 成品图（第 12 步；图片本身在 IndexedDB picknest-blobs：core/blobStore.js，不在 state 里；页面上显示用 ui/photo.js 的 photoPool）
//   ctx.photos.put(blob) → Promise<{ sha256, mime, bytes }>   存一张（同样内容只存一份）
//   ctx.photos.local(sha) → Promise<Blob | null>              本机有没有（不下载）
//   ctx.photos.fetch(sha) → Promise<Blob | null>              本机没有就马上从同步仓库下载（没开同步 → null；下载出错抛出来）
//   ctx.photos.canFetch()                                       开着同步（本机没有的能下载）
//   ctx.photos.discard(sha) → Promise<boolean>                 删掉一张从来没上传过的（编辑页里加了又放弃的）；有没有食谱在用由页面先查
//   ctx.photos.usage() → Promise<{ count, bytes } | null>      这台设备上存了几张、多大（设置 → 备份与恢复里写）
//   ctx.on('photo', fn(sha))   后台下载好了一张
// 界面
//   ctx.t(key, vars)、ctx.lang()、ctx.setLang(l)、ctx.setTheme('auto'|'light'|'dark')、ctx.theme()（当前生效的 'light'|'dark'）
//   ctx.toast(msg, { ms, action: { label, run } })、ctx.sheet(content, opts)、ctx.confirm(opts) → Promise<boolean>（见 ui/dom.js）
//   ctx.on(event, fn)          'change'(info) | 'sync'(status) | 'layout'(layout) | 'theme'(theme) | 'update' | 'photo'(sha)；返回取消函数，页面清理时自动取消
//   ctx.onChange(fn)           = ctx.on('change', fn)
//   ctx.build                  当前版本（src/version.js，和 sw.js 的 CACHE 一样）
//   ctx.updateReady()          新版本下载好了、等着下次打开（设置 → 关于里说一声）；ctx.on('update', fn) 下载好的时候
// 恢复页（ui/recovery.js）用
//   ctx.storageIssue()         本机数据读不出来 / 存储用不了 → { code, count }，正常 → null
//   ctx.recoveryExport() / ctx.recoveryArchive()   原始数据（下载用；recoveryArchive 是上次恢复前存的，设置 → 备份与恢复里也能下载）
//   ctx.recoveryCloud()        只读地取云端现在的那一份 → Promise<State>（开过同步才有；没有文件抛 SyncError('nofile')）
//   ctx.repairData(next)       用读得出来的部分（合并 next）换掉坏了的数据（原件先存档）；ctx.retryData() 重新读取
import * as state from './core/state.js';
import { stamp, deletedRecord, restoredRecord, setSetting, normalizeRecord, newId, listName } from './core/store.js';
import { liveList } from './core/items.js';
import { isObj, own, safeKey, debounce } from './core/util.js';
import { createSync, platformDevice } from './core/sync.js';
import { blobStore } from './core/blobStore.js';
import { t, setLang, getLang, guessLang, LANGS } from './i18n.js';
import { h, $, icon, toast, sheet, confirmDialog, download } from './ui/dom.js';
import { recoveryPanel } from './ui/recovery.js';
import { syncBadge } from './ui/syncBadge.js';
import { BUILD } from './version.js';
import * as lists from './views/lists.js';
import * as list from './views/list.js';
import * as stores from './views/stores.js';
import * as store from './views/store.js';
import * as settings from './views/settings.js';
import * as deleted from './views/deleted.js';
import * as search from './views/search.js';
import * as recipes from './views/recipes.js';
import * as recipe from './views/recipe.js';
import * as recipeEdit from './views/recipeEdit.js';
import * as plan from './views/plan.js';
import { liveRecipe, recipeName } from './core/recipes.js';

const VIEWS = { lists, list, stores, store, search, recipes, recipe, recipeEdit, plan, settings, deleted };
const SETTINGS_SUBS = ['stores', 'categories', 'sync', 'data', 'goals'];
const THEME_COLOR = { light: '#f6f5f0', dark: '#121412' };          // 和 styles.css 的 --bg 一样：状态栏和页面连成一片
const ID_PREFIX = { lists: 'l_', items: 'i_', stores: 's_', categories: 'c_', memory: 'm_', recipes: 'r_', plan: 'p_', foods: 'f_', log: 'e_' };

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
  // 设置里没有的子页面（以后才有的页面的旧链接）当成设置首页：不然既没有底栏、也没有返回
  if (a === 'settings') r = { name: 'settings', sub: SETTINGS_SUBS.includes(path[1]) ? path[1] : null };
  else if (a === 'deleted') r = { name: 'deleted' };
  // 以前清单页 / 商店页带上 ?shop=1 是另一个大字的页面（已经去掉：勾选和平时一样）。历史记录、书签里的旧地址不看 query，打开的就是普通的那一页
  else if (a === 'l' && path[1]) r = { name: 'list', id: path[1] };
  else if (a === 'stores') r = { name: 'stores' };
  else if (a === 's' && path[1]) r = { name: 'store', id: path[1] };
  else if (a === 'search') r = { name: 'search' };
  else if (a === 'recipes') r = { name: 'recipes' };
  else if (a === 'r' && path[1] === 'new') r = { name: 'recipeEdit', sub: 'new' };
  else if (a === 'r' && path[1] && path[2] === 'edit') r = { name: 'recipeEdit', id: path[1] };
  else if (a === 'r' && path[1]) r = { name: 'recipe', id: path[1] };
  // 「日历」第 13 步以前叫「计划」、地址是 #/plan：主屏幕上、书签里、App 内历史里的旧地址照样打开同一页
  else if (a === 'calendar' || a === 'plan') r = { name: 'plan' };
  else r = { name: 'lists' };                  // #/ 和不认识的地址（比如以后才有的页面的旧链接）
  return { id: null, sub: null, ...r, path, query, hash: '#/' + raw };
}
const route = () => parseRoute(location.hash);

const mqSide = matchMedia('(min-width: 720px)'), mqTwo = matchMedia('(min-width: 1000px)');
const layout = () => (mqTwo.matches ? 'two' : mqSide.matches ? 'side' : 'phone');
const TOP_LEVEL = r => r.name === 'lists' || r.name === 'stores' || r.name === 'recipes' || r.name === 'plan' || (r.name === 'settings' && !r.sub);
// 双栏时左栏放什么：清单这一边（首页、一张清单、搜索）是首页，商店这一边（「商店」、一家店）是「商店」，食谱这一边（「食谱」、一道食谱、编辑）是「食谱」
const LEFT = { lists: 'lists', list: 'lists', search: 'lists', stores: 'stores', store: 'stores', recipes: 'recipes', recipe: 'recipes', recipeEdit: 'recipes' };

/** 这个路由在这个布局下要画哪些栏（照 babble）。双栏时左栏本身的地址（#/、#/stores）右栏是提示（'empty'） */
function planPanes(r, lay) {
  const left = lay === 'two' ? own(LEFT, r.name) : null;
  if (left) {
    const home = r.name === left;
    return [
      { slot: 'list', name: left, params: { ...r, name: left, pane: 'list', selected: home ? null : r.id } },
      { slot: 'detail', name: home ? 'empty' : r.name, params: { ...r, pane: 'detail', selected: r.id } },
    ];
  }
  return [{ slot: 'main', name: r.name, params: { ...r, pane: 'main', selected: r.id } }];
}

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

// ---------- 离开前先问（照 babble 的 ctx.guard：编辑食谱改了没保存） ----------
// 没有要问的时候一切照旧、同步地换页（iPhone 要在点按里画出新页面才弹键盘）；有的时候先问「放弃没保存的修改？」，放弃了再走
const safeCall = fn => { try { return !!fn(); } catch (e) { return false; } };
const guarded = () => Object.values(mounted).some(m => m.guard && safeCall(m.guard));
function confirmLeave() {
  return confirmDialog({ message: t('item.discardQ'), cancelLabel: t('common.keepEditing'), confirmLabel: t('item.discard'), danger: true })
    .then(ok => {
      if (!ok) return false;
      // 放弃了：告诉有修改的页面（编辑食谱要删掉另存的草稿，不然下次打开又回来了）
      for (const m of Object.values(mounted)) {
        const dirty = m.guard && safeCall(m.guard), onDiscard = m.guardDiscard;
        m.guard = null; m.guardDiscard = null;
        if (dirty && onDiscard) { try { onDiscard(); } catch (e) { console.error(e); } }
      }
      return true;
    });
}

function navigate(path, { replace = false } = {}) {
  if (state.storageIssue()) return false;
  if (guarded()) { confirmLeave().then(ok => { if (ok) navigate(path, { replace }); }); return false; }
  const target = norm(path);
  if ((location.hash || '#/') === target && !replace) { refresh(); return true; }
  if (replace) {
    history.replaceState(history.state, '', target);
    if (navStack.length) navStack[navStack.length - 1] = target; else navStack.push(target);
    currentHash = target; lastWasBack = false;
    render();
  } else {
    // 马上画（不等 hashchange）：还在这一下点按里，新页面把焦点给输入框时 iPhone 才弹得出键盘。随后到的 hashchange 是同一个地址，不再处理
    location.hash = target;
    onUrlChange();
  }
  return true;
}
/** 页面自己换了状态（搜索框里打的字）：只换地址栏，不重画、不加历史记录；挂着的页面记下新地址（下次 render 不当成换页） */
function replaceHash(path) {
  const target = norm(path), before = route().hash;
  if ((location.hash || '#/') === target) return;
  // Safari 限制一会儿之内 replaceState 的次数（超了会报错）：换不成就算了，只是地址栏晚一点跟上
  try { history.replaceState(history.state, '', target); } catch (e) { return; }
  currentHash = location.hash || target;
  if (navStack.length) navStack[navStack.length - 1] = currentHash; else navStack.push(currentHash);
  const after = route().hash;
  for (const m of Object.values(mounted)) if (m.params.hash === before) { m.params.hash = after; m.key = m.slot + '|' + m.name + '|' + after; }
}
function back(fallback = '/') {
  // 先问再后退：后退以后再问的话，历史记录已经退了一格，留下来时只能把地址改回去
  if (guarded()) { confirmLeave().then(ok => { if (ok) back(fallback); }); return; }
  if (navStack.length > 1) history.back();
  else navigate(fallback, { replace: true });
}
// 返回按钮写真的会回到的那一页：有上一页时 back() 是后退，从「商店」点「管理商店」、从首页的同步标签进来的，回到的不是「设置」。
// 子页面的名字和设置首页那一行一样（「多设备同步」「备份与恢复」）
const SUB_TITLE = { stores: 'set.stores', categories: 'set.categories', sync: 'set.sync', data: 'set.data', goals: 'log.goals' };
function pageTitle(r) {
  if (r.name === 'lists') return t('nav.lists');
  if (r.name === 'stores') return t('nav.stores');
  if (r.name === 'search') return t('nav.search');
  if (r.name === 'recipes') return t('nav.recipes');
  if (r.name === 'plan') return t('nav.plan');
  if (r.name === 'recipe') { const rc = liveRecipe(S(), r.id); return rc ? recipeName(rc, t) : null; }
  if (r.name === 'recipeEdit') return t(r.sub === 'new' ? 'rcp.newTitle' : 'rcp.editTitle');
  if (r.name === 'settings') return t(r.sub ? SUB_TITLE[r.sub] : 'nav.settings');
  if (r.name === 'deleted') return t('deleted.title');
  if (r.name === 'list') { const l = liveList(S(), r.id); return l ? listName(l, t) : null; }
  if (r.name === 'store') { if (r.id === 'none') return t('store.none'); const st = own(S().data.stores, r.id); return st && !st.deleted ? st.name : null; }
  return null;
}
const backLabel = (fallback) => (navStack.length > 1 && pageTitle(parseRoute(navStack[navStack.length - 2]))) || fallback;
// 地址变了（点链接、后退前进）：hashchange 和 popstate 都听（WebKit 后退时有时只先来 popstate），同一个地址只处理一次
function onUrlChange() {
  const target = location.hash || '#/';
  if (target === currentHash) return;
  // 浏览器自己的后退 / 前进（Safari 标签页里边缘右滑、Mac 上 ⌘[）：地址已经变了，先改回原地址，问过再走（照 babble）。
  // App 里的链接、按钮在这之前就问过了（navigate、back、下面的 click）
  if (guarded()) {
    const here = currentHash || '#/';
    try { history.replaceState(history.state, '', here); } catch (e) { /* 换不成也照样问 */ }
    // 放弃了：把这一格换回它本来的地址（不能 location.hash = target：那是再推一格，历史变成「食谱、编辑、食谱」，
    // 在食谱页上点「‹ 食谱」后退又回到编辑页）。babble 的同一处也该这样改
    confirmLeave().then(ok => {
      if (!ok) return;
      try { history.replaceState(history.state, '', target); } catch (e) { location.hash = target; }
      onUrlChange();
    });
    return;
  }
  if (currentHash) rememberScroll();
  currentHash = target;
  track(target);
  render();
}
window.addEventListener('hashchange', onUrlChange);
window.addEventListener('popstate', onUrlChange);
// 有没保存的修改时点 App 里的链接（底栏、侧栏、双栏左栏的一行）：在浏览器换地址之前拦下来先问，历史记录不乱；面板里的链接不管
document.addEventListener('click', e => {
  if (!guarded() || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target && e.target.closest ? e.target.closest('a[href^="#"]') : null;
  if (!a || a.closest('dialog')) return;
  e.preventDefault();
  e.stopPropagation();
  confirmLeave().then(ok => { if (ok) navigate(a.getAttribute('href')); });
}, true);
window.addEventListener('beforeunload', e => { if (guarded()) { e.preventDefault(); e.returnValue = ''; } });

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

// ---------- 同步 ----------
// 什么时候跑（照 babble）：启动时；本机改了数据 2 秒后（连着改只算最后一次）；切回 App（离上次超过 5 秒）；切到后台时有没传的修改就马上传
// （先直接上传，不先拉取，请求体小于 60 KB 时用 keepalive：页面随时可能被系统挂起）；联网时；开着的时候每分钟一次。
// 本机数据读不出来（恢复页）时一律不同步：getConfig 返回 null，残缺的数据不会传上去。请求太多（rate）时在 GitHub 说的时刻之前不自动同步
let lastSyncTry = 0;
const deviceName = () => (typeof L().device === 'string' && L().device.trim()) || platformDevice();
const syncer = createSync({
  getState: S,
  applyRemote: (merged, info) => state.applyRemote(merged, info),
  getConfig: () => (state.storageIssue() ? null : L().sync),
  // 数据没存进本机（空间满）时 state.saveLocal 不写云端版本号：下次启动完整拉取、合并，不会被 304 / 同一个 sha 当成「没变化」
  saveConfig: (cfg) => { if (L().sync === cfg) state.saveLocal(); syncChanged(); },
  editVersion: state.editVersion,
  device: deviceName,
  onStatus: () => syncChanged(),
  // 成品图（第 12 步）：本机的图片库；后台下载好一张，页面上还空着的那张换成图（ui/photo.js 听 'photo'）
  blobs: blobStore,
  onBlob: (sha) => emit('photo', sha),
});
function syncStatus() {
  const c = L().sync, b = syncer.status();
  return { on: !!c, running: !!b.running, repo: c ? c.repo : null, at: (c && c.at) || null, err: (c && c.err) || null,
    offline: !!(c && c.offline), dirty: !!(c && c.dirty), tokenExp: (c && c.tokenExp) || null,
    uploading: !!b.uploading, downloading: !!b.downloading, pendingUp: b.pendingUp || 0, pendingDown: b.pendingDown || 0, blobErr: b.blobErr || null };
}
function renderSyncBadges() {
  const st = syncStatus(), lang = getLang();
  for (const el of document.querySelectorAll('.sync-badge')) el.replaceWith(syncBadge(st, lang, { link: el.tagName === 'A' }));
}
function syncChanged() { renderSyncBadges(); emit('sync', syncStatus()); }
const syncApi = {
  now(opts) {
    if (state.storageIssue()) return Promise.resolve({ ok: false, skipped: true });
    lastSyncTry = Date.now();
    const p = syncer.syncNow(opts);
    syncChanged();
    return p.finally(syncChanged);
  },
  connect({ repo, token, tokenExp = null }) {
    state.setLocal({ sync: { repo, token, sha: null, etag: null, dirty: true, at: null, err: null, offline: false, tokenExp: tokenExp || null } });
    syncChanged();
    return syncApi.now();
  },
  stop() { syncSoon.cancel(); state.setLocal({ sync: null }); syncChanged(); },
  checkRepo: (repo, token) => syncer.checkRepo(repo, token),
  status: syncStatus,
};
/** 自动同步（不是用户点的）：没开、数据有问题、GitHub 说请求太多还没到再试的时刻都不跑；ok() 是另外的条件 */
function autoSync(ok = () => true, opts = {}) {
  const c = L().sync;
  if (!c || state.storageIssue() || !ok()) return;
  if (c.err && c.err.code === 'rate' && Number(c.err.vars && c.err.vars.until) > Date.now()) return;
  syncApi.now(opts);
}
const syncSoon = debounce(() => autoSync(), 2000);
const syncIfStale = () => autoSync(() => Date.now() - lastSyncTry > 5000);

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
  // 只读云端：数据有问题时正常同步是停着的（getConfig 返回 null），不能让空白或残缺的数据传上去；这里另开一个只读的
  recoveryCloud: () => createSync({ getConfig: () => L().sync, getState: S, applyRemote() {}, saveConfig() {}, editVersion: () => 0 }).readRemote(),
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

  navigate, back, backLabel, replaceHash, refresh: () => refresh(), layout,
  t, lang: getLang,
  setLang(l) {
    const next = LANGS.includes(l) ? l : 'zh-Hans';
    state.setLocal({ lang: next });
    if (next === getLang()) return;
    setLang(next); refresh();
  },
  setTheme(th) { state.setLocal({ theme: th }); applyTheme(); },
  theme: () => document.documentElement.dataset.theme || 'light',
  toast, sheet, confirm: confirmDialog,
  guard: () => {},              // 每个页面拿到的是自己的版本（见 viewCtx）
  on, onChange: (fn) => on('change', fn),
  build: BUILD,
  updateReady: () => updateReady,
  sync: syncApi,
  syncBadge: (opts) => syncBadge(syncStatus(), getLang(), opts),
  photos: {
    // 存一张（编辑页刚压缩好的）：顺手请浏览器把存储标成持久的——图片比文字占地方，空间紧张时最先被清的就是不持久的网站数据
    put: (blob) => { askPersist(); return blobStore.putBlob(blob); },
    local: (sha) => blobStore.getBlob(sha).then(r => (r && r.blob) || null, () => null),
    fetch: (sha) => (L().sync && !state.storageIssue() ? syncer.getBlob(sha) : Promise.resolve(null)),
    canFetch: () => !!L().sync && !state.storageIssue(),
    discard: (sha) => blobStore.deleteBlob(sha).catch(() => false),
    usage: () => blobStore.usage().catch(() => null),
  },
};

// ---------- 外壳 ----------
function renderShell(r) {
  document.title = t('common.appName');
  $('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', t('common.appName'));
  $('link[rel="manifest"]')?.setAttribute('href', getLang() === 'zh-Hant-TW' ? 'manifest.zh-Hant-TW.webmanifest' : 'manifest.webmanifest');   // 添加到主屏幕时的语言跟着界面
  document.body.dataset.route = r.name;
  document.body.dataset.layout = layout();
  document.body.dataset.tabs = TOP_LEVEL(r) ? '1' : '0';
  // 清单页算在「清单」下面，一家店算在「商店」下面，一道食谱、编辑食谱算在「食谱」下面，最近删除算在「设置」下面
  const cur = r.name === 'list' ? 'lists' : r.name === 'store' ? 'stores' : r.name === 'recipe' || r.name === 'recipeEdit' ? 'recipes'
    : r.name === 'deleted' ? 'settings' : r.name;
  const item = (id, href, ic, label, onclick = null) => h('a.nav-item' + (cur === id ? '.on' : ''), { href, onclick, 'aria-current': cur === id ? 'page' : null }, ic, h('span', null, label));
  const tab = (id, href, ic, label) => h('a.tab' + (cur === id ? '.on' : ''), { href, 'aria-current': cur === id ? 'page' : null }, ic, h('span', null, label));
  $('#side').replaceChildren(
    h('div.brand', null, h('img', { src: 'icons/icon-180.png', alt: '', width: 32, height: 32, onerror: e => { e.target.style.visibility = 'hidden'; } }), h('b', null, t('common.appName'))),
    // 搜索在点按里就换页（search.searchLink）：iPad 上搜索框的键盘才弹得出来；已经在搜索页上就只把焦点给搜索框，搜索词不清掉
    h('nav', { 'aria-label': t('nav.label') }, item('lists', '#/', icon('list'), t('nav.lists')), item('stores', '#/stores', icon('store'), t('nav.stores')),
      item('recipes', '#/recipes', icon('recipe'), t('nav.recipes')), item('plan', '#/calendar', icon('calendar'), t('nav.plan')),
      item('search', '#/search', icon('search'), t('nav.search'), search.searchLink(ctx))),
    h('div.side-foot', null, h('nav', { 'aria-label': t('nav.settings') }, item('settings', '#/settings', icon('gear'), t('nav.settings'))), ctx.syncBadge()),
  );
  const tabs = $('#tabs');
  tabs.setAttribute('aria-label', t('nav.label'));
  // 底栏：清单 · 商店 · 食谱 · 日历 · 设置
  tabs.replaceChildren(tab('lists', '#/', icon('list'), t('nav.lists')), tab('stores', '#/stores', icon('store'), t('nav.stores')),
    tab('recipes', '#/recipes', icon('recipe'), t('nav.recipes')), tab('plan', '#/calendar', icon('calendar'), t('nav.plan')), tab('settings', '#/settings', icon('gear'), t('nav.settings')));
}

// ---------- 页面挂载（一栏，或者双栏的左右两栏；照 babble） ----------
const mounted = {};           // slot（'main' | 'list' | 'detail'）→ { slot, name, key, params, el, handle, offs, guard }
const scroller = (el) => (layout() === 'phone' ? document.scrollingElement : el);
// 后退回来时的滚动位置：每一栏各记各的（键是 mount 的 key：栏 | 页面 | 地址）。双栏时左栏的首页、右栏的清单页滚到哪儿不一样，
// 只记一个数的话会把右栏的位置套到左栏上（右栏只是提示时又把左栏的丢了）；换了栏、换了页面的不套
function rememberScroll() {
  for (const m of Object.values(mounted)) scrollMemory.set(m.key, layout() === 'phone' ? window.scrollY || 0 : m.el.scrollTop || 0);
}

function viewCtx(m) {
  const c = Object.create(ctx);
  c.on = (ev, fn) => { const off = on(ev, fn); m.offs.push(off); return off; };
  c.onChange = (fn) => c.on('change', fn);
  c.guard = (fn, onDiscard) => { m.guard = typeof fn === 'function' ? fn : null; m.guardDiscard = m.guard && typeof onDiscard === 'function' ? onDiscard : null; };
  c.params = m.params;
  return c;
}
function runView(m) {
  m.offs = []; m.handle = null; m.guard = null; m.guardDiscard = null;
  // 双栏右边还没选的时候：App 图标 + 一句提示（和 Babble 一样；左栏是首页就说选清单，是「商店」就说选商店，是「食谱」就说选食谱）。图标是装饰，读屏只念那句话
  if (m.name === 'empty') {
    const pick = m.params.name === 'stores' ? 'store.pick' : m.params.name === 'recipes' ? 'rcp.pick' : 'list.pick';
    m.el.append(h('div.detail-empty', null, h('img', { src: 'icons/icon.svg', alt: '', width: 96, height: 96, onerror: e => e.target.remove() }), h('p', null, t(pick))));
    return;
  }
  try {
    const ret = VIEWS[m.name].render(m.el, m.params, viewCtx(m));
    m.handle = typeof ret === 'function' ? { cleanup: ret } : ret && typeof ret === 'object' ? ret : null;
  } catch (e) { safeMode(m.el, e); }
}
function cleanupView(m) {
  for (const off of m.offs || []) off();
  m.offs = []; m.guard = null; m.guardDiscard = null;
  try { if (m.handle && m.handle.cleanup) m.handle.cleanup(); } catch (e) { console.error(e); }
  m.handle = null;
}
function unmount(slot) {
  const m = mounted[slot];
  if (!m) return;
  cleanupView(m);
  m.el.remove();
  delete mounted[slot];
}
const keyOf = p => p.slot + '|' + p.name + '|' + p.params.hash;

/** 换页：同一栏、同一个地址不重画；换了就清理旧页面、在同一个容器里画新页面，后退回来时恢复滚动位置 */
function mount(p, main) {
  const old = mounted[p.slot];
  const key = keyOf(p);
  if (old && old.key === key) return false;
  // 双栏左边的首页 / 「商店」：右边换了一张清单（左栏跟着重画高亮）不跳回顶部
  const keepScroll = old && old.name === p.name && p.slot === 'list' ? old.el.scrollTop : null;
  if (old) cleanupView(old);
  const el = old ? old.el : h('section.pane');
  el.className = `pane pane-${p.slot} view view-${p.name}`;
  el.replaceChildren();
  const m = { slot: p.slot, name: p.name, key, params: p.params, el, handle: null, offs: [], guard: null };
  mounted[p.slot] = m;
  if (!old) main.append(el);
  runView(m);
  const saved = lastWasBack && scrollMemory.get(key);
  const restore = keepScroll != null ? keepScroll : saved != null && saved !== false ? saved : null;
  if (layout() === 'phone') window.scrollTo(0, restore || 0); else el.scrollTop = restore || 0;
  if (restore == null && m.handle && m.handle.land) { try { m.handle.land(); } catch (e) { console.error(e); } }
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
/**
 * 换布局（转 iPad、拉窗口）时同一个页面要换栏（一栏的清单页 ↔ 双栏右边的清单页）：自己管更新（有 onChange）的页面整个搬过去，
 * 快速添加、搜索框里打了一半的字、焦点、勾到一半的都不丢；params 是同一个对象，pane / selected 原地改
 */
function migrate(plan) {
  for (const p of plan) {
    if (mounted[p.slot] && mounted[p.slot].name === p.name) continue;
    const from = Object.keys(mounted).find(s => s !== p.slot && mounted[s].name === p.name && mounted[s].params.hash === p.params.hash
      && !plan.some(q => q.slot === s && q.name === mounted[s].name));
    const m = from && mounted[from];
    if (!m || !(m.handle && m.handle.onChange)) continue;
    if (mounted[p.slot]) unmount(p.slot);
    delete mounted[from];
    Object.assign(m.params, { pane: p.params.pane, selected: p.params.selected });
    Object.assign(m, { slot: p.slot, key: keyOf(p) });
    m.el.className = `pane pane-${p.slot} view view-${p.name}`;
    mounted[p.slot] = m;
  }
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
  const plan = planPanes(r, layout());
  renderShell(r);
  const main = $('#main');
  main.dataset.panes = String(plan.length);
  migrate(plan);
  for (const slot of Object.keys(mounted)) if (!plan.some(p => p.slot === slot && mounted[slot].name === p.name)) unmount(slot);
  let changed = false;
  for (const p of plan) changed = mount(p, main) || changed;
  // 栏的顺序：左栏在前（只在顺序不对时移动：移动元素会丢滚动位置）
  plan.forEach((p, i) => { const el = mounted[p.slot].el; if (main.children[i] !== el) main.insertBefore(el, main.children[i] || null); });
  if (changed && !document.querySelector('dialog[open]')) {
    // 换页后读屏、键盘从新页面开始：双栏时是右栏，右栏只是提示（#/、#/stores）时是左栏
    const to = mounted.detail && mounted.detail.name !== 'empty' ? mounted.detail : mounted.list || mounted.main;
    if (to && !to.el.contains(document.activeElement)) { to.el.tabIndex = -1; to.el.focus({ preventScroll: true }); }
  }
}
/** 整页重画（换语言之类）：保留各栏容器和滚动位置，焦点回到同一个选项；不卸载页面再挂载，免得先跳到页首 */
function refresh() {
  const active = document.activeElement, fid = active && active.dataset ? active.dataset.fid : null;
  const focused = Object.values(mounted).find(m => m.el.contains(active));
  render();
  for (const m of Object.values(mounted)) rerender(m);
  const el = fid ? $('#main')?.querySelector(`[data-fid="${CSS.escape(fid)}"]`) : null;
  if (el) el.focus({ preventScroll: true });
  else if (focused && mounted[focused.slot] === focused && !focused.el.contains(document.activeElement)) {
    focused.el.tabIndex = -1; focused.el.focus({ preventScroll: true });
  }
}

// 数据变化 → 提示撤销 / 存储满 → 安排同步 → 页面更新
let rerenderQueued = false;
state.subscribe((st, info) => {
  const wasBlocked = !!recoveryRoot;
  if (recoveryScreen()) return;
  // 同步拉下来的（remote）不再排一次：不然每一轮都会接着再来一轮。从备份恢复、修好本机数据（merge）马上传：合并的结果要尽快到别的设备
  if (info.source === 'local' || info.source === 'undo' || info.source === 'merge' || (info.source === 'storage' && info.changed)) syncSoon();
  if (info.source === 'merge') syncSoon.flush();
  if (info.source === 'local') askPersist();
  if (wasBlocked) { refresh(); return; }       // 本页或别的标签页修好数据后，重新挂载页面
  if (info.saved === false) toast(t('common.storageFull'), { ms: 10000 });
  else if (info.undoLabel) toast(info.undoLabel, { ms: 10000, action: { label: t('common.undo'), run: () => ctx.undo() } });
  emit('change', info);
  if (rerenderQueued) return;
  rerenderQueued = true;
  queueMicrotask(() => {
    rerenderQueued = false;
    if (recoveryScreen()) return;
    renderSyncBadges();                          // 待同步 / 已同步跟着数据变
    for (const m of Object.values(mounted)) {
      if (m.handle && typeof m.handle.onChange === 'function') { try { m.handle.onChange(info); } catch (e) { console.error(e); } }
      else if (m.name !== 'empty') rerender(m);
    }
  });
});

// ---------- 出错时的安全模式：页面画不出来也能把数据下载下来、停止同步 ----------
function safeMode(el, e) {
  console.error(e);
  el.replaceChildren(h('div.page', null, h('section.card.safe-mode', null,
    h('p.err', null, t('common.renderError'), ' ', String((e && e.message) || e)),
    h('p.muted', null, t('common.safeMode')),
    h('div.row', null,
      h('button.btn', { type: 'button', onclick: () => download('picknest-data.json', JSON.stringify({ app: 'picknest', v: 1, kind: 'raw', exportedAt: new Date().toISOString(), state: S() }), 'application/json') }, t('common.exportRaw')),
      L().sync ? h('button.btn', { type: 'button', onclick: () => { syncApi.stop(); refresh(); } }, t('sync.stop')) : null))));
}

// ---------- 本机数据别被系统清掉 ----------
// 请浏览器把这个网站的存储标成「持久的」：空间紧张时 WebKit 会清掉不是持久的网站数据（没开同步的话清单就没了）。
// 主屏幕上的网页 App 一般直接答应；有的浏览器只在用户操作时才给，所以在第一次改数据时（点按里）要，一次打开只要一次
let persistAsked = false;
function askPersist() {
  if (persistAsked) return;
  persistAsked = true;
  try { const p = globalThis.navigator?.storage?.persist?.(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* 不支持就算了 */ }
}

// ---------- 新版本 ----------
// 已经装好的 App 里 navigator.serviceWorker.register() 不检查更新（注册没变就直接返回），只有冷启动（导航）时浏览器才去看；
// 主屏幕上的 App 常常几天都只是切回来，不是重新打开。所以启动后、切回来时（最多半小时一次）自己 update()：
// 新版在后台下载、校验好（sw.js），等下次关掉再打开时启用（不 skipWaiting），下载好了在「设置 → 关于」里说一声
const UPDATE_EVERY = 30 * 60 * 1000;
let updateReady = false, lastUpdateCheck = 0, watchedReg = null;
function checkUpdate() {
  const sw = globalThis.navigator?.serviceWorker;
  if (!sw || !sw.controller || typeof sw.getRegistration !== 'function' || Date.now() - lastUpdateCheck < UPDATE_EVERY) return;
  lastUpdateCheck = Date.now();
  sw.getRegistration().then(reg => {
    if (!reg) return;
    watchUpdate(reg);
    return reg.update();
  }).catch(() => { /* 离线、GitHub Pages 出错：下次再看 */ });
}
function watchUpdate(reg) {
  const mark = () => { if (reg.waiting && !updateReady) { updateReady = true; emit('update', true); } };
  // update() 在新的 worker 开始安装时就返回了，装好（校验完所有文件）要等 statechange 到 installed
  const follow = w => { if (w) w.addEventListener('statechange', () => { if (w.state === 'installed') mark(); }); };
  if (watchedReg !== reg) {
    watchedReg = reg;
    reg.addEventListener?.('updatefound', () => follow(reg.installing));
    // 冷启动时浏览器自己（导航）也会去看新版：App 载入时它可能已经在装了，updatefound 早就过去了，接着等它装好
    follow(reg.installing);
  }
  mark();            // 每次看都再对一下 waiting：万一上面哪一步错过了，下次切回来也补得上
}

// ---------- 系统事件 ----------
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { applyTheme(); syncIfStale(); checkUpdate(); }
  else {
    // 先把页面上点过、还没写进数据的写进去：勾选要停 0.3 秒才改数据，勾完最后一样马上锁屏的话，这一下既没存进本机也传不上去
    for (const m of Object.values(mounted)) { try { m.handle?.flush?.(); } catch (e) { console.error(e); } }
    // 切走前把改动传上去：不等防抖，先直接上传（云端变过照样会合并），能用 keepalive 就用
    if (L().sync && L().sync.dirty) { syncSoon.cancel(); autoSync(undefined, { pushFirst: true, keepalive: true }); }
  }
});
window.addEventListener('online', () => autoSync());
setInterval(() => { if (document.visibilityState === 'visible') syncIfStale(); }, 60000);
window.addEventListener('storage', e => { if (e.key === state.KEY || e.key === state.LKEY || e.key?.startsWith(state.PENDING_PREFIX)) state.reload(); });   // 别的标签页改了数据
prefersDark.addEventListener('change', () => applyTheme());
for (const mq of [mqSide, mqTwo]) mq.addEventListener('change', () => { render(); emit('layout', layout()); });

// ---------- 启动 ----------
setLang(L().lang && LANGS.includes(L().lang) ? L().lang : guessLang());
currentHash = location.hash || '#/';
track(currentHash);
render();
autoSync();
checkUpdate();
window.__picknest = { state, ctx, syncer, mounted, get current() { return mounted.detail || mounted.main || null; }, get S() { return S(); } };   // 方便在浏览器控制台里查看；boot.js 的看门狗也靠它判断启动好了
