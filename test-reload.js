'use strict';
/* 刷新恢复回归：多回合游玩后重新加载档位，验证进度与剧情重放 */
const BASE = 'http://127.0.0.1:8787';
async function post(path, obj) {
  const res = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });
  return res.json();
}
(async () => {
  /* 造一个玩过 5 回合的档 */
  const n = await post('/api/newgame', { slot: 3, name: '刷新测试' });
  if (!n.ok) { console.log('开篇失败:', JSON.stringify(n)); process.exit(1); }
  for (let i = 1; i <= 5; i++) {
    const p = await post('/api/play', { slot: 3, command: `打坐修炼（第${i}次）` });
    if (!p.ok) { console.log(`回合${i}失败:`, JSON.stringify(p.error)); process.exit(1); }
  }
  /* 模拟刷新：重新加载（export 返回完整存档含 log） */
  const exp = await fetch(`${BASE}/api/export?slot=3`).then(r => r.json());
  console.log('模拟刷新加载 ok=', exp.ok);
  console.log('  进度: 回合数=', exp.data.turns, '| 修为=', exp.data.exp, '| 位置=', exp.data.location.name, '| 时间=', exp.data.timeH);
  console.log('  剧情记录条数(log)=', exp.data.log.length, '| 最近一条指令:', exp.data.log.slice(-1)[0].u.slice(0, 30));
  const boot = await fetch(`${BASE}/api/bootstrap`).then(r => r.json());
  const s3 = boot.slots.find(s => s.slot === 3);
  console.log('bootstrap 最近游玩时间(updated)可排序:', typeof s3.updated === 'number' && s3.updated > 0);
  await post('/api/reset', { slot: 3 });
  console.log('测试档已清理');
})().catch(e => { console.error('回归失败:', e.message); process.exit(1); });
