// 设置页：外观、关于。语言那一行的标题三种语言写在一起（views/settings.js 里的「语言 / Language」），不在这里。
export const STRINGS = {
  'zh-Hans': {
    'set.theme': '外观', 'set.theme.auto': '自动', 'set.theme.light': '浅色', 'set.theme.dark': '深色',
    'set.aboutH': '关于', 'set.aboutLine': '食材、日用品、想买的东西，都在一个清单 App 里',
    'set.about1': '数据只保存在这台设备的浏览器里，不经过任何服务器。', 'set.version': '版本 {v}',
  },
  'zh-Hant-TW': {
    'set.theme': '外觀', 'set.theme.auto': '自動', 'set.theme.light': '淺色', 'set.theme.dark': '深色',
    'set.aboutH': '關於', 'set.aboutLine': '食材、日用品、想買的東西，都在一個清單 App 裡',
    'set.about1': '資料只儲存在這臺裝置的瀏覽器裡，不經過任何伺服器。', 'set.version': '版本 {v}',
  },
  en: {
    'set.theme': 'Appearance', 'set.theme.auto': 'Auto', 'set.theme.light': 'Light', 'set.theme.dark': 'Dark',
    'set.aboutH': 'About', 'set.aboutLine': 'Groceries, household things and wish lists in one list app',
    'set.about1': "Your data is stored only in this device's browser and never goes through a server.", 'set.version': 'Version {v}',
  },
};
