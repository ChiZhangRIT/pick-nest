// @ts-check
// 食谱的成品图（第 12 步）里不碰 DOM 的部分：压缩到多大（fitSize）、一步步缩小的每一步（resizeSteps）、仓库里的文件名（photoPath）、
// 哪些图有食谱在用（recipePhotos：上传、后台下载按它；photoInUse：编辑页放弃时能不能删掉刚加的那张）、占了多少地方怎么写（fmtBytes）。
// 解码、画到 canvas、编成 JPEG 在 ui/photo.js（要浏览器）；图片本身存在 core/blobStore.js，同步在 core/sync.js。
// recipe.photo 的整理（normalizePhoto）在 store.js，和别的字段的整理放在一起。
import { isObj, own } from './util.js';
import { extForMime } from './blobStore.js';

/** @typedef {import('./store.js').State} State */
/** @typedef {import('./store.js').Photo} Photo */

/** 长边最多多少像素：手机上整屏看够清楚，一张 JPEG 大约 200–500 KB（同步仓库、本机空间都不大） */
export const PHOTO_MAX = 1600;
/** JPEG 质量：0.82 看不出压缩的痕迹，比 0.92 小一半左右 */
export const PHOTO_QUALITY = 0.82;
export const PHOTO_MIME = 'image/jpeg';
/** 选来的图片太大（解码出来几百 MB）的不收：一张 1 亿像素的图在 iPhone 上会直接把页面弄崩 */
export const PHOTO_MAX_PIXELS = 100e6;

export const SHA_RE = /^[0-9a-f]{64}$/;

/**
 * 压缩后的尺寸：长边超过 max 时等比缩到 max（四舍五入到整像素，最小 1），不放大；宽高认不出 → null
 * @param {number} w @param {number} h @param {number} [max] @returns {{ w: number, h: number } | null}
 */
export function fitSize(w, h, max = PHOTO_MAX) {
  if (!(Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0)) return null;
  const s = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

/**
 * 从原图缩到目标大小的每一步（最后一步就是目标）：一次缩小超过一半时，浏览器（尤其 Safari）的 drawImage 只取很少几个像素，
 * 细节（米粒、葱花）会变成锯齿和摩尔纹；每次最多缩一半，最后一步正好到目标。第一步就比原图小一半，大照片也不用开一张原图那么大的 canvas
 * （iOS 的 canvas 最大约 1670 万像素，2400 万像素的照片放不下）
 * @param {number} w @param {number} h @param {number} tw @param {number} th @returns {{ w: number, h: number }[]}
 */
export function resizeSteps(w, h, tw, th) {
  const steps = [];
  let cw = w, ch = h;
  while (cw / 2 > tw && ch / 2 > th) {
    cw = Math.round(cw / 2); ch = Math.round(ch / 2);
    steps.push({ w: cw, h: ch });
  }
  steps.push({ w: tw, h: th });
  return steps;
}

/** 仓库里的路径：images/<sha256>.<扩展名>（按内容命名：同一张图只传一次，换图是另一个文件） @param {string} sha @param {unknown} [mime] */
export const photoPath = (sha, mime) => `images/${sha}.${extForMime(mime || PHOTO_MIME)}`;

/** @param {State} state */
const recipesOf = (state) => (isObj(own(state && state.data, 'recipes')) ? Object.values(state.data.recipes) : []);

/**
 * 有食谱在用的图：sha256 → mime，改得晚的食谱的图在前（后台下载先下新的）。
 * includeDeleted：删掉的食谱（在「最近删除」里，能恢复）的也算——上传时要算：在这台设备上删了、别的设备恢复了，图得在云端；后台下载不算（不为看不到的食谱占流量）
 * @param {State} state @param {{ includeDeleted?: boolean }} [opts] @returns {Map<string, string>}
 */
export function recipePhotos(state, { includeDeleted = false } = {}) {
  const list = recipesOf(state).filter(r => isObj(r) && isObj(r.photo) && typeof r.photo.sha256 === 'string' && SHA_RE.test(r.photo.sha256) && (includeDeleted || !r.deleted));
  list.sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));
  /** @type {Map<string, string>} */
  const out = new Map();
  for (const r of list) if (!out.has(r.photo.sha256)) out.set(r.photo.sha256, typeof r.photo.mime === 'string' && r.photo.mime ? r.photo.mime : PHOTO_MIME);
  return out;
}

/** 有没有哪道食谱（删掉了的也算）用着这张图 @param {State} state @param {string} sha */
export const photoInUse = (state, sha) => recipePhotos(state, { includeDeleted: true }).has(sha);

/**
 * 占了多少地方：不到 1 MB 写 KB（至少 1 KB），10 MB 以下一位小数，再大写整数。三种语言都写 KB / MB（中文界面里也这么写）
 * @param {number} bytes
 */
export function fmtBytes(bytes) {
  const n = Number(bytes) > 0 ? Number(bytes) : 0;
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  const mb = n / (1024 * 1024);
  return `${mb < 10 ? Math.round(mb * 10) / 10 : Math.round(mb)} MB`;
}
