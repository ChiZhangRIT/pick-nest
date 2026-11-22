// 设置 → 备份与恢复（#/settings/data）：
//   备份：「导出备份」（一个 JSON 文件；没有令牌、没有本机设置），能把文件交给系统分享的浏览器（iPhone、iPad，Mac 上的 Safari 也行）上还有「分享备份…」（存到「文件」、隔空投送）；
//     记下这台设备上次备份的时间（picknest.local 的 lastBackupAt），下面写「上次备份：今天 / 3 天前 / 还没备份过」（backupReminder，设置首页「数据」下面也用），
//     还没备份过、30 天以上没备份时是琥珀色（core/backup.js 的 backupAge）
//   从备份恢复：选一个文件 → 读、检查（core/backup.js 的 readBackup：是不是 PickNest 的、是不是新版做的）→ 先确认（说里面有几张清单、
//     几样东西、是什么时候的）→ 逐条合并（ctx.mergeIn：较新的为准，备份里没有的不删）→ 说改了几条；开着同步马上同步一次，合并的结果传到别的设备
//   恢复前的原始数据（恢复页修过本机数据才有，下载下来排查问题用）。「最近删除」的入口在设置首页「数据」那一组里，这一页只管备份
// 没有输入框，数据变了由 app 整页重画。
import { h, pushFrame, download } from '../ui/dom.js';
import { t } from '../i18n.js';
import { backupFileName, buildBackup, readBackup, backupAge, BackupError } from '../core/backup.js';
import { fmtFull } from '../core/dates.js';

/** 这个浏览器能不能把文件交给系统的分享面板（iPhone、iPad 上存到「文件」、隔空投送要用它；Mac 上的 Safari 也能，多一条路不碍事，不特意藏） */
function canShareFiles() {
  try {
    return typeof navigator !== 'undefined' && typeof navigator.canShare === 'function' && typeof File === 'function'
      && navigator.canShare({ files: [new File(['{}'], 'picknest.json', { type: 'application/json' })] });
  } catch (e) { return false; }
}

/** 「上次备份：今天 / 3 天前 / 还没备份过」和要不要提醒（还没备份过、30 天以上：琥珀色）：设置首页「数据」下面和这一页的备份卡片里都用 */
export function backupReminder(ctx) {
  const { days, stale } = backupAge(ctx.local.lastBackupAt);
  const when = days == null ? t('set.backupNever') : days === 0 ? t('set.backupToday') : t('set.backupAgo', { n: days });
  return { text: t('set.backupLast', { when }), stale };
}

export function dataPage(main, params, ctx) {
  const lang = ctx.lang();
  const page = pushFrame(main, ctx, t('set.data'), { cls: 'set data' });
  const sec = (title, ...kids) => h('section.set-sec', null, h('h2.group-h', null, title), ...kids);
  const lastLine = h('p.small.data-last');
  function paintLast() { const b = backupReminder(ctx); lastLine.textContent = b.text; lastLine.classList.toggle('set-warn', b.stale); lastLine.classList.toggle('muted', !b.stale); }
  paintLast();
  // 记下这台设备上次备份的时间，就地改那一行（不整页重画：焦点、滚动都不动）
  const saved = () => { ctx.setLocal({ lastBackupAt: Date.now() }); paintLast(); };

  // 备份在点的那一下里做好（很快）：navigator.share 要在用户的点按里调用
  const file = () => ({ name: backupFileName(), text: buildBackup(ctx.state) });
  function downloadBackup() {
    const f = file();
    download(f.name, f.text, 'application/json');
    saved();
  }
  async function shareBackup() {
    const f = file();
    try { await navigator.share({ files: [new File([f.text], f.name, { type: 'application/json' })], title: f.name }); saved(); }
    catch (e) { if (!e || e.name !== 'AbortError') downloadBackup(); }    // 分享不了（不是用户自己取消的）：退回直接下载
  }

  const picker = h('input', { type: 'file', hidden: true, accept: '.json,application/json',
    onchange: (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) restoreFrom(f); } });
  async function restoreFrom(f) {
    let b;
    try { b = readBackup(await f.text()); }
    catch (e) { ctx.toast(t(e instanceof BackupError ? 'backup.err.' + e.code : 'backup.err.read'), { ms: 8000 }); return; }
    const message = [t('backup.counts', b.counts), b.exportedAt ? t('backup.from', { time: fmtFull(b.exportedAt, lang) }) : null, t('backup.merge')].filter(Boolean).join('\n');
    if (!(await ctx.confirm({ title: t('backup.restoreQ'), message, confirmLabel: t('backup.go') }))) return;
    const { changed } = ctx.mergeIn(b.state);
    // 开着同步时合并的结果由 app 马上传（不等两秒的防抖，app.js）
    ctx.toast(changed ? t('backup.restored', { n: changed }) : t('backup.nothing'), { ms: 7000 });
  }

  const archive = ctx.recoveryArchive ? ctx.recoveryArchive() : null;
  page.append(...[
    sec(t('data.backupH'), h('div.card.data-card', null,
      h('p.small', null, t('backup.what')),
      lastLine,
      h('div.row', null,
        h('button.btn.primary', { type: 'button', dataset: { fid: 'dt-download' }, onclick: downloadBackup }, t('backup.download')),
        canShareFiles() ? h('button.btn', { type: 'button', dataset: { fid: 'dt-share' }, onclick: shareBackup }, t('backup.share')) : null))),
    sec(t('data.restoreH'), h('div.card.data-card', null,
      h('p.small', null, t('backup.restoreHelp')),
      h('div.row', null, h('button.btn', { type: 'button', dataset: { fid: 'dt-restore' }, onclick: () => picker.click() }, t('backup.restore'))),
      picker)),
    archive ? sec(t('data.archiveH'), h('div.card.data-card', null,
      h('p.small', null, t('backup.archiveHelp')),
      h('div.row', null, h('button.btn', { type: 'button', onclick: () => download('picknest-recovery-archive.json', JSON.stringify(archive, null, 2), 'application/json') }, t('backup.archive'))))) : null,
  ].filter(Boolean));      // append 会把 null 写成字「null」（h() 才跳过 null）
}
