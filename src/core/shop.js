// @ts-check
// 购物模式（#/l/<id>?shop=1、#/s/<id>?shop=1）：上面的进度「已买 N · 还剩 M」，都买齐了换成「都买齐了」。
// 数法和下面画出来的两块一样（页面不自己数）：清单 = 这张清单上「要买」的和「已买」的（「以后再说」不算：这次不打算买）；
// 一家店 = 商店页上的（core/stores.js 的 groupStore：所有清单里在这家买的，归档的清单不算，「以后再说」不在商店页上）。
// 「已买」包括这次之前勾掉、还没清除的（它们也在下面「已买」里）；买完「清除已买」就从头算。
import { countItems } from './items.js';
import { groupStore } from './stores.js';

/** @typedef {import('./store.js').State} State */

/**
 * @typedef {object} Progress
 * @property {number} done      已买几样
 * @property {number} left      还剩几样（要买的）
 * @property {number} total     done + left（进度条的分母）
 * @property {boolean} finished 都买齐了：没有要买的，而且这一页上买到过东西（光是空的不算「买齐了」）
 */
/**
 * @param {State} state @param {'list' | 'store'} kind @param {string | null} id  清单 id；商店 id（null = 未指定）
 * @returns {Progress}
 */
export function shopProgress(state, kind, id) {
  let done = 0, left = 0;
  if (kind === 'store') {
    const g = groupStore(state, id);
    left = g.groups.reduce((n, x) => n + x.items.length, 0);
    done = g.done.length;
  } else if (typeof id === 'string') {
    left = countItems(state, id, 'need');
    done = countItems(state, id, 'done');
  }
  return { done, left, total: done + left, finished: left === 0 && done > 0 };
}
