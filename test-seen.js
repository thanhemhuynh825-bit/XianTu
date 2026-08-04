'use strict';
/* 剧情见闻真实链路：获得物品 → 悬浮数据 itemSeen 落库 → 下次回合保留 */
const BASE = 'http://127.0.0.1:8787';
async function post(p, obj) {
  const res = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });
  return res.json();
}
(async () => {
  const n = await post('/api/newgame', { slot: 3, name: '见闻验证' });
  if (!n.ok) { console.log('开篇失败:', JSON.stringify(n)); process.exit(1); }
  /* 让 GM 给一件带描述的物品：买/讨一件东西 */
  const p = await post('/api/play', { slot: 3, command: '向钱掌柜买一壶好酒，顺带打听这酒的来历' });
  if (!p.ok) { console.log('回合失败:', JSON.stringify(p.error)); process.exit(1); }
  const added = Object.keys(p.state.inventory || {}).filter(k => !['干粮', '止血草'].includes(k));
  console.log('获得物品:', added.join('、') || '（本回合未获得新物品）');
  console.log('itemSeen 条数:', Object.keys(p.state.itemSeen || {}).length);
  for (const [k, v] of Object.entries(p.state.itemSeen || {})) {
    console.log(`  见闻[${k}]:`, v.map(x => `第${x.t}回「${x.text.slice(0, 40)}」`).join(' / '));
  }
  /* 再玩一回合确认 itemSeen 保留（不因回合推进丢失） */
  const p2 = await post('/api/play', { slot: 3, command: '打坐修炼' });
  console.log('下回合后 itemSeen 保留:', Object.keys(p2.state.itemSeen || {}).length, '条');
  await post('/api/reset', { slot: 3 });
  console.log('测试档已清理');
})().catch(e => { console.error('回归失败:', e.message); process.exit(1); });
