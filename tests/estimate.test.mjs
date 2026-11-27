// 自动估算（第 15 步）的规则：每样食材换成克（克、斤两、毫升按密度、个 / 根按表里的重量）、适量 / 少许和可选的不算（列出来）、认不出的列出来，
// 自己的说法（foods 里 kind 'ingredient'：指定成表里的哪一样、自己填的每 100 g、一个多重）比表优先，按人数换算，四舍五入在最后；
// 手动填的每人份为准（recipeNutrition）、「用手动的」、记饮食时用估算的（estimated，记的时候抄下来）；搜营养表、繁体界面的表名。全是编的数据
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blankState, ensureSeeds } from '../src/core/store.js';
import { saveRecipe, parseIngredients } from '../src/core/recipes.js';
import { addEntry } from '../src/core/plan.js';
import { addLogEntry, logFromPlan, logFromRecipe, logOn } from '../src/core/log.js';
import { foodId, liveFood, rememberFood, foodOf, foodSuggestions } from '../src/core/foods.js';
import { findFood, searchTable, nameHead, unitKey, asksWeight, isWeightUnit, foodAlias, TW_NAMES } from '../src/core/nutrition.js';
import { NUTRITION } from '../src/data/nutrition.js';
import { toTraditional } from '../src/core/hanzi.js';
import {
  estimateRecipe, recipeNutrition, ingredientFood, resolveIngredient, saveIngredientFood, ingredientRecord, clearIngredientFood, validateIngredientInput, useEstimate,
  usableEstimate,
} from '../src/core/estimate.js';

const fresh = () => ensureSeeds(blankState());
let clock = 1_000_000;
const now = () => (clock += 1000);
const food = (n) => /** @type {any} */ (findFood(n));
const ing = (name, qty = null, unit = '', extra = {}) => ({ key: 'g_' + name + unit, name, qty, unit, note: '', optional: false, ...extra });
const r1 = (x) => Math.round(x * 10) / 10;
const line = (est, name) => est.lines.find(l => l.name === name);

test('换成克：克、斤两、台斤、个（没写单位也是个）、勺、毫升按密度、碗、一块西瓜；表里没有密度的体积按 1 g/ml 猜；按体积量没意义的换算不了', () => {
  const s = fresh();
  const est = estimateRecipe(s, { servings: 1, ings: [
    ing('五花肉', 500, 'g'), ing('土豆', 0.5, '斤'), ing('鸡腿肉', 1, '台斤'), ing('鸡蛋', 3), ing('生抽', 2, '勺'), ing('牛奶', 250, 'ml'), ing('米饭', 1, '碗'),
    ing('西瓜', 1, '块'), ing('肥膘', 1, '杯'), ing('紫菜', 1, '杯'), ing('清水', 1, 'L'),
  ] });
  const g = (n) => line(est, n).grams;
  assert.deepEqual([g('五花肉'), g('土豆'), g('鸡腿肉'), g('鸡蛋'), g('生抽')], [500, 250, 600, 3 * food('鸡蛋').grams.个, 2 * food('生抽').grams.勺]);
  assert.equal(g('牛奶'), r1(250 * food('牛奶').density), '毫升按密度');
  assert.equal(g('米饭'), r1(250 * food('米饭').density), '一碗 250 ml');
  assert.equal(g('西瓜'), food('西瓜').grams.块, '一块西瓜是切下来的一块，不是一整个');
  assert.deepEqual([g('肥膘'), line(est, '肥膘').guess], [240, true], '不知道密度：按 1 g/ml 猜，标出来');
  assert.equal(est.guess, true);
  assert.deepEqual([line(est, '紫菜').status, line(est, '紫菜').reason], ['unknown-unit', 'weight'], '紫菜按体积量没有意义');
  assert.deepEqual([line(est, '清水').status, line(est, '清水').nutrition.kcal], ['ok', 0], '水认得（0 千卡），不列成没算进去');
  // 每一样算进去的营养 = 每 100 g × 克 ÷ 100
  assert.equal(line(est, '五花肉').nutrition.kcal, food('五花肉').per100.kcal * 5);
  assert.equal(line(est, '五花肉').source, 'table');
});

test('算不了的列出来：适量 / 少许（没写数量）、表里没有、不知道一个多重、认不出单位；可选的不算、另外列；名字空的不管', () => {
  const s = fresh();
  const est = estimateRecipe(s, { servings: 2, ings: [
    ing('五花肉', 500, 'g'), ing('油'), ing('盐', null, '少许'), ing('鱼豆腐', 200, 'g'), ing('鸡腿', 2, '个'), ing('牛奶', 1, '盒'), ing('香菜', 1, '把', { optional: true }),
    ing('  ', 3, '个'),
  ] });
  assert.deepEqual(est.missing.map(l => [l.name, l.status, l.reason]), [['油', 'vague', null], ['盐', 'vague', null], ['鱼豆腐', 'unknown-food', null],
    ['鸡腿', 'unknown-unit', 'weight'], ['牛奶', 'unknown-unit', 'unit']]);
  assert.deepEqual(est.optional.map(l => [l.name, l.status]), [['香菜', 'optional']]);
  assert.equal(est.lines.length, 7, '名字空的那一行不算');
  assert.equal(est.counted, 1);
  assert.equal(line(est, '油').food, food('油'), '没写用量的也认得是什么（明细里写着）');
  assert.equal(line(est, '鱼豆腐').food, null);
  assert.deepEqual(est.perServing, { kcal: Math.round(food('五花肉').per100.kcal * 5 / 2), protein: r1(food('五花肉').per100.protein * 5 / 2), carbs: 0, fat: r1(food('五花肉').per100.fat * 5 / 2) });
  // 一样也算不进去：每人份都是 null（算不出来，不是 0 千卡）
  const none = estimateRecipe(s, { servings: 2, ings: [ing('鱼豆腐', 200, 'g'), ing('油')] });
  assert.deepEqual([none.counted, none.perServing.kcal, none.total.kcal], [0, null, null]);
  assert.equal(recipeNutrition(s, { servings: 2, ings: [ing('鱼豆腐', 200, 'g')], nutrition: null }), null);
});

test('按人数换算：每人份不变，合计按人数；没写几人份的一整道当一份；四舍五入在最后（不是每样先四舍五入再加）', () => {
  const s = fresh();
  const r = { servings: 2, ings: [ing('五花肉', 500, 'g'), ing('鸡蛋', 3)] };
  const two = estimateRecipe(s, r), four = estimateRecipe(s, r, { servings: 4 });
  assert.deepEqual(four.perServing, two.perServing);
  assert.equal(four.servings, 4);
  assert.equal(four.total.kcal, Math.round((food('五花肉').per100.kcal * 5 + food('鸡蛋').per100.kcal * 1.5) * 2));
  assert.equal(line(four, '鸡蛋').qty, 6, '用量跟着换算');
  const whole = estimateRecipe(s, { servings: null, ings: r.ings });
  assert.deepEqual([whole.whole, whole.servings], [true, 1]);
  assert.deepEqual(whole.perServing, whole.total);
  // 三人份 100 g 五花肉：518 ÷ 3 = 172.67 → 173（合计 518）
  const three = estimateRecipe(s, { servings: 3, ings: [ing('五花肉', 100, 'g')] });
  assert.deepEqual([three.total.kcal, three.perServing.kcal, three.perServing.protein], [food('五花肉').per100.kcal, Math.round(food('五花肉').per100.kcal / 3), r1(food('五花肉').per100.protein / 3)]);
  // 两小勺生抽：每一样的脂肪四舍五入是 0，加起来是 0.1
  const soy = estimateRecipe(s, { servings: 1, ings: [ing('生抽', 1, '小勺'), { ...ing('生抽', 1, '小勺'), key: 'g_2' }] });
  assert.deepEqual(soy.lines.map(l => l.nutrition.fat), [0, 0]);
  assert.equal(soy.total.fat, r1(2 * food('生抽').grams.小勺 * food('生抽').per100.fat / 100));
  assert.ok(soy.total.fat > 0);
});

test('自己的说法比表优先：自己填的每 100 g > 指定成表里的 > 自动认的；自己填的一个多重比表里的优先；按逗号、括号前面那段记，所有食谱都认；用回自动认的', () => {
  const s = fresh();
  const r = { servings: 1, ings: [ing('鱼豆腐', 200, 'g'), ing('鸡腿', 2, '只'), ing('鸡蛋', 2), ing('五花肉', 100, 'g')] };
  // 指定成表里的豆腐（写的是「鱼豆腐（切块）」：记在「鱼豆腐」上）
  assert.equal(saveIngredientFood(s, '鱼豆腐（切块）', { ref: food('豆腐').id }, now()).ok, true);
  assert.equal(liveFood(s, foodId('鱼豆腐')).ref, String(food('豆腐').id));
  let est = estimateRecipe(s, r);
  assert.deepEqual([line(est, '鱼豆腐').status, line(est, '鱼豆腐').source, line(est, '鱼豆腐').food], ['ok', 'manual', food('豆腐')]);
  assert.equal(line(est, '鱼豆腐').nutrition.kcal, food('豆腐').per100.kcal * 2);
  assert.equal(ingredientFood(s, '鱼豆腐, 炸过的'), ingredientFood(s, '鱼豆腐'), '「鱼豆腐, 炸过的」也是它');
  // 自己填每 100 g：比指定的优先；没填的那一样照指定的豆腐（「自己填」的格子里淡淡写着的就是它）
  saveIngredientFood(s, '鱼豆腐', { per: { kcal: '200', protein: '12', carbs: '', fat: '10' } }, now());
  est = estimateRecipe(s, r);
  assert.deepEqual([line(est, '鱼豆腐').source, line(est, '鱼豆腐').nutrition, line(est, '鱼豆腐').gaps],
    ['mine', { kcal: 400, protein: 24, carbs: r1(food('豆腐').per100.carbs * 2), fat: 20 }, []]);
  // 再指定一次：自己填的每 100 g 清掉（指定就是按表里那一样算）
  saveIngredientFood(s, '鱼豆腐', { ref: String(food('豆腐').id) }, now());
  assert.equal(line(estimateRecipe(s, r), '鱼豆腐').source, 'manual');
  // 自己填一个多重：「只」记在「个」上，营养照表里的
  saveIngredientFood(s, '鸡腿', { grams: '150', unit: '只' }, now());
  assert.deepEqual(liveFood(s, foodId('鸡腿')).grams, { 个: 150 });
  est = estimateRecipe(s, r);
  assert.deepEqual([line(est, '鸡腿').status, line(est, '鸡腿').grams, line(est, '鸡腿').source], ['ok', 300, 'table']);
  // 表里有一个多重的也是自己的优先；指定成别的一样（鸡蛋 → 鸭蛋）
  saveIngredientFood(s, '鸡蛋', { ref: food('鸭蛋').id, grams: '60', unit: '' }, now());
  est = estimateRecipe(s, r);
  assert.deepEqual([line(est, '鸡蛋').food, line(est, '鸡蛋').grams, line(est, '鸡蛋').source], [food('鸭蛋'), 120, 'manual']);
  // 一个多重写空的 = 不要了，回到表里的（鸭蛋一个 70 g）
  saveIngredientFood(s, '鸡蛋', { grams: '', unit: '个' }, now());
  assert.equal(line(estimateRecipe(s, r), '鸡蛋').grams, 2 * food('鸭蛋').grams.个);
  // 表里有的也能自己填每 100 g
  saveIngredientFood(s, '五花肉', { per: { kcal: '400', protein: '15', carbs: '0', fat: '38' } }, now());
  assert.equal(line(estimateRecipe(s, r), '五花肉').nutrition.kcal, 400);
  // 用回自动认的：软删除那一条（撤销靠提示条）；以后再填从空的开始，还是这一条（createdAt 照旧：合并时整条取较新的）
  const born = liveFood(s, foodId('五花肉')).createdAt;
  const was = clearIngredientFood(s, '五花肉', now());
  assert.equal(was.name, '五花肉');
  assert.equal(s.data.foods[foodId('五花肉')].deleted, true);
  assert.equal(line(estimateRecipe(s, r), '五花肉').source, 'table');
  assert.equal(clearIngredientFood(s, '五花肉', now()), null);
  saveIngredientFood(s, '五花肉', { grams: '20', unit: '片' }, now());
  const again = liveFood(s, foodId('五花肉'));
  assert.deepEqual([again.createdAt, again.per.kcal, again.grams, again.deleted], [born, null, { 片: 20 }, undefined]);
  assert.equal(line(estimateRecipe(s, r), '五花肉').source, 'table');
  // 指定的那一样表里没有了（以后的版本）：照自动认的算
  s.data.foods[foodId('鸡蛋')].ref = '999999999';
  assert.deepEqual([line(estimateRecipe(s, r), '鸡蛋').food, line(estimateRecipe(s, r), '鸡蛋').source], [food('鸡蛋'), 'table']);
  // 常吃的（kind 'food'：每份的营养）同名的不当成食材的说法
  rememberFood(s, '番茄', { kcal: 30 }, { use: true }, now());
  assert.equal(ingredientFood(s, '番茄'), null);
  assert.equal(resolveIngredient(s, '番茄').source, 'table');
});

test('自己填的检查：每 100 g 最多 900 千卡、每样 100 g，一个多重 0–10000 g；表里没有、也没指定、没填营养的存不了；有错什么也不改', () => {
  const s = fresh();
  assert.deepEqual(validateIngredientInput({ per: { kcal: '901', protein: '101', carbs: '-1', fat: 'x' }, grams: '0' }).errors,
    { kcal: 'est.err.kcal100', protein: 'est.err.gram100', carbs: 'log.err.num', fat: 'log.err.num', grams: 'est.err.grams' });
  assert.deepEqual(validateIngredientInput({ per: { kcal: '884', protein: '', carbs: '1/2', fat: '100' }, grams: '0.5' }),
    { ok: true, per: { kcal: 884, protein: null, carbs: 0.5, fat: 100 }, grams: 0.5, errors: {} });
  assert.deepEqual(saveIngredientFood(s, '鱼豆腐', { grams: '20', unit: '个' }, now()), { ok: false, errors: { kcal: 'est.err.needPer' } }, '表里没有：只填一个多重算不出来');
  assert.deepEqual(saveIngredientFood(s, '鱼豆腐', { ref: 'nope' }, now()), { ok: false, errors: { ref: 'est.err.ref' } });
  assert.deepEqual(saveIngredientFood(s, ' ', { per: { kcal: '1' } }, now()), { ok: false, errors: { name: 'est.err.name' } });
  assert.equal(Object.keys(s.data.foods).length, 0, '有错什么也不改');
  assert.equal(ingredientRecord(s, '鱼豆腐', { per: { kcal: '150' } }, now()).ok, true, '面板先查一遍（不改数据）');
  assert.equal(Object.keys(s.data.foods).length, 0);
  const a = saveIngredientFood(s, '鱼豆腐', { per: { kcal: '150' } }, 5000);
  assert.ok(a.ok);
  const at = liveFood(s, foodId('鱼豆腐')).updatedAt;
  saveIngredientFood(s, '鱼豆腐', { per: { kcal: '150' } }, now());
  assert.equal(liveFood(s, foodId('鱼豆腐')).updatedAt, at, '一样的数再存一遍不盖新时间');
  saveIngredientFood(s, '魚豆腐', { per: { kcal: '160' } }, now());
  assert.deepEqual([liveFood(s, foodId('鱼豆腐')).createdAt, liveFood(s, foodId('鱼豆腐')).name, liveFood(s, foodId('鱼豆腐')).per.kcal], [5000, '魚豆腐', 160],
    '改的时候保留 createdAt（繁体是同一条，名字用这次的写法）');
});

test('同名的是常吃的（每份）：存成食材的以后，记饮食时不再联想它、也不再记进它；过去记的不变', () => {
  const s = fresh();
  const e = addLogEntry(s, { date: '2026-11-23', title: '豆浆', per: { kcal: '120' } }, now());
  assert.equal(foodOf(s, '豆浆').per.kcal, 120);
  const created = liveFood(s, foodId('豆浆')).createdAt;
  assert.ok(saveIngredientFood(s, '豆浆', { per: { kcal: '31', protein: '3' } }, now()).ok);
  const f = liveFood(s, foodId('豆浆'));
  assert.deepEqual([f.kind, f.perUnit, f.per.kcal, f.createdAt], ['ingredient', '100g', 31, created]);
  assert.equal(foodOf(s, '豆浆'), null);
  assert.deepEqual(foodSuggestions(s, '豆'), []);
  const again = addLogEntry(s, { date: '2026-11-24', title: '豆浆', per: { kcal: '150' } }, now());
  assert.equal(again.entry.foodId, null, '不记进食材的那一条（每 100 g 的数不能混进每份的）');
  assert.equal(liveFood(s, foodId('豆浆')).per.kcal, 31);
  assert.equal(logOn(s, '2026-11-23')[0].kcal, 120, '过去记的是抄下来的');
  assert.equal(e.entry.kcal, 120);
});

test('手动填的每人份为准；没填的用估算（recipeNutrition）；「用手动的」把估算抄过去（填了的不改）', () => {
  const s = fresh();
  const hsr = saveRecipe(s, null, { name: '红烧肉', servings: '2', ings: [{ name: '五花肉', qty: '500', unit: 'g' }] }, now()).recipe;
  const est = estimateRecipe(s, hsr);
  assert.deepEqual(recipeNutrition(s, hsr), { per: est.perServing, estimated: true, estimate: est });
  const manual = saveRecipe(s, null, { name: '燕麦粥', servings: '1', ings: [{ name: '燕麦', qty: '50', unit: 'g' }], nutrition: { kcal: '330' } }, now()).recipe;
  assert.deepEqual(recipeNutrition(s, manual), { per: { kcal: 330, protein: null, carbs: null, fat: null }, estimated: false, estimate: null });
  assert.equal(useEstimate(s, manual.id, now()), false, '手动填了的不改');
  assert.equal(useEstimate(s, hsr.id, now()), true);
  assert.deepEqual(s.data.recipes[hsr.id].nutrition, est.perServing);
  assert.equal(recipeNutrition(s, s.data.recipes[hsr.id]).estimated, false);
  const empty = saveRecipe(s, null, { name: '鱼豆腐汤', servings: '2', ings: [{ name: '鱼豆腐', qty: '200', unit: 'g' }] }, now()).id;
  assert.equal(useEstimate(s, empty, now()), false, '估算不出来的不抄');
  assert.equal(s.data.recipes[empty].nutrition, null);
});

test('估算拿去用之前先查（usableEstimate）：只算进去水和盐、又有没算进去的不是 0 千卡；没写几人份的一整锅超过一份的上限不填；一整道不抄成每人份', () => {
  const s = fresh();
  // 麻辣烫：底料、鱼豆腐认不出，只剩水和盐（0 千卡）→ 算不出来
  const soup = saveRecipe(s, null, { name: '麻辣烫', servings: '2', ings: [{ name: '火锅底料', qty: '1', unit: '包' }, { name: '水', qty: '1', unit: 'L' },
    { name: '鱼豆腐', qty: '200', unit: 'g' }, { name: '盐', qty: '1', unit: '小勺' }] }, now()).recipe;
  const se = estimateRecipe(s, soup);
  assert.deepEqual([se.counted, se.missing.length, se.blank, se.perServing.kcal, usableEstimate(se)], [2, 2, true, 0, false]);
  assert.equal(recipeNutrition(s, soup), null);
  assert.deepEqual([logFromRecipe(s, soup.id).per, logFromRecipe(s, soup.id).estimated], [null, false], '不填 0 千卡');
  assert.equal(useEstimate(s, soup.id, now()), false);
  // 都算进去了、本来就是 0 千卡的（淡盐水）：是真的 0
  const brine = estimateRecipe(s, { servings: 1, ings: [ing('水', 500, 'ml'), ing('盐', 1, '小勺')] });
  assert.deepEqual([brine.blank, usableEstimate(brine), brine.perServing.kcal], [false, true, 0]);
  // 没写几人份的一整锅卤肉：一万多千卡，超过一份能写的（9999 千卡、999 g）→ 不填、不抄
  const pot = saveRecipe(s, null, { name: '卤肉', ings: [{ name: '五花肉', qty: '2', unit: 'kg' }, { name: '冰糖', qty: '50', unit: 'g' }] }, now()).recipe;
  const pe = estimateRecipe(s, pot);
  assert.deepEqual([pe.whole, pe.perServing.kcal > 9999, pe.perServing.fat > 999, usableEstimate(pe)], [true, true, true, false]);
  assert.equal(recipeNutrition(s, pot), null);
  assert.equal(useEstimate(s, pot.id, now()), false);
  assert.equal(s.data.recipes[pot.id].nutrition, null, '抄过去的话以后改个名字都存不了');
  // 没写几人份、没超过的：记饮食时照样带上一整道（一整道当一份，面板上说一句），但不抄成手动的每人份（以后写上 4 人份就错了）
  const bowl = saveRecipe(s, null, { name: '燕麦碗', ings: [{ name: '燕麦', qty: '50', unit: 'g' }, { name: '鸡腿', qty: '1', unit: '个' }] }, now()).recipe;
  const be = estimateRecipe(s, bowl);
  assert.equal(usableEstimate(be), true);
  assert.deepEqual(logFromRecipe(s, bowl.id), { title: '燕麦碗', recipeId: bowl.id, servings: 1, per: be.perServing, estimated: true, estNote: { missing: ['鸡腿'], whole: true } });
  assert.equal(useEstimate(s, bowl.id, now()), false);
  assert.equal(s.data.recipes[bowl.id].nutrition, null);
});

test('自己填只填了几样：表里有的（自动认的、指定的）没填的照表里的；表里没有的那几样没有数（gaps），合计里少了它的', () => {
  const s = fresh();
  saveIngredientFood(s, '五花肉', { per: { kcal: '450', protein: '', carbs: '', fat: '' } }, now());
  const r = { servings: 1, ings: [ing('五花肉', 100, 'g'), ing('鸡蛋', 2)] };
  const l = line(estimateRecipe(s, r), '五花肉');
  assert.deepEqual([l.source, l.nutrition, l.gaps], ['mine', { kcal: 450, protein: food('五花肉').per100.protein, carbs: 0, fat: food('五花肉').per100.fat }, []]);
  // 表里没有的：只填了热量，另外三样没有数
  saveIngredientFood(s, '鱼豆腐', { per: { kcal: '150' } }, now());
  const est = estimateRecipe(s, { servings: 1, ings: [ing('鱼豆腐', 200, 'g'), ing('鸡蛋', 2)] });
  const f = line(est, '鱼豆腐');
  assert.deepEqual([f.status, f.nutrition, f.gaps], ['ok', { kcal: 300, protein: null, carbs: null, fat: null }, ['protein', 'carbs', 'fat']]);
  assert.equal(est.perServing.protein, r1(food('鸡蛋').per100.protein * food('鸡蛋').grams.个 * 2 / 100), '蛋白质只有鸡蛋的');
  assert.deepEqual(line(est, '鸡蛋').gaps, []);
});

test('记饮食：没填每人份的食谱用估算的（estimated，记的时候抄下来）；没改过的不记到食谱上；以后指定了食材，记过的不变', () => {
  const s = fresh();
  const rid = saveRecipe(s, null, { name: '鱼豆腐炖肉', servings: '2', ings: [{ name: '五花肉', qty: '500', unit: 'g' }, { name: '鱼豆腐', qty: '200', unit: 'g' }] }, now()).id;
  const pid = addEntry(s, { date: '2026-11-23', meal: 'dinner', recipeId: rid, servings: '4' }, now()).id;
  const per = estimateRecipe(s, s.data.recipes[rid]).perServing;
  assert.deepEqual([logFromPlan(s, pid).per, logFromPlan(s, pid).estimated], [per, true], '计划的人数是做几人份，吃的是一份：每人份照食谱的');
  assert.deepEqual([logFromRecipe(s, rid).per, logFromRecipe(s, rid).estimated], [per, true]);
  const a = addLogEntry(s, { ...logFromPlan(s, pid), saveToRecipe: true }, now());
  assert.deepEqual([a.entry.kcal, a.entry.estimated], [per.kcal, true]);
  assert.equal(s.data.recipes[rid].nutrition, null, '估算的、没改过的不抄成手动的');
  // 改过的数是自己填的：estimated false，也记到食谱上
  const b = addLogEntry(s, { ...logFromPlan(s, pid), per: { ...per, kcal: '900' }, estimated: false, saveToRecipe: true }, now());
  assert.deepEqual([b.entry.kcal, b.entry.estimated, s.data.recipes[rid].nutrition.kcal], [900, false, 900]);
  // estimated 但一个数也没有的不标
  assert.equal(addLogEntry(s, { date: '2026-11-23', title: 'x', recipeId: rid, per: null, estimated: true }, now()).entry.estimated, false);
  // 以后指定了鱼豆腐：记过的是抄下来的，不变
  saveIngredientFood(s, '鱼豆腐', { ref: food('豆腐').id }, now());
  assert.equal(s.data.log[a.id].kcal, per.kcal);
});

test('营养表的搜索（指定成…）：一样的在前，再是开头对上的、包含的（短的在前），最后是搜的字里包含的；英文按整个词；简繁都行', () => {
  const names = (q) => searchTable(q).map(x => x.food.zh[0]);
  assert.equal(names('豆腐')[0], '豆腐');
  assert.ok(names('豆腐').includes('嫩豆腐'));
  assert.deepEqual(names('鱼豆腐'), ['豆腐'], '鱼豆腐里有「豆腐」');
  assert.equal(names('雞蛋')[0], '鸡蛋', '繁体也认');
  assert.equal(searchTable('rice')[0].food.en[0], 'rice');
  assert.ok(!searchTable('rice').some(x => x.food.en.includes('ice')), '「ice」不算在「rice」里');
  assert.deepEqual(searchTable('  '), []);
  assert.equal(searchTable('豆', { limit: 3 }).length, 3);
  assert.equal(new Set(searchTable('鸡').map(x => x.food.id)).size, searchTable('鸡').length, '每样只出一次');
});

test('记在哪个名字、哪个单位上；要不要问一个多重；繁体界面的表名（只换写法，异体字不换）', () => {
  assert.deepEqual(['鱼豆腐（切块）', '鱼豆腐, 切块', '(可选) 香菜', ' 鸡蛋 ', '鸡蛋/鸭蛋'].map(nameHead), ['鱼豆腐', '鱼豆腐', '(可选) 香菜', '鸡蛋', '鸡蛋']);
  assert.deepEqual(['', '只', '颗', 'clove', '条', '盒', '勺', 'Tbsp.'].map(unitKey), ['个', '个', '个', '瓣', '条', '盒', '勺', '勺']);
  assert.deepEqual(['', '个', '勺', '杯', '盒', 'g', '斤', 'ml', '升'].map(asksWeight), [true, true, true, true, true, false, false, false, false]);
  assert.deepEqual(['g', '斤', 'ml', '个'].map(isWeightUnit), [true, true, false, false]);
  assert.deepEqual(['鸡蛋', '豆腐', '面粉', '干香菇', '猪肉馅', '红豆', '苹果', '酸奶', '芝麻酱', '松子', '姜'].map(toTraditional),
    ['雞蛋', '豆腐', '麵粉', '乾香菇', '豬肉餡', '紅豆', '蘋果', '酸奶', '芝麻醬', '松子', '薑']);
});

test('表里的一样叫什么（foodAlias）：写的名字对上的那个别名，不是第一个名字；对不上的繁体先用台湾的说法；英文用英文名', () => {
  const potato = food('土豆');
  assert.equal(foodAlias(potato, '马铃薯'), '马铃薯');
  assert.equal(foodAlias(potato, '馬鈴薯 2 顆'.split(' ')[0], { tw: true }), '马铃薯', '繁体写的也对得上');
  assert.equal(foodAlias(potato, '土豆丝（切细）'), '土豆丝');
  assert.equal(foodAlias(food('鲅鱼'), '鲅鱼'), '鲅鱼', '鲅鱼不写成同一条的「带鱼」');
  assert.equal(foodAlias(food('鸡腿肉丁'), '鸡腿肉丁'), '鸡腿肉', '包含的最长的那个');
  assert.equal(foodAlias(food('豆腐'), '鱼豆腐'), '豆腐', '指定成的：鱼豆腐里有「豆腐」');
  assert.deepEqual([foodAlias(potato, 'potatoes'), foodAlias(potato, 'potatoes', { tw: true })], ['土豆', '马铃薯'], '对不上：第一个名字，繁体先用台湾的');
  assert.deepEqual(['生抽', '酸奶', '奶酪', '三文鱼', '卷心菜', '菠萝', '红薯', '猕猴桃'].map(n => foodAlias(food(n), '', { tw: true })),
    ['酱油', '优格', '起司', '鲑鱼', '高丽菜', '凤梨', '地瓜', '奇异果']);
  assert.equal(foodAlias(food('番茄'), '', { tw: true }), '番茄', '没有台湾说法的用第一个名字');
  assert.deepEqual([foodAlias(potato, 'russet potatoes, diced', { en: true }), foodAlias(potato, '土豆', { en: true })], ['russet potatoes', 'potato']);
  // 台湾的说法每一个都是表里的名字，而且不是另一样的第一个名字（不会拿错）
  for (const n of TW_NAMES) {
    const owners = NUTRITION.filter(f => f.zh.includes(n));
    assert.equal(owners.length, 1, n);
    assert.notEqual(owners[0].zh[0], n, n + ' 已经是第一个名字');
  }
});

test('粘贴的食材直接估算（第 16 步检查）：英文写成整个词的重量、带点的缩写、「朵」都是单位，不当成几个；没认出的单位在名字里也不按几个算', () => {
  const s = fresh();
  const est = (/** @type {string} */ text, servings = 1) => estimateRecipe(s, { servings, ings: parseIngredients(text).map((g, i) => ({ key: 'g' + i, ...g })) });
  const one = (/** @type {string} */ text) => { const e = est(text); return [e.lines[0].name, e.lines[0].unit, e.lines[0].status, e.lines[0].grams]; };
  assert.deepEqual(one('2 pounds chicken thighs'), ['chicken thighs', 'pounds', 'ok', 907.2], '不是两只鸡腿 298 g');
  assert.deepEqual(one('3 ounces chicken breast'), ['chicken breast', 'ounces', 'ok', 85.1], '不是三块鸡胸 816 g');
  assert.deepEqual(one('500 grams chicken breast'), ['chicken breast', 'grams', 'ok', 500]);
  assert.deepEqual(one('1 kilogram potatoes'), ['potatoes', 'kilogram', 'ok', 1000]);
  assert.deepEqual(one('2 kilos potatoes'), ['potatoes', 'kilos', 'ok', 2000]);
  assert.deepEqual(one('1 pound ground beef'), ['ground beef', 'pound', 'ok', 453.6]);
  assert.deepEqual(one('8 ounces cream cheese'), ['cream cheese', 'ounces', 'ok', 226.8]);
  assert.deepEqual(one('200 grams flour'), ['flour', 'grams', 'ok', 200]);
  assert.deepEqual(one('1 liter coconut milk').slice(0, 3), ['coconut milk', 'liter', 'ok']);
  assert.deepEqual(one('4 fl oz heavy cream').slice(0, 3), ['heavy cream', 'fl oz', 'ok']);
  // 缩写后面的点
  assert.deepEqual(one('1 lb. pork shoulder'), ['pork shoulder', 'lb', 'ok', 453.6]);
  assert.deepEqual(one('2 Tbsp. olive oil'), ['olive oil', 'Tbsp', 'ok', 28]);
  assert.deepEqual(one('1 1/2 lbs. beef').slice(0, 3), ['beef', 'lbs', 'ok']);
  assert.deepEqual(one('olive oil 2 tbsp.').slice(0, 3), ['olive oil', 'tbsp', 'ok']);
  assert.deepEqual(parseIngredients('橄榄油 2 tbsp. 盐 1 tsp').map(g => [g.name, g.qty, g.unit]), [['橄榄油', 2, 'tbsp'], ['盐', 1, 'tsp']]);
  // 朵：花菜有自己的一朵 13 g，香菇没有「朵」按个；西兰花没有「朵」不退成一整颗
  assert.deepEqual(one('花菜 5朵'), ['花菜', '朵', 'ok', 65]);
  assert.deepEqual(one('香菇5朵'), ['香菇', '朵', 'ok', 95]);
  assert.deepEqual(one('5朵香菇'), ['香菇', '朵', 'ok', 95]);
  assert.deepEqual(one('西兰花 3朵').slice(0, 3), ['西兰花', '朵', 'unknown-unit']);
  assert.deepEqual(one('broccoli 2 florets').slice(0, 3), ['broccoli', 'florets', 'unknown-unit']);
  // 「2 pounds chicken thighs」4 人份：每人份按 907 g 鸡腿算
  assert.ok(est('2 pounds chicken thighs', 4).perServing.kcal > 1000 / 4);
  // 名字是重量、体积的词开头、没写单位（拆的时候没认出来）：换算不了，不按几个算；「large eggs」照样是几个
  const raw = (/** @type {string} */ name) => line(estimateRecipe(s, { servings: 1, ings: [ing(name, 2)] }), name);
  for (const n of ['pounds chicken thighs', 'fl oz heavy cream', 'Tbsp. olive oil', 'grams chicken breast']) assert.deepEqual([raw(n).status, raw(n).reason, raw(n).grams], ['unknown-unit', 'unit', null], n);
  assert.deepEqual([raw('large eggs').status, raw('large eggs').grams], ['ok', 100]);
  assert.deepEqual([raw('L 号鸡蛋').status, raw('L 号鸡蛋').grams], ['ok', 100], '有汉字的名字不看：L 号是大号');
});

test('一样营养素只有水、盐的 0、又有算进去却没有这一项的：是不知道（null），不是 0 g（第 16 步检查）', () => {
  const s = fresh();
  assert.ok(saveIngredientFood(s, '鱼豆腐', { per: { kcal: '200' }, grams: '15', unit: '个' }, now()).ok);
  const soup = { servings: 1, ings: parseIngredients('鱼豆腐 5个\n清水 500ml\n盐 1小勺').map((g, i) => ({ key: 'g' + i, ...g })) };
  const e = estimateRecipe(s, soup);
  assert.deepEqual(e.perServing, { kcal: 150, protein: null, carbs: null, fat: null });
  assert.deepEqual(e.total, { kcal: 150, protein: null, carbs: null, fat: null });
  assert.equal(e.blank, false);
  assert.equal(usableEstimate(e), true, '热量是知道的，照样能用');
  // 记饮食：蛋白质这几样是没填（合计里写着），不是 0
  const r = saveRecipe(s, null, { name: '鱼豆腐汤', ...soup }, now());
  const id = /** @type {any} */ (r).recipe.id;
  const d = /** @type {any} */ (logFromRecipe(s, id));
  assert.deepEqual([d.per, d.estimated], [{ kcal: 150, protein: null, carbs: null, fat: null }, true]);
  // 有一样真有蛋白质的：照样加起来（缺了鱼豆腐的那一份，明细里写着）
  const withEgg = { servings: 1, ings: [...soup.ings, ing('鸡蛋', 1)] };
  const e2 = estimateRecipe(s, withEgg);
  assert.ok(e2.perServing.protein > 0);
  // 只有水和盐的 0、没有缺的：照样是 0（知道的）
  assert.deepEqual(estimateRecipe(s, { servings: 1, ings: [ing('清水', 500, 'ml'), ing('盐', 1, '小勺')] }).perServing, { kcal: 0, protein: 0, carbs: 0, fat: 0 });
});
