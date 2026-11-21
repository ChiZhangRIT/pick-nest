// 购物模式：开始 / 完成购物、进度、都买齐了、屏幕常亮的那一行（「已买」「清除已买」用清单页的 list.*）。
// 繁體（台灣）用台灣用語（螢幕、裝置……）；动态字段 {x} 三种语言一致（测试会查）。英文单复数：en(一个, 多个)
const en = (one, many) => (v) => (Number(v.n) === 1 ? one : many).replace('{n}', v.n);

export const STRINGS = {
  'zh-Hans': {
    'shop.start': '开始购物', 'shop.finish': '完成购物',
    'shop.progress': '已买 {done} · 还剩 {left}', 'shop.progressLabel': '购物进度',
    'shop.allDone': '都买齐了', 'shop.allDoneHint': '这一页上的 {n} 样都买到了。',
    'shop.nothing': '这里没有要买的东西', 'shop.nothingHint': '在清单里加上要买的，再来开始购物。',
    'shop.noWake': '这台设备不支持让屏幕保持常亮', 'shop.wakeFail': '没能让屏幕保持常亮（比如开着低电量模式）',
  },
  'zh-Hant-TW': {
    'shop.start': '開始購物', 'shop.finish': '完成購物',
    'shop.progress': '已買 {done} · 還剩 {left}', 'shop.progressLabel': '購物進度',
    'shop.allDone': '都買齊了', 'shop.allDoneHint': '這一頁上的 {n} 樣都買到了。',
    'shop.nothing': '這裡沒有要買的東西', 'shop.nothingHint': '在清單裡加上要買的，再來開始購物。',
    'shop.noWake': '這臺裝置不支援讓螢幕保持開啟', 'shop.wakeFail': '無法讓螢幕保持開啟（例如開著低耗電模式）',
  },
  en: {
    'shop.start': 'Start Shopping', 'shop.finish': 'Done Shopping',
    'shop.progress': '{done} bought · {left} to go', 'shop.progressLabel': 'Shopping progress',
    'shop.allDone': 'All done!', 'shop.allDoneHint': en('You got the {n} item on this page.', 'You got all {n} items on this page.'),
    'shop.nothing': 'Nothing to buy here', 'shop.nothingHint': 'Add things to the list, then start shopping.',
    'shop.noWake': 'This device can’t keep the screen on', 'shop.wakeFail': 'Couldn’t keep the screen on (Low Power Mode may be on)',
  },
};
