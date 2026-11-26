// 成品图的同步（src/core/sync.js 的第 12 步部分，照 babble 的录音）：先传图再传 picknest.json、只传有食谱用着的（删掉的食谱的也传）、
// 云端已经有同一张不再传、409 / 422 重新 GET、一直不行先跳过（文字照常同步）、本机坏了的（sha256 对不上）不传；
// 别的设备上后台下载（改得晚的食谱在前）、页面要看的马上下载、下载下来 sha256 对不上不收、云端还没有的 5 分钟内后台不再问；
// 切到后台的直接上传也先传图；传图期间又存了带新图的食谱，JSON 里的图也都先传了；本机存不下的不一轮一轮重下；
// 上传、下载的问题各记各的，图都删了以后不再提；「还剩几张在下载」不减两次。假的 GitHub（tests/helpers/github.mjs，不联网、令牌是编的）+ 内存版的图片库，全是编的数据
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mockGitHub, DATA, enc } from './helpers/github.mjs';
import { createSync, SyncError } from '../src/core/sync.js';
import { memoryStore } from '../src/core/blobStore.js';
import { photoPath } from '../src/core/photo.js';
import { blankState, ensureSeeds, normalizeRecord, stamp, deletedRecord, normalizeState } from '../src/core/store.js';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const IMG = (s) => 'PUT /repos/me/data/contents/' + photoPath(sha(s));

/** 一台设备：自己的数据、图片库（内存版）、同步设置；recipe 加一道带图的食谱（图先存进图片库） */
function device(gh, name, blobs = memoryStore()) {
  const d = { name, state: ensureSeeds(blankState()), version: 0, cfg: { repo: 'me/data', token: 'github_pat_test' }, blobs, got: [], statuses: [], onSleep: null };
  d.sync = createSync({
    getState: () => d.state, applyRemote: (m) => { d.state = ensureSeeds(normalizeState(m)); },
    getConfig: () => d.cfg, saveConfig: () => {}, editVersion: () => d.version, device: name,
    fetch: (...a) => gh.fetch(...a), blobs: d.blobs, onBlob: (s) => d.got.push(s), onStatus: (st) => d.statuses.push(st),
    // 409 以后等一下再拉取：d.onSleep 在这时插一手（模拟这期间本机又改了）
    sleep: async () => { const fn = d.onSleep; d.onSleep = null; if (fn) await fn(); },
  });
  const changed = () => { d.version++; if (d.cfg) d.cfg.dirty = true; };
  d.put = (c, rec) => { d.state.data[c][rec.id] = normalizeRecord(c, stamp(rec, d.state.data[c][rec.id]), rec.id); changed(); return d.state.data[c][rec.id]; };
  /** 一道带图的食谱：图的内容就是 text（编的字节） */
  d.recipe = async (id, text, extra = {}) => {
    const p = text ? await d.blobs.putBlob(new Blob([text], { type: 'image/jpeg' })) : null;
    return d.put('recipes', { id, name: '测试' + id, ings: [], photo: p ? { ...p, w: 4, h: 3 } : null, ...extra });
  };
  d.remove = (c, id) => { d.state.data[c][id] = deletedRecord(d.state.data[c][id]); changed(); };
  d.run = async (opts) => { const r = await d.sync.syncNow(opts); await d.sync.idle(); await d.sync.downloadsIdle(); return r; };
  return d;
}

test('先传图、再传 picknest.json；只传有食谱用着的（加了又放弃的不传），删掉的食谱的也传；传过的下一轮不再问', async () => {
  const gh = mockGitHub(), mac = device(gh, 'Mac');
  await mac.recipe('r_a', '测试图片：红烧肉');
  await mac.recipe('r_gone', '测试图片：删掉的食谱');
  mac.remove('recipes', 'r_gone');
  await mac.blobs.putBlob(new Blob(['测试图片：加了又放弃']), { mime: 'image/jpeg' });
  assert.deepEqual(await mac.run(), { ok: true });
  const putA = gh.log.indexOf(IMG('测试图片：红烧肉')), putJson = gh.log.indexOf('PUT /repos/me/data/contents/' + DATA);
  assert.ok(putA > 0 && putJson > putA, '图在 JSON 前面传');
  assert.ok(gh.log.indexOf(IMG('测试图片：删掉的食谱')) < putJson, '删掉的食谱的图也传（别的设备可能从最近删除里恢复）');
  assert.ok(!gh.files.has(photoPath(sha('测试图片：加了又放弃'))), '没有食谱用着的不传');
  assert.equal(new TextDecoder().decode(gh.files.get(photoPath(sha('测试图片：红烧肉'))).bytes), '测试图片：红烧肉');
  assert.match(gh.opts.find(o => o.method === 'PUT' && o.path.includes('images/')).body, /"message":"添加图片 [0-9a-f]{8}（Mac）"/);
  assert.equal(gh.json().state.data.recipes.r_a.photo.sha256, sha('测试图片：红烧肉'), 'JSON 里只有记录');
  assert.deepEqual((await mac.blobs.pendingUploads('me/data')).map(b => b.sha256), [sha('测试图片：加了又放弃')], '传好的记下了在这个仓库里');
  assert.equal(mac.sync.status().pendingUp, 0);
  assert.equal(mac.sync.status().blobErr, null);
  gh.log.length = 0;
  await mac.run();
  assert.ok(!gh.log.some(l => l.includes('/images/')), '传过的不再问');
});

test('云端已经有同一张（别的设备传过）：只 GET 不 PUT；云端那张内容不对（以前传坏了）：带着它的 sha 覆盖', async () => {
  const gh = mockGitHub(), mac = device(gh, 'Mac');
  await mac.recipe('r_a', '测试图片：已经在了');
  await mac.recipe('r_b', '测试图片：传坏过');
  gh.putFile(photoPath(sha('测试图片：已经在了')), enc('测试图片：已经在了'));
  gh.putFile(photoPath(sha('测试图片：传坏过')), enc('坏'));
  await mac.run();
  assert.ok(!gh.log.includes(IMG('测试图片：已经在了')), '一样的不传');
  const put = gh.opts.find(o => o.method === 'PUT' && o.path.endsWith(photoPath(sha('测试图片：传坏过'))));
  assert.ok(put && JSON.parse(put.body).sha, '覆盖时带着云端那份的 sha');
  assert.equal(new TextDecoder().decode(gh.files.get(photoPath(sha('测试图片：传坏过'))).bytes), '测试图片：传坏过');
  assert.deepEqual(await mac.blobs.pendingUploads('me/data'), []);
});

test('图片 PUT 撞上 409：重新 GET 再传；一直撞就先跳过（blobErr，不算同步出错），文字照常传，下一轮再传上', async () => {
  const gh = mockGitHub(), mac = device(gh, 'Mac');
  await mac.recipe('r_a', '测试图片：撞了一次');
  gh.faults.push({ method: 'PUT', path: 'images/', status: 409 });
  assert.deepEqual(await mac.run(), { ok: true });
  const path = '/repos/me/data/contents/' + photoPath(sha('测试图片：撞了一次'));
  assert.deepEqual(gh.log.filter(l => l.endsWith(path)), ['GET ' + path, 'PUT ' + path, 'GET ' + path, 'PUT ' + path], '409 以后重新 GET 再 PUT');
  assert.ok(gh.files.has(photoPath(sha('测试图片：撞了一次'))));

  await mac.recipe('r_b', '测试图片：一直撞');
  gh.faults.push({ method: 'PUT', path: 'images/', status: 422, times: 3 });
  const r = await mac.run();
  assert.deepEqual(r, { ok: true }, '图没传上不算这一轮失败');
  assert.equal(mac.sync.status().blobErr.code, 'blobUp');
  assert.equal(mac.cfg.err, null);
  assert.ok(gh.json().state.data.recipes.r_b, '文字照常传了');
  assert.equal((await mac.blobs.pendingUploads('me/data')).length, 1, '还算没传');
  await mac.run();
  assert.ok(gh.files.has(photoPath(sha('测试图片：一直撞'))), '下一轮传上了');
  assert.equal(mac.sync.status().blobErr, null, '传上了就不再提');

  // 断网：这一轮不再传图，传 JSON 时报离线
  await mac.recipe('r_c', '测试图片：断网');
  gh.faults.push({ method: 'PUT', path: 'images/', throws: true });
  gh.faults.push({ method: 'PUT', path: DATA, throws: true });
  const off = await mac.run();
  assert.equal(off.offline, true);
  // 令牌失效：图片停下，整轮报 auth
  gh.faults.push({ method: 'GET', path: 'images/', status: 401 });
  const bad = await mac.run();
  assert.equal(bad.error.code, 'auth');
});

test('本机这一份坏了（内容和 sha256 对不上）：不传，报 shaMismatch；文字照样传', async () => {
  const gh = mockGitHub(), mac = device(gh, 'Mac');
  const r = await mac.recipe('r_a', '测试图片：原来的');
  mac.blobs.blobs.get(r.photo.sha256).blob = new Blob(['被改过的内容']);
  assert.deepEqual(await mac.run(), { ok: true });
  assert.ok(!gh.log.some(l => l.startsWith('PUT') && l.includes('images/')), '坏的不传');
  assert.equal(mac.sync.status().blobErr.code, 'shaMismatch');
  assert.ok(gh.json().state.data.recipes.r_a);
});

test('别的设备：一轮以后在后台下载缺的图（改得晚的食谱在前），记下在仓库里（不再传回去），通知页面；没有食谱用着的、删掉的食谱的不下载', async () => {
  const gh = mockGitHub(), mac = device(gh, 'Mac'), ipad = device(gh, 'iPad');
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => (now += 10);
  try {
    await mac.recipe('r_old', '测试图片：先做的');
    await mac.recipe('r_new', '测试图片：后做的');
    await mac.recipe('r_gone', '测试图片：删掉的');
    mac.remove('recipes', 'r_gone');
    await mac.run();
  } finally { Date.now = realNow; }
  gh.log.length = 0; gh.opts.length = 0;
  assert.deepEqual(await ipad.run(), { ok: true });
  const gets = gh.log.filter(l => l.startsWith('GET') && l.includes('images/'));
  assert.deepEqual(gets, ['GET /repos/me/data/contents/' + photoPath(sha('测试图片：后做的')), 'GET /repos/me/data/contents/' + photoPath(sha('测试图片：先做的'))], '新的在前，删掉的食谱的不下');
  assert.ok(gh.opts.filter(o => o.path.includes('images/')).every(o => o.headers.Accept === 'application/vnd.github.raw+json'), '要原文');
  assert.equal(await (await ipad.blobs.getBlob(sha('测试图片：先做的'))).blob.text(), '测试图片：先做的');
  assert.deepEqual(ipad.got.sort(), [sha('测试图片：先做的'), sha('测试图片：后做的')].sort(), '下载好了通知页面');
  assert.deepEqual(await ipad.blobs.pendingUploads('me/data'), [], '下载来的不再传回去');
  assert.equal(ipad.sync.status().pendingDown, 0);
  assert.equal(ipad.sync.status().downloading, false);
  gh.log.length = 0;
  await ipad.run();
  assert.ok(!gh.log.some(l => l.includes('images/')), '都有了：不再下载');
});

test('页面要看的马上下载（同一张只下载一次）；云端还没有 → null，后台 5 分钟内不再问；下载下来 sha256 对不上不收；没开同步 → null', async () => {
  const gh = mockGitHub(), mac = device(gh, 'Mac'), ipad = device(gh, 'iPad');
  await mac.recipe('r_a', '测试图片：要看的');
  await mac.run();
  ipad.state = JSON.parse(JSON.stringify(mac.state));        // 已经拿到了记录，还没下载图
  const want = sha('测试图片：要看的');
  gh.log.length = 0;
  const [b1, b2] = await Promise.all([ipad.sync.getBlob(want), ipad.sync.getBlob(want.toUpperCase())]);
  assert.equal(await b1.text(), '测试图片：要看的');
  assert.equal(await b2.text(), '测试图片：要看的');
  assert.equal(gh.log.filter(l => l.includes('images/')).length, 1, '同一张同时只下载一次');
  assert.equal(b1.type, 'image/jpeg');
  gh.log.length = 0;
  await ipad.sync.getBlob(want);
  assert.equal(gh.log.length, 0, '本机有了：不下载');
  assert.equal(await ipad.sync.getBlob('不是哈希'), null);

  // 云端还没有（那台设备还没传上来）
  const later = sha('测试图片：还没传上来');
  ipad.put('recipes', { id: 'r_b', name: '测试 r_b', ings: [], photo: { sha256: later, mime: 'image/jpeg' } });
  assert.equal(await ipad.sync.getBlob(later), null);
  gh.log.length = 0;
  ipad.sync.kickDownloads();
  await ipad.sync.downloadsIdle();
  assert.ok(!gh.log.some(l => l.includes(later)), '刚问过没有：后台 5 分钟内不再问');
  assert.equal(await ipad.sync.getBlob(later), null);
  assert.ok(!gh.log.some(l => l.includes(later)), '页面再打开也不再问（大图不会每次先占一大块再缩回去）');

  // 云端的文件被换过：sha256 对不上，不收
  const odd = sha('测试图片：原来的样子');
  ipad.put('recipes', { id: 'r_c', name: '测试 r_c', ings: [], photo: { sha256: odd, mime: 'image/jpeg' } });
  gh.putFile(photoPath(odd), enc('测试图片：被换过的样子'));
  await assert.rejects(ipad.sync.getBlob(odd), (e) => e instanceof SyncError && e.code === 'shaMismatch');
  assert.equal(await ipad.blobs.hasBlob(odd), false, '对不上的不存');
  ipad.sync.kickDownloads();
  await ipad.sync.downloadsIdle();
  assert.equal(ipad.sync.status().blobErr.code, 'shaMismatch', '后台下载碰到了也说一句');

  ipad.cfg = null;
  assert.equal(await ipad.sync.getBlob(sha('测试图片：随便哪张')), null, '没开同步：不下载');
});

test('切到后台的直接上传（pushFirst）：有没传的图，先确认仓库是私有的、传图，再传 JSON（不先拉取）', async () => {
  const gh = mockGitHub(), mac = device(gh, 'Mac');
  mac.put('items', { id: 'i_1', listId: 'l_groceries', name: '牛奶', status: 'need' });
  await mac.run();
  await mac.recipe('r_a', '测试图片：切到后台');
  gh.log.length = 0;
  assert.deepEqual(await mac.run({ pushFirst: true, keepalive: true }), { ok: true });
  const img = '/repos/me/data/contents/' + photoPath(sha('测试图片：切到后台'));
  assert.deepEqual(gh.log, ['GET /repos/me/data', 'GET ' + img, 'PUT ' + img, 'PUT /repos/me/data/contents/' + DATA], '传图之前这一轮问过一次仓库；没有拉取');
  assert.equal(mac.cfg.dirty, false);
});

test('没给图片库（旧的调用方式）：只同步文字，有图的记录照样传', async () => {
  const gh = mockGitHub();
  let state = ensureSeeds(blankState());
  state.data.recipes.r_a = normalizeRecord('recipes', { id: 'r_a', name: '测试', ings: [], photo: { sha256: sha('x'), mime: 'image/jpeg' }, updatedAt: Date.now() }, 'r_a');
  const cfg = { repo: 'me/data', token: 'github_pat_test', dirty: true };
  const sync = createSync({ getState: () => state, applyRemote: (m) => { state = m; }, getConfig: () => cfg, saveConfig() {}, editVersion: () => 0, fetch: (...a) => gh.fetch(...a), sleep: async () => {} });
  assert.deepEqual(await sync.syncNow(), { ok: true });
  assert.ok(!gh.log.some(l => l.includes('images/')));
  assert.equal(await sync.getBlob(sha('x')), null);
});

test('上传 picknest.json 之前又存了带新图的食谱（传别的图的时候、409 以后重新拉取的时候）：先把新图传了，传上去的 JSON 里的图都在仓库里', async () => {
  const gh = mockGitHub(), mac = device(gh, 'Mac');
  await mac.recipe('r_a', '测试图片：先传的');
  gh.onPut = async () => { await mac.recipe('r_b', '测试图片：传图时存的'); };   // 第一张图 PUT 的时候
  assert.deepEqual(await mac.run(), { ok: true });
  const b = photoPath(sha('测试图片：传图时存的'));
  assert.ok(gh.json().state.data.recipes.r_b.photo, 'JSON 里有新食谱的图');
  assert.ok(gh.files.has(b), '图也在仓库里');
  assert.ok(gh.log.indexOf('PUT /repos/me/data/contents/' + b) < gh.log.lastIndexOf('PUT /repos/me/data/contents/' + DATA), '先传图');
  assert.equal(mac.sync.status().pendingUp, 0);

  // JSON 撞上 409，等一下重新拉取的时候又存了一道带图的
  gh.pushJson(s => { s.data.recipes.r_other = normalizeRecord('recipes', { id: 'r_other', name: '别的设备的', ings: [], updatedAt: Date.now() }, 'r_other'); });
  mac.put('items', { id: 'i_1', listId: 'l_groceries', name: '牛奶', status: 'need' });
  mac.onSleep = async () => { await mac.recipe('r_c', '测试图片：重新拉取时存的'); };
  gh.log.length = 0;
  assert.deepEqual(await mac.run({ pushFirst: true }), { ok: true });
  const c = photoPath(sha('测试图片：重新拉取时存的'));
  assert.equal(gh.log.filter(l => l === 'PUT /repos/me/data/contents/' + DATA).length, 2, '第一次 409（云端被别的设备改过）');
  assert.ok(gh.json().state.data.recipes.r_c.photo && gh.files.has(c), 'JSON 里的图都在仓库里');
  assert.ok(gh.json().state.data.recipes.r_other, '合并了别的设备的');
  assert.ok(gh.log.indexOf('PUT /repos/me/data/contents/' + c) < gh.log.lastIndexOf('PUT /repos/me/data/contents/' + DATA));
  assert.equal(mac.cfg.dirty, false);
});

test('没传上的那张图后来删掉了（再没有食谱有图）：不再写「还有 1 张没上传」和上传的错；下载的错在有图的食谱都删了以后也不再提', async () => {
  const gh = mockGitHub(), mac = device(gh, 'Mac');
  await mac.recipe('r_a', '测试图片：没传上');
  gh.faults.push({ method: 'PUT', path: 'images/', status: 500, times: 3 });
  await mac.run();
  assert.equal(mac.sync.status().pendingUp, 1);
  assert.equal(mac.sync.status().blobErr.code, 'blobUp');
  mac.put('recipes', { ...mac.state.data.recipes.r_a, photo: null });
  await mac.run();
  assert.equal(mac.sync.status().pendingUp, 0);
  assert.equal(mac.sync.status().blobErr, null);

  const ipad = device(gh, 'iPad');
  await mac.recipe('r_b', '测试图片：下载出错');
  await mac.run();
  gh.faults.push({ method: 'GET', path: 'images/', status: 500 });
  await ipad.run();
  assert.equal(ipad.sync.status().blobErr.code, 'blobDown');
  ipad.remove('recipes', 'r_b');
  await ipad.run();
  assert.equal(ipad.sync.status().blobErr, null, '没有要下载的了');
  assert.equal(ipad.sync.status().pendingDown, 0);
});

test('上传和下载的问题各记各的：下载好了不会清掉上传没成的，上传好了也不会清掉下载没成的', async () => {
  const gh = mockGitHub(), mac = device(gh, 'Mac'), ipad = device(gh, 'iPad');
  await mac.recipe('r_a', '测试图片：Mac 的');
  await mac.run();
  await ipad.recipe('r_b', '测试图片：iPad 的');
  gh.faults.push({ method: 'PUT', path: 'images/', status: 500, times: 3 });
  await ipad.run();                                  // 传 iPad 的没成；下载 Mac 的成了
  assert.equal(ipad.sync.status().blobErr.code, 'blobUp');
  assert.equal(await ipad.blobs.hasBlob(sha('测试图片：Mac 的')), true);
});

test('本机存不下（存储空间满了）：下载下来的这次打开期间留在内存里给页面看，后台不再一轮一轮重下，设置里说存不下；空出地方以后自己存上、接着下', async () => {
  const gh = mockGitHub(), mac = device(gh, 'Mac');
  await mac.recipe('r_a', '测试图片：一');
  await mac.recipe('r_b', '测试图片：二');
  await mac.run();
  const full = memoryStore(), realPut = full.putBlob.bind(full);
  let noSpace = true;
  full.putBlob = async (...a) => { if (noSpace) throw new DOMException('quota', 'QuotaExceededError'); return realPut(...a); };
  const ipad = device(gh, 'iPad', full);
  gh.log.length = 0;
  for (let i = 0; i < 3; i++) assert.deepEqual(await ipad.run(), { ok: true });
  assert.equal(gh.log.filter(l => l.includes('images/')).length, 1, '下了一张、存不下，就不再下了（三轮一共一次）');
  assert.equal(ipad.sync.status().blobErr.code, 'blobFull');
  assert.equal(ipad.cfg.err, null, '不算同步出错');
  assert.deepEqual(ipad.got, [], '没存上：不通知');
  const first = gh.log.find(l => l.includes('images/'));
  const firstSha = [sha('测试图片：一'), sha('测试图片：二')].find(s => first.includes(s));
  gh.log.length = 0;
  assert.ok(await ipad.sync.getBlob(firstSha), '内存里那张照样给页面看');
  assert.equal(gh.log.length, 0, '不重下');
  const otherSha = [sha('测试图片：一'), sha('测试图片：二')].find(s => s !== firstSha);
  assert.equal(await (await ipad.sync.getBlob(otherSha)).text().then(t => t.length > 0), true, '页面要看的照样马上下载');
  assert.equal(gh.log.filter(l => l.includes('images/')).length, 1);
  gh.log.length = 0;
  await ipad.run();
  assert.equal(gh.log.filter(l => l.includes('images/')).length, 0, '页面下过的也不重下');

  noSpace = false;                                   // 空出地方了
  await ipad.run();
  assert.equal(gh.log.filter(l => l.includes('images/')).length, 0, '从内存里存，不用再下载');
  assert.equal(await full.hasBlob(firstSha), true);
  assert.equal(await full.hasBlob(otherSha), true);
  assert.equal(ipad.sync.status().blobErr, null);
  assert.deepEqual(ipad.got.sort(), [firstSha, otherSha].sort());
});

test('还剩几张在下载（pendingDown）：后台和页面在下同一张时不减两次，还有几张没下好就至少写几张', async () => {
  const gh = mockGitHub(), mac = device(gh, 'Mac');
  const texts = ['测试图片：甲', '测试图片：乙', '测试图片：丙'];
  for (const [i, x] of texts.entries()) await mac.recipe('r_' + i, x);
  await mac.run();
  const ipad = device(gh, 'iPad');
  ipad.state = JSON.parse(JSON.stringify(mac.state));
  // 图片的下载先拦着，一张一张放
  const gate = [];
  const tick = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 0)); };
  const seen = [];
  ipad.sync = createSync({
    getState: () => ipad.state, applyRemote() {}, getConfig: () => ipad.cfg, saveConfig() {}, editVersion: () => 0, sleep: async () => {}, blobs: ipad.blobs,
    fetch: (url, opt) => (url.includes('/images/') ? new Promise(r => gate.push({ url, go: () => r(gh.fetch(url, opt)) })) : gh.fetch(url, opt)),
    onStatus: (st) => { if (st.downloading) seen.push([st.pendingDown, texts.length - ipad.blobs.blobs.size]); },
  });
  const release = async (x) => { const k = gate.findIndex(g => g.url.includes(sha(x))); gate.splice(k, 1)[0].go(); await tick(); };
  gh.log.length = 0;
  ipad.sync.kickDownloads();
  await tick();
  assert.equal(gate.length, 1, '后台一张一张下');
  const [bg, ...rest] = [...texts].sort((a, b) => (gate[0].url.includes(sha(a)) ? -1 : gate[0].url.includes(sha(b)) ? 1 : 0));
  const pages = Promise.all(texts.map(x => ipad.sync.getBlob(sha(x))));    // 「食谱」页上同时要看这三张
  await tick();
  assert.equal(gate.length, 3, '后台在下的那张不再下一次');
  await release(rest[0]);                          // 页面的先下好
  await release(bg);                               // 后台和页面一起等的那张
  assert.equal(ipad.sync.status().pendingDown, 1, '还有一张');
  await release(rest[1]);
  await pages;
  await ipad.sync.downloadsIdle();
  assert.deepEqual(seen.filter(([shown, left]) => shown < left), [], '写的比还没下好的少：' + JSON.stringify(seen));
  assert.equal(ipad.sync.status().pendingDown, 0);
  assert.equal(gh.log.filter(l => l.includes('images/')).length, texts.length, '每张只下载一次');
});
