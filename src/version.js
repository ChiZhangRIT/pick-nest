// 当前版本号（和 sw.js 的 CACHE 一样）。由 scripts/prepare-release.mjs 写，不要手改。
// 单独一个文件：启动器要拿它核对 worker 的版本，设置页的「关于」也要显示它（app.js 不能 import 启动器，那会再启动一次）。
export const BUILD = 'picknest-v28';
