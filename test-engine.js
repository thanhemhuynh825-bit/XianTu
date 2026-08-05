'use strict';
/* 引擎自测 v3：用模拟 GM 输出走一遍完整流程（含大事记/规范化），不消耗 API */
const state = require('./game/state');
const gm = require('./game/gm');

let calls = 0;
require('./game/llm').chat = async () => {
  calls++;
  const scripts = [
    { json: { narration: '暮色四合。*,钱掌柜*正拨着算盘。', effects: { flags: { npc_钱掌柜: '药铺掌柜' } }, available: ['进客栈'] } },
    { json: { narration: '你盘膝而坐，吐纳周天。', effects: { exp: 15, mp: 20 } } },
    { json: { narration: '妖狼扑来，你一剑刺中要害。', effects: { hp: -8, exp: 40, spirit_stones: 8, inventory_add: { 妖狼皮: 1 } } } },
    { json: { narration: '*你突破到了炼气三层！*', effects: { realm: { stage: '炼气', level: 3 }, max_hp: 10 } } },
    { json: { narration: '二当家一刀斩落，意识坠入黑暗。', effects: { hp: -999 } } },
  ];
  return { json: scripts[calls - 1].json, raw: JSON.stringify(scripts[calls - 1].json) };
};

(async () => {
  let s = state.newState('楚玄');
  const llm = require('./game/llm');

  const j1 = (await llm.chat()).json;
  state.applyEffects(s, j1.effects);
  const j2 = (await llm.chat()).json;
  state.applyEffects(s, j2.effects);
  const j3 = (await llm.chat()).json;
  state.applyEffects(s, j3.effects);
  /* 修为硬门槛：55 < 120，突破必被拒 */
  const evReject = state.applyEffects(s, { realm: { stage: '炼气', level: 3 } });
  console.log('[硬门槛] 修为不足被拒:', evReject.some(e => e.t === 'system' && /修为不足/.test(e.text)), '境界未变:', gm.stageLabel(s.realm) === '炼气一层');
  /* 修为封顶：120 封顶不累积 */
  const evCap = state.applyEffects(s, { exp: 999 });
  console.log('[封顶] 修为=', s.exp, '(应为120) 提示封顶:', evCap.some(e => e.t === 'system' && /圆满/.test(e.text)));
  /* 修为圆满 + GM 同回合修炼连写 → 突破成功 */
  const evOk = state.applyEffects(s, { exp: 200, realm: { stage: '炼气', level: 3 } });
  console.log('[突破] 成功后境界=', gm.stageLabel(s.realm), 'exp清零=', s.exp === 0, '事件含realm:', evOk.some(e => e.t === 'realm'));
  console.log('[大事记] ', s.chronicle.map(c => `#${c.t} ${c.text}`).join(' | '));

  await llm.chat(); // 跳过 mock 序列中的突破脚本（硬门槛测试已消耗对应场景）
  const j5 = (await llm.chat()).json;
  const ev = state.applyEffects(s, j5.effects);
  console.log('[死亡] dead=', s.dead, '大事记尾条:', s.chronicle.slice(-1)[0].text);
  console.log('[死亡事件]', ev.map(e => e.t + ':' + e.text).join(' | '));

  /* 规范化：模拟旧版/残缺存档 */
  const old = { name: '老档', realm: { stage: '炼气', level: 1 }, attrs: { hp: 50 }, inventory: {} };
  const norm = state.normalizeState(old);
  console.log('[规范化] 补齐字段:', !!norm.log, !!norm.chronicle, norm.attrs.lifespan, norm.explored.join(','), norm.quests.length);

  /* 回档模拟：快照副本独立，互不污染 */
  const snap = JSON.parse(JSON.stringify(s));
  s.attrs.hp = 999;
  s.inventory['作弊物'] = 1;
  const loaded = state.normalizeState(snap);
  console.log('[回档] 快照hp=', loaded.attrs.hp, '当前hp=', s.attrs.hp, '快照无作弊物:', !loaded.inventory['作弊物']);

  /* 天命骰确定性：同种子同回合 → 同结果；不同回合 → 不同结果 */
  const sA = state.newState('甲');
  sA.rngSeed = 12345;
  sA.turns = 3;
  const r1 = state.fateRolls(sA);
  const r2 = state.fateRolls(sA);
  console.log('[骰子] r1=', JSON.stringify(r1), '确定性:', JSON.stringify(r1) === JSON.stringify(r2));
  sA.turns = 4;
  const r3 = state.fateRolls(sA);
  console.log('[骰子] 回合变化则结果变化:', JSON.stringify(r1) !== JSON.stringify(r3));
  const sB = state.newState('乙');
  sB.rngSeed = 12345;
  sB.turns = 3;
  sB.attrs.luck = sA.attrs.luck; // 福缘为每档随机修正，对齐后同种子必须完全复现
  const rB = state.fateRolls(sB);
  console.log('[骰子] 同种子跨档可复现(福缘对齐):', JSON.stringify(r1) === JSON.stringify(rB));

  /* 防御性 effects + 保险丝 */
  state.applyEffects(s, { hp: -999, inventory_add: '单件字符串', inventory_remove: ['不存在'], equip: { weapon: '没有的剑' }, map_add: '孤岛' });
  console.log('[防呆] hp=', s.attrs.hp, '物品数=', Object.keys(s.inventory).length, '探索=', s.explored.join(','));
  const warn = [];
  const fused = state.applyFuses(s, { exp: 99999, spirit_stones: 99999, gold: 99999, inventory_add: { '神级法宝': 999 }, techniques_add: [{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }] }, warn);
  console.log('[保险丝] 经验=', fused.exp, '灵石=', fused.spirit_stones, '银两=', fused.gold, '法宝数量=', fused.inventory_add['神级法宝'], '功法数=', fused.techniques_add.length);
  console.log('[保险丝警告] ', warn.join(' | '));
  /* 游戏内时间：effects.time 解析 + 寿元联动 */
  const t1 = state.newState('时');
  state.applyEffects(t1, { time: '3日' });
  console.log('[时间] 3日→', t1.timeH, '小时 | 日历=', state.formatDate(t1), '| 寿元=', Math.round(t1.attrs.lifespan * 1000) / 1000);
  state.applyEffects(t1, { time: '半月' });
  console.log('[时间] 半月→', t1.timeH, '小时 | 日历=', state.formatDate(t1));
  const t2 = state.newState('老');
  t2.attrs.lifespan = 0.4; // 只剩半年寿元
  const ev2 = state.applyEffects(t2, { time: '1年' });
  console.log('[时间] 寿元耗尽坐化:', t2.dead, '|', t2.deathReason.slice(0, 20), '| 事件含death:', ev2.some(e => e.t === 'death'));
  console.log('[时间] 超限截断:', (() => { const s = state.newState('x'); const e = state.applyEffects(s, { time: '200年' }); return s.timeH === 10 + 365 * 24 && e.some(x => x.t === 'system'); })());

  /* 放置闭关：结算数学 */
  const idle1 = state.newState('挂');
  idle1.idle = { startAt: Date.now() - 30 * 60000, durationMin: 30 };
  const ir1 = state.settleIdle(idle1, Date.now());
  console.log('[挂机] 30分钟炼气: 修为+', ir1.exp, '| 流逝', state.fmtHours(ir1.hours), '| idle清空:', idle1.idle === null);
  const idle2 = state.newState('挂');
  idle2.idle = { startAt: Date.now() - 7 * 24 * 60 * 60000, durationMin: 7 * 24 * 60 };
  const ir2 = state.settleIdle(idle2, Date.now());
  console.log('[挂机] 7天炼气(有上限): 修为+', ir2.exp, '(应为144) | 流逝', state.fmtHours(ir2.hours));

  /* 未了之事与长期记忆 */
  const sH = state.newState('记');
  sH.turns = 5;
  let evH = state.applyEffects(sH, { hooks: [{ text: '黑衣人约你三日后在断魂崖相见' }, { text: '钱掌柜欠你一个人情' }] });
  console.log('[未了之事] 登记数=', sH.hooks.length, '事件提示:', evH.some(e => /未了之事/.test(e.text)));
  evH = state.applyEffects(sH, { hooks: [{ text: '黑衣人约你三日后在断魂崖相见', action: 'close' }] });
  console.log('[未了之事] 关闭后剩=', sH.hooks.length, '（应1）了结事件:', evH.some(e => /了结/.test(e.text)));
  evH = state.applyEffects(sH, { memory: '钱掌柜曾许诺：若你剿灭镇外狼群，便教你一手粗浅丹术。' });
  console.log('[记忆] 归档条数=', sH.memory.length, '内容含丹术:', sH.memory[0].text.includes('丹术'));
  state.applyEffects(sH, { memory: ['第一条', '第二条', '第三条'] });
  console.log('[记忆] 多条归档=', sH.memory.length, '(应4)');

  /* 台词提取 */
  const qs = state.extractQuotes ? require('./game/state').extractQuotes('钱掌柜笑道：「三十灵石，少一个子都不卖。」你点头："成交。"') : null;
  console.log('[台词] 提取=', JSON.stringify(qs));

  /* 任务生命周期：登记 → 完成即清除 → 载入大事件 */
  const sQ = state.newState('务');
  sQ.turns = 7;
  let evQ = state.applyEffects(sQ, { quests: [{ title: '奇遇·断魂崖之约', desc: '黑衣人约你三日后相见', kind: '奇遇' }] });
  console.log('[任务] 登记 kind:', sQ.quests[0].kind, '| 事件:', evQ.some(e => /【奇遇】/.test(e.text)));
  evQ = state.applyEffects(sQ, { quests: [{ title: '奇遇·断魂崖之约', status: 'done' }] });
  console.log('[任务] 完成后列表清除:', sQ.quests.length === 0, '| 大事件载入:', sQ.chronicle.some(c => c.kind === 'quest' && /断魂崖之约/.test(c.text)), '| 事件:', evQ.some(e => /已载入大事件/.test(e.text)));
  evQ = state.applyEffects(sQ, { quests: [{ title: '直接宣告完成的任务', status: 'done' }] });
  console.log('[任务] 直接done不占列表:', sQ.quests.length === 0, '| 入大事件:', sQ.chronicle.some(c => /直接宣告完成/.test(c.text)));

  /* 质检事实构建 */
  const sQc = state.newState('察');
  sQc.turns = 9;
  state.applyEffects(sQc, { memory: '钱掌柜许诺教你丹术', hooks: [{ text: '深夜敲门者未现身' }], scene: { npcs: ['钱掌柜'], desc: '客栈大堂' } });
  const qcFacts = gm.buildQCFacts(sQc);
  console.log('[监察] 事实含记忆:', qcFacts.includes('丹术'), '| 含未了之事:', qcFacts.includes('敲门'), '| 含场景:', qcFacts.includes('客栈'), '| 体积≈', qcFacts.length, '字');
  console.log('[监察] QC_SYSTEM 存在:', gm.QC_SYSTEM.length > 200, '| 要求JSON:', gm.QC_SYSTEM.includes('JSON'));

  /* 物品格式污染：GM 写"烈焰符×3"作物品名 → 解析为烈焰符+3 */
  const sFmt = state.newState('格');
  sFmt.inventory = { '烈焰符': 5 };
  const evFmt = state.applyEffects(sFmt, { inventory_remove: '烈焰符×3' });
  console.log('[格式] 移除×3解析:', sFmt.inventory['烈焰符'] === 2, '| 事件:', evFmt.some(e => e.text === '失去 烈焰符×3'));
  const evFmt2 = state.applyEffects(sFmt, { inventory_add: '冰锥符×2' });
  console.log('[格式] 添加×2解析:', sFmt.inventory['冰锥符'] === 2, '| 事件:', evFmt2.some(e => e.text === '获得 冰锥符×2'));

  /* 消耗对账：量词跳跃匹配 */
  const inv2 = { '烈焰符': 3, '回元丹': 2 };
  const cons = state.extractConsumes('你点燃一张烈焰符，又用掉半瓶回元丹。', inv2);
  console.log('[对账] 量词跳跃:', JSON.stringify(cons));

  /* 回合回滚：快照链 + 状态恢复 + 日志截断 */
  const sRb = state.newState('滚');
  sRb.turns = 5;
  sRb.exp = 88;
  sRb.inventory['聚气丹'] = 4;
  sRb.log = [{ t: 1, u: 'a', a: 'A' }, { t: 2, u: 'b', a: 'B' }, { t: 3, u: 'c', a: 'C' }, { t: 4, u: 'd', a: 'D' }, { t: 5, u: 'e', a: 'E' }];
  sRb.chronicle = [{ t: 1, text: 'x' }, { t: 5, text: 'y' }];
  state.pushTurnSnap(sRb); // t=5
  sRb.exp = 999; // 模拟之后又变化
  sRb.inventory['聚气丹'] = 9;
  const ok = state.rollbackTo(sRb, 5);
  console.log('[回滚] 状态恢复: exp=', sRb.exp === 88, '聚气丹=', sRb.inventory['聚气丹'] === 4, '| log截断:', sRb.log.length === 5, '| chronicle过滤:', sRb.chronicle.length === 2, '| 种子重洗:', ok && sRb.rngSeed !== undefined);
  state.rollbackTo(sRb, 5);
  state.pushTurnSnap(sRb); // 同回合重玩覆盖
  console.log('[回滚] 快照覆盖后同t条数:', sRb.turnSnaps.filter(s => s.t === 5).length === 1);

  /* 人物登记与见闻 */
  const sN = state.newState('人');
  sN.turns = 3;
  const evN = state.applyEffects(sN, { npcs: [{ name: '钱掌柜', power: '炼气二层（你感知）', desc: '太虚门外门弟子' }] });
  console.log('[人物] 登记:', sN.npcs['钱掌柜'].power === '炼气二层（你感知）', '| 首见回合:', sN.npcs['钱掌柜'].firstTurn === 4, '| 事件:', evN.some(e => /识得人物/.test(e.text)));
  state.applyEffects(sN, { npcs: [{ name: '钱掌柜', desc: '更新：此人藏身青云镇四十年' }] });
  console.log('[人物] 更新保留power:', sN.npcs['钱掌柜'].power !== '', '| desc更新:', sN.npcs['钱掌柜'].desc.includes('更新'));
  const snapN = gm.buildSnapshot(sN, null);
  console.log('[人物] 快照含已识人物:', snapN.includes('已识人物') && snapN.includes('钱掌柜'));

  /* 剧情链 */
  const sB2 = state.newState('链');
  sB2.turns = 3;
  state.applyEffects(sB2, { beat: '钱掌柜许诺剿狼便教丹术' });
  state.applyEffects(sB2, { beat: '你应下此事，明早出发' });
  console.log('[剧情链] 条数:', sB2.beats.length === 2, '| 含摘要:', sB2.beats[0].text.includes('丹术'));
  const snapB = gm.buildSnapshot(sB2, null);
  console.log('[剧情链] 快照含脉络:', snapB.includes('剧情链') && snapB.includes('明早出发'));

  /* 状态系统与战斗状态机 */
  const sC = state.newState('状');
  sC.turns = 2;
  let evC = state.applyEffects(sC, { conditions: [{ name: '寒毒', desc: '气血每回合-5', turns: 3, hpPerTurn: -5 }] });
  console.log('[状态] 中毒登记:', sC.conditions.length === 1, '| 事件:', evC.some(e => /身中寒毒/.test(e.text)));
  /* 模拟服务器结算 */
  for (const c of sC.conditions) { sC.attrs.hp += c.hpPerTurn; c.turns -= 1; }
  sC.conditions = sC.conditions.filter(c => c.turns > 0);
  console.log('[状态] 发作后 hp=', sC.attrs.hp, '(应95) 剩回合:', sC.conditions[0].turns);
  evC = state.applyEffects(sC, { conditions: [{ name: '寒毒', action: 'remove' }] });
  console.log('[状态] 解除:', sC.conditions.length === 0, '| 事件:', evC.some(e => /解除/.test(e.text)));
  const sE = state.newState('战');
  let evE = state.applyEffects(sE, { enemy: { name: '妖狼', realm: '炼气三层', hp: 12, maxHp: 18, atk: 8, def: 3 } });
  console.log('[战斗] 敌人入册:', sE.enemy.name === '妖狼', '| 快照可见:', gm.buildSnapshot(sE, null).includes('妖狼'));
  evE = state.applyEffects(sE, { enemy: { hp: 0 } });
  console.log('[战斗] 败亡清除:', sE.enemy === null, '| 事件:', evE.some(e => /败亡/.test(e.text)));

  /* 灵宠登记：收服/更新/快照/旧档自动补空 */
  const sP = state.newState('宠');
  sP.turns = 3;
  let evP = state.applyEffects(sP, { pets: [{ name: '墨玉狸', realm: '炼气二层妖', desc: '通体墨色、瞳如金灯' }] });
  console.log('[灵宠] 登记:', sP.pets['墨玉狸'].realm === '炼气二层妖', '| 首见回合:', sP.pets['墨玉狸'].firstTurn === 4, '| 事件:', evP.some(e => /灵宠同游/.test(e.text)));
  state.applyEffects(sP, { pets: [{ name: '墨玉狸', desc: '更新：学会夜行探路' }] });
  console.log('[灵宠] 更新保留realm:', sP.pets['墨玉狸'].realm === '炼气二层妖', '| desc更新:', sP.pets['墨玉狸'].desc.includes('夜行'));
  const snapP = gm.buildSnapshot(sP, null);
  console.log('[灵宠] 快照含灵宠行:', snapP.includes('灵宠') && snapP.includes('墨玉狸'));
  const oldP = { name: '老档', realm: { stage: '炼气', level: 1 }, attrs: {} };
  const normP = state.normalizeState(oldP);
  console.log('[灵宠] 旧档自动补空:', JSON.stringify(normP.pets) === '{}');

  /* 综合判定战斗：GM 可只写 diff（无 atk/def），胜负由 GM 综合裁定 */
  const sJ = state.newState('判');
  sJ.turns = 5;
  let evJ = state.applyEffects(sJ, { enemy: { name: '妖狼', realm: '炼气三层', hp: 18, maxHp: 18, diff: '颇感吃力' } });
  console.log('[判定] 无atk/def入册:', sJ.enemy.atk === undefined && sJ.enemy.def === undefined, '| 快照含评估:', gm.buildSnapshot(sJ, null).includes('颇感吃力'));
  state.applyEffects(sJ, { enemy: { lever: 12 } });
  console.log('[判定] 杠杆累积:', sJ.enemy.lever === 12, '| 快照含杠杆:', gm.buildSnapshot(sJ, null).includes('+12'));
  evJ = state.applyEffects(sJ, { enemy: { hp: 0 } });
  console.log('[判定] 结束清除:', sJ.enemy === null, '| 留痕:', sJ.battleLog.length === 1, '| 留痕含杠杆:', sJ.battleLog[0].lever === 12);

  console.log('\n引擎 v13 全部通过 ✓');
})().catch(e => { console.error('测试失败:', e); process.exit(1); });
