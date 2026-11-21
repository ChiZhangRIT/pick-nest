// 搜索（#/search）：首页的入口、搜索框、没输入时的说明、找到几样、没找到。
// 繁體（台灣）用台灣用語（搜尋、封存……）；动态字段 {x} 三种语言一致（测试会查）。英文单复数：en(一个, 多个)
const en = (one, many) => (v) => (Number(v.n) === 1 ? one : many).replace('{n}', v.n);

export const STRINGS = {
  'zh-Hans': {
    'search.ph': '搜索所有清单', 'search.label': '搜索所有清单里的东西',
    'search.hint': '名字和备注都能搜，简体繁体、大小写都算：搜「鸡蛋」也能找到「雞蛋」。已归档的清单也在里面。',
    'search.found': '找到 {n} 样', 'search.none': '没有找到「{q}」', 'search.noneHint': '换个写法试试，或者少写几个字。',
    'search.archived': '已归档',
  },
  'zh-Hant-TW': {
    'search.ph': '搜尋所有清單', 'search.label': '搜尋所有清單裡的東西',
    'search.hint': '名稱和備註都能搜尋，簡體繁體、大小寫都算：搜「雞蛋」也找得到「鸡蛋」。已封存的清單也包括在內。',
    'search.found': '找到 {n} 樣', 'search.none': '找不到「{q}」', 'search.noneHint': '換個寫法試試，或是少打幾個字。',
    'search.archived': '已封存',
  },
  en: {
    'search.ph': 'Search all lists', 'search.label': 'Search items on all lists',
    'search.hint': 'Searches names and notes, ignoring case and Simplified vs. Traditional Chinese (鸡蛋 also finds 雞蛋). Archived lists are included.',
    'search.found': en('{n} item found', '{n} items found'), 'search.none': 'No results for “{q}”', 'search.noneHint': 'Try a different spelling or fewer words.',
    'search.archived': 'Archived',
  },
};
