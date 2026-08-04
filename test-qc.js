'use strict';
/* 剧情监察真实链路：跑 10 回合，验证 audit 中 qc 字段与监察不阻塞回合 */
const fs = require('fs');
const path = require('path');
const BASE = 'http://127.0.0.1:8787';
async function post(p, obj) {
  const res = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });
  return res.json();
}
(async () => {
  const n = await post('/api/newgame', { slot: 3, name: '监察验证' });
  if (!n.ok) { console.log('开篇失败:', JSON.stringify(n)); process.exit(1); }
  let qcStats = { pass: 0, issues: 0, none: 0 };
  for (let i = 1; i <= 10; i++) {
    const cmds = [
      '打坐修炼', '与钱掌柜攀谈，打听镇上的新鲜事', '去杂货铺看看', '沿南街走走',
      '打坐修炼', '向路人打听青云宗怎么走', '打坐修炼', '继续打坐',
      '查看四周，看看有没有异样', '收拾行装，准备明早去青云山看看',
    ];
    const p = await post('/api/play', { slot: 3, command: cmds[i - 1] });
    if (!p.ok) { console.log(`回合${i}失败:`, JSON.stringify(p.error)); process.exit(1); }
    const delay = i === 3 || i === 8 || i === 10 ? 3000 : 1500; // 等监察写完审计
    await new Promise(r => setTimeout(r, delay));
  }
  /* 读审计文件验证 qc 字段 */
  const dir = path.join(__dirname, 'saves', 'audit');
  const files = fs.readdirSync(dir).filter(f => f.startsWith('slot3-') && f.endsWith('.jsonl'));
  const lines = files.flatMap(f => fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } })).filter(Boolean);
  for (const l of lines) qcStats[l.qc || 'none'] = (qcStats[l.qc || 'none'] || 0) + 1;
  console.log('监察结果统计:', JSON.stringify(qcStats), '| 总回合:', lines.length);
  const withQC = lines.filter(l => l.qc);
  console.log('监察示例:', withQC.slice(0, 2).map(l => `#${l.turn} ${l.qc}`).join(' | '));
  await post('/api/reset', { slot: 3 });
  console.log('测试档已清理');
})().catch(e => { console.error('回归失败:', e.message); process.exit(1); });
