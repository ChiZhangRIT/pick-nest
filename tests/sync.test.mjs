// 同步（src/core/sync.js）：照 babble 的 tests/sync.test.mjs，只留文字数据这一部分。测试只用编出来的数据和假的 GitHub（tests/helpers/github.mjs：不联网、没有真的令牌）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockGitHub, DATA, enc, dec } from './helpers/github.mjs';
import {
  createSync, SyncError, syncCode, parseSyncCode, cleanRepo, tokenProblem, tokenDaysLeft, tokenWarn, syncPhase, temporary,
  toB64, fromB64, readSyncFile, platformDevice, SYNC_FILE, CODE_PREFIX, APP_ID,
} from '../src/core/sync.js';
import { blankState, ensureSeeds, normalizeRecord, stamp, deletedRecord, canon, normalizeState } from '../src/core/store.js';

/** 一台设备：自己的数据（有预置记录）、同步设置、修改计数；put / edit / remove 照 state.js 的样子改并标记待同步 */
function device(gh, name, { token = 'github_pat_test', repo = 'me/data' } = {}) {
  const d = { name, state: ensureSeeds(blankState()), version: 0, cfg: { repo, token }, applied: [], statuses: [], sleeps: [] };
  d.open = () => createSync({
    getState: () => d.state, applyRemote: (m, info) => { d.state = ensureSeeds(normalizeState(m)); d.applied.push(info.device); },
    getConfig: () => d.cfg, saveConfig: () => {}, editVersion: () => d.version, device: name,
    onStatus: s => d.statuses.push(s), fetch: (...a) => gh.fetch(...a), sleep: async ms => { d.sleeps.push(ms); },
  });
  d.sync = d.open();
  const changed = () => { d.version++; if (d.cfg) d.cfg.dirty = true; };
  d.put = (c, rec) => { const prev = d.state.data[c][rec.id]; d.state.data[c][rec.id] = normalizeRecord(c, stamp(rec, prev), rec.id); changed(); return d.state.data[c][rec.id]; };
  d.item = (id, fields = {}) => d.put('items', { id, listId: 'l_groceries', name: id, status: 'need', ...fields });
  d.edit = (c, id, patch) => d.put(c, { ...d.state.data[c][id], ...patch });
  d.remove = (c, id) => { d.state.data[c][id] = deletedRecord(d.state.data[c][id]); changed(); return d.state.data[c][id]; };
  d.run = async (opts) => { const r = await d.sync.syncNow(opts); await d.sync.idle(); return r; };
  return d;
}

test('同步码：前缀是参数（默认 picknest-sync:），来回一样；可以带着令牌到期日；别的 App、缺东西的不认；仓库名能从网址里认出来', () => {
  assert.equal(CODE_PREFIX, 'picknest-sync:');
  assert.equal(syncCode('me/pick-nest-data', 'github_pat_ABC_123'), 'picknest-sync:me/pick-nest-data:github_pat_ABC_123');
  assert.deepEqual(parseSyncCode('  ' + syncCode('me/pick-nest-data', 'github_pat_ABC_123') + '\n'), { repo: 'me/pick-nest-data', token: 'github_pat_ABC_123', exp: null });
  // 带着到期日：用同步码连上的设备也知道什么时候该提醒
  assert.equal(syncCode('me/pick-nest-data', 'github_pat_ABC_123', { exp: '2027-02-01' }), 'picknest-sync:me/pick-nest-data:github_pat_ABC_123:2027-02-01');
  assert.deepEqual(parseSyncCode(syncCode('me/d', 'github_pat_x', { exp: '2027-02-01' })), { repo: 'me/d', token: 'github_pat_x', exp: '2027-02-01' });
  assert.equal(syncCode('me/d', 'github_pat_x', { exp: 'soon' }), 'picknest-sync:me/d:github_pat_x', '不像日期的不带');
  for (const bad of ['', 'babble-sync:me/data:github_pat_x', 'picknest-sync:nodata:github_pat_x', 'picknest-sync:me/data:', 'picknest-syncXme/data:t', 'xpicknest-sync:me/data:t',
    'picknest-sync:me/data:github_pat_x:soon', 'picknest-sync:me/data:github_pat_x:2027-02-01:x']) {
    assert.equal(parseSyncCode(bad), null, bad);
  }
  // 换一个前缀（别的 App 用同一套代码）：各认各的，前缀里的点不当成正则的「任意字符」
  assert.deepEqual(parseSyncCode(syncCode('a/b', 'tok', { prefix: 'other.app:' }), 'other.app:'), { repo: 'a/b', token: 'tok', exp: null });
  assert.equal(parseSyncCode('otherXapp:a/b:tok', 'other.app:'), null);
  assert.equal(parseSyncCode(syncCode('a/b', 'tok', { prefix: 'other.app:' })), null);
  assert.equal(cleanRepo(' https://github.com/me/pick-nest-data.git/ '), 'me/pick-nest-data');
  assert.equal(cleanRepo('me/pick-nest-data'), 'me/pick-nest-data');
  for (const bad of ['', 'pick-nest-data', 'me/data/extra', 'me data/x']) assert.equal(cleanRepo(bad), null, bad);
});

test('令牌：只收 Fine-grained（github_pat_ 开头；经典的 ghp_ / gho_ / ghu_ / ghs_ / ghr_、以前没前缀的 40 位十六进制不收，别的格式也不收）；到期提醒提前两周；base64 是 UTF-8', () => {
  assert.equal(tokenProblem('github_pat_11ABC_def'), null);
  for (const t of ['ghp_abc', 'gho_abc', 'ghu_abc', 'ghs_abc', 'ghr_abc', ' ghp_abc ', '0123456789abcdef0123456789abcdef01234567', 'A'.repeat(40)]) assert.equal(tokenProblem(t), 'classic', t);
  for (const t of ['abc', 'a'.repeat(39), 'github_pa_x', 'picknest-sync:me/data']) assert.equal(tokenProblem(t), 'notFine', t);
  assert.equal(tokenProblem(''), 'noToken');
  assert.equal(tokenProblem('github_pat_a b'), 'badToken');
  const now = Date.UTC(2026, 10, 21, 12);
  assert.equal(tokenDaysLeft(null, now), null);
  assert.equal(tokenDaysLeft(now + 20 * 864e5, now), 20);
  assert.equal(tokenWarn(now + 20 * 864e5, now), false);
  assert.equal(tokenWarn(now + 13 * 864e5, now), true);
  assert.equal(tokenWarn(now - 864e5, now), true, '过期了也提醒');
  assert.equal(fromB64(toB64('牛奶 ✓ 🥬 mjölk')), '牛奶 ✓ 🥬 mjölk');
  assert.equal(platformDevice({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', platform: 'iPhone' }), 'iPhone');
  assert.equal(platformDevice({ userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 5 }), 'iPad');
  assert.equal(platformDevice({ userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 0 }), 'Mac');
});

test('状态：没开 → off；要用户处理的错 → err；暂时的（请求太多、GitHub 自己出错、合并没成）→ wait；令牌两周内到期 → token；有改动 → pending', () => {
  const now = Date.UTC(2026, 10, 21);
  assert.equal(syncPhase(null), 'off');
  assert.equal(syncPhase({ on: true, err: { code: 'auth' } }), 'err');
  assert.equal(syncPhase({ on: true, running: true }), 'running');
  assert.equal(syncPhase({ on: true, offline: true, dirty: true }), 'offline');
  for (const err of [{ code: 'rate', vars: { status: 429 } }, { code: 'http', vars: { status: 502 } }, { code: 'mergeFail' }]) {
    assert.equal(temporary(err), true); assert.equal(syncPhase({ on: true, err }), 'wait', err.code);
  }
  assert.equal(syncPhase({ on: true, err: { code: 'http', vars: { status: 400 } } }), 'err');
  assert.equal(syncPhase({ on: true, tokenExp: now + 3 * 864e5 }, now), 'token');
  assert.equal(syncPhase({ on: true, dirty: true, tokenExp: now + 90 * 864e5 }, now), 'pending');
  assert.equal(syncPhase({ on: true }, now), 'ok');
});

test('第一次同步：云端没有 picknest.json（404）→ 先再确认一次仓库是私有的，再新建 { app, v, device, savedAt, state }', async () => {
  const gh = mockGitHub(), mac = device(gh, 'Mac');
  mac.item('i_milk', { name: '牛奶' });
  assert.deepEqual(await mac.run(), { ok: true });
  const j = gh.json();
  assert.deepEqual([j.app, j.v, j.device, typeof j.savedAt], ['picknest', 1, 'Mac', 'string']);
  assert.equal(j.state.data.items.i_milk.name, '牛奶');
  assert.equal(j.state.data.lists.l_groceries.updatedAt, 0, '预置记录原样上去');
  assert.equal(mac.cfg.dirty, false); assert.ok(mac.cfg.sha); assert.ok(mac.cfg.at); assert.equal(mac.cfg.err, null);
  assert.deepEqual(gh.log, ['GET /repos/me/data', 'GET /repos/me/data/contents/picknest.json', 'GET /repos/me/data', 'PUT /repos/me/data/contents/picknest.json'],
    '新建文件之前一定再问一次是不是私有的');
  assert.ok(mac.statuses.some(s => s.running) && !mac.sync.status().running);
  assert.equal(SYNC_FILE, DATA); assert.equal(APP_ID, 'picknest');
  assert.ok(!JSON.stringify(j).includes('github_pat_test'), '令牌不进同步的数据');
});

test('文件名、App 标识是参数：别的名字的文件不碰，别的 App 写的文件不合并（badFile）', async () => {
  const gh = mockGitHub();
  const cfg = { repo: 'me/data', token: 'github_pat_test' };
  let state = ensureSeeds(blankState());
  const sync = createSync({ getState: () => state, applyRemote: m => { state = m; }, getConfig: () => cfg, saveConfig() {}, editVersion: () => 0,
    file: 'other.json', app: 'other', fetch: (...a) => gh.fetch(...a), sleep: async () => {} });
  assert.equal((await sync.syncNow()).ok, true);
  assert.ok(gh.files.has('other.json') && !gh.files.has(DATA));
  assert.equal(JSON.parse(dec(gh.files.get('other.json').bytes)).app, 'other');
  gh.putFile('other.json', enc(JSON.stringify({ app: 'picknest', v: 1, state: blankState() })));
  const r = await sync.syncNow();
  assert.deepEqual([r.ok, r.error.code, r.error.vars.file], [false, 'badFile', 'other.json']);
});

test('两台设备合并到一致；没变化时带 ETag 得到 304，不再提交', async () => {
  const gh = mockGitHub(), mac = device(gh, 'Mac'), ipad = device(gh, 'iPad');
  mac.item('i_1');
  await mac.run();
  await ipad.run();
  assert.ok(ipad.state.data.items.i_1);
  assert.deepEqual(ipad.applied, ['Mac'], 'applyRemote 带着上次写入的设备名');
  ipad.item('i_2'); mac.item('i_3');
  await ipad.run();
  await mac.run();                                    // 带着旧 sha 上传 → 409 → 重新拉取合并再传
  await ipad.run();
  for (const d of [mac, ipad]) assert.deepEqual(Object.keys(d.state.data.items).sort(), ['i_1', 'i_2', 'i_3'], d.name);
  assert.equal(canon(normalizeState(mac.state)), canon(normalizeState(ipad.state)));
  const puts = gh.puts;
  gh.log.length = 0;
  await mac.run(); await ipad.run();
  assert.equal(gh.puts, puts, '没有改动：不再提交');
  assert.equal(gh.log.filter(l => l.endsWith('/contents/' + DATA)).length, 2, '每轮只问一次');
  gh.n304 = 0;
  await mac.run(); await ipad.run();
  assert.equal(gh.n304, 2, '带 ETag 再问：304');
  assert.ok(gh.opts.filter(o => o.path.endsWith(DATA)).every(o => o.cache === 'no-store'), '不走浏览器缓存');
});

test('409 冲突：重新拉取、合并后再传（中间等一小会儿），两边的修改都在', async () => {
  const gh = mockGitHub(), mac = device(gh, 'Mac'), ipad = device(gh, 'iPad');
  mac.item('i_1'); await mac.run(); await ipad.run();
  ipad.item('i_ipad');
  mac.item('i_mac');
  gh.onPut = async () => { await ipad.sync.syncNow(); };      // Mac 上传的那一刻，iPad 抢先提交了
  const r = await mac.sync.syncNow();
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(gh.json().state.data.items).sort(), ['i_1', 'i_ipad', 'i_mac']);
  assert.deepEqual(Object.keys(mac.state.data.items).sort(), ['i_1', 'i_ipad', 'i_mac']);
  assert.equal(mac.cfg.dirty, false);
  assert.equal(mac.sleeps.length, 1); assert.ok(mac.sleeps[0] >= 150 && mac.sleeps[0] <= 300, '带一点随机的等待');
});

test('上传返回 422（文件已经有了、没给 sha）：重新拉取再决定，不当成功；一直冲突 4 次以后报 mergeFail（暂时的错误）', async () => {
  const gh = mockGitHub(), mac = device(gh, 'Mac');
  mac.item('i_1');
  gh.faults.push({ method: 'PUT', path: DATA, status: 422 });
  assert.equal((await mac.run()).ok, true);
  assert.equal(gh.writes().length, 2);
  assert.ok(gh.json().state.data.items.i_1);
  const pc = device(gh, 'PC');
  pc.item('i_pc');
  gh.faults.push({ method: 'PUT', path: DATA, status: 409, times: 99 });
  const r = await pc.run();
  assert.deepEqual([r.ok, r.error.code], [false, 'mergeFail']);
  assert.equal(gh.writes().length, 2 + 4, '最多传 4 次');
  assert.equal(pc.sleeps.length, 3);
  assert.equal(temporary(r.error), true);
  assert.equal(pc.cfg.dirty, true, '还没传上去');
});

test('云端的文件被删了（带着旧 sha 上传 → 404）：重新拉取，确认私有以后新建', async () => {
  const gh = mockGitHub(), mac = device(gh, 'Mac');
  mac.item('i_1'); await mac.run();
  gh.files.delete(DATA);
  mac.item('i_2');
  const r = await mac.run({ pushFirst: true });
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(gh.json().state.data.items).sort(), ['i_1', 'i_2']);
});

test('超过 1 MB 的 picknest.json：object 格式只给 sha，再用 raw 取原文；ETag 只在合并成功以后记', async () => {
  const gh = mockGitHub({ big: 2000 }), mac = device(gh, 'Mac'), ipad = device(gh, 'iPad');
  mac.item('i_1'); await mac.run();
  await ipad.run();
  mac.item('i_big', { name: '长长的备注', note: '🥬'.repeat(800) }); await mac.run();
  assert.ok(gh.files.get(DATA).bytes.length > 2000);
  // object 格式的 GET 正常，接着取 raw 原文时断网：这一轮没合并，ETag 不能记，下一轮要完整再拉
  gh.faults.push({ method: 'GET', path: DATA, accept: 'application/vnd.github.raw+json', throws: true });
  const r = await ipad.run();
  assert.equal(r.offline, true);
  assert.equal(ipad.state.data.items.i_big, undefined);
  await ipad.run();
  assert.equal(ipad.state.data.items.i_big.note, mac.state.data.items.i_big.note, '没被 304 挡住');
  assert.ok(gh.log.filter(l => l === 'GET /repos/me/data/contents/' + DATA).length >= 4);
});

test('仓库必须是私有的：公开的不传（visibility 不是 private 就算公开，internal 也不行）；5 分钟内不重复问；checkRepo 的各种错', async () => {
  const gh = mockGitHub(), mac = device(gh, 'Mac');
  assert.equal(await mac.sync.checkRepo(' https://github.com/me/data ', 'github_pat_test'), 'me/data');
  await assert.rejects(mac.sync.checkRepo('me/data', 'github_pat_wrong'), e => e instanceof SyncError && e.code === 'auth');
  await assert.rejects(mac.sync.checkRepo('me/nope', 'github_pat_test'), e => e.code === 'notfound');
  await assert.rejects(mac.sync.checkRepo('nope', 'github_pat_test'), e => e.code === 'badRepo');
  await assert.rejects(mac.sync.checkRepo('me/data', 'ghp_classic'), e => e.code === 'classic');
  assert.equal(gh.log.filter(l => l.includes('/repos/nope') || l.includes('ghp')).length, 0);
  gh.private = false;
  await assert.rejects(mac.sync.checkRepo('me/data', 'github_pat_test'), e => e.code === 'public');
  gh.visibility = 'internal'; gh.private = true;
  await assert.rejects(mac.sync.checkRepo('me/data', 'github_pat_test'), e => e.code === 'public');
  gh.visibility = undefined; gh.private = false;
  mac.item('i_1');
  const r = await mac.run();
  assert.deepEqual([r.ok, r.error.code], [false, 'public']);
  assert.equal(gh.puts, 0, '没传');
  assert.equal(gh.log.filter(l => l.includes('/contents/')).length, 0, '连文件都没读');
  gh.private = true;
  gh.log.length = 0;
  await mac.run(); mac.item('i_2'); await mac.run();
  assert.equal(gh.log.filter(l => l === 'GET /repos/me/data').length, 2, '第一次一次、新建文件前一次；之后 5 分钟内不再问');
});

test('同步码里是经典令牌（有前缀的、以前没前缀的 40 位）或者不是 Fine-grained 令牌：一个请求都不发（只读的云端恢复也不发），报原因', async () => {
  for (const [token, code] of [['ghp_classic', 'classic'], ['0123456789abcdef0123456789abcdef01234567', 'classic'], ['ghr_refresh', 'classic'], ['some-other-token', 'notFine']]) {
    const gh = mockGitHub(), mac = device(gh, 'Mac', { token });
    mac.item('i_1');
    const r = await mac.run();
    assert.deepEqual([r.ok, r.error.code], [false, code], token);
    await assert.rejects(mac.sync.readRemote(), e => e instanceof SyncError && e.code === code);
    await assert.rejects(mac.sync.checkRepo('me/data', token), e => e.code === code);
    assert.equal(gh.log.length, 0, token);
  }
});

test('401 → auth；断网不算错误，只标离线；403 → perm；请求太多（429 / 403 + 剩余 0）→ rate，带着能再试的时刻', async () => {
  const gh = mockGitHub();
  const a = device(gh, 'Mac', { token: 'github_pat_expired' });
  a.item('i_1');
  let r = await a.run();
  assert.deepEqual([r.ok, r.error.code, a.cfg.err.code], [false, 'auth', 'auth']);
  const b = device(gh, 'iPad');
  gh.faults.push({ throws: true, times: 99 });
  r = await b.run();
  assert.deepEqual([r.ok, r.offline, b.cfg.err, b.cfg.offline], [false, true, null, true]);
  gh.faults.length = 0;
  const c = device(gh, 'PC');
  c.item('i_c');
  gh.faults.push({ method: 'PUT', status: 403, message: 'Resource not accessible by personal access token' });
  r = await c.run();
  assert.equal(r.error.code, 'perm');
  gh.faults.push({ path: '/repos/me/data', status: 403, headers: { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': '1900000000' } });
  r = await c.run();
  assert.deepEqual([r.error.code, r.error.vars.status, r.error.vars.until], ['rate', 403, 1900000000 * 1000]);
  assert.equal(temporary(r.error), true);
  const before = Date.now();
  gh.faults.push({ path: '/repos/me/data', status: 429, headers: { 'Retry-After': '30' } });
  c.sync = c.open();                                  // 重新打开：私有的确认要重新问
  r = await c.run();
  assert.equal(r.error.code, 'rate');
  assert.ok(r.error.vars.until >= before + 30000 && r.error.vars.until <= Date.now() + 30000);
  r = await c.run();
  assert.equal(r.ok, true, '过后照常同步');
  assert.equal(c.cfg.err, null);
});

test('上传期间本机又改了：上传完仍算有改动，下一轮再传', async () => {
  const gh = mockGitHub(), mac = device(gh, 'Mac');
  mac.item('i_1');
  gh.onPut = async () => { mac.item('i_during'); };
  assert.equal((await mac.run()).ok, true);
  assert.equal(mac.cfg.dirty, true, '上传的那一份里没有 i_during');
  assert.equal(gh.json().state.data.items.i_during, undefined);
  await mac.run();
  assert.ok(gh.json().state.data.items.i_during);
  assert.equal(mac.cfg.dirty, false);
});

test('拉取结果落盘时又接上另一个标签页的记录：仍标记待上传，不能把新记录漏在云端外', async () => {
  const gh = mockGitHub(), mac = device(gh, 'Mac');
  mac.item('i_remote'); await mac.run();
  let current = ensureSeeds(blankState());
  const cfg = { repo: 'me/data', token: 'github_pat_test', dirty: false };
  const sync = createSync({
    getState: () => current,
    applyRemote: merged => { current = merged; current.data.items.i_local = normalizeRecord('items', { id: 'i_local', listId: 'l_tobuy', name: '另一页刚存的', updatedAt: Date.now() }); },
    getConfig: () => cfg, saveConfig() {}, editVersion: () => 0, device: '测试标签页', fetch: (...a) => gh.fetch(...a), sleep: async () => {},
  });
  assert.equal((await sync.syncNow()).ok, true);
  await sync.idle();
  assert.deepEqual(Object.keys(gh.json().state.data.items).sort(), ['i_local', 'i_remote']);
  assert.equal(cfg.dirty, false);
});

test('picknest.json 被手动改坏了 / 是别的 App 的：报 badFile，不覆盖云端；新版 App 写的：报 newer，也不覆盖；修好以后照常同步', async () => {
  const gh = mockGitHub(), mac = device(gh, 'Mac');
  mac.item('i_1'); await mac.run();
  for (const [bytes, code] of [['{"app":"picknest","v":1,"state":{"da', 'badFile'], [JSON.stringify({ app: 'babble', v: 1, state: blankState() }), 'badFile'],
    [JSON.stringify({ app: 'picknest', v: 2, state: { v: 2, data: {} } }), 'newer']]) {
    gh.putFile(DATA, enc(bytes));
    mac.item('i_' + code + gh.puts);
    const puts = gh.puts;
    const r = await mac.run();
    assert.deepEqual([r.ok, r.error.code, r.error.vars.file], [false, code, DATA]);
    assert.equal(gh.puts, puts, '没有覆盖');
    assert.equal(dec(gh.files.get(DATA).bytes), bytes);
    assert.equal(mac.cfg.dirty, true);
  }
  gh.files.delete(DATA);
  assert.equal((await mac.run()).ok, true);
  assert.ok(gh.json().state.data.items.i_1);
  assert.throws(() => readSyncFile('null'), e => e.code === 'badFile');
});

test('预置记录和删除经得起来回同步：A 删掉的预置商店、改过名的预置清单，B（自己补了预置记录）同步以后还是删掉的、改过的，B 也不会把它传回去', async () => {
  const gh = mockGitHub(), a = device(gh, 'iPhone');
  a.remove('stores', 's_costco');
  a.edit('lists', 'l_tobuy', { name: '想要的' });
  a.remove('categories', 'c_books');
  await a.run();
  const b = device(gh, 'Mac');                        // 新设备：ensureSeeds 补了 updatedAt 0 的 Costco
  assert.equal(b.state.data.stores.s_costco.deleted, undefined);
  assert.equal((await b.run()).ok, true);
  assert.equal(b.state.data.stores.s_costco.deleted, true);
  assert.equal(b.state.data.categories.c_books.deleted, true);
  assert.equal(b.state.data.lists.l_tobuy.name, '想要的');
  assert.equal(b.cfg.dirty, false, '合并完和云端一样：不用传');
  b.item('i_b'); await b.run(); await a.run();
  for (const d of [a, b]) {
    assert.equal(d.state.data.stores.s_costco.deleted, true, d.name);
    assert.equal(d.state.data.lists.l_groceries.updatedAt, 0, '没人改过的预置记录还是 0');
  }
  assert.equal(gh.json().state.data.stores.s_costco.deleted, true);
  // 没有预置记录的云端文件（手动写的）：合并后本机补上，传上去
  gh.pushJson(s => { delete s.data.stores.s_hmart; });
  await a.run();
  assert.ok(a.state.data.stores.s_hmart);
  assert.ok(gh.json().state.data.stores.s_hmart, '补齐的预置记录传回去了');
});

test('切到后台时（pushFirst）：知道云端版本、有改动就直接上传，不先拉取；云端变过照样合并；keepalive 只给小的请求', async () => {
  const gh = mockGitHub(), mac = device(gh, 'Mac'), ipad = device(gh, 'iPad');
  mac.item('i_1'); await mac.run();
  mac.item('i_2');
  gh.log.length = 0; gh.opts.length = 0;
  assert.equal((await mac.run({ pushFirst: true, keepalive: true })).ok, true);
  assert.deepEqual(gh.log, ['PUT /repos/me/data/contents/' + DATA], '一个请求');
  assert.equal(gh.opts[0].keepalive, true);
  // 云端被别的设备改过：409 → 合并 → 再传
  await ipad.run(); ipad.item('i_ipad'); await ipad.run();
  mac.item('i_3');
  assert.equal((await mac.run({ pushFirst: true, keepalive: true })).ok, true);
  assert.deepEqual(Object.keys(gh.json().state.data.items).sort(), ['i_1', 'i_2', 'i_3', 'i_ipad']);
  // 没改动：照常先拉取；请求体太大（keepalive 有 64 KB 上限）：不带 keepalive
  mac.item('i_big', { note: 'x'.repeat(70000) });
  gh.opts.length = 0;
  await mac.run({ pushFirst: true, keepalive: true });
  assert.equal(gh.opts.find(o => o.method === 'PUT').keepalive, undefined);
  gh.log.length = 0;
  await mac.run({ pushFirst: true });
  assert.deepEqual(gh.log, ['GET /repos/me/data/contents/' + DATA], '没改动：只拉取');
});

test('同步中途停止了（或换了仓库、本机数据出了问题 → getConfig 返回 null）：不再上传', async () => {
  const gh = mockGitHub(), mac = device(gh, 'Mac');
  mac.item('i_1');
  gh.faults.push({ method: 'GET', path: DATA, status: 404, message: 'Not Found' });
  const orig = gh.fetch;
  gh.fetch = async (url, opt) => { const r = await orig(url, opt); if (url.endsWith(DATA) && (opt.method || 'GET') === 'GET') mac.cfg = null; return r; };
  const r = await mac.run();
  assert.equal(r.skipped, true);
  assert.equal(gh.puts, 0);
  gh.fetch = orig;
  mac.cfg = null;
  assert.deepEqual(await mac.run(), { ok: true, skipped: true }, '没开同步：什么也不做');
});

test('一次只跑一轮：同时点了两次，第二轮等第一轮做完', async () => {
  const gh = mockGitHub(), mac = device(gh, 'Mac');
  mac.item('i_1');
  let inFlight = 0, max = 0;
  const orig = gh.fetch;
  gh.fetch = async (...a) => { inFlight++; max = Math.max(max, inFlight); await new Promise(r => setImmediate(r)); try { return await orig(...a); } finally { inFlight--; } };
  const [r1, r2] = await Promise.all([mac.sync.syncNow(), mac.sync.syncNow()]);
  assert.equal(r1.ok && r2.ok, true);
  assert.equal(max, 1);
  assert.equal(gh.puts, 1);
});

test('readRemote（恢复页「从云端恢复」）：只读、要原文；云端没有 → nofile；没开 → off', async () => {
  const gh = mockGitHub({ big: 100 }), mac = device(gh, 'Mac');
  await assert.rejects(mac.sync.readRemote(), e => e.code === 'nofile' && e.vars.file === DATA);
  mac.item('i_1', { name: '云端的牛奶' }); await mac.run();
  gh.log.length = 0;
  const st = await mac.sync.readRemote();
  assert.equal(st.data.items.i_1.name, '云端的牛奶');
  assert.deepEqual(gh.log, ['GET /repos/me/data/contents/' + DATA]);
  assert.equal(gh.opts.at(-1).headers.Accept, 'application/vnd.github.raw+json');
  mac.cfg = null;
  await assert.rejects(mac.sync.readRemote(), e => e.code === 'off');
});
