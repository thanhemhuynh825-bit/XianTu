'use strict';
/* 赐名回归：留空自动赐名 + 改名 API + NPC 称呼验证（快照含名） */
const BASE = 'http://127.0.0.1:8787';
async function post(path, obj) {
  const res = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });
  return res.json();
}
(async () => {
  const n = await post('/api/newgame', { slot: 3, name: '' }); // 留空 → 天命赐名
  if (!n.ok) { console.log('开篇失败:', JSON.stringify(n)); process.exit(1); }
  console.log('赐名开篇 ok= | 名字 =', n.state.name, '| givenName =', n.state.givenName);
  const p = await post('/api/play', { slot: 3, command: `和老槐客栈的钱掌柜打个招呼，听听他怎么说` });
  if (!p.ok) { console.log('回合失败:', JSON.stringify(p.error)); process.exit(1); }
  const nm = n.state.name;
  const called = p.narration.includes(nm) || p.narration.includes(nm.slice(-2)) || p.narration.includes(nm.slice(-1)); // 全名或单/双名称呼
  console.log('回合 ok | NPC 用名相称（全名或简称）:', called, '| 名字:', nm);
  if (!called) console.log('  叙事片段:', p.narration.slice(0, 120));
  const rn = await post('/api/name', { slot: 3, name: '苏长歌' });
  console.log('改名 ok=', rn.ok, '| 新名 =', rn.state.name, '| 大事件:', rn.state.chronicle.slice(-1)[0].text);
  const q = await post('/api/qa', { slot: 3, question: '我叫什么名字？钱掌柜是怎么称呼我的？' });
  console.log('QA ok=', q.ok, '|', q.answer);
  await post('/api/reset', { slot: 3 });
  console.log('测试档已清理');
})().catch(e => { console.error('回归失败:', e.message); process.exit(1); });
