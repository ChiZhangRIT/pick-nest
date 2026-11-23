// 一道食谱（#/r/<id>）：名字、几人份 · 几样食材、来源（http / https 的链接在新标签页打开，别的照写）、「加到清单」（面板在 ui/addToList.js）、
// 「加到计划」（选哪一天、哪一顿、几人份：和计划页加一道菜是同一个面板 ui/dishSheet.js，食谱已经选好；默认今天的晚饭）、
// 食材（名字、用量、备注，可选的、常备品标出来）、做法、备注，最下面「删除食谱」（先问，软删除进最近删除，10 秒内能撤销）。
// 顶栏：返回（双栏右栏里 CSS 藏起来：左栏「食谱」就是上一页）、「编辑」（#/r/<id>/edit）。
// 食谱不在了（地址错了、别的设备删掉了）→ 回「食谱」并提示。
// 自己管更新（返回 onChange）：数据变了就地重画（焦点按 data-fid 放回）；删除时先离开再删，不然重画时会当成「不在了」再提示一次。
import { h, icon, backText } from '../ui/dom.js';
import { t } from '../i18n.js';
import { liveRecipe, recipeName, deleteRecipe } from '../core/recipes.js';
import { isStaple } from '../core/memory.js';
import { qtyLabel } from '../core/parse.js';
import { cleanUrl } from '../core/items.js';
import { addToListSheet } from '../ui/addToList.js';
import { dishSheet } from '../ui/dishSheet.js';
import { todayDay } from '../core/dates.js';
import { recipeMeta } from './recipes.js';

export function render(main, params, ctx) {
  const id = params.id;
  const rec = () => liveRecipe(ctx.state, id);
  let leaving = false;
  function gone() {
    if (leaving) return;
    leaving = true;
    queueMicrotask(() => { ctx.navigate('/recipes', { replace: true }); ctx.toast(t('rcp.gone')); });
  }
  if (!rec()) { gone(); return undefined; }

  const navbar = h('header.navbar.lp-nav', null,
    h('button.back', { type: 'button', onclick: () => ctx.back('/recipes') }, icon('back'), backText(ctx, t('nav.recipes'))),
    h('div.nav-acts', null, h('button.tb-btn', { type: 'button', dataset: { fid: 'rcp-edit' }, onclick: () => ctx.navigate('/r/' + encodeURIComponent(id) + '/edit') }, icon('pencil'), t('rcp.edit'))));
  const content = h('div.rcp-page');

  function draw() {
    const r = rec();
    const url = r.source ? cleanUrl(r.source) : '';
    const ings = r.ings.filter(g => g.name.trim());
    const text = (cls, s) => h('div.card.rcp-prose' + cls, null, s);
    // 没写做法、备注的那两块是 null：replaceChildren 会把 null 写成字「null」（只有 h() 跳过 null），先 filter 掉
    content.replaceChildren(...[
      h('div.page.lp-head.rcp-head', null,
        h('h1.lp-name', { tabindex: -1, dataset: { fid: 'lp-title' } }, recipeName(r, t)),
        h('p.rcp-sub', null, recipeMeta(r)),
        // 来源：链接只当 http / https 打开（新标签页、不带来源），别的（「妈妈教的」、坏链接）照原文写
        r.source.trim() ? (url
          ? h('a.rcp-source', { href: url, target: '_blank', rel: 'noopener noreferrer' }, icon('open'), h('span', null, r.source.trim()))
          : h('p.rcp-source', null, r.source.trim())) : null,
        h('div.rcp-acts', null,
          // 还没写食材：「加到清单」不当主按钮（打开也没什么可加的），主要的事是去「编辑」
          h('button.btn.rcp-add' + (ings.length ? '.primary' : ''), { type: 'button', dataset: { fid: 'rcp-add' }, onclick: () => addToListSheet(ctx, id) }, icon('cart'), t('rcp.addToList')),
          h('button.btn.rcp-plan', { type: 'button', dataset: { fid: 'rcp-plan' }, onclick: () => dishSheet(ctx, { recipeId: id, date: todayDay(), meal: 'dinner' }) }, icon('calendar'), t('rcp.addToPlan')))),
      h('section.page.rcp-sec', null,
        h('h2.group-h', null, t('rcp.ings')),
        ings.length ? h('ul.group.rcp-ings', null, ings.map(g => h('li.group-row.rcp-ing', null,
          h('span.rcp-ing-text', null,
            h('span.rcp-ing-name', null, g.name,
              g.optional ? h('span.tag', null, t('rcp.optional')) : null,
              isStaple(ctx.state, g.name) ? h('span.tag.rcp-staple', null, t('rcp.staple')) : null),
            g.note ? h('span.rcp-ing-note', null, g.note) : null),
          h('span.rcp-ing-qty', null, qtyLabel(g.qty, g.unit)))))
          : h('p.group-foot', null, t('rcp.ingsEmpty'))),
      r.steps.trim() ? h('section.page.rcp-sec', null, h('h2.group-h', null, t('rcp.steps')), text('.rcp-steps', r.steps.trim())) : null,
      r.note.trim() ? h('section.page.rcp-sec', null, h('h2.group-h', null, t('rcp.note')), text('.rcp-note', r.note.trim())) : null,
      h('div.page.rcp-foot', null, h('button.btn.block.danger', { type: 'button', dataset: { fid: 'rcp-del' }, onclick: () => remove() }, t('rcp.delete'))),
    ].filter(Boolean));
  }

  async function remove() {
    const r = rec();
    if (!r) return;
    const name = recipeName(r, t);
    if (!(await ctx.confirm({ title: t('rcp.deleteQ', { name }), message: t('rcp.deleteMsg'), confirmLabel: t('common.delete'), danger: true }))) return;
    leaving = true;                 // 先离开再删：不在这页画「不在了」
    ctx.back('/recipes');
    ctx.mutate(s => deleteRecipe(s, id, Date.now()), { undoLabel: t('rcp.deleted', { name }) });
  }

  main.append(navbar, content);
  draw();
  return {
    onChange() {
      if (leaving) return;
      if (!rec()) { gone(); return; }
      const a = document.activeElement, fid = a && a.dataset && main.contains(a) ? a.dataset.fid : null;
      draw();
      const el = fid ? main.querySelector(`[data-fid="${fid}"]`) : null;
      if (el) el.focus({ preventScroll: true });
    },
  };
}
