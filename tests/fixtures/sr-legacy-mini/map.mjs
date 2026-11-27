// 编出来的小对照表和同一个目录里的几个 CSV（格式照 USDA SR Legacy：列名、双引号、measure_unit_id 9999），给 tests/nutritionBuild.test.mjs 测生成脚本。不是真的数据
export const MAP = [
  { fdc: 900003, zh: ['测试油', '测试油'], en: ['test oil'] },
  { fdc: 900001, zh: ['测试果'], en: ['testfruit'], note: 'approximation: invented', units: { '个': 'large' } },
  { fdc: 900002, zh: ['测试豆沙'], en: ['test bean paste'], units: { '包': 'package' } },
];
