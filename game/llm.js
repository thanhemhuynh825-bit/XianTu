'use strict';

/* ============================================================
 * 《仙途·苍玄界》 — 模型调用层
 * OpenAI 兼容协议（默认 DeepSeek），带超时、重试、容错 JSON 解析。
 * ============================================================ */

const fs = require('fs');
const path = require('path');

/* 密钥优先级：config.json → 环境变量 → opencode 的 auth.json（与本终端同源） */
function resolveKey() {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY;
  const candidates = [
    path.join(__dirname, '..', 'config.json'),
    path.join(process.env.USERPROFILE || '~', '.local', 'share', 'opencode', 'auth.json'),
  ];
  for (const p of candidates) {
    try {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (p.endsWith('config.json') && j.apiKey) return j.apiKey;
      if (j.deepseek && j.deepseek.key) return j.deepseek.key;
    } catch { /* 继续找 */ }
  }
  return '';
}

function stripBom(s) { return s.replace(/^\uFEFF/, ''); }

function loadConfig() {
  const bundled = path.join(__dirname, '..', 'config.json');
  const external = process.env.XMUD_CONFIG_DIR ? path.join(process.env.XMUD_CONFIG_DIR, 'config.json') : null;
  const p = (external && fs.existsSync(external)) ? external : bundled;
  const cfg = JSON.parse(stripBom(fs.readFileSync(p, 'utf8')));
  cfg.apiKey = resolveKey();
  return cfg;
}

/* 容错 JSON 提取：直接解析 → 代码块 → 括号配对截取 */
function extractJson(text) {
  if (!text) return null;
  const t = text.trim();
  try { return JSON.parse(t); } catch { /* fallthrough */ }
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1].trim()); } catch { /* fallthrough */ } }
  const s = t.indexOf('{');
  if (s >= 0) {
    const chunk = t.slice(s);
    let depth = 0, inStr = false, esc = false;
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk[i];
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (inStr) { if (c === '"') inStr = false; continue; }
      if (c === '"') { inStr = true; continue; }
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { try { return JSON.parse(chunk.slice(0, i + 1)); } catch { return null; } } }
    }
  }
  return null;
}

class GMError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

/* 调用一次对话补全，返回 { json, raw }。
 * v4-flash 对"长上下文+JSON模式"偶发空白响应：自动重试（保持 JSON 模式），
 * 仍失败则切换到兜底模型（默认 deepseek-v4-pro，该模型无此问题）。 */
async function chat(cfg, system, messages, useJson = true, maxTokens = null, attempts = 1) {
  if (!cfg.apiKey) throw new GMError('NO_KEY', '尚未配置 DeepSeek API Key（config.json 或环境变量 DEEPSEEK_API_KEY）');

  const budget = maxTokens || cfg.maxTokens || 4096;
  const model = attempts >= 2 && cfg.fallbackModel ? cfg.fallbackModel : (cfg.model || 'deepseek-v4-flash');
  const body = {
    model,
    messages: [{ role: 'system', content: system }, ...messages],
    temperature: cfg.temperature ?? 0.9,
    max_tokens: budget,
    stream: false,
  };
  if (cfg.disableThinking !== false) body.thinking = { type: 'disabled' }; // v4 系列思考模型：游戏回合无需长篇推理
  if (useJson && cfg.useJsonMode !== false) body.response_format = { type: 'json_object' };

  let res;
  try {
    res = await fetch(cfg.baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180000),
    });
  } catch (e) {
    throw new GMError('NETWORK', `无法连接模型服务：${e.message}`);
  }

  if (res.status === 400 && useJson && /response_format/i.test((await res.text().catch(() => '')))) {
    return chat(cfg, system, messages, false, maxTokens, attempts); // 模型不支持 json_object，退回纯文本再解析
  }
  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    if (res.status === 401) throw new GMError('AUTH', 'API Key 无效或已过期');
    if (res.status === 429) throw new GMError('RATE', '请求过于频繁（限流），请稍后再试');
    throw new GMError('HTTP', `模型服务返回错误 ${res.status}：${msg.slice(0, 200)}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || '';
  const finish = data.choices?.[0]?.finish_reason;
  const json = extractJson(content);

  /* 显式纯文本模式（如天机问答）：不要求 JSON，直接返回正文 */
  if (!useJson && !json && content.trim()) return { json: { narration: content }, raw: content };

  if (!json && attempts < 3) {
    const hint = finish === 'length'
      ? `（上轮输出被预算截断，请精简叙事，务必输出完整 JSON）`
      : `（上轮输出无效：请只输出一个符合协议的 JSON 对象）`;
    const fixed = messages.slice();
    const last = { ...fixed[fixed.length - 1] };
    last.content = last.content + '\n\n' + hint;
    fixed[fixed.length - 1] = last;
    return chat(cfg, system, fixed, true, finish === 'length' ? Math.min(8192, budget * 2) : maxTokens, attempts + 1);
  }
  if (!json) {
    const e = new GMError('PARSE', '模型多次返回无法解析的内容，请重试。');
    e.raw = content;
    e.finish = finish;
    throw e;
  }
  return { json, raw: content };
}

module.exports = { loadConfig, chat, extractJson, GMError };
