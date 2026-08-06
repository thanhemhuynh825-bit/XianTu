'use strict';

/* ============================================================
 * 《仙途·苍玄界》— 前端逻辑
 * 状态渲染 / 回合交互 / 存档管理 / 死亡轮回
 * ============================================================ */

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const app = {
  slot: null, st: null, busy: false, cmdHist: [], histIdx: -1, lastAvailable: [], snapSlot: null, viewSlot: null,
};
let draft = null; // 历史浏览前的输入草稿（按【下】时恢复，绝不丢失输入）

const STATIC_CHIPS = ['查看四周', '打坐修炼', '闭关修炼', '查看背包', '查看状态', '帮助'];

/* ---------- 悬浮说明系统 ---------- */
/* 属性解释 */
const STAT_TIPS = {
  attack: '攻击：近身杀伤力。战斗中你的刀剑能造成多大伤害，装备与境界是主要来源。',
  defense: '防御：抵御伤害。皮糙肉厚者挨得住打，衣甲与护体功法可提升。',
  agility: '身法：决定先手与闪避。身法高者先出招、躲得快——脱身/逃跑时有效凶险 −身法×2，逃生大业全靠它。',
  insight: '悟性：决定修炼快慢。每点 +2% 修炼效率（打坐/闭关收益上浮），悟性高者顿悟机缘更多（机缘骰 +悟性/2）。',
  luck: '福缘：天命眷顾程度。每 3 点修正 1 点机缘骰，福缘高者奇遇更密、厄运更远。',
  spirit_stones: '灵石：修真界硬通货。购买丹药法宝、支付闭关洞府、悬赏报酬都用它。',
  gold: '银两：凡间货币。凡人集市上买干粮杂货、住店吃饭用的。',
  lifespan: '寿元：你的寿命，耗尽即坐化而终。突破境界可大幅延寿——时间才是修行最大的敌人。',
};
const BAR_TIPS = {
  hp: '气血：生命。归零即身死（可复活或轮回转世）。\n恢复：服用金创药/疗伤丹、睡觉休整、寻医救治。',
  mp: '灵力：施法、御器、护体之耗。耗尽则无力施法。\n恢复：打坐运功（最快）、服用回元丹、身处灵气充沛之地。',
  exp: '修为：当前境界的进度，达到所需值即圆满封顶，必须突破才能再进。\n获取：打坐、杀妖、历练、奇遇；突破需要修为圆满+突破丹药+心境机缘。',
};
/* 内置物品图鉴兜底（GM 下发的 item_ 说明优先） */
const ITEM_DICT = {
  '干粮': '粗粮做的干粮，充饥之物。长途跋涉必备。',
  '止血草': '常见灵草，碾碎外敷可止小伤之血。低阶修士的救命草。',
  '旧木剑': '凡品木剑，连铁器都不如，聊胜于无。',
  '粗布衣': '凡人所穿的粗布衣裳，遮体避寒而已。',
  '聚气丹': '炼气期修士常用丹药，服用可增修为。',
  '回元丹': '服用可回复灵力，战斗续航必备。',
  '金创药': '治疗外伤的药剂，可回复气血。',
  '筑基丹': '炼气圆满突破筑基的关键丹药，坊市有售，价格不菲。',
  '凝金丹': '筑基圆满突破金丹的关键丹药，极为珍贵。',
  '灵石': '天地灵气凝结的货币，也是修炼的辅助品。',
};

/* 客户端青云历（与服务器一致，仅展示用） */
const CN_D = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const SHI_CH = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
function fmtDate(timeH) {
  const h = timeH || 10;
  const day = Math.floor(h / 24);
  const year = 437 + Math.floor(day / 360);
  const doy = ((day % 360) + 360) % 360;
  const month = Math.floor(doy / 30) + 1;
  const dom = doy % 30 + 1;
  const dd = dom === 1 ? '初一' : dom === 10 ? '初十' : dom < 10 ? '初' + CN_D[dom] : dom < 20 ? '十' + CN_D[dom % 10] : dom < 30 ? '廿' + CN_D[dom % 10] : '三十';
  return `青云历${year}年${month}月${dd} ${SHI_CH[Math.floor((h % 24) / 2)]}时`;
}
function fmtRemain(ms) {
  const m = Math.max(0, Math.ceil(ms / 60000));
  if (m < 60) return `${m}分钟`;
  return `${Math.floor(m / 60)}时${m % 60}分`;
}

/* ---------- 工具 ---------- */
function stageLabel(r) {
  if (!r) return '未知';
  if (r.stage === '炼气') return `炼气${['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'][r.level - 1] || r.level}层`;
  return `${r.stage}${['初期', '中期', '后期', '圆满'][(r.level - 1) % 4] || ''}`;
}
function expNeed(s) {
  const m = { 炼气: 100, 筑基: 900, 金丹: 6000, 元婴: 40000, 化神: 200000, 炼虚: 1000000, 合体: 5000000, 大乘: 25000000 };
  return m[s.realm.stage] || 100;
}
async function api(path, body) {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res.json();
}

/* ---------- 引导与启动页 ---------- */
async function bootstrap() {
  try {
    const boot = await api('/api/bootstrap');
    if (!boot.ok) throw new Error('bootstrap failed');
    setConn(boot.configured ? 'ok' : 'bad', boot.configured ? `· 天道相连 · ${boot.model}` : '· 天道未连 · 需配置 API');
    window.__boot = boot;
    $('menu-ver').textContent = `v${boot.model ? '' : ''}${boot.model || ''} · 一路修行，仙途漫漫`;
    if (!boot.configured) { showModal('m-nokey'); return; }
    showMenu();
    loadMenuNews(); // 启动页江湖快讯
    /* 首次进入：启动页之上率先展示指引；之后不再自动弹出（上栏保留指引按钮） */
    if (!localStorage.getItem(GUIDE_KEY)) setTimeout(() => openGuide(true), 900);
  } catch {
    setConn('bad', '· 无法连接服务器');
    showModal('m-nokey');
  }
}

/* 启动页（主菜单）：开始游戏 / 设置 / 指引 */
function showMenu() { $('m-menu').classList.remove('hidden'); }
function hideMenu() {
  $('m-menu').classList.add('hidden');
  const imgs = document.querySelectorAll('#menu-bg .mb-img');
  imgs.forEach((im, i) => im.classList.toggle('active', i === 0));
}
let menuIdx = 0;
const menuImgs = document.querySelectorAll('#menu-bg .mb-img');
setInterval(() => {
  if ($('m-menu').classList.contains('hidden')) return;
  menuIdx = (menuIdx + 1) % menuImgs.length;
  menuImgs.forEach((im, i) => im.classList.toggle('active', i === menuIdx));
}, 9000);
$('btn-menu-start').addEventListener('click', () => { showSlots(); }); // 选存档后进入（隐藏启动页在进入时）
$('btn-menu-settings').addEventListener('click', () => { applySettings(); showModal('m-settings'); });
$('btn-menu-guide').addEventListener('click', () => openGuide(false));

/* 启动页江湖快讯：最近 3 档的世界动态 */
async function loadMenuNews() {
  const list = $('mn-list');
  try {
    const slot = Number(localStorage.getItem('xmx_slot')) || 1;
    const exp = await fetch('/api/export?slot=' + slot).then(r => r.json());
    if (exp.ok && exp.data && exp.data.news && exp.data.news.length) {
      const items = [...exp.data.news].slice(-3).reverse();
      list.innerHTML = items.map(n =>
        `<div class="mn-item"><span class="mn-k">${esc(n.kind)}</span>${esc(n.text)}<span class="mn-t">第${n.t}回</span></div>`).join('');
      return;
    }
  } catch { /* 无档或错误，用占位 */ }
  list.innerHTML = '<div class="mn-item" style="border-left-color:transparent">踏入苍玄界，亲历天下事。</div>';
}

function setConn(state, text) {
  const el = $('conn');
  el.className = 'conn ' + state;
  el.textContent = text;
}

/* ---------- 叙事渲染 ---------- */
function appendTurn(res) {
  const nav = document.getElementById('narrative-inner');
  const box = document.createElement('div');
  box.className = 'msg';

  if (res.title) {
    const t = document.createElement('div');
    t.className = 'scene-title';
    t.textContent = res.title;
    box.appendChild(t);
  }

  const paras = String(res.narration || '').split(/\n+/).map(p => p.trim()).filter(Boolean);
  for (const p of paras) {
    const d = document.createElement('div');
    d.className = 'para';
    d.innerHTML = esc(p).replace(/\*([^*]+)\*/g, '<span class="act">$1</span>');
    box.appendChild(d);
  }

  if (res.events && res.events.length) {
    const ev = document.createElement('div');
    ev.className = 'events';
    for (const e of res.events) {
      const d = document.createElement('div');
      d.className = 'evt ' + (['gain', 'lose', 'damage', 'heal', 'drain', 'restore', 'realm', 'tech', 'quest', 'map', 'exp', 'time', 'system', 'death'].includes(e.t) ? e.t : 'system');
      d.textContent = e.text;
      ev.appendChild(d);
    }
    box.appendChild(ev);
  }

  /* 回合回滚按钮（右下角，悬浮显现） */
  const turn = res && res.state ? res.state.turns : null;
  if (turn != null && turn >= 1) {
    const rb = document.createElement('span');
    rb.className = 'rollback-btn';
    rb.dataset.turn = turn;
    rb.title = `回滚到第 ${turn} 回合，此后剧情重新演绎`;
    rb.textContent = '⤺ 回滚';
    box.appendChild(rb);
  }

  nav.appendChild(box);
  nav.scrollTop = nav.scrollHeight;
}

function appendCommand(cmd) {
  const nav = document.getElementById('narrative-inner');
  const box = document.createElement('div');
  box.className = 'msg';
  const d = document.createElement('div');
  d.className = 'cmdline';
  d.textContent = cmd;
  box.appendChild(d);
  nav.appendChild(box);
}

function appendThinking() {
  const nav = document.getElementById('narrative-inner');
  const d = document.createElement('div');
  d.className = 'thinking';
  d.id = 'thinking';
  d.textContent = '… 因果正在推演，天道垂询中 …';
  nav.appendChild(d);
  nav.scrollTop = nav.scrollHeight;
}
function removeThinking() { const t = $('thinking'); if (t) t.remove(); }

/* ---------- 状态面板 ---------- */
function renderState(st) {
  app.st = st;
  const a = st.attrs;
  ensureTurnBadge();
  $('turn-badge').textContent = `第 ${st.turns} 回合 · ${fmtDate(st.timeH)} · ${esc(st.location.area)}`;
  $('c-avatar').src = 'avatars/' + (st.gender === 'female' ? 'female' : 'male') + '.webp';
  $('c-name').textContent = st.name + (st.reincarnations ? ` · 第${st.reincarnations + 1}世` : '');
  $('c-meta').textContent = `${stageLabel(st.realm)} · ${st.roots.quality} · 年${Math.round(a.age)}岁 · 寿元${Math.round(a.lifespan)}年`;
  /* 声名（侠名/恶名，世界对玩家的评价）+ 天劫将至徽标 */
  const fam = Math.round(st.fame || 0);
  const famEl = $('c-fame');
  if (fam === 0 && !st.tribulation) { famEl.innerHTML = ''; }
  else {
    const famTip = fam === 0
      ? '声名不显：江湖尚未记住你。行大善积侠名、犯大恶落恶名，世界会回应你的名声。'
      : fam > 0
        ? `侠名 +${fam}：江湖对你的赞誉。侠名高者正道示好、坊市让利、贵人相助；叙事会不时提及你的风评。`
        : `恶名 ${fam}：江湖对你的畏惧与唾弃。恶名高者人人忌惮、或被悬赏通缉、招致正道追杀。`;
    famEl.innerHTML = `<span class="fame-chip ${fam > 0 ? 'fame-good' : fam < 0 ? 'fame-bad' : ''}" data-tip="${esc(famTip)}">${fam > 0 ? '✦ 侠名 +' + fam : fam < 0 ? '☠ 恶名 ' + fam : '声名不显'}</span>${st.tribulation ? `<span class="trib-chip" data-tip="${esc('天劫将至：' + st.tribulation.stage + '道基将成，九天雷意已在酝酿。下一回合直面雷劫——法宝、丹药、功法、灵宠皆可为渡劫出力，成败看天命与准备。')}">⚡ 天劫将至</span>` : ''}`;
  }
  $('c-roots').textContent = `灵根：${st.roots.list.join('、')}`;
  /* 性格与禀赋（角色底色，出身不常驻展示） */
  $('c-dise').innerHTML = [
    st.personality ? `<span class="dise-chip" data-kind="personality" data-tip="${esc(st.personality.desc)}"><b>性</b>${esc(st.personality.name)}</span>` : '',
    st.talent ? `<span class="dise-chip" data-kind="talent" data-tip="${esc(st.talent.desc)}"><b>禀</b>${esc(st.talent.name)}</span>` : '',
  ].join('');

  setBar('hp', a.hp, a.max_hp, 't-hp', `${a.hp}/${a.max_hp}`);
  setBar('mp', a.mp, a.max_mp, 't-mp', `${a.mp}/${a.max_mp}`);
  setBar('exp', st.exp, expNeed(st), 't-exp', `${st.exp}/${expNeed(st)}`);

  $('c-stats').innerHTML = [
    ['attack', '攻', a.attack], ['defense', '防', a.defense], ['agility', '身', a.agility], ['insight', '悟', a.insight],
    ['luck', '福', a.luck], ['spirit_stones', '灵石', st.spirit_stones], ['gold', '银', st.gold], ['lifespan', '寿', Math.round(a.lifespan)],
  ].map(([k, lab, v]) => `<div class="stat" data-key="${k}" data-tip="${esc(STAT_TIPS[k])}"><div class="k">${lab}</div><div class="v">${v}</div></div>`).join('');

  /* 属性成长闪光：与上次对比，变化的属性短暂高亮 */
  if (app.lastAttrs) {
    for (const key of ['attack', 'defense', 'agility', 'insight', 'luck']) {
      const d = a[key] - (app.lastAttrs[key] || 0);
      if (d === 0) continue;
      const el = document.querySelector(`#c-stats .stat[data-key="${key}"]`);
      if (el) {
        el.classList.add(d > 0 ? 'flash-up' : 'flash-down');
        setTimeout(() => el.classList.remove('flash-up', 'flash-down'), 1300);
      }
    }
  }
  app.lastAttrs = { attack: a.attack, defense: a.defense, agility: a.agility, insight: a.insight, luck: a.luck };

  setBarTip('hp', BAR_TIPS.hp);
  setBarTip('mp', BAR_TIPS.mp);
  setBarTip('exp', BAR_TIPS.exp);

  /* 功法 */
  $('c-tech').innerHTML = st.techniques.length
    ? st.techniques.map(t => `<div class="tech-row" data-tip="${esc(`${t.name}（${t.tier}·${t.type}）\n${t.desc || '来历不明的功法。'}`)}"><span class="nm">${esc(t.name)}</span><span class="ti">${esc(t.tier)}·${esc(t.type)}</span><span class="de">${esc(t.desc || '')}</span></div>`).join('')
    : '<div class="empty">尚未习得功法</div>';

  /* 装备 */
  $('c-equip').innerHTML = [['weapon', '武器'], ['armor', '衣甲'], ['accessory', '佩饰']].map(([slot, name]) => {
    const item = st.equipment[slot];
    const tip = item ? itemTip(st, item) : `${name}位空缺。`;
    return `<div class="equip-row" data-tip="${esc(tip)}"><span class="sl">${name}</span>${item ? `<span class="nm">${esc(item)}</span>` : '<span class="nm" style="color:var(--ink-faint)">—</span>'}</div>`;
  }).join('');

  /* 行囊：可用之物清单（剧情中直接说"服用聚气丹"即可使用，行囊仅作提醒） */
  const entries = Object.entries(st.inventory || {}).sort((x, y) => x[0].localeCompare(y[0]));
  $('bag-count').textContent = entries.reduce((s, [, c]) => s + c, 0) + ' 件';
  $('c-bag').innerHTML = entries.length
    ? entries.map(([name, count]) =>
      `<div class="item" data-item="${esc(name)}" data-tip="${esc(itemTip(st, name) + '\n\n可用指令示例：服用' + name + ' / 装备' + name)}"><span class="nm">${esc(name)}</span><span class="ct">×${count}</span></div>`).join('')
    : '<div class="empty">囊中空空</div>';

  /* 位置与探索 */
  $('c-loc').textContent = st.location.name;
  $('c-area').textContent = st.location.area;
  $('c-explored').innerHTML = (st.explored || []).map(a => `<span class="tag">${esc(a)}</span>`).join('');

  /* 任务（重要剧情/奇遇以任务展示，完成即清除；限时任务显示倒计时） */
  const KIND_CLS = { 主线: 'kind-main', 奇遇: 'kind-fate', 委托: 'kind-quest', 悬赏: 'kind-bounty', 恩怨: 'kind-grudge', 秘闻: 'kind-secret' };
  $('c-quests').innerHTML = (st.quests && st.quests.length)
    ? st.quests.map(q => {
      const kc = KIND_CLS[q.kind] || 'kind-quest';
      let dl = '';
      if (q.deadlineH != null) {
        const remainH = q.deadlineH - st.timeH;
        const d = Math.floor(remainH / 24), s = Math.floor((remainH % 24) / 2);
        const warn = remainH <= 24 ? 'dl-urgent' : '';
        let dlTxt = '';
        if (remainH <= 0) dlTxt = '已过';
        else if (d > 0) dlTxt = d + '日' + (s > 0 ? s + '时辰' : '');
        else if (s > 0) dlTxt = s + '时辰';
        else dlTxt = '将尽';
        dl = `<span class="q-dl ${warn}" data-tip="${esc(`限时任务：${q.deadline}内完成，逾期即失。世界言而有信——错过就是错过。`)}">⏳ ${dlTxt}</span>`;
      }
      return `<div class="quest-row ${kc}"><span class="q-kind">${esc(q.kind || '委托')}</span><span class="q-t">${esc(q.title)}</span>${q.desc ? `<span class="q-d">${esc(q.desc)}</span>` : ''}${dl}</div>`;
    }).join('')
    : '<div class="empty">暂无因果缠身</div>';

  /* 未了之事（伏笔/恩怨/承诺） */
  $('c-hooks').innerHTML = (st.hooks && st.hooks.length)
    ? st.hooks.map(h => `<div class="quest-row" data-tip="${esc(`于第 ${h.turn} 回合结下。了结它，或让时间给它一个交代。`)}"><span class="q-t" style="color:var(--gold)">✧ ${esc(h.text)}</span><span class="q-d">第${h.turn}回</span></div>`).join('')
    : '<div class="empty">身无挂碍</div>';

  /* 身外之物（田产/铺面/官职/灵田/洞府……自由玩法的家业载体） */
  const HOLD_KIND = { 田产: 'var(--jade)', 铺面: 'var(--gold)', 官职: 'var(--cinnabar)', 灵田: 'var(--jade)', 洞府: 'var(--violet)', 矿脉: '#d9a96b' };
  $('c-holdings').innerHTML = (st.holdings && st.holdings.length)
    ? st.holdings.map(h => `<div class="quest-row" data-tip="${esc(`${h.desc || '你在苍玄界安身立命的产业。'}\n于第 ${h.since} 回合置办。`)}"><span class="q-t" style="color:${HOLD_KIND[h.kind] || 'var(--gold)'}">◈ ${esc(h.name)}</span><span class="q-d">${esc(h.kind)}</span></div>`).join('')
    : '<div class="empty">尚无产业，白手起家</div>';

  /* 灵宠栏（收服/结契/孵化后由 GM 登记，自动展示；旧档无灵宠显示空态） */
  const pets = Object.values(st.pets || {});
  $('pets-count').textContent = pets.length ? `${pets.length} 只` : '';
  $('c-pets').innerHTML = pets.length
    ? pets.map(p => `<div class="quest-row" data-tip="${esc(`${p.name}（${p.realm || '凡兽'}）\n${p.desc || '来历不明的灵兽，与你有缘。'}\n第 ${p.firstTurn} 回合结缘同游，战斗中可助攻（受新鲜感法则约束）。`)}"><span class="q-t" style="color:var(--jade)">✦ ${esc(p.name)}</span><span class="q-d">${esc(p.realm || '凡兽')}</span></div>`).join('')
    : '<div class="empty">尚未收服灵宠</div>';

  /* 身中状态（中毒/内伤等，服务器自动结算） */
  $('c-conds').innerHTML = (st.conditions && st.conditions.length)
    ? st.conditions.map(c => `<div class="quest-row" data-tip="${esc(`${c.desc || '持续中'} · 服务器每回合自动结算`)}"><span class="q-t" style="color:#e08a72">✚ ${esc(c.name)}</span><span class="q-d">剩${c.turns}回合${c.hpPerTurn ? `·每回气血${c.hpPerTurn}` : ''}${c.mpPerTurn ? `·每回灵力${c.mpPerTurn}` : ''}</span></div>`).join('')
    : '<div class="empty">身无挂碍</div>';

  /* 战况（战斗状态机 + 战力评估 + 战术杠杆；攻防对比仅作可视化参考，胜负由天道综合裁定） */
  if (st.enemy) {
    const e = st.enemy;
    const a = st.attrs;
    const pct = (mine, foe) => { const tot = mine + foe || 1; return Math.round(mine / tot * 100); };
    const diffCls = /悬殊/.test(e.diff) ? 'diff-red' : /远非|吃力/.test(e.diff) ? 'diff-orange' : /略胜|占优/.test(e.diff) ? 'diff-green' : 'diff-yellow';
    const hasAtk = e.atk != null, hasDef = e.def != null;
    $('c-enemy').innerHTML = `<div class="quest-row" data-tip="${esc(`${e.name}：${e.realm}${e.desc ? '｜' + e.desc : ''}\n胜负由天道综合修为/法宝/功法/战术裁定，攻防数值仅供参考。`)}">
        <span class="q-t" style="color:var(--cinnabar)">⚔ ${esc(e.name)}</span>
        <span class="q-d">${esc(e.realm)} · 气血 ${e.hp}/${e.maxHp}</span>
      </div>
      ${e.diff ? `<div class="bc-row"><span class="bc-label">战力评估</span><span class="bc-diff ${diffCls}">${esc(e.diff)}</span></div>` : ''}
      ${e.lever ? `<div class="bc-row"><span class="bc-label">战术杠杆</span><div class="bc-bar"><span class="mine" style="width:${Math.min(100, e.lever * 2)}%"></span></div><span class="bc-num">+${e.lever}</span></div>` : ''}
      ${(hasAtk || hasDef) ? `<div class="battle-compare">
        ${hasAtk ? `<div class="bc-row"><span class="bc-label">攻击</span><div class="bc-bar"><span class="mine" style="width:${pct(a.attack, e.atk)}%"></span><span class="foe" style="width:${100 - pct(a.attack, e.atk)}%"></span></div><span class="bc-num">你 ${a.attack} · 敌 ${e.atk}</span></div>` : ''}
        ${hasDef ? `<div class="bc-row"><span class="bc-label">防御</span><div class="bc-bar"><span class="mine" style="width:${pct(a.defense, e.def)}%"></span><span class="foe" style="width:${100 - pct(a.defense, e.def)}%"></span></div><span class="bc-num">你 ${a.defense} · 敌 ${e.def}</span></div>` : ''}
      </div>` : '<div class="bc-row"><span class="bc-label">判定</span><span class="bc-num" style="color:var(--ink-faint)">天道综合修为·法宝·战术裁定</span></div>'}`;
  } else {
    $('c-enemy').innerHTML = '<div class="empty">四下安宁</div>';
  }
  /* 战斗留痕（最近 3 场） */
  const blog = (st.battleLog || []).slice(-3).reverse();
  $('c-battles').innerHTML = blog.length
    ? blog.map(b => `<div class="bc-row"><span class="bc-label">战记</span><span style="color:${b.result === '败亡' ? 'var(--jade)' : 'var(--ink-dim)'}">第${b.t}回 · ${esc(b.foe)}（${esc(b.realm || '')}）${esc(b.result)}${b.lever ? ` · 杠杆+${b.lever}` : ''}</span></div>`).join('')
    : '<div class="empty">尚无战斗留痕</div>';

  /* 闭关状态条 */
  renderIdleBar(st);

  /* 死亡 */
  if (st.dead) { $('death-reason').textContent = st.deathReason || '你倒下了。'; showModal('m-death'); }
}

/* 闭关：开始 / 状态条 / 出关 */
function renderIdleBar(st) {
  const bar = $('idle-bar');
  if (!st.idle) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  const remain = (st.idle.startAt + st.idle.durationMin * 60000) - Date.now();
  bar.innerHTML = `☯ 闭关入定中 · 剩余 <span class="ib-timer">${fmtRemain(remain)}</span>
    <span class="ib-act" id="ib-cancel">提前出关</span>`;
  $('ib-cancel').onclick = async () => {
    const res = await api('/api/idle', { slot: app.slot, cancel: true });
    if (res.ok) { appendTurn(res); renderState(res.state); renderChips(); }
    else appendTurn({ narration: `⚠ ${res.error?.msg || '出关失败'}` });
  };
}
function idleTick() {
  if (!app.st || !app.st.idle) return;
  if ((app.st.idle.startAt + app.st.idle.durationMin * 60000) <= Date.now()) {
    fetchState(app.slot); // 到期静默结算
  } else {
    renderIdleBar(app.st);
  }
}
setInterval(idleTick, 30000);

async function startIdle(durationMin) {
  hideModal('m-idle');
  appendThinking();
  try {
    const res = await api('/api/idle', { slot: app.slot, durationMin });
    removeThinking();
    if (res.ok) { appendTurn(res); renderState(res.state); }
    else appendTurn({ narration: `⚠ ${res.error?.msg || '入定失败'}` });
  } catch { removeThinking(); appendTurn({ narration: '⚠ 与天道断联。' }); }
}

function setBar(bar, val, max, textId, text) {
  const pct = max > 0 ? Math.max(0, Math.min(100, val / max * 100)) : 0;
  $('bar-' + bar).style.width = pct + '%';
  $(textId).textContent = text;
}
function setBarTip(bar, tip) {
  const row = $('bar-' + bar).closest('.bar-row');
  if (row) row.setAttribute('data-tip', esc(tip));
}
function itemTip(st, name) {
  const parts = [];
  if (st.items && st.items[name]) parts.push(st.items[name]);
  if (st.itemSeen && st.itemSeen[name]) {
    for (const s of st.itemSeen[name]) parts.push(`剧情见闻（第${s.t}回）：${s.text}`);
  }
  if (parts.length) {
    const inBag = st.inventory && st.inventory[name] ? `行囊剩余 ×${st.inventory[name]}` : (Object.values(st.equipment || {}).includes(name) ? '已装备' : '不在行囊');
    parts.push(`—— ${inBag}`);
  } else if (ITEM_DICT[name]) {
    parts.push(ITEM_DICT[name]);
  } else {
    parts.push('来历不明的物件，可用行动亲自探查它的功用。');
  }
  return `${name}：${parts.join('\n')}`;
}

/* 悬浮说明：全局事件委托 */
const tipEl = $('tip');
let tipTimer = null;
document.addEventListener('mouseover', e => {
  const el = e.target.closest('[data-tip]');
  if (!el) return;
  const text = el.getAttribute('data-tip');
  if (!text) return;
  tipTimer = setTimeout(() => {
    tipEl.innerHTML = text;
    tipEl.classList.add('show');
    const r = el.getBoundingClientRect();
    const tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
    let x = r.left + r.width / 2 - tw / 2;
    let y = r.top - th - 10;
    if (y < 4) y = r.bottom + 10;
    x = Math.max(6, Math.min(window.innerWidth - tw - 6, x));
    tipEl.style.left = x + 'px';
    tipEl.style.top = y + 'px';
  }, 350);
});
document.addEventListener('mouseout', e => {
  if (e.target.closest('[data-tip]')) { clearTimeout(tipTimer); tipEl.classList.remove('show'); }
});
document.addEventListener('click', () => tipEl.classList.remove('show'));

/* ---------- 快捷指令 ---------- */
function renderChips() {
  const wrap = $('chips');
  const list = [...new Set([...(app.lastAvailable || []), ...STATIC_CHIPS])].slice(0, 12);
  wrap.innerHTML = list.map(c => `<span class="chip${STATIC_CHIPS.includes(c) ? ' cmd' : ''}" data-cmd="${esc(c)}">${esc(c)}</span>`).join('');
  wrap.querySelectorAll('.chip').forEach(el => {
    el.addEventListener('click', () => send(el.dataset.cmd));
  });
}

/* ---------- 回合 ---------- */
async function send(cmd) {
  cmd = String(cmd || '').trim();
  if (!cmd || app.busy || !app.st || app.st.dead) return;
  if (cmd === '帮助' || cmd === 'help') { showModal('m-guide'); return; }
  if (/^(闭关|入定|出关)/.test(cmd)) { showModal('m-idle'); return; }

  app.busy = true;
  $('btn-send').disabled = true;
  $('cmd').disabled = true;
  appendCommand(cmd);
  appendThinking();
  app.cmdHist.push(cmd);
  app.histIdx = app.cmdHist.length;
  draft = null;

  try {
    const res = await api('/api/play', { slot: app.slot, command: cmd });
    removeThinking();
    if (!res.ok) {
      appendTurn({ narration: `⚠ ${res.error?.msg || '未知错误'}` });
      if (res.error?.code === 'NOSAVE') showSlots();
      return;
    }
    app.lastAvailable = res.available || [];
    appendTurn(res);
    renderState(res.state);
    renderChips();
    localStorage.setItem('xmx_slot', String(app.slot));
    audioScene(res.state); // 场景化 BGM 切换
    hideMenu(); // 若仍在启动页（切档进入）则隐藏
    if (res.battle && res.battle.lever) {
      /* 战斗骰与杠杆：让玩家直观看到自己的智取在生效 */
      const eff = res.battle.danger - res.battle.lever;
      appendTurn({ narration: `（战况）凶险骰 ${res.battle.danger} · 战术杠杆 −${res.battle.lever} → 有效 ${Math.max(0, eff)}${eff < 30 ? '，敌势已衰，战机在你' : eff > 60 ? '，凶多吉少，速谋退路' : '，胜负未分'}` });
    }
    if (res.cutscene) showCutscene(res.cutscene);
    pushUnlocks(res.unlocks);
  } catch (e) {
    removeThinking();
    appendTurn({ narration: '⚠ 与天道断联（网络错误），请重试。' });
  } finally {
    app.busy = false;
    $('btn-send').disabled = false;
    $('cmd').disabled = false;
    $('cmd').focus();
  }
}

/* ---------- 存档管理 ---------- */
async function showSlots() {
  try { window.__boot = await api('/api/bootstrap'); } catch { /* 用旧缓存 */ }
  const list = $('slot-list');
  const boot = window.__boot;
  const rows = (boot && boot.slots ? boot.slots : [1, 2, 3].map(s => ({ slot: s, has: false }))).map(s => {
    if (!s.has) {
      return `<div class="slot new" data-new="${s.slot}"><span>＋ 开辟第 ${s.slot} 档（新角色）</span></div>`;
    }
    const acts = [
      `<button class="btn primary" data-open="${s.slot}">继续</button>`,
      `<button class="btn ghost" data-snaps="${s.slot}" title="随时存档 / 回档">快照</button>`,
      `<button class="btn ghost" data-reset="${s.slot}" title="清空此档">废档</button>`,
    ].join('');
    return `<div class="slot">
      <div class="s-main">
        <div class="s-name">${esc(s.name)} ${s.dead ? '<span style="color:var(--cinnabar);font-size:12px">【身死】</span>' : ''}</div>
        <div class="s-meta">${esc(s.realm)} · ${esc(s.location)} · 已历 ${s.turns} 回合</div>
      </div>
      <div class="s-actions">${acts}</div>
    </div>`;
  }).join('');
  list.innerHTML = rows;

  list.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation(); hideModal('m-slots'); enter(Number(b.dataset.open));
  }));
  list.querySelectorAll('[data-new]').forEach(b => b.addEventListener('click', async () => {
    app.slot = Number(b.dataset.new);
    $('m-new-title').textContent = `开辟第 ${app.slot} 档 · 命运初定`;
    hideModal('m-slots'); showModal('m-new');
    const focusName = () => { try { $('new-name').focus(); } catch { /* ignore */ } };
    focusName();
    setTimeout(focusName, 280); // 弹窗动画结束后再次聚焦（Electron 下防止焦点丢失）
    charCreate.rerolls = 20;
    $('reroll-count').textContent = '…';
    const r = await api('/api/preview', { gender: currentGender() });
    if (r.ok) renderTraits(r.traits);
  }));
  list.querySelectorAll('[data-snaps]').forEach(b => b.addEventListener('click', async e => {
    e.stopPropagation();
    app.snapSlot = Number(b.dataset.snaps);
    hideModal('m-slots');
    await openSnaps(app.snapSlot);
  }));
  list.querySelectorAll('[data-reset]').forEach(b => b.addEventListener('click', async e => {
    e.stopPropagation();
    if (!confirm('确认废掉此档？此世的因果与全部快照将烟消云散。')) return;
    await api('/api/reset', { slot: Number(b.dataset.reset) });
    location.reload();
  }));
  showModal('m-slots');
}

/* ---------- 快照：随时存档 / 回档 ---------- */
async function openSnaps(slot) {
  const res = await api('/api/snapshots?slot=' + slot).then(r => r.json()).catch(() => ({ ok: false }));
  renderSnaps(slot, res.ok ? res.list : []);
  showModal('m-snaps');
}

function renderSnaps(slot, list) {
  $('snaps-title').textContent = `快照 · 第 ${slot} 档`;
  const live = app.st && app.slot === slot ? app.st : null;
  $('snap-live').innerHTML = live
    ? `当前进度：<b>${esc(live.name)}</b> · ${esc(stageLabel(live.realm))} · 第 ${live.turns} 回合 · 自动存档中，每步皆已保存`
    : '（该档尚未载入，快照仍可管理）';
  $('snap-name').value = '';
  const box = $('snap-list');
  if (!list.length) {
    box.innerHTML = '<div class="snap-empty">尚无快照。随时点上方「保存快照」给重要时刻留档，之后可任意回档。</div>';
    return;
  }
  box.innerHTML = list.map(s => {
    const acts = [
      `<button class="btn primary" data-load="${s.id}" data-name="${esc(s.name)}" title="回到此节点（回档前会自动备份）">回档</button>`,
      s.auto ? '' : `<button class="btn ghost" data-del="${s.id}" title="删除此快照">删除</button>`,
    ].join('');
    return `<div class="snap ${s.auto ? 'auto' : ''}">
      <div class="s-main">
        <div class="s-name">${s.auto ? '⛬ ' : '◈ '}${esc(s.name)}${s.dead ? ' <span style="color:var(--cinnabar);font-size:12px">【身死】</span>' : ''}</div>
        <div class="s-meta">${esc(s.realm)} · ${esc(s.location)} · 第 ${s.turns} 回合 · ${new Date(s.createdAt).toLocaleString()}</div>
      </div>
      <div class="s-actions">${acts}</div>
    </div>`;
  }).join('');

  box.querySelectorAll('[data-load]').forEach(b => b.addEventListener('click', async () => {
    const name = b.dataset.name;
    if (!confirm(`确认回档到「${name}」？当前进度会先自动备份为「回档前自动备份」。`)) return;
    const res = await api('/api/loadsnapshot', { slot, id: b.dataset.load });
    if (res.ok) {
      hideModal('m-snaps');
      appendTurn(res);
      app.lastAvailable = res.available || [];
      renderState(res.state);
      renderChips();
      localStorage.setItem('xmx_slot', String(slot));
    } else appendTurn({ narration: `⚠ ${res.error?.msg || '回档失败'}` });
  }));
  box.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    const res = await api('/api/deletesnapshot', { slot, id: b.dataset.del });
    if (res.ok) renderSnaps(slot, res.list);
  }));
}

function enter(slot) {
  app.slot = slot;
  hideMenu(); // 进入游戏，隐藏启动页
  fetchState(slot);
}

async function fetchState(slot, force = false) {
  app.busy = true;
  try {
    const res = await fetch('/api/export?slot=' + slot).then(r => r.json());
    if (res.ok) {
      if (res.events && res.events.length) appendTurn({ events: res.events });
      const isNewView = force || !app.st || app.viewSlot !== slot;
      if (isNewView) clearNarrative();
      replayLog(res.data); // 刷新/切档/回滚后重放历史剧情
      app.viewSlot = slot;
      renderState(res.data); renderChips(); $('narrative').querySelector('.opening')?.remove();
      audioScene(res.data);
    }
  } finally { app.busy = false; }
}

/* 回合回滚：点击历史回合右下角按钮，时光倒流重写命运 */
async function doRollback(turn) {
  if (app.busy) return;
  if (!confirm(`回滚到第 ${turn} 回合？\n第 ${turn + 1} 回合起的剧情将全部改写，命运重新洗牌（可回滚最近 300 回合）。`)) return;
  const res = await api('/api/rollback', { slot: app.slot, turn });
  if (!res.ok) { alert(res.error?.msg || '回滚失败'); return; }
  appendTurn(res);
  await fetchState(app.slot, true);
  renderChips();
  localStorage.setItem('xmx_slot', String(app.slot));
}
document.getElementById('narrative').addEventListener('click', e => {
  const btn = e.target.closest('.rollback-btn');
  if (btn) doRollback(Number(btn.dataset.turn));
});

/* 清空叙事区（切档/开新档时）：只清剧情内容（顶栏徽标在 nav-head 固定区，不受影响） */
function clearNarrative() {
  const inner = document.getElementById('narrative-inner');
  if (!inner) return;
  inner.innerHTML = '<div class="orn-head">— ✦ —</div>';
}

/* 确保回合徽标存在（防御：误删后自动重建到顶栏固定区） */
function ensureTurnBadge() {
  let b = $('turn-badge');
  if (!b) {
    b = document.createElement('div');
    b.className = 'turn-badge';
    b.id = 'turn-badge';
    b.textContent = '—';
    const head = document.querySelector('.nav-head');
    (head || $('narrative')).prepend(b);
  }
  return b;
}

/* 重放全部历史剧情（刷新后进度与剧情完整可见，仅换档/开新档才清屏） */
const EVT_CLASSES = ['gain', 'lose', 'damage', 'heal', 'drain', 'restore', 'realm', 'tech', 'quest', 'map', 'exp', 'time', 'system', 'death'];
function replayLog(st) {
  const nav = document.getElementById('narrative-inner');
  if (nav.querySelector('.msg')) return; // 已有剧情不重复
  const log = (st.log || []).filter(l => l && l.u);
  if (!log.length) return;
  const frag = document.createDocumentFragment();

  const head = document.createElement('div');
  head.className = 'msg';
  const t = document.createElement('div');
  t.className = 'scene-title';
  t.textContent = `—— 续此前的因果 · 共 ${log.length} 回合 ——`;
  head.appendChild(t);
  frag.appendChild(head);

  for (const l of log) {
    const box = document.createElement('div');
    box.className = 'msg';

    if (l.title) {
      const st = document.createElement('div');
      st.className = 'scene-title';
      st.textContent = l.title;
      box.appendChild(st);
    }
    const c = document.createElement('div');
    c.className = 'cmdline';
    c.textContent = l.u;
    box.appendChild(c);
    const paras = String(l.a || '').split(/\n+/).map(p => p.trim()).filter(Boolean);
    for (const p of paras) {
      const d = document.createElement('div');
      d.className = 'para';
      d.innerHTML = esc(p).replace(/\*([^*]+)\*/g, '<span class="act">$1</span>');
      box.appendChild(d);
    }
    if (l.ev && l.ev.length) {
      const ev = document.createElement('div');
      ev.className = 'events';
      for (const e of l.ev) {
        const d = document.createElement('div');
        d.className = 'evt ' + (EVT_CLASSES.includes(e.t) ? e.t : 'system');
        d.textContent = e.text;
        ev.appendChild(d);
      }
      box.appendChild(ev);
    }
    if (l.t >= 1) {
      const rb = document.createElement('span');
      rb.className = 'rollback-btn';
      rb.dataset.turn = l.t;
      rb.title = `回滚到第 ${l.t} 回合，此后剧情重新演绎`;
      rb.textContent = '⤺ 回滚';
      box.appendChild(rb);
    }
    frag.appendChild(box);
  }
  nav.appendChild(frag); // 一次插入，长记录也不卡
  nav.scrollTop = nav.scrollHeight;
}

/* ---------- 建号：性别 + 词条（20 次免费刷新） ---------- */
const charCreate = { rerolls: 20, traits: null };
function currentGender() {
  const r = document.querySelector('input[name="sex"]:checked');
  return r ? r.value : 'male';
}
function renderTraits(t) {
  charCreate.traits = t;
  $('t-roots').textContent = `${t.roots.quality}：${t.roots.list.join('、')}`;
  $('t-roots-tags').innerHTML = t.roots.quality === '天灵根' ? '<span class="ct-tag">天选</span>' : t.roots.quality === '变异灵根' ? '<span class="ct-tag">异禀</span>' : '<span class="ct-tag">常资</span>';
  $('t-origin').textContent = t.origin.name + '——' + t.origin.desc;
  $('t-origin-tags').innerHTML = (t.origin.tags || []).map(x => `<span class="ct-tag">${esc(x)}</span>`).join('');
  $('t-personality').textContent = t.personality.name + '——' + t.personality.desc;
  $('t-talent').textContent = t.talent.name + '——' + t.talent.desc;
  $('t-talent-tags').innerHTML = (t.talent.tags || []).map(x => `<span class="ct-tag">${esc(x)}</span>`).join('');
  $('reroll-count').textContent = charCreate.rerolls;
  $('reroll-left').textContent = charCreate.rerolls;
  $('btn-reroll').disabled = charCreate.rerolls <= 0;
}
$('btn-reroll').addEventListener('click', async () => {
  if (charCreate.rerolls <= 0) { alert('天命已定，二十次刷新用尽——此身已成，不必再改。'); return; }
  charCreate.rerolls -= 1;
  const r = await api('/api/preview', { gender: currentGender() });
  if (r.ok) renderTraits(r.traits);
  else { charCreate.rerolls += 1; alert(r.error?.msg || '刷新失败'); }
});
document.querySelectorAll('input[name="sex"]').forEach(r => r.addEventListener('change', () => {
  if (charCreate.traits) api('/api/preview', { gender: currentGender() }).then(r => { if (r.ok) renderTraits(r.traits); });
}));

async function startNewGame() {
  const name = $('new-name').value.trim();
  const menuWasHidden = $('m-menu').classList.contains('hidden');
  hideModal('m-new');
  hideMenu(); // 立即离开启动页进入「开篇推演」界面（等待期显示占位，不再停留菜单）
  clearNarrative();
  app.viewSlot = app.slot;
  resetPanel(app.slot); // 立即清除旧档残留：开篇推演期间不再显示其他存档的内容
  appendTurn({ narration: `—— 第 ${app.slot} 档 · 天地初开 ——` });
  appendThinking();
  app.busy = true;
  try {
    const res = await api('/api/newgame', {
      slot: app.slot, name, gender: currentGender(),
      traits: charCreate.traits || null,
    });
    removeThinking();
    if (!res.ok) {
      if (res.error?.code === 'NO_KEY') { showModal('m-nokey'); return; }
      appendTurn({ narration: `⚠ ${res.error?.msg || '开篇失败'}` });
      if (!menuWasHidden) showMenu(); // 首页路径失败：回到启动页
      return;
    }
    app.lastAvailable = res.available || [];
    appendTurn(res);
    renderState(res.state);
    renderChips();
    localStorage.setItem('xmx_slot', String(app.slot));
  } catch {
    removeThinking();
    appendTurn({ narration: '⚠ 开篇时与天道断联，请重试。' });
    if (!menuWasHidden) showMenu();
  } finally { app.busy = false; }
}

/* 面板占位：切档/建号期间清除旧存档的界面残留 */
function resetPanel(slot) {
  try { $('turn-badge').textContent = `第 ${slot} 档 · 开篇推演中`; } catch {}
  try { $('c-avatar').src = 'avatars/male.webp'; } catch {}
  try { $('c-name').textContent = '—'; } catch {}
  try { $('c-meta').textContent = '命运未定'; } catch {}
  try { $('c-fame').innerHTML = ''; } catch {}
  try { $('c-roots').textContent = ''; } catch {}
  try { $('c-dise').innerHTML = ''; } catch {}
  try { $('c-stats').innerHTML = ''; } catch {}
  try { setBar('hp', 0, 1, 't-hp', '—'); setBar('mp', 0, 1, 't-mp', '—'); setBar('exp', 0, 1, 't-exp', '—'); } catch {}
  try { $('c-tech').innerHTML = '<div class="empty">—</div>'; } catch {}
  try { $('c-equip').innerHTML = ''; } catch {}
  try { $('bag-count').textContent = ''; } catch {}
  try { $('c-bag').innerHTML = '<div class="empty">—</div>'; } catch {}
  try { $('c-loc').textContent = '—'; } catch {}
  try { $('c-area').textContent = '—'; } catch {}
  try { $('c-explored').innerHTML = ''; } catch {}
  try { $('c-quests').innerHTML = '<div class="empty">—</div>'; } catch {}
  try { $('c-holdings').innerHTML = '<div class="empty">—</div>'; } catch {}
  try { $('c-hooks').innerHTML = '<div class="empty">—</div>'; } catch {}
  try { $('c-pets').innerHTML = '<div class="empty">—</div>'; } catch {}
  try { $('pets-count').textContent = ''; } catch {}
  try { $('c-conds').innerHTML = '<div class="empty">—</div>'; } catch {}
  try { $('c-enemy').innerHTML = '<div class="empty">四下安宁</div>'; } catch {}
  try { $('c-battles').innerHTML = '<div class="empty">—</div>'; } catch {}
  app.lastAttrs = null;
}

/* ---------- 复活 / 轮回 ---------- */
async function doRevive() {
  hideModal('m-death');
  appendThinking();
  try {
    const res = await api('/api/revive', { slot: app.slot, mode: 'revive' });
    removeThinking();
    if (res.ok) { appendTurn(res); renderState(res.state); renderChips(); }
    else { appendTurn({ narration: `⚠ ${res.error?.msg || '复活失败'}` }); showModal('m-death'); }
  } catch { removeThinking(); appendTurn({ narration: '⚠ 与天道断联。' }); showModal('m-death'); }
}
async function doReincarnate() {
  hideModal('m-death');
  appendThinking();
  try {
    const res = await api('/api/revive', { slot: app.slot, mode: 'reincarnate' });
    removeThinking();
    if (res.ok) { appendTurn(res); renderState(res.state); renderChips(); }
    else { appendTurn({ narration: `⚠ ${res.error?.msg || '轮回失败'}` }); showModal('m-death'); }
  } catch { removeThinking(); appendTurn({ narration: '⚠ 与天道断联。' }); showModal('m-death'); }
}

/* ---------- 导入导出 ---------- */
function doExport() {
  if (!app.st) { alert('尚无角色可导出。'); return; }
  const data = JSON.stringify({ version: 2, name: app.st.name, slot: app.slot, data: app.st }, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `仙途-${app.st.name}-第${app.slot}档.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
async function doImport(file) {
  try {
    const data = JSON.parse(await file.text());
    const src = data.data || data;
    if (!src.realm || !src.attrs || !src.inventory) throw new Error('bad');
    const slot = Number(data.slot) || app.slot || 1;
    const res = await api('/api/import', { slot, data: src });
    if (res.ok) { app.slot = slot; renderState(res.state); renderChips(); alert('导入成功。'); }
    else alert('导入失败：' + res.error?.msg);
  } catch { alert('存档文件无法识别。'); }
}

/* ---------- 新手指引 ---------- */
const GUIDE_KEY = 'xmx_guide_v2'; // v2：新玩法指引（自由度/声名/天劫/身外之物等），升级后自动弹出一次
function guideState() {
  try { return JSON.parse(localStorage.getItem(GUIDE_KEY)) || [false, false, false, false, false]; }
  catch { return [false, false, false, false, false]; }
}
function renderGuide() {
  const done = guideState();
  document.querySelectorAll('#m-guide .chk').forEach(el => {
    const i = Number(el.querySelector('input').dataset.step);
    const c = done[i];
    el.querySelector('input').checked = c;
    el.classList.toggle('checked', c);
    el.querySelector('input').onchange = () => {
      const s = guideState();
      s[i] = !s[i];
      localStorage.setItem(GUIDE_KEY, JSON.stringify(s));
      renderGuide();
    };
  });
}
function openGuide(firstTime = false) {
  renderGuide();
  showModal('m-guide');
  if (firstTime) $('btn-guide-close').textContent = '明白了，踏入仙途';
}
function maybeShowGuide() {
  if (!localStorage.getItem(GUIDE_KEY)) openGuide(true); // 首次游玩自动弹出
}

/* 面板卡片 tabs 切换 */
document.querySelectorAll('.side-tab').forEach(t => t.addEventListener('click', () => {
  document.querySelectorAll('.side-tab').forEach(x => x.classList.toggle('active', x === t));
  document.querySelectorAll('.side-pane').forEach(p => p.classList.toggle('hidden', p.id !== 'pane-' + t.dataset.pane));
}));

/* ---------- 苍玄界舆图：SVG 真地图，三级操作（世界 → 区域 → 地点） ---------- */
const mapState = { view: 'world', area: null, place: null };
const MAP_W = 900, MAP_H = 520;

/* 从剧情日志提取提到某地点的句子（最多 N 条） */
function placeSeen(st, place, n = 3) {
  const hits = [];
  for (const l of (st.log || [])) {
    if (hits.length >= n) break;
    const sent = String(l.a || '').split(/[。！？!?；;\n]+/).find(s => s.includes(place) && s.length > place.length + 1);
    if (sent) hits.push({ t: l.t, text: sent.replace(/\*+/g, '').replace(/\s+/g, ' ').trim().slice(0, 70) });
  }
  return hits;
}

function mapNode(cx, cy, label, cls, extra = '') {
  return `<g class="map-node ${cls}" transform="translate(${cx},${cy})" ${extra}>
    <circle r="15" class="mn-ring"></circle>
    <circle r="7" class="mn-dot"></circle>
    <text class="mn-label" y="32" text-anchor="middle">${esc(label)}</text>
  </g>`;
}

function renderMap() {
  const st = app.st;
  const body = $('map-body');
  const crumb = $('map-crumb');
  if (!st) return;

  if (mapState.view === 'world') {
    $('map-title').textContent = '苍玄界 · 舆图';
    crumb.innerHTML = '苍玄界';
    const explored = st.explored || [];
    const curArea = st.location.area;
    const pos = st.mapPos || {};
    /* 连线：探索顺序相邻 */
    const expAreas = explored.filter(a => pos[a]);
    let lines = '';
    for (let i = 1; i < expAreas.length; i++) {
      const a = pos[expAreas[i - 1]], b = pos[expAreas[i]];
      lines += `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" class="map-link"/>`;
    }
    /* 节点：已探索亮、骨架未探索迷雾、当前高亮 */
    const nodes = Object.entries(pos).map(([area, [x, y]]) => {
      const isExp = explored.includes(area);
      const isCur = area === curArea;
      return mapNode(x, y, area, `${isExp ? 'exp' : 'fog'}${isCur ? ' cur' : ''}`, `data-area="${esc(area)}"`);
    }).join('');
    body.innerHTML = `<svg viewBox="0 0 ${MAP_W} ${MAP_H}" class="map-svg" preserveAspectRatio="xMidYMid meet">
      <defs><filter id="mglow"><feGaussianBlur stdDeviation="3.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
      ${lines}${nodes}
      <text class="map-hint" x="${MAP_W / 2}" y="${MAP_H - 14}" text-anchor="middle">已探索区域亮起 · 迷雾深处藏而未现 · 点击区域进入</text>
    </svg>`;
    bindMapNodes(body, 'area');
  } else if (mapState.view === 'area') {
    $('map-title').textContent = `舆图 · ${mapState.area}`;
    crumb.innerHTML = `<span class="crumb-link" data-go="world">苍玄界</span> › ${esc(mapState.area)}`;
    const places = Object.entries(st.visited || {}).filter(([, v]) => v.area === mapState.area)
      .sort((a, b) => a[1].firstTurn - b[1].firstTurn);
    if (!places.length) {
      body.innerHTML = '<div class="codex-empty">此区域尚未探明具体地点。</div>';
      return;
    }
    /* 区域内地点环形布局 */
    const cx = MAP_W / 2, cy = MAP_H / 2, R = Math.min(150, Math.max(70, places.length * 32));
    const nodes = places.map(([place], i) => {
      const ang = (i / places.length) * Math.PI * 2 - Math.PI / 2;
      const x = cx + R * Math.cos(ang), y = cy + R * Math.sin(ang);
      const isCur = place === st.location.name;
      return mapNode(x, y, place, `exp${isCur ? ' cur' : ''}`, `data-place="${esc(place)}"`);
    }).join('');
    body.innerHTML = `<svg viewBox="0 0 ${MAP_W} ${MAP_H}" class="map-svg" preserveAspectRatio="xMidYMid meet">
      <defs><filter id="mglow"><feGaussianBlur stdDeviation="3.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
      ${nodes}
      <text class="map-hint" x="${MAP_W / 2}" y="${MAP_H - 14}" text-anchor="middle">${esc(mapState.area)} · 点击地点查看详情</text>
    </svg>`;
    bindMapNodes(body, 'place');
  } else {
    $('map-title').textContent = `舆图 · ${mapState.place}`;
    crumb.innerHTML = `<span class="crumb-link" data-go="world">苍玄界</span> › <span class="crumb-link" data-go="area">${esc(mapState.area)}</span> › ${esc(mapState.place)}`;
    const v = (st.visited || {})[mapState.place];
    const seen = placeSeen(st, mapState.place, 5);
    const here = mapState.place === st.location.name;
    body.innerHTML = `<div class="map-detail">
      <div class="md-name">${esc(mapState.place)}${here ? ' <span class="map-current">· 此刻在此</span>' : ''}</div>
      ${v ? `<div class="md-field"><span class="k">所属</span><span class="v">${esc(v.area)}</span></div>
      <div class="md-field"><span class="k">到访</span><span class="v">首访第 ${v.firstTurn} 回 · 最近第 ${v.lastTurn} 回 · 共 ${v.count} 次</span></div>` : ''}
      <div class="md-field"><span class="k">此间见闻</span><span class="v">${seen.length ? seen.map(s => `<span class="md-seen-item"><span class="si-t">第${s.t}回</span>${esc(s.text)}</span>`).join('') : '尚无见闻记载。'}</span></div>
    </div>`;
    bindMapCrumb(crumb);
  }
}
function bindMapNodes(body, kind) {
  body.querySelectorAll('.map-node').forEach(el => el.addEventListener('click', () => {
    if (kind === 'area') {
      if (!el.classList.contains('exp')) return; // 迷雾不可入
      mapState.view = 'area';
      mapState.area = el.dataset.area;
      mapState.place = null;
    } else {
      mapState.view = 'place';
      mapState.place = el.dataset.place;
    }
    renderMap();
  }));
}
function bindMapCrumb(crumb) {
  crumb.querySelectorAll('.crumb-link').forEach(el => el.addEventListener('click', () => {
    if (el.dataset.go === 'world') { mapState.view = 'world'; mapState.area = null; mapState.place = null; }
    else if (el.dataset.go === 'area') { mapState.view = 'area'; mapState.place = null; }
    renderMap();
  }));
}
$('btn-map').addEventListener('click', () => {
  mapState.view = 'world'; mapState.area = null; mapState.place = null;
  renderMap();
  showModal('m-map');
});

/* ---------- 万象阁 · 图鉴与人物志 ---------- */
const codex = { tab: 'items', view: 'list', name: null };
let codexTimer = null;

/* 物品类型推断（从名称与说明） */
function itemKind(st, name) {
  const n = name + (st.items ? st.items[name] || '' : '');
  if (/丹|丸|散|液|膏|露/.test(n)) return '丹药';
  if (/符/.test(n)) return '符箓';
  if (/草|果|花|参|芝|藤|叶|根/.test(n)) return '灵材';
  if (/剑|刀|枪|斧|棍|环|印|镜|珠|铃|幡|塔|钟|甲|袍|衣|护臂|护心/.test(n)) return '法宝';
  if (/肉|皮|骨|血|丹核|内丹/.test(n)) return '妖材';
  if (/粮|酒|水|茶|食/.test(n)) return '杂用';
  return '杂物';
}

/* 万象阁 tab 标题映射 */
const CODEX_TITLES = { items: '万象阁 · 行囊图鉴', tech: '万象阁 · 功法图鉴', npcs: '万象阁 · 人物志', news: '万象阁 · 天下大势' };

function renderCodex() {
  const st = app.st;
  const body = $('codex-body');
  const empty = $('codex-empty');
  document.querySelectorAll('#codex-tabs .codex-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === codex.tab));
  empty.classList.add('hidden');
  if (!st) return;

  if (codex.view === 'detail') { renderCodexDetail(); return; }

  let cards = '';
  if (codex.tab === 'items') {
    const names = new Set([...Object.keys(st.inventory || {}), ...Object.keys(st.items || {}), ...Object.keys(st.itemSeen || {})]);
    cards = [...names].sort((a, b) => a.localeCompare(b)).map(n => {
      const hold = st.inventory && st.inventory[n] ? `×${st.inventory[n]}` : '';
      const desc = (st.items && st.items[n]) || (st.itemSeen && st.itemSeen[n] && st.itemSeen[n][0] ? `「${st.itemSeen[n][0].text}」` : '');
      return `<div class="codex-card" data-open="items" data-name="${esc(n)}">
        <div class="cc-name">${esc(n)}${hold ? `<span class="cc-tag">${hold}</span>` : ''}<span class="cc-tag">${itemKind(st, n)}</span></div>
        <div class="cc-sub">${esc(desc)}</div>
        <div class="cc-meta">${st.itemSeen && st.itemSeen[n] ? `首见第${st.itemSeen[n][0].t}回` : '图鉴收录'}</div>
      </div>`;
    }).join('');
  } else if (codex.tab === 'tech') {
    cards = (st.techniques || []).map(t => `<div class="codex-card" data-open="tech" data-name="${esc(t.name)}">
      <div class="cc-name">${esc(t.name)}<span class="cc-tag">${esc(t.tier)}</span><span class="cc-tag">${esc(t.type)}</span></div>
      <div class="cc-sub">${esc(t.desc || '来历不明的功法。')}</div>
      <div class="cc-meta">已习得</div>
    </div>`).join('');
  } else if (codex.tab === 'news') {
    /* 天下大势：世界快讯时间线（倒序） */
    const list = [...(st.news || [])].reverse();
    cards = `<div class="news-timeline">${list.map(n => `
      <div class="news-item">
        <span class="ni-k ${'ni-' + n.kind}">${esc(n.kind)}</span>
        <span class="ni-text">${esc(n.text)}</span>
        <span class="ni-t">第${n.t}回</span>
      </div>`).join('') || '<div class="codex-empty" style="padding:30px 0">江湖初定，尚无大事——一切静待发生。</div>'}</div>`;
  } else {
    /* 人物志：人物小卡（豆包统一风格画像，仅图鉴展示） */
    cards = Object.entries(st.npcs || {}).map(([n, p]) => `<div class="codex-card npc-card" data-open="npcs" data-name="${esc(n)}">
      ${faceHtml(n, p)}
      <div class="npc-info">
        <div class="cc-name">${esc(n)}<span class="cc-tag">人物</span></div>
        <div class="cc-sub ${p.power ? '' : ''}" style="color:${p.power ? 'var(--cyan)' : 'var(--ink-faint)'}">${esc(p.power || '深浅未知')}</div>
        <div class="cc-meta">初见于第 ${p.firstTurn} 回 · 登场 ${p.turns ? p.turns.length : 1} 次</div>
      </div>
    </div>`).join('');
  }

  body.innerHTML = cards || '';
  empty.classList.toggle('hidden', !!cards);
  $('codex-title').textContent = CODEX_TITLES[codex.tab] || '万象阁';

  body.querySelectorAll('[data-open]').forEach(el => el.addEventListener('click', () => {
    codex.view = 'detail';
    codex.name = el.dataset.name;
    renderCodex();
  }));
}

function renderCodexDetail() {
  const st = app.st;
  const body = $('codex-body');
  $('codex-title').textContent = '万象阁 · 详情';
  const back = `<span class="codex-back">← 返回图鉴</span>`;
  let html = '';
  if (codex.tab === 'items') {
    const n = codex.name;
    const hold = st.inventory && st.inventory[n] ? st.inventory[n] : 0;
    const inEquip = Object.values(st.equipment || {}).includes(n);
    const seen = st.itemSeen && st.itemSeen[n] || [];
    html = `${back}
      <div class="codex-detail">
        <div class="cd-name">${esc(n)} <span class="cc-tag">${itemKind(st, n)}</span></div>
        <div class="cd-field"><span class="k">持有</span><span class="v">${hold > 0 ? `行囊 ×${hold}` : inEquip ? '已装备' : '不在行囊'}</span></div>
        <div class="cd-field"><span class="k">图鉴说明</span><span class="v">${esc((st.items && st.items[n]) || '尚未探明其功用，可在剧情中亲身一试。')}</span></div>
        ${seen.length ? `<div class="cd-field"><span class="k">剧情见闻</span><span class="v">${seen.map(s => `<span class="seen-item"><span class="si-t">第${s.t}回</span>${esc(s.text)}</span>`).join('')}</span></div>` : ''}
      </div>`;
  } else if (codex.tab === 'tech') {
    const t = (st.techniques || []).find(x => x.name === codex.name);
    if (t) html = `${back}
      <div class="codex-detail">
        <div class="cd-name">${esc(t.name)} <span class="cc-tag">${esc(t.tier)}</span><span class="cc-tag">${esc(t.type)}</span></div>
        <div class="cd-field"><span class="k">品阶</span><span class="v">${esc(t.tier)}</span></div>
        <div class="cd-field"><span class="k">类别</span><span class="v">${esc(t.type)}</span></div>
        <div class="cd-field"><span class="k">描述</span><span class="v">${esc(t.desc || '无')}</span></div>
        <div class="cd-field"><span class="k">状态</span><span class="v">已习得</span></div>
      </div>`;
  } else {
    const p = st.npcs && st.npcs[codex.name];
    if (p) {
      const seen = st.npcSeen && st.npcSeen[codex.name] || [];
      const rels = (st.hooks || []).filter(h => h.text.includes(codex.name));
      html = `${back}
      <div class="codex-detail">
        <div class="cd-npc-head">
          ${faceHtml(codex.name, p, true)}
          <div>
            <div class="cd-name">${esc(p.name)}</div>
            <div class="cd-power">${esc(p.power || '深浅未知（以你目前的境界无法窥探）')}</div>
          </div>
        </div>
        <div class="cd-field"><span class="k">修为情报</span><span class="v cd-power">${esc(p.power || '深浅未知（以你目前的境界无法窥探）')}</span></div>
        ${(p.powerHistory && p.powerHistory.length >= 2) ? `<div class="cd-field"><span class="k">修为轨迹</span><span class="v">${p.powerHistory.map(h => `<span class="seen-item"><span class="si-t">第${h.t}回</span>${esc(h.power)}</span>`).join('')}</span></div>` : ''}
        <div class="cd-field"><span class="k">身份来历</span><span class="v">${esc(p.desc || '所知甚少。')}</span></div>
        <div class="cd-field"><span class="k">登场记录</span><span class="v">初见于第 ${p.firstTurn} 回 · 登场 ${(p.turns || []).length} 次</span></div>
        ${rels.length ? `<div class="cd-field"><span class="k">未了因果</span><span class="v">${rels.map(r => esc(r.text)).join('<br>')}</span></div>` : ''}
        ${seen.length ? `<div class="cd-field"><span class="k">剧情见闻</span><span class="v">${seen.map(s => `<span class="seen-item"><span class="si-t">第${s.t}回</span>${esc(s.text)}</span>`).join('')}</span></div>` : ''}
      </div>`;
    }
  }
  body.innerHTML = html;
  body.querySelector('.codex-back').addEventListener('click', () => { codex.view = 'list'; renderCodex(); });
}

/* 人物小卡头像：豆包统一风格画像；未生成/失败时显示水墨占位（首字） */
function faceHtml(n, p, big = false) {
  const av = p && p.avatar;
  const ph = `<span class="npc-av npc-ph" title="${av === 'pending' ? '画像生成中…' : av === 'fail' ? '画像生成失败' : '尚未生成画像（配置豆包 ARK Key 后自动生成）'}">${esc((n || '').charAt(0))}</span>`;
  const size = big ? 'npc-lg' : '';
  if (av === 'done') {
    return `<span class="npc-av-wrap ${size}"><img class="npc-av" src="/api/face?n=${encodeURIComponent(n)}" alt="${esc(n)}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">${ph}</span>`;
  }
  return `<span class="npc-av-wrap ${size}">${ph}</span>`;
}

$('btn-codex').addEventListener('click', () => {
  codex.tab = 'items'; codex.view = 'list';
  renderCodex();
  showModal('m-codex');
  /* 人物小卡生成是异步的：万象打开期间定时刷新列表视图 */
  if (codexTimer) clearInterval(codexTimer);
  codexTimer = setInterval(() => {
    const open = !document.getElementById('m-codex').classList.contains('hidden');
    if (!open) { clearInterval(codexTimer); codexTimer = null; return; }
    if (codex.view === 'list') renderCodex();
  }, 12000);
});
document.querySelectorAll('#codex-tabs .codex-tab').forEach(t => t.addEventListener('click', () => {
  codex.tab = t.dataset.tab; codex.view = 'list';
  renderCodex();
}));

/* ---------- 生平 · 大事件表 ---------- */
function openLife() {
  const st = app.st;
  const list = $('life-list');
  if (!st || !(st.chronicle || []).length) {
    list.innerHTML = '<div class="life-empty">大道尚无文字，等你来书写第一笔。</div>';
    showModal('m-life');
    return;
  }
  const ICONS = { realm: '✦', death: '✟', map: '◈', tech: '⚡', quest: '✓' };
  const clsOf = c => {
    if (c.kind === 'quest' || /任务达成|了结/.test(c.text)) return 'quest';
    if (/突破/.test(c.text)) return 'realm';
    if (/陨|坐化|倒下了/.test(c.text)) return 'death';
    if (/探索新区域/.test(c.text)) return 'map';
    if (/习得/.test(c.text)) return 'tech';
    return '';
  };
  list.innerHTML = [...st.chronicle].reverse().map(c => {
    const cls = clsOf(c);
    return `<div class="life-item ${cls}"><span class="t">${ICONS[cls] || '·'} 第${c.t}回</span><span class="x">${esc(c.text)}</span></div>`;
  }).join('');
  showModal('m-life');
}

/* ---------- 开场背景轮播 ---------- */
let openingIdx = 0;
const openingImgs = document.querySelectorAll('.opening-bg .ob-img');
setInterval(() => {
  if (!document.querySelector('.opening')) return; // 开场页已移除则停止
  openingIdx = (openingIdx + 1) % openingImgs.length;
  openingImgs.forEach((im, i) => im.classList.toggle('active', i === openingIdx));
}, 9000);

/* ---------- 剧情过场：重大节点全屏插画 ---------- */
function showCutscene(cs) {
  if (!cs) return;
  $('cs-img').src = 'cutscenes/' + (cs.img || 1) + '.webp';
  $('cs-title').textContent = cs.title || '';
  $('cs-text').textContent = cs.text || '';
  showModal('m-cutscene');
}
$('m-cutscene').addEventListener('click', () => hideModal('m-cutscene'));
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') {
    const m = $('m-cutscene');
    if (!m.classList.contains('hidden')) hideModal('m-cutscene');
  }
});

/* ---------- 解锁动效：新物品/NPC/任务 中央渐显，四周暗化 ---------- */
const UNLOCK_ICONS = { item: '✦', npc: '人', quest: '卷' };
let unlockQueue = [];
let unlockBusy = false;
let unlockSkip = false;
function pushUnlocks(list) {
  if (!list || !list.length) return;
  unlockQueue.push(...list);
  playUnlocks();
}
function playUnlocks() {
  if (unlockBusy || !unlockQueue.length) return;
  const u = unlockQueue.shift();
  unlockBusy = true;
  unlockSkip = false;
  const card = $('unlock-card');
  card.className = 'unlock-card ul-type-' + (u.type || 'item');
  $('ul-icon').textContent = UNLOCK_ICONS[u.type] || '✦';
  $('ul-label').textContent = u.type === 'item' ? '获得新物' : u.type === 'npc' ? '识得人物' : '新任务';
  $('ul-title').textContent = u.title || '';
  $('ul-desc').textContent = u.desc || '';
  showModal('m-unlock');
  setTimeout(() => {
    if (unlockSkip) { unlockSkip = false; }
    hideModal('m-unlock');
    unlockBusy = false;
    playUnlocks();
  }, 3200);
}
$('m-unlock').addEventListener('click', () => {
  if (unlockBusy) {
    unlockSkip = true;
    hideModal('m-unlock');
    unlockBusy = false;
    playUnlocks();
  }
});

/* ---------- 四卡可调整：拖拽分隔条 + 传讯卡折叠 ---------- */
const layout = document.querySelector('.layout');
const splitter = $('splitter');
(function restoreSplit() {
  try {
    const w = Number(localStorage.getItem('xmx_split'));
    if (w && w > 320) layout.style.gridTemplateColumns = `${w}px 8px 360px`;
  } catch { /* ignore */ }
})();
let splitDrag = null;
splitter.addEventListener('pointerdown', e => {
  splitDrag = { x: e.clientX, w: layout.getBoundingClientRect().width };
  splitter.classList.add('dragging');
  splitter.setPointerCapture(e.pointerId);
  e.preventDefault();
});
splitter.addEventListener('pointermove', e => {
  if (!splitDrag) return;
  const total = splitDrag.w;
  let main = total - e.clientX + splitDrag.x - 8 - 360;
  main = Math.max(340, Math.min(total - 380, main));
  layout.style.gridTemplateColumns = `${main}px 8px 360px`;
});
splitter.addEventListener('pointerup', () => {
  if (!splitDrag) return;
  const cols = layout.style.gridTemplateColumns;
  const w = parseFloat(cols) || 0;
  if (w > 300) localStorage.setItem('xmx_split', String(Math.round(w)));
  splitDrag = null;
  splitter.classList.remove('dragging');
});
$('btn-chat-fold').addEventListener('click', () => {
  const card = document.querySelector('.chat-card');
  card.classList.toggle('collapsed');
  $('btn-chat-fold').textContent = card.classList.contains('collapsed') ? '展开' : '收起';
  localStorage.setItem('xmx_chat_fold', card.classList.contains('collapsed') ? '1' : '0');
});
(function restoreChatFold() {
  if (localStorage.getItem('xmx_chat_fold') === '1') {
    document.querySelector('.chat-card').classList.add('collapsed');
    $('btn-chat-fold').textContent = '展开';
  }
})();

/* ---------- 音频系统：场景化 BGM ---------- */
function loadAudioSettings() {
  try {
    const a = JSON.parse(localStorage.getItem('xmx_audio') || '{}');
    if (a.music !== undefined) settings.music = a.music;
    if (a.volume !== undefined) settings.volume = a.volume;
  } catch { /* ignore */ }
  const m = $('set-music'); if (m) m.checked = settings.music;
  const v = $('set-vol'); if (v) { v.value = Math.round(settings.volume * 100); $('set-vol-val').textContent = Math.round(settings.volume * 100) + '%'; }
}
function audioInit() {
  loadAudioSettings();
  AudioSys.load(settings);
  /* 首次用户交互后启动音频（浏览器自动播放限制） */
  const kick = () => {
    document.removeEventListener('click', kick);
    document.removeEventListener('keydown', kick);
    AudioSys.init();
    AudioSys.update(app.st);
  };
  document.addEventListener('click', kick);
  document.addEventListener('keydown', kick);
}
function audioScene(st) {
  if (window.AudioSys) AudioSys.update(st || app.st);
}
$('set-music').addEventListener('change', e => {
  settings.music = e.target.checked;
  AudioSys.setMusic(settings.music);
  saveSettingsExtra();
});
$('set-vol').addEventListener('input', e => {
  settings.volume = Number(e.target.value) / 100;
  $('set-vol-val').textContent = e.target.value + '%';
  AudioSys.setVolume(settings.volume);
  saveSettingsExtra();
});
function saveSettingsExtra() {
  try { localStorage.setItem('xmx_audio', JSON.stringify({ music: settings.music, volume: settings.volume })); } catch { /* ignore */ }
}
/* 当前音乐来源（设置页确认 BGM 搭载状态） */
function refreshMusicSrc() {
  const el = $('set-music-src');
  if (!el) return;
  if (window.AudioSys) {
    const st = AudioSys.getStatus();
    el.textContent = st;
    el.style.color = st.includes('游戏BGM') ? 'var(--jade)' : 'var(--gold-dim)';
  } else {
    el.textContent = '';
  }
}
setInterval(() => { if (!document.getElementById('m-settings').classList.contains('hidden')) refreshMusicSrc(); }, 1500);
const SET_KEY = 'xmx_settings';
const DEF_SET = { skin: 'default', zoom: 100, narr: 17, panel: 14.5, anim: true, font: 'default' };
let settings = (() => { try { return { ...DEF_SET, ...JSON.parse(localStorage.getItem(SET_KEY) || '{}') }; } catch { return { ...DEF_SET }; } })();

function applySettings() {
  const s = settings;
  document.body.dataset.skin = s.skin;
  document.body.dataset.anim = s.anim ? 'on' : 'off';
  document.body.dataset.font = s.font;
  document.body.style.zoom = (s.zoom / 100).toFixed(2);
  document.documentElement.style.setProperty('--narr-size', s.narr + 'px');
  document.documentElement.style.setProperty('--panel-size', s.panel + 'px');
  localStorage.setItem(SET_KEY, JSON.stringify(s));
  /* 同步控件状态（若弹窗已渲染） */
  const zoom = $('set-zoom'); if (zoom) { zoom.value = s.zoom; $('set-zoom-val').textContent = s.zoom + '%'; }
  const narr = $('set-narr'); if (narr) { narr.value = s.narr; $('set-narr-val').textContent = s.narr + 'px'; }
  const panel = $('set-panel'); if (panel) { panel.value = s.panel; $('set-panel-val').textContent = s.panel + 'px'; }
  const anim = $('set-anim'); if (anim) anim.checked = s.anim;
  const font = $('set-font'); if (font) font.value = s.font;
  document.querySelectorAll('#skin-grid .skin-card').forEach(c => c.classList.toggle('active', c.dataset.skin === s.skin));
}

$('btn-settings').addEventListener('click', () => {
  applySettings();
  refreshMusicSrc();
  fetch('/api/info').then(r => r.json()).then(info => {
    if (info.ok) {
      $('set-datadir').textContent = `存档目录：${info.dataDir}\n配置目录：${info.configDir}`;
    }
  }).catch(() => {});
  fetch('/api/getconfig').then(r => r.json()).then(c => {
    if (c.ok) {
      $('set-apikey-state').textContent = c.hasKey ? '已配置 ✓' : '未配置';
      $('set-apikey-state').style.color = c.hasKey ? 'var(--jade)' : 'var(--cinnabar)';
      setSttState(!!c.stt, c.sttAppId);
      if (c.sttAppId) $('set-stt-appid').value = c.sttAppId; // 回显已保存的 AppID
      setArkState(!!c.ark);
    }
  }).catch(() => {});
  fetch('/api/update/status').then(r => r.json()).then(u => {
    if (u.ok) {
      $('set-version').textContent = `游戏 ${u.gameVersion} · 资源 ${u.localVersion}${u.updateUrl ? ' · 更新源已配置' : ' · 未配置更新源'}`;
    }
  }).catch(() => {});
  showModal('m-settings');
});
function setSttState(on, appId) {
  const s = $('set-stt-state');
  if (on) {
    s.innerHTML = `讯飞语音已接入 ✓（AppID：${esc(appId || '—')}）——语音输入走讯飞听写（识别更准）。如需更换，重填三项保存即可。`;
    s.style.color = 'var(--jade)';
  } else {
    s.innerHTML = '未接入讯飞：语音输入使用浏览器内置识别（需联网）。可到讯飞开放平台购买「实时语音听写」免费试用包后填入。';
    s.style.color = 'var(--ink-faint)';
  }
}
function setArkState(on) {
  const s = $('set-ark-state');
  if (on) {
    s.innerHTML = '豆包生图已接入 ✓ NPC 人物小卡将自动生成（统一水墨画风，仅图鉴展示）。';
    s.style.color = 'var(--jade)';
  } else {
    s.innerHTML = '未接入：人物小卡显示水墨占位。在火山方舟控制台开通「豆包·图像生成」获取 ARK Key 后填入，新登场的 NPC 将自动配图。';
    s.style.color = 'var(--ink-faint)';
  }
}
$('set-ark-save').addEventListener('click', async () => {
  const ak = $('set-ark').value.trim();
  const r = await api('/api/setconfig', { ark: ak ? { apiKey: ak } : null });
  if (r.ok) { setArkState(!!r.ark); alert(r.ark ? '豆包生图已保存' + '，重启游戏后生效。' : '豆包生图已清除。'); }
  else alert(r.error?.msg || '保存失败');
});
$('set-ark-test').addEventListener('click', async () => {
  const st = $('set-ark-state');
  st.textContent = '… 正在生成测试图（约 10~30 秒）…';
  st.style.color = 'var(--gold)';
  const r = await api('/api/ark/test', {});
  if (r.ok) { st.textContent = '测试通过 ✓ ARK Key 有效'; st.style.color = 'var(--jade)'; }
  else { st.textContent = '测试失败：' + (r.error?.msg || '未知错误'); st.style.color = 'var(--cinnabar)'; }
});
$('set-stt-save').addEventListener('click', async () => {
  const stt = {
    appId: $('set-stt-appid').value.trim(),
    apiKey: $('set-stt-apikey').value.trim(),
    apiSecret: $('set-stt-apisecret').value.trim(),
  };
  const r = await api('/api/setconfig', { stt });
  if (r.ok) { setSttState(!!r.stt); alert('讯飞语音已保存' + (r.stt ? '，重启游戏后生效。' : '。')); }
  else alert(r.error?.msg || '保存失败');
});
$('set-stt-clear').addEventListener('click', async () => {
  const r = await api('/api/setconfig', { stt: null });
  if (r.ok) {
    $('set-stt-appid').value = '';
    $('set-stt-apikey').value = '';
    $('set-stt-apisecret').value = '';
    setSttState(false);
    alert('讯飞语音已清除。');
  } else alert(r.error?.msg || '清除失败');
});
$('set-apikey-save').addEventListener('click', async () => {
  const key = $('set-apikey').value.trim();
  const r = await api('/api/setconfig', { apiKey: key });
  if (r.ok) {
    $('set-apikey-state').textContent = r.msg;
    $('set-apikey-state').style.color = 'var(--jade)';
    setConn(r.configured ? 'ok' : 'bad', r.configured ? '· 天道相连 · ' + (r.model || '') : '· 天道未连 · 需配置 API');
  } else alert(r.error?.msg || '保存失败');
});
$('set-update').addEventListener('click', async () => {
  const st = $('set-update-state');
  st.textContent = '… 正在检查更新 …';
  $('set-relaunch').classList.add('hidden');
  const r = await api('/api/update/check', {});
  if (r.ok) {
    if (r.hotUpdated) {
      st.textContent = `热更 ${r.version} 已就绪（${r.files} 个文件）`;
      $('set-relaunch').classList.remove('hidden');
      $('set-relaunch').textContent = (window.xmu && window.xmu.relaunch) ? '重启生效' : '刷新页面生效';
      if (r.exe) st.textContent += ` · 另有完整版 ${r.exe.name}`;
    } else if (r.exe) {
      st.textContent = `发现完整版 ${r.exe.name}（${(r.exe.size / 1048576).toFixed(0)}MB）`;
      const dl = $('set-dlexe');
      dl.classList.remove('hidden');
      dl.textContent = '下载新版本';
      dl.onclick = async () => {
        dl.disabled = true;
        dl.textContent = '下载中…';
        const d = await api('/api/update/download-exe', { url: r.exe.url, name: r.exe.name });
        if (d.ok) {
          dl.textContent = '已下载 ✓';
          st.textContent = d.msg;
          const op = $('set-openpath');
          op.classList.remove('hidden');
          op.onclick = () => { if (window.xmu && window.xmu.openPath) window.xmu.openPath(d.path); };
        } else {
          dl.textContent = '下载失败，重试';
          dl.disabled = false;
          st.textContent = d.error?.msg || '下载失败';
        }
      };
    } else {
      st.textContent = r.msg || '已是最新版本';
    }
  } else {
    st.textContent = r.error?.msg || '检查失败';
  }
});
$('set-relaunch').addEventListener('click', () => {
  if (window.xmu && window.xmu.relaunch) window.xmu.relaunch();
  else location.reload();
});
document.querySelectorAll('.set-tab').forEach(t => t.addEventListener('click', () => {
  document.querySelectorAll('.set-tab').forEach(x => x.classList.toggle('active', x === t));
  document.querySelectorAll('.set-sec').forEach(s => s.classList.toggle('hidden', s.id !== 'sec-' + t.dataset.sec));
}));
document.querySelectorAll('#skin-grid .skin-card').forEach(c => c.addEventListener('click', () => { settings.skin = c.dataset.skin; applySettings(); }));
$('set-zoom').addEventListener('input', e => { settings.zoom = Number(e.target.value); applySettings(); });
$('set-narr').addEventListener('input', e => { settings.narr = Number(e.target.value); applySettings(); });
$('set-panel').addEventListener('input', e => { settings.panel = Number(e.target.value); applySettings(); });
$('set-anim').addEventListener('change', e => { settings.anim = e.target.checked; applySettings(); });
$('set-font').addEventListener('change', e => { settings.font = e.target.value; applySettings(); });
$('set-reset').addEventListener('click', () => { settings = { ...DEF_SET }; applySettings(); });
applySettings();

/* ---------- 天机阁 · 档案问答（游戏外） ---------- */
const qa = { busy: false };
function qaMsg(cls, text) {
  const body = $('qa-body');
  const d = document.createElement('div');
  d.className = 'qa-msg ' + cls;
  d.textContent = text;
  body.appendChild(d);
  body.scrollTop = body.scrollHeight;
  return d;
}
async function sendQa() {
  const input = $('qa-input');
  const q = input.value.trim();
  if (!q || qa.busy || !app.st) return;
  qa.busy = true;
  $('qa-send').disabled = true;
  qaMsg('qa-me', q);
  const t = qaMsg('qa-bot qa-thinking', '… 档案官翻阅卷宗中 …');
  input.value = '';
  try {
    const res = await api('/api/qa', { slot: app.slot, question: q });
    t.remove();
    if (res.ok) qaMsg('qa-bot', res.answer);
    else qaMsg('qa-err', '⚠ ' + (res.error?.msg || '档案查询失败'));
  } catch {
    t.remove();
    qaMsg('qa-err', '⚠ 与天机阁断联，请重试。');
  } finally {
    qa.busy = false;
    $('qa-send').disabled = false;
    input.focus();
  }
}
function toggleQa() {
  const wrap = $('qa-wrap');
  wrap.classList.toggle('hidden');
  if (!wrap.classList.contains('hidden')) {
    positionQaPanel();
    $('qa-input').focus();
  }
}

/* 悬浮球：可拖动、位置记忆（pointer 事件同时支持鼠标与触屏） */
const qaFab = $('qa-fab');
const qaWrap = $('qa-wrap');
let qaDrag = null;
(function restoreQaPos() {
  try {
    const p = localStorage.getItem('xmx_qa_pos');
    if (!p) return;
    const [x, y] = p.split(',').map(Number);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      qaFab.style.left = x + 'px';
      qaFab.style.top = y + 'px';
      qaFab.style.right = 'auto';
      qaFab.style.bottom = 'auto';
    }
  } catch { /* 忽略损坏记录 */ }
})();
function positionQaPanel() {
  const r = qaFab.getBoundingClientRect();
  const pw = Math.min(380, window.innerWidth - 12);
  const x = Math.max(6, Math.min(window.innerWidth - pw - 6, r.left + r.width / 2 - pw / 2));
  qaWrap.style.left = x + 'px';
  qaWrap.style.right = 'auto';
  qaWrap.style.bottom = 'auto';
  qaWrap.style.top = Math.max(6, r.top - 8) + 'px';
  qaWrap.style.transform = 'translateY(-100%)';
}
qaFab.addEventListener('pointerdown', e => {
  qaDrag = { sx: e.clientX, sy: e.clientY, ox: qaFab.offsetLeft, oy: qaFab.offsetTop, moved: false };
  qaFab.setPointerCapture(e.pointerId);
  e.preventDefault();
});
qaFab.addEventListener('pointermove', e => {
  if (!qaDrag) return;
  const dx = e.clientX - qaDrag.sx, dy = e.clientY - qaDrag.sy;
  if (Math.abs(dx) > 4 || Math.abs(dy) > 4) qaDrag.moved = true;
  if (qaDrag.moved) {
    qaFab.style.left = Math.max(0, Math.min(window.innerWidth - 52, qaDrag.ox + dx)) + 'px';
    qaFab.style.top = Math.max(0, Math.min(window.innerHeight - 52, qaDrag.oy + dy)) + 'px';
    qaFab.style.right = 'auto';
    qaFab.style.bottom = 'auto';
    if (!qaWrap.classList.contains('hidden')) positionQaPanel();
  }
});
qaFab.addEventListener('pointerup', () => {
  if (!qaDrag) return;
  const moved = qaDrag.moved;
  qaDrag = null;
  if (moved) localStorage.setItem('xmx_qa_pos', `${qaFab.style.left.replace('px', '')},${qaFab.style.top.replace('px', '')}`);
  else toggleQa();
});
window.addEventListener('resize', () => {
  if (!qaWrap.classList.contains('hidden')) positionQaPanel();
});
$('qa-close').addEventListener('click', toggleQa);
$('qa-send').addEventListener('click', sendQa);
$('qa-input').addEventListener('keydown', e => { if (e.key === 'Enter') sendQa(); });

/* ---------- 模态 ---------- */
function showModal(id) { $(id).classList.remove('hidden'); }
function hideModal(id) { $(id).classList.add('hidden'); }
function toggleModal(id) { $(id).classList.toggle('hidden'); }

/* ---------- 事件绑定 ---------- */
$('btn-send').addEventListener('click', () => send($('cmd').value) && ($('cmd').value = ''));

/* ---------- 语音输入：讯飞听写（优先）→ 内置识别（兜底）
 * 关键：AudioContext 必须在用户手势内创建并 resume，否则保持 suspended、录音无数据（"点了没反应"） ---------- */
(() => {
  const mic = $('btn-mic');
  const meter = $('voice-meter');
  const cmd = $('cmd');
  if (!mic) return;
  let engine = 'none';           // 'xfyun' | 'builtin' | 'none'
  let busy = false;
  let liveCtx = null;            // 用户手势内创建的 AudioContext

  const PH = '输入你的行动：向东 / 打坐修炼 / 与钱掌柜交谈 / 查看背包 / 帮助 …';
  const setListening = on => {
    mic.classList.toggle('on', on);
    if (meter) meter.classList.toggle('on', on);
    cmd.placeholder = on ? '正在聆听…（说完停顿自动结束）' : PH;
  };

  /* 输入框附近的小弹窗反馈（不污染剧情卡） */
  let toastTimer = null;
  const toast = (msg, kind = '') => {
    const el = $('voice-toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'voice-toast show' + (kind ? ' ' + kind : '');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'voice-toast'; }, 2600);
  };

  const fail = (msg) => {
    setListening(false);
    mic.title = msg;
    toast(msg, 'err');
    busy = false;
  };

  /* 启动时探测可用引擎 */
  const probe = async () => {
    try {
      const r = await fetch('/api/stt/auth').then(x => x.json());
      if (r && r.ok && r.url) { engine = 'xfyun'; mic.title = '语音输入（讯飞听写 · 说中文自动转文字）'; return; }
    } catch { /* fallthrough */ }
    if (window.SpeechRecognition || window.webkitSpeechRecognition) {
      engine = 'builtin';
      mic.title = '语音输入（浏览器内置 · 说中文自动转文字 · 需联网）';
      return;
    }
    mic.classList.add('hidden');
  };
  probe();

  /* 波形指示：音量 → 四条小竖条 */
  let lvlAcc = 0, lvlN = 0;
  const setLevel = rms => {
    if (!meter || !meter.classList.contains('on')) return;
    const v = Math.min(1, rms * 7);
    for (let i = 0; i < meter.children.length; i++) {
      const h = Math.max(4, Math.round(v * (0.35 + 0.22 * (i % 2)) * 100));
      meter.children[i].style.height = h + '%';
    }
  };

  let appIdHint = '';
  let rec = null;
  const startBuiltin = () => {
    if (!rec) {
      rec = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
      rec.lang = 'zh-CN';
      rec.continuous = false;
      rec.interimResults = false;
      rec.onresult = ev => {
        const txt = Array.from(ev.results || []).map(r => r[0].transcript).join('，').trim();
        cmd.value = (cmd.value ? cmd.value.trimEnd() + '，' : '') + txt;
        setListening(false); busy = false;
      };
      rec.onerror = () => fail('听音落空：内置识别需联网，可重试或直接打字');
      rec.onend = () => { setListening(false); busy = false; };
    }
    rec.start();
    setListening(true);
  };

  /* 讯飞 iat：录音（16k PCM）→ 流式帧 → 增量识别（识别文字实时显示在输入框） */
  const startXfyun = async (url, ctx) => {
    const preText = cmd.value;
    let stream = null, src = null, node = null, ws = null, timer = null, totalTimer = null;
    let opened = false, done = false;
    let frame = [];               // 累积 Int16 采样
    let finalText = '';

    const sendFrame = status => {
      if (!opened || done) return;
      try {
        const bytes = new Uint8Array(frame.length * 2);
        const dv = new DataView(bytes.buffer);
        for (let i = 0; i < frame.length; i++) dv.setInt16(i * 2, frame[i], true);
        frame = [];
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        ws.send(JSON.stringify({
          common: { app_id: appIdHint },
          business: { language: 'zh_cn', domain: 'iat', accent: 'mandarin', vad_eos: 2500, dwa: 'wpgs', ptt: 0 },
          data: { status, format: 'audio/L16;rate=16000', encoding: 'raw', audio: btoa(bin) },
        }));
      } catch { /* ignore */ }
    };
    /* 实时显示已识别文字（wpgs 增量，边说边填） */
    const fillLive = () => {
      const t = finalText.trim();
      if (!t) return;
      cmd.value = preText ? preText.trimEnd() + '，' + t : t;
    };

    const finish = () => {
      if (done) return;
      if (opened) sendFrame(2); // 收尾帧：让服务器结算已识别内容（先于 done 置位）
      done = true;
      if (timer) clearInterval(timer);
      if (totalTimer) clearTimeout(totalTimer);
      try { if (node) { node.onaudioprocess = null; node.disconnect(); } } catch {}
      try { if (src) src.disconnect(); } catch {}
      try { if (stream) stream.getTracks().forEach(t => t.stop()); } catch {}
      try { if (ctx && ctx.state !== 'closed') ctx.close(); liveCtx = null; } catch {}
      setTimeout(() => { try { if (ws) ws.close(); } catch {} }, 400);
      mic.onclick = null;
      busy = false;
      setListening(false);
      const t = finalText.trim();
      if (t) { toast(`已转录：${t.length > 12 ? t.slice(0, 12) + '…' : t}`, 'ok'); }
      else { toast('未识别到话语——可检查麦克风是否被占用，或靠近一些再说', 'warn'); }
    };

    /* 麦克风：失败给出明确提示（不静默） */
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      fail('无法使用麦克风（请允许系统/游戏麦克风权限后重试）');
      return;
    }
    try {
      if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
      if (ctx.state !== 'running') { fail('录音启动被浏览器限制，请再次点击麦克风重试'); return; }
      src = ctx.createMediaStreamSource(stream);
      node = ctx.createScriptProcessor(4096, 1, 1);
      /* 采样率自适应：ctx.sampleRate 可能不是 16000（部分设备忽略 AudioContext 采样率选项），
         必须手动重采样到 16k 再发送，否则讯飞报 10008 或识别为空（时间轴错乱）。
         正确实现：输入计数 / 比率 = 应输出数，逐样本补足（48k→16k 每 3 个输入输出 1 个） */
      const inRate = ctx.sampleRate || 48000;
      const ratio = inRate / 16000;
      let inCnt = 0, outCnt = 0;
      node.onaudioprocess = e => {
        if (done) return;
        const d = e.inputBuffer.getChannelData(0);
        let sum = 0;
        for (let i = 0; i < d.length; i++) {
          const s = Math.max(-1, Math.min(1, d[i]));
          sum += s * s;
          inCnt++;
          const target = Math.floor(inCnt / ratio);
          while (outCnt < target) {
            outCnt++;
            frame.push(s < 0 ? s * 0x8000 : s * 0x7FFF);
          }
        }
        if (frame.length >= 640) sendFrame(1); // 40ms=1280B 一帧（16k）
        lvlAcc += Math.sqrt(sum / d.length); lvlN++;
        if (lvlN >= 4) { setLevel(lvlAcc / lvlN); lvlAcc = 0; lvlN = 0; }
      };
      src.connect(node);
      /* ScriptProcessor 必须连入 destination 链才会被 Chromium 处理（否则 onaudioprocess 永不触发）。
         用零音量增益节点承接：既保证处理发生，又不会把麦克风声音回放到扬声器（防回声） */
      const mute = ctx.createGain();
      mute.gain.value = 0;
      node.connect(mute);
      mute.connect(ctx.destination);
    } catch (e) {
      fail('录音初始化失败（可重试或直接打字）');
      return;
    }

    ws = new WebSocket(url);
    timer = setInterval(() => { if (!done && opened && frame.length >= 640) sendFrame(1); }, 250); // 兜底定时冲刷
    totalTimer = setTimeout(() => { if (!done) { fillLive(); finish(); } }, 60000); // 总超时60s：防静音/断连时永久卡死
    ws.onopen = () => { opened = true; sendFrame(0); };    ws.onmessage = ev => {
      try {
        const m = JSON.parse(ev.data);
        if (m.code !== 0) {
          const hint = m.code === 11200 ? '（鉴权失败，请检查讯飞凭证）' : m.code === 11201 ? '（免费次数已用完）' : '';
          fail(`听写失败（${m.code}）${hint}，可重试或直接打字`);
          finish();
          return;
        }
        if (m.data && m.data.result && m.data.result.text) {
          finalText += m.data.result.text;
          fillLive(); // 实时显示
        }
        if (m.data && m.data.status === 2) {
          fillLive();
          finish();
        }
      } catch { /* ignore */ }
    };
    ws.onerror = () => { if (!done) { fail('听写连接异常，可重试或直接打字'); finish(); } };
    ws.onclose = () => { if (!done) { fillLive(); finish(); } };

    setListening(true);
    mic.title = '聆听中…点击停止';
    mic.onclick = () => finish(); // 手动点停：保留已识别文字
  };

  mic.addEventListener('click', async () => {
    if (busy) return;
    /* 用户手势内：预建音频上下文（防 suspended 导致录音无数据） */
    if (engine === 'xfyun' && !liveCtx) {
      try { liveCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 }); }
      catch { liveCtx = null; }
    }
    busy = true;
    mic.classList.add('on');
    try {
      if (engine === 'xfyun') {
        if (!liveCtx) { fail('无法启动录音（浏览器限制），请重试或直接打字'); return; }
        if (liveCtx.state === 'suspended') await liveCtx.resume().catch(() => {});
        const r = await fetch('/api/stt/auth').then(x => x.json());
        if (r && r.ok) { appIdHint = r.appId || ''; await startXfyun(r.url, liveCtx); return; }
        engine = 'builtin';
      }
      if (engine === 'builtin') { startBuiltin(); return; }
      fail('当前环境不支持语音输入');
    } catch (e) {
      fail('无法使用麦克风（请检查系统录音权限）');
    }
    busy = false;
  });
})();

$('cmd').addEventListener('keydown', e => {
  if (e.key === 'Enter') { send($('cmd').value); $('cmd').value = ''; }
  if (e.key === 'ArrowUp' && app.cmdHist.length) {
    e.preventDefault();
    if (app.histIdx >= app.cmdHist.length) {
      // 首次上翻：保存当前草稿，进入历史
      draft = $('cmd').value;
      app.histIdx = app.cmdHist.length - 1;
    } else {
      app.histIdx = Math.max(0, app.histIdx - 1);
    }
    $('cmd').value = app.cmdHist[app.histIdx];
    $('cmd').setSelectionRange($('cmd').value.length, $('cmd').value.length);
  }
  if (e.key === 'ArrowDown') {
    if (app.histIdx >= app.cmdHist.length) return; // 不在历史浏览中：绝不碰输入内容
    e.preventDefault();
    app.histIdx = Math.min(app.cmdHist.length, app.histIdx + 1);
    if (app.histIdx >= app.cmdHist.length) {
      $('cmd').value = draft || ''; // 回到草稿，而非清空
      draft = null;
    } else {
      $('cmd').value = app.cmdHist[app.histIdx];
    }
  }
});

$('btn-slots').addEventListener('click', showSlots);
$('btn-life').addEventListener('click', openLife);
$('btn-guide').addEventListener('click', () => openGuide(false));
$('btn-guide-close').addEventListener('click', () => {
  localStorage.setItem(GUIDE_KEY, JSON.stringify(guideState())); // 已看过指引：此后不再自动弹出
  hideModal('m-guide');
});
$('btn-snap-save').addEventListener('click', async () => {
  if (!app.snapSlot) return;
  const name = $('snap-name').value.trim();
  const res = await api('/api/snapshot', { slot: app.snapSlot, name });
  if (res.ok) renderSnaps(app.snapSlot, res.list);
});
$('btn-export').addEventListener('click', doExport);
$('btn-import').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', e => { if (e.target.files[0]) doImport(e.target.files[0]); e.target.value = ''; });
$('btn-new-go').addEventListener('click', startNewGame);
$('new-name').addEventListener('keydown', e => { if (e.key === 'Enter') startNewGame(); });
$('btn-revive').addEventListener('click', doRevive);
$('btn-reinc').addEventListener('click', doReincarnate);
$('btn-nokey-retry').addEventListener('click', () => { hideModal('m-nokey'); location.reload(); });

/* 赐名 / 改名 */
$('btn-rename').addEventListener('click', () => {
  if (!app.st) return;
  const name = prompt(`当前名讳：${app.st.name}\n赐予新的名讳（NPC 将以此相称）：`, app.st.name);
  if (!name || name.trim() === app.st.name) return;
  api('/api/name', { slot: app.slot, name: name.trim() }).then(res => {
    if (res.ok) { appendTurn(res); renderState(res.state); }
    else alert(res.error?.msg || '赐名失败');
  });
});

/* 闭关选项 */
document.querySelectorAll('#m-idle .idle-opts .btn').forEach(b => b.addEventListener('click', () => startIdle(Number(b.dataset.min))));

/* 行囊物品点击 → 生成动作 */
$('c-bag').addEventListener('click', e => {
  const item = e.target.closest('.item');
  if (!item || app.busy) return;
  const name = item.dataset.item;
  const action = confirm(`【${name}】\n「确定」使用它\n「取消」装备/收起\n（使用：服用/食用类；装备：武器衣甲类）`) ? `使用${name}` : `查看${name}`;
  send(action);
});

document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => hideModal(b.closest('.modal-mask').id)));

window.addEventListener('keydown', e => { if (e.key === 'Escape') document.querySelectorAll('.modal-mask:not(.hidden)').forEach(m => hideModal(m.id)); });

bootstrap();
audioInit(); // 音频系统：首次交互后启动，随场景切换 BGM
