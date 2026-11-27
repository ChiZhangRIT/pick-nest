// 营养数据表的生成脚本（tools/build-nutrition.mjs，第 14 步）：CSV 怎么拆（引号、逗号、换行、块的边界）、四样营养怎么取整、
// USDA 的 portion 怎么换成中文的单位（medium 优先、带核带壳的排后面、量了一个的优先、复数、对照表指定的、按体积量没有意义的）、
// 开头的 BOM、出错时停下、输出是确定的（带着对照表的指纹）。
// 只用 tests/fixtures/sr-legacy-mini 里编出来的几行，不读真的 USDA 数据。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  csvParser, parseCsv, streamCsv, per100Of, portionsOf, firstWord, roundGrams, buildEntries, render, readData, checkNutrientIds, inputHash, SOURCE, UNIT_RULES,
} from '../tools/build-nutrition.mjs';
import { MAP as MINI_MAP } from './fixtures/sr-legacy-mini/map.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MINI = path.join(root, 'tests/fixtures/sr-legacy-mini');
const read = (/** @type {string} */ f) => fs.readFileSync(path.join(MINI, f), 'utf8');
const units = new Map([['1000', 'cup'], ['1029', 'large'], ['9999', 'undetermined']]);
const portionsFor = (/** @type {string} */ id) => parseCsv(read('food_portion.csv')).filter(r => r.fdc_id === id);

test('CSV：双引号里的逗号、"" 引号、换行，\\r\\n，最后一行没有换行，空行不算', () => {
  const rows = parseCsv('"a","b","c"\r\n"1","x, y","say ""hi"""\n"2","two\nlines",""\n\n3,plain,last');
  assert.deepEqual(rows, [
    { a: '1', b: 'x, y', c: 'say "hi"' },
    { a: '2', b: 'two\nlines', c: '' },
    { a: '3', b: 'plain', c: 'last' },
  ]);
  assert.deepEqual(parseCsv(''), []);
  assert.deepEqual(parseCsv('"a","b"\n"1"'), [{ a: '1', b: '' }], '少了的列是空的');
});

test('CSV：一块一块地喂，块的边界落在哪里（引号中间、\\r\\n 中间、"" 中间）结果都一样', () => {
  const text = read('food_nutrient.csv') + read('nutrient.csv');
  const whole = (() => { const p = csvParser(); return [...p.push(text), ...p.end()]; })();
  for (let i = 0; i <= text.length; i++) {
    const p = csvParser();
    assert.deepEqual([...p.push(text.slice(0, i)), ...p.push(text.slice(i)), ...p.end()], whole, `在第 ${i} 个字切开`);
  }
  const p = csvParser();
  const oneByOne = [...text].flatMap(c => p.push(c));
  assert.deepEqual([...oneByOne, ...p.end()], whole, '一个字一个字地喂');
});

test('CSV：开头的 UTF-8 BOM 去掉（不然第一列的列名对不上）；只去开头的那一个', async () => {
  assert.deepEqual(parseCsv('\uFEFF"id","name"\n"1","a\uFEFFb"'), [{ id: '1', name: 'a\uFEFFb' }]);
  const p = csvParser();
  assert.deepEqual([...p.push('\uFEFF'), ...p.push('"id"\n"1"\n'), ...p.end()], [['id'], ['1']], 'BOM 单独一块也行');
  assert.deepEqual([...p.push('\uFEFF"x"\n'), ...p.end()], [['x']], 'end() 以后再用是新的一份');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pn-nutrition-'));
  try {
    for (const f of fs.readdirSync(MINI).filter(f => f.endsWith('.csv'))) fs.writeFileSync(path.join(dir, f), '\uFEFF' + read(f));
    const data = await readData(dir, MINI_MAP);
    assert.deepEqual(buildEntries(MINI_MAP, data), buildEntries(MINI_MAP, await readData(MINI, MINI_MAP)), '每个文件都带 BOM 时结果一样');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('streamCsv：一行一个对象，脚注里有换行的那一行也是一行', async () => {
  const rows = [];
  await streamCsv(path.join(MINI, 'food_nutrient.csv'), r => rows.push(r));
  assert.equal(rows.length, 16);
  assert.equal(rows[5].footnote, 'two\nlines');
  assert.equal(rows[2].footnote, 'fat, by "Soxhlet" method');
  assert.deepEqual(Object.keys(rows[0]).slice(0, 4), ['id', 'fdc_id', 'nutrient_id', 'amount']);
});

test('四样营养：千卡整数、克一位小数；别的营养不要；缺了、空的、负的是 null', () => {
  const rows = parseCsv(read('food_nutrient.csv'));
  assert.deepEqual(per100Of(rows.filter(r => r.fdc_id === '900001')), { kcal: 52, protein: 0.3, carbs: 13.8, fat: 0.2 });
  assert.deepEqual(per100Of(rows.filter(r => r.fdc_id === '900004')), { kcal: 100, protein: null, carbs: 20, fat: 1 });
  assert.deepEqual(per100Of([{ nutrient_id: '1008', amount: '' }, { nutrient_id: '1003', amount: '-1' }, { nutrient_id: '1004', amount: 'x' }]),
    { kcal: null, protein: null, carbs: null, fat: null });
  assert.deepEqual(per100Of([{ nutrient_id: '1003', amount: '0.25' }, { nutrient_id: '1004', amount: '1.05' }]).protein, 0.3, '0.25 → 0.3（不是浮点的 0.2）');
});

test('nutrient.csv 的四个 id 要还是那四样，不然停下', () => {
  const rows = parseCsv(read('nutrient.csv'));
  assert.doesNotThrow(() => checkNutrientIds(rows));
  assert.throws(() => checkNutrientIds(rows.map(r => (r.id === '1008' ? { ...r, unit_name: 'kJ' } : r))), /1008/);
  assert.throws(() => checkNutrientIds(rows.filter(r => r.id !== '1003')), /1003/);
});

test('portion 的第一个词：小写、复数折成单数', () => {
  assert.deepEqual(['cup, chopped', 'Medium (2" dia)', 'cloves', 'slices', 'berries', 'leaves', 'pieces', 'fl oz', '', '1/2 cup'].map(firstWord),
    ['cup', 'medium', 'clove', 'slice', 'berry', 'leaf', 'piece', 'fl', '', '']);
  assert.deepEqual([4.86, 9.95, 10, 236.4, 0.04].map(roundGrams), [4.9, 10, 10, 236, 0]);
});

test('单位：一个是 medium（比 large 优先），带核的「yields」排在后面，「10 slices」按一片算，NLEA serving 不当「个」', () => {
  const { grams, density } = portionsOf(portionsFor('900001'), units);
  assert.deepEqual(grams, { 杯: 150, 勺: 9, 片: 5, 个: 160 });
  assert.equal(density, 0.61, '没有 fl oz 时按 tbsp：9 g ÷ 14.787 ml');
  assert.deepEqual(Object.keys(grams), ['杯', '勺', '片', '个'], '单位的顺序固定');
});

test('单位：对照表指定的（「个」要 large、加一个「包」、null = 不要），指定的写法 portion 里没有就停下', () => {
  assert.equal(portionsOf(portionsFor('900001'), units, { 个: 'large' }).grams.个, 200);
  assert.equal(portionsOf(portionsFor('900001'), units, { 个: null }).grams.个, undefined);
  assert.equal(portionsOf(portionsFor('900001'), units, { 杯: 'cup, with pits' }).grams.杯, 140, '指定了才用带核的那条');
  const paste = portionsOf(portionsFor('900002'), units, { 包: 'package' });
  assert.deepEqual(paste.grams, { 杯: 300, 勺: 18, 包: 284 }, 'modifier 空着时看 measure_unit（0.5 cup = 150 g）；can、package 不是「个」');
  assert.throws(() => portionsOf(portionsFor('900002'), units, { 个: 'bunch' }), /bunch/);
});

test('单位：同一种写法有「1 package」也有「0.33 package」时用量了一个的；wedge 是「块」、floweret 是「朵」', () => {
  const row = (/** @type {string} */ amount, /** @type {string} */ modifier, /** @type {string} */ g, seq = '1') => ({ seq_num: seq, amount, measure_unit_id: '9999', modifier, gram_weight: g });
  const pack = [row('0.33', 'package (10 oz)', '95', '1'), row('1', 'package (10 oz)', '284', '2')];
  assert.equal(portionsOf(pack, units, { 包: 'package' }).grams.包, 284, '95 ÷ 0.33 = 288，不如量了一包的准');
  const melon = portionsOf([row('1', 'wedge (approx 1/16 of melon)', '286'), row('1', 'melon (15" long)', '4518')], units).grams;
  assert.deepEqual(melon, { 块: 286, 个: 4518 }, '切下来的一块是「块」，不是「个」');
  assert.deepEqual(portionsOf([row('1', 'floweret', '13'), row('1', 'head medium (5-6" dia.)', '588')], units).grams, { 朵: 13, 个: 588 });
  const corn = [row('1', 'ear, large (7-3/4" to 9" long) yields', '143', '1'), row('1', 'ear, medium (6-3/4" to 7-1/2" long) yields', '102', '2'), row('1', 'ear, small (5-1/2" to 6-1/2" long)', '73', '3')];
  assert.equal(portionsOf(corn, units).grams.根, 73, '默认没写 yields 的优先');
  assert.equal(portionsOf(corn, units, { 根: 'ear, medium' }).grams.根, 102, '对照表指定 medium 的（玉米）');
  assert.ok(UNIT_RULES.some(([zh]) => zh === '朵'));
});

test('密度：液体先看 fl oz；不像密度的（一杯切碎的菜几十克）是 null', () => {
  assert.equal(portionsOf(portionsFor('900003'), units).density, 0.92);
  assert.equal(portionsOf([{ seq_num: '1', amount: '1', measure_unit_id: '9999', modifier: 'cup, shredded', gram_weight: '36' }], units).density, null);
  assert.deepEqual(portionsOf([], units), { grams: {}, density: null });
  assert.deepEqual(portionsOf([{ seq_num: '1', amount: '0', measure_unit_id: '9999', modifier: 'cup', gram_weight: '100' }], units).grams, {}, '数量是 0 的不算');
});

test('拼起来：按 id 排，名字去重，note 照抄；fdc 找不到、重复、缺营养都停下', async () => {
  const data = await readData(MINI, MINI_MAP);
  assert.deepEqual([...data.nutrients.keys()].sort(), ['900001', '900002', '900003'], '只读对照表用到的');
  const out = buildEntries(MINI_MAP, data);
  assert.deepEqual(out.map(e => e.id), [900001, 900002, 900003]);
  assert.deepEqual(out[2], { id: 900003, zh: ['测试油'], en: ['test oil'], per100: { kcal: 884, protein: 0, carbs: 0, fat: 100 }, grams: { 杯: 218, 勺: 14 }, density: 0.92 }, '13.6 g 是 10 g 以上，取整');
  assert.equal(out[0].note, 'approximation: invented');
  assert.equal(out[0].grams.个, 200);
  assert.equal('note' in out[2], false, '没有 note 的不写这个键');
  assert.throws(() => buildEntries([{ fdc: 123, zh: ['没有'], en: [] }], data), /123/);
  assert.throws(() => buildEntries([MINI_MAP[0], { ...MINI_MAP[0], zh: ['又一个'] }], data), /两次/);
  const [noVolume] = buildEntries([{ ...MINI_MAP[1], volume: false }], data);
  assert.deepEqual(noVolume.grams, { 片: 5, 个: 200 }, 'volume: false：不要杯、勺、小勺');
  assert.equal(noVolume.density, null);
  assert.equal(noVolume.volume, false);
  assert.equal('volume' in out[0], false, '没写 volume 的不写这个键');
  const withMissing = await readData(MINI, [{ fdc: 900004, zh: ['缺蛋白质'], en: [] }]);
  assert.throws(() => buildEntries([{ fdc: 900004, zh: ['缺蛋白质'], en: [] }], withMissing), /protein/);
});

test('输出：一样一行、重跑一样、能直接 import；来源写全', async () => {
  const entries = buildEntries(MINI_MAP, await readData(MINI, MINI_MAP));
  const hash = inputHash(MINI_MAP);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(inputHash(MINI_MAP), hash);
  assert.notEqual(inputHash([{ ...MINI_MAP[0], units: { 杯: null } }, ...MINI_MAP.slice(1)]), hash, '对照表改一点指纹就变');
  const text = render(entries, hash);
  assert.equal(render(buildEntries(MINI_MAP, await readData(MINI, MINI_MAP)), hash), text);
  assert.equal(text.split('\n').filter(l => l.startsWith('  {"id":')).length, 3);
  assert.ok(text.includes(SOURCE.attribution));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pn-nutrition-'));
  try {
    const file = path.join(dir, 'nutrition.js');
    fs.writeFileSync(file, text);
    const mod = await import(pathToFileURL(file).href);
    assert.deepEqual(mod.NUTRITION, JSON.parse(JSON.stringify(entries)));
    assert.equal(mod.NUTRITION_SOURCE.attribution, 'U.S. Department of Agriculture, Agricultural Research Service. FoodData Central (SR Legacy, 2018).');
    assert.equal(mod.NUTRITION_INPUT, hash);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('命令行：没给目录说用法；给了目录和对照表写出文件', () => {
  const script = path.join(root, 'tools/build-nutrition.mjs');
  const usage = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /用法/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pn-nutrition-'));
  try {
    const out = path.join(dir, 'out.js');
    const run = spawnSync(process.execPath, [script, MINI, '--out', out, '--map', path.join(MINI, 'map.mjs')], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /3 样/);
    assert.match(fs.readFileSync(out, 'utf8'), /"id":900001/);
    assert.ok(fs.readFileSync(out, 'utf8').includes(`NUTRITION_INPUT = "${inputHash(MINI_MAP)}"`), '命令行写的指纹是 --map 那份对照表的');
    const bad = spawnSync(process.execPath, [script, path.join(dir, 'no-such-dir'), '--out', path.join(dir, 'bad.js')], { encoding: 'utf8' });
    assert.notEqual(bad.status, 0);
    assert.equal(fs.existsSync(path.join(dir, 'bad.js')), false, '出错时不写文件');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
