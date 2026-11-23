// 搜索（#/search?q=）：所有清单里的东西（core/search.js 的 searchItems：名字和备注，简繁、大小写、全角半角都算；归档的清单也在里面，标「已归档」）。
// 结果按清单分组（组名是清单的图标和名字，点了进那张清单），每组里要买、以后再说、已买（画淡）；命中的字标出来（<mark>，用 textContent，不拼 HTML）。
// 点一行勾掉 / 取消、› 打开编辑面板、左右滑，和清单页一样（ui/checklist.js）。手机上是推入的页面（有返回）；宽屏双栏时在右栏，左栏是首页。
// 打字时只换下面的结果和地址栏（ctx.replaceHash：重新载入、后退回来还是这次搜的），输入框不重画；数据变了也只重画结果（返回 onChange）。
// 输入法还在选字时不搜（拼音字母会先搜出一堆英文的），选好字再搜。
// 打开时焦点放进搜索框：从首页的入口点进来时（ui/dom.js 的 linkTo，在点按里就换页）iPhone 也会弹出键盘；
// 后退回来（不是点按）时 iPhone 不弹键盘，结果照样看得到，想改搜索词直接打字（iPad、Mac 的键盘）。
import { h, icon, linkTo, backText } from '../ui/dom.js';
import { t } from '../i18n.js';
import { listName, listIcon } from '../core/store.js';
import { searchItems, searchTerms, hitCount, highlight } from '../core/search.js';
import { collatorFor } from '../core/group.js';
import { checklist, storeChip } from '../ui/checklist.js';
import { composing } from '../ui/form.js';

/**
 * 去搜索的链接（首页标题下面的入口、侧栏的「搜索」）：在点按里就换页（linkTo），iPhone 上搜索框的键盘才弹得出来。
 * 已经在搜索页上（双栏、侧栏的布局里入口和搜索页同时看得见）：只把焦点给搜索框，不换成空的 #/search（搜索词和结果会被清掉，还多一条历史记录）
 */
export const searchLink = (ctx) => linkTo(ctx, '/search', () => (ctx.route.name === 'search' ? document.querySelector('.search-input') : null));

/** @param {{ swipe?: object }} [deps]  测试用：交给 ui/swipe.js 的 createSwipes 的 env */
export function render(main, params, ctx, deps = {}) {
  let q = String((params.query && params.query.q) || '');
  const cl = checklist(ctx, main, deps.swipe);

  // 顶栏吸顶（和清单页一样），双栏右栏里 CSS 把返回藏起来（左栏就是上一页）；标题能接焦点（重画后按过的控件没了，焦点给它）
  const navbar = h('header.navbar.lp-nav', null, h('button.back', { type: 'button', onclick: () => ctx.back('/') }, icon('back'), backText(ctx, t('nav.lists'))));
  const head = h('div.page.push-head', null, h('h1.push-title', { tabindex: -1, dataset: { fid: 'lp-title' } }, t('nav.search')));
  const input = h('input.add-input.search-input', { type: 'search', value: q, 'aria-label': t('search.label'), placeholder: t('search.ph'),
    autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'search', maxlength: 200, dataset: { fid: 'search-q' },
    oninput: (e) => { if (!composing(e)) changed(); }, oncompositionend: () => changed(), onkeydown: (e) => onKey(e) });
  // 和快速添加同一个样子、同样吸在顶栏下面
  const bar = h('div.page.add-bar.search-bar', null, h('div.add-wrap', null, icon('search', { cls: 'add-ic' }), input));
  const found = h('p.search-found', { role: 'status' });         // 读屏听得到「找到 3 样」
  const body = h('div.page.lp-body.search-body');

  function onKey(e) {
    if (composing(e)) return;
    // 回车：收起键盘看结果（搜索是边打边搜的）；Esc：清空
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    else if (e.key === 'Escape' && input.value) { e.preventDefault(); input.value = ''; changed(); }
  }
  function changed() {
    if (input.value === q) return;
    q = input.value;
    ctx.replaceHash('/search' + (q.trim() ? '?q=' + encodeURIComponent(q) : ''));
    drawBody();
  }

  const hl = (text) => highlight(text, q).map(s => (s.hit ? h('mark', null, s.text) : s.text));
  function drawBody() {
    const terms = searchTerms(q);
    const groups = searchItems(ctx.state, q, collatorFor(ctx.lang()));
    const n = hitCount(groups);
    // 没找到时大字在下面，这里只给读屏念（不然一样的话写两遍）
    found.textContent = !terms.length ? '' : n ? t('search.found', { n }) : t('search.none', { q: q.trim() });
    found.classList.toggle('sr-only', !n);
    cl.draw(() => {
      if (!terms.length) { body.replaceChildren(h('p.empty.search-hint', null, t('search.hint'))); return; }
      if (!n) {
        body.replaceChildren(h('div.empty.lp-empty', null, h('p', null, h('b', null, t('search.none', { q: q.trim() }))), h('p.small', null, t('search.noneHint'))));
        return;
      }
      body.replaceChildren(...groups.map(g => h('section.grp.sr-grp', null,
        h('h2.sr-head', null,
          h('a.sr-list', { href: '#/l/' + encodeURIComponent(g.list.id) },
            h('span.sr-list-ic', { 'aria-hidden': 'true' }, listIcon(g.list)), h('span.sr-list-name', null, listName(g.list, t)),
            g.archived ? h('span.tag', null, t('search.archived')) : null)),
        h('ul.group.items', null, g.hits.map(({ item, note }) => cl.row(item,
          // 「以后再说」的标出来（清单页上它们在单独一组里）；商店照清单页的规则，只标不在默认商店买的
          [item.status === 'later' ? h('span.tag.sr-later', null, t('item.st.later')) : null, storeChip(ctx, item, g.list.defaultStoreId)],
          { name: hl(item.name), note: note ? hl(note) : null }))))));
    });
  }

  main.append(navbar, head, bar, found, body);
  drawBody();
  input.focus({ preventScroll: true });

  return {
    onChange: () => cl.whenIdle(() => cl.keepFocus(drawBody)),     // 正在滑一行：滑完再重画
    // 离开时点过、还没挪的，马上改（和清单页一样）
    cleanup: () => { cl.flush(); cl.destroy(); },
    flush: () => cl.flush(),
  };
}
