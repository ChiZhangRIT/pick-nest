// 快速添加的解析（core/parse.js）：数量在前 / 在后、中文数字、单位、一般清单不拆光秃秃的数字、认不出就整句当名字。全是编的例子
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuickAdd, readQty, stepQty, formatQty, qtyLabel, isUnit, cnNumber, UNITS, UNIT_SUGGESTIONS, QTY_MAX } from '../src/core/parse.js';

const P = (text, kind = 'grocery') => { const r = parseQuickAdd(text, { kind }); return [r.name, r.qty, r.unit]; };

test('README 里的四个例子', () => {
  assert.deepEqual(P('牛奶'), ['牛奶', null, '']);           // 没写数量：null，加的时候用默认的 1
  assert.deepEqual(P('鸡蛋 12'), ['鸡蛋', 12, '']);
  assert.deepEqual(P('2 牛奶'), ['牛奶', 2, '']);
  assert.deepEqual(P('面粉 1袋'), ['面粉', 1, '袋']);
});

test('数字在前：空格、单位、x；中文数字只在单位前面才算', () => {
  const table = [
    ['2盒牛奶', ['牛奶', 2, '盒']], ['两盒牛奶', ['牛奶', 2, '盒']], ['半斤肉', ['肉', 0.5, '斤']], ['一斤半排骨', ['排骨', 1.5, '斤']],
    ['十个鸡蛋', ['鸡蛋', 10, '个']], ['二十四瓶水', ['水', 24, '瓶']], ['2 lb beef', ['beef', 2, 'lb']], ['2x 牛奶', ['牛奶', 2, '']],
    ['1/2 cabbage', ['cabbage', 0.5, '']], ['1.5 L 牛奶', ['牛奶', 1.5, 'L']], ['2 gala apples', ['gala apples', 2, '']],
    // 不是数量：中文数字后面不是单位、东西的名字本身以数字开头
    ['五花肉', ['五花肉', null, '']], ['三明治', ['三明治', null, '']], ['四季豆', ['四季豆', null, '']], ['二锅头', ['二锅头', null, '']],
    ['一品鲜酱油', ['一品鲜酱油', null, '']], ['7up', ['7up', null, '']], ['3x3 魔方', ['3x3 魔方', null, '']],
    // 「包子」是一样东西，不拆成「2 包 / 子」
    ['2 包子', ['包子', 2, '']],
  ];
  for (const [text, want] of table) assert.deepEqual(P(text), want, text);
});

test('数字在后：空格、连着汉字、x / ×、单位（中英文，大小写都认）', () => {
  const table = [
    ['鸡蛋12个', ['鸡蛋', 12, '个']], ['鸡蛋 12 个', ['鸡蛋', 12, '个']], ['鸡蛋 x12', ['鸡蛋', 12, '']], ['鸡蛋 ×12', ['鸡蛋', 12, '']],
    ['鸡蛋x12', ['鸡蛋', 12, '']], ['鸡蛋 x 12', ['鸡蛋', 12, '']], ['milk 2 gal', ['milk', 2, 'gal']], ['Milk 2 GAL', ['Milk', 2, 'GAL']],
    ['gala apples 2 lb', ['gala apples', 2, 'lb']], ['牛奶 2L', ['牛奶', 2, 'L']], ['牛奶 1.5 L', ['牛奶', 1.5, 'L']], ['鸡蛋 1/2', ['鸡蛋', 0.5, '']],
    ['肉一斤半', ['肉', 1.5, '斤']], ['肉半斤', ['肉', 0.5, '斤']], ['十三香两包', ['十三香', 2, '包']], ['牛奶，2盒', ['牛奶', 2, '盒']],
    ['eggs 12', ['eggs', 12, '']], ['eggs 1 dozen', ['eggs', 1, 'dozen']],
  ];
  for (const [text, want] of table) assert.deepEqual(P(text), want, text);
});

test('全角数字、繁体单位：比较时折过来，名字和单位按原文保留', () => {
  assert.deepEqual(P('１２ 鸡蛋'), ['鸡蛋', 12, '']);
  assert.deepEqual(P('鸡蛋 １２'), ['鸡蛋', 12, '']);
  assert.deepEqual(P('雞蛋 12個'), ['雞蛋', 12, '個']);
  assert.deepEqual(P('兩盒牛奶'), ['牛奶', 2, '盒']);
  assert.deepEqual(P('  鸡蛋　１２  '), ['鸡蛋', 12, '']);
  // 台湾的写法：公克、公升、台斤（快速添加也认）；cc 只在拆食谱时认（买东西时「鮮奶 936cc」说的是一瓶多大）
  assert.deepEqual(P('豬肉 300公克'), ['豬肉', 300, '公克']);
  assert.deepEqual(P('牛奶 2公升'), ['牛奶', 2, '公升']);
  assert.deepEqual(P('豬肉 1台斤'), ['豬肉', 1, '台斤']);
  assert.deepEqual(P('鮮奶 936cc'), ['鮮奶 936cc', null, '']);
  assert.deepEqual(P('電視 1台'), ['電視', 1, '台'], '「台」照旧');
});

test('一般清单：光秃秃的数字（前后）不算数量，要写单位或 x；食材清单算', () => {
  assert.deepEqual(P('iPhone 15', 'general'), ['iPhone 15', null, '']);
  assert.deepEqual(P('iPhone 15', 'grocery'), ['iPhone', 15, '']);
  assert.deepEqual(P('100 Years of Solitude', 'general'), ['100 Years of Solitude', null, '']);
  assert.deepEqual(P('AA 电池 4', 'general'), ['AA 电池 4', null, '']);
  assert.deepEqual(P('apples 2', 'general'), ['apples 2', null, '']);
  assert.deepEqual(P('袜子 3双', 'general'), ['袜子', 3, '双']);
  assert.deepEqual(P('电池 x4', 'general'), ['电池', 4, '']);
  assert.deepEqual(P('2 本 小说', 'general'), ['小说', 2, '本']);
  // 英文的一般单位：写在后面照常；写在前面要跟着 of（「sheet masks」「set screws」里的词是名字）
  assert.deepEqual(P('socks 3 pairs', 'general'), ['socks', 3, 'pairs']);
  assert.deepEqual(P('paper 10 sheets', 'general'), ['paper', 10, 'sheets']);
  assert.deepEqual(P('screws 2 sets', 'general'), ['screws', 2, 'sets']);
  assert.deepEqual(P('3 pairs of socks', 'general'), ['socks', 3, 'pairs']);
  assert.deepEqual(P('10 sheet masks', 'general'), ['10 sheet masks', null, '']);
  assert.deepEqual(P('2 sheet pans', 'grocery'), ['sheet pans', 2, '']);
  assert.deepEqual(P('2 bags of rice'), ['rice', 2, 'bags'], '单位后面的 of 不算名字');
  assert.deepEqual(P('2 lb of beef', 'general'), ['beef', 2, 'lb']);
});

test('连着字母的数字是名字的一部分；数量超出范围、拆完名字空了：整句当名字', () => {
  for (const text of ['维生素B12', 'V8', 'x12', '12', '两盒', '2 l', '牛奶 一', '鸡蛋 0', '鸡蛋 10000', '鸡蛋 1/0', '0 牛奶'])
    assert.deepEqual(P(text), [text.trim(), null, ''], text);
  assert.deepEqual(P('鸡蛋 9999'), ['鸡蛋', QTY_MAX, '']);
  assert.deepEqual(P('   '), ['', null, '']);
  assert.deepEqual(P(null), ['', null, '']);
  // 名字永远不会是空的
  for (const text of ['x', '×', '2x', '半', '十', '1/2', 'lb', '袋']) assert.ok(parseQuickAdd(text).name, text);
});

test('单位表：编辑面板的快捷选项都认得；isUnit 不分大小写、简繁都认；「两」不是单位', () => {
  for (const [lang, list] of Object.entries(UNIT_SUGGESTIONS)) for (const u of list) assert.ok(isUnit(u), `${lang}: ${u}`);
  for (const u of ['个', '個', 'LB', 'Lb', 'ml', 'mL', 'KG', '盒', 'gal']) assert.ok(isUnit(u), u);
  for (const u of ['两', '', 'abc', '牛奶']) assert.equal(isUnit(u), false, u);
  assert.ok(UNITS.length > 40);
});

test('中文数字', () => {
  assert.deepEqual(['一', '两', '二', '九', '十', '十二', '二十', '二十四', '半', '百', '十十'].map(cnNumber), [1, 2, 2, 9, 10, 12, 20, 24, 0.5, null, null]);
});

test('编辑面板的数量：读输入框、−/+、显示', () => {
  assert.equal(readQty(''), null);
  assert.equal(readQty('  '), null);
  assert.equal(readQty(null), null);
  assert.equal(readQty('3'), 3);
  assert.equal(readQty('１.５'), 1.5);
  assert.equal(readQty('1/3'), 0.333);
  assert.ok(Number.isNaN(readQty('abc')));
  assert.ok(Number.isNaN(readQty('1/0')));
  assert.equal(readQty(7), 7);
  assert.deepEqual([stepQty(null, 1), stepQty(2, 1), stepQty(QTY_MAX, 1), stepQty(0.5, 1)], [1, 3, QTY_MAX, 1.5]);
  assert.deepEqual([stepQty(null, -1), stepQty(1, -1), stepQty(0.5, -1), stepQty(3, -1)], [null, null, null, 2]);
  assert.deepEqual([formatQty(null), formatQty(12), formatQty(0.5), formatQty(1 / 3), formatQty(12000)], ['', '12', '0.5', '0.33', '12000']);
  assert.deepEqual([qtyLabel(null, '盒'), qtyLabel(1, ''), qtyLabel(2, '盒'), qtyLabel(0.5, 'lb')], ['', '1', '2 盒', '0.5 lb']);
});

test('英文单位后面的缩写点（第 16 步检查）：「2 lb. ground beef」「1 Tbsp. oil」；整个词的 pound、ounce 和「朵」只在拆食谱时认', () => {
  assert.deepEqual(parseQuickAdd('2 lb. ground beef'), { name: 'ground beef', qty: 2, unit: 'lb' });
  assert.deepEqual(parseQuickAdd('3 oz. cheese'), { name: 'cheese', qty: 3, unit: 'oz' });
  assert.deepEqual(parseQuickAdd('1 Tbsp. olive oil', { recipe: true }), { name: 'olive oil', qty: 1, unit: 'Tbsp' });
  assert.deepEqual(parseQuickAdd('2 lbs.'), { name: '2 lbs.', qty: null, unit: '' }, '只有数量和单位：整句当名字');
  assert.deepEqual(parseQuickAdd('2 l.a. style ribs'), { name: 'l.a. style ribs', qty: 2, unit: '' }, '点后面不是空格的不是缩写的单位（l 不是升）');
  // 快速添加：「2 pound cakes」是两个磅蛋糕，「一朵花」的朵不是单位
  assert.deepEqual(parseQuickAdd('2 pound cakes'), { name: 'pound cakes', qty: 2, unit: '' });
  assert.deepEqual(parseQuickAdd('一朵花'), { name: '一朵花', qty: null, unit: '' });
  assert.deepEqual(parseQuickAdd('2 pounds beef', { recipe: true }), { name: 'beef', qty: 2, unit: 'pounds' });
  assert.deepEqual(parseQuickAdd('香菇 5朵', { recipe: true }), { name: '香菇', qty: 5, unit: '朵' });
});
