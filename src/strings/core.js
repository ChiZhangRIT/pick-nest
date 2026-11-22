// 公共文案：common.* 通用按钮和提示、nav.* 导航。
// 繁體（台灣）用台灣用語（設定、儲存、復原…）；动态字段 {x} 三种语言一致（测试会查）。
export const STRINGS = {
  'zh-Hans': {
    'common.appName': 'PickNest', 'common.cancel': '取消', 'common.confirm': '确定', 'common.close': '关闭',
    'common.undo': '撤销', 'common.undone': '已撤销', 'common.restored': '已恢复',
    'common.save': '保存', 'common.keepEditing': '继续编辑', 'common.delete': '删除', 'common.more': '更多',
    'common.storageFull': '这台设备的存储空间满了，刚才的修改没能保存。请先清理一些空间再试。',
    'common.renderError': '这一页出错了：', 'common.safeMode': '数据还在。可以先导出一份留着。',
    'common.exportRaw': '导出数据（JSON）',

    'nav.label': '主导航', 'nav.lists': '清单', 'nav.stores': '商店', 'nav.settings': '设置', 'nav.search': '搜索',
  },

  'zh-Hant-TW': {
    'common.appName': 'PickNest', 'common.cancel': '取消', 'common.confirm': '確定', 'common.close': '關閉',
    'common.undo': '復原', 'common.undone': '已復原', 'common.restored': '已還原',
    'common.save': '儲存', 'common.keepEditing': '繼續編輯', 'common.delete': '刪除', 'common.more': '更多',
    'common.storageFull': '這臺裝置的儲存空間滿了，剛才的修改沒能儲存。請先清出一些空間再試。',
    'common.renderError': '這一頁出錯了：', 'common.safeMode': '資料還在。可以先匯出一份留著。',
    'common.exportRaw': '匯出資料（JSON）',

    'nav.label': '主要導覽', 'nav.lists': '清單', 'nav.stores': '商店', 'nav.settings': '設定', 'nav.search': '搜尋',
  },

  en: {
    'common.appName': 'PickNest', 'common.cancel': 'Cancel', 'common.confirm': 'OK', 'common.close': 'Close',
    'common.undo': 'Undo', 'common.undone': 'Undone', 'common.restored': 'Restored',
    'common.save': 'Save', 'common.keepEditing': 'Keep editing', 'common.delete': 'Delete', 'common.more': 'More',
    'common.storageFull': "This device's storage is full, so the last change wasn't saved. Free up some space and try again.",
    'common.renderError': 'This page hit an error:', 'common.safeMode': 'Your data is still here. You can export a copy first.',
    'common.exportRaw': 'Export data (JSON)',

    'nav.label': 'Main', 'nav.lists': 'Lists', 'nav.stores': 'Stores', 'nav.settings': 'Settings', 'nav.search': 'Search',
  },
};
