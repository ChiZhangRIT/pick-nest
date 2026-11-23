// 每次启动固定使用同一份完整缓存。新版安装时按 release.json 校验文件，等旧页面全部关闭后再启用。
// 只管本网站的文件。同步（api.github.com）不经过这里，也不进缓存。
const CACHE = 'picknest-v20';
// 程序文件全部预先缓存（tests/sw.test.mjs 检查这张表和磁盘上的文件、index.html、import 关系一致），第一次打开之后就能离线用
const CORE = [
  './', './index.html', './styles.css',
  './manifest.webmanifest', './manifest.zh-Hant-TW.webmanifest',
  './icons/icon.svg', './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png',
  './src/start.js', './src/version.js', './src/boot.js', './src/app.js', './src/i18n.js',
  './src/core/util.js', './src/core/hanzi.js', './src/core/store.js', './src/core/persistence.js', './src/core/state.js',
  './src/core/parse.js', './src/core/catalog.js', './src/core/memory.js', './src/core/items.js', './src/core/group.js', './src/core/lists.js',
  './src/core/stores.js', './src/core/categories.js', './src/core/dates.js', './src/core/sync.js', './src/core/backup.js', './src/core/deleted.js',
  './src/core/search.js', './src/core/shop.js', './src/core/wake.js', './src/core/listIcons.js', './src/core/recipes.js', './src/core/plan.js',
  './src/strings/core.js', './src/strings/lists.js', './src/strings/items.js', './src/strings/stores.js', './src/strings/catalog.js', './src/strings/settings.js', './src/strings/recovery.js',
  './src/strings/sync.js', './src/strings/data.js', './src/strings/shop.js', './src/strings/search.js', './src/strings/recipes.js', './src/strings/plan.js',
  './src/ui/dom.js', './src/ui/recovery.js', './src/ui/form.js', './src/ui/listEditor.js', './src/ui/itemEditor.js', './src/ui/checklist.js', './src/ui/swipe.js', './src/ui/nameSheet.js', './src/ui/syncBadge.js', './src/ui/listTile.js', './src/ui/storeFilter.js',
  './src/ui/addToList.js', './src/ui/pasteIngredients.js', './src/ui/dishSheet.js', './src/ui/planList.js',
  './src/views/lists.js', './src/views/list.js', './src/views/stores.js', './src/views/store.js', './src/views/settings.js', './src/views/manage.js',
  './src/views/sync.js', './src/views/data.js', './src/views/deleted.js', './src/views/shop.js', './src/views/search.js',
  './src/views/recipes.js', './src/views/recipe.js', './src/views/recipeEdit.js', './src/views/plan.js',
];
const RELEASE = './release.json';
const BASE = new URL('./', location).pathname;
const CORE_PATHS = new Map(CORE.map(u => [new URL(u, location).pathname, u]));
const HASH = /^[a-f0-9]{64}$/;

async function verify(response, expected) {
  if (response.status !== 200 || !HASH.test(expected || '')) throw new Error('release-file-unavailable');
  const bytes = await response.clone().arrayBuffer();
  const actual = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
  if (actual !== expected) throw new Error('release-hash-mismatch');
  return response;
}
async function install() {
  const response = await fetch(new Request(RELEASE, { cache: 'no-store' }));
  if (response.status !== 200) throw new Error('release-unavailable');
  const release = await response.clone().json();
  if (release.cache !== CACHE || !release.core
    || Object.keys(release.core).length !== CORE.length || CORE.some(u => !HASH.test(release.core[u] || ''))) throw new Error('release-version-mismatch');
  // 整版下载、全部校验通过才开始写缓存：网慢、刚好在发布时混进别的版本，都不会装成半套
  const files = await Promise.all(CORE.map(async u => [u, await verify(await fetch(new Request(u, { cache: 'reload' })), release.core[u])]));
  const cache = await caches.open(CACHE);
  for (const [url, file] of files) await cache.put(new Request(url), file);
  await cache.put(new Request(RELEASE), response);
}
self.addEventListener('install', e => { e.waitUntil(install()); });
self.addEventListener('activate', e => {
  // 只清自己的旧版本：同一个 github.io 域名下的其它网页 app（babble、房屋账本……）也用 Cache Storage
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('picknest-') && k !== CACHE).map(k => caches.delete(k)))));
  // 不 skipWaiting / claim：已经打开的旧页面继续由旧 worker 服务，页面和 worker 永远是同一版。
});
self.addEventListener('message', e => { if (e.data === 'picknest-build') e.ports?.[0]?.postMessage(CACHE); });
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  // 别的网站（api.github.com 等）和非 GET 请求一律不碰：浏览器直接发，不缓存
  if (req.method !== 'GET' || url.origin !== location.origin || !url.pathname.startsWith(BASE)) return;
  const file = req.mode === 'navigate' ? './index.html' : CORE_PATHS.get(url.pathname);
  if (file) e.respondWith(core(file));
});

async function core(file) {
  try {
    const cache = await caches.open(CACHE), request = new Request(file);
    const hit = await cache.match(request);
    if (hit) return hit;
    // 缓存意外缺文件时，只接收当前版本校验通过的原件，不能借用别的版本或未经校验的网络文件。
    const release = await (await cache.match(new Request(RELEASE))).json();
    const response = await verify(await fetch(new Request(file, { cache: 'reload' })), release.core[file]);
    await cache.put(request, response.clone());
    return response;
  } catch (e) { return Response.error(); }
}
