// 清单页（#/l/<listId>）：页头（图标、名字、还要买几样、按分类 / 按商店）、最上面的快速添加（吸顶）、要买的东西分组、
// 「以后再说」（一般清单）、「已买」（可以折起来，「清除已买」能撤销）。清单不在了（地址错了、删掉了）→ 回首页并提示。
// 自己管更新（返回 onChange）：数据变了只重画页头和列表，输入框和联想原样留着，打字不会被打断。
// 规则都在 core：解析和添加（items.js、parse.js）、联想（memory.js）、分组排序（group.js）、清单操作（lists.js）。
// 点一行 = 勾掉 / 取消：行和勾选的节奏（先在原地打勾，停一下再挪）在 ui/checklist.js，商店页也用它。
import { h, icon } from '../ui/dom.js';
import { t } from '../i18n.js';
import { listName, listIcon, categoryName, needCounts } from '../core/store.js';
import { liveList, addFromInput, addItem, clearDone, countItems, storeExists } from '../core/items.js';
import { parseQuickAdd } from '../core/parse.js';
import { suggestions } from '../core/memory.js';
import { groupNeed, collatorFor, listView } from '../core/group.js';
import { setArchived, deleteList } from '../core/lists.js';
import { checklist, foldSec } from '../ui/checklist.js';
import { listSheet } from '../ui/listEditor.js';
import { composing } from '../ui/form.js';

export function render(main, params, ctx) {
  const listId = params.id;
  const list = () => liveList(ctx.state, listId);
  let leaving = false;
  // 清单不在了：等这次挂载做完再换页（挂载中途换页会把首页画进同一个容器）
  function gone() {
    if (leaving) return;
    leaving = true;
    queueMicrotask(() => { ctx.navigate('/', { replace: true }); ctx.toast(t('list.gone')); });
  }
  if (!list()) { gone(); return undefined; }

  const cl = checklist(ctx, main);
  const keepFocus = cl.keepFocus;
  let sugs = [], active = -1;
  const view = () => listView(ctx.local, listId);
  const setView = (patch) => ctx.setLocal({ view: { ...(ctx.local.view || {}), [listId]: { ...view(), ...patch } } });
  const storeName = (id) => (storeExists(ctx.state, id) ? ctx.state.data.stores[id].name : '');

  // ---------- 顶栏、页头 ----------
  // 顶栏和快速添加都吸顶：长清单滚下去也能返回、打开 ⋯
  const navbar = h('header.navbar.lp-nav', null,
    h('button.back', { type: 'button', onclick: () => ctx.back('/') }, icon('back'), t('nav.lists')),     // 宽屏有侧栏，CSS 藏起来
    h('button.icon-btn', { type: 'button', 'aria-label': t('common.more'), title: t('common.more'), onclick: () => menu() }, icon('more')));
  const segBtns = ['category', 'store'].map(g => h('button', { type: 'button', dataset: { g, fid: 'lp-g-' + g },
    onclick: () => { if (view().groupBy !== g) { setView({ groupBy: g }); paintSeg(); keepFocus(drawBody); } } }, t(g === 'store' ? 'list.byStore' : 'list.byCat')));
  const seg = h('div.seg.lp-seg', { role: 'group', 'aria-label': t('list.groupBy') }, segBtns);
  function paintSeg() { const g = view().groupBy; for (const b of segBtns) { const on = b.dataset.g === g; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); } }
  const head = h('div.page.lp-head');
  function drawHead() {
    const l = list();
    const n = needCounts(ctx.state).get(listId) || 0;         // 和首页同一个数法
    paintSeg();
    head.replaceChildren(...[
      // 标题能接焦点（tabindex -1）：按过的按钮重画后没了（取消归档、删掉了的一样），焦点给它（ui/checklist.js 的 keepFocus）
      h('div.lp-title', null, h('span.lp-icon', { 'aria-hidden': 'true' }, listIcon(l)), h('h1.lp-name', { tabindex: -1, dataset: { fid: 'lp-title' } }, listName(l, t))),
      h('div.lp-sub', null, h('span.lp-count', null, t('list.needN', { n })), seg),
      l.archived ? h('div.lp-banner', { role: 'status' }, h('span', null, t('list.archivedBanner')),
        h('button.btn.small', { type: 'button', dataset: { fid: 'lp-unarchive' }, onclick: () => ctx.mutate(s => setArchived(s, listId, false, Date.now()), { undoLabel: t('list.unarchived', { name: listName(l, t) }) }) },
          t('list.unarchive'))) : null,
    ].filter(Boolean));
  }

  // ---------- 快速添加 + 联想 ----------
  // 一般清单光写数字不算数量（「iPhone 15」）：占位的例子带单位
  const input = h('input.add-input', { type: 'text', role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-controls': 'lp-sugs',
    'aria-label': t('list.addLabel'), placeholder: t(list().kind === 'general' ? 'list.addPhGeneral' : 'list.addPh'),
    autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false',
    enterkeyhint: 'enter', maxlength: 200, dataset: { fid: 'lp-add' },
    oninput: () => updateSugs(), onkeydown: (e) => onKey(e), onblur: () => closeSugs() });
  // 点联想时输入框不能先失去焦点（不然列表先关掉、点不到；手机键盘也会收起来）
  const keep = (e) => e.preventDefault();
  const sugBox = h('ul.sugs', { id: 'lp-sugs', role: 'listbox', 'aria-label': t('list.sugs'), hidden: true, onpointerdown: keep, onmousedown: keep });
  const addBar = h('div.page.add-bar', null, h('div.add-wrap', null, icon('plus', { cls: 'add-ic' }), input, sugBox));

  function onKey(e) {
    if (composing(e)) return;          // 输入法还在选字：回车是选字，不是添加
    if (e.key === 'ArrowDown' && sugs.length) { e.preventDefault(); setActive(Math.min(sugs.length - 1, active + 1)); }
    else if (e.key === 'ArrowUp' && sugs.length) { e.preventDefault(); setActive(Math.max(-1, active - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (active >= 0 && sugs[active]) pick(sugs[active]); else submit(); }
    else if (e.key === 'Escape') {
      if (!sugBox.hidden) { e.preventDefault(); closeSugs(); }
      else if (input.value) { e.preventDefault(); input.value = ''; }
    }
  }
  function submit() {
    const text = input.value;
    if (!text.trim()) return;
    after(ctx.mutate(s => addFromInput(s, listId, text, Date.now())));
  }
  // 点联想：加以前买过的那个名字；输入里写了数量（「鸡蛋 12」时点「鸡蛋」）照样用上
  function pick(sg) {
    const l = list();
    if (!l) return;
    const p = parseQuickAdd(input.value, { kind: l.kind });
    after(ctx.mutate(s => addItem(s, listId, { name: sg.name, qty: p.qty, unit: p.unit }, Date.now())));
    input.focus();
  }
  function after(r) {
    if (!r || r.outcome === 'empty' || r.outcome === 'nolist') return;
    input.value = '';
    closeSugs();
    cl.flash(r.id);
    // 已经在清单上的：数据没变、不会重画，现在就闪；新加的、恢复的：重画后（onChange → drawBody）在新位置闪
    if (r.outcome === 'exists') { ctx.toast(t('item.exists', { name: r.item.name })); cl.flashNow(); }
  }
  function updateSugs() {
    const l = list();
    sugs = l && input.value.trim() ? suggestions(ctx.state, listId, parseQuickAdd(input.value, { kind: l.kind }).name, { limit: 8 }) : [];
    active = -1;
    paintSugs();
  }
  function paintSugs() {
    const open = sugs.length > 0;
    sugBox.hidden = !open;
    input.setAttribute('aria-expanded', String(open));
    if (active >= 0) input.setAttribute('aria-activedescendant', 'lp-sug-' + active); else input.removeAttribute('aria-activedescendant');
    sugBox.replaceChildren(...sugs.map((sg, i) => h('li.sug' + (i === active ? '.on' : ''), { id: 'lp-sug-' + i, role: 'option', 'aria-selected': String(i === active),
      onclick: () => pick(sg) },
    h('span.sug-name', null, sg.name),
    sg.storeId && storeName(sg.storeId) ? h('span.sug-store', null, storeName(sg.storeId)) : null,
    sg.inList ? h('span.sug-in', null, t('list.sugInList')) : null)));
    fitSugs();
  }
  // iPhone 弹出键盘时页面（layout viewport）不变矮，变矮的是看得见的部分（visualViewport）：联想最多到键盘上面，多的在里面滚
  function fitSugs() {
    const vv = globalThis.visualViewport;
    if (sugBox.hidden || !vv || !sugBox.getBoundingClientRect || !sugBox.style.setProperty) return;
    const room = vv.offsetTop + vv.height - sugBox.getBoundingClientRect().top - 8;
    sugBox.style.setProperty('--sugs-room', Math.max(120, Math.floor(room)) + 'px');
  }
  function setActive(i) { active = i; paintSugs(); }
  function closeSugs() { if (!sugs.length && sugBox.hidden) return; sugs = []; active = -1; paintSugs(); }

  // ---------- 列表 ----------
  const body = h('div.page.lp-body');
  // 商店小标签：只标和清单默认商店不一样的（每行都写「Whole Foods」等于没写，例外的「H Mart」反而看不出来）。
  // 按商店分组时「要买」的组名就是商店，不用标（chip 是 false）；「以后再说」「已买」不按商店分，照样标
  function storeChip(it, chip, defaultStore) {
    const name = chip && it.storeId && it.storeId !== defaultStore ? storeName(it.storeId) : '';
    return name ? h('span.store-chip', null, name) : null;
  }
  const items = (arr, chip) => { const ds = list().defaultStoreId; return h('ul.group.items', null, arr.map(it => cl.row(it, storeChip(it, chip, ds)))); };
  function groupLabel(id, groupBy) {
    if (!id) return t(groupBy === 'store' ? 'list.noStoreGroup' : 'list.uncategorized');
    return groupBy === 'store' ? storeName(id) : categoryName(ctx.state.data.categories[id], t);
  }
  const fold = (key, title, open, toggle, arr, extra = null) => foldSec(key, title, open, () => { toggle(); keepFocus(drawBody); }, () => items(arr, true), extra);
  function drawBody() {
    const l = list(), v = view();
    const { groups, later, done } = groupNeed(ctx.state, listId, v.groupBy, collatorFor(ctx.lang()));
    cl.draw(() => {
      const kids = [];
      if (!groups.length) {
        // 「买齐了」只在真的买过东西时说；只剩「以后再说」的，是还没有要买的
        kids.push(done.length ? h('p.empty.lp-empty', null, t('list.allDone'))
          : later.length ? h('p.empty.lp-empty', null, t('list.empty'))
          : h('div.empty.lp-empty', null, h('p', null, h('b', null, t('list.empty'))), h('p.small', null, t(l.kind === 'general' ? 'list.emptyHintGeneral' : 'list.emptyHint'))));
      }
      // 只有一组而且是「未分类 / 未指定」时不写组名（一般清单常常都没分类，写一个「未分类」只是噪音）
      const bare = groups.length === 1 && groups[0].id === null;
      for (const g of groups) kids.push(h('section.grp', null, bare ? null : h('h2.group-h', null, groupLabel(g.id, v.groupBy)), items(g.items, v.groupBy === 'category')));
      if (later.length) kids.push(fold('later', t('list.laterN', { n: later.length }), v.showLater, () => setView({ showLater: !view().showLater }), later));
      if (done.length) {
        kids.push(fold('done', t('list.doneN', { n: done.length }), v.showDone, () => setView({ showDone: !view().showDone }), done,
          h('button.link-btn.clear-done', { type: 'button', dataset: { fid: 'lp-clear' }, onclick: () => clear() }, t('list.clearDone'))));
      }
      body.replaceChildren(...kids);
    });
  }

  // ---------- 清除已买、⋯ 菜单 ----------
  const doneCount = () => countItems(ctx.state, listId, 'done');
  function clear() {
    const n = doneCount();
    if (n) ctx.mutate(s => clearDone(s, listId, Date.now()), { undoLabel: t('list.cleared', { n }) });
  }
  function menu() {
    const l = list();
    if (!l) return;
    ctx.sheet((api) => {
      const item = (label, fn) => h('button.group-row.menu-row', { type: 'button', onclick: () => { api.close(); fn(); } }, h('span', null, label));
      return h('div.group.menu', null, item(t('list.editTitle'), () => editList()), doneCount() ? item(t('list.clearDone'), () => clear()) : null);
    }, { title: listName(l, t), cls: 'menu-sheet' });
  }
  function editList() {
    const l = list();
    if (!l) return;
    const name = listName(l, t);
    listSheet(ctx, {
      list: l,
      onArchive: () => {
        if (l.archived) { ctx.mutate(s => setArchived(s, listId, false, Date.now()), { undoLabel: t('list.unarchived', { name }) }); return; }
        // 归档 = 收起来：回首页（它在最下面「已归档」里），10 秒内可以撤销
        leaving = true;
        ctx.back('/');
        ctx.mutate(s => setArchived(s, listId, true, Date.now()), { undoLabel: t('list.archived', { name }) });
      },
      onDelete: async () => {
        const n = countItems(ctx.state, listId);
        if (!(await ctx.confirm({ title: t('list.deleteQ', { name }), message: t('list.deleteMsg', { n }), confirmLabel: t('common.delete'), danger: true }))) return;
        leaving = true;                 // 先离开再删：不在这页画「不在了」
        ctx.back('/');
        ctx.mutate(s => deleteList(s, listId, Date.now()), { undoLabel: t('list.deleted', { name }) });
      },
    });
  }

  // 吸顶的快速添加下面画一条线：滚下去以后行从它下面经过，没有线看着像被切掉一截。手机整页滚、宽屏内容栏滚，capture 两种都收得到
  function onScroll() {
    if (!head.getBoundingClientRect) return;
    addBar.classList.toggle('stuck', head.getBoundingClientRect().bottom < addBar.getBoundingClientRect().top - 1);
  }
  const vv = globalThis.visualViewport;
  window.addEventListener('scroll', onScroll, { passive: true, capture: true });
  if (vv) { vv.addEventListener('resize', fitSugs); vv.addEventListener('scroll', fitSugs); }

  main.append(navbar, head, addBar, body);
  drawHead();
  drawBody();

  return {
    onChange: () => {
      if (!list()) { gone(); return; }
      keepFocus(() => { drawHead(); drawBody(); });
      if (!sugBox.hidden) updateSugs();
    },
    cleanup: () => {
      window.removeEventListener('scroll', onScroll, { capture: true });
      if (vv) { vv.removeEventListener('resize', fitSugs); vv.removeEventListener('scroll', fitSugs); }
      // 离开时点过、还没挪的，马上改：点过的不能丢（清单删掉、归档了的不改）
      if (leaving) cl.drop(); else cl.flush();
    },
  };
}
