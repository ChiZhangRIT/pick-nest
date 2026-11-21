# PickNest 开发约定

自己用的购物清单网页 App。**先读**：`README.md`（行为规格，从用户角度写）、`docs/DATA_MODEL.md`（数据结构和规则）、`docs/ROADMAP.md`（分步计划和已定的决定）。

## 技术约定（和 ../babble、../house-ledger 一致）

- **无构建**：原生 ES modules，没有 `package.json`、没有 npm 依赖、没有打包。部署 = GitHub Pages 直接发布 `main` 的根目录，地址 `https://chizhangrit.github.io/pick-nest/`
- **测试**：`node --test tests/*.test.mjs`（Node 自带，零依赖）。视图测试用假 DOM（照 `../babble/tests/helpers/dom.mjs`）。只用编出来的数据，不读令牌、不访问 GitHub
- **结构**：`src/core/*` 纯逻辑（不碰 DOM，Node 里能 import、能测）；`src/views/*` 页面；`src/ui/*` 共用界面部件；`src/strings/*.js` 文案；`src/app.js` 外壳。关键的业务规则（解析输入、固定 id、合并、常去商店、排序分组）必须在 `core/` 里并有测试，不写在页面里；页面也不自己数（还要买几样用 `store.js` 的 `needCounts`，已买几样、清单里几样用 `items.js` 的 `countItems`）。现在的分工：`parse.js` 解析快速添加、`catalog.js` 常见食材对照、`items.js` 加 / 恢复 / 勾选 / 清除 / 移动 / 编辑、`memory.js` 买过的东西和联想、`group.js` 分组排序、`lists.js` 清单本身。
  这些操作函数直接改传进来的 state（页面在 `ctx.mutate(s => …)` 里调用，撤销、保存由 `state.js` 管），写记录一律用 `store.js` 的 `writeRecord`（整理字段；内容没变不盖新时间）或 `deletedRecord`
- **页面接口**照 babble `src/app.js` 开头的约定：`render(main, params, ctx)` 返回清理函数或 `{ cleanup, onChange }`；改数据一律走 `ctx.mutate / put / update / remove`，app 负责保存、同步、重画。把 PickNest 实际的 `ctx` 写在 `src/app.js` 开头
- **DOM**：用 `ui/dom.js` 的 `h()`，只用 `textContent`，不拼 HTML 字符串（清单名、商品名、粘贴的链接都是用户内容）
- **类型**：`src/core/*.js` 开头加 `// @ts-check`，用 JSDoc 写清参数和记录形状（VS Code 直接检查，不用装东西）
- **文案**：`t(key, vars)`，三种语言 `zh-Hans`（默认）、`zh-Hant-TW`（台湾用词）、`en`，按功能分文件放在 `src/strings/`，测试检查三种语言的键和 `{占位符}` 一致。用户写的内容永远不经过 `t()`，也不做简繁转换
- **注释**用中文，写「为什么」，不写「做了什么」；密度照 babble
- **CSP**：`connect-src 'self' https://api.github.com`，不加载任何 CDN
- **离线**：照 babble 的 `sw.js` / `release.json` / `scripts/prepare-release.mjs` / `src/start.js`：整版下载并校验 SHA-256 才安装，页面和 worker 同一版，不 `skipWaiting`。缓存名前缀 `picknest-`，只清自己前缀的旧缓存（同一个 github.io 域名下还有别的 App）。新加的程序文件要进 `CORE`，`tests/sw.test.mjs` 检查。版本号在 `src/version.js`，由 `prepare-release` 和 `sw.js` 的 `CACHE` 一起改，不要手改
- **本机存储**：`picknest.state`（快照）+ `picknest.pending.*`（每次改动一条日志）+ `picknest.local`（本机设置），照 babble 的 `core/persistence.js` 和 `core/state.js`。同一个域名下有别的 App，所有键都带 `picknest.` 前缀

## 从 babble 移植什么

以 `../babble` 为准（它的同步修过 house-ledger 和 virtual-bookshelf 还有的两个问题：文件超过 1 MB 要用 raw 格式读；ETag 要合并成功后再记）。移植时：

- `core/util.js`、`core/hanzi.js` 基本原样（已移植）；`core/sha256.js` 第 5 步跟着同步一起移植
- `core/store.js`：`canon`、`pick`、`mergeStates`、`stamp`、`deletedRecord`、`restoredRecord`、`newId` 原样；`normalizeState` 和各集合的整理函数按 `docs/DATA_MODEL.md` 重写；加 `ensureSeeds`、`normName`、`hash64`、`itemId`
- `core/state.js`、`core/persistence.js`：去掉 babble 特有的（说话人、录音、夜间、版本记录本），键名换成 `picknest.*`，`app` 标识换成 `picknest`
- `core/sync.js`（第 5 步）：文件名 `picknest.json`、App 标识、同步码前缀 `picknest-sync:` 做成参数（babble 第 30 行的正则写死了 `babble-sync:`，别照抄）；V1 没有图片，去掉录音上传下载那部分，但保留以后接图片的位置
- `ui/dom.js`、`i18n.js`、`start.js`、`boot.js`、`sw.js`、`scripts/prepare-release.mjs`、相关测试和 `tests/helpers/`
- 不要搬 babble 的业务（梦话、录音、转文字、夜间、日历）

## 数据规则（细节见 docs/DATA_MODEL.md）

- 删除一律软删除；改动一律经过 `stamp()`；读入的数据一律经过 `normalizeState()`；不认识的字段和集合原样保留
- 预置的清单、商店、分类用固定 id、`updatedAt: 0`，由 `ensureSeeds()` 补（加载后、每次合并后），不重复、不复活被删的
- 同一张清单里同名的东西是同一条记录：id 一律用 `itemId(state, listId, name)` 算（先找同名的，再固定 id，再随机）；再加一次就恢复同一条
- `items.needs` 是给以后的食谱 / 计划预留的，V1 不用，但必须原样保留
- 确定性的事（勾选、筛选、数量、分组）永远不用 AI

## 现在不做

- AI 提取、食谱、Meal plan、分享菜单（见 ROADMAP「以后」）。不要放「食谱」「计划」页，也不要放点了没反应的按钮
- 不加任何服务器、账号系统、第三方 SDK

## 隐私

- 这个仓库是公开的：真实的购物记录、备份、令牌不进仓库，测试、注释、例子里也不写。`.gitignore` 已排除 `picknest*.json`、`*.private.*`
- 同步令牌只存在本机（`picknest.local`），不进备份、不进同步的数据

## 提交

- 每完成 ROADMAP 里的一步就提交一次：先跑 `node scripts/prepare-release.mjs` 和 `node --test tests/*.test.mjs`，全部通过；README 改成实际的行为、ROADMAP 打勾
- 提交信息用中文，一句话说清做了什么（照 babble 的风格）
- **不要 push**，推送由 Chi 在 GitHub Desktop 上做
