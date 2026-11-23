// 食谱（core/recipes.js）：粘贴食材的拆法、按人数换算、搜索、用到某样食材的食谱、新建 / 改 / 删、「加到清单」的每一行（常备品、可选的默认不勾，
// 清单上已有的）和确认；食谱的整理与合并、最近删除。全是编的数据
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureSeeds, blankState, normalizeRecord, normalizeState, mergeStates, canon, itemId, deletedRecord, restoredRecord } from '../src/core/store.js';
import { parseIngredients, scaleIngredients, searchRecipes, recipesUsing, validateRecipe, saveRecipe, deleteRecipe, liveRecipe,
  recipeLines, addRecipeToList, groceryLists, defaultTarget, recipeName } from '../src/core/recipes.js';
import { addFromInput, totalLabel, setStatus } from '../src/core/items.js';
import { setStaple, isStaple } from '../src/core/memory.js';
import { recentlyDeleted, restoreBlock, deletedCount } from '../src/core/deleted.js';
import { backupCounts } from '../src/core/backup.js';
import { parseQuickAdd } from '../src/core/parse.js';

const T0 = 1_700_000_000_000;
let clock = T0;
const now = () => (clock += 1000);
const seeded = () => ensureSeeds(blankState());
const L = 'l_groceries';
/** 拆成 [名字, 数量, 单位, 备注]（可选的再加一个 '可选'），表格好读 */
const rows = (text) => parseIngredients(text).map(g => [g.name, g.qty, g.unit, g.note, ...(g.optional ? ['可选'] : [])]);
const recipe = (s, id, fields) => (s.data.recipes[id] = normalizeRecord('recipes', { id, updatedAt: T0, createdAt: T0, ...fields }));
let keySeq = 0;
const ing = (name, qty = null, unit = '', extra = {}) => ({ key: 'k' + (++keySeq), name, qty, unit, ...extra });
const keyOf = (r, name) => r.ings.find(g => g.name === name).key;

// ---------- 粘贴食材 ----------
test('粘贴食材：小红书那种一行写完的「食材：…、…」，去掉开头、按「、」拆、认数量和单位', () => {
  assert.deepEqual(rows('食材：五花肉500g、生抽2勺、老抽1勺、冰糖20g'), [['五花肉', 500, 'g', ''], ['生抽', 2, '勺', ''], ['老抽', 1, '勺', ''], ['冰糖', 20, 'g', '']]);
  assert.deepEqual(rows('用料：鸡翅10个，可乐1罐；姜3片'), [['鸡翅', 10, '个', ''], ['可乐', 1, '罐', ''], ['姜', 3, '片', '']]);
  assert.deepEqual(rows('【调料】盐少许,糖1小勺'), [['盐', null, '', '少许'], ['糖', 1, '小勺', '']], '有汉字的行英文逗号也拆');
  assert.deepEqual(rows('主料 五花肉500g 冰糖20g 葱姜适量'), [['五花肉', 500, 'g', ''], ['冰糖', 20, 'g', ''], ['葱姜', null, '', '适量']], '空格隔开的几样：左边以数量结尾才拆');
  assert.deepEqual(rows('五花肉 500g'), [['五花肉', 500, 'g', '']], '名字 + 空格 + 数量还是一样');
  assert.deepEqual(rows('猪蹄 2只 约1kg'), [['猪蹄', 2, '只', '约1kg']], '「约…」是前面那样的补充');
});

test('粘贴食材：「适量」「少许」「若干」「一点」不算数量，写进备注；「葱、姜、蒜 适量」「生抽、老抽各1勺」给同一行前面没写的', () => {
  assert.deepEqual(rows('葱、姜、蒜 适量'), [['葱', null, '', '适量'], ['姜', null, '', '适量'], ['蒜', null, '', '适量']]);
  assert.deepEqual(rows('生抽、老抽各1勺'), [['生抽', 1, '勺', ''], ['老抽', 1, '勺', '']]);
  assert.deepEqual(rows('鸡蛋2个、葱 适量'), [['鸡蛋', 2, '个', ''], ['葱', null, '', '适量']], '前面写了数量的不改');
  assert.deepEqual(rows('盐若干\n一点糖\n少许胡椒粉\n料酒 适当'), [['盐', null, '', '若干'], ['糖', null, '', '一点'], ['胡椒粉', null, '', '少许'], ['料酒', null, '', '适当']]);
  assert.deepEqual(rows('香菜（可选）、生抽2勺(约30ml)、五花肉（带皮）500g'),
    [['香菜', null, '', '', '可选'], ['生抽', 2, '勺', '约30ml'], ['五花肉', 500, 'g', '带皮']], '括号里的写进备注，「可选」是可选');
});

test('粘贴食材：一行一样，序号和列表符号去掉；「1.5斤」不是序号；繁体、全角数字、中文数字、食谱的单位（两、勺、汤匙、瓣）', () => {
  assert.deepEqual(rows('1. 五花肉 500克\n2、鸡蛋 3个\n(3) 番茄2个\n① 盐少许\n- 料酒 1汤匙\n• 八角 2颗\n· 桂皮1块\n* 香叶 2片'),
    [['五花肉', 500, '克', ''], ['鸡蛋', 3, '个', ''], ['番茄', 2, '个', ''], ['盐', null, '', '少许'], ['料酒', 1, '汤匙', ''], ['八角', 2, '颗', ''], ['桂皮', 1, '块', ''], ['香叶', 2, '片', '']]);
  assert.deepEqual(rows('1.5斤五花肉\n10、牛腩 1斤'), [['五花肉', 1.5, '斤', ''], ['牛腩', 1, '斤', '']]);
  assert.deepEqual(rows('猪肉二两\n雞蛋兩個\n半个洋葱\n洋葱半个\n大蒜３瓣\n盐 1小勺\n二两白酒'),
    [['猪肉', 2, '两', ''], ['雞蛋', 2, '個', ''], ['洋葱', 0.5, '个', ''], ['洋葱', 0.5, '个', ''], ['大蒜', 3, '瓣', ''], ['盐', 1, '小勺', ''], ['白酒', 2, '两', '']]);
  assert.deepEqual(rows('五花肉：500g'), [['五花肉', 500, 'g', '']]);
});

test('粘贴食材：英文的行（cups、tbsp、分数），逗号后面当备注、不拆；Ingredients: 开头；to taste', () => {
  assert.deepEqual(rows('Ingredients:\n- 2 cups flour\n- 1/2 tsp salt\n- 1 onion, diced\n- 3 cloves garlic, minced\n- 1 tbsp olive oil\n- Salt to taste\n- 2 eggs'),
    [['flour', 2, 'cups', ''], ['salt', 0.5, 'tsp', ''], ['onion', 1, '', 'diced'], ['garlic', 3, 'cloves', 'minced'], ['olive oil', 1, 'tbsp', ''], ['Salt', null, '', 'to taste'], ['eggs', 2, '', '']]);
});

test('粘贴食材：到「做法」「步骤」就停；空的、只有标点 / 表情、#话题 扔掉；拆不出数量整段当名字；不是字符串 → []', () => {
  assert.deepEqual(rows('【主料】\n五花肉500g\n\n做法：\n1. 五花肉切块焯水'), [['五花肉', 500, 'g', '']]);
  assert.deepEqual(rows('鸡蛋 2个\n步骤\n打散'), [['鸡蛋', 2, '个', '']]);
  assert.deepEqual(rows('！！！\n🔥🔥🔥\n#红烧肉# #家常菜\n   \n。。'), []);
  assert.deepEqual(rows('老干妈 看心情\n维生素B12\n秘制酱汁一份'), [['老干妈 看心情', null, '', ''], ['维生素B12', null, '', ''], ['秘制酱汁', 1, '份', '']], '不猜');
  assert.deepEqual(parseIngredients(null), []);
  assert.deepEqual(parseIngredients(42), [{ name: '42', qty: null, unit: '', note: '', optional: false }]);
  assert.equal(parseIngredients(Array.from({ length: 300 }, (_, i) => '菜' + i).join('\n')).length, 200, '最多 200 样');
});

test('粘贴食材：数量和单位中间有空格（「鸡蛋 3 个」「五花肉 500 克」）：单位是左边那个数量的，不是下一样', () => {
  assert.deepEqual(rows('鸡蛋 3 个'), [['鸡蛋', 3, '个', '']]);
  assert.deepEqual(rows('生抽 2 勺、老抽 1 勺'), [['生抽', 2, '勺', ''], ['老抽', 1, '勺', '']]);
  assert.deepEqual(rows('盐 1/4 茶匙\n五花肉 500 克 冰糖 20 克\n牛奶 250 毫升\n姜 3 片'),
    [['盐', 0.25, '茶匙', ''], ['五花肉', 500, '克', ''], ['冰糖', 20, '克', ''], ['牛奶', 250, '毫升', ''], ['姜', 3, '片', '']]);
  assert.deepEqual(rows('洋葱 1 个（切丝）\n土豆 2 个（约400g）'), [['洋葱', 1, '个', '切丝'], ['土豆', 2, '个', '约400g']]);
  assert.deepEqual(rows('3 个 鸡蛋'), [['鸡蛋', 3, '个', '']]);
});

test('粘贴食材：小红书的表情——标题、「做法」前后带表情照样认得；开头的表情、▪️、1️⃣ 去掉，名字里不留表情', () => {
  assert.deepEqual(rows('✅食材：\n🥩五花肉 500g\n🧅洋葱 1个\n▪️牛腩 300g\n▫️鸡蛋 2个\n1️⃣ 盐少许\n👉 牛奶 1盒\n👩‍🍳做法：\n五花肉切块冷水下锅'),
    [['五花肉', 500, 'g', ''], ['洋葱', 1, '个', ''], ['牛腩', 300, 'g', ''], ['鸡蛋', 2, '个', ''], ['盐', null, '', '少许'], ['牛奶', 1, '盒', '']]);
  for (const head of ['✨食材✨', '📝 配料表', '食材清单👇', '✅用料', '🛒 Ingredients:']) assert.deepEqual(rows(head + '\n姜 3片'), [['姜', 3, '片', '']], head);
  for (const stop of ['💡步骤', '💡做法：', '1. 💡做法', '做法👇', '🔥 Instructions']) assert.deepEqual(rows('姜 3片\n' + stop + '\n1⃣️牛腩冷水下锅焯水'), [['姜', 3, '片', '']], stop);
  assert.deepEqual(rows('🥩五花肉500g 🧅洋葱1个\n🇨🇳酱油 1瓶'), [['五花肉', 500, 'g', ''], ['洋葱', 1, '个', ''], ['酱油', 1, '瓶', '']], '表情隔开的也拆');
  assert.equal(rows('▪️牛腩')[0][0], '牛腩', '不留看不见的 U+FE0F');
});

test('粘贴食材：「各」「适量」只给紧挨在前面、什么也没写的几段（往前到写了的就停）；「各适量」「：适量」不留在名字里', () => {
  assert.deepEqual(rows('调料：生抽、老抽各1勺，蚝油1勺，糖1小勺，盐少许'),
    [['生抽', 1, '勺', ''], ['老抽', 1, '勺', ''], ['蚝油', 1, '勺', ''], ['糖', 1, '小勺', ''], ['盐', null, '', '少许']], '生抽是 1 勺，不是盐的少许');
  assert.deepEqual(rows('葱、姜、蒜 适量，盐 1小勺'), [['葱', null, '', '适量'], ['姜', null, '', '适量'], ['蒜', null, '', '适量'], ['盐', 1, '小勺', '']]);
  assert.deepEqual(rows('生抽、老抽各1勺，蚝油1勺'), [['生抽', 1, '勺', ''], ['老抽', 1, '勺', ''], ['蚝油', 1, '勺', '']]);
  assert.deepEqual(rows('葱、姜各适量、蒜 少许'), [['葱', null, '', '适量'], ['姜', null, '', '适量'], ['蒜', null, '', '少许']]);
  assert.deepEqual(rows('葱姜蒜各适量\n盐、胡椒粉各适量\n盐、糖各少许\n盐：适量\n盐 : 适量'),
    [['葱姜蒜', null, '', '适量'], ['盐', null, '', '适量'], ['胡椒粉', null, '', '适量'], ['盐', null, '', '少许'], ['糖', null, '', '少许'], ['盐', null, '', '适量'], ['盐', null, '', '适量']]);
});

test('粘贴食材：连着写的「约…」、「 / 」后面的另一种写法进备注；带分数；「｜」「 / 」隔开的几样；拆不准的整段当名字', () => {
  assert.deepEqual(rows('鸡翅8个约400g\n猪蹄2只约1kg\n牛奶 250ml / 1杯'), [['鸡翅', 8, '个', '约400g'], ['猪蹄', 2, '只', '约1kg'], ['牛奶', 250, 'ml', '1杯']]);
  assert.deepEqual(rows('1 1/2 cups sugar\nflour 2 1/4 cups\n½ cup milk'), [['sugar', 1.5, 'cups', ''], ['flour', 2.25, 'cups', ''], ['½ cup milk', null, '', '']], '½ 不认：整段当名字');
  assert.deepEqual(rows('1 3/2 cups sugar')[0], ['1 3/2 cups sugar', null, '', ''], '不是带分数：不猜');
  assert.deepEqual(rows('柠檬汁 15ml / 蜂蜜 10g\n虾仁200g｜西兰花1颗｜蒜末适量\n2 eggs | 1 cup milk'),
    [['柠檬汁', 15, 'ml', ''], ['蜂蜜', 10, 'g', ''], ['虾仁', 200, 'g', ''], ['西兰花', 1, '颗', ''], ['蒜末', null, '', '适量'], ['eggs', 2, '', ''], ['milk', 1, 'cup', '']]);
});

test('快速添加照旧不认食谱的单位（「两盒牛奶」的两是数字，「盐 1勺」整句是名字）；拆食谱时才认', () => {
  assert.deepEqual(parseQuickAdd('两盒牛奶'), { name: '牛奶', qty: 2, unit: '盒' });
  assert.deepEqual(parseQuickAdd('盐 1勺'), { name: '盐 1勺', qty: null, unit: '' });
  assert.deepEqual(parseQuickAdd('盐 1勺', { recipe: true }), { name: '盐', qty: 1, unit: '勺' });
  assert.deepEqual(parseQuickAdd('2 cups flour'), { name: 'cups flour', qty: 2, unit: '' });
  assert.deepEqual(parseQuickAdd('2 cups flour', { recipe: true }), { name: 'flour', qty: 2, unit: 'cups' });
  assert.deepEqual(parseQuickAdd('2 1/2 gal milk'), { name: '1/2 gal milk', qty: 2, unit: '' }, '带分数只在拆食谱时认：快速添加里多半是 2 桶「半加仑」');
  assert.deepEqual(parseQuickAdd('1 1/2 cups sugar', { recipe: true }), { name: 'sugar', qty: 1.5, unit: 'cups' });
});

// ---------- 按人数换算 ----------
test('按人数换算：qty × 人数 / 食谱的人数，两位小数；没写数量的、食谱没写人数的、人数不对的原样', () => {
  const r = { servings: 2, ings: [ing('五花肉', 500, 'g'), ing('盐', null, '', { note: '适量' }), ing('鸡蛋', 3, '个'), ing('糖', 0.01, 'g')] };
  assert.deepEqual(scaleIngredients(r, 3).map(g => g.qty), [750, null, 4.5, 0.02]);
  assert.deepEqual(scaleIngredients(r, 1).map(g => g.qty), [250, null, 1.5, 0.01], '太小的至少 0.01');
  assert.deepEqual(scaleIngredients({ servings: 3, ings: [ing('a', 1)] }, 2)[0].qty, 0.67);
  assert.deepEqual(scaleIngredients(r, 2).map(g => g.qty), [500, null, 3, 0.01]);
  assert.deepEqual(scaleIngredients({ servings: null, ings: r.ings }, 4).map(g => g.qty), [500, null, 3, 0.01], '食谱没写人数');
  for (const bad of [0, -1, NaN, null, '3']) assert.deepEqual(scaleIngredients(r, bad).map(g => g.qty), [500, null, 3, 0.01], String(bad));
  assert.equal(scaleIngredients({ servings: 2, ings: [ing('水', 2000, 'ml')] }, 10)[0].qty, 10000, '可以超过 9999（那是输入框的上限），不悄悄卡在 9999');
  assert.equal(scaleIngredients(r, 3)[1].note, '适量', '别的字段原样');
  assert.notEqual(scaleIngredients(r, 3)[0], r.ings[0], '不改原来的');
});

// ---------- 搜索、联想 ----------
test('搜索食谱：名字和食材都搜，简繁、大小写互通，几个词都要有；按名字排；空的 → 全部；删掉的不算', () => {
  const s = seeded();
  recipe(s, 'r_1', { name: '紅燒肉', ings: [ing('五花肉', 500, 'g'), ing('冰糖')] });
  recipe(s, 'r_2', { name: '番茄炒蛋', ings: [ing('番茄', 2, '个'), ing('鸡蛋', 3, '个')] });
  recipe(s, 'r_3', { name: 'Pancakes', ings: [ing('Flour'), ing('eggs')] });
  s.data.recipes.r_4 = deletedRecord(normalizeRecord('recipes', { id: 'r_4', name: '红烧排骨', updatedAt: T0 }), T0 + 1);
  const names = (q) => searchRecipes(s, q).map(x => x.recipe.name);
  assert.deepEqual(names(''), ['番茄炒蛋', '紅燒肉', 'Pancakes'], '按拼音');
  assert.deepEqual(names('红烧'), ['紅燒肉'], '简体搜繁体，删掉的不算');
  assert.deepEqual(names('五花'), ['紅燒肉'], '食材也搜');
  assert.deepEqual(searchRecipes(s, '五花')[0].ings, ['五花肉'], '命中的食材');
  assert.deepEqual(searchRecipes(s, '红烧')[0].ings, [], '名字命中时没有');
  assert.deepEqual(names('雞蛋 番茄'), ['番茄炒蛋']);
  assert.deepEqual(names('鸡蛋 五花'), []);
  assert.deepEqual(names('FLOUR'), ['Pancakes']);
  assert.deepEqual(names('ＦＬＯＵＲ'), ['Pancakes'], '全角');
});

test('用到它的食谱：同名，或者包含它（至少两个字）；简繁互通；删掉的不算；按名字排', () => {
  const s = seeded();
  recipe(s, 'r_1', { name: '红烧肉', ings: [ing('五花肉', 500, 'g')] });
  recipe(s, 'r_2', { name: '回锅肉', ings: [ing('五花肉'), ing('青椒')] });
  recipe(s, 'r_3', { name: '炒肉丝', ings: [ing('肉')] });
  recipe(s, 'r_4', { name: '蒜蓉', ings: [ing('蒜')] });
  const names = (q) => recipesUsing(s, q).map(r => r.name);
  assert.deepEqual(names('五花肉'), ['红烧肉', '回锅肉'].sort((a, b) => new Intl.Collator('zh-Hans-u-co-pinyin').compare(a, b)));
  assert.deepEqual(names('五花'), names('五花肉'), '两个字就能联想');
  assert.deepEqual(names('肉'), ['炒肉丝'], '一个字只认同名的');
  assert.deepEqual(names('蒜'), ['蒜蓉']);
  assert.deepEqual(names('五花肉'.split('').join('')), names('五花肉'));
  assert.deepEqual(names(' 五 花 '), [], '中间有空格的不是这样东西');
  assert.deepEqual(names(''), []);
  s.data.recipes.r_2 = deletedRecord(s.data.recipes.r_2, T0 + 5);
  assert.deepEqual(names('五花肉'), ['红烧肉']);
});

// ---------- 新建、改、删 ----------
test('检查食谱：名字不能空；几人份空着或 0–99；全空的食材行扔掉，没名字的、数量不对的按行报错', () => {
  const v = validateRecipe({ name: '  ', servings: '0', ings: [{ name: '五花肉', qty: '500', unit: 'g' }, { name: '', qty: '', unit: '', note: '' }, { name: '', qty: '2' }, { name: '糖', qty: 'abc' }, { name: '盐', qty: '' }] });
  assert.equal(v.ok, false);
  assert.deepEqual(v.errors, { name: 'rcp.err.name', servings: 'rcp.err.servings', ings: { 2: 'rcp.err.ingName', 3: 'rcp.err.ingQty' } });
  const ok = validateRecipe({ name: ' 红烧肉 ', servings: '２', steps: '1. 切块\n2. 炖', source: ' https://example.com/r ', note: '', ings: [{ name: ' 五花肉 ', qty: '1/2', unit: ' kg ', note: ' 带皮 ', optional: true }, {}] });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.clean, { name: '红烧肉', servings: 2, steps: '1. 切块\n2. 炖', source: 'https://example.com/r', note: '',
    ings: [{ key: undefined, name: '五花肉', qty: 0.5, unit: 'kg', note: '带皮', optional: true }] });
  assert.equal(validateRecipe({ name: 'x', servings: '100' }).errors.servings, 'rcp.err.servings');
  assert.equal(validateRecipe({ name: 'x', servings: '' }).clean.servings, null);
  assert.equal(validateRecipe({ name: 'x', ings: [{ name: 'a', qty: '10000' }] }).errors.ings[0], 'rcp.err.ingQty');
});

test('保存食谱：新建给 r_ 开头的 id，食材有 key；改的时候 key 照留、新行给新 key，原来那一行上不认识的字段留着；有错什么也不改；删掉的不能改', () => {
  const s = seeded();
  const r = saveRecipe(s, null, { name: '红烧肉', servings: '2', ings: [{ name: '五花肉', qty: '500', unit: 'g' }, { name: '冰糖', qty: '20', unit: 'g' }] }, now());
  assert.equal(r.ok, true);
  assert.match(r.id, /^r_/);
  const rec = s.data.recipes[r.id];
  assert.deepEqual([rec.name, rec.servings, rec.ings.length, rec.createdAt === rec.updatedAt], ['红烧肉', 2, 2, true]);
  assert.ok(rec.ings.every(g => /^g_/.test(g.key)) && rec.ings[0].key !== rec.ings[1].key);
  const [k1, k2] = rec.ings.map(g => g.key);
  s.data.recipes[r.id] = { ...rec, ings: [{ ...rec.ings[0], future: '新版字段' }, rec.ings[1]] };
  const r2 = saveRecipe(s, r.id, { name: '红烧肉', servings: '4', ings: [{ key: k2, name: '冰糖', qty: '30', unit: 'g' }, { key: k1, name: '五花肉', qty: '1', unit: 'kg' }, { name: '八角', qty: '2', unit: '颗' }] }, now());
  assert.equal(r2.ok, true);
  const ed = s.data.recipes[r.id];
  assert.deepEqual(ed.ings.map(g => [g.key === k1 ? 'k1' : g.key === k2 ? 'k2' : 'new', g.name, g.qty]), [['k2', '冰糖', 30], ['k1', '五花肉', 1], ['new', '八角', 2]], '排顺序、改用量，key 不变');
  assert.equal(ed.ings[1].future, '新版字段');
  assert.equal(ed.createdAt, rec.createdAt);
  const before = canon(s);
  assert.deepEqual(saveRecipe(s, r.id, { name: '' }, now()), { ok: false, errors: { name: 'rcp.err.name' } });
  assert.equal(canon(s), before, '有错什么也不改');
  const same = s.data.recipes[r.id].updatedAt;
  saveRecipe(s, r.id, { name: '红烧肉', servings: 4, ings: ed.ings }, now());
  assert.equal(s.data.recipes[r.id].updatedAt, same, '没改什么：不盖新时间');
  deleteRecipe(s, r.id, now());
  assert.equal(liveRecipe(s, r.id), null);
  assert.deepEqual(saveRecipe(s, r.id, { name: 'x' }, now()), { ok: false, errors: { recipe: 'rcp.err.gone' } });
  assert.equal(deleteRecipe(s, r.id, now()), null, '删过了');
  assert.equal(recipeName({ name: ' ' }, k => k), 'rcp.untitled');
});

test('删掉的食谱进最近删除（新删的在前），能恢复、不会撞名；加进清单的东西不跟着删；备份里数几道', () => {
  const s = seeded();
  const a = saveRecipe(s, null, { name: '红烧肉', ings: [{ name: '五花肉', qty: '500', unit: 'g' }] }, now()).id;
  const b = saveRecipe(s, null, { name: '红烧肉', ings: [] }, now()).id;
  addRecipeToList(s, s.data.recipes[a], { listId: L, keys: s.data.recipes[a].ings.map(g => g.key), source: 'a:1' }, now());
  deleteRecipe(s, a, now());
  assert.deepEqual(recentlyDeleted(s).recipes.map(r => r.id), [a]);
  assert.equal(deletedCount(s), 1);
  assert.equal(restoreBlock(s, 'recipes', a), null, '同名的食谱可以有两道');
  assert.equal(s.data.items[itemId(s, L, '五花肉')].deleted, undefined, '清单上的东西留着');
  assert.deepEqual(backupCounts(s).recipes, 1);
  s.data.recipes[a] = restoredRecord(s.data.recipes[a], now());
  assert.deepEqual(recentlyDeleted(s).recipes, []);
  assert.equal(backupCounts(s).recipes, 2);
  assert.equal(restoreBlock(s, 'recipes', b), 'gone', '没删的');
});

// ---------- 加到清单 ----------
test('加到清单的每一行：按人数换算，常备品、可选的默认不勾，清单上已有的（要买、以后再说）写出来，已买的不算；没名字的不列', () => {
  const s = seeded();
  const r = recipe(s, 'r_1', { name: '红烧肉', servings: 2, ings: [ing('五花肉', 500, 'g'), ing('生抽', 2, '勺'), ing('洋葱', 1, '个'), ing('香菜', null, '', { optional: true }), ing('冰糖', 20, 'g'), ing('', 1)] });
  setStaple(s, '生抽', true, now());
  addFromInput(s, L, '洋葱 2个', now());
  addFromInput(s, L, '冰糖', now());
  setStatus(s, s.data.items[itemId(s, L, '冰糖')].id, 'done', now());
  const lines = recipeLines(s, r, { servings: 3, listId: L });
  assert.deepEqual(lines.map(l => [l.name, l.qty, l.unit, l.staple, l.checked, l.haveLabel, !!l.have]), [
    ['五花肉', 750, 'g', false, true, '', false],
    ['生抽', 3, '勺', true, false, '', false],
    ['洋葱', 1.5, '个', false, true, '2 个', true],
    ['香菜', null, '', false, false, '', false],
    ['冰糖', 30, 'g', false, true, '', false],
  ]);
  assert.deepEqual(recipeLines(s, r).map(l => l.qty), [500, 2, 1, null, 20], '不给人数：食谱的人数');
  assert.ok(recipeLines(s, r, { listId: 'l_nope' }).every(l => !l.have), '清单不在：没有「已有」');
});

test('加到清单的每一行：这道菜已经加过的（needs 里 recipeId 是它）写出加过多少、默认不勾；别的菜加的、自己加的照旧只写「已有」', () => {
  const s = seeded();
  const r = recipe(s, 'r_1', { name: '红烧肉', servings: 2, ings: [ing('五花肉', 500, 'g'), ing('洋葱', 1, '个'), ing('盐', null, '', { note: '适量' })] });
  const c = recipe(s, 'r_2', { name: '咖喱', servings: 2, ings: [ing('洋葱', 200, 'g')] });
  addRecipeToList(s, r, { listId: L, keys: [keyOf(r, '五花肉'), keyOf(r, '盐')], source: 'a:1' }, now());
  addRecipeToList(s, r, { listId: L, keys: [keyOf(r, '五花肉')], servings: 1, source: 'a:2' }, now());
  addRecipeToList(s, c, { listId: L, keys: [keyOf(c, '洋葱')], source: 'a:3' }, now());
  addFromInput(s, L, '洋葱 2个', now());                         // 只是因为食谱在：记成自己加的
  const lines = recipeLines(s, r, { listId: L });
  assert.deepEqual(lines.map(l => [l.name, l.added, l.addedLabel, l.haveLabel, l.checked]), [
    ['五花肉', true, '750 g', '750 g', false],
    ['洋葱', false, '', '2 个 + 200 g', true],
    ['盐', true, '', '', false],
  ]);
});

test('加到清单：勾上的按人数加进去（来源是一次一份，label 抄菜名），这次标 / 取消的常备品记下来；没勾的不加；同一道菜加两次是两份', () => {
  const s = seeded();
  const r = recipe(s, 'r_1', { name: ' 红烧肉 ', servings: 2, ings: [ing('五花肉', 500, 'g'), ing('生抽', 2, '勺'), ing('盐', null, '', { note: '适量' })] });
  setStaple(s, '生抽', true, now());
  const res = addRecipeToList(s, r, { listId: L, servings: 4, keys: [keyOf(r, '五花肉'), keyOf(r, '生抽')], staples: { 盐: true, 生抽: false }, source: 'a:1' }, now());
  assert.deepEqual([res.added, res.updated], [2, 0]);
  assert.deepEqual(s.data.items[itemId(s, L, '五花肉')].needs, { 'a:1': { qty: 1000, unit: 'g', label: '红烧肉', recipeId: 'r_1' } });
  assert.equal(s.data.items[itemId(s, L, '盐')], undefined, '没勾的不加');
  assert.deepEqual([isStaple(s, '盐'), isStaple(s, '生抽')], [true, false]);
  addRecipeToList(s, r, { listId: L, keys: [keyOf(r, '五花肉')], source: 'a:2' }, now());
  assert.equal(totalLabel(s.data.items[itemId(s, L, '五花肉')]), '1500 g', '两次是两份');
  assert.deepEqual(addRecipeToList(s, r, { listId: L, keys: [], staples: { 盐: false }, source: 'a:3' }, now()), { added: 0, updated: 0, ids: [] });
  assert.equal(isStaple(s, '盐'), false, '一样没勾也记下常备品');
  assert.equal(addRecipeToList(s, r, { listId: 'l_nope', keys: [keyOf(r, '五花肉')], source: 'a:4' }, now()), null);
});

test('能加到哪些清单：首页上的食材清单（归档、删除、一般清单不算）；默认给了的 → 「食材」→ 第一张；一张都没有 → null', () => {
  const s = seeded();
  s.data.lists.l_week = normalizeRecord('lists', { id: 'l_week', name: '这周', kind: 'grocery', order: -1, updatedAt: T0 });
  s.data.lists.l_old = normalizeRecord('lists', { id: 'l_old', name: '旧的', kind: 'grocery', order: 3, archived: true, updatedAt: T0 });
  assert.deepEqual(groceryLists(s).map(l => l.id), ['l_week', 'l_groceries']);
  assert.equal(defaultTarget(s), 'l_groceries');
  assert.equal(defaultTarget(s, 'l_week'), 'l_week');
  assert.equal(defaultTarget(s, 'l_tobuy'), 'l_groceries', '一般清单不行');
  s.data.lists.l_groceries = { ...s.data.lists.l_groceries, archived: true };
  assert.equal(defaultTarget(s), 'l_week');
  s.data.lists.l_week = deletedRecord(s.data.lists.l_week, T0 + 9);
  assert.equal(defaultTarget(s), null);
});

// ---------- 整理和合并 ----------
test('整理食谱：字段补齐，几人份 ≤ 0 → null；食材不是对象的扔掉，key 缺了 / 重了按位置补（每台设备一样），数量 ≤ 0 → null；不认识的字段原样', () => {
  const r = normalizeRecord('recipes', { id: 'r_1', name: '红烧肉', servings: '0', updatedAt: '5', future: 1,
    ings: [{ key: 'a', name: '五花肉', qty: '500', unit: 'g', extra: 'x' }, 'bad', { key: 'a', name: '冰糖', qty: -1 }, { name: '盐', optional: 'yes' }, { key: 'g_2', name: '葱' }] });
  assert.deepEqual([r.name, r.servings, r.steps, r.source, r.note, r.updatedAt, r.future], ['红烧肉', null, '', '', '', 5, 1]);
  assert.deepEqual(r.ings.map(g => [g.key, g.name, g.qty, g.unit, g.note, g.optional]),
    [['a', '五花肉', 500, 'g', '', false], ['g_1', '冰糖', null, '', '', false], ['g_2_1', '盐', null, '', '', false], ['g_2', '葱', null, '', '', false]]);
  assert.equal(r.ings[0].extra, 'x');
  assert.equal(canon(normalizeRecord('recipes', r)), canon(r), '可重复整理');
  assert.deepEqual(normalizeRecord('recipes', { id: 'r_2', ings: 'nope' }).ings, []);
  const st = normalizeState({ data: { recipes: { r_3: { name: 'x', updatedAt: 1 }, 'bad id': { name: 'y' }, r_4: 'nope' } } });
  assert.deepEqual(Object.keys(st.data.recipes), ['r_3']);
});

test('合并食谱：整条取较新的（食材的顺序、拿掉的行不会被旧的补回来），删除比旧的修改新就还是删除；顺序无关', () => {
  const a = normalizeState({ data: { recipes: { r_1: { id: 'r_1', name: '红烧肉', ings: [{ key: 'g_a', name: '五花肉' }, { key: 'g_b', name: '冰糖' }], createdAt: 1, updatedAt: 10 } } } });
  const b = normalizeState({ data: { recipes: { r_1: { id: 'r_1', name: '红烧肉（少糖）', ings: [{ key: 'g_a', name: '五花肉' }], createdAt: 1, updatedAt: 20 } } } });
  const m = mergeStates(a, b);
  assert.deepEqual([m.data.recipes.r_1.name, m.data.recipes.r_1.ings.length], ['红烧肉（少糖）', 1]);
  assert.equal(canon(mergeStates(b, a)), canon(m));
  const del = structuredClone(a);
  del.data.recipes.r_1 = deletedRecord(a.data.recipes.r_1, 30);
  assert.equal(mergeStates(b, del).data.recipes.r_1.deleted, true);
});
