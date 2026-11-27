// 营养数据表的对照表（第 14 步）：挑哪些 USDA FoodData Central SR Legacy 的食物、叫什么。tools/build-nutrition.mjs 按它生成 src/data/nutrition.js。
// 每一样：fdc 是 SR Legacy 的 fdc_id（行尾注释是 USDA 的原名，核对用）；zh 是简体的名字和常见叫法（繁体靠 normName 折，台湾叫法另外写了：
//   高丽菜、马铃薯、鲑鱼、凤梨……），en 是英文的叫法（小写；复数认食材时会自己认，这里写了的是常见的写法）；
//   note：SR Legacy 里没有完全对上的、用了最接近的一样时写清楚用了什么（英文，给维护的人看，界面不显示）；
//   units：这一样的单位克数要用 USDA 的哪一条 portion（中文单位 → portion 的写法开头，比如 '个': 'large' 是一个大号鸡蛋；null = 不要这个单位：
//   USDA 的那条和中文说的「一个」差得太远，比如鸡翅的「1 piece」连着骨头）。没写的单位按 build-nutrition.mjs 的 UNIT_RULES 找；
//   volume: false：按体积（杯、勺、毫升）量没有意义，换算不了（紫菜）。
//   小的品种（小番茄、小米辣、小胡萝卜）的一个比大的轻好几倍：要么有自己的一条（SR Legacy 里有的：baby carrots、serrano），要么不收，
//   别把它们当别名挂在大的那一条上（会用大的那个的「个」）。「小」「干」这些开头的、看着像表里名字的别的东西，core/nutrition.js 的
//   PREFIX_WORDS、LOOKALIKES 挡着，认不出。
// 一个名字只能给一样（测试查：normName 以后不同的两样不能有同一个名字）；说法有歧义、营养差得多的不收（「奶油」在大陆多是淡奶油、在台湾是黄油；
//   「牛油」在火锅里是牛脂、在港台是黄油——只收了「牛油」= 牛脂，黄油另有自己的名字）。
// 选的都是生的、可食部分（菜谱里写的多是买来的生重）；熟的只收了按熟的写才说得通的（米饭、熟意面、烤鸭、熟花生、糖炒栗子），
//   鸡爪 SR Legacy 只有煮过的。
// 数据：U.S. Department of Agriculture, Agricultural Research Service. FoodData Central (SR Legacy, 2018). 公共领域（CC0）。

/** @type {import('./build-nutrition.mjs').MapEntry[]} */
export const MAP = [
  // ---------- 猪肉 ----------
  { fdc: 167812, zh: ['五花肉', '五花', '猪五花', '三层肉', '腊肉', '咸肉'], en: ['pork belly'], note: 'approximation: 腊肉 / 咸肉 (Chinese cured pork belly) use raw pork belly (cured belly has lost some water, so it is a little richer per 100 g)' },   // Pork, fresh, belly, raw
  { fdc: 168249, zh: ['里脊', '猪里脊', '里脊肉', '猪里脊肉', '小里脊', '腰内肉'], en: ['pork tenderloin'] },   // Pork, fresh, loin, tenderloin, separable lean only, raw
  { fdc: 167902, zh: ['猪肉馅', '肉馅', '猪绞肉', '绞肉', '猪肉末', '肉末', '猪肉糜', '肉糜'], en: ['ground pork', 'minced pork', 'pork mince'] },   // Pork, fresh, ground, raw
  { fdc: 167853, zh: ['排骨', '猪排骨', '肋排', '猪肋排', '小排', '猪小排', '肋骨'], en: ['spareribs', 'pork ribs', 'ribs'] },   // Pork, fresh, spareribs, separable lean and fat, raw
  { fdc: 167888, zh: ['猪肉', '猪肉片', '肉片', '猪肉丝', '肉丝', '鲜猪肉'], en: ['pork'] },   // Pork, fresh, composite of trimmed retail cuts (leg, loin, shoulder, and spareribs), separable lean and fat, raw
  { fdc: 168220, zh: ['瘦肉', '猪瘦肉', '瘦猪肉', '精肉'], en: ['lean pork'] },   // Pork, fresh, composite of trimmed retail cuts (leg, loin, shoulder), separable lean only, raw
  { fdc: 167849, zh: ['梅花肉', '猪梅花肉', '梅头肉', '猪颈肉'], en: ['pork butt', 'pork shoulder', 'boston butt'] },   // Pork, fresh, shoulder, (Boston butt), blade (steaks), separable lean and fat, raw
  { fdc: 168255, zh: ['前腿肉', '猪前腿', '猪前腿肉', '夹心肉'], en: ['pork picnic shoulder'] },   // Pork, fresh, shoulder, arm picnic, separable lean and fat, raw
  { fdc: 168222, zh: ['后腿肉', '猪后腿', '猪后腿肉'], en: ['fresh ham', 'pork leg'] },   // Pork, fresh, leg (ham), whole, separable lean and fat, raw
  { fdc: 168238, zh: ['猪排', '猪大排', '大排', '猪扒'], en: ['pork chop', 'pork chops'] },   // Pork, fresh, loin, center loin (chops), bone-in, separable lean and fat, raw
  { fdc: 167859, zh: ['猪蹄', '猪脚', '猪手', '猪蹄子'], en: ['pig feet', 'pork feet', 'pig trotters'] },   // Pork, fresh, variety meats and by-products, feet, raw
  { fdc: 167862, zh: ['猪肝'], en: ['pork liver'] },   // Pork, fresh, variety meats and by-products, liver, raw
  { fdc: 168270, zh: ['猪腰', '腰花', '猪腰子'], en: ['pork kidney'] },   // Pork, fresh, variety meats and by-products, kidneys, raw
  { fdc: 167867, zh: ['猪肚'], en: ['pork stomach', 'pig stomach'] },   // Pork, fresh, variety meats and by-products, stomach, raw
  { fdc: 168266, zh: ['猪大肠', '大肠', '肥肠'], en: ['pork intestines', 'chitterlings'] },   // Pork, fresh, variety meats and by-products, chitterlings, raw
  { fdc: 168267, zh: ['猪心'], en: ['pork heart'] },   // Pork, fresh, variety meats and by-products, heart, raw
  { fdc: 167857, zh: ['猪耳', '猪耳朵'], en: ['pig ears'], units: { '根': null, '个': 'ear' } },   // Pork, fresh, variety meats and by-products, ears, frozen, raw
  { fdc: 168275, zh: ['猪舌', '猪舌头', '口条'], en: ['pork tongue'] },   // Pork, fresh, variety meats and by-products, tongue, raw
  { fdc: 167811, zh: ['肥膘', '猪肥膘', '肥肉'], en: ['pork fat', 'fatback'] },   // Pork, fresh, backfat, raw
  { fdc: 168277, zh: ['培根', '烟肉'], en: ['bacon'] },   // Pork, cured, bacon, unprepared
  { fdc: 173864, zh: ['火腿', '火腿片'], en: ['ham', 'sliced ham'] },   // Ham, sliced, regular (approximately 11% fat)
  { fdc: 171401, zh: ['猪油', '荤油'], en: ['lard'] },   // Lard
  { fdc: 172934, zh: ['猪肉肠', '鲜肉肠', '早餐肠'], en: ['pork sausage', 'sausage', 'breakfast sausage'] },   // Pork sausage, link/patty, unprepared
  { fdc: 174571, zh: ['午餐肉'], en: ['luncheon meat', 'spam'] },   // Luncheon meat, pork, canned
  // ---------- 牛羊 ----------
  { fdc: 174036, zh: ['牛肉馅', '牛绞肉', '牛肉末', '碎牛肉'], en: ['ground beef', 'minced beef'] },   // Beef, ground, 80% lean meat / 20% fat, raw
  { fdc: 174760, zh: ['牛肉', '牛肉片', '牛肉丝', '瘦牛肉', '鲜牛肉'], en: ['beef'] },   // Beef, composite of trimmed retail cuts, separable lean only, trimmed to 0" fat, all grades, raw
  { fdc: 168664, zh: ['牛腩', '牛胸肉'], en: ['beef brisket', 'brisket'], note: 'approximation: 牛腩 (beef flank/belly for stewing) uses brisket' },   // Beef, brisket, whole, separable lean and fat, trimmed to 1/8" fat, all grades, raw
  { fdc: 169441, zh: ['牛腱', '牛腱子', '牛腱肉', '牛展'], en: ['beef shank'] },   // Beef, shank crosscuts, separable lean only, trimmed to 1/4" fat, choice, raw
  { fdc: 168717, zh: ['牛排', '丁骨牛排'], en: ['steak', 'beef steak', 't-bone steak'], units: { '块': null } },   // Beef, short loin, t-bone steak, separable lean and fat, trimmed to 1/8" fat, choice, raw（「1 steak」461 g 是一整块美国的丁骨，一块牛排一般一两百克）
  { fdc: 173403, zh: ['肉眼牛排', '眼肉', '肋眼牛排'], en: ['ribeye', 'rib eye steak'] },   // Beef, rib eye steak, boneless, lip off, separable lean and fat, trimmed to 0" fat, choice, raw
  { fdc: 169542, zh: ['牛里脊', '牛柳', '菲力', '牛菲力'], en: ['beef tenderloin', 'filet mignon'] },   // Beef, tenderloin, steak, separable lean and fat, trimmed to 1/8" fat, all grades, raw
  { fdc: 170827, zh: ['牛小排'], en: ['short ribs', 'beef short ribs'], units: { '块': null, '个': null } },   // Beef, chuck, short ribs, boneless, separable lean and fat, trimmed to 0" fat, choice, raw（「1 piece」434 g 是一整条去骨的）
  { fdc: 168675, zh: ['肥牛', '肥牛片', '肥牛卷', '牛五花'], en: ['sliced beef for hot pot', 'beef plate'], note: 'approximation: 肥牛 (thin-sliced fatty beef for hot pot) uses whole rib, lean and fat' },   // Beef, rib, whole (ribs 6-12), separable lean and fat, trimmed to 1/8" fat, choice, raw
  { fdc: 169433, zh: ['牛腹肉'], en: ['flank steak'] },   // Beef, flank, steak, separable lean and fat, trimmed to 0" fat, choice, raw
  { fdc: 170599, zh: ['牛肚', '毛肚', '牛百叶'], en: ['beef tripe', 'tripe'] },   // Beef, variety meats and by-products, tripe, raw
  { fdc: 170196, zh: ['牛舌'], en: ['beef tongue'] },   // Beef, variety meats and by-products, tongue, raw
  { fdc: 169451, zh: ['牛肝'], en: ['beef liver'] },   // Beef, variety meats and by-products, liver, raw
  { fdc: 167536, zh: ['牛肉干'], en: ['beef jerky', 'jerky'] },   // Snacks, beef jerky, chopped and formed
  { fdc: 172479, zh: ['羊肉', '羊肉片', '羊肉卷', '羊肉串'], en: ['lamb'] },   // Lamb, composite of trimmed retail cuts, separable lean and fat, trimmed to 1/4" fat, choice, raw
  { fdc: 174321, zh: ['羊排', '羊肋排'], en: ['lamb chops', 'rack of lamb', 'lamb ribs'] },   // Lamb, rib, separable lean and fat, trimmed to 1/4" fat, choice, raw
  { fdc: 174311, zh: ['羊腿', '羊腿肉'], en: ['leg of lamb', 'lamb leg'] },   // Lamb, leg, whole (shank and sirloin), separable lean and fat, trimmed to 1/4" fat, choice, raw
  { fdc: 174370, zh: ['羊肉馅', '羊绞肉'], en: ['ground lamb'] },   // Lamb, ground, raw
  { fdc: 175303, zh: ['山羊肉'], en: ['goat', 'goat meat'] },   // Game meat, goat, raw
  // ---------- 禽 ----------
  { fdc: 171077, zh: ['鸡胸肉', '鸡胸', '鸡脯肉', '鸡胸脯'], en: ['chicken breast', 'boneless skinless chicken breast'], units: { '块': 'piece' } },   // Chicken, broiler or fryers, breast, skinless, boneless, meat only, raw
  { fdc: 172378, zh: ['鸡腿', '全腿'], en: ['chicken leg', 'chicken legs', 'chicken quarters'], units: { '个': null } },   // Chicken, broilers or fryers, leg, meat and skin, raw（「1 leg」344 g 是大腿 + 小腿 + 背上那块；中文的「鸡腿」大小差得多，不给「个」）
  { fdc: 172385, zh: ['鸡大腿', '带皮鸡腿肉'], en: ['chicken thigh with skin', 'skin-on chicken thigh'] },   // Chicken, broilers or fryers, thigh, meat and skin, raw
  { fdc: 173627, zh: ['鸡腿肉', '去骨鸡腿肉', '鸡腿排', '鸡扒'], en: ['chicken thigh', 'boneless chicken thighs', 'chicken thighs'], units: { '个': 'thigh' } },   // Chicken, broilers or fryers, dark meat, thigh, meat only, raw
  { fdc: 172373, zh: ['琵琶腿', '鸡小腿', '棒棒腿', '鸡琵琶腿'], en: ['drumsticks', 'chicken drumsticks', 'drumstick'], units: { '个': 'drumstick' } },   // Chicken, broilers or fryers, drumstick, meat and skin, raw
  { fdc: 172390, zh: ['鸡翅', '鸡翅膀', '鸡中翅', '翅中', '鸡翅中', '鸡翅根', '翅根'], en: ['chicken wings', 'wings', 'chicken wing'], units: { '个': null, '块': null } },   // Chicken, broilers or fryers, wing, meat and skin, raw（「1 piece」107 g 是连骨头的，乘每 100 g 可食部分会多算一倍）
  { fdc: 171447, zh: ['鸡', '整鸡', '全鸡', '鸡块', '三黄鸡', '乌鸡', '土鸡'], en: ['whole chicken', 'chicken'] },   // Chicken, broilers or fryers, meat and skin, raw
  { fdc: 171052, zh: ['鸡肉', '鸡肉丁', '鸡丁', '鸡肉丝', '鸡丝'], en: ['chicken meat'] },   // Chicken, broilers or fryers, meat only, raw
  { fdc: 171116, zh: ['鸡肉馅', '鸡绞肉', '鸡肉末'], en: ['ground chicken'] },   // Chicken, ground, raw
  { fdc: 171060, zh: ['鸡肝'], en: ['chicken liver', 'chicken livers'] },   // Chicken, liver, all classes, raw
  { fdc: 171456, zh: ['鸡胗', '鸡肫', '鸡胃'], en: ['chicken gizzards', 'gizzards'] },   // Chicken, gizzard, all classes, raw
  { fdc: 171458, zh: ['鸡心'], en: ['chicken hearts'] },   // Chicken, heart, all classes, raw
  { fdc: 171119, zh: ['鸡爪', '凤爪', '鸡脚'], en: ['chicken feet'] },   // Chicken, feet, boiled
  { fdc: 172408, zh: ['鸭', '鸭肉', '鸭子', '鸭块'], en: ['duck'] },   // Duck, domesticated, meat and skin, raw
  { fdc: 172409, zh: ['烤鸭'], en: ['roast duck'] },   // Duck, domesticated, meat and skin, cooked, roasted
  { fdc: 174470, zh: ['鹅', '鹅肉'], en: ['goose'] },   // Goose, domesticated, meat and skin, raw
  { fdc: 171081, zh: ['火鸡', '火鸡肉'], en: ['turkey'] },   // Turkey, whole, meat and skin, raw
  { fdc: 171505, zh: ['火鸡肉馅', '火鸡绞肉'], en: ['ground turkey'] },   // Turkey, Ground, raw
  { fdc: 172418, zh: ['鹌鹑'], en: ['quail'] },   // Quail, meat and skin, raw
  { fdc: 174475, zh: ['鸽子', '乳鸽', '鸽肉'], en: ['squab', 'pigeon'] },   // Squab, (pigeon), meat and skin, raw
  // ---------- 蛋奶 ----------
  { fdc: 171287, zh: ['鸡蛋', '蛋', '鲜鸡蛋', '土鸡蛋', '鸡蛋液', '蛋液', '全蛋'], en: ['egg', 'eggs', 'whole egg'], units: { '个': 'large' } },   // Egg, whole, raw, fresh
  { fdc: 172183, zh: ['蛋白', '蛋清', '鸡蛋清', '鸡蛋白'], en: ['egg white', 'egg whites'], units: { '个': 'large' } },   // Egg, white, raw, fresh
  { fdc: 172184, zh: ['蛋黄', '鸡蛋黄'], en: ['egg yolk', 'egg yolks'], units: { '个': 'large' } },   // Egg, yolk, raw, fresh
  { fdc: 172189, zh: ['鸭蛋', '咸鸭蛋', '咸蛋', '皮蛋', '松花蛋'], en: ['duck egg', 'salted duck egg', 'century egg'], note: 'approximation: 咸鸭蛋 / 皮蛋 use fresh duck egg (salted and century eggs are close in calories, much saltier)' },   // Egg, duck, whole, fresh, raw
  { fdc: 172191, zh: ['鹌鹑蛋'], en: ['quail egg', 'quail eggs'] },   // Egg, quail, whole, fresh, raw
  { fdc: 171265, zh: ['牛奶', '鲜奶', '纯牛奶', '全脂牛奶', '牛乳', '鲜牛奶'], en: ['milk', 'whole milk'] },   // Milk, whole, 3.25% milkfat, with added vitamin D
  { fdc: 170872, zh: ['低脂牛奶'], en: ['low-fat milk', '1% milk'] },   // Milk, lowfat, fluid, 1% milkfat, with added vitamin A and vitamin D
  { fdc: 171269, zh: ['脱脂牛奶', '脱脂奶'], en: ['skim milk', 'nonfat milk'] },   // Milk, nonfat, fluid, with added vitamin A and vitamin D (fat free or skim)
  { fdc: 170876, zh: ['奶粉', '全脂奶粉'], en: ['milk powder', 'powdered milk'] },   // Milk, dry, whole, with added vitamin D
  { fdc: 171275, zh: ['炼乳', '炼奶'], en: ['sweetened condensed milk', 'condensed milk'] },   // Milk, canned, condensed, sweetened
  { fdc: 171276, zh: ['淡奶', '淡炼乳'], en: ['evaporated milk'] },   // Milk, canned, evaporated, with added vitamin D and without added vitamin A
  { fdc: 171284, zh: ['酸奶', '优格', '优酪乳', '原味酸奶'], en: ['yogurt', 'plain yogurt'] },   // Yogurt, plain, whole milk
  { fdc: 171304, zh: ['希腊酸奶'], en: ['greek yogurt'] },   // Yogurt, Greek, plain, whole milk
  { fdc: 173410, zh: ['黄油', '有盐黄油', '有盐奶油'], en: ['butter', 'salted butter'], units: { '条': 'stick' } },   // Butter, salted
  { fdc: 173430, zh: ['无盐黄油', '无盐奶油'], en: ['unsalted butter'], units: { '条': 'stick' } },   // Butter, without salt
  { fdc: 170859, zh: ['淡奶油', '鲜奶油', '动物奶油', '稀奶油'], en: ['heavy cream', 'whipping cream', 'heavy whipping cream'], units: { '杯': 'cup, fluid' } },   // Cream, fluid, heavy whipping
  { fdc: 171257, zh: ['酸奶油'], en: ['sour cream'] },   // Cream, sour, cultured
  { fdc: 173418, zh: ['奶油奶酪', '奶油芝士', '奶酪芝士'], en: ['cream cheese'] },   // Cheese, cream
  { fdc: 173414, zh: ['奶酪', '芝士', '起司', '切达', '切达奶酪', '车达', '车达起司', '乳酪', '切达乳酪'], en: ['cheese', 'cheddar', 'cheddar cheese'] },   // Cheese, cheddar (Includes foods for USDA's Food Distribution Program)
  { fdc: 170845, zh: ['马苏里拉', '马苏里拉奶酪', '马苏里拉芝士', '莫扎瑞拉', '拉丝芝士'], en: ['mozzarella'] },   // Cheese, mozzarella, whole milk
  { fdc: 171247, zh: ['帕玛森', '帕玛森奶酪', '帕玛森芝士', '帕马森'], en: ['parmesan', 'parmesan cheese'] },   // Cheese, parmesan, grated
  { fdc: 170853, zh: ['芝士片', '奶酪片', '起司片'], en: ['american cheese', 'cheese slices'] },   // Cheese, pasteurized process, American, fortified with vitamin D
  { fdc: 167575, zh: ['冰淇淋', '冰激凌', '香草冰淇淋'], en: ['ice cream', 'vanilla ice cream'] },   // Ice creams, vanilla
  // ---------- 豆制品 ----------
  { fdc: 172476, zh: ['豆腐', '冻豆腐'], en: ['tofu'] },   // Tofu, raw, regular, prepared with calcium sulfate
  { fdc: 172475, zh: ['老豆腐', '北豆腐', '硬豆腐'], en: ['firm tofu'] },   // Tofu, raw, firm, prepared with calcium sulfate
  { fdc: 172449, zh: ['嫩豆腐', '南豆腐', '内酯豆腐', '绢豆腐', '水豆腐'], en: ['soft tofu', 'silken tofu'] },   // Tofu, soft, prepared with calcium sulfate and magnesium chloride (nigari)
  { fdc: 174291, zh: ['豆腐干', '豆干', '香干', '白干'], en: ['pressed tofu', 'dried tofu'], note: 'approximation: 豆干 (pressed tofu) uses hard tofu', units: { '块': null } },   // Tofu, hard, prepared with nigari（「0.25 block」是一整块压过的豆腐，一块豆干只有几十克）
  { fdc: 172451, zh: ['油豆腐', '豆腐泡', '豆泡', '炸豆腐'], en: ['fried tofu', 'tofu puffs'] },   // Tofu, fried
  { fdc: 174280, zh: ['腐乳', '豆腐乳', '南乳'], en: ['fermented tofu', 'fermented bean curd'] },   // Tofu, salted and fermented (fuyu)
  { fdc: 172450, zh: ['腐竹', '油皮', '干腐竹'], en: ['yuba', 'tofu skin', 'dried tofu skin'], note: 'approximation: 腐竹 / 油皮 (dried tofu skin, yuba) use dried-frozen tofu (koyadofu), both dried soy curd' },   // Tofu, dried-frozen (koyadofu)
  { fdc: 172446, zh: ['豆浆', '豆奶', '原味豆浆'], en: ['soy milk', 'soymilk'] },   // Soymilk, original and vanilla, unfortified
  { fdc: 174270, zh: ['黄豆', '大豆'], en: ['soybeans', 'soybean'] },   // Soybeans, mature seeds, raw
  { fdc: 168410, zh: ['毛豆', '毛豆仁'], en: ['edamame'], units: { '包': 'package' } },   // Edamame, frozen, unprepared
  { fdc: 172443, zh: ['纳豆'], en: ['natto'] },   // Natto
  { fdc: 172442, zh: ['味噌', '黄豆酱', '大酱', '豆瓣酱', '郫县豆瓣'], en: ['miso', 'doubanjiang', 'soybean paste'], note: 'approximation: 豆瓣酱 / 黄豆酱 / 大酱 (Chinese bean pastes) use miso' },   // Miso
  { fdc: 174272, zh: ['天贝'], en: ['tempeh'] },   // Tempeh
  // ---------- 海鲜 ----------
  { fdc: 175179, zh: ['虾', '虾仁', '鲜虾', '大虾', '基围虾', '明虾', '对虾', '白虾'], en: ['shrimp', 'prawns', 'prawn'] },   // Crustaceans, shrimp, raw
  { fdc: 174223, zh: ['鱿鱼', '鱿鱼须', '透抽', '小卷'], en: ['squid', 'calamari'] },   // Mollusks, squid, mixed species, raw
  { fdc: 174215, zh: ['墨鱼', '乌贼', '花枝', '墨斗鱼'], en: ['cuttlefish'] },   // Mollusks, cuttlefish, mixed species, raw
  { fdc: 174218, zh: ['章鱼', '八爪鱼'], en: ['octopus'] },   // Mollusks, octopus, common, raw
  { fdc: 175167, zh: ['三文鱼', '鲑鱼', '三文鱼排'], en: ['salmon', 'salmon fillet'] },   // Fish, salmon, Atlantic, farmed, raw
  { fdc: 171955, zh: ['鳕鱼', '大西洋鳕鱼', '黄鳝', '鳝鱼', '鳝丝', '鳝段'], en: ['cod', 'rice-field eel', 'swamp eel'], note: 'approximation: 黄鳝 / 鳝鱼 (rice-field eel, very lean: about 90 kcal, 1-2 g fat) use Atlantic cod (lean white fish), not eel (184 kcal)' },   // Fish, cod, Atlantic, raw
  { fdc: 175134, zh: ['银鳕鱼', '黑鳕鱼'], en: ['black cod', 'sablefish'] },   // Fish, sablefish, raw
  { fdc: 173673, zh: ['带鱼', '马鲛鱼', '鲅鱼'], en: ['spanish mackerel', 'hairtail', 'ribbonfish'], note: 'approximation: 带鱼 (hairtail) uses Spanish mackerel (similar lean white-fleshed sea fish)' },   // Fish, mackerel, spanish, raw
  { fdc: 175142, zh: ['鲈鱼', '海鲈鱼'], en: ['sea bass', 'bass'] },   // Fish, sea bass, mixed species, raw
  { fdc: 175176, zh: ['罗非鱼', '台湾鲷', '鲷鱼片'], en: ['tilapia'] },   // Fish, tilapia, raw
  { fdc: 171952, zh: ['鲤鱼', '鲫鱼', '草鱼', '鲢鱼', '胖头鱼', '鳙鱼', '鱼头'], en: ['carp', 'grass carp', 'crucian carp'], note: 'approximation: 鲫鱼 / 草鱼 / 鲢鱼 use carp (same family, similar flesh)' },   // Fish, carp, raw
  { fdc: 174192, zh: ['黄花鱼', '黄鱼', '小黄鱼', '大黄鱼'], en: ['yellow croaker', 'croaker'] },   // Fish, croaker, Atlantic, raw
  { fdc: 175159, zh: ['金枪鱼', '吞拿鱼', '鲔鱼'], en: ['tuna', 'ahi tuna'] },   // Fish, tuna, fresh, yellowfin, raw
  { fdc: 173709, zh: ['金枪鱼罐头', '水浸金枪鱼'], en: ['canned tuna'] },   // Fish, tuna, light, canned in water, drained solids (Includes foods for USDA's Food Distribution Program)
  { fdc: 175119, zh: ['鲭鱼', '青花鱼', '鲐鱼'], en: ['mackerel'] },   // Fish, mackerel, Atlantic, raw
  { fdc: 175139, zh: ['沙丁鱼'], en: ['sardines'] },   // Fish, sardine, Atlantic, canned in oil, drained solids with bone
  { fdc: 174193, zh: ['鳗鱼'], en: ['eel'] },   // Fish, eel, mixed species, raw
  { fdc: 174196, zh: ['比目鱼', '多宝鱼', '龙利鱼', '鲽鱼'], en: ['flounder', 'sole'], note: 'approximation: 龙利鱼 (sold as sole, often basa) uses flatfish' },   // Fish, flatfish (flounder and sole species), raw
  { fdc: 175165, zh: ['鲶鱼', '鲇鱼', '巴沙鱼'], en: ['catfish', 'basa', 'swai'], note: 'approximation: 巴沙鱼 (basa) uses farmed channel catfish' },   // Fish, catfish, channel, farmed, raw
  { fdc: 173717, zh: ['虹鳟', '鳟鱼'], en: ['trout', 'rainbow trout'] },   // Fish, trout, rainbow, farmed, raw
  { fdc: 173682, zh: ['鲳鱼', '平鱼', '金鲳鱼'], en: ['pompano', 'pomfret'], note: 'approximation: 鲳鱼 (pomfret) uses Florida pompano' },   // Fish, pompano, florida, raw
  { fdc: 174200, zh: ['大比目鱼'], en: ['halibut'] },   // Fish, halibut, Atlantic and Pacific, raw
  { fdc: 175132, zh: ['鱼子', '鱼籽'], en: ['fish roe', 'roe'] },   // Fish, roe, mixed species, raw
  { fdc: 174204, zh: ['螃蟹', '蟹', '大闸蟹', '蟹肉', '梭子蟹'], en: ['crab', 'crab meat'], units: { '个': null } },   // Crustaceans, crab, blue, raw（「1 crab」21 g 是一只小蓝蟹的肉）
  { fdc: 175164, zh: ['帝王蟹'], en: ['king crab'], units: { '个': null } },   // Crustaceans, crab, alaska king, raw（「1 leg」是一条蟹腿，不是一只）
  { fdc: 174208, zh: ['龙虾'], en: ['lobster'] },   // Crustaceans, lobster, northern, raw
  { fdc: 175169, zh: ['小龙虾'], en: ['crawfish', 'crayfish'] },   // Crustaceans, crayfish, mixed species, farmed, raw
  { fdc: 174214, zh: ['蛤蜊', '花蛤', '蚬子', '蛤', '文蛤'], en: ['clams', 'clam'] },   // Mollusks, clam, mixed species, raw
  { fdc: 174220, zh: ['扇贝', '带子', '扇贝肉', '鲜贝'], en: ['scallops', 'scallop'] },   // Mollusks, scallop, mixed species, raw
  { fdc: 174219, zh: ['生蚝', '牡蛎', '蚝', '海蛎子'], en: ['oysters', 'oyster'] },   // Mollusks, oyster, Pacific, raw
  { fdc: 174216, zh: ['青口', '贻贝', '淡菜'], en: ['mussels', 'mussel'] },   // Mollusks, mussel, blue, raw
  { fdc: 174212, zh: ['鲍鱼'], en: ['abalone'] },   // Mollusks, abalone, mixed species, raw
  { fdc: 173702, zh: ['蟹棒', '蟹柳', '蟹肉棒', '鱼糜'], en: ['imitation crab', 'surimi', 'crab sticks'] },   // Fish, surimi
  // ---------- 海藻、菌 ----------
  { fdc: 168457, zh: ['海带', '海带丝', '海带结', '昆布'], en: ['kelp', 'kombu'] },   // Seaweed, kelp, raw
  { fdc: 170496, zh: ['裙带菜', '海草'], en: ['wakame'] },   // Seaweed, wakame, raw
  { fdc: 170495, zh: ['紫菜', '海苔', '寿司海苔', '干紫菜'], en: ['nori', 'dried seaweed', 'seaweed'], note: 'approximation: 紫菜 / 海苔 (dried laver) use dried spirulina (similar per 100 g dried)', volume: false },   // Seaweed, spirulina, dried（杯、勺、密度都是粉的，干紫菜、海苔片轻得多，按 1 g/ml 猜更差：宁可换算不了）
  // 木耳、黑木耳、云耳在菜谱里多半写的是泡发以后的重量（「黑木耳 200g（泡发后）」）：按鲜的算，每 100 g 25 千卡；按干的（284 千卡）会多算十倍。
  // 写了「干」的才是干的。银耳一般买干的、按干重写（「银耳 15g」），照旧用干的那一条；泡发、水发开头的别的东西 PREFIX_WORDS 挡着
  { fdc: 169237, zh: ['木耳', '黑木耳', '云耳', '鲜木耳', '泡发木耳', '水发木耳', '泡发黑木耳', '水发黑木耳'], en: ['wood ear', 'black fungus', 'wood ear mushroom'], note: 'approximation: 木耳 / 黑木耳 / 云耳 in recipes are mostly weighed after soaking; use raw Jew\'s ear (close to soaked wood ear), 干木耳 is the dried one', units: { '块': null } },   // Jew's ear, (pepeao), raw
  { fdc: 168581, zh: ['干木耳', '干黑木耳', '干云耳', '银耳', '白木耳', '干银耳'], en: ['dried wood ear', 'dried black fungus', 'dried cloud ear'], note: 'approximation: 银耳 (white fungus) uses dried cloud ears', units: { '个': null, '块': null } },   // Fungi, Cloud ears, dried（「1 piece」4.5 g 是一小片云耳，一朵银耳一二十克）
  { fdc: 169242, zh: ['香菇', '鲜香菇', '冬菇', '花菇'], en: ['shiitake', 'shiitake mushrooms'] },   // Mushrooms, shiitake, raw
  { fdc: 168436, zh: ['干香菇', '香菇干'], en: ['dried shiitake', 'dried shiitake mushrooms'] },   // Mushrooms, shiitake, dried
  { fdc: 169382, zh: ['金针菇'], en: ['enoki', 'enoki mushrooms'] },   // Mushrooms, enoki, raw
  { fdc: 168580, zh: ['平菇', '杏鲍菇', '秀珍菇', '蚝菇', '鸿喜菇', '蟹味菇', '白玉菇'], en: ['oyster mushrooms', 'king oyster mushrooms', 'king trumpet mushrooms', 'shimeji'], note: 'approximation: 杏鲍菇 (king oyster) and 鸿喜菇 / 蟹味菇 (shimeji) use oyster mushrooms', units: { '个': null } },   // Mushrooms, oyster, raw（「1 large」148 g、「1 small」15 g，一个说不准）
  { fdc: 169251, zh: ['蘑菇', '口蘑', '白蘑菇', '洋菇', '蘑菇片'], en: ['mushrooms', 'white mushrooms', 'button mushrooms', 'mushroom'] },   // Mushrooms, white, raw
  { fdc: 168434, zh: ['褐蘑菇', '棕蘑菇'], en: ['cremini', 'crimini mushrooms', 'baby bella'] },   // Mushrooms, brown, italian, or crimini, raw
  { fdc: 169255, zh: ['大褐菇', '波特贝勒菇'], en: ['portobello', 'portabella'] },   // Mushrooms, portabella, raw
  { fdc: 169403, zh: ['舞茸', '灰树花'], en: ['maitake'] },   // Mushrooms, maitake, raw
  // ---------- 蔬菜 ----------
  { fdc: 169979, zh: ['大白菜', '白菜', '黄芽白', '结球白菜', '绍菜', '娃娃菜'], en: ['napa cabbage', 'chinese cabbage', 'napa'] },   // Cabbage, chinese (pe-tsai), raw
  { fdc: 170390, zh: ['小白菜', '青菜', '上海青', '油菜', '青江菜', '白菜仔', '菜心', '小油菜', '小青菜'], en: ['bok choy', 'pak choi', 'baby bok choy', 'shanghai bok choy'], note: 'approximation: 菜心 (choy sum) uses bok choy', units: { '个': null } },   // Cabbage, chinese (pak-choi), raw（「1 head」840 g 是大棵的白菜仔，上海青、小白菜一颗只有几十克）
  { fdc: 168462, zh: ['菠菜', '菠菜叶'], en: ['spinach', 'baby spinach'] },   // Spinach, raw
  { fdc: 169249, zh: ['生菜', '生菜叶'], en: ['lettuce', 'leaf lettuce', 'green leaf lettuce'], units: { '片': 'leaf outer', '个': 'head' } },   // Lettuce, green leaf, raw
  { fdc: 169248, zh: ['球生菜', '结球生菜', '西生菜', '美生菜'], en: ['iceberg lettuce', 'iceberg'], units: { '片': 'leaf', '个': 'head' } },   // Lettuce, iceberg (includes crisphead types), raw
  { fdc: 169247, zh: ['罗马生菜', '油麦菜', '莴笋叶'], en: ['romaine', 'romaine lettuce', 'a-choy'], note: 'approximation: 油麦菜 (A-choy) uses romaine', units: { '片': 'leaf outer', '个': 'head' } },   // Lettuce, cos or romaine, raw
  { fdc: 169301, zh: ['空心菜', '通菜', '蕹菜'], en: ['water spinach', 'ong choy'] },   // Water convolvulus,raw
  { fdc: 169994, zh: ['韭菜', '韭黄', '韭菜花', '细香葱'], en: ['chives', 'garlic chives', 'chinese chives'], note: 'approximation: 韭菜 (garlic chives) uses chives' },   // Chives, raw
  { fdc: 169988, zh: ['芹菜', '西芹', '芹菜段', '香芹菜'], en: ['celery'] },   // Celery, raw
  { fdc: 170416, zh: ['欧芹', '香芹', '法香'], en: ['parsley'] },   // Parsley, fresh
  { fdc: 169997, zh: ['香菜', '芫荽', '胡荽'], en: ['cilantro', 'coriander leaves'] },   // Coriander (cilantro) leaves, raw
  { fdc: 170005, zh: ['葱', '小葱', '香葱', '青葱', '葱段', '葱花', '葱白', '葱叶', '小香葱'], en: ['scallions', 'green onions', 'spring onions', 'green onion', 'scallion'], units: { '根': 'medium' } },   // Onions, spring or scallions (includes tops and bulb), raw
  { fdc: 170007, zh: ['大葱', '京葱'], en: ['welsh onion', 'long green onion'] },   // Onions, welsh, raw
  { fdc: 170000, zh: ['洋葱', '洋葱丝', '洋葱丁', '圆葱', '紫洋葱', '红洋葱', '白洋葱'], en: ['onion', 'onions', 'yellow onion', 'red onion', 'white onion'] },   // Onions, raw
  { fdc: 170499, zh: ['红葱头', '干葱', '小洋葱'], en: ['shallots', 'shallot'] },   // Shallots, raw
  { fdc: 169246, zh: ['韭葱', '蒜苗', '青蒜'], en: ['leeks', 'leek'], note: 'approximation: 蒜苗 / 青蒜 (garlic shoots) use leeks', units: { '根': 'leek' } },   // Leeks, (bulb and lower leaf-portion), raw
  { fdc: 169230, zh: ['蒜', '大蒜', '蒜头', '蒜瓣', '蒜末', '蒜蓉', '蒜泥', '独头蒜'], en: ['garlic', 'garlic cloves', 'clove garlic'] },   // Garlic, raw
  { fdc: 169231, zh: ['姜', '生姜', '老姜', '嫩姜', '姜片', '姜丝', '姜末', '姜蓉'], en: ['ginger', 'fresh ginger', 'ginger root'] },   // Ginger root, raw
  { fdc: 170106, zh: ['辣椒', '红辣椒', '尖椒', '鲜辣椒', '红尖椒'], en: ['chili', 'chili pepper', 'red chili', 'chilies', 'chiles'], units: { '个': null } },   // Peppers, hot chili, red, raw（「1 pepper」45 g，中文的辣椒从几克到几十克）
  { fdc: 169395, zh: ['小米辣', '朝天椒', '小辣椒', '指天椒', '小米椒'], en: ['thai chili', 'bird\'s eye chili', 'serrano', 'serrano pepper'], note: 'approximation: 小米辣 / 朝天椒 (bird\'s eye chilies) use serrano peppers (closest small chili; a bird\'s eye chili is about half a serrano, 2-5 g)' },   // Peppers, serrano, raw
  { fdc: 170497, zh: ['青辣椒', '青尖椒', '杭椒', '线椒', '螺丝椒'], en: ['green chili', 'green chile'], units: { '个': null } },   // Peppers, hot chili, green, raw（「1 pepper」45 g，杭椒、线椒一根十几克）
  { fdc: 168576, zh: ['墨西哥辣椒'], en: ['jalapeno', 'jalapeno pepper'] },   // Peppers, jalapeno, raw
  { fdc: 170427, zh: ['青椒', '灯笼椒', '柿子椒'], en: ['green bell pepper', 'green pepper'] },   // Peppers, sweet, green, raw
  { fdc: 170108, zh: ['红椒', '红甜椒', '彩椒', '甜椒', '红彩椒'], en: ['red bell pepper', 'bell pepper', 'red pepper'] },   // Peppers, sweet, red, raw
  { fdc: 169383, zh: ['黄椒', '黄甜椒', '黄彩椒'], en: ['yellow bell pepper'] },   // Peppers, sweet, yellow, raw
  { fdc: 169228, zh: ['茄子', '长茄子', '圆茄子', '紫茄子'], en: ['eggplant', 'aubergine', 'chinese eggplant'], units: { '个': null } },   // Eggplant, raw（「1 eggplant」是 500 多克的圆茄子，长茄子一根两百多克）
  { fdc: 168409, zh: ['黄瓜', '青瓜', '胡瓜'], en: ['cucumber', 'cucumbers', 'english cucumber'], units: { '根': 'cucumber' } },   // Cucumber, with peel, raw
  { fdc: 170457, zh: ['番茄', '西红柿', '蕃茄'], en: ['tomato', 'tomatoes'] },   // Tomatoes, red, ripe, raw, year round average
  { fdc: 170051, zh: ['番茄罐头', '罐头番茄', '番茄丁罐头'], en: ['canned tomatoes', 'diced tomatoes', 'crushed tomatoes'] },   // Tomatoes, red, ripe, canned, packed in tomato juice
  { fdc: 170459, zh: ['番茄膏', '番茄糊'], en: ['tomato paste'] },   // Tomato products, canned, paste, without salt added (Includes foods for USDA's Food Distribution Program)
  { fdc: 170054, zh: ['番茄酱汁', '意面酱', '番茄沙司'], en: ['tomato sauce', 'marinara'] },   // Tomato products, canned, sauce
  { fdc: 170026, zh: ['土豆', '马铃薯', '洋芋', '土豆丝', '土豆片', '土豆块', '薯仔'], en: ['potato', 'potatoes', 'russet potatoes', 'yukon gold potatoes'] },   // Potatoes, flesh and skin, raw
  { fdc: 168482, zh: ['红薯', '地瓜', '番薯', '甘薯', '紫薯', '白薯', '山芋'], en: ['sweet potato', 'sweet potatoes', 'yam'], note: 'approximation: 紫薯 (purple sweet potato) uses sweet potato' },   // Sweet potato, raw, unprepared (Includes foods for USDA's Food Distribution Program)
  { fdc: 168432, zh: ['山药', '淮山', '铁棍山药', '淮山药'], en: ['chinese yam', 'nagaimo'], note: 'approximation: 山药 (Chinese yam, nagaimo, about 57-65 kcal) uses Hawaiian mountain yam, not tropical yam (118 kcal)', units: { '个': null } },   // Mountain yam, hawaii, raw（「1 yam」420 g，山药一根大小差得多）
  { fdc: 169308, zh: ['芋头', '芋艿', '芋', '香芋', '小芋头'], en: ['taro'] },   // Taro, raw
  { fdc: 170393, zh: ['胡萝卜', '红萝卜', '胡萝卜丝', '胡萝卜丁'], en: ['carrot', 'carrots'], units: { '根': 'medium' } },   // Carrots, raw
  { fdc: 168568, zh: ['小胡萝卜', '迷你胡萝卜', '手指胡萝卜'], en: ['baby carrot', 'mini carrot'] },   // Carrots, baby, raw
  { fdc: 168451, zh: ['白萝卜', '萝卜', '青萝卜', '水萝卜'], en: ['daikon', 'daikon radish', 'chinese radish'], units: { '根': 'radish' } },   // Radishes, oriental, raw
  { fdc: 169276, zh: ['樱桃萝卜', '小萝卜'], en: ['radish', 'radishes'] },   // Radishes, raw
  { fdc: 170069, zh: ['冬瓜'], en: ['winter melon', 'wax gourd'] },   // Waxgourd, (chinese preserving melon), raw
  { fdc: 168393, zh: ['苦瓜', '凉瓜'], en: ['bitter melon', 'bitter gourd'] },   // Balsam-pear (bitter gourd), pods, raw
  { fdc: 168414, zh: ['丝瓜'], en: ['luffa', 'loofah', 'chinese okra'] },   // Gourd, dishcloth (towelgourd), raw
  { fdc: 169232, zh: ['葫芦', '瓠瓜', '蒲瓜', '瓠子'], en: ['opo squash', 'calabash', 'bottle gourd'] },   // Gourd, white-flowered (calabash), raw
  { fdc: 170402, zh: ['佛手瓜', '合掌瓜'], en: ['chayote'] },   // Chayote, fruit, raw
  { fdc: 168448, zh: ['南瓜', '老南瓜'], en: ['pumpkin'] },   // Pumpkin, raw
  { fdc: 169291, zh: ['西葫芦', '节瓜', '角瓜'], en: ['zucchini', 'courgette', 'summer squash'] },   // Squash, summer, zucchini, includes skin, raw
  { fdc: 169295, zh: ['胡桃南瓜', '奶油南瓜'], en: ['butternut squash'] },   // Squash, winter, butternut, raw
  { fdc: 169250, zh: ['莲藕', '藕', '藕片'], en: ['lotus root'] },   // Lotus root, raw
  { fdc: 169210, zh: ['竹笋', '笋', '春笋', '冬笋', '笋尖', '鲜笋'], en: ['bamboo shoots', 'bamboo shoot'] },   // Bamboo shoots, raw
  { fdc: 169212, zh: ['罐头笋', '笋片罐头'], en: ['canned bamboo shoots'] },   // Bamboo shoots, canned, drained solids
  { fdc: 169957, zh: ['豆芽', '绿豆芽', '银芽', '豆芽菜', '黄豆芽'], en: ['bean sprouts', 'mung bean sprouts', 'soybean sprouts'], note: 'approximation: 黄豆芽 (long soybean sprouts, about 44 kcal) uses mung bean sprouts (USDA sprouted soybeans are mostly bean, 122 kcal)', units: { '包': 'package' } },   // Mung beans, mature seeds, sprouted, raw
  { fdc: 170379, zh: ['西兰花', '西蓝花', '青花菜', '绿花椰', '绿花椰菜'], en: ['broccoli', 'broccoli florets'] },   // Broccoli, raw
  { fdc: 169986, zh: ['花菜', '菜花', '花椰菜', '白花椰', '有机花菜', '白花椰菜'], en: ['cauliflower'] },   // Cauliflower, raw
  { fdc: 169404, zh: ['芥兰', '芥蓝'], en: ['chinese broccoli', 'gai lan'] },   // Broccoli, chinese, raw
  { fdc: 169256, zh: ['芥菜', '雪里蕻', '雪菜'], en: ['mustard greens'] },   // Mustard greens, raw
  { fdc: 169995, zh: ['茼蒿', '茼蒿菜', '皇帝菜'], en: ['garland chrysanthemum', 'tong ho'] },   // Chrysanthemum, garland, raw
  { fdc: 168385, zh: ['苋菜', '汉菜', '红苋菜'], en: ['amaranth greens', 'amaranth leaves'] },   // Amaranth leaves, raw
  { fdc: 170068, zh: ['西洋菜', '豆瓣菜'], en: ['watercress'] },   // Watercress, raw
  { fdc: 170392, zh: ['泡菜', '韩国泡菜', '辣白菜'], en: ['kimchi'] },   // Cabbage, kimchi
  { fdc: 169975, zh: ['卷心菜', '包菜', '圆白菜', '高丽菜', '甘蓝', '洋白菜', '包心菜', '椰菜'], en: ['cabbage', 'green cabbage'], units: { '个': 'head' } },   // Cabbage, raw
  { fdc: 169977, zh: ['紫甘蓝', '红甘蓝', '紫包菜'], en: ['red cabbage', 'purple cabbage'], units: { '个': 'head' } },   // Cabbage, red, raw
  { fdc: 170383, zh: ['抱子甘蓝', '球芽甘蓝'], en: ['brussels sprouts'] },   // Brussels sprouts, raw
  { fdc: 168421, zh: ['羽衣甘蓝'], en: ['kale'] },   // Kale, raw
  { fdc: 169260, zh: ['秋葵'], en: ['okra'] },   // Okra, raw
  { fdc: 168389, zh: ['芦笋', '石刁柏'], en: ['asparagus'] },   // Asparagus, raw
  { fdc: 169998, zh: ['玉米', '甜玉米', '玉米粒', '鲜玉米', '玉米棒'], en: ['corn', 'sweet corn', 'corn kernels', 'corn on the cob'], units: { '根': 'ear, medium' } },   // Corn, sweet, yellow, raw
  { fdc: 170419, zh: ['豌豆', '青豆', '豌豆粒', '青豌豆'], en: ['peas', 'green peas'] },   // Peas, green, raw
  { fdc: 170010, zh: ['荷兰豆', '甜豆', '甜豌豆'], en: ['snow peas', 'sugar snap peas', 'snap peas'] },   // Peas, edible-podded, raw
  { fdc: 169961, zh: ['四季豆', '豆角', '芸豆角', '扁豆', '菜豆', '敏豆'], en: ['green beans', 'string beans'], units: { '根': 'bean' } },   // Beans, snap, green, raw
  { fdc: 169222, zh: ['豇豆', '长豆角', '豆角丝'], en: ['long beans', 'yardlong beans', 'chinese long beans'], units: { '根': 'pod' } },   // Yardlong bean, raw
  { fdc: 170377, zh: ['蚕豆', '胡豆', '鲜蚕豆'], en: ['fava beans', 'broad beans'] },   // Broadbeans, immature seeds, raw
  { fdc: 169145, zh: ['甜菜', '甜菜根', '红菜头'], en: ['beets', 'beet', 'beetroot'] },   // Beets, raw
  { fdc: 169974, zh: ['牛蒡'], en: ['burdock root', 'burdock', 'gobo'] },   // Burdock root, raw
  { fdc: 170066, zh: ['荸荠', '马蹄'], en: ['water chestnuts', 'water chestnut'] },   // Waterchestnuts, chinese, (matai), raw
  { fdc: 170149, zh: ['莲子', '干莲子'], en: ['lotus seeds'] },   // Seeds, lotus seeds, dried
  { fdc: 169385, zh: ['茴香', '球茎茴香', '茴香头'], en: ['fennel', 'fennel bulb'], note: 'approximation: 茴香 (fennel greens) uses fennel bulb' },   // Fennel, bulb, raw
  { fdc: 168412, zh: ['苦菊', '苦苣'], en: ['endive', 'frisee'] },   // Endive, raw
  { fdc: 169387, zh: ['芝麻菜', '火箭菜'], en: ['arugula', 'rocket'] },   // Arugula, raw
  { fdc: 171705, zh: ['牛油果', '酪梨', '鳄梨'], en: ['avocado', 'avocados'] },   // Avocados, raw, all commercial varieties
  { fdc: 169279, zh: ['酸菜', '东北酸菜', '德国酸菜'], en: ['sauerkraut', 'pickled cabbage'], note: 'approximation: 酸菜 (Chinese pickled cabbage) uses sauerkraut' },   // Sauerkraut, canned, solids and liquids
  { fdc: 168558, zh: ['酸黄瓜', '腌黄瓜'], en: ['pickles', 'dill pickles'] },   // Pickles, cucumber, dill or kosher dill
  { fdc: 169094, zh: ['橄榄', '黑橄榄'], en: ['olives', 'black olives'] },   // Olives, ripe, canned (small-extra large)
  { fdc: 172238, zh: ['刺山柑', '酸豆'], en: ['capers'] },   // Capers, canned
  { fdc: 168583, zh: ['山葵'], en: ['wasabi'] },   // Wasabi, root, raw
  { fdc: 168573, zh: ['香茅', '柠檬草'], en: ['lemongrass', 'lemon grass'] },   // Lemon grass (citronella), raw
  { fdc: 169205, zh: ['洋蓟', '朝鲜蓟'], en: ['artichoke', 'artichokes'] },   // Artichokes, (globe or french), raw
  { fdc: 169287, zh: ['冷冻菠菜'], en: ['frozen spinach'], units: { '包': 'package' } },   // Spinach, frozen, chopped or leaf, unprepared (Includes foods for USDA's Food Distribution Program)
  { fdc: 170471, zh: ['冷冻杂菜', '杂菜', '什锦蔬菜'], en: ['mixed vegetables', 'frozen mixed vegetables'], units: { '包': 'package (10 oz)' } },   // Vegetables, mixed, frozen, unprepared
  // ---------- 水果 ----------
  { fdc: 171688, zh: ['苹果', '红富士', '青苹果'], en: ['apple', 'apples'] },   // Apples, raw, with skin (Includes foods for USDA's Food Distribution Program)
  { fdc: 173944, zh: ['香蕉'], en: ['banana', 'bananas'], units: { '根': 'medium' } },   // Bananas, raw
  { fdc: 169097, zh: ['橙子', '橙', '甜橙', '脐橙', '柳丁', '柳橙'], en: ['orange', 'oranges'] },   // Oranges, raw, all commercial varieties
  { fdc: 169105, zh: ['橘子', '桔子', '柑橘', '蜜橘', '沃柑'], en: ['mandarin', 'mandarins', 'tangerine', 'clementines'] },   // Tangerines, (mandarin oranges), raw
  { fdc: 167746, zh: ['柠檬', '黄柠檬'], en: ['lemon', 'lemons'] },   // Lemons, raw, without peel
  { fdc: 167747, zh: ['柠檬汁'], en: ['lemon juice'], units: { '块': null } },   // Lemon juice, raw（「1 wedge yields」是一块柠檬挤出来的汁，不是「一块柠檬汁」）
  { fdc: 168155, zh: ['青柠', '莱姆', '青柠檬'], en: ['lime', 'limes'] },   // Limes, raw
  { fdc: 168156, zh: ['青柠汁'], en: ['lime juice'] },   // Lime juice, raw
  { fdc: 174683, zh: ['葡萄', '提子', '青提', '红提'], en: ['grapes', 'grape'] },   // Grapes, red or green (European type, such as Thompson seedless), raw
  { fdc: 168165, zh: ['葡萄干', '提子干'], en: ['raisins'] },   // Raisins, dark, seedless (Includes foods for USDA's Food Distribution Program)
  { fdc: 167762, zh: ['草莓'], en: ['strawberries', 'strawberry'] },   // Strawberries, raw
  { fdc: 171711, zh: ['蓝莓'], en: ['blueberries'] },   // Blueberries, raw
  { fdc: 167755, zh: ['树莓', '覆盆子', '山莓'], en: ['raspberries'] },   // Raspberries, raw
  { fdc: 173946, zh: ['黑莓'], en: ['blackberries'] },   // Blackberries, raw
  { fdc: 171723, zh: ['蔓越莓干', '蔓越莓'], en: ['dried cranberries', 'craisins'] },   // Cranberries, dried, sweetened (Includes foods for USDA's Food Distribution Program)
  { fdc: 167765, zh: ['西瓜'], en: ['watermelon'] },   // Watermelon, raw
  { fdc: 169092, zh: ['哈密瓜', '甜瓜', '香瓜'], en: ['cantaloupe', 'melon'] },   // Melons, cantaloupe, raw
  { fdc: 169911, zh: ['蜜瓜', '白兰瓜'], en: ['honeydew'] },   // Melons, honeydew, raw
  { fdc: 169118, zh: ['梨', '西洋梨', '啤梨'], en: ['pear', 'pears'] },   // Pears, raw
  { fdc: 168177, zh: ['雪梨', '鸭梨', '亚洲梨', '丰水梨', '水晶梨', '香梨', '水梨'], en: ['asian pear', 'asian pears'] },   // Pears, asian, raw
  { fdc: 169928, zh: ['桃', '桃子', '黄桃', '水蜜桃', '蟠桃'], en: ['peach', 'peaches'] },   // Peaches, yellow, raw
  { fdc: 169914, zh: ['油桃'], en: ['nectarine', 'nectarines'] },   // Nectarines, raw
  { fdc: 171697, zh: ['杏', '杏子'], en: ['apricot', 'apricots'] },   // Apricots, raw
  { fdc: 169949, zh: ['李子', '布朗'], en: ['plum', 'plums'] },   // Plums, raw
  { fdc: 171719, zh: ['樱桃', '车厘子'], en: ['cherries', 'cherry'] },   // Cherries, sweet, raw
  { fdc: 169910, zh: ['芒果'], en: ['mango', 'mangoes', 'mangos'] },   // Mangos, raw
  { fdc: 169124, zh: ['菠萝', '凤梨'], en: ['pineapple'], units: { '片': 'slice (3-1/2' } },   // Pineapple, raw, all varieties
  { fdc: 168153, zh: ['猕猴桃', '奇异果'], en: ['kiwi', 'kiwifruit'] },   // Kiwifruit, green, raw
  { fdc: 167754, zh: ['柚子', '柚', '文旦', '沙田柚', '蜜柚'], en: ['pomelo', 'pummelo'] },   // Pummelo, raw
  { fdc: 174673, zh: ['葡萄柚', '西柚'], en: ['grapefruit'] },   // Grapefruit, raw, pink and red, all areas
  { fdc: 169134, zh: ['石榴'], en: ['pomegranate'] },   // Pomegranates, raw
  { fdc: 169941, zh: ['柿子', '柿', '甜柿'], en: ['persimmon', 'persimmons'] },   // Persimmons, japanese, raw
  { fdc: 169926, zh: ['木瓜', '番木瓜'], en: ['papaya'] },   // Papayas, raw
  { fdc: 170169, zh: ['椰子', '椰肉', '椰子肉'], en: ['coconut', 'coconut meat'] },   // Nuts, coconut meat, raw
  { fdc: 170174, zh: ['椰子水'], en: ['coconut water'] },   // Nuts, coconut water (liquid from coconuts)
  { fdc: 168192, zh: ['榴莲'], en: ['durian'] },   // Durian, raw or frozen
  { fdc: 169108, zh: ['百香果'], en: ['passion fruit'] },   // Passion-fruit, (granadilla), purple, raw
  { fdc: 173021, zh: ['无花果'], en: ['figs', 'fig'] },   // Figs, raw
  { fdc: 169086, zh: ['荔枝'], en: ['lychee', 'lychees', 'litchi'] },   // Litchis, raw
  { fdc: 169089, zh: ['龙眼', '桂圆'], en: ['longan', 'longans'] },   // Longans, raw
  { fdc: 169907, zh: ['桂圆干', '龙眼干', '桂圆肉'], en: ['dried longan'] },   // Longans, dried
  { fdc: 168152, zh: ['红枣', '大枣', '枣', '干枣', '金丝枣'], en: ['jujube', 'red dates', 'chinese dates', 'dried jujube'] },   // Jujube, Chinese, fresh, dried
  { fdc: 173032, zh: ['枸杞', '枸杞子'], en: ['goji berries', 'goji', 'wolfberry'] },   // Goji berries, dried
  { fdc: 168154, zh: ['金桔', '金橘'], en: ['kumquat', 'kumquats'] },   // Kumquats, raw
  { fdc: 169908, zh: ['枇杷'], en: ['loquat', 'loquats'] },   // Loquats, raw
  { fdc: 171715, zh: ['杨桃', '阳桃'], en: ['star fruit', 'starfruit', 'carambola'] },   // Carambola, (starfruit), raw
  { fdc: 173044, zh: ['番石榴', '芭乐'], en: ['guava'] },   // Guavas, common, raw
  { fdc: 169090, zh: ['山竹'], en: ['mangosteen'] },   // Mangosteen, canned, syrup pack
  { fdc: 168191, zh: ['椰枣', '蜜枣'], en: ['dates', 'medjool dates'] },   // Dates, medjool
  { fdc: 168160, zh: ['西梅干', '西梅'], en: ['prunes'] },   // Prunes, dehydrated (low-moisture), uncooked
  { fdc: 167758, zh: ['大黄'], en: ['rhubarb'] },   // Rhubarb, raw
  // ---------- 谷物、面食 ----------
  { fdc: 168877, zh: ['大米', '米', '白米', '生米', '香米', '泰国香米', '籼米', '长粒米'], en: ['rice', 'white rice', 'jasmine rice', 'long grain rice', 'uncooked rice'] },   // Rice, white, long-grain, regular, raw, enriched
  { fdc: 168878, zh: ['米饭', '白米饭', '白饭', '熟米饭', '剩米饭', '隔夜饭'], en: ['cooked rice', 'steamed rice', 'cooked white rice'] },   // Rice, white, long-grain, regular, enriched, cooked
  { fdc: 169760, zh: ['东北大米', '粳米', '珍珠米', '寿司米', '中粒米'], en: ['medium grain rice', 'sushi rice', 'calrose rice'] },   // Rice, white, medium-grain, raw, unenriched
  { fdc: 168883, zh: ['糯米', '江米', '圆糯米', '长糯米'], en: ['glutinous rice', 'sticky rice', 'sweet rice'] },   // Rice, white, glutinous, unenriched, uncooked
  { fdc: 169711, zh: ['糯米饭'], en: ['cooked sticky rice'] },   // Rice, white, glutinous, unenriched, cooked
  { fdc: 169703, zh: ['糙米'], en: ['brown rice'] },   // Rice, brown, long-grain, raw (Includes foods for USDA's Food Distribution Program)
  { fdc: 169704, zh: ['糙米饭'], en: ['cooked brown rice'] },   // Rice, brown, long-grain, cooked (Includes foods for USDA's Food Distribution Program)
  { fdc: 169726, zh: ['菰米', '野米'], en: ['wild rice'] },   // Wild rice, raw
  { fdc: 169702, zh: ['小米', '黄小米'], en: ['millet'] },   // Millet, raw
  { fdc: 170284, zh: ['大麦', '薏米', '薏仁', '珍珠麦'], en: ['pearl barley', 'barley', 'job\'s tears'], note: 'approximation: 薏米 / 薏仁 (Job\'s tears) use pearled barley' },   // Barley, pearled, raw
  { fdc: 168874, zh: ['藜麦'], en: ['quinoa'] },   // Quinoa, uncooked
  { fdc: 169705, zh: ['燕麦', '燕麦粒', '燕麦米'], en: ['oats', 'oat groats', 'whole oats'] },   // Oats (Includes foods for USDA's Food Distribution Program)（整粒的，一杯 156 g）
  { fdc: 173904, zh: ['燕麦片', '麦片', '即食燕麦', '即食燕麦片', '快熟燕麦'], en: ['rolled oats', 'oatmeal', 'quick oats', 'old-fashioned oats', 'oat flakes'] },   // Cereals, oats, regular and quick, not fortified, dry（压扁的，一杯 81 g）
  { fdc: 170286, zh: ['荞麦'], en: ['buckwheat'] },   // Buckwheat
  { fdc: 168894, zh: ['面粉', '中筋面粉', '普通面粉', '白面', '小麦粉'], en: ['flour', 'all-purpose flour', 'all purpose flour', 'plain flour'] },   // Wheat flour, white, all-purpose, enriched, bleached
  { fdc: 168896, zh: ['高筋面粉', '面包粉'], en: ['bread flour'] },   // Wheat flour, white, bread, enriched
  { fdc: 169723, zh: ['低筋面粉', '蛋糕粉'], en: ['cake flour'] },   // Wheat flour, white, cake, enriched
  { fdc: 168893, zh: ['全麦面粉', '全麦粉'], en: ['whole wheat flour'] },   // Wheat flour, whole-grain (Includes foods for USDA's Food Distribution Program)
  { fdc: 169698, zh: ['玉米淀粉', '淀粉', '生粉', '粟粉', '芡粉'], en: ['cornstarch', 'corn starch', 'cornflour'] },   // Cornstarch
  { fdc: 168446, zh: ['土豆淀粉', '马铃薯淀粉', '太白粉', '土豆粉'], en: ['potato starch', 'potato flour'], note: 'approximation: 土豆淀粉 / 太白粉 (potato starch) use potato flour' },   // Potato flour
  { fdc: 169717, zh: ['木薯淀粉', '西米', '木薯粉', '珍珠粉圆'], en: ['tapioca starch', 'tapioca', 'tapioca pearls', 'sago'] },   // Tapioca, pearl, dry
  { fdc: 169714, zh: ['粘米粉', '大米粉', '米粉粉', '在来米粉'], en: ['rice flour'] },   // Rice flour, white, unenriched
  { fdc: 169697, zh: ['玉米面', '玉米粉', '玉米碴'], en: ['cornmeal', 'polenta'], note: 'approximation: in Taiwan 玉米粉 usually means cornstarch; calories per 100 g are about the same' },   // Cornmeal, whole-grain, yellow
  { fdc: 168908, zh: ['面条', '挂面', '干面条', '龙须面', '细面'], en: ['noodles', 'dried noodles', 'wheat noodles', 'somen'], note: 'approximation: 面条 / 挂面 (dried wheat noodles) use somen' },   // Noodles, japanese, somen, dry
  { fdc: 169727, zh: ['鲜面条', '湿面条', '生面', '拉面', '手擀面', '切面'], en: ['fresh noodles', 'fresh pasta'] },   // Pasta, fresh-refrigerated, plain, as purchased
  { fdc: 169731, zh: ['鸡蛋面', '蛋面', '全蛋面', '伊面'], en: ['egg noodles'] },   // Noodles, egg, dry, enriched
  { fdc: 168906, zh: ['荞麦面'], en: ['soba', 'soba noodles'] },   // Noodles, japanese, soba, dry
  { fdc: 169736, zh: ['意大利面', '意面', '通心粉', '意粉', '螺丝粉', '笔管面'], en: ['pasta', 'spaghetti', 'penne', 'macaroni'] },   // Pasta, dry, enriched
  { fdc: 169737, zh: ['熟意面', '煮好的意面'], en: ['cooked pasta'] },   // Pasta, cooked, enriched, without added salt
  { fdc: 171177, zh: ['方便面', '泡面', '速食面', '拉面饼'], en: ['instant noodles', 'ramen', 'instant ramen'], units: { '包': 'package without' } },   // Soup, ramen noodle, any flavor, dry
  { fdc: 169742, zh: ['米粉', '米线', '河粉', '干米粉', '粿条', '檬粉'], en: ['rice noodles', 'rice vermicelli', 'pho noodles'] },   // Rice noodles, dry
  { fdc: 168914, zh: ['湿河粉', '鲜河粉', '鲜米粉', '肠粉'], en: ['fresh rice noodles', 'cooked rice noodles'] },   // Rice noodles, cooked
  { fdc: 174258, zh: ['粉丝', '冬粉', '绿豆粉丝', '龙口粉丝', '粉条', '红薯粉条', '宽粉'], en: ['glass noodles', 'cellophane noodles', 'bean thread noodles', 'vermicelli'], note: 'approximation: 粉条 / 红薯粉条 (sweet-potato starch noodles) use mung bean cellophane noodles' },   // Noodles, chinese, cellophane or long rice (mung beans), dehydrated
  { fdc: 168905, zh: ['脆面', '炸面'], en: ['chow mein noodles', 'crispy noodles'] },   // Noodles, chinese, chow mein
  { fdc: 172802, zh: ['馄饨皮', '饺子皮', '云吞皮', '春卷皮', '水饺皮', '抄手皮', '烧卖皮'], en: ['wonton wrappers', 'dumpling wrappers', 'egg roll wrappers', 'gyoza wrappers'], units: { '张': 'wrapper, wonton', '个': 'wrapper, wonton' } },   // Wonton wrappers (includes egg roll wrappers)
  { fdc: 174924, zh: ['面包', '白面包', '吐司', '吐司面包', '切片面包', '方包'], en: ['bread', 'white bread', 'toast', 'sandwich bread'] },   // Bread, white, commercially prepared (includes soft bread crumbs)
  { fdc: 172688, zh: ['全麦面包', '全麦吐司'], en: ['whole wheat bread'] },   // Bread, whole-wheat, commercially prepared
  { fdc: 174915, zh: ['馒头', '花卷', '白馒头', '皮塔饼', '口袋饼'], en: ['pita', 'steamed buns', 'mantou'], note: 'approximation: 馒头 / 花卷 (steamed buns) use white pita (same lean yeast dough; steamed buns hold more water, so a little fewer kcal)', units: { '个': null } },   // Bread, pita, white, enriched（一个皮塔饼 60 g，一个馒头一般 100 g 上下：不用它的「个」）
  { fdc: 172675, zh: ['法棍', '法式面包', '欧包'], en: ['baguette', 'french bread', 'sourdough'], units: { '片': null } },   // Bread, french or vienna (includes sourdough)（「1 slice」139 g 不像一片）
  { fdc: 174899, zh: ['贝果', '百吉饼'], en: ['bagel', 'bagels'] },   // Bagels, plain, enriched, with calcium propionate (includes onion, poppy, sesame)
  { fdc: 174987, zh: ['牛角包', '可颂', '羊角包'], en: ['croissant', 'croissants'] },   // Croissants, butter
  { fdc: 174994, zh: ['英式松饼'], en: ['english muffin', 'english muffins'] },   // Muffins, English, plain, enriched, with ca prop (includes sourdough)
  { fdc: 174928, zh: ['面包糠', '面包屑'], en: ['breadcrumbs', 'bread crumbs'] },   // Bread, crumbs, dry, grated, plain
  { fdc: 172806, zh: ['调味面包糠'], en: ['seasoned breadcrumbs'] },   // Bread, crumbs, dry, grated, seasoned
  { fdc: 175037, zh: ['墨西哥饼', '墨西哥卷饼', '面粉饼', '卷饼皮'], en: ['tortillas', 'flour tortillas', 'tortilla'], units: { '张': 'tortilla medium' } },   // Tortillas, ready-to-bake or -fry, flour, refrigerated
  { fdc: 175036, zh: ['玉米饼', '玉米薄饼'], en: ['corn tortillas'], units: { '张': 'tortilla' } },   // Tortillas, ready-to-bake or -fry, corn
  { fdc: 172746, zh: ['苏打饼干', '饼干', '咸饼干', '梳打饼'], en: ['saltines', 'crackers', 'soda crackers'] },   // Crackers, saltines (includes oyster, soda, soup)
  { fdc: 171646, zh: ['格兰诺拉', '燕麦脆'], en: ['granola'] },   // Cereals ready-to-eat, granola, homemade
  // ---------- 豆类 ----------
  { fdc: 173727, zh: ['红豆', '赤小豆', '赤豆'], en: ['adzuki beans', 'red beans', 'azuki beans'] },   // Beans, adzuki, mature seeds, raw
  { fdc: 173729, zh: ['红豆沙', '豆沙', '豆沙馅', '蜜红豆'], en: ['red bean paste', 'sweet red bean paste'], note: 'approximation: 红豆沙 (sweet red bean paste) uses canned sweetened adzuki beans' },   // Beans, adzuki, mature seeds, canned, sweetened
  { fdc: 174256, zh: ['绿豆'], en: ['mung beans'] },   // Mung beans, mature seeds, raw
  { fdc: 173734, zh: ['黑豆', '黑豆子'], en: ['black beans'] },   // Beans, black, mature seeds, raw
  { fdc: 175193, zh: ['芸豆', '红腰豆', '腰豆'], en: ['kidney beans', 'red kidney beans'] },   // Beans, kidney, all types, mature seeds, raw
  { fdc: 174285, zh: ['红腰豆罐头'], en: ['canned kidney beans'] },   // Beans, kidney, red, mature seeds, canned, drained solids
  { fdc: 175188, zh: ['黑豆罐头'], en: ['canned black beans'] },   // Beans, black turtle, mature seeds, canned
  { fdc: 173756, zh: ['鹰嘴豆'], en: ['chickpeas', 'garbanzo beans'] },   // Chickpeas (garbanzo beans, bengal gram), mature seeds, raw
  { fdc: 173801, zh: ['鹰嘴豆罐头'], en: ['canned chickpeas'] },   // Chickpeas (garbanzo beans, bengal gram), mature seeds, canned, drained, rinsed in tap water
  { fdc: 172420, zh: ['小扁豆', '兵豆', '红扁豆'], en: ['lentils'] },   // Lentils, raw
  { fdc: 175199, zh: ['斑豆', '花豆'], en: ['pinto beans'] },   // Beans, pinto, mature seeds, raw (Includes foods for USDA's Food Distribution Program)
  { fdc: 173745, zh: ['白芸豆', '白豆'], en: ['navy beans', 'white beans'] },   // Beans, navy, mature seeds, raw
  { fdc: 174289, zh: ['鹰嘴豆泥'], en: ['hummus'] },   // Hummus, commercial
  { fdc: 172430, zh: ['花生', '花生米', '生花生', '花生仁'], en: ['peanuts', 'peanut'] },   // Peanuts, all types, raw
  { fdc: 174262, zh: ['熟花生', '烤花生', '炒花生'], en: ['roasted peanuts'] },   // Peanuts, all types, dry-roasted, with salt
  // ---------- 坚果种子 ----------
  { fdc: 170187, zh: ['核桃', '核桃仁', '胡桃'], en: ['walnuts', 'walnut'] },   // Nuts, walnuts, english
  { fdc: 170567, zh: ['杏仁', '扁桃仁', '巴旦木', '杏仁片'], en: ['almonds', 'almond', 'sliced almonds'] },   // Nuts, almonds
  { fdc: 170162, zh: ['腰果'], en: ['cashews', 'cashew nuts'] },   // Nuts, cashew nuts, raw
  { fdc: 170184, zh: ['开心果'], en: ['pistachios'] },   // Nuts, pistachio nuts, raw
  { fdc: 170591, zh: ['松子', '松仁'], en: ['pine nuts'] },   // Nuts, pine nuts, dried
  { fdc: 170164, zh: ['栗子', '板栗', '栗子仁'], en: ['chestnuts', 'chestnut'] },   // Nuts, chestnuts, chinese, raw
  { fdc: 170573, zh: ['熟栗子', '糖炒栗子', '板栗仁'], en: ['roasted chestnuts'] },   // Nuts, chestnuts, chinese, roasted
  { fdc: 170581, zh: ['榛子', '榛子仁'], en: ['hazelnuts'] },   // Nuts, hazelnuts or filberts
  { fdc: 170178, zh: ['夏威夷果', '澳洲坚果'], en: ['macadamia nuts', 'macadamias'] },   // Nuts, macadamia nuts, raw
  { fdc: 170182, zh: ['碧根果', '山核桃'], en: ['pecans'] },   // Nuts, pecans
  { fdc: 168586, zh: ['椰丝', '椰蓉'], en: ['shredded coconut', 'desiccated coconut'] },   // Nuts, coconut meat, dried (desiccated), sweetened, shredded
  { fdc: 170150, zh: ['芝麻', '白芝麻', '黑芝麻', '熟芝麻'], en: ['sesame seeds', 'sesame'] },   // Seeds, sesame seeds, whole, dried
  { fdc: 170562, zh: ['葵花籽', '瓜子', '瓜子仁', '葵花子'], en: ['sunflower seeds'] },   // Seeds, sunflower seed kernels, dried
  { fdc: 170556, zh: ['南瓜子', '南瓜籽'], en: ['pumpkin seeds', 'pepitas'] },   // Seeds, pumpkin and squash seed kernels, dried
  { fdc: 170554, zh: ['奇亚籽'], en: ['chia seeds', 'chia'] },   // Seeds, chia seeds, dried
  { fdc: 169414, zh: ['亚麻籽'], en: ['flaxseed', 'flax seeds'] },   // Seeds, flaxseed
  { fdc: 174266, zh: ['花生酱'], en: ['peanut butter'] },   // Peanut butter, smooth style, with salt (Includes foods for USDA's Food Distribution Program)
  { fdc: 170191, zh: ['芝麻酱', '麻酱'], en: ['sesame paste', 'chinese sesame paste'] },   // Seeds, sesame butter, paste
  { fdc: 170189, zh: ['中东芝麻酱'], en: ['tahini'] },   // Seeds, sesame butter, tahini, from roasted and toasted kernels (most common type)
  { fdc: 168588, zh: ['杏仁酱'], en: ['almond butter'] },   // Nuts, almond butter, plain, without salt added
  // ---------- 油 ----------
  { fdc: 171411, zh: ['植物油', '食用油', '油', '色拉油', '沙拉油', '大豆油', '调和油', '炒菜油'], en: ['vegetable oil', 'oil', 'cooking oil', 'soybean oil'] },   // Oil, soybean, salad or cooking
  { fdc: 172336, zh: ['菜籽油', '菜油', '芥花油', '辣椒油', '红油'], en: ['canola oil', 'chili oil', 'rapeseed oil'], note: 'approximation: 辣椒油 / 红油 (chili oil) use canola oil (chili oil is almost all oil)' },   // Oil, canola
  { fdc: 171410, zh: ['花生油'], en: ['peanut oil'] },   // Oil, peanut, salad or cooking
  { fdc: 171413, zh: ['橄榄油', '初榨橄榄油', '特级初榨橄榄油'], en: ['olive oil', 'extra virgin olive oil', 'evoo'] },   // Oil, olive, salad or cooking
  { fdc: 171016, zh: ['香油', '芝麻油', '麻油', '小磨香油'], en: ['sesame oil', 'toasted sesame oil'] },   // Oil, sesame, salad or cooking
  { fdc: 171029, zh: ['玉米油'], en: ['corn oil'] },   // Oil, corn, industrial and retail, all purpose salad or cooking
  { fdc: 171025, zh: ['葵花籽油', '葵花油'], en: ['sunflower oil'] },   // Oil, sunflower, linoleic, (approx. 65%)
  { fdc: 171412, zh: ['椰子油', '椰油'], en: ['coconut oil'] },   // Oil, coconut
  { fdc: 173573, zh: ['牛油果油', '酪梨油'], en: ['avocado oil'] },   // Oil, avocado
  { fdc: 171400, zh: ['牛油', '牛脂'], en: ['beef tallow', 'tallow'] },   // Fat, beef tallow
  { fdc: 171011, zh: ['起酥油', '白油'], en: ['shortening'] },   // Shortening, household, soybean (partially hydrogenated)-cottonseed (partially hydrogenated)
  { fdc: 172346, zh: ['人造黄油', '植物黄油', '玛琪琳'], en: ['margarine'], units: { '条': 'stick' } },   // Margarine, regular, 80% fat, composite, stick, with salt
  { fdc: 167702, zh: ['亚麻籽油'], en: ['flaxseed oil'] },   // Oil, flaxseed, cold pressed
  // ---------- 调味 ----------
  { fdc: 174277, zh: ['生抽', '酱油', '鲜酱油', '味极鲜', '头抽', '淡口酱油', '豉油'], en: ['soy sauce', 'light soy sauce', 'shoyu'] },   // Soy sauce made from soy and wheat (shoyu)
  { fdc: 174278, zh: ['老抽', '浓口酱油', '草菇老抽'], en: ['dark soy sauce', 'tamari'], note: 'approximation: 老抽 (dark soy sauce) uses tamari (darker, thicker soy sauce; dark soy has a bit more sugar)' },   // Soy sauce made from soy (tamari)
  { fdc: 172474, zh: ['低盐酱油', '薄盐酱油', '减盐酱油'], en: ['low sodium soy sauce', 'reduced sodium soy sauce'] },   // Soy sauce, reduced sodium, made from hydrolyzed vegetable protein
  { fdc: 174529, zh: ['蚝油', '耗油'], en: ['oyster sauce'] },   // Sauce, oyster, ready-to-serve
  { fdc: 172886, zh: ['海鲜酱', '甜面酱', '柱侯酱'], en: ['hoisin sauce', 'hoisin', 'sweet bean sauce'], note: 'approximation: 甜面酱 / 柱侯酱 use hoisin sauce' },   // Sauce, hoisin, ready-to-serve
  { fdc: 174531, zh: ['鱼露'], en: ['fish sauce'] },   // Sauce, fish, ready-to-serve
  { fdc: 171167, zh: ['照烧酱', '日式照烧汁'], en: ['teriyaki sauce'] },   // Sauce, teriyaki, ready-to-serve
  { fdc: 174523, zh: ['烧烤酱', '烤肉酱', '叉烧酱'], en: ['bbq sauce', 'barbecue sauce', 'char siu sauce'], note: 'approximation: 叉烧酱 (char siu sauce) uses barbecue sauce' },   // Sauce, barbecue
  { fdc: 171186, zh: ['是拉差', '辣椒酱', '蒜蓉辣酱', '剁椒'], en: ['sriracha', 'hot sauce', 'chili sauce', 'chili garlic sauce'], note: 'approximation: 辣椒酱 / 剁椒 (Chinese chili sauces) use sriracha' },   // Sauce, hot chile, sriracha
  { fdc: 172879, zh: ['梅子酱', '甜辣酱', '泰式甜辣酱'], en: ['plum sauce', 'sweet chili sauce', 'thai sweet chili sauce'], note: 'approximation: 甜辣酱 (Thai sweet chili sauce, mostly sugar) uses plum sauce' },   // Sauce, plum, ready-to-serve
  { fdc: 174527, zh: ['辣椒仔', '塔巴斯科'], en: ['tabasco', 'louisiana hot sauce'] },   // Sauce, ready-to-serve, pepper or hot
  { fdc: 168556, zh: ['番茄酱', '茄汁'], en: ['ketchup', 'catsup'] },   // Catsup
  { fdc: 171009, zh: ['蛋黄酱', '美乃滋', '沙拉酱'], en: ['mayonnaise', 'mayo'] },   // Salad dressing, mayonnaise, regular
  { fdc: 171402, zh: ['千岛酱'], en: ['thousand island', 'thousand island dressing'] },   // Salad dressing, thousand island, commercial, regular
  { fdc: 172234, zh: ['黄芥末', '芥末酱', '芥末', '美式芥末'], en: ['mustard', 'yellow mustard', 'dijon mustard'] },   // Mustard, prepared, yellow
  { fdc: 172237, zh: ['白醋', '醋', '米醋', '糯米醋'], en: ['vinegar', 'white vinegar', 'rice vinegar'], note: 'approximation: 米醋 (rice vinegar) uses distilled vinegar' },   // Vinegar, distilled
  { fdc: 172241, zh: ['香醋', '陈醋', '黑醋', '镇江香醋', '山西老陈醋', '意大利黑醋', '老陈醋'], en: ['balsamic vinegar', 'black vinegar', 'chinkiang vinegar'], note: 'approximation: 香醋 / 陈醋 (Chinese black vinegars) use balsamic vinegar' },   // Vinegar, balsamic
  { fdc: 173469, zh: ['苹果醋'], en: ['apple cider vinegar', 'cider vinegar'] },   // Vinegar, cider
  { fdc: 172240, zh: ['红酒醋'], en: ['red wine vinegar'] },   // Vinegar, red wine
  { fdc: 167723, zh: ['料酒', '黄酒', '绍兴酒', '花雕酒', '米酒', '清酒', '绍酒'], en: ['shaoxing wine', 'cooking wine', 'rice wine', 'sake'], note: 'approximation: 料酒 / 黄酒 / 绍兴酒 use sake (rice wine)' },   // Alcoholic beverage, rice (sake)
  { fdc: 168746, zh: ['啤酒'], en: ['beer'] },   // Alcoholic beverage, beer, regular, all
  { fdc: 173190, zh: ['红酒', '红葡萄酒', '干红'], en: ['red wine'] },   // Alcoholic beverage, wine, table, red
  { fdc: 174837, zh: ['白葡萄酒', '干白'], en: ['white wine'] },   // Alcoholic beverage, wine, table, white
  { fdc: 174815, zh: ['烈酒', '伏特加', '威士忌', '朗姆酒', '金酒'], en: ['vodka', 'whiskey', 'rum', 'liquor', 'gin'] },   // Alcoholic beverage, distilled, all (gin, rum, vodka, whiskey) 80 proof
  { fdc: 173664, zh: ['白酒', '二锅头', '高粱酒', '白干酒'], en: ['baijiu'], note: 'approximation: Chinese baijiu (42-56% alcohol) uses 100-proof (50%) distilled spirits' },   // Alcoholic beverage, distilled, all (gin, rum, vodka, whiskey) 100 proof
  { fdc: 169655, zh: ['白糖', '糖', '白砂糖', '砂糖', '细砂糖', '冰糖', '绵白糖', '幼砂糖'], en: ['sugar', 'white sugar', 'granulated sugar', 'rock sugar'] },   // Sugars, granulated
  { fdc: 168833, zh: ['红糖', '黑糖', '黄糖', '赤砂糖', '片糖'], en: ['brown sugar'] },   // Sugars, brown
  { fdc: 169656, zh: ['糖粉'], en: ['powdered sugar', 'icing sugar', 'confectioners sugar'] },   // Sugars, powdered
  { fdc: 169640, zh: ['蜂蜜', '蜜糖'], en: ['honey'] },   // Honey
  { fdc: 169661, zh: ['枫糖浆', '枫糖'], en: ['maple syrup'] },   // Syrups, maple
  { fdc: 169660, zh: ['麦芽糖', '麦芽糖浆', '饴糖'], en: ['maltose', 'malt syrup'] },   // Syrups, malt
  { fdc: 168837, zh: ['玉米糖浆'], en: ['corn syrup', 'light corn syrup'] },   // Syrups, corn, light
  { fdc: 169641, zh: ['果酱', '草莓酱', '蓝莓酱'], en: ['jam', 'jelly', 'preserves'] },   // Jams and preserves
  { fdc: 173468, zh: ['盐', '食盐', '精盐', '海盐', '细盐', '味精'], en: ['salt', 'sea salt', 'kosher salt', 'table salt', 'msg'], note: 'approximation: 味精 (MSG) has no meaningful calories, so it is estimated like salt' },   // Salt, table
  { fdc: 171562, zh: ['鸡精', '鸡粉', '浓汤宝', '高汤块', '鸡汤块'], en: ['bouillon', 'chicken bouillon', 'bouillon cube', 'chicken powder'] },   // Soup, chicken broth or bouillon, dry
  { fdc: 172884, zh: ['鸡汤', '高汤', '鸡高汤', '清汤'], en: ['chicken stock', 'chicken broth', 'stock', 'broth'] },   // Soup, stock, chicken, home-prepared
  { fdc: 172883, zh: ['牛肉汤', '牛骨汤', '牛高汤'], en: ['beef stock', 'beef broth'] },   // Soup, stock, beef, home-prepared
  { fdc: 172885, zh: ['鱼汤', '鱼高汤'], en: ['fish stock'] },   // Soup, stock, fish, home-prepared
  { fdc: 170931, zh: ['胡椒粉', '黑胡椒', '黑胡椒粉', '胡椒', '黑胡椒碎'], en: ['black pepper', 'pepper', 'ground black pepper'] },   // Spices, pepper, black
  { fdc: 170933, zh: ['白胡椒', '白胡椒粉'], en: ['white pepper'] },   // Spices, pepper, white
  { fdc: 170932, zh: ['辣椒面', '辣椒粉', '干辣椒', '干辣椒段', '辣椒碎', '卡宴辣椒', '干辣椒面'], en: ['cayenne', 'red pepper flakes', 'chili flakes', 'crushed red pepper', 'dried chilies'] },   // Spices, pepper, red or cayenne
  { fdc: 171319, zh: ['墨西哥辣椒粉'], en: ['chili powder'] },   // Spices, chili powder
  { fdc: 171329, zh: ['红椒粉', '甜椒粉'], en: ['paprika', 'smoked paprika'] },   // Spices, paprika
  { fdc: 171316, zh: ['八角', '大料', '八角茴香'], en: ['star anise', 'anise'], note: 'approximation: 八角 (star anise) uses anise seed' },   // Spices, anise seed
  { fdc: 171323, zh: ['小茴香', '孜然芹', '茴香籽'], en: ['fennel seed', 'fennel seeds'] },   // Spices, fennel seed
  { fdc: 171320, zh: ['桂皮', '肉桂', '肉桂粉', '桂皮粉'], en: ['cinnamon', 'cinnamon stick', 'ground cinnamon'] },   // Spices, cinnamon, ground
  { fdc: 170923, zh: ['孜然', '孜然粉'], en: ['cumin', 'cumin seeds', 'ground cumin'] },   // Spices, cumin seed
  { fdc: 170924, zh: ['咖喱粉', '咖哩粉'], en: ['curry powder'] },   // Spices, curry powder
  { fdc: 172231, zh: ['姜黄', '姜黄粉'], en: ['turmeric'] },   // Spices, turmeric, ground
  { fdc: 170926, zh: ['姜粉'], en: ['ground ginger', 'ginger powder'] },   // Spices, ginger, ground
  { fdc: 171325, zh: ['蒜粉', '大蒜粉'], en: ['garlic powder'] },   // Spices, garlic powder
  { fdc: 171327, zh: ['洋葱粉'], en: ['onion powder'] },   // Spices, onion powder
  { fdc: 170917, zh: ['香叶', '月桂叶'], en: ['bay leaf', 'bay leaves'] },   // Spices, bay leaf
  { fdc: 171321, zh: ['丁香'], en: ['cloves', 'ground cloves'] },   // Spices, cloves, ground
  { fdc: 171326, zh: ['肉豆蔻'], en: ['nutmeg'] },   // Spices, nutmeg, ground
  { fdc: 170922, zh: ['香菜籽', '芫荽籽'], en: ['coriander seed', 'ground coriander'] },   // Spices, coriander seed
  { fdc: 171328, zh: ['牛至', '奥勒冈'], en: ['oregano'] },   // Spices, oregano, dried
  { fdc: 170938, zh: ['干百里香'], en: ['dried thyme'] },   // Spices, thyme, dried
  { fdc: 173470, zh: ['百里香'], en: ['thyme', 'fresh thyme'] },   // Thyme, fresh
  { fdc: 173473, zh: ['迷迭香'], en: ['rosemary'] },   // Rosemary, fresh
  { fdc: 172232, zh: ['罗勒', '九层塔', '罗勒叶', '金不换'], en: ['basil', 'thai basil'] },   // Basil, fresh
  { fdc: 173475, zh: ['薄荷', '薄荷叶'], en: ['mint', 'mint leaves'] },   // Spearmint, fresh
  { fdc: 172233, zh: ['莳萝'], en: ['dill'] },   // Dill weed, fresh
  { fdc: 170935, zh: ['鼠尾草'], en: ['sage'] },   // Spices, sage, ground
  { fdc: 173471, zh: ['香草精', '香草精华'], en: ['vanilla extract', 'vanilla'] },   // Vanilla extract
  { fdc: 172803, zh: ['泡打粉', '发粉'], en: ['baking powder'] },   // Leavening agents, baking powder, double-acting, sodium aluminum sulfate
  { fdc: 175040, zh: ['小苏打', '苏打粉', '食用碱'], en: ['baking soda'] },   // Leavening agents, baking soda
  { fdc: 175043, zh: ['酵母', '干酵母', '酵母粉', '安琪酵母'], en: ['yeast', 'active dry yeast', 'instant yeast'] },   // Leavening agents, yeast, baker's, active dry
  { fdc: 169593, zh: ['可可粉'], en: ['cocoa powder', 'cocoa'] },   // Cocoa, dry powder, unsweetened
  { fdc: 170273, zh: ['黑巧克力', '巧克力'], en: ['dark chocolate', 'chocolate'] },   // Chocolate, dark, 70-85% cacao solids
  { fdc: 167568, zh: ['无糖巧克力'], en: ['unsweetened chocolate', 'baking chocolate'] },   // Baking chocolate, unsweetened, squares
  { fdc: 167976, zh: ['巧克力豆', '半甜巧克力'], en: ['chocolate chips', 'semisweet chocolate'] },   // Candies, semisweet chocolate
  { fdc: 168775, zh: ['果冻粉'], en: ['jello', 'gelatin dessert mix'] },   // Gelatin desserts, dry mix
  { fdc: 169599, zh: ['吉利丁', '吉利丁片', '鱼胶粉', '明胶'], en: ['gelatin', 'gelatine'] },   // Gelatins, dry powder, unsweetened
  { fdc: 170173, zh: ['椰浆', '椰奶', '椰乳'], en: ['coconut milk', 'coconut cream'] },   // Nuts, coconut milk, canned (liquid expressed from grated meat and water)
  { fdc: 170090, zh: ['琼脂', '寒天', '洋菜'], en: ['agar', 'agar agar'] },   // Seaweed, agar, dried
  // ---------- 饮料、零食（做菜也会用到的） ----------
  { fdc: 169098, zh: ['橙汁', '鲜橙汁'], en: ['orange juice'] },   // Orange juice, raw (Includes foods for USDA's Food Distribution Program)
  { fdc: 173933, zh: ['苹果汁'], en: ['apple juice'] },   // Apple juice, canned or bottled, unsweetened, without added ascorbic acid
  { fdc: 174832, zh: ['杏仁奶'], en: ['almond milk'] },   // Beverages, almond milk, unsweetened, shelf stable
  { fdc: 174852, zh: ['可乐'], en: ['cola', 'coke'] },   // Beverages, carbonated, cola, regular
  { fdc: 171890, zh: ['咖啡', '黑咖啡', '美式咖啡'], en: ['coffee', 'black coffee'] },   // Beverages, coffee, brewed, prepared with tap water
  { fdc: 173227, zh: ['红茶', '茶', '绿茶', '乌龙茶'], en: ['tea', 'black tea', 'green tea'] },   // Beverages, tea, black, brewed, prepared with tap water
  { fdc: 173647, zh: ['水', '清水', '开水', '温水', '凉水', '冷水', '热水', '凉白开', '饮用水', '纯净水', '矿泉水', '冰水', '冰块'], en: ['water', 'hot water', 'boiling water', 'ice water', 'tap water', 'ice', 'ice cubes'] },   // Beverages, water, tap, drinking（第 15 步：汤、面团里的水不算「没算进去」）
  { fdc: 169677, zh: ['薯片', '洋芋片'], en: ['potato chips', 'chips'] },   // Snacks, potato chips, plain, salted
  { fdc: 167959, zh: ['爆米花'], en: ['popcorn'] },   // Snacks, popcorn, air-popped
  { fdc: 167558, zh: ['玉米片', '玉米脆片'], en: ['tortilla chips'] },   // Snacks, tortilla chips, plain, white corn, salted
  { fdc: 170523, zh: ['薯条', '冷冻薯条'], en: ['french fries', 'fries'] },   // Potatoes, french fried, all types, salt not added in processing, frozen, as purchased
];
