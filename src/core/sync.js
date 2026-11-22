// @ts-check
// 多设备同步：数据在用户自己的 GitHub 私有仓库里（建议叫 pick-nest-data），用 GitHub 的 contents API 读写一个文件。
// 从 babble 的 core/sync.js 移植，只留文字数据这一部分（没有录音、永久删除、云端历史）。文件名、App 标识（createSync 的 file / app）
// 和同步码前缀（syncCode / parseSyncCode 的 prefix）都是参数，不写死。
//   picknest.json = { app:'picknest', v:1, device, savedAt, state }   state 是整份数据（data、settings、settingsAt）：没有令牌，也没有本机设置
// 每一轮：确认仓库是私有的（5 分钟内确认过就不再问；要新建文件时一定再问）→ 先拉取、逐条合并（两边都 normalizeState，mergeStates，
// ensureSeeds，交给 applyRemote 保存）→ 本机有云端没有的改动才上传（带着云端版本号 sha；别的设备抢先改过会返回 409 / 422，
// 就重新拉取、合并再传，最多 4 次，中间等一小会儿、带点随机，免得两台设备一直撞在一起）。
// 切到后台时（pushFirst）：已经知道云端版本、本机有改动，就直接上传，不先拉取——少一个来回，页面随时可能被系统挂起；云端变过照样 409 → 合并再传。
// ETag 只在真的合并成功以后才记（不然以后的 304 会把没合并进来的那一版挡在外面）；文件超过 1 MB 时 contents API 不给内容，再用 raw 格式取原文。
// 同一时间只跑一轮（一条 promise 队列；切到后台的直接上传先打断正在跑的那一轮）；本机修改计数（editVersion）在上传期间变了，上传完仍算有改动。
// 请求太多（429、403 + 剩余 0）是暂时的：报 rate，带着能再试的时刻（app 在那之前不自动同步），不当成令牌或权限问题。
import { normalizeState, mergeStates, ensureSeeds, canon, fileProblem } from './store.js';
import { isObj, str } from './util.js';

/** @typedef {import('./store.js').State} State */
/**
 * 本机设置 picknest.local 里的 sync（只在这台设备上，不进备份、不同步）
 * @typedef {{ repo: string, token: string, sha?: string | null, etag?: string | null, dirty?: boolean, at?: number | null,
 *   err?: { code: string, vars?: Record<string, any>, message?: string } | null, offline?: boolean, tokenExp?: number | null }} SyncConfig
 */
/** @typedef {{ ok: boolean, skipped?: boolean, error?: SyncConfig['err'], offline?: boolean }} RoundResult */
/** @typedef {{ pushFirst?: boolean, keepalive?: boolean }} RoundOptions */

export const GH_API = 'https://api.github.com';
export const SYNC_FILE = 'picknest.json';
export const APP_ID = 'picknest';
export const CODE_PREFIX = 'picknest-sync:';
// object 格式：超过 1 MB 的文件也能拿到 sha（content 是空的），默认格式会直接报错
const ACCEPT_OBJ = 'application/vnd.github.object+json', ACCEPT_RAW = 'application/vnd.github.raw+json';
const VERIFY_MS = 5 * 60 * 1000;              // 「仓库是私有的」确认多久有效（仓库可能被改成公开、删掉重建）
// 切到后台时的直接上传（pushFirst，带着 sha：文件在、就是刚才确认过的那个仓库）放宽到半小时：先问一次仓库要多一个来回
//（还有 CORS 预检），页面多半等不到回答就被挂起，上传根本发不出去
const PUSH_VERIFY_MS = 30 * 60 * 1000;
const PUT_TRIES = 4;
const KEEPALIVE_MAX = 60 * 1024;              // fetch keepalive 的请求体上限是 64 KB（这一页所有 keepalive 请求加起来），留点余量
const DAY = 864e5;
export const TOKEN_WARN_DAYS = 14;            // 令牌到期前两周开始提醒

/** 同步出错：带错误代码（显示时翻译成 syncErr.<code>）。网络问题是 'net' */
export class SyncError extends Error {
  /** @param {string} code @param {Record<string, any>} [vars] */
  constructor(code, vars = {}) { super(code); this.code = code; this.vars = vars; }
}
/** 暂时的问题（断网、请求太多、几台设备同时改、GitHub 自己出错）：等一会儿自动再试，不用用户改设置 @param {{ code: string, vars?: Record<string, any> } | null | undefined} err */
export const temporary = err => !!err && (['net', 'rate', 'mergeFail'].includes(err.code) || (err.code === 'http' && Number(err.vars && err.vars.status) >= 500));

// ---------- 同步码、仓库名、令牌 ----------
const escRe = (/** @type {string} */ s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/**
 * 同步码：<前缀><owner/repo>:<令牌>[:<令牌到期日 YYYY-MM-DD>]（复制到别的设备上粘贴；里面就是令牌原文）。
 * 到期日是每台设备自己的本机设置：不带过去的话，用同步码连上的设备（iPhone、iPad 一般都是）永远不会提前提醒换令牌
 * @param {string} repo @param {string} token @param {{ exp?: string | null, prefix?: string }} [opts] exp：<input type=date> 的值
 */
export const syncCode = (repo, token, { exp = null, prefix = CODE_PREFIX } = {}) => `${prefix}${repo}:${token}${exp && DAY_RE.test(exp) ? ':' + exp : ''}`;
/** → { repo, token, exp（'YYYY-MM-DD'，没带 → null） } | null。前缀是参数：别的 App（babble-sync:）的同步码不认 @param {unknown} text @param {string} [prefix] */
export function parseSyncCode(text, prefix = CODE_PREFIX) {
  const m = str(text).trim().match(new RegExp('^' + escRe(prefix) + '([\\w.-]+\\/[\\w.-]+):([^\\s:]+)(?::(\\d{4}-\\d{2}-\\d{2}))?$'));
  return m ? { repo: m[1], token: m[2], exp: m[3] || null } : null;
}
/** 用户填的仓库：「owner/repo」，也认 https://github.com/owner/repo(.git)；不对 → null @param {unknown} input */
export function cleanRepo(input) {
  const repo = str(input).trim().replace(/^https?:\/\/(www\.)?github\.com\//i, '').replace(/\/+$/, '').replace(/\.git$/i, '');
  return /^[\w.-]+\/[\w.-]+$/.test(repo) ? repo : null;
}
/**
 * 令牌有什么问题：空的 → 'noToken'；经典令牌（ghp_、gho_、ghu_、ghs_、ghr_ 开头，还有 2021 年以前没有前缀的 40 位十六进制：
 * 能动整个 GitHub 账号，常常不会过期）→ 'classic'；中间有空白（复制多了）→ 'badToken'；别的不是 github_pat_ 开头的 → 'notFine'；没问题 → null。
 * 只认 Fine-grained 令牌的前缀，不认识的格式不能留给 GitHub 判断：旧式的经典令牌 GitHub 照样收，不会 401
 * @param {unknown} token
 */
export function tokenProblem(token) {
  const s = str(token).trim();
  if (!s) return 'noToken';
  if (/^gh[pousr]_/.test(s) || /^[0-9a-f]{40}$/i.test(s)) return 'classic';
  if (/\s/.test(s)) return 'badToken';
  return /^github_pat_/.test(s) ? null : 'notFine';
}
/** 本地日期那一天的 0 点 @param {number} ms */
const dayStart = ms => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
/**
 * 令牌还有几天到期：按本地的日历日数（今天到期是 0，明天 1，过期了是负数）；没填 → null。
 * 不用毫秒差除以 24 小时：夏令时开始的那天只有 23 小时，前一晚会把「明天到期」算成「今天到期」
 * @param {unknown} exp @param {number} [now]
 */
export function tokenDaysLeft(exp, now = Date.now()) {
  const ms = Number(exp);
  return ms > 0 ? Math.round((dayStart(ms) - dayStart(now)) / DAY) : null;
}
/** 该提醒换令牌了吗（两周内到期，或者已经过期） @param {unknown} exp @param {number} [now] */
export const tokenWarn = (exp, now = Date.now()) => { const d = tokenDaysLeft(exp, now); return d != null && d < TOKEN_WARN_DAYS; };

/**
 * 同步状态的样子（标签和设置页用）：没开 off → 出错 err（要用户处理的）→ 同步中 running → 离线 offline → 稍后再试 wait（暂时的错误）
 * → 令牌快到期 token → 有改动没传 pending → 已同步 ok
 * @param {{ on?: boolean, running?: boolean, err?: SyncConfig['err'], offline?: boolean, dirty?: boolean, tokenExp?: number | null } | null | undefined} st
 * @param {number} [now]
 */
export function syncPhase(st, now = Date.now()) {
  if (!st || !st.on) return 'off';
  if (st.err && !temporary(st.err)) return 'err';
  if (st.running) return 'running';
  if (st.offline) return 'offline';
  if (st.err) return 'wait';
  if (tokenWarn(st.tokenExp, now)) return 'token';
  return st.dirty ? 'pending' : 'ok';
}

/** 写进云端的设备名：设置里没起名字就用平台名（iPhone / iPad / Mac） @param {any} [nav] */
export function platformDevice(nav = globalThis.navigator) {
  const ua = str(nav && nav.userAgent), pf = str(nav && nav.platform);
  if (/iPad/.test(ua) || (pf === 'MacIntel' && nav && nav.maxTouchPoints > 1)) return 'iPad';
  if (/iPhone|iPod/.test(ua)) return 'iPhone';
  if (/Mac/.test(pf)) return 'Mac';
  return 'Browser';
}

// ---------- base64（UTF-8） ----------
/** @param {Uint8Array} bytes */
function bytesToB64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, /** @type {any} */ (bytes.subarray(i, i + 0x8000)));
  return btoa(bin);
}
/** @param {string} text */
export const toB64 = text => bytesToB64(new TextEncoder().encode(text));
/** @param {string} b64 */
export function fromB64(b64) {
  const bin = atob(String(b64).replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/**
 * 云端文件的内容 → { device, state }。读不出来、不是这个 App 的 → badFile；新版 App 写的（v 比 1 大）→ newer（旧版不合并、不上传，免得改坏）
 * @param {string} text @param {string} [app] @param {string} [file]
 */
export function readSyncFile(text, app = APP_ID, file = SYNC_FILE) {
  let d = null;
  try { d = JSON.parse(text); } catch (e) { d = null; }
  const p = fileProblem(d, app);
  if (p === 'newer') throw new SyncError('newer', { file });
  if (p) throw new SyncError('badFile', { file });
  return { device: str(d.device), state: normalizeState(d.state) };
}

/** 私有仓库：visibility 是 private（企业版的 internal 也不行）；很旧的回应没有 visibility 时看 private @param {any} info */
const isPrivate = info => isObj(info) && (info.visibility != null ? info.visibility === 'private' : info.private === true);

/**
 * @param {object} o
 * @param {() => any} o.getState                         当前本机数据
 * @param {(merged: State, info: { device: string }) => any} o.applyRemote   合并出新内容时调用（info.device = 上次写入云端的设备名）
 * @param {() => SyncConfig | null} o.getConfig         picknest.local 里的 sync；没开同步（或本机数据有问题）→ null
 * @param {(cfg: SyncConfig) => void} o.saveConfig      一轮结束：保存同步状态（只存本机）
 * @param {() => number} o.editVersion                  本机修改计数：上传期间又改过的话，上传完仍然算「有改动」
 * @param {string | (() => string)} [o.device]          设备名（写进云端和提交说明；可以是函数）
 * @param {string} [o.file]                             仓库里的文件名（默认 picknest.json）
 * @param {string} [o.app]                              文件里的 App 标识（默认 picknest）：别的 App 的文件不合并
 * @param {(status: { running: boolean }) => void} [o.onStatus]   开始、结束一轮时调用
 * @param {typeof fetch} [o.fetch]
 * @param {(ms: number) => Promise<void>} [o.sleep]     409 以后重试前等一下（测试换成不等）
 */
export function createSync(o) {
  const doFetch = o.fetch || ((/** @type {any[]} */ ...a) => fetch(.../** @type {[any, any]} */ (a)));
  const file = o.file || SYNC_FILE, app = o.app || APP_ID;
  const sleep = o.sleep || (ms => new Promise(r => setTimeout(r, ms)));
  const device = () => str((typeof o.device === 'function' ? o.device() : o.device) || '');
  let chain = Promise.resolve(/** @type {any} */ (null));
  let verified = /** @type {string | null} */ (null), verifiedAt = 0;   // 最近确认过是私有仓库的 repo 名和时刻
  const st = { running: false };
  /** @type {AbortController | null} */
  let current = null;                          // 正在跑的这一轮：切到后台要直接上传时打断它（见 syncNow）
  const changed = (/** @type {Partial<typeof st>} */ patch) => {
    Object.assign(st, patch);
    if (o.onStatus) { try { o.onStatus({ ...st }); } catch (e) { /* 界面出错不影响同步 */ } }
  };

  // ---------- GitHub API ----------
  /** @param {string} token @param {string} [accept] @returns {Record<string, string>} */
  const headers = (token, accept) => ({ Authorization: 'Bearer ' + token, Accept: accept || 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' });
  /**
   * @param {{ token: string }} cfg @param {string} method @param {string} path
   * detached：不属于一轮同步（checkRepo、readRemote）：切到后台打断一轮时不连带打断它
   * @param {{ body?: any, etag?: string | null | false, accept?: string, timeout?: number, keepalive?: boolean, detached?: boolean }} [opts]
   * @returns {Promise<any>}
   */
  async function gh(cfg, method, path, { body, etag, accept, timeout = 20000, keepalive = false, detached = false } = {}) {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), timeout);
    const round = detached ? null : current && current.signal;
    if (round) { if (round.aborted) ctl.abort(); else round.addEventListener('abort', () => ctl.abort(), { once: true }); }
    const h = headers(cfg.token, accept);
    const text = body ? JSON.stringify(body) : undefined;
    if (text) h['Content-Type'] = 'application/json';
    if (etag) h['If-None-Match'] = etag;
    /** @type {RequestInit} */
    const init = { method, headers: h, body: text, cache: 'no-store', signal: ctl.signal };
    // 切到后台时的上传：keepalive 让请求在页面被挂起、关掉以后也发得出去（请求体大了浏览器会直接拒绝，就照常发）
    if (keepalive && (!text || new TextEncoder().encode(text).length < KEEPALIVE_MAX)) init.keepalive = true;
    try { return await doFetch(GH_API + path, init); }
    catch (e) { throw new SyncError(round && round.aborted ? 'aborted' : 'net'); }
    finally { clearTimeout(timer); }
  }
  /** @param {any} r @param {string} k */
  const header = (r, k) => (r && r.headers && typeof r.headers.get === 'function' ? r.headers.get(k) : null);
  /** 读 JSON / 文字；读不出来（连接断了）当成断网（这一轮被打断了的是 aborted；detached 同 gh） @param {any} r @param {boolean} [detached] */
  const json = async (r, detached = false) => { try { return await r.json(); } catch (e) { throw new SyncError(!detached && current && current.signal.aborted ? 'aborted' : 'net'); } };
  /** @param {any} r @param {boolean} [detached] @returns {Promise<string>} */
  const text = async (r, detached = false) => { try { return await r.text(); } catch (e) { throw new SyncError(!detached && current && current.signal.aborted ? 'aborted' : 'net'); } };
  /** 请求太多：什么时候能再试（Retry-After 秒数，或者 x-ratelimit-reset 的时刻；都没有就一分钟后） @param {any} r */
  function retryAt(r) {
    const after = Number(header(r, 'retry-after')), reset = Number(header(r, 'x-ratelimit-reset'));
    return after > 0 ? Date.now() + after * 1000 : reset > 0 ? reset * 1000 : Date.now() + 60000;
  }
  /** @param {any} r */
  function httpError(r) {
    if (r.status === 401) return new SyncError('auth');
    if (r.status === 429 || (r.status === 403 && (header(r, 'x-ratelimit-remaining') === '0' || header(r, 'retry-after')))) {
      return new SyncError('rate', { status: r.status, until: retryAt(r) });     // 稍后再试，不是权限问题
    }
    if (r.status === 404) { verified = null; return new SyncError('notfound'); }   // 仓库可能被删了（重建的可能是公开的）：下次重新确认
    if (r.status === 403) return new SyncError('perm');
    return new SyncError('http', { status: r.status });
  }
  /** @param {SyncConfig} cfg */
  const contents = cfg => `/repos/${cfg.repo}/contents/${file}`;

  /** 仓库必须是私有的。maxAge（默认 5 分钟）内确认过就不再问；force：一定再问 @param {SyncConfig} cfg @param {boolean} [force] @param {number} [maxAge] */
  async function ensurePrivate(cfg, force = false, maxAge = VERIFY_MS) {
    if (!force && verified === cfg.repo && Date.now() - verifiedAt < maxAge) return;
    const t0 = Date.now();
    verified = null;
    const r = await gh(cfg, 'GET', `/repos/${cfg.repo}`);
    if (!r.ok) throw httpError(r);
    if (!isPrivate(await json(r))) throw new SyncError('public');
    verified = cfg.repo; verifiedAt = t0;
  }
  /** 停止同步了、换了仓库或令牌、本机数据出了问题（getConfig 返回 null）：正在跑的这一轮不再往下做 @param {SyncConfig} cfg */
  const stopped = cfg => { const c = o.getConfig(); return !c || c.repo !== cfg.repo || c.token !== cfg.token; };

  // ---------- 拉取、上传 ----------
  /** @param {SyncConfig} cfg @param {RoundOptions} [opts] */
  async function pull(cfg, { keepalive = false } = {}) {
    const r = await gh(cfg, 'GET', contents(cfg), { etag: !!cfg.sha && cfg.etag, accept: ACCEPT_OBJ, keepalive });
    if (r.status === 304) return;                    // 和上次合并过的一样
    if (r.status === 404) {                          // 云端还没有文件：第一次同步（或者被删了），这一轮新建
      cfg.sha = cfg.etag = null;
      cfg.dirty = true;
      return;
    }
    if (!r.ok) throw httpError(r);
    const j = await json(r);
    const etag = header(r, 'ETag');                  // 真的合并进来了才记下
    if (isObj(j) && j.sha && j.sha === cfg.sha) { cfg.etag = etag; return; }   // 就是上次合并过 / 传上去的那一版
    let body = isObj(j) && j.encoding === 'base64' && j.content ? fromB64(j.content) : null;
    if (body == null) {                              // 超过 1 MB：object 格式只给 sha，原文要单独取
      const raw = await gh(cfg, 'GET', contents(cfg), { accept: ACCEPT_RAW, timeout: 60000, keepalive });
      if (!raw.ok) throw httpError(raw);
      body = await text(raw);
    }
    const d = readSyncFile(body, app, file);
    // 两边都整理成同样的格式再比较：不然本机刚改的记录（还没补默认字段）和云端整理过的永远「不一样」，每次同步都会再传一遍
    const remote = d.state, local = normalizeState(o.getState());
    const merged = ensureSeeds(mergeStates(local, remote));
    if (canon(merged) !== canon(local)) o.applyRemote(merged, { device: d.device });
    cfg.sha = isObj(j) ? j.sha || null : null; cfg.etag = etag;
    // 保存合并结果时可能又接上了别的标签页的新记录：和云端那份比，不一样就这一轮传上去
    cfg.dirty = canon(normalizeState(o.getState())) !== canon(remote);
  }

  /** @param {SyncConfig} cfg @param {RoundOptions} [opts] */
  async function push(cfg, opts = {}) {
    if (!cfg.sha) { verified = null; await ensurePrivate(cfg); }   // 要新建文件（第一次、云端被删过或重建过）：再确认一次仓库没变成公开的
    for (let i = 0; i < PUT_TRIES; i++) {
      if (stopped(cfg)) return;
      const version = o.editVersion(), state = o.getState();
      /** @type {{ message: string, content: string, sha?: string }} */
      const body = {
        message: `更新 ${file}（${device()}）`,
        content: toB64(JSON.stringify({ app, v: 1, device: device(), savedAt: new Date().toISOString(), state })),
      };
      if (cfg.sha) body.sha = cfg.sha;
      const r = await gh(cfg, 'PUT', contents(cfg), { body, timeout: 60000, keepalive: opts.keepalive });
      if (r.ok) {
        const j = await json(r);
        cfg.sha = (isObj(j) && isObj(j.content) && j.content.sha) || null;
        cfg.etag = null;
        cfg.dirty = o.editVersion() !== version;    // 上传期间又改过：留到下一次
        return;
      }
      // 409 / 422：云端被别的设备改过（sha 过期）或者已经有文件了；带着 sha 却 404：云端的文件被删了。都是重新拉取、合并再传
      const gone = r.status === 404 && !!cfg.sha;
      if (r.status !== 409 && r.status !== 422 && !gone) throw httpError(r);
      if (i === PUT_TRIES - 1) break;
      await sleep(150 * 2 ** i + Math.round(Math.random() * 150));   // 两台设备同时传时错开一点
      cfg.etag = null;
      await pull(cfg, opts);
      if (!cfg.dirty) return;                       // 合并以后和云端一样了（对方已经传了同样的改动）
      if (!cfg.sha) { verified = null; await ensurePrivate(cfg); }
    }
    throw new SyncError('mergeFail');
  }

  // ---------- 一轮同步 ----------
  /** @param {RoundOptions} [opts] @returns {Promise<RoundResult>} */
  async function run(opts = {}) {
    const cfg = o.getConfig();
    if (!cfg) return { ok: true, skipped: true };
    const ctl = current = new AbortController();
    changed({ running: true });
    try {
      const bad = tokenProblem(cfg.token);
      if (bad) throw new SyncError(bad);           // 不是 Fine-grained 令牌（经典令牌能动整个账号）：不用它发任何请求
      const direct = !!(opts.pushFirst && cfg.sha && cfg.dirty);
      await ensurePrivate(cfg, false, direct ? PUSH_VERIFY_MS : VERIFY_MS);
      // 以后有图片（ROADMAP「以后 → 图片」）：照 babble 的录音，在这里（拉取之后、上传 picknest.json 之前）先传本机还没上传的图片
      //（按内容的 sha256 命名、只增不改），别的设备看到记录时图片已经在云端了；本机缺的图片在这一轮之后放到后台下载
      if (direct) await push(cfg, opts);
      else {
        await pull(cfg, opts);
        if (stopped(cfg)) return { ok: false, skipped: true };
        if (cfg.dirty) await push(cfg, opts);
      }
      if (stopped(cfg)) return { ok: false, skipped: true };
      cfg.at = Date.now();
      cfg.offline = false;
      cfg.err = null;
      return { ok: true };
    } catch (e) {
      const code = e instanceof SyncError ? e.code : 'unknown';
      // 被切到后台的直接上传打断了：不算出错、也不算离线，状态留着，接着那一轮会再来
      if (code === 'aborted') return { ok: false, skipped: true };
      cfg.offline = code === 'net';
      cfg.err = code === 'net' ? null : { code, vars: (e instanceof SyncError && e.vars) || {}, ...(code === 'unknown' ? { message: String((e && /** @type {any} */ (e).message) || e) } : {}) };
      return { ok: false, error: cfg.err, offline: cfg.offline };
    } finally {
      if (current === ctl) current = null;
      o.saveConfig(cfg);
      changed({ running: false });
    }
  }

  /** 同一时间只跑一个 @template T @param {() => Promise<T>} fn @returns {Promise<T>} */
  function queue(fn) {
    const p = chain.then(fn);
    chain = p.catch(() => null);
    return p;
  }
  /**
   * 排一轮。切到后台的直接上传（pushFirst）不排在正在跑的那一轮后面：那一轮（比如刚切回来时的拉取）还在等回答，页面就会被挂起，
   * 这次的修改要等下次打开才传得上去。先打断它（它的请求作废，这一轮不算出错），马上上传；云端变过照样 409 → 合并再传
   * @param {RoundOptions} [opts]
   */
  const syncNow = (opts = {}) => {
    if (opts && opts.pushFirst && current) current.abort();
    return queue(() => run(opts || {}));
  };
  /** 等排着的都跑完（测试用） */
  async function idle() { let c; do { c = chain; await c; } while (c !== chain); }

  /** 连接之前检查：仓库名、令牌（不收经典令牌）、仓库在、令牌能看到它、是私有的 → 仓库全名 @param {unknown} repo @param {unknown} token */
  async function checkRepo(repo, token) {
    const name = cleanRepo(repo);
    if (!name) throw new SyncError('badRepo');
    const bad = tokenProblem(token);
    if (bad) throw new SyncError(bad);
    const r = await gh({ token: str(token).trim() }, 'GET', `/repos/${name}`, { detached: true });
    if (!r.ok) throw httpError(r);
    const info = await json(r, true);
    if (!isPrivate(info)) throw new SyncError('public');
    return isObj(info) && typeof info.full_name === 'string' && info.full_name ? info.full_name : name;
  }

  /**
   * 只读：取云端现在的那一份（恢复页「从云端恢复」用：本机数据有问题时正常同步是停着的，不能让残缺的数据传上去）。
   * 直接要原文（raw），超过 1 MB 也能取。没开同步 → off；云端还没有文件 → nofile
   * @returns {Promise<State>}
   */
  async function readRemote() {
    const cfg = o.getConfig();
    if (!cfg) throw new SyncError('off');
    const bad = tokenProblem(cfg.token);
    if (bad) throw new SyncError(bad);             // 和正常同步一样：经典令牌不拿来发请求
    const r = await gh(cfg, 'GET', contents(cfg), { accept: ACCEPT_RAW, timeout: 60000, detached: true });
    if (r.status === 404) throw new SyncError('nofile', { file });
    if (!r.ok) throw httpError(r);
    return readSyncFile(await text(r, true), app, file).state;
  }

  return { syncNow, checkRepo, readRemote, idle, status: () => ({ ...st }) };
}
