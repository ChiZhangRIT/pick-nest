// 页面在假 DOM 里画出来的样子（不开浏览器）：首页清单、设置（清单页、编辑面板、首页的操作在 listView.test.mjs）。全是编的数据
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureSeeds, blankState, normalizeRecord, stamp, deletedRecord } from '../src/core/store.js';
import { setLang, t } from '../src/i18n.js';
import { Element, all, find, installDom } from './helpers/dom.mjs';
import * as lists from '../src/views/lists.js';
import * as settings from '../src/views/settings.js';

const text = el => el ? el.textContent : null;
// 图标方块写成「图标 色调」：画好的写成 'i:名字'（只是这里的写法，数据里存在 glyph），自己写的是那个字
const tileOf = el => { const g = el.querySelector('.lt-glyph'); const cls = el.attrs.class; return (g ? 'i:' + /g-(\w+)/.exec(g.attrs.class)[1] : text(el)) + ' ' + /tint-(\w+)/.exec(cls)[1]; };
const rowsOf = main => main.querySelectorAll('.list-row').map(r => [text(r.querySelector('.list-name')), tileOf(r.querySelector('.list-icon')), text(r.querySelector('.list-count'))]);
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
    assert.deepEqual(rowsOf(main), [['食材', 'i:basket green', '2'], ['想买', 'i:bag amber', '1']], '预置清单没选过：食材是绿底菜篮、想买是琥珀底购物袋');
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
    s.data.lists.l_wood = normalizeRecord('lists', { id: 'l_wood', name: '木工', glyph: 'saw', color: 'clay', order: 5, createdAt: 3000, updatedAt: 3000 });
    s.data.lists.l_cloth = normalizeRecord('lists', { id: 'l_cloth', name: '衣服', icon: '衣', color: 'future-tint', order: 6, createdAt: 3000, updatedAt: 3000 });
    s.data.lists.l_old = normalizeRecord('lists', { id: 'l_old', name: '归档的', archived: true, updatedAt: 3000 });
    s.data.lists.l_gone = deletedRecord(normalizeRecord('lists', { id: 'l_gone', name: '删掉的', updatedAt: 3000 }), 4000);
    for (const lang of ['zh-Hans', 'en']) {
      setLang(lang);
      const main = new Element('section');
      lists.render(main, { name: 'lists' }, { state: s });
      assert.deepEqual(rowsOf(main), [[lang === 'en' ? 'Groceries' : '食材', 'i:basket green', '2'], ['想買的東西', '🎁 amber', '1'], ['木工', 'i:saw clay', '0'], ['衣服', '衣 amber', '0']], lang);
      assert.equal(main.querySelectorAll('.list-icon')[0].attrs['aria-hidden'], 'true', '方块给眼睛看，读屏念名字');
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

test('设置：语言是第一组的下拉框（没有组名，有读屏的名字）、同步 / 商店和分类 / 饮食 / 外观 / 数据 / 关于的顺序和组名、外观立即生效且保留按钮、版本号', () => {
  const dom = installDom();
  try {
    setLang('zh-Hans');
    const calls = [];
    const local = { theme: 'auto' };
    const ctx = { state: ensureSeeds(blankState()), local, build: 'picknest-v7', lang: () => 'zh-Hans', setLang: l => calls.push(['lang', l]), setTheme: th => { calls.push(['theme', th]); local.theme = th; } };
    const main = new Element('section');
    settings.render(main, { name: 'settings' }, ctx);
    assert.equal(text(main.querySelector('h1')), '设置');
    // 语言：和别的 App 一样是下拉框，在最上面、没有组名；那一行的字跟着界面写（简体界面「语言 / Language」）
    const secs = main.querySelectorAll('.set-sec');
    assert.deepEqual(secs.map(s => text(s.querySelector('h2'))), [null, '同步', '商店和分类', '饮食', '外观', '数据', '关于']);
    const select = secs[0].querySelector('select');
    assert.equal(select.attrs['aria-label'], '语言 / Language', '读屏念得出这是什么');
    assert.equal(select.parent.tag, 'label', '整行是 <label>：点哪里都行');
    assert.equal(select.dataset.fid, 'set-lang', '换语言重画后靠它把焦点放回来');
    const options = select.querySelectorAll('option');
    assert.deepEqual(options.map(o => [o.value, text(o), !!o.selected]), [['zh-Hans', '简体中文', true], ['zh-Hant-TW', '繁體中文（台灣）', false], ['en', 'English', false]]);
    select.value = 'en'; select.fire('change');
    assert.deepEqual(calls.at(-1), ['lang', 'en']);
    assert.equal(main.querySelector('.set-language-radio'), null, '不再是一排单选');
    const seg = () => main.querySelector('.seg');
    const buttons = () => seg().querySelectorAll('button');
    assert.deepEqual(buttons().map(b => [text(b), b.attrs['aria-pressed']]), [['自动', 'true'], ['浅色', 'false'], ['深色', 'false']]);
    const dark = buttons()[2];
    dark.fire('click');
    assert.deepEqual(calls.at(-1), ['theme', 'dark']);
    assert.deepEqual(buttons().map(b => b.attrs['aria-pressed']), ['false', 'false', 'true'], '换完马上更新按钮');
    assert.deepEqual(buttons().map(b => b.classList.contains('on')), [false, false, true]);
    assert.equal(buttons()[2], dark, '就地更新、不换掉按钮：焦点和读屏的位置不丢');
    assert.ok(text(main.querySelector('.set-version')).includes('picknest-v7'));
    assert.ok(text(main).includes('PickNest'));
    assert.deepEqual(all(main, el => el.tag === 'a').map(a => [a.attrs.href, text(a.querySelector('.set-label'))]),
      [['#/settings/sync', '多设备同步'], ['#/settings/stores', '商店'], ['#/settings/categories', '分类'], ['#/settings/goals', '饮食目标'], ['#/settings/data', '备份与恢复'], ['#/deleted', '最近删除']]);
    // 同步没开：下面说是什么；数据下面说上次备份（还没备份过：琥珀色）
    assert.equal(text(secs[1].querySelector('.group-foot')), '用你自己的 GitHub 私有仓库，在 iPhone、iPad、Mac 之间同步。');
    assert.equal(text(secs[3].querySelector('.group-foot')), '还没设目标', '饮食目标下面写设了多少');
    const foot = secs[5].querySelector('.group-foot');
    assert.deepEqual([text(foot), foot.classList.contains('set-warn')], ['上次备份：还没备份过', true]);
  } finally { dom.restore(); }
});

test('设置首页：数据变了只改「最近删除」的数和下面那句（不重建、焦点不丢）；同步开着写仓库；上次备份今天 / n 天前，30 天以上提醒', () => {
  const dom = installDom();
  try {
    setLang('zh-Hans');
    const subs = {};
    const status = { on: true, repo: 'someone/pick-nest-data' };
    // 按日历往前推 n 天（不是 n × 24 小时：夏令时那几周半夜里跑，差一小时就会多算一天）
    const daysBack = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.getTime(); };
    const ctx = { state: ensureSeeds(blankState()), local: { theme: 'auto', lastBackupAt: daysBack(3) }, build: 'picknest-v7', lang: () => 'zh-Hans', setLang() {}, setTheme() {},
      sync: { status: () => status }, on: (ev, fn) => { subs[ev] = fn; return () => {}; } };
    const main = new Element('section');
    const handle = settings.render(main, { name: 'settings' }, ctx);
    const secs = main.querySelectorAll('.set-sec');
    const deletedRow = find(main, el => el.tag === 'a' && el.attrs.href === '#/deleted');
    assert.equal(text(deletedRow.querySelector('.set-count')), '', '没有删掉的不写 0');
    assert.equal(text(secs[1].querySelector('.group-foot')), '仓库：someone/pick-nest-data');
    const foot = secs[5].querySelector('.group-foot');
    assert.deepEqual([text(foot), foot.classList.contains('set-warn')], ['上次备份：3 天前', false]);
    // 别的设备删了一家店：只改数，选项、链接都还是原来那几个元素
    const select = main.querySelector('select');
    select.focus();
    ctx.state.data.stores.s_costco = deletedRecord(ctx.state.data.stores.s_costco);
    ctx.local.lastBackupAt = daysBack(40);
    handle.onChange({ source: 'remote' });
    assert.equal(text(deletedRow.querySelector('.set-count')), '1');
    assert.deepEqual([text(foot), foot.classList.contains('set-warn')], ['上次备份：40 天前', true]);
    assert.equal(main.querySelector('select'), select);
    assert.equal(dom.doc.activeElement, select);
    ctx.local.lastBackupAt = Date.now();
    handle.onChange({ source: 'local' });
    assert.deepEqual([text(foot), foot.classList.contains('set-warn')], ['上次备份：今天', false]);
    // 停止同步：下面那句换成没开时的说明
    status.on = false; status.repo = null;
    subs.sync();
    assert.equal(text(secs[1].querySelector('.group-foot')), '用你自己的 GitHub 私有仓库，在 iPhone、iPad、Mac 之间同步。');
    setLang('en');
    const en = new Element('section');
    settings.render(en, { name: 'settings' }, { ...ctx, lang: () => 'en', local: { lastBackupAt: daysBack(1) } });
    assert.equal(text(en.querySelector('label').querySelector('.set-label')), 'Language / 语言');
    assert.equal(text(en.querySelectorAll('.set-sec')[5].querySelector('.group-foot')), 'Last backup: 1 day ago');
  } finally { setLang('zh-Hans'); dom.restore(); }
});

test('设置：本机设置里的外观值不认识 → 当成「自动」', () => {
  const dom = installDom();
  try {
    setLang('en');
    const main = new Element('section');
    settings.render(main, { name: 'settings' }, { state: ensureSeeds(blankState()), local: { theme: 'sepia' }, build: 'picknest-v1', lang: () => 'en', setLang() {}, setTheme() {} });
    const on = find(main.querySelector('.seg'), el => el.tag === 'button' && el.attrs['aria-pressed'] === 'true');
    assert.equal(text(on), 'Auto');
  } finally { setLang('zh-Hans'); dom.restore(); }
});

test('同步状态的小标签：手机上首页标题旁边是去设置 → 多设备同步的链接（iPad、Mac 上只在侧栏）；设置里「同步」那一行本身是链接，里面的标签是 <span>（不套链接）', async () => {
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
    // 有侧栏的布局：侧栏「设置」下面已经有一个，标题旁边不重复
    for (const lay of ['side', 'two']) {
      const wide = new Element('section');
      lists.render(wide, { name: 'lists', pane: lay === 'two' ? 'list' : 'main' }, { ...ctx, syncBadge: (o) => syncBadge(st, 'zh-Hans', o), layout: () => lay });
      assert.equal(wide.querySelector('.sync-badge'), null, lay);
    }
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
