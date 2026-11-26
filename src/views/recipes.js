// 「食谱」（#/recipes）：搜索框（名字和食材，简繁互通：core/recipes.js 的 searchRecipes）+ 食谱一行一张卡片（名字，下面「2 人份 · 8 样食材」；
// 名字没搜到、是食材搜到的写「用到：五花肉」），点了进那道食谱（#/r/<id>）；右上角「新建食谱」（#/r/new，⌘N 也是）。
// 自己管更新（返回 onChange）：打字时只换下面的卡片，数据变了（同步来的、撤销）也只重画卡片，搜索框不重画，打字不会被打断。
// 搜索词记在这次打开 App 期间（ui.q，不放地址里）：双栏时点左栏的一道食谱，左栏会跟着右栏重新挂载（地址换成 #/r/…），
// 放地址里的话搜索词就没了；手机上点进去再返回也还是刚才搜的。
// 宽屏双栏时在左栏（params.pane === 'list'）：右栏正在看 / 编辑的那道（params.selected）高亮。
// 第 11 步：卡片上写着标签，右边一个购物车按钮直接打开「加到清单」（ui/addToList.js；点卡片别的地方照旧打开这道食谱：
// 按钮在链接外面，不能套在 <a> 里）；搜索框下面按标签筛选（core/recipes.js 的 usedTags 列用到的、searchRecipes 的 tags 筛：
// 一组里任一、两组都要；选的也记在这次打开期间）；左上角「食材替换」（ui/replaceIngredient.js）。
// 数据变了先比一下要画的东西（卡片、筛选）有没有变，没变不重画：加到清单、标常备品这种和食谱无关的修改，不把焦点从刚点的购物车上弄丢。
// 第 12 步：有成品图的卡片左边一张圆角小图（ui/photo.js：这一页的 object URL 页面清理时放掉；本机没有、在下载的是淡淡的占位）。
import { h, icon, linkTo } from '../ui/dom.js';
import { t, listJoin } from '../i18n.js';
import { searchRecipes, recipeName, recipeTags, usedTags } from '../core/recipes.js';
import { live, normName, hash64, TAG_GROUPS } from '../core/store.js';
import { collatorFor } from '../core/group.js';
import { formatQty } from '../core/parse.js';
import { composing, isNewKey, isTextField } from '../ui/form.js';
import { addToListSheet } from '../ui/addToList.js';
import { replaceSheet } from '../ui/replaceIngredient.js';
import { photoPool } from '../ui/photo.js';

/** q：搜索词；tags：按标签筛选选了的（组 → normName 的集合） */
const ui = { q: '', tags: { cuisine: new Set(), style: new Set() } };

/** 卡片下面那一行：「2 人份 · 8 样食材」（没写人数就只写几样） */
export const recipeMeta = (r) => [r.servings ? t('rcp.servingsN', { n: formatQty(r.servings) }) : null, t('rcp.ingN', { n: r.ings.filter(g => g.name.trim()).length })].filter(Boolean).join(' · ');

export function render(main, params, ctx) {
  const sel_ = (r) => !!params.selected && params.selected === r.id;
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
  const photos = photoPool(ctx, main);

  function changed() {
    if (input.value === ui.q) return;
    ui.q = input.value;
    drawBody();
  }
  // 筛选的一排：每组用到的标签一个开关（aria-pressed），有选了的时候最后一个「清除筛选」
  const filterEl = h('div.rcp-filter', { role: 'group', 'aria-label': t('rcp.filter') });
  // 「食材替换」：还没有食谱时不画（没有可换的）
  const replaceBtn = h('button.tb-btn.rcp-replace', { type: 'button', dataset: { fid: 'rcp-replace' }, onclick: () => replaceSheet(ctx) }, t('rcp.replace'));
  let lastSig = null;
  function drawBody() {
    const collator = collatorFor(ctx.lang());
    const all = live(ctx.state, 'recipes').length;
    const used = usedTags(ctx.state, collator);
    // 选了的标签已经没有食谱用了（删掉、改掉了）：去掉，不然筛着一个看不见的标签，什么都列不出来、也没处取消
    for (const g of TAG_GROUPS) for (const k of [...ui.tags[g]]) if (!used[g].some(x => normName(x.name) === k)) ui.tags[g].delete(k);
    const sel = { cuisine: [...ui.tags.cuisine], style: [...ui.tags.style] };
    const filtering = sel.cuisine.length + sel.style.length > 0;
    const hits = searchRecipes(ctx.state, ui.q, collator, { tags: filtering ? sel : null });
    const q = ui.q.trim();
    // 要画的东西没变（只是清单、计划、常备品变了）：不重画，焦点、读屏的位置都不动
    const sig = JSON.stringify([all, q, sel, used, params.selected || null, ctx.lang(), hits.map(({ recipe: r, ings }) => [r.id, r.name, r.servings, r.ings.length, recipeTags(r), ings, r.photo && r.photo.sha256])]);
    if (sig === lastSig) return;
    lastSig = sig;
    replaceBtn.hidden = !all;
    found.textContent = (q || filtering) && all ? (hits.length ? t('rcp.foundN', { n: hits.length }) : q ? t('rcp.notFound', { q }) : t('rcp.filterNone')) : '';
    drawFilter(used, filtering);
    if (!all) {
      body.replaceChildren(h('div.empty.rcp-empty', null, icon('recipe'), h('p', null, h('b', null, t('rcp.none'))), h('p.small', null, t('rcp.noneHint'))));
      return;
    }
    if (!hits.length) {
      body.replaceChildren(h('div.empty.lp-empty', null,
        h('p', null, h('b', null, q ? t('rcp.notFound', { q }) : t('rcp.filterNone'))),
        h('p.small', null, filtering ? t('rcp.filterNoneHint') : t('rcp.notFoundHint')),
        filtering ? h('button.btn.small.rcp-fclear', { type: 'button', dataset: { fid: 'rcp-fclear2' }, onclick: () => clearFilter() }, t('rcp.filterClear')) : null));
      return;
    }
    body.replaceChildren(h('ul.group.rcp-list', { 'aria-label': t('nav.recipes') }, hits.map(({ recipe: r, ings }) => {
      const name = recipeName(r, t), tg = recipeTags(r), tags = [...tg.cuisine, ...tg.style];
      return h('li.rcp-li' + (sel_(r) ? '.sel' : ''), null,
        h('a.group-row.rcp-row' + (sel_(r) ? '.sel' : ''), { href: '#/r/' + encodeURIComponent(r.id), dataset: { id: r.id, fid: 'rcp-open-' + r.id }, 'aria-current': sel_(r) ? 'page' : null },
          r.photo ? photos.view(r.photo, { cls: '.rcp-thumb' }) : null,
          h('span.rcp-text', null,
            h('span.rcp-name', null, name),
            h('span.rcp-meta', null, ings.length ? t('rcp.uses', { names: listJoin(ings) }) : recipeMeta(r)),
            tags.length ? h('span.rcp-tags', null, tags.map(x => h('span.tag.rcp-tag', null, x))) : null)),
        // 购物车：直接打开「加到清单」（44px 的点按区域，读屏念「把「红烧肉」加到清单」）
        h('button.icon-btn.rcp-cart', { type: 'button', 'aria-label': t('rcp.cartFor', { name }), dataset: { fid: 'rcp-cart-' + r.id },
          onclick: () => addToListSheet(ctx, r.id) }, icon('cart')));
    })));
  }
  function drawFilter(used, filtering) {
    const groups = TAG_GROUPS.filter(g => used[g].length);
    filterEl.hidden = !groups.length;
    // 没在筛的时候「清除筛选」是 null：replaceChildren 会把 null 写成字「null」（只有 h() 跳过 null），先 filter 掉
    filterEl.replaceChildren(...[...groups.map(g => h('div.rcp-frow', { role: 'group', 'aria-label': t('rcp.tag.' + g) },
      h('span.rcp-flabel', { 'aria-hidden': 'true' }, t('rcp.tag.' + g)),
      used[g].map(({ name }) => {
        // fid 用名字的哈希：标签是用户写的，里面可能有引号，不能直接放进选择器
        const k = normName(name), on = ui.tags[g].has(k), f = `rcp-f-${g}-${hash64(k)}`;
        return h('button.chip.rcp-fchip', { type: 'button', 'aria-pressed': String(on), dataset: { fid: f },
          onclick: () => { if (on) ui.tags[g].delete(k); else ui.tags[g].add(k); refocus(f); } }, name);
      }))),
    filtering ? h('button.link-btn.rcp-fclear', { type: 'button', dataset: { fid: 'rcp-fclear' }, onclick: () => clearFilter() }, t('rcp.filterClear')) : null].filter(Boolean));
  }
  function clearFilter() {
    for (const g of TAG_GROUPS) ui.tags[g].clear();
    refocus(null);
    input.focus({ preventScroll: true });
  }
  /** 筛选变了：重画，焦点回到刚点的那个标签（重画以后是新的按钮） */
  function refocus(fid) {
    drawBody();
    const el = fid ? main.querySelector(`[data-fid="${fid}"]`) : null;
    if (el) el.focus({ preventScroll: true });
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
      h('div.toolbar', null,
        replaceBtn,
        h('a.tb-btn', { href: '#/r/new', onclick: newRecipe, dataset: { fid: 'rcp-new' } }, icon('plus'), t('rcp.new'))),
      h('h1.lt', null, t('nav.recipes')),
      h('div.add-wrap.rcp-search-wrap', null, icon('search', { cls: 'add-ic' }), input),
      filterEl),
    found, body);
  drawBody();
  return {
    onChange() {
      const a = document.activeElement, fid = a && a.dataset && main.contains(a) ? a.dataset.fid : null;
      drawBody();
      // 重画了（食谱真的变了）：焦点放回原来那个控件（卡片、购物车、筛选的标签）
      if (fid && !main.contains(a)) { const el = main.querySelector(`[data-fid="${fid}"]`); if (el) el.focus({ preventScroll: true }); }
    },
    cleanup: () => { document.removeEventListener('keydown', onShortcut); photos.revoke(); },
  };
}
