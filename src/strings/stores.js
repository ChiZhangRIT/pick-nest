// 商店：「商店」页、一家店的页面、设置 → 商店。商店名是专有名词（用户写的、预置的都一样），不在这里。
// 繁體（台灣）用台灣用語（封存、新增、選項……）；动态字段 {x} 三种语言一致（测试会查）。英文单复数：en(一个, 多个)
const en = (one, many) => (v) => (Number(v.n) === 1 ? one : many).replace('{n}', v.n);

export const STRINGS = {
  'zh-Hans': {
    // 「商店」页
    'store.manage': '管理商店', 'store.none': '未指定', 'store.archivedTag': '已归档', 'store.empty': '没有要显示的商店。',
    // 一家店的页面
    'store.gone': '这家店不在了',
    'store.nothing': '在这家没有要买的东西', 'store.nothingHint': '哪张清单上的东西指定了这家店，都会出现在这里。',
    'store.noneHint': '这里是没指定商店的东西（还有指定的商店删掉了的）；点 › 可以选一家。',
    'store.allDone': '在这家要买的都买齐了', 'store.archivedBanner': '这家店已归档，不出现在商店的选择里。',
    // 设置 → 商店
    'store.add': '新增商店', 'store.editTitle': '编辑商店', 'store.name': '名字', 'store.namePh': '比如：农贸市场', 'store.create': '添加',
    'store.err.name': '请写个名字', 'store.err.taken': '已经有同名的商店了',
    'store.archive': '归档', 'store.unarchive': '取消归档', 'store.archiveHelp': '归档的商店不出现在选择里；已经指定给它的东西照常显示。',
    'store.delete': '删除商店', 'store.deleteQ': '删除「{name}」？',
    'store.deleteMsg': v => (Number(v.n) ? `指定给它的 ${v.n} 样东西会显示成「未指定」。` : '') + '删除后 10 秒内可以撤销。',
    'store.archived': '已归档「{name}」', 'store.unarchived': '已取消归档「{name}」', 'store.deleted': '已删除「{name}」',
    'store.manageHelp': '点名字可以改名、归档或删除。这里的顺序就是「商店」页和选择列表里的顺序。',
    'store.noActive': '没有在用的商店。', 'store.archivedN': '已归档（{n}）',
    // 宽屏双栏：右栏还没选商店时
    'store.pick': '选一家店，在那儿要买的东西显示在这里',
    // 只看一张清单（「商店」页、一家店上面的按钮和面板）
    'store.filterAll': '所有清单', 'store.filterTitle': '看哪张清单', 'store.filterAria': '看哪张清单：{name}',
    'store.filterHelp': '选一张清单，「商店」页的数和每家店里的东西就只算这张。这台设备会记住。',
    'store.filterHelpHere': '数字是在这家店还要买几样。选了的清单换一家店也照样用，这台设备会记住。',
    'store.nothingIn': '这家店在「{name}」里没有要买的东西', 'store.allDoneIn': '「{name}」里在这家要买的都买齐了',
    'store.filterHint': '现在只看「{name}」，可以在上面换成「所有清单」。',
    // 只看一张清单时「商店」页不列 0 样的店：下面说一句还有几家没列；一家都没有时说这张清单没有要买的
    'store.hiddenN': '另外 {n} 家店在「{name}」里没有要买的。', 'store.emptyIn': '「{name}」里没有要买的东西。',
  },
  'zh-Hant-TW': {
    'store.manage': '管理商店', 'store.none': '未指定', 'store.archivedTag': '已封存', 'store.empty': '沒有要顯示的商店。',
    'store.gone': '這家店已經不在了',
    'store.nothing': '在這家沒有要買的東西', 'store.nothingHint': '任何清單上的東西指定了這家店，都會出現在這裡。',
    'store.noneHint': '這裡是沒指定商店的東西（還有指定的商店已刪除的）；點 › 可以選一家。',
    'store.allDone': '在這家要買的都買齊了', 'store.archivedBanner': '這家店已封存，不會出現在商店的選項裡。',
    'store.add': '新增商店', 'store.editTitle': '編輯商店', 'store.name': '名稱', 'store.namePh': '例如：傳統市場', 'store.create': '新增',
    'store.err.name': '請輸入名稱', 'store.err.taken': '已經有同名的商店了',
    'store.archive': '封存', 'store.unarchive': '取消封存', 'store.archiveHelp': '封存的商店不會出現在選項裡；已經指定給它的東西照常顯示。',
    'store.delete': '刪除商店', 'store.deleteQ': '刪除「{name}」？',
    'store.deleteMsg': v => (Number(v.n) ? `指定給它的 ${v.n} 樣東西會顯示成「未指定」。` : '') + '刪除後 10 秒內可以復原。',
    'store.archived': '已封存「{name}」', 'store.unarchived': '已取消封存「{name}」', 'store.deleted': '已刪除「{name}」',
    'store.manageHelp': '點名稱可以改名、封存或刪除。這裡的順序就是「商店」頁和選項裡的順序。',
    'store.noActive': '沒有使用中的商店。', 'store.archivedN': '已封存（{n}）',
    'store.pick': '選一家店，在那裡要買的東西會顯示在這裡',
    'store.filterAll': '所有清單', 'store.filterTitle': '顯示哪張清單', 'store.filterAria': '顯示哪張清單：{name}',
    'store.filterHelp': '選一張清單，「商店」頁的數字和每家店裡的東西就只算這張。這台裝置會記住。',
    'store.filterHelpHere': '數字是在這家店還要買幾樣。選好的清單換一家店也照樣適用，這台裝置會記住。',
    'store.nothingIn': '這家店在「{name}」裡沒有要買的東西', 'store.allDoneIn': '「{name}」裡在這家要買的都買齊了',
    'store.filterHint': '目前只顯示「{name}」，可以在上方切換成「所有清單」。',
    'store.hiddenN': '另外 {n} 家店在「{name}」裡沒有要買的。', 'store.emptyIn': '「{name}」裡沒有要買的東西。',
  },
  en: {
    'store.manage': 'Manage', 'store.none': 'No Store', 'store.archivedTag': 'Archived', 'store.empty': 'No stores to show.',
    'store.gone': 'That store no longer exists',
    'store.nothing': 'Nothing to buy here', 'store.nothingHint': 'Items on any list that are set to this store show up here.',
    'store.noneHint': 'Items without a store (or whose store was deleted). Tap › to pick one.',
    'store.allDone': 'Everything here is bought', 'store.archivedBanner': 'This store is archived and won’t appear when you pick a store.',
    'store.add': 'Add Store', 'store.editTitle': 'Edit Store', 'store.name': 'Name', 'store.namePh': 'e.g. Farmers Market', 'store.create': 'Add',
    'store.err.name': 'Enter a name', 'store.err.taken': 'There’s already a store with that name',
    'store.archive': 'Archive', 'store.unarchive': 'Unarchive', 'store.archiveHelp': 'Archived stores don’t appear when you pick a store; items already set to them still show it.',
    'store.delete': 'Delete Store', 'store.deleteQ': 'Delete “{name}”?',
    'store.deleteMsg': v => (Number(v.n) ? en('{n} item set to it will show under “No Store”. ', '{n} items set to it will show under “No Store”. ')(v) : '') + 'You can undo for 10 seconds.',
    'store.archived': 'Archived “{name}”', 'store.unarchived': 'Unarchived “{name}”', 'store.deleted': 'Deleted “{name}”',
    'store.manageHelp': 'Tap a name to rename, archive or delete it. This order is used on Stores and when you pick a store.',
    'store.noActive': 'No active stores.', 'store.archivedN': 'Archived ({n})',
    'store.pick': 'Pick a store to see what to buy there',
    'store.filterAll': 'All Lists', 'store.filterTitle': 'Show Items From', 'store.filterAria': 'Show items from: {name}',
    'store.filterHelp': 'Pick a list to count and show only its items on Stores and every store page. This device remembers your choice.',
    'store.filterHelpHere': 'Numbers are what’s left to buy at this store. Your choice stays when you switch stores, and this device remembers it.',
    'store.nothingIn': 'Nothing from “{name}” to buy here', 'store.allDoneIn': 'Everything from “{name}” here is bought',
    'store.filterHint': 'Showing only “{name}”. You can switch to All Lists above.',
    'store.hiddenN': v => en('1 other store has nothing from “{name}” to buy.', '{n} other stores have nothing from “{name}” to buy.')(v).replace('{name}', v.name),
    'store.emptyIn': 'Nothing left to buy from “{name}”.',
  },
};
