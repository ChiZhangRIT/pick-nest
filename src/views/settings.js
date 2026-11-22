// 设置（#/settings）：语言、外观、商店和分类（进 #/settings/stores、#/settings/categories，页面在 views/manage.js）、
// 同步（#/settings/sync，views/sync.js；这一行右边是同步状态的小标签）、数据（#/settings/data，views/data.js：备份、恢复、最近删除）、关于（新版本下载好了也在这里说）。
// 语言、外观是本机设置（picknest.local），改了不通知订阅者：外观换完就地更新这一组按钮（不换掉按钮，焦点和读屏的位置不丢），
// 语言直接点选，不经过系统下拉菜单的打开 / 关闭动画；换完仍保留滚动位置和选项上的焦点。
import { h, linkTo } from '../ui/dom.js';
import { LANGS, LANG_LABELS, t } from '../i18n.js';
import { storesPage, categoriesPage } from './manage.js';
import { syncPage } from './sync.js';
import { dataPage } from './data.js';

const THEMES = ['auto', 'light', 'dark'];
// 中英文写在一起：不管现在是哪种语言都找得到。中文那一半跟着界面写简体 / 繁体（繁体界面里冒出一个简体字很扎眼，读屏也按 zh-TW 念）
const LANG_ROW = { 'zh-Hans': '语言 / Language', 'zh-Hant-TW': '語言 / Language', en: 'Language / 语言' };

const sec = (id, title, kids) => h('section.set-sec', { id: id ? 'set-' + id : null },
  title ? h('h2.group-h', null, title) : null, h('div.group', null, kids));
const row = (label, control) => h('div.group-row.set-row', null,
  h('span.set-label', null, label), control);

export function render(main, params, ctx) {
  if (params.sub === 'stores') return storesPage(main, params, ctx);
  if (params.sub === 'categories') return categoriesPage(main, params, ctx);
  if (params.sub === 'sync') return syncPage(main, params, ctx);
  if (params.sub === 'data') return dataPage(main, params, ctx);
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
  const languages = sec('lang', langRow, LANGS.map(l => h('label.group-row.set-row.set-language', null,
      h('span.set-label', null, LANG_LABELS[l]),
      h('input.set-language-radio', { type: 'radio', name: 'picknest-language', value: l, checked: l === ctx.lang(), lang: l,
        dataset: { fid: 'set-lang-' + l }, onchange: e => {
          if (!e.target.checked) return;
          e.target.focus({ preventScroll: true }); ctx.setLang(l);
        } }))));
  languages.querySelector('.group').setAttribute('role', 'group');
  languages.querySelector('.group').setAttribute('aria-label', langRow);
  page.append(
    languages,
    sec('look', null, [row(t('set.theme'), themeSeg())]),
    sec('manage', null, [
      go('/settings/stores', t('set.stores')),
      go('/settings/categories', t('set.categories')),
    ]),
    // 同步那一行本身是链接：里面的状态标签不能再是链接（app 换新标签时照原来的样子换）
    sec('data', null, [
      go('/settings/sync', t('set.sync'), ctx.syncBadge ? ctx.syncBadge({ link: false }) : null),
      go('/settings/data', t('set.data')),
    ]),
    h('section.set-sec#set-about', null, h('h2.group-h', null, t('set.aboutH')),
      h('div.card.set-about', null,
        h('div.set-about-top', null,
          h('img', { src: 'icons/icon-180.png', alt: '', width: 48, height: 48, onerror: (e) => e.target.remove() }),
          h('div', null, h('b', null, t('common.appName')), h('p.small.muted', null, t('set.aboutLine')))),
        h('p.small', null, t('set.about1')),
        h('p.small.muted.set-version', null, t('set.version', { v: ctx.build })),
        updateLine)),
  );
  // 新版本下载好了（app.js 在启动、切回来时检查）：说一声，关掉再打开就用上
  function paintUpdate() { updateLine.hidden = !(ctx.updateReady && ctx.updateReady()); }
  paintUpdate();
  if (ctx.on) ctx.on('update', paintUpdate);
  // 首页只有本机选项；同步标签由 app 更新，新版本提示由 update 事件更新。
  // 后台购物数据的变化不用重建选项，按着键盘或点设置时不会被打断。
  return { onChange() {} };
}
