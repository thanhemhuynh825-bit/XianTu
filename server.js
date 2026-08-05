'use strict';

/* ============================================================
 * 《仙途·苍玄界》 — 服务器
 * 零依赖 Node 服务：静态页面 + 游戏 API + 三槽位存档。
 * 启动：node server.js  然后打开 http://127.0.0.1:8787
 * ============================================================ */

const http = require('http');
const fs = require('fs');
const path = require('path');

const GAME_VERSION = '1.3.1';
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const SAVES = process.env.XMUD_DATA_DIR || path.join(ROOT, 'saves'); // 桌面版可重定向到可写目录
const RES_DIR = process.env.XMUD_RES_DIR || ''; // 资源热更目录（桌面版优先读取）
if (!process.env.XMUD_CONFIG_DIR) process.env.XMUD_CONFIG_DIR = ROOT; // 热更模块读配置的兜底（桌面版已指向 userData）

/* 热更模块加载：game/*.js 优先从热更目录加载（桌面版重启后生效），否则用内置 */
function loadGame(mod) {
  if (RES_DIR) {
    const p = path.join(RES_DIR, 'game', mod + '.js');
    if (fs.existsSync(p)) return require(p);
  }
  return require('./game/' + mod);
}
const state = loadGame('state');
const gm = loadGame('gm');
const character = loadGame('character');
const llm = loadGame('llm');
const { SYSTEM_PROMPT, buildMessages, buildOpeningPrompt, revivePrompt, reincarnatePrompt, GM_RULES_VERSION } = gm;
const { QA_SYSTEM, QC_SYSTEM, buildQCFacts } = gm;
const { newState, normalizeState, applyEffects, revive, reincarnate, expNeed, realmText, safeView, fateRolls, applyFuses, settleIdle, formatDate, IDLE_MAX_MIN, extractMoveLocations, inferTimeFx, fmtHours, getShichen, extractQuotes, extractConsumes, generateName, extractItemSentence, parseItemRefs, pushTurnSnap, rollbackTo } = state;
const { rollTraits, ORIGINS, PERSONALITIES, TALENTS, ORIGIN_STARTS } = character;
const { loadConfig: loadCfg, chat, GMError } = llm;

const cfg = loadCfg();

/* 静态资源：热更目录优先，其次内置 */
function resolvePublic(rel) {
  if (RES_DIR) {
    const p = path.join(RES_DIR, 'public', rel);
    if (fs.existsSync(p)) return p;
  }
  return path.join(PUBLIC, rel);
}
function localResVersion() {
  try {
    if (RES_DIR) return fs.readFileSync(path.join(RES_DIR, 'version.txt'), 'utf8').trim();
  } catch { /* 无热更版本 */ }
  return GAME_VERSION;
}
const PORT = process.env.PORT || cfg.port || 8787;
const HOST = '127.0.0.1';
const MAX_HISTORY = 30; // 模型记住最近 30 回合完整上下文（128k 窗口充裕，叙事连贯优先）
const MAX_SNAPSHOTS = 20; // 每档最多快照数（超过自动淘汰最旧）
const busy = new Map(); // slot -> boolean 回合锁，防止并发写坏存档
const qaMem = new Map(); // slot -> {name, hist:[{q,a}]} 天机问答记忆（绑定角色，换人即清）

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};

function ensureDirs() { if (!fs.existsSync(SAVES)) fs.mkdirSync(SAVES, { recursive: true }); }
function slotFile(slot) { return path.join(SAVES, `slot${slot}.json`); }
function snapDir(slot) { return path.join(SAVES, `slot${slot}.snaps`); }
function loadSlot(slot) {
  try { return normalizeState(JSON.parse(fs.readFileSync(slotFile(slot), 'utf8'))); } catch { return null; }
}
function saveSlot(slot, st) {
  st.updated = Date.now();
  const f = slotFile(slot);
  fs.writeFileSync(f + '.tmp', JSON.stringify(st, null, 2), 'utf8');
  fs.renameSync(f + '.tmp', f); // 原子写入，防断电损坏
}

/* ---------- 快照（随时存档 / 回档） ---------- */
function snapFile(slot, id) { return path.join(snapDir(slot), `${id}.json`); }
function listSnaps(slot) {
  try {
    return fs.readdirSync(snapDir(slot))
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try {
          const j = JSON.parse(fs.readFileSync(path.join(snapDir(slot), f), 'utf8'));
          return {
            id: j.id, name: j.snapName || '无名之档', createdAt: j.snapAt || 0,
            realm: realmText(j), location: j.location ? j.location.name : '未知', turns: j.turns || 0, dead: !!j.dead, auto: !!j.auto,
          };
        } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => b.createdAt - a.createdAt);
  } catch { return []; }
}
function writeSnap(slot, st, name, auto = false) {
  ensureDirs();
  if (!fs.existsSync(snapDir(slot))) fs.mkdirSync(snapDir(slot), { recursive: true });
  const id = auto ? 'auto-backup' : `s-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const snap = JSON.parse(JSON.stringify(st));
  snap.id = id; snap.snapName = name; snap.snapAt = Date.now(); snap.auto = auto;
  fs.writeFileSync(path.join(snapDir(slot), `${id}.json`), JSON.stringify(snap, null, 2), 'utf8');
  const list = listSnaps(slot).filter(s => !s.auto);
  if (list.length > MAX_SNAPSHOTS) fs.unlinkSync(snapFile(slot, list[list.length - 1].id));
  return id;
}
function readSnap(slot, id) {
  try { return JSON.parse(fs.readFileSync(snapFile(slot, id), 'utf8')); } catch { return null; }
}
function delSnap(slot, id) {
  try { fs.unlinkSync(snapFile(slot, id)); return true; } catch { return false; }
}
function err(code, msg) { return { ok: false, error: { code, msg } }; }
function friendErr(e) {
  if (e instanceof GMError) {
    if (e.code === 'PARSE' && e.raw) {
      try {
        const dir = path.join(SAVES, 'audit');
        fs.mkdirSync(dir, { recursive: true });
        fs.appendFileSync(path.join(dir, 'parse-errors.jsonl'), JSON.stringify({ at: new Date().toISOString(), finish: e.finish, raw: (e.raw || '').slice(0, 2000) }) + '\n', 'utf8');
      } catch { /* ignore */ }
    }
    return err(e.code, e.message);
  }
  return err('UNKNOWN', `服务器内部错误：${e.message || e}｜${(e.stack || '').split('\n').slice(0, 4).join(' → ')}`);
}
function log(...args) { console.log(`[${new Date().toLocaleTimeString()}]`, ...args); }

/* 解锁检测：本回合新获得的物品 / 新识 NPC / 新任务（供前端渐显动效） */
function detectUnlocks(st, invBefore, npcBefore, questBefore, fused) {
  const out = [];
  if (fused.inventory_add) {
    const names = Array.isArray(fused.inventory_add) ? fused.inventory_add
      : typeof fused.inventory_add === 'object' ? Object.keys(fused.inventory_add)
        : [fused.inventory_add];
    for (const n of names) {
      const key = String(n).replace(/[×xX]\d+$/, '');
      if (!key) continue;
      const isNew = !(st.items && st.items[key]) && !(st.itemSeen && st.itemSeen[key]);
      if (isNew) {
        out.push({
          type: 'item', title: key,
          desc: (st.items && st.items[key]) || (st.itemSeen && st.itemSeen[key] && st.itemSeen[key][0] && st.itemSeen[key][0].text) || '此物入你囊中，来历待考。',
        });
      }
    }
  }
  for (const [n, v] of Object.entries(st.npcs || {})) {
    if (!npcBefore[n]) {
      out.push({ type: 'npc', title: n, desc: v.power ? `${v.power}${v.desc ? '·' + v.desc : ''}` : (v.desc || '一位新面孔。') });
    }
  }
  if (fused.quests) {
    for (const q of Array.isArray(fused.quests) ? fused.quests : [fused.quests]) {
      if (q && q.title && !questBefore.has(q.title) && q.status !== 'done') {
        out.push({ type: 'quest', title: q.title, desc: q.desc || '', kind: q.kind || '委托' });
      }
    }
  }
  return out.slice(0, 4);
}

/* 台词自动提取（定义在 state.js，纯函数） */

/* ---------- 天命骰（定义在 state.js，服务器持有种子与回合数） ---------- */

/* ---------- 审计日志：每回合 GM 原始响应落盘，供回放调优 ---------- */
function audit(slot, rec) {
  try {
    const dir = path.join(SAVES, 'audit');
    fs.mkdirSync(dir, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    fs.appendFileSync(path.join(dir, `slot${slot}-${day}.jsonl`), JSON.stringify({ ...rec, rules: GM_RULES_VERSION }) + '\n', 'utf8');
  } catch { /* 审计失败不阻塞游戏 */ }
}

/* 结算挂机（幂等）：返回 settlement events + 给 GM 的注记，无挂机则返回空 */
function settleIdleNow(st, now = Date.now()) {
  const r = settleIdle(st, now);
  if (!r) return { events: [], note: null, warnings: [] };
  const warnings = [];
  const fx = { exp: r.exp, time: r.hours / 24 };
  applyFuses(st, fx, warnings);
  const events = applyEffects(st, fx);
  return { events, note: r.note, warnings };
}

/* ---------- 剧情监察：分级质检（只在关键节点触发，省 token） ---------- */
function needsQC(st, fx) {
  if (st.turns % 8 === 0) return true; // 周期抽查
  if (!fx) return false;
  if (['quests', 'hooks', 'memory', 'realm', 'location', 'scene', 'techniques_add'].some(k => fx[k] != null)) return true; // 剧情关键节点
  if (fx.flags && typeof fx.flags === 'object' && Object.keys(fx.flags).some(k => /^npc_/.test(k))) return true; // 新 NPC 登场
  return false;
}
/* 质检调用：输入精简（约 GM 回合 1/5），输出极小 JSON，失败静默跳过。
 * 人物模式：本回合叙事涉及已登记 NPC 时，注入其档案供人设一致性核查 */
async function qcCheck(st, command, narration, fx) {
  const involved = [...new Set(Object.keys(st.npcs || {}).filter(n => narration && narration.includes(n)))].slice(0, 3);
  const npcFacts = involved.map(n => {
    const p = st.npcs[n] || {};
    return `【${n}的档案】${p.power ? `战力：${p.power}；` : ''}身份：${p.desc || '未知'}${(st.npcSeen && st.npcSeen[n] || []).length ? `；过往言行：${st.npcSeen[n].map(s => s.text).join('；')}` : ''}`;
  }).join('\n');
  const msgs = [{
    role: 'user',
    content: `${buildQCFacts(st)}${npcFacts ? `\n\n${npcFacts}` : ''}\n\n【GM 本回合叙事】\n${narration}\n\n【GM 本回合结算(effects)】\n${JSON.stringify(fx || {})}`,
  }];
  const { json } = await chat(cfg, QC_SYSTEM, msgs, true, 400);
  return {
    ok: json && json.ok !== false,
    issues: Array.isArray(json && json.issues) ? json.issues.slice(0, 3).map(i => String(i).slice(0, 40)) : [],
    suggestion: String((json && json.suggestion) || '').slice(0, 80),
  };
}

/* 玩家质疑连贯性时强制质检（"为什么/刚才/之前/说过/不对/矛盾/不是"） */
const QC_DOUBT_RE = /为什么|为何|刚才|之前|不是说过|不是刚|不对吧|矛盾|前后|怎么回事|说过|怎么突然|明明/;

/* ---------- GM 单回合对话（新开篇/指令/复活/轮回 共用） ---------- */
async function gmTurn(slot, st, command, opts = {}) {
  /* 剧情监察提示注入：上回合的问题由本回合自然圆回（不打断体验） */
  if (!opts.skipHistory && Array.isArray(st.pendingQC) && st.pendingQC.length) {
    const notes = st.pendingQC.map(q => `${q.issues.join('；')}${q.suggestion ? `（建议：${q.suggestion}）` : ''}`).join('；');
    command = `【剧情监察】上回合剧情存在衔接问题，请在本回合叙事中自然圆回、不动声色地修正（不要打断玩家体验，也不要直接说"修正bug"之类的话）：${notes}\n${command}`;
    st.pendingQC = [];
  }
  /* 每 10 回合触发一次记忆归档提醒（GM 在本回合 effects.memory 中归档剧情摘要） */
  if (!opts.skipHistory && (st.turns + 1) % 10 === 0 && st.turns > 0) {
    command = `【系统】今逢第${st.turns + 1}回合，正是记忆归档之时：请在 effects.memory 中写入 1~3 条（每条 60 字内）最近 10 回合值得永远记住的剧情摘要（NPC 关键原话、恩怨因果、伏笔走向、势力关系），此后这些内容将作为你叙事的事实依据。\n${command}`;
  }
  const rolls = opts.noRolls ? null : fateRolls(st);
  const messages = buildMessages(st, command, rolls);
  const { json, raw } = await chat(cfg, SYSTEM_PROMPT, messages, opts.json !== false);
  const narration = typeof json.narration === 'string' ? json.narration.trim() : '（天地沉默，未有回应。）';
  const effects = json.effects && typeof json.effects === 'object' ? json.effects : {};
  const warnings = [];
  const timeBefore = st.timeH;
  const locBefore = st.location.name;
  const invBefore = { ...st.inventory }; // 行囊对账基准
  const npcBefore = { ...(st.npcs || {}) }; // 解锁检测基准
  const questBefore = new Set((st.quests || []).map(q => q.title)); // 解锁检测基准
  const fused = applyFuses(st, JSON.parse(JSON.stringify(effects)), warnings);
  const events = applyEffects(st, fused);

  /* 状态自动结算：中毒/内伤等每回合发作（回合开始时） */
  if (!opts.skipHistory && (st.conditions || []).length) {
    for (const c of st.conditions) {
      if (c.turns <= 0) continue;
      if (c.hpPerTurn) {
        st.attrs.hp += c.hpPerTurn;
        events.push({ t: c.hpPerTurn < 0 ? 'damage' : 'heal', text: `${c.name}发作：气血 ${c.hpPerTurn > 0 ? '+' : ''}${c.hpPerTurn}` });
      }
      if (c.mpPerTurn) {
        st.attrs.mp += c.mpPerTurn;
        events.push({ t: c.mpPerTurn < 0 ? 'drain' : 'restore', text: `${c.name}发作：灵力 ${c.mpPerTurn > 0 ? '+' : ''}${c.mpPerTurn}` });
      }
      c.turns -= 1;
    }
    st.conditions = st.conditions.filter(c => c.turns > 0);
    if (events.some(e => /发作/.test(e.text))) warnings.push('状态自动结算');
  }

  /* 行囊对账：叙事中消耗了物品而 GM 漏写 effects 时，按差额补扣 */
  for (const { item, times } of extractConsumes(narration, invBefore)) {
    const actualDrop = (invBefore[item] || 0) - (st.inventory[item] || 0);
    const need = times - actualDrop;
    if (need > 0 && (st.inventory[item] || 0) >= need) {
      st.inventory[item] -= need;
      if (st.inventory[item] === 0) delete st.inventory[item];
      events.push({ t: 'lose', text: `行囊核对：已消耗 ${item}×${need}` });
      warnings.push(`叙事消耗${item}×${times}但 effects 未同步，已按差额补扣 ${need}`);
    }
  }

  /* 时辰自动推断：GM 未声明时间流逝时，按动作关键词兜底（有体感、有代价） */
  if (st.timeH === timeBefore) {
    const h = inferTimeFx(command + '\n' + narration);
    if (h > 0) {
      applyEffects(st, { time: h / 24 });
      events.push({ t: 'time', text: `时光流逝：${fmtHours(h)} · 现为${getShichen(st)}时` });
      warnings.push(`未声明时间，按动作推断 ${fmtHours(h)}`);
    }
  }

  /* 恢复兜底：GM 忘了结算时，修炼回灵力、休整回气血（只补缺口的百分比） */
  const act = command + '\n' + narration;
  if (/打坐|运功|吐纳|调息|修炼|闭关/.test(act) && st.attrs.mp < st.attrs.max_mp && fused.mp == null) {
    const gain = Math.ceil((st.attrs.max_mp - st.attrs.mp) * 0.4);
    if (gain > 0) { st.attrs.mp += gain; events.push({ t: 'restore', text: `灵力 +${gain}（打坐回气）` }); }
  }
  if (/睡觉|过夜|休整|歇息|养伤|疗伤|休养|卧床/.test(act) && st.attrs.hp < st.attrs.max_hp && fused.hp == null) {
    const gain = Math.ceil((st.attrs.max_hp - st.attrs.hp) * 0.25);
    if (gain > 0) { st.attrs.hp += gain; events.push({ t: 'heal', text: `气血 +${gain}（休整养息）` }); }
  }

  /* 位置校正：GM 叙事里发生了移动却漏写 effects.location → 提取地点并同步 */
  if (st.location.name === locBefore) {
    const moves = extractMoveLocations(narration);
    const target = moves.find(m => m !== st.location.name);
    if (target) {
      st.location = { name: target, area: target };
      events.push({ t: 'system', text: `（位置校正）已抵达 ${target}` });
      warnings.push(`叙事提及移动但未写 location，已校正至 "${target}"`);
    }
  }

  if (st.dead && events.some(e => e.t === 'death')) {
    st.deathReason = (narration || '').replace(/\*+/g, '').trim().slice(-90) || '命陨苍玄界';
  }
  st.turns += 1;

  /* 台词自动存档（滚动 200 条） */
  const qs = extractQuotes(narration);
  if (qs.length) {
    st.quotes = st.quotes || [];
    for (const q of qs.slice(0, 6)) st.quotes.push({ t: st.turns, text: q });
    if (st.quotes.length > 200) st.quotes = st.quotes.slice(-200);
  }

  /* 剧情见闻摘录：本回合获得/装备的物品，从叙事中提取原文存入图鉴（悬浮窗如实展示） */
  {
    st.itemSeen = st.itemSeen || {};
    const touched = new Set();
    if (fused.inventory_add) {
      if (Array.isArray(fused.inventory_add)) fused.inventory_add.forEach(n => touched.add(n));
      else if (typeof fused.inventory_add === 'object') Object.keys(fused.inventory_add).forEach(n => touched.add(n));
      else touched.add(fused.inventory_add);
    }
    if (fused.equip && typeof fused.equip === 'object') Object.values(fused.equip).forEach(n => n && touched.add(n));
    for (const name of touched) {
      const seen = st.itemSeen[name];
      if (seen && seen.length >= 2) continue; // 每件物品最多留 2 条见闻
      const sent = extractItemSentence(narration, name);
      if (!sent) continue;
      const entry = { t: st.turns, text: sent };
      if (seen) { st.itemSeen[name] = [...seen, entry].slice(-2); }
      else st.itemSeen[name] = [entry];
    }
  }

  /* 人物见闻摘录：本回合叙事中提到已识 NPC 的句子，存入人物志（跟随剧情更新） */
  {
    st.npcSeen = st.npcSeen || {};
    const known = new Set([
      ...Object.keys(st.npcs || {}),
      ...Object.keys(st.world.flags || {}).filter(k => k.startsWith('npc_')).map(k => k.slice(4)),
    ]);
    for (const nm of known) {
      const arr = st.npcSeen[nm] || [];
      if (arr.length >= 3) continue; // 每人最多 3 条见闻
      const sent = extractItemSentence(narration, nm); // 按句子提取，逻辑同物品
      if (!sent) continue;
      const entry = { t: st.turns, text: sent };
      st.npcSeen[nm] = [...arr, entry].slice(-3);
    }
  }
  st.log = st.log || [];
  st.log.push({
    t: st.turns, u: command, a: narration,
    title: typeof json.title === 'string' ? json.title : null,
    ev: events.map(e => ({ t: e.t, text: e.text })), // 系统事件一并存档，重放时可完整还原排版
  });
  if (st.log.length > 10000) st.log = st.log.slice(-10000); // 剧情永久保留（万回合量级），仅作防爆盘护栏
  if (!opts.skipHistory) {
    st.history.push({ u: command, a: narration });
    if (st.history.length > MAX_HISTORY) st.history = st.history.slice(-MAX_HISTORY);
  }
  pushTurnSnap(st); // 回合快照链：记录本回合结束时的核心状态（支持回滚）

  /* 到访记录（地图数据源） */
  {
    st.visited = st.visited || {};
    const k = st.location.name;
    const v = st.visited[k] || { area: st.location.area, firstTurn: st.turns, count: 0 };
    v.area = st.location.area;
    v.lastTurn = st.turns;
    v.count = (v.count || 0) + 1;
    st.visited[k] = v;
  }
  saveSlot(slot, st);

  /* 剧情监察：关键节点/周期抽样/玩家质疑时跑质检，发现问题挂起待下回合圆回 */
  let qcResult = null;
  if (!opts.skipHistory && (needsQC(st, fused) || QC_DOUBT_RE.test(command))) {
    try {
      qcResult = await qcCheck(st, command, narration, fused);
      if (!qcResult.ok && qcResult.issues.length) {
        st.pendingQC = st.pendingQC || [];
        st.pendingQC.push({ turn: st.turns, issues: qcResult.issues, suggestion: qcResult.suggestion });
        if (st.pendingQC.length > 3) st.pendingQC = st.pendingQC.slice(-3);
        saveSlot(slot, st);
        log(`[slot${slot}] ⚠ 监察 #${st.turns}: ${qcResult.issues.join('；')}`);
      } else {
        log(`[slot${slot}] ✓ 监察 #${st.turns} 通过`);
      }
    } catch (e) {
      log(`[slot${slot}] 监察跳过（${e.code || e.message}）`);
    }
  }

  /* 剧情链与自检记录（audit 留痕） */
  if (fused.beat != null) { /* 已在 applyEffects 中入链 */ }
  const selfcheck = Array.isArray(fused.selfcheck) ? fused.selfcheck.slice(0, 6).map(s => String(s).slice(0, 30)) : null;

  audit(slot, {
    at: new Date().toISOString(), turn: st.turns, command: command.slice(0, 200),
    rolls, narrationLen: narration.length, title: json.title || null,
    effects: fused, warnings, dead: st.dead, realm: realmText(st),
    qc: qcResult ? (qcResult.ok ? 'pass' : 'issues') : null,
    selfcheck,
  });
  if (warnings.length) log(`[slot${slot}] ⚠ 回合#${st.turns} 保险丝: ${warnings.join('；')}`);
  log(`[slot${slot}] 回合#${st.turns} 指令: ${command.slice(0, 40)} | 事件${events.length}条 | 骰 ${rolls ? `${rolls.fate}/${rolls.danger}/${rolls.chance}` : '-'}`);
  return {
    ok: true,
    title: typeof json.title === 'string' ? json.title : null,
    narration,
    available: Array.isArray(json.available) ? json.available.slice(0, 9) : [],
    events,
    state: safeView(st),
    cutscene: fused.cutscene || null, // 重大节点过场（一次性展示，不落档）
    unlocks: detectUnlocks(st, invBefore, npcBefore, questBefore, fused),
  };
}

/* ---------- HTTP 处理 ---------- */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 5e6) { reject(new Error('body too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error('JSON 格式错误')); } });
  });
}

function staticServe(req, res, pathname) {
  let rel = pathname === '/' ? 'index.html' : pathname;
  let fp = path.normalize(path.join(PUBLIC, rel));
  if (RES_DIR) {
    const hot = path.join(RES_DIR, 'public', rel);
    if (fs.existsSync(hot)) fp = hot;
  }
  if (!fp.startsWith(PUBLIC) && !(RES_DIR && fp.startsWith(path.join(RES_DIR, 'public')))) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(fp, (e, buf) => {
    if (e) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('404 Not Found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  const p = u.pathname;

  /* 静态资源 */
  if (req.method === 'GET' && !p.startsWith('/api/')) return staticServe(req, res, p);

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const send = (code, obj) => { res.writeHead(code); res.end(JSON.stringify(obj)); };

  try {
    /* 引导信息：是否已配置密钥 + 存档概览 */
    if (req.method === 'GET' && p === '/api/bootstrap') {
      ensureDirs();
      const slots = [1, 2, 3].map(slot => {
        const st = loadSlot(slot);
        if (!st) return { slot, has: false };
        return { slot, has: true, name: st.name, realm: realmText(st), location: st.location.name, turns: st.turns, dead: st.dead, updated: st.updated || st.created }; // updated=最近游玩时间
      });
      return send(200, { ok: true, configured: !!cfg.apiKey, model: cfg.model, slots });
    }

    const body = await readBody(req);

    /* 建号词条：预览 / 刷新（免费 20 次由前端计数） */
    if (req.method === 'POST' && p === '/api/preview') {
      return send(200, { ok: true, traits: rollTraits(body.gender === 'female' ? 'female' : 'male') });
    }

    /* 新游戏（会覆盖该槽位，前端已确认；name/gender/词条由建号界面选定） */
    if (req.method === 'POST' && p === '/api/newgame') {
      ensureDirs();
      const slot = Math.max(1, Math.min(3, parseInt(body.slot) || 1));
      if (busy.get(slot)) return send(409, err('BUSY', '该档位正在演绎中，请稍候。'));
      busy.set(slot, true);
      try {
        const given = (body.name || '').trim().slice(0, 12);
        const name = given && given !== '无名散修' ? given : generateName(); // 留空由天命赐名
        const traits = body.traits && typeof body.traits === 'object' ? body.traits : {};
        const st = newState(name, {
          gender: body.gender,
          roots: traits.roots && traits.roots.quality && Array.isArray(traits.roots.list) && traits.roots.list.length ? traits.roots : null,
          origin: traits.origin && ORIGINS.some(o => o.name === traits.origin.name) ? traits.origin : null,
          personality: traits.personality && PERSONALITIES.some(p => p.name === traits.personality.name) ? traits.personality : null,
          talent: traits.talent && TALENTS.some(t => t.name === traits.talent.name) ? traits.talent : null,
        });
        /* 出身决定出生地：开局位置与初始剧情随之变化 */
        const start = st.origin && ORIGIN_STARTS[st.origin.name];
        if (start) {
          st.location = { name: start.place, area: start.area };
          st.visited = { [start.place]: { area: start.area, firstTurn: 1, lastTurn: 1, count: 1 } };
          if (!st.explored.includes(start.area)) st.explored.push(start.area);
          if (st.mapPos[start.area] === undefined) st.mapPos[start.area] = [450 + Math.floor(Math.random() * 60) - 30, 260 + Math.floor(Math.random() * 40) - 20];
        }
        st.givenName = !!given;
        const opening = await gmTurn(slot, st, buildOpeningPrompt(st), { skipHistory: true, json: true });
        /* 开篇位置锁定：出生地以出身映射为准，GM 首回合不得移动 */
        if (start && st.location.name !== start.place) {
          st.location = { name: start.place, area: start.area };
          saveSlot(slot, st);
          log(`[slot${slot}] 开篇位置已锁定为出生地「${start.place}」`);
        }
        return send(200, opening);
      } finally { busy.set(slot, false); }
    }

    /* 赐名 / 改名：让 NPC 有名字可叫 */
    if (req.method === 'POST' && p === '/api/name') {
      const slot = Math.max(1, Math.min(3, parseInt(body.slot) || 1));
      const st = loadSlot(slot);
      if (!st) return send(404, err('NOSAVE', '该档位还没有角色。'));
      const name = (body.name || '').trim().slice(0, 12);
      if (!name || name === '无名散修') return send(400, err('BADNAME', '请赐一个真正的名讳。'));
      const old = st.name;
      st.name = name;
      st.givenName = true;
      st.chronicle = st.chronicle || [];
      st.chronicle.push({ t: st.turns + 1, text: `更名：${old} → ${name}，从此世人以此名相称`, kind: 'system' });
      saveSlot(slot, st);
      return send(200, {
        ok: true,
        narration: `自此，你以「${name}」之名行走苍玄界。旧名将随风散去，新名会渐渐响在坊市、山门与酒肆之间。`,
        title: '赐名',
        state: safeView(st),
      });
    }

    /* 常规指令回合 */
    if (req.method === 'POST' && p === '/api/play') {
      const slot = Math.max(1, Math.min(3, parseInt(body.slot) || 1));
      const st = loadSlot(slot);
      if (!st) return send(404, err('NOSAVE', '该档位还没有角色，请先创建。'));
      if (st.dead) return send(409, err('DEAD', '角色已身死，请选择复活或轮回。'));
      const cmd = (body.command || '').trim();
      if (!cmd) return send(400, err('EMPTY', '请输入指令。'));
      if (cmd.length > 200) return send(400, err('LONG', '指令过长，请精简到 200 字以内。'));
      if (busy.get(slot)) return send(409, err('BUSY', '上一段因果还在推演中，稍候再言。'));
      busy.set(slot, true);
      try {
        const settled = settleIdleNow(st); // 闭关挂机结算（若有）
        const fullCmd = settled.note ? `${settled.note}。\n【玩家指令】${cmd}` : cmd;
        const res = await gmTurn(slot, st, fullCmd);
        if (settled.events.length) res.events = [...settled.events, ...res.events];
        if (settled.warnings.length) log(`[slot${slot}] ⚠ 挂机保险丝: ${settled.warnings.join('；')}`);
        return send(200, res);
      }
      catch (e) { return send(500, friendErr(e)); }
      finally { busy.set(slot, false); }
    }

    /* 放置闭关：开始 / 提前出关 */
    if (req.method === 'POST' && p === '/api/idle') {
      const slot = Math.max(1, Math.min(3, parseInt(body.slot) || 1));
      const st = loadSlot(slot);
      if (!st) return send(404, err('NOSAVE', '该档位还没有角色。'));
      if (st.dead) return send(409, err('DEAD', '角色已身死，请先处理。'));
      busy.set(slot, true);
      try {
        if (body.cancel) {
          const settled = settleIdleNow(st);
          if (!settled.note) return send(200, { ok: true, narration: '你本就没有入定。', state: safeView(st), events: [] });
          const fullCmd = `${settled.note}。\n【事件】玩家提前出关，打断了这次闭关（挂机中断结算）。请用一两句话承接当前处境，给出下一步建议。`;
          let narration = settled.note + '。';
          try {
            const msg = buildMessages(st, fullCmd);
            const { json } = await chat(cfg, SYSTEM_PROMPT, msg);
            narration = typeof json.narration === 'string' ? json.narration : settled.note;
          } catch { /* 用默认文本 */ }
          st.history.push({ u: '(事件) 出关', a: narration });
          saveSlot(slot, st);
          return send(200, { ok: true, narration, events: settled.events, state: safeView(st) });
        }
        if (st.idle) return send(409, err('BUSY', '你尚在闭关入定中（快照面板可提前出关）。'));
        const durationMin = Math.max(10, Math.min(IDLE_MAX_MIN, parseInt(body.durationMin) || 30));
        st.idle = { startAt: Date.now(), durationMin };
        saveSlot(slot, st);
        const endAt = new Date(st.idle.startAt + durationMin * 60000);
        return send(200, {
          ok: true,
          narration: `你寻了一处静室，盘膝入定。天地渐远，灵台澄明——闭关将于约 ${durationMin} 分钟后出关（${endAt.toLocaleTimeString()}）。期间可离线，修为会自动结算。`,
          state: safeView(st),
        });
      } finally { busy.set(slot, false); }
    }

    /* 复活 / 轮回 */
    if (req.method === 'POST' && p === '/api/revive') {
      const slot = Math.max(1, Math.min(3, parseInt(body.slot) || 1));
      let st = loadSlot(slot);
      if (!st) return send(404, err('NOSAVE', '该档位还没有角色。'));
      const mode = body.mode === 'reincarnate' ? 'reincarnate' : 'revive';
      busy.set(slot, true);
      try {
        let narration;
        if (mode === 'revive') {
          if (!st.dead) return send(200, { ok: true, narration: '你一切安好。', state: safeView(st) });
          const fallback = revive(st);
          st.chronicle = st.chronicle || [];
          st.chronicle.push({ t: st.turns + 1, text: `死而复生，于${st.location.name}苏醒（气血六成）` });
          saveSlot(slot, st);
          try {
            const msg = buildMessages(st, revivePrompt(st.location.name));
            const { json } = await chat(cfg, SYSTEM_PROMPT, msg);
            narration = typeof json.narration === 'string' ? json.narration : fallback;
          } catch { narration = fallback; }
          st.history.push({ u: '(事件) 战败苏醒', a: narration });
        } else {
          const { next, tech } = reincarnate(st);
          st = next; // 指向新档
          const techName = tech ? tech.name : '无（尘缘未了）';
          st.chronicle = st.chronicle || [];
          st.chronicle.push({ t: 0, text: `轮回转世·第${st.reincarnations}世，传承《${techName}》，福缘+1` });
          saveSlot(slot, st);
          const prompt = reincarnatePrompt(techName, st.reincarnations, st.location.name);
          try {
            const msg = buildMessages(st, prompt);
            const { json } = await chat(cfg, SYSTEM_PROMPT, msg);
            narration = typeof json.narration === 'string' ? json.narration : '';
          } catch { narration = ''; }
          if (!narration) narration = `轮回第${st.reincarnations}世：你带着前世记忆在${st.location.name}重新睁眼${tech ? `，脑海中的《${techName}》仍在流转。` : '。'}`;
          st.history.push({ u: '(事件) 轮回转世', a: narration });
        }
        saveSlot(slot, st);
        return send(200, { ok: true, narration, state: safeView(st) });
      } finally { busy.set(slot, false); }
    }

    /* 回合回滚：回到历史第 N 回合，其后剧情重新演绎（命运重新洗牌） */
    if (req.method === 'POST' && p === '/api/rollback') {
      const slot = Math.max(1, Math.min(3, parseInt(body.slot) || 1));
      const st = loadSlot(slot);
      if (!st) return send(404, err('NOSAVE', '该档位还没有角色。'));
      const turn = parseInt(body.turn);
      if (!Number.isFinite(turn) || turn < 1 || turn > st.turns) return send(400, err('BADTURN', '回滚点无效。'));
      if (busy.get(slot)) return send(409, err('BUSY', '上一段因果还在推演中，稍候再言。'));
      busy.set(slot, true);
      try {
        if (!rollbackTo(st, turn)) return send(404, err('NOSNAP', '该回合距今太远，快照已滚动清除（最近 300 回合内可回滚）。'));
        saveSlot(slot, st);
        log(`[slot${slot}] 回滚 → 第 ${turn} 回合，命运重洗`);
        return send(200, {
          ok: true,
          narration: `【时光倒流】因果于第 ${turn} 回合重新起笔——此后的一切尚未发生，命运重新洗牌。接下来的每一步都是全新的。`,
          title: '逆天改命',
          state: safeView(st),
        });
      } finally { busy.set(slot, false); }
    }

    /* 天机问答：只读人生档案，不耗回合、不写档 */
    if (req.method === 'POST' && p === '/api/qa') {
      const slot = Math.max(1, Math.min(3, parseInt(body.slot) || 1));
      const st = loadSlot(slot);
      if (!st) return send(404, err('NOSAVE', '该档位还没有角色。'));
      const q = (body.question || '').trim().slice(0, 500);
      if (!q) return send(400, err('EMPTY', '请输入问题。'));
      const logs = (st.log || []).slice(-300).map(l => `【第${l.t}回合】你：${l.u}\n${(l.a || '').slice(0, 120)}`).join('\n\n');
      const mem = (st.memory || []).map(m => `[第${m.t}回]${m.text}`).join('；') || '（尚无长期记忆）';
      const hooks = (st.hooks || []).map(h => `[第${h.turn}回]${h.text}`).join('；') || '（无）';
      const quotes = (st.quotes || []).slice(-100).map(q => `[第${q.t}回]${q.text}`).join('\n');
      const context = `【修士当前】${st.name}，${realmText(st)}，位于${st.location.name}（第${st.turns}回合）。\n【长期记忆】${mem}\n【未了之事】${hooks}\n【台词存档】${quotes || '（暂无）'}\n\n【人生档案（节选最近300回合）】\n${logs || '（档案尚空，此人初入江湖。）'}`;
      /* QA 会话记忆绑定角色：换档/改名即清，防止串档 */
      const memQA = qaMem.get(slot);
      if (!memQA || memQA.name !== st.name) qaMem.set(slot, { name: st.name, hist: [] });
      const hist = qaMem.get(slot).hist.slice(-8).flatMap(h => [
        { role: 'user', content: `问：${h.q}` }, { role: 'assistant', content: h.a },
      ]);
      const msgs = [
        { role: 'user', content: context },
        ...hist,
        { role: 'user', content: `问：${q}` },
      ];
      try {
        const { json } = await chat(cfg, QA_SYSTEM, msgs, false, 800);
        const answer = String(json.narration || '').trim() || '（档案官沉吟不语。）';
        qaMem.get(slot).hist.push({ q, a: answer });
        if (qaMem.get(slot).hist.length > 10) qaMem.get(slot).hist = qaMem.get(slot).hist.slice(-10);
        return send(200, { ok: true, answer });
      } catch (e) { return send(500, friendErr(e)); }
    }

    /* 快照管理：列表 / 存档 / 回档 / 删除 */
    if (req.method === 'GET' && p === '/api/snapshots') {
      const slot = Math.max(1, Math.min(3, parseInt(u.searchParams.get('slot') || 1)));
      return send(200, { ok: true, list: listSnaps(slot) });
    }
    if (req.method === 'POST' && p === '/api/snapshot') {
      const slot = Math.max(1, Math.min(3, parseInt(body.slot) || 1));
      const st = loadSlot(slot);
      if (!st) return send(404, err('NOSAVE', '该档位还没有角色。'));
      const name = String(body.name || '').trim().slice(0, 20) || '无名之档';
      writeSnap(slot, st, name);
      return send(200, { ok: true, list: listSnaps(slot) });
    }
    if (req.method === 'POST' && p === '/api/loadsnapshot') {
      const slot = Math.max(1, Math.min(3, parseInt(body.slot) || 1));
      const id = String(body.id || '');
      const st = loadSlot(slot);
      const snap = readSnap(slot, id);
      if (!st) return send(404, err('NOSAVE', '该档位还没有角色。'));
      if (!snap) return send(404, err('NOSNAP', '快照不存在或已损坏。'));
      busy.set(slot, true);
      try {
        writeSnap(slot, st, '回档前自动备份', true); // 安全网：回档前留一手
        const loaded = normalizeState(snap);
        delete loaded.id; delete loaded.snapName; delete loaded.snapAt; delete loaded.auto;
        saveSlot(slot, loaded);
        log(`[slot${slot}] 回档 → "${snap.snapName}"（回合 ${snap.turns}）`);
        return send(200, {
          ok: true,
          narration: `【回档】你已回到「${snap.snapName}」的节点（第 ${snap.turns} 回合）。若反悔，快照列表里的「回档前自动备份」可让你回到回档前的状态。`,
          title: '时光倒流',
          state: safeView(loaded),
          list: listSnaps(slot),
        });
      } finally { busy.set(slot, false); }
    }
    if (req.method === 'POST' && p === '/api/deletesnapshot') {
      const slot = Math.max(1, Math.min(3, parseInt(body.slot) || 1));
      const ok = delSnap(slot, String(body.id || ''));
      return send(200, { ok, list: listSnaps(slot) });
    }

    /* 重置档位 */
    if (req.method === 'POST' && p === '/api/reset') {
      const slot = Math.max(1, Math.min(3, parseInt(body.slot) || 1));
      try { fs.unlinkSync(slotFile(slot)); } catch { /* 没有也无妨 */ }
      try { fs.rmSync(snapDir(slot), { recursive: true, force: true }); } catch { /* 没有也无妨 */ }
      return send(200, { ok: true });
    }

    /* 导出 / 导入（备份与迁移） */
    if (req.method === 'GET' && p === '/api/export') {
      const slot = Math.max(1, Math.min(3, parseInt(u.searchParams.get('slot') || 1)));
      const st = loadSlot(slot);
      if (!st) return send(404, err('NOSAVE', '该档位没有角色。'));
      const settled = settleIdleNow(st); // 挂机到期静默结算，events 随响应带回
      if (settled.events.length) saveSlot(slot, st);
      return send(200, { ok: true, data: st, events: settled.events });
    }
    if (req.method === 'POST' && p === '/api/import') {
      const slot = Math.max(1, Math.min(3, parseInt(body.slot) || 1));
      const st = normalizeState(body.data);
      if (!st || !st.realm || !st.attrs || !st.inventory) return send(400, err('BADIMPORT', '存档数据不完整。'));
      saveSlot(slot, st);
      return send(200, { ok: true, state: safeView(st) });
    }

    /* 心跳 */
    if (req.method === 'GET' && p === '/api/health') {
      return send(200, { ok: true, configured: !!cfg.apiKey, model: cfg.model, time: Date.now() });
    }

    /* 桌面信息（设置页展示数据目录） */
    if (req.method === 'GET' && p === '/api/info') {
      return send(200, { ok: true, dataDir: SAVES, configDir: process.env.XMUD_CONFIG_DIR || ROOT, desktop: !!process.env.XMUD_DATA_DIR });
    }

    /* API 配置：读取 / 保存（朋友机器填 key 即用） */
    if (req.method === 'GET' && p === '/api/getconfig') {
      return send(200, { ok: true, configured: !!cfg.apiKey, model: cfg.model || 'deepseek-v4-flash', hasKey: !!cfg.apiKey });
    }
    if (req.method === 'POST' && p === '/api/setconfig') {
      const key = String(body.apiKey || '').trim();
      if (key && key.length < 8) return send(400, err('BADKEY', 'API Key 格式可疑，请核对。'));
      if (key) cfg.apiKey = key;
      else cfg.apiKey = ''; // 允许清空
      const configDir = process.env.XMUD_CONFIG_DIR || ROOT;
      try {
        const fp = path.join(configDir, 'config.json');
        const cur = JSON.parse(fs.readFileSync(fp, 'utf8'));
        cur.apiKey = key;
        fs.writeFileSync(fp, JSON.stringify(cur, null, 2), 'utf8');
        return send(200, { ok: true, configured: !!key, msg: key ? 'API Key 已保存并生效。' : 'API Key 已清空。' });
      } catch (e) {
        return send(500, err('SAVEFAIL', `配置写入失败：${e.message}`));
      }
    }

    /* 一键更新：支持直链 JSON 或 GitHub 仓库（"github:owner/repo"） */
    if (req.method === 'GET' && p === '/api/update/status') {
      return send(200, {
        ok: true, gameVersion: GAME_VERSION, localVersion: localResVersion(),
        updateUrl: cfg.updateUrl || '', hasUpdate: false,
      });
    }
    if (req.method === 'POST' && p === '/api/update/check') {
      const url = cfg.updateUrl || '';
      if (!url) return send(400, err('NOURL', '尚未配置更新地址（config.json 的 updateUrl，支持直链或 github:owner/repo）。'));
      try {
        let pkg = null, exeInfo = null;
        if (url.startsWith('github:')) {
          /* GitHub 仓库模式：取最新 Release 的资产 */
          const repo = url.slice(7).replace(/\/+$/, '');
          const rel = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
            headers: { 'User-Agent': 'xiantu-updater', Accept: 'application/vnd.github+json' },
            signal: AbortSignal.timeout(30000),
          });
          if (!rel.ok) return send(502, err('FETCH', `GitHub 返回 ${rel.status}（仓库名应为 owner/repo，且需有已发布的 Release）`));
          const data = await rel.json();
          const assets = (data.assets || []).map(a => ({ name: a.name, url: a.browser_download_url, size: a.size }));
          const up = assets.find(a => a.name === 'update.json');
          const exe = assets.find(a => /\.exe$/.test(a.name));
          if (up) {
            const r2 = await fetch(up.url, { signal: AbortSignal.timeout(60000) });
            if (r2.ok) pkg = await r2.json();
          }
          if (exe) exeInfo = { name: exe.name, url: exe.url, size: exe.size, tag: data.tag_name, note: data.name || '' };
        } else {
          const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
          if (!res.ok) return send(502, err('FETCH', `更新源返回 ${res.status}`));
          pkg = await res.json();
        }
        const ver = pkg && String(pkg.version || '');
        const cur = localResVersion();
        const norm = s => String(s || '').replace(/^v/i, ''); // tag 的 v 前缀归一化
        const hasHot = ver && norm(ver) !== norm(cur) && pkg.files && typeof pkg.files === 'object';
        if (hasHot && RES_DIR) {
          fs.mkdirSync(path.join(RES_DIR, 'public'), { recursive: true });
          fs.mkdirSync(path.join(RES_DIR, 'game'), { recursive: true });
          let n = 0;
          for (const [rel, b64] of Object.entries(pkg.files)) {
            const safe = path.normalize(rel).replace(/^[.\\/]+/, '');
            if (!safe || safe.includes('..')) continue;
            const target = path.join(RES_DIR, safe);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, Buffer.from(b64, 'base64'));
            n++;
          }
          fs.writeFileSync(path.join(RES_DIR, 'version.txt'), ver, 'utf8');
          log(`[update] 热更完成 ${ver}（${n} 个文件）`);
        }
        return send(200, {
          ok: true,
          hasUpdate: !!(hasHot || exeInfo),
          hotUpdated: !!hasHot,
          version: ver || (exeInfo && exeInfo.tag) || cur,
          note: (pkg && pkg.note) || (exeInfo && exeInfo.note) || '',
          files: hasHot ? Object.keys(pkg.files).length : 0,
          exe: exeInfo || null,
          msg: hasHot ? `更新 ${ver} 已就绪，重启应用生效。` : exeInfo ? `发现新完整版 ${exeInfo.tag || ''}，可下载更新。` : '已是最新版本。',
        });
      } catch (e) {
        return send(502, err('FETCH', `检查更新失败：${e.message}`));
      }
    }
    /* 下载完整版 exe（GitHub Release 资产 → 系统下载目录） */
    if (req.method === 'POST' && p === '/api/update/download-exe') {
      const { url, name } = body;
      if (!url) return send(400, err('NOURL', '缺少下载地址。'));
      const dir = process.env.XMUD_DOWNLOAD_DIR || path.join(process.env.USERPROFILE || '.', 'Downloads');
      try {
        fs.mkdirSync(dir, { recursive: true });
        const target = path.join(dir, String(name || '仙途-新版本.exe').replace(/[\\/:*?"<>|]/g, '_'));
        const res = await fetch(url, { signal: AbortSignal.timeout(1800000) }); // 大文件下载：30 分钟超时
        if (!res.ok) return send(502, err('FETCH', `下载失败：${res.status}`));
        const buf = Buffer.from(await res.arrayBuffer());
        fs.writeFileSync(target, buf);
        return send(200, { ok: true, path: target, size: buf.length, msg: `已下载到：${target}` });
      } catch (e) {
        return send(502, err('FETCH', `下载失败：${e.message}`));
      }
    }

    send(404, err('NOTFOUND', '未知接口'));
  } catch (e) {
    if (/JSON 格式错误/.test(e.message)) return send(400, err('BADJSON', e.message));
    send(500, friendErr(e));
  }
});

/* 导出：供 Electron 桌面版复用（startServer 返回 {server, port}） */
function startServer(port = PORT) {
  ensureDirs();
  const srv = server.listen(port, HOST, () => {
    console.log('');
    console.log('  ╔══════════════════════════════════════════════╗');
    console.log('  ║  仙途 · 苍玄界 — AI 修仙 MUD                 ║');
    console.log(`  ║  服务器：http://${HOST}:${port}                      ║`);
    console.log(`  ║  模型：${(cfg.model || 'deepseek-chat').padEnd(33)}║`);
    console.log(`  ║  API Key：${cfg.apiKey ? '已配置 ✓' : '未配置 ✗（填 config.json 或设环境变量）'}${' '.repeat(7)}║`);
    console.log('  ╚══════════════════════════════════════════════╝');
    if (!cfg.apiKey) console.log('\n  提示：在 config.json 中填入你的 DeepSeek API Key 后重启即可游玩。');
  });
  return { server: srv, port };
}

module.exports = { startServer, loadConfig: cfg };

if (require.main === module) {
  startServer();
}
