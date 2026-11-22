// 设置 → 商店 / 分类用的面板：一个名字（新增分类时还有「用在哪种清单」）。点「保存」（新增时是「添加」）才存，有改动时关面板先问一句（ui/form.js）。
// 面板不在页面里：数据变了页面整页重画也不会打断输入。归档、删除这种马上生效的按钮由页面给（actions）：点了先关面板
// （有没保存的修改时先问「放弃修改？」），再做；要确认的由页面问。
import { h } from './dom.js';
import { t } from '../i18n.js';
import { field, showErr, discardGuard, closeThen, onEnter } from './form.js';

/**
 * nameSheet(ctx, { title, label, value, placeholder, help, kinds, submitLabel, focus, save, actions })
 *   kinds：{ label, value, options: [[值, 文字]…], help } 给了就多一组单选（新增分类时选用在哪种清单）
 *   save({ name, kind }) → core 的结果 { ok, errors }（errors.name 是文案的键）：ok 就关面板，不然把错误标在名字下面
 *   actions(act) → 名字下面的一组按钮（归档、删除）；act(fn) 是按钮的 onclick：关面板（有改动先问），再 fn()
 *   focus：打开就把光标放进名字（新增时；编辑时不弹键盘挡住下面的按钮）
 */
export function nameSheet(ctx, { title, label, value = '', placeholder = '', help = null, kinds = null, submitLabel = t('common.save'), focus = false, save, actions = null }) {
  const init = { name: value.trim(), kind: kinds ? kinds.value : null };
  let kind = init.kind;
  const nameIn = h('input.f-in', { type: 'text', value, maxlength: 80, placeholder, autocomplete: 'off', enterkeyhint: 'done',
    onkeydown: onEnter(() => submit()) });
  const nameRow = field(label, nameIn, { help });
  const kindRow = kinds ? field(kinds.label, h('div.kind-pick', { role: 'radiogroup' }, kinds.options.map(([v, text]) =>
    h('label.kind-opt', null,
      h('input', { type: 'radio', name: 'name-sheet-kind', value: v, checked: v === kind, onchange: () => { kind = v; } }),
      h('span.kind-text', null, h('b', null, text))))), { help: kinds.help }) : null;

  const dirty = () => nameIn.value.trim() !== init.name || kind !== init.kind;
  const s = ctx.sheet(h('div.form', null, nameRow, kindRow, actions ? h('div.sheet-actions', null, actions((fn) => closeThen(ctx, dirty, () => s, fn))) : null), {
    title, cls: 'name-sheet',
    beforeClose: discardGuard(ctx, dirty, () => s),
    foot: [
      h('button.btn', { type: 'button', onclick: () => s.close() }, t('common.cancel')),
      h('button.btn.primary', { type: 'button', onclick: () => submit() }, submitLabel),
    ],
  });
  if (focus) setTimeout(() => nameIn.focus(), 0);

  function submit() {
    const res = save({ name: nameIn.value.trim(), kind });
    if (res && res.ok === false) { showErr(nameRow, res.errors.name); nameIn.focus(); return; }
    s.close();
  }
  return s;
}
