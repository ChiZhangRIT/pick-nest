// 启动器：安装完成后才加载 App；当前页面和控制它的 worker 必须属于同一版。只依赖 version.js（版本号），App 出什么错这里都能提示。
import { BUILD } from './version.js';
export { BUILD };

function within(promise, ms) {
  let timer;
  return Promise.race([promise, new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('boot-timeout')), ms); })]).finally(() => clearTimeout(timer));
}
export function workerBuild(controller, { Channel = globalThis.MessageChannel, timeout = 5000 } = {}) {
  const channel = new Channel();
  const answer = new Promise(resolve => { channel.port1.onmessage = e => resolve(e.data); controller.postMessage('picknest-build', [channel.port2]); });
  return within(answer, timeout).finally(() => { channel.port1.close(); channel.port2.close(); });
}
export async function start({ nav = globalThis.navigator, loc = globalThis.location, win = globalThis.window,
  load = () => import('./app.js'), Channel = globalThis.MessageChannel, timeout = 15000 } = {}) {
  win.__picknestBootError = true;               // 等待期间由这里负责超时提示，避免 boot.js 的看门狗再盖一层
  if (loc.protocol === 'https:') {
    if (!nav.serviceWorker) throw new Error('worker-unavailable');
    if (!nav.serviceWorker.controller) {
      await within(nav.serviceWorker.register('sw.js', { updateViaCache: 'none' }), timeout);
      await within(nav.serviceWorker.ready, timeout);
      loc.reload();                           // 首次打开还未受控制：重开到刚校验通过的完整版本，不先运行网络里的模块
      return;
    }
    let active;
    try { active = await workerBuild(nav.serviceWorker.controller, { Channel, timeout }); }
    catch (e) { throw new Error('update-pending'); }
    if (active !== BUILD) throw new Error('update-pending');
    // 已安装时从缓存立即启动；网络慢、离线或更新失败都不阻塞旧版使用。
    Promise.resolve().then(() => nav.serviceWorker.register('sw.js', { updateViaCache: 'none' })).catch(() => {});
  }
  await within(load(), timeout);
  win.__picknestBootError = false;
}
/**
 * 出错提示用哪种语言：规则和 i18n.js 一样（选过的 → 系统语言里先碰到繁体中文就繁体，其他中文或没有中文 → 简体，English 只在选了时用），
 * 但不 import 它：App 的模块出了错，这里也得能提示
 */
export function errorLang(stored, langs = []) {
  if (stored === 'zh-Hans' || stored === 'zh-Hant-TW' || stored === 'en') return stored;
  for (const raw of langs) {
    const l = String(raw || '').toLowerCase();
    if (/^zh-(tw|hk|mo)|^zh-hant/.test(l)) return 'zh-Hant-TW';
    if (l.startsWith('zh')) return 'zh-Hans';
  }
  return 'zh-Hans';
}
function showError(error) {
  let stored = '';
  try { stored = JSON.parse(localStorage.getItem('picknest.local') || 'null')?.lang || ''; } catch (e) { /* 按系统语言 */ }
  const nav = globalThis.navigator;
  const lang = errorLang(stored, (nav && (nav.languages || [nav.language])) || []);
  const strings = {
    'zh-Hans': ['请关闭所有 PickNest 页面，再重新打开，让程序完成更新。', 'PickNest 没能打开，请联网后重试。', '重新尝试'],
    'zh-Hant-TW': ['請關閉所有 PickNest 頁面，再重新開啟，讓程式完成更新。', 'PickNest 無法開啟，請連上網路後重試。', '重試'],
    en: ['Close all PickNest windows, then open PickNest again to finish the update.', "PickNest couldn't start. Connect to the internet and try again.", 'Try again'],
  }[lang];
  const box = document.createElement('section'); box.className = 'boot-error'; box.setAttribute('role', 'alert');
  const text = document.createElement('p'); text.textContent = strings[error.message === 'update-pending' ? 0 : 1];
  const button = document.createElement('button'); button.className = 'btn'; button.type = 'button'; button.textContent = strings[2]; button.onclick = () => location.reload();
  box.append(text, button); document.body.append(box);
}
if (typeof window !== 'undefined') start().catch(showError);
