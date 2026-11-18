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

## 所有记录都有的字段

| 字段 | 说明 |
|---|---|
| `id` | 符合 `safeKey`（`^[A-Za-z0-9_.:@-]{1,200}$`，不能是 `__proto__` 等） |
| `createdAt` / `updatedAt` | 毫秒。改动一律经过 `stamp()`：比上一版至少新 1 毫秒 |
| `deleted` / `deletedAt` | 软删除。内容保留，照样同步，「最近删除」里能恢复；不做硬删除 |

不认识的字段、不认识的集合原样保留（旧版 App 同步时不会弄丢新版的数据）。读入本机、云端、备份时都经过 `normalizeState()`：坏记录丢掉，能修的修好，用户写的文字一个字都不改。

## 合并（多台设备）

V1 沿用 babble：**逐条记录比 `updatedAt`，取较新的整条**；时间相同按 `canon()` 序列化比较，保证每台设备结果一样。设置按键合并（`settingsAt`）。

现在只有自己用，同一时刻在两台设备上改同一样东西的情况很少，整条覆盖可以接受。以后多人共用时改成按字段合并（见 ROADMAP），数据形状不用变。

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
- 系统清单能改名、换图标、归档，不能删除；自建清单能删除（软删除，里面的东西跟着隐藏，恢复清单时一起回来）

## items — 清单里的一样东西

```js
{ id, listId, name, qty: 1 | null, unit: '', note: '',
  categoryId: null, storeId: null,
  status: 'need' | 'done' | 'later', doneAt: null,
  url: '', price: null,
  needs: {} }
```

- `qty`：数字或 `null`（不写数量）。新加的默认 1。显示时 `null` 不显示数量
- `unit`：任意文字，空字符串是没有单位。常用单位在界面里给选项（个、袋、盒、瓶、包、罐、把、根、斤、磅、lb、oz、g、kg、mL、L……）
- `storeId`：**这次**打算在哪买，`null` 是未指定。长期习惯记在 `memory` 里，改这一项不影响习惯
- `status`：`need` 要买、`done` 已买、`later` 以后再说（只在 `kind: 'general'` 的清单里出现）
- `url`、`price`：一般物品可选填（手动粘贴链接，V1 不抓取网页）
- `needs`：**预留给食谱和计划**：`{ [来源]: { qty, unit, label } }`。V1 永远是 `{}`，但读写时原样保留。到时 `qty` 表示手动加的那一部分，总数 = 手动 + 各来源（同单位才相加）

### 固定 id（同一张清单里同名的东西是同一条记录）

`itemId(listId, name) = 'i_' + hash64(listId + '\n' + normName(name))`（FNV-1a 64 位，base36）。

- 再加一次「牛奶」：找到这条记录（已买、已清除也算）就恢复成「要买」，不新建
- 已经是「要买」：提示「已经在清单上了」，不重复添加
- 这个 id 已经被别的东西占了（那条记录改过名，`normName` 对不上）：用随机 id `newId('i_')`
- 好处：清单记录的数量 ≈ 不同东西的个数，不会越买越多；两台设备离线时各加一次「牛奶」，同步后还是一条

`normName(s)`：NFKC → 去首尾空格 → 连续空白合成一个 → 小写 → 繁体折成简体（`hanzi.js`）。只用来比较和算 id，不改用户写的名字。

### 「清除已买」

把已买的东西软删除（不是改状态）。以后再加同名的东西会恢复同一条记录。

## memory — 买过的东西（跨清单的习惯）

```js
{ id: 'm_' + hash64(normName), name, kind: 'grocery' | 'general',
  categoryId: null, unit: '', qty: null,
  stores: { [storeId]: { n: 3, at: 1731900000000 } },
  uses: 0, lastAt: 0 }
```

- 每个 `normName` 一条，不分清单（砂纸在哪张清单里都记得去 Home Depot 买）
- **加进清单时**：`uses + 1`、`lastAt`、`name`（最近一次的写法）、`kind`
- **勾成已买时**：这次的 `storeId` 计数 `n + 1`、`at` 更新（没指定商店就不计）
- **改分类、单位时**：记下来，下次同名的东西直接用
- **常去的商店** `usualStore(memory)`：`n` 最大的，一样多取 `at` 最新的；跳过已删除、已归档的商店。偶尔换一家买一次不会改掉习惯
- 输入时的联想（最近、常买的东西）也从这里来

### 新加一样东西时的默认值

| 字段 | 依次取 |
|---|---|
| 商店 | 这样东西常去的商店 → 清单的默认商店 → 未指定 |
| 分类 | 记住的分类 → 内置常见食材对照（牛奶→蛋奶、苹果→蔬果……）→ 未分类 |
| 单位 | 输入里写了就用（「面粉 1袋」）→ 记住的单位 → 空 |
| 数量 | 输入里写了就用（「鸡蛋 12」「2 牛奶」）→ 1 |

## stores — 商店

```js
{ id, name, order: 0, archived: false }
```

预置（固定 id，`updatedAt: 0`）：`s_wholefoods` Whole Foods、`s_traderjoes` Trader Joe's、`s_costco` Costco、`s_target` Target、`s_hmart` H Mart、`s_99ranch` 99 Ranch、`s_amazon` Amazon、`s_homedepot` The Home Depot。

线上商家也是商店。归档的商店不出现在选择列表里，但已经指定给它的东西照常显示。

## categories — 分类

```js
{ id, sys: 'produce' | … | null, name: '', kind: 'grocery' | 'general' | null, order: 0 }
```

- `kind`：只给食材清单用、只给一般清单用，或者 `null` 两边都用
- 预置食材分类：蔬果 produce、肉类海鲜 meat、蛋奶 dairy、面包烘焙 bakery、冷冻 frozen、粮油干货 pantry、调料酱料 condiments、零食饮料 snacks、日用清洁 household
- 预置一般分类：衣物 clothing、书籍 books、工具五金 tools、数码 electronics、家居 home
- 没有分类的东西归在「未分类」，排在最后

## 排序

- 清单：`order`，再 `createdAt`
- 清单里「要买」的东西：按分类（或按商店）分组，组按 `order`，「未分类 / 未指定」在最后；组内按名字（`localeCompare`，中文用拼音顺序）
- 「已买」：`doneAt` 新的在前

## 本机设置 picknest.local（不同步）

```js
{ lang: null, theme: 'auto', device: null, sync: null, lastBackupAt: null,
  view: { [listId]: { groupBy: 'category' | 'store', showDone: true } } }
```
