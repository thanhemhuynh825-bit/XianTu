'use strict';
/* 真实 API 回归：修为封顶 / 突破门槛 / 物品图鉴 / QA */
const BASE = 'http://127.0.0.1:8787';
async function post(path, obj) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(obj),
  });
  return res.json();
}
(async () => {
  const n = await post('/api/newgame', { slot: 3, name: '门槛验证' });
  if (!n.ok) { console.log('开篇失败:', JSON.stringify(n)); process.exit(1); }
  console.log('开篇 ok=', n.ok, '| 位置:', n.state.location.name);
  let st = n.state;
  for (let i = 1; i <= 4; i++) {
    const p = await post('/api/play', { slot: 3, command: `打坐修炼（第${i}次）` });
    if (!p.ok) { console.log(`回合${i}失败:`, p.error); break; }
    const ev = p.events.map(e => e.text).join('；');
    console.log(`回合${i} ok | exp=${p.state.exp} 境界=${p.state.realm.stage}${p.state.realm.level} | ${ev}`);
    st = p.state;
  }
  /* 注入记忆/钩子/台词，验证持久与 QA 可见 */
  st.memory = [{ t: 1, text: '钱掌柜曾许诺：剿灭镇外狼群便教你丹术。' }];
  st.hooks = [{ id: 'h1', text: '深夜客栈有人敲门，说与你的身世有关', turn: 3, open: true }];
  st.quotes = [{ t: 2, text: '三十灵石，少一个子都不卖。' }];
  const imp = await post('/api/import', { slot: 3, data: st });
  console.log('注入 ok=', imp.ok);
  const p2 = await post('/api/play', { slot: 3, command: '查看四周' });
  console.log('注入后回合 ok=', p2.ok, 'hooks保留:', (p2.state.hooks || []).length, '条');
  const q = await post('/api/qa', { slot: 3, question: '钱掌柜许诺过我什么？是谁深更半夜敲过我的门？' });
  console.log('QA ok=', q.ok, '|', q.answer);
  const itemKeys = st.items ? Object.keys(st.items) : [];
  console.log('物品图鉴条数:', itemKeys.length, itemKeys.join(','));
  await post('/api/reset', { slot: 3 });
  console.log('测试档已清理');
})().catch(e => { console.error('回归失败:', e.message); process.exit(1); });
