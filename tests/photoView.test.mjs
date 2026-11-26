// 成品图在页面上（第 12 步，假 DOM + 真的 state.js，只用内存；图片库是内存版，图片是编出来的字节，压缩用假的）：
// 编辑页「添加成品图」「换一张」「删除图片」（能撤销）、保存时存进食谱、放弃 / 换掉的从本机删掉、草稿里接着有、打不开的说一句；
// 一道食谱上面的大图（本机有 → 图；没有、开着同步 → 「正在下载图片…」再换成图；拿不到 → 「这台设备上没有这张图」；后台下载好了换上）、
// 「食谱」页卡片上的小图、页面清理时 object URL 都放掉；设置 → 备份与恢复写着备份不含图、这台设备上存了几张
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as recipesView from '../src/views/recipes.js';
import * as recipeView from '../src/views/recipe.js';
import * as editView from '../src/views/recipeEdit.js';
import { dataPage } from '../src/views/data.js';
import * as state from '../src/core/state.js';
import { saveRecipe, liveRecipe } from '../src/core/recipes.js';
import { memoryStore } from '../src/core/blobStore.js';
import { PhotoError } from '../src/ui/photo.js';
import { setLang, t } from '../src/i18n.js';
import { Element, all, find, installDom, fakeStorage } from './helpers/dom.mjs';

const settle = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)); };
const cls = (el, c) => (el.className || el.attrs.class || '').split(' ').includes(c);
const byCls = (root, c) => find(root, el => cls(el, c));
const allCls = (root, c) => all(root, el => cls(el, c));
const fid = (root, f) => root.querySelector(`[data-fid="${f}"]`);
const imgs = (root) => all(root, el => el.tag === 'img');
const S = () => state.getState();

/** 假 ctx（照 app.js 的 ctx.photos）：图片库是内存版；sync: true 时「本机没有的能下载」，下载由 env.remote 给（可以晚一点给） */
function setup({ sync = false } = {}) {
  const dom = installDom();
  setLang('zh-Hans');
  state.load({ storage: null });
  const blobs = memoryStore();
  const bus = new Map();
  const urls = { made: 0, revoked: new Set() };
  const realCreate = URL.createObjectURL, realRevoke = URL.revokeObjectURL;
  URL.createObjectURL = (b) => { urls.made++; return 'blob:test/' + urls.made; };
  URL.revokeObjectURL = (u) => { urls.revoked.add(u); };
  const env = { ...dom, blobs, urls, toasts: [], navs: [], confirms: [], answer: true, handle: null, storage: fakeStorage(), sync, remote: new Map(), fetches: [], discarded: [] };
  const ctx = env.ctx = {
    t, lang: () => 'zh-Hans', layout: () => 'phone',
    get state() { return S(); }, get local() { return state.getLocal(); }, setLocal: (p) => state.setLocal(p),
    mutate: (fn, o) => state.mutate(fn, o),
    toast: (msg, o = {}) => env.toasts.push({ msg, ...o }),
    confirm: async (o) => { env.confirms.push(o); return env.answer; },
    navigate: (p) => env.navs.push(p), back: (p) => env.navs.push('back:' + p), backLabel: (f) => f,
    guard: () => {}, sheet: () => ({ close() {} }),
    on(ev, fn) { if (!bus.has(ev)) bus.set(ev, new Set()); bus.get(ev).add(fn); return () => bus.get(ev).delete(fn); },
    photos: {
      put: (b) => blobs.putBlob(b),
      local: async (sha) => { const r = await blobs.getBlob(sha); return r ? r.blob : null; },
      canFetch: () => env.sync,
      fetch: async (sha) => { env.fetches.push(sha); const v = env.remote.get(sha); return typeof v === 'function' ? v() : v || null; },
      discard: async (sha) => { env.discarded.push(sha); return blobs.deleteBlob(sha); },
      usage: () => blobs.usage(),
    },
  };
  env.emit = (ev, arg) => { for (const fn of bus.get(ev) || []) fn(arg); };
  const off = state.subscribe(() => queueMicrotask(() => { if (env.handle && env.handle.onChange) env.handle.onChange(); }));
  env.mount = (view, params, deps) => {
    if (env.handle && env.handle.cleanup) env.handle.cleanup();
    env.main = new Element('section');
    const ret = view.render(env.main, params, ctx, deps);
    env.handle = ret && typeof ret === 'object' ? ret : null;
    return env.main;
  };
  env.unmount = () => { const h = env.handle; env.handle = null; if (h && h.cleanup) h.cleanup(); };
  env.done = () => { env.unmount(); off(); URL.createObjectURL = realCreate; URL.revokeObjectURL = realRevoke; dom.restore(); };
  return env;
}
/** 编一道带图的食谱：图先存进本机（local: false 时不存，只有记录：像是别的设备同步来的） */
async function photoRecipe(env, name, text, { local = true } = {}) {
  const blob = new Blob([text], { type: 'image/jpeg' });
  const p = local ? await env.blobs.putBlob(blob) : { sha256: await (await import('../src/core/sha256.js')).sha256Hex(blob), mime: 'image/jpeg', bytes: blob.size };
  let id;
  state.mutate(s => { id = saveRecipe(s, null, { name, servings: '2', ings: [{ name: '五花肉', qty: '500', unit: 'g' }], photo: { ...p, w: 1600, h: 1200 } }, Date.now()).id; });
  return { id, sha: p.sha256, blob };
}
/** 假的压缩：照片「解码」出来是 4032×3024，压缩后是 'JPEG:' + 原文（不同的照片 → 不同的 sha256）；坏的文件抛 decode */
const fakeEncode = async (file) => {
  const text = await file.text();
  if (text.startsWith('坏')) throw new PhotoError('decode');
  return { blob: new Blob(['JPEG:' + text], { type: 'image/jpeg' }), w: 1600, h: 1200 };
};
/** 选了一个文件（<input type=file> 的 change） */
async function pick(main, text) {
  const input = fid(main, 're-photo-file');
  assert.equal(input.attrs.accept, 'image/*', 'iPhone 上能拍照、从相册选');
  input.files = [new Blob([text], { type: 'image/heic' })];
  await input.fire('change');
  await settle();
}

test('编辑页：添加成品图 → 压缩、存进本机、预览；换一张；保存时记进食谱（宽高、字节数），换掉的那张从本机删掉', async () => {
  const env = setup();
  try {
    let main = env.mount(editView, { name: 'recipeEdit', sub: 'new' }, { storage: env.storage, encodePhoto: fakeEncode });
    const add = fid(main, 're-photo-add');
    assert.equal(add.textContent, '添加成品图');
    assert.equal(byCls(main, 're-photo').parent.querySelector('.f-help').textContent, t('rcp.photo.help'));
    let clicks = 0;
    fid(main, 're-photo-file').addEventListener('click', () => clicks++);
    await add.click();
    assert.equal(clicks, 1, '点了打开系统的选图');
    await pick(main, '测试照片一');
    assert.equal(env.blobs.blobs.size, 1, '压缩好的存进本机');
    const first = [...env.blobs.blobs.keys()][0];
    assert.ok(byCls(main, 're-photo-thumb'), '有预览');
    assert.equal(imgs(main)[0].attrs.src, 'blob:test/1');
    assert.equal(fid(main, 're-photo-replace').textContent, '换一张');
    assert.equal(env.ctx.state.data.recipes && Object.keys(S().data.recipes).length, 0, '还没保存');
    await pick(main, '测试照片二');
    assert.equal(env.blobs.blobs.size, 2);
    const second = [...env.blobs.blobs.keys()].find(k => k !== first);
    fid(main, 're-name').value = '红烧肉';
    await fid(main, 're-name').fire('input');
    await fid(main, 're-save').click();
    await settle();
    const r = Object.values(S().data.recipes)[0];
    assert.deepEqual(r.photo, { sha256: second, mime: 'image/jpeg', w: 1600, h: 1200, bytes: new Blob(['JPEG:测试照片二']).size });
    assert.deepEqual(env.discarded, [first], '换掉的、从来没上传过的那张删掉');
    assert.deepEqual([...env.blobs.blobs.keys()], [second]);
    env.unmount();
    assert.ok(env.urls.revoked.has('blob:test/1') && env.urls.revoked.has('blob:test/2'), '离开时 object URL 都放掉');
  } finally { env.done(); }
});

test('编辑页：删除图片（10 秒内能撤销）→ 保存后食谱没有图；以前存的图（可能已经传上去了）不从本机删', async () => {
  const env = setup();
  try {
    const { id, sha } = await photoRecipe(env, '红烧肉', '测试图片：原来的');
    const main = env.mount(editView, { name: 'recipeEdit', id }, { storage: env.storage, encodePhoto: fakeEncode });
    await settle();
    assert.equal(imgs(main).length, 1, '原来的图');
    await fid(main, 're-photo-remove').click();
    assert.equal(imgs(main).length, 0);
    assert.ok(fid(main, 're-photo-add'));
    const toast = env.toasts.at(-1);
    assert.equal(toast.msg, '删掉了成品图');
    toast.action.run();
    assert.equal(imgs(main).length, 1, '撤销：图回来了');
    await fid(main, 're-photo-remove').click();
    await fid(main, 're-save').click();
    await settle();
    assert.equal(liveRecipe(S(), id).photo, null);
    assert.deepEqual(env.discarded, [], '不是这次加的：不删');
    assert.equal(await env.blobs.hasBlob(sha), true);
  } finally { env.done(); }
});

test('编辑页：加了图又取消 → 从本机删掉；没保存就离开 → 草稿里有图，下次接着改，图还在；打不开的图说一句、原来的不动', async () => {
  const env = setup();
  try {
    let main = env.mount(editView, { name: 'recipeEdit', sub: 'new' }, { storage: env.storage, encodePhoto: fakeEncode });
    await pick(main, '测试照片：取消');
    const sha = [...env.blobs.blobs.keys()][0];
    await fid(main, 're-cancel').click();
    await settle();
    assert.equal(env.confirms.length, 1, '改了：先问');
    assert.deepEqual(env.discarded, [sha]);
    assert.equal(env.blobs.blobs.size, 0, '没有食谱用着、从来没上传过：删掉');

    main = env.mount(editView, { name: 'recipeEdit', sub: 'new' }, { storage: env.storage, encodePhoto: fakeEncode });
    await pick(main, '测试照片：草稿');
    const kept = [...env.blobs.blobs.keys()][0];
    env.unmount();                                     // 没保存就离开（iOS 把 App 关掉）
    assert.equal(JSON.parse(env.storage.getItem(editView.DRAFT_PREFIX + 'new')).w.photo.sha256, kept, '草稿里记着图');
    assert.equal(await env.blobs.hasBlob(kept), true, '草稿里的图不删');
    main = env.mount(editView, { name: 'recipeEdit', sub: 'new' }, { storage: env.storage, encodePhoto: fakeEncode });
    await settle();
    assert.ok(byCls(main, 're-draft'), '接着上次的');
    assert.equal(imgs(main).length, 1, '图还在');
    await pick(main, '坏掉的文件');
    assert.equal(byCls(main, 're-photo').querySelector('.f-err').textContent, t('rcp.photo.err.decode'));
    assert.equal(imgs(main).length, 1, '原来的图不动');
    // 别的编辑页（另一道食谱）放弃时，不删这份草稿里的图
    env.unmount();
    const draftKey = editView.DRAFT_PREFIX + 'new';
    const keepDraft = env.storage.getItem(draftKey);
    let other;
    state.mutate(s => { other = saveRecipe(s, null, { name: '番茄炒蛋', ings: [] }, Date.now()).id; });
    main = env.mount(editView, { name: 'recipeEdit', id: other }, { storage: env.storage, encodePhoto: fakeEncode });
    await pick(main, '测试照片：草稿');                 // 同一张照片：同一个 sha
    await fid(main, 're-cancel').click();
    await settle();
    assert.equal(await env.blobs.hasBlob(kept), true, '还在别的草稿里：不删');
    // 回到那份草稿，点「放弃修改」：草稿里的那张（上次加的）也删掉
    env.storage.setItem(draftKey, keepDraft);
    main = env.mount(editView, { name: 'recipeEdit', sub: 'new' }, { storage: env.storage, encodePhoto: fakeEncode });
    await settle();
    await fid(main, 're-drop').click();
    await settle();
    assert.equal(await env.blobs.hasBlob(kept), false, '放弃草稿：草稿里加的图也删掉');
    assert.equal(imgs(main).length, 0);
  } finally { env.done(); }
});

test('一道食谱：本机有 → 最上面一张大图（替代文字是食谱名）；没有、没开同步 → 「这台设备上没有这张图」', async () => {
  const env = setup();
  try {
    const { id } = await photoRecipe(env, '红烧肉', '测试图片：本机有');
    let main = env.mount(recipeView, { name: 'recipe', id });
    await settle();
    const hero = byCls(main, 'rcp-hero');
    assert.ok(hero, '大图');
    assert.equal(hero.style.aspectRatio, '1600 / 1200', '照着照片的比例占好位置');
    assert.equal(imgs(hero)[0].attrs.alt, '「红烧肉」的成品图');
    const other = await photoRecipe(env, '番茄炒蛋', '测试图片：别的设备的', { local: false });
    main = env.mount(recipeView, { name: 'recipe', id: other.id });
    await settle();
    assert.equal(byCls(main, 'rcp-hero').textContent, '这台设备上没有这张图');
    assert.ok(cls(byCls(main, 'rcp-hero'), 'is-missing'));
    assert.deepEqual(env.fetches, [], '没开同步：不下载');
    env.unmount();
    assert.ok(env.urls.revoked.has('blob:test/1'), '离开时 object URL 放掉');
  } finally { env.done(); }
});

test('一道食谱：本机没有、开着同步 → 「正在下载图片…」，下载好了换成图；云端也没有 → 没有这张图；后台下载好了（photo 事件）换上', async () => {
  const env = setup({ sync: true });
  try {
    const { id, sha, blob } = await photoRecipe(env, '红烧肉', '测试图片：在云端', { local: false });
    let release;
    env.remote.set(sha, () => new Promise(r => { release = () => r(blob); }));
    const main = env.mount(recipeView, { name: 'recipe', id });
    await settle();
    assert.equal(byCls(main, 'rcp-hero').textContent, '正在下载图片…');
    assert.ok(cls(byCls(main, 'rcp-hero'), 'is-loading'));
    release();
    await settle();
    assert.equal(imgs(byCls(main, 'rcp-hero')).length, 1, '下载好了换成图');
    assert.deepEqual(env.fetches, [sha]);

    const later = await photoRecipe(env, '番茄炒蛋', '测试图片：还没传上来', { local: false });
    const m2 = env.mount(recipeView, { name: 'recipe', id: later.id });
    await settle();
    assert.equal(byCls(m2, 'rcp-hero').textContent, '这台设备上没有这张图', '云端也还没有');
    await env.blobs.putBlob(later.blob, { uploaded: 'me/data' });   // 后台下载好了
    env.emit('photo', later.sha);
    await settle();
    assert.equal(imgs(byCls(m2, 'rcp-hero')).length, 1, '换上了');
  } finally { env.done(); }
});

test('「食谱」页：有图的卡片左边一张小图（装饰，读屏不念），没图的没有；数据没变不重画', async () => {
  const env = setup();
  try {
    await photoRecipe(env, '红烧肉', '测试图片：卡片');
    state.mutate(s => saveRecipe(s, null, { name: '番茄炒蛋', ings: [] }, Date.now()));
    const main = env.mount(recipesView, { name: 'recipes' });
    await settle();
    const rows = allCls(main, 'rcp-row');
    const withThumb = rows.map(r => [find(r, el => cls(el, 'rcp-name')).textContent, !!byCls(r, 'rcp-thumb')]);
    assert.deepEqual(withThumb, [['番茄炒蛋', false], ['红烧肉', true]]);
    const thumb = byCls(main, 'rcp-thumb');
    assert.equal(thumb.attrs['aria-hidden'], 'true');
    assert.equal(imgs(thumb)[0].attrs.loading, 'lazy');
    assert.equal(env.urls.made, 1);
  } finally { env.done(); }
});

test('设置 → 备份与恢复：说备份里没有成品图；这台设备上有图时写几张、多大', async () => {
  const env = setup();
  try {
    await env.blobs.putBlob(new Blob(['测试图片：一']));
    await env.blobs.putBlob(new Blob(['x'.repeat(300 * 1024)]));
    env.main = new Element('section');
    dataPage(env.main, { name: 'settings', sub: 'data' }, env.ctx);
    await settle();
    assert.ok(all(env.main, el => el.tag === 'p').some(p => p.textContent === t('backup.noPhotos')));
    const line = byCls(env.main, 'data-photos');
    assert.equal(line.hidden, false);
    assert.equal(line.textContent, '这台设备上的成品图：2 张，300 KB');
  } finally { env.done(); }
});

test('「食谱」页的小图只用本机的：本机没有、开着同步也不马上下载（一页几十张会挤掉正看着的大图，后台一张一张下），后台下载好了（photo 事件）换上', async () => {
  const env = setup({ sync: true });
  try {
    const { sha, blob } = await photoRecipe(env, '红烧肉', '测试图片：卡片上的', { local: false });
    env.remote.set(sha, blob);
    const main = env.mount(recipesView, { name: 'recipes' });
    await settle();
    const thumb = byCls(main, 'rcp-thumb');
    assert.ok(thumb, '占位');
    assert.equal(imgs(thumb).length, 0);
    assert.deepEqual(env.fetches, [], '不下载');
    await env.blobs.putBlob(blob, { uploaded: 'me/data' });   // 后台下载好了
    env.emit('photo', sha);
    await settle();
    assert.equal(imgs(byCls(main, 'rcp-thumb')).length, 1, '换上了');
    assert.deepEqual(env.fetches, []);
  } finally { env.done(); }
});

test('一道食谱：这次打开 App 期间已经知道拿不到的大图，再打开时一开始就是矮矮的一条（不先占一大块再缩回去，按钮不跟着跳）；后来拿到了再换成图', async () => {
  const env = setup({ sync: true });
  try {
    const { id, sha, blob } = await photoRecipe(env, '红烧肉', '测试图片：一直拿不到', { local: false });
    let main = env.mount(recipeView, { name: 'recipe', id });
    assert.ok(cls(byCls(main, 'rcp-hero'), 'is-loading'), '第一次：照着照片的比例占好位置');
    await settle();
    assert.ok(cls(byCls(main, 'rcp-hero'), 'is-missing'));
    main = env.mount(recipeView, { name: 'recipe', id });
    const hero = byCls(main, 'rcp-hero');
    assert.ok(cls(hero, 'is-missing') && !cls(hero, 'is-loading'), '再打开：一开始就是矮的');
    assert.equal(hero.textContent, '这台设备上没有这张图', '问着的时候也不写「正在下载」（多半还是没有）');
    await settle();
    assert.ok(cls(byCls(main, 'rcp-hero'), 'is-missing'));
    env.remote.set(sha, blob);                          // 那台设备传上来了
    main = env.mount(recipeView, { name: 'recipe', id });
    await settle();
    assert.equal(imgs(byCls(main, 'rcp-hero')).length, 1, '拿到了：换成图');
    main = env.mount(recipeView, { name: 'recipe', id });
    assert.ok(cls(byCls(main, 'rcp-hero'), 'is-loading'), '拿到过的又照着比例占位');
  } finally { env.done(); }
});

test('编辑页：「正在处理图片…」时点保存 → 等这张处理好了一起存（不会存成没有图的、也不删掉这张）；没处理成就留在这一页', async () => {
  const env = setup();
  try {
    let release;
    const slow = (file) => new Promise(r => { release = () => r(fakeEncode(file)); });
    let main = env.mount(editView, { name: 'recipeEdit', sub: 'new' }, { storage: env.storage, encodePhoto: slow });
    fid(main, 're-name').value = '红烧肉';
    await fid(main, 're-name').fire('input');
    const input = fid(main, 're-photo-file');
    input.files = [new Blob(['测试照片：处理得慢'], { type: 'image/heic' })];
    await input.fire('change');
    await settle();
    assert.ok(byCls(main, 're-photo-busy'), '正在处理图片…');
    fid(main, 're-save').click();
    await settle();
    assert.equal(Object.keys(S().data.recipes).length, 0, '还在等这张图');
    assert.deepEqual(env.navs, []);
    release();
    await settle();
    const r = Object.values(S().data.recipes)[0];
    assert.ok(r && r.photo, '存下的食谱有这张图');
    assert.equal(await env.blobs.hasBlob(r.photo.sha256), true);
    assert.deepEqual(env.discarded, [], '不当成没用的删掉');
    assert.equal(env.navs.length, 1, '存好了才离开');

    // 没处理成（打不开）：不存、留在这一页，错误写在这一栏下面
    main = env.mount(editView, { name: 'recipeEdit', id: r.id }, { storage: env.storage, encodePhoto: slow });
    await settle();
    fid(main, 're-name').value = '红烧肉（改）';
    await fid(main, 're-name').fire('input');
    const input2 = fid(main, 're-photo-file');
    input2.files = [new Blob(['坏掉的文件'], { type: 'image/heic' })];
    await input2.fire('change');
    await settle();
    fid(main, 're-save').click();
    await settle();
    release();
    await settle();
    assert.equal(liveRecipe(S(), r.id).name, '红烧肉', '没存');
    assert.equal(byCls(main, 're-photo').querySelector('.f-err').textContent, t('rcp.photo.err.decode'));
    assert.equal(env.navs.length, 1);
  } finally { env.done(); }
});

test('编辑页：预览不是装饰（读屏念得到「「红烧肉」的成品图」），「成品图」这一组有名字；卡片上的小图才是装饰', async () => {
  const env = setup();
  try {
    const { id } = await photoRecipe(env, '红烧肉', '测试图片：预览');
    const main = env.mount(editView, { name: 'recipeEdit', id }, { storage: env.storage, encodePhoto: fakeEncode });
    await settle();
    const box = byCls(main, 're-photo');
    assert.equal(box.attrs.role, 'group');
    assert.ok(box.attrs['aria-labelledby'], '标题「成品图」');
    const thumb = byCls(main, 're-photo-thumb');
    assert.equal(thumb.attrs['aria-hidden'], undefined);
    assert.equal(imgs(thumb)[0].attrs.alt, '「红烧肉」的成品图');
  } finally { env.done(); }
});
