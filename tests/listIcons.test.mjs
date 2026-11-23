// 清单的图标和颜色（core/listIcons.js 的规则、ui/listTile.js 的方块）。全是编的数据
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { LIST_GLYPHS, LIST_COLORS, LIST_DEFAULTS, customIcon, glyphOf, isEmoji, listLook, lookFields } from '../src/core/listIcons.js';
import { normalizeRecord } from '../src/core/store.js';
import { STRINGS, LANGS } from '../src/i18n.js';
import { installDom } from './helpers/dom.mjs';

test('画好的图标、色调：名字不重复；两个默认在里面；每个都有画法、三种语言的名字，每个色调深浅两套颜色都有', async () => {
  assert.equal(new Set(LIST_GLYPHS).size, LIST_GLYPHS.length);
  assert.ok(LIST_GLYPHS.length >= 28 && LIST_GLYPHS.length % 6 === 0, '面板一行 6 个，排满');
  assert.equal(new Set(LIST_COLORS).size, LIST_COLORS.length);
  assert.equal(LIST_COLORS[0], 'green', '第一个是 App 的绿');
  for (const d of Object.values(LIST_DEFAULTS)) { assert.ok(LIST_GLYPHS.includes(d.glyph), d.glyph); assert.ok(LIST_COLORS.includes(d.color), d.color); }
  assert.deepEqual(LIST_DEFAULTS, { grocery: { glyph: 'basket', color: 'green' }, general: { glyph: 'bag', color: 'amber' } });
  const dom = installDom();
  try {
    const { GLYPHS } = await import('../src/ui/listTile.js');
    assert.deepEqual(Object.keys(GLYPHS).sort(), [...LIST_GLYPHS].sort(), 'ui/listTile.js 的画法和 LIST_GLYPHS 一一对应');
    for (const [k, kids] of Object.entries(GLYPHS)) for (const [tag, attrs] of kids) {
      assert.ok(['path', 'circle', 'rect', 'ellipse'].includes(tag), k);
      if (attrs.d) assert.match(attrs.d, /^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]+$/, k);
    }
  } finally { dom.restore(); }
  for (const lang of LANGS) {
    for (const k of LIST_GLYPHS) assert.ok(STRINGS[lang]['list.glyph.' + k], `${lang} list.glyph.${k}`);
    for (const c of LIST_COLORS) assert.ok(STRINGS[lang]['list.tint.' + c], `${lang} list.tint.${c}`);
  }
  // 名字不重名（读屏分得清）
  for (const lang of LANGS) assert.equal(new Set(LIST_GLYPHS.map(k => STRINGS[lang]['list.glyph.' + k])).size, LIST_GLYPHS.length, lang);
  const css = fs.readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  const dark = css.slice(css.indexOf(':root[data-theme="dark"]'));
  for (const c of LIST_COLORS) {
    assert.ok(css.includes(`.tint-${c} { --t-bg: var(--tint-${c}-bg); --t-fg: var(--tint-${c}-fg); }`), c);
    for (const part of ['bg', 'fg']) {
      assert.match(css, new RegExp(`--tint-${c}-${part}: #[0-9a-f]{6}`), `浅色 ${c}-${part}`);
      assert.match(dark.slice(0, dark.indexOf('}')), new RegExp(`--tint-${c}-${part}: #[0-9a-f]{6}`), `深色 ${c}-${part}`);
    }
  }
});

test('自己写的图标：一个 emoji，或者开头的一两个字；空格、emoji 前面截断', () => {
  assert.equal(customIcon('🪵🔨'), '🪵');
  assert.equal(customIcon(' 👨‍👩‍👧 家'), '👨‍👩‍👧');
  assert.equal(customIcon('🇹🇼'), '🇹🇼');
  assert.equal(customIcon('1️⃣2'), '1️⃣');
  assert.equal(customIcon('木'), '木');
  assert.equal(customIcon('木工活'), '木工');
  assert.equal(customIcon('木 工'), '木');
  assert.equal(customIcon('木🪵'), '木');
  assert.equal(customIcon('AB'), 'AB');
  assert.equal(customIcon('i:'), 'i:', '画好的图标不在 icon 里，这两个字就是两个字');
  assert.equal(customIcon('  '), '');
  assert.equal(customIcon(null), '');
  assert.ok(isEmoji('🛍️') && isEmoji('🇹🇼') && !isEmoji('木') && !isEmoji('A'));
  assert.equal(glyphOf(' basket '), 'basket');
  assert.equal(glyphOf('no-such'), null);
  assert.equal(glyphOf('i:basket'), null, '没有前缀这种写法');
  assert.equal(glyphOf(undefined), null);
});

test('显示成什么：空的按类型默认；旧版存的 emoji 照样显示；新版才有的图标名、色调按默认显示、记录里原样留着', () => {
  const look = (rec) => { const l = listLook(normalizeRecord('lists', { id: 'l', ...rec })); return [l.glyph || l.text, l.color, l.emoji, l.two]; };
  assert.deepEqual(look({ sys: 'groceries', kind: 'grocery' }), ['basket', 'green', false, false]);
  assert.deepEqual(look({ sys: 'tobuy', kind: 'general' }), ['bag', 'amber', false, false]);
  assert.deepEqual(look({ kind: 'general', icon: '🪵' }), ['🪵', 'amber', true, false], '旧版选的 emoji');
  assert.deepEqual(look({ kind: 'grocery', icon: '\u{1F96C}', color: 'teal' }), ['\u{1F96C}', 'teal', true, false]);
  assert.deepEqual(look({ kind: 'general', icon: '木工', color: 'clay' }), ['木工', 'clay', false, true]);
  assert.deepEqual(look({ kind: 'general', glyph: 'saw', color: 'blue' }), ['saw', 'blue', false, false]);
  assert.deepEqual(look({ kind: 'grocery', glyph: 'future-glyph', color: 'future-tint' }), ['basket', 'green', false, false]);
  assert.deepEqual(look({ kind: 'general', icon: '🪵', glyph: 'saw' }), ['🪵', 'amber', true, false], '两样都有（旧版后来选了个 emoji）：自己写的在前');
  assert.deepEqual(look({ kind: 'general', icon: '木工活动', color: 7 }), ['木工', 'amber', false, true], '手改的长字也只显示两个');
  assert.deepEqual(look({ kind: 'general', icon: '   ' }), ['bag', 'amber', false, false]);
  const kept = normalizeRecord('lists', { id: 'l', kind: 'general', glyph: 'future-glyph', color: 'future-tint' });
  assert.deepEqual([kept.glyph, kept.color], ['future-glyph', 'future-tint'], '不认识的原样留着：旧版改名字不会冲掉新版选的');
  assert.deepEqual([normalizeRecord('lists', { id: 'l' }).color, normalizeRecord('lists', { id: 'l' }).glyph], ['', ''], '旧记录没有 color、glyph：空的（默认）');
  assert.equal(listLook(null).glyph, 'bag');
});

test('存什么：图标只留一样（自己写的优先）；和这一类默认一样的存空的；画好的图标只收认得的名字；自己写的截到两个字；认不出的颜色存空的', () => {
  assert.deepEqual(lookFields('grocery', { glyph: 'basket', color: 'green' }), { icon: '', glyph: '', color: '' });
  assert.deepEqual(lookFields('general', { glyph: 'basket', color: 'green' }), { icon: '', glyph: 'basket', color: 'green' }, '别的类型的默认不算默认');
  assert.deepEqual(lookFields('general', { glyph: 'bag', color: 'amber' }), { icon: '', glyph: '', color: '' });
  assert.deepEqual(lookFields('general', { glyph: ' saw ', color: 'clay' }), { icon: '', glyph: 'saw', color: 'clay' });
  assert.deepEqual(lookFields('general', { glyph: 'no-such', color: 'purple' }), { icon: '', glyph: '', color: '' });
  assert.deepEqual(lookFields('general', { icon: '木工活' }), { icon: '木工', glyph: '', color: '' });
  assert.deepEqual(lookFields('general', { icon: '木', glyph: 'saw' }), { icon: '木', glyph: '', color: '' }, '两样都交：留自己写的（显示的就是它）');
  assert.deepEqual(lookFields('general', { icon: '  ', glyph: 'saw' }), { icon: '', glyph: 'saw', color: '' }, '自己写的空着：用画好的');
  assert.deepEqual(lookFields('project', { icon: '🧳🎒', color: 'rose' }), { icon: '🧳', glyph: '', color: 'rose' }, '认不出的类型按一般清单');
  assert.deepEqual(lookFields('general', {}), { icon: '', glyph: '', color: '' });
});

test('旧版（v15 和更早的，只认 icon）保存编辑面板时交回 icon、截成第一个字：画好的图标不受影响，旧版选的 emoji 显示在前', () => {
  // 旧版 core/lists.js 的 editList：{ ...旧的 }，icon = firstGrapheme(面板里的 icon)；面板里的 icon 就是记录里的 icon（没动的话）
  const oldEdit = (l, f) => ({ ...l, ...f, icon: [...String(f.icon ?? l.icon).trim()][0] || '' });
  const wood = normalizeRecord('lists', { id: 'l_wood', name: '木工', kind: 'general', ...lookFields('general', { glyph: 'saw', color: 'clay' }) });
  const renamed = normalizeRecord('lists', oldEdit(wood, { name: '木工活' }));
  assert.deepEqual([renamed.icon, renamed.glyph, renamed.color], ['', 'saw', 'clay'], '旧设备上改名字：glyph、color 原样留着');
  assert.equal(listLook(renamed).glyph, 'saw');
  const picked = normalizeRecord('lists', oldEdit(renamed, { icon: '🪚' }));
  assert.deepEqual([listLook(picked).text, listLook(picked).color], ['🪚', 'clay'], '旧设备上选了 emoji：那是最后一次换的图标');
});

test('图标方块：画好的是 svg（带色调的类、读屏不念），自己写的是字（emoji、两个字各有自己的类）', async () => {
  const dom = installDom();
  try {
    const { listTile } = await import('../src/ui/listTile.js');
    const a = listTile({ kind: 'grocery', icon: '', color: '' }, 'list-icon');
    assert.equal(a.attrs.class, 'list-tile tint-green list-icon');
    assert.equal(a.attrs['aria-hidden'], 'true');
    assert.equal(a.children[0].tag, 'svg');
    assert.equal(a.children[0].attrs.class, 'lt-glyph g-basket');
    assert.equal(a.children[0].attrs.viewBox, '0 0 24 24');
    const b = listTile({ kind: 'general', icon: '🪵', color: 'clay' }, 'sr-list-ic');
    assert.deepEqual([b.attrs.class, b.textContent, b.children[0].attrs.class], ['list-tile tint-clay sr-list-ic', '🪵', 'lt-text lt-emoji']);
    const c = listTile({ kind: 'general', icon: '木工', color: 'blue' });
    assert.deepEqual([c.attrs.class, c.textContent, c.children[0].attrs.class], ['list-tile tint-blue', '木工', 'lt-text lt-two']);
    const d = listTile({ kind: 'general', icon: '', glyph: 'saw', color: 'clay' });
    assert.deepEqual([d.attrs.class, d.children[0].attrs.class], ['list-tile tint-clay', 'lt-glyph g-saw']);
  } finally { dom.restore(); }
});
