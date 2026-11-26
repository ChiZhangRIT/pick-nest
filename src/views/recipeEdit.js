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
// 第 11 步：
//   - 标签：「菜系」「风格」两组开关（预设按界面语言写出来、别的食谱用过的、自己加的：core/recipes.js 的 tagChoices），「自己加」开一个名字面板
//   - 食材的默认顺序：粘贴进来的马上按类别放好（placeIngredients），「加一样」写的保存时再放（写着名字的时候行不能跳走：iPhone 上点同一行的数量框
//     名字框就失去焦点，这时挪走就点空了）；↑↓ 排过（ordered）、已经存过的食谱，新加的只放进它那一组的最后（原来的几行不自己挪）；
//     「按类别重新排」整张排一次、去掉 ordered
//   - 重复的食材：名字写好（change）时这道菜里已经有同一样（duplicateOf）→ 这一行下面提醒「这道菜里已经有「生抽」了」[合并] [仍然加一行]；
//     提醒是就地插进这一行的，不重画（不然刚点的下一个输入框就没了）
// 第 12 步：成品图（几人份下面）：「添加成品图」打开系统的选图（<input type=file accept=image/*>：iPhone 上能拍照、从相册选）→
//   压缩成长边 1600 px 的 JPEG（ui/photo.js 的 encodePhoto）→ 存进本机的图片库（ctx.photos.put，按 sha256）→ 工作副本的 photo 换成它；
//   有图时「换一张」「删除图片」（删了 10 秒内能撤销）。和别的修改一样点「保存」才算。这次加的图保存、取消、放弃时还没有食谱用着
//  （也不在别的草稿里）的从本机删掉（只删从来没上传过的）：不然换几次图本机就多几张没用的
// 第 13 步：食材下面「每人份营养」（热量千卡、蛋白质 / 碳水 / 脂肪克，手动填的，都能不填）：日历里「吃了」这道菜时用它；
//   写错的（读不出来、负数、太大）保存时标在那一格下面（core/foods.js 的 readNutrition，validateRecipe 的 errors.nutrition）
import { h, icon, keepUnderFinger } from '../ui/dom.js';
import { t } from '../i18n.js';
import { field, showErr, onEnter } from '../ui/form.js';
import { liveRecipe, validateRecipe, saveRecipe, sortIngredients, placeIngredients, duplicateOf, mergeIngredient, tagChoices, addTag, removeTag, hasTag,
  RECIPE_TAG_PRESETS } from '../core/recipes.js';
import { formatQty, readQty, stepQty } from '../core/parse.js';
import { canon, newId, normName, hash64, normalizeTags, normalizePhoto, TAG_GROUPS, NUTRIENTS } from '../core/store.js';
import { photoInUse } from '../core/photo.js';
import { photoPool, encodePhoto, PhotoError } from '../ui/photo.js';
import { collatorFor } from '../core/group.js';
import { isObj } from '../core/util.js';
import { pasteSheet } from '../ui/pasteIngredients.js';
import { nameSheet } from '../ui/nameSheet.js';

export const DRAFT_PREFIX = 'picknest.draft.recipe.';
const defaultStorage = () => { try { return globalThis.localStorage || null; } catch (e) { return null; } };

/** 食谱 → 编辑页的工作副本（数量、几人份是输入框里的写法） */
export function workingCopy(r) {
  return {
    name: r ? r.name : '', servings: r && r.servings ? formatQty(r.servings) : '', steps: r ? r.steps : '', source: r ? r.source : '', note: r ? r.note : '',
    ings: r ? r.ings.map(g => ({ key: g.key, name: g.name, qty: formatQty(g.qty), unit: g.unit, note: g.note, optional: g.optional })) : [],
    tags: normalizeTags(r && r.tags), ordered: !!(r && r.ordered), photo: normalizePhoto(r && r.photo),
    nutrition: nutStrings(r && r.nutrition),
  };
}
/** 每人份营养 → 四个输入框里的字（没填的是空的；旧版的草稿、坏了的整理一下） @param {any} n */
function nutStrings(n) {
  return Object.fromEntries(NUTRIENTS.map(k => [k, isObj(n) && n[k] != null ? String(typeof n[k] === 'number' ? formatQty(n[k]) : n[k]) : '']));
}

/** 本机另存的编辑食谱草稿里用着的图（sha）：放弃这一页时不能删掉别的草稿里刚加的那张 @param {any} storage */
function draftPhotos(storage) {
  const out = new Set();
  try {
    for (let i = 0; storage && i < storage.length; i++) {
      const k = storage.key(i);
      if (!k || !k.startsWith(DRAFT_PREFIX)) continue;
      const d = JSON.parse(storage.getItem(k) || 'null');
      const p = d && d.w && normalizePhoto(d.w.photo);
      if (p) out.add(p.sha256);
    }
  } catch (e) { /* 读不出来的草稿不算 */ }
  return out;
}

/** @param {{ storage?: any, encodePhoto?: typeof encodePhoto }} [deps]  测试用：假的 localStorage、假的图片压缩（不用浏览器解码） */
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
    try { const d = storage && JSON.parse(storage.getItem(draftKey) || 'null'); return isObj(d) && isObj(d.w) && Array.isArray(d.w.ings) ? d : null; } catch (e) { return null; }
  }
  let persistTimer = null;
  function persist() {
    clearTimeout(persistTimer); persistTimer = null;
    try { if (!storage) return; if (dirty()) storage.setItem(draftKey, JSON.stringify({ w, place: [...fresh], at: Date.now() })); else storage.removeItem(draftKey); } catch (e) { /* 存不下就算了：只是保险 */ }
  }
  const persistSoon = () => { clearTimeout(persistTimer); persistTimer = setTimeout(persist, 400); };
  function dropDraft() { clearTimeout(persistTimer); persistTimer = null; try { if (storage) storage.removeItem(draftKey); } catch (e) { /* 同上 */ } }

  const saved = readDraft(), draft = saved && saved.w;
  const w = draft ? { ...workingCopy(src), ...draft, ings: draft.ings.map(g => ({ key: String(g.key || newId('g_')), name: String(g.name ?? ''), qty: String(g.qty ?? ''), unit: String(g.unit ?? ''), note: String(g.note ?? ''), optional: g.optional === true })) } : workingCopy(src);
  // 旧版存的草稿没有标签、ordered：用这道食谱现在的；坏了的整理一下
  w.tags = normalizeTags(draft && draft.tags !== undefined ? draft.tags : w.tags);
  w.ordered = w.ordered === true;
  w.photo = normalizePhoto(w.photo);       // 旧版存的草稿没有 photo：上面已经是这道食谱现在的
  w.nutrition = nutStrings(w.nutrition);   // 旧版存的草稿没有 nutrition：上面已经是这道食谱现在的
  // 「加一样」写的、还没按类别放好的那几行（保存时放：saveRecipe 的 place）；草稿里也记着，接着改时照样放
  const fresh = new Set(saved && Array.isArray(saved.place) ? saved.place.filter(k => typeof k === 'string') : []);
  if (draft && canon(w) === base) dropDraft();
  const dirty = () => canon(w) !== base;
  let done = false;                   // 存好了 / 放弃了：离开时不再问、不再另存
  // 在别处换页、点了「放弃」：删掉另存的草稿（不然下次打开又回来了）
  ctx.guard(() => !done && dirty(), () => { done = true; dropDraft(); sweep(); });

  // ---------- 顶栏 ----------
  const navbar = h('header.navbar.lp-nav.push-nav', null,
    h('button.back.text', { type: 'button', dataset: { fid: 're-cancel' }, onclick: () => cancel() }, t('common.cancel')),
    h('h1.nb-title', { tabindex: -1, dataset: { fid: 'lp-title' } }, t(isNew ? 'rcp.newTitle' : 'rcp.editTitle')),
    h('button.tb-btn.re-save', { type: 'button', dataset: { fid: 're-save' }, onclick: () => save() }, t('common.save')));

  // 回车（iPhone 键盘上的「下一项」「完成」）不保存：新建时名字一打完点「完成」收键盘，就成了只有名字的食谱、跳到食谱页。
  // 名字 → 几人份，几人份、来源 → 收起键盘；保存是顶栏的「保存」或 ⌘S / ⌘回车（照 babble 的编辑页）
  const touched = () => persistSoon();
  const nameIn = h('input.f-in', { type: 'text', value: w.name, maxlength: 200, placeholder: t('rcp.namePh'), autocomplete: 'off', enterkeyhint: 'next', dataset: { fid: 're-name' },
    onkeydown: onEnter(() => svIn.focus()), oninput: () => { w.name = nameIn.value; touched(); } });
  const nameRow = field(t('rcp.name'), nameIn);

  // 几人份：−/+ 每次 1，减到 0 就是不写
  const svIn = h('input.f-in.qty-in', { type: 'text', inputmode: 'decimal', value: w.servings, placeholder: t('rcp.servingsPh'), autocomplete: 'off', enterkeyhint: 'done',
    dataset: { fid: 're-sv' }, onkeydown: onEnter(() => svIn.blur()), oninput: () => { w.servings = svIn.value; touched(); } });
  const svStep = (dir) => { const q = readQty(svIn.value); svIn.value = formatQty(stepQty(Number.isFinite(q) ? q : null, dir)); w.servings = svIn.value; touched(); };
  const svRow = field(t('rcp.servings'), svIn, { wrap: h('div.stepper', null,
    h('button.icon-btn.step-btn', { type: 'button', 'aria-label': t('rcp.servingsDec'), onclick: () => svStep(-1) }, icon('minus')),
    svIn,
    h('button.icon-btn.step-btn', { type: 'button', 'aria-label': t('rcp.servingsInc'), onclick: () => svStep(1) }, icon('plus'))), help: t('rcp.servingsHelp') });

  // ---------- 成品图 ----------
  const encode = deps.encodePhoto || encodePhoto;
  const photos = photoPool(ctx, main);
  const added = new Set();            // 这次编辑里加进本机的图（sha）：保存、放弃时没有食谱用着的删掉
  // 接着上次的草稿：草稿里换上的那张也是这个编辑页加的（放弃草稿时一样要删，不然一直留在本机）
  if (draft && w.photo && !(src && src.photo && src.photo.sha256 === w.photo.sha256)) added.add(w.photo.sha256);
  let photoBusy = false, photoErr = '';
  /** @type {Promise<boolean> | null} */
  let photoJob = null;                // 正在处理的那张（保存时先等它：不然存下的是没有这张图的食谱，处理好的图也被当成没用的删掉）
  const photoIn = h('input', { type: 'file', accept: 'image/*', hidden: true, dataset: { fid: 're-photo-file' },
    onchange: (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) addPhoto(f); } });
  // 一组按钮（「换一张」「删除图片」）：role=group 读屏才把「成品图」这个标题和按钮一起念
  const photoBox = h('div.re-photo', { role: 'group' });
  const photoRow = field(t('rcp.photo'), photoBox, { help: t('rcp.photo.help') });
  function drawPhoto() {
    const p = w.photo;
    const status = photoBusy ? h('p.small.muted.re-photo-busy', { role: 'status' }, t('rcp.photo.busy')) : null;
    const err = photoErr ? h('p.f-err', { role: 'alert' }, t(photoErr)) : null;
    if (!p) {
      photoBox.replaceChildren(...[
        h('button.btn.re-photo-add', { type: 'button', disabled: photoBusy, dataset: { fid: 're-photo-add' }, onclick: () => photoIn.click() }, icon('photo'), t('rcp.photo.add')),
        status, err, photoIn].filter(Boolean));
      return;
    }
    photoBox.replaceChildren(...[
      h('div.re-photo-has', null,
        photos.view(p, { cls: '.re-photo-thumb', alt: t('rcp.photo.alt', { name: w.name.trim() || t('rcp.untitled') }) }),
        h('div.re-photo-acts', null,
          h('button.btn', { type: 'button', disabled: photoBusy, dataset: { fid: 're-photo-replace' }, onclick: () => photoIn.click() }, t('rcp.photo.replace')),
          h('button.btn.danger', { type: 'button', disabled: photoBusy, dataset: { fid: 're-photo-remove' }, onclick: () => removePhoto() }, t('rcp.photo.remove')))),
      status, err, photoIn].filter(Boolean));
  }
  /** 选好了一张：压缩、存进本机、换上（还没保存）；压缩不了、存不了 → 这一栏下面说一句，原来的图不动。→ 换上了没有 */
  function addPhoto(file) {
    if (photoBusy) return photoJob;
    photoJob = processPhoto(file);
    return photoJob;
  }
  async function processPhoto(file) {
    photoBusy = true; photoErr = '';
    drawPhoto();
    let put = null, size = null;
    try {
      if (!ctx.photos) throw new Error('no-store');
      const out = await encode(file);
      size = out;
      try { put = await ctx.photos.put(out.blob); } catch (e) { throw new Error('store'); }
    } catch (e) {
      photoErr = e instanceof PhotoError ? 'rcp.photo.err.' + e.code : 'rcp.photo.err.store';
    }
    photoBusy = false;
    if (unmounted || done) { if (put) sweep([put.sha256]); return false; }
    if (put && size) {
      added.add(put.sha256);
      w.photo = normalizePhoto({ sha256: put.sha256, mime: put.mime, w: size.w, h: size.h, bytes: put.bytes });
      touched();
    }
    drawPhoto();
    // 点了保存在等它的话焦点不动（马上就离开这一页了；没处理成的话 save 自己把焦点给这一栏）
    if (!saving) focusFid(w.photo ? 're-photo-replace' : 're-photo-add');
    return !!(put && size);
  }
  function removePhoto() {
    const prev = w.photo;
    if (!prev) return;
    w.photo = null; photoErr = '';
    touched();
    drawPhoto();
    focusFid('re-photo-add');
    ctx.toast(t('rcp.photo.removed'), { ms: 10000, action: { label: t('common.undo'), run: () => {
      if (done || unmounted || w.photo) return;
      w.photo = prev;
      touched();
      drawPhoto();
      focusFid('re-photo-replace');
    } } });
  }
  /** 这次加的图里，没有食谱用着、也不在哪份草稿里的，从本机删掉（ctx.photos.discard 只删从来没上传过的） */
  function sweep(list = [...added]) {
    if (!ctx.photos) return;
    const inDrafts = draftPhotos(storage);
    for (const sha of list) {
      if ((w.photo && w.photo.sha256 === sha && !done) || photoInUse(ctx.state, sha) || inDrafts.has(sha)) continue;
      added.delete(sha);
      Promise.resolve(ctx.photos.discard(sha)).catch(() => {});
    }
  }

  // ---------- 食材 ----------
  const rowsEl = h('ul.re-rows');
  const rowErr = new Map();           // key → 文案的键（保存时标的错）
  const prompts = new Map();          // key → 和它重复的那一行的 key（名字写好时提醒「这道菜里已经有…」）
  const dismissed = new Map();        // key → 点了「仍然加一行」时的名字（normName）：同一个名字不再提醒
  const dupSlots = new Map();         // key → 这一行里放提醒的地方（就地改，不重画）
  const emptyNote = h('p.group-foot.re-empty', null, t('rcp.rowsEmpty'));
  const nameOf = (g, i) => g.name.trim() || t('rcp.rowN', { n: i + 1 });
  const focusFid = (fid) => { const el = fid ? main.querySelector(`[data-fid="${fid}"]`) : null; if (el) el.focus({ preventScroll: true }); return el; };
  function drawRows() {
    emptyNote.hidden = w.ings.length > 0;
    rowsEl.hidden = !w.ings.length;
    sortBtn.hidden = w.ings.length < 2;
    dupSlots.clear();
    rowsEl.replaceChildren(...w.ings.map((g, i) => {
      const inp = (cls, key, label, extra = {}) => h('input.f-in.' + cls, { type: 'text', value: g[key], 'aria-label': t(label, { n: i + 1 }), autocomplete: 'off',
        dataset: { fid: `re-${key}-${g.key}` }, oninput: (e) => { g[key] = e.target.value; touched(); }, ...extra });
      const mv = (dir) => {
        const j = i + dir, edge = j < 0 || j >= w.ings.length, fid = `re-${dir < 0 ? 'up' : 'down'}-${g.key}`;
        // 手动排过：以后新加的只放进它那一组的最后，不再整张按类别排（ordered）；挪过的这一行自己也不用再放了
        return h('button.icon-btn.mv-btn', { type: 'button', 'aria-label': t(dir < 0 ? 'rcp.moveUp' : 'rcp.moveDown', { name: nameOf(g, i) }), 'aria-disabled': String(edge), dataset: { fid },
          onclick: () => { if (!edge) keepUnderFinger(ctx, main, fid, () => { const [x] = w.ings.splice(i, 1); w.ings.splice(j, 0, x); w.ordered = true; fresh.delete(x.key); touched(); redrawRows(fid); }); } },
        icon(dir < 0 ? 'up' : 'down'));
      };
      const opt = h('button.chip.re-opt', { type: 'button', 'aria-pressed': String(g.optional), 'aria-label': t('rcp.rowOptional', { name: nameOf(g, i) }), dataset: { fid: 're-opt-' + g.key },
        onclick: () => { g.optional = !g.optional; opt.setAttribute('aria-pressed', String(g.optional)); touched(); } }, t('rcp.optional'));
      const err = h('p.f-err', { role: 'alert', hidden: !rowErr.has(g.key) }, rowErr.has(g.key) ? t(rowErr.get(g.key)) : '');
      const slot = h('div.re-dup-slot');
      dupSlots.set(g.key, slot);
      paintDup(g);
      return h('li.re-row', { dataset: { key: g.key } },
        h('div.re-main', null,
          inp('re-name', 'name', 'rcp.rowName', { placeholder: t('rcp.ingName'), maxlength: 200, enterkeyhint: 'next', onchange: () => checkDup(g) }),
          inp('re-qty', 'qty', 'rcp.rowQty', { placeholder: t('rcp.ingQty'), inputmode: 'decimal', 'aria-invalid': rowErr.get(g.key) === 'rcp.err.ingQty' ? 'true' : null }),
          inp('re-unit', 'unit', 'rcp.rowUnit', { placeholder: t('rcp.ingUnit'), maxlength: 20 })),
        h('div.re-sub', null,
          inp('re-note', 'note', 'rcp.rowNote', { placeholder: t('rcp.ingNote') }),
          opt,
          h('span.re-acts', null, mv(-1), mv(1),
            h('button.icon-btn.re-del', { type: 'button', 'aria-label': t('rcp.removeRow', { name: nameOf(g, i) }), dataset: { fid: 're-del-' + g.key },
              onclick: () => removeRow(i) }, icon('trash')))),
        slot,
        err);
    }));
  }
  /** 重画食材以后焦点放回同一个按钮（↑↓ 连着按挪的还是同一样） */
  function redrawRows(fid) {
    drawRows();
    focusFid(fid);
  }
  // ---------- 重复的食材 ----------
  /** 名字写好了（change：离开这个输入框）：这道菜里已经有同一样、又没点过「仍然加一行」→ 提醒；不重复了 → 拿掉提醒 */
  function checkDup(g) {
    const k = normName(g.name);
    const d = k && dismissed.get(g.key) !== k ? duplicateOf(w, g.name, g.key) : null;
    if (d) prompts.set(g.key, d.key); else prompts.delete(g.key);
    paintDup(g);
  }
  function paintDup(g) {
    const slot = dupSlots.get(g.key);
    if (!slot) return;
    const other = prompts.has(g.key) ? w.ings.find(x => x.key === prompts.get(g.key)) : null;
    if (!other) { prompts.delete(g.key); slot.replaceChildren(); slot.hidden = true; return; }
    slot.hidden = false;
    slot.replaceChildren(h('div.re-dup', { role: 'group', 'aria-label': t('rcp.dupHave', { name: other.name.trim() }) },
      h('p.re-dup-msg', { role: 'status' }, t('rcp.dupHave', { name: other.name.trim() })),
      h('div.re-dup-acts', null,
        h('button.btn.small.re-merge', { type: 'button', dataset: { fid: 're-merge-' + g.key }, onclick: () => mergeRow(g, other) }, t('rcp.dupMerge')),
        h('button.btn.small.re-keep', { type: 'button', dataset: { fid: 're-keep-' + g.key }, onclick: () => keepRow(g) }, t('rcp.dupKeep')))));
  }
  /** 输入框里的数量 → 数字；空的、写错了的当没写（合并时写错的不当成数） */
  const num = (x) => { const q = readQty(x); return q != null && Number.isFinite(q) ? q : null; };
  /** 「合并」：这一行并进已经有的那一行（core/recipes.js 的 mergeIngredient：单位一样数量相加，不一样写进备注），这一行去掉；10 秒内能撤销 */
  function mergeRow(g, into) {
    const at = w.ings.indexOf(g);
    if (at < 0 || !w.ings.includes(into)) return;
    const before = { qty: into.qty, unit: into.unit, note: into.note };
    const m = mergeIngredient({ qty: num(into.qty), unit: into.unit, note: into.note }, { qty: num(g.qty), unit: g.unit, note: g.note });
    into.qty = formatQty(m.qty); into.unit = m.unit; into.note = m.note;
    w.ings.splice(at, 1);
    prompts.delete(g.key); fresh.delete(g.key);
    touched();
    redrawRows(`re-qty-${into.key}`);
    ctx.toast(t('rcp.merged', { name: into.name.trim() }), { ms: 10000, action: { label: t('common.undo'), run: () => {
      if (done || unmounted || w.ings.some(x => x.key === g.key) || !w.ings.includes(into)) return;
      Object.assign(into, before);
      w.ings.splice(Math.min(at, w.ings.length), 0, g);
      dismissed.set(g.key, normName(g.name));
      touched();
      redrawRows(`re-name-${g.key}`);
    } } });
  }
  /** 「仍然加一行」（腌料、调味各一份盐）：这个名字不再提醒，接着写数量 */
  function keepRow(g) {
    dismissed.set(g.key, normName(g.name));
    prompts.delete(g.key);
    paintDup(g);
    focusFid(`re-qty-${g.key}`);
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
  // 「加一样」：先接在最后（写着名字时不挪），保存时再按类别放好（fresh → saveRecipe 的 place）
  const addBtn = h('button.btn.re-add', { type: 'button', dataset: { fid: 're-add' }, onclick: () => {
    const row = blank();
    w.ings.push(row);
    fresh.add(row.key);
    touched();
    drawRows();
    const el = main.querySelector(`[data-fid="re-name-${row.key}"]`);
    if (el) el.focus();
  } }, icon('plus'), t('rcp.addRow'));
  const pasteBtn = h('button.btn.re-paste', { type: 'button', dataset: { fid: 're-paste' }, onclick: () => pasteSheet(ctx, (got) => {
    // 只有一行空的（刚点了「加一样」还没写）：换掉它，不留一个空行在中间
    if (w.ings.length && w.ings.every(g => !g.name.trim() && !g.qty.trim() && !g.unit.trim() && !g.note.trim())) { w.ings = []; fresh.clear(); }
    const added = got.map(g => blank(g));
    // 粘贴进来的马上按类别放好：新建的、没手动排过的整张排；排过的、已经存过的食谱放进各自那一组的最后（原来的几行不自己挪，
    // 和保存时一样：第 11 步以前存的食谱可能是以前用 ↑↓ 排好的）
    const keep = w.ordered || !isNew;
    w.ings = placeIngredients(ctx.state, [...w.ings, ...added], added.map(g => g.key), keep);
    if (!keep) fresh.clear();
    touched();
    drawRows();
    ctx.toast(t('rcp.pasted', { n: added.length }));
    // 焦点回到「粘贴食材」（不给新的一行的输入框：iPhone 会弹出键盘盖住刚加的那几样），刚加的第一样滚到看得见
    const first = main.querySelector(`[data-fid="re-name-${added[0].key}"]`);
    if (first && first.scrollIntoView) first.scrollIntoView({ block: 'nearest' });
    pasteBtn.focus({ preventScroll: true });
  }, { have: () => w.ings.map(g => g.name) }) }, icon('paste'), t('rcp.paste'));
  // 「按类别重新排」：整张按组排一次（同一组里先后不变），以后新加的也照组放（去掉 ordered）
  const sortBtn = h('button.link-btn.re-sort', { type: 'button', dataset: { fid: 're-sort' }, onclick: () => {
    w.ings = sortIngredients(ctx.state, w.ings);
    w.ordered = false;
    fresh.clear();
    touched();
    redrawRows('re-sort');
    ctx.toast(t('rcp.sorted'));
  } }, t('rcp.sortGroups'));

  // ---------- 标签 ----------
  const collator = collatorFor(ctx.lang());
  // 标签开关的 fid 用名字的哈希：自己加的标签里可能有引号，不能直接放进选择器
  const tagFid = (g, name) => `re-tag-${g}-${hash64(normName(name))}`;
  const tagEls = Object.fromEntries(TAG_GROUPS.map(g => [g, h('div.chips.re-tag-chips', { role: 'group', 'aria-label': t('rcp.tag.' + g), dataset: { group: g } })]));
  /** 一组的开关：预设（界面语言）→ 别的食谱用过的 → 这一道自己加的（tagChoices），最后「自己加」 */
  function drawTags(g) {
    const presets = RECIPE_TAG_PRESETS[g].map(k => t(`rcp.tag.${g}.${k}`));
    tagEls[g].replaceChildren(...tagChoices(ctx.state, g, presets, w.tags[g], collator).map(name => {
      const chip = h('button.chip.re-tag', { type: 'button', 'aria-pressed': String(hasTag(w.tags, g, name)), dataset: { fid: tagFid(g, name) },
        onclick: () => {
          const on = !hasTag(w.tags, g, name);
          w.tags = on ? /** @type {any} */ (addTag(w.tags, g, name)).tags : removeTag(w.tags, g, name);
          chip.setAttribute('aria-pressed', String(on));
          touched();
        } }, name);
      return chip;
    }), h('button.chip.re-tag-add', { type: 'button', dataset: { fid: 're-tag-add-' + g }, onclick: () => customTag(g) }, icon('plus'), t('rcp.tagAdd')));
  }
  function customTag(g) {
    const cu = g === 'cuisine';
    nameSheet(ctx, { title: t(cu ? 'rcp.tagAddCuisine' : 'rcp.tagAddStyle'), label: t('rcp.tagName'), placeholder: t(cu ? 'rcp.tagPhCuisine' : 'rcp.tagPhStyle'),
      submitLabel: t('rcp.tagAddGo'), focus: true,
      save: ({ name }) => {
        const r = addTag(w.tags, g, name);
        if (!r.ok) return { ok: false, errors: { name: r.error } };
        w.tags = r.tags;
        touched();
        drawTags(g);
        // 面板关上以后焦点给刚加的（选上了的）那个
        setTimeout(() => focusFid(tagFid(g, name)), 0);
        return { ok: true };
      } });
  }
  const tagsRow = h('div.f-row.re-tags', null, h('h2.group-h', null, t('rcp.tags')),
    TAG_GROUPS.map(g => h('div.re-tag-group', null, h('div.f-label', { 'aria-hidden': 'true' }, t('rcp.tag.' + g)), tagEls[g])),
    h('p.f-help', null, t('rcp.tagHelp')));

  const stepsIn = h('textarea.f-in.re-steps', { rows: 6, value: w.steps, placeholder: t('rcp.stepsPh'), dataset: { fid: 're-steps' }, oninput: () => { w.steps = stepsIn.value; touched(); } });
  const sourceIn = h('input.f-in', { type: 'text', value: w.source, placeholder: t('rcp.sourcePh'), autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', enterkeyhint: 'done',
    dataset: { fid: 're-source' }, onkeydown: onEnter(() => sourceIn.blur()), oninput: () => { w.source = sourceIn.value; touched(); } });
  const noteIn = h('textarea.f-in', { rows: 3, value: w.note, dataset: { fid: 're-note' }, oninput: () => { w.note = noteIn.value; touched(); } });

  // ---------- 每人份营养（第 13 步） ----------
  const NUT_LABEL = { kcal: 'log.kcalField', protein: 'log.proteinField', carbs: 'log.carbsField', fat: 'log.fatField' };
  /** @type {Record<string, any>} */
  const nutIns = {}, nutRows = {};
  for (const k of NUTRIENTS) {
    // 热量存的是整数：整数的数字键盘（和记一样吃的面板、饮食目标一样）
    nutIns[k] = h('input.f-in.nut-in', { type: 'text', inputmode: k === 'kcal' ? 'numeric' : 'decimal', value: w.nutrition[k], autocomplete: 'off', enterkeyhint: 'done', dataset: { fid: 're-nut-' + k },
      onkeydown: onEnter(() => nutIns[k].blur()), oninput: () => { w.nutrition[k] = nutIns[k].value; showErr(nutRows[k], null); touched(); } });
    nutRows[k] = field(t(NUT_LABEL[k]), nutIns[k]);
  }
  const nutRow = h('div.f-row.re-nut', null, h('h2.group-h', null, t('log.perServing')), h('div.lg-nut-grid', null, NUTRIENTS.map(k => nutRows[k])),
    h('p.f-help', null, t('log.recipeNutHelp')));

  const banner = draft && dirty() ? h('div.lp-banner.re-draft', { role: 'status' }, h('span', null, t('rcp.draftBack')),
    h('button.btn.small', { type: 'button', dataset: { fid: 're-drop' }, onclick: () => discard() }, t('rcp.draftDrop'))) : null;

  main.append(navbar, h('div.page.form.re-form', null,
    banner,
    nameRow,
    svRow,
    photoRow,
    h('div.f-row.re-ings', null, h('div.re-ings-head', null, h('h2.group-h', null, t('rcp.ings')), sortBtn), emptyNote, rowsEl, h('div.re-ing-acts', null, addBtn, pasteBtn)),
    nutRow,
    tagsRow,
    field(t('rcp.steps'), stepsIn),
    field(t('rcp.source'), sourceIn),
    field(t('rcp.note'), noteIn)));
  drawRows();
  drawPhoto();
  for (const g of TAG_GROUPS) drawTags(g);
  if (isNew && !draft) nameIn.focus({ preventScroll: true });

  // ---------- 保存、取消 ----------
  let saving = false;
  async function save() {
    if (saving) return;
    if (photoBusy && photoJob) {
      // 「正在处理图片…」时点了保存（⌘S）：等这张处理好了一起存；没处理成（打不开、存不了）就留在这一页，错误写在这一栏下面
      saving = true;
      const ok = await photoJob.catch(() => false);
      saving = false;
      if (unmounted || done) return;
      if (!ok) { focusFid(w.photo ? 're-photo-replace' : 're-photo-add'); return; }
    }
    const v = validateRecipe(w);
    showErr(nameRow, v.errors.name);
    showErr(svRow, v.errors.servings);
    rowErr.clear();
    for (const [i, key] of Object.entries(v.errors.ings || {})) rowErr.set(w.ings[Number(i)].key, key);
    const nutErr = v.errors.nutrition || {};
    for (const k of NUTRIENTS) showErr(nutRows[k], nutErr[k] || null);
    if (!v.ok) {
      drawRows();
      // 焦点给页面上第一个错的：名字 → 几人份 → 食材 → 每人份营养
      const firstRow = Object.keys(v.errors.ings || {})[0], firstNut = NUTRIENTS.find(k => nutErr[k]);
      const el = v.errors.name ? nameIn : v.errors.servings ? svIn
        : firstRow === undefined ? (firstNut ? nutIns[firstNut] : null)
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
    // 「加一样」写的那几行这时按类别放好（place）：写着的时候没挪，免得点空
    const res = ctx.mutate(s => saveRecipe(s, target, { ...w, place: [...fresh] }, Date.now()));
    if (!res.ok) { if (res.errors.recipe) ctx.toast(t(res.errors.recipe)); return; }
    done = true;
    dropDraft();
    sweep();                            // 换掉了的、加了又删掉的（存好的那张有食谱用着，不删）
    ctx.guard(null);
    if (!target) ctx.navigate('/r/' + encodeURIComponent(res.id), { replace: true });
    else ctx.back(backTo);
  }
  async function cancel() {
    if (dirty() && !done && !(await ctx.confirm({ message: t('item.discardQ'), cancelLabel: t('common.keepEditing'), confirmLabel: t('item.discard'), danger: true }))) return;
    done = true;
    dropDraft();
    sweep();
    ctx.guard(null);
    ctx.back(backTo);
  }
  /** 横幅上的「放弃修改」：丢掉另存的草稿，回到这道食谱现在的样子（新建的回到空白） */
  function discard() {
    dropDraft();
    Object.assign(w, workingCopy(src && liveRecipe(ctx.state, id)));
    sweep();                            // 草稿里加的图（这道食谱没在用的）
    base = canon(w);
    nameIn.value = w.name; svIn.value = w.servings; stepsIn.value = w.steps; sourceIn.value = w.source; noteIn.value = w.note;
    for (const k of NUTRIENTS) { nutIns[k].value = w.nutrition[k]; showErr(nutRows[k], null); }
    rowErr.clear(); prompts.clear(); dismissed.clear(); fresh.clear();
    photoErr = '';
    drawRows();
    drawPhoto();
    for (const g of TAG_GROUPS) drawTags(g);
    if (banner) banner.remove();
    nameIn.focus({ preventScroll: true });
  }
  // Esc = 取消、⌘S / ⌘回车（别的系统 Ctrl）= 保存（面板开着时是面板自己的键）。听这一页自己（照 babble）：双栏时左栏「食谱」搜索框里的 Esc 是清空搜索，不能连带把右栏的编辑取消了
  function onKey(e) {
    if (e.isComposing || e.defaultPrevented || document.querySelector('dialog[open]')) return;
    if ((e.metaKey || e.ctrlKey) && (String(e.key).toLowerCase() === 's' || e.key === 'Enter')) { e.preventDefault(); save(); return; }
    if (e.key !== 'Escape') return;
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
      photos.revoke();
    },
  };
}
