// 首页「清单」（#/）：没归档、没删除的清单，按顺序排，每张显示图标、名字、还要买几样，点了进清单页（#/l/<id>）。
// 右上角「新建清单」（面板在 ui/listEditor.js）；「编辑」切到排顺序：每行一对 ↑↓（44px，读屏念「上移『食材』」）。
// 手机上标题右边是同步状态的小标签（ctx.syncBadge，点了去设置 → 多设备同步；状态变了由 app 换掉，不用重画这一页）；
// iPad、Mac（有侧栏的两种布局）上只在侧栏「设置」下面放一个，标题旁边不再重复（换布局时听 ctx.on('layout') 重画）。
// 标题下面是搜索的入口（去 #/search，views/search.js 的 searchLink：在点按里就换页，iPhone 上搜索框的键盘才弹得出来）。
// 宽屏双栏时在左栏（params.pane === 'list'）：右栏正在看的那张清单（params.selected）高亮，右栏是搜索时入口高亮（再点它只是把焦点给右栏的搜索框）。
// 归档的清单收在最下面「已归档（N）」里，点开才显示；点进去以后在「⋯ → 编辑清单」里可以取消归档。
// 在浏览器标签页里打开时，最上面说一句这里的数据和主屏幕 / 程序坞上的不是同一份，怎么添加（tabNote / tabNoteKind：iPhone、iPad 说「分享 → 添加到主屏幕」，
// Mac 的 Safari 说「文件 → 添加到程序坞」；可以关掉）。
// 没有输入框，数据变了由 app 整页重画；↑↓ 带 data-fid，重画后焦点还在同一个按钮上、页面滚到按钮还在手指下面，可以连着按。
// 「编辑」「已归档」这种只改显示的开关就地重画（不用 ctx.refresh 重建所有页面），焦点照样放回同一个按钮。
import { h, icon, keepUnderFinger } from '../ui/dom.js';
import { t } from '../i18n.js';
import { homeLists, needCounts, listName, listIcon } from '../core/store.js';
import { archivedLists, moveList } from '../core/lists.js';
import { listSheet } from '../ui/listEditor.js';
import { searchLink } from './search.js';

/**
 * 首页最上面要不要说「这是在浏览器里打开的」→ 'ios'（iPhone、iPad：分享 → 添加到主屏幕）| 'mac'（Mac 的 Safari：文件 → 添加到程序坞）| null（不说）。
 * 先看是不是已经装好的 App（和 Babble 的诊断页一样两样都看）：navigator.standalone 是 true（主屏幕上）或 display-mode 是 standalone（程序坞上）就不说。
 * 现在 Mac 的 Safari 标签页里也有 navigator.standalone（是 false），所以不能拿「有没有 standalone」分 iPhone 和 Mac，要看 platform：
 * iPad 默认用桌面版网站，UA、platform 写的是 Mac，多点触控（maxTouchPoints > 1）的「Mac」是 iPad。
 * Mac 上只有 Safari 说（UA 里有 Version/… Safari/）：别的浏览器（Chrome、Firefox）、别的 App 里嵌的网页都没有「添加到程序坞」
 * @param {any} nav navigator @param {((q: string) => { matches: boolean }) | undefined} mm matchMedia
 */
export function tabNoteKind(nav, mm) {
  if (!nav) return null;
  let installed = nav.standalone === true;
  try { installed = installed || !!(mm && mm('(display-mode: standalone)').matches); } catch (e) { /* 不支持就只看 standalone */ }
  if (installed) return null;
  const ua = String(nav.userAgent || ''), mac = /Mac/.test(String(nav.platform || '')), touchMac = mac && Number(nav.maxTouchPoints) > 1;
  if (nav.standalone === false && (!mac || touchMac)) return 'ios';
  // 没有 standalone 的 iPad（别的 App 里的浏览器）分不出来，不说
  if (!mac || touchMac || !/Version\/[\d.]+.*Safari\//.test(ua) || /Chrome|Chromium|CriOS|Edg|Firefox|FxiOS|OPR/.test(ua)) return null;
  return 'mac';
}

// 这次打开 App 期间记住：在不在排顺序、归档的那一组开没开
const ui = { editing: false, archivedOpen: false };

export function render(main, params, ctx) {
  const href = (l) => '#/l/' + encodeURIComponent(l.id);
  const count = (n) => [
    // 数字给眼睛看；读屏念整句「还要买 3 样」
    h('span.list-count' + (n ? '' : '.zero'), { 'aria-hidden': 'true' }, String(n)),
    h('span.sr-only', null, t('list.needN', { n })),
  ];
  const sel = (l) => !!params.selected && params.selected === l.id;
  const linkRow = (l, n) => h('li', null, h('a.group-row.list-row.go' + (sel(l) ? '.sel' : ''), { href: href(l), dataset: { id: l.id }, 'aria-current': sel(l) ? 'page' : null },
    h('span.list-icon', { 'aria-hidden': 'true' }, listIcon(l)), h('span.list-name', null, listName(l, t)), count(n)));

  const searching = params.pane === 'list' && !!ctx.route && ctx.route.name === 'search';
  function draw() {
    const lists = homeLists(ctx.state), archived = archivedLists(ctx.state);
    const counts = needCounts(ctx.state);
    if (lists.length < 2) ui.editing = false;            // 一张以下没什么好排的

    // 排顺序：到头了的按钮标 aria-disabled（不用 disabled：按到头时焦点不会丢）
    const editRow = (l, i) => {
      const name = listName(l, t);
      const mv = (dir, ic, key, edge) => { const fid = `mv-${dir > 0 ? 'down' : 'up'}-${l.id}`;
        return h('button.icon-btn.mv-btn', { type: 'button', 'aria-label': t(key, { name }), 'aria-disabled': String(edge), dataset: { fid },
          onclick: () => { if (!edge) keepUnderFinger(ctx, main, fid, () => ctx.mutate(s => moveList(s, l.id, dir, Date.now()))); } }, icon(ic)); };
      return h('li.group-row.list-row.editing', { dataset: { id: l.id } },
        h('span.list-icon', { 'aria-hidden': 'true' }, listIcon(l)), h('span.list-name', null, name), count(counts.get(l.id) || 0),
        h('span.mv', null, mv(-1, 'up', 'list.moveUp', i === 0), mv(1, 'down', 'list.moveDown', i === lists.length - 1)));
    };

    const head = h('header.page-head', null,
      h('div.toolbar', null,
        // 字本身就说了状态（编辑 → 完成）：不再加 aria-pressed，不然读屏念「完成，切换按钮，已选中」
        lists.length > 1 ? h('button.tb-btn', { type: 'button', dataset: { fid: 'lists-edit' },
          onclick: () => { ui.editing = !ui.editing; redraw(); } }, t(ui.editing ? 'list.editDone' : 'list.edit')) : h('span'),
        h('button.tb-btn', { type: 'button', onclick: () => listSheet(ctx, { onCreated: id => ctx.navigate('/l/' + encodeURIComponent(id)) }) },
          icon('plus'), t('list.new'))),
      h('div.lt-row', null, h('h1.lt', null, t('nav.lists')), ctx.syncBadge && (!ctx.layout || ctx.layout() === 'phone') ? ctx.syncBadge() : null),
      h('a.search-entry' + (searching ? '.on' : ''), { href: '#/search', onclick: searchLink(ctx), 'aria-current': searching ? 'page' : null },
        icon('search'), h('span', null, t('search.ph'))));

    const archivedSec = archived.length ? h('section.arch', null,
      h('button.sec-toggle', { type: 'button', 'aria-expanded': String(ui.archivedOpen), dataset: { fid: 'lists-archived' },
        onclick: () => { ui.archivedOpen = !ui.archivedOpen; redraw(); } },
      icon('chev', { cls: 'sec-chev' }), h('span', null, t('list.archivedN', { n: archived.length }))),
      ui.archivedOpen ? h('ul.group.lists.archived', { 'aria-label': t('list.archivedN', { n: archived.length }) },
        archived.map(l => linkRow(l, counts.get(l.id) || 0))) : null) : null;

    main.append(head, h('div.page', null,
      tabNote(),
      lists.length
        ? h('ul.group.lists', { 'aria-label': t('nav.lists') }, lists.map((l, i) => (ui.editing ? editRow(l, i) : linkRow(l, counts.get(l.id) || 0))))
        : h('p.empty', null, t('list.none')),
      archivedSec));
  }
  // 在 Safari 标签页（或别的 App 里的浏览器）里打开的：和主屏幕 / 程序坞上的不是同一份数据，Safari 还会清掉一阵子没打开的网站的数据。
  // 点「知道了」以后这台设备上不再说（记在本机设置）
  function tabNote() {
    const kind = tabNoteKind(globalThis.navigator, globalThis.matchMedia);
    if (!kind || ctx.local.tabNoteOff) return null;
    return h('div.card.tab-note', { role: 'note' }, h('p.small', null, t(kind === 'mac' ? 'list.tabNoteMac' : 'list.tabNote')),
      h('button.btn.small', { type: 'button', onclick: () => {
        ctx.setLocal({ tabNoteOff: true });
        redraw();
        const title = main.querySelector('h1');
        if (title) { title.tabIndex = -1; title.focus({ preventScroll: true }); }
      } }, t('list.tabNoteOk')));
  }
  // 换布局（手机 ↔ 有侧栏）：标题旁边的同步标签要出现 / 去掉
  if (ctx.on) ctx.on('layout', () => redraw());
  function redraw() {
    const a = document.activeElement, fid = a && a.dataset ? a.dataset.fid : null;
    main.replaceChildren();
    draw();
    const el = fid ? main.querySelector(`[data-fid="${fid}"]`) : null;
    if (el) el.focus({ preventScroll: true });
  }
  draw();
}
