// @ts-check
// 多设备同步：数据在用户自己的 GitHub 私有仓库里（建议叫 pick-nest-data），用 GitHub 的 contents API 读写一个文件。
// 从 babble 的 core/sync.js 移植（没有永久删除、云端历史）。文件名、App 标识（createSync 的 file / app）
// 和同步码前缀（syncCode / parseSyncCode 的 prefix）都是参数，不写死。
//   picknest.json = { app:'picknest', v:1, device, savedAt, state }   state 是整份数据（data、settings、settingsAt）：没有令牌，也没有本机设置
//   images/<sha256>.jpg   食谱的成品图（第 12 步，照 babble 的录音）：按内容的哈希命名，只增不改（换图是另一个文件，删图只是记录上没了，
//                         仓库里的文件和提交历史还在）。每一轮在拉取之后、上传 picknest.json 之前，先传本机有、还没传到这个仓库、
//                         有食谱用着的图（没有食谱用着的不传：编辑页里加了又放弃的）——别的设备拿到 JSON 时图已经在了。
//                         先 GET 看在不在（git blob sha 一样就不传），不在才 PUT；409 / 422 不当成功，重新 GET 再定。传之前、下载以后都核对 sha256。
//                         上传 picknest.json 之前再看一眼那份数据：传图期间又存了带新图的食谱，先把那几张传了（传上去的 JSON 里的图都看过）。
//                         本机缺的图：一轮成功以后在后台按「改得晚的食谱在前」下载，页面正看着的马上下载（getBlob）；云端还没有的 5 分钟内不再问；
//                         本机存不下的（空间满了）留在内存里，后台先停下，不一轮一轮重下
// 每一轮：确认仓库是私有的（5 分钟内确认过就不再问；要新建文件时一定再问）→ 先拉取、逐条合并（两边都 normalizeState，mergeStates，
// ensureSeeds，交给 applyRemote 保存）→ 本机有云端没有的改动才上传（带着云端版本号 sha；别的设备抢先改过会返回 409 / 422，
// 就重新拉取、合并再传，最多 4 次，中间等一小会儿、带点随机，免得两台设备一直撞在一起）。
// 切到后台时（pushFirst）：已经知道云端版本、本机有改动，就直接上传，不先拉取——少一个来回，页面随时可能被系统挂起；云端变过照样 409 → 合并再传。
// ETag 只在真的合并成功以后才记（不然以后的 304 会把没合并进来的那一版挡在外面）；文件超过 1 MB 时 contents API 不给内容，再用 raw 格式取原文。
// 同一时间只跑一轮（一条 promise 队列；切到后台的直接上传先打断正在跑的那一轮）；本机修改计数（editVersion）在上传期间变了，上传完仍算有改动。
// 请求太多（429、403 + 剩余 0）是暂时的：报 rate，带着能再试的时刻（app 在那之前不自动同步），不当成令牌或权限问题。
import { normalizeState, mergeStates, ensureSeeds, canon, fileProblem } from './store.js';
import { isObj, str } from './util.js';
import { sha256Hex } from './sha256.js';
import { photoPath, recipePhotos, SHA_RE, PHOTO_MIME } from './photo.js';

/** @typedef {import('./store.js').State} State */
/**
 * 本机设置 picknest.local 里的 sync（只在这台设备上，不进备份、不同步）
 * @typedef {{ repo: string, token: string, sha?: string | null, etag?: string | null, dirty?: boolean, at?: number | null,
 *   err?: { code: string, vars?: Record<string, any>, message?: string } | null, offline?: boolean, tokenExp?: number | null }} SyncConfig
 */
/** @typedef {{ ok: boolean, skipped?: boolean, error?: SyncConfig['err'], offline?: boolean }} RoundResult */
/** @typedef {{ pushFirst?: boolean, keepalive?: boolean }} RoundOptions */
/**
 * 同步现在在做什么（status()）：running 正在跑一轮；uploading / downloading 正在传 / 下载图片，pendingUp / pendingDown 还剩几张；
 * blobErr 最近一次图片没传上 / 没下载成 / 本机存不下（blobUp / shaMismatch / blobDown / blobFull；不算同步出错：文字照常同步，下一轮再试）
 * @typedef {{ running: boolean, uploading: boolean, downloading: boolean, pendingUp: number, pendingDown: number,
 *   blobErr: { code: string, vars?: Record<string, any> } | null }} SyncStatus
 */

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
const BLOB_TRIES = 3;                         // 一张图：GET → PUT 最多来回几次（409 / 422、回应对不上时重新 GET）
const BLOB_PASSES = 3;                        // 上传 picknest.json 之前，为这期间新加的图最多再传几趟（一直在加图的话不能一直不传文字）
const MISSING_RETRY_MS = 5 * 60 * 1000;       // 云端还没有的图（那台设备还没传上来）：后台 5 分钟内不再问
const DOWNLOAD_MS = 2 * 60 * 1000;            // 下载一张图最多等多久（连读完内容）
// 图片上传、下载碰到这些就停下（文字同步一样会碰到、会报）：断网、令牌、权限、仓库不在了 / 公开了、请求太多、这一轮被打断
const BLOB_STOP = ['net', 'auth', 'perm', 'notfound', 'public', 'rate', 'aborted'];

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

/**
 * git 的 blob sha（sha1("blob <长度>\0" + 内容)）：GitHub 返回的 sha 就是它，用来确认云端的图和本机的一模一样。
 * 没有 crypto.subtle（局域网 http 打开）→ null，这时只比大小
 * @param {Uint8Array} bytes @returns {Promise<string | null>}
 */
export async function gitBlobSha(bytes) {
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (!subtle) return null;
  const head = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const buf = new Uint8Array(head.length + bytes.length);
  buf.set(head); buf.set(bytes, head.length);
  const h = await subtle.digest('SHA-1', buf);
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
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
 * @param {(status: SyncStatus) => void} [o.onStatus]   开始、结束一轮，图片传、下载的进度变了时调用
 * @param {import('./blobStore.js').BlobStore | null} [o.blobs]   本机的图片库（core/blobStore.js）；没有就只同步文字
 * @param {(sha: string) => void} [o.onBlob]            下载好一张图、存进本机了（页面上「正在下载」的那张可以换成图了）
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
  let round = 0, checkedRound = -1;           // 第几轮、哪一轮真的问过仓库是不是私有的（传图之前这一轮一定要问过一次）
  const blobs = o.blobs || null;
  /** @type {SyncStatus} */
  const st = { running: false, uploading: false, downloading: false, pendingUp: 0, pendingDown: 0, blobErr: null };
  // 图片的问题上传、下载各记各的（blobErr 先说上传的）：谁也不会把对方的清掉，也不会一直留着对方已经好了的
  /** @type {SyncStatus['blobErr']} */
  let upErr = null, dnErr = null, upRoundErr = null;
  const blobErrNow = () => upErr || dnErr;
  // 这一轮看过的图（传了、没传上、云端本来就有、本机没有的）和没传上的：每一轮从头记（一轮一轮是排着队跑的，不会两轮同时改）
  let upSeen = new Set(), upFailed = new Set();
  /** @type {AbortController | null} */
  let current = null;                          // 正在跑的这一轮：切到后台要直接上传时打断它（见 syncNow）
  const changed = (/** @type {Partial<SyncStatus>} */ patch) => {
    // 没变的不通知（后台下载每一轮都会来看一下，没有缺的图时不该让设置页跟着重画）
    if (Object.keys(patch).every(k => /** @type {any} */ (st)[k] === /** @type {any} */ (patch)[k])) return;
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
    verified = cfg.repo; verifiedAt = t0; checkedRound = round;
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
      // 传图的时候、409 等一下重新拉取的时候又存了带新图的食谱：先把这些图传了。查完到下面取数据、编进请求之间不再等别的，
      // 传上去的这份里的图一定都看过了（不然别的设备拿到的记录指着仓库里还没有的图）
      for (let k = 0; k < BLOB_PASSES && unseenPhotos(); k++) {
        await uploadBlobs(cfg);
        if (stopped(cfg)) return;
      }
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

  // ---------- 图片上传 ----------
  /** @param {SyncConfig} cfg @param {string} p */
  const pathOf = (cfg, p) => `/repos/${cfg.repo}/contents/${p}`;
  /** 读 JSON，读不出来当没有（只用来核对 sha） @param {any} r */
  const jsonOrNull = async (r) => { try { return await r.json(); } catch (e) { return null; } };

  /**
   * 传一张图：先 GET 看云端有没有（内容一样就只记下「已经在这个仓库里」）；没有才 PUT。PUT 返回 409 / 422 不当成功（可能是别的设备刚传了同一张，
   * 也可能是同时提交撞了），回到开头重新 GET 再定。本机这一份和 sha256 对不上（坏了）→ shaMismatch，不传
   * @param {SyncConfig} cfg @param {string} sha @param {string} mime
   */
  async function uploadBlob(cfg, sha, mime) {
    const rec = blobs && await blobs.getBlob(sha);
    if (!rec || !rec.blob) return;
    const bytes = new Uint8Array(await rec.blob.arrayBuffer());
    if (await sha256Hex(bytes) !== sha) throw new SyncError('shaMismatch');
    const path = pathOf(cfg, photoPath(sha, mime));
    const blobSha = await gitBlobSha(bytes);
    const same = (/** @type {any} */ info) => isObj(info) && (blobSha ? info.sha === blobSha : info.size === bytes.length);
    let content = null;
    for (let i = 0; i < BLOB_TRIES; i++) {
      const r = await gh(cfg, 'GET', path, { accept: ACCEPT_OBJ });
      let remoteSha = null;
      if (r.ok) {
        const j = await jsonOrNull(r);
        if (same(j)) { await blobs.markUploaded(sha, cfg.repo); return; }          // 已经在云端，内容一样
        remoteSha = (isObj(j) && j.sha) || null;                                      // 在，但内容不对（以前传坏了）：覆盖
      } else if (r.status !== 404) throw httpError(r);
      content = content || bytesToB64(bytes);
      /** @type {{ message: string, content: string, sha?: string }} */
      const body = { message: `添加图片 ${sha.slice(0, 8)}（${device()}）`, content };
      if (remoteSha) body.sha = remoteSha;
      const p = await gh(cfg, 'PUT', path, { body, timeout: 60000 + Math.round(content.length / 20) });   // 按 20 KB/s 估上传时间
      if (p.ok) {
        const j = await jsonOrNull(p);
        if (isObj(j) && same(j.content)) { await blobs.markUploaded(sha, cfg.repo); return; }
        continue;                                    // 回应对不上：再 GET 一次确认
      }
      if (p.status !== 409 && p.status !== 422) throw httpError(p);
    }
    throw new SyncError('blobUp');
  }

  /**
   * 传本机有、还没传到这个仓库、有食谱用着的图（删掉的食谱的也传：别的设备可能从「最近删除」里恢复；没有食谱用着的不传）。
   * 一张传不上（不是断网、令牌这些）先跳过，文字照常同步、下一轮再试；本机的图片库打不开（无痕浏览、存储出错）也只是不传图。
   * 一轮里可能来几次（push 发现要传的那份数据里有这一轮还没看过的图）：每次只看还没看过的（upSeen），没传上的记在 upFailed
   * @param {SyncConfig} cfg
   */
  async function uploadBlobs(cfg) {
    if (!blobs) return;
    const refs = recipePhotos(o.getState(), { includeDeleted: true });
    const fresh = new Set([...refs.keys()].filter(s => !upSeen.has(s)));
    for (const s of fresh) upSeen.add(s);
    let left = 0;                                    // 这一次还没传完的（被打断时还算没传）
    const finish = () => { upErr = upRoundErr; changed({ uploading: false, pendingUp: upFailed.size + left, blobErr: blobErrNow() }); };
    // 没有新的要看（包括一张图都没有了：上次没传上的那张已经被删了，不能一直写着「还有 1 张没上传」）
    if (!fresh.size) { finish(); return; }
    /** @type {import('./blobStore.js').BlobMeta[]} */
    let todo;
    try { todo = (await blobs.pendingUploads(cfg.repo)).filter(b => fresh.has(b.sha256)); }
    catch (e) { upRoundErr = { code: 'blobUp', vars: {} }; finish(); return; }
    if (!todo.length) { finish(); return; }
    left = todo.length;
    changed({ pendingUp: upFailed.size + left, uploading: true });
    try {
      if (checkedRound !== round) await ensurePrivate(cfg, true);   // 传图之前这一轮一定确认过一次（5 分钟里仓库也可能被改成公开的）
      for (const b of todo) {
        if (stopped(cfg)) return;
        // 列表是开始时算的：传的过程中这张图没有食谱用了（换了图、合并进来了别的）就不传
        if (recipePhotos(o.getState(), { includeDeleted: true }).has(b.sha256)) {
          try {
            await uploadBlob(cfg, b.sha256, refs.get(b.sha256) || b.mime);
          } catch (e) {
            const code = e instanceof SyncError ? e.code : '';
            if (code === 'net') {                    // 断网 / 大图传超时：这一轮不再传图，真断网的话上传 picknest.json 时会报离线
              upRoundErr = { code: 'blobUp', vars: {} };
              for (const x of todo.slice(todo.indexOf(b))) upFailed.add(x.sha256);
              left = 0;
              break;
            }
            if (BLOB_STOP.includes(code)) throw e;
            upFailed.add(b.sha256);                  // 这张先跳过
            upRoundErr = { code: code === 'shaMismatch' ? 'shaMismatch' : 'blobUp', vars: (e instanceof SyncError && e.vars) || {} };
          }
        }
        left--;
        changed({ pendingUp: upFailed.size + left });
      }
    } finally {
      finish();
    }
  }
  /** 要传的这份数据里有这一轮还没看过的图（传图的时候、409 重新拉取以后又存了带新图的食谱） */
  const unseenPhotos = () => !!blobs && [...recipePhotos(o.getState(), { includeDeleted: true }).keys()].some(s => !upSeen.has(s));

  // ---------- 图片下载 ----------
  /** @type {Map<string, Promise<Blob | null>>} */
  const inflight = new Map();     // sha → 正在下载的：同一张图同时只下载一次
  /** @type {Map<string, number>} */
  const missingAt = new Map();    // sha → 云端没有（404）的时刻
  // 已经知道本机有的：图只增不改，有食谱用着的不会被删（编辑页只删没有食谱用着的），不用每一轮都去问一遍 IndexedDB
  const haveLocal = new Set();
  // 下载下来了、本机存不下的（存储空间满了、存储出错）：这次打开期间照样给页面看，不再重下。
  // storeFull 时后台不再下载新的（下了也存不下，每一轮把所有的图白下一遍）：每一趟拿内存里的一张试着存（不联网），存上了就接着下
  /** @type {Map<string, Blob>} */
  const memBlobs = new Map();
  let storeFull = false;
  // 后台这一趟还要下载的：pendingDown 就是它有几张（页面先下好了的也从这里拿掉：同一张不减两次）
  let dlLeft = new Set();
  const doneDown = (/** @type {string} */ sha) => { if (dlLeft.delete(sha)) changed({ pendingDown: dlLeft.size }); };
  const FULL = () => ({ code: 'blobFull', vars: {} });
  let dlWanted = false;
  /** @type {Promise<void> | null} */
  let dlLoop = null;

  /** 取原文（raw）：404 → null。不属于一轮同步（切到后台的直接上传不打断它）；连读完内容一起限时 @param {SyncConfig} cfg @param {string} path */
  async function getBytes(cfg, path) {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), DOWNLOAD_MS);
    try {
      const r = await doFetch(GH_API + path, { method: 'GET', headers: headers(cfg.token, ACCEPT_RAW), cache: 'no-store', signal: ctl.signal });
      if (r.status === 404) return null;
      if (!r.ok) throw httpError(r);
      return new Uint8Array(await r.arrayBuffer());
    } catch (e) {
      throw e instanceof SyncError ? e : new SyncError('net');
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 下载一张、核对 sha256、存进本机（记下它在这个仓库里，不用再传）→ Blob；云端还没有 → null。
   * 内存里已经有（上次存不下）的不再下载，只再试着存一次
   * @param {SyncConfig} cfg @param {string} sha @param {string} mime
   */
  function fetchBlob(cfg, sha, mime) {
    const had = inflight.get(sha);
    if (had) return had;
    const p = (async () => {
      const have = await blobs.getBlob(sha).catch(() => null);
      if (have && have.blob) return have.blob;
      let blob = memBlobs.get(sha) || null;
      if (!blob) {
        const bytes = await getBytes(cfg, pathOf(cfg, photoPath(sha, mime)));
        if (!bytes) { missingAt.set(sha, Date.now()); return null; }        // 那台设备还没传上来
        missingAt.delete(sha);
        if (await sha256Hex(bytes) !== sha) throw new SyncError('shaMismatch');   // 下载坏了、文件被改过：不收，下次重下
        blob = new Blob([bytes], { type: mime });
      }
      try { await blobs.putBlob(blob, { mime, uploaded: cfg.repo }); }
      catch (e) {
        // 存不下：留在内存里，这一次照样给页面看；设置 → 多设备同步里说这台设备存不下了
        memBlobs.set(sha, blob);
        storeFull = true;
        dnErr = FULL();
        changed({ blobErr: blobErrNow() });
        return blob;
      }
      memBlobs.delete(sha);
      if (storeFull) { storeFull = false; if (dnErr && dnErr.code === 'blobFull') { dnErr = null; changed({ blobErr: blobErrNow() }); } }
      haveLocal.add(sha);
      if (o.onBlob) { try { o.onBlob(sha); } catch (e) { /* 界面出错不影响同步 */ } }
      return blob;
    })().finally(() => inflight.delete(sha));
    inflight.set(sha, p);
    return p;
  }

  /** 没删除的食谱用着、本机没有的图（改得晚的食谱的在前） → [sha, mime][] */
  async function missingBlobs() {
    const out = [];
    for (const [sha, mime] of recipePhotos(o.getState())) {
      if (haveLocal.has(sha)) continue;
      if (await blobs.hasBlob(sha)) haveLocal.add(sha); else out.push([sha, mime]);
    }
    return out;
  }
  /** 云端刚问过没有（5 分钟内）：那台设备上次没传上，要等它下一次同步 @param {string} sha */
  const recentlyMissing = (sha) => { const m = missingAt.get(sha); return !!m && Date.now() - m < MISSING_RETRY_MS; };

  /** 后台一张一张下载本机缺的图；下载期间又要了（又同步了一轮）就从头再看一遍 */
  async function downloadLoop() {
    /** @type {SyncStatus['blobErr']} */
    let err = null;
    try {
      while (dlWanted) {
        dlWanted = false;
        err = null;
        const cfg = o.getConfig();
        if (!cfg || tokenProblem(cfg.token)) return;
        const todo = (await missingBlobs()).filter(([sha]) => !recentlyMissing(sha));
        dlLeft = new Set(todo.map(([sha]) => sha));
        changed({ pendingDown: dlLeft.size, downloading: dlLeft.size > 0 });
        let probed = false;                          // 存不下时这一趟已经拿内存里的一张试过了
        for (const [sha, mime] of todo) {
          if (!dlLeft.has(sha)) continue;            // 页面要看，已经先下好了
          const cur = o.getConfig();
          if (!cur || cur.repo !== cfg.repo || cur.token !== cfg.token) return;   // 停止同步、换了仓库或令牌
          if (storeFull) {
            if (probed || !memBlobs.has(sha)) continue;
            probed = true;
          }
          try {
            const blob = await fetchBlob(cur, sha, mime);
            if (memBlobs.has(sha)) probed = true;    // 下下来了，存不下
            else if (blob) doneDown(sha);
          } catch (e) {
            if (e instanceof SyncError && BLOB_STOP.includes(e.code)) return;     // 离线、令牌问题：文字同步会报，这里先停
            err = { code: e instanceof SyncError && e.code === 'shaMismatch' ? 'shaMismatch' : 'blobDown', vars: {} };
          }
        }
        if (storeFull) err = FULL();
      }
    } catch (e) {
      err = { code: 'blobDown', vars: {} };        // 本机的图片库打不开
    } finally {
      dnErr = err;
      changed({ downloading: false, blobErr: blobErrNow() });
    }
  }
  /** 在后台下载本机缺的图（一轮同步成功以后） */
  function kickDownloads() {
    if (!blobs) return;
    if (!recipePhotos(o.getState()).size) {
      // 没有要下载的了（有图的食谱都删了、图都删了）：上次没下载成的不再提
      if (!dlLoop) { dlLeft = new Set(); dnErr = null; changed({ pendingDown: 0, blobErr: blobErrNow() }); }
      return;
    }
    dlWanted = true;
    if (!dlLoop) dlLoop = downloadLoop().catch(() => {}).finally(() => { dlLoop = null; });
  }

  /**
   * 页面要看的图：本机有就直接给；没有就马上下载（不排队），核对 sha256 后存进本机（存不下的这次打开期间留在内存里）。
   * 没开同步、云端也没有、5 分钟内问过云端还没有 → null（每次打开都问一遍的话，大图的位置也一会儿大一会儿小；那台设备下次同步传上来以后，
   * 后台下载好了会发 onBlob）；下载出错照样抛（页面显示「这台设备上没有这张图」）
   * @param {string} sha @returns {Promise<Blob | null>}
   */
  async function getBlob(sha) {
    sha = str(sha).toLowerCase();
    if (!blobs || !SHA_RE.test(sha)) return null;
    const have = await blobs.getBlob(sha).catch(() => null);
    if (have && have.blob) return have.blob;
    const mem = memBlobs.get(sha);
    if (mem) return mem;
    const cfg = o.getConfig();
    if (!cfg || tokenProblem(cfg.token) || recentlyMissing(sha)) return null;
    const blob = await fetchBlob(cfg, sha, recipePhotos(o.getState(), { includeDeleted: true }).get(sha) || PHOTO_MIME);
    if (blob && !memBlobs.has(sha)) doneDown(sha);
    return blob;
  }

  // ---------- 一轮同步 ----------
  /** @param {RoundOptions} [opts] @returns {Promise<RoundResult>} */
  async function run(opts = {}) {
    const cfg = o.getConfig();
    if (!cfg) return { ok: true, skipped: true };
    const ctl = current = new AbortController();
    round++;
    upSeen = new Set(); upFailed = new Set(); upRoundErr = null;
    changed({ running: true });
    try {
      const bad = tokenProblem(cfg.token);
      if (bad) throw new SyncError(bad);           // 不是 Fine-grained 令牌（经典令牌能动整个账号）：不用它发任何请求
      const direct = !!(opts.pushFirst && cfg.sha && cfg.dirty);
      await ensurePrivate(cfg, false, direct ? PUSH_VERIFY_MS : VERIFY_MS);
      // 先传图、再传 picknest.json：别的设备看到食谱上的图时，图已经在云端了。切到后台的直接上传也一样（图大，用不了 keepalive，
      // 页面被挂起的话这一次 JSON 也不传，留到下次：宁可晚一点，也不让别的设备拿到指着不存在的图的记录）
      if (direct) {
        await uploadBlobs(cfg);
        if (stopped(cfg)) return { ok: false, skipped: true };
        await push(cfg, opts);
      } else {
        await pull(cfg, opts);                       // 先合并：别的设备换掉了的图，这一轮就不传了
        if (stopped(cfg)) return { ok: false, skipped: true };
        await uploadBlobs(cfg);
        if (stopped(cfg)) return { ok: false, skipped: true };
        if (cfg.dirty) await push(cfg, opts);
      }
      if (stopped(cfg)) return { ok: false, skipped: true };
      cfg.at = Date.now();
      cfg.offline = false;
      cfg.err = null;
      if (!direct) kickDownloads();                 // 本机缺的图在后台下载（切到后台时不下）
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

  /** 等后台下载做完（测试用） */
  async function downloadsIdle() { while (dlLoop) await dlLoop; }

  return { syncNow, checkRepo, readRemote, idle, getBlob, kickDownloads, downloadsIdle, status: () => ({ ...st }) };
}
