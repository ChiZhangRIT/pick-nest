// 计划（第二版）：本地日期的算法（core/dates.js：哪一周、哪个月、加几天，夏令时和跨年都不差一天；三种语言的写法）、
// plan 的整理与合并（store.js 的 normalizePlan）、加 / 改 / 挪 / 删一道菜（core/plan.js），「生成购物清单」的每一行（planLines：同名同单位合成一行、
// 按人数换算、常备品和买过的不勾、清单上已有的）和确认（generateList：每道菜自己的来源、再生成一次是替换不会多），
// 删掉 / 改人数 / 换食谱 / 挪日子时清单上那一份怎么跟着变（已买的不动、自己加的留着、两道菜共用的只减一份、一起撤销）。全是编的数据
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureSeeds, blankState, normalizeRecord, normalizeState, mergeStates, itemId, canon } from '../src/core/store.js';
import { isDay, parseDay, todayDay, addDays, weekdayOf, weekStart, weekDays, monthStart, addMonths, dayDiff, monthGrid,
  weekdayName, weekdayLetters, fmtPlanDay, fmtDayRange, fmtMonth } from '../src/core/dates.js';
import { planSource, liveEntry, planView, entriesIn, entriesOn, dayCounts, dishName, validateEntry, addEntry, editEntry, moveEntry, deleteEntry,
  planLines, generateList, previewEdit } from '../src/core/plan.js';
import { saveRecipe } from '../src/core/recipes.js';
import { addFromInput, addNeeds, setStatus, clearDone, totalLabel, editAndMove } from '../src/core/items.js';
import { setStaple, memoryOf } from '../src/core/memory.js';
import * as state from '../src/core/state.js';

const T0 = 1_790_000_000_000;
let clock = T0;
const now = () => (clock += 1000);
const L = 'l_groceries';
const t = (k) => ({ 'plan.untitled': '（没写）', 'rcp.untitled': '未命名食谱' }[k] || k);
const itemOf = (s, name, listId = L) => s.data.items[itemId(s, listId, name)];

/** 红烧肉（2 人份：五花肉 500 g、洋葱 1 个、生抽 2 勺（常备品）、香菜（可选））、咖喱（4 人份：洋葱 2 个、咖喱块 1 盒、五花肉 200 g、盐 适量）、番茄炒蛋（没写人数） */
function world() {
  const s = ensureSeeds(blankState());
  s.data.lists.l_party = normalizeRecord('lists', { id: 'l_party', name: '聚会', kind: 'grocery', order: 3, updatedAt: T0 });
  const rid = (name, servings, ings) => saveRecipe(s, null, { name, servings, ings }, now()).id;
  const hsr = rid('红烧肉', '2', [{ name: '五花肉', qty: '500', unit: 'g' }, { name: '洋葱', qty: '1', unit: '个' }, { name: '生抽', qty: '2', unit: '勺' }, { name: '香菜', optional: true }]);
  const curry = rid('咖喱', '4', [{ name: '洋葱', qty: '2', unit: '个' }, { name: '咖喱块', qty: '1', unit: '盒' }, { name: '五花肉', qty: '200', unit: 'g' }, { name: '盐', note: '适量' }]);
  const egg = rid('番茄炒蛋', '', [{ name: '番茄', qty: '2', unit: '个' }, { name: '鸡蛋', qty: '3', unit: '个' }]);
  setStaple(s, '生抽', true, now());
  return { s, hsr, curry, egg };
}
const add = (s, input) => { const r = addEntry(s, input, now()); assert.ok(r.ok, JSON.stringify(r)); return r.id; };

// ---------- 本地日期 ----------
test('日子：只收真的 YYYY-MM-DD（2月30日、0002 年、多余的字都不收）；加几天跨月、跨年、闰年；b 比 a 晚几天', () => {
  assert.deepEqual(parseDay('2026-11-23'), [2026, 11, 23]);
  for (const bad of ['2026-02-30', '2026-13-01', '0002-11-23', '1999-12-31', '2026-1-5', ' 2026-11-23', '2026-11-23T00:00', '', null, 20261123]) assert.equal(isDay(bad), false, String(bad));
  assert.equal(isDay('2028-02-29'), true, '闰年');
  assert.equal(isDay('2027-02-29'), false);
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2027-01-01', -1), '2026-12-31');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2026-11-23', 400), '2027-12-28');
  assert.equal(addDays('nope', 1), '');
  assert.equal(dayDiff('2026-11-23', '2026-11-30'), 7);
  assert.equal(dayDiff('2026-12-31', '2027-01-01'), 1);
  assert.equal(dayDiff('2026-11-30', '2026-11-23'), -7);
});

test('一周从周一开始：周日算前一个周一那一周；跨年的那一周；这一周七天', () => {
  assert.equal(weekdayOf('2026-11-23'), 0, '2026-11-23 是周一');
  assert.equal(weekdayOf('2026-11-29'), 6, '周日是第 7 天');
  assert.equal(weekStart('2026-11-29'), '2026-11-23');
  assert.equal(weekStart('2026-11-23'), '2026-11-23');
  assert.equal(weekStart('2027-01-01'), '2026-12-28', '跨年：2027 年元旦（周五）那一周从 2026-12-28 开始');
  assert.deepEqual(weekDays('2027-01-02'), ['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03']);
  assert.deepEqual(weekDays('x'), []);
});

test('月历：周一开头、前后补上别的月的日子；2 月正好四周；1 月 31 日加一个月是 2 月 1 日', () => {
  const nov = monthGrid('2026-11-23');
  assert.equal(nov.length, 6, '2026 年 11 月 1 日是周日：要六行');
  assert.deepEqual(nov[0].map(c => c.day), ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']);
  assert.deepEqual(nov[0].map(c => c.inMonth), [false, false, false, false, false, false, true]);
  assert.deepEqual(nov.at(-1).map(c => c.day), ['2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05', '2026-12-06']);
  const feb = monthGrid('2027-02-10');
  assert.equal(feb.length, 4, '2027 年 2 月 1 日是周一、28 天');
  assert.ok(feb.flat().every(c => c.inMonth));
  assert.equal(monthGrid('2028-02-01').flat().filter(c => c.inMonth).length, 29, '闰年');
  assert.equal(monthStart('2026-11-23'), '2026-11-01');
  assert.equal(addMonths('2027-01-31', 1), '2027-02-01');
  assert.equal(addMonths('2026-12-15', 1), '2027-01-01', '跨年');
  assert.equal(addMonths('2027-01-15', -1), '2026-12-01');
  assert.equal(addMonths('2026-11-23', -14), '2025-09-01');
});

test('夏令时：换时间那天（23 / 25 小时）在几个时区里今天是哪天、加几天、哪一周都不差一天', () => {
  const was = process.env.TZ;
  try {
    for (const tz of ['America/Los_Angeles', 'America/New_York', 'Europe/London', 'Australia/Sydney', 'Asia/Shanghai', 'UTC']) {
      process.env.TZ = tz;
      // 美国 2026-03-08、2026-11-01 换时间；欧洲 2026-03-29、10-25；澳洲 2026-04-05、10-04
      for (const day of ['2026-03-08', '2026-11-01', '2026-03-29', '2026-10-25', '2026-04-05', '2026-10-04']) {
        const [y, m, d] = parseDay(day);
        assert.equal(todayDay(new Date(y, m - 1, d, 0, 30).getTime()), day, `${tz} ${day} 0:30`);
        assert.equal(todayDay(new Date(y, m - 1, d, 23, 30).getTime()), day, `${tz} ${day} 23:30`);
        assert.equal(addDays(day, 1), addDays(addDays(day, -1), 2), `${tz} ${day}`);
        const week = weekDays(day);
        assert.equal(new Set(week).size, 7);
        week.forEach((x, i) => assert.equal(dayDiff(week[0], x), i, `${tz} ${x}`));
      }
      assert.equal(addDays('2026-03-07', 2), '2026-03-09');
      assert.equal(addDays('2026-10-31', 2), '2026-11-02');
      assert.equal(dayDiff('2026-03-01', '2026-04-01'), 31);
    }
  } finally { if (was === undefined) delete process.env.TZ; else process.env.TZ = was; }
});

test('日子的写法：三种语言；一段日子同月只写一次月份、跨月写两个、不在今年的带年份（跨年两头都带）；月份', () => {
  const NOW = new Date(2026, 10, 23, 12).getTime();
  assert.equal(fmtPlanDay('2026-11-23', 'zh-Hans'), '11月23日 周一');
  assert.equal(fmtPlanDay('2026-11-29', 'zh-Hant-TW'), '11月29日 週日');
  assert.equal(fmtPlanDay('2026-11-23', 'en'), 'Mon, Nov 23');
  assert.equal(fmtPlanDay('2026-11-23', 'en', { year: true, weekday: false }), 'Nov 23, 2026');
  assert.equal(fmtPlanDay('2026-11-23', 'zh-Hans', { year: true }), '2026年11月23日 周一');
  assert.equal(fmtDayRange('2026-11-23', '2026-11-29', 'zh-Hans', NOW), '11月23日 – 29日');
  assert.equal(fmtDayRange('2026-11-30', '2026-12-06', 'zh-Hans', NOW), '11月30日 – 12月6日');
  assert.equal(fmtDayRange('2026-12-28', '2027-01-03', 'zh-Hans', NOW), '2026年12月28日 – 2027年1月3日');
  assert.equal(fmtDayRange('2027-03-01', '2027-03-07', 'zh-Hant-TW', NOW), '2027年3月1日 – 7日');
  assert.equal(fmtDayRange('2026-11-23', '2026-11-29', 'en', NOW), 'Nov 23 – 29');
  assert.equal(fmtDayRange('2026-11-30', '2026-12-06', 'en', NOW), 'Nov 30 – Dec 6');
  assert.equal(fmtDayRange('2026-12-28', '2027-01-03', 'en', NOW), 'Dec 28, 2026 – Jan 3, 2027');
  assert.equal(fmtDayRange('2027-03-01', '2027-03-07', 'en', NOW), 'Mar 1 – 7, 2027');
  assert.equal(fmtDayRange('2026-11-24', '2026-11-24', 'en', NOW), 'Nov 24');
  assert.equal(fmtMonth('2026-11-23', 'zh-Hans'), '2026年11月');
  assert.equal(fmtMonth('2026-11-23', 'en'), 'November 2026');
  assert.deepEqual([weekdayName(0, 'zh-Hans'), weekdayName('2026-11-29', 'zh-Hant-TW'), weekdayName(2, 'en')], ['周一', '週日', 'Wed']);
  assert.deepEqual(weekdayLetters('zh-Hans'), ['一', '二', '三', '四', '五', '六', '日']);
  assert.deepEqual(weekdayLetters('en'), ['M', 'T', 'W', 'T', 'F', 'S', 'S']);
});

// ---------- 整理、合并 ----------
test('plan 的整理：认不出的哪一顿按晚饭、几人份不是正数当没写、坏的食谱 id 去掉；日子认不出的原样留着（不显示）；不认识的字段留着；合并整条取较新的', () => {
  const e = normalizeRecord('plan', { date: '2026-11-23', meal: 'brunch', recipeId: 'has space', title: 5, servings: '0', order: '2', x: { y: 1 }, updatedAt: T0 }, 'p_1');
  assert.deepEqual([e.date, e.meal, e.recipeId, e.title, e.servings, e.order, e.note, e.x], ['2026-11-23', 'dinner', null, '5', null, 2, '', { y: 1 }]);
  assert.equal(normalizeRecord('plan', { date: 'next tuesday', servings: 3, updatedAt: T0 }, 'p_2').date, 'next tuesday');
  const s = normalizeState({ data: { plan: { p_1: { date: '2026-11-23', meal: 'lunch', title: '出去吃', updatedAt: T0 }, bad: 'x', 'has space': { updatedAt: T0 } } } });
  assert.deepEqual(Object.keys(s.data.plan), ['p_1']);
  assert.equal(entriesOn(s, '2026-11-23')[0].title, '出去吃');
  assert.deepEqual(entriesIn(normalizeState({ data: { plan: { p_2: { date: 'next tuesday', updatedAt: T0 } } } }), '2000-01-01', '2999-12-31'), [], '日子认不出的哪天都不显示');
  const a = normalizeState({ data: { plan: { p_1: { date: '2026-11-23', meal: 'lunch', title: '出去吃', note: '叫上小王', updatedAt: T0 } } } });
  const b = normalizeState({ data: { plan: { p_1: { date: '2026-11-24', meal: 'dinner', title: '出去吃', updatedAt: T0 + 5 } } } });
  const ab = mergeStates(a, b), ba = mergeStates(b, a);
  assert.equal(canon(ab), canon(ba));
  assert.deepEqual([ab.data.plan.p_1.date, ab.data.plan.p_1.note], ['2026-11-24', ''], '整条取较新的（id 是随机的，没有各自从头建的同一条）');
  assert.ok(blankState().data.plan, '空白数据里就有 plan');
});

// ---------- 加、改、删 ----------
test('加一道菜：连着食谱的抄下名字、几人份；只写一句的不能空；日子、几人份不对报错；同一顿里按加进来的先后排，一天里按早午晚加餐', () => {
  const { s, hsr, egg } = world();
  assert.deepEqual(addEntry(s, { date: '2026-11-31', meal: 'dinner', recipeId: hsr }, now()), { ok: false, errors: { date: 'plan.err.date' } });
  assert.deepEqual(addEntry(s, { date: '2026-11-24', meal: 'dinner', title: '  ' }, now()).errors, { dish: 'plan.err.dish' });
  assert.deepEqual(addEntry(s, { date: '2026-11-24', meal: 'dinner', recipeId: 'r_nope' }, now()).errors, { dish: 'plan.err.recipeGone' });
  assert.deepEqual(addEntry(s, { date: '2026-11-24', meal: 'dinner', recipeId: hsr, servings: '120' }, now()).errors, { servings: 'plan.err.servings' });
  const a = add(s, { date: '2026-11-24', meal: 'dinner', recipeId: hsr, servings: 3 });
  const b = add(s, { date: '2026-11-24', meal: 'dinner', title: ' 出去吃 ', servings: 9 });
  const c = add(s, { date: '2026-11-24', meal: 'breakfast', recipeId: egg, servings: '' });
  const d = add(s, { date: '2026-11-24', meal: 'snack', title: '水果', note: '苹果' });
  assert.deepEqual([s.data.plan[a].title, s.data.plan[a].servings, s.data.plan[b].title, s.data.plan[b].servings, s.data.plan[b].recipeId], ['红烧肉', 3, '出去吃', null, null], '只写一句的没有几人份');
  assert.deepEqual(entriesOn(s, '2026-11-24').map(e => e.id), [c, a, b, d]);
  assert.equal(s.data.plan[a].id.startsWith('p_'), true);
  assert.deepEqual([...dayCounts(s, '2026-11-23', '2026-11-29')], [['2026-11-24', 4]]);
  // 菜名：食谱改名跟着变，删掉了显示抄下来的
  saveRecipe(s, hsr, { ...s.data.recipes[hsr], name: '红烧肉（少糖）', servings: '2' }, now());
  assert.equal(dishName(s, s.data.plan[a], t), '红烧肉（少糖）');
  s.data.recipes[hsr] = { ...s.data.recipes[hsr], deleted: true, deletedAt: now() };
  assert.equal(dishName(s, s.data.plan[a], t), '红烧肉');
  assert.equal(dishName(s, normalizeRecord('plan', { title: '', date: '2026-11-24', updatedAt: T0 }, 'p_x'), t), '（没写）');
  assert.equal(planView({ planView: 'month' }), 'month');
  assert.equal(planView({ planView: 'year' }), 'week');
  assert.equal(planView(null), 'week');
});

test('改一道菜：挪到别的日子排在那一顿最后；食谱删掉了照样能改别的；改成只写一句；不在了报错', () => {
  const { s, hsr, egg } = world();
  const a = add(s, { date: '2026-11-24', meal: 'dinner', recipeId: hsr, servings: 2 });
  const b = add(s, { date: '2026-11-25', meal: 'dinner', recipeId: egg });
  const r = moveEntry(s, a, '2026-11-25', 'dinner', now());
  assert.ok(r.ok);
  assert.deepEqual(entriesOn(s, '2026-11-25').map(e => e.id), [b, a], '挪过去排在最后');
  assert.deepEqual(entriesOn(s, '2026-11-24'), []);
  s.data.recipes[hsr] = { ...s.data.recipes[hsr], deleted: true, deletedAt: now() };
  assert.ok(editEntry(s, a, { note: '多放糖' }, now()).ok, '连着的食谱删掉了：别的照样能改');
  assert.equal(s.data.plan[a].recipeId, hsr);
  assert.deepEqual(editEntry(s, b, { recipeId: hsr }, now()).errors, { dish: 'plan.err.recipeGone' }, '换成一道删掉的食谱不行');
  const r2 = editEntry(s, b, { recipeId: null, title: '外卖' }, now());
  assert.deepEqual([r2.entry.recipeId, r2.entry.title, r2.entry.servings], [null, '外卖', null]);
  assert.deepEqual(editEntry(s, 'p_nope', { note: 'x' }, now()).errors, { entry: 'plan.err.gone' });
  assert.equal(validateEntry(s, { date: '2026-11-24', meal: 'teatime', title: 'x' }).clean.meal, 'dinner');
});

// ---------- 生成购物清单：每一行 ----------
test('planLines：按各道菜的人数换算，同名同单位合成一行写着来自哪几道，单位不一样的分开；常备品、可选的不勾；没连食谱的、食谱删掉的不算', () => {
  const { s, hsr, curry, egg } = world();
  const a = add(s, { date: '2026-11-23', meal: 'dinner', recipeId: hsr, servings: 3 });     // 红烧肉 3 人份：五花肉 750 g、洋葱 1.5 个
  const b = add(s, { date: '2026-11-25', meal: 'lunch', recipeId: curry, servings: 2 });    // 咖喱 2 人份：洋葱 1 个、五花肉 100 g
  const c = add(s, { date: '2026-11-26', meal: 'dinner', recipeId: egg });                   // 没写人数：原样
  add(s, { date: '2026-11-27', meal: 'dinner', title: '出去吃' });
  const gone = add(s, { date: '2026-11-28', meal: 'dinner', recipeId: egg });
  add(s, { date: '2026-11-30', meal: 'dinner', recipeId: hsr });                             // 下一周的不算
  const { lines, dishes, skipped } = planLines(s, '2026-11-23', '2026-11-29', { listId: L });
  assert.deepEqual(dishes.map(e => e.id), [a, b, c, gone]);
  assert.deepEqual(skipped.map(e => e.title), ['出去吃']);
  const row = (name) => lines.find(l => l.name === name);
  assert.deepEqual(lines.map(l => [l.name, l.qty, l.unit, l.checked]), [
    ['五花肉', 850, 'g', true], ['洋葱', 2.5, '个', true], ['生抽', 3, '勺', false], ['香菜', null, '', false],
    ['咖喱块', 0.5, '盒', true], ['盐', null, '', true], ['番茄', 4, '个', true], ['鸡蛋', 6, '个', true]]);
  assert.deepEqual(row('五花肉').sources.map(x => [x.entryId, x.title, x.qty, x.state]), [[a, '红烧肉', 750, 'new'], [b, '咖喱', 100, 'new']]);
  assert.deepEqual([row('生抽').staple, row('香菜').optional], [true, true]);
  // 食谱删掉了：那几道不算（不知道要什么）；同名不同单位分开
  s.data.recipes[egg] = { ...s.data.recipes[egg], deleted: true, deletedAt: now() };
  saveRecipe(s, curry, { ...s.data.recipes[curry], servings: '4', ings: [...s.data.recipes[curry].ings, { name: '五花肉', qty: '1', unit: '斤' }] }, now());
  const again = planLines(s, '2026-11-23', '2026-11-29', { listId: L });
  assert.deepEqual(again.skipped.map(e => e.id).sort(), [c, gone, again.skipped.find(e => e.title === '出去吃').id].sort());
  assert.deepEqual(again.lines.filter(l => l.name === '五花肉').map(l => [l.qty, l.unit]), [[850, 'g'], [0.5, '斤']]);
  assert.deepEqual(planLines(s, '2026-12-01', '2026-12-07').lines, [], '没有菜的日子');
});

test('planLines：清单上已有的写出来；这道菜已经在清单上的照样勾着（再生成是替换）；每道都已经买过的不勾，一行里有几道买过的只算还没买的', () => {
  const { s, hsr, curry } = world();
  const a = add(s, { date: '2026-11-23', meal: 'dinner', recipeId: hsr });
  const b = add(s, { date: '2026-11-24', meal: 'dinner', recipeId: curry });
  addFromInput(s, L, '咖喱块', now());
  let lines = planLines(s, '2026-11-23', '2026-11-29', { listId: L }).lines;
  const row = (name) => lines.find(l => l.name === name);
  assert.deepEqual([row('咖喱块').have && row('咖喱块').have.name, row('咖喱块').haveLabel], ['咖喱块', '1']);
  generateList(s, { from: '2026-11-23', to: '2026-11-29', listId: L }, now());
  lines = planLines(s, '2026-11-23', '2026-11-29', { listId: L }).lines;
  assert.deepEqual([row('洋葱').added, row('洋葱').checked, row('洋葱').haveLabel, row('洋葱').addedLabel], [true, true, '3 个', '3 个']);
  assert.deepEqual([row('咖喱块').haveLabel, row('咖喱块').addedLabel], ['1 + 1 盒', '1 盒'], '自己加的 1 不算这几道菜加过的');
  // 买了红烧肉的洋葱（洋葱是红烧肉 1 个 + 咖喱 2 个，同一样东西）——勾掉的是整样，两道的都算买过
  setStatus(s, itemOf(s, '洋葱').id, 'done', now());
  setStatus(s, itemOf(s, '五花肉').id, 'done', now());
  clearDone(s, L, now());
  lines = planLines(s, '2026-11-23', '2026-11-29', { listId: L }).lines;
  assert.deepEqual([row('洋葱').bought, row('洋葱').checked, row('洋葱').have], [true, false, null], '买过了：不勾，清单上也没有了（清除了）');
  assert.equal(row('洋葱').qty, 3, '自己再勾上就是全部再买一次');
  // 新加一道红烧肉：五花肉这一行一道买过、一道还没 → 勾着，只算新的那一道
  const c = add(s, { date: '2026-11-26', meal: 'lunch', recipeId: hsr, servings: 4 });
  lines = planLines(s, '2026-11-23', '2026-11-29', { listId: L }).lines;
  assert.deepEqual(row('五花肉').sources.map(x => [x.entryId, x.state]), [[a, 'bought'], [b, 'bought'], [c, 'new']]);
  assert.deepEqual([row('五花肉').checked, row('五花肉').qty, row('五花肉').bought], [true, 1000, false]);
});

// ---------- 生成购物清单：确认 ----------
test('generateList：每道菜自己的来源 p:<id>、label 是菜名；同一段日子再生成一次是替换（数量不翻倍、记录不重建）；常备品在这里标一次也记下', () => {
  const { s, hsr, curry } = world();
  const a = add(s, { date: '2026-11-23', meal: 'dinner', recipeId: hsr, servings: 3 });
  const b = add(s, { date: '2026-11-25', meal: 'lunch', recipeId: curry, servings: 2 });
  const r = generateList(s, { from: '2026-11-23', to: '2026-11-29', listId: L, staples: { 盐: true } }, now());
  assert.deepEqual(r, { items: 3, dishes: 2, changed: 3 }, '五花肉、洋葱、咖喱块（盐这次标成常备品了，生抽是常备品，香菜可选）');
  const onion = itemOf(s, '洋葱');
  assert.deepEqual(onion.needs, { [planSource(a)]: { qty: 1.5, unit: '个', label: '红烧肉', recipeId: hsr }, [planSource(b)]: { qty: 1, unit: '个', label: '咖喱', recipeId: curry } });
  assert.equal(totalLabel(onion), '2.5 个');
  assert.equal(itemOf(s, '盐'), undefined);
  assert.equal(memoryOf(s, '盐').staple, true);
  // 自己改过商店、加了自己要的：再生成一次照样留着，数量不翻倍
  editAndMove(s, onion.id, { storeId: 's_hmart', qty: '2', unit: '个' }, null, now());
  const before = canon(s.data.items);
  const uses = memoryOf(s, '洋葱').uses;
  generateList(s, { from: '2026-11-23', to: '2026-11-29', listId: L }, now());
  assert.equal(canon(s.data.items), before, '再生成一次：什么都没变（不盖新时间）');
  assert.equal(generateList(s, { from: '2026-11-23', to: '2026-11-29', listId: L }, now()).changed, 0);
  assert.deepEqual([itemOf(s, '洋葱').storeId, totalLabel(itemOf(s, '洋葱')), memoryOf(s, '洋葱').uses], ['s_hmart', '4.5 个', uses]);
  // 改了人数再生成：换成新的用量，不是加上去
  editEntry(s, a, { servings: 2 }, now());
  generateList(s, { from: '2026-11-23', to: '2026-11-29', listId: L }, now());
  assert.equal(totalLabel(itemOf(s, '五花肉')), '600 g');
});

test('generateList：没勾的、这道菜原来在清单上的拿掉（只为它加的软删除）；换一张清单生成是挪过去，不是两边各一份；清单不在 → null', () => {
  const { s, hsr, curry } = world();
  add(s, { date: '2026-11-23', meal: 'dinner', recipeId: hsr });
  add(s, { date: '2026-11-25', meal: 'lunch', recipeId: curry });
  generateList(s, { from: '2026-11-23', to: '2026-11-29', listId: L }, now());
  const keys = planLines(s, '2026-11-23', '2026-11-29', { listId: L }).lines.filter(l => l.name !== '咖喱块').filter(l => l.checked).map(l => l.key);
  generateList(s, { from: '2026-11-23', to: '2026-11-29', listId: L, keys }, now());
  assert.equal(itemOf(s, '咖喱块').deleted, true, '这次没勾：拿掉');
  generateList(s, { from: '2026-11-23', to: '2026-11-29', listId: 'l_party' }, now());
  assert.equal(itemOf(s, '洋葱').deleted, true, '原来的清单上拿掉');
  assert.equal(totalLabel(itemOf(s, '洋葱', 'l_party')), '3 个');
  assert.equal(generateList(s, { from: '2026-11-23', to: '2026-11-29', listId: 'l_nope' }, now()), null);
});

test('generateList：买过的不再放回去；没连食谱的菜、食谱删掉了的菜在清单上的那一份不动', () => {
  const { s, hsr, egg } = world();
  const a = add(s, { date: '2026-11-23', meal: 'dinner', recipeId: hsr });
  const b = add(s, { date: '2026-11-24', meal: 'dinner', recipeId: egg });
  generateList(s, { from: '2026-11-23', to: '2026-11-29', listId: L }, now());
  setStatus(s, itemOf(s, '五花肉').id, 'done', now());
  const pork = canon(itemOf(s, '五花肉'));
  s.data.recipes[egg] = { ...s.data.recipes[egg], deleted: true, deletedAt: now() };
  const egg0 = canon(itemOf(s, '鸡蛋'));
  generateList(s, { from: '2026-11-23', to: '2026-11-29', listId: L }, now());
  assert.equal(canon(itemOf(s, '五花肉')), pork, '已买的不动，也不放回要买');
  assert.equal(canon(itemOf(s, '鸡蛋')), egg0, '删掉食谱不动清单上从它加进来的东西');
  assert.ok(liveEntry(s, a) && liveEntry(s, b));
});

// ---------- 删掉、改人数、换食谱、挪日子 ----------
test('删掉一道菜：只为它加的拿掉；自己也加了的留着（自己加的不动）；两道菜共用的只减它那一份；已买的不动；整个能撤销', () => {
  state.load({ storage: null });
  let ids;
  state.mutate(s => {
    const w = world();
    Object.assign(s.data, w.s.data);
    const a = add(s, { date: '2026-11-23', meal: 'dinner', recipeId: w.hsr });
    const b = add(s, { date: '2026-11-25', meal: 'lunch', recipeId: w.curry });
    generateList(s, { from: '2026-11-23', to: '2026-11-29', listId: L }, now());
    addFromInput(s, L, '五花肉 1斤', now());                         // 只因为食谱在清单上、写了数量 → 记成自己加的
    setStatus(s, itemOf(s, '洋葱').id, 'done', now());
    ids = { a, b };
  });
  const S = () => state.getState();
  // 撤销会盖新的修改时间：比内容
  const content = () => canon(JSON.parse(JSON.stringify(S().data), (k, v) => (k === 'updatedAt' ? undefined : v)));
  const before = content();
  const res = state.mutate(s => deleteEntry(s, ids.a, now()), { undoLabel: '删了' });
  assert.equal(res.removed, 0, '红烧肉的五花肉自己也加了、洋葱已经买了：都没拿掉');
  assert.equal(S().data.plan[ids.a].deleted, true);
  assert.deepEqual([totalLabel(itemOf(S(), '五花肉')), Object.keys(itemOf(S(), '五花肉').needs)], ['1 斤 + 200 g', [planSource(ids.b)]], '只减红烧肉那一份');
  assert.equal(itemOf(S(), '洋葱').status, 'done');
  assert.ok(itemOf(S(), '洋葱').needs[planSource(ids.a)], '已买的上面留着买的是哪几道');
  const res2 = state.mutate(s => deleteEntry(s, ids.b, now()), { undoLabel: '删了' });
  assert.equal(res2.removed, 2, '咖喱块、盐只为咖喱加的：拿掉');
  assert.equal(itemOf(S(), '咖喱块').deleted, true);
  assert.equal(itemOf(S(), '五花肉').deleted, undefined, '自己加的还在');
  state.undo(); state.undo();
  assert.equal(content(), before, '两次撤销：菜和清单都回来了');
  assert.equal(deleteEntry(S(), 'p_nope', now()), null);
});

test('改人数：还没买的就地按新人数重算（自己改的商店留着），已买的不动，生成时没勾的不会冒出来；食谱删掉了不动', () => {
  const { s, hsr } = world();
  const a = add(s, { date: '2026-11-23', meal: 'dinner', recipeId: hsr, servings: 2 });
  generateList(s, { from: '2026-11-23', to: '2026-11-29', listId: L }, now());
  editAndMove(s, itemOf(s, '五花肉').id, { storeId: 's_costco' }, null, now());
  setStatus(s, itemOf(s, '洋葱').id, 'done', now());
  const onion = canon(itemOf(s, '洋葱'));
  const r = editEntry(s, a, { servings: '4' }, now());
  assert.equal(r.listChanged, 1);
  assert.deepEqual([totalLabel(itemOf(s, '五花肉')), itemOf(s, '五花肉').storeId], ['1000 g', 's_costco']);
  assert.equal(canon(itemOf(s, '洋葱')), onion, '已买的不动');
  assert.equal(itemOf(s, '生抽'), undefined, '常备品当时没勾：不会冒出来');
  s.data.recipes[hsr] = { ...s.data.recipes[hsr], deleted: true, deletedAt: now() };
  assert.equal(editEntry(s, a, { servings: 6 }, now()).listChanged, 0);
  assert.equal(totalLabel(itemOf(s, '五花肉')), '1000 g');
});

test('换食谱：旧的那一份拿掉、新的加到同一张清单（常备品、可选的、已经为这道菜买过的不加）；还没生成过的不动清单；挪日子不动清单', () => {
  const { s, hsr, curry, egg } = world();
  const a = add(s, { date: '2026-11-23', meal: 'dinner', recipeId: hsr });
  generateList(s, { from: '2026-11-23', to: '2026-11-29', listId: 'l_party' }, now());
  setStatus(s, itemOf(s, '洋葱', 'l_party').id, 'done', now());
  const items0 = canon(s.data.items);
  assert.equal(moveEntry(s, a, '2026-12-02', 'lunch', now()).listChanged, 0);
  assert.equal(canon(s.data.items), items0, '挪日子：还是同一道菜');
  const r = editEntry(s, a, { recipeId: curry }, now());
  assert.ok(r.ok);
  assert.equal(itemOf(s, '五花肉', 'l_party').needs[planSource(a)].qty, 200, '咖喱也要五花肉：就地换成咖喱的用量');
  assert.equal(itemOf(s, '五花肉', 'l_party').needs[planSource(a)].label, '咖喱');
  assert.equal(totalLabel(itemOf(s, '咖喱块', 'l_party')), '1 盒');
  assert.equal(itemOf(s, '洋葱', 'l_party').status, 'done', '洋葱已经为这道菜买过了：不再加');
  assert.deepEqual([itemOf(s, '盐', 'l_party').status, totalLabel(itemOf(s, '盐', 'l_party'))], ['need', ''], '盐（适量）不是常备品：照加，没写数量');
});

test('换食谱：还没生成过的菜不动清单；改成只写一句就拿掉那一份', () => {
  const { s, hsr, curry, egg } = world();
  const a = add(s, { date: '2026-11-23', meal: 'dinner', recipeId: hsr });
  const items0 = canon(s.data.items);
  editEntry(s, a, { recipeId: egg }, now());
  assert.equal(canon(s.data.items), items0);
  generateList(s, { from: '2026-11-23', to: '2026-11-23', listId: L }, now());
  assert.equal(totalLabel(itemOf(s, '鸡蛋')), '3 个');
  editEntry(s, a, { recipeId: null, title: '出去吃' }, now());
  assert.equal(itemOf(s, '鸡蛋').deleted, true);
  assert.equal(itemOf(s, '番茄').deleted, true);
  void curry;
});

// ---------- 检查后修正 ----------
const W = { from: '2026-11-23', to: '2026-11-29', listId: L };
const sheet = (s, listId = L) => planLines(s, W.from, W.to, { listId }).lines.map(l => [l.name, l.unit, l.qty, l.checked, l.sources.map(x => x.state).join(',')]);

test('买过的又加回来（别的菜要、快速添加、隔久了取消勾选、清除后再加）：这道菜的这一样照样算买过，同一段日子再生成两次结果一样', () => {
  const { s, hsr, curry } = world();
  add(s, { date: '2026-11-23', meal: 'dinner', recipeId: hsr });
  generateList(s, W, now());
  for (const n of ['五花肉', '洋葱']) setStatus(s, itemOf(s, n).id, 'done', now());
  clock += 3600_000;
  // 周三加一道咖喱（也要洋葱），再生成：洋葱又成了要买的，只算咖喱的
  add(s, { date: '2026-11-25', meal: 'dinner', recipeId: curry, servings: 2 });
  generateList(s, W, now());
  assert.deepEqual([itemOf(s, '洋葱').status, totalLabel(itemOf(s, '洋葱'))], ['need', '1 个']);
  const items1 = canon(s.data.items);
  assert.deepEqual(sheet(s).find(r => r[0] === '洋葱'), ['洋葱', '个', 1, true, 'bought,added'], '红烧肉的洋葱周一买过了');
  // 什么都没改，再打开、再确认：一样
  assert.equal(generateList(s, W, now()).changed, 0);
  assert.equal(canon(s.data.items), items1, '再生成一次不会把红烧肉买过的那 1 个放回去');
  assert.ok(itemOf(s, '洋葱').boughtFor && Object.keys(itemOf(s, '洋葱').boughtFor).length === 1, '买过的那一道记在 boughtFor 里');
  assert.equal(totalLabel(itemOf(s, '洋葱')), '1 个', 'boughtFor 不算在数量里');

  // 五花肉（红烧肉的买过，咖喱的 100 g 刚加回来）也买了，隔天快速添加又加回来（restored）：两道的都还是买过的
  assert.equal(totalLabel(itemOf(s, '五花肉')), '100 g');
  setStatus(s, itemOf(s, '五花肉').id, 'done', now());
  clock += 3600_000;
  assert.equal(addFromInput(s, L, '五花肉 300g', now()).outcome, 'restored');
  assert.deepEqual(sheet(s).find(r => r[0] === '五花肉').slice(3), [false, 'bought,bought'], '两道都买过：不勾');
  generateList(s, W, now());
  assert.equal(totalLabel(itemOf(s, '五花肉')), '300 g', '只有自己加的，买过的没放回去');
  const items2 = canon(s.data.items);
  generateList(s, W, now());
  assert.equal(canon(s.data.items), items2);

  // 隔久了取消勾选、清除后再从食谱加：一样
  setStatus(s, itemOf(s, '咖喱块').id, 'done', now());
  clock += 3600_000;
  setStatus(s, itemOf(s, '咖喱块').id, 'need', now());
  assert.deepEqual([itemOf(s, '咖喱块').needs, sheet(s).find(r => r[0] === '咖喱块').slice(3)], [{}, [false, 'bought']]);
  setStatus(s, itemOf(s, '咖喱块').id, 'done', now());
  clearDone(s, L, now());
  addNeeds(s, L, [{ name: '咖喱块', qty: 2, unit: '盒' }], 'a:x', { label: '别的' }, now());
  assert.equal(sheet(s).find(r => r[0] === '咖喱块')[4], 'bought');
  const items3 = canon(s.data.items);
  generateList(s, W, now());
  generateList(s, W, now());
  assert.equal(canon(s.data.items), items3, '咖喱块只剩「别的」那一份，生成两次都不动它');
});

test('boughtFor 的整理与合并：只留时间是数字的、最多 50 道（最近买的）、空的不放；各自从头建的同一条两边的都留，另一条已买的那一轮也记成买过', () => {
  const it = normalizeRecord('items', { id: 'i_x', listId: L, name: '洋葱', updatedAt: 5, boughtFor: { 'p:a': 3, 'p:b': 'x', '__proto__': 1, 'bad key': 2, 'p:c': -1 } });
  assert.deepEqual(it.boughtFor, { 'p:a': 3 });
  assert.equal('boughtFor' in normalizeRecord('items', { id: 'i_x', listId: L, name: '洋葱', updatedAt: 5, boughtFor: { 'p:b': null } }), false, '一道也没有：不放这个键');
  assert.equal('boughtFor' in normalizeRecord('items', { id: 'i_x', listId: L, name: '洋葱', updatedAt: 5 }), false);
  const many = Object.fromEntries(Array.from({ length: 60 }, (_, i) => ['p:' + i, 1000 + i]));
  const capped = normalizeRecord('items', { id: 'i_x', listId: L, name: '洋葱', updatedAt: 5, boughtFor: many }).boughtFor;
  assert.equal(Object.keys(capped).length, 50);
  assert.ok(capped['p:59'] && !capped['p:9'], '留最近买的');
  // 各自从头建的同一条：云端那条已买（带着红烧肉 p:a），这台设备新建的要买（带着咖喱 p:b、以前记着的 p:z）
  const cloud = { id: 'i_x', listId: L, name: '洋葱', createdAt: 100, updatedAt: 200, status: 'done', doneAt: 150, needs: { 'p:a': { qty: 1, unit: '个' } } };
  const here = { id: 'i_x', listId: L, name: '洋葱', createdAt: 300, updatedAt: 400, status: 'need', needs: { 'p:b': { qty: 2, unit: '个' } }, boughtFor: { 'p:z': 50 } };
  const a = mergeStates({ data: { items: { i_x: cloud } } }, { data: { items: { i_x: here } } });
  const b = mergeStates({ data: { items: { i_x: here } } }, { data: { items: { i_x: cloud } } });
  assert.equal(canon(a), canon(b), '顺序无关');
  const m = normalizeState(a).data.items.i_x;
  assert.deepEqual([m.status, Object.keys(m.needs), m.boughtFor], ['need', ['p:b'], { 'p:z': 50, 'p:a': 150 }]);
  const again = normalizeState(mergeStates(a, { data: { items: { i_x: here } } })).data.items.i_x;
  assert.equal(canon(again), canon(m), '再合并一次结果一样');
});

test('改人数只重算对得上的那几份：清单上改了名的、食谱里后来删掉的那一样照原样留着；同名不同单位只算生成时勾了的那个单位；没变的不算改了', () => {
  const { s } = world();
  const rid = saveRecipe(s, null, { name: '奶茶', servings: '2', ings: [{ name: '牛奶', qty: '200', unit: 'ml' }, { name: '牛奶', qty: '1', unit: '杯' }, { name: '红茶', qty: '2', unit: '包' }, { name: '洋葱', qty: '1', unit: '个' }] }, now()).id;
  const a = add(s, { date: '2026-11-23', meal: 'snack', recipeId: rid });
  const keys = planLines(s, W.from, W.to, { listId: L }).lines.filter(l => !(l.name === '牛奶' && l.unit === '杯')).map(l => l.key);
  generateList(s, { ...W, keys }, now());
  assert.equal(totalLabel(itemOf(s, '牛奶')), '200 ml');
  assert.deepEqual(sheet(s).filter(r => r[0] === '牛奶').map(r => [r[1], r[3], r[4]]), [['ml', true, 'added'], ['杯', true, 'new']], '「牛奶 杯」生成时没勾：不算加过');
  // 清单上的洋葱改名成紫洋葱；食谱里删掉红茶
  editAndMove(s, itemOf(s, '洋葱').id, { name: '紫洋葱' }, null, now());
  saveRecipe(s, rid, { ...s.data.recipes[rid], servings: '2', ings: s.data.recipes[rid].ings.filter(g => g.name !== '红茶') }, now());
  const purple = canon(itemOf(s, '紫洋葱')), tea = canon(itemOf(s, '红茶'));
  const r = editEntry(s, a, { servings: 4 }, now());
  assert.equal(r.listChanged, 1, '只有牛奶');
  assert.equal(totalLabel(itemOf(s, '牛奶')), '400 ml', '没勾的「杯」不会冒出来');
  assert.equal(canon(itemOf(s, '紫洋葱')), purple, '改了名的不动（不会被拿掉）');
  assert.equal(canon(itemOf(s, '红茶')), tea, '食谱里删掉的不动');
  // 没写人数（照食谱的 2 人份）改成 2：用量一样，不算改了
  const b = add(s, { date: '2026-11-24', meal: 'dinner', recipeId: rid });
  generateList(s, { from: '2026-11-24', to: '2026-11-24', listId: L }, now());
  const items0 = canon(s.data.items);
  assert.equal(previewEdit(s, b, { servings: 2 }), false);
  assert.equal(editEntry(s, b, { servings: 2 }, now()).listChanged, 0);
  assert.equal(canon(s.data.items), items0);
});

test('改人数：同一样东西上这道菜两个单位，食谱里只剩一个了，另一个照原来的留着', () => {
  const { s } = world();
  const rid = saveRecipe(s, null, { name: '奶茶', servings: '2', ings: [{ name: '牛奶', qty: '200', unit: 'ml' }, { name: '牛奶', qty: '1', unit: '杯' }] }, now()).id;
  const a = add(s, { date: '2026-11-23', meal: 'snack', recipeId: rid });
  generateList(s, W, now());
  assert.equal(totalLabel(itemOf(s, '牛奶')), '200 ml + 1 杯');
  saveRecipe(s, rid, { ...s.data.recipes[rid], servings: '2', ings: s.data.recipes[rid].ings.filter(g => g.unit !== '杯') }, now());
  editEntry(s, a, { servings: 4 }, now());
  assert.equal(totalLabel(itemOf(s, '牛奶')), '400 ml + 1 杯');
});

test('买过、又自己勾上在另一张清单再买一次的：再打开是「加过」照样勾着，确认不会拿掉；换食谱时也留着换成新的用量', () => {
  const { s, hsr, curry } = world();
  const a = add(s, { date: '2026-11-23', meal: 'dinner', recipeId: hsr });
  generateList(s, W, now());
  for (const n of ['五花肉', '洋葱']) setStatus(s, itemOf(s, n).id, 'done', now());
  const party = { ...W, listId: 'l_party' };
  const keys = planLines(s, W.from, W.to, { listId: 'l_party' }).lines.filter(l => l.name === '洋葱').map(l => l.key);
  generateList(s, { ...party, keys }, now());
  assert.equal(totalLabel(itemOf(s, '洋葱', 'l_party')), '1 个', '都买过了还勾上：再买一次');
  assert.deepEqual(sheet(s, 'l_party').find(r => r[0] === '洋葱').slice(3), [true, 'added']);
  generateList(s, party, now());
  assert.equal(itemOf(s, '洋葱', 'l_party').deleted, undefined, '照默认确认：不会把再买的那份拿掉');
  // 换成咖喱（也要洋葱）：聚会上的洋葱就地换成咖喱的用量，不当成买过的拿掉
  editEntry(s, a, { recipeId: curry }, now());
  assert.deepEqual([itemOf(s, '洋葱', 'l_party').deleted, totalLabel(itemOf(s, '洋葱', 'l_party'))], [undefined, '2 个']);
});

test('generateList：前一道菜不要了的、后一道还要的东西不先删再加（商店、用过的次数不变）', () => {
  const { s } = world();
  const r1 = saveRecipe(s, null, { name: '炒洋葱', servings: '2', ings: [{ name: '洋葱', qty: '1', unit: '个' }] }, now()).id;
  const r2 = saveRecipe(s, null, { name: '洋葱汤', servings: '2', ings: [{ name: '洋葱', qty: '200', unit: 'g' }] }, now()).id;
  add(s, { date: '2026-11-23', meal: 'dinner', recipeId: r1 });
  generateList(s, W, now());
  editAndMove(s, itemOf(s, '洋葱').id, { storeId: 's_costco' }, null, now());
  const uses = memoryOf(s, '洋葱').uses;
  add(s, { date: '2026-11-26', meal: 'dinner', recipeId: r2 });
  const keys = planLines(s, W.from, W.to, { listId: L }).lines.filter(l => l.unit === 'g').map(l => l.key);
  generateList(s, { ...W, keys }, now());
  const onion = itemOf(s, '洋葱');
  assert.deepEqual([onion.deleted, onion.storeId, totalLabel(onion), memoryOf(s, '洋葱').uses], [undefined, 's_costco', '200 g', uses]);
});

test('generateList：一个也没勾，这几道菜已经在清单上的那一份全拿掉', () => {
  const { s, hsr } = world();
  add(s, { date: '2026-11-23', meal: 'dinner', recipeId: hsr });
  generateList(s, W, now());
  const r = generateList(s, { ...W, keys: [] }, now());
  assert.deepEqual([r.items, r.changed], [0, 2]);
  assert.deepEqual([itemOf(s, '五花肉').deleted, itemOf(s, '洋葱').deleted], [true, true]);
});

test('买过的这一轮记进 boughtFor 的其余几条路：编辑面板里隔久了改回要买、移过来合并成那一条已买的；刚勾上就取消（点错了）不记', () => {
  const { s, hsr } = world();
  const a = add(s, { date: '2026-11-23', meal: 'dinner', recipeId: hsr });
  generateList(s, W, now());
  const src = planSource(a);
  setStatus(s, itemOf(s, '洋葱').id, 'done', now());
  setStatus(s, itemOf(s, '洋葱').id, 'need', now());
  assert.deepEqual([Object.keys(itemOf(s, '洋葱').needs), itemOf(s, '洋葱').boughtFor], [[src], undefined], '点错了又点回来：照原样');
  setStatus(s, itemOf(s, '五花肉').id, 'done', now());
  clock += 3600_000;
  editAndMove(s, itemOf(s, '五花肉').id, { status: 'need' }, null, now());
  assert.deepEqual([itemOf(s, '五花肉').needs, Object.keys(itemOf(s, '五花肉').boughtFor)], [{}, [src]]);
  // 聚会清单上自己加的洋葱移到「食材」，那边的洋葱已经为红烧肉买过：合并成那一条，红烧肉的照样算买过
  setStatus(s, itemOf(s, '洋葱').id, 'done', now());
  addFromInput(s, 'l_party', '洋葱 2', now());
  editAndMove(s, itemOf(s, '洋葱', 'l_party').id, {}, L, now());
  assert.deepEqual([itemOf(s, '洋葱').status, totalLabel(itemOf(s, '洋葱')), Object.keys(itemOf(s, '洋葱').boughtFor)], ['need', '2', [src]]);
  assert.deepEqual(sheet(s).filter(r => r[0] === '洋葱' || r[0] === '五花肉').map(r => [r[0], r[3], r[4]]), [['五花肉', false, 'bought'], ['洋葱', false, 'bought']]);
});
