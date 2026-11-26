// @ts-check
// 备份（设置 → 备份与恢复）：一个 JSON 文件 picknest-backup-YYYYMMDD.json = { app:'picknest', v:1, kind:'backup', exportedAt, state }。
// state 就是整份同步的数据（data、settings、settingsAt）：没有同步令牌，也没有本机设置（picknest.local：语言、外观、各清单的显示方式）。
// 「最近删除」里的东西也在里面（软删除的记录照样是数据）。
// 恢复 = 逐条合并（state.js 的 mergeIn：每条取较新的，备份里没有的不删），页面先确认、再说改了几条。
// 读的时候认所有 { app:'picknest', v:1, state } 形状的文件（store.js 的 fileProblem）：备份、出错时下载的原始数据、
// 恢复页下载的原始数据、同步仓库里的 picknest.json 都能拿来恢复。
import { normalizeState, fileProblem, live } from './store.js';
import { liveList } from './items.js';
import { ymd, daysAgo } from './dates.js';
import { isObj, str } from './util.js';

/** @typedef {import('./store.js').State} State */

/** 读备份出错：code 是 backup.err.<code> 的后半（notJson 读不出来、notApp 不是 PickNest 的、newer 新版写的、bad 缺东西） */
export class BackupError extends Error {
  /** @param {string} code */
  constructor(code) { super(code); this.code = code; }
}

/** picknest-backup-20261121.json（本机日期；.gitignore 排除了 picknest*.json，放在仓库目录里也不会被提交） @param {Date} [date] */
export const backupFileName = (date = new Date()) => `picknest-backup-${ymd(date)}.json`;

/** 备份文件的内容（字符串）。只放同步的数据：令牌和本机设置在 picknest.local，不在 state 里 @param {State} state @param {Date} [now] */
export function buildBackup(state, now = new Date()) {
  const s = normalizeState(state);
  return JSON.stringify({ app: 'picknest', v: 1, kind: 'backup', exportedAt: now.toISOString(), state: { app: s.app, v: s.v, data: s.data, settings: s.settings, settingsAt: s.settingsAt } }, null, 1);
}

/** 隔多少天没备份就提醒（和 Babble 一样：设置里那句「上次备份」变成琥珀色） */
export const BACKUP_STALE_DAYS = 30;
/**
 * 这台设备上次备份是几天前（picknest.local 的 lastBackupAt）→ { days: 0 今天 / n 天前 / null 还没备份过, stale: 要不要提醒 }
 * @param {unknown} lastAt @param {number} [now]
 */
export function backupAge(lastAt, now = Date.now()) {
  const days = Number(lastAt) > 0 ? daysAgo(lastAt, now) : null;
  return { days, stale: days == null || days >= BACKUP_STALE_DAYS };
}

/** 看得见的有几样（确认框里说「备份里有 3 张清单、42 样东西」，有食谱、计划再说几道，吃了什么再说几条）：没删除的清单、在没删除的清单上的东西、食谱、商店、分类 @param {State} state */
export function backupCounts(state) {
  return {
    lists: live(state, 'lists').length,
    items: live(state, 'items').filter(it => liveList(state, it.listId)).length,
    recipes: live(state, 'recipes').length,
    plan: live(state, 'plan').length,
    log: live(state, 'log').length,
    stores: live(state, 'stores').length,
    categories: live(state, 'categories').length,
  };
}

/**
 * 读一个备份文件（文字）→ { state（整理过的）, exportedAt（毫秒，没写 → null）, kind, counts }。读不出来、不是 PickNest 的抛 BackupError
 * @param {unknown} text
 */
export function readBackup(text) {
  let d = null;
  try { d = JSON.parse(str(text).replace(/^\uFEFF/, '')); } catch (e) { throw new BackupError('notJson'); }
  const p = fileProblem(d);
  if (p) throw new BackupError(p);
  const state = normalizeState(d.state);
  const at = Date.parse(isObj(d) ? str(d.exportedAt || d.savedAt) : '');
  return { state, exportedAt: Number.isFinite(at) ? at : null, kind: str(d.kind) || 'sync', counts: backupCounts(state) };
}
