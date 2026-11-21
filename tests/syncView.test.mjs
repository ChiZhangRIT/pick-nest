// 设置 → 同步（views/sync.js）和设置 → 数据（views/data.js）在假 DOM 里：没开 / 开着的各种状态、连接、换令牌、停止、复制同步码；
// 下载 / 分享备份、从备份恢复（真的 state.js，只用内存）。ctx.sync 是假的（不联网）；全是编的数据，令牌也是编的
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as state from '../src/core/state.js';
import { normalizeRecord, deletedRecord } from '../src/core/store.js';
import { SyncError, syncCode } from '../src/core/sync.js';
import { buildBackup } from '../src/core/backup.js';
import { endOfDay, dayValue } from '../src/core/dates.js';
import { syncPage } from '../src/views/sync.js';
import { dataPage } from '../src/views/data.js';
import { syncBadge } from '../src/ui/syncBadge.js';
import { setLang, t } from '../src/i18n.js';
import { Element, all, find, installDom } from './helpers/dom.mjs';

const TOKEN = 'github_pat_11TEST_onlyInTests';
const cls = (el, c) => (el.className || el.attrs.class || '').split(' ').includes(c);
const byCls = (root, c) => find(root, el => cls(el, c));
const btn = (root, label) => find(root, el => el.tag === 'button' && el.textContent === label);
const inputs = root => all(root, el => el.tag === 'input');
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(r => queueMicrotask(r)); };
const errors = root => all(root, el => (cls(el, 'f-err') && !el.hidden) || (el.attrs.role === 'alert' && cls(el, 'err'))).map(el => el.textContent);

/** 假的 ctx。sync：status 从 local.sync 算；connect 写进 local.sync 并返回 env.round；checkRepo 用 env.check */
function setup({ sync = null, lang = 'zh-Hans', page = 'sync', share = false } = {}) {
  const writes = [], blobs = [], shared = [];
  const dom = installDom({
    setTimeout: (fn) => { queueMicrotask(fn); return 0; },
    navigator: { clipboard: { writeText: async (s) => { writes.push(s); } },
      ...(share ? { canShare: () => true, share: async (d) => { shared.push(d); if (env.shareErr) throw env.shareErr; } } : {}) },
    URL: { createObjectURL: (b) => { blobs.push(b); return 'blob:test'; }, revokeObjectURL() {} },
    File: class extends Blob { constructor(parts, name, o) { super(parts, o); this.name = name; } },
  });
  setLang(lang);
  state.load({ storage: null });
  if (sync) state.setLocal({ sync: { ...sync } });
  const env = { ...dom, writes, blobs, shared, toasts: [], confirms: [], answer: true, calls: [], round: { ok: true }, check: async (repo) => repo, running: false, shareErr: null };
  const listeners = [];
  const ctx = env.ctx = {
    t, lang: () => lang,
    get state() { return state.getState(); }, get local() { return state.getLocal(); },
    setLocal: (p) => state.setLocal(p),
    mergeIn: (o) => state.mergeIn(o),
    toast: (msg, o = {}) => env.toasts.push({ msg, ...o }),
    confirm: async (o) => { env.confirms.push(o); return env.answer; },
    back: () => {}, on: (ev, fn) => { if (ev === 'sync') listeners.push(fn); return () => {}; },
    recoveryArchive: () => env.archive || null,
    sync: {
      status() { const c = state.getLocal().sync; return { on: !!c, running: env.running, repo: c && c.repo, at: c && c.at, err: c && c.err, offline: !!(c && c.offline), dirty: !!(c && c.dirty), tokenExp: (c && c.tokenExp) || null }; },
      async checkRepo(repo, token) { env.calls.push(['check', repo, token]); return env.check(repo, token); },
      async connect(cfg) { env.calls.push(['connect', cfg]); state.setLocal({ sync: { ...cfg, dirty: true, at: env.round.ok ? Date.now() : null, err: env.round.ok ? null : env.round.error } }); return env.round; },
      stop() { env.calls.push(['stop']); state.setLocal({ sync: null }); },
      async now() { env.calls.push(['now']); return env.round; },
    },
  };
  ctx.syncBadge = (o) => syncBadge(ctx.sync.status(), lang, o);
  env.main = new Element('section');
  env.handle = (page === 'sync' ? syncPage : dataPage)(env.main, { name: 'settings', sub: page }, ctx);
  env.emitSync = () => listeners.forEach(fn => fn(ctx.sync.status()));
  env.done = () => { if (env.handle && env.handle.cleanup) env.handle.cleanup(); dom.restore(); };
  return env;
}
const type = async (input, value, ev = 'input') => { input.focus(); input.value = value; await input.fire(ev); };
/** 用键盘、读屏按一个按钮：焦点先在它上面（Safari 用鼠标点按钮不给焦点，那时也用不着放回去） */
const press = async (el) => { el.focus(); await el.fire('click'); };
const fidOf = (env) => env.doc.activeElement && env.doc.activeElement.dataset ? env.doc.activeElement.dataset.fid : null;

test('没开同步：说明、粘贴同步码、第一次设置的步骤、仓库（只有占位的例子）/ 令牌 / 到期日、「连接」；没有停止、立即同步', () => {
  const env = setup();
  try {
    const { main } = env;
    assert.equal(main.querySelector('.push-title').textContent, '同步');
    assert.ok(main.textContent.includes(t('sync.intro')));
    const [code, repo, token, exp] = inputs(main);
    assert.equal(code.attrs.placeholder, '粘贴同步码（picknest-sync: 开头）');
    assert.deepEqual([repo.value, repo.attrs.placeholder], ['', 'chizhangrit/pick-nest-data'], '默认的仓库名只是占位');
    assert.deepEqual([token.attrs.type, token.attrs.placeholder], ['password', 'github_pat_…']);
    assert.equal(exp.attrs.type, 'date');
    // 步骤和 GitHub 页面上的顺序一样：Token name（必填）→ Expiration → Repository access → Permissions（新版页面要先 Add permissions）
    const steps = all(byCls(main, 'sy-steps'), el => el.tag === 'li').map(li => li.textContent);
    assert.equal(steps.length, 7);
    assert.ok(steps[0].includes('Private') && steps[0].includes('Keep this code private'));
    assert.ok(steps[1].includes('Token name'));
    assert.ok(steps[2].startsWith('Expiration'));
    assert.ok(steps[3].includes('Only select repositories'));
    assert.ok(steps[4].includes('Read and write') && steps[4].includes('Add permissions'));
    const link = find(main, el => el.tag === 'a' && el.attrs.href === 'https://github.com/settings/personal-access-tokens/new');
    assert.deepEqual([link.attrs.target, link.attrs.rel], ['_blank', 'noopener']);
    assert.ok(btn(main, '连接'));
    for (const label of ['停止同步', '立即同步', '复制同步码']) assert.equal(btn(main, label), undefined, label);
  } finally { env.done(); }
});

test('粘贴同步码：马上填好仓库和令牌、说一声，焦点给「连接」；不是 PickNest 的同步码说清楚；粘进令牌那一栏也认', async () => {
  const env = setup();
  try {
    const { main } = env;
    const [code, repo, token] = inputs(main);
    await type(code, 'babble-sync:me/data:' + TOKEN, 'input');
    await code.fire('change');
    assert.deepEqual(errors(main), [t('sync.badCode')]);
    await type(code, '  ' + syncCode('me/pick-nest-data', TOKEN) + '\n');
    assert.deepEqual([code.value, repo.value, token.value], ['', 'me/pick-nest-data', TOKEN]);
    assert.equal(byCls(main, 'sy-filled').hidden, false);
    assert.equal(env.doc.activeElement, btn(main, '连接'));
    assert.deepEqual(errors(main), []);
    await type(token, syncCode('me/other', TOKEN));
    assert.equal(repo.value, 'me/other');
    // 带着到期日的同步码：到期日也填上（这台设备到期前一样会提醒），连接时用上
    await type(code, syncCode('me/pick-nest-data', TOKEN, { exp: '2027-02-01' }));
    assert.equal(inputs(main)[3].value, '2027-02-01');
    await btn(main, '连接').fire('click'); await settle();
    assert.equal(env.calls.find(c => c[0] === 'connect')[1].tokenExp, endOfDay('2027-02-01'));
  } finally { env.done(); }
});

test('连接：仓库名、令牌先在本机查（经典令牌不收，错误标在那一栏下面，不发请求）；再查仓库、连接、同步一次，成功了换成开着的样子', async () => {
  const env = setup();
  try {
    const { main } = env;
    const [, repo, token, exp] = inputs(main);
    await type(repo, 'pick-nest-data'); await type(token, TOKEN);
    await btn(main, '连接').fire('click');
    assert.deepEqual(errors(main), [t('syncErr.badRepo')]);
    await type(inputs(main)[1], 'me/pick-nest-data'); await type(inputs(main)[2], 'ghp_classic123');
    await btn(main, '连接').fire('click');
    assert.deepEqual(errors(main), [t('syncErr.classic')]);
    await type(inputs(main)[2], '0123456789abcdef0123456789abcdef01234567');
    await btn(main, '连接').fire('click');
    assert.deepEqual(errors(main), [t('syncErr.classic')], '以前没有前缀的经典令牌也不收');
    await type(inputs(main)[2], 'not-a-token');
    await btn(main, '连接').fire('click');
    assert.deepEqual(errors(main), [t('syncErr.notFine')]);
    await type(inputs(main)[2], TOKEN);
    // 用键盘填日期填到一半（年份还是 0002）就点了连接：说日期不对，不悄悄当成没填
    exp.value = '0002-02-01'; await exp.fire('change');
    await btn(main, '连接').fire('click');
    assert.deepEqual(errors(main), [t('sync.badDate')]);
    assert.equal(env.calls.length, 0, '没发请求');
    const ex = inputs(main)[3];
    ex.value = '2027-02-01'; await ex.fire('change');
    assert.deepEqual(errors(main), [], '改了日期，错误收起来');
    env.check = async () => 'Me/pick-nest-data';
    await press(btn(main, '连接'));
    await settle();
    assert.deepEqual(env.calls[0], ['check', 'me/pick-nest-data', TOKEN]);
    assert.deepEqual(env.calls[1], ['connect', { repo: 'Me/pick-nest-data', token: TOKEN, tokenExp: endOfDay('2027-02-01') }], '用 GitHub 给的全名');
    assert.equal(env.toasts.at(-1).msg, t('sync.connected'));
    assert.equal(state.getLocal().sync.token, TOKEN, '令牌只在本机设置里');
    assert.ok(!JSON.stringify(state.getState()).includes(TOKEN), '不进数据');
    assert.ok(btn(main, '立即同步') && btn(main, '停止同步'));
    assert.equal(byCls(main, 'sy-repo').textContent, 'Me/pick-nest-data');
    assert.equal(fidOf(env), 'sy-now', '连接好了：焦点给「立即同步」，不掉回页首');
  } finally { env.done(); }
});

test('连接没成功（公开仓库、令牌不对、第一轮同步出错）：说原因，停掉（第一次连接），按钮还能再点', async () => {
  for (const [check, round, msg] of [
    [async () => { throw new SyncError('public'); }, { ok: true }, t('syncErr.public')],
    [async () => { throw new SyncError('notfound'); }, { ok: true }, t('syncErr.notfound')],
    [async (r) => r, { ok: false, error: { code: 'perm', vars: {} } }, t('syncErr.perm')],
    [async (r) => r, { ok: false, offline: true }, t('syncErr.net')],
    // 令牌不对：这一页上没有「换令牌」，不能叫人去点它
    [async () => { throw new SyncError('auth'); }, { ok: true }, t('syncErr.authNew')],
  ]) {
    const env = setup();
    try {
      env.check = check; env.round = round;
      await type(inputs(env.main)[1], 'me/pick-nest-data'); await type(inputs(env.main)[2], TOKEN);
      await press(btn(env.main, '连接'));
      await settle();
      assert.deepEqual(errors(env.main), [msg]);
      assert.ok(!errors(env.main)[0].includes('换令牌'));
      assert.equal(state.getLocal().sync, null);
      assert.ok(env.calls.some(c => c[0] === 'check'));
      assert.ok(!btn(env.main, '连接').disabled);
      assert.equal(env.doc.activeElement, btn(env.main, '连接'), '连接中按钮不能按，按完焦点回到它');
      assert.equal(inputs(env.main)[1].value, 'me/pick-nest-data', '填的还在');
    } finally { env.done(); }
  }
});

test('开着：仓库、上次同步、有没传的修改、离线、出错的说明（请求太多说什么时候再试）；同步状态变了重画，但焦点在输入框里时等它离开', async () => {
  const at = Date.now() - 60000;
  const env = setup({ sync: { repo: 'me/pick-nest-data', token: TOKEN, at, dirty: true, tokenExp: Date.now() + 90 * 864e5 } });
  try {
    const { main } = env;
    assert.equal(byCls(main, 'sy-repo').textContent, 'me/pick-nest-data');
    assert.equal(byCls(main, 'sync-badge').tag, 'span', '页面里的标签不是链接');
    assert.ok(main.textContent.includes('上次同步：今天 '));
    assert.ok(main.textContent.includes(t('sync.pendingLine')));
    assert.ok(main.textContent.includes('令牌 ') && !byCls(main, 'sy-warn'), '还早：不提醒');
    for (const label of ['立即同步', '复制同步码', '换令牌', '停止同步']) assert.ok(btn(main, label), label);
    Object.assign(state.getLocal().sync, { offline: true });
    env.emitSync();
    assert.ok(main.textContent.includes(t('sync.offlineLine')));
    const until = new Date(2026, 10, 21, 16, 5).getTime();
    Object.assign(state.getLocal().sync, { offline: false, err: { code: 'rate', vars: { status: 429, until } } });
    env.emitSync();
    assert.deepEqual(errors(main), ['GitHub 说请求太多了，16:05 以后会自动再试。']);
    assert.equal(byCls(main, 'sync-badge').textContent, '稍后重试');
    // 焦点在输入框里（补到期日、换令牌的时候）：先不重画
    await btn(main, '换令牌').fire('click');
    const newTok = find(main, el => el.tag === 'input' && el.dataset.fid === 'sy-new-token');
    newTok.focus();
    Object.assign(state.getLocal().sync, { err: { code: 'auth', vars: {} } });
    env.emitSync();
    assert.ok(!main.textContent.includes(t('syncErr.auth')));
    assert.equal(find(main, el => el.tag === 'input' && el.dataset.fid === 'sy-new-token'), newTok, '输入框还是同一个');
    env.doc.activeElement = null; await main.fire('focusout'); await settle();
    assert.ok(main.textContent.includes(t('syncErr.auth')));
    assert.equal(byCls(main, 'sync-badge').textContent, '同步出错');
  } finally { env.done(); }
});

test('令牌到期：两周内提醒（还有几天 / 今天）、过期了说怎么办；没填过到期日可以在这里补上（点「保存」才算）', async () => {
  const now = Date.now();
  // 多留一小时：页面自己取的「现在」比这里晚几毫秒，正��� 5 天整会按 4 天算（真的到期日都是那天 23:59）
  for (const [exp, want] of [[now + 5 * 864e5 + 3600e3, '还有 5 天'], [now + 3600e3, '今天到期'], [now - 2 * 864e5, '令牌已经过期']]) {
    const env = setup({ sync: { repo: 'me/data', token: TOKEN, at: now, tokenExp: exp } });
    try {
      assert.ok(byCls(env.main, 'sy-warn').textContent.includes(want), want);
      assert.equal(byCls(env.main, 'sync-badge').textContent, '令牌快到期');
    } finally { env.done(); }
  }
  const env = setup({ sync: { repo: 'me/data', token: TOKEN, at: now } });
  try {
    const add = () => find(env.main, el => el.tag === 'input' && el.dataset.fid === 'sy-exp-add');
    const cfg = state.getLocal().sync;
    // 用键盘填：年份一位一位进去，每一步都有 change（0002-03-01……）：只是记下，不存、输入框也不换掉
    const input = add();
    input.focus();
    for (const v of ['0002-03-01', '0020-03-01']) { input.value = v; await input.fire('input'); await input.fire('change'); }
    assert.equal(add(), input, '还是同一个输入框');
    assert.equal(cfg.tokenExp, undefined);
    await press(btn(env.main, '保存到期日'));
    assert.deepEqual(errors(env.main), [t('sync.badDate')], '没填完就点保存：说日期不对');
    assert.equal(cfg.tokenExp, undefined);
    assert.equal(add().value, '0020-03-01', '填的还在');
    add().value = '2027-03-01'; await add().fire('change');
    await press(btn(env.main, '保存到期日'));
    assert.equal(state.getLocal().sync, cfg, '改的是同一个设置对象：正在跑的同步不受影响');
    assert.equal(cfg.tokenExp, endOfDay('2027-03-01'));
    assert.ok(env.main.textContent.includes('令牌 2027年3月1日 到期。'));
    assert.equal(add(), undefined);
    assert.equal(fidOf(env), 'sy-title', '那一块没了：焦点给标题');
    // 复制的同步码带着到期日：别的设备用它连上也会提醒
    await btn(env.main, '复制同步码').fire('click');
    assert.equal(env.writes.at(-1), syncCode('me/data', TOKEN, { exp: '2027-03-01' }));
    assert.equal(dayValue(cfg.tokenExp), '2027-03-01');
  } finally { env.done(); }
});

test('立即同步、复制同步码（里面是仓库和令牌）、换令牌（新令牌或新同步码；没成功留着原来的设置）、停止同步先问', async () => {
  const env = setup({ sync: { repo: 'me/pick-nest-data', token: TOKEN, at: Date.now(), sha: 'abc' } });
  try {
    const { main } = env;
    await press(btn(main, '立即同步'));
    await settle();
    assert.deepEqual(env.calls.at(-1), ['now']);
    assert.equal(env.toasts.at(-1).msg, '已同步');
    assert.equal(env.doc.activeElement, btn(main, '立即同步'), '同步中按钮不能按，同步完焦点回到它');
    await btn(main, '复制同步码').fire('click');
    assert.deepEqual(env.writes, ['picknest-sync:me/pick-nest-data:' + TOKEN]);
    assert.ok(env.toasts.at(-1).msg.startsWith('同步码已复制'));
    // 换令牌：经典令牌不收；新令牌没通过检查 → 原来的设置还在
    await press(btn(main, '换令牌'));
    assert.equal(btn(main, '换令牌').attrs['aria-expanded'], 'true');
    assert.equal(env.doc.activeElement, btn(main, '换令牌'), '面板打开了，焦点还在按钮上');
    const tok = () => find(main, el => el.tag === 'input' && el.dataset.fid === 'sy-new-token');
    await type(tok(), 'ghp_old');
    await btn(main, '保存').fire('click');
    assert.deepEqual(errors(main), [t('syncErr.classic')]);
    const prev = state.getLocal().sync;
    await type(tok(), 'github_pat_NEW_bad');
    env.check = async () => { throw new SyncError('auth'); };
    await btn(main, '保存').fire('click'); await settle();
    assert.equal(state.getLocal().sync, prev);
    assert.deepEqual(errors(main), [t('syncErr.authNew')], '已经在换令牌了：不再叫人点「换令牌」');
    env.check = async (r) => r;
    env.round = { ok: false, error: { code: 'notfound', vars: {} } };
    await btn(main, '保存').fire('click'); await settle();
    assert.equal(state.getLocal().sync, prev, '第一轮没成功也退回去');
    env.round = { ok: true };
    await type(tok(), syncCode('me/pick-nest-data', 'github_pat_NEW_good', { exp: '2027-05-01' }));
    await press(btn(main, '保存')); await settle();
    assert.deepEqual(env.calls.filter(c => c[0] === 'check').at(-1), ['check', 'me/pick-nest-data', 'github_pat_NEW_good']);
    assert.equal(state.getLocal().sync.token, 'github_pat_NEW_good');
    assert.equal(state.getLocal().sync.tokenExp, endOfDay('2027-05-01'), '同步码带着的到期日也用上');
    assert.equal(env.toasts.at(-1).msg, t('sync.renewed'));
    assert.equal(tok(), undefined, '换好了收起来');
    assert.equal(fidOf(env), 'sy-renew', '焦点回到「换令牌」');
    // 停止：先问；取消什么也不做
    env.answer = false;
    await btn(main, '停止同步').fire('click');
    assert.ok(state.getLocal().sync);
    assert.equal(env.confirms.at(-1).danger, true);
    env.answer = true;
    await press(btn(main, '停止同步'));
    assert.equal(state.getLocal().sync, null);
    assert.ok(btn(main, '连接'), '回到没开的样子');
    assert.equal(fidOf(env), 'sy-title', '按钮没了：焦点给标题');
    assert.ok(env.confirms.at(-1).message.includes('第一次设置'), '再开不一定有同步码：说清楚怎么重新连接');
  } finally { env.done(); }
});

test('英文、繁体（台湾用词）的同步页', () => {
  const en = setup({ lang: 'en' });
  try { assert.ok(btn(en.main, 'Connect')); assert.ok(en.main.textContent.includes('Fine-grained') || en.main.textContent.includes('fine-grained')); } finally { en.done(); }
  const tw = setup({ lang: 'zh-Hant-TW', sync: { repo: 'me/data', token: TOKEN, at: Date.now() } });
  try {
    for (const label of ['立即同步', '複製同步碼', '更換權杖', '停止同步']) assert.ok(btn(tw.main, label), label);
  } finally { tw.done(); setLang('zh-Hans'); }
});

// ---------- 设置 → 数据 ----------
const item = (id, fields = {}) => normalizeRecord('items', { id, listId: 'l_groceries', name: id, status: 'need', updatedAt: Date.now(), ...fields });

test('数据：下载备份（文件名带日期、内容能读回来、没有令牌）、记下上次备份；能分享文件的设备上多一个「分享备份…」', async () => {
  const env = setup({ page: 'data', sync: { repo: 'me/data', token: TOKEN } });
  try {
    const { main } = env;
    state.mutate(s => { s.data.items.i_milk = item('i_milk', { name: '牛奶' }); });
    assert.equal(main.querySelector('.push-title').textContent, '数据');
    assert.ok(main.textContent.includes('这台设备还没备份过。'));
    assert.equal(btn(main, '分享备份…'), undefined);
    const anchors = [];
    const append = env.doc.body.appendChild.bind(env.doc.body);
    env.doc.body.appendChild = (el) => { anchors.push(el); return append(el); };
    await btn(main, '下载备份').fire('click');
    assert.match(anchors[0].attrs.download, /^picknest-backup-\d{8}\.json$/);
    assert.equal(anchors[0].clicks, 1);
    const text = await env.blobs[0].text();
    assert.equal(JSON.parse(text).state.data.items.i_milk.name, '牛奶');
    assert.ok(!text.includes(TOKEN));
    assert.ok(state.getLocal().lastBackupAt > 0);
    assert.ok(main.textContent.includes('这台设备上次备份：今天 '), '就地改那一行');
  } finally { env.done(); }
  const sh = setup({ page: 'data', share: true });
  try {
    await btn(sh.main, '分享备份…').fire('click');
    assert.match(sh.shared[0].files[0].name, /^picknest-backup-/);
    assert.ok(state.getLocal().lastBackupAt > 0);
    sh.shareErr = Object.assign(new Error('cancel'), { name: 'AbortError' });
    await btn(sh.main, '分享备份…').fire('click');
    assert.equal(sh.blobs.length, 0, '用户自己取消的：不退回下载');
  } finally { sh.done(); }
});

test('数据：从备份恢复先确认（几张清单、几样东西、什么时候的），合并后说改了几条，开着同步马上同步；读不出来的文件说清楚、不问', async () => {
  const env = setup({ page: 'data', sync: { repo: 'me/data', token: TOKEN } });
  try {
    const { main } = env;
    const picker = find(main, el => el.tag === 'input' && el.attrs.type === 'file');
    assert.equal(picker.attrs.accept, '.json,application/json');
    const pick = async (text) => { picker.files = [{ text: async () => text }]; await picker.fire('change'); await settle(); };
    await pick('not json');
    assert.equal(env.toasts.at(-1).msg, t('backup.err.notJson'));
    await pick(JSON.stringify({ app: 'babble', v: 1, state: {} }));
    assert.equal(env.toasts.at(-1).msg, t('backup.err.notApp'));
    assert.equal(env.confirms.length, 0);
    const other = state.getState();
    const backup = JSON.parse(JSON.stringify(other));
    backup.data.items.i_new = item('i_new', { name: '备份里的鸡蛋' });
    const text = buildBackup(backup, new Date(2026, 10, 1, 9, 30));
    env.answer = false;
    await pick(text);
    assert.equal(env.confirms[0].title, '从备份恢复？');
    assert.equal(env.confirms[0].message.split('\n')[0], '备份里有 2 张清单、1 样东西。');
    assert.ok(env.confirms[0].message.includes('2026年11月1日 9:30'));
    assert.equal(state.getState().data.items.i_new, undefined, '取消了就不合并');
    env.answer = true;
    await pick(text);
    assert.equal(state.getState().data.items.i_new.name, '备份里的鸡蛋');
    assert.equal(env.toasts.at(-1).msg, '合并好了：1 条记录有更新。');
    assert.deepEqual(env.calls.at(-1), ['now'], '开着同步：马上同步');
    await pick(text);
    assert.equal(env.toasts.at(-1).msg, t('backup.nothing'));
  } finally { env.done(); }
});

test('数据：最近删除的入口带着几项；恢复前的原始数据只在修过本机数据以后才有', async () => {
  const env = setup({ page: 'data' });
  try {
    const row = find(env.main, el => el.tag === 'a' && el.attrs.href === '#/deleted');
    assert.equal(byCls(row, 'set-count').textContent, '0');
    assert.equal(btn(env.main, '下载恢复前的原始数据'), undefined);
    assert.ok(!env.main.textContent.includes('null'), '没有的部分不画成字「null」');
  } finally { env.done(); }
  const env2 = setup({ page: 'data' });
  try {
    state.mutate(s => { s.data.items.i_a = deletedRecord(item('i_a')); s.data.stores.s_costco = deletedRecord(s.data.stores.s_costco); });
    env2.archive = { app: 'picknest', v: 1, kind: 'local-recovery', records: [{ key: 'picknest.state', raw: '{broken' }] };
    env2.main.replaceChildren();
    dataPage(env2.main, { name: 'settings', sub: 'data' }, env2.ctx);
    assert.equal(byCls(find(env2.main, el => el.tag === 'a' && el.attrs.href === '#/deleted'), 'set-count').textContent, '2');
    await btn(env2.main, '下载恢复前的原始数据').fire('click');
    assert.equal(JSON.parse(await env2.blobs.at(-1).text()).records[0].raw, '{broken');
  } finally { env2.done(); }
});
