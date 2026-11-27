// 屏幕常亮（清单页、商店页共用）：⋯ 菜单里的「屏幕常亮」开关、开着时顶栏上安静的「屏幕常亮中」小标签，和页面一起开始、离开时放掉。
// 在店里推着车、一只手拿着手机时屏幕一暗就要解锁再找回来；勾东西就在平时的清单页、商店页上（没有另一页），所以常亮也跟着这两页。
// 开没开是这台设备记住的（picknest.local 的 keepAwake，core/wake.js 的 keepAwakeOn / keepAwakePatch），不同步：手机上开着、Mac 上关着都可以。
// 请求、切回来再要、放掉是 core/wake.js 的 screenWake；navigator.wakeLock、document 默认用全局的，测试给假的（env）。
// 一页一个：页面的 cleanup 里一定调 stop()。清单页 ↔ 商店页换页时先放掉再要，中间只隔一下，屏幕来不及暗。
// 小标签：拿到了（或正在要）写「屏幕常亮中」，点了就关掉（提示一句，焦点给 ⋯）；被拒绝了（低电量模式之类）同一个地方淡淡地写「没能常亮」，点了再要一次。
// 不支持的浏览器：页面上什么也不写，⋯ 里那一行不是开关（点了也做不到的开关是骗人的），说清楚这台设备做不到、可以把系统的「自动锁定」调长。
import { h, icon } from './dom.js';
import { t } from '../i18n.js';
import { screenWake, keepAwakeOn, keepAwakePatch } from '../core/wake.js';

/**
 * @param {object} ctx  页面的 ctx（读 ctx.local、ctx.setLocal、ctx.toast）
 * @param {any} main    页面的容器：在上面点一下（click）时，之前没要到的再要一次（有的浏览器只在点按里才给）
 * @param {{ wakeLock?: any, doc?: any, focusTo?: () => any }} [env]  测试用的 wakeLock / doc；focusTo：小标签点掉以后焦点给谁（⋯ 按钮）
 */
export function keepAwake(ctx, main, env = {}) {
  const nav = globalThis.navigator;
  const wakeLock = 'wakeLock' in env ? env.wakeLock : nav && nav.wakeLock;
  const doc = 'doc' in env ? env.doc : globalThis.document;
  const on = () => keepAwakeOn(ctx.local);
  const wake = screenWake({ wakeLock, doc, onChange: () => paint() });

  // ---------- 顶栏上的小标签 ----------
  /** @type {null | 'on' | 'denied'} */
  let shown = null;
  const label = h('span.awake-txt');
  const chip = h('button.awake-chip', { type: 'button', hidden: true, dataset: { fid: 'awake-chip' }, onclick: () => tapChip() }, icon('sun'), label);
  // 正在要（切回来、点一下再要）、被系统收回（切到后台）时不换字：被拒绝以后每点一下都会再要一次，换来换去顶栏就一闪一闪的；
  // 切回来时先收回、马上又要到，也不该缩回去再冒出来
  function want(st) {
    if (!on() || st === 'unsupported') return null;
    if (st === 'on' || st === 'denied') return st;
    return shown || 'on';
  }
  function paint() {
    const next = want(wake.status());
    if (next === shown) return;
    const hadFocus = globalThis.document && globalThis.document.activeElement === chip;
    shown = next;
    chip.hidden = !next;
    chip.classList.toggle('denied', next === 'denied');
    label.textContent = next ? t(next === 'on' ? 'awake.on' : 'awake.denied') : '';
    chip.setAttribute('aria-label', next ? t(next === 'on' ? 'awake.onLabel' : 'awake.deniedLabel') : '');
    // 点掉的小标签不见了：焦点不能掉回页首
    if (hadFocus && !next && env.focusTo) { const el = env.focusTo(); if (el && el.focus) el.focus(); }
  }
  function tapChip() {
    if (shown === 'denied') { wake.retry(); return; }
    set(false);
    ctx.toast(t('awake.turnedOff'));
  }
  function set(next) {
    ctx.setLocal(keepAwakePatch(next));
    if (next) wake.start(); else wake.stop();
    paint();
  }

  // ---------- ⋯ 菜单里的一组 ----------
  /** @param {{ close: () => void }} api  ctx.sheet 给的面板；点了开关先关面板（和菜单里别的一行一样），在点按里要常亮 */
  function menuGroup(api) {
    const st = wake.status();
    const head = [icon('sun', { cls: 'awake-ic' })];
    if (st === 'unsupported') {
      return h('div.group.menu.awake-menu', null, h('div.group-row.awake-row.awake-na', { dataset: { fid: 'awake-na' } }, ...head,
        h('span.awake-text', null, h('span.awake-t', null, t('awake.title')), h('span.awake-hint', null, t('awake.unsupported')))));
    }
    const isOn = on();
    const hint = h('span.awake-hint', { id: 'awake-hint' }, t(isOn && st === 'denied' ? 'awake.deniedHint' : 'awake.hint'));
    return h('div.group.menu.awake-menu', null, h('button.group-row.awake-row', {
      type: 'button', role: 'switch', 'aria-checked': String(isOn), 'aria-label': t('awake.title'), 'aria-describedby': 'awake-hint', dataset: { fid: 'awake-toggle' },
      onclick: () => { api.close(); set(!isOn); },
    }, ...head, h('span.awake-text', null, h('span.awake-t', null, t('awake.title')), hint), h('span.awake-switch', { 'aria-hidden': 'true' })));
  }

  // 有的浏览器只在点按里才给常亮：之前没要到（被拒绝、被系统收回）时，点一下页面再要一次。
  // 听 click 不听 pointerdown：手指按下还不算「点过」，松开以后才算；键盘按的按钮也有 click
  const retry = () => wake.retry();
  main.addEventListener('click', retry);
  if (on()) wake.start();
  paint();

  return {
    chip,
    menuGroup,
    /** 现在的样子（测试、页面不用自己判断）：null 没开 / 不支持，'on'，'denied' */
    shown: () => shown,
    /** 离开这一页：放掉，不再听切回来、点按 */
    stop() { main.removeEventListener('click', retry); wake.stop(); },
  };
}
