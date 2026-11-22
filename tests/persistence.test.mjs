import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPersistence, readStoredState, STATE_KEY, PENDING_PREFIX, ARCHIVE_PREFIX, STATE_LOCK, LocalDataError } from '../src/core/persistence.js';
import { blankState, normalizeRecord, setSetting, deletedRecord, canon } from '../src/core/store.js';
import { fakeStorage } from './helpers/dom.mjs';

// 测试只用编出来的数据
const fakeLocks = () => {
  let chain = Promise.resolve();
  const names = [];
  const lk = { names, held: false, request(name, fn) { names.push(name); const p = chain.then(async () => { lk.held = true; try { return await fn(); } finally { lk.held = false; } }); chain = p.catch(() => {}); return p; } };
  return lk;
};
const item = (id, name = id) => normalizeRecord('items', { id, listId: 'l_groceries', name, updatedAt: 1000 });
const itemState = (id, name = id) => { const s = blankState(); s.data.items[id] = item(id, name); return s; };
const pending = st => [...st.m.keys()].filter(k => k.startsWith(PENDING_PREFIX));

test('键名都带 picknest 前缀（同一个域名下还有别的 App），日志里 app 是 picknest', () => {
  assert.deepEqual([STATE_KEY, PENDING_PREFIX, ARCHIVE_PREFIX, STATE_LOCK], ['picknest.state', 'picknest.pending.', 'picknest.recovery.', 'picknest-state-write']);
  const st = fakeStorage();
  createPersistence(st, { locks: null }).save(itemState('a'));
  const [key] = pending(st);
  assert.equal(JSON.parse(st.getItem(key)).app, 'picknest');
});

test('多标签页：旧快照各自新增，不等 storage 事件也都能落盘，重启后两条都在', () => {
  const st = fakeStorage(), a = createPersistence(st, { locks: null }), b = createPersistence(st, { locks: null });
  a.save(itemState('a'));
  b.save(itemState('b'));
  assert.deepEqual(Object.keys(readStoredState(st).data.items).sort(), ['a', 'b']);
  assert.equal(pending(st).length, 2);
  assert.equal(st.getItem(STATE_KEY), null, '未整理前不需要依赖总快照');
  assert.equal(canon(createPersistence(st, { locks: null }).read()), canon(readStoredState(st)));
});

test('真正交错写入：两页都读过旧快照，另一页插在日志写入前保存，互不覆盖', () => {
  const st = fakeStorage(), a = createPersistence(st, { locks: null }), b = createPersistence(st, { locks: null });
  const write = st.setItem;
  let interleave = true;
  st.setItem = (key, value) => {
    if (interleave && key.startsWith(PENDING_PREFIX)) { interleave = false; b.save(itemState('b')); }
    return write(key, value);
  };
  a.save(itemState('a'));
  assert.deepEqual(Object.keys(readStoredState(st).data.items).sort(), ['a', 'b']);
});

test('只写改了的记录：日志里没有没动过的记录', () => {
  const st = fakeStorage(), p = createPersistence(st, { locks: null });
  const s = itemState('a'); s.data.items.b = item('b');
  p.save(s);
  const next = p.read(); next.data.items.b = { ...next.data.items.b, note: '改了', updatedAt: 2000 };
  p.save(next);
  const last = JSON.parse(st.getItem(pending(st).sort().at(-1)));
  assert.deepEqual(Object.keys(last.patch.data.items), ['b']);
});

test('整理持有同一个 Web Lock；写好快照后才删日志，原有快照的数据也一起保留', async () => {
  const st = fakeStorage(), locks = fakeLocks();
  st.setItem(STATE_KEY, JSON.stringify(itemState('legacy')));
  // 写快照、删日志时一定拿着锁（不然两个标签页同时整理，会删掉对方刚写的日志）
  const unlocked = [];
  const write = st.setItem, remove = st.removeItem;
  st.setItem = (k, v) => { if (k === STATE_KEY && !locks.held) unlocked.push(k); return write(k, v); };
  st.removeItem = (k) => { if (!locks.held) unlocked.push(k); return remove(k); };
  const a = createPersistence(st, { locks }), b = createPersistence(st, { locks });
  a.save(itemState('a')); b.save(itemState('b'));
  await Promise.all([a.idle(), b.idle()]);
  assert.deepEqual(Object.keys(JSON.parse(st.getItem(STATE_KEY)).data.items).sort(), ['a', 'b', 'legacy']);
  assert.equal(pending(st).length, 0);
  assert.ok(locks.names.length > 0);
  assert.ok(locks.names.every(n => n === 'picknest-state-write'));
  assert.deepEqual(unlocked, [], '整理都在锁里');
});

test('整理期间另一个标签页写入：新日志不能被前一轮删除', async () => {
  const st = fakeStorage(), a = createPersistence(st, { locks: fakeLocks() }), b = createPersistence(st, { locks: null });
  const write = st.setItem;
  let interleave = true;
  st.setItem = (key, value) => {
    if (key === STATE_KEY && interleave) { interleave = false; b.save(itemState('b')); }
    return write(key, value);
  };
  a.save(itemState('a'));
  await a.idle();
  assert.equal(pending(st).length, 1, '这轮没读到的日志仍在');
  assert.deepEqual(Object.keys(readStoredState(st).data.items).sort(), ['a', 'b']);
  a.read(); await a.idle();
  assert.equal(pending(st).length, 0);
  assert.deepEqual(Object.keys(JSON.parse(st.getItem(STATE_KEY)).data.items).sort(), ['a', 'b']);
});

test('快照写不下：保存成功的日志不删；关闭后能恢复，空间恢复后再整理', async () => {
  const st = fakeStorage(), write = st.setItem;
  st.setItem = (key, value) => { if (key === STATE_KEY) throw new Error('quota'); return write(key, value); };
  const a = createPersistence(st, { locks: fakeLocks() });
  a.save(itemState('a', '牛奶')); await a.idle();
  assert.equal(pending(st).length, 1);
  assert.equal(readStoredState(st).data.items.a.name, '牛奶');
  st.setItem = write;
  const reopened = createPersistence(st, { locks: fakeLocks() });
  assert.equal(reopened.read().data.items.a.name, '牛奶'); await reopened.idle();
  assert.equal(pending(st).length, 0);
});

test('日志写失败绝不算成功；原数据保留，空间恢复后可以重试同一份修改', () => {
  const st = fakeStorage(), a = createPersistence(st, { locks: null });
  st.setItem(STATE_KEY, JSON.stringify(itemState('a', '旧')));
  const next = a.read(); next.data.items.a.name = '新'; next.data.items.a.updatedAt++;
  const write = st.setItem;
  st.setItem = () => { throw new Error('quota'); };
  assert.throws(() => a.save(next), /quota/);
  assert.equal(readStoredState(st).data.items.a.name, '旧');
  st.setItem = write; a.save(next);
  assert.equal(readStoredState(st).data.items.a.name, '新');
});

test('读日志时另一个标签页完成整理：重读新快照，不能漏掉已删掉的日志', () => {
  const st = fakeStorage(), a = createPersistence(st, { locks: null });
  a.save(itemState('a'));
  const complete = readStoredState(st), get = st.getItem;
  let interleave = true;
  st.getItem = key => {
    if (key.startsWith(PENDING_PREFIX) && interleave) {
      interleave = false;
      st.setItem(STATE_KEY, JSON.stringify(complete));
      for (const k of pending(st)) st.removeItem(k);
    }
    return get(key);
  };
  assert.equal(readStoredState(st).data.items.a.name, 'a');
});

test('日志按现有规则合并：删除不复活、设置分别保留、needs 和旧版未知字段保留', () => {
  const st = fakeStorage(), a = createPersistence(st, { locks: null }), b = createPersistence(st, { locks: null });
  const initial = itemState('a'); initial.data.items.a.future = { keep: true }; initial.data.items.a.needs = { 'recipe:r_1': { qty: 2, unit: '个', label: '测试菜' } };
  initial.settings.future = '旧版无时间戳的设置';
  st.setItem(STATE_KEY, JSON.stringify(initial));
  const deleted = a.read(), other = b.read();
  deleted.data.items.a = deletedRecord(deleted.data.items.a, 2000);
  setSetting(deleted, 'x', 'a', 2000);
  setSetting(other, 'y', 5, 2000); other.data.items.b = item('b', '测试');
  a.save(deleted); b.save(other);
  const merged = readStoredState(st);
  assert.equal(merged.data.items.a.deleted, true);
  assert.deepEqual(merged.data.items.a.future, { keep: true });
  assert.deepEqual(merged.data.items.a.needs, { 'recipe:r_1': { qty: 2, unit: '个', label: '测试菜' } });
  assert.equal(merged.settings.x, 'a');
  assert.equal(merged.settings.y, 5);
  assert.equal(merged.settings.future, initial.settings.future);
});

test('state 集成：两页写入、storage 重载、空间满后的无改动重试，都不丢记录', async () => {
  const a = await import('../src/core/state.js?tab=persistence-a');
  const b = await import('../src/core/state.js?tab=persistence-b');
  const st = fakeStorage();
  a.load({ storage: st, locks: null }); b.load({ storage: st, locks: null });
  a.mutate(s => { s.data.items.a = item('a', 'A'); });
  b.mutate(s => { s.data.items.b = item('b', 'B'); });
  a.reload(); b.reload();
  assert.equal(canon(a.getState()), canon(b.getState()));
  assert.equal(Object.keys(a.getState().data.items).length, 2);
  assert.equal(Object.keys(a.getState().data.lists).length, 2, '重载后预置记录还在');
  const write = st.setItem;
  st.setItem = () => { throw new Error('quota'); };
  a.mutate(s => { s.data.items.a.name = '未保存'; });
  assert.equal(a.saveOk(), false);
  a.reload();
  assert.equal(a.getState().data.items.a.name, '未保存', '重载不能覆盖内存里没存下的改动');
  assert.equal(a.saveOk(), false);
  st.setItem = write;
  a.mutate(s => { s.data.items.a.name = '未保存'; });
  assert.equal(a.saveOk(), true, '没有新的字段改动也会重试落盘');
  assert.equal(readStoredState(st).data.items.a.name, '未保存');
  b.reload();
  assert.equal(b.getState().data.items.a.name, '未保存');
});

test('state 集成：只变本机设置不推进版本；接到别的标签页记录会推进版本', async () => {
  const a = await import('../src/core/state.js?tab=version-a');
  const b = await import('../src/core/state.js?tab=version-b');
  const st = fakeStorage();
  a.load({ storage: st, locks: null }); b.load({ storage: st, locks: null });
  const seen = []; a.subscribe((s, info) => seen.push(info));
  const v = a.editVersion(); a.reload();
  assert.equal(seen.at(-1).changed, false);
  assert.equal(a.editVersion(), v);
  b.mutate(s => { s.data.items.b = item('b', '测试'); });
  a.reload();
  assert.equal(seen.at(-1).changed, true);
  assert.equal(a.editVersion(), v + 1);
});

test('浏览器存储暂不可用：重试仍失败时保持保护，恢复后重新获取存储并正常读写', async () => {
  const a = await import('../src/core/state.js?tab=browser-storage-retry');
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const st = fakeStorage(); st.setItem(STATE_KEY, JSON.stringify(itemState('existing')));
  st.setItem(a.LKEY, JSON.stringify({ lang: 'en', sync: { repo: 'someone/test-data', token: 'synthetic', dirty: false } }));
  let available = false;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { if (!available) throw new Error('SecurityError'); return st; } });
  try {
    a.load({ locks: null });
    assert.equal(a.storageIssue().code, 'unavailable');
    assert.equal(Object.keys(a.getState().data.lists).length, 0, '什么也没读到：不补预置清单（恢复页数的是读出来的）');
    a.reload();
    assert.equal(a.storageIssue().code, 'unavailable', '访问仍被拒绝时不能解除保护');
    assert.equal(Object.keys(a.getState().data.lists).length, 0);
    assert.equal(a.saveOk(), false);
    assert.throws(() => a.mutate(s => { s.data.items.new = item('new'); }));
    available = true;
    a.reload();
    assert.equal(a.storageIssue(), null);
    assert.equal(a.saveOk(), true);
    assert.equal(a.getState().data.items.existing.name, 'existing');
    assert.equal(Object.keys(a.getState().data.lists).length, 2, '存储能用了再补预置清单');
    assert.equal(a.getLocal().lang, 'en');
    a.mutate(s => { s.data.items.existing.name = '重试后保存的测试文字'; });
    assert.equal(a.saveOk(), true);
    assert.equal(readStoredState(st).data.items.existing.name, '重试后保存的测试文字');
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original); else delete globalThis.localStorage;
  }
});

test('浏览器存储对象更换后重试会重连，显式注入的存储和纯内存模式不会读取浏览器存储', async () => {
  const a = await import('../src/core/state.js?tab=browser-storage-rebind');
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const first = fakeStorage(), second = fakeStorage();
  first.setItem(STATE_KEY, JSON.stringify(itemState('first')));
  second.setItem(STATE_KEY, JSON.stringify(itemState('second')));
  let current = first, reads = 0;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { reads++; if (!current) throw new Error('SecurityError'); return current; } });
  try {
    a.load({ locks: null });
    current = null; a.reload();
    assert.equal(a.storageIssue().code, 'unavailable');
    assert.ok(a.getState().data.items.first, '访问失败不能清掉内存中已有的记录');
    current = second; a.reload();
    assert.equal(a.storageIssue(), null);
    assert.deepEqual(Object.keys(a.getState().data.items).sort(), ['first', 'second']);
    assert.ok(readStoredState(second).data.items.first, '重连后合并而非丢掉原有的内存记录');
    const injected = fakeStorage(); injected.setItem(STATE_KEY, JSON.stringify(itemState('injected')));
    reads = 0;
    a.load({ storage: injected, locks: null }); a.reload();
    assert.deepEqual(Object.keys(a.getState().data.items), ['injected']);
    a.load({ storage: null }); a.mutate(s => { s.data.items.memory = item('memory'); }); a.reload();
    assert.ok(a.getState().data.items.memory);
    assert.equal(a.saveOk(), true);
    assert.equal(reads, 0, '测试注入与纯内存模式仍保持隔离');
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original); else delete globalThis.localStorage;
  }
});

test('state 集成：空间满后由 storage 事件补存，旧配置不能抹掉待同步标记', async () => {
  const a = await import('../src/core/state.js?tab=retry-sync');
  const st = fakeStorage();
  a.load({ storage: st, locks: null });
  a.setLocal({ sync: { repo: 'someone/test-data', token: 'synthetic', dirty: false } });
  const write = st.setItem;
  st.setItem = () => { throw new Error('quota'); };
  a.mutate(s => { s.data.items.a = item('a', '等待补存'); });
  assert.equal(a.saveOk(), false);
  st.setItem = write;
  a.reload();
  assert.equal(a.saveOk(), true);
  assert.equal(a.getLocal().sync.dirty, true);
  assert.equal(readStoredState(st).data.items.a.name, '等待补存');
});

test('损坏快照：原始 JSON 不覆盖；健康日志仍可读，导出不含本机同步令牌', async () => {
  const st = fakeStorage();
  st.setItem(STATE_KEY, '{broken-json'); st.setItem('picknest.local', JSON.stringify({ sync: { token: 'synthetic-secret' } }));
  st.setItem(PENDING_PREFIX + 'healthy', JSON.stringify({ app: 'picknest', v: 1, patch: itemState('kept') }));
  const p = createPersistence(st, { locks: fakeLocks() });
  assert.throws(() => p.read(), e => e instanceof LocalDataError && !!e.state.data.items.kept);
  assert.throws(() => p.save(itemState('new')), LocalDataError);
  await p.idle();
  assert.equal(st.getItem(STATE_KEY), '{broken-json');
  const evidence = p.evidence();
  assert.equal(evidence.app, 'picknest');
  assert.equal(evidence.records.find(r => r.key === STATE_KEY).raw, '{broken-json');
  assert.ok(!JSON.stringify(evidence).includes('synthetic-secret'));
  assert.equal(evidence.state.data.items.kept.name, 'kept');
});

test('有效 JSON 但结构损坏、或者是别的 App 的数据，也不能当成空白覆盖', () => {
  for (const raw of ['null', '[]', '"text"', '{"data":[]}', '{"app":"babble"}', '{"v":99}', '{"data":{"items":[]}}']) {
    const st = fakeStorage(); st.setItem(STATE_KEY, raw);
    assert.throws(() => readStoredState(st), LocalDataError, raw);
    assert.throws(() => createPersistence(st).save(itemState('new')), LocalDataError);
    assert.equal(st.getItem(STATE_KEY), raw);
  }
  const st = fakeStorage(); st.setItem(PENDING_PREFIX + 'x', JSON.stringify({ app: 'babble', v: 1, patch: itemState('a') }));
  assert.throws(() => readStoredState(st), LocalDataError, '日志的 app 不对');
});

test('部分记录结构损坏：保留原始文件，可读部分仍可导出恢复，恢复前先存档', async () => {
  const st = fakeStorage();
  const original = JSON.stringify({ app: 'picknest', v: 1, data: { items: { bad: 'not a record', good: item('good', '完整记录') } } });
  st.setItem(STATE_KEY, original);
  const p = createPersistence(st, { locks: fakeLocks() });
  assert.throws(() => p.read(), e => e instanceof LocalDataError && e.state.data.items.good.name === '完整记录');
  assert.equal(p.evidence().records[0].raw, original);
  await p.recover(itemState('backup'));
  assert.ok(p.read().data.items.backup);
  assert.ok(p.read().data.items.good);
  assert.equal(p.archive().records[0].raw, original);
});

test('损坏日志：健康快照和日志一起保留；恢复先存档，再合并，不清除别的本机数据', async () => {
  const st = fakeStorage(); st.setItem(STATE_KEY, JSON.stringify(itemState('kept')));
  st.setItem(PENDING_PREFIX + 'bad', 'broken log'); st.setItem('picknest.local', 'untouched local');
  const p = createPersistence(st, { locks: fakeLocks() });
  assert.throws(() => p.read(), LocalDataError);
  const fixed = await p.recover(itemState('backup'));
  assert.deepEqual(Object.keys(fixed.data.items).sort(), ['backup', 'kept']);
  assert.equal(st.getItem('picknest.local'), 'untouched local');
  assert.equal(st.getItem(PENDING_PREFIX + 'bad'), null);
  const archive = p.archive();
  assert.equal(archive.records.find(r => r.key === PENDING_PREFIX + 'bad').raw, 'broken log');
  assert.equal(archive.records.find(r => r.key === STATE_KEY).raw, JSON.stringify(itemState('kept')));
  assert.equal(Object.keys(createPersistence(st).read().data.items).length, 2);
});

test('恢复了几次：只留最新的一份存档（旧的下载不到，只占同一个域名下共用的空间）', async () => {
  const st = fakeStorage(), p = createPersistence(st, { locks: fakeLocks() });
  const archives = () => { const out = []; for (let i = 0; i < st.length; i++) if (st.key(i).startsWith(ARCHIVE_PREFIX)) out.push(st.key(i)); return out; };
  for (const n of [1, 2, 3]) {
    st.setItem(PENDING_PREFIX + 'bad' + n, 'broken log ' + n);
    await p.recover(itemState('backup' + n));
    await new Promise(r => setTimeout(r, 2));
  }
  assert.equal(archives().length, 1);
  assert.equal(p.archive().records.find(r => r.key.startsWith(PENDING_PREFIX)).raw, 'broken log 3', '留下的是最近一次的');
  assert.deepEqual(Object.keys(p.read().data.items).sort(), ['backup1', 'backup2', 'backup3']);
});

test('存档或新快照写不下：恢复失败，原件不删除', async () => {
  for (const failing of ['archive', 'snapshot']) {
    const st = fakeStorage(); st.setItem(STATE_KEY, 'original broken state'); st.setItem(PENDING_PREFIX + 'bad', 'original broken log');
    const write = st.setItem;
    st.setItem = (key, value) => {
      if ((failing === 'archive' && key.startsWith(ARCHIVE_PREFIX)) || (failing === 'snapshot' && key === STATE_KEY)) throw new Error('quota');
      return write(key, value);
    };
    const p = createPersistence(st, { locks: fakeLocks() });
    await assert.rejects(p.recover(itemState('backup')), /quota/);
    assert.equal(st.getItem(STATE_KEY), 'original broken state');
    assert.equal(st.getItem(PENDING_PREFIX + 'bad'), 'original broken log');
  }
});

test('恢复期间新来的日志不删除；没有锁时不执行替换', async () => {
  const st = fakeStorage(); st.setItem(STATE_KEY, 'broken');
  await assert.rejects(createPersistence(st, { locks: null }).recover(itemState('backup')), /unavailable/);
  assert.equal(st.getItem(STATE_KEY), 'broken');
  const write = st.setItem;
  st.setItem = (key, value) => { if (key === STATE_KEY) write(PENDING_PREFIX + 'late', JSON.stringify({ app: 'picknest', v: 1, patch: itemState('late') })); return write(key, value); };
  const p = createPersistence(st, { locks: fakeLocks() });
  const fixed = await p.recover(itemState('backup'));
  assert.deepEqual(Object.keys(fixed.data.items).sort(), ['backup', 'late']);
  assert.notEqual(st.getItem(PENDING_PREFIX + 'late'), null);
});

test('state 损坏期间阻止修改和合并、不补预置记录；恢复后解除保护、补上预置记录，重置同步版本并保留存档', async () => {
  const a = await import('../src/core/state.js?tab=corrupt-recovery');
  const st = fakeStorage(); st.setItem(STATE_KEY, '{broken');
  st.setItem(a.LKEY, JSON.stringify({ sync: { token: 'synthetic-secret', sha: 'stale', etag: 'stale', dirty: false } }));
  a.load({ storage: st, locks: fakeLocks() });
  assert.equal(a.storageIssue().code, 'corrupt');
  assert.equal(Object.keys(a.getState().data.lists).length, 0, '读不出来时不补预置清单（恢复页数的是读出来的）');
  assert.throws(() => a.mutate(s => { s.data.items.new = item('new'); }), LocalDataError);
  assert.equal(a.applyRemote(itemState('remote')), false);
  assert.throws(() => a.mergeIn(itemState('imported')), LocalDataError);
  assert.equal(a.saveState(), false);
  assert.equal(a.undo(), null);
  assert.equal(st.getItem(STATE_KEY), '{broken');
  await a.recoverFrom(itemState('backup'));
  assert.equal(a.storageIssue(), null); assert.equal(a.saveOk(), true);
  assert.equal(a.getState().data.items.backup.name, 'backup');
  assert.equal(Object.keys(a.getState().data.lists).length, 2);
  assert.equal(a.getLocal().sync.sha, null); assert.equal(a.getLocal().sync.dirty, true);
  assert.ok(!JSON.stringify(a.recoveryArchive()).includes('synthetic-secret'));
  a.load({ storage: st, locks: fakeLocks() });
  assert.equal(a.getState().data.items.backup.name, 'backup');
  assert.equal(a.recoveryExport().records[0].raw, '{broken');
});
