// 备份和从备份恢复（core/backup.js + state.js 的 mergeIn）、显示时间（core/dates.js）。全是编的数据
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBackup, readBackup, backupFileName, backupCounts, backupAge, BackupError } from '../src/core/backup.js';
import { blankState, ensureSeeds, normalizeRecord, stamp, deletedRecord, fileProblem, canon, normalizeState } from '../src/core/store.js';
import { fmtClock, fmtDay, fmtWhen, fmtShort, fmtFull, ymd, endOfDay, dayValue, daysAgo } from '../src/core/dates.js';
import * as state from '../src/core/state.js';

const item = (id, fields = {}) => normalizeRecord('items', { id, listId: 'l_groceries', name: id, status: 'need', updatedAt: 1000, ...fields });
function sample() {
  const s = ensureSeeds(blankState());
  s.data.items.i_milk = item('i_milk', { name: '牛奶', note: '全脂' });
  s.data.items.i_gone = deletedRecord(item('i_gone'), 2000);
  s.data.items.i_orphan = item('i_orphan', { listId: 'l_nope' });
  s.data.stores.s_costco = deletedRecord(s.data.stores.s_costco, 3000);
  s.data.future = { x_1: { id: 'x_1', updatedAt: 5, shape: '新版才有的集合' } };
  s.settings.someday = 'kept'; s.settingsAt.someday = 10;
  return s;
}

test('备份：文件名 picknest-backup-YYYYMMDD.json；内容是 { app, v, kind, exportedAt, state }，原样读回来（删掉的、不认识的集合、设置都在）', () => {
  assert.equal(backupFileName(new Date(2026, 0, 5, 23, 59)), 'picknest-backup-20260105.json');
  const s = sample();
  const text = buildBackup(s, new Date(Date.UTC(2026, 10, 21, 3)));
  const d = JSON.parse(text);
  assert.deepEqual([d.app, d.v, d.kind, d.exportedAt], ['picknest', 1, 'backup', '2026-11-21T03:00:00.000Z']);
  assert.deepEqual(Object.keys(d.state).sort(), ['app', 'data', 'settings', 'settingsAt', 'v']);
  const b = readBackup(text);
  assert.equal(canon(b.state), canon(normalizeState(s)));
  assert.equal(b.state.data.items.i_gone.deleted, true);
  assert.equal(b.state.data.future.x_1.shape, '新版才有的集合');
  assert.equal(b.exportedAt, Date.UTC(2026, 10, 21, 3));
  assert.deepEqual(b.counts, { lists: 2, items: 1, recipes: 0, plan: 0, log: 0, stores: 7, categories: 14 }, '只数看得见的：删掉的、清单不在了的不算');
  assert.deepEqual(backupCounts(s), b.counts);
});

test('备份里没有同步令牌和本机设置：只放 state（令牌在 picknest.local）', () => {
  state.load({ storage: null });
  state.setLocal({ sync: { repo: 'me/data', token: 'github_pat_synthetic_secret' }, lang: 'en', theme: 'dark' });
  state.mutate(s => { s.data.items.i_a = item('i_a'); });
  const text = buildBackup(state.getState());
  assert.ok(!text.includes('github_pat_synthetic_secret'));
  assert.ok(!/"theme"|"lang"|"sync"/.test(text));
});

test('读备份：不是 JSON、不是 PickNest 的、新版做的、缺了 state 都说清楚；同步仓库里的 picknest.json、出错时下载的原始数据也能读', () => {
  const err = (text, code) => assert.throws(() => readBackup(text), e => e instanceof BackupError && e.code === code, code);
  err('not json', 'notJson');
  err('', 'notJson');
  err(JSON.stringify({ app: 'babble', v: 1, state: blankState() }), 'notApp');
  err(JSON.stringify([1, 2]), 'notApp');
  err(JSON.stringify({ app: 'picknest', v: 2, state: blankState() }), 'newer');
  err(JSON.stringify({ app: 'picknest', v: 1, state: { app: 'picknest', v: 2, data: {} } }), 'newer');
  err(JSON.stringify({ app: 'picknest', v: 1 }), 'bad');
  err(JSON.stringify({ app: 'picknest', v: '1', state: blankState() }), 'bad');
  err(JSON.stringify({ app: 'picknest', v: 1, state: { data: [] } }), 'bad');
  const s = sample();
  const synced = readBackup(JSON.stringify({ app: 'picknest', v: 1, device: 'iPad', savedAt: '2026-11-20T10:00:00.000Z', state: s }));
  assert.equal(synced.state.data.items.i_milk.name, '牛奶');
  assert.equal(synced.exportedAt, Date.parse('2026-11-20T10:00:00.000Z'));
  const raw = readBackup('\uFEFF' + JSON.stringify({ app: 'picknest', v: 1, kind: 'raw', state: s }));
  assert.equal(raw.kind, 'raw');
  assert.equal(fileProblem({ app: 'picknest', v: 1, state: {} }), null);
});

test('从备份恢复 = 逐条合并：较新的为准，备份里没有的不删，删除也按时间合并；返回改了几条，没变就是 0；预置记录补齐', () => {
  state.load({ storage: null });
  const now = Date.now();
  state.mutate(s => {
    s.data.items.i_local = item('i_local', { name: '只在本机', updatedAt: now });
    s.data.items.i_both = item('i_both', { name: '本机改得更晚', updatedAt: now + 10 });
    s.data.items.i_old = item('i_old', { name: '本机旧的', updatedAt: now });
  });
  const backup = ensureSeeds(blankState());
  backup.data.items.i_both = item('i_both', { name: '备份里旧的', updatedAt: now - 1000 });
  backup.data.items.i_old = item('i_old', { name: '备份里新的', updatedAt: now + 50 });
  backup.data.items.i_new = item('i_new', { name: '只在备份里', updatedAt: now - 5000 });
  backup.data.stores.s_target = deletedRecord(backup.data.stores.s_target, now - 1);
  delete backup.data.lists.l_tobuy;
  const v = state.editVersion();
  const text = buildBackup(backup);
  const { changed } = state.mergeIn(readBackup(text).state);
  assert.equal(changed, 3, 'i_old、i_new、s_target');
  const items = state.getState().data.items;
  assert.deepEqual([items.i_local.name, items.i_both.name, items.i_old.name, items.i_new.name], ['只在本机', '本机改得更晚', '备份里新的', '只在备份里']);
  assert.equal(state.getState().data.stores.s_target.deleted, true, '备份里更晚的删除照样合并');
  assert.ok(state.getState().data.lists.l_tobuy, '备份里没有的不删');
  assert.equal(state.editVersion(), v + 1, '算本机修改：开着同步会传上去');
  assert.equal(state.mergeIn(readBackup(text).state).changed, 0, '再恢复一次：什么都没变');
});

test('显示时间：今天 / 昨天 / 今年 / 更早，三种语言；很短的、完整的；文件名的日期；到期日是那天 23:59', () => {
  const now = new Date(2026, 10, 21, 15, 30).getTime();
  const at = (d, h, m) => new Date(2026, 10, d, h, m).getTime();
  assert.equal(fmtClock(at(21, 9, 5)), '9:05');
  assert.equal(fmtClock(at(21, 14, 5), 'en'), '2:05 PM');
  assert.equal(fmtClock(at(21, 0, 30), 'en'), '12:30 AM');
  assert.equal(fmtWhen(at(21, 14, 5), 'zh-Hans', now), '今天 14:05');
  assert.equal(fmtWhen(at(20, 8, 0), 'zh-Hant-TW', now), '昨天 8:00');
  assert.equal(fmtWhen(at(20, 8, 0), 'en', now), 'Yesterday at 8:00 AM');
  assert.equal(fmtWhen(at(4, 8, 0), 'zh-Hans', now), '11月4日 8:00');
  assert.equal(fmtWhen(at(4, 20, 0), 'en', now), 'Nov 4 at 8:00 PM');
  assert.equal(fmtWhen(new Date(2025, 0, 31, 9).getTime(), 'zh-Hans', now), '2025年1月31日');
  assert.equal(fmtWhen(new Date(2025, 0, 31, 9).getTime(), 'en', now), 'Jan 31, 2025');
  assert.equal(fmtWhen(new Date(2026, 0, 1, 9).getTime(), 'zh-Hans', new Date(2026, 0, 1, 10).getTime()), '今天 9:00');
  assert.equal(fmtWhen(new Date(2025, 11, 31, 22).getTime(), 'zh-Hans', new Date(2026, 0, 1, 10).getTime()), '昨天 22:00', '跨年的昨天');
  assert.equal(fmtShort(at(21, 14, 5), 'zh-Hans', now), '14:05');
  assert.equal(fmtShort(at(3, 14, 5), 'en', now), 'Nov 3');
  assert.equal(fmtShort(new Date(2025, 4, 3).getTime(), 'zh-Hans', now), '2025年5月3日');
  assert.equal(fmtFull(at(4, 20, 0), 'en'), 'Nov 4, 2026, 8:00 PM');
  assert.equal(fmtFull(at(4, 20, 0), 'zh-Hant-TW'), '2026年11月4日 20:00');
  assert.equal(fmtDay(at(4, 1, 0)), '2026年11月4日');
  for (const bad of [null, 0, NaN, 'x']) { assert.equal(fmtWhen(bad), ''); assert.equal(fmtDay(bad), ''); }
  assert.equal(ymd(new Date(2026, 8, 7)), '20260907');
  assert.equal(endOfDay('2027-02-01'), new Date(2027, 1, 1, 23, 59).getTime());
  for (const bad of ['', '2027-02-30', '2027/02/01', null]) assert.equal(endOfDay(bad), null, String(bad));
  // 用键盘填日期时年份一位一位进去（0002 → 0020 → 0202 → 2027）：中间那几个也是「合法」的日期，不收
  for (const partial of ['0002-11-26', '0020-11-26', '0202-11-26', '1999-12-31']) assert.equal(endOfDay(partial), null, partial);
  assert.equal(dayValue(endOfDay('2027-02-01')), '2027-02-01', '反过来：<input type=date> 的值、同步码里的到期日');
  assert.equal(dayValue(new Date(2026, 0, 5, 0, 30).getTime()), '2026-01-05');
  for (const none of [null, 0, NaN, 'x']) assert.equal(dayValue(none), '', String(none));
});

test('上次备份是几天前：按日历日数（昨晚 23:50 也是 1 天前），还没备份过、30 天以上要提醒', () => {
  const now = new Date(2026, 10, 22, 9, 30).getTime();
  assert.equal(daysAgo(new Date(2026, 10, 22, 0, 5).getTime(), now), 0);
  assert.equal(daysAgo(new Date(2026, 10, 21, 23, 50).getTime(), now), 1);
  assert.equal(daysAgo(new Date(2026, 9, 23, 12, 0).getTime(), now), 30);
  assert.equal(daysAgo(new Date(2026, 10, 23, 8, 0).getTime(), now), 0, '时钟不准、记成了明天：当成今天');
  assert.equal(daysAgo(null, now), null);
  assert.deepEqual(backupAge(null, now), { days: null, stale: true });
  assert.deepEqual(backupAge(0, now), { days: null, stale: true });
  assert.deepEqual(backupAge(new Date(2026, 10, 22, 8, 0).getTime(), now), { days: 0, stale: false });
  assert.deepEqual(backupAge(new Date(2026, 9, 24, 8, 0).getTime(), now), { days: 29, stale: false });
  assert.deepEqual(backupAge(new Date(2026, 9, 23, 8, 0).getTime(), now), { days: 30, stale: true });
});

test('stamp 之后的记录照样能备份恢复（修改时间、软删除的时间都在）', () => {
  const s = ensureSeeds(blankState());
  s.data.lists.l_tobuy = stamp({ ...s.data.lists.l_tobuy, name: '想买的' }, s.data.lists.l_tobuy, 7000);
  const b = readBackup(buildBackup(s));
  assert.deepEqual([b.state.data.lists.l_tobuy.name, b.state.data.lists.l_tobuy.updatedAt, b.state.data.lists.l_tobuy.createdAt], ['想买的', 7000, 0]);
});
