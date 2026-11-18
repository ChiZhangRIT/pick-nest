import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('发布准备：校验不写文件；内容变化才升级版本，sw.js 和 version.js 一起更新，重复运行保持不变', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'picknest-release-test-'));
  try {
    for (const dir of ['scripts', 'src']) fs.mkdirSync(path.join(root, dir), { recursive: true });
    fs.copyFileSync(new URL('../scripts/prepare-release.mjs', import.meta.url), path.join(root, 'scripts/prepare-release.mjs'));
    fs.writeFileSync(path.join(root, 'sw.js'), "const CACHE = 'picknest-v1';\nconst CORE = ['./', './index.html', './src/version.js'];\n");
    fs.writeFileSync(path.join(root, 'src/version.js'), "export const BUILD = 'picknest-v1';\n");
    fs.writeFileSync(path.join(root, 'index.html'), '<p>fixture</p>');
    const run = (...args) => spawnSync(process.execPath, ['scripts/prepare-release.mjs', ...args], { cwd: root, encoding: 'utf8' });
    const manifest = () => JSON.parse(fs.readFileSync(path.join(root, 'release.json'), 'utf8'));
    assert.equal(run('--check').status, 1, '还没有清单');
    assert.equal(run().status, 0); assert.equal(manifest().cache, 'picknest-v1');
    assert.equal(manifest().app, 'picknest');
    const original = fs.readFileSync(path.join(root, 'release.json'), 'utf8');
    assert.equal(run().status, 0); assert.equal(fs.readFileSync(path.join(root, 'release.json'), 'utf8'), original);
    assert.equal(run('--check').status, 0);
    fs.appendFileSync(path.join(root, 'index.html'), '<p>changed</p>');
    assert.equal(run('--check').status, 1);
    assert.equal(fs.readFileSync(path.join(root, 'release.json'), 'utf8'), original, '--check 不改清单');
    assert.equal(run().status, 0); assert.equal(manifest().cache, 'picknest-v2');
    assert.ok(fs.readFileSync(path.join(root, 'src/version.js'), 'utf8').includes("BUILD = 'picknest-v2'"));
    assert.ok(fs.readFileSync(path.join(root, 'sw.js'), 'utf8').includes("CACHE = 'picknest-v2'"));
    assert.equal(run('--check').status, 0);
    assert.equal(run().status, 0); assert.equal(manifest().cache, 'picknest-v2', '没变化不升级');
    fs.writeFileSync(path.join(root, 'src/version.js'), "export const BUILD = 'picknest-v1';\n");
    assert.equal(run('--check').status, 1, 'version.js 和清单对不上');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
