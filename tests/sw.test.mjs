// service worker：预缓存表（CORE）要和仓库里的程序文件一致（加了新模块忘记写进去，离线时就打不开）；
// 只缓存自己网站的文件（同步的 api.github.com 不碰）；清旧缓存只清 picknest- 开头的（同域名下还有别的 app）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createHash, webcrypto } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const exists = f => fs.existsSync(path.join(root, f)) && fs.statSync(path.join(root, f)).isFile();
const SW = read('sw.js');
const CORE = [...SW.match(/const CORE = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
const CACHE = SW.match(/const CACHE = '([^']+)';/)[1];
const inCore = (f, from) => assert.ok(CORE.includes(f), `${f}（${from}）没有写进 sw.js 的 CORE`);
const isLocal = u => !/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(u);
/** 相对 from 文件解析成 './a/b.js' 的形式（去掉 ?query #hash） */
const resolve = (from, u) => './' + path.posix.normalize(path.posix.join(path.posix.dirname(from), u.split(/[?#]/)[0]));

function filesUnder(dir, keep = () => true) {
  const out = [];
  (function walk(d) {
    for (const f of fs.readdirSync(path.join(root, d)).sort()) {
      const p = d + '/' + f;
      if (fs.statSync(path.join(root, p)).isDirectory()) walk(p);
      else if (!f.startsWith('.') && keep(f)) out.push('./' + p);
    }
  })(dir);
  return out;
}

/** index.html 里引用的本站文件：<link href>、<script src>、<img src> */
function htmlRefs() {
  return [...read('index.html').matchAll(/\b(?:href|src)\s*=\s*["']([^"']+)["']/g)].map(m => m[1]).filter(isLocal).map(u => resolve('./index.html', u));
}

/** 从启动器开始顺着 import 走一遍：静态 import、export … from、import '…'、字面量的 import('…') */
function importGraph(start) {
  const seen = new Map();   // 文件 → 是谁 import 的
  const queue = [[start, 'index.html']];
  while (queue.length) {
    const [f, by] = queue.shift();
    if (seen.has(f)) continue;
    seen.set(f, by);
    if (!exists(f)) continue;
    const src = read(f);
    const specs = [
      ...src.matchAll(/^\s*(?:import|export)\b[^;'"`]*?\bfrom\s*['"]([^'"]+)['"]/gm),
      ...src.matchAll(/^\s*import\s*['"]([^'"]+)['"]/gm),
      ...src.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g),
    ].map(m => m[1]);
    for (const s of specs) {
      assert.ok(s.startsWith('./') || s.startsWith('../'), `${f} import 了 ${s}：只能用相对路径（没有打包，浏览器直接加载）`);
      queue.push([resolve(f, s), f]);
    }
  }
  return seen;
}

test('CORE 里的每个文件都存在，没有重复', () => {
  assert.equal(new Set(CORE).size, CORE.length, 'CORE 有重复');
  assert.ok(CORE.includes('./') && CORE.includes('./index.html'), '要有 ./ 和 ./index.html（离线打开的入口）');
  for (const f of CORE) if (f !== './') assert.ok(exists(f), `CORE 里的 ${f} 不存在`);
  assert.match(CACHE, /^picknest-v\d+$/);
});

test('index.html 引用的文件都存在，都在 CORE 里；CSP 只允许连自己和 api.github.com', () => {
  const refs = htmlRefs();
  for (const want of ['./src/start.js', './src/boot.js', './styles.css', './manifest.webmanifest', './icons/icon-180.png']) assert.ok(refs.includes(want), `index.html 应该引用 ${want}`);
  for (const f of refs) { assert.ok(exists(f), `index.html 引用的 ${f} 不存在`); inCore(f, 'index.html'); }
  const csp = read('index.html').match(/Content-Security-Policy" content="([^"]+)"/)[1];
  assert.match(csp, /connect-src 'self' https:\/\/api\.github\.com;/);
  assert.match(csp, /script-src 'self';/);
  assert.doesNotMatch(csp, /https?:\/\/(?!api\.github\.com)/, '不加载任何 CDN');
  assert.match(read('index.html'), /<title>PickNest<\/title>/);
  assert.match(read('index.html'), /name="apple-mobile-web-app-capable" content="yes"/);
});

test('从启动器顺着 import 走到的模块都存在，都在 CORE 里', () => {
  const graph = importGraph('./src/start.js');
  assert.ok(graph.size >= 15, `只走到了 ${graph.size} 个模块，解析 import 的正则可能坏了`);
  for (const [f, by] of graph) { assert.ok(exists(f), `${by} import 的 ${f} 不存在`); inCore(f, `${by} import`); }
});

test('程序文件全都在 CORE 里：src/ 下所有 .js、根目录的样式表和 manifest、icons/ 下所有文件', () => {
  for (const f of filesUnder('src', f => f.endsWith('.js'))) inCore(f, 'src/');
  for (const f of fs.readdirSync(root).filter(f => /\.(css|webmanifest)$/.test(f))) inCore('./' + f, '根目录');
  for (const f of filesUnder('icons')) inCore(f, 'icons/');
  for (const f of CORE) assert.ok(!f.startsWith('./tests/') && !f.startsWith('./tools/') && !f.startsWith('./scripts/') && !f.startsWith('./docs/'), `${f} 不是 App 用的文件`);
});

test('JS 里写到的图标和 CSS 里 url() 的文件都存在，都在 CORE 里', () => {
  for (const f of filesUnder('src', f => f.endsWith('.js'))) {
    for (const m of read(f).matchAll(/['"`](?:\.\/)?(icons\/[\w.-]+)['"`]/g)) {
      const p = './' + m[1];   // 页面里的相对地址按 index.html 所在目录算
      assert.ok(exists(p), `${f} 用到的 ${p} 不存在`); inCore(p, f);
    }
  }
  for (const f of fs.readdirSync(root).filter(f => f.endsWith('.css')).map(f => './' + f)) {
    for (const m of read(f).matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) {
      if (!isLocal(m[2])) continue;
      const p = resolve(f, m[2]);
      assert.ok(exists(p), `${f} 用到的 ${p} 不存在`); inCore(p, f);
    }
  }
});

test('manifest：名字、start_url / scope、图标都对；两种语言的 manifest 只差 lang', () => {
  const files = fs.readdirSync(root).filter(f => f.endsWith('.webmanifest')).sort();
  assert.deepEqual(files, ['manifest.webmanifest', 'manifest.zh-Hant-TW.webmanifest']);
  const [hans, hant] = files.map(f => JSON.parse(read(f)));
  assert.deepEqual([hans.name, hant.name, hans.lang, hant.lang], ['PickNest', 'PickNest', 'zh-Hans', 'zh-Hant-TW']);
  for (const m of [hans, hant]) {
    assert.equal(m.start_url, './');
    assert.equal(m.scope, './');
    assert.equal(m.id, './', '两份 manifest 的 id 一样，切换语言不会变成另一个 app');
    assert.equal(m.display, 'standalone');
    assert.equal(m.background_color, '#f6f5f0');
    for (const ic of m.icons) { const p = resolve('./manifest.webmanifest', ic.src); assert.ok(exists(p), `manifest 图标 ${p} 不存在`); inCore(p, 'manifest'); }
    assert.ok(m.icons.some(ic => ic.sizes === '512x512' && (ic.purpose || 'any').includes('any')));
    assert.ok(m.icons.some(ic => ic.sizes === '512x512' && (ic.purpose || '').includes('maskable')));
  }
  const strip = m => JSON.stringify({ ...m, name: 0, short_name: 0, lang: 0 });
  assert.equal(strip(hans), strip(hant));
});

test('图标：PNG 是正方形，尺寸和文件名一致，不是空白的；SVG 有 #artwork（maskable 版靠它缩放）', () => {
  const pngs = filesUnder('icons', f => f.endsWith('.png'));
  assert.deepEqual(pngs.map(f => path.basename(f)).sort(), ['icon-180.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png']);
  for (const f of pngs) {
    const b = fs.readFileSync(path.join(root, f));
    assert.equal(b.toString('latin1', 1, 4), 'PNG', `${f} 不是 PNG`);
    const w = b.readUInt32BE(16), hgt = b.readUInt32BE(20);
    assert.equal(w, hgt, `${f} 不是正方形`);
    assert.equal(w, Number(f.match(/icon-(?:maskable-)?(\d+)\.png$/)[1]), `${f} 实际是 ${w}px`);
    assert.ok(b.length > w * 40, `${f} 只有 ${b.length} 字节，可能是空白图`);
  }
  assert.match(read('icons/icon.svg'), /<g id="artwork" transform="/);
});

// ---------- 在假的 service worker 环境里跑真实 sw.js（响应体与摘要使用 Node 的真实 Web API） ----------
const SCOPE = 'https://example.github.io/pick-nest/';
const digest = text => createHash('sha256').update(text).digest('hex');
const fixture = file => 'core:' + file;
const release = () => ({ cache: CACHE, core: Object.fromEntries(CORE.map(file => [file, digest(fixture(file))])) });
const response = (body, status = 200) => new Response(body, { status });
function loadSw({ fetch: fakeFetch, caches: initial = {}, manifest = release() } = {}) {
  const location = new URL(SCOPE + 'sw.js');
  const abs = r => new URL(typeof r === 'string' ? r : r.url, location).href;
  const stores = new Map(Object.entries(initial).map(([name, files]) => [name, new Map(Object.entries(files).map(([u, v]) => [abs(u), v]))]));
  const handlers = {}, fetched = [];
  let skipped = 0, claimed = 0;
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const m = stores.get(name);
      return { async put(req, res) { m.set(abs(req), res.clone()); }, async match(req) { return m.get(abs(req))?.clone(); } };
    },
    async keys() { return [...stores.keys()]; }, async delete(name) { return stores.delete(name); },
  };
  class Request extends globalThis.Request { constructor(url, init = {}) { super(abs(url), init); } }
  const network = fakeFetch || (async req => {
    const p = './' + new URL(req.url).pathname.slice(new URL(SCOPE).pathname.length);
    return p === './release.json' ? response(JSON.stringify(manifest)) : response(fixture(p));
  });
  vm.runInNewContext(SW, {
    self: { addEventListener: (type, fn) => { handlers[type] = fn; }, skipWaiting() { skipped++; }, clients: { claim() { claimed++; } } },
    caches, location, URL, Request, Response, crypto: webcrypto,
    fetch: (req, init) => { fetched.push({ url: req.url, cache: req.cache, init }); return network(req, init); },
  }, { filename: 'sw.js' });
  const fire = (type, props = {}) => {
    const waits = []; let responded = null;
    handlers[type]({ ...props, waitUntil: p => waits.push(p), respondWith: p => { responded = Promise.resolve(p); } });
    return { settled: () => Promise.all(waits), get responded() { return responded; } };
  };
  return { fire, stores, fetched, get skipped() { return skipped; }, get claimed() { return claimed; }, keys: name => [...(stores.get(name) || new Map()).keys()] };
}
const req = (p, extra = {}) => ({ request: { url: new URL(p, SCOPE).href, method: 'GET', mode: 'cors', ...extra } });
const swTest = (name, fn) => test(name, { timeout: 3000 }, fn);
const activeFiles = files => ({ 'release.json': response(JSON.stringify(release())), ...files });

swTest('sw 安装：按发布清单校验完整 CORE，绕过 HTTP 缓存；安装结束不强制接管页面', async () => {
  const sw = loadSw(); await sw.fire('install').settled();
  assert.deepEqual(sw.keys(CACHE), [...CORE, './release.json'].map(u => new URL(u, SCOPE).href));
  assert.equal(sw.fetched.find(r => r.url.endsWith('/release.json')).cache, 'no-store');
  for (const r of sw.fetched.filter(r => !r.url.endsWith('/release.json'))) assert.equal(r.cache, 'reload');
  assert.equal(sw.skipped, 0); assert.equal(sw.claimed, 0);
});

swTest('sw 安装：断网、缺文件、混入别版内容或清单版本不符都失败，旧版缓存不动', async () => {
  for (const fault of ['offline', 'missing', 'mixed', 'version']) {
    const manifest = release(); if (fault === 'version') manifest.cache = 'picknest-v0';
    const sw = loadSw({ caches: { 'picknest-v0': { 'index.html': response('old index') } }, fetch: async request => {
      const p = './' + new URL(request.url).pathname.slice(new URL(SCOPE).pathname.length);
      if (p === './release.json') return response(JSON.stringify(manifest));
      if (p === './src/app.js') {
        if (fault === 'offline') throw new Error('offline');
        if (fault === 'missing') return response('missing', 404);
        if (fault === 'mixed') return response('another release');
      }
      return response(fixture(p));
    } });
    await assert.rejects(sw.fire('install').settled());
    assert.deepEqual(sw.keys('picknest-v0'), [SCOPE + 'index.html']);
    assert.equal(sw.keys(CACHE).length, 0, fault + ': 未验证全套之前不开始写缓存');
  }
});

swTest('sw 启用：只清理自己的旧缓存；保留同域名下其它 App 的缓存；不 claim 活跃页面', async () => {
  const sw = loadSw({ caches: { 'picknest-v0': {}, [CACHE]: {}, 'babble-v20': {}, 'babble-vendor-tf432': {}, 'house-ledger-v13': {} } });
  await sw.fire('activate').settled();
  assert.deepEqual([...sw.stores.keys()].sort(), [CACHE, 'babble-v20', 'babble-vendor-tf432', 'house-ledger-v13'].sort());
  assert.equal(sw.claimed, 0);
});

swTest('sw 有网也始终用当前版本：程序和带查询参数的资源不混用网络或别版缓存', async () => {
  const sw = loadSw({ caches: { 'picknest-v0': { 'src/app.js': response('wrong old app') }, [CACHE]: activeFiles({ 'src/app.js': response('pinned app'), 'styles.css': response('pinned css'), 'index.html': response('pinned index') }) }, fetch: async () => response('newer server') });
  assert.equal(await (await sw.fire('fetch', req('src/app.js?v=next')).responded).text(), 'pinned app');
  assert.equal(await (await sw.fire('fetch', req('styles.css')).responded).text(), 'pinned css');
  assert.equal(await (await sw.fire('fetch', req('./?x=1', { mode: 'navigate' })).responded).text(), 'pinned index');
  assert.equal(sw.fetched.length, 0);
});

swTest('sw 当前缓存意外缺文件：只补回校验通过的同版文件，不能借用旧缓存', async () => {
  for (const good of [true, false]) {
    const sw = loadSw({ caches: { 'picknest-v0': { 'src/app.js': response('other version') }, [CACHE]: activeFiles({}) }, fetch: async () => response(good ? fixture('./src/app.js') : 'wrong version') });
    const result = await sw.fire('fetch', req('src/app.js')).responded;
    if (good) { assert.equal(await result.text(), fixture('./src/app.js')); assert.ok(sw.keys(CACHE).includes(SCOPE + 'src/app.js')); }
    else { assert.equal(result.type, 'error'); assert.ok(!sw.keys(CACHE).includes(SCOPE + 'src/app.js')); }
  }
});

swTest('sw 离线或服务器失败：已有完整版本仍立即可用；缺少文件时明确失败', async () => {
  const sw = loadSw({ caches: { [CACHE]: activeFiles({ 'index.html': response('offline index') }) }, fetch: async () => { throw new Error('offline'); } });
  assert.equal(await (await sw.fire('fetch', req('./', { mode: 'navigate' })).responded).text(), 'offline index');
  assert.equal((await sw.fire('fetch', req('src/app.js')).responded).type, 'error');
});

swTest('sw 不碰 GitHub、其它 App 路径、非 GET 或未列入清单的资源', () => {
  const sw = loadSw();
  for (const props of [req('https://api.github.com/repos/test/data'), req('/babble/src/app.js'), req('src/app.js', { method: 'POST' }), req('not-an-app-file.txt'), req('tests/store.test.mjs')]) assert.equal(sw.fire('fetch', props).responded, null);
  assert.equal(sw.fetched.length, 0);
});

swTest('sw 版本查询只答复缓存版本，不触发更新或接管；别的 App 的查询不答', () => {
  const sw = loadSw(); let version;
  sw.fire('message', { data: 'picknest-build', ports: [{ postMessage: value => { version = value; } }] });
  assert.equal(version, CACHE); assert.equal(sw.claimed, 0); assert.equal(sw.skipped, 0);
  version = null;
  sw.fire('message', { data: 'babble-build', ports: [{ postMessage: value => { version = value; } }] });
  assert.equal(version, null);
});

test('发布清单与当前代码、资源和版本号一致，遗漏准备发布步骤时测试失败', () => {
  const result = spawnSync(process.execPath, ['scripts/prepare-release.mjs', '--check'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const rel = JSON.parse(read('release.json'));
  assert.equal(rel.app, 'picknest');
  assert.equal(rel.cache, CACHE);
  assert.deepEqual(Object.keys(rel.core), CORE);
  assert.ok(read('src/version.js').includes(`export const BUILD = '${CACHE}';`), 'version.js 和 sw.js 是同一版');
});
