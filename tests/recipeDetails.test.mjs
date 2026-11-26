// 第 11 步 食谱的细节（core/recipes.js、store.js 的整理）：标签（整理、加 / 去、编辑页列哪些、用到的、筛选）、食材的默认顺序（归组、稳定排序、
// 新加的放进它那一组的最后、保存时放）、重复的食材（找出来、合并的规则）、食材替换（找、先看、换、常备品跟着换、撤销）。全是编的数据
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureSeeds, blankState, normalizeRecord, normalizeState, mergeStates, canon, deletedRecord, normalizeTags, itemId } from '../src/core/store.js';
import { saveRecipe, searchRecipes, addTag, removeTag, hasTag, usedTags, tagChoices, matchesTags, recipeTags, RECIPE_TAG_PRESETS,
  ingredientGroup, sortIngredients, placeIngredients, ING_GROUPS, duplicateOf, mergeIngredient,
  ingredientNames, replacePreview, replaceIngredient, replaceDuplicates, liveRecipe } from '../src/core/recipes.js';
import fs from 'node:fs';
import path from 'node:path';
import { addFromInput, editItem } from '../src/core/items.js';
import { setStaple, isStaple, memoryId } from '../src/core/memory.js';
import * as state from '../src/core/state.js';
import { STRINGS } from '../src/strings/recipes.js';

const T0 = 1_700_000_000_000;
let clock = T0;
const now = () => (clock += 1000);
const seeded = () => ensureSeeds(blankState());
const recipe = (s, id, fields) => (s.data.recipes[id] = normalizeRecord('recipes', { id, updatedAt: T0, createdAt: T0, ...fields }));
const names = (ings) => ings.map(g => g.name);
let seq = 0;
const ing = (name, extra = {}) => ({ key: 'k' + (++seq), name, qty: null, unit: '', note: '', optional: false, ...extra });

// ---------- 标签 ----------
test('整理标签：没有就是两个空数组；不是字符串、空白的扔掉，同一组里 normName 一样的留第一个（简繁一样）；字原样；别的组原样留着；可重复整理', () => {
  const r = normalizeRecord('recipes', { id: 'r_1', name: '红烧肉', updatedAt: 1 });
  assert.deepEqual(r.tags, { cuisine: [], style: [] });
  const t = normalizeTags({ cuisine: ['川菜', ' 川菜 ', '粵菜', '粤菜', 3, '', '  ', null], style: 'nope', diet: ['低碳'] });
  assert.deepEqual(t, { cuisine: ['川菜', '粵菜'], style: [], diet: ['低碳'] });
  const r2 = normalizeRecord('recipes', { id: 'r_2', tags: t, updatedAt: 1 });
  assert.equal(canon(normalizeRecord('recipes', r2)), canon(r2));
  assert.deepEqual(normalizeTags(['川菜']), { cuisine: [], style: [] }, '数组不是标签');
});

test('整理食谱的 ordered：只有 true 留着，别的去掉（以前的食谱上没有这个键）', () => {
  assert.equal(normalizeRecord('recipes', { id: 'r_1', ordered: true, updatedAt: 1 }).ordered, true);
  for (const v of [false, 'true', 1, null]) assert.equal('ordered' in normalizeRecord('recipes', { id: 'r_1', ordered: v, updatedAt: 1 }), false, String(v));
  assert.equal('ordered' in normalizeRecord('recipes', { id: 'r_1', updatedAt: 1 }), false);
});

test('加 / 去标签：去掉前后空白，空的报错；normName 一样的不重复加（简繁）；去掉按 normName；不认识的组不动', () => {
  let t = { cuisine: ['川菜'], style: [] };
  assert.deepEqual(addTag(t, 'cuisine', '  '), { ok: false, error: 'rcp.err.tag' });
  assert.deepEqual(addTag(t, 'nope', '川菜'), { ok: false, error: 'rcp.err.tag' });
  t = /** @type {any} */ (addTag(t, 'style', ' 快手 ')).tags;
  assert.deepEqual(t, { cuisine: ['川菜'], style: ['快手'] });
  assert.deepEqual(/** @type {any} */ (addTag(t, 'cuisine', '川菜')).tags.cuisine, ['川菜']);
  assert.ok(hasTag(t, 'style', '快手') && !hasTag(t, 'cuisine', '快手') && !hasTag(t, 'style', ''));
  assert.deepEqual(removeTag({ cuisine: ['粵菜', '川菜'], style: [] }, 'cuisine', '粤菜'), { cuisine: ['川菜'], style: [] });
  assert.deepEqual(removeTag({ cuisine: ['川菜'], style: [] }, 'nope', '川菜').cuisine, ['川菜']);
});

test('预设标签：每个都有三种语言的文案（rcp.tag.<组>.<键>），同一组里不重名', () => {
  for (const [g, keys] of Object.entries(RECIPE_TAG_PRESETS)) {
    for (const lang of Object.keys(STRINGS)) {
      const shown = keys.map(k => STRINGS[lang][`rcp.tag.${g}.${k}`]);
      assert.ok(shown.every(x => typeof x === 'string' && x), `${lang} ${g}`);
      assert.equal(new Set(shown).size, shown.length, `${lang} ${g} 不重名`);
    }
  }
  assert.ok(RECIPE_TAG_PRESETS.cuisine.length >= 10 && RECIPE_TAG_PRESETS.style.length >= 10);
});

test('用到的标签：没删除的食谱里的，normName 一样算一个（写法用最多的），按用得多的、名字排；编辑页列的是预设 → 别的食谱用过的 → 自己刚加的', () => {
  const s = seeded();
  recipe(s, 'r_a', { name: 'a', tags: { cuisine: ['川菜'], style: ['快手', '下饭'] } });
  recipe(s, 'r_b', { name: 'b', tags: { cuisine: ['川菜', '湘菜'], style: ['下饭'] } });
  recipe(s, 'r_c', { name: 'c', tags: { cuisine: ['川菜'], style: [] } });
  recipe(s, 'r_d', { name: 'd', tags: { cuisine: ['粵菜'], style: ['快手'] } });
  s.data.recipes.r_d = deletedRecord(s.data.recipes.r_d, T0 + 1);
  const u = usedTags(s);
  assert.deepEqual(u.cuisine, [{ name: '川菜', n: 3 }, { name: '湘菜', n: 1 }]);
  assert.deepEqual(u.style, [{ name: '下饭', n: 2 }, { name: '快手', n: 1 }]);
  recipe(s, 'r_e', { name: 'e', tags: { cuisine: ['湘菜'], style: [] } });
  recipe(s, 'r_f', { name: 'f', tags: { cuisine: ['湘菜'], style: [] } });
  recipe(s, 'r_g', { name: 'g', tags: { cuisine: ['湘菜'], style: [] } });
  assert.deepEqual(usedTags(s).cuisine.map(x => x.name), ['湘菜', '川菜'], '用得多的在前');
  assert.deepEqual(tagChoices(s, 'cuisine', ['川菜', '粤菜'], ['云南菜', '川菜']), ['川菜', '粤菜', '湘菜', '云南菜']);
  assert.deepEqual(tagChoices(s, 'style', [], []), ['下饭', '快手']);
});

test('按标签筛选：一组里选几个是「任一」，两组之间是「都要」；一组没选不管；简繁一样；和搜索词一起；搜索也搜标签', () => {
  const s = seeded();
  recipe(s, 'r_a', { name: '水煮鱼', tags: { cuisine: ['川菜'], style: ['下饭'] } });
  recipe(s, 'r_b', { name: '剁椒鱼头', tags: { cuisine: ['湘菜'], style: ['宴客'] } });
  recipe(s, 'r_c', { name: '番茄炒蛋', tags: { cuisine: ['家常中餐'], style: ['快手', '下饭'] } });
  recipe(s, 'r_d', { name: '老菜', ings: [{ key: 'g_1', name: '鱼' }] });
  const ids = (sel, q = '') => searchRecipes(s, q, undefined, { tags: sel }).map(x => x.recipe.id).sort();
  assert.deepEqual(ids({ cuisine: ['川菜', '湘菜'] }), ['r_a', 'r_b']);
  assert.deepEqual(ids({ cuisine: ['川菜', '湘菜'], style: ['下饭'] }), ['r_a']);
  assert.deepEqual(ids({ style: ['下飯'] }), ['r_a', 'r_c'], '简繁一样');
  assert.deepEqual(ids({ cuisine: [], style: [] }), ['r_a', 'r_b', 'r_c', 'r_d']);
  assert.deepEqual(ids({ style: ['下饭'] }, '鱼'), ['r_a']);
  assert.deepEqual(ids(null, '湘菜'), ['r_b'], '搜索词也搜标签');
  assert.ok(matchesTags(s.data.recipes.r_d, {}) && !matchesTags(s.data.recipes.r_d, { cuisine: ['川菜'] }), '没标签的旧食谱只在没筛的时候列');
  assert.deepEqual(recipeTags({ tags: null }), { cuisine: [], style: [] });
});

test('保存食谱：给了 tags 就存整理过的，没给的照原来的（别的地方调 saveRecipe 不会冲掉标签）；ordered 也一样', () => {
  const s = seeded();
  const r = saveRecipe(s, null, { name: '水煮鱼', tags: { cuisine: ['川菜', '川菜'], style: [' 下饭'] }, ordered: true }, now());
  assert.ok(r.ok);
  const rec = s.data.recipes[r.id];
  assert.deepEqual(rec.tags, { cuisine: ['川菜'], style: [' 下饭'] });
  assert.equal(rec.ordered, true);
  saveRecipe(s, r.id, { name: '水煮鱼片' }, now());
  assert.deepEqual([s.data.recipes[r.id].tags.cuisine, s.data.recipes[r.id].ordered], [['川菜'], true], '没给的不动');
  saveRecipe(s, r.id, { name: '水煮鱼片', tags: { cuisine: [] }, ordered: false }, now());
  assert.deepEqual(s.data.recipes[r.id].tags, { cuisine: [], style: [] });
  assert.equal('ordered' in s.data.recipes[r.id], false, '「按类别重新排」以后去掉');
});

test('合并：标签、ordered 跟着整条（取较新的），顺序无关、再合并一样', () => {
  const a = normalizeState({ data: { recipes: { r_1: { id: 'r_1', name: 'x', tags: { cuisine: ['川菜'] }, ordered: true, createdAt: 1, updatedAt: 10 } } } });
  const b = normalizeState({ data: { recipes: { r_1: { id: 'r_1', name: 'x', tags: { style: ['快手'] }, createdAt: 1, updatedAt: 20 } } } });
  const m = mergeStates(a, b);
  assert.deepEqual([m.data.recipes.r_1.tags, 'ordered' in m.data.recipes.r_1], [{ cuisine: [], style: ['快手'] }, false]);
  assert.equal(canon(mergeStates(b, a)), canon(m));
  assert.equal(canon(mergeStates(m, a)), canon(m));
});

// ---------- 食材的默认顺序 ----------
test('食材归组：对照表（和清单的分类同一张）、豆制品在蛋奶一组、做菜常见的、名字的结尾 / 开头；清单上自己选过的分类优先；猜不出的是其他', () => {
  const s = seeded();
  const table = [
    ['五花肉', 'meat'], ['排骨', 'meat'], ['虾仁', 'meat'], ['牛腩', 'meat'], ['鲫鱼', 'meat'], ['鸡爪', 'meat'], ['chicken breast', 'meat'],
    ['洋葱', 'produce'], ['西红柿', 'produce'], ['葱花', 'produce'], ['姜片', 'produce'], ['蒜末', 'produce'], ['小米辣', 'produce'], ['油麦菜', 'produce'], ['杏鲍菇', 'produce'],
    ['鸡蛋', 'dairy'], ['雞蛋', 'dairy'], ['牛奶', 'dairy'], ['豆腐', 'dairy'], ['老豆腐', 'dairy'], ['冻豆腐', 'dairy'], ['腐竹', 'dairy'], ['鹌鹑蛋', 'dairy'], ['butter', 'dairy'],
    ['大米', 'pantry'], ['面粉', 'pantry'], ['食用油', 'pantry'], ['菜籽油', 'pantry'], ['淀粉', 'pantry'], ['面包糠', 'pantry'], ['乌冬面', 'pantry'], ['flour', 'pantry'],
    ['生抽', 'condiments'], ['盐', 'condiments'], ['冰糖', 'condiments'], ['料酒', 'condiments'], ['黄酒', 'condiments'], ['干辣椒', 'condiments'], ['花椒', 'condiments'],
    ['豆瓣酱', 'condiments'], ['腐乳', 'condiments'], ['海盐', 'condiments'], ['孜然粉', 'condiments'], ['蒸鱼豉油', 'condiments'], ['soy sauce', 'condiments'],
    ['清水', 'other'], ['水', 'other'], ['饺子', 'other'], ['没听说过的', 'other'], ['', 'other'],
    // 检查后补的：对照表会分错的（土豆淀粉里有「土豆」、黄豆酱里有「黄豆」、鱼丸在冷冻里），火锅、卤味常见的（结尾是肠、肝、血、肚、筋、丸、滑），
    // 牛百叶不是豆制品，新鲜的豆子是蔬果，面筋不是肉
    ['土豆淀粉', 'pantry'], ['黄豆酱', 'condiments'], ['鱼丸', 'meat'], ['牛百叶', 'meat'], ['百叶', 'dairy'], ['千张', 'dairy'],
    ['腊肠', 'meat'], ['猪肝', 'meat'], ['鸭血', 'meat'], ['毛肚', 'meat'], ['肥肠', 'meat'], ['牛筋', 'meat'], ['虾滑', 'meat'], ['肉丸', 'meat'], ['鸡胗', 'meat'],
    ['面筋', 'pantry'], ['十三香', 'condiments'], ['红油', 'condiments'], ['藤椒油', 'condiments'],
    ['毛豆', 'produce'], ['豌豆', 'produce'], ['荷兰豆', 'produce'], ['青豆', 'produce'], ['黄豆', 'pantry'],
  ];
  for (const [name, g] of table) assert.equal(ingredientGroup(s, name), g, name);
  // 清单上把「牛腩」改到了「冷冻」：食谱里也按它（其他）；选的分类删掉了 → 照旧猜
  addFromInput(s, 'l_groceries', '牛腩', now());
  editItem(s, itemId(s, 'l_groceries', '牛腩'), { categoryId: 'c_frozen' }, now());
  assert.equal(ingredientGroup(s, '牛腩'), 'other');
  s.data.categories.c_frozen = deletedRecord(s.data.categories.c_frozen, now());
  assert.equal(ingredientGroup(s, '牛腩'), 'meat');
  assert.deepEqual([...ING_GROUPS], ['meat', 'produce', 'dairy', 'pantry', 'condiments', 'other']);
});

test('程序、测试、文档里没有坏掉的字（U+FFFD：拷贝时编码弄坏的，「土豆淀粉」坏成了对不上的字，悄悄分错组）', () => {
  const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
  const files = (dir) => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(e => (e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  const all = [...files('src'), ...files('tests'), ...files('docs'), 'README.md', 'CLAUDE.md', 'styles.css', 'sw.js', 'index.html'].filter(f => /\.(m?js|md|css|html)$/.test(f));
  assert.ok(all.length > 20);
  for (const f of all) assert.equal(fs.readFileSync(path.join(root, f), 'utf8').includes('\uFFFD'), false, f);
});

test('按组排：肉类海鲜 → 蔬果 → 蛋奶豆制品 → 粮油干货 → 调料酱料 → 其他；同一组里保持原来的先后（稳定）；不改原来的数组', () => {
  const s = seeded();
  const ings = ['生抽', '鸡蛋', '五花肉', '清水', '洋葱', '盐', '排骨', '大米', '葱', '豆腐', '冰糖'].map(n => ing(n));
  const before = names(ings);
  assert.deepEqual(names(sortIngredients(s, ings)), ['五花肉', '排骨', '洋葱', '葱', '鸡蛋', '豆腐', '大米', '生抽', '盐', '冰糖', '清水']);
  assert.deepEqual(names(ings), before, '原来的不动');
  const sorted = sortIngredients(s, ings);
  assert.deepEqual(names(sortIngredients(s, sorted)), names(sorted), '排好的再排不变');
  assert.equal(sorted[0], ings[2], '还是原来那几个对象');
  // 两行「盐」（腌料、调味各一份）：先后不变
  const two = [ing('盐', { note: '腌料' }), ing('五花肉'), ing('盐', { note: '调味' })];
  assert.deepEqual(sortIngredients(s, two).map(g => g.note), ['', '腌料', '调味']);
});

test('新加的放在哪：没手动排过 → 整张按组排；排过 → 别的不动，新的插到它那一组的最后（没有这一组放在前面几组的最后，都没有放最前）', () => {
  const s = seeded();
  const a = [ing('盐'), ing('五花肉'), ing('生抽')];        // 手动排过：盐在最前
  const pork = ing('排骨'), sugar = ing('冰糖'), egg = ing('鸡蛋'), water = ing('清水');
  assert.deepEqual(names(placeIngredients(s, [...a, pork, sugar], [pork.key, sugar.key], false)), ['五花肉', '排骨', '盐', '生抽', '冰糖']);
  assert.deepEqual(names(placeIngredients(s, [...a, pork, sugar, egg, water], [pork.key, sugar.key, egg.key, water.key], true)),
    ['盐', '五花肉', '排骨', '鸡蛋', '生抽', '冰糖', '清水'], '排骨跟在五花肉后面、冰糖跟在最后一个调料后面；还没有蛋奶：鸡蛋在前面几组（排骨）的后面');
  const onion = ing('洋葱');
  assert.deepEqual(names(placeIngredients(s, [ing('生抽'), onion], [onion.key], true)), ['洋葱', '生抽'], '前面没有它那一组和更前的组：放最前');
  assert.deepEqual(names(placeIngredients(s, a, ['nope'], false)), names(a), '没有新的：原样（不排）');
  const two = [ing('葱'), ing('姜')];
  assert.deepEqual(names(placeIngredients(s, [ing('五花肉'), ...two], two.map(g => g.key), true)), ['五花肉', '葱', '姜'], '几样新的一起：同组里照它们的先后');
});

test('保存时放好「加一样」新写的（place）：没排过的整张按组排、排过的只放新的；没给 place 原样（粘贴进来的编辑页已经放好了）', () => {
  const s = seeded();
  const rows = [{ key: 'g_1', name: '生抽', qty: '2', unit: '勺' }, { key: 'g_2', name: '五花肉', qty: '500', unit: 'g' }];
  const r = saveRecipe(s, null, { name: '红烧肉', ings: rows, place: ['g_1', 'g_2'] }, now());
  assert.deepEqual(names(s.data.recipes[r.id].ings), ['五花肉', '生抽']);
  const kept = saveRecipe(s, null, { name: '原样', ings: rows }, now());
  assert.deepEqual(names(s.data.recipes[kept.id].ings), ['生抽', '五花肉'], '没给 place：照交来的顺序');
  // 手动把生抽挪到最前（ordered），再「加一样」洋葱、冰糖：只放这两样
  saveRecipe(s, r.id, { name: '红烧肉', ordered: true, ings: [{ key: 'g_1', name: '生抽' }, { key: 'g_2', name: '五花肉' }, { key: 'g_3', name: '冰糖' }, { key: 'g_4', name: '洋葱' }], place: ['g_3', 'g_4', 7] }, now());
  assert.deepEqual(names(s.data.recipes[r.id].ings), ['生抽', '冰糖', '五花肉', '洋葱']);
  assert.equal(s.data.recipes[r.id].ordered, true);
});

test('已经存过的食谱（第 11 步以前存的没有 ordered，可能是以前用 ↑↓ 排好的）：「加一样」写的保存时只放进它那一组的最后，原来的几行不挪', () => {
  const s = seeded();
  recipe(s, 'r_old', { name: '可乐鸡翅', ings: [{ key: 'g_1', name: '生抽' }, { key: 'g_2', name: '料酒' }, { key: 'g_3', name: '鸡翅' }, { key: 'g_4', name: '可乐' }] });
  assert.equal('ordered' in s.data.recipes.r_old, false);
  const rows = [...s.data.recipes.r_old.ings.map(g => ({ ...g })), { key: 'g_5', name: '姜' }];
  const r = saveRecipe(s, 'r_old', { name: '可乐鸡翅', ordered: false, ings: rows, place: ['g_5'] }, now());
  assert.ok(r.ok);
  assert.deepEqual(names(s.data.recipes.r_old.ings), ['生抽', '料酒', '鸡翅', '姜', '可乐'], '姜放进蔬果（鸡翅后面），生抽、料酒不挪到后面去');
  assert.equal('ordered' in s.data.recipes.r_old, false, '没手动排过：还是没有 ordered');
  // 新建的照旧整张排（还没有「原来的几行」）
  const made = saveRecipe(s, null, { name: '新的', ings: [{ key: 'g_1', name: '生抽' }, { key: 'g_2', name: '鸡翅' }], place: ['g_1', 'g_2'] }, now());
  assert.deepEqual(names(s.data.recipes[made.id].ings), ['鸡翅', '生抽']);
});

// ---------- 重复的食材 ----------
test('重复的食材：同一道里 normName 一样的第一行（简繁、大小写、空白）；跳过自己那一行；名字空着 → null', () => {
  const r = { ings: [ing('生抽'), ing('Salt'), ing('雞蛋'), ing('生抽')] };
  assert.equal(duplicateOf(r, ' 生抽 '), r.ings[0]);
  assert.equal(duplicateOf(r, 'salt'), r.ings[1]);
  assert.equal(duplicateOf(r, '鸡蛋'), r.ings[2]);
  assert.equal(duplicateOf(r, '生抽', r.ings[0].key), r.ings[3], '跳过自己');
  assert.equal(duplicateOf(r, '老抽'), null);
  assert.equal(duplicateOf(r, '  '), null);
  assert.equal(duplicateOf(null, '生抽'), null);
});

test('合并重复的一行：单位一样数量相加（大小写、简繁不分）；有一边没写数量就是没写（写了的那边记进备注）；单位不一样这次的写进备注；备注接在后面、不重复', () => {
  const m = (into, add) => mergeIngredient({ qty: null, unit: '', note: '', ...into }, { qty: null, unit: '', note: '', ...add });
  assert.deepEqual(m({ qty: 2, unit: '勺' }, { qty: 1, unit: '勺' }), { qty: 3, unit: '勺', note: '' });
  assert.deepEqual(m({ qty: 0.1, unit: 'ML' }, { qty: 0.2, unit: 'ml' }), { qty: 0.3, unit: 'ML', note: '' }, '浮点零头去掉');
  assert.deepEqual(m({ qty: 2, unit: '個' }, { qty: 1, unit: '个', note: '打散' }), { qty: 3, unit: '個', note: '打散' });
  assert.deepEqual(m({ qty: 2, unit: '勺', note: '腌料' }, { qty: 15, unit: 'ml' }), { qty: 2, unit: '勺', note: '腌料；15 ml' });
  assert.deepEqual(m({ note: '适量' }, { qty: 1, unit: '小勺' }), { qty: null, unit: '', note: '适量；1 小勺' });
  assert.deepEqual(m({ qty: 2 }, { note: '适量' }), { qty: 2, unit: '', note: '适量' }, '这次没写数量：原来那一行的 2 留着，只接上备注');
  assert.deepEqual(m({ qty: 2 }, {}), { qty: 2, unit: '', note: '' }, '刚写了名字就点合并（「五花肉 500 葱 2」拆出来的没有单位）');
  assert.deepEqual(m({ qty: 2, unit: '个' }, {}), { qty: 2, unit: '个', note: '' }, '有没有单位都一样');
  assert.deepEqual(m({}, { qty: 2 }), { qty: null, unit: '', note: '2' }, '原来那一行没写数量：这次的写进备注');
  assert.deepEqual(m({ qty: 6000, unit: 'ml' }, { qty: 5000, unit: 'ml' }), { qty: 6000, unit: 'ml', note: '5000 ml' }, '加起来超过 9999：保存会报错，这次的写进备注');
  assert.deepEqual(m({ qty: 4999, unit: 'g' }, { qty: 5000, unit: 'g' }), { qty: 9999, unit: 'g', note: '' }, '正好 9999 还加');
  assert.deepEqual(m({ note: '少许' }, { note: '少许' }), { qty: null, unit: '', note: '少许' }, '一样的备注不写两遍');
  assert.deepEqual(m({ qty: 1, unit: 'cup', note: 'sifted' }, { qty: 2, unit: 'tbsp' }), { qty: 1, unit: 'cup', note: 'sifted; 2 tbsp' }, '英文用「; 」');
});

// ---------- 食材替换 ----------
function replaceSeed() {
  const s = seeded();
  recipe(s, 'r_a', { name: '红烧肉', ings: [{ key: 'g_1', name: '生抽', qty: 2, unit: '勺', note: '腌料' }, { key: 'g_2', name: '五花肉', qty: 500, unit: 'g' }, { key: 'g_3', name: '生抽', qty: 1, unit: '勺' }] });
  recipe(s, 'r_b', { name: '凉拌黄瓜', ings: [{ key: 'g_1', name: '黄瓜' }, { key: 'g_2', name: ' 生抽', note: '少许', future: 1 }] });
  recipe(s, 'r_c', { name: '可乐鸡翅', ings: [{ key: 'g_1', name: '生抽王' }] });
  recipe(s, 'r_d', { name: '删掉的', ings: [{ key: 'g_1', name: '生抽' }] });
  s.data.recipes.r_d = deletedRecord(s.data.recipes.r_d, T0 + 5);
  return s;
}

test('食材替换先找：用到的食材按名字搜（每个词都要有），normName 一样的算一样、写法用最多的；开头对上的在前、再按几道食谱用；删掉的食谱不算', () => {
  const s = replaceSeed();
  assert.deepEqual(ingredientNames(s, '生抽'), [{ name: '生抽', n: 2 }, { name: '生抽王', n: 1 }]);
  assert.deepEqual(ingredientNames(s, '抽'), [{ name: '生抽', n: 2 }, { name: '生抽王', n: 1 }]);
  assert.deepEqual(ingredientNames(s, '黄').map(x => x.name), ['黄瓜']);
  assert.equal(ingredientNames(s, '').length, 4, '空的列全部');
  assert.deepEqual(ingredientNames(s, '', undefined, { limit: 1 }).length, 1);
  assert.deepEqual(ingredientNames(s, '没有'), []);
  // 开头对上的在前，哪怕用到它的食谱少（回车选第一个）：蚝油 1 道、油菜 2 道，搜「油」是油菜
  recipe(s, 'r_e', { name: 'e', ings: [{ key: 'g_1', name: '蚝油' }, { key: 'g_2', name: '油菜' }] });
  recipe(s, 'r_f', { name: 'f', ings: [{ key: 'g_1', name: '油菜' }] });
  assert.deepEqual(ingredientNames(s, '油'), [{ name: '油菜', n: 2 }, { name: '蚝油', n: 1 }]);
  recipe(s, 'r_g', { name: 'g', ings: [{ key: 'g_1', name: '蚝油' }, { key: 'g_2', name: '香油' }] });
  recipe(s, 'r_h', { name: 'h', ings: [{ key: 'g_1', name: '蚝油' }] });
  assert.deepEqual(ingredientNames(s, '油').map(x => x.name), ['油菜', '蚝油', '香油'], '开头对上的少也在前，别的按几道食谱用');
});

test('食材替换先看：normName 一样的那几行（不是包含：「生抽王」不算），按食谱名字排；删掉的不算', () => {
  const s = replaceSeed();
  const p = replacePreview(s, '生抽');
  assert.deepEqual(p.map(x => [x.recipe.id, x.rows.map(g => g.key)]), [['r_a', ['g_1', 'g_3']], ['r_b', ['g_2']]]);
  assert.deepEqual(replacePreview(s, ''), []);
});

test('食材替换：所有食谱里这几行一起改名，数量、单位、备注、key、不认识的字段不动；常备品跟着换；清单上的东西不改；再换一次什么也不变', () => {
  const s = replaceSeed();
  setStaple(s, '生抽', true, now());
  addFromInput(s, 'l_groceries', '生抽', now());
  const res = replaceIngredient(s, '生抽', ' 酱油 ', now());
  assert.deepEqual(res, { recipes: 2, rows: 3 });
  assert.deepEqual(s.data.recipes.r_a.ings.map(g => [g.key, g.name, g.qty, g.unit, g.note]), [['g_1', '酱油', 2, '勺', '腌料'], ['g_2', '五花肉', 500, 'g', ''], ['g_3', '酱油', 1, '勺', '']]);
  assert.deepEqual([s.data.recipes.r_b.ings[1].name, s.data.recipes.r_b.ings[1].future], ['酱油', 1]);
  assert.equal(s.data.recipes.r_c.ings[0].name, '生抽王', '包含它的不算');
  assert.equal(s.data.recipes.r_d.ings[0].name, '生抽', '删掉的食谱不动');
  assert.ok(isStaple(s, '酱油') && !isStaple(s, '生抽'), '常备品换到新名字');
  assert.equal(s.data.items[itemId(s, 'l_groceries', '生抽')].name, '生抽', '清单上的不改');
  const at = s.data.recipes.r_a.updatedAt;
  assert.deepEqual(replaceIngredient(s, '生抽', '酱油', now()), { recipes: 0, rows: 0 });
  assert.equal(s.data.recipes.r_a.updatedAt, at);
  assert.deepEqual(replaceIngredient(s, '酱油', '  ', now()), { recipes: 0, rows: 0 }, '新名字空着什么也不改');
});

test('食材替换会让哪几道食谱有两行一样的：本来就有新名字那一行的（按名字排）；只换写法、新名字空着 → 没有；换了以后照样两行（不拦着）', () => {
  const s = replaceSeed();
  recipe(s, 'r_e', { name: '回锅肉', ings: [{ key: 'g_1', name: '生抽' }, { key: 'g_2', name: '醬油' }] });
  recipe(s, 'r_f', { name: '只有酱油', ings: [{ key: 'g_1', name: '酱油' }] });
  assert.deepEqual(replaceDuplicates(s, '生抽', '酱油').map(r => r.id), ['r_e'], '简繁一样算；不用生抽的食谱不算');
  assert.deepEqual(replaceDuplicates(s, '生抽', '老抽'), []);
  assert.deepEqual(replaceDuplicates(s, '生抽', '生抽'), [], '只换写法');
  assert.deepEqual(replaceDuplicates(s, '生抽', ' '), []);
  replaceIngredient(s, '生抽', '酱油', now());
  assert.deepEqual(names(s.data.recipes.r_e.ings), ['酱油', '醬油']);
});

test('食材替换只换写法（normName 一样）：名字改成新的写法，常备品是同一条、不动', () => {
  const s = seeded();
  recipe(s, 'r_a', { name: 'x', ings: [{ key: 'g_1', name: 'soy sauce' }, { key: 'g_2', name: 'Soy Sauce' }] });
  setStaple(s, 'soy sauce', true, now());
  assert.deepEqual(replaceIngredient(s, 'SOY SAUCE', 'Soy Sauce', now()), { recipes: 1, rows: 1 });
  assert.deepEqual(names(s.data.recipes.r_a.ings), ['Soy Sauce', 'Soy Sauce']);
  assert.ok(isStaple(s, 'Soy Sauce'));
  assert.equal(s.data.memory[memoryId('soy sauce')].staple, true);
});

test('食材替换在一次修改里，撤销一下全回来（食谱的名字、常备品）', () => {
  state.load({ storage: null });
  state.mutate(s => {
    s.data.recipes.r_a = normalizeRecord('recipes', { id: 'r_a', name: '红烧肉', updatedAt: 1, createdAt: 1, ings: [{ key: 'g_1', name: '生抽' }] });
    s.data.recipes.r_b = normalizeRecord('recipes', { id: 'r_b', name: '凉拌', updatedAt: 1, createdAt: 1, ings: [{ key: 'g_1', name: '生抽' }, { key: 'g_2', name: '醋' }] });
    setStaple(s, '生抽', true, Date.now());
  });
  state.mutate(s => replaceIngredient(s, '生抽', '酱油', Date.now()), { undoLabel: '换了' });
  const S = state.getState();
  assert.deepEqual([liveRecipe(S, 'r_a').ings[0].name, liveRecipe(S, 'r_b').ings[0].name, isStaple(S, '酱油'), isStaple(S, '生抽')], ['酱油', '酱油', true, false]);
  assert.equal(state.undo(), '换了');
  const U = state.getState();
  assert.deepEqual([liveRecipe(U, 'r_a').ings[0].name, liveRecipe(U, 'r_b').ings.map(g => g.name), isStaple(U, '酱油'), isStaple(U, '生抽')], ['生抽', ['生抽', '醋'], false, true]);
});
