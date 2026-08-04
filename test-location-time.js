'use strict';
/* 位置提取与时辰推断单元测试 */
const state = require('./game/state');

const cases = [
  ['你沿着山路来到了黑风谷。', ['黑风谷']],
  ['你走进客栈，向钱掌柜打听。', ['客栈']],
  ['你望向远处的黑风谷方向，心中盘算。', []],
  ['沿官道前行，两个时辰后回到了青云镇。', ['青云镇']],
  ['你离开南街，出了镇子。', []], // 无地点后缀词，应跳过
  ['他提到了百灵坊市的传闻，你没有去。', []], // 提到≠移动
  ['天黑前抵达了落霞森林的猎户小屋。', ['猎户小屋']],
];

let pass = 0;
for (const [text, expect] of cases) {
  const got = state.extractMoveLocations(text);
  const ok = JSON.stringify(got) === JSON.stringify(expect);
  if (ok) pass++;
  console.log(`${ok ? '✓' : '✗'} "${text.slice(0, 24)}" → [${got.join('、')}] 期望[${expect.join('、')}]`);
}
console.log(`位置提取 ${pass}/${cases.length}`);

const timeCases = [
  ['打坐修炼', 4], ['闭关冲击金丹', 24], ['前往百灵坊市', 16], ['炼丹', 8],
  ['睡觉过夜', 6], ['攻击妖狼', 2], ['采药', 2], ['与钱掌柜交谈', 1], ['查看背包', 1], ['帮助', 1], ['向北', 1],
];
let tpass = 0;
for (const [text, expect] of timeCases) {
  const got = state.inferTimeFx(text);
  if (got === expect) tpass++;
  console.log(`${got === expect ? '✓' : '✗'} "${text}" → ${got}小时 (期望${expect})`);
}
console.log(`时间推断 ${tpass}/${timeCases.length}`);
