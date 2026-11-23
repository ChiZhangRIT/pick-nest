# 数据模型（V1 + 第二版的食谱）

所有数据是一份 JSON（和 babble、房屋账本同一个形状），存在本机，开了同步时另存一份到私有仓库 `pick-nest-data/picknest.json`：

```js
{
  app: 'picknest', v: 1,
  data: { lists: {}, items: {}, stores: {}, categories: {}, memory: {}, recipes: {}, plan: {} },   // 每个集合都是「id → 记录」（第二版：recipes 第 8 步加了，plan 第 9 步加）
  settings: {}, settingsAt: {},                                            // 同步的设置（按键合并）
}
```

本机设置 `picknest.local`（语言、主题、设备名、同步令牌、各清单的显示方式、按商店看时只看哪张清单……）不进数据、不同步、不进备份。编辑食谱时没保存的修改另存在 `picknest.draft.recipe.<食谱 id | new>`（见下面 recipes），也只在这台设备上。

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

例外（`store.js` 的 `mergeRecord`）：`items`、`memory` 的 id 是算出来的（清单 + 名字、名字），一台设备还没拉到云端那条（新设备还没连同步、Safari 清掉了存储、店里离线）就又加了同名的，建的是同一个 id 上一条空白的新记录。整条取较新的话，云端那条（可能是几个月前的）的备注、链接、价格、常去的商店、记住的单位就永远没了。所以两条的 **`createdAt` 不一样**（同一条记录改来改去、恢复、移动，`createdAt` 都不变）时：

- 以较新的为底（状态、数量、名字的写法、删除标记都是它的）
- `items`（还要同一张清单、`normName` 一样；不然是另一样东西占了这个 id，照旧整条取较新的）：它空着的 `note`、`url`、`price`、`unit`、`storeId`、`categoryId` 用另一条的补上；空着的 `needs` 只在**两条都还没买**（要买 / 以后再说、没删除）时补——另一条已买、已清除的 `needs` 是买过的那一轮，补过来就又成了要买的（新设备上快速添加「洋葱」，同步后变成「1 + 200 g」）；较新的已买、已清除，补了也没用
- `memory`：`stores` 两边合在一起，同一家店 `n`、`at` 取大的；`uses`、`lastAt` 取大的；较新的没选过分类（`categorySet`）就用另一条选过的；较新的没标常备品（`staple`）、另一条标了就留着；空着的 `unit`、`qty` 补上
- `createdAt` 取早的（以后两边就是同一条，不再走这个例外）；补到了东西的结果 `updatedAt` 是较新那条 + 1（还拿着较新那条的设备合并时它赢），没补到东西就是较新的那条。顺序无关，再合并几次结果都一样
- 同一条记录（`createdAt` 一样）照旧整条取较新的：清空的备注不会被旧的补回来，点错了减回去的购买次数也不会被旧的加回去
- 不满足结合律：三份各自从头建的，先合并哪两份，结果（谁的字段补进来、`updatedAt` 多 1 毫秒落在哪）可能不一样。经过同一个仓库轮流同步时照样会收敛（每台设备最后一样、不会来回上传），各自从头建的那几份上的备注、链接、价格不会丢；`tests/mergeConvergence.test.mjs` 用随机数据模拟三台设备检查这几条，改合并规则时要它照样通过

现在只有自己用，同一时刻在两台设备上改同一样东西的情况很少，整条覆盖可以接受。以后多人共用时改成按字段合并（见 ROADMAP），数据形状不用变。

## 同步（core/sync.js）

仓库里一个文件 `picknest.json`（文件名、App 标识、同步码前缀都是 `createSync` / `syncCode` 的参数）：

```js
{ app: 'picknest', v: 1, device: 'iPhone', savedAt: '2026-11-21T10:00:00.000Z', state: { app, v, data, settings, settingsAt } }
```

- 每一轮：确认仓库是私有的（`visibility === 'private'`，5 分钟内确认过不再问；要新建文件时一定再问）→ 拉取（`Accept: application/vnd.github.object+json`，带 `If-None-Match`；超过 1 MB 时内容是空的，再用 raw 格式取原文）→ 两边都 `normalizeState`，`mergeStates`，`ensureSeeds`，交给 `state.applyRemote` 保存（不算本机修改）→ 本机有云端没有的才上传（PUT 整个文件，带上次的 `sha`）
- 409 / 422（别的设备抢先改过、已经有文件了）、带着 sha 却 404（文件被删了）：重新拉取、合并再传，最多传 4 次，重传前等一下（150 毫秒起、每次加倍，再加一点随机）；还不行报 `mergeFail`，下一轮再来
- ETag 只在合并成功以后记；数据最近一次没存进本机（空间满）时，`state.saveLocal` 写本机设置时一律不写云端版本号（`sync.sha`、`etag`；不管是同步一轮结束、改显示方式还是标「待同步」时存的），被关掉以后下次完整拉取。内存里留着，这次打开期间照常用
- 「有没传的修改」：`state.js` 每次本机修改都标 `sync.dirty`；上传前记下 `editVersion`，上传完它变了（上传期间又改过）就还是 dirty
- 同一时间只跑一轮。切到后台时（`pushFirst`）：知道云端版本、有改动就直接上传（不先拉取），请求体小于 60 KB 时用 `fetch` 的 `keepalive`。页面随时会被挂起，所以：「仓库是私有的」30 分钟内确认过就不再先问（平常的一轮还是 5 分钟）；正在跑一轮（比如刚切回来时的拉取）就先打断它（它的请求作废，算 `aborted`：不算出错、不标离线），不排在它后面
- 出错：`SyncError` 的 `code`——`net`（断网，只标离线）、`auth`（401）、`perm`（403）、`notfound`（404）、`public`、`classic`（经典令牌）、`notFine`（不是 `github_pat_` 开头的别的格式）、`noToken`（没填令牌）、`badToken`（令牌中间有空白）、`badRepo`（仓库名不对，`checkRepo`）、`badFile`（不是这个 App 的 / 读不出来，不覆盖）、`newer`（新版写的）、`mergeFail`、`rate`（429，或 403 + 剩余 0，或 403 + `Retry-After`：带着能再试的时刻 `until`，app 在那之前不自动同步）、`http`（别的状态码）；只读的 `readRemote` 还有 `off`（没开同步）、`nofile`（云端没有文件）。`net`、`rate`、`mergeFail`、`http` 5xx 是暂时的，状态标签显示「稍后重试」，别的要用户处理。`aborted`（被切到后台的直接上传打断）不存、不显示
- 本机数据读不出来（恢复页）时 `getConfig` 返回 null：一律不同步。「从云端恢复」另开一个只读的（`readRemote`，raw 格式），只读不写
- 以后有图片：照 babble 的录音，在拉取之后、上传 `picknest.json` 之前传本机还没上传的图片（按内容的 sha256 命名，只增不改），`core/sha256.js` 到那时再移植

## 备份（core/backup.js）

`picknest-backup-YYYYMMDD.json` = `{ app: 'picknest', v: 1, kind: 'backup', exportedAt, state }`。`state` 就是整份同步的数据（软删除的记录、不认识的集合和设置都在），没有令牌和本机设置。

从备份恢复 = `state.mergeIn`：逐条合并、较新的为准（各自从头建的同一条也和同步一样补字段）、补预置记录，备份里没有的不删（备份里更晚的删除照样合并进来），算本机修改（开着同步时 app 马上传，不等两秒的防抖）。读的时候认所有 `{ app: 'picknest', v: 1, state }` 形状的文件，读不出来按 `fileProblem` 说原因（`notJson`、`notApp`、`newer`、`bad`）。

恢复页修本机数据（`persistence.recover`）前存的原件在 `picknest.recovery.<时刻>.*`，只留最近一次的（`archive()` 和「设置 → 备份与恢复」只给最新的，旧的只占同一个域名下共用的空间）。

## 最近删除（core/deleted.js）

列的是 `deleted` 的清单、东西、食谱、商店、分类，各自 `deletedAt` 新的在前（`DELETED_KINDS` 的顺序就是页面上分组的顺序）。东西只列所在的清单没删除的：删掉的清单里的东西没有删除标记，只是跟着隐藏，恢复清单时一起回来。「清除已买」清掉的东西 `status` 还是 `done`，恢复后回到「已买」。

恢复 = `store.js` 的 `restoredRecord`（去掉删除标记，修改时间晚于删除）。不能恢复（`restoreBlock`）：这张清单上已经有同名的（`normName`）没删除的东西（同一张清单里同名的只能有一条）、已经有同名的商店、已经有会一起出现的同名分类（规则和新增、改名一样）、所在的清单也删了（先恢复清单）。食谱可以同名，总能恢复；删除、恢复食谱都不动清单上从它加进来的东西。

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
  icon: '' | '🪵' | '木工', glyph: '' | 'basket' | 'saw' | …, color: '' | 'green' | …, order: 0, defaultStoreId: 's_wholefoods' | null, archived: false }
```

- `kind`：`grocery` 是食材清单（以后接食谱、计划）；`general` 是一般物品（衣服、书、木工……），东西多一个「以后再说」状态
- 预置：`l_groceries`（`kind: 'grocery'`，默认商店 Whole Foods）、`l_tobuy`（`kind: 'general'`，没有默认商店）
- 显示名：`name.trim()`，空的话 `sys` 有就用文案，没有就是「未命名清单」
- 图标（规则在 `core/listIcons.js`，显示用 `ui/listTile.js` 的 `listTile`：圆角方块，底是色调的浅色、图标是深色，深色模式两样都换）是 `icon` 和 `glyph` 两个字段一起决定的，显示时（`listLook`）先看 `icon`、再看 `glyph`、都没有按类型的默认：
  - `icon`：自己写的，一个 emoji 或者一两个字（「木」「木工」）；存之前用 `customIcon` 截（emoji 只留一个；字最多两个，遇到空格、emoji 截断）。旧版存的 emoji（🪵）照样是自己写的图标
  - `glyph`：画好的线条图标的名字，`LIST_GLYPHS` 里的（`basket` 菜篮、`bag` 购物袋、`saw` 木工……共 30 个，只能加、不能改名）。旧记录没有这个字段，读进来是空的。认不出的名字（新版才有的）按默认显示，记录里原样留着
  - 都空的：按 `kind` 的默认（`LIST_DEFAULTS`：食材 → 菜篮、一般 → 购物袋）。预置的两张清单一直是空的，换了默认样子不用改数据
  - 为什么画好的不放在 `icon` 里：旧版（v15 和更早的）保存编辑面板时总会交回 `icon`、再截成第一个字，`i:saw` 这样的写法在旧设备上改个名字就变成字母「i」。旧版不认识 `glyph`，原样留着（`{ ...旧的 }`），只是显示成它自己的默认 emoji；旧版在面板里选个 emoji 写进 `icon`，那就是这张清单最后一次换的图标，所以 `icon` 显示在前
- `color`：色调名，`LIST_COLORS` 里的（`green` App 的绿、`teal`、`blue`、`indigo`、`rose`、`amber`、`clay` 陶土、`graphite`；只能加、不能改名），空的按 `kind` 的默认（食材 → 绿、一般 → 琥珀）。旧记录没有这个字段，读进来是空的。认不出的（新版才有的）按默认显示，记录里原样留着（旧版改名字不会冲掉）
- 新建、编辑时经过 `lookFields(kind, { icon, glyph, color })`：图标是一个选择，`icon`、`glyph` 只留一样（自己写的优先），画好的只收认得的名字、自己写的照上面截、认不出的颜色存空的；**和这一类的默认一样的存成空的**（没改过的预置清单还是空的、`updatedAt` 还是 0）。编辑面板只交改了的：换了图标 `icon`、`glyph` 一起交（`editList` 两样一起存），只换颜色只交 `color`（认不出的图标、色调显示成默认，没动就不交）。还不能用照片当图标：要等图片能同步（ROADMAP「图片」）
- 系统清单能改名、换图标和颜色、归档，不能删除；自建清单能删除（软删除，里面的东西不动、跟着隐藏，恢复清单时一起回来）
- 新建的 `order` = 现有清单（没删除的）里最大的 + 1；`kind` 只在新建时选，以后不改（东西的分类、「以后再说」都跟着它）
- `defaultStoreId` 只收没删除、没归档的商店；归档了的照样留着，只是新加东西时不再当默认
- 首页排顺序（↑↓）：挪到相邻的一张（没归档的）的另一边，**只改这一张的 `order`**：取新位置前后两条的中间值（可以是小数），别的记录不动、不盖新时间——合并是整条取较新的，给没挪的记录（包括 `updatedAt: 0` 的预置记录）白盖一个新时间，会盖掉别的设备上对它的删除。归档的也算在「前后两条」里（它的 `order` 还占着位置，取消归档后回到原处）。前后两条的 `order` 一样（两台设备各自新建了一条）或者中间值已经分不开（同一处挪了很多次）时，才把所有的重写成 0、1、2……（只盖变了的）。在 `store.js` 的 `moveInOrder`，商店、分类也用它

## items — 清单里的一样东西

```js
{ id, listId, name, qty: 1 | null, unit: '', note: '',
  categoryId: null, storeId: null,
  status: 'need' | 'done' | 'later', doneAt: null,
  url: '', price: null,
  needs: {},
  fromLater: true /* 只在从「以后再说」勾成已买时有 */ }
```

- `qty`：数字或 `null`（不写数量）。新加的默认 1。显示时 `null` 不显示数量。编辑时只收 `null` 或 0 < q ≤ 9999
- `unit`：任意文字，空字符串是没有单位。常用单位在界面里给选项（个、袋、盒、瓶、包、罐、把、根、斤、磅、lb、oz、g、kg、mL、L……）
- `storeId`：**这次**打算在哪买，`null` 是未指定。长期习惯记在 `memory` 里，改这一项不影响习惯
- `status`：`need` 要买、`done` 已买、`later` 以后再说（只在 `kind: 'general'` 的清单里出现）。状态只有点左边的圆圈（勾掉 / 取消）和编辑面板的「状态」会改；一行往右滑露出「编辑」、往左露出「删除」（和面板里的删除同样是软删除），由 `items.js` 的 `swipeActions` 定（每一行都一样，不存任何东西）
- `fromLater`：从「以后再说」勾成已买的（`setStatus` 记，不是已买时 `normalizeItem` 去掉）。取消勾选时回哪由 `items.js` 的 `untickStatus` 定：有这个标记、勾上 30 分钟内（`UNTICK_MS`）、还在一般清单上 → 回「以后再说」（点错了再点一下就是没点过）；别的回「要买」
- `url`、`price`：一般物品可选填（手动粘贴链接，V1 不抓取网页）。`url` 只收 `http:` / `https:`（或空），`price` 是 `null` 或 ≥ 0
- `needs`：**食谱和计划加进来的用量**（第二版，见下面「来自食谱的数量」）：`{ [来源]: { qty: number|null, unit: '', label: '', recipeId: null } }`。读写时原样保留不认识的来源和字段。`qty` 是算出来的（按人数换算、几行相加），可以超过 9999（那是输入框的上限），`items.js` 的 `NEED_MAX`（999999）封顶，再大、不是正数的当没写

### 来自食谱的数量（`needs`，第二版）

一样东西要买的量分两部分：**自己加的**（`qty` + `unit`，快速添加、编辑面板里改的就是它）和**各道菜的**（`needs`，每个来源一份）。

- **来源的键**：从食谱页「加到清单」一次是 `a:<随机>`（每加一次是新的一份，同一道菜加两次就是两份）；从计划「生成购物清单」是 `p:<计划里那一道菜的 id>`（同一道菜再生成一次是替换，不会重复加）
- `label`：这道菜的名字（加的时候抄下来，食谱后来改名、删掉也看得懂）；`recipeId`：哪道食谱（可以是 `null`）
- **显示的总量**：自己加的和各来源里**单位一样**（`normName` 比单位）的相加；单位不一样的分开写：「洋葱 2.5 个 + 200 g」。自己加的是 `null`（没写数量）时只算各来源的；都没写数量就不显示数量。总数照 `qty` 的显示规则（整数原样、小数最多两位）
- **加进来时**（`core/items.js` 的 `addNeeds(state, listId, lines, source, { label, recipeId }, now)`，lines = [{ name, qty, unit }]，返回 `{ added, updated, ids }`）：先把同名（`normName`）的几行合在一起——单位一样的相加（没写数量的不算），单位不一样的另记一份，键是 `<来源>#2`、`#3`……（同一张清单里同名的只能有一条，一行一行加会把前一份替换掉）；再按 `itemId` 找这张清单上同名的
  - 有、而且是「要买」或「以后再说」：在它的 `needs` 里放这个来源（已经有同一个键就替换），状态变成「要买」，自己加的不动
  - 有、但已买或已清除，或者没有：新建 / 恢复成「要买」，**自己加的设成 `null`、`needs` 清空后只放这个来源**（上一次买过的那一轮不算了），其余照「新加一样东西时的默认值」（商店、分类；`unit` 用记住的单位，食谱里的单位只记在这一份里，不记进 memory）；`memory` 记一次用过（`uses`；已经在清单上的那种不算）
- **拿掉一个来源**（`removeNeeds(state, source)`：计划里删掉 / 挪走一道菜，或者改人数前先拿掉旧的；`<来源>#2` 这些一起拿掉）：只动「要买」「以后再说」的东西，已买、已清除的不动（买过的历史留着）；拿掉以后自己加的是 `null` 或 0、而且 `needs` 空了 → 这样东西本来就只是为这道菜加的，软删除；还有别的就留着。整个操作在一次 `ctx.mutate` 里，带撤销
- **改人数**：先 `removeNeeds` 这个来源，再按新的人数 `addNeeds`（只对还没买的）
- **勾成已买、清除已买**：`needs` 不改（已买的东西上留着这一轮是为哪几道菜买的）。这一轮买过了就不再算：再加回来时清空——从食谱加（`addNeeds`，上面「已买或已清除」那条）、快速添加或点联想（`addItem` 的 `'restored'`，见下面「固定 id」）都是；已买的**隔了 `UNTICK_MS`（30 分钟）才取消勾选**（又要买了：`setStatus`、编辑面板里改状态）也清空。留着的话再从食谱加一次会算两遍（「1 + 400 g」），第 9 步计划里删掉那道旧菜还会把又要买的东西拿掉。刚勾上就取消是点错了，照原样放回去；从「以后再说」恢复的（还没买过）也留着
- **显示**：`qtyParts(item)` → `[{ qty, unit }]`（自己加的那一份在前，别的按 `needs` 里出现的先后，单位用先出现的写法），`totalLabel(item)` 用「 + 」连起来；清单页、一家店、搜索、购物模式的每一行都是它（`ui/checklist.js`），每份不拆开折行。`needsOf(item)` → `[[键, { qty, unit, label, recipeId }]]`（编辑面板列出来；坏的来源跳过）
- **编辑面板**：有 `needs` 时数量那一项叫「自己加的」（改的只是 `qty`、`unit`），下面「来自食谱」列出每一份（菜名用抄下来的 `label`，空的用食谱现在的名字），每份能拿掉：点「保存」时交 `dropNeeds: [键…]`，`validateItemPatch` 换成 `clean.needs`（这时的 `needs` 去掉它们）。拿掉以后什么都不剩也照样留着（面板里的「保存」只改看得到的；不要了用「删除」）
- 合并（多台设备）：`needs` 是记录的一个字段，照整条取较新的；各自从头建的同一条（`mergeRecord`）里，较新的那条 `needs` 是空的、而且两条都还没买（要买 / 以后再说、没删除）才用另一条的（见上面「合并」）。从备份恢复也是这条路

### 固定 id（同一张清单里同名的东西是同一条记录）

`itemId(state, listId, name)` 返回这样东西在这张清单里该用的 id。固定 id 是 `'i_' + hash64(listId + '\n' + normName(name))`（FNV-1a 64 位，base36）；少传 `state` 会直接报错（不然会算出一个看着正常、其实不对的 id）。

1. 先找这张清单里同名（`normName` 一样）的记录，已买、已清除的也算。改名改成「牛奶」的、从别的清单移过来的、以前分到随机 id 的，都已经是「这张清单里的牛奶」。有几条时：没删除的优先，再固定 id 优先，再按 id 排（每台设备选的一样）
2. 没有同名的：用固定 id
3. 固定 id 已经被别的东西占了（那条记录改过名或移到了别的清单）：用 `'i_' + hash64(listId + '\n' + normName(name) + '\n' + n)` 里第一个空着的（n = 1、2……）。也是算出来的：两台设备同步过的数据一样，离线各加一次还是同一个 id（不用随机 id，不然同步后是两条）

调用的地方拿到 id 以后：

- 有这条、已经是「要买」：`'exists'`，提示「已经在清单上了」，什么也不改。例外：只是因为食谱在清单上（自己加的是 `null`、`needs` 不空），这次又**写了数量**（「洋葱 2」）→ `'own'`：写的数量（和单位）记成自己加的，各道菜的不动，提示「已经因为食谱在清单上了，另记了你自己要的 2」（明明写了要几个，不能只说一句就丢掉；以后计划里删菜时这样东西也不会被拿掉）。没写数量的照旧 `'exists'`
- 有这条、已买、以后再说或已清除：`'restored'`，恢复成「要买」，不新建（带着上次的分类、单位、备注、链接；商店按下面的默认值重新定；数量用这次写的或 1）。已买、已清除的 `needs` 清空（那一轮已经买过了，见「来自食谱的数量」），以后再说的留着
- 没有这条：`'added'`，新建

这些在 `core/items.js` 的 `addItem` / `addFromInput`（先用 `core/parse.js` 的 `parseQuickAdd` 拆出数量和单位）。

### 移到别的清单

同一条记录换 `listId`。目标清单上已经有同名的（没删除的）：页面先确认（`moveConflict`），然后合并成那一条（恢复成要买），这一条软删除——同一张清单里同名的只能有一条。合并时这一条的东西不丢（`mergeMoved`）：那一条空着的链接、价格、商店、分类（能给目标清单用的）用这一条的补上，两条的备注都有、不一样就接在后面；自己加的数量：那一条本来就在要买、而且自己写了数量的用它的，不然（已买、只是因为食谱才在清单上）用这一条的，单位跟着数量走（「2 个」不能变成那一条的「2 g」；用那一条的数量时，它没写单位才补这一条的）；各道菜的那几份（`needs`）只带还没买的（要买 / 以后再说）那一条、这一条的，已买的那一条上是上一轮的，不带（不然上周买过的用量又回到清单上）。分类不能给目标清单用时按默认值重新定；移到食材清单时「以后再说」变成要买。

编辑面板的「保存」是 `editAndMove(state, id, patch, toListId)`：改和移在一起做，这次改过的字段（`patch` 里的）合并时以这一条为准、落在留下来的那一条上（不是改在随后被删掉的这一条上）；同时改名时名字只和要去的清单比（`validateItemPatch` 的 `moving`），那边有同名的就是合并。

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

- 每个 `normName` 一条，不分清单（砂纸在哪张清单里都记得去 Home Depot 买）。还有 `staple: true`（常备品，第二版；见下面），没标的记录上没有这个键
- **加进清单时**（新加或恢复；已经在清单上的不算）：`uses + 1`、`lastAt`、`name`（最近一次的写法）、`kind`；输入里写了单位也记成 `unit`
- **勾成已买时**：这次的 `storeId` 计数 `n + 1`、`at` 更新（没指定商店就不计；指定的商店删掉了也当没指定，不记到那家：`items.js` 的 `storeKeyOf`，和「商店」页的数法一样）。勾上 30 分钟内（`UNTICK_MS`，按 `doneAt` 算）又取消，算点错了 / 没买成，把那次减回去（减到 0 去掉这家店，`at` 不动）；隔久了再取消是又要买了，那次照样算（不然每次从「已买」点回来都减一次，常去的商店永远只记得最近一次）。已买的东西改了商店或名字（`normName` 变了），那一次挪过去：从旧的减掉、记到新的上
- **改分类、单位时**（编辑面板）：记下来，下次同名的东西直接用。改分类时同时记 `categorySet: true`：改成「未分类」（`categoryId: null`）和「没改过」（也是 `null`）要分得开，不然分错的又按对照表猜回来；没选过的记录上没有这个键
- **常去的商店** `usualStore(memory)`：`n` 最大的，一样多取 `at` 最新的；跳过已删除、已归档的商店。偶尔换一家买一次不会改掉习惯
- **常备品** `staple: true`（第二版）：盐、油、生抽这类家里一般都有的，在「加到清单」的面板里标一次（按名字记，不分食谱），以后从任何食谱、计划加食材时默认不勾；取消就去掉这个键。只影响默认勾不勾，不会自动从清单上拿掉什么。`isStaple(state, name)`、`setStaple(state, name, on)`（还没有这个名字的记录就新建一条，`uses` 是 0：只是记住了，不算买过；值没变不盖新时间）。面板里标的在「加到清单」确认时才记下（和加进去的东西在同一次修改里，一起撤销）
- 输入时的联想 `suggestions`：名字开头对上的在中间对上的前面，再按 `uses` 多的、`lastAt` 新的，最多 8 个；带着常去的商店、这样东西是不是已经在这张清单上要买

### 新加一样东西时的默认值

| 字段 | 依次取 |
|---|---|
| 商店 | 这样东西常去的商店 → 清单的默认商店（没删除、没归档）→ 未指定 |
| 分类 | 记住的分类（`categorySet` 而且是 `null`：用户选过「未分类」，就是未分类，不往下找）→（恢复时）这条记录上次的分类 → 内置常见食材对照（`core/catalog.js`，只给食材清单：牛奶→蛋奶、苹果→蔬果……）→ 未分类；都要是没删除、能给这种清单用的分类 |
| 单位 | 输入里写了就用（「面粉 1袋」）→ 记住的单位 →（恢复时）这条记录上次的单位 → 空 |
| 数量 | 输入里写了就用（「鸡蛋 12」「2 牛奶」）→ 1 |

## recipes — 食谱（第二版）

```js
{ id: 'r_…', name: '', servings: 2 | null, steps: '', source: '', note: '',
  ings: [ { key: 'g_…', name: '', qty: number|null, unit: '', note: '', optional: false } ] }
```

- `servings`：几人份，`null` = 没写（加到清单时就不能按人数换算，用量原样）；整理时不是正数的当 `null`，编辑页只收空着或 0 < n ≤ 99（`SERVINGS_MAX`）
- `ings`：食材，按顺序；`key` 在这道食谱里不重复（新行 `newId('g_')`），排顺序、改名都不变。`qty` 是 `null` 时是「适量」「少许」这种，原话放在 `note` 里；`optional: true` 是可选（加到清单时默认不勾）。整理（`normalizeRecipe`）：不是对象的食材扔掉；`key` 缺了、不符合 `safeKey`、重了的按位置补 `'g_' + 第几样`（被占了再加 `_1`、`_2`……；要每台设备算得一样，不能随机）；`qty` 不是正数的当 `null`；食材里不认识的字段原样留着
- `steps`：做法，多行文字；`source`：来源（链接或一句话，链接只当 `http:` / `https:` 打开，新标签页、不带来源）；`note`：备注
- 删除是软删除（`deleteRecipe`），进最近删除；加进清单的东西不动；计划里连着它的菜照样显示抄下来的名字
- 合并：id 是随机的（`newId('r_')`），没有「各自从头建的同一条」，照旧整条取较新的（食材的顺序、删掉的行不会被旧的补回来）
- **新建、改** `saveRecipe(state, id | null, input)`：先 `validateRecipe`（名字不能空；几人份空着或 0–99；全空的食材行扔掉，没名字的、数量不对的按行报错 `errors.ings[第几行]`；数量、几人份可以是输入框里的字），有错什么也不改；改的时候原来那一行（按 `key`）上不认识的字段留着；这道食谱已经删了 → `errors.recipe`（编辑页问要不要存成新的）
- **按人数换算** `scaleIngredients(recipe, servings)`：`qty × servings / recipe.servings`，四舍五入到两位小数（太小的至少 0.01）；`qty` 是 `null`、食谱没写人数、`servings` 不是正数的原样。换算出来的可以超过 9999（2 人份的 2000 ml 水，10 人份是 10000 ml），只在 `NEED_MAX` 封顶
- **粘贴食材** `parseIngredients(text)` → `[{ name, qty, unit, note, optional }]`（最多 200 样）：
  - 每一行先把表情换成空格（小红书的笔记到处是：「✅食材：」「✨用料✨」「💡做法：」「🥩五花肉」「1️⃣ 鸡蛋」「▪️牛腩」；连着的变体选择符 U+FE0F、零宽连接、肤色、旗帜、按键数字 1️⃣ / 1⃣️ 一起）：开头的就和列表符号一样去掉了，标题、「做法」前后带表情照样认得；名字里留着表情的话和清单上的东西、常备品都对不上（`normName` 不去表情）
  - 按换行拆，一行里再按「、」「，」「；」「｜」拆（有汉字的行英文逗号、分号也算，「 / 」后面是汉字时也算：「柠檬汁 15ml / 蜂蜜 10g」；没有汉字的行英文逗号后面当备注：「1 onion, diced」）；有汉字的行里空格隔开的几样也拆（左边以数量或「适量」结尾、右边是汉字开头才拆：「五花肉500g 冰糖20g」是两样，「五花肉 500g」还是一样；右边是左边那个数量的单位时不拆：「鸡蛋 3 个」「五花肉 500 克」；右边是「约」「各」开头的是补充，进备注）
  - 去掉开头的「食材：」「用料：」「配料：」「材料」「主料」「辅料」「调料」「【调料】」「Ingredients:」（后面要跟冒号、空白或者结束：「调料包 1 个」是一样东西）、序号（「1.」「1、」「(1)」「①」「-」「•」「·」；「1.5斤」的「1.」不是序号）；到「做法」「步骤」「Instructions」那一行就停（整篇笔记贴进来时做法不算食材）
  - 每段用 `parseQuickAdd(段, { recipe: true })`（食材清单的规则，多认食谱的单位 `RECIPE_UNITS`：两、勺、汤匙、大勺、小勺、茶匙、碗、瓣、撮、滴、cup、tbsp、tsp、clove……；g、克、kg、斤、ml、L、个、根、片、块、颗、粒、把、杯本来就认。「两」只在这里是单位，快速添加里是数字）拆出数量和单位
  - 「适量」「少许」「若干」「少量」「一点」「to taste」不算数量，写进 `note`（名字后面的冒号、「各」去掉：「盐：适量」「葱姜蒜各适量」）；括号里的、连着写的「约…」（「鸡翅8个约400g」）、「 / 」后面的另一种写法（「牛奶 250ml / 1杯」）写进 `note`（「可选」「optional」是 `optional: true`）
  - 「葱、姜、蒜 适量」「生抽、老抽各1勺」：写了「适量」/「各 + 数量」的那一段，也给**紧挨在它前面**、自己什么也没写（没数量、没备注）的几段，往前碰到写了的就停——「生抽、老抽各1勺，蚝油1勺，糖1小勺，盐少许」的生抽是 1 勺（不是后面盐的「少许」），「葱、姜、蒜 适量，盐 1小勺」的葱、姜是适量
  - 带分数「1 1/2 cups」「flour 2 1/4 cups」（分子比分母小）只在拆食谱时认（`parseQuickAdd` 的 `recipe`）；快速添加里「2 1/2 gal milk」照旧是 2 个「1/2 gal milk」。「½」这种字符不认，整段当名字
  - 空的段、#话题、只有标点和表情的扔掉。不确定的不猜：拆不出数量就整段当名字
- **搜索** `searchRecipes(state, query, collator)` → `[{ recipe, ings }]`：搜索词 `normName` 后按空格拆，每个词都要出现在名字或某一样食材里；`ings` 是命中的食材名（页面在名字没命中时写「用到：…」）；按名字排（collator），空的搜索词列全部
- **用到这样食材的食谱** `recipesUsing(state, name)`：`normName` 一样，或者食谱里那一行的 `normName` 包含它（它至少两个字）；没删除的，按名字排。清单页快速添加的联想只给食材清单、最多 3 道
- **加到清单**：能加到首页上的食材清单（`groceryLists`：没删除、没归档的 `kind: 'grocery'`），默认 `defaultTarget(state, 给的)`：给的那张 → 预置的「食材」→ 第一张 → 都没有是 `null`（面板说先新建一张）。每一行 `recipeLines(state, recipe, { servings, listId })` → 换算过的用量 + `staple` + `have`（这张清单上同名的、要买或以后再说的那一条）+ `haveLabel`（它的 `totalLabel`）+ `added` / `addedLabel`（`have` 的 `needs` 里有这道食谱加的那几份（`recipeId` 是它）、一共多少）+ `checked`（常备品、可选的、这道菜已经加过的不勾：再打开面板多半是来看加了什么，一下点确认就把用量翻倍了；勾上就是再加一份）；面板上标常备品是按名字的，同名的几行（腌料、调味里各一个「盐」）一起取消勾；确认 `addRecipeToList(state, recipe, { listId, servings, keys, staples, source })`：先 `setStaple` 这次标 / 取消的，再把勾上的 `addNeeds`（来源由页面给 `a:<随机>`，`label` 抄食谱名字、`recipeId`），在一次 `ctx.mutate` 里
- **编辑页的草稿**：`picknest.draft.recipe.<id | new>` = `{ w: 编辑页的工作副本, at }`，打字时随手存（0.4 秒防抖；切到后台（app 调页面的 `flush`）、`pagehide` 时马上存：iOS 页面一隐藏就停掉计时器），保存、取消、放弃（包括换页时问了点「放弃」）时删掉；下次打开同一个编辑页时接着用（说一句、可以放弃）。只在本机，不同步、不进备份

## plan — 计划（第二版）

```js
{ id: 'p_…', date: 'YYYY-MM-DD', meal: 'breakfast' | 'lunch' | 'dinner' | 'snack',
  recipeId: null, title: '', servings: 2 | null, note: '', order: 0 }
```

- 一条是某一天某一顿的一道菜。连着食谱的 `recipeId` 有值、`title` 抄下食谱名字（食谱改名后显示食谱的新名字，食谱删掉了显示 `title`）；只写一句的（「出去吃」）`recipeId` 是 `null`
- `date` 是本地日期（不带时区），一周从周一开始
- **生成购物清单** `planLines(state, from, to)`：这几天连着食谱的菜，按 `servings` 换算用量；列出来时同名（`normName`）同单位的合成一行、写着来自哪几道菜，单位不一样的分开；确认后**每道菜**用自己的来源 `p:<id>` `addNeeds`（所以删掉其中一道只减它那一份）
- **删掉 / 挪到别的日子 / 改人数 / 换食谱**：这道菜已经加进清单的那一份照「来自食谱的数量」的规则拿掉或重算；挪日子不改清单（还是同一道菜）
- 删除也是软删除（`deleted`），10 秒撤销；不进最近删除页面（太多太碎），撤销靠提示条

## stores — 商店

```js
{ id, name, order: 0, archived: false }
```

预置（固定 id，`updatedAt: 0`）：`s_wholefoods` Whole Foods、`s_traderjoes` Trader Joe's、`s_costco` Costco、`s_target` Target、`s_hmart` H Mart、`s_99ranch` 99 Ranch、`s_amazon` Amazon、`s_homedepot` The Home Depot。

线上商家也是商店。归档的商店不出现在选择列表里，但已经指定给它的东西照常显示。规则在 `core/stores.js`：

- **这家店的东西**：没删除、所在的清单没删除**也没归档**的东西里，`storeId` 是这家店的。`storeId` 是 `null`、指向删掉的或者不存在的商店：算「未指定」
- **还要买几样** `storeCounts`：只数 `status: 'need'`（以后再说、已买不算）。「商店」页的行 `storeRows`：没归档的商店按顺序（0 样的也列；只看一张清单时 0 样的不列，没列的有几家用 `emptyStoresIn`）；归档的商店只在还有要买的时候列，排在后面；最后「未指定」（有要买的才列）
- **一家店的页面** `groupStore`：要买的按分类分组（和清单页同一个 `group.js` 的 `groupItems`），已买的 `doneAt` 新的在前；「清除已买」`clearStoreDone` 只软删除这一页上的已买
- **只看一张清单**：`shoppingItems`、`storeCounts`、`storeRows`、`groupStore`、`clearStoreDone`（还有 `shop.js` 的 `shopProgress`）最后都收一个 `{ listId }`，`null` / 不给 = 所有清单。给了就只算这张清单上的：数、「商店」页哪家归档的店 / 「未指定」要列出来、要买的、已买的、清除已买（只清看得到的，别的清单在这家买到的不动）都一样。`listId` 原样用（删掉、归档的清单上本来什么也看不到）；页面先用 `storeFilter(state, local)` 取本机记着的（见下面「本机设置」），那张清单不在了它返回 `null`
- **选清单的面板** `storeFilterOptions(state, { storeId })` → `[{ id: null, list: null, n }, { id, list, n }…]`：「所有清单」在最前（`n` 是各张加起来），然后首页上的清单（`homeLists`：没删除、没归档，首页的顺序），`n` = 还要买几样；给了 `storeId`（`null` = 未指定）只数在这家店的，不给是所有店加起来
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

- **进度** `shopProgress(state, 'list' | 'store', id, { listId })` → `{ done, left, total, finished }`：清单 = 这张清单上没删除的 `need`（还剩）和 `done`（已买），用 `items.js` 的 `countItems`；一家店 = `groupStore` 里的（归档的清单不算，删掉的商店算「未指定」；商店页只看一张清单时给 `listId`，只数这张，清单的购物模式不用）。`以后再说` 不算。`finished` = 没有还剩的、而且有已买的（空的一页不算「买齐了」）。已买包括以前勾掉还没清除的（它们也在「已买」里），「清除已买」以后从 0 算
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
{ lang: null, theme: 'auto', device: null, lastBackupAt: null, tabNoteOff: false,
  sync: null | { repo: 'owner/pick-nest-data', token: 'github_pat_…', tokenExp: null /* 用户填的到期日 23:59 */,
                 sha, etag, dirty, at /* 上次同步成功 */, err: null | { code, vars }, offline },
  view: { [listId]: { groupBy: 'category' | 'store', showDone: true, showLater: true } },   // 认不出的值按默认（core/group.js 的 listView）；购物模式只用 groupBy
  storeView: { [storeId | 'none']: { showDone: true } },                                     // 商店页「已买」折没折；'none' 是「未指定」（core/group.js 的 storeView）
  storeFilter: null | listId }                                                                 // 按商店看时只看哪张清单（core/stores.js 的 storeFilter）
```

- `storeFilter`：「商店」页、每家店的页面、从商店进的购物模式共用一个（换一家店还是同一张）；`null` 是所有清单。读的时候一律经过 `stores.js` 的 `storeFilter(state, local)`：不是字符串、没有这张清单、删掉了、归档了 → 按所有清单显示（`null`），不提示，也不改记着的值（撤销删除、取消归档以后又按它筛）。改的时候用 `storeFilterPatch(listId)`；选清单的面板拿点的和**记着的**比（不是现在生效的）：记着的清单归档了、面板上勾着「所有清单」，再点「所有清单」也要记下来

- `device`：写进同步文件和提交说明的设备名；没设就用平台名（iPhone / iPad / Mac，`core/sync.js` 的 `platformDevice`）
- `tabNoteOff`：在浏览器标签页里打开时（`navigator.standalone` 不是 true、也不是 `display-mode: standalone`；iPhone / iPad 和 Mac 的 Safari 说法不同，见 `views/lists.js` 的 `tabNoteKind`）首页那句「和主屏幕 / 程序坞上的不是同一份数据」点过「知道了」
- `lastBackupAt`：这台设备上次导出 / 分享备份的时刻（设置首页「数据」下面和「备份与恢复」里写「上次备份：今天 / n 天前」，`core/backup.js` 的 `backupAge`：没有或 ≥ 30 天提醒）
- `tokenExp`：用户填的到期日那天 23:59（`dates.js` 的 `endOfDay`；2000 年以前的不收：用键盘填日期时年份是一位一位进去的，0002 也是「合法」的日期）
- 同步码 = `picknest-sync:<owner/repo>:<令牌>[:<到期日 YYYY-MM-DD>]`（`syncCode` / `parseSyncCode`，前缀是参数）。到期日是每台设备自己的本机设置，带在同步码里，用它连上的设备也会提前提醒
- 只收 Fine-grained 令牌（`tokenProblem`，只认 `github_pat_` 前缀）：`ghp_`、`gho_`、`ghu_`、`ghs_`、`ghr_` 开头的和以前没有前缀的 40 位十六进制（都是经典令牌，GitHub 照样收）报 `classic`，别的格式报 `notFine`，都不拿来发任何请求（`readRemote` 也一样）
