// 「粘贴食材」的面板（编辑食谱里）：两步——
//   1. 把一整段食材贴进文本框（小红书的「食材：五花肉500g、生抽2勺…」、一行一样的、英文的都行），点「拆开看看」；
//   2. 看拆成了什么样（core/recipes.js 的 parseIngredients）：每样的名字、数量、单位、备注都能改，不要的点 × 去掉；「返回修改」回到文字（贴的字还在），
//      「加进去」交给编辑页（onInsert(rows)，接在已有的食材后面），还没保存：编辑页的「保存」才存。
// 贴了字、改过拆出来的再关面板，先问「放弃没保存的修改？」（和别的编辑面板一样）。
// 重复的（第 11 步）：这道菜里已经有的（have：编辑页现在的食材）、这次贴的上面已经有的（normName 一样）标「重复」，默认不加，
// 下面一个「仍然加一行」的勾（腌料、调味各一份盐）；改了名字（change）就地重新认，不重画（焦点不丢）。
import { h, icon } from './dom.js';
import { t } from '../i18n.js';
import { field, discardGuard } from './form.js';
import { parseIngredients } from '../core/recipes.js';
import { formatQty } from '../core/parse.js';
import { normName } from '../core/store.js';

/**
 * @typedef {{ name: string, qty: string, unit: string, note: string, optional: boolean, dup: { kind: 'have' | 'above', name: string } | null, add: boolean }} PasteRow
 * dup：和谁重复（have 这道菜里已经有、above 这次贴的上面已经有）；add：加不加（重复的默认不加）
 */
/**
 * pasteSheet(ctx, onInsert, { have })：onInsert([{ name, qty: 字符串, unit, note, optional }])（数量是输入框里的写法，编辑页照它的行画）；
 * have()：这道菜现在已经有的食材名字（认重复用）
 */
export function pasteSheet(ctx, onInsert, { have = () => [] } = {}) {
  let step = 1;
  /** @type {PasteRow[]} */
  let rows = [];
  /** @type {HTMLElement[]} 每一行里放「重复」的地方（按位置） */
  let slots = [];
  const ta = h('textarea.f-in.paste-in', { rows: 7, placeholder: t('rcp.pastePh'), dataset: { fid: 'paste-text' }, 'aria-label': t('rcp.paste') });
  const err = h('p.f-err.paste-err', { role: 'alert', hidden: true });
  const step1 = h('div.form.paste-1', null, field(t('rcp.paste'), ta, { help: t('rcp.pasteHelp') }), err);
  // 拆完焦点给这一句（不给第一个输入框：拆完是要扫一眼、点 × 的时候，iPhone 弹出键盘会盖住半张单子和「加进去」）
  const help2 = h('p.f-help.paste-help', { tabindex: -1 }, t('rcp.previewHelp'));
  const list = h('ul.paste-list');
  const dupHelp = h('p.f-help.paste-duphelp', { hidden: true }, t('rcp.previewDupHelp'));
  const step2 = h('div.form.paste-2', { hidden: true }, help2, dupHelp, list);
  const back = h('button.btn', { type: 'button', dataset: { fid: 'paste-back' }, onclick: () => (step === 1 ? s.tryClose() : toStep1()) }, t('common.cancel'));
  const go = h('button.btn.primary', { type: 'button', dataset: { fid: 'paste-go' }, onclick: () => (step === 1 ? split() : insert()) }, t('rcp.pasteGo'));
  const dirty = () => !!ta.value.trim();
  const s = ctx.sheet(h('div', null, step1, step2), {
    title: t('rcp.paste'), cls: 'paste-sheet',
    beforeClose: discardGuard(ctx, dirty, () => s),
    foot: [back, go],
  });

  function split() {
    const got = parseIngredients(ta.value);
    if (!got.length) { err.textContent = t('rcp.pasteNone'); err.hidden = false; ta.focus(); return; }
    err.hidden = true;
    rows = got.map(g => ({ name: g.name, qty: formatQty(g.qty), unit: g.unit, note: g.note, optional: g.optional, dup: null, add: true }));
    step = 2;
    step1.hidden = true; step2.hidden = false;
    back.textContent = t('rcp.pasteBack');
    drawRows();
    help2.focus();
  }
  function toStep1() {
    step = 1;
    step1.hidden = false; step2.hidden = true;
    back.textContent = t('common.cancel');
    go.textContent = t('rcp.pasteGo');
    s.setTitle(t('rcp.paste'));
    ta.focus();
  }
  /** 重新认哪几样重复：这道菜里已经有的 → 「这道菜里已经有」；这次贴的上面已经有的 → 「上面已经有」。刚变成重复的默认不加，不重复了就加 */
  function markDups() {
    const mine = new Map();
    for (const n of have()) { const k = normName(n); if (k && !mine.has(k)) mine.set(k, String(n).trim()); }
    const seen = new Map();
    for (const g of rows) {
      const k = normName(g.name), was = g.dup;
      g.dup = !k ? null : mine.has(k) ? { kind: 'have', name: mine.get(k) } : seen.has(k) ? { kind: 'above', name: seen.get(k) } : null;
      if (k && !seen.has(k)) seen.set(k, g.name.trim());
      if (g.dup && !was) g.add = false;
      else if (!g.dup) g.add = true;
    }
  }
  const adding = () => rows.filter(g => g.name.trim() && (!g.dup || g.add));
  function paintGo() { go.setAttribute('aria-disabled', String(!adding().length)); }
  /** 一行的「重复」：标签、和谁重复、「仍然加一行」的勾（就地改） */
  function paintDup(i) {
    const g = rows[i], slot = slots[i];
    if (!g || !slot) return;
    slot.hidden = !g.dup;
    if (!g.dup) { slot.replaceChildren(); return; }
    const box = h('input.paste-keep-box', { type: 'checkbox', checked: g.add, dataset: { fid: 'paste-keep-' + i },
      onchange: () => { g.add = box.checked; paintGo(); } });
    slot.replaceChildren(h('span.tag.paste-dup-tag', null, t('rcp.dupTag')),
      h('span.paste-dup-msg', null, t(g.dup.kind === 'have' ? 'rcp.dupHave' : 'rcp.dupAbove', { name: g.dup.name })),
      h('label.paste-keep', null, box, h('span', null, t('rcp.dupKeep'))));
  }
  function repaintDups() {
    markDups();
    rows.forEach((g, i) => paintDup(i));
    dupHelp.hidden = !rows.some(g => g.dup);
    paintGo();
  }
  // 拆出来的每样：名字、数量、单位、备注（输入框，改了就记下，不重画），× 去掉这一样。几样写在标题上（按钮上再写一遍，320 宽的手机上会折成两行）
  function drawRows() {
    s.setTitle(t('rcp.previewTitle', { n: rows.length }));
    go.textContent = t('rcp.pasteInsert');
    help2.textContent = rows.length ? t('rcp.previewHelp') : t('rcp.previewEmpty');
    list.hidden = !rows.length;
    slots = [];
    list.replaceChildren(...rows.map((g, i) => {
      const inp = (cls, key, label, extra = {}) => h('input.f-in.' + cls, { type: 'text', value: g[key], 'aria-label': t(label, { n: i + 1 }), autocomplete: 'off',
        oninput: (e) => { g[key] = e.target.value; }, ...extra });
      const slot = h('div.paste-dup');
      slots.push(slot);
      return h('li.paste-row', null,
        h('div.paste-main', null,
          inp('paste-name', 'name', 'rcp.rowName', { placeholder: t('rcp.ingName'), onchange: () => repaintDups() }),
          inp('paste-qty', 'qty', 'rcp.rowQty', { inputmode: 'decimal', placeholder: t('rcp.ingQty') }),
          inp('paste-unit', 'unit', 'rcp.rowUnit', { placeholder: t('rcp.ingUnit') }),
          h('button.icon-btn.paste-x', { type: 'button', 'aria-label': t('rcp.removeRow', { name: g.name || t('rcp.rowN', { n: i + 1 }) }), dataset: { fid: 'paste-x-' + i },
            onclick: () => {
              rows.splice(i, 1);
              drawRows();
              // 焦点给顶上来的那一行的 ×（没有了给上一行的，都没了给「返回修改」）
              const next = list.querySelector(`[data-fid="paste-x-${Math.min(i, rows.length - 1)}"]`);
              (next || back).focus();
            } }, icon('x'))),
        g.note || g.optional ? h('div.paste-sub', null,
          inp('paste-note', 'note', 'rcp.rowNote', { placeholder: t('rcp.ingNote') }),
          g.optional ? h('span.tag', null, t('rcp.optional')) : null) : null,
        slot);
    }));
    repaintDups();
  }
  function insert() {
    const keep = adding();
    if (!keep.length) return;
    s.close();
    onInsert(keep.map(({ name, qty, unit, note, optional }) => ({ name, qty, unit, note, optional })));
  }
  ta.focus();
  return s;
}
