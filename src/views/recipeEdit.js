// 编辑食谱（#/r/new 新建，#/r/<id>/edit 改）：名字、几人份（−/+，可以不写）、食材一行一样（名字、数量、单位、备注、「可选」；↑↓ 排顺序、删掉一行）、
// 「加一样」「粘贴食材」（面板在 ui/pasteIngredients.js：先看拆成什么样、能改，再加进来）、做法、来源、备注。
// 顶栏和 Babble 的编辑页一样：「取消」· 标题 ·「保存」（双栏右栏里「取消」照样显示：上一页是这道食谱，不是左栏）。
// 「保存」才存（core/recipes.js 的 saveRecipe：检查名字、几人份、每行的数量，有错标在那一项下面，焦点给第一个错的）；
// 新建的存好以后换成那道食谱的页面（替换掉 #/r/new 这一条历史），改的回到上一页。
// 改了没保存：「取消」、Esc、换页（底栏、侧栏、双栏左栏、浏览器后退）、关标签页都先问「放弃没保存的修改？」（ctx.guard，照 babble）。
// 没保存的修改随手另存在本机（picknest.draft.recipe.<id|new>，只在这台设备上，不同步）：iOS 在后台把 App 关掉（去小红书复制食材时常见）也不丢，
// 下次打开同一个编辑页时接着改（上面说一句，可以「放弃修改」）；保存、放弃时删掉。打字时 0.4 秒后存，切到后台（app 调 flush）、页面被收起（pagehide）
// 马上存：iOS 页面一隐藏就停掉计时器，最后 0.4 秒里打的、贴的字等不到。
// 自己管更新（返回 onChange）：别的设备同步来的改动不重画这一页（正在打的字不能被冲掉）；这道食谱在别的设备上删掉了，保存时问要不要存成新的。
import { h, icon, keepUnderFinger } from '../ui/dom.js';
import { t } from '../i18n.js';
import { field, showErr, onEnter } from '../ui/form.js';
import { liveRecipe, validateRecipe, saveRecipe } from '../core/recipes.js';
import { formatQty, readQty, stepQty } from '../core/parse.js';
import { canon, newId } from '../core/store.js';
import { isObj } from '../core/util.js';
import { pasteSheet } from '../ui/pasteIngredients.js';

export const DRAFT_PREFIX = 'picknest.draft.recipe.';
const defaultStorage = () => { try { return globalThis.localStorage || null; } catch (e) { return null; } };

/** 食谱 → 编辑页的工作副本（数量、几人份是输入框里的写法） */
export function workingCopy(r) {
  return {
    name: r ? r.name : '', servings: r && r.servings ? formatQty(r.servings) : '', steps: r ? r.steps : '', source: r ? r.source : '', note: r ? r.note : '',
    ings: r ? r.ings.map(g => ({ key: g.key, name: g.name, qty: formatQty(g.qty), unit: g.unit, note: g.note, optional: g.optional })) : [],
  };
}

/** @param {{ storage?: any }} [deps]  测试用：假的 localStorage */
export function render(main, params, ctx, deps = {}) {
  const isNew = params.sub === 'new';
  const id = isNew ? null : params.id;
  const storage = deps.storage !== undefined ? deps.storage : defaultStorage();
  const draftKey = DRAFT_PREFIX + (isNew ? 'new' : id);
  const src = id ? liveRecipe(ctx.state, id) : null;
  if (!isNew && !src) {
    queueMicrotask(() => { ctx.navigate('/recipes', { replace: true }); ctx.toast(t('rcp.gone')); });
    return undefined;
  }
  const backTo = isNew ? '/recipes' : '/r/' + encodeURIComponent(id);
  let base = canon(workingCopy(src));

  // ---------- 另存的草稿 ----------
  function readDraft() {
    try { const d = storage && JSON.parse(storage.getItem(draftKey) || 'null'); return isObj(d) && isObj(d.w) && Array.isArray(d.w.ings) ? d.w : null; } catch (e) { return null; }
  }
  let persistTimer = null;
  function persist() {
    clearTimeout(persistTimer); persistTimer = null;
    try { if (!storage) return; if (dirty()) storage.setItem(draftKey, JSON.stringify({ w, at: Date.now() })); else storage.removeItem(draftKey); } catch (e) { /* 存不下就算了：只是保险 */ }
  }
  const persistSoon = () => { clearTimeout(persistTimer); persistTimer = setTimeout(persist, 400); };
  function dropDraft() { clearTimeout(persistTimer); persistTimer = null; try { if (storage) storage.removeItem(draftKey); } catch (e) { /* 同上 */ } }

  const draft = readDraft();
  const w = draft ? { ...workingCopy(src), ...draft, ings: draft.ings.map(g => ({ key: String(g.key || newId('g_')), name: String(g.name ?? ''), qty: String(g.qty ?? ''), unit: String(g.unit ?? ''), note: String(g.note ?? ''), optional: g.optional === true })) } : workingCopy(src);
  if (draft && canon(w) === base) dropDraft();
  const dirty = () => canon(w) !== base;
  let done = false;                   // 存好了 / 放弃了：离开时不再问、不再另存
  // 在别处换页、点了「放弃」：删掉另存的草稿（不然下次打开又回来了）
  ctx.guard(() => !done && dirty(), () => { done = true; dropDraft(); });

  // ---------- 顶栏 ----------
  const navbar = h('header.navbar.lp-nav.push-nav', null,
    h('button.back.text', { type: 'button', dataset: { fid: 're-cancel' }, onclick: () => cancel() }, t('common.cancel')),
    h('h1.nb-title', { tabindex: -1, dataset: { fid: 'lp-title' } }, t(isNew ? 'rcp.newTitle' : 'rcp.editTitle')),
    h('button.tb-btn.re-save', { type: 'button', dataset: { fid: 're-save' }, onclick: () => save() }, t('common.save')));

  const enter = onEnter(() => save());
  const touched = () => persistSoon();
  const nameIn = h('input.f-in', { type: 'text', value: w.name, maxlength: 200, placeholder: t('rcp.namePh'), autocomplete: 'off', enterkeyhint: 'done', dataset: { fid: 're-name' },
    onkeydown: enter, oninput: () => { w.name = nameIn.value; touched(); } });
  const nameRow = field(t('rcp.name'), nameIn);

  // 几人份：−/+ 每次 1，减到 0 就是不写
  const svIn = h('input.f-in.qty-in', { type: 'text', inputmode: 'decimal', value: w.servings, placeholder: t('rcp.servingsPh'), autocomplete: 'off', enterkeyhint: 'done',
    dataset: { fid: 're-sv' }, onkeydown: enter, oninput: () => { w.servings = svIn.value; touched(); } });
  const svStep = (dir) => { const q = readQty(svIn.value); svIn.value = formatQty(stepQty(Number.isFinite(q) ? q : null, dir)); w.servings = svIn.value; touched(); };
  const svRow = field(t('rcp.servings'), svIn, { wrap: h('div.stepper', null,
    h('button.icon-btn.step-btn', { type: 'button', 'aria-label': t('rcp.servingsDec'), onclick: () => svStep(-1) }, icon('minus')),
    svIn,
    h('button.icon-btn.step-btn', { type: 'button', 'aria-label': t('rcp.servingsInc'), onclick: () => svStep(1) }, icon('plus'))), help: t('rcp.servingsHelp') });

  // ---------- 食材 ----------
  const rowsEl = h('ul.re-rows');
  const rowErr = new Map();           // key → 文案的键（保存时标的错）
  const emptyNote = h('p.group-foot.re-empty', null, t('rcp.rowsEmpty'));
  const nameOf = (g, i) => g.name.trim() || t('rcp.rowN', { n: i + 1 });
  function drawRows() {
    emptyNote.hidden = w.ings.length > 0;
    rowsEl.hidden = !w.ings.length;
    rowsEl.replaceChildren(...w.ings.map((g, i) => {
      const inp = (cls, key, label, extra = {}) => h('input.f-in.' + cls, { type: 'text', value: g[key], 'aria-label': t(label, { n: i + 1 }), autocomplete: 'off',
        dataset: { fid: `re-${key}-${g.key}` }, oninput: (e) => { g[key] = e.target.value; touched(); }, ...extra });
      const mv = (dir) => {
        const j = i + dir, edge = j < 0 || j >= w.ings.length, fid = `re-${dir < 0 ? 'up' : 'down'}-${g.key}`;
        return h('button.icon-btn.mv-btn', { type: 'button', 'aria-label': t(dir < 0 ? 'rcp.moveUp' : 'rcp.moveDown', { name: nameOf(g, i) }), 'aria-disabled': String(edge), dataset: { fid },
          onclick: () => { if (!edge) keepUnderFinger(ctx, main, fid, () => { const [x] = w.ings.splice(i, 1); w.ings.splice(j, 0, x); touched(); redrawRows(fid); }); } },
        icon(dir < 0 ? 'up' : 'down'));
      };
      const opt = h('button.chip.re-opt', { type: 'button', 'aria-pressed': String(g.optional), 'aria-label': t('rcp.rowOptional', { name: nameOf(g, i) }), dataset: { fid: 're-opt-' + g.key },
        onclick: () => { g.optional = !g.optional; opt.setAttribute('aria-pressed', String(g.optional)); touched(); } }, t('rcp.optional'));
      const err = h('p.f-err', { role: 'alert', hidden: !rowErr.has(g.key) }, rowErr.has(g.key) ? t(rowErr.get(g.key)) : '');
      return h('li.re-row', { dataset: { key: g.key } },
        h('div.re-main', null,
          inp('re-name', 'name', 'rcp.rowName', { placeholder: t('rcp.ingName'), maxlength: 200, enterkeyhint: 'next' }),
          inp('re-qty', 'qty', 'rcp.rowQty', { placeholder: t('rcp.ingQty'), inputmode: 'decimal', 'aria-invalid': rowErr.get(g.key) === 'rcp.err.ingQty' ? 'true' : null }),
          inp('re-unit', 'unit', 'rcp.rowUnit', { placeholder: t('rcp.ingUnit'), maxlength: 20 })),
        h('div.re-sub', null,
          inp('re-note', 'note', 'rcp.rowNote', { placeholder: t('rcp.ingNote') }),
          opt,
          h('span.re-acts', null, mv(-1), mv(1),
            h('button.icon-btn.re-del', { type: 'button', 'aria-label': t('rcp.removeRow', { name: nameOf(g, i) }), dataset: { fid: 're-del-' + g.key },
              onclick: () => removeRow(i) }, icon('trash')))),
        err);
    }));
  }
  /** 重画食材以后焦点放回同一个按钮（↑↓ 连着按挪的还是同一样） */
  function redrawRows(fid) {
    drawRows();
    const el = fid ? main.querySelector(`[data-fid="${fid}"]`) : null;
    if (el) el.focus({ preventScroll: true });
  }
  function removeRow(i) {
    const [gone] = w.ings.splice(i, 1);
    touched();
    drawRows();
    // 焦点给顶上来的那一行的删除按钮（删的是最后一行就给上一行，都没了给「加一样」）
    const next = w.ings[Math.min(i, w.ings.length - 1)];
    const el = next ? main.querySelector(`[data-fid="re-del-${next.key}"]`) : addBtn;
    if (el) el.focus({ preventScroll: true });
    // 删掉一行不问（编辑页的「取消」整个都能放弃），但手湿着点偏了一点就少一样：写过东西的行给 10 秒「撤销」，放回原来的位置
    if (gone && (gone.name.trim() || gone.qty.trim() || gone.unit.trim() || gone.note.trim())) {
      ctx.toast(t('rcp.rowRemoved', { name: nameOf(gone, i) }), { ms: 10000, action: { label: t('common.undo'), run: () => {
        if (done || unmounted || w.ings.some(g => g.key === gone.key)) return;
        w.ings.splice(Math.min(i, w.ings.length), 0, gone);
        touched();
        redrawRows(`re-del-${gone.key}`);
      } } });
    }
  }
  const blank = (x = {}) => ({ key: newId('g_'), name: '', qty: '', unit: '', note: '', optional: false, ...x });
  const addBtn = h('button.btn.re-add', { type: 'button', dataset: { fid: 're-add' }, onclick: () => {
    w.ings.push(blank());
    touched();
    drawRows();
    const el = main.querySelector(`[data-fid="re-name-${w.ings[w.ings.length - 1].key}"]`);
    if (el) el.focus();
  } }, icon('plus'), t('rcp.addRow'));
  const pasteBtn = h('button.btn.re-paste', { type: 'button', dataset: { fid: 're-paste' }, onclick: () => pasteSheet(ctx, (got) => {
    // 只有一行空的（刚点了「加一样」还没写）：换掉它，不留一个空行在中间
    if (w.ings.length && w.ings.every(g => !g.name.trim() && !g.qty.trim() && !g.unit.trim() && !g.note.trim())) w.ings = [];
    const added = got.map(g => blank(g));
    w.ings.push(...added);
    touched();
    drawRows();
    ctx.toast(t('rcp.pasted', { n: added.length }));
    // 焦点回到「粘贴食材」（不给新的一行的输入框：iPhone 会弹出键盘盖住刚加的那几样），刚加的第一样滚到看得见
    const first = main.querySelector(`[data-fid="re-name-${added[0].key}"]`);
    if (first && first.scrollIntoView) first.scrollIntoView({ block: 'nearest' });
    pasteBtn.focus({ preventScroll: true });
  }) }, icon('paste'), t('rcp.paste'));

  const stepsIn = h('textarea.f-in.re-steps', { rows: 6, value: w.steps, placeholder: t('rcp.stepsPh'), dataset: { fid: 're-steps' }, oninput: () => { w.steps = stepsIn.value; touched(); } });
  const sourceIn = h('input.f-in', { type: 'text', value: w.source, placeholder: t('rcp.sourcePh'), autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', enterkeyhint: 'done',
    dataset: { fid: 're-source' }, onkeydown: enter, oninput: () => { w.source = sourceIn.value; touched(); } });
  const noteIn = h('textarea.f-in', { rows: 3, value: w.note, dataset: { fid: 're-note' }, oninput: () => { w.note = noteIn.value; touched(); } });

  const banner = draft && dirty() ? h('div.lp-banner.re-draft', { role: 'status' }, h('span', null, t('rcp.draftBack')),
    h('button.btn.small', { type: 'button', dataset: { fid: 're-drop' }, onclick: () => discard() }, t('rcp.draftDrop'))) : null;

  main.append(navbar, h('div.page.form.re-form', null,
    banner,
    nameRow,
    svRow,
    h('div.f-row.re-ings', null, h('h2.group-h', null, t('rcp.ings')), emptyNote, rowsEl, h('div.re-ing-acts', null, addBtn, pasteBtn)),
    field(t('rcp.steps'), stepsIn),
    field(t('rcp.source'), sourceIn),
    field(t('rcp.note'), noteIn)));
  drawRows();
  if (isNew && !draft) nameIn.focus({ preventScroll: true });

  // ---------- 保存、取消 ----------
  let saving = false;
  async function save() {
    if (saving) return;
    const v = validateRecipe(w);
    showErr(nameRow, v.errors.name);
    showErr(svRow, v.errors.servings);
    rowErr.clear();
    for (const [i, key] of Object.entries(v.errors.ings || {})) rowErr.set(w.ings[Number(i)].key, key);
    if (!v.ok) {
      drawRows();
      const firstRow = Object.keys(v.errors.ings || {})[0];
      const el = v.errors.name ? nameIn : v.errors.servings ? svIn
        : main.querySelector(`[data-fid="re-${rowErr.get(w.ings[Number(firstRow)].key) === 'rcp.err.ingQty' ? 'qty' : 'name'}-${w.ings[Number(firstRow)].key}"]`);
      if (el) el.focus();
      return;
    }
    drawRows();
    let target = id;
    if (id && !liveRecipe(ctx.state, id)) {
      // 在别的设备上删掉了：存成一道新的（问一下），不然改的全丢了
      saving = true;
      const ok = await ctx.confirm({ message: t('rcp.goneSaveQ'), confirmLabel: t('rcp.saveNew') });
      saving = false;
      if (!ok) return;
      target = null;
    }
    const res = ctx.mutate(s => saveRecipe(s, target, w, Date.now()));
    if (!res.ok) { if (res.errors.recipe) ctx.toast(t(res.errors.recipe)); return; }
    done = true;
    dropDraft();
    ctx.guard(null);
    if (!target) ctx.navigate('/r/' + encodeURIComponent(res.id), { replace: true });
    else ctx.back(backTo);
  }
  async function cancel() {
    if (dirty() && !done && !(await ctx.confirm({ message: t('item.discardQ'), cancelLabel: t('common.keepEditing'), confirmLabel: t('item.discard'), danger: true }))) return;
    done = true;
    dropDraft();
    ctx.guard(null);
    ctx.back(backTo);
  }
  /** 横幅上的「放弃修改」：丢掉另存的草稿，回到这道食谱现在的样子（新建的回到空白） */
  function discard() {
    dropDraft();
    Object.assign(w, workingCopy(src && liveRecipe(ctx.state, id)));
    base = canon(w);
    nameIn.value = w.name; svIn.value = w.servings; stepsIn.value = w.steps; sourceIn.value = w.source; noteIn.value = w.note;
    rowErr.clear();
    drawRows();
    if (banner) banner.remove();
    nameIn.focus({ preventScroll: true });
  }
  // Esc = 取消（面板开着时是面板自己的 Esc）。听这一页自己（照 babble）：双栏时左栏「食谱」搜索框里的 Esc 是清空搜索，不能连带把右栏的编辑取消了
  function onKey(e) {
    if (e.key !== 'Escape' || e.isComposing || e.defaultPrevented || document.querySelector('dialog[open]')) return;
    e.preventDefault();
    cancel();
  }
  main.addEventListener('keydown', onKey);
  // 页面被收起（关标签页、Safari 换页）：马上存一份，之后可能直接没了
  const onPageHide = () => { if (!done) persist(); };
  window.addEventListener('pagehide', onPageHide);
  let unmounted = false;

  return {
    onChange() {},
    // 切到后台（app 在 visibilitychange → hidden 时调）：马上存，不等 0.4 秒（iOS 页面一隐藏就停掉计时器，之后可能被系统直接关掉）
    flush() { if (!done) persist(); },
    cleanup() {
      unmounted = true;
      main.removeEventListener('keydown', onKey);
      window.removeEventListener('pagehide', onPageHide);
      if (!done) persist(); else dropDraft();
    },
  };
}
