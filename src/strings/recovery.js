// 本机数据读不出来时的恢复页（ui/recovery.js）。从备份、从云端恢复等第 5 步有了备份和同步再加文案。
// 英文单复数
const plural = (n, one, many) => (Number(n) === 1 ? one : many);

export const STRINGS = {
  'zh-Hans': {
    'recovery.title': '本机数据需要恢复',
    'recovery.intro': '有数据没能读出来，已经暂停修改。原始内容没有被覆盖。',
    'recovery.unavailable': '暂时无法安全读写本机数据。请重新读取，并确认浏览器的本机存储可以正常使用（比如没有在用无痕浏览）。',
    'recovery.readable': '目前能读出 {lists} 张清单、{items} 样东西。',
    'recovery.export': '下载原始数据', 'recovery.exportHint': '先留一份原始数据，方便以后排查；文件里没有同步令牌。',
    'recovery.retry': '重新读取', 'recovery.keep': '保留读得出来的部分，继续使用',
    'recovery.confirm': '恢复本机数据？',
    'recovery.keepConfirm': '读不出来的内容只会留在本机的原始数据存档里，不会出现在清单上。建议先下载原始数据。仍要继续吗？',
    'recovery.go': '恢复并继续', 'recovery.working': '正在处理…',
    'recovery.failed': '没能恢复。原始数据仍然保留；请检查本机可用空间后再试。',
    'recovery.stillBroken': '重新读取了一遍，问题还在。',
  },
  'zh-Hant-TW': {
    'recovery.title': '本機資料需要復原',
    'recovery.intro': '部分資料無法讀取，已暫停修改。原始內容沒有被覆寫。',
    'recovery.unavailable': '暫時無法安全讀寫本機資料。請重新讀取，並確認瀏覽器的本機儲存空間可正常使用（例如沒有在用私密瀏覽）。',
    'recovery.readable': '目前能讀取 {lists} 張清單、{items} 樣東西。',
    'recovery.export': '下載原始資料', 'recovery.exportHint': '先留一份原始資料，方便日後查明問題；檔案裡沒有同步權杖。',
    'recovery.retry': '重新讀取', 'recovery.keep': '保留讀得出來的部分，繼續使用',
    'recovery.confirm': '復原本機資料？',
    'recovery.keepConfirm': '無法讀取的內容只會留在本機的原始資料封存檔裡，不會出現在清單上。建議先下載原始資料。仍要繼續嗎？',
    'recovery.go': '復原並繼續', 'recovery.working': '正在處理…',
    'recovery.failed': '無法復原。原始資料仍保留；請檢查本機可用空間後再試。',
    'recovery.stillBroken': '重新讀取了一次，問題仍然存在。',
  },
  en: {
    'recovery.title': 'Local data needs recovery',
    'recovery.intro': 'Some data could not be read, so changes are paused. The original data has not been overwritten.',
    'recovery.unavailable': "Local data can't be read or written safely right now. Try reading again, and check that the browser's local storage is available (for example, not in Private Browsing).",
    'recovery.readable': v => `${v.lists} ${plural(v.lists, 'list', 'lists')} and ${v.items} ${plural(v.items, 'item', 'items')} can be read right now.`,
    'recovery.export': 'Download original data', 'recovery.exportHint': 'Keep a copy of the original data for troubleshooting. The file does not contain your sync token.',
    'recovery.retry': 'Try reading again', 'recovery.keep': 'Keep what can be read and continue',
    'recovery.confirm': 'Recover local data?',
    'recovery.keepConfirm': 'Unreadable content will remain only in the original data archive on this device and will not appear in your lists. Download the original data first. Continue?',
    'recovery.go': 'Recover and continue', 'recovery.working': 'Working…',
    'recovery.failed': 'Recovery failed. The original data is still preserved. Check available storage, then try again.',
    'recovery.stillBroken': 'Read again, but the problem is still there.',
  },
};
