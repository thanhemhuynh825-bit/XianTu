'use strict';
/* ============================================================
 * 《仙途》— 音频系统
 * 场景化 BGM：优先播放 audio/ 目录下按约定命名的音乐文件，
 * 无文件时用 Web Audio 程序化生成五声音阶氛围乐兜底。
 * 场景标签：menu / town / wild / dark / battle / meditate
 * ============================================================ */

const AudioSys = (() => {
  let ctx = null;
  let master = null;
  let musicGain = null;
  let current = { tag: null, type: null, src: null, fadeTo: 0 };
  let genNodes = []; // 程序化音乐的活动节点
  let settings = { music: true, volume: 0.5 };
  let sceneTimer = null;
  const GAME_BGM = 'audio/游戏BGM.mp3'; // 玩家自定义单曲循环 BGM
  let singleMode = false; // true：已加载玩家 BGM，全局单曲循环，不再随场景切换

  /* ---------- 场景判定（由外部调用方驱动） ---------- */
  const TAGS = [
    { tag: 'battle', test: st => !!(st.enemy && st.enemy.name) },
    { tag: 'meditate', test: st => !!st.idle },
    { tag: 'dark', test: st => /谷|渊|墓|陵|窟|崖|塔/.test(st.location && st.location.area || '') },
    { tag: 'town', test: st => /镇|城|坊市|村/.test(st.location && st.location.area || '') },
    { tag: 'wild', test: st => true },
  ];
  function sceneOf(st) {
    if (!st) return 'menu';
    for (const t of TAGS) if (t.test(st)) return t.tag;
    return 'wild';
  }

  function ensureCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = settings.music ? settings.volume : 0;
      master.connect(ctx.destination);
      musicGain = ctx.createGain();
      musicGain.gain.value = 0.85;
      musicGain.connect(master);
    }
    return ctx;
  }

  /* ---------- 程序化氛围乐（五声音阶 C D E G A） ---------- */
  const PENTA = [261.63, 293.66, 329.63, 392.0, 440.0];
  function genStop() {
    for (const n of genNodes) { try { n.stop(); } catch { /* ignore */ } }
    genNodes = [];
  }
  function genStart(tag) {
    genStop();
    const c = ensureCtx();
    const mood = {
      battle: { base: 196.0, step: 260, dur: 0.5, lfo: 6, low: 130 },
      dark: { base: 146.83, step: 420, dur: 3.2, lfo: 0.08, low: 98 },
      meditate: { base: 220.0, step: 900, dur: 4.0, lfo: 0.05, low: 110 },
      town: { base: 246.94, step: 260, dur: 2.2, lfo: 0.06, low: 110 },
      wild: { base: 196.0, step: 340, dur: 2.6, lfo: 0.07, low: 110 },
      menu: { base: 220.0, step: 320, dur: 3.0, lfo: 0.05, low: 110 },
    }[tag] || { base: 196, step: 320, dur: 3, lfo: 0.06, low: 110 };

    /* 低音 Pad：轻柔绵长，音量压到最低（氛围垫底，不抢主旋律） */
    const pad = ctx.createGain();
    pad.gain.value = 0.028;
    pad.connect(musicGain);
    const osc1 = ctx.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.value = mood.base;
    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = mood.base * 2;
    const g2 = ctx.createGain();
    g2.gain.value = 0.18;
    osc2.connect(g2); g2.connect(pad);
    osc1.connect(pad);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = mood.lfo;
    const lfoG = ctx.createGain();
    lfoG.gain.value = mood.base * 0.008;
    lfo.connect(lfoG); lfoG.connect(osc1.frequency);
    osc1.start(); osc2.start(); lfo.start();
    genNodes.push(osc1, osc2, lfo);

    /* 五声音阶琶音：主旋律清晰可闻（比 Pad 响得多） */
    let idx = 0;
    function pluck() {
      const t = ctx.currentTime;
      const n = PENTA[idx % PENTA.length] * (tag === 'battle' ? 1 : 0.5);
      idx += tag === 'battle' ? 2 : 1;
      const o = ctx.createOscillator();
      o.type = tag === 'battle' ? 'triangle' : 'sine';
      o.frequency.value = n;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(tag === 'battle' ? 0.09 : 0.06, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + mood.dur);
      o.connect(g); g.connect(musicGain);
      o.start(t); o.stop(t + mood.dur + 0.1);
      genNodes.push(o);
    }
    pluck();
    sceneTimer = setInterval(pluck, tag === 'battle' ? 340 : (mood.step / 1.5));
  }

  /* ---------- 文件音乐 ---------- */
  function fileUrl(tag) {
    return 'audio/' + tag + '.mp3';
  }
  function fileExists(tag, cb) {
    const a = new Audio();
    a.src = fileUrl(tag);
    a.addEventListener('canplaythrough', () => cb(true), { once: true });
    a.addEventListener('error', () => cb(false), { once: true });
  }

  /* ---------- 场景切换（交叉淡化；单曲模式不再切换） ---------- */
  function switchTo(tag) {
    if (!ctx || current.tag === tag || singleMode) return;
    const old = current;
    current = { tag, type: null };
    if (old.src) {
      const g = ctx.createGain();
      old.src.disconnect();
      old.src.connect(g); g.connect(musicGain);
      g.gain.setValueAtTime(musicGain.gain.value, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 2);
      old.src.addEventListener('ended', () => { try { old.src.src = ''; } catch { /* ignore */ } });
      try { old.src.pause(); } catch { /* ignore */ }
    }
    /* 文件优先，缺失用程序化 */
    fileExists(tag, ok => {
      if (current.tag !== tag) return; // 场景又变了
      if (ok) {
        genStop();
        const src = new Audio(fileUrl(tag));
        src.loop = true;
        src.volume = 0;
        src.play().catch(() => {});
        const fade = ctx.createGain();
        src.connect(fade); fade.connect(musicGain);
        fade.gain.setValueAtTime(0.0001, ctx.currentTime);
        fade.gain.exponentialRampToValueAtTime(0.9, ctx.currentTime + 2.2);
        current.src = src;
        current.type = 'file';
      } else {
        genStart(tag);
        current.type = 'gen';
      }
    });
  }

  /* ---------- 对外 ---------- */
  function init() {
    ensureCtx();
    /* 玩家自制 BGM：直接尝试播放（canplay 即起播，不再等全量缓冲），失败/超时才回退程序化 */
    let started = false;
    const src = new Audio(GAME_BGM);
    src.loop = true;
    src.preload = 'auto';
    src.addEventListener('canplay', () => {
      if (started) return;
      started = true;
      singleMode = true;
      genStop();
      src.play().catch(() => {});
      const fade = ctx.createGain();
      src.connect(fade); fade.connect(musicGain);
      fade.gain.setValueAtTime(0.0001, ctx.currentTime);
      fade.gain.exponentialRampToValueAtTime(1, ctx.currentTime + 2.5);
      current = { tag: 'single', type: 'file', src };
    }, { once: true });
    src.addEventListener('error', () => {
      if (!started) { started = true; switchTo('menu'); }
    }, { once: true });
    /* 超时兜底：6 秒未起播则视为加载失败，走程序化 */
    setTimeout(() => {
      if (!started) { started = true; try { src.src = ''; } catch { /* ignore */ } switchTo('menu'); }
    }, 6000);
  }
  function update(st) {
    if (!ctx || singleMode) return; // 单曲模式下世界照常运转，音乐始终循环
    const tag = sceneOf(st);
    switchTo(tag);
  }
  /* 当前音乐来源（设置页显示，确认搭载） */
  function getStatus() {
    return singleMode ? '游戏BGM.mp3（你的音乐 · 单曲循环）' : '内置氛围乐（随场景切换）';
  }
  function setMusic(on) {
    settings.music = on;
    if (ctx) master.gain.value = on ? settings.volume : 0;
    if (!on) genStop();
  }
  function setVolume(v) {
    settings.volume = v;
    if (ctx) master.gain.value = settings.music ? v : 0;
  }
  function load(saved) {
    if (saved) { settings.music = saved.music !== false; settings.volume = saved.volume != null ? saved.volume : 0.5; }
  }
  function dispose() {
    if (sceneTimer) clearInterval(sceneTimer);
    genStop();
    if (ctx) ctx.close().catch(() => {});
    ctx = null;
  }
  return { init, update, setMusic, setVolume, load, sceneOf, dispose, getStatus };
})();

window.AudioSys = AudioSys;
