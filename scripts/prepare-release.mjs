// node scripts/prepare-release.mjs；--check 仅检查，不写文件。只计算仓库内程序文件，不访问用户数据。
// 生成 release.json（sw.js 的 CORE 里每个文件的 SHA-256）；和上一版比内容变了，就把 sw.js 的 CACHE 和 src/version.js 的 BUILD 一起升一版。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, file));
const write = (file, text) => fs.writeFileSync(path.join(root, file), text);
const hash = file => createHash('sha256').update(read(file)).digest('hex');
const check = process.argv.includes('--check');
const BUILD_LINE = /export const BUILD = 'picknest-v\d+';/;
let source = read('sw.js').toString(), cache = source.match(/const CACHE = '(picknest-v\d+)'/)[1];
const files = [...source.match(/const CORE = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
const manifest = () => ({ app: 'picknest', v: 1, cache, worker: hash('sw.js'),
  core: Object.fromEntries(files.map(file => [file, hash(file === './' ? 'index.html' : file)])),
});
const previous = fs.existsSync(path.join(root, 'release.json')) ? JSON.parse(read('release.json')) : null;
if (!check) {
  let version = read('src/version.js').toString().replace(BUILD_LINE, `export const BUILD = '${cache}';`);
  write('src/version.js', version);
  if (previous?.cache === cache && JSON.stringify(previous) !== JSON.stringify(manifest())) {
    cache = 'picknest-v' + (Number(cache.slice('picknest-v'.length)) + 1);
    source = source.replace(/const CACHE = 'picknest-v\d+';/, `const CACHE = '${cache}';`);
    write('sw.js', source);
    version = version.replace(BUILD_LINE, `export const BUILD = '${cache}';`);
    write('src/version.js', version);
  }
}
const release = manifest();
if (check) {
  if (JSON.stringify(previous) !== JSON.stringify(release) || !read('src/version.js').toString().includes(`export const BUILD = '${cache}';`)) {
    console.error('发布清单已过期，请运行 node scripts/prepare-release.mjs'); process.exitCode = 1;
  } else console.log('发布清单与所有程序文件一致。');
} else {
  write('release.json', JSON.stringify(release, null, 2) + '\n');
  console.log(`已准备 ${cache}，${files.length} 个程序文件。`);
}
