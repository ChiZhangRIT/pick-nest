// 本机数据读不出来时盖在整个 App 上的恢复页（app.js 的 recoveryScreen）。这时修改和同步都已经暂停，原始数据不会被覆盖。
// 按钮：下载原始数据、重新读取、从备份恢复（选一个备份文件）、从云端恢复（开过同步才有：只读地取仓库里现在的那一份）、保留读得出来的部分继续用。
// 后三个都是 ctx.repairData：和读得出来的部分逐条合并，替换之前 persistence.recover 先把原件存档（以后在「设置 → 数据」里还能下载）。
import { h, download } from './dom.js';
import { t } from '../i18n.js';
import { readBackup, BackupError } from '../core/backup.js';
import { SyncError } from '../core/sync.js';
import { syncErrText } from './syncBadge.js';

export function recoveryPanel(main, ctx) {
  let busy = false;
  const status = h('p.err', { role: 'alert', hidden: true });
  const buttons = [];
  const button = (label, run, disabled = false) => {
    const el = h('button.btn', { type: 'button', disabled, onclick: async () => { if (!busy) await run(); } }, label);
    buttons.push({ el, disabled }); return el;
  };
  function lock(value) { busy = value; for (const { el, disabled } of buttons) el.disabled = value || disabled; }
  // 出错时说清楚是哪一步：备份文件不对、云端没有 / 连不上、存储用不了、恢复本身失败。
  // 令牌不对时不能照搬 syncErr.auth（「点换令牌」）：这一页上没有那个按钮，App 也点不了，要说先修好本机数据、再去换令牌
  const message = e => (e instanceof BackupError ? t('backup.err.' + e.code)
    : e instanceof SyncError ? (e.code === 'nofile' ? t('recovery.noCloud') : e.code === 'auth' ? t('recovery.cloudAuth') : syncErrText(e, ctx.lang ? ctx.lang() : 'zh-Hans'))
    : t(e?.message === 'recovery-unavailable' ? 'recovery.unavailable' : e?.message === 'still-broken' ? 'recovery.stillBroken' : 'recovery.failed'));
  async function run(task) {
    lock(true); status.hidden = false; status.textContent = t('recovery.working');
    try { await task(); status.hidden = true; }
    catch (e) { status.textContent = message(e); }
    finally { lock(false); }
  }
  // 换掉之前先问一句（keepOnly：只用读得出来的部分，读不出来的只留在存档里）
  async function repair(next, keepOnly = false) {
    const ok = await ctx.confirm({ title: t('recovery.confirm'), message: keepOnly ? t('recovery.keepConfirm') : t('recovery.confirmText'), confirmLabel: t('recovery.go') });
    if (ok) await ctx.repairData(next);
  }
  // 「重新读取」后还是读不出来：读取是同步的，不说一声的话「正在处理…」一闪就没了，看不出点没点到。顺便更新读得出来的数量
  function retry() {
    ctx.retryData();
    if (ctx.storageIssue()) { readable.textContent = readableText(); throw new Error('still-broken'); }
  }
  const file = h('input', { type: 'file', hidden: true, accept: '.json,application/json',
    onchange: e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) return run(async () => { const b = readBackup(await f.text()); await repair(b.state); }); } });
  const original = ctx.recoveryExport();
  const n = c => Object.values(ctx.state.data[c] || {}).filter(r => !r.deleted).length;
  const readableText = () => t('recovery.readable', { lists: n('lists'), items: n('items') });
  const readable = h('p.muted', null, readableText());
  main.replaceChildren(h('div.page', null, h('section.card.safe-mode', null,
    h('h1', null, t('recovery.title')), h('p', null, t('recovery.intro')),
    ctx.storageIssue()?.code === 'unavailable' ? h('p', null, t('recovery.unavailable')) : null,
    readable,
    h('div.row', null,
      button(t('recovery.export'), () => download('picknest-recovery-original.json', JSON.stringify(original, null, 2), 'application/json'), !original),
      button(t('recovery.retry'), () => run(retry))),
    h('p.muted', null, t('recovery.exportHint')),
    h('div.row', null,
      button(t('recovery.backup'), () => file.click()),
      ctx.local && ctx.local.sync ? button(t('recovery.cloud'), () => run(async () => { const next = await ctx.recoveryCloud(); await repair(next); })) : null,
      button(t('recovery.keep'), () => run(() => repair(ctx.state, true)))),
    status, file)));
}
