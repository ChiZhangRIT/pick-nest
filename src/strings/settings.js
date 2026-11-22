// 设置页：外观、商店和分类、同步和数据的入口、关于（同步、数据、最近删除这几页自己的文案在 strings/sync.js、strings/data.js）。语言那一行的标题中英文写在一起（views/settings.js 的 LANG_ROW：繁体界面写「語言」），不在这里。
export const STRINGS = {
  'zh-Hans': {
    'set.stores': '商店', 'set.categories': '分类', 'set.sync': '同步', 'set.data': '数据',
    'set.theme': '外观', 'set.theme.auto': '自动', 'set.theme.light': '浅色', 'set.theme.dark': '深色',
    'set.aboutH': '关于', 'set.aboutLine': '食材、日用品、想买的东西，都在一个清单 App 里',
    'set.about1': '数据保存在这台设备的浏览器里；开了同步时另存一份到你自己的 GitHub 私有仓库，不经过任何别的服务器。', 'set.version': '版本 {v}',
    'set.updateReady': '新版本已经下载好了：关掉 PickNest 再打开就是新版。',
  },
  'zh-Hant-TW': {
    'set.stores': '商店', 'set.categories': '分類', 'set.sync': '同步', 'set.data': '資料',
    'set.theme': '外觀', 'set.theme.auto': '自動', 'set.theme.light': '淺色', 'set.theme.dark': '深色',
    'set.aboutH': '關於', 'set.aboutLine': '食材、日用品、想買的東西，都在一個清單 App 裡',
    'set.about1': '資料儲存在這臺裝置的瀏覽器裡；開了同步時另存一份到你自己的 GitHub 私人儲存庫，不經過任何其他伺服器。', 'set.version': '版本 {v}',
    'set.updateReady': '新版本已經下載好了：關掉 PickNest 再開啟就是新版。',
  },
  en: {
    'set.stores': 'Stores', 'set.categories': 'Categories', 'set.sync': 'Sync', 'set.data': 'Data',
    'set.theme': 'Appearance', 'set.theme.auto': 'Auto', 'set.theme.light': 'Light', 'set.theme.dark': 'Dark',
    'set.aboutH': 'About', 'set.aboutLine': 'Groceries, household things and wish lists in one list app',
    'set.about1': "Your data is stored in this device's browser. With sync on, a copy also goes to your own private GitHub repository, never through any other server.", 'set.version': 'Version {v}',
    'set.updateReady': 'A new version has been downloaded. Close PickNest and open it again to use it.',
  },
};
