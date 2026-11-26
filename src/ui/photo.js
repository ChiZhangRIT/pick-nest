// 成品图（第 12 步）在页面上的部分：
//   encodePhoto(file)  选来的图片 → 长边最多 1600 px 的 JPEG（解码：<img>，Safari 认得的 HEIC 也行，按 EXIF 的方向摆正——浏览器自己会转；
//                      不行再试 createImageBitmap；缩小用 core/photo.js 的 fitSize / resizeSteps 一次最多缩一半；透明的底铺白，JPEG 没有透明）
//   photoPool(ctx, root)  一个页面一个：sha → object URL（这个页面期间同一张图只建一次，重画不闪），页面清理时全部 revoke；
//                      view(photo) 画一张：本机有马上显示；没有的话，用户正看着的那一张（有 alt：大图、编辑页的预览）开着同步时
//                      马上下载（大图写「正在下载图片…」），下载好了换成图；卡片、计划里的小图（装饰）只用本机的，不下载——一页几十张同时下载
//                      会挤掉正看着的那张大图，后台按「改得晚的在前」一张一张下。拿不到（没开同步、云端也没有、下载出错）→ 安安静静的占位
//                      （大图写「这台设备上没有这张图」，是矮矮的一条）。后台下载好了（ctx.on('photo')）把这个页面上还空着的那几张换成图
// 不拼 HTML；用户的图只经过 Blob / object URL（CSP 的 img-src 要有 blob:）。
import { h, icon } from './dom.js';
import { t } from '../i18n.js';
import { fitSize, resizeSteps, PHOTO_MIME, PHOTO_QUALITY, PHOTO_MAX_PIXELS } from '../core/photo.js';

/** 图片没处理成：decode 打不开（格式不认识、文件坏了）、encode 编不出 JPEG（内存不够、canvas 太大） */
export class PhotoError extends Error {
  /** @param {'decode' | 'encode'} code */
  constructor(code) { super(code); this.code = code; }
}

/** 解码成能画到 canvas 上的 → { source, w, h, close } */
async function decodeImage(file) {
  // <img> 先：Safari 认得的格式（HEIC）它都认得，EXIF 的方向浏览器自己摆正（image-orientation 默认 from-image，drawImage 也按摆正的画）。
  // 只等 onload，不用 img.decode()：iOS 上大图偶尔 decode() 报 EncodingError，图其实是好的
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = url; });
    if (!img.naturalWidth || !img.naturalHeight) throw new Error('empty');
    return { source: img, w: img.naturalWidth, h: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (e) {
    URL.revokeObjectURL(url);
  }
  if (typeof createImageBitmap === 'function') {
    try {
      const b = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: b, w: b.width, h: b.height, close: () => b.close() };
    } catch (e) { /* 也打不开 */ }
  }
  throw new PhotoError('decode');
}

/** 一步步缩小、编成 JPEG → Blob（浏览器编不出 JPEG 时 toBlob 给 PNG，类型照 Blob 自己的） */
async function drawJpeg(source, sw, sh, size) {
  let src = source;
  let first = true;
  for (const step of resizeSteps(sw, sh, size.w, size.h)) {
    const c = document.createElement('canvas');
    c.width = step.w; c.height = step.h;
    const g = c.getContext('2d');
    if (!g) throw new PhotoError('encode');
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    if (first) { g.fillStyle = '#fff'; g.fillRect(0, 0, step.w, step.h); first = false; }   // 透明的 PNG 编成 JPEG 会变黑底
    g.drawImage(src, 0, 0, step.w, step.h);
    if (src !== source) { src.width = 0; src.height = 0; }   // 马上放掉上一步的 canvas：iOS 所有 canvas 加起来的内存有上限
    src = c;
  }
  const blob = await new Promise(resolve => { try { src.toBlob(resolve, PHOTO_MIME, PHOTO_QUALITY); } catch (e) { resolve(null); } });
  src.width = 0; src.height = 0;
  if (!blob || !blob.size) throw new PhotoError('encode');
  return blob;
}

/**
 * 选来的图片 → { blob（JPEG）, w, h }。deps 测试用：decode(file) → { source, w, h, close? }、draw(source, w, h, size) → Blob
 * @param {Blob} file @param {{ decode?: Function, draw?: Function }} [deps]
 */
export async function encodePhoto(file, { decode = decodeImage, draw = drawJpeg } = {}) {
  const img = await decode(file);
  try {
    const size = fitSize(img.w, img.h);
    if (!size) throw new PhotoError('decode');
    // <img> 的 onload 只读了文件头，第一次 drawImage 才整张解码（每像素 4 字节）：太大的在这之前就不收，不然 iPhone 上整个页面直接崩掉
    if (img.w * img.h > PHOTO_MAX_PIXELS) throw new PhotoError('encode');
    const blob = await draw(img.source, img.w, img.h, size);
    if (!blob || !blob.size) throw new PhotoError('encode');
    return { blob, w: size.w, h: size.h };
  } finally {
    try { if (img.close) img.close(); } catch (e) { /* 已经放掉了 */ }
  }
}

// 这次打开 App 期间知道拿不到的图（所有页面共用）：再打开这道食谱时大图直接是矮矮的一条，不先占一大块再缩回去（按钮跟着往上跳）。
// 拿到了（下载好了、后台下好了）就拿掉
const knownMissing = new Set();

/**
 * 一个页面的图：root 是这个页面的容器（后台下载好了找里面还空着的那几张）。
 * ctx.photos 没有（测试的假 ctx、旧的页面）时只画占位
 */
export function photoPool(ctx, root) {
  const api = ctx.photos || null;
  const urls = new Map();          // sha → object URL
  const loading = new Map();       // sha → Promise
  const missing = new Set();       // 这次拿不到的（后台下载好了再试）
  const fetching = new Set();      // 正在从云端下载的（大图写「正在下载图片…」）
  const opts = new WeakMap();      // 元素 → 画法
  let dead = false;
  const off = ctx.on ? ctx.on('photo', (sha) => { if (missing.delete(sha)) { load(sha, false); repaint(sha); } }) : null;

  /** @param {string} sha @param {boolean} now 本机没有时马上从同步仓库下载（用户正看着的那一张） */
  function load(sha, now) {
    if (loading.has(sha) || urls.has(sha)) return;
    const p = (async () => {
      let blob = api ? await api.local(sha) : null;
      if (!blob && now && api && api.canFetch()) {
        fetching.add(sha);
        repaint(sha);
        try { blob = await api.fetch(sha); } finally { fetching.delete(sha); }
      }
      if (dead) return;
      if (blob) { urls.set(sha, URL.createObjectURL(blob)); knownMissing.delete(sha); }
      else { missing.add(sha); if (now) knownMissing.add(sha); }
    })().catch(() => { missing.add(sha); if (now) knownMissing.add(sha); }).finally(() => { loading.delete(sha); if (!dead) repaint(sha); });
    loading.set(sha, p);
  }
  /** 这个页面上画着这张图的（重画过的话是新的元素）都换成现在的样子 */
  function repaint(sha) {
    if (!root) return;
    for (const el of root.querySelectorAll(`[data-sha="${sha}"]`)) if (opts.has(el)) paint(el, sha, opts.get(el));
  }
  /** 现在算不算拿不到：这个页面问过了没有；还在问的大图，这次打开 App 期间已经知道拿不到的也先当成没有（拿到了再换成图） */
  const absent = (sha, o) => missing.has(sha) || (!!o.hero && loading.has(sha) && knownMissing.has(sha));
  function paint(el, sha, o) {
    const url = urls.get(sha);
    const gone = !url && absent(sha, o);
    el.classList.toggle('is-missing', gone);
    el.classList.toggle('is-loading', !url && !gone);
    if (url) {
      const img = h('img', { src: url, alt: o.alt || '', decoding: 'async', loading: o.hero ? null : 'lazy', width: o.w || null, height: o.h || null,
        // 存着的图坏了（读不出来）：当成没有
        onerror: () => { el.classList.add('is-missing'); el.replaceChildren(...placeholder(o, 'missing')); } });
      el.replaceChildren(img);
      return;
    }
    el.replaceChildren(...placeholder(o, gone ? 'missing' : fetching.has(sha) ? 'fetching' : 'loading'));
  }
  function placeholder(o, kind) {
    // 小图只有一个淡淡的图标；大图写一句（读屏按顺序读到，不用 live region：打开一道没有图的食谱不该先插一句话）。
    // 本机读一下很快，那一瞬间不写字（不闪一下「正在下载」）。编辑页的预览（有 alt、不是大图）读屏念 alt：知道这里有一张图
    const text = !o.hero ? '' : kind === 'missing' ? t('rcp.photo.missing') : kind === 'fetching' ? t('rcp.photo.loading') : '';
    return [icon('photo', { cls: 'photo-ic' }), text ? h('span.photo-msg', null, text) : !o.hero && o.alt ? h('span.sr-only', null, o.alt) : null].filter(Boolean);
  }

  return {
    /**
     * 画一张图 → 元素（.photo + cls）。o：{ cls, alt, hero }。
     * alt：用户正看着的那一张给（大图、编辑页的预览：「「红烧肉」的成品图」），本机没有时马上下载；
     * 不给的是装饰（卡片、计划里的小图，名字旁边写着）：读屏不念，本机没有的只等后台下载
     * @param {{ sha256: string, w?: number | null, h?: number | null }} photo
     */
    view(photo, o = {}) {
      const sha = photo.sha256;
      const el = h('div.photo' + (o.cls || '') + (o.hero ? '.photo-hero' : ''), { dataset: { sha }, 'aria-hidden': o.alt ? null : 'true',
        style: o.hero && photo.w && photo.h ? { aspectRatio: `${photo.w} / ${photo.h}` } : null });
      const oo = { ...o, w: photo.w, h: photo.h };
      opts.set(el, oo);
      if (!urls.has(sha) && !missing.has(sha)) load(sha, !!o.alt);
      paint(el, sha, oo);
      return el;
    },
    /** 页面清理时：放掉所有 object URL，不再听后台下载 */
    revoke() {
      dead = true;
      for (const u of urls.values()) { try { URL.revokeObjectURL(u); } catch (e) { /* 已经放掉了 */ } }
      urls.clear();
      if (off) off();
    },
  };
}
