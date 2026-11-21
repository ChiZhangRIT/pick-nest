// 设置 → 数据（#/settings/data）：
//   备份：「下载备份」（一个 JSON 文件；没有令牌、没有本机设置），能把文件交给系统分享的浏览器（iPhone、iPad，Mac 上的 Safari 也行）上还有「分享备份…」（存到「文件」、隔空投送）；
//     记下这台设备上次备份的时间（picknest.local 的 lastBackupAt）
//   从备份恢复：选一个文件 → 读、检查（core/backup.js 的 readBackup：是不是 PickNest 的、是不是新版做的）→ 先确认（说里面有几张清单、
//     几样东西、是什么时候的）→ 逐条合并（ctx.mergeIn：较新的为准，备份里没有的不删）→ 说改了几条；开着同步马上同步一次，合并的结果传到别的设备
//   最近删除的入口（#/deleted，后面是几项）；恢复前的原始数据（恢复页修过本机数据才有，下载下来排查问题用）
// 没有输入框，数据变了由 app 整页重画。
import { h, pushFrame, download } from '../ui/dom.js';
import { t } from '../i18n.js';
import { backupFileName, buildBackup, readBackup, BackupError } from '../core/backup.js';
import { deletedCount } from '../core/deleted.js';
import { fmtWhen, fmtFull } from '../core/dates.js';

/** 这个浏览器能不能把文件交给系统的分享面板（iPhone、iPad 上存到「文件」、隔空投送要用它；Mac 上的 Safari 也能，多一条路不碍事，不特意藏） */
function canShareFiles() {
  try {
    return typeof navigator !== 'undefined' && typeof navigator.canShare === 'function' && typeof File === 'function'
      && navigator.canShare({ files: [new File(['{}'], 'picknest.json', { type: 'application/json' })] });
  } catch (e) { return false; }
}

export function dataPage(main, params, ctx) {
  const lang = ctx.lang();
  const page = pushFrame(main, ctx, t('set.data'), { cls: 'set data' });
  const sec = (title, ...kids) => h('section.set-sec', null, h('h2.group-h', null, title), ...kids);
  const lastText = () => { const at = Number(ctx.local.lastBackupAt) || 0; return at ? t('backup.last', { time: fmtWhen(at, lang) }) : t('backup.never'); };
  const lastLine = h('p.small.muted', null, lastText());
  // 记下这台设备上次备份的时间，就地改那一行（不整页重画：焦点、滚动都不动）
  const saved = () => { ctx.setLocal({ lastBackupAt: Date.now() }); lastLine.textContent = lastText(); };

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
    ctx.toast(changed ? t('backup.restored', { n: changed }) : t('backup.nothing'), { ms: 7000 });
    if (changed && ctx.sync && ctx.sync.status().on) ctx.sync.now();      // 不等两秒的防抖：合并的结果马上传到别的设备
  }

  const archive = ctx.recoveryArchive ? ctx.recoveryArchive() : null;
  const n = deletedCount(ctx.state);
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
    sec(t('data.trashH'), h('div.group', null,
      h('a.group-row.set-row.go', { href: '#/deleted' }, h('span.set-label', null, t('deleted.title')), h('span.set-count', null, String(n))))),
    archive ? sec(t('data.archiveH'), h('div.card.data-card', null,
      h('p.small', null, t('backup.archiveHelp')),
      h('div.row', null, h('button.btn', { type: 'button', onclick: () => download('picknest-recovery-archive.json', JSON.stringify(archive, null, 2), 'application/json') }, t('backup.archive'))))) : null,
  ].filter(Boolean));      // append 会把 null 写成字「null」（h() 才跳过 null）
}
