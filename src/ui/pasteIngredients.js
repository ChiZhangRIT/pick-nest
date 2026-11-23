// 「粘贴食材」的面板（编辑食谱里）：两步——
//   1. 把一整段食材贴进文本框（小红书的「食材：五花肉500g、生抽2勺…」、一行一样的、英文的都行），点「拆开看看」；
//   2. 看拆成了什么样（core/recipes.js 的 parseIngredients）：每样的名字、数量、单位、备注都能改，不要的点 × 去掉；「返回修改」回到文字（贴的字还在），
//      「加进去」交给编辑页（onInsert(rows)，接在已有的食材后面），还没保存：编辑页的「保存」才存。
// 贴了字、改过拆出来的再关面板，先问「放弃没保存的修改？」（和别的编辑面板一样）。
import { h, icon } from './dom.js';
import { t } from '../i18n.js';
import { field, discardGuard } from './form.js';
import { parseIngredients } from '../core/recipes.js';
import { formatQty } from '../core/parse.js';

/**
 * pasteSheet(ctx, onInsert)：onInsert([{ name, qty: 字符串, unit, note, optional }])（数量是输入框里的写法，编辑页照它的行画）
 */
export function pasteSheet(ctx, onInsert) {
  let step = 1;
  /** @type {{ name: string, qty: string, unit: string, note: string, optional: boolean }[]} */
  let rows = [];
  const ta = h('textarea.f-in.paste-in', { rows: 7, placeholder: t('rcp.pastePh'), dataset: { fid: 'paste-text' }, 'aria-label': t('rcp.paste') });
  const err = h('p.f-err.paste-err', { role: 'alert', hidden: true });
  const step1 = h('div.form.paste-1', null, field(t('rcp.paste'), ta, { help: t('rcp.pasteHelp') }), err);
  // 拆完焦点给这一句（不给第一个输入框：拆完是要扫一眼、点 × 的时候，iPhone 弹出键盘会盖住半张单子和「加进去」）
  const help2 = h('p.f-help.paste-help', { tabindex: -1 }, t('rcp.previewHelp'));
  const list = h('ul.paste-list');
  const step2 = h('div.form.paste-2', { hidden: true }, help2, list);
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
    rows = got.map(g => ({ name: g.name, qty: formatQty(g.qty), unit: g.unit, note: g.note, optional: g.optional }));
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
  // 拆出来的每样：名字、数量、单位、备注（输入框，改了就记下，不重画），× 去掉这一样。几样写在标题上（按钮上再写一遍，320 宽的手机上会折成两行）
  function drawRows() {
    s.setTitle(t('rcp.previewTitle', { n: rows.length }));
    go.textContent = t('rcp.pasteInsert');
    go.setAttribute('aria-disabled', String(!rows.length));
    help2.textContent = rows.length ? t('rcp.previewHelp') : t('rcp.previewEmpty');
    list.hidden = !rows.length;
    list.replaceChildren(...rows.map((g, i) => {
      const inp = (cls, key, label, extra = {}) => h('input.f-in.' + cls, { type: 'text', value: g[key], 'aria-label': t(label, { n: i + 1 }), autocomplete: 'off',
        oninput: (e) => { g[key] = e.target.value; }, ...extra });
      return h('li.paste-row', null,
        h('div.paste-main', null,
          inp('paste-name', 'name', 'rcp.rowName', { placeholder: t('rcp.ingName') }),
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
          g.optional ? h('span.tag', null, t('rcp.optional')) : null) : null);
    }));
  }
  function insert() {
    const keep = rows.filter(g => g.name.trim());
    if (!keep.length) return;
    s.close();
    onInsert(keep);
  }
  ta.focus();
  return s;
}
