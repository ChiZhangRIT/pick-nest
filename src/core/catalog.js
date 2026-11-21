// @ts-check
// 内置的常见食材对照：新加的东西没有记住的分类时，按名字猜一个（牛奶 → 蛋奶、苹果 → 蔬果）。只给食材清单用，分错了改一次就记住了（memory）。
// 键都写成 normName 的样子（简体、小写）：繁体的输入折成简体后就对得上；台湾的叫法（凤梨、马铃薯、优格、洋芋片……）另外列了。
// 匹配：先看整个名字；名字里有「冻干 / freeze-dried」的是零食；有「冷冻 / 速冻 / frozen」的、「冻」加上一样对照表里的东西（冻虾仁、冻豆腐）
// 是冷冻（「冷冻草莓」不是蔬果；光看「冻」开头会把冻顶乌龙茶、冻柠茶也算成冷冻）；再找名字里包含的最长的键
// （中文至少两个字：单字的「盐」「葱」只认整个名字；英文按整个词，复数也算），一样长取靠后的：中文英文都是后面的词说了算（「猪肉水饺」是水饺）。
import { normName } from './store.js';
import { own, isObj } from './util.js';

/** 分类（预置分类的 sys）→ 名字 @type {Record<string, string[]>} */
const NAMES = {
  produce: [
    '苹果', '香蕉', '橙子', '橘子', '柠檬', '青柠', '莱姆', '葡萄', '草莓', '蓝莓', '西瓜', '梨', '桃子', '芒果', '菠萝', '凤梨', '牛油果', '酪梨',
    '猕猴桃', '奇异果', '樱桃', '车厘子', '番茄', '西红柿', '黄瓜', '土豆', '马铃薯', '红薯', '地瓜', '洋葱', '大蒜', '蒜', '姜', '葱', '小葱',
    '胡萝卜', '萝卜', '西兰花', '花椰菜', '菜花', '菠菜', '生菜', '白菜', '大白菜', '卷心菜', '包菜', '高丽菜', '青椒', '甜椒', '辣椒', '茄子',
    '芹菜', '蘑菇', '香菇', '金针菇', '豆芽', '玉米', '南瓜', '香菜', '韭菜', '青菜', '油麦菜', '空心菜', '四季豆', '豆角', '山药', '莲藕',
    '冬瓜', '丝瓜', '苦瓜', '豆腐',
    'apple', 'banana', 'orange', 'lemon', 'lime', 'grape', 'strawberry', 'blueberry', 'raspberry', 'watermelon', 'pear', 'peach', 'mango',
    'pineapple', 'avocado', 'kiwi', 'cherry', 'tomato', 'cucumber', 'potato', 'sweet potato', 'onion', 'green onion', 'scallion', 'garlic',
    'ginger', 'carrot', 'broccoli', 'cauliflower', 'spinach', 'lettuce', 'kale', 'cabbage', 'napa cabbage', 'bok choy', 'bell pepper',
    'eggplant', 'celery', 'mushroom', 'corn', 'zucchini', 'pumpkin', 'cilantro', 'green beans', 'tofu',
  ],
  meat: [
    '肉', '猪肉', '五花肉', '排骨', '牛肉', '肥牛', '牛排', '羊肉', '鸡肉', '鸡腿', '鸡翅', '鸡胸肉', '鸭', '培根', '火腿', '香肠', '肉末', '绞肉',
    '鱼', '三文鱼', '鲑鱼', '鳕鱼', '鲈鱼', '带鱼', '虾', '虾仁', '螃蟹', '蛤蜊', '扇贝', '鱿鱼',
    'pork', 'pork belly', 'ribs', 'beef', 'ground beef', 'steak', 'lamb', 'chicken', 'chicken breast', 'chicken thighs', 'chicken wings',
    'turkey', 'bacon', 'ham', 'sausage', 'fish', 'salmon', 'tuna', 'cod', 'shrimp', 'crab', 'scallop',
  ],
  dairy: [
    '牛奶', '鲜奶', '酸奶', '优格', '优酪乳', '鸡蛋', '蛋', '黄油', '奶油', '奶酪', '芝士', '起司', '淡奶油', '豆浆', '燕麦奶',
    'milk', 'oat milk', 'almond milk', 'soy milk', 'chocolate milk', 'egg', 'butter', 'cheese', 'cream cheese', 'sour cream', 'heavy cream',
    'yogurt', 'half and half',
  ],
  bakery: [
    '面包', '吐司', '贝果', '馒头', '包子', '花卷', '蛋糕', '牛角包', '可颂', '法棍', '面包糠',
    'bread', 'bagel', 'croissant', 'baguette', 'muffin', 'tortilla', 'buns', 'cake',
  ],
  frozen: [
    '冻饺子', '饺子', '水饺', '汤圆', '馄饨', '鱼丸', '冰淇淋', '雪糕', '冰块', '薯条',
    'dumplings', 'ice cream', 'ice', 'frozen pizza', 'fries',
  ],
  pantry: [
    '大米', '米', '面条', '挂面', '方便面', '泡面', '意大利面', '意面', '面粉', '燕麦', '麦片', '谷片', '食用油', '油', '橄榄油', '花生油',
    '罐头', '红豆', '绿豆', '黄豆', '糯米', '小米', '粉丝', '米粉', '年糕', '木耳', '紫菜', '蜂蜜', '高汤', '鸡蛋面',
    'rice', 'noodles', 'ramen', 'pasta', 'spaghetti', 'flour', 'oats', 'oatmeal', 'cereal', 'olive oil', 'vegetable oil', 'beans',
    'canned tomatoes', 'broth', 'chicken broth', 'honey', 'coconut milk',
  ],
  condiments: [
    '生抽', '老抽', '酱油', '醋', '香醋', '陈醋', '米醋', '蚝油', '料酒', '盐', '糖', '白糖', '冰糖', '红糖', '胡椒粉', '辣椒酱', '老干妈',
    '辣椒油', '辣椒粉', '番茄酱', '蛋黄酱', '美乃滋', '沙拉酱', '芥末', '豆瓣酱', '芝麻酱', '花生酱', '果酱', '香油', '芝麻油', '麻油', '花椒', '八角', '鸡精',
    '味精', '咖喱', '咖哩', '火锅底料',
    'soy sauce', 'vinegar', 'rice vinegar', 'oyster sauce', 'salt', 'sugar', 'black pepper', 'ketchup', 'mayo', 'mayonnaise', 'mustard',
    'hot sauce', 'sriracha', 'peanut butter', 'jam', 'sesame oil', 'curry', 'salsa', 'dressing', 'bbq sauce', 'cooking wine',
  ],
  snacks: [
    '薯片', '洋芋片', '饼干', '巧克力', '糖果', '坚果', '花生', '瓜子', '爆米花', '牛肉干', '果冻', '海苔', '辣条', '果汁', '可乐', '汽水',
    '雪碧', '矿泉水', '水', '气泡水', '啤酒', '红酒', '葡萄酒', '咖啡', '茶叶', '茶', '奶茶', '乌龙茶', '绿茶', '红茶', '柠檬茶', '柠茶', '奶糖',
    'chips', 'cookies', 'crackers', 'chocolate', 'candy', 'nuts', 'almonds', 'popcorn', 'pretzels', 'jerky', 'juice', 'orange juice',
    'apple juice', 'soda', 'coke', 'water', 'sparkling water', 'beer', 'wine', 'coffee', 'tea', 'granola bars',
  ],
  household: [
    '洗洁精', '洗碗块', '洗衣液', '洗衣粉', '洗衣球', '柔顺剂', '漂白水', '卫生纸', '纸巾', '面纸', '抽纸', '厨房纸', '垃圾袋', '保鲜膜',
    '保鲜袋', '锡纸', '铝箔纸', '洗发水', '洗发精', '护发素', '沐浴露', '沐浴乳', '牙膏', '牙刷', '牙线', '洗手液', '肥皂', '湿巾', '湿纸巾',
    '电池', '海绵', '卫生巾',
    'dish soap', 'dishwasher pods', 'laundry detergent', 'fabric softener', 'bleach', 'toilet paper', 'paper towels', 'tissues',
    'trash bags', 'plastic wrap', 'aluminum foil', 'ziploc bags', 'shampoo', 'conditioner', 'body wash', 'toothpaste', 'toothbrush',
    'floss', 'hand soap', 'soap', 'wipes', 'batteries', 'sponge',
  ],
};
// 名字里有这几个词就是冷冻：比别的键都优先（「冷冻草莓」「frozen strawberries」不该归到蔬果）
const FROZEN = ['冷冻', '速冻', 'frozen'];
// 冻干的多是零食（冻干草莓、冻干咖啡），比冷冻、比名字里的「草莓」都优先
const FREEZE_DRIED = ['冻干', 'freeze-dried', 'freeze dried'];

/** normName 后的名字 → 分类的 sys @type {Map<string, string>} */
export const CATALOG = new Map();
for (const [sys, names] of Object.entries(NAMES)) for (const n of names) CATALOG.set(n, sys);

const CJK = /[㐀-鿿豈-﫿]/;
const esc = (/** @type {string} */ s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** 英文的键按整个词找，复数也算（berry → berries、tomato → tomatoes） @param {string} k */
const wordRe = k => new RegExp('(?:^|[^a-z0-9])(' + (k.endsWith('y') ? esc(k.slice(0, -1)) + '(?:y|ies)' : esc(k) + '(?:s|es)?') + ')(?=$|[^a-z0-9])', 'g');
/** 能拿来在名字里找的键：中文至少两个字，英文全部；[键, 分类, 找它的办法] @type {[string, string, RegExp | null][]} */
const KEYS = [...CATALOG].filter(([k]) => !CJK.test(k) || k.length >= 2).map(([k, sys]) => [k, sys, CJK.test(k) ? null : wordRe(k)]);

/** 键在名字里最后一次出现的结束位置；没有 → -1 @param {string} name @param {string} k @param {RegExp | null} re */
function lastEnd(name, k, re) {
  if (!re) { const i = name.lastIndexOf(k); return i < 0 ? -1 : i + k.length; }
  let end = -1;
  re.lastIndex = 0;
  for (let m = re.exec(name); m; m = re.exec(name)) end = m.index + m[0].length;
  return end;
}

/** 名字是不是对照表里的一样东西（整个名字一样）。parse.js 用它别把「2 包子」拆成「2 包 / 子」 @param {unknown} name */
export const isCatalogName = name => CATALOG.has(normName(name));

/** 按名字猜分类的 sys（不看 state）；猜不出 → null @param {unknown} name @returns {string | null} */
export function catalogSys(name) {
  const key = normName(name);
  if (!key) return null;
  const exact = CATALOG.get(key);
  if (exact) return exact;
  const has = (/** @type {string} */ k) => lastEnd(key, k, CJK.test(k) ? null : wordRe(k)) >= 0;
  if (FREEZE_DRIED.some(has)) return 'snacks';
  // 「冻」开头只在后面整个是一样吃的时才算（冻虾仁、冻肉）；冻奶茶、冻柠茶是冰饮料，冻顶乌龙是茶名
  const rest = key.startsWith('冻') ? CATALOG.get(key.slice(1).trim()) : null;
  if ((rest && rest !== 'snacks') || FROZEN.some(has)) return 'frozen';
  let best = null, bestLen = 0, bestEnd = -1;
  for (const [k, sys, re] of KEYS) {
    const end = lastEnd(key, k, re);
    if (end < 0) continue;
    if (k.length > bestLen || (k.length === bestLen && end > bestEnd)) { best = sys; bestLen = k.length; bestEnd = end; }
  }
  return best;
}

/**
 * 新加的东西用哪个分类（只给食材清单）：对照表猜出的预置分类还在（没删除、不是只给一般清单用的）才用，不然 → null
 * @param {import('./store.js').State} state @param {unknown} name @param {string} [kind] 清单的类型
 * @returns {string | null}
 */
export function catalogCategory(state, name, kind = 'grocery') {
  if (kind !== 'grocery') return null;
  const sys = catalogSys(name);
  if (!sys) return null;
  const cat = own(isObj(state && state.data) ? state.data.categories : null, 'c_' + sys);
  return cat && !cat.deleted && cat.kind !== 'general' ? cat.id : null;
}
