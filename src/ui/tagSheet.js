// 「管理标签」的面板（「食谱」页筛选下面）：菜系、风格两组，每组先列有食谱用着的标签（显示出来的名字、几道食谱用），
//   每个能「改名」（所有用到的食谱一起改；改成这一组里已有的就合成一个：core/recipes.js 的 checkTagRename / renameTag）、
//   「删除」（所有食谱上去掉，食谱本身不删：deleteTag；先问一句、说清几道，焦点先给「取消」）——都是一次 ctx.mutate，提示条上能撤销；
//   再列没有食谱用的预设，每个能「不在选项里显示」/「恢复」（setTagHidden：同步的设置里一个预设一个键）。
// 预设显示成界面语言写出来的字（tagLabel），存的是键，所以改了界面语言这里跟着变。
// 面板不在页面里：数据变了（撤销、别的设备同步来的）由打开它的页面调返回的 refresh() 重画；自己改了的马上重画，焦点按 data-fid 放回去。
import { h } from './dom.js';
import { t } from '../i18n.js';
import { nameSheet } from './nameSheet.js';
import { tagOverview, tagLabel, tagId, isPresetTag, checkTagRename, renameTag, deleteTag, setTagHidden } from '../core/recipes.js';
import { hash64, TAG_GROUPS } from '../core/store.js';
import { collatorFor } from '../core/group.js';

/** 一个标签的按钮 id：标签是用户写的，里面可能有引号，不能直接放进选择器，用 tagId 的哈希 @param {string} kind @param {string} g @param {string} tag */
export const tagFid = (kind, g, tag) => `tm-${kind}-${g}-${hash64(tagId(g, tag))}`;

/** tagSheet(ctx) → { sheet, refresh, isOpen } */
export function tagSheet(ctx) {
  const body = h('div.tm');
  let open = true;
  const s = ctx.sheet(body, { title: t('rcp.tagManage'), cls: 'tm-sheet', onClose: () => { open = false; } });

  function draw() {
    const ov = tagOverview(ctx.state, collatorFor(ctx.lang()), t);
    body.replaceChildren(...TAG_GROUPS.map(g => {
      const { used, unused } = ov[g];
      const name = (tag) => tagLabel(g, tag, t);
      return h('section.tm-sec', { 'aria-label': t('rcp.tag.' + g) },
        h('h3.group-h', null, t('rcp.tag.' + g)),
        used.length
          ? h('ul.group.tm-list', null, used.map(({ tag, n }, i) => h('li.group-row.tm-row', null,
            h('span.tm-text', null, h('span.tm-name', null, name(tag)), h('span.tm-n', null, t('rcp.tagUsedN', { n }))),
            h('span.tm-acts', null,
              h('button.btn.small.tm-ren', { type: 'button', 'aria-label': t('rcp.tagRenameFor', { name: name(tag) }), dataset: { fid: tagFid('ren', g, tag) },
                onclick: () => rename(g, tag) }, t('rcp.tagRename')),
              h('button.btn.small.danger.tm-del', { type: 'button', 'aria-label': t('rcp.tagDeleteFor', { name: name(tag) }), dataset: { fid: tagFid('del', g, tag) },
                onclick: () => remove(g, tag, n, used[i + 1] || used[i - 1]) }, t('common.delete'))))))
          : h('p.f-help.tm-none', null, t('rcp.tagNone')),
        unused.length ? h('div.tm-unused', null,
          h('h4.tm-sub', null, t('rcp.tagUnused')),
          h('ul.group.tm-list', null, unused.map(({ tag, hidden }) => h('li.group-row.tm-row' + (hidden ? '.off' : ''), null,
            h('span.tm-text', null, h('span.tm-name', null, name(tag)), hidden ? h('span.tag.tm-hidden', null, t('rcp.tagHidden')) : null),
            h('button.link-btn.tm-hide', { type: 'button', 'aria-label': t(hidden ? 'rcp.tagShowFor' : 'rcp.tagHideFor', { name: name(tag) }), dataset: { fid: tagFid('hide', g, tag) },
              onclick: () => hide(g, tag, !hidden) }, t(hidden ? 'rcp.tagShow' : 'rcp.tagHide')))))) : null);
    }), h('p.f-help.tm-help', null, t('rcp.tagUnusedHelp')));
  }
  /** 重画，焦点放到 fid（给了的话），不然放回原来那个按钮（还在的话） @param {string | null} [fid] */
  function refresh(fid = null) {
    if (!open) return;
    const a = document.activeElement, was = a && a.dataset && body.contains(a) ? a.dataset.fid : null;
    draw();
    const want = fid || was;
    const el = want ? body.querySelector(`[data-fid="${want}"]`) : null;
    if (el) el.focus({ preventScroll: true });
  }

  function rename(g, tag) {
    const from = tagLabel(g, tag, t);
    nameSheet(ctx, { title: t('rcp.tagRenameFor', { name: from }), label: t('rcp.tagName'), value: from, help: t('rcp.tagRenameHelp'), focus: true,
      save: ({ name }) => {
        // 按这时的数据算（面板开着时别的设备可能改过）
        const c = checkTagRename(ctx.state, g, tag, name);
        if (!c.ok) return { ok: false, errors: { name: c.error } };
        const to = tagLabel(g, c.value, t);
        ctx.mutate(st => renameTag(st, g, tag, name, Date.now()), { undoLabel: t(c.merge ? 'rcp.tagMerged' : 'rcp.tagRenamed', { name: from, to }) });
        // 名字面板关掉以后焦点回到改好的那一行的「改名」
        setTimeout(() => refresh(tagFid('ren', g, c.value)), 0);
        return { ok: true };
      } });
  }
  async function remove(g, tag, n, next) {
    const name = tagLabel(g, tag, t);
    const ok = await ctx.confirm({ title: t('rcp.tagDelTitle', { name }), message: t('rcp.tagDelMsg', { n }), confirmLabel: t('common.delete'), danger: true });
    if (!ok || !open) return;
    ctx.mutate(st => deleteTag(st, g, tag, Date.now()), { undoLabel: t('rcp.tagDeleted', { name }) });
    // 预设删掉以后挪到下面「没用到的预设」，焦点给它的「不在选项里显示」（多半接着要点的就是它）；自己写的给下一行
    refresh(isPresetTag(g, tag) ? tagFid('hide', g, tag) : next ? tagFid('ren', g, next.tag) : null);
  }
  function hide(g, tag, on) {
    ctx.mutate(st => setTagHidden(st, g, tag, on, Date.now()));
    refresh(tagFid('hide', g, tag));
  }

  draw();
  return { sheet: s, refresh: () => refresh(), isOpen: () => open };
}
