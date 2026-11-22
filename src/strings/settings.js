// 设置页：同步、商店和分类、外观、数据（备份与恢复、最近删除）的入口和每组下面的一句、关于（同步、数据、最近删除这几页自己的文案在 strings/sync.js、strings/data.js）。
// 语言那一行的标题中英文写在一起（views/settings.js 的 LANG_ROW：繁体界面写「語言」），不在这里。
// 叫法和别的几个 App（Babble、房屋账本、书架）一致：「多设备同步」「备份与恢复」「上次备份：n 天前」。
const plural = (n, one, many) => (Number(n) === 1 ? one : many);

export const STRINGS = {
  'zh-Hans': {
    'set.syncH': '同步', 'set.sync': '多设备同步', 'set.syncRepo': '仓库：{repo}', 'set.syncOffFoot': '用你自己的 GitHub 私有仓库，在 iPhone、iPad、Mac 之间同步。',
    'set.manageH': '商店和分类', 'set.stores': '商店', 'set.categories': '分类',
    'set.lookH': '外观', 'set.theme': '外观', 'set.theme.auto': '自动', 'set.theme.light': '浅色', 'set.theme.dark': '深色',
    'set.dataH': '数据', 'set.data': '备份与恢复',
    'set.backupLast': '上次备份：{when}', 'set.backupNever': '还没备份过', 'set.backupToday': '今天', 'set.backupAgo': '{n} 天前',
    'set.aboutH': '关于', 'set.aboutLine': '食材、日用品、想买的东西，都在一个清单 App 里',
    'set.about1': '数据保存在这台设备的浏览器里；开了同步时另存一份到你自己的 GitHub 私有仓库，不经过任何别的服务器。', 'set.version': '版本 {v}',
    'set.updateReady': '新版本已经下载好了：关掉 PickNest 再打开就是新版。',
  },
  'zh-Hant-TW': {
    'set.syncH': '同步', 'set.sync': '多裝置同步', 'set.syncRepo': '儲存庫：{repo}', 'set.syncOffFoot': '用你自己的 GitHub 私人儲存庫，在 iPhone、iPad、Mac 之間同步。',
    'set.manageH': '商店和分類', 'set.stores': '商店', 'set.categories': '分類',
    'set.lookH': '外觀', 'set.theme': '外觀', 'set.theme.auto': '自動', 'set.theme.light': '淺色', 'set.theme.dark': '深色',
    'set.dataH': '資料', 'set.data': '備份與還原',
    'set.backupLast': '上次備份：{when}', 'set.backupNever': '還沒備份過', 'set.backupToday': '今天', 'set.backupAgo': '{n} 天前',
    'set.aboutH': '關於', 'set.aboutLine': '食材、日用品、想買的東西，都在一個清單 App 裡',
    'set.about1': '資料儲存在這臺裝置的瀏覽器裡；開了同步時另存一份到你自己的 GitHub 私人儲存庫，不經過任何其他伺服器。', 'set.version': '版本 {v}',
    'set.updateReady': '新版本已經下載好了：關掉 PickNest 再開啟就是新版。',
  },
  en: {
    'set.syncH': 'Sync', 'set.sync': 'Multi-device sync', 'set.syncRepo': 'Repository: {repo}', 'set.syncOffFoot': 'Sync between your iPhone, iPad and Mac through your own private GitHub repository.',
    'set.manageH': 'Stores & Categories', 'set.stores': 'Stores', 'set.categories': 'Categories',
    'set.lookH': 'Appearance', 'set.theme': 'Appearance', 'set.theme.auto': 'Auto', 'set.theme.light': 'Light', 'set.theme.dark': 'Dark',
    'set.dataH': 'Data', 'set.data': 'Backup & Restore',
    'set.backupLast': 'Last backup: {when}', 'set.backupNever': 'never', 'set.backupToday': 'today', 'set.backupAgo': v => `${v.n} ${plural(v.n, 'day', 'days')} ago`,
    'set.aboutH': 'About', 'set.aboutLine': 'Groceries, household things and wish lists in one list app',
    'set.about1': "Your data is stored in this device's browser. With sync on, a copy also goes to your own private GitHub repository, never through any other server.", 'set.version': 'Version {v}',
    'set.updateReady': 'A new version has been downloaded. Close PickNest and open it again to use it.',
  },
};
