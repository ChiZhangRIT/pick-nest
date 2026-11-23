import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { t, setLang, getLang, guessLang, has, LANGS, LANG_LABELS, STRINGS, TABLES } from '../src/i18n.js';
import { SYS_LISTS, SYS_CATEGORIES } from '../src/core/store.js';

const fields = s => [...s.matchAll(/\{(\w+)\}/g)].map(x => x[1]).sort();
const SAMPLE = { n: 3, v: 'picknest-v1', lists: 2, items: 5, name: '木工' };

test('每个文案文件：三种语言的键完全一样', () => {
  for (const [name, table] of Object.entries(TABLES)) {
    const keys = Object.keys(table['zh-Hans']).sort();
    for (const lang of LANGS) assert.deepEqual(Object.keys(table[lang] || {}).sort(), keys, `${name} / ${lang}`);
  }
});

test('同一个键不能出现在两个文案文件里（合并时会互相覆盖）', () => {
  const seen = new Map();
  for (const [name, table] of Object.entries(TABLES)) {
    for (const key of Object.keys(table['zh-Hans'])) {
      assert.ok(!seen.has(key), `${key} 同时在 ${seen.get(key)} 和 ${name}`);
      seen.set(key, name);
    }
  }
});

test('动态字段 {x} 三种语言一致；函数文案能用示例变量算出完整的句子', () => {
  for (const key of Object.keys(STRINGS['zh-Hans'])) {
    const vals = LANGS.map(l => STRINGS[l][key]);
    for (const v of vals) assert.ok(typeof v === 'string' ? v.length : typeof v === 'function', key);
    const strs = vals.filter(v => typeof v === 'string');
    for (const s of strs) assert.deepEqual(fields(s), fields(strs[0]), key);
    for (const [i, v] of vals.entries()) {
      if (typeof v !== 'function') continue;
      for (const n of [0, 1, 2, 12]) {
        const out = v({ ...SAMPLE, n }, { lang: LANGS[i], num: String });
        assert.equal(typeof out, 'string', key);
        assert.ok(out.length && !/\{\w+\}|undefined/.test(out), `${key} → ${out}`);
      }
    }
  }
});

test('每个文案文件只用自己的前缀；预置清单、预置分类都有文案', () => {
  const prefix = { core: /^(common|nav)\./, lists: /^list\./, items: /^item\./, stores: /^store\./, catalog: /^cat\./, settings: /^set\./, recovery: /^recovery\./, sync: /^sync(Err)?\./, data: /^(data|backup|deleted)\./, shop: /^shop\./, search: /^search\./ };
  assert.deepEqual(Object.keys(TABLES).sort(), Object.keys(prefix).sort());
  for (const [name, table] of Object.entries(TABLES)) for (const key of Object.keys(table['zh-Hans'])) assert.match(key, prefix[name], `${name}: ${key}`);
  for (const sys of SYS_LISTS) assert.ok(has('list.sys.' + sys), sys);
  for (const sys of SYS_CATEGORIES) assert.ok(has('cat.sys.' + sys), sys);
  for (const key of ['list.untitled', 'cat.untitled', 'nav.lists', 'nav.stores', 'nav.settings', 'store.none', 'common.appName']) assert.ok(has(key), key);
});

test('t()：替换变量；缺变量保留原样；不认识的键返回键名；不认识的语言退回简体', () => {
  setLang('zh-Hans');
  assert.equal(t('list.needN', { n: 3 }), '还要买 3 样');
  assert.equal(t('list.needN'), '还要买 {n} 样');
  assert.equal(t('no.such.key'), 'no.such.key');
  assert.equal(setLang('fr'), 'zh-Hans');
  assert.equal(getLang(), 'zh-Hans');
});

test('预置清单的名字三种语言；英文数量分单复数', () => {
  const names = { 'zh-Hans': ['食材', '想买'], 'zh-Hant-TW': ['食材', '想買'], en: ['Groceries', 'To Buy'] };
  for (const [lang, want] of Object.entries(names)) {
    setLang(lang);
    assert.deepEqual([t('list.sys.groceries'), t('list.sys.tobuy')], want, lang);
  }
  setLang('en');
  assert.equal(t('list.needN', { n: 1 }), '1 item to buy');
  assert.equal(t('list.needN', { n: 4 }), '4 items to buy');
  setLang('zh-Hans');
});

test('台灣用語', () => {
  setLang('zh-Hant-TW');
  const want = { 'nav.settings': '設定', 'nav.lists': '清單', 'store.archive': '封存', 'store.add': '新增商店', 'cat.sec.both': '兩邊都用', 'common.undo': '復原', 'cat.sys.bakery': '麵包烘焙', 'cat.sys.frozen': '冷凍', 'set.theme.light': '淺色',
    'sync.renew': '更換權杖', 'sync.repo': '儲存庫', 'set.dataH': '資料', 'set.data': '備份與還原', 'deleted.restore': '還原', 'backup.download': '匯出備份',
    'set.sync': '多裝置同步', 'common.save': '儲存', 'common.keepEditing': '繼續編輯', 'common.exportRaw': '匯出資料（JSON）' };
  for (const [key, value] of Object.entries(want)) assert.equal(t(key), value, key);
  setLang('zh-Hans');
});

test('语言列表和名称；按系统语言猜第一次打开的语言', () => {
  assert.deepEqual(LANGS, ['zh-Hans', 'zh-Hant-TW', 'en']);
  for (const l of LANGS) assert.ok(LANG_LABELS[l], l);
  assert.equal(guessLang(['zh-TW']), 'zh-Hant-TW');
  assert.equal(guessLang(['zh-Hant-HK']), 'zh-Hant-TW');
  assert.equal(guessLang(['zh-CN', 'en']), 'zh-Hans');
  assert.equal(guessLang(['en-US']), 'zh-Hans');            // 英文系统也先用简体，English 要在设置里选
  assert.equal(guessLang(['en-US', 'zh-Hant-TW']), 'zh-Hant-TW');
  assert.equal(guessLang([]), 'zh-Hans');
});

test('源码里写死的文案键（t(\'…\')）都有；拼出来的键（t(\'list.sys.\' + sys)）至少有一个', () => {
  const root = new URL('../src/', import.meta.url).pathname;
  const files = [];
  (function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (p.endsWith('.js') && f !== 'i18n.js') files.push(p); } })(root);   // i18n.js 自己的注释里有 t('key') 示例
  let n = 0;
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/\bt\(\s*'([a-zA-Z][\w.]*)'\s*([,)+])/g)) {
      n++;
      if (m[2] === '+') assert.ok(Object.keys(STRINGS['zh-Hans']).some(k => k.startsWith(m[1])), `${path.basename(f)}: ${m[1]}…`);
      else assert.ok(has(m[1]), `${path.basename(f)}: ${m[1]}`);
    }
  }
  assert.ok(n > 20, `只找到 ${n} 处 t()，正则可能坏了`);
});
