// 「食谱」（#/recipes）：搜索框（名字和食材，简繁互通：core/recipes.js 的 searchRecipes）+ 食谱一行一张卡片（名字，下面「2 人份 · 8 样食材」；
// 名字没搜到、是食材搜到的写「用到：五花肉」），点了进那道食谱（#/r/<id>）；右上角「新建食谱」（#/r/new，⌘N 也是）。
// 自己管更新（返回 onChange）：打字时只换下面的卡片，数据变了（同步来的、撤销）也只重画卡片，搜索框不重画，打字不会被打断。
// 搜索词记在这次打开 App 期间（ui.q，不放地址里）：双栏时点左栏的一道食谱，左栏会跟着右栏重新挂载（地址换成 #/r/…），
// 放地址里的话搜索词就没了；手机上点进去再返回也还是刚才搜的。
// 宽屏双栏时在左栏（params.pane === 'list'）：右栏正在看 / 编辑的那道（params.selected）高亮。
import { h, icon, linkTo } from '../ui/dom.js';
import { t } from '../i18n.js';
import { searchRecipes, recipeName } from '../core/recipes.js';
import { live } from '../core/store.js';
import { collatorFor } from '../core/group.js';
import { formatQty } from '../core/parse.js';
import { composing, isNewKey, isTextField } from '../ui/form.js';

const ui = { q: '' };

/** 卡片下面那一行：「2 人份 · 8 样食材」（没写人数就只写几样） */
export const recipeMeta = (r) => [r.servings ? t('rcp.servingsN', { n: formatQty(r.servings) }) : null, t('rcp.ingN', { n: r.ings.filter(g => g.name.trim()).length })].filter(Boolean).join(' · ');

export function render(main, params, ctx) {
  const sel = (r) => !!params.selected && params.selected === r.id;
  const newRecipe = linkTo(ctx, '/r/new');
  const input = h('input.add-input.search-input.rcp-search', { type: 'search', value: ui.q, 'aria-label': t('rcp.searchLabel'), placeholder: t('rcp.searchPh'),
    autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'search', maxlength: 200, dataset: { fid: 'rcp-q' },
    oninput: (e) => { if (!composing(e)) changed(); }, oncompositionend: () => changed(),
    onkeydown: (e) => {
      if (composing(e)) return;
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      else if (e.key === 'Escape' && input.value) { e.preventDefault(); input.value = ''; changed(); }
    } });
  const found = h('p.sr-only', { role: 'status' });          // 读屏听得到「找到 3 道食谱」
  const body = h('div.page.rcp-body');

  function changed() {
    if (input.value === ui.q) return;
    ui.q = input.value;
    drawBody();
  }
  function drawBody() {
    const all = live(ctx.state, 'recipes').length;
    const hits = searchRecipes(ctx.state, ui.q, collatorFor(ctx.lang()));
    const q = ui.q.trim();
    found.textContent = q && all ? (hits.length ? t('rcp.foundN', { n: hits.length }) : t('rcp.notFound', { q })) : '';
    if (!all) {
      body.replaceChildren(h('div.empty.rcp-empty', null, icon('recipe'), h('p', null, h('b', null, t('rcp.none'))), h('p.small', null, t('rcp.noneHint'))));
      return;
    }
    if (!hits.length) {
      body.replaceChildren(h('div.empty.lp-empty', null, h('p', null, h('b', null, t('rcp.notFound', { q }))), h('p.small', null, t('rcp.notFoundHint'))));
      return;
    }
    body.replaceChildren(h('ul.group.rcp-list', { 'aria-label': t('nav.recipes') }, hits.map(({ recipe: r, ings }) => h('li', null,
      h('a.group-row.rcp-row.go' + (sel(r) ? '.sel' : ''), { href: '#/r/' + encodeURIComponent(r.id), dataset: { id: r.id }, 'aria-current': sel(r) ? 'page' : null },
        h('span.rcp-text', null,
          h('span.rcp-name', null, recipeName(r, t)),
          h('span.rcp-meta', null, ings.length ? t('rcp.uses', { names: ings.join('、') }) : recipeMeta(r))))))));
  }

  // ⌘N（别的系统 Ctrl+N）= 新建食谱；面板开着、正在别的输入框里打字时不管（和清单页的 ⌘N 一样）
  function onShortcut(e) {
    if (!isNewKey(e) || document.querySelector('dialog[open]')) return;
    if (isTextField(document.activeElement)) return;
    e.preventDefault();
    ctx.navigate('/r/new');
  }
  document.addEventListener('keydown', onShortcut);

  main.append(
    h('header.page-head', null,
      h('div.toolbar', null, h('span'), h('a.tb-btn', { href: '#/r/new', onclick: newRecipe, dataset: { fid: 'rcp-new' } }, icon('plus'), t('rcp.new'))),
      h('h1.lt', null, t('nav.recipes')),
      h('div.add-wrap.rcp-search-wrap', null, icon('search', { cls: 'add-ic' }), input)),
    found, body);
  drawBody();
  return {
    onChange: () => drawBody(),
    cleanup: () => document.removeEventListener('keydown', onShortcut),
  };
}
