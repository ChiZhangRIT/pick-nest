// 设置（#/settings）：语言、外观、商店和分类（进 #/settings/stores、#/settings/categories，页面在 views/manage.js）、关于。
// 同步、备份在后面几步再加（不放还没做好的入口）。
// 语言、外观是本机设置（picknest.local），改了不通知订阅者：外观换完就地更新这一组按钮（不换掉按钮，焦点和读屏的位置不丢），
// 换语言由 app 整页重画（下拉框带 data-fid，重画后焦点回到它上面）。
import { h } from '../ui/dom.js';
import { LANGS, LANG_LABELS, t } from '../i18n.js';
import { storesPage, categoriesPage } from './manage.js';

const THEMES = ['auto', 'light', 'dark'];
const LANG_ROW = '语言 / Language';     // 三种语言写在一起：不管现在是哪种语言都找得到

const sec = (id, title, kids) => h('section.set-sec', { id: id ? 'set-' + id : null },
  title ? h('h2.group-h', null, title) : null, h('div.group', null, kids));
// 只有一个下拉框时整行是 <label>（点哪里都行）；分段按钮用 <div>，免得点文字误按第一个按钮
const row = (label, control) => h((/^(INPUT|SELECT|TEXTAREA)$/.test(control.tagName) ? 'label' : 'div') + '.group-row.set-row', null,
  h('span.set-label', null, label), control);

export function render(main, params, ctx) {
  if (params.sub === 'stores') return storesPage(main, params, ctx);
  if (params.sub === 'categories') return categoriesPage(main, params, ctx);
  const page = h('div.page.set');
  main.append(h('header.page-head', null, h('h1.lt', null, t('nav.settings'))), page);

  function themeSeg() {
    const cur = THEMES.includes(ctx.local.theme) ? ctx.local.theme : 'auto';
    const buttons = THEMES.map(v => h('button', {
      type: 'button', class: v === cur ? 'on' : null, 'aria-pressed': String(v === cur),
      onclick: () => { ctx.setTheme(v); mark(v); },
    }, t('set.theme.' + v)));
    const mark = v => buttons.forEach((b, i) => { b.classList.toggle('on', THEMES[i] === v); b.setAttribute('aria-pressed', String(THEMES[i] === v)); });
    return h('div.seg.set-seg', { role: 'group', 'aria-label': t('set.theme') }, buttons);
  }

  page.append(
    sec('lang', null, [row(LANG_ROW, h('select.set-in.set-select', { 'aria-label': LANG_ROW, dataset: { fid: 'set-lang' }, onchange: (e) => ctx.setLang(e.target.value) },
      LANGS.map(l => h('option', { value: l, selected: l === ctx.lang() }, LANG_LABELS[l]))))]),
    sec('look', null, [row(t('set.theme'), themeSeg())]),
    sec('manage', null, [
      h('a.group-row.set-row.go', { href: '#/settings/stores' }, h('span.set-label', null, t('set.stores'))),
      h('a.group-row.set-row.go', { href: '#/settings/categories' }, h('span.set-label', null, t('set.categories'))),
    ]),
    h('section.set-sec#set-about', null, h('h2.group-h', null, t('set.aboutH')),
      h('div.card.set-about', null,
        h('div.set-about-top', null,
          h('img', { src: 'icons/icon-180.png', alt: '', width: 48, height: 48, onerror: (e) => e.target.remove() }),
          h('div', null, h('b', null, t('common.appName')), h('p.small.muted', null, t('set.aboutLine')))),
        h('p.small', null, t('set.about1')),
        h('p.small.muted.set-version', null, t('set.version', { v: ctx.build })))),
  );
}
