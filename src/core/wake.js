// @ts-check
// 屏幕常亮（Screen Wake Lock，navigator.wakeLock）：清单页、商店页上开着「屏幕常亮」（⋯ 里的开关，ui/keepAwake.js）时，进这一页要一次；
// 切到后台时系统会收回，切回来（visibilitychange → visible）再要；离开这一页、关掉开关时放掉。
// 浏览器不支持（旧的 iOS 等）就什么也不做，被拒绝（低电量模式之类）也一样——不影响勾东西，页面上淡淡地说一句。
// 以前只在第 6 步那个单独的大字页面里用；那一页去掉了（勾选和平时一样，不需要另一页），留下的只有常亮，换成本机记住的开关（keepAwakeOn / keepAwakePatch）。
// navigator.wakeLock、document 都由调用的地方给（测试用假的），这里不碰 DOM。
//
// 状态（status()，变了调 onChange）：
//   'unsupported' 没有 navigator.wakeLock；'asking' 正在要；'on' 拿到了；'off' 没在用（还没开始、已经放掉、被系统收回）；'denied' 要了没给

/**
 * 本机设置里开没开（picknest.local 的 keepAwake）：只有 true 算开，没有这一项（旧版存的）、认不出的值都是关着。
 * 默认关：常亮费电，而且只有在店里推着车时才需要；Mac、iPad 上一般用不着
 * @param {{ keepAwake?: unknown } | null | undefined} local
 */
export const keepAwakeOn = (local) => !!(local && local.keepAwake === true);
/** 给 ctx.setLocal 的改动（只记这台设备，不同步：手机上开着、Mac 上关着都可以） @param {boolean} on */
export const keepAwakePatch = (on) => ({ keepAwake: on === true });

/** @typedef {'unsupported' | 'asking' | 'on' | 'off' | 'denied'} WakeStatus */
/**
 * @typedef {object} WakeSentinel
 * @property {() => Promise<void>} release
 * @property {(type: string, fn: () => void) => void} [addEventListener]
 */
/**
 * wakeLock：navigator.wakeLock（没有就是不支持）；doc：document（听切回来、看在不在前台；不给就当一直在前台、不听）
 * @param {{ wakeLock?: { request: (type: 'screen') => Promise<WakeSentinel> } | null, doc?: any, onChange?: (s: WakeStatus) => void }} [o]
 */
export function screenWake({ wakeLock = null, doc = null, onChange = () => {} } = {}) {
  const supported = !!(wakeLock && typeof wakeLock.request === 'function');
  let running = false, asking = false;
  /** @type {WakeSentinel | null} */
  let sentinel = null;
  /** @type {WakeStatus} */
  let st = supported ? 'off' : 'unsupported';
  const set = (/** @type {WakeStatus} */ s) => { if (st !== s) { st = s; try { onChange(s); } catch (e) { /* 页面画不出来不影响常亮 */ } } };
  const visible = () => !doc || !doc.visibilityState || doc.visibilityState === 'visible';
  // 放掉不等结果：release() 本身可能已经失效（系统先收回了）
  const drop = (/** @type {WakeSentinel} */ s) => { Promise.resolve().then(() => s.release()).catch(() => {}); };

  async function request() {
    // 在后台时要不到（浏览器直接拒绝），等切回来再要；已经有了、正在要的不重复要
    if (!running || !supported || sentinel || asking || !visible()) return;
    asking = true;
    set('asking');
    try {
      const s = await /** @type {any} */ (wakeLock).request('screen');
      asking = false;
      if (!running) { drop(s); return; }            // 要到之前已经离开了这一页（或者关掉了开关）
      sentinel = s;
      // 系统收回（切到后台、锁屏、低电量）：记成没在用，切回来再要。自己放掉的（stop）已经先把 sentinel 清掉了，不算
      if (s && typeof s.addEventListener === 'function') s.addEventListener('release', () => { if (sentinel === s) { sentinel = null; set('off'); } });
      set('on');
    } catch (e) {
      asking = false;
      if (running) set('denied');
    }
  }
  function onVis() { if (visible()) request(); }

  return {
    /** 进清单页 / 商店页（开着开关时），或者刚打开开关 */
    start() {
      if (running) return;
      running = true;
      if (!supported) { set('unsupported'); return; }
      if (doc && typeof doc.addEventListener === 'function') doc.addEventListener('visibilitychange', onVis);
      request();
    },
    /** 离开这一页、关掉开关：放掉，不再听切回来 */
    stop() {
      if (!running) return;
      running = false;
      if (doc && typeof doc.removeEventListener === 'function') doc.removeEventListener('visibilitychange', onVis);
      const s = sentinel;
      sentinel = null;
      if (s) drop(s);
      if (supported) set('off');
    },
    /** 用户点了一下页面：之前被拒绝了 / 被收回了就再要一次（有的浏览器要在点按里才给） */
    retry() { if (running && (st === 'denied' || st === 'off')) request(); },
    status: () => st,
  };
}
