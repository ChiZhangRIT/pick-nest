// 面板里的表单小部件（新建 / 编辑清单、编辑一样东西、商店和分类的名字共用）：一行字段（标题、控件、说明、错误）、回车提交、
// 关面板前问「放弃修改？」（面板里马上生效的归档、删除也先问）。
import { h } from './dom.js';
import { t } from '../i18n.js';

let seq = 0;
/** 控件没有 id 就给一个，标题的 <label for> 才点得到它 */
const idOf = (el) => el.id || (el.id = 'f' + (++seq));

/**
 * 一个字段：标题、控件、说明（可选），下面留一个放错误的位置（返回的元素上的 .err，showErr 用）
 * control 是 input / select / textarea 时标题是 <label for>；别的（分段按钮、一组按钮）用 <div> + aria-labelledby。
 * wrap：控件外面套着的一层（数量的 −/+、链接旁边的「打开」），画它而不是 control；extra：控件下面再放的东西（单位的快捷选项）
 */
export function field(label, control, { help = null, wrap = null, extra = null } = {}) {
  const plain = /^(INPUT|SELECT|TEXTAREA)$/.test(control.tagName);
  const lab = plain ? h('label.f-label', { for: idOf(control) }, label) : h('div.f-label', { id: 'fl' + (++seq) }, label);
  if (!plain) control.setAttribute('aria-labelledby', lab.id);
  const err = h('p.f-err', { role: 'alert', hidden: true });
  const row = h('div.f-row', null, lab, wrap || control, extra, help ? h('p.f-help', null, help) : null, err);
  row.err = err;
  row.control = control;
  return row;
}

/** 在字段下面显示错误（文案的键 → 文字），没有错误就收起来；有错的控件标 aria-invalid */
export function showErr(row, key, vars) {
  row.err.textContent = key ? t(key, vars) : '';
  row.err.hidden = !key;
  if (key) row.control.setAttribute('aria-invalid', 'true'); else row.control.removeAttribute('aria-invalid');
}

/**
 * 输入法还在选字（中文、日文）：这时的回车是选字，不是提交。Safari 先结束选字再发回车的 keydown，那时 isComposing 已经是 false，
 * 只能靠 keyCode 229 认出来
 */
export const composing = (e) => e.isComposing || e.keyCode === 229;
/** 输入框的 onkeydown：回车（不是选字的）= fn() */
export const onEnter = (fn) => (e) => { if (e.key === 'Enter' && !composing(e)) { e.preventDefault(); fn(); } };

const askDiscard = (ctx) => ctx.confirm({ message: t('item.discardQ'), confirmLabel: t('item.discard'), danger: true });
/**
 * 给 sheet 的 beforeClose 用：有没保存的修改时先不关，问一句「放弃这次的修改？」，确定了才关。
 * getSheet() 返回 sheet() 的结果（beforeClose 在 sheet 建好以后才会被调用）
 */
export function discardGuard(ctx, isDirty, getSheet) {
  return () => {
    if (!isDirty()) return true;
    askDiscard(ctx).then(ok => { if (ok) getSheet().close(); });
    return false;
  };
}
/**
 * 面板里马上生效的按钮（归档、删除）的 onclick：和关面板一样，有没保存的修改时先问「放弃这次的修改？」，
 * 放弃了（或者没改过）才关面板、做 fn。不然改了名字再点「归档」，改的名字就悄悄丢了
 */
export function closeThen(ctx, isDirty, getSheet, fn) {
  return async () => {
    if (isDirty() && !(await askDiscard(ctx))) return;
    getSheet().close();
    fn();
  };
}
