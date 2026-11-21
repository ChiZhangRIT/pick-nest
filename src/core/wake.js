// @ts-check
// 购物模式的屏幕常亮（Screen Wake Lock，navigator.wakeLock）：进购物模式时要一次；切到后台时系统会收回，切回来（visibilitychange → visible）再要；
// 离开购物模式时放掉。浏览器不支持（旧的 iOS 等）就什么也不做，被拒绝（低电量模式之类）也一样——不影响购物，页面最下面淡淡地说一句。
// navigator.wakeLock、document 都由调用的地方给（测试用假的），这里不碰 DOM。
//
// 状态（status()，变了调 onChange）：
//   'unsupported' 没有 navigator.wakeLock；'asking' 正在要；'on' 拿到了；'off' 没在用（还没开始、已经放掉、被系统收回）；'denied' 要了没给

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
      if (!running) { drop(s); return; }            // 要到之前已经离开了购物模式
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
    /** 进购物模式 */
    start() {
      if (running) return;
      running = true;
      if (!supported) { set('unsupported'); return; }
      if (doc && typeof doc.addEventListener === 'function') doc.addEventListener('visibilitychange', onVis);
      request();
    },
    /** 离开购物模式：放掉，不再听切回来 */
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
