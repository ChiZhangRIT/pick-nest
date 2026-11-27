// 饮食记录（第 13 步）的规则：log、foods、goals 的整理，记 / 改 / 删（份数相乘、四舍五入、记的时候抄下来），从计划「吃了」，常吃的（记住、联想），
// 合计、和目标比、一周的平均（日子的边界），食谱的每人份营养，foods 的合并（各自从头建的补字段），撤销。全是编的数据
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blankState, ensureSeeds, normalizeState, normalizeLog, normalizeFood, normalizeNutrition, normalizeRecipe, nutrValue, mergeStates, canon, writeRecord } from '../src/core/store.js';
import { saveRecipe, deleteRecipe, validateRecipe } from '../src/core/recipes.js';
import { addEntry } from '../src/core/plan.js';
import {
  addLogEntry, editLogEntry, deleteLogEntry, validateLogEntry, logOn, logIn, liveLog, loggedFrom, logFromPlan, logFromRecipe, logFromFood, perServing, editedTotals,
  sumEntries, dayTotals, totalsByDay, weekAverage, goalsOf, setGoals, validateGoals, goalProgress, mealAt, NUTRIENTS,
} from '../src/core/log.js';
import { foodId, foodOf, liveFood, rememberFood, foodSuggestions, readNutrition, scaleNutrition, hasNutrition, KCAL_MAX, GRAM_MAX } from '../src/core/foods.js';
import * as state from '../src/core/state.js';

const fresh = () => ensureSeeds(blankState());
let clock = 1_000_000;
const now = () => (clock += 1000);
const MON = '2026-11-23', SUN = '2026-11-29';
const nut = (e) => [e.kcal, e.protein, e.carbs, e.fat];

test('整理：log 的份数、营养（千卡整数、克一位小数、负数和读不出来的是没填）、哪一顿、认不出的日子原样留着', () => {
  const e = normalizeLog({ id: 'e_1', date: 'someday', meal: 'brunch', servings: '0', kcal: '519.6', protein: 25.25, carbs: -3, fat: 'x', estimated: 'yes', planId: '../bad', extra: 1 });
  assert.deepEqual([e.date, e.meal, e.servings, ...nut(e), e.estimated, e.planId, e.extra], ['someday', 'dinner', 1, 520, 25.3, null, null, false, null, 1]);
  assert.equal(normalizeLog({ id: 'e_2', servings: 1.5 }).servings, 1.5);
  // 整理两次一样（四舍五入过的再整理不变：25.3 × 10 是 253.00000000000003）
  assert.equal(canon(normalizeLog(e)), canon(e));
  assert.deepEqual([nutrValue('kcal', 0), nutrValue('fat', 0.04), nutrValue('fat', 0.05), nutrValue('protein', '')], [0, 0, 0.1, null]);
});

test('整理：foods 的种类、每多少、单位重量；食谱的每人份营养没填是 null（填了 0 不是没填），别的字段留着', () => {
  const f = normalizeFood({ id: 'f_1', name: '鸡蛋', kind: 'snack', per: { kcal: '72', fat: -1, fiber: 1 }, grams: { 个: '50', 勺: 0, __proto__: 3 }, uses: 2.7, ref: 3 });
  assert.deepEqual([f.kind, f.perUnit, f.per, f.grams, f.uses, f.ref], ['food', 'serving', { kcal: 72, protein: null, carbs: null, fat: null, fiber: 1 }, { 个: 50 }, 2, null]);
  assert.equal(normalizeFood({ id: 'f_2', kind: 'ingredient' }).perUnit, '100g', '食材的营养默认每 100 g');
  assert.equal(normalizeRecipe({ id: 'r_1', name: 'x' }).nutrition, null, '第 13 步以前的食谱整理后是 null');
  assert.equal(normalizeRecipe({ id: 'r_1', name: 'x', nutrition: { kcal: null } }).nutrition, null);
  assert.deepEqual(normalizeRecipe({ id: 'r_1', name: 'x', nutrition: { kcal: 0 } }).nutrition, { kcal: 0, protein: null, carbs: null, fat: null }, '0 千卡的黑咖啡是填了的');
  assert.deepEqual(normalizeNutrition('bad'), { kcal: null, protein: null, carbs: null, fat: null });
  // 旧数据（没有 foods、log 集合）读进来补上空的
  const s = normalizeState({ app: 'picknest', v: 1, data: { lists: {} } });
  assert.deepEqual([s.data.foods, s.data.log], [{}, {}]);
});

test('营养输入框：空的是没填、分数和小数都认、负数和读不出来报错、太大报错；乘份数以后再整理', () => {
  const r = readNutrition({ kcal: ' 190 ', protein: '1/2', carbs: '', fat: '8.25' });
  assert.deepEqual([r.ok, r.value], [true, { kcal: 190, protein: 0.5, carbs: null, fat: 8.3 }]);
  const bad = readNutrition({ kcal: '-5', protein: 'abc', carbs: String(GRAM_MAX + 1), fat: '3' });
  assert.deepEqual(bad.errors, { kcal: 'log.err.num', protein: 'log.err.num', carbs: 'log.err.gramMax' });
  assert.deepEqual(readNutrition({ kcal: KCAL_MAX + 1 }).errors, { kcal: 'log.err.kcalMax' });
  assert.equal(readNutrition(null).ok, true);
  assert.deepEqual(scaleNutrition({ kcal: 333, protein: 10.2, carbs: null, fat: 0.3 }, 1.5), { kcal: 500, protein: 15.3, carbs: null, fat: 0.5 });
  assert.deepEqual([hasNutrition({ kcal: 0 }), hasNutrition({ kcal: null }), hasNutrition(null)], [true, false, false]);
});

test('记一样：合计 = 每份 × 份数（千卡整数、克一位小数）；排在那一顿的最后；有错什么也不改', () => {
  const s = fresh();
  const a = addLogEntry(s, { date: MON, meal: 'lunch', title: ' 拿铁 ', servings: '1.5', per: { kcal: '190', protein: '8.4', fat: '7' } }, now());
  assert.ok(a.ok);
  assert.deepEqual([a.entry.title, a.entry.servings, ...nut(a.entry), a.entry.order, a.entry.estimated], ['拿铁', 1.5, 285, 12.6, null, 10.5, 0, false]);
  const b = addLogEntry(s, { date: MON, meal: 'lunch', title: '饼干', per: {} }, now());
  assert.deepEqual([b.entry.servings, b.entry.kcal, b.entry.order], [1, null, 1], '份数空着是 1 份；没填的营养是 null');
  const before = canon(s);
  for (const [input, key] of [
    [{ date: MON, title: '' }, 'title'], [{ date: '2026-02-30', title: 'x' }, 'date'], [{ date: MON, title: 'x', servings: '0' }, 'servings'],
    [{ date: MON, title: 'x', servings: '100' }, 'servings'], [{ date: MON, title: 'x', per: { kcal: '-1' } }, 'kcal'],
  ]) {
    const r = addLogEntry(s, input, now());
    assert.equal(r.ok, false);
    assert.ok(/** @type {any} */ (r).errors[key], key);
  }
  assert.equal(canon(s), before, '有错的一条也没记、常吃的也没动');
  assert.deepEqual(logOn(s, MON).map(e => e.title), ['拿铁', '饼干']);
});

test('手动写的记进常吃的（这次的写法和每份营养、次数）；从食谱记的不记；同名是食材的营养时不盖掉', () => {
  const s = fresh();
  const rid = saveRecipe(s, null, { name: '红烧肉', servings: '2', ings: [], nutrition: { kcal: '620' } }, now()).id;
  addLogEntry(s, { date: MON, title: '拿铁', per: { kcal: '190' } }, now());
  const t2 = now();
  const e2 = addLogEntry(s, { date: MON, title: '拿鐵', per: { kcal: '200', protein: '9' } }, t2);
  const f = foodOf(s, '拿铁');
  assert.equal(f.id, foodId('拿鐵'), '简繁是同一条');
  assert.deepEqual([f.name, f.uses, f.lastAt, f.per], ['拿鐵', 2, t2, { kcal: 200, protein: 9, carbs: null, fat: null }]);
  assert.equal(e2.entry.foodId, f.id);
  const r = addLogEntry(s, logFromRecipe(s, rid) && { ...logFromRecipe(s, rid), date: MON }, now());
  assert.deepEqual([r.entry.recipeId, r.entry.foodId, r.entry.kcal], [rid, null, 620]);
  assert.equal(foodOf(s, '红烧肉'), null, '食谱的不进常吃的');
  // 食材的营养（第 15 步，每 100 g）占着这个名字：不混进每份的数
  writeRecord(s, 'foods', { id: foodId('豆腐'), name: '豆腐', kind: 'ingredient', per: { kcal: 76 }, createdAt: 1 }, now());
  const tofu = addLogEntry(s, { date: MON, title: '豆腐', per: { kcal: '150' } }, now());
  assert.deepEqual([tofu.entry.foodId, liveFood(s, foodId('豆腐')).per.kcal, liveFood(s, foodId('豆腐')).kind], [null, 76, 'ingredient']);
  // 改的时候保留 createdAt（不然合并时当成各自从头建的）
  const created = f.createdAt;
  rememberFood(s, '拿铁', { kcal: 210 }, { use: false }, now());
  assert.deepEqual([foodOf(s, '拿铁').createdAt, foodOf(s, '拿铁').uses], [created, 2]);
  assert.equal(rememberFood(s, '  ', { kcal: 1 }), null);
});

test('记的时候抄下来：以后改了食谱的每人份、常吃的、删了食谱，记过的不变', () => {
  const s = fresh();
  const rid = saveRecipe(s, null, { name: '燕麦粥', servings: '1', ings: [], nutrition: { kcal: '330', protein: '14' } }, now()).id;
  const a = addLogEntry(s, { ...logFromRecipe(s, rid), date: MON, servings: '2' }, now());
  const b = addLogEntry(s, { date: MON, title: '苹果', per: { kcal: '95' } }, now());
  saveRecipe(s, rid, { name: '燕麦粥（少糖）', servings: '1', ings: [], nutrition: { kcal: '280' } }, now());
  rememberFood(s, '苹果', { kcal: 80 }, { use: false }, now());
  deleteRecipe(s, rid, now());
  assert.deepEqual([liveLog(s, a.id).title, ...nut(liveLog(s, a.id))], ['燕麦粥', 660, 28, null, null]);
  assert.equal(liveLog(s, b.id).kcal, 95);
  // 食谱删了以后照样能记（不再连着，名字是写的）
  const c = addLogEntry(s, { date: MON, recipeId: rid, title: '燕麦粥', per: { kcal: '300' } }, now());
  assert.deepEqual([c.entry.recipeId, c.entry.title], [null, '燕麦粥']);
});

test('食谱还没填每人份营养：这次填了、勾着「也记到食谱里」才记上；已经填了的不改', () => {
  const s = fresh();
  const rid = saveRecipe(s, null, { name: '番茄炒蛋', servings: '2', ings: [] }, now()).id;
  addLogEntry(s, { ...logFromRecipe(s, rid), date: MON, per: { kcal: '250' } }, now());
  assert.equal(s.data.recipes[rid].nutrition, null, '没勾不记');
  addLogEntry(s, { ...logFromRecipe(s, rid), date: MON, per: { kcal: '260', fat: '15' }, saveToRecipe: true }, now());
  assert.deepEqual(s.data.recipes[rid].nutrition, { kcal: 260, protein: null, carbs: null, fat: 15 });
  addLogEntry(s, { ...logFromRecipe(s, rid), date: MON, per: { kcal: '999' }, saveToRecipe: true }, now());
  assert.equal(s.data.recipes[rid].nutrition.kcal, 260, '填了的不改');
  // 编辑页：每人份营养给了才改，写错标在那一样上
  assert.deepEqual(validateRecipe({ name: 'x', nutrition: { kcal: 'abc', fat: '-1' } }).errors.nutrition, { kcal: 'log.err.num', fat: 'log.err.num' });
  assert.equal(validateRecipe({ name: 'x', nutrition: { kcal: '', protein: ' ' } }).clean.nutrition, null);
  assert.equal('nutrition' in validateRecipe({ name: 'x' }).clean, false, '没给的保存时照原来的');
  saveRecipe(s, rid, { name: '番茄炒蛋', servings: '2', ings: [] }, now());
  assert.equal(s.data.recipes[rid].nutrition.kcal, 260, '别处调 saveRecipe 不冲掉营养');
});

test('从计划「吃了」：那一天那一顿、1 份、食谱现在的每人份营养；只写一句的用那句话；同一道菜能记几次；菜不在了 → null', () => {
  const s = fresh();
  const rid = saveRecipe(s, null, { name: '红烧肉', servings: '2', ings: [], nutrition: { kcal: '620', protein: '22' } }, now()).id;
  const p = addEntry(s, { date: MON, meal: 'dinner', recipeId: rid, servings: '3' }, now()).id;
  const q = addEntry(s, { date: MON, meal: 'lunch', title: '公司食堂' }, now()).id;
  assert.deepEqual(logFromPlan(s, p), { date: MON, meal: 'dinner', title: '红烧肉', recipeId: rid, planId: p, servings: 1, per: { kcal: 620, protein: 22, carbs: null, fat: null }, estimated: false, estNote: null, fromFood: null });
  assert.deepEqual(logFromPlan(s, q), { date: MON, meal: 'lunch', title: '公司食堂', recipeId: null, planId: q, servings: 1, per: null, estimated: false, estNote: null, fromFood: null });
  assert.equal(logFromPlan(s, 'p_nope'), null);
  assert.equal(loggedFrom(s, p), 0);
  addLogEntry(s, logFromPlan(s, p), now());
  addLogEntry(s, { ...logFromPlan(s, p), servings: '0.5' }, now());
  assert.equal(loggedFrom(s, p), 2);
  assert.deepEqual(logOn(s, MON).filter(e => e.planId === p).map(e => e.kcal), [620, 310]);
  // 只写一句的「出去吃」记的时候也进常吃的
  addLogEntry(s, { ...logFromPlan(s, q), per: { kcal: '800' } }, now());
  assert.equal(foodOf(s, '公司食堂').per.kcal, 800);
  // 下一次「吃了」同一句话：用记住的每份；直接「添加」不会记成没填，也不会把记住的冲掉
  const q2 = addEntry(s, { date: SUN, meal: 'lunch', title: '公司食堂' }, now()).id;
  assert.deepEqual(logFromPlan(s, q2), { date: SUN, meal: 'lunch', title: '公司食堂', recipeId: null, planId: q2, servings: 1,
    per: { kcal: 800, protein: null, carbs: null, fat: null }, estimated: false, estNote: null, fromFood: foodId('公司食堂') });
  const again = addLogEntry(s, logFromPlan(s, q2), now());
  assert.deepEqual([again.entry.kcal, foodOf(s, '公司食堂').per.kcal, foodOf(s, '公司食堂').uses], [800, 800, 2]);
});

test('写的名字正好是常吃的、没点它：空着的营养是没填（不冲掉记住的），一个数也没填 = 和点了它一样；从它填好的，空着才是删掉了', () => {
  const s = fresh();
  addLogEntry(s, { date: MON, title: '拿铁', per: { kcal: '190', protein: '10', carbs: '15', fat: '7' } }, now());
  const keep = { kcal: 190, protein: 10, carbs: 15, fat: 7 };
  // 打了「拿铁」直接添加（面板交来的四个框都是空的字）
  const a = addLogEntry(s, { date: MON, title: '拿铁', per: { kcal: '', protein: '', carbs: '', fat: '' } }, now());
  assert.deepEqual(nut(a.entry), [190, 10, 15, 7], '这一条用记住的每份');
  assert.deepEqual([foodOf(s, '拿铁').per, foodOf(s, '拿铁').uses], [keep, 2], '记住的没被冲掉');
  // 写了几个数、别的空着：填了的记上，空着的留着记住的
  const b = addLogEntry(s, { date: MON, title: '拿鐵', servings: '2', per: { kcal: '200', protein: '', carbs: '', fat: '' } }, now());
  assert.deepEqual(nut(b.entry), [400, null, null, null], '这一条照写的记');
  assert.deepEqual(foodOf(s, '拿铁').per, { ...keep, kcal: 200 });
  // 从它填好的（点了它、写名字时自动填上的）：用户删掉的就是删掉了
  const c = addLogEntry(s, { date: MON, title: '拿铁', per: { kcal: '200', protein: '10', carbs: '', fat: '7' }, fromFood: foodId('拿铁') }, now());
  assert.equal(c.entry.carbs, null);
  assert.deepEqual(foodOf(s, '拿铁').per, { kcal: 200, protein: 10, carbs: null, fat: 7 });
  // fromFood 是别的一条（点了「拿铁」又把名字改成「冰拿铁」）：不算从这一条填的
  addLogEntry(s, { date: MON, title: '冰拿铁', per: { kcal: '150', protein: '6' } }, now());
  addLogEntry(s, { date: MON, title: '冰拿铁', per: { kcal: '160', protein: '' }, fromFood: foodId('拿铁') }, now());
  assert.deepEqual(foodOf(s, '冰拿铁').per, { kcal: 160, protein: 6, carbs: null, fat: null });
  // rememberFood 只改给了的那几样（给了、空的 = 清掉）
  rememberFood(s, '拿铁', { fat: '' }, { use: false }, now());
  assert.deepEqual(foodOf(s, '拿铁').per, { kcal: 200, protein: 10, carbs: null, fat: null });
});

test('改一条：只改份数时合计按比例变（按没四舍五入的每份）；改了营养是新的每份 × 份数；挪到别的一顿排在最后；手动写的常吃的跟着更新，不算又吃了一次', () => {
  const s = fresh();
  const a = addLogEntry(s, { date: MON, meal: 'lunch', title: '饺子', servings: '3', per: { kcal: '33', protein: '1.2' } }, now());
  assert.deepEqual(nut(a.entry), [99, 3.6, null, null]);
  // 合计除不尽份数的（另一台设备、以后的版本记的）：100 千卡 3 份
  writeRecord(s, 'log', { ...a.entry, kcal: 100, protein: 3.5 }, now());
  a.entry = liveLog(s, a.id);
  assert.deepEqual(perServing(a.entry), { kcal: 100 / 3, protein: 3.5 / 3, carbs: null, fat: null });
  const b = editLogEntry(s, a.id, { servings: '2' }, now());
  assert.deepEqual([b.entry.servings, ...nut(b.entry)], [2, 67, 2.3, null, null], '100 × 2/3 = 66.7 → 67，不是 33 × 2');
  const c = editLogEntry(s, a.id, { per: { kcal: '50', protein: '', carbs: '6' } }, now());
  assert.deepEqual(nut(c.entry), [100, null, 12, null], '改了的营养：每份 × 2 份（清空的蛋白质就是没填）');
  assert.deepEqual(foodOf(s, '饺子').per, { kcal: 50, protein: null, carbs: 6, fat: null });
  assert.equal(foodOf(s, '饺子').uses, 1, '改不算又吃了一次');
  const fat = editLogEntry(s, a.id, { per: { fat: '4' } }, now());
  assert.deepEqual(nut(fat.entry), [100, null, 12, 8], '只给了脂肪：别的合计不动');
  assert.deepEqual(foodOf(s, '饺子').per, { kcal: 50, protein: null, carbs: 6, fat: 4 }, '常吃的也只改脂肪');
  const same = editLogEntry(s, a.id, { note: '猪肉白菜' }, now());
  assert.deepEqual(nut(same.entry), [100, null, 12, 8], '什么营养都没给：合计不动');
  addLogEntry(s, { date: MON, meal: 'dinner', title: '汤', per: {} }, now());
  const moved = editLogEntry(s, a.id, { meal: 'dinner' }, now());
  assert.deepEqual([moved.entry.meal, moved.entry.order], ['dinner', 1]);
  const renamed = editLogEntry(s, a.id, { title: '水饺' }, now());
  assert.deepEqual([renamed.entry.foodId, foodOf(s, '水饺').per], [foodId('水饺'), { kcal: 50, protein: null, carbs: 6, fat: 4 }], '改了名字：这一条的每份记到新名字上');
  assert.deepEqual(editLogEntry(s, a.id, { servings: '0' }).errors, { servings: 'log.err.servings' });
  assert.deepEqual(editLogEntry(s, 'e_nope', {}).errors, { entry: 'log.err.gone' });
  // 估算的（第 15 步）自己改了营养就不再是估算
  writeRecord(s, 'log', { ...liveLog(s, a.id), estimated: true }, now());
  assert.equal(editLogEntry(s, a.id, { per: { kcal: '60' } }, now()).entry.estimated, false);
});

test('改一条：份数改过以后只改一样营养，别的合计不变（框里的每份是四舍五入过的，不拿它乘回去）；面板的合计和存的一样', () => {
  const s = fresh();
  const a = addLogEntry(s, { date: MON, title: '包子', servings: '1.5', per: { kcal: '101', protein: '3.4', carbs: '17', fat: '2.2' } }, now());
  assert.deepEqual(nut(a.entry), [152, 5.1, 25.5, 3.3]);
  const b = editLogEntry(s, a.id, { servings: '2' }, now());
  assert.deepEqual(nut(b.entry), [203, 6.8, 34, 4.4], '只改份数：按比例');
  // 再打开面板：框里的热量是 101.5（203 ÷ 2）；只改脂肪
  const c = editLogEntry(s, a.id, { per: { fat: '10' } }, now());
  assert.deepEqual(nut(c.entry), [203, 6.8, 34, 20], '热量、蛋白质、碳水不动');
  // 面板里改成 3 份时写的合计 = 存的
  const preview = editedTotals(c.entry, 3, {});
  const d = editLogEntry(s, a.id, { servings: '3' }, now());
  assert.deepEqual(nut(d.entry), [preview.kcal, preview.protein, preview.carbs, preview.fat]);
  assert.deepEqual(nut(d.entry), [305, 10.2, 51, 30]);
  // 给了的那几样按新的每份 × 份数；给了空的 = 清掉
  assert.deepEqual(editedTotals(d.entry, 2, { kcal: 90, carbs: null }), { kcal: 180, protein: 6.8, carbs: null, fat: 20 });
});

test('删一条：软删除（不算进合计）；撤销回来（state.js 的撤销）', () => {
  state.load({ storage: null });
  const a = state.mutate(s => addLogEntry(s, { date: MON, title: '蛋糕', per: { kcal: '400' } }, now()));
  const gone = state.mutate(s => deleteLogEntry(s, a.id, now()), { undoLabel: '已删除「蛋糕」' });
  assert.equal(gone.title, '蛋糕');
  assert.equal(state.getState().data.log[a.id].deleted, true);
  assert.equal(dayTotals(state.getState(), MON).kcal, 0);
  assert.equal(deleteLogEntry(structuredClone(state.getState()), a.id), null, '已经删了');
  state.undo();
  assert.equal(liveLog(state.getState(), a.id).kcal, 400);
  assert.equal(dayTotals(state.getState(), MON).kcal, 400);
});

test('合计：没填的不算进去、写着几条没填；浮点零头不显示；估算的标出来', () => {
  const e = (kcal, protein, estimated = false) => ({ kcal, protein, carbs: null, fat: 0.1, estimated });
  const t = sumEntries(/** @type {any} */ ([e(100, 0.1), e(null, 0.2), e(250, null, true)]));
  assert.deepEqual(t, { kcal: 350, protein: 0.3, carbs: 0, fat: 0.3, n: 3, missing: { kcal: 1, protein: 1, carbs: 3, fat: 0 }, estimated: true });
  assert.deepEqual(sumEntries([]), { kcal: 0, protein: 0, carbs: 0, fat: 0, n: 0, missing: { kcal: 0, protein: 0, carbs: 0, fat: 0 }, estimated: false });
});

test('日子的边界：几天里的（两头都算）、认不出的日子不算；一周的平均只算周一到周日里记了热量的日子', () => {
  const s = fresh();
  const add = (date, kcal, protein = null) => addLogEntry(s, { date, title: 'x', per: { kcal: kcal == null ? '' : String(kcal), protein: protein == null ? '' : String(protein) } }, now());
  add('2026-11-22', 5000);      // 上一周的周日
  add(MON, 1800, 90);
  add(MON, 200);
  add('2026-11-25', null, 30);  // 只写了蛋白质：热量的平均不算这一天
  add(SUN, 1500, 60);
  add('2026-11-30', 9000);      // 下一周的周一
  writeRecord(s, 'log', { id: 'e_bad', date: '11/24', title: 'y', kcal: 999, createdAt: 1 }, now());
  assert.deepEqual(logIn(s, MON, SUN).map(e => e.date), [MON, MON, '2026-11-25', SUN]);
  assert.deepEqual([...totalsByDay(s, MON, SUN)].map(([d, t]) => [d, t.kcal]), [[MON, 2000], ['2026-11-25', 0], [SUN, 1500]]);
  const w = weekAverage(s, '2026-11-26');
  assert.deepEqual(w, { from: MON, to: SUN, days: 2, kcal: 1750, protein: 60, carbs: null, fat: null, skipsToday: false }, '(2000 + 1500) / 2；蛋白质 (90 + 30 + 60) / 3');
  assert.deepEqual(weekAverage(s, SUN), w, '周日还是这一周');
  assert.equal(weekAverage(s, '2026-11-30').kcal, 9000);
  assert.equal(weekAverage(s, '2026-12-07').days, 0);
  assert.equal(weekAverage(s, 'bad').days, 0);
  // 今天还没吃完（第 16 步检查）：只算今天以前的。周日只记了早饭：不拉低平均，写着「不算今天」
  assert.deepEqual(weekAverage(s, MON, { today: SUN }), { ...w, days: 1, kcal: 2000, protein: 60, skipsToday: true }, '周一 2000；蛋白质 (90 + 30) / 2');
  assert.deepEqual(weekAverage(s, MON, { today: '2026-11-25' }), { ...w, days: 1, kcal: 2000, protein: 90, skipsToday: true });
  assert.deepEqual(weekAverage(s, MON, { today: '2026-11-24' }), { ...w, days: 1, kcal: 2000, protein: 90, skipsToday: false }, '今天还没记：没有不算的');
  assert.deepEqual(weekAverage(s, MON, { today: MON }), { from: MON, to: SUN, days: 0, kcal: null, protein: null, carbs: null, fat: null, skipsToday: true }, '只有今天记了：没有平均');
  assert.deepEqual(weekAverage(s, MON, { today: '2026-12-01' }), w, '过去的一周：都算');
  assert.deepEqual(weekAverage(s, MON, { today: 'bad' }), w);
});

test('饮食目标：只改给了的那几样、空的和 0 是不设、写错不存；没变不盖新时间；和目标比（还差 / 超了 / 进度）', () => {
  const s = fresh();
  const at = (/** @type {any} */ st) => NUTRIENTS.map(k => st.settingsAt['goals.' + k]);
  const raw = (/** @type {any} */ st) => NUTRIENTS.map(k => st.settings['goals.' + k]);
  assert.deepEqual(goalsOf(s), { kcal: null, protein: null, carbs: null, fat: null });
  assert.deepEqual(setGoals(s, { kcal: '1800.4', protein: '90' }, 5000), { ok: true, changed: true, errors: {} });
  assert.deepEqual([raw(s), at(s)], [[1800, 90, undefined, undefined], [5000, 5000, undefined, undefined]], '一样一个键，没给的不写');
  assert.equal(s.settings.goals, undefined);
  assert.equal(setGoals(s, { kcal: '1800' }, 6000).changed, false, '一样的不盖新时间');
  assert.equal(s.settingsAt['goals.kcal'], 5000);
  setGoals(s, { protein: '0' }, 7000);
  assert.deepEqual([goalsOf(s).protein, s.settings['goals.protein'], s.settingsAt['goals.protein'], s.settingsAt['goals.kcal']], [null, null, 7000, 5000], '0 是不设：写 null、盖新时间，别的不动');
  assert.deepEqual([setGoals(s, { carbs: '0', fat: '' }, 7500).changed, at(s)], [false, [5000, 7000, undefined, undefined]], '本来就没设的写 0、清空：不写');
  assert.deepEqual(setGoals(s, { fat: '-3' }, 8000), { ok: false, changed: false, errors: { fat: 'log.err.num' } });
  assert.deepEqual(validateGoals({ kcal: '' }).clean.kcal, null);
  Object.assign(s.settings, { 'goals.kcal': 'abc', 'goals.protein': -1, 'goals.fat': 50 });
  assert.deepEqual(goalsOf(s), { kcal: null, protein: null, carbs: null, fat: 50 }, '坏了的当没设');
  const p = goalProgress(/** @type {any} */ ({ kcal: 2100, protein: 45, carbs: 0, fat: 50 }), { kcal: 1800, protein: 90, carbs: null, fat: 50 });
  assert.deepEqual(p, [
    { key: 'kcal', value: 2100, goal: 1800, left: 0, over: 300, ratio: 1 },
    { key: 'protein', value: 45, goal: 90, left: 45, over: 0, ratio: 0.5 },
    { key: 'carbs', value: 0, goal: null, left: null, over: null, ratio: null },
    { key: 'fat', value: 50, goal: 50, left: 0, over: 0, ratio: 1 },
  ]);
  // 本来就没设的写 0：什么也不写（空写一次会冲掉别的设备刚设、还没同步过来的目标）
  const z = fresh();
  assert.deepEqual(setGoals(z, { kcal: '0' }, 1000), { ok: true, changed: false, errors: {} });
  assert.deepEqual([z.settings['goals.kcal'], z.settingsAt['goals.kcal']], [undefined, undefined]);
  const other = fresh();
  setGoals(other, { kcal: '1600' }, 900);
  assert.equal(goalsOf(mergeStates(z, other)).kcal, 1600);
  // 不认识的（以后的版本加的纤维）是另一个键，原样留着、照样同步
  z.settings['goals.fiber'] = 30; z.settingsAt['goals.fiber'] = 1500;
  assert.equal(setGoals(z, { protein: '90' }, 2000).changed, true);
  assert.equal(z.settings['goals.fiber'], 30);
  assert.equal(mergeStates(fresh(), z).settings['goals.fiber'], 30);
});

test('饮食目标：两台设备还没同步时各设了一样，合并以后两样都在（一样一个键）；同一样两边都改了取晚的；顺序无关、重复合并不变（第 16 步检查）', () => {
  const base = fresh();
  setGoals(base, { kcal: '2000', fat: '70' }, 1000);
  const a = mergeStates(fresh(), base), b = mergeStates(fresh(), base);
  setGoals(a, { kcal: '1800' }, 2000);                    // 设备 A：设置 → 饮食目标，热量
  setGoals(b, { protein: '120' }, 3000);                  // 设备 B（离线）：蛋白质
  setGoals(b, { fat: '' }, 3500);                         // B 还把脂肪清掉了
  const ab = mergeStates(a, b), ba = mergeStates(b, a);
  assert.deepEqual(goalsOf(ab), { kcal: 1800, protein: 120, carbs: null, fat: null });
  assert.deepEqual(ab, ba, '顺序无关');
  assert.deepEqual(mergeStates(ab, ab), ab, '重复合并不变');
  assert.deepEqual(mergeStates(ab, a), ab);
  // 同一样两边都改了：晚的为准
  setGoals(a, { protein: '100' }, 4000);
  assert.equal(goalsOf(mergeStates(a, b)).protein, 100);
  assert.equal(goalsOf(mergeStates(b, a)).protein, 100);
});

test('常吃的联想：开头对上的在前，再按次数、最近一次；框空着列「常吃的」；只有 kind food；最多几样', () => {
  const s = fresh();
  const f = (name, uses, lastAt) => writeRecord(s, 'foods', { id: foodId(name), name, kind: 'food', per: {}, uses, lastAt, createdAt: 1 }, now());
  f('拿铁', 5, 100); f('冰拿铁', 9, 300); f('拿破仑', 5, 200); f('牛肉面', 1, 900);
  writeRecord(s, 'foods', { id: foodId('拿铁豆'), name: '拿铁豆', kind: 'ingredient', uses: 99, createdAt: 1 }, now());
  assert.deepEqual(foodSuggestions(s, '拿').map(x => x.name), ['拿破仑', '拿铁', '冰拿铁']);
  assert.deepEqual(foodSuggestions(s, '拿鐵').map(x => x.name), ['拿铁', '冰拿铁'], '简繁互通');
  assert.deepEqual(foodSuggestions(s, '').map(x => x.name), ['冰拿铁', '拿破仑', '拿铁', '牛肉面']);
  assert.equal(foodSuggestions(s, '', { limit: 2 }).length, 2);
  assert.deepEqual(logFromFood(s, foodId('拿铁')), { title: '拿铁', recipeId: null, servings: 1, per: { kcal: null, protein: null, carbs: null, fat: null }, fromFood: foodId('拿铁') });
  assert.equal(logFromFood(s, 'f_nope'), null);
});

test('合并 foods：各自从头记的同一样（createdAt 不一样）补上空着的营养（同一种、同一个每多少才补）、次数取大的、单位重量都留；顺序无关、再合并不变', () => {
  const st = (rec) => ensureSeeds(normalizeState({ app: 'picknest', v: 1, data: { foods: { f_x: { id: 'f_x', name: '拿铁', kind: 'food', ...rec } } } }));
  const merged = (a, b) => ensureSeeds(normalizeState(mergeStates(a, b)));
  const old = st({ per: { kcal: 190, protein: 9, carbs: 15, fat: 7 }, grams: { 杯: 350 }, uses: 12, lastAt: 500, createdAt: 100, updatedAt: 500 });
  const neu = st({ per: { kcal: 200 }, grams: { 杯: 400, 小杯: 240 }, uses: 1, lastAt: 900, createdAt: 800, updatedAt: 900 });
  const m = merged(old, neu), f = m.data.foods.f_x;
  assert.deepEqual([f.per, f.grams, f.uses, f.lastAt, f.createdAt, f.updatedAt], [{ kcal: 200, protein: 9, carbs: 15, fat: 7 }, { 杯: 400, 小杯: 240 }, 12, 900, 100, 901]);
  assert.equal(canon(merged(neu, old)), canon(m));
  for (const x of [old, neu, m]) assert.equal(canon(merged(m, x)), canon(m));
  // 一条是每 100 g 的食材营养：不互相补
  const ing = st({ kind: 'ingredient', per: { kcal: 60, protein: 3 }, createdAt: 50, updatedAt: 950 });
  const mi = merged(neu, ing).data.foods.f_x;
  assert.deepEqual([mi.kind, mi.per], ['ingredient', { kcal: 60, protein: 3, carbs: null, fat: null }]);
  // 同一条（createdAt 一样）：整条取较新的
  const v1 = st({ per: { kcal: 190, protein: 9 }, createdAt: 100, updatedAt: 500 }), v2 = st({ per: { kcal: 180 }, createdAt: 100, updatedAt: 600 });
  assert.deepEqual(merged(v1, v2).data.foods.f_x.per, { kcal: 180, protein: null, carbs: null, fat: null }, '清空的不被旧的补回来');
  // log 的 id 是随机的：整条取较新的
  const la = ensureSeeds(normalizeState({ app: 'picknest', v: 1, data: { log: { e_1: { id: 'e_1', date: MON, title: '粥', kcal: 300, createdAt: 1, updatedAt: 10 } } } }));
  const lb = ensureSeeds(normalizeState({ app: 'picknest', v: 1, data: { log: { e_1: { id: 'e_1', date: MON, title: '粥', kcal: 250, servings: 2, createdAt: 1, updatedAt: 20 } } } }));
  assert.deepEqual([merged(la, lb).data.log.e_1.kcal, merged(lb, la).data.log.e_1.servings], [250, 2]);
});

test('现在是哪一顿：凌晨和下午茶、夜宵是加餐', () => {
  const at = (h, m = 0) => mealAt(new Date(2026, 10, 26, h, m));
  assert.deepEqual([at(2), at(7), at(10, 29), at(10, 30), at(14, 29), at(15), at(18), at(21, 30)], ['snack', 'breakfast', 'breakfast', 'lunch', 'lunch', 'snack', 'dinner', 'snack']);
});

test('validateLogEntry：连着食谱没写名字的用食谱的名字；计划的 id 原样带着', () => {
  const s = fresh();
  const rid = saveRecipe(s, null, { name: '咖喱', servings: '4', ings: [] }, now()).id;
  const v = validateLogEntry(s, { date: MON, recipeId: rid, planId: 'p_1', per: { kcal: '400' } });
  assert.deepEqual([v.ok, v.clean.title, v.clean.recipeId, v.clean.planId, v.clean.servings], [true, '咖喱', rid, 'p_1', 1]);
});
