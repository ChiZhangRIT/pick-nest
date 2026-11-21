import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blankState, ensureSeeds, normalizeRecord, mergeStates, setSetting, stamp, deletedRecord, live, canon } from '../src/core/store.js';
import * as state from '../src/core/state.js';
import { readStoredState, STATE_KEY } from '../src/core/persistence.js';
import { fakeStorage } from './helpers/dom.mjs';

// 测试只用编出来的数据
const item = (id, fields = {}) => normalizeRecord('items', { id, listId: 'l_groceries', name: id, status: 'need', ...fields });
const withItem = (s, id, fields) => { s.data.items[id] = item(id, fields); return s; };

test('load：补上预置记录；没有 localStorage（storage:null）也能用；存储里没有预置记录也不另写一份', () => {
  state.load({ storage: null });
  assert.deepEqual(Object.keys(state.getState().data.lists), ['l_groceries', 'l_tobuy']);
  assert.equal(Object.keys(state.getState().data.stores).length, 8);
  const st = fakeStorage();
  state.load({ storage: st, locks: null });
  assert.equal(Object.keys(state.getState().data.categories).length, 14);
  assert.equal(st.m.size, 0, '只是打开看看，不写存储');
  assert.equal(state.storageIssue(), null);
});

test('load：已有的数据（改过名、删掉的预置记录）不被预置记录盖回去', () => {
  const s = ensureSeeds(blankState());
  s.data.lists.l_groceries = stamp({ ...s.data.lists.l_groceries, name: '吃的' }, s.data.lists.l_groceries, 5000);
  s.data.stores.s_costco = deletedRecord(s.data.stores.s_costco, 6000);
  delete s.data.stores.s_hmart;
  const st = fakeStorage([[STATE_KEY, JSON.stringify(s)]]);
  state.load({ storage: st, locks: null });
  const S = state.getState();
  assert.equal(S.data.lists.l_groceries.name, '吃的');
  assert.equal(S.data.stores.s_costco.deleted, true);
  assert.equal(S.data.stores.s_hmart.updatedAt, 0, '缺的补上');
});

test('mutate：保存、计数、补盖修改时间、按集合整理、通知订阅者；没改东西不保存不通知', () => {
  const st = fakeStorage();
  state.load({ storage: st, locks: null });
  const seen = [];
  const off = state.subscribe((s, info) => seen.push(info));
  const v0 = state.editVersion();
  const ret = state.mutate(s => { s.data.items.i1 = { id: 'i1', listId: 'l_groceries', name: '牛奶' }; return 'ok'; });
  assert.equal(ret, 'ok');
  assert.equal(state.editVersion(), v0 + 1);
  const saved = readStoredState(st).data.items.i1;
  assert.equal(saved.name, '牛奶');
  assert.deepEqual([saved.qty, saved.status, saved.unit], [1, 'need', ''], '新记录按集合补齐字段');
  assert.ok(saved.updatedAt > 1000, '没给修改时间的新记录补上现在的时间');
  // 直接改字段、忘了盖时间：自动补上
  const before = state.getState().data.items.i1.updatedAt;
  state.mutate(s => { s.data.items.i1.status = 'done'; });
  assert.ok(state.getState().data.items.i1.updatedAt > before);
  // 改预置清单：updatedAt 从 0 变成现在，createdAt 还是 0
  state.mutate(s => { s.data.lists.l_tobuy.name = '想要'; });
  assert.ok(state.getState().data.lists.l_tobuy.updatedAt > 0);
  assert.equal(state.getState().data.lists.l_tobuy.createdAt, 0);
  const n = seen.length, v = state.editVersion();
  state.mutate(() => {});
  assert.equal(seen.length, n);
  assert.equal(state.editVersion(), v);
  assert.deepEqual([seen[0].source, seen[0].ids], ['local', ['i1']]);
  off();
  state.load({ storage: st, locks: null });
  assert.equal(state.getState().data.items.i1.status, 'done');
  assert.equal(state.getState().data.lists.l_tobuy.name, '想要');
});

test('mutate：只有真的改了的记录才盖新时间，其余（包括预置记录）原样', () => {
  state.load({ storage: fakeStorage(), locks: null });
  const before = structuredClone(state.getState());
  state.mutate(s => { s.data.items.x = { id: 'x', listId: 'l_tobuy', name: '剪刀' }; });
  const after = state.getState();
  for (const c of ['lists', 'stores', 'categories']) assert.equal(canon(after.data[c]), canon(before.data[c]), c);
});

test('mutate：内容没变的写入（同样的值、整理后一样的值、手动盖了新时间）不算修改——预置记录还是 updatedAt 0，不保存、不进撤销', () => {
  const st = fakeStorage();
  state.load({ storage: st, locks: null });
  const seen = [];
  const off = state.subscribe((s, info) => seen.push(info));
  const v = state.editVersion();
  const amazon = state.getState().data.stores.s_amazon;
  state.mutate(s => { s.data.stores.s_amazon = stamp({ ...s.data.stores.s_amazon, archived: false }, s.data.stores.s_amazon); }, { undoLabel: '没改' });
  state.mutate(s => { s.data.stores.s_amazon.order = String(amazon.order); s.data.lists.l_tobuy.updatedAt = 99; });
  off();
  assert.deepEqual(state.getState().data.stores.s_amazon, amazon);
  assert.equal(state.getState().data.lists.l_tobuy.updatedAt, 0);
  assert.equal(state.editVersion(), v);
  assert.equal(state.peekUndo(), null);
  assert.equal(seen.length, 0);
  assert.equal(st.m.size, 0, '没写存储');
  // 另一台设备删掉了这家店：这台上没改东西的写入不能让它在合并后复活
  const other = ensureSeeds(blankState());
  other.data.stores.s_amazon = deletedRecord(other.data.stores.s_amazon, Date.now() - 60000);
  assert.equal(ensureSeeds(mergeStates(state.getState(), other)).data.stores.s_amazon.deleted, true);
});

test('mutate：写坏了的记录（null、存不下的 id、存不下的集合名）报错并整个撤回，不留半整理的数据', () => {
  state.load({ storage: fakeStorage(), locks: null });
  state.mutate(s => { s.data.items.i1 = item('i1', { name: '牛奶' }); });
  const before = canon(state.getState()), v = state.editVersion();
  const bad = [
    s => { s.data.items.i1.note = '同一次里改的别的'; s.data.stores.s_amazon = null; },
    s => { s.data.items.i2 = null; },
    s => { s.data.items['milk 2'] = item('milk 2'); },
    s => { s.data['my items'] = { x: item('x') }; },
  ];
  for (const fn of bad) {
    assert.throws(() => state.mutate(fn), /bad-/);
    assert.equal(canon(state.getState()), before);
  }
  assert.equal(state.editVersion(), v);
  assert.equal(live(state.getState(), 'stores').length, 8, '撤回后照常能用');
});

test('mutate：硬删除自动变成软删除；撤销删除 = 原样恢复；撤销新建 = 软删除；设置也能撤销', () => {
  state.load({ storage: fakeStorage(), locks: null });
  state.mutate(s => { s.data.items.i1 = item('i1', { name: '鸡蛋', note: '一打' }); }, { undoLabel: '新建' });
  state.mutate(s => { delete s.data.items.i1; }, { undoLabel: '删除' });
  const tomb = state.getState().data.items.i1;
  assert.equal(tomb.deleted, true);
  assert.equal(tomb.note, '一打');
  assert.equal(state.peekUndo(), '删除');
  assert.equal(state.undo(), '删除');
  const back = state.getState().data.items.i1;
  assert.equal(back.deleted, undefined);
  assert.ok(back.updatedAt > tomb.updatedAt, '撤销也要盖新时间，同步时才会赢');
  assert.equal(state.undo(), '新建');
  assert.equal(state.getState().data.items.i1.deleted, true);
  assert.equal(state.undo(), null);
  state.mutate(s => setSetting(s, 'future', 'on'), { undoLabel: '设置' });
  assert.equal(state.getState().settings.future, 'on');
  state.undo();
  assert.equal(state.getState().settings.future, undefined);
});

test('撤销只改回那次改动的字段——之后同步来的别的字段不会被盖掉', () => {
  state.load({ storage: fakeStorage(), locks: null });
  state.mutate(s => { s.data.items.i1 = item('i1', { name: '牛奶' }); });
  state.mutate(s => { s.data.items.i1.status = 'done'; }, { undoLabel: '买到了' });
  const cur = state.getState().data.items.i1;
  const remote = structuredClone(state.getState());
  remote.data.items.i1 = { ...cur, note: '另一台设备写的备注', updatedAt: cur.updatedAt + 5 };
  state.applyRemote(remote);
  assert.equal(state.undo(), '买到了');
  const back = state.getState().data.items.i1;
  assert.equal(back.status, 'need', '状态改回去了');
  assert.equal(back.note, '另一台设备写的备注', '对方写的备注还在');
  assert.ok(back.updatedAt > cur.updatedAt + 5);
});

test('fn 抛错时数据不变；同步合并不算本机修改并补预置记录；导入备份算本机修改、补预置记录；开了同步就标记待上传', () => {
  const st = fakeStorage();
  state.load({ storage: st, locks: null });
  state.setLocal({ sync: { repo: 'someone/pick-nest-data', token: 'synthetic', dirty: false } });
  assert.throws(() => state.mutate(s => { s.data.items.x = item('x'); throw new Error('boom'); }));
  assert.equal(Object.keys(state.getState().data.items).length, 0);
  assert.equal(state.getLocal().sync.dirty, false);
  const v = state.editVersion();
  const remote = withItem(blankState(), 'r1', { name: '云端的', updatedAt: 5 });     // 云端那份没有预置记录（比如很旧的文件）
  assert.equal(state.applyRemote(remote, { device: 'iPad' }), true);
  assert.equal(state.editVersion(), v);
  assert.equal(state.getState().data.items.r1.name, '云端的');
  assert.equal(Object.keys(state.getState().data.lists).length, 2, '合并后补上预置记录');
  assert.equal(state.getLocal().sync.dirty, false);
  const backup = withItem(blankState(), 'b1', { name: '备份里的', updatedAt: 5 });
  withItem(backup, 'r1', { name: '更旧的', updatedAt: 1 });
  assert.deepEqual(state.mergeIn(backup), { changed: 1 });
  assert.equal(state.getState().data.items.r1.name, '云端的', '合并不会用旧的覆盖新的');
  assert.equal(Object.keys(state.getState().data.stores).length, 8);
  assert.equal(state.editVersion(), v + 1);
  assert.equal(state.getLocal().sync.dirty, true);
  assert.deepEqual(state.mergeIn(backup), { changed: 0 }, '再导入一次什么也不变');
  assert.equal(JSON.parse(st.m.get(state.LKEY)).sync.token, 'synthetic', '本机设置单独存');
  assert.equal(readStoredState(st).sync, undefined, '令牌不进数据');
});

test('存储空间满时 mutate 照常改内存，info.saved = false；applyRemote 返回有没有存进本机', () => {
  const st = fakeStorage();
  state.load({ storage: st, locks: null });
  const real = st.setItem;
  st.setItem = () => { throw new Error('QuotaExceededError'); };
  let info = null;
  const off = state.subscribe((s, i) => { info = i; });
  state.mutate(s => { s.data.items.x = item('x'); });
  off();
  assert.equal(info.saved, false);
  assert.equal(state.saveOk(), false);
  assert.equal(live(state.getState(), 'items').length, 1);
  assert.equal(state.applyRemote(mergeStates(state.getState(), withItem(blankState(), 'r2', { updatedAt: 5 }))), false);   // 同步给的是已经和本机合并过的
  st.setItem = real;
  state.mutate(s => { s.data.items.r2.note = '再存一次'; });
  assert.equal(state.saveOk(), true);
  assert.ok(readStoredState(st).data.items.x, '之前没存下的也一起存了');
});

test('本机设置：默认值齐全，坏的 JSON 不影响启动，setLocal 浅合并并保存', () => {
  const st = fakeStorage([[state.LKEY, '{bad']]);
  state.load({ storage: st, locks: null });
  assert.deepEqual(state.getLocal(), { lang: null, theme: 'auto', device: null, sync: null, lastBackupAt: null, view: {}, storeView: {} });
  state.setLocal({ theme: 'dark' });
  assert.equal(JSON.parse(st.getItem(state.LKEY)).theme, 'dark');
  state.load({ storage: st, locks: null });
  assert.equal(state.getLocal().theme, 'dark');
  assert.equal(state.KEY, 'picknest.state');
  assert.equal(state.LKEY, 'picknest.local');
  assert.equal(state.PENDING_PREFIX, 'picknest.pending.');
});
