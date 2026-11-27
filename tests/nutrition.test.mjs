// 内置营养表（src/data/nutrition.js，第 14 步）和它的查法（src/core/nutrition.js）：
// 数据本身对不对（id 不重复、一个名字只给一样、数在合理的范围里、热量和三大营养素对得上、单位克数是正的、和对照表一致），
// 认名字（简体、繁体、英文、包含的、不该认的不认：鸡蛋面不是鸡蛋、小番茄不是一个番茄、鱼豆腐不是豆腐），
// 单位换成克（自己的单位重量、只往一样大或更小的单位退、斤两、毫升按密度、认不出的说为什么），别名的单位重量说得通（小米辣一个几克，不是 45 g）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NUTRITION, NUTRITION_SOURCE, NUTRITION_INPUT } from '../src/data/nutrition.js';
import { findFood, foodById, gramsFor, normUnit, GENERIC_UNITS, EXACT_ONLY, PREFIX_WORDS, LOOKALIKES } from '../src/core/nutrition.js';
import { normName } from '../src/core/store.js';
import { MAP } from '../tools/nutrition-map.mjs';
import { inputHash } from '../tools/build-nutrition.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** 表里的一样（按名字找，找不到直接失败） @param {string} name */
const food = name => { const f = findFood(name); assert.ok(f, `表里应该有「${name}」`); return /** @type {NonNullable<typeof f>} */ (f); };
const UNIT_KEYS = ['杯', '勺', '小勺', '片', '瓣', '根', '块', '把', '张', '朵', '个', '条', '包'];

// 热量和 4·蛋白质 + 4·碳水 + 9·脂肪 差得多、但没错的（USDA 的热量是按每样食物自己的系数算的）：
const KCAL_EXPLAINED = {
  alcohol: ['料酒', '啤酒', '红酒', '白葡萄酒', '烈酒', '白酒', '香草精'],   // 酒精一克 7 千卡，不在三样里
  fiber: ['可可粉', '紫菜', '香叶', '香菜籽', '咖喱粉', '胡椒粉', '辣椒面', '鼠尾草', '干百里香', '八角', '墨西哥辣椒粉', '桂皮', '丁香', '牛至', '红椒粉', '百里香', '酵母'],   // 香料、可可的碳水大半是纤维
  other: ['泡打粉'],   // 泡打粉的「碳水」是淀粉和酸式盐
};

test('数据：来源、按 id 排、id 不重复、文件不大', () => {
  assert.equal(NUTRITION_SOURCE.attribution, 'U.S. Department of Agriculture, Agricultural Research Service. FoodData Central (SR Legacy, 2018).');
  assert.match(NUTRITION_SOURCE.license, /CC0/);
  assert.ok(NUTRITION.length >= 400 && NUTRITION.length <= 600, `${NUTRITION.length} 样`);
  const ids = NUTRITION.map(f => f.id);
  assert.equal(new Set(ids).size, ids.length, 'id 重复');
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b), '按 id 排（生成的结果是确定的）');
  for (const id of ids) assert.ok(Number.isInteger(id) && id > 0, `id ${id}`);
  const size = fs.statSync(path.join(root, 'src/data/nutrition.js')).size;
  assert.ok(size < 150 * 1024, `nutrition.js 有 ${(size / 1024).toFixed(1)} KB，离线缓存每次都要下载`);
});

test('数据：名字是简体、整理过的写法，英文小写；一个名字（normName 以后）只给一样', () => {
  /** @type {Map<string, number>} */
  const owner = new Map();
  for (const f of NUTRITION) {
    assert.ok(f.zh.length >= 1, `${f.id} 没有中文名`);
    assert.ok(f.en.length >= 1, `${f.id} 没有英文名`);
    for (const n of [...f.zh, ...f.en]) {
      assert.equal(typeof n, 'string');
      assert.equal(normName(n), n, `「${n}」（${f.id}）要写成 normName 的样子：简体、小写、没有多余的空白`);
      const prev = owner.get(n);
      assert.ok(prev === undefined || prev === f.id, `「${n}」同时给了 ${prev} 和 ${f.id}`);
      owner.set(n, f.id);
    }
    assert.equal(new Set([...f.zh, ...f.en]).size, f.zh.length + f.en.length, `${f.id} 的名字有重复`);
    for (const n of [...f.zh, ...f.en]) assert.equal(findFood(n), f, `表里的「${n}」要认成它自己那一样（和 LOOKALIKES、EXACT_ONLY 不冲突）`);
  }
});

test('数据：每 100 g 的数在合理的范围里，热量和三大营养素对得上（对不上的写了原因）', () => {
  const explained = new Set(Object.values(KCAL_EXPLAINED).flat());
  for (const n of explained) assert.ok(NUTRITION.some(f => f.zh[0] === n), `KCAL_EXPLAINED 里的「${n}」不在表里了`);
  for (const f of NUTRITION) {
    const { kcal, protein, carbs, fat } = f.per100;
    assert.ok(Number.isInteger(kcal) && kcal >= 0 && kcal <= 902, `${f.zh[0]} ${kcal} 千卡`);
    for (const g of [protein, carbs, fat]) assert.ok(g >= 0 && g <= 100 && Math.round(g * 10) / 10 === g, `${f.zh[0]} ${g} g`);
    assert.ok(protein + carbs + fat <= 100.5, `${f.zh[0]} 三样加起来超过 100 g`);
    const calc = 4 * protein + 4 * carbs + 9 * fat;
    const ok = Math.abs(kcal - calc) <= Math.max(20, kcal * 0.2);
    if (explained.has(f.zh[0])) assert.ok(!ok, `「${f.zh[0]}」已经对得上了，从 KCAL_EXPLAINED 里拿掉`);
    else assert.ok(ok, `${f.zh[0]}（${f.id}）${kcal} 千卡，按三样算是 ${calc.toFixed(0)}`);
  }
});

test('数据：单位的克数是正数，只有认得的那几个单位；密度 0.3–2 或 null；note 写的是用了什么代替', () => {
  const KEYS = ['id', 'zh', 'en', 'per100', 'grams', 'density', 'volume', 'note'];
  for (const f of NUTRITION) {
    for (const k of Object.keys(f)) assert.ok(KEYS.includes(k), `${f.zh[0]} 多了「${k}」`);
    if ('volume' in f) {
      assert.equal(f.volume, false);
      assert.equal(f.density, null, `${f.zh[0]} 按体积量没有意义，不该有密度`);
      for (const u of ['杯', '勺', '小勺']) assert.equal(f.grams[u], undefined, `${f.zh[0]} 按体积量没有意义，不该有「${u}」`);
    }
    for (const [u, g] of Object.entries(f.grams)) {
      assert.ok(UNIT_KEYS.includes(u), `${f.zh[0]} 的单位「${u}」gramsFor 不认`);
      assert.ok(typeof g === 'number' && Number.isFinite(g) && g > 0, `${f.zh[0]} 一${u} ${g} g`);
    }
    assert.ok(f.density === null || (f.density >= 0.3 && f.density <= 2), `${f.zh[0]} 密度 ${f.density}`);
    if ('note' in f) assert.match(String(f.note), /^approximation: /, `${f.zh[0]} 的 note`);
  }
  // 几个一看就知道对不对的
  assert.equal(food('鸡蛋').grams.个, 50);
  assert.equal(food('蒜').grams.瓣, 3);
  assert.equal(food('盐').grams.小勺, 6);
  assert.equal(food('黄油').grams.条, 113);
  assert.equal(food('牛奶').density, 1.03);
  assert.equal(food('鸡翅').grams.个, undefined, 'USDA 的「1 piece」连骨头，对照表里拿掉了');
});

test('数据和对照表一致：改了 tools/nutrition-map.mjs 要重新生成（node tools/build-nutrition.mjs <CSV 目录>）', () => {
  assert.equal(NUTRITION_INPUT, inputHash(MAP), '对照表或 UNIT_RULES 改过了，src/data/nutrition.js 没有重新生成');
  assert.equal(NUTRITION.length, MAP.length);
  for (const m of MAP) {
    const f = foodById(m.fdc);
    assert.ok(f, `对照表里的 ${m.fdc}（${m.zh[0]}）不在 nutrition.js 里`);
    assert.deepEqual(f.zh, [...new Set(m.zh)], `${m.fdc} 的中文名`);
    assert.deepEqual(f.en, [...new Set(m.en)], `${m.fdc} 的英文名`);
    assert.equal(f.note, m.note, `${m.fdc} 的 note`);
    for (const [u, w] of Object.entries(m.units || {})) {
      if (w === null) assert.equal(f.grams[u], undefined, `${m.zh[0]} 的「${u}」应该拿掉了`);
      else assert.ok(f.grams[u] > 0, `${m.zh[0]} 的「${u}」是对照表指定的（${w}），nutrition.js 里没有`);
    }
    assert.equal(f.volume, m.volume, `${m.fdc} 的 volume`);
  }
});

test('常用的中式食材、调料都认得', () => {
  const MUST = [
    '五花肉', '里脊', '猪肉馅', '排骨', '牛腩', '牛腱', '肥牛', '鸡胸肉', '鸡腿', '鸡翅', '鸭', '羊肉', '虾', '鱿鱼', '三文鱼', '鳕鱼', '带鱼',
    '大白菜', '小白菜', '青菜', '菠菜', '生菜', '油麦菜', '空心菜', '韭菜', '芹菜', '香菜', '葱', '洋葱', '蒜', '姜', '辣椒', '青椒', '茄子', '黄瓜',
    '番茄', '土豆', '红薯', '胡萝卜', '白萝卜', '冬瓜', '苦瓜', '南瓜', '莲藕', '竹笋', '豆芽', '西兰花', '花菜', '玉米', '豌豆', '毛豆', '香菇',
    '金针菇', '杏鲍菇', '木耳', '海带', '豆腐', '嫩豆腐', '老豆腐', '豆浆', '腐竹', '豆干', '鸡蛋', '牛奶', '米饭', '大米', '糯米', '面条', '挂面',
    '米粉', '粉丝', '面粉', '玉米淀粉', '土豆淀粉', '面包', '馒头', '生抽', '老抽', '蚝油', '香醋', '陈醋', '米醋', '白糖', '冰糖', '红糖', '盐',
    '味精', '香油', '花生油', '植物油', '猪油', '料酒', '豆瓣酱', '甜面酱', '海鲜酱', '芝麻酱', '花生酱', '辣椒油', '番茄酱', '蜂蜜',
  ];
  const missing = MUST.filter(n => !findFood(n));
  assert.deepEqual(missing, []);
});

test('认名字：简体、繁体（台湾的叫法）、英文，大小写、复数、全角空格都不管', () => {
  const same = (/** @type {string} */ a, /** @type {string} */ b) => assert.equal(findFood(a), food(b), `「${a}」应该是「${b}」`);
  same('雞蛋', '鸡蛋');
  same('醬油', '生抽');
  same('蠔油', '蚝油');
  same('豬肉餡', '猪肉馅');
  same('蔥', '葱');
  same('薑', '姜');
  same('高麗菜', '卷心菜');
  same('馬鈴薯', '土豆');
  same('鮭魚', '三文鱼');
  same('鳳梨', '菠萝');
  same('Eggs', '鸡蛋');
  same('  Soy  Sauce ', '生抽');
  same('scallions', '葱');
  same('蕃茄', '番茄');
  same('柳丁', '橙子');
  same('水梨', '雪梨');
  same('乳酪', '奶酪');
  same('無鹽奶油', '无盐黄油');
  same('有鹽奶油', '黄油');
  same('鯛魚片', '罗非鱼');
  same('醬油 ', '生抽');
  same('jalapeño', '墨西哥辣椒');
  same('Jalapeños', '墨西哥辣椒');
  same('red bell peppers', '红椒');
  same('ＥＧＧ', '鸡蛋');
  assert.equal(findFood(''), null);
  assert.equal(findFood(null), null);
  assert.equal(findFood(12), null);
  assert.equal(findFood('不是吃的东西'), null);
});

test('认名字：包含的最长的、后面只能是切法和说明（中文英文都是后面的词说了算）', () => {
  const is = (/** @type {string} */ a, /** @type {string} */ b) => assert.equal(findFood(a), food(b), `「${a}」应该是「${b}」`);
  is('五花肉片', '五花肉');
  is('去皮鸡胸肉', '鸡胸肉');
  is('鸡胸肉丁', '鸡胸肉');
  is('土豆泥', '土豆');
  is('牛腩肉', '牛腩');
  is('鲜香菇', '香菇');
  is('冷冻虾仁', '虾');
  is('花生碎', '花生');
  is('鸡蛋（打散）', '鸡蛋');
  is('小葱段', '葱');
  is('葱花', '葱');
  is('蒜末', '蒜');
  is('姜丝', '姜');
  is('葱（切段）', '葱');
  is('糖块', '白糖');
  is('extra firm tofu', '老豆腐');
  is('boneless skinless chicken breasts', '鸡胸肉');
  is('garlic, minced', '蒜');
  is('fresh basil leaves', '罗勒');
  is('salt to taste', '盐');
  is('cilantro for garnish', '香菜');
  is('green onions (sliced)', '葱');
  is('jalapeno peppers', '墨西哥辣椒');
  // 逗号、括号前面那段是名字，后面是说明；前面那段认不出才看整段
  is('ham, pork', '火腿');
  is('garlic, ginger', '蒜');
  is('鸡蛋，牛奶', '鸡蛋');
  is('牛肉、土豆', '牛肉');
  is('鸡胸肉，或鸡腿肉', '鸡胸肉');
  is('(optional) cilantro', '香菜');
  // 只认整个名字的，去掉前后的切法、说明再比
  is('flour, sifted', '面粉');
  is('milk, warmed', '牛奶');
  is('rice, rinsed', '大米');
  is('cheese, grated', '奶酪');
  is('pepper to taste', '胡椒粉');
  is('melted butter', '黄油');
  is('cold butter, cubed', '黄油');
  is('bacon strips', '培根');
  is('freshly ground pepper', '胡椒粉');
  // 本来就有的写法不受「小」「干」开头的影响
  is('小葱段', '葱');
  is('小青菜', '小白菜');
  is('干辣椒段', '辣椒面');
  is('干辣椒面', '辣椒面');
  is('干香菇', '干香菇');
  is('baby spinach', '菠菜');
  is('baby carrots', '小胡萝卜');
  is('茴香籽', '小茴香');
});

test('认名字：不该认的不认——后面还有别的字、单字的名字在中间、太笼统的英文', () => {
  const not = (/** @type {string} */ a, /** @type {string | null} */ b = null) => {
    const f = findFood(a);
    if (b === null) assert.equal(f, null, `「${a}」不该认成「${f && f.zh[0]}」`);
    else assert.equal(f, food(b), `「${a}」应该是「${b}」，不是包含的那个`);
  };
  not('鸡蛋面', '鸡蛋面');
  assert.notEqual(findFood('鸡蛋面'), food('鸡蛋'));
  not('番茄酱', '番茄酱');
  not('椰子油', '椰子油');
  not('芝麻油', '香油');
  not('芝麻菜', '芝麻菜');
  not('花生油', '花生油');
  not('玉米淀粉', '玉米淀粉');
  not('柠檬汁', '柠檬汁');
  not('鸡汤块', '鸡精');
  not('egg noodles', '鸡蛋面');
  not('番茄炒蛋');
  not('牛肉丸');
  not('鸡肉丸');
  not('油条');
  not('虾米');
  not('豆腐乳', '腐乳');
  not('猪肉白菜饺子');
  not('柠檬皮');
  not('egg wash');
  not('oat milk');
  not('feta cheese');
  not('almond flour');
  not('fried rice');
  not('chili crisp');
  // 小的品种：一个的重量差好几倍，宁可认不出（第 15 步让人指定、自己填一个多重）
  for (const n of ['小番茄', '小西红柿', '樱桃番茄', '圣女果', 'cherry tomatoes', 'cherry tomato', 'grape tomatoes', '小土豆', '小黄瓜', '迷你黄瓜', 'baby potatoes',
    'baby corn', 'pearl onions', 'mini cucumbers', '砂糖橘']) not(n);
  // 干的、腌的、熏的、卤的：每 100 g 差好几倍
  for (const n of ['干豆腐', '干鱿鱼', '干虾仁', '干海带', '腌萝卜', '熏鱼豆腐', '酱牛肉', '卤牛肉', 'dried apricots', 'sun-dried tomatoes', 'dried mango',
    'freeze-dried strawberries', 'smoked salmon', 'smoked tofu', 'candied ginger', 'pickled ginger']) not(n);
  // 看着包含表里的名字、其实是别的东西
  for (const n of ['鱼豆腐', '杏仁豆腐', '鸡蛋豆腐', '日本豆腐', '臭豆腐', '水淀粉', '贝贝南瓜', '板栗南瓜', '日本南瓜', 'kabocha', 'salt pork', '千张', '百叶', '豆腐皮',
    '豆皮', '椰汁', '香肠', '腊肠', 'chinese sausage', '鸡柳', '鸭腿', '炒面']) not(n);
  // 太笼统的英文前面是别的食物：tuna steak 不是牛排
  for (const n of ['tuna steak', 'salmon steak', 'ham steak', 'turkey bacon', 'chicken sausage', 'turkey sausage', 'apple butter', 'cocoa butter',
    'vegetable stock', 'vegetable broth', 'banana chips']) not(n);
  for (const w of EXACT_ONLY) assert.ok(findFood(w), `「${w}」整个名字照样认`);
  for (const n of LOOKALIKES) assert.equal(findFood(n), null, `LOOKALIKES 的「${n}」认不出`);
  assert.ok(PREFIX_WORDS.zh.includes('小') && PREFIX_WORDS.en.has('dried'));
});

test('认名字：小的品种、近似的那几样用的是自己的一条，不是大的那一样的「个」', () => {
  assert.equal(food('小米辣').grams.个, 6.1, '小米辣按 serrano 一个 6.1 g，不是一个美国辣椒 45 g');
  assert.equal(food('朝天椒'), food('小米辣'));
  assert.ok(gramsFor(food('小米辣'), 5, '个').grams < 50);
  assert.equal(gramsFor(food('杭椒'), 2, '根').reason, 'weight', '杭椒、线椒一根十几克，没有说得准的「个」');
  assert.equal(gramsFor(food('辣椒'), 2, '个').reason, 'weight');
  assert.equal(gramsFor(food('小胡萝卜'), 10, '根').grams, 100, 'baby carrots 一根 10 g');
  assert.equal(food('胡萝卜').grams.根, 61);
  assert.equal(findFood('鸡大腿')?.id, 172385, '鸡大腿是大腿（thigh），不是连着背的整条腿');
  assert.equal(gramsFor(food('鸡腿'), 2, '个').reason, 'weight', '「1 leg」344 g 连着背上那块，不给「个」');
  assert.equal(gramsFor(food('牛排'), 1, '块').reason, 'weight', '一整块美国丁骨 461 g 不是一块牛排');
  assert.equal(gramsFor(food('牛小排'), 1, '块').reason, 'weight');
  assert.equal(gramsFor(food('玉米'), 1, '根').grams, 102, '一根中等的玉米能吃的部分（ear, medium … yields），不是 small 的 73 g');
  assert.equal(food('燕麦片').grams.杯, 81, '压扁的燕麦片一杯 81 g');
  assert.equal(food('燕麦').grams.杯, 156, '整粒的燕麦一杯 156 g');
  assert.notEqual(food('燕麦片'), food('燕麦'));
  assert.equal(food('千岛酱').per100.kcal, 379, '千岛酱有自己的一条，不是蛋黄酱（680）');
  assert.equal(findFood('thousand island dressing'), food('千岛酱'));
  assert.ok(food('山药').per100.kcal < 80, '山药按 mountain yam（67），不是热带的 yam（118）');
  assert.ok(food('腊肉').per100.kcal < 600, '腊肉按猪五花（518），不是 salt pork（748）');
  assert.ok(food('黄鳝').per100.fat < 3, '黄鳝很瘦，不按鳗鱼');
  assert.ok(food('黄豆芽').per100.kcal < 60, '黄豆芽按豆芽，不按发了芽的黄豆（122）');
  assert.ok(food('甜辣酱').per100.carbs > 30, '甜辣酱大半是糖，不按是拉差');
  assert.ok(food('白酒').per100.kcal > 280, '白酒按 100 proof');
  assert.equal(food('菠萝').grams.片, 84, '一片菠萝是 3-1/2" 的那种');
  // 紫菜：每 100 g 按螺旋藻粉近似，按体积量没有意义
  const nori = food('紫菜');
  assert.equal(nori.volume, false);
  for (const u of ['杯', '勺', '小勺', 'ml', '碗']) assert.deepEqual(gramsFor(nori, 1, u), { grams: null, reason: 'weight', guess: false }, u);
  assert.equal(gramsFor(nori, 5, 'g').grams, 5);
});

test('认名字：规则本身（编出来的小表）：分隔符前面那段、一样长取靠后的、英文按整个词、y → ies、前面说大小做法的不算', () => {
  const per100 = { kcal: 1, protein: 0, carbs: 0, fat: 0 };
  /** @type {import('../src/data/nutrition.js').NutritionFood[]} */
  const table = [
    { id: 1, zh: ['白菜'], en: ['berry'], per100, grams: {}, density: null },
    { id: 2, zh: ['猪肉'], en: ['pork'], per100, grams: {}, density: null },
    { id: 3, zh: ['盐'], en: ['corn'], per100, grams: {}, density: null },
    { id: 4, zh: ['肉片'], en: ['bean'], per100, grams: {}, density: null },
  ];
  assert.equal(findFood('berries', table)?.id, 1);
  assert.equal(findFood('strawberry', table), null, '不是整个词');
  assert.equal(findFood('popcorn', table), null);
  assert.equal(findFood('sweet corn', table)?.id, 3);
  assert.equal(findFood('pork, corn', table)?.id, 2, '逗号后面是说明，前面的才是名字（pork 比 corn 长也一样）');
  assert.equal(findFood('corn, pork', table)?.id, 3, '前面那段短的也是它');
  assert.equal(findFood('bean (or pork)', table)?.id, 4);
  assert.equal(findFood('猪肉片', table)?.id, 4, '一样长（猪肉、肉片后面都只剩切法）取靠后的');
  assert.equal(findFood('白菜猪肉', table)?.id, 2, '白菜后面还有字，不算');
  assert.equal(findFood('猪肉白菜', table)?.id, 1);
  assert.equal(findFood('盐粒', table)?.id, 3);
  assert.equal(findFood('椒盐', table), null, '单字的只认开头');
  assert.equal(findFood('盐焗鸡', table), null);
  assert.equal(findFood('小白菜', table), null, '「小」开头的是小的品种');
  assert.equal(findFood('干白菜', table), null, '「干」开头的是干的');
  assert.equal(findFood('dried berries', table), null);
  assert.equal(findFood('sun-dried corn', table), null);
  assert.equal(findFood('baby corn', table), null);
  assert.equal(findFood('fresh berries', table)?.id, 1, '别的形容词照旧（后面的词说了算）');
  assert.equal(findFood('鱼豆腐', table), null, 'LOOKALIKES 换了表也认不出');
});

test('foodById：内置表的 id；foods 的 ref 存的是字符串，也认', () => {
  const egg = food('鸡蛋');
  assert.equal(foodById(egg.id), egg);
  assert.equal(foodById(String(egg.id)), egg);
  for (const bad of [-1, 0, '', ' 171287', '171287.0', '0171287', null, undefined, {}, [egg.id]]) assert.equal(foodById(bad), null, JSON.stringify(bad));
});

test('gramsFor：这一样自己的单位重量优先，同义的单位（颗、只、条、cloves、大匙）也认', () => {
  const egg = food('鸡蛋'), salt = food('盐'), garlic = food('蒜'), cucumber = food('黄瓜'), butter = food('黄油'), soy = food('生抽');
  assert.deepEqual(gramsFor(egg, 3, '个'), { grams: 150, reason: null, guess: false });
  assert.equal(gramsFor(egg, 2, '').grams, 100, '没写单位就是几个');
  assert.equal(gramsFor(egg, 2, '颗').grams, 100);
  assert.equal(gramsFor(egg, 2, '顆').grams, 100);
  assert.equal(gramsFor(egg, 2, '個').grams, 100);
  assert.equal(gramsFor(egg, 1.5, 'large').grams, 75);
  assert.equal(gramsFor(salt, 1, '勺').grams, 18, '一勺盐 18 g（USDA），不是 15 ml × 密度');
  assert.equal(gramsFor(salt, 1, '大匙').grams, 18);
  assert.equal(gramsFor(salt, 2, '小匙').grams, 12);
  assert.equal(gramsFor(salt, 1, 'tsp').grams, 6);
  assert.equal(gramsFor(salt, 1, 'Tbsp.').grams, 18);
  assert.equal(gramsFor(garlic, 3, 'cloves').grams, 9);
  assert.equal(gramsFor(garlic, 3, '瓣').grams, 9);
  assert.equal(gramsFor(cucumber, 1, '条').grams, cucumber.grams.根, '一条黄瓜是一根');
  assert.equal(gramsFor(butter, 1, '条').grams, 113);
  assert.equal(gramsFor(soy, 2, 'tbsp').grams, 32);
  assert.equal(gramsFor({ grams: { 个: 30 }, density: null }, 2, '个').grams, 60, '自己填的（foods）也是一样的形状');
});

test('gramsFor：只往一样大或者更小的单位退——一块西瓜不是一整个、一棵芹菜不是一根、一朵花菜不是一整颗', () => {
  const melon = food('西瓜'), waxgourd = food('冬瓜'), celery = food('芹菜'), cauli = food('花菜'), broccoli = food('西兰花'), shiitake = food('香菇');
  assert.equal(gramsFor(melon, 1, '块').grams, 286, 'USDA 的 wedge（1/16 个）');
  assert.ok(gramsFor(melon, 1, '个').grams > 4000);
  assert.deepEqual(gramsFor(waxgourd, 1, '块'), { grams: null, reason: 'weight', guess: false }, '冬瓜没有「块」，不退成一整个 5.7 kg');
  for (const f of NUTRITION) {
    const big = f.grams.个;
    if (big && !f.grams.块) assert.equal(gramsFor(f, 1, '块').grams, null, `${f.zh[0]} 的「块」不能退成「个」`);
  }
  assert.equal(gramsFor(food('番茄'), 1, '块').grams, 31, '一块番茄是 1/4 个');
  assert.deepEqual(gramsFor(celery, 1, '棵'), { grams: null, reason: 'weight', guess: false }, '一棵芹菜不是一根的 40 g');
  assert.equal(gramsFor(celery, 2, '根').grams, 80);
  assert.equal(gramsFor(food('葱'), 1, '棵').grams, 15, '葱有「个」：一棵葱就是一根');
  assert.equal(gramsFor(cauli, 3, '朵').grams, 39, '花菜一小朵 13 g');
  assert.ok(gramsFor(cauli, 1, '个').grams > 500);
  assert.equal(gramsFor(broccoli, 1, '朵').reason, 'weight');
  assert.equal(gramsFor(cauli, 2, 'florets').grams, 26);
  assert.equal(gramsFor(shiitake, 3, '朵').grams, 57, '香菇没有「朵」，一朵就是一个');
  assert.equal(gramsFor(food('黄瓜'), 1, '条').grams, 301, '一条黄瓜是一根');
});

test('gramsFor：台湾和美国的写法——公克、cc、公升、台斤、台两、qt、pint、gal、fl oz', () => {
  const pork = food('五花肉'), milk = food('牛奶');
  assert.equal(gramsFor(pork, 300, '公克').grams, 300);
  assert.equal(gramsFor(pork, 1, '台斤').grams, 600);
  assert.equal(gramsFor(pork, 1, '臺斤').grams, 600);
  assert.equal(gramsFor(pork, 2, '台两').grams, 75);
  assert.equal(gramsFor(pork, 1, '斤').grams, 500, '只写「斤」按 500 g（看不出是哪里写的）');
  assert.equal(gramsFor(milk, 200, 'cc').grams, 206);
  assert.equal(gramsFor(milk, 200, 'CC').grams, 206);
  assert.equal(gramsFor(milk, 1, '公升').grams, 1030);
  assert.equal(gramsFor(milk, 1, 'qt').grams, 974.8);
  assert.equal(gramsFor(milk, 1, 'pint').grams, 487.4);
  assert.equal(gramsFor(milk, 1, 'gal').grams, 3899);
  assert.equal(gramsFor(milk, 2, 'fl oz').grams, 60.9);
  assert.equal(gramsFor(food('生抽'), 2, '大匙').grams, 32);
  assert.equal(gramsFor(food('盐'), 1, '小匙').grams, 6);
});

test('gramsFor：重量单位直接换；体积按这一样的密度，不知道密度的按 1 g/ml 并标成猜的', () => {
  const pork = food('五花肉'), milk = food('牛奶'), sugar = food('白糖'), rice = food('米饭');
  assert.equal(gramsFor(pork, 1, '斤').grams, 500);
  assert.equal(gramsFor(pork, 2, '两').grams, 100);
  assert.equal(gramsFor(pork, 2, '兩').grams, 100);
  assert.equal(gramsFor(pork, 0.5, 'kg').grams, 500);
  assert.equal(gramsFor(pork, 1, '公斤').grams, 1000);
  assert.equal(gramsFor(pork, 1, 'lb').grams, 453.6);
  assert.equal(gramsFor(pork, 2, 'lbs').grams, 907.2);
  assert.equal(gramsFor(pork, 4, 'oz').grams, 113.4);
  assert.equal(gramsFor(pork, 250, 'G').grams, 250);
  assert.equal(gramsFor(pork, 250, '克').grams, 250);
  assert.deepEqual(gramsFor(milk, 100, 'ml'), { grams: 103, reason: null, guess: false });
  assert.equal(gramsFor(milk, 1, 'L').grams, 1030);
  assert.equal(gramsFor(milk, 200, '毫升').grams, 206);
  assert.equal(gramsFor(sugar, 1, '勺').grams, Math.round(15 * /** @type {number} */ (sugar.density) * 10) / 10, '没有 USDA 的一勺：15 ml × 密度');
  assert.equal(gramsFor(rice, 1, '碗').grams, Math.round(250 * /** @type {number} */ (rice.density) * 10) / 10);
  assert.equal(gramsFor(rice, 1, '杯').grams, rice.grams.杯);
  assert.equal(pork.density, null);
  assert.deepEqual(gramsFor(pork, 100, 'ml'), { grams: 100, reason: null, guess: true });
  assert.deepEqual(gramsFor(null, 1, '斤'), { grams: 500, reason: null, guess: false });
  assert.deepEqual(gramsFor(undefined, 2, '勺'), { grams: 30, reason: null, guess: true });
  for (const [u, v] of Object.entries(GENERIC_UNITS)) assert.equal(normUnit(u), u, `GENERIC_UNITS 的「${u}」要写成 normUnit 的样子`), assert.ok((v.g || 0) > 0 || (v.ml || 0) > 0);
});

test('gramsFor：换算不了的说为什么——没写数量、这一样没有单位重量、认不出的单位', () => {
  const cilantro = food('香菜'), tofu = food('豆腐');
  for (const q of [null, undefined, 0, -1, NaN, Infinity, '2']) assert.deepEqual(gramsFor(cilantro, q, '克'), { grams: null, reason: 'qty', guess: false }, String(q));
  assert.deepEqual(gramsFor(cilantro, 2, '根'), { grams: null, reason: 'weight', guess: false });
  assert.deepEqual(gramsFor(food('盐'), 1, ''), { grams: null, reason: 'weight', guess: false }, '「盐 1」不知道一个是多少');
  assert.deepEqual(gramsFor(tofu, 1, '盒'), { grams: null, reason: 'unit', guess: false });
  assert.deepEqual(gramsFor(tofu, 1, '撮'), { grams: null, reason: 'unit', guess: false });
  for (const u of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    assert.deepEqual(gramsFor(tofu, 1, u), { grams: null, reason: 'unit', guess: false }, `「${u}」不能摸到原型上`);
  }
  assert.deepEqual(gramsFor({ grams: { 个: -5, 根: 0 } }, 1, '个'), { grams: null, reason: 'weight', guess: false }, '不是正数的单位重量不算');
});
