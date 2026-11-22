# PickNest 开发约定

自己用的购物清单网页 App。**先读**：`README.md`（行为规格，从用户角度写）、`docs/DATA_MODEL.md`（数据结构和规则）、`docs/ROADMAP.md`（分步计划和已定的决定）。

## 技术约定（和 ../babble、../house-ledger 一致）

- **无构建**：原生 ES modules，没有 `package.json`、没有 npm 依赖、没有打包。部署 = GitHub Pages 直接发布 `main` 的根目录，地址 `https://chizhangrit.github.io/pick-nest/`
- **测试**：`node --test tests/*.test.mjs`（Node 自带，零依赖）。视图测试用假 DOM（照 `../babble/tests/helpers/dom.mjs`）。只用编出来的数据，不读令牌、不访问 GitHub
- **结构**：`src/core/*` 纯逻辑（不碰 DOM，Node 里能 import、能测）；`src/views/*` 页面；`src/ui/*` 共用界面部件；`src/strings/*.js` 文案；`src/app.js` 外壳。关键的业务规则（解析输入、固定 id、合并、常去商店、排序分组）必须在 `core/` 里并有测试，不写在页面里；页面也不自己数（还要买几样用 `store.js` 的 `needCounts`，每家店几样用 `stores.js` 的 `storeCounts` / `storeRows`（东西算在哪家店、勾掉记在哪家用 `items.js` 的 `storeKeyOf`：删掉的商店算未指定），已买几样、清单里几样用 `items.js` 的 `countItems`，删除前「会影响几样」用 `countUsing`）。现在的分工：`parse.js` 解析快速添加、`catalog.js` 常见食材对照、`items.js` 加 / 恢复 / 勾选 / 清除 / 移动 / 编辑、`memory.js` 买过的东西和联想、`group.js` 分组排序（清单页、商店页共用 `groupItems`）、`lists.js` 清单本身、`stores.js` 商店（「商店」页、一家店、设置里管商店）、`categories.js` 设置里管分类、`sync.js` 同步（GitHub contents API、同步码、令牌规则、状态 `syncPhase`）、`backup.js` 备份的内容和读文件、`deleted.js` 最近删除列什么、能不能恢复、`dates.js` 显示时间（今天 / 昨天…，三种语言）、`search.js` 搜索（`searchItems`、标出命中的字 `highlight`，用 `normName` 比）、`shop.js` 购物模式的进度（`shopProgress`）、`wake.js` 购物模式的屏幕常亮（navigator.wakeLock、document 由调用的地方给，测试用假的）；
  本机的显示方式（`view`、`storeView`）改的时候用 `group.js` 的 `listViewPatch` / `storeViewPatch`（清单页、商店页；购物模式只读 `groupBy`，「已买」每次进去都折着、页面自己记）；↑↓ 排顺序一律用 `store.js` 的 `moveInOrder`（只改挪的那一条的 `order`，别的不盖新时间），按钮的 onclick 套 `ui/dom.js` 的 `keepUnderFinger`。
  界面上能勾的一行和勾选的节奏在 `ui/checklist.js`（清单页、商店页、购物模式、搜索共用；行里的小标签 `storeChip` / `listChip`、组名 `groupTitle`、分好的组 `groupSections` 也在这里；取消勾选回哪用 `items.js` 的 `untickStatus`），改一样东西的面板是 `ui/itemEditor.js`（「保存」= `items.js` 的 `editAndMove`：改和移到别的清单在 core 里一起做），同步状态的小标签是 `ui/syncBadge.js`（`ctx.syncBadge()`），推入的页面（设置的子页面、最近删除）的顶栏用 `ui/dom.js` 的 `pushFrame`，不要在页面里再写一份。
  返回按钮上的字用 `ui/dom.js` 的 `backText(ctx, 没有上一页时的字)`（`ctx.backLabel`：写后退回去的那一页，读屏念的和按了去的要一样）。提示条的读屏文字写进一直在页面里的 `#toast-live`（`toast()` 管），不要给 `#toast` 加 live region。确认框（`ctx.confirm`）会删东西、放弃修改的要给 `danger: true`（焦点先给「取消」）。
  `el.append(…)` 会把 `null` 写成字「null」（只有 `h()` 跳过 null）：可能为空的部分先 `.filter(Boolean)`
  面板里输入框的回车用 `ui/form.js` 的 `onEnter`（输入法选字的回车不算，Safari 要看 keyCode 229）；面板里马上生效的按钮（归档、删除）用 `closeThen`（有没存的修改先问）
  这些操作函数直接改传进来的 state（页面在 `ctx.mutate(s => …)` 里调用，撤销、保存由 `state.js` 管），写记录一律用 `store.js` 的 `writeRecord`（整理字段；内容没变不盖新时间）或 `deletedRecord`
- **页面接口**照 babble `src/app.js` 开头的约定：`render(main, params, ctx)` 返回清理函数或 `{ cleanup, onChange, flush }`（`flush`：切到后台前把点过、还没写进数据的写进去，清单页、商店页、购物模式、搜索的勾选用）；改数据一律走 `ctx.mutate / put / update / remove`，app 负责保存、同步、重画。把 PickNest 实际的 `ctx` 写在 `src/app.js` 开头
- **布局**照 babble 的三种：手机 < 720（底栏）、侧栏 720–999、双栏 ≥ 1000（`planPanes`：首页 / 「商店」在左栏，`params.pane`、`params.selected` 给左栏高亮）；换布局时有 `onChange` 的页面整个搬到另一栏（`migrate`），所以有输入框的页面一定要返回 `onChange`、不要让 app 重画。购物模式（`#/l/…?shop=1`、`#/s/…?shop=1`）永远一栏。
  页面自己换了状态（搜索词）用 `ctx.replaceHash` 只换地址栏；`ctx.navigate` 马上画新页面（点按里 focus 输入框 iPhone 才弹键盘，链接用 `ui/dom.js` 的 `linkTo`；去搜索的用 `views/search.js` 的 `searchLink`：已经在搜索页上只给焦点，不清掉搜索词）
- **DOM**：用 `ui/dom.js` 的 `h()`，只用 `textContent`，不拼 HTML 字符串（清单名、商品名、粘贴的链接都是用户内容）
- **类型**：`src/core/*.js` 开头加 `// @ts-check`，用 JSDoc 写清参数和记录形状（VS Code 直接检查，不用装东西）
- **文案**：`t(key, vars)`，三种语言 `zh-Hans`（默认）、`zh-Hant-TW`（台湾用词）、`en`，按功能分文件放在 `src/strings/`，测试检查三种语言的键和 `{占位符}` 一致。用户写的内容永远不经过 `t()`，也不做简繁转换
- **注释**用中文，写「为什么」，不写「做了什么」；密度照 babble
- **CSP**：`connect-src 'self' https://api.github.com`，不加载任何 CDN
- **同步**：什么时候跑、`ctx.sync` 在 `app.js`（照 babble；页面不自己排同步，从备份恢复后马上传也是 app 管）；规则在 `core/sync.js`，测试用 `tests/helpers/github.mjs` 的假 GitHub（不联网，令牌是编的 `github_pat_test`）。本机数据有问题时 `getConfig` 返回 null，一律不同步。只收 Fine-grained 令牌，令牌只在 `picknest.local`
- **离线**：照 babble 的 `sw.js` / `release.json` / `scripts/prepare-release.mjs` / `src/start.js`：整版下载并校验 SHA-256 才安装，页面和 worker 同一版，不 `skipWaiting`。`register()` 不检查新版，`app.js` 在启动后、切回来时（最多半小时一次）`registration.update()`，下载好了「设置 → 关于」里说；没有 Service Worker 的浏览器（别的 App 里的）照样打开，只是不能离线。缓存名前缀 `picknest-`，只清自己前缀的旧缓存（同一个 github.io 域名下还有别的 App）。新加的程序文件要进 `CORE`，`tests/sw.test.mjs` 检查。版本号在 `src/version.js`，由 `prepare-release` 和 `sw.js` 的 `CACHE` 一起改，不要手改
- **本机存储**：`picknest.state`（快照）+ `picknest.pending.*`（每次改动一条日志）+ `picknest.local`（本机设置），照 babble 的 `core/persistence.js` 和 `core/state.js`。同一个域名下有别的 App，所有键都带 `picknest.` 前缀

## 和别的 App 保持一致

Chi 的四个 App（`../babble`、`../house-ledger`、`../virtual-bookshelf` 和这个）用起来要一样；拿不准的以 babble 为准，改了这里的约定也告诉另外几个。已经定下的：

- **设置首页**从上到下：语言（第一组、**没有组名**，一行「语言 / Language」——跟着界面写简体 / 繁体，英文界面「Language / 语言」——右边是原生的下拉框 `<select>`，带 `aria-label` 和 `data-fid`；换语言就地重画、保留滚动，焦点回到下拉框；选了当前的语言不重画）→「同步」（「多设备同步」+ 状态标签；下面一句：开着写「仓库：…」，没开说是干什么的）→ 各 App 自己的几组 →「外观」（自动 / 浅色 / 深色分段）→「数据」（备份与恢复、最近删除；下面「上次备份：今天 / n 天前 / 还没备份过」，还没备份过或 ≥ 30 天琥珀色 `--warn`）→「关于」
- **叫法**：「多设备同步」/「多裝置同步」/ Multi-device sync（组名是「同步」）；「导出备份」/「匯出備份」/ Export backup；「导出数据（JSON）」；编辑面板的主按钮「保存」/「儲存」/ Save（新建的用自己的「添加」「新建」）；放弃修改问「放弃没保存的修改？」，按钮 [继续编辑] [放弃]；从备份恢复的确认框标题「从备份恢复？」、按钮「恢复」
- **推入的页面**（设置的子页面、最近删除）：吸顶顶栏「返回 · 标题 · 操作」，标题在中间（17px / 600，长了省略，`h1.nb-title`），**所有布局都有返回**；只有双栏右栏（左栏就是上一页）不显示返回。顶栏和 Babble 的 `.navbar` 一样不限宽（宽屏时返回贴着内容栏左边），内容限宽居中；右边的操作按钮在 375 宽以下的手机上只留图标（字在 `aria-label` 里）
- **确认框**：会删东西、放弃修改的（`danger: true`）焦点先给「取消」（「继续编辑」），连按两下回车不会直接删掉
- **关于**里显示版本号（`src/version.js`），新版本在后台下载好了说一句「关掉再打开就是新版」
- **同步状态标签**：令牌快到期（两周内）是黄点；手机上在首页大标题旁边，宽屏只在侧栏「设置」下面一个
- **快捷键**：⌘N（别的系统 Ctrl+N）是「新建」——这里是把光标放进清单页的快速添加；面板开着、正在别的输入框里打字时不管
- **样式**：组名 `.group-h` 不大写、不加字距，颜色 `--ink-2`；分段控件选中那段的字是 `--accent-text`；大标题 `.lt` 字距 .04em；输入框圆角 12px（`--radius`）；双栏右栏空着时是 96px 的 App 图标（圆角 22.37%）+ 一句话
- **图标**：改 `icons/icon.svg` → `swift tools/render-icons.swift` 重新生成 PNG → 把 `index.html` 和两份 manifest 里图标的 `?v=` 加一 → `node scripts/prepare-release.mjs`

## 从 babble 移植什么

以 `../babble` 为准（它的同步修过 house-ledger 和 virtual-bookshelf 还有的两个问题：文件超过 1 MB 要用 raw 格式读；ETag 要合并成功后再记）。移植时：

- `core/util.js`、`core/hanzi.js` 基本原样（已移植）；`app.js` 的三种布局、双栏（`planPanes`、`migrate`、`replaceHash`）已移植；`core/sha256.js` 等以后做图片时再移植（babble 里只给录音用，第 5 步没有录音 / 图片）
- `core/store.js`：`canon`、`pick`、`mergeStates`、`stamp`、`deletedRecord`、`restoredRecord`、`newId` 原样（`mergeStates` 逐条用 `mergeRecord`：items、memory 各自从头建的同一条补字段，babble 没有）；`normalizeState` 和各集合的整理函数按 `docs/DATA_MODEL.md` 重写；加 `ensureSeeds`、`normName`、`hash64`、`itemId`
- `core/state.js`、`core/persistence.js`：去掉 babble 特有的（说话人、录音、夜间、版本记录本），键名换成 `picknest.*`，`app` 标识换成 `picknest`
- `core/sync.js`（已移植）：文件名 `picknest.json`、App 标识、同步码前缀 `picknest-sync:` 是参数（babble 的正则写死了 `babble-sync:`，没照抄）；去掉了录音上传下载、永久删除、云端历史，`run()` 里留了以后接图片的位置
- `ui/dom.js`、`i18n.js`、`start.js`、`boot.js`、`sw.js`、`scripts/prepare-release.mjs`、相关测试和 `tests/helpers/`
- 不要搬 babble 的业务（梦话、录音、转文字、夜间、日历）

## 数据规则（细节见 docs/DATA_MODEL.md）

- 删除一律软删除；改动一律经过 `stamp()`；读入的数据一律经过 `normalizeState()`；不认识的字段和集合原样保留
- 合并是整条取较新的（`mergeRecord`）；例外只有 `items`、`memory` 里各自从头建的同一条（`createdAt` 不一样）：补上空着的字段。新建 items / memory 记录时 `createdAt` 用现在，改的时候一律保留原来的 `createdAt`（`{ ...旧的, ...改动 }`），不然会被当成「各自从头建的」
- 预置的清单、商店、分类用固定 id、`updatedAt: 0`，由 `ensureSeeds()` 补（加载后、每次合并后），不重复、不复活被删的
- 同一张清单里同名的东西是同一条记录：id 一律用 `itemId(state, listId, name)` 算（先找同名的，再固定 id，固定 id 被占了再算下一个空位；都不随机）；再加一次就恢复同一条
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
