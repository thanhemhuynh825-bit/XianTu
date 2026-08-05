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
      battle: { base: 130.81, step: 260, dur: 0.5, lfo: 6, low: 90 },
      dark: { base: 110.0, step: 420, dur: 3.2, lfo: 0.08, low: 55 },
      meditate: { base: 196.0, step: 900, dur: 4.0, lfo: 0.05, low: 70 },
      town: { base: 220.0, step: 260, dur: 2.2, lfo: 0.06, low: 60 },
      wild: { base: 174.61, step: 340, dur: 2.6, lfo: 0.07, low: 65 },
      menu: { base: 196.0, step: 320, dur: 3.0, lfo: 0.05, low: 60 },
    }[tag] || { base: 196, step: 320, dur: 3, lfo: 0.06, low: 60 };

    /* 低音 Pad：两个失谐振荡 + 缓慢 LFO 起伏 */
    const pad = ctx.createGain();
    pad.gain.value = 0.06;
    pad.connect(musicGain);
    const osc1 = ctx.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.value = mood.base;
    const osc2 = ctx.createOscillator();
    osc2.type = 'triangle';
    osc2.frequency.value = mood.base * 2.01;
    const g2 = ctx.createGain();
    g2.gain.value = 0.3;
    osc2.connect(g2); g2.connect(pad);
    osc1.connect(pad);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = mood.lfo;
    const lfoG = ctx.createGain();
    lfoG.gain.value = mood.base * 0.012;
    lfo.connect(lfoG); lfoG.connect(osc1.frequency);
    osc1.start(); osc2.start(); lfo.start();
    genNodes.push(osc1, osc2, lfo);

    /* 五声音阶琶音：每 dur 秒一个音符，指数衰减 */
    let idx = 0;
    function pluck() {
      const t = ctx.currentTime;
      const n = PENTA[idx % PENTA.length] * (tag === 'battle' ? 1 : 0.5);
      idx += tag === 'battle' ? 2 : 1;
      const o = ctx.createOscillator();
      o.type = tag === 'battle' ? 'square' : 'sine';
      o.frequency.value = n;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(tag === 'battle' ? 0.05 : 0.035, t + 0.02);
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

  /* ---------- 场景切换（交叉淡化） ---------- */
  function switchTo(tag) {
    if (!ctx || current.tag === tag) return;
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
    switchTo('menu');
  }
  function update(st) {
    if (!ctx) return;
    const tag = sceneOf(st);
    switchTo(tag);
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
  return { init, update, setMusic, setVolume, load, sceneOf, dispose };
})();

window.AudioSys = AudioSys;
