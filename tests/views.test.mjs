// 页面在假 DOM 里画出来的样子（不开浏览器）：首页清单、设置（清单页、编辑面板、首页的操作在 listView.test.mjs）。全是编的数据
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureSeeds, blankState, normalizeRecord, stamp, deletedRecord } from '../src/core/store.js';
import { setLang, t } from '../src/i18n.js';
import { Element, all, find, installDom } from './helpers/dom.mjs';
import * as lists from '../src/views/lists.js';
import * as settings from '../src/views/settings.js';

const text = el => el ? el.textContent : null;
const rowsOf = main => main.querySelectorAll('.list-row').map(r => [text(r.querySelector('.list-name')), text(r.querySelector('.list-icon')), text(r.querySelector('.list-count'))]);
function seededWithItems() {
  const s = ensureSeeds(blankState());
  const add = (id, listId, status, extra = {}) => { s.data.items[id] = normalizeRecord('items', { id, listId, name: id, status, updatedAt: 1, ...extra }); };
  add('牛奶', 'l_groceries', 'need'); add('鸡蛋', 'l_groceries', 'need'); add('面包', 'l_groceries', 'done');
  add('苹果', 'l_groceries', 'need', { deleted: true }); add('雨伞', 'l_tobuy', 'later'); add('台灯', 'l_tobuy', 'need');
  return s;
}

test('首页：预置的两张清单按顺序显示名字、默认图标、还要买几样（只数没删除的「要买」）', () => {
  const dom = installDom();
  try {
    setLang('zh-Hans');
    const main = new Element('section');
    lists.render(main, { name: 'lists' }, { state: seededWithItems() });
    assert.equal(text(main.querySelector('h1')), '清单');
    assert.deepEqual(rowsOf(main), [['食材', '\u{1F96C}', '2'], ['想买', '\u{1F6CD}\uFE0F', '1']]);
    const srOnly = main.querySelectorAll('.sr-only').map(text);
    assert.deepEqual(srOnly, ['还要买 2 样', '还要买 1 样'], '读屏念整句');
    // 每一行是去清单页的链接；按钮只有上面的「编辑」「新建清单」
    assert.deepEqual(main.querySelectorAll('.list-row').map(r => [r.tag, r.attrs.href]), [['a', '#/l/l_groceries'], ['a', '#/l/l_tobuy']]);
    assert.deepEqual(all(main, el => el.tag === 'button').map(text), ['编辑', '新建清单']);
  } finally { dom.restore(); }
});

test('首页：改过名的显示用户写的名字（不做简繁转换），归档、删除的不显示，0 样的数字变淡；英文界面用英文的预置名', () => {
  const dom = installDom();
  try {
    const s = seededWithItems();
    s.data.lists.l_tobuy = stamp({ ...s.data.lists.l_tobuy, name: '想買的東西', icon: '🎁' }, s.data.lists.l_tobuy, 2000);
    s.data.lists.l_wood = normalizeRecord('lists', { id: 'l_wood', name: '木工', order: 5, createdAt: 3000, updatedAt: 3000 });
    s.data.lists.l_old = normalizeRecord('lists', { id: 'l_old', name: '归档的', archived: true, updatedAt: 3000 });
    s.data.lists.l_gone = deletedRecord(normalizeRecord('lists', { id: 'l_gone', name: '删掉的', updatedAt: 3000 }), 4000);
    for (const lang of ['zh-Hans', 'en']) {
      setLang(lang);
      const main = new Element('section');
      lists.render(main, { name: 'lists' }, { state: s });
      assert.deepEqual(rowsOf(main), [[lang === 'en' ? 'Groceries' : '食材', '\u{1F96C}', '2'], ['想買的東西', '🎁', '1'], ['木工', '\u{1F6CD}\uFE0F', '0']], lang);
      assert.ok(main.querySelectorAll('.list-count')[2].attrs.class.includes('zero'));
    }
  } finally { setLang('zh-Hans'); dom.restore(); }
});

test('首页：所有清单都归档了 → 显示一句说明，不是空白', () => {
  const dom = installDom();
  try {
    setLang('zh-Hans');
    const s = ensureSeeds(blankState());
    for (const id of ['l_groceries', 'l_tobuy']) s.data.lists[id] = stamp({ ...s.data.lists[id], archived: true }, s.data.lists[id], 5000);
    const main = new Element('section');
    lists.render(main, { name: 'lists' }, { state: s });
    assert.equal(main.querySelectorAll('.list-row').length, 0);
    assert.equal(text(main.querySelector('.empty')), t('list.none'));
  } finally { dom.restore(); }
});

test('设置：语言直接点选、外观立即生效且保留按钮、管理入口和版本号', () => {
  const dom = installDom();
  try {
    setLang('zh-Hans');
    const calls = [];
    const local = { theme: 'auto' };
    const ctx = { local, build: 'picknest-v7', lang: () => 'zh-Hans', setLang: l => calls.push(['lang', l]), setTheme: th => { calls.push(['theme', th]); local.theme = th; } };
    const main = new Element('section');
    settings.render(main, { name: 'settings' }, ctx);
    assert.equal(text(main.querySelector('h1')), '设置');
    assert.equal(main.querySelector('select'), null, '语言不经过系统下拉菜单');
    const options = main.querySelectorAll('.set-language-radio');
    assert.deepEqual(options.map(o => o.value), ['zh-Hans', 'zh-Hant-TW', 'en']);
    assert.deepEqual(main.querySelectorAll('.set-language').map(o => text(o)), ['简体中文', '繁體中文（台灣）', 'English']);
    assert.deepEqual(options.map(o => !!o.checked), [true, false, false]);
    options[2].checked = true; options[2].fire('change');
    assert.deepEqual(calls.at(-1), ['lang', 'en']);
    const seg = () => main.querySelector('.seg');
    const buttons = () => seg().querySelectorAll('button');
    assert.deepEqual(buttons().map(b => [text(b), b.attrs['aria-pressed']]), [['自动', 'true'], ['浅色', 'false'], ['深色', 'false']]);
    const dark = buttons()[2];
    dark.fire('click');
    assert.deepEqual(calls.at(-1), ['theme', 'dark']);
    assert.deepEqual(buttons().map(b => b.attrs['aria-pressed']), ['false', 'false', 'true'], '换完马上更新按钮');
    assert.deepEqual(buttons().map(b => b.classList.contains('on')), [false, false, true]);
    assert.equal(buttons()[2], dark, '就地更新、不换掉按钮：焦点和读屏的位置不丢');
    assert.equal(options[2].dataset.fid, 'set-lang-en', '换语言后焦点回到刚选中的选项');
    assert.ok(text(main.querySelector('.set-version')).includes('picknest-v7'));
    assert.ok(text(main).includes('PickNest'));
    assert.equal(main.querySelectorAll('.set-sec').length, 5, '语言、外观、商店和分类、同步和数据、关于');
    assert.deepEqual(all(main, el => el.tag === 'a').map(a => [a.attrs.href, text(a.querySelector('.set-label'))]),
      [['#/settings/stores', '商店'], ['#/settings/categories', '分类'], ['#/settings/sync', '同步'], ['#/settings/data', '数据']]);
  } finally { dom.restore(); }
});

test('设置：本机设置里的外观值不认识 → 当成「自动」', () => {
  const dom = installDom();
  try {
    setLang('en');
    const main = new Element('section');
    settings.render(main, { name: 'settings' }, { local: { theme: 'sepia' }, build: 'picknest-v1', lang: () => 'en', setLang() {}, setTheme() {} });
    const on = find(main.querySelector('.seg'), el => el.tag === 'button' && el.attrs['aria-pressed'] === 'true');
    assert.equal(text(on), 'Auto');
  } finally { setLang('zh-Hans'); dom.restore(); }
});

test('同步状态的小标签：首页标题旁边是去设置 → 同步的链接；设置里「同步」那一行本身是链接，里面的标签是 <span>（不套链接）', async () => {
  const { syncBadge } = await import('../src/ui/syncBadge.js');
  const dom = installDom();
  try {
    setLang('zh-Hans');
    const opts = [];
    const st = { on: true, at: Date.now(), dirty: false };
    const ctx = { state: seededWithItems(), local: { theme: 'auto' }, build: 'picknest-v7', lang: () => 'zh-Hans', setLang() {}, setTheme() {},
      syncBadge: (o) => { opts.push(o); return syncBadge(st, 'zh-Hans', o); } };
    const home = new Element('section');
    lists.render(home, { name: 'lists' }, ctx);
    const badge = home.querySelector('.sync-badge');
    assert.deepEqual([badge.tag, badge.attrs.href], ['a', '#/settings/sync']);
    assert.match(text(badge), /^已同步 · \d{1,2}:\d{2}$/);
    assert.equal(badge.parent.attrs.class, 'lt-row', '在大标题旁边');
    const set = new Element('section');
    settings.render(set, { name: 'settings' }, ctx);
    const row = find(set, el => el.tag === 'a' && el.attrs.href === '#/settings/sync');
    assert.equal(row.querySelector('.sync-badge').tag, 'span');
    assert.deepEqual(opts, [undefined, { link: false }]);
    // 没开、出错、离线、令牌快到期的样子
    const look = (s) => { const b = syncBadge(s, 'zh-Hans'); return [b.attrs.class, text(b)]; };
    assert.deepEqual(look(null), ['sync-badge off', '未开同步']);
    assert.deepEqual(look({ on: true, err: { code: 'auth' } }), ['sync-badge err', '同步出错']);
    assert.equal(syncBadge({ on: true, err: { code: 'auth' } }, 'zh-Hans').attrs.title, t('syncErr.auth'), '鼠标停上去看到原因');
    assert.deepEqual(look({ on: true, offline: true, dirty: true }), ['sync-badge wait', '离线']);
    assert.deepEqual(look({ on: true, tokenExp: Date.now() + 864e5 }), ['sync-badge warn', '令牌快到期']);
    assert.deepEqual(look({ on: true, dirty: true }), ['sync-badge wait', '待同步']);
  } finally { dom.restore(); }
});

test('设置里的子页面没有的部分不画成字「null」（append 不像 h() 那样跳过 null）', () => {
  const dom = installDom();
  try {
    setLang('zh-Hans');
    const ctx = { state: ensureSeeds(blankState()), local: {}, lang: () => 'zh-Hans', back() {}, recoveryArchive: () => null,
      sync: { status: () => ({ on: false }) }, on: () => () => {} };
    for (const sub of ['stores', 'categories', 'sync', 'data']) {
      const main = new Element('section');
      settings.render(main, { name: 'settings', sub }, ctx);
      assert.ok(main.children.length && !text(main).includes('null'), sub);
    }
  } finally { dom.restore(); }
});
