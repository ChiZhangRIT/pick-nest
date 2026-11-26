// 成品图里不碰浏览器的部分（第 12 步）：压缩到多大（fitSize）、一步步缩小（resizeSteps）、仓库里的文件名、哪些图有食谱用着、
// 占了多少地方怎么写；recipe.photo 的整理（normalizePhoto）、保存（saveRecipe 给了才改）、合并（跟着整条记录走，几台设备轮流同步会收敛）；
// ui/photo.js 的 encodePhoto（用假的解码、编码：浏览器的 <img> / canvas 在 Node 里没有）。全是编的数据
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitSize, resizeSteps, photoPath, recipePhotos, photoInUse, fmtBytes, PHOTO_MAX } from '../src/core/photo.js';
import { normalizePhoto, normalizeRecord, blankState, ensureSeeds, mergeStates, canon, stamp } from '../src/core/store.js';
import { saveRecipe, liveRecipe, validateRecipe } from '../src/core/recipes.js';
import { encodePhoto, PhotoError } from '../src/ui/photo.js';

const SHA = 'a'.repeat(64), SHA2 = 'b'.repeat(64);

test('压缩到多大：长边最多 1600，等比、四舍五入到整像素，不放大；宽高不对 → null', () => {
  assert.equal(PHOTO_MAX, 1600);
  assert.deepEqual(fitSize(4032, 3024), { w: 1600, h: 1200 });
  assert.deepEqual(fitSize(3024, 4032), { w: 1200, h: 1600 }, '竖的');
  assert.deepEqual(fitSize(5712, 4284), { w: 1600, h: 1200 });
  assert.deepEqual(fitSize(1000, 3), { w: 1000, h: 3 }, '小的不放大');
  assert.deepEqual(fitSize(1600, 1600), { w: 1600, h: 1600 });
  assert.deepEqual(fitSize(20000, 5), { w: 1600, h: 1 }, '至少 1 像素');
  assert.deepEqual(fitSize(1170, 2532, 800), { w: 370, h: 800 });
  for (const [w, h] of [[0, 10], [10, -1], [NaN, 10], [10, Infinity], [undefined, 5]]) assert.equal(fitSize(w, h), null, `${w}×${h}`);
});

test('一步步缩小：每一步最多缩一半，最后一步就是目标；不用缩的只有一步', () => {
  assert.deepEqual(resizeSteps(4032, 3024, 1600, 1200), [{ w: 2016, h: 1512 }, { w: 1600, h: 1200 }]);
  assert.deepEqual(resizeSteps(8064, 6048, 1600, 1200), [{ w: 4032, h: 3024 }, { w: 2016, h: 1512 }, { w: 1600, h: 1200 }]);
  assert.deepEqual(resizeSteps(1200, 900, 1200, 900), [{ w: 1200, h: 900 }]);
  assert.deepEqual(resizeSteps(3000, 2000, 1600, 1067), [{ w: 1600, h: 1067 }], '缩得不到一半：一步');
  for (const [w, h] of [[4032, 3024], [12000, 1000], [5712, 4284], [1601, 1601]]) {
    const t = fitSize(w, h), steps = resizeSteps(w, h, t.w, t.h);
    let pw = w, ph = h;
    for (const s of steps) { assert.ok(s.w >= pw / 2 - 1 && s.h >= ph / 2 - 1, `${w}×${h}：一次最多缩一半`); pw = s.w; ph = s.h; }
    assert.deepEqual(steps.at(-1), t);
    assert.ok(steps[0].w * steps[0].h <= Math.max(w * h / 4 + w + h, t.w * t.h), '第一张 canvas 不比原图的四分之一大（iOS 的 canvas 有上限）');
  }
});

test('仓库里的文件名按内容和格式：images/<sha256>.jpg；不认识的格式是 .bin（不是 babble 的 .m4a）', () => {
  assert.equal(photoPath(SHA), `images/${SHA}.jpg`);
  assert.equal(photoPath(SHA, 'image/jpeg'), `images/${SHA}.jpg`);
  assert.equal(photoPath(SHA, 'image/png'), `images/${SHA}.png`, 'canvas 编不出 JPEG 时给的 PNG');
  assert.equal(photoPath(SHA, 'audio/mp4'), `images/${SHA}.bin`);
});

test('占了多少地方：KB / MB', () => {
  assert.equal(fmtBytes(0), '1 KB');
  assert.equal(fmtBytes(300 * 1024), '300 KB');
  assert.equal(fmtBytes(1.25 * 1024 * 1024), '1.3 MB');
  assert.equal(fmtBytes(42.4 * 1024 * 1024), '42 MB');
  assert.equal(fmtBytes(-5), '1 KB');
});

test('recipe.photo 的整理：没有、不是对象、sha256 不对 → null；sha256 转小写；mime 去参数、默认 JPEG；宽高字节数要正整数；新版的字段留着', () => {
  for (const bad of [undefined, null, 'x', [], {}, { sha256: 'abc' }, { sha256: 'g'.repeat(64) }, { sha256: 12 }]) assert.equal(normalizePhoto(bad), null, JSON.stringify(bad));
  assert.deepEqual(normalizePhoto({ sha256: ' ' + SHA.toUpperCase() + ' ', mime: 'IMAGE/JPEG; q=1', w: '1600', h: 1200.4, bytes: 0, extra: 1, __proto__x: 2 }),
    { sha256: SHA, mime: 'image/jpeg', w: 1600, h: 1200, bytes: null, extra: 1, __proto__x: 2 });
  assert.deepEqual(normalizePhoto({ sha256: SHA }), { sha256: SHA, mime: 'image/jpeg', w: null, h: null, bytes: null });
  const old = normalizeRecord('recipes', { id: 'r_old', name: '第 11 步以前的食谱', ings: [] }, 'r_old');
  assert.equal(old.photo, null, '以前的食谱：没有图');
  const r = normalizeRecord('recipes', { id: 'r_1', name: '测试', ings: [], photo: { sha256: SHA, mime: 'image/jpeg', w: 4, h: 3, bytes: 10 } }, 'r_1');
  assert.deepEqual(r.photo, { sha256: SHA, mime: 'image/jpeg', w: 4, h: 3, bytes: 10 });
  assert.equal(canon(normalizeRecord('recipes', r, 'r_1')), canon(r), '整理两次一样');
});

test('保存食谱：给了 photo 才改（null = 删掉图）；没给的（别处调用、旧版的草稿）留着原来的', () => {
  const s = ensureSeeds(blankState());
  const p = { sha256: SHA, mime: 'image/jpeg', w: 1600, h: 1200, bytes: 321000 };
  const a = saveRecipe(s, null, { name: '红烧肉', ings: [], photo: p }, 1000);
  assert.equal(a.ok, true);
  assert.deepEqual(liveRecipe(s, a.id).photo, p);
  saveRecipe(s, a.id, { name: '红烧肉（改名）', ings: [] }, 2000);
  assert.deepEqual(liveRecipe(s, a.id).photo, p, '没给 photo：不动');
  saveRecipe(s, a.id, { name: '红烧肉（改名）', ings: [], photo: { ...p, sha256: SHA2 } }, 3000);
  assert.equal(liveRecipe(s, a.id).photo.sha256, SHA2, '换一张');
  const at = liveRecipe(s, a.id).updatedAt;
  saveRecipe(s, a.id, { name: '红烧肉（改名）', ings: [], photo: { ...p, sha256: SHA2 } }, 4000);
  assert.equal(liveRecipe(s, a.id).updatedAt, at, '同一张：内容没变，不盖新时间');
  saveRecipe(s, a.id, { name: '红烧肉（改名）', ings: [], photo: null }, 5000);
  assert.equal(liveRecipe(s, a.id).photo, null, '删掉图');
  assert.equal(validateRecipe({ name: 'x', photo: { sha256: '坏的' } }).clean.photo, null, '认不出的当没有');
  assert.equal('photo' in validateRecipe({ name: 'x' }).clean, false);
});

test('哪些图有食谱用着：改得晚的在前、同一张只算一次；删掉的食谱只在 includeDeleted 时算；photoInUse 算删掉的', () => {
  const s = ensureSeeds(blankState());
  const put = (id, sha, at, extra = {}) => { s.data.recipes[id] = normalizeRecord('recipes', { id, name: id, ings: [], photo: sha ? { sha256: sha, mime: 'image/png' } : null, updatedAt: at, ...extra }, id); };
  put('r_a', SHA, 100);
  put('r_b', SHA2, 300);
  put('r_c', SHA, 200);
  put('r_d', null, 400);
  put('r_e', 'c'.repeat(64), 500, { deleted: true, deletedAt: 500 });
  assert.deepEqual([...recipePhotos(s)], [[SHA2, 'image/png'], [SHA, 'image/png']]);
  assert.deepEqual([...recipePhotos(s, { includeDeleted: true }).keys()], ['c'.repeat(64), SHA2, SHA]);
  assert.equal(photoInUse(s, 'c'.repeat(64)), true, '在最近删除里的也算（能恢复）');
  assert.equal(photoInUse(s, 'd'.repeat(64)), false);
  assert.equal(recipePhotos({ data: {} }).size, 0);
});

test('合并：photo 跟着整条记录取较新的；两台设备各换各的图，轮流同步收敛到同一张，重复合并结果不变', () => {
  const base = ensureSeeds(blankState());
  base.data.recipes.r_1 = normalizeRecord('recipes', { id: 'r_1', name: '红烧肉', ings: [], updatedAt: 1000, createdAt: 1000 }, 'r_1');
  const a = JSON.parse(JSON.stringify(base)), b = JSON.parse(JSON.stringify(base));
  a.data.recipes.r_1 = normalizeRecord('recipes', stamp({ ...a.data.recipes.r_1, photo: { sha256: SHA, mime: 'image/jpeg' } }, a.data.recipes.r_1, 2000), 'r_1');
  b.data.recipes.r_1 = normalizeRecord('recipes', stamp({ ...b.data.recipes.r_1, photo: { sha256: SHA2, mime: 'image/jpeg' } }, b.data.recipes.r_1, 3000), 'r_1');
  const ab = mergeStates(a, b), ba = mergeStates(b, a);
  assert.equal(canon(ab), canon(ba), '顺序无关');
  assert.equal(ab.data.recipes.r_1.photo.sha256, SHA2, '较新的那次');
  assert.equal(canon(mergeStates(ab, b)), canon(ab), '重复合并不变');
  // 后来在另一台设备上改了名字（不知道换了图）：整条较新的为准，图跟着那一条（和别的字段一样，不是逐个字段合并）
  const c = JSON.parse(JSON.stringify(a));
  c.data.recipes.r_1 = normalizeRecord('recipes', stamp({ ...c.data.recipes.r_1, name: '红烧肉（妈妈的）' }, c.data.recipes.r_1, 4000), 'r_1');
  const m = mergeStates(ab, c);
  assert.deepEqual([m.data.recipes.r_1.name, m.data.recipes.r_1.photo.sha256], ['红烧肉（妈妈的）', SHA]);
});

test('encodePhoto（假的解码、编码）：按 fitSize 缩，返回 JPEG 和宽高，用完放掉；打不开、编不出的报 PhotoError', async () => {
  const calls = [];
  let closed = 0;
  const decode = async (file) => { calls.push(['decode', await file.text()]); return { source: 'SRC', w: 4032, h: 3024, close: () => closed++ }; };
  const draw = async (src, w, h, size) => { calls.push(['draw', src, w, h, size]); return new Blob(['编出来的 JPEG'], { type: 'image/jpeg' }); };
  const out = await encodePhoto(new Blob(['测试照片']), { decode, draw });
  assert.deepEqual([out.w, out.h, out.blob.type, await out.blob.text()], [1600, 1200, 'image/jpeg', '编出来的 JPEG']);
  assert.deepEqual(calls, [['decode', '测试照片'], ['draw', 'SRC', 4032, 3024, { w: 1600, h: 1200 }]]);
  assert.equal(closed, 1);
  await assert.rejects(encodePhoto(new Blob(['x']), { decode: async () => { throw new PhotoError('decode'); }, draw }), (e) => e instanceof PhotoError && e.code === 'decode');
  await assert.rejects(encodePhoto(new Blob(['x']), { decode: async () => ({ source: 1, w: 0, h: 0, close: () => closed++ }), draw }), (e) => e.code === 'decode');
  assert.equal(closed, 2, '出错也放掉');
  await assert.rejects(encodePhoto(new Blob(['x']), { decode, draw: async () => new Blob([]) }), (e) => e.code === 'encode', '编出来是空的');
  // 太大的（超过 1 亿像素：拼起来的全景、下载的大图）不画：第一次 drawImage 才整张解码，在 iPhone 上会把页面弄崩
  calls.length = 0;
  const huge = async () => ({ source: 'BIG', w: 20000, h: 5001, close: () => closed++ });
  await assert.rejects(encodePhoto(new Blob(['x']), { decode: huge, draw }), (e) => e instanceof PhotoError && e.code === 'encode');
  assert.deepEqual(calls, [], '没有画');
  assert.equal(closed, 4, '也放掉了');
  const edge = async () => ({ source: 'OK', w: 10000, h: 10000, close() {} });
  assert.equal((await encodePhoto(new Blob(['x']), { decode: edge, draw })).w, 1600, '正好 1 亿像素的照样收');
});
