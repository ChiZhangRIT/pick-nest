// 测试用的假 GitHub（不联网、不碰真的仓库和令牌）：sync.test.mjs 和整个 App 的同步测试共用。
// GET /repos/me/data（private 可以改成公开的）、contents API（文件、git blob sha、ETag / 304、409（sha 过期）、
// 422（文件已经有了却没给 sha）、带 sha 却没有文件 → 404、超过 gh.big 字节只给 sha 不给内容（要 raw 才给原文））；
// gh.faults 让某个请求出错一次（断网、某个状态码、带响应头），gh.onPut 在 PUT 落地之前插一手（模拟上传期间别的设备、本机又改了）。
// 成品图（第 12 步）也走 contents API：images/<sha256>.jpg 和 picknest.json 一样存在 gh.files 里，raw 格式给原文（arrayBuffer）。
// 认的令牌只有编出来的 github_pat_test。
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { blankState, ensureSeeds } from '../../src/core/store.js';

export const DATA = 'picknest.json';
const blobSha = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
export const enc = s => new TextEncoder().encode(s);
export const dec = b => new TextDecoder().decode(b);

export function mockGitHub({ big = Infinity } = {}) {
  const gh = { log: [], opts: [], puts: 0, n304: 0, private: true, visibility: undefined, faults: [], files: new Map(), big, onPut: null };
  const res = (status, body, headers = {}) => {
    const hs = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    const bytes = body instanceof Uint8Array ? body : null;
    return {
      status, ok: status >= 200 && status < 300, headers: { get: k => hs[k.toLowerCase()] ?? null },
      json: async () => (bytes ? JSON.parse(dec(bytes)) : body),
      text: async () => (bytes ? dec(bytes) : JSON.stringify(body)),
      arrayBuffer: async () => (bytes || enc(JSON.stringify(body))).slice().buffer,   // 图片的原文（raw）
    };
  };
  /** 有人（网页上、别的设备）直接写了文件 */
  gh.putFile = (path, bytes) => gh.files.set(path, { bytes, sha: blobSha(bytes) });
  gh.json = () => JSON.parse(dec(gh.files.get(DATA).bytes));
  /** 别的设备（或者手动）写 picknest.json：fn 改 state */
  gh.pushJson = (fn, { device = '别的 iPad', app = 'picknest', v = 1 } = {}) => {
    const j = gh.files.has(DATA) ? gh.json() : { app, v, state: ensureSeeds(blankState()) };
    fn(j.state);
    gh.putFile(DATA, enc(JSON.stringify({ app, v, device, savedAt: new Date().toISOString(), state: j.state })));
  };
  gh.writes = () => gh.log.filter(l => l.startsWith('PUT'));
  gh.fetch = async (url, opt = {}) => {
    const method = opt.method || 'GET', h = opt.headers || {};
    const path = url.replace('https://api.github.com', '');
    gh.log.push(`${method} ${path}`);
    gh.opts.push({ method, path, ...opt });
    assert.match(h.Authorization, /^Bearer /);
    assert.equal(h['X-GitHub-Api-Version'], '2022-11-28');
    const fault = gh.faults.findIndex(f => (!f.method || f.method === method) && path.includes(f.path || '') && (!f.accept || f.accept === h.Accept));
    if (fault >= 0) {
      const f = gh.faults[fault];
      if (!f.times || --f.times <= 0) gh.faults.splice(fault, 1);
      if (f.throws) throw new TypeError('Load failed');
      if (f.status) return res(f.status, { message: f.message || 'fault' }, f.headers || {});
    }
    const body = opt.body ? JSON.parse(opt.body) : null;
    if (path === '/repos/me/data') {
      if (h.Authorization !== 'Bearer github_pat_test') return res(401, { message: 'Bad credentials' });
      return res(200, { full_name: 'me/data', private: gh.private, visibility: gh.visibility ?? (gh.private ? 'private' : 'public') });
    }
    if (path.startsWith('/repos/') && !path.startsWith('/repos/me/data/')) return res(404, { message: 'Not Found' });
    const cm = path.match(/^\/repos\/me\/data\/contents\/(.+)$/);
    if (!cm) return res(404, {});
    const name = cm[1], file = gh.files.get(name);
    if (method === 'GET') {
      if (!file) return res(404, { message: 'Not Found' });
      if (h.Accept === 'application/vnd.github.raw+json') return res(200, file.bytes);
      const etag = `"e-${file.sha}"`;
      if (h['If-None-Match'] === etag) { gh.n304++; return res(304, null); }
      if (file.bytes.length > gh.big) {
        assert.equal(h.Accept, 'application/vnd.github.object+json', '大文件要用 object 格式问');
        return res(200, { sha: file.sha, size: file.bytes.length, encoding: 'none', content: '' }, { ETag: etag });
      }
      return res(200, { sha: file.sha, size: file.bytes.length, encoding: 'base64', content: Buffer.from(file.bytes).toString('base64') }, { ETag: etag });
    }
    if (method === 'PUT') {
      if (gh.onPut) { const fn = gh.onPut; gh.onPut = null; await fn(); }
      const now = gh.files.get(name);
      if (now && !body.sha) return res(422, { message: '"sha" wasn\'t supplied.' });
      if (now && body.sha !== now.sha) return res(409, { message: 'does not match' });
      if (!now && body.sha) return res(404, { message: 'Not Found' });
      const bytes = new Uint8Array(Buffer.from(body.content, 'base64'));
      gh.putFile(name, bytes);
      gh.puts++;
      return res(now ? 200 : 201, { content: { sha: gh.files.get(name).sha, size: bytes.length }, commit: { sha: 'c' + gh.puts } });
    }
    return res(405, {});
  };
  return gh;
}

