// 设置 → 同步（#/settings/sync）。
// 没开：粘贴同步码（马上填好仓库、令牌，带着到期日的话也填上）、第一次设置的步骤（建私有仓库、建 Fine-grained 令牌）、仓库 + 令牌 + 令牌到期日（可选）、「连接」。
// 开着：仓库、状态（上次同步、有没传的修改、离线、出错的说明）、令牌到期日（两周内到期提醒；没填过可以补上，点「保存」才算）、
//   「立即同步」「复制同步码」（带着到期日：用它连上的设备也会提醒）「换令牌」（粘贴新令牌，或者别的设备复制来的新同步码，不用停止同步）、
//   怎么同步的说明、「停止同步」（先问）。
// 连接 / 换令牌：先用 core 的 cleanRepo、tokenProblem 查仓库名和令牌（只收 Fine-grained 令牌，错误标在那一栏下面）、到期日填得对不对，
//   再 ctx.sync.checkRepo（仓库在、令牌看得到、是私有的），最后 ctx.sync.connect 马上同步一次；没成功就退回原来的设置（第一次连接的就停掉），
//   原因写在按钮上面。令牌只进 picknest.local（ctx.sync.connect 存），不进数据、不进备份。
// 自己管更新（返回 onChange）：同步状态变了（ctx.on('sync')）、数据变了都重画，但焦点在输入框里时等它离开再画，打字不会被打断。
// 重画以后焦点放回同一个控件（data-fid）：按钮正好在「连接中」「同步中」不能按时，等按完那次重画再放回去；控件没了（停止同步、补好到期日）给标题。
import { h, copyText, pushFrame } from '../ui/dom.js';
import { field, showErr } from '../ui/form.js';
import { syncBadge, syncErrText } from '../ui/syncBadge.js';
import { t } from '../i18n.js';
import { SyncError, syncCode, parseSyncCode, cleanRepo, tokenProblem, tokenDaysLeft, tokenWarn } from '../core/sync.js';
import { fmtWhen, fmtDay, endOfDay, dayValue } from '../core/dates.js';
import { str } from '../core/util.js';

const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new';
const REPO_PH = 'chizhangrit/pick-nest-data';      // 只是占位的例子：仓库名一定要自己填（或者粘贴同步码）
const TOKEN_PH = 'github_pat_…';
const plainIn = { autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' };
const TOKEN_ERRS = ['noToken', 'classic', 'badToken', 'notFine'];      // 标在令牌那一栏下面的

/** 重画但不打断输入：焦点在本页的输入框里就等它离开再画（照 babble） */
function quietRedraw(main, draw) {
  let pending = false;
  const busy = () => { const a = document.activeElement; return !!a && main.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName); };
  const run = () => {
    pending = false;
    const sc = main.scrollHeight > main.clientHeight ? main : document.scrollingElement;
    const top = sc ? sc.scrollTop : 0;
    draw();
    if (sc) sc.scrollTop = top;
  };
  const onOut = () => setTimeout(() => { if (pending && !busy()) run(); }, 0);
  main.addEventListener('focusout', onOut);
  return { soon: () => { if (busy()) pending = true; else run(); }, off: () => main.removeEventListener('focusout', onOut) };
}

export function syncPage(main, params, ctx) {
  const lang = ctx.lang();
  const page = pushFrame(main, ctx, t('set.sync'), { cls: 'set sync' });
  // 标题能接焦点（tabindex -1）：按过的按钮重画后没了，焦点给它，不掉回页首的 <body>
  const title = main.querySelector('.push-title');
  if (title) { title.tabIndex = -1; title.dataset.fid = 'sy-title'; }
  // 跨重画留着：填了一半的表单、正在连接、换令牌的面板开没开、上次连接的错误
  const form = { code: '', repo: '', token: '', exp: '' };
  const renewForm = { token: '', exp: '' };
  let expDraft = '';                 // 开着同步时补填的到期日（点「保存」之前）
  let busy = false, renew = false, filled = false;
  /** @type {{ repo?: string, token?: string, code?: string, exp?: string, addExp?: string, general?: string, vars?: Record<string, any> }} */
  let errs = {};
  let refocus = null;                // 重画时按钮不能按（连接中、同步中），焦点没放回去：下一次重画再放
  // 读屏马上念的错误（role=alert）只在出现、变了的那一次重画时标：每分钟一轮的自动同步、数据变了都会重画，
  // 一直挂着的错误（令牌过期）每次重画都是新的 alert 元素，读屏会一遍遍打断用户念它。用户自己点了「立即同步」「连接」以后再念一次
  const shown = { status: '', general: '' };
  /** @param {'status' | 'general'} k @param {string} text */
  const alertRole = (k, text) => { const fresh = !!text && text !== shown[k]; shown[k] = text || ''; return fresh ? 'alert' : null; };

  /** 重画整页，焦点放回同一个控件；want：指定给谁（连接好了给「立即同步」、停止以后给标题） @param {string} [want] */
  function draw(want) {
    const a = document.activeElement;
    const here = a && main.contains(a) && a.dataset ? a.dataset.fid : null;
    // 焦点掉到了页面外（<body>，或者已经被换掉的旧按钮上）：多半是上一次重画时按钮不能按，这次放回去；在对话框里的不管
    const lost = !a || a === document.body || !document.body.contains(a);
    const fid = want || here || (lost ? refocus : null);
    refocus = null;
    const st = ctx.sync.status();
    page.replaceChildren(...(st.on ? onView(st) : offView()).filter(Boolean));
    if (!fid) return;
    const el = main.querySelector(`[data-fid="${fid}"]`);
    if (el && el.disabled) { refocus = fid; return; }
    const to = el || main.querySelector('[data-fid="sy-title"]');
    if (to && document.activeElement !== to) to.focus({ preventScroll: true });
  }

  /** 这一栏的错误（文案的键）标在下面 @param {ReturnType<typeof field>} row @param {string} [key] */
  const mark = (row, key) => { showErr(row, key || null, errs.vars || {}); return row; };
  const generalErr = () => { const role = alertRole('general', errs.general || ''); return errs.general ? h('p.err.small.sy-err', { role }, errs.general) : null; };

  // ---------- 没开：同步码 / 仓库 + 令牌 ----------
  function offView() {
    const codeIn = h('input.f-in', { type: 'text', value: form.code, placeholder: t('sync.codePh'), ...plainIn, dataset: { fid: 'sy-code' },
      oninput: (e) => { form.code = e.target.value; fromCode(e.target.value); },
      onchange: (e) => { if (str(e.target.value).trim() && !parseSyncCode(e.target.value)) { errs = { code: 'sync.badCode' }; showErr(codeRow, 'sync.badCode'); } } });
    const codeRow = mark(field(t('sync.code'), codeIn), errs.code);
    const repoIn = h('input.f-in', { type: 'text', value: form.repo, placeholder: REPO_PH, ...plainIn, dataset: { fid: 'sy-repo' },
      oninput: (e) => { form.repo = e.target.value; fromCode(e.target.value); } });
    const tokIn = h('input.f-in', { type: 'password', value: form.token, placeholder: TOKEN_PH, ...plainIn, dataset: { fid: 'sy-token' },
      oninput: (e) => { form.token = e.target.value; fromCode(e.target.value); } });
    const expIn = h('input.f-in.sy-exp', { type: 'date', value: form.exp, dataset: { fid: 'sy-exp' }, onchange: (e) => { form.exp = e.target.value; showErr(expRow, null); } });
    const btn = h('button.btn.primary.block', { type: 'button', disabled: busy, dataset: { fid: 'sy-connect' }, onclick: () => connect(form.repo, form.token, form.exp) },
      busy ? t('sync.connecting') : t('sync.connect'));
    // 粘贴的是同步码（在哪一栏都行）：拆成仓库和令牌填好，焦点给「连接」。
    // 带着到期日（复制它的那台设备填过）也填上：到期日是每台设备自己记的，不填的话这台到期前不会提醒
    function fromCode(text) {
      const c = parseSyncCode(text);
      if (!c) return;
      Object.assign(form, { repo: c.repo, token: c.token, code: '', exp: c.exp && endOfDay(c.exp) ? c.exp : form.exp });
      codeIn.value = ''; repoIn.value = c.repo; tokIn.value = c.token; expIn.value = form.exp;
      errs = {}; filled = true;
      for (const row of [codeRow, repoRow, tokRow, expRow]) showErr(row, null);
      hint.hidden = false;
      btn.focus();
    }
    const repoRow = mark(field(t('sync.repo'), repoIn), errs.repo);
    const tokRow = mark(field(t('sync.tokenLabel'), tokIn), errs.token);
    const expRow = mark(field(t('sync.expLabel'), expIn, { help: t('sync.expHelp') }), errs.exp);
    const hint = h('p.f-help.sy-filled', { role: 'status', hidden: !filled }, t('sync.codeFilled'));
    return [
      h('p.sy-lead', null, t('sync.intro')),
      h('section.set-sec', null, h('h2.group-h', null, t('sync.haveH')),
        h('div.card.form.sy-card', null, h('p.small', null, t('sync.have')), codeRow)),
      h('section.set-sec', null, h('h2.group-h', null, t('sync.firstH')),
        h('div.card.form.sy-card', null,
          h('details.sy-howto', null, h('summary', null, t('sync.stepsH')),
            h('ol.sy-steps', null, [1, 2, 3, 4, 5, 6, 7].map(n => h('li', null, t('sync.step' + n)))),
            h('p', null, h('a', { href: TOKEN_URL, target: '_blank', rel: 'noopener' }, t('sync.tokenLink')))),
          repoRow, tokRow, expRow,
          hint, generalErr(), btn)),
      notes(),
    ];
  }

  // ---------- 开着：状态、立即同步、复制同步码、换令牌、停止 ----------
  function onView(st) {
    const days = tokenDaysLeft(st.tokenExp);
    const expLine = st.tokenExp ? h('p.small' + (tokenWarn(st.tokenExp) ? '.sy-warn' : '.muted'), null,
      t('sync.exp', { date: fmtDay(st.tokenExp, lang) }), tokenWarn(st.tokenExp) ? [lang === 'en' ? ' ' : '', days < 0 ? t('sync.expired') : t('sync.expSoon', { n: days })] : null) : null;
    return [
      h('section.card.sy-status', null,
        h('p.sy-repo', null, h('b', null, st.repo || '')),
        syncBadge(st, lang, { link: false }),
        h('p.small.muted', null, st.at ? t('sync.last', { time: fmtWhen(st.at, lang) }) : t('sync.never')),
        st.offline ? h('p.small', null, t('sync.offlineLine')) : st.dirty ? h('p.small', null, t('sync.pendingLine')) : null,
        statusErr(st),
        expLine,
        h('div.row.sy-btns', null,
          h('button.btn.primary', { type: 'button', disabled: busy || st.running, dataset: { fid: 'sy-now' }, onclick: syncNow }, busy || st.running ? t('sync.running') : t('sync.now')),
          h('button.btn', { type: 'button', dataset: { fid: 'sy-copy' }, onclick: copyCode }, t('sync.copyCode')),
          h('button.btn.ghost', { type: 'button', 'aria-expanded': String(renew), dataset: { fid: 'sy-renew' }, onclick: () => { renew = !renew; errs = {}; draw(); } }, t('sync.renew')))),
      st.tokenExp ? null : addExpCard(),
      renew ? renewView(st) : null,
      notes(),
      h('div.sy-stop', null, h('button.btn.danger', { type: 'button', dataset: { fid: 'sy-stop' }, onclick: stopSync }, t('sync.stop'))),
    ];
  }
  function statusErr(st) {
    const text = st.err ? syncErrText(st.err, lang) : '';
    const role = alertRole('status', text);
    return text ? h('p.err.small', { role }, text) : null;
  }
  // 连接时没填到期日：在这里补上。点「保存」才算：用键盘填日期时每填一位都是一个「合法」的日期（年份 0002、0020……），不能一变就存
  function addExpCard() {
    const keep = (e) => { expDraft = e.target.value; };
    const input = h('input.f-in.sy-exp', { type: 'date', value: expDraft, dataset: { fid: 'sy-exp-add' }, oninput: keep, onchange: keep });
    return h('div.card.form.sy-card', null,
      mark(field(t('sync.expLabel'), input, { help: t('sync.expHelp') }), errs.addExp),
      h('div.row.sy-btns', null, h('button.btn', { type: 'button', dataset: { fid: 'sy-exp-save' }, onclick: saveExp }, t('sync.saveExp'))));
  }
  function saveExp() {
    const ms = endOfDay(expDraft), c = ctx.local.sync;
    if (!ms) { errs = { addExp: 'sync.badDate' }; draw(); return; }
    // 改的是同一个设置对象：正在跑的同步不受影响（这一轮结束时存的也是它）
    if (c) { c.tokenExp = ms; ctx.setLocal({ sync: c }); }
    expDraft = ''; errs = {};
    draw('sy-title');
  }
  function renewView(st) {
    const tokIn = h('input.f-in', { type: 'password', value: renewForm.token, placeholder: TOKEN_PH, ...plainIn, dataset: { fid: 'sy-new-token' },
      oninput: (e) => { renewForm.token = e.target.value; } });
    const expIn = h('input.f-in.sy-exp', { type: 'date', value: renewForm.exp, dataset: { fid: 'sy-new-exp' }, onchange: (e) => { renewForm.exp = e.target.value; } });
    return h('section.card.form.sy-card.sy-renew', null,
      h('p.small', null, t('sync.renewHelp')),
      mark(field(t('sync.tokenLabel'), tokIn), errs.token),
      mark(field(t('sync.expLabel'), expIn), errs.exp),
      generalErr(),
      h('div.row.sy-btns', null,
        h('button.btn.primary', { type: 'button', disabled: busy, dataset: { fid: 'sy-renew-save' }, onclick: () => {
          const c = parseSyncCode(renewForm.token);           // 粘贴的是别的设备复制来的同步码（换过令牌的那台）也行，带着的到期日也用上
          connect(c ? c.repo : st.repo, c ? c.token : renewForm.token, renewForm.exp || (c && c.exp) || '');
        } }, busy ? t('sync.connecting') : t('sync.save')),
        h('a.btn.ghost', { href: TOKEN_URL, target: '_blank', rel: 'noopener' }, t('sync.tokenLink'))));
  }
  const notes = () => h('section.set-sec', null, h('h2.group-h', null, t('sync.howH')),
    h('ul.group-foot.sy-notes', null, [1, 2, 3, 4].map(n => h('li', null, t('sync.note' + n)))));

  // ---------- 操作 ----------
  async function connect(repo0, token0, exp) {
    const repo = cleanRepo(repo0), token = str(token0).trim();
    const fail = (e) => { errs = e; busy = false; shown.general = ''; draw(); };
    if (!repo) return fail({ repo: 'syncErr.badRepo' });
    const bad = tokenProblem(token);
    if (bad) return fail({ token: 'syncErr.' + bad });
    const tokenExp = exp ? endOfDay(exp) : null;
    if (exp && !tokenExp) return fail({ exp: 'sync.badDate' });     // 填了一半、年份不对的日期：说一声，不悄悄当成没填
    const prev = ctx.local.sync, v0 = ctx.editVersion;
    busy = true; errs = {}; draw();
    try {
      const full = await ctx.sync.checkRepo(repo, token);
      const r = await ctx.sync.connect({ repo: full, token, tokenExp });
      if (!r || !r.ok || (ctx.local.sync && ctx.local.sync.offline)) throw new SyncError((r && r.error && r.error.code) || 'net', (r && r.error && r.error.vars) || {});
      Object.assign(form, { code: '', repo: '', token: '', exp: '' });
      Object.assign(renewForm, { token: '', exp: '' });
      renew = false; busy = false; filled = false;
      ctx.toast(t(prev ? 'sync.renewed' : 'sync.connected'), { ms: 7000 });
      draw(prev ? 'sy-renew' : 'sy-now');
    } catch (e) {
      if (!prev) ctx.sync.stop();
      else if (ctx.local.sync !== prev) {
        // 换令牌没成功：留着原来的设置。这期间本机又改过（标在了新的设置上）的话，原来的也要记着有没传的
        if (ctx.editVersion !== v0) prev.dirty = true;
        ctx.setLocal({ sync: prev });
      }
      const err = { code: e instanceof SyncError ? e.code : 'unknown', vars: (e && e.vars) || {} };
      // 令牌不对：不用 syncErr.auth（「点换令牌」）：没开同步的页面上没有这个按钮，换令牌的面板本身就是在换
      fail(TOKEN_ERRS.includes(err.code) ? { token: 'syncErr.' + err.code } : err.code === 'badRepo' ? { repo: 'syncErr.badRepo' }
        : { general: err.code === 'auth' ? t('syncErr.authNew') : syncErrText(err, lang) });
    }
  }
  async function syncNow() {
    busy = true; draw();
    const r = await ctx.sync.now().catch(() => ({ ok: false }));
    busy = false; shown.status = ''; draw();
    if (r && r.ok) ctx.toast(t('sync.done'));
  }
  async function copyCode() {
    const c = ctx.local.sync;
    if (!c) return;
    ctx.toast((await copyText(syncCode(c.repo, c.token, { exp: dayValue(c.tokenExp) || null }))) ? t('sync.codeCopied') : t('sync.copyFail'), { ms: 8000 });
  }
  async function stopSync() {
    if (!(await ctx.confirm({ message: t('sync.stopConfirm'), confirmLabel: t('sync.stop'), danger: true }))) return;
    ctx.sync.stop();
    renew = false; errs = {};
    ctx.toast(t('sync.stopped'));
    draw('sy-title');
  }

  const redraw = quietRedraw(main, draw);
  draw();
  ctx.on('sync', () => { if (!busy) redraw.soon(); });
  return { onChange: () => { if (!busy) redraw.soon(); }, cleanup: () => redraw.off() };
}

