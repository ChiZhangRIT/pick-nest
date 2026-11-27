// 屏幕常亮：清单页、商店页 ⋯ 里的开关，开着时顶栏上的小标签（ui/keepAwake.js）。
// 繁體（台灣）用台灣用語（螢幕、裝置、低耗電模式……；「常亮」說成「保持開啟」，和 iOS 的說法一樣）；动态字段 {x} 三种语言一致（测试会查）
export const STRINGS = {
  'zh-Hans': {
    'awake.title': '屏幕常亮',
    'awake.hint': '在清单页和商店页上不让屏幕变暗。只记在这台设备上',
    'awake.deniedHint': '刚才没能让屏幕常亮（比如开着低电量模式）',
    'awake.unsupported': '这台设备不支持让屏幕常亮。可以在系统设置里把「自动锁定」调长一点',
    'awake.on': '屏幕常亮中', 'awake.onLabel': '屏幕常亮中，点一下关掉',
    'awake.denied': '没能常亮', 'awake.deniedLabel': '没能让屏幕常亮，点一下再试一次',
    'awake.turnedOff': '已关掉屏幕常亮',
  },
  'zh-Hant-TW': {
    'awake.title': '螢幕保持開啟',
    'awake.hint': '在清單頁和商店頁上不讓螢幕變暗。只記在這臺裝置上',
    'awake.deniedHint': '剛才無法讓螢幕保持開啟（例如開著低耗電模式）',
    'awake.unsupported': '這臺裝置不支援讓螢幕保持開啟。可以在系統設定裡把「自動鎖定」調長一點',
    'awake.on': '螢幕保持開啟中', 'awake.onLabel': '螢幕保持開啟中，點一下關閉',
    'awake.denied': '無法保持開啟', 'awake.deniedLabel': '無法讓螢幕保持開啟，點一下再試一次',
    'awake.turnedOff': '已關閉螢幕保持開啟',
  },
  en: {
    'awake.title': 'Keep Screen On',
    'awake.hint': 'Stops the screen from dimming on list and store pages. Saved on this device only',
    'awake.deniedHint': 'Couldn’t keep the screen on just now (Low Power Mode may be on)',
    'awake.unsupported': 'This device can’t keep the screen on. You can set Auto-Lock to a longer time in Settings',
    'awake.on': 'Screen On', 'awake.onLabel': 'Screen is kept on. Tap to turn off',
    'awake.denied': 'Screen May Dim', 'awake.deniedLabel': 'Couldn’t keep the screen on. Tap to try again',
    'awake.turnedOff': 'Keep Screen On is off',
  },
};
