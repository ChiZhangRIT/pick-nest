// 同步状态的小标签：一个圆点 + 一句话（首页标题旁边、设置里「同步」那一行、设置 → 同步页）。状态怎么算在 core/sync.js 的 syncPhase；
// app.js 的 ctx.syncBadge() 画一个，同步状态变了时把页面上所有 .sync-badge 换成新的（是链接的还是链接：点了去 #/settings/sync）。
// 设置里那一行本身就是去同步页的链接，里面的标签不能再是链接（链接套链接），用 { link: false }。
import { h } from './dom.js';
import { t, has } from '../i18n.js';
import { syncPhase } from '../core/sync.js';
import { fmtShort, fmtClock } from '../core/dates.js';

// 状态 → 圆点的样子：ok 绿、wait 灰（同步中、离线、待同步、稍后再试）、warn 黄（令牌快到期）、err 红、off 空心
const CLS = { off: 'off', err: 'err', running: 'wait', offline: 'wait', wait: 'wait', token: 'warn', pending: 'wait', ok: 'ok' };
const TEXT = { off: 'sync.off', err: 'sync.error', running: 'sync.running', offline: 'sync.offline', wait: 'sync.wait', token: 'sync.token', pending: 'sync.pending' };

/** 出错的说明（syncErr.<code>）：请求太多时带上能再试的时刻 @param {{ code: string, vars?: Record<string, any> } | null | undefined} err @param {string} lang */
export function syncErrText(err, lang) {
  if (!err) return '';
  const vars = { file: 'picknest.json', ...(err.vars || {}) };
  if (vars.until) vars.time = fmtClock(vars.until, lang);
  return t(has('syncErr.' + err.code) ? 'syncErr.' + err.code : 'syncErr.unknown', vars);
}

/** 状态 → { phase, cls, text, title }（title：出错时鼠标停上去看到的说明） @param {any} st @param {string} lang @param {number} [now] */
export function syncLabel(st, lang, now = Date.now()) {
  const phase = syncPhase(st, now);
  const text = phase === 'ok' ? (st.at ? t('sync.ok', { time: fmtShort(st.at, lang, now) }) : t('sync.ok0')) : t(TEXT[phase]);
  return { phase, cls: CLS[phase], text, title: st && st.err ? syncErrText(st.err, lang) : null };
}

/** 标签元素 @param {any} st ctx.sync.status() @param {string} lang @param {{ link?: boolean }} [opts] */
export function syncBadge(st, lang, { link = true } = {}) {
  const s = syncLabel(st, lang);
  return h((link ? 'a' : 'span') + '.sync-badge.' + s.cls, { href: link ? '#/settings/sync' : null, title: s.title, dataset: { phase: s.phase } },
    h('span.dot', { 'aria-hidden': 'true' }), h('span.sync-text', null, s.text));
}
