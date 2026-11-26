// 设置（#/settings），从上到下和 Babble 一样：语言（没有组名）、同步（「多设备同步」，右边是同步状态的小标签，进 #/settings/sync，views/sync.js）、
// 商店和分类（进 #/settings/stores、#/settings/categories，页面在 views/manage.js）、饮食（「饮食目标」进 #/settings/goals，views/goals.js；下面写着设了多少）、外观、数据（「备份与恢复」进 #/settings/data，views/data.js；
// 「最近删除」进 #/deleted，后面是几项）、关于（版本号；新版本下载好了也在这里说）。每组下面一句：同步说仓库 / 没开时说是什么，数据说上次备份是几天前。
// 语言、外观是本机设置（picknest.local），改了不通知订阅者：外观换完就地更新这一组按钮（不换掉按钮，焦点和读屏的位置不丢），
// 换语言由 app 就地重画所有页面（保留滚动；下拉框带 data-fid，重画后焦点回到它上面）。
// 自己管更新（返回 onChange）：数据变了（别的设备同步来的、撤销）只改「最近删除」后面的数和下面那句，不整页重画——
// 正在用键盘、读屏走到一半，或者下拉框开着时不会被打断；同步状态的标签由 app 换，同步那一组下面的一句听 ctx.on('sync')。
import { h, linkTo } from '../ui/dom.js';
import { LANGS, LANG_LABELS, t } from '../i18n.js';
import { deletedCount } from '../core/deleted.js';
import { storesPage, categoriesPage } from './manage.js';
import { syncPage } from './sync.js';
import { dataPage, backupReminder } from './data.js';
import { goalsPage } from './goals.js';
import { goalsOf } from '../core/log.js';
import { macroText, nowrapParts } from '../ui/logSheet.js';

const THEMES = ['auto', 'light', 'dark'];
// 中英文写在一起：不管现在是哪种语言都找得到。中文那一半跟着界面写简体 / 繁体（繁体界面里冒出一个简体字很扎眼，读屏也按 zh-TW 念）
const LANG_ROW = { 'zh-Hans': '语言 / Language', 'zh-Hant-TW': '語言 / Language', en: 'Language / 语言' };

const sec = (id, title, kids, foot = null) => h('section.set-sec', { id: id ? 'set-' + id : null },
  title ? h('h2.group-h', null, title) : null, h('div.group', null, kids), foot);
// 只有一个下拉框时整行是 <label>（点哪里都行）；分段按钮用 <div>，免得点文字误按第一个按钮
const row = (label, control) => h((/^(INPUT|SELECT|TEXTAREA)$/.test(control.tagName) ? 'label' : 'div') + '.group-row.set-row', null,
  h('span.set-label', null, label), control);

export function render(main, params, ctx) {
  if (params.sub === 'stores') return storesPage(main, params, ctx);
  if (params.sub === 'categories') return categoriesPage(main, params, ctx);
  if (params.sub === 'sync') return syncPage(main, params, ctx);
  if (params.sub === 'data') return dataPage(main, params, ctx);
  if (params.sub === 'goals') return goalsPage(main, params, ctx);
  const page = h('div.page.set');
  const updateLine = h('p.small.set-update', { role: 'status' }, t('set.updateReady'));
  const langRow = LANG_ROW[ctx.lang()] || LANG_ROW['zh-Hans'];
  main.append(h('header.page-head', null, h('h1.lt', null, t('nav.settings'))), page);

  function themeSeg() {
    const cur = THEMES.includes(ctx.local.theme) ? ctx.local.theme : 'auto';
    const buttons = THEMES.map(v => h('button', {
      type: 'button', class: v === cur ? 'on' : null, 'aria-pressed': String(v === cur), dataset: { fid: 'set-theme-' + v },
      onclick: () => { ctx.setTheme(v); mark(v); },
    }, t('set.theme.' + v)));
    const mark = v => buttons.forEach((b, i) => { b.classList.toggle('on', THEMES[i] === v); b.setAttribute('aria-pressed', String(THEMES[i] === v)); });
    return h('div.seg.set-seg', { role: 'group', 'aria-label': t('set.theme') }, buttons);
  }

  const go = (path, label, extra = null) => h('a.group-row.set-row.go', { href: '#' + path, onclick: linkTo(ctx, path) }, h('span.set-label', null, label), extra);
  // 下面那几句和「最近删除」后面的数：就地改字，元素不换（onChange、同步状态变了时）
  const syncFoot = h('div.group-foot');
  const backupFoot = h('div.group-foot');
  const deletedN = h('span.set-count');
  const goalsFoot = h('div.group-foot');
  function paintSync() {
    const st = ctx.sync ? ctx.sync.status() : { on: false };
    syncFoot.textContent = st.on ? (st.repo ? t('set.syncRepo', { repo: st.repo }) : '') : t('set.syncOffFoot');
    syncFoot.hidden = !syncFoot.textContent;
  }
  function paintData() {
    const n = deletedCount(ctx.state);
    deletedN.textContent = n ? String(n) : '';           // 和 Babble 一样：没有删掉的就不写 0
    const b = backupReminder(ctx);
    backupFoot.textContent = b.text;
    backupFoot.classList.toggle('set-warn', b.stale);     // 还没备份过、30 天以上没备份：琥珀色
    // 饮食目标（同步的设置，别的设备改了也跟着变）：「每天 1800 千卡 · 蛋白质 90 g」，没设写「还没设目标」
    const g = goalsOf(ctx.state);
    const line = [g.kcal != null ? t('log.goalsFoot', { n: g.kcal }) : null, macroText(g) || null].filter(Boolean).join(' · ');
    if (line) goalsFoot.replaceChildren(...nowrapParts(line)); else goalsFoot.textContent = t('log.goalsNone');
  }

  page.append(
    // 语言放最上面、不要组名：标题三种语言都写，不管现在是哪种语言都找得到
    sec('lang', null, [row(langRow, h('select.set-in.set-select', { 'aria-label': langRow, dataset: { fid: 'set-lang' }, onchange: (e) => ctx.setLang(e.target.value) },
      LANGS.map(l => h('option', { value: l, lang: l, selected: l === ctx.lang() }, LANG_LABELS[l]))))]),
    // 同步那一行本身是链接：里面的状态标签不能再是链接（app 换新标签时照原来的样子换）
    sec('sync', t('set.syncH'), [go('/settings/sync', t('set.sync'), ctx.syncBadge ? ctx.syncBadge({ link: false }) : null)], syncFoot),
    sec('manage', t('set.manageH'), [
      go('/settings/stores', t('set.stores')),
      go('/settings/categories', t('set.categories')),
    ]),
    sec('food', t('log.goalsH'), [go('/settings/goals', t('log.goals'))], goalsFoot),
    sec('look', t('set.lookH'), [row(t('set.theme'), themeSeg())]),
    sec('data', t('set.dataH'), [
      go('/settings/data', t('set.data')),
      go('/deleted', t('deleted.title'), deletedN),
    ], backupFoot),
    h('section.set-sec#set-about', null, h('h2.group-h', null, t('set.aboutH')),
      h('div.card.set-about', null,
        h('div.set-about-top', null,
          h('img', { src: 'icons/icon-180.png', alt: '', width: 48, height: 48, onerror: (e) => e.target.remove() }),
          h('div', null, h('b', null, t('common.appName')), h('p.small.muted', null, t('set.aboutLine')))),
        h('p.small', null, t('set.about1')),
        h('p.small.muted.set-version', null, t('set.version', { v: ctx.build })),
        updateLine)),
  );
  paintSync();
  paintData();
  if (ctx.on) ctx.on('sync', paintSync);
  // 新版本下载好了（app.js 在启动、切回来时检查）：说一声，关掉再打开就用上
  function paintUpdate() { updateLine.hidden = !(ctx.updateReady && ctx.updateReady()); }
  paintUpdate();
  if (ctx.on) ctx.on('update', paintUpdate);
  return { onChange() { paintData(); } };
}
