// 清单：list.sys.* 预置清单的名字（用户改过名字就显示用户写的）、首页。
// 英文单复数：en(一个, 多个)
const en = (one, many) => (v) => (Number(v.n) === 1 ? one : many).replace('{n}', v.n);

export const STRINGS = {
  'zh-Hans': {
    'list.sys.groceries': '食材', 'list.sys.tobuy': '想买', 'list.untitled': '未命名清单',
    'list.none': '没有要显示的清单。', 'list.needN': '还要买 {n} 样',
  },
  'zh-Hant-TW': {
    'list.sys.groceries': '食材', 'list.sys.tobuy': '想買', 'list.untitled': '未命名清單',
    'list.none': '沒有要顯示的清單。', 'list.needN': '還要買 {n} 樣',
  },
  en: {
    'list.sys.groceries': 'Groceries', 'list.sys.tobuy': 'To Buy', 'list.untitled': 'Untitled list',
    'list.none': 'No lists to show.', 'list.needN': en('{n} item to buy', '{n} items to buy'),
  },
};
