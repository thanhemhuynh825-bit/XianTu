'use strict';

/* ============================================================
 * 《仙途·苍玄界》 — 状态引擎
 * 服务器是状态的唯一权威：GM 只下发"增量"，本模块负责
 * 校验、结算、派生系统消息，保证玩家面板永远真实可信。
 * ============================================================ */

/* 舆图坐标：内置青云域骨架（区域 → [x, y]，逻辑坐标 900x520） */
const MAP_SKELETON = {
  '青云镇': [150, 300], '青云山': [400, 140], '落霞森林': [330, 380], '黑风谷': [620, 250],
  '百灵坊市': [520, 470], '妖兽山脉': [720, 400], '断魂崖': [660, 110],
};
/* 新区域自动布局：按探索顺序环形分布（中心 450,260） */
let mapAutoAngle = 0;
function autoMapPos() {
  const angle = (mapAutoAngle++ * 0.9) % (Math.PI * 2);
  return [Math.round(450 + 200 * Math.cos(angle)), Math.round(260 + 150 * Math.sin(angle))];
}
const STAGE_LEVELS = { 炼气: 12, 筑基: 4, 金丹: 4, 元婴: 4, 化神: 4, 炼虚: 4, 合体: 4, 大乘: 4, 渡劫: 4 };
function stageLabel(s) {
  if (!s) return '未知';
  if (s.stage === '炼气') return `炼气${['一','二','三','四','五','六','七','八','九','十','十一','十二'][s.level - 1] || s.level}层`;
  return `${s.stage}${['初期','中期','后期','圆满'][(s.level - 1) % 4] || ''}`;
}

const LIFESPAN = { 凡人: 100, 炼气: 150, 筑基: 200, 金丹: 500, 元婴: 1000, 化神: 2000, 炼虚: 4000, 合体: 8000, 大乘: 16000, 渡劫: 20000 };
/* 每小层所需修为：稳扎稳打——修为是硬门槛，突破后清零重来 */
const EXP_NEED = {
  炼气: 120,     // 炼气每层 120（12 层共 1440）
  筑基: 1000,    // 筑基每小层 1000（初/中/后/圆满 共 4000）
  金丹: 8000,    // 金丹每小层 8000
  元婴: 50000,
  化神: 250000,
  炼虚: 1200000,
  合体: 6000000,
  大乘: 30000000,
  渡劫: 0,
};
const ELEMENTS = ['金', '木', '水', '火', '土'];
const MUTANTS = ['冰', '风', '雷'];
const EQUIP_SLOTS = ['weapon', 'armor', 'accessory'];
const SLOT_NAMES = { weapon: '武器', armor: '衣甲', accessory: '佩饰' };

/* ---------- 游戏内日历（青云历） ---------- */
const CAL_START = { year: 437, month: 3, day: 23, hour: 10 }; // 青云历起点：三月初三巳时
const HOURS_PER_DAY = 24, DAYS_PER_MONTH = 30, DAYS_PER_YEAR = 360;
const SHICHEN = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
const MAX_TIME_PER_TURN = 365 * HOURS_PER_DAY; // 单回合时间流逝上限（一年），防事故

function cnDay(d) {
  if (d <= 0 || d > 30) return `${d}日`;
  const tens = Math.floor(d / 10), ones = d % 10;
  if (d === 10) return '初十';
  if (tens === 0) return '初' + ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'][ones];
  if (tens === 1) return '十' + (ones ? ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'][ones] : '');
  if (tens === 2) return '廿' + (ones ? ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'][ones] : '');
  return '三十';
}
function formatDate(st) {
  const h = (st.timeH || 0);
  const day = Math.floor(h / HOURS_PER_DAY);
  const year = CAL_START.year + Math.floor(day / DAYS_PER_YEAR);
  const doy = ((day % DAYS_PER_YEAR) + DAYS_PER_YEAR) % DAYS_PER_YEAR;
  const month = Math.floor(doy / DAYS_PER_MONTH) + 1;
  const dom = doy % DAYS_PER_MONTH + 1;
  const shi = SHICHEN[Math.floor((h % HOURS_PER_DAY) / 2)];
  return `青云历${year}年${month}月${cnDay(dom)} ${shi}时`;
}
/* 时长格式化：小时 → "3日5时辰" / "17日" */
function fmtHours(hours) {
  if (hours <= 0) return '片刻';
  const d = Math.floor(hours / HOURS_PER_DAY);
  const rem = Math.round(hours - d * HOURS_PER_DAY);
  const shi = Math.floor(rem / 2);
  return (d ? `${d}日` : '') + (shi ? `${shi}时辰` : '') || `${Math.round(hours)}时辰`;
}
/* 解析 effects.time：支持 "3日"/"2时辰"/"半月"/"5年"/数字(天)/{hours|days|months|years} */
function parseTimeFx(t) {
  if (t == null) return 0;
  if (typeof t === 'number') return t * HOURS_PER_DAY; // 数字视为天数
  if (typeof t === 'object') {
    return (t.hours || 0) + (t.days || 0) * 24 + (t.months || 0) * DAYS_PER_MONTH * 24 + (t.years || 0) * DAYS_PER_YEAR * 24;
  }
  if (typeof t === 'string') {
    let total = 0;
    for (const m of t.matchAll(/(\d+)\s*(时辰|时|日|天|月|年)/g)) {
      const n = parseInt(m[1]);
      if (m[2] === '时辰' || m[2] === '时') total += n * 2;
      else if (m[2] === '日' || m[2] === '天') total += n * 24;
      else if (m[2] === '月') total += n * DAYS_PER_MONTH * 24;
      else if (m[2] === '年') total += n * DAYS_PER_YEAR * 24;
    }
    if (/半月/.test(t)) total += 15 * 24;
    if (/半年/.test(t)) total += DAYS_PER_YEAR / 2 * 24;
    return total;
  }
  return 0;
}
/* 时间流逝：加时钟、自动扣寿元增年龄 */
function applyTime(s, hours) {
  if (!hours || hours <= 0) return 0;
  s.timeH = (s.timeH || 0) + hours;
  const years = hours / (DAYS_PER_YEAR * HOURS_PER_DAY);
  s.attrs.age += years;
  s.attrs.lifespan -= years;
  return years;
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

/* 天命赐名：生成有真实感的修士名（姓氏 + 单/双字名） */
const SURNAMES = ['楚', '苏', '沈', '顾', '萧', '叶', '秦', '陆', '江', '白', '柳', '谢', '唐', '韩', '裴', '温', '洛', '云', '慕容', '上官', '百里', '南宫', '公孙', '宁', '霍', '程', '虞', '卫', '纪', '季'];
const GIVEN_ONE = ['玄', '尘', '渊', '澈', '清', '岚', '霄', '衡', '临', '微', '昭', '暮', '砚', '栖', '寒', '衍', '初', '远', '青', '问', '书', '庭', '辞', '离', '照', '空', '野', '白', '墨', '秋'];
const GIVEN_TWO_A = ['长', '清', '问', '书', '云', '天', '砚', '之', '若', '无', '临', '南', '明', '照', '风', '雪', '山', '晚', '半', '一'];
const GIVEN_TWO_B = ['歌', '尘', '雪', '风', '云', '月', '尘', '舟', '墨', '涯', '远', '归', '深', '眠', '行', '溪', '屏', '故', '白', '秋'];
function generateName() {
  const s = pick(SURNAMES);
  return Math.random() < 0.45 ? s + pick(GIVEN_ONE) : s + pick(GIVEN_TWO_A) + pick(GIVEN_TWO_B);
}

/* 灵根：权重抽卡 */
function rollRoots() {
  const r = Math.random() * 100;
  const elements = [...ELEMENTS].sort(() => Math.random() - 0.5);
  let quality, list;
  if (r < 4) { quality = '天灵根'; list = [pick(ELEMENTS) + '灵根']; }
  else if (r < 10) { quality = '变异灵根'; list = [pick(MUTANTS) + '灵根']; }
  else if (r < 28) { quality = '双灵根'; list = [elements[0] + '灵根', elements[1] + '灵根']; }
  else if (r < 63) { quality = '三灵根'; list = [elements[0] + '灵根', elements[1] + '灵根', elements[2] + '灵根']; }
  else if (r < 90) { quality = '四灵根'; list = elements.slice(0, 4).map(e => e + '灵根'); }
  else { quality = '杂灵根'; list = [elements[0] + '灵根']; }
  return { quality, list };
}

function newState(name = '无名散修', traits = {}) {
  const roll = (traits.roots && traits.roots.quality && Array.isArray(traits.roots.list) && traits.roots.list.length)
    ? traits.roots // 建号选定的灵根（否则重新掷定）
    : rollRoots();
  return {
    version: 6,
    created: Date.now(),
    updated: Date.now(),
    turns: 0,
    dead: false,
    deathReason: null,
    reincarnations: 0,
    rngSeed: Math.floor(Math.random() * 0x7fffffff), // 天命种子：全档概率可复现、可审计
    timeH: CAL_START.hour, // 游戏内时钟：距青云历起点的时辰数（起点=三月廿三巳时）
    idle: null,    // 放置闭关：{startAt, durationMin}
    items: {},     // 物品图鉴：GM 通过 flags item_ 下发说明
    itemSeen: {},  // 剧情见闻：服务器从叙事自动摘录的物品原文 {name: {t, text}}
    npcs: {},      // 人物志：GM 通过 effects.npcs 登记 {name: {name, power, desc, firstTurn, turns}}
    npcSeen: {},   // 人物见闻：服务器从叙事自动摘录的句子 {name: [{t, text}]}
    memory: [],    // 长期记忆：GM 定期归档的剧情摘要 [{t, text}]
    hooks: [],     // 未了之事：伏笔/恩怨/承诺 [{id, text, turn, open}]
    quotes: [],    // 台词存档：服务器自动提取的引号内容 [{t, text}]
    beats: [],     // 剧情链：每回合 GM 输出的一句话摘要（脉络速览，最近 40 条）
    conditions: [], // 状态：中毒/内伤/煞气等 [{name, desc, turns, hpPerTurn, mpPerTurn}]，服务器每回合自动结算
    enemy: null,    // 战斗状态机：{name, realm, hp, maxHp, mp, atk, def}（战斗中由 GM 更新，快照可见）
    visited: {},    // 到访记录（地图数据源）：{地点: {area, firstTurn, lastTurn, count}}
    mapPos: { ...MAP_SKELETON }, // 舆图坐标：区域 → [x, y]
    scene: null,   // 当前场景锚点：{npcs, desc, mood}（GM 维护，保证场景连贯）
    turnSnaps: [], // 回合快照链：每回合核心状态（支持回滚）
    /* 角色底色：性别/出身/性格/禀赋（建号选定，影响发展底色） */
    gender: traits.gender === 'female' ? 'female' : 'male',
    origin: traits.origin || null,
    personality: traits.personality || null,
    talent: traits.talent || null,
    name,
    realm: { stage: '炼气', level: 1 },
    roots: roll,
    attrs: {
      hp: 100, max_hp: 100,
      mp: 60, max_mp: 60,
      attack: 6, defense: 3, agility: 2, insight: 6,
      luck: 3 + Math.floor(Math.random() * 5),
      age: 16, lifespan: LIFESPAN['炼气'],
    },
    exp: 0,
    spirit_stones: 30,
    gold: 5,
    techniques: [],
    equipment: { weapon: '旧木剑', armor: '粗布衣', accessory: null },
    inventory: { '干粮': 3, '止血草': 2 },
    location: { name: '青云镇·南街', area: '青云镇' },
    explored: ['青云镇'],
    world: { flags: {} },
    quests: [],
    history: [],   // GM 上下文（最近 N 回合，服务器截断）
    log: [],       // 完整人生记录 {t, u, a}（导出/回档依据）
    chronicle: [], // 大事记 [{t, text}]
  };
}

/* 载入/导入存档时规范化，兼容旧版本 */
function normalizeState(s) {
  if (!s || typeof s !== 'object') return null;
  s.version = 5;
  s.updated = s.updated || Date.now();
  s.turns = s.turns || 0;
  s.reincarnations = s.reincarnations || 0;
  s.rngSeed = s.rngSeed != null ? s.rngSeed : Math.floor(Math.random() * 0x7fffffff);
  s.timeH = s.timeH != null ? s.timeH : CAL_START.hour;
  s.idle = s.idle && s.idle.startAt ? s.idle : null;
  s.givenName = !!s.givenName;
  s.items = s.items || {};
  s.itemSeen = s.itemSeen || {};
  s.npcs = s.npcs || {};
  s.npcSeen = s.npcSeen || {};

  /* 旧档迁移：从世界记事（npc_ 前缀）恢复人物档案，并从历史日志提取见闻 */
  if (s.world && s.world.flags) {
    const NOT_PEOPLE = new Set(['身世', 'shenshi', '自己', '主角', '玩家']);
    const entries = Object.entries(s.world.flags).filter(([k]) => k.startsWith('npc_'));
    /* 第一遍：主条目（纯名字无后缀） */
    for (const [k, v] of entries) {
      const raw = k.slice(4);
      const base = raw.split('_')[0];
      if (!base || NOT_PEOPLE.has(base) || raw !== base) continue;
      if (!s.npcs[base]) s.npcs[base] = { name: base, power: '', desc: String(v).slice(0, 500), firstTurn: 1, turns: [1] };
    }
    /* 第二遍：附属状态键并入主人物 desc */
    for (const [k, v] of entries) {
      const raw = k.slice(4);
      const base = raw.split('_')[0];
      if (!base || NOT_PEOPLE.has(base) || raw === base) continue;
      const add = `${raw.split('_').slice(1).join('_')}：${v}`;
      if (s.npcs[base]) {
        if (!s.npcs[base].desc.includes(add)) s.npcs[base].desc = `${s.npcs[base].desc}；${add}`.slice(0, 2000);
      } else {
        s.npcs[base] = { name: base, power: '', desc: String(add).slice(0, 500), firstTurn: 1, turns: [1] };
      }
    }
    /* 第三遍：从历史日志提取每人见闻（最多 3 条） */
    if (Array.isArray(s.log)) {
      for (const name of Object.keys(s.npcs)) {
        if (s.npcSeen[name] && s.npcSeen[name].length) continue;
        const hits = [];
        for (const l of s.log) {
          if (hits.length >= 3) break;
          const sent = extractItemSentence(l.a, name);
          if (sent) hits.push({ t: l.t, text: sent });
        }
        if (hits.length) s.npcSeen[name] = hits;
      }
    }
  }
  s.memory = Array.isArray(s.memory) ? s.memory.slice(-25) : [];
  s.beats = Array.isArray(s.beats) ? s.beats.slice(-40) : [];
  s.conditions = Array.isArray(s.conditions) ? s.conditions.filter(c => c && c.name && (c.turns || 0) > 0).slice(-10) : [];
  s.enemy = s.enemy && s.enemy.name ? s.enemy : null;
  s.visited = s.visited || {};
  s.mapPos = { ...MAP_SKELETON, ...(s.mapPos || {}) };
  if (!Object.keys(s.visited).length && s.location && s.location.name) {
    s.visited[s.location.name] = { area: s.location.area || '未知', firstTurn: 1, lastTurn: s.turns || 1, count: 1 }; // 旧档迁移：当前位置入舆图
  }
  s.hooks = Array.isArray(s.hooks) ? s.hooks.filter(h => h && h.open !== false).slice(-20) : [];
  s.quotes = Array.isArray(s.quotes) ? s.quotes.slice(-200) : [];
  s.scene = s.scene && (s.scene.desc || (s.scene.npcs && s.scene.npcs.length)) ? { npcs: s.scene.npcs || [], desc: s.scene.desc || '', mood: s.scene.mood || '' } : null;
  s.gender = s.gender === 'female' ? 'female' : 'male';
  s.origin = s.origin || null;
  s.personality = s.personality || null;
  s.talent = s.talent || null;
  s.turnSnaps = Array.isArray(s.turnSnaps) ? s.turnSnaps.slice(-TURN_SNAP_MAX) : [];
  s.history = Array.isArray(s.history) ? s.history : [];
  s.log = Array.isArray(s.log) ? s.log.slice(-10000) : []; // 剧情永久保留
  s.chronicle = Array.isArray(s.chronicle) ? s.chronicle.slice(-300) : [];
  s.world = s.world || { flags: {} };
  s.quests = s.quests || [];
  s.techniques = s.techniques || [];
  s.explored = s.explored || ['青云镇'];
  s.roots = s.roots || { quality: '三灵根', list: ['火灵根'] };
  s.attrs = { ...{ hp: 100, max_hp: 100, mp: 60, max_mp: 60, attack: 6, defense: 3, agility: 2, insight: 6, luck: 3, age: 16, lifespan: 150 }, ...(s.attrs || {}) };
  s.equipment = { weapon: null, armor: null, accessory: null, ...(s.equipment || {}) };
  s.inventory = s.inventory || {};
  s.location = s.location || { name: '青云镇·南街', area: '青云镇' };
  return s;
}

function expNeed(s) { return EXP_NEED[s.realm.stage] || 100; }
function realmText(s) { return stageLabel(s.realm); }

/* ---------- effects 规范化：宽容接收 GM 的各种手滑 ---------- */
function asArray(x) {
  if (x == null) return [];
  if (Array.isArray(x)) return x;
  if (typeof x === 'string') return [x];
  return [x];
}
function asCountMap(x) {
  if (x == null) return {};
  if (Array.isArray(x)) { const m = {}; x.forEach(n => { m[n] = (m[n] || 0) + 1; }); return m; }
  if (typeof x === 'string') return { [x]: 1 };
  if (typeof x === 'object') return { ...x };
  return {};
}
function num(v) { const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) ? n : 0; }
function addToInv(inv, map) { Object.entries(map).forEach(([k, c]) => { if (c !== 0) inv[k] = (inv[k] || 0) + c; }); }
function removeFromInv(inv, map) {
  Object.entries(map).forEach(([k, c]) => {
    inv[k] = Math.max(0, (inv[k] || 0) - c);
    if (inv[k] === 0) delete inv[k];
  });
}

/* 物品引用解析：兼容 GM 把数量写进物品名（"烈焰符×3"→烈焰符+3），修复「失去 烈焰符×3×1」式格式污染 */
function parseItemRefs(map) {
  const out = {};
  for (const [k, c] of Object.entries(map)) {
    const m = k.match(/^(.*?)[×xX](\d+)$/);
    if (m && m[1].trim()) out[m[1].trim()] = (out[m[1].trim()] || 0) + (c || 1) * parseInt(m[2], 10);
    else out[k] = (out[k] || 0) + (c || 1);
  }
  return out;
}

/* ---------- 核心：应用一回合 effects，产出系统事件 ---------- */
function applyEffects(s, fx) {
  const events = [];
  if (!fx || typeof fx !== 'object') return events;
  const a = s.attrs;

  /* 数值增量（修为先行：先累积再判定突破，支持 GM 同回合"修炼+突破"连写） */
  const numMap = { hp: 'hp', mp: 'mp', max_hp: 'max_hp', max_mp: 'max_mp', exp: 'exp', spirit_stones: 'spirit_stones', gold: 'gold', attack: 'attack', defense: 'defense', agility: 'agility', insight: 'insight', luck: 'luck', age: 'age', lifespan: 'lifespan' };
  for (const [k, v] of Object.entries(numMap)) {
    const d = num(fx[k]);
    if (d === 0) continue;
    if (k === 'exp') {
      s.exp = Math.max(0, s.exp + d);
      events.push({ t: 'exp', text: `修为 ${d > 0 ? '+' : ''}${d}` });
      /* 修为硬门槛：封顶于当前境界所需值，未突破不累积（稳扎稳打） */
      const cap = expNeed(s);
      if (s.exp > cap) {
        s.exp = cap;
        events.push({ t: 'system', text: '修为已至圆满，非突破不能再进' });
      }
    }
    else if (k === 'spirit_stones') { s.spirit_stones = Math.max(0, s.spirit_stones + d); events.push({ t: d > 0 ? 'gain' : 'lose', text: `${d > 0 ? '灵石 +' : '灵石 '}${d}` }); }
    else if (k === 'gold') { s.gold = Math.max(0, s.gold + d); events.push({ t: d > 0 ? 'gain' : 'lose', text: `${d > 0 ? '银两 +' : '银两 '}${d}` }); }
    else if (k === 'hp') { events.push({ t: d < 0 ? 'damage' : 'heal', text: `气血 ${d > 0 ? '+' : ''}${d}` }); a.hp += d; }
    else if (k === 'mp') { events.push({ t: d < 0 ? 'drain' : 'restore', text: `灵力 ${d > 0 ? '+' : ''}${d}` }); a.mp += d; }
    else if (k === 'max_hp' || k === 'max_mp') { a[k] += d; events.push({ t: 'system', text: `${k === 'max_hp' ? '气血上限' : '灵力上限'} ${d > 0 ? '+' : ''}${d}` }); }
    else if (k === 'age' || k === 'lifespan') { a[k] += d; events.push({ t: 'system', text: d < 0 ? `寿元流逝 ${-d} 年` : `寿元 +${d} 年` }); }
    else { a[k] += d; events.push({ t: 'system', text: `${k} ${d > 0 ? '+' : ''}${d}` }); }
  }
  if (fx.lifespan_set != null) { a.lifespan = Math.max(1, num(fx.lifespan_set)); }

  /* 境界变化（只升不降）：修为达标是服务器强制的硬门槛，机缘与丹药不能越过 */
  if (fx.realm && fx.realm.stage && LIFESPAN[fx.realm.stage] !== undefined) {
    const stage = fx.realm.stage;
    const level = Math.max(1, num(fx.realm.level) || 1);
    const need = expNeed(s); // 当前境界每小层所需修为
    const before = realmText(s);
    const isSameStage = stage === s.realm.stage;
    if (!isSameStage && s.exp < need) {
      events.push({ t: 'system', text: `突破未果：修为不足（${Math.floor(s.exp)}/${need}），契机稍纵即逝` });
    } else if (isSameStage && level <= s.realm.level) {
      events.push({ t: 'system', text: `晋阶未成：境界不可倒退` });
    } else if (s.exp < need) {
      events.push({ t: 'system', text: `晋阶未果：修为不足（${Math.floor(s.exp)}/${need}），还需打磨` });
    } else {
      s.realm = { stage, level: Math.min(level, stage === '炼气' ? 12 : 4) };
      if (LIFESPAN[stage] > a.lifespan) a.lifespan = LIFESPAN[stage];
      s.exp = 0; // 突破消耗全部修为，从零再修
      events.push({ t: 'realm', text: `突破！${realmText(s)}` });
    }
  }

  /* 时间流逝：GM 声明闭关/赶路/炼丹耗时，服务器扣寿元增年龄 */
  if (fx.time != null) {
    let hours = parseTimeFx(fx.time);
    if (hours > MAX_TIME_PER_TURN) {
      events.push({ t: 'system', text: `时间流逝超限，截断为一年` });
      hours = MAX_TIME_PER_TURN;
    }
    if (hours > 0) {
      applyTime(s, hours);
      events.push({ t: 'time', text: `时光流逝：${fmtHours(hours)}` });
    }
  }

  /* 背包增减（先解析 ×N 格式，兼容 GM 手滑） */
  const addM = parseItemRefs(asCountMap(fx.inventory_add));
  addToInv(s.inventory, addM);
  Object.entries(addM).forEach(([k, c]) => events.push({ t: 'gain', text: `获得 ${k}×${c}` }));

  const rmM = parseItemRefs(asCountMap(fx.inventory_remove));
  removeFromInv(s.inventory, rmM);
  Object.entries(rmM).forEach(([k, c]) => events.push({ t: 'lose', text: `失去 ${k}×${c}` }));

  /* 装备与卸下 */
  if (fx.equip && typeof fx.equip === 'object') {
    for (const [slot, item] of Object.entries(fx.equip)) {
      if (!EQUIP_SLOTS.includes(slot)) continue;
      if ((s.inventory[item] || 0) > 0) {
        const old = s.equipment[slot];
        removeFromInv(s.inventory, { [item]: 1 });
        if (old) addToInv(s.inventory, { [old]: 1 });
        s.equipment[slot] = item;
        events.push({ t: 'system', text: `装备 ${SLOT_NAMES[slot]}：${item}` });
      }
    }
  }
  if (fx.unequip) {
    for (const slot of asArray(fx.unequip)) {
      if (!EQUIP_SLOTS.includes(slot)) continue;
      const item = s.equipment[slot];
      if (item) { s.equipment[slot] = null; addToInv(s.inventory, { [item]: 1 }); events.push({ t: 'system', text: `卸下 ${item}` }); }
    }
  }

  /* 功法 */
  if (fx.techniques_add) {
    for (const t of asArray(fx.techniques_add)) {
      if (!t || !t.name) continue;
      if (!s.techniques.some(x => x.name === t.name)) {
        s.techniques.push({ name: t.name, tier: t.tier || '黄阶', type: t.type || '修炼', desc: t.desc || '' });
        events.push({ t: 'tech', text: `习得功法：${t.name}（${t.tier || '黄阶'}·${t.type || '修炼'}）` });
      }
    }
  }

  /* 任务：重要剧情/奇遇以任务形式展示；完成即从列表清除，载入大事件表 */
  if (fx.quests) {
    s.chronicle = s.chronicle || [];
    for (const q of asArray(fx.quests)) {
      if (!q || !q.title) continue;
      const kind = ['主线', '奇遇', '委托', '悬赏', '恩怨', '秘闻'].includes(q.kind) ? q.kind : (q.kind || '委托');
      const exist = s.quests.find(x => x.title === q.title);
      if (exist) {
        if (q.status === 'done' || exist.status === 'done') {
          s.quests = s.quests.filter(x => x !== exist); // 及时清除
          s.chronicle.push({ t: s.turns + 1, text: `✓ 任务达成：${exist.title}${exist.desc ? `（${exist.desc}）` : ''}`, kind: 'quest' });
          events.push({ t: 'quest', text: `任务达成：${exist.title} · 已载入大事件` });
        } else {
          exist.desc = q.desc || exist.desc;
          exist.kind = q.kind || exist.kind || '委托';
        }
      } else if (q.status === 'done') {
        // GM 直接宣告完成：不占列表，直接入大事件
        s.chronicle.push({ t: s.turns + 1, text: `✓ 任务达成：${q.title}${q.desc ? `（${q.desc}）` : ''}`, kind: 'quest' });
        events.push({ t: 'quest', text: `任务达成：${q.title} · 已载入大事件` });
      } else {
        s.quests.push({ title: q.title, desc: q.desc || '', status: 'active', kind });
        events.push({ t: 'quest', text: `【${kind}】新任务：${q.title}` });
      }
    }
    if (s.chronicle.length > 300) s.chronicle = s.chronicle.slice(-300);
  }

  /* 世界记事（item_ 前缀存入物品图鉴，供前端悬浮说明） */
  if (fx.flags && typeof fx.flags === 'object') {
    s.items = s.items || {};
    for (const [k, v] of Object.entries(fx.flags)) {
      if (k.startsWith('item_')) s.items[k.slice(5)] = String(v).slice(0, 80);
      else s.world.flags[k] = v;
    }
  }

  /* 长期记忆归档（GM 每 8~12 回合输出一段值得铭记的剧情摘要） */
  if (fx.memory != null) {
    const items = Array.isArray(fx.memory) ? fx.memory : [fx.memory];
    for (const it of items) {
      const text = String(it && typeof it === 'object' ? it.text : it).trim().slice(0, 120);
      if (text) {
        s.memory.push({ t: s.turns + 1, text });
        events.push({ t: 'system', text: '（记忆归档）' });
      }
    }
    if (s.memory.length > 25) s.memory = s.memory.slice(-25);
  }

  /* 状态增减：中毒/内伤/煞气等（服务器每回合自动结算 hpPerTurn/mpPerTurn） */
  if (fx.conditions != null) {
    s.conditions = s.conditions || [];
    for (const c of Array.isArray(fx.conditions) ? fx.conditions : [fx.conditions]) {
      if (!c || !c.name) continue;
      if (c.action === 'remove' || c.turns === 0) {
        const idx = s.conditions.findIndex(x => x.name === c.name);
        if (idx >= 0) { s.conditions.splice(idx, 1); events.push({ t: 'heal', text: `${c.name}解除` }); }
        continue;
      }
      const exist = s.conditions.find(x => x.name === c.name);
      if (exist) {
        exist.turns = Math.max(exist.turns, num(c.turns) || 1);
        if (c.desc) exist.desc = String(c.desc).slice(0, 60);
        if (c.hpPerTurn != null) exist.hpPerTurn = num(c.hpPerTurn);
        if (c.mpPerTurn != null) exist.mpPerTurn = num(c.mpPerTurn);
        events.push({ t: 'system', text: `${c.name}持续（剩${exist.turns}回合）` });
      } else {
        s.conditions.push({
          name: String(c.name).slice(0, 20),
          desc: String(c.desc || '').slice(0, 60),
          turns: Math.max(1, num(c.turns) || 1),
          hpPerTurn: num(c.hpPerTurn),
          mpPerTurn: num(c.mpPerTurn),
        });
        events.push({ t: 'system', text: `身中${c.name}${c.turns ? `（${c.turns}回合）` : ''}` });
      }
    }
  }

  /* 战斗状态机：敌人属性更新（快照展示，玩家可见敌我差距） */
  if (fx.enemy != null) {
    const e = typeof fx.enemy === 'string' ? { name: fx.enemy } : fx.enemy;
    const cur = s.enemy || {};
    const name = e && (e.name || cur.name);
    if (!name) { s.enemy = null; }
    else {
      s.enemy = {
        name: String(name).slice(0, 20),
        realm: String(e.realm || cur.realm || '未知').slice(0, 20),
        hp: num(e.hp ?? cur.hp),
        maxHp: num(e.maxHp ?? cur.maxHp ?? (e.hp ?? 0)),
        mp: num(e.mp ?? cur.mp ?? 0),
        atk: num(e.atk ?? cur.atk ?? 0),
        def: num(e.def ?? cur.def ?? 0),
        desc: String(e.desc || cur.desc || '').slice(0, 60),
      };
      if (s.enemy.hp <= 0) { events.push({ t: 'gain', text: `${s.enemy.name}已败亡` }); s.enemy = null; }
      else events.push({ t: 'system', text: `战况：${s.enemy.name}（${s.enemy.realm}）气血 ${s.enemy.hp}/${s.enemy.maxHp}` });
    }
  }

  /* 剧情链：本回合一句话摘要（GM 输出 beat，供速览脉络与衔接） */
  if (fx.beat != null) {
    const text = String(fx.beat).trim().slice(0, 60);
    if (text) {
      s.beats = s.beats || [];
      s.beats.push({ t: s.turns + 1, text });
      if (s.beats.length > 40) s.beats = s.beats.slice(-40);
    }
  }

  /* 场景锚点：GM 维护当前场景（在场 NPC/环境描述/气氛），快照展示保证连贯 */
  if (fx.scene != null) {
    const sc = typeof fx.scene === 'string' ? { desc: fx.scene } : (fx.scene || {});
    s.scene = {
      npcs: Array.isArray(sc.npcs) ? sc.npcs.map(n => String(n).slice(0, 20)).slice(0, 8) : ((s.scene && s.scene.npcs) || []),
      desc: String(sc.desc || '').slice(0, 100),
      mood: String(sc.mood || '').slice(0, 40),
    };
  }

  /* 人物登记：NPC 登场/情报更新（人物志数据源） */
  if (fx.npcs != null) {
    s.npcs = s.npcs || {};
    for (const p of Array.isArray(fx.npcs) ? fx.npcs : [fx.npcs]) {
      if (!p || !p.name) continue;
      const old = s.npcs[p.name];
      const entry = {
        name: p.name,
        power: String(p.power || (old && old.power) || '').slice(0, 60),
        desc: String(p.desc || (old && old.desc) || '').slice(0, 200),
        firstTurn: old ? old.firstTurn : s.turns + 1,
        turns: old ? [...(old.turns || []).slice(-49), s.turns + 1] : [s.turns + 1],
      };
      s.npcs[p.name] = entry;
      events.push({ t: 'quest', text: `识得人物：${p.name}${entry.power ? `（${entry.power}）` : ''}` });
    }
  }

  /* 未了之事：伏笔/恩怨/承诺的登记与回收 */
  if (fx.hooks != null) {
    s.hooks = s.hooks || [];
    for (const h of Array.isArray(fx.hooks) ? fx.hooks : [fx.hooks]) {
      if (!h || !h.text) continue;
      if (h.action === 'close') {
        const idx = s.hooks.findIndex(x => (h.id && x.id === h.id) || (h.text && x.text === h.text));
        if (idx >= 0) {
          const [closed] = s.hooks.splice(idx, 1);
          events.push({ t: 'quest', text: `（了结）${closed.text}` });
        }
        continue;
      }
      if (s.hooks.length >= 12) continue;
      if (s.hooks.some(x => x.text === h.text)) continue;
      s.hooks.push({ id: `h${s.turns + 1}-${s.hooks.length}`, text: String(h.text).slice(0, 60), turn: s.turns + 1, open: true });
      events.push({ t: 'quest', text: `（未了之事）${h.text}` });
    }
  }

  /* 移动与探索（map_add 支持带坐标：{"name":"黑风谷","x":620,"y":250}） */
  if (fx.location && fx.location.name) {
    s.location = { name: fx.location.name, area: fx.location.area || s.location.area };
  }
  if (fx.map_add) {
    s.mapPos = s.mapPos || {};
    for (const area of asArray(fx.map_add)) {
      if (!area) continue;
      const name = typeof area === 'string' ? area : area.name;
      if (!name) continue;
      if (!s.explored.includes(name)) {
        s.explored.push(name);
        events.push({ t: 'map', text: `探索新区域：${name}` });
      }
      if (s.mapPos[name] === undefined) {
        if (typeof area === 'object' && Number.isFinite(area.x) && Number.isFinite(area.y)) s.mapPos[name] = [area.x, area.y];
        else s.mapPos[name] = autoMapPos();
      }
    }
  }
  if (fx.map_pos) {
    s.mapPos = s.mapPos || {};
    for (const p of asArray(fx.map_pos)) {
      if (p && p.name && Number.isFinite(p.x) && Number.isFinite(p.y)) s.mapPos[p.name] = [p.x, p.y];
    }
  }

  /* 收敛与生死 */
  a.hp = Math.max(0, Math.min(a.max_hp, Math.round(a.hp)));
  a.mp = Math.max(0, Math.min(a.max_mp, Math.round(a.mp)));
  s.spirit_stones = Math.max(0, Math.round(s.spirit_stones));
  s.gold = Math.max(0, Math.round(s.gold));
  s.exp = Math.max(0, Math.round(s.exp));

  if (a.hp <= 0) {
    s.dead = true;
    s.deathReason = s.deathReason || '命陨苍玄界';
    events.push({ t: 'death', text: '你倒下了……' });
  } else if (a.lifespan <= 0) {
    s.dead = true;
    a.lifespan = 0;
    s.deathReason = s.deathReason || '寿元耗尽，于静室中坐化——一世修行，终归尘土。';
    events.push({ t: 'death', text: '寿元耗尽，坐化而终……' });
  }

  /* 大事记：值得铭记的时刻写入生平 */
  s.chronicle = s.chronicle || [];
  for (const e of events) {
    if (['realm', 'death', 'map', 'tech', 'quest'].includes(e.t)) {
      s.chronicle.push({ t: s.turns + 1, text: e.text });
    }
  }
  if (s.chronicle.length > 300) s.chronicle = s.chronicle.slice(-300);
  return events;
}

/* ---------- 复活 / 轮回 ---------- */
function revive(s) {
  s.dead = false;
  s.deathReason = null;
  s.attrs.hp = Math.round(s.attrs.max_hp * 0.6);
  s.attrs.mp = Math.round(s.attrs.max_mp * 0.5);
  const lost = Math.floor(s.spirit_stones * 0.1);
  s.spirit_stones -= lost;
  return `你在一阵剧烈的咳嗽中醒来——六成气血恢复，灵府空空，腰间的灵石袋也轻了（损失 ${lost} 灵石）。`;
}

function reincarnate(old) {
  const next = newState(old.name);
  next.reincarnations = (old.reincarnations || 0) + 1;
  next.attrs.luck = Math.min(9, next.attrs.luck + 1);
  let tech = null;
  if (old.techniques && old.techniques.length) {
    tech = old.techniques[Math.floor(Math.random() * old.techniques.length)];
    next.techniques = [tech];
  }
  return { next, tech };
}

/* ---------- 天命骰：存档种子 + 回合数 → 确定性结果（可复现、可审计） ---------- */
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function fateRolls(st) {
  const rng = mulberry32((st.rngSeed + (st.turns + 1) * 7919) >>> 0);
  const d = () => Math.max(1, Math.min(100, Math.round(rng() * 100)));
  return {
    fate: Math.max(1, Math.min(100, d() + (st.attrs.luck - 3) * 3)), // 机缘受福缘修正
    danger: d(),
    chance: d(),
  };
}

/* ---------- 数值保险丝：GM 越界即截断并记录（品控第二道闸） ---------- */
const EXP_CAP = { 炼气: 180, 筑基: 1500, 金丹: 12000, 元婴: 75000, 化神: 375000, 炼虚: 1800000, 合体: 9000000, 大乘: 45000000, 渡劫: 0 };
function applyFuses(st, fx, warnings) {
  if (!fx || typeof fx !== 'object') return fx;
  const capExp = Math.max(100, EXP_CAP[st.realm.stage] || 150);
  if (fx.exp > capExp) { warnings.push(`经验超限 ${fx.exp}→${capExp}`); fx.exp = capExp; }
  if (fx.spirit_stones > 500) { warnings.push(`灵石超限 ${fx.spirit_stones}→500`); fx.spirit_stones = 500; }
  if (fx.gold > 5000) { warnings.push(`银两超限 ${fx.gold}→5000`); fx.gold = 5000; }
  if (fx.inventory_add && typeof fx.inventory_add === 'object' && !Array.isArray(fx.inventory_add)) {
    for (const [k, v] of Object.entries(fx.inventory_add)) {
      if (v > 100) { warnings.push(`物品数量超限 ${k}:${v}→100`); fx.inventory_add[k] = 100; }
    }
    if (Object.keys(fx.inventory_add).length > 20) warnings.push('单回合物品种类超过20种');
  }
  if (Array.isArray(fx.techniques_add) && fx.techniques_add.length > 3) warnings.push('单回合功法超过3本');
  if (Array.isArray(fx.quests) && fx.quests.length > 3) warnings.push('单回合任务变更超过3条');
  return fx;
}

/* ---------- 放置闭关：1 真实分钟 = 2 游戏小时，离线照常结算 ---------- */
const IDLE_RATE = { 炼气: 1.2, 筑基: 4, 金丹: 12, 元婴: 40, 化神: 120, 炼虚: 400, 合体: 1200, 大乘: 4000 }; // 修为/真实分钟
const IDLE_CAP_MIN = { 炼气: 120, 筑基: 240, 金丹: 480, 元婴: 960, 化神: 1440, 炼虚: 2400, 合体: 4800, 大乘: 7200 }; // 有效挂机时长上限
const IDLE_MAX_MIN = 7 * 24 * 60; // 单次闭关最长 7 天真实时间

/* 结算挂机（幂等）：返回 {exp, hours, note} 或 null；已结算则清空 st.idle */
function settleIdle(st, now = Date.now()) {
  if (!st || !st.idle) return null;
  const elapsedMin = (now - st.idle.startAt) / 60000;
  const durMin = st.idle.durationMin || 0;
  const capMin = IDLE_CAP_MIN[st.realm.stage] || 120;
  const effMin = Math.max(0, Math.min(elapsedMin, durMin, capMin));
  const exp = Math.floor(effMin * (IDLE_RATE[st.realm.stage] || 1.2));
  const gameHours = Math.min(effMin * 2, durMin * 2, 365 * 24); // 1分钟=2游戏小时，单次最多流逝一年
  st.idle = null;
  return { exp, hours: gameHours, note: `你自闭关中苏醒：修为 +${exp}，时光已过 ${fmtHours(gameHours)}` };
}

/* ---------- 位置与时间：服务器的世界一致性守卫 ---------- */

/* 从叙事中提取"发生了物理移动"的地点（GM 忘了写 effects.location 时的校正依据） */
const MOVE_RE = /(?:来到|走进|进入|进了|抵达|到达|回到|赶回|赶往|前往|去了|离开|出了|踏进|跨进|返回|回了|赶到|赶往|赶赴)([\u4e00-\u9fa5A-Za-z0-9·—\-（）()]{2,14})/g;
const PLACE_SUFFIX = /(镇|城|山|谷|林|坊市|坊|宗|洞|宫|殿|峰|岭|泽|海|岛|村|驿|楼|阁|庙|观|窟|崖|渊|滩|溪|河|湖|潭|庄|寨|集|店|院|墓|塔|涧|坡|坳|栈|屋|馆|亭|台|港|市)$/;
function extractMoveLocations(narration) {
  const out = [];
  if (!narration) return out;
  const seen = new Set();
  for (const m of String(narration).matchAll(MOVE_RE)) {
    let loc = (m[1] || '').trim();
    loc = loc.split(/[，。！？；、\n]/)[0]; // 截断标点
    loc = loc.replace(/^(了|过|着|的)+/, ''); // 去助词：来到"了"黑风谷
    const segs = loc.split('的').filter(Boolean); // 取最后一个地点段：落霞森林"的"猎户小屋
    if (segs.length > 1) loc = segs[segs.length - 1];
    if (loc.length < 2) continue;
    if (/方向|远处|前方|背后|头顶|外面|里面|那边|这边/.test(loc)) continue;
    if (!PLACE_SUFFIX.test(loc) && !loc.endsWith('门')) continue;
    if (seen.has(loc)) continue;
    seen.add(loc);
    out.push(loc);
  }
  return out;
}

/* 按动作关键词推断本回合流逝的时辰数（GM 未写 effects.time 时的兜底） */
const TIME_INFER = [
  [/闭关|闭死关|冲击(金丹|元婴|化神|炼虚|合体|大乘)/, 24],
  [/赶路|启程|出发|前往|赶回|返回|离开|回(镇|城|家)|远行|赶赴/, 16],
  [/炼丹|炼器|制符|画符|布阵|炼药|锻造/, 8],
  [/睡觉|过夜|就寝|休整|歇息|养伤|疗伤|卧床|休养/, 6],
  [/打坐|运功|吐纳|调息|修炼|练功|悟道|参悟/, 4],
  [/战斗|攻击|猎杀|搏杀|缠斗|追杀|偷袭|斩杀|应战|斗法/, 2],
  [/采药|挖矿|砍柴|狩猎|搜索|搜寻|探索|查看四周|捡拾|采集|巡视/, 2],
  [/交谈|打听|询问|购买|出售|交易|讨价|对话|查看背包|查看状态|帮助/, 1],
];
function inferTimeFx(text) {
  const t = String(text || '');
  for (const [re, h] of TIME_INFER) if (re.test(t)) return h;
  return 1; // 其他行动默认 1 时辰
}
function getShichen(st) {
  return SHICHEN[Math.floor(((st.timeH || 0) % HOURS_PER_DAY) / 2)];
}

/* 台词自动提取：叙事中的引号内容存档，供 QA 与审计核对（"他说过什么"要对得上） */
const QUOTE_RE = /「([^「」]{2,80})」|“([^”]{2,80})”|"([^"]{2,80})"/g;
function extractQuotes(narration) {
  const out = [];
  if (!narration) return out;
  for (const m of String(narration).matchAll(QUOTE_RE)) {
    const text = (m[1] || m[2] || m[3] || '').trim();
    if (text.length >= 2) out.push(text.slice(0, 80));
  }
  return out;
}

/* 行囊对账：从叙事中提取"消耗了背包物品"的记录 [{item, times}]
 * 匹配明确的消耗动词（可跳过数量词"用掉一张烈焰符"）+ 背包中存在的物品名 */
const CONSUME_VERBS = '服用|服下|服食|吞下|吃下|吃掉|饮下|喝下|点燃|捏碎|掷出|抛出|撒出|敷上|抹上|涂上|喝尽|使用|用掉|用了|激发|催动|引燃|祭出|打出|放出|释放|催发|施展|动用';
const QTY_SKIP = '(?:[半一二两三四五六七八九十百千\\d]+[张枚颗粒瓶份株个把支卷])?';
function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function extractConsumes(narration, inventory) {
  const out = [];
  if (!narration || !inventory) return out;
  const text = String(narration);
  for (const item of Object.keys(inventory)) {
    const re = new RegExp(`(?:${CONSUME_VERBS})${QTY_SKIP}${escapeRe(item)}`, 'g');
    const m = text.match(re);
    if (m && m.length) out.push({ item, times: m.length });
  }
  return out;
}

/* 剧情见闻摘录：从叙事中提取提到某物品的句子（GM 未写 item_ 说明时的如实依据） */
function extractItemSentence(narration, itemName) {
  if (!narration || !itemName) return '';
  const text = String(narration);
  const sentences = text.split(/[。！？!?；;\n]+/);
  const hit = sentences.find(s => s.includes(itemName) && s.length > itemName.length + 1);
  if (!hit) return '';
  return hit.replace(/\*+/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

/* ---------- 回合快照链：每回合存核心状态，支持任意回滚（最近 300 回合） ---------- */
const TURN_SNAP_MAX = 300;
const CORE_FIELDS = ['name', 'gender', 'origin', 'personality', 'talent', 'realm', 'roots', 'attrs', 'exp', 'spirit_stones', 'gold', 'techniques', 'equipment', 'inventory', 'location', 'explored', 'items', 'itemSeen', 'npcs', 'npcSeen', 'quests', 'timeH', 'idle', 'givenName', 'reincarnations', 'dead', 'deathReason', 'world', 'scene', 'memory', 'hooks', 'quotes', 'beats', 'conditions', 'enemy', 'visited', 'mapPos'];
function snapCore(st) {
  const core = {};
  for (const k of CORE_FIELDS) {
    core[k] = st[k] === undefined ? undefined : JSON.parse(JSON.stringify(st[k]));
  }
  return core;
}
function pushTurnSnap(st) {
  st.turnSnaps = st.turnSnaps || [];
  st.turnSnaps = st.turnSnaps.filter(s => s.t !== st.turns); // 同回合覆盖（回滚后重玩）
  st.turnSnaps.push({ t: st.turns, core: snapCore(st) });
  if (st.turnSnaps.length > TURN_SNAP_MAX) st.turnSnaps = st.turnSnaps.slice(-TURN_SNAP_MAX);
}
/* 回滚到第 turn 回合（含）：恢复核心状态，其后剧情全部改写 */
function rollbackTo(st, turn) {
  const snap = (st.turnSnaps || []).find(s => s.t === turn);
  if (!snap) return null;
  Object.assign(st, JSON.parse(JSON.stringify(snap.core)));
  st.turns = turn;
  st.rngSeed = Math.floor(Math.random() * 0x7fffffff); // 逆天改命：命运重新洗牌
  st.log = (st.log || []).filter(l => l.t <= turn);
  st.history = st.log.slice(-30).map(l => ({ u: l.u, a: l.a }));
  st.chronicle = (st.chronicle || []).filter(c => (c.t || 0) <= turn);
  st.pendingQC = [];
  return st;
}

/* ---------- 存档安全视图（不下发历史，减小传输） ---------- */
function safeView(s) {
  const { history, ...rest } = s;
  return { ...rest, historyCount: history.length };
}

module.exports = { newState, normalizeState, applyEffects, revive, reincarnate, expNeed, realmText, safeView, asArray, fateRolls, applyFuses, formatDate, fmtHours, parseTimeFx, settleIdle, IDLE_MAX_MIN, stageLabel, extractMoveLocations, inferTimeFx, getShichen, extractQuotes, extractConsumes, generateName, extractItemSentence, parseItemRefs, pushTurnSnap, rollbackTo };
