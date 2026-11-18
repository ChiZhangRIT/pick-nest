// 本机数据读不出来时盖在整个 App 上的恢复页（app.js 的 recoveryScreen）。这时修改已经暂停，原始数据不会被覆盖。
// 现在只有：下载原始数据、重新读取、保留读得出来的部分继续用。「从备份恢复」「从云端恢复」等第 5 步有了备份和同步再加。
import { h, download } from './dom.js';
import { t } from '../i18n.js';

export function recoveryPanel(main, ctx) {
  let busy = false;
  const status = h('p.err', { role: 'alert', hidden: true });
  const buttons = [];
  const button = (label, run, disabled = false) => {
    const el = h('button.btn', { type: 'button', disabled, onclick: async () => { if (!busy) await run(); } }, label);
    buttons.push({ el, disabled }); return el;
  };
  function lock(value) { busy = value; for (const { el, disabled } of buttons) el.disabled = value || disabled; }
  async function run(task) {
    lock(true); status.hidden = false; status.textContent = t('recovery.working');
    try { await task(); status.hidden = true; }
    catch (e) { status.textContent = t(e?.message === 'recovery-unavailable' ? 'recovery.unavailable' : e?.message === 'still-broken' ? 'recovery.stillBroken' : 'recovery.failed'); }
    finally { lock(false); }
  }
  // 「保留读得出来的部分」= 用内存里读出来的数据去恢复（persistence.recover 会先把原件存档，再写新快照、移走坏日志）
  async function keep() {
    const ok = await ctx.confirm({ title: t('recovery.confirm'), message: t('recovery.keepConfirm'), confirmLabel: t('recovery.go') });
    if (ok) await ctx.repairData(ctx.state);
  }
  // 「重新读取」后还是读不出来：读取是同步的，不说一声的话「正在处理…」一闪就没了，看不出点没点到。顺便更新读得出来的数量
  function retry() {
    ctx.retryData();
    if (ctx.storageIssue()) { readable.textContent = readableText(); throw new Error('still-broken'); }
  }
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
    h('div.row', null, button(t('recovery.keep'), () => run(keep))),
    status)));
}
