// 整个 App（src/app.js）里的成品图：ctx.photos 存进本机的图片库（IndexedDB picknest-blobs，这里是假的 IndexedDB），保存食谱 2 秒后同步时
// 先传图、再传 picknest.json；设置 → 多设备同步的状态里有图片的进度；页面要看的、本机没有的从仓库下载，下载好了发 'photo'。
// 假 DOM + 假的 GitHub（不联网、令牌是编的）+ 编的图片字节
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mockGitHub, DATA, enc } from './helpers/github.mjs';
import { fakeIDB } from './helpers/idb.mjs';
import { normalizeRecord } from '../src/core/store.js';
import { saveRecipe } from '../src/core/recipes.js';
import { photoPath } from '../src/core/photo.js';
import { Element, fakeStorage, installDom } from './helpers/dom.mjs';

test('整个 App：存图 → 保存食谱 → 同步先传图再传 JSON；本机没有的图按需下载、发 photo 事件', async () => {
  const gh = mockGitHub();
  const storage = fakeStorage([['picknest.local', JSON.stringify({ sync: { repo: 'me/data', token: 'github_pat_test', dirty: false } })]]);
  const loc = { hash: '', protocol: 'http:' };
  const timers = [];
  const idb = fakeIDB();
  const dom = installDom({ localStorage: storage, location: loc, history: { state: {}, replaceState(s, title, hash) { loc.hash = hash; }, back() {} },
    navigator: { languages: ['zh-CN'], userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', platform: 'iPhone', locks: { request: async (name, fn) => fn() } },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    setTimeout: (fn, ms) => { if (ms === 2000) { timers.push({ fn, ms }); return timers.length; } return globalThis.setImmediate(fn); },
    clearTimeout: (id) => { if (typeof id === 'number' && timers[id - 1]) timers[id - 1].fn = null; },
    setInterval: () => 0, getComputedStyle: () => ({ bottom: '24px' }), requestAnimationFrame: () => 0, MutationObserver: class { observe() {} disconnect() {} }, CSS: { escape: String },
    fetch: (...a) => gh.fetch(...a), indexedDB: idb });
  try {
    dom.doc.visibilityState = 'visible';
    const shell = new Element('div'); shell.className = 'app';
    for (const id of ['side', 'main']) { const el = new Element('div'); el.id = id; shell.append(el); }
    const tabs = new Element('nav'); tabs.id = 'tabs';
    dom.doc.body.append(shell, tabs);
    await import('../src/app.js?test=photo');
    const { ctx, syncer } = window.__picknest;
    const settle = async () => { await syncer.idle(); await syncer.downloadsIdle(); for (let i = 0; i < 10; i++) await new Promise(r => globalThis.setImmediate(r)); };
    const runDebounce = () => { for (const x of timers.filter(x => x.fn)) { const fn = x.fn; x.fn = null; fn(); } };
    await settle();

    // 编辑页存好的一张图 → 保存食谱 → 2 秒后同步：先传图、再传 JSON
    const p = await ctx.photos.put(new Blob(['测试图片：整个 App'], { type: 'image/jpeg' }));
    assert.equal(p.sha256, createHash('sha256').update('测试图片：整个 App').digest('hex'));
    assert.equal(await (await ctx.photos.local(p.sha256)).text(), '测试图片：整个 App');
    ctx.mutate(s => saveRecipe(s, null, { name: '红烧肉', ings: [], photo: { ...p, w: 4, h: 3 } }, Date.now()));
    gh.log.length = 0;
    runDebounce();
    await settle();
    const img = 'PUT /repos/me/data/contents/' + photoPath(p.sha256);
    assert.ok(gh.log.includes(img), gh.log.join('\n'));
    assert.ok(gh.log.indexOf(img) < gh.log.indexOf('PUT /repos/me/data/contents/' + DATA), '图在前');
    assert.equal(ctx.sync.status().pendingUp, 0);
    assert.equal(ctx.sync.status().blobErr, null);
    assert.equal(idb.stores.get('blobs').m.get(p.sha256).uploaded, 'me/data', '记下传到了哪个仓库');
    assert.deepEqual(await ctx.photos.usage(), { count: 1, bytes: p.bytes });

    // 别的设备加的食谱和图：拉下来以后（后台下载，或者页面要看时马上下载），下载好了发 photo
    const other = enc('测试图片：别的设备的');
    const osha = createHash('sha256').update(other).digest('hex');
    gh.putFile(photoPath(osha), other);
    gh.pushJson(s => { s.data.recipes.r_other = normalizeRecord('recipes', { id: 'r_other', name: '番茄炒蛋', ings: [], photo: { sha256: osha, mime: 'image/jpeg' }, updatedAt: Date.now() + 5000 }, 'r_other'); });
    const seen = [];
    ctx.on('photo', (sha) => seen.push(sha));
    assert.equal(ctx.photos.canFetch(), true);
    await ctx.sync.now();
    await settle();
    assert.deepEqual(seen, [osha], '后台下载好了');
    assert.equal(await (await ctx.photos.fetch(osha)).text(), '测试图片：别的设备的', '本机有了');
    assert.equal(await ctx.photos.discard(osha), false, '下载来的（在仓库里）不删');

    ctx.sync.stop();
    assert.equal(ctx.photos.canFetch(), false);
    assert.equal(await ctx.photos.fetch('c'.repeat(64)), null, '没开同步：不下载');
  } finally { dom.restore(); }
});
