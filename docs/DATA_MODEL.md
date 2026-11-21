# 数据模型（V1）

所有数据是一份 JSON（和 babble、房屋账本同一个形状），存在本机，开了同步时另存一份到私有仓库 `pick-nest-data/picknest.json`：

```js
{
  app: 'picknest', v: 1,
  data: { lists: {}, items: {}, stores: {}, categories: {}, memory: {} },   // 每个集合都是「id → 记录」
  settings: {}, settingsAt: {},                                            // 同步的设置（按键合并）
}
```

本机设置 `picknest.local`（语言、主题、设备名、同步令牌、各清单的显示方式……）不进数据、不同步、不进备份。

所有数据文件（同步仓库里的 `picknest.json`、备份、出错时下载的原始数据）外面都是 `{ app: 'picknest', v: 1, …, state }`，读之前由 `store.js` 的 `fileProblem` 检查：不是这个 App 的 → 不读；`v`（或 `state.v`）比 1 大 → 是新版写的，旧版不读、不合并、不上传（免得改坏）；缺了 `state` → 不读。

## 所有记录都有的字段

| 字段 | 说明 |
|---|---|
| `id` | 符合 `safeKey`（`^[A-Za-z0-9_.:@-]{1,200}$`，不能是 `__proto__` 等） |
| `createdAt` / `updatedAt` | 毫秒。改动一律经过 `stamp()`：比上一版至少新 1 毫秒 |
| `deleted` / `deletedAt` | 软删除。内容保留，照样同步，「最近删除」里能恢复；不做硬删除 |

不认识的字段、不认识的集合原样保留（旧版 App 同步时不会弄丢新版的数据）。读入本机、云端、备份时都经过 `normalizeState()`：坏记录丢掉，能修的修好，用户写的文字一个字都不改。

例外：已知字段里认不出的**取值**（`lists.kind`、`items.status`、`categories.kind`、`memory.kind`）按默认值读，改过以后照默认值写回去。所以以后要加新的取值（比如「项目」清单），要么用新字段表达，要么同时升 `v`（旧版读到 `v` 不是 1 会拒绝读、进恢复页，不会把数据改坏），不要直接往这几个字段里塞新值。

内容没有变的写入（同样的值再存一遍，或者整理后一样，比如 `order: '0'` → `0`）不算修改：不盖新时间、不保存、不进撤销。预置记录靠 `updatedAt: 0` 表示「没人改过」，白盖一个新时间会让它在合并时盖过别的设备上的删除。

## 合并（多台设备）

V1 沿用 babble：**逐条记录比 `updatedAt`，取较新的整条**；时间相同按 `canon()` 序列化比较，保证每台设备结果一样。设置按键合并（`settingsAt`）。

现在只有自己用，同一时刻在两台设备上改同一样东西的情况很少，整条覆盖可以接受。以后多人共用时改成按字段合并（见 ROADMAP），数据形状不用变。

## 同步（core/sync.js）

仓库里一个文件 `picknest.json`（文件名、App 标识、同步码前缀都是 `createSync` / `syncCode` 的参数）：

```js
{ app: 'picknest', v: 1, device: 'iPhone', savedAt: '2026-11-21T10:00:00.000Z', state: { app, v, data, settings, settingsAt } }
```

- 每一轮：确认仓库是私有的（`visibility === 'private'`，5 分钟内确认过不再问；要新建文件时一定再问）→ 拉取（`Accept: application/vnd.github.object+json`，带 `If-None-Match`；超过 1 MB 时内容是空的，再用 raw 格式取原文）→ 两边都 `normalizeState`，`mergeStates`，`ensureSeeds`，交给 `state.applyRemote` 保存（不算本机修改）→ 本机有云端没有的才上传（PUT 整个文件，带上次的 `sha`）
- 409 / 422（别的设备抢先改过、已经有文件了）、带着 sha 却 404（文件被删了）：重新拉取、合并再传，最多传 4 次，重传前等一下（150 毫秒起、每次加倍，再加一点随机）；还不行报 `mergeFail`，下一轮再来
- ETag 只在合并成功以后记；保存合并结果失败（空间满）时本机设置里不记云端版本号，下次完整拉取
- 「有没传的修改」：`state.js` 每次本机修改都标 `sync.dirty`；上传前记下 `editVersion`，上传完它变了（上传期间又改过）就还是 dirty
- 同一时间只跑一轮。切到后台时（`pushFirst`）：知道云端版本、有改动就直接上传（不先拉取），请求体小于 60 KB 时用 `fetch` 的 `keepalive`
- 出错：`SyncError` 的 `code`——`net`（断网，只标离线）、`auth`（401）、`perm`（403）、`notfound`（404）、`public`、`classic`（经典令牌）、`notFine`（不是 `github_pat_` 开头的别的格式）、`badFile`（不是这个 App 的 / 读不出来，不覆盖）、`newer`（新版写的）、`mergeFail`、`rate`（429 或 403 + 剩余 0：带着能再试的时刻 `until`，app 在那之前不自动同步）、`http`（别的状态码）。`net`、`rate`、`mergeFail`、`http` 5xx 是暂时的，状态标签显示「稍后重试」，别的要用户处理
- 本机数据读不出来（恢复页）时 `getConfig` 返回 null：一律不同步。「从云端恢复」另开一个只读的（`readRemote`，raw 格式），只读不写
- 以后有图片：照 babble 的录音，在拉取之后、上传 `picknest.json` 之前传本机还没上传的图片（按内容的 sha256 命名，只增不改），`core/sha256.js` 到那时再移植

## 备份（core/backup.js）

`picknest-backup-YYYYMMDD.json` = `{ app: 'picknest', v: 1, kind: 'backup', exportedAt, state }`。`state` 就是整份同步的数据（软删除的记录、不认识的集合和设置都在），没有令牌和本机设置。

从备份恢复 = `state.mergeIn`：逐条合并、较新的为准、补预置记录，备份里没有的不删（备份里更晚的删除照样合并进来），算本机修改（开着同步会传上去）。读的时候认所有 `{ app: 'picknest', v: 1, state }` 形状的文件，读不出来按 `fileProblem` 说原因（`notJson`、`notApp`、`newer`、`bad`）。

## 最近删除（core/deleted.js）

列的是 `deleted` 的清单、东西、商店、分类，各自 `deletedAt` 新的在前。东西只列所在的清单没删除的：删掉的清单里的东西没有删除标记，只是跟着隐藏，恢复清单时一起回来。「清除已买」清掉的东西 `status` 还是 `done`，恢复后回到「已买」。

恢复 = `store.js` 的 `restoredRecord`（去掉删除标记，修改时间晚于删除）。不能恢复（`restoreBlock`）：这张清单上已经有同名的（`normName`）没删除的东西（同一张清单里同名的只能有一条）、已经有同名的商店、已经有会一起出现的同名分类（规则和新增、改名一样）、所在的清单也删了（先恢复清单）。

## 预置数据（系统清单、商店、分类）

第一次打开时 `ensureSeeds(state)` 补上缺的预置记录：**固定 id，`createdAt: 0, updatedAt: 0`**。

- 固定 id：两台设备各自初始化，同步后不会出现两份「食材」清单
- `updatedAt: 0`：用户的任何修改（改名、归档、删除）都比预置的新，另一台设备晚些初始化也盖不掉
- 已经存在（包括已删除的）就不再补，删掉的预置商店不会自己回来
- 加载时和每次合并之后都调用，重复调用结果不变

预置的清单和分类 `name` 为空、带 `sys` 键，显示时用界面语言的文案（`t('list.sys.groceries')` 之类）；用户改过名字后就显示用户写的名字。商店名是专有名词，直接写名字。

## lists — 清单

```js
{ id, sys: 'groceries' | 'tobuy' | null, name: '', kind: 'grocery' | 'general',
  icon: '', order: 0, defaultStoreId: 's_wholefoods' | null, archived: false }
```

- `kind`：`grocery` 是食材清单（以后接食谱、计划）；`general` 是一般物品（衣服、书、木工……），东西多一个「以后再说」状态
- 预置：`l_groceries`（`kind: 'grocery'`，默认商店 Whole Foods）、`l_tobuy`（`kind: 'general'`，没有默认商店）
- 显示名：`name.trim()`，空的话 `sys` 有就用文案，没有就是「未命名清单」
- `icon`：一个 emoji，空的话按 `kind` 用默认图标
- 系统清单能改名、换图标、归档，不能删除；自建清单能删除（软删除，里面的东西不动、跟着隐藏，恢复清单时一起回来）
- 新建的 `order` = 现有清单（没删除的）里最大的 + 1；`kind` 只在新建时选，以后不改（东西的分类、「以后再说」都跟着它）
- `defaultStoreId` 只收没删除、没归档的商店；归档了的照样留着，只是新加东西时不再当默认
- 首页排顺序（↑↓）：挪到相邻的一张（没归档的）的另一边，**只改这一张的 `order`**：取新位置前后两条的中间值（可以是小数），别的记录不动、不盖新时间——合并是整条取较新的，给没挪的记录（包括 `updatedAt: 0` 的预置记录）白盖一个新时间，会盖掉别的设备上对它的删除。归档的也算在「前后两条」里（它的 `order` 还占着位置，取消归档后回到原处）。前后两条的 `order` 一样（两台设备各自新建了一条）或者中间值已经分不开（同一处挪了很多次）时，才把所有的重写成 0、1、2……（只盖变了的）。在 `store.js` 的 `moveInOrder`，商店、分类也用它

## items — 清单里的一样东西

```js
{ id, listId, name, qty: 1 | null, unit: '', note: '',
  categoryId: null, storeId: null,
  status: 'need' | 'done' | 'later', doneAt: null,
  url: '', price: null,
  needs: {} }
```

- `qty`：数字或 `null`（不写数量）。新加的默认 1。显示时 `null` 不显示数量。编辑时只收 `null` 或 0 < q ≤ 9999
- `unit`：任意文字，空字符串是没有单位。常用单位在界面里给选项（个、袋、盒、瓶、包、罐、把、根、斤、磅、lb、oz、g、kg、mL、L……）
- `storeId`：**这次**打算在哪买，`null` 是未指定。长期习惯记在 `memory` 里，改这一项不影响习惯
- `status`：`need` 要买、`done` 已买、`later` 以后再说（只在 `kind: 'general'` 的清单里出现）
- `url`、`price`：一般物品可选填（手动粘贴链接，V1 不抓取网页）。`url` 只收 `http:` / `https:`（或空），`price` 是 `null` 或 ≥ 0
- `needs`：**预留给食谱和计划**：`{ [来源]: { qty, unit, label } }`。V1 永远是 `{}`，但读写时原样保留。到时 `qty` 表示手动加的那一部分，总数 = 手动 + 各来源（同单位才相加）

### 固定 id（同一张清单里同名的东西是同一条记录）

`itemId(state, listId, name)` 返回这样东西在这张清单里该用的 id。固定 id 是 `'i_' + hash64(listId + '\n' + normName(name))`（FNV-1a 64 位，base36）；少传 `state` 会直接报错（不然会算出一个看着正常、其实不对的 id）。

1. 先找这张清单里同名（`normName` 一样）的记录，已买、已清除的也算。改名改成「牛奶」的、从别的清单移过来的、以前分到随机 id 的，都已经是「这张清单里的牛奶」。有几条时：没删除的优先，再固定 id 优先，再按 id 排（每台设备选的一样）
2. 没有同名的：用固定 id
3. 固定 id 已经被别的东西占了（那条记录改过名或移到了别的清单）：用随机 id `newId('i_')`

调用的地方拿到 id 以后：

- 有这条、已经是「要买」：`'exists'`，提示「已经在清单上了」，什么也不改
- 有这条、已买、以后再说或已清除：`'restored'`，恢复成「要买」，不新建（带着上次的分类、单位、备注、链接；商店按下面的默认值重新定；数量用这次写的或 1）
- 没有这条：`'added'`，新建

这些在 `core/items.js` 的 `addItem` / `addFromInput`（先用 `core/parse.js` 的 `parseQuickAdd` 拆出数量和单位）。

### 移到别的清单

同一条记录换 `listId`。目标清单上已经有同名的（没删除的）：页面先确认（`moveConflict`），然后合并成那一条（恢复成要买），这一条软删除——同一张清单里同名的只能有一条。分类不能给目标清单用时按默认值重新定；移到食材清单时「以后再说」变成要买。

好处：清单记录的数量 ≈ 不同东西的个数，不会越买越多；两台设备离线时各加一次「牛奶」，同步后还是一条。

`normName(s)`：NFKC → 去首尾空格 → 连续空白合成一个 → 小写 → 繁体折成简体（`hanzi.js`）。只用来比较和算 id，不改用户写的名字。

### 「清除已买」

把这张清单里已买的东西软删除（不是改状态），10 秒内可以撤销。以后再加同名的东西会恢复同一条记录。

## memory — 买过的东西（跨清单的习惯）

```js
{ id: 'm_' + hash64(normName), name, kind: 'grocery' | 'general',
  categoryId: null, categorySet: true /* 选过分类才有 */, unit: '', qty: null,
  stores: { [storeId]: { n: 3, at: 1731900000000 } },
  uses: 0, lastAt: 0 }
```

- 每个 `normName` 一条，不分清单（砂纸在哪张清单里都记得去 Home Depot 买）
- **加进清单时**（新加或恢复；已经在清单上的不算）：`uses + 1`、`lastAt`、`name`（最近一次的写法）、`kind`；输入里写了单位也记成 `unit`
- **勾成已买时**：这次的 `storeId` 计数 `n + 1`、`at` 更新（没指定商店就不计；指定的商店删掉了也当没指定，不记到那家：`items.js` 的 `storeKeyOf`，和「商店」页的数法一样）。勾上 30 分钟内（`UNTICK_MS`，按 `doneAt` 算）又取消，算点错了 / 没买成，把那次减回去（减到 0 去掉这家店，`at` 不动）；隔久了再取消是又要买了，那次照样算（不然每次从「已买」点回来都减一次，常去的商店永远只记得最近一次）。已买的东西改了商店或名字（`normName` 变了），那一次挪过去：从旧的减掉、记到新的上
- **改分类、单位时**（编辑面板）：记下来，下次同名的东西直接用。改分类时同时记 `categorySet: true`：改成「未分类」（`categoryId: null`）和「没改过」（也是 `null`）要分得开，不然分错的又按对照表猜回来；没选过的记录上没有这个键
- **常去的商店** `usualStore(memory)`：`n` 最大的，一样多取 `at` 最新的；跳过已删除、已归档的商店。偶尔换一家买一次不会改掉习惯
- 输入时的联想 `suggestions`：名字开头对上的在中间对上的前面，再按 `uses` 多的、`lastAt` 新的，最多 8 个；带着常去的商店、这样东西是不是已经在这张清单上要买

### 新加一样东西时的默认值

| 字段 | 依次取 |
|---|---|
| 商店 | 这样东西常去的商店 → 清单的默认商店（没删除、没归档）→ 未指定 |
| 分类 | 记住的分类（`categorySet` 而且是 `null`：用户选过「未分类」，就是未分类，不往下找）→（恢复时）这条记录上次的分类 → 内置常见食材对照（`core/catalog.js`，只给食材清单：牛奶→蛋奶、苹果→蔬果……）→ 未分类；都要是没删除、能给这种清单用的分类 |
| 单位 | 输入里写了就用（「面粉 1袋」）→ 记住的单位 →（恢复时）这条记录上次的单位 → 空 |
| 数量 | 输入里写了就用（「鸡蛋 12」「2 牛奶」）→ 1 |

## stores — 商店

```js
{ id, name, order: 0, archived: false }
```

预置（固定 id，`updatedAt: 0`）：`s_wholefoods` Whole Foods、`s_traderjoes` Trader Joe's、`s_costco` Costco、`s_target` Target、`s_hmart` H Mart、`s_99ranch` 99 Ranch、`s_amazon` Amazon、`s_homedepot` The Home Depot。

线上商家也是商店。归档的商店不出现在选择列表里，但已经指定给它的东西照常显示。规则在 `core/stores.js`：

- **这家店的东西**：没删除、所在的清单没删除**也没归档**的东西里，`storeId` 是这家店的。`storeId` 是 `null`、指向删掉的或者不存在的商店：算「未指定」
- **还要买几样** `storeCounts`：只数 `status: 'need'`（以后再说、已买不算）。「商店」页的行 `storeRows`：没归档的商店按顺序（0 样的也列）；归档的商店只在还有要买的时候列，排在后面；最后「未指定」（有要买的才列）
- **一家店的页面** `groupStore`：要买的按分类分组（和清单页同一个 `group.js` 的 `groupItems`），已买的 `doneAt` 新的在前；「清除已买」`clearStoreDone` 只软删除这一页上的已买
- **名字**：不能空，不能和别的没删除的商店 `normName` 一样（删掉的不算）。预置商店也能改名、删除
- **新增**：`order` = 现有的（没删除的，归档的也算）最大的 + 1，id `newId('s_')`
- **排顺序**（设置里的 ↑↓）：挪到相邻的（没归档的）另一边，和清单一样只改这一家的 `order`（归档的也算在前后两条里）
- **删除**：软删除。东西的 `storeId`、清单的 `defaultStoreId`、memory 里的次数都不动，商店删掉期间都当「未指定」（不当默认、不算常去的，勾掉时也不记到它）；恢复（撤销、最近删除）时一起回来。`ensureSeeds` 不会补回删掉的预置商店

## categories — 分类

```js
{ id, sys: 'produce' | … | null, name: '', kind: 'grocery' | 'general' | null, order: 0 }
```

- `kind`：只给食材清单用、只给一般清单用，或者 `null` 两边都用
- 预置分类的固定 id 是 `c_` + `sys`（`c_produce`、`c_books`……），`order` 按下面的顺序
- 预置食材分类：蔬果 produce、肉类海鲜 meat、蛋奶 dairy、面包烘焙 bakery、冷冻 frozen、粮油干货 pantry、调料酱料 condiments、零食饮料 snacks、日用清洁 household
- 预置一般分类：衣物 clothing、书籍 books、工具五金 tools、数码 electronics、家居 home
- 没有分类的东西归在「未分类」，排在最后
- 设置里按 `kind` 分三组：食材（`'grocery'`）、一般（`'general'`）、两边都用（`null`）。`kind` 只在新增时选，以后不改（改了的话已经分在这一类的东西会突然「不合适」）。规则在 `core/categories.js`
- **名字**：预置分类可以清空（显示界面语言的名字）；自己加的不能空。不能和会出现在同一张清单上的分类（同一种，或者有一边是两边都用的）重名：`normName` 比，删掉的不算，没改过名的预置分类按显示的名字比；食材的和一般的可以同名。新增的 `order` = 现有的最大的 + 1（排在它那一组的最后），id `newId('c_')`
- **排顺序**：只在同一组里挪。所有没删除的分类按 `order` 排成一列（几组是穿插的），这一个挪到组里上一个 / 下一个的另一边，和清单一样只改它的 `order`（取前后两条的中间值），别的相对顺序不变、不盖新时间。两边都用的分类和食材分类会出现在同一张清单上，所以是一套顺序
- **删除**：软删除。东西的 `categoryId`、memory 里记住的分类都不动，分类删掉期间归到「未分类」（也不再当默认），恢复时回来。预置分类也能删，删掉的不会被补回来

## 排序

- 清单：`order`，再 `createdAt`
- 清单里「要买」的东西：按分类（或按商店）分组，组按 `order`，「未分类 / 未指定」在最后；已删除的分类 / 商店当作没有（归到「未分类 / 未指定」），归档的商店照常一组。组内按名字（`Intl.Collator`：简体 `zh-Hans-u-co-pinyin`，繁体 `zh-Hant-TW`，英文 `en`，数字按大小），一样的按 id
- 「以后再说」：单独一组，按名字
- 「已买」：`doneAt` 新的在前
- 在 `core/group.js` 的 `groupNeed`；分组本身是 `groupItems`，商店页（`core/stores.js` 的 `groupStore`，按分类分组）也用它

## 购物模式（core/shop.js）

不存任何东西：是清单页 / 商店页的地址带上 `?shop=1`（`#/l/<id>?shop=1`、`#/s/<id>?shop=1`、`#/s/none?shop=1`），重新载入还在。显示的东西和普通页面一样分组（清单用 `groupNeed`、按这张清单的 `groupBy`；一家店用 `groupStore`），只是不显示「以后再说」。

- **进度** `shopProgress(state, 'list' | 'store', id)` → `{ done, left, total, finished }`：清单 = 这张清单上没删除的 `need`（还剩）和 `done`（已买），用 `items.js` 的 `countItems`；一家店 = `groupStore` 里的（归档的清单不算，删掉的商店算「未指定」）。`以后再说` 不算。`finished` = 没有还剩的、而且有已买的（空的一页不算「买齐了」）。已买包括以前勾掉还没清除的（它们也在「已买」里），「清除已买」以后从 0 算
- 勾掉、放回去、清除已买用的就是 `setStatus`、`clearDone`、`clearStoreDone`（勾掉时照样记 memory）
- 「已买」每次进购物模式都是折起来的，点开只管这一次（页面里记着，不存）：不读不写普通页面的 `view[listId].showDone`、`storeView`，本机设置只读 `view[listId].groupBy`（分组和清单页一样）
- 屏幕常亮（`core/wake.js` 的 `screenWake`，`navigator.wakeLock`、`document` 由页面传进去）：只是浏览器的 Screen Wake Lock，不存东西、不同步

## 搜索（core/search.js）

`#/search?q=<词>`，搜索词只在地址里，不存。

- `searchItems(state, query, collator)` → `[{ list, archived, hits: [{ item, note }] }]`：搜索词经过 `normName`（NFKC、小写、繁体折成简体）后按空格拆开，每个词都要出现在名字或备注（也 `normName` 过）里，可以分在两处。没删除的清单里没删除的东西都算，归档的清单也算（`archived: true`，排在后面）；什么状态都列
- 清单按首页的顺序（`byOrder`），归档的在后；每张里 `need` → `later` → `done`，同一种按名字（`group.js` 的 `byName`）
- `note`：备注里第一行有命中的那一行（原文），没有就是 `''`（页面照常显示备注的第一行）
- `highlight(text, query)` → `[{ text, hit }]`：拼起来就是原文，命中的部分 `hit: true`。逐字折（和 `normName` 同一套），一个字折成几个字（「㎏」→「kg」）时只命中一部分也标整个字；极少数要连起来才折得成的写法搜得到、标不出来

## 本机设置 picknest.local（不同步）

```js
{ lang: null, theme: 'auto', device: null, lastBackupAt: null,
  sync: null | { repo: 'owner/pick-nest-data', token: 'github_pat_…', tokenExp: null /* 用户填的到期日 23:59 */,
                 sha, etag, dirty, at /* 上次同步成功 */, err: null | { code, vars }, offline },
  view: { [listId]: { groupBy: 'category' | 'store', showDone: true, showLater: true } },   // 认不出的值按默认（core/group.js 的 listView）；购物模式只用 groupBy
  storeView: { [storeId | 'none']: { showDone: true } } }                                     // 商店页「已买」折没折；'none' 是「未指定」（core/group.js 的 storeView）
```

- `device`：写进同步文件和提交说明的设备名；没设就用平台名（iPhone / iPad / Mac，`core/sync.js` 的 `platformDevice`）
- `lastBackupAt`：这台设备上次下载 / 分享备份的时刻（设置 → 数据里显示）
- `tokenExp`：用户填的到期日那天 23:59（`dates.js` 的 `endOfDay`；2000 年以前的不收：用键盘填日期时年份是一位一位进去的，0002 也是「合法」的日期）
- 同步码 = `picknest-sync:<owner/repo>:<令牌>[:<到期日 YYYY-MM-DD>]`（`syncCode` / `parseSyncCode`，前缀是参数）。到期日是每台设备自己的本机设置，带在同步码里，用它连上的设备也会提前提醒
- 只收 Fine-grained 令牌（`tokenProblem`，只认 `github_pat_` 前缀）：`ghp_`、`gho_`、`ghu_`、`ghs_`、`ghr_` 开头的和以前没有前缀的 40 位十六进制（都是经典令牌，GitHub 照样收）报 `classic`，别的格式报 `notFine`，都不拿来发任何请求（`readRemote` 也一样）
