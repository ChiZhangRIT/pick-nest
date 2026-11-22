// 搜索（core/search.js）：简繁互通、大小写、全角半角、名字和备注、归档的清单也算（排在后面、标出来）、删掉的不算、命中的字标出来。全是编的数据
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureSeeds, blankState, normalizeRecord, deletedRecord } from '../src/core/store.js';
import { createList, setArchived, deleteList } from '../src/core/lists.js';
import { searchItems, searchTerms, hitCount, highlight } from '../src/core/search.js';

function seeded() {
  const s = ensureSeeds(blankState());
  const wood = createList(s, { name: '木工', kind: 'general' }, 1000).id;
  const old = createList(s, { name: '去年的年货', kind: 'grocery' }, 1001).id;
  const gone = createList(s, { name: '删掉的', kind: 'grocery' }, 1002).id;
  let n = 0;
  const add = (listId, name, f = {}) => { const id = 'i_t' + n++; s.data.items[id] = normalizeRecord('items', { id, listId, name, status: 'need', updatedAt: 1, ...f }); return id; };
  add('l_groceries', '鸡蛋', { qty: 12 });
  add('l_groceries', '雞蛋豆腐', { status: 'done', doneAt: 5 });
  add('l_groceries', 'Oat Milk');
  add('l_groceries', '牛奶', { note: '全脂的\n要两盒' });
  add('l_tobuy', '机械键盘', { note: '配牛奶色的键帽' });
  add('l_tobuy', '雨伞', { status: 'later' });
  add(wood, 'ＭＩＬＫ ｐａｉｎｔ');                  // 全角写的
  add(old, '雞蛋卷');
  add(gone, '鸡蛋布丁');
  const del = add('l_groceries', '鸡蛋饼');
  s.data.items[del] = deletedRecord(s.data.items[del], 2000);
  setArchived(s, old, true, 1003);
  deleteList(s, gone, 1004);
  return { s, wood, old };
}
const names = (groups) => groups.map(g => [g.list.name || g.list.sys, g.archived, g.hits.map(x => x.item.name)]);

test('searchItems：繁体搜得到简体、简体搜得到繁体；删掉的东西、删掉的清单里的不算；归档的清单也在（排在后面、标出来）', () => {
  const { s, wood } = seeded();
  const expected = [['groceries', false, ['鸡蛋', '雞蛋豆腐']], ['去年的年货', true, ['雞蛋卷']]];
  assert.deepEqual(names(searchItems(s, '雞蛋')), expected, '繁体的「雞蛋」找到简体写的「鸡蛋」');
  assert.deepEqual(names(searchItems(s, '鸡蛋')), expected, '简体的「鸡蛋」找到繁体写的「雞蛋豆腐」「雞蛋卷」');
  assert.equal(hitCount(searchItems(s, '鸡蛋')), 3);
  assert.deepEqual(searchItems(s, '布丁'), [], '删掉的清单里的东西跟着隐藏');
  assert.deepEqual(searchItems(s, '蛋饼'), [], '删掉的东西不算');
  // 归档的排在后面，不是碰巧 order 大：把排在最前面的「食材」归档，它也要排到没归档的「木工」后面
  s.data.items.i_wood_egg = normalizeRecord('items', { id: 'i_wood_egg', listId: wood, name: '蛋壳漆', status: 'need', updatedAt: 1 });
  setArchived(s, 'l_groceries', true, 1005);
  assert.deepEqual(names(searchItems(s, '蛋')).map(g => [g[0], g[1]]), [['木工', false], ['groceries', true], ['去年的年货', true]]);
});

test('searchItems：大小写、全角半角都算；搜名字也搜备注（备注里命中的那一行交给页面）；几个词都要有，可以分在名字和备注里', () => {
  const { s } = seeded();
  assert.deepEqual(names(searchItems(s, 'MILK')).map(g => g[2]), [['Oat Milk'], ['ＭＩＬＫ ｐａｉｎｔ']]);
  assert.deepEqual(names(searchItems(s, 'ｍｉｌｋ')).map(g => g[2]), [['Oat Milk'], ['ＭＩＬＫ ｐａｉｎｔ']], '全角的搜索词也一样');
  const milk = searchItems(s, '牛奶');
  assert.deepEqual(names(milk), [['groceries', false, ['牛奶']], ['tobuy', false, ['机械键盘']]], '备注里有「牛奶」的也找到');
  assert.equal(milk[0].hits[0].note, '', '名字里命中、备注里没有：页面照常显示备注第一行');
  assert.equal(milk[1].hits[0].note, '配牛奶色的键帽');
  assert.equal(searchItems(s, '两盒')[0].hits[0].note, '要两盒', '备注第二行命中：给的是那一行');
  assert.deepEqual(names(searchItems(s, '牛奶 两盒')).map(g => g[2]), [['牛奶']], '名字里一个、备注里一个');
  assert.deepEqual(names(searchItems(s, '  键帽   机械 ')).map(g => g[2]), [['机械键盘']], '不要求挨着、按顺序；多余的空格不算');
  assert.deepEqual(searchItems(s, '牛奶 雨伞'), [], '每个词都要有');
});

test('searchItems：要买 → 以后再说 → 已买，同一种按名字；空的搜索词什么也不列', () => {
  const s = ensureSeeds(blankState());
  const add = (id, name, status) => { s.data.items[id] = normalizeRecord('items', { id, listId: 'l_tobuy', name, status, updatedAt: 1, doneAt: status === 'done' ? 1 : null }); };
  add('i_1', '袜子 已买', 'done'); add('i_2', '袜子 以后', 'later'); add('i_3', '袜子 B', 'need'); add('i_4', '袜子 A', 'need');
  assert.deepEqual(names(searchItems(s, '袜子'))[0][2], ['袜子 A', '袜子 B', '袜子 以后', '袜子 已买']);
  for (const q of ['', '   ', null, undefined]) assert.deepEqual(searchItems(s, q), []);
  assert.deepEqual(searchTerms(' 雞蛋  ＭＩＬＫ '), ['鸡蛋', 'milk']);
});

test('highlight：标出命中的原文（简繁、大小写、全角都算），拼起来还是原文；几个词、几处都标；没命中就是一整段', () => {
  const join = (segs) => segs.map(x => x.text).join('');
  const hits = (segs) => segs.filter(x => x.hit).map(x => x.text);
  let segs = highlight('雞蛋豆腐', '鸡蛋');
  assert.deepEqual(segs, [{ text: '雞蛋', hit: true }, { text: '豆腐', hit: false }], '标的是原文的繁体字');
  segs = highlight('Oat Milk', 'MILK');
  assert.deepEqual(hits(segs), ['Milk']);
  assert.equal(join(segs), 'Oat Milk');
  segs = highlight('ＭＩＬＫ ｐａｉｎｔ', 'milk paint');
  assert.deepEqual(hits(segs), ['ＭＩＬＫ', 'ｐａｉｎｔ'], '全角的原文照样标出来');
  assert.deepEqual(hits(highlight('牛奶加牛奶', '牛奶')), ['牛奶', '牛奶'], '出现几次标几次');
  assert.deepEqual(hits(highlight('abcabc', 'bc ab')), ['abcabc'], '挨着、重叠的合成一段');
  assert.deepEqual(highlight('雨伞', '牛奶'), [{ text: '雨伞', hit: false }]);
  assert.deepEqual(highlight('雨伞', ''), [{ text: '雨伞', hit: false }]);
  assert.deepEqual(highlight('', '牛奶'), [{ text: '', hit: false }]);
  // 一个字折成两个字（「㎏」→「kg」）：只命中一半也标整个字，拼起来还是原文
  segs = highlight('5㎏米', 'k');
  assert.deepEqual(hits(segs), ['㎏']);
  assert.equal(join(segs), '5㎏米');
  // 表情（两个 UTF-16 单元）在前面也对得上位置
  assert.deepEqual(hits(highlight('🥚雞蛋', '鸡蛋')), ['雞蛋']);
});
