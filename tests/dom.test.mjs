// ui/dom.js 的确认框和提示条（读屏、键盘）：假 DOM（tests/helpers/dom.mjs），<dialog> 的 showModal / close 在这里补上。全是编的文字
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirmDialog, toast } from '../src/ui/dom.js';
import { setLang } from '../src/i18n.js';
import { Element, find, installDom } from './helpers/dom.mjs';

const wait = (ms) => new Promise(r => setTimeout(r, ms));
function setup() {
  const dom = installDom({ getComputedStyle: () => ({ bottom: '24px' }), requestAnimationFrame: () => 0, MutationObserver: class { observe() {} disconnect() {} } });
  setLang('zh-Hans');
  const make = dom.doc.createElement;
  dom.doc.createElement = (tag) => {
    const el = make(tag);
    if (tag === 'dialog') {
      el.showModal = () => { el.open = true; };
      el.close = () => { el.open = false; el.fire('close'); };
    }
    return el;
  };
  window.innerHeight = 800; window.innerWidth = 400;
  const main = new Element('main'); main.id = 'main';
  dom.doc.body.append(main);
  return { ...dom, main };
}
const dialog = (doc) => find(doc.body, el => el.tag === 'dialog');
const button = (root, text) => find(root, el => el.tag === 'button' && el.textContent === text);

test('确认框：只有一句话时那句话就是它的名字（读屏打开就念问题）；有标题时标题是名字、那句话是说明；会删东西的焦点先给「取消」', async () => {
  const env = setup();
  try {
    let p = confirmDialog({ message: '放弃这次的修改？', confirmLabel: '放弃', danger: true });
    let d = dialog(env.doc);
    const msg = find(d, el => el.tag === 'p');
    assert.equal(d.getAttribute('aria-label'), null);
    assert.equal(d.getAttribute('aria-labelledby'), msg.id);
    assert.equal(env.doc.activeElement, button(d, '取消'), 'danger：连按两下回车不会直接放弃');
    await button(d, '放弃').fire('click');
    assert.equal(await p, true);
    p = confirmDialog({ title: '删除「木工」？', message: '里面的 3 样东西会跟着隐藏。', confirmLabel: '删除', danger: true });
    d = dialog(env.doc);
    assert.equal(d.getAttribute('aria-label'), '删除「木工」？');
    assert.equal(d.getAttribute('aria-describedby'), find(d, el => el.tag === 'p').id);
    await button(d, '取消').fire('click');
    assert.equal(await p, false);
    p = confirmDialog({ message: '「食材」上已经有「电池」了，合并成一条？', confirmLabel: '合并' });
    d = dialog(env.doc);
    assert.equal(env.doc.activeElement, button(d, '合并'), '不会删东西的：焦点给确定');
    await button(d, '合并').fire('click');
    assert.equal(await p, true);
  } finally { env.restore(); }
});

test('提示条：读屏念一直在页面里的 #toast-live；焦点在「撤销」上时不倒计时；按了「撤销」焦点回到原来的地方，不掉回 <body>', async () => {
  const env = setup();
  try {
    const before = new Element('button'); before.dataset.fid = 'lp-clear';
    env.main.append(before);
    before.focus();
    let undone = 0;
    toast('已清除 2 样', { ms: 40, action: { label: '撤销', run: () => { undone++; } } });
    const el = env.doc.querySelector('#toast');
    const live = env.doc.querySelector('#toast-live');
    assert.equal(el.getAttribute('role'), null, '提示条本身不是 live region（空着时不在读屏的树里）');
    assert.equal(live.getAttribute('role'), 'status');
    // 键盘一路 Tab 到「撤销」：焦点在上面就不关
    const undo = button(el, '撤销');
    for (const fn of el.events.focusin) fn({ target: undo, relatedTarget: before });
    undo.focus();
    await wait(150);
    assert.ok(el.classList.contains('on'), '焦点在上面：不倒计时');
    assert.equal(live.textContent, '已清除 2 样');
    await undo.fire('click');
    await wait(0);
    assert.equal(undone, 1);
    assert.equal(env.doc.activeElement, before, '焦点回到按「撤销」之前的地方');
    assert.ok(!el.classList.contains('on'));
    // 没碰它：照常到时间就关
    toast('已删除「台灯」', { ms: 20 });
    await wait(60);
    assert.ok(!el.classList.contains('on'));
  } finally { env.restore(); }
});
