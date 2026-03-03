/**
 * run_eval_deepseek_v3_scan.mjs
 * Evaluation runner: runs 25 evaluation set markets through DeepSeek V3 (deepseek-chat)
 * Profile: SCAN (temperature=0, max_tokens=1000)
 * Serial execution, 1s interval between calls.
 *
 * Usage: HTTPS_PROXY=http://127.0.0.1:51081 node scripts/run_eval_deepseek_v3_scan.mjs
 */

import fs from 'fs';
import path from 'path';
import { fetch as undiciFetch, ProxyAgent } from 'undici';

// --- Config ---
const MODEL = 'deepseek-chat';
const API_BASE = 'https://api.deepseek.com/v1';
const API_KEY = process.env.DEEPSEEK_API_KEY || '';
const PROXY_URL = process.env.HTTPS_PROXY || process.env.https_proxy || '';
const INPUT_FILE = 'data/evaluation_set_v1_260302.jsonl';
const OUT_FILE = 'data/evaluation_run_20260304_deepseek_v3_scan.json';

const PROFILE = {
  name: 'SCAN',
  temperature: 0,
  max_tokens: 1000,
};

// --- Proxy ---
const proxyDispatcher = PROXY_URL ? new ProxyAgent(PROXY_URL) : undefined;
if (PROXY_URL) console.log(`[Eval] Using proxy: ${PROXY_URL}`);

function pfetch(url, opts = {}) {
  if (proxyDispatcher) opts.dispatcher = proxyDispatcher;
  return undiciFetch(url, opts);
}

// --- Load API key from .env if not in env ---
function loadApiKey() {
  if (API_KEY) return API_KEY;
  try {
    const envContent = fs.readFileSync('.env', 'utf8');
    const match = envContent.match(/DEEPSEEK_API_KEY=(.+)/);
    if (match) return match[1].trim();
  } catch (_) {}
  return '';
}

// --- Build prompt (identical to R1) ---
function buildPrompt(market) {
  return `你是一个预测市场估值器。请对以下市场进行分析并返回 JSON。

市场问题：${market.question}
市场ID：${market.id}
到期时间：${market.end_date}
24h成交量：$${market.volume_24h}
分类：${market.categories.join(', ')}

请严格返回以下 JSON 结构（不要添加任何其他文字）：
{
  "p_range": { "low": 0.0, "mid": 0.5, "high": 1.0 },
  "confidence": "High|Med|Low",
  "claims": [
    {
      "claim_text": "断言内容",
      "basis_type": "INPUT|PRIOR|UNVERIFIED_FACT",
      "claim_impact": "MAJOR|MINOR"
    }
  ],
  "risk_triggers": ["trigger1"],
  "rules_text": "该市场的结算规则理解（至少80字符）",
  "rules_unknown": false,
  "bullshit_score": 0,
  "why_1_liner": "一句话解释（≤160字符）",
  "mispricing_type": "THIN|RULE|SLOW|UNKNOWN"
}

注意：
- p_range: low <= mid <= high，均在 [0,1] 范围
- claims: 0-3条断言（SCAN档允许为空）
- bullshit_score: 0-100，衡量信息虚假程度，0=完全可信，100=完全不可信
- rules_text: 你对该市场结算规则的理解，至少80字符
- rules_unknown: 如果你无法确定结算规则则设为true`;
}

// --- Call DeepSeek API ---
async function callDeepSeek(prompt, apiKey) {
  const url = `${API_BASE}/chat/completions`;
  const body = {
    model: MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: PROFILE.temperature,
    max_tokens: PROFILE.max_tokens,
  };

  const resp = await pfetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`API ${resp.status}: ${errText.slice(0, 300)}`);
  }

  return resp.json();
}

// --- Parse LLM JSON output ---
function parseLLMOutput(content) {
  if (!content) return null;
  let jsonStr = content;

  // Strip markdown code fences: ```json ... ``` or ``` ... ```
  const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) jsonStr = fenceMatch[1].trim();

  // Fallback: extract outermost { ... }
  if (!fenceMatch) {
    const braceMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (braceMatch) jsonStr = braceMatch[0];
  }

  try {
    return JSON.parse(jsonStr);
  } catch (_) {
    return null;
  }
}

// --- Compute system scores (identical to R1) ---
function computeSystemScores(output) {
  if (!output) {
    return {
      estimator_trust_score: 0,
      estimator_trust_level: 'RED',
      range_width: null,
      p_valid: false,
    };
  }

  const bullshit = typeof output.bullshit_score === 'number'
    ? Math.max(0, Math.min(100, output.bullshit_score)) : 50;
  const rulesUnknown = output.rules_unknown === true;
  const rulesPenalty = rulesUnknown ? 15 : 0;

  const trustScore = Math.max(0, Math.min(100, 100 - bullshit - rulesPenalty));

  let trustLevel;
  if (trustScore >= 70) trustLevel = 'GREEN';
  else if (trustScore >= 40) trustLevel = 'YELLOW';
  else trustLevel = 'RED';

  // p_range validation
  let pValid = false;
  let rangeWidth = null;
  if (output.p_range) {
    const { low, mid, high } = output.p_range;
    if (typeof low === 'number' && typeof high === 'number' &&
        low >= 0 && high <= 1 && low <= high) {
      pValid = true;
      rangeWidth = parseFloat((high - low).toFixed(4));
      if (typeof mid === 'number' && (mid < low || mid > high)) pValid = false;
    }
  }

  return {
    estimator_trust_score: trustScore,
    estimator_trust_level: trustLevel,
    range_width: rangeWidth,
    p_valid: pValid,
    bullshit_score: bullshit,
    rules_penalty: rulesPenalty,
    rules_unknown: rulesUnknown,
  };
}

// --- Sleep ---
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ===================== main =====================
async function main() {
  const apiKey = loadApiKey();
  if (!apiKey) {
    console.error('[Eval] DEEPSEEK_API_KEY not found. Set env or .env file.');
    process.exit(1);
  }

  // Load evaluation set
  const lines = fs.readFileSync(INPUT_FILE, 'utf8').trim().split('\n');
  const markets = lines.map(l => JSON.parse(l));
  console.log(`[Eval] Loaded ${markets.length} markets from ${INPUT_FILE}`);
  console.log(`[Eval] Model: ${MODEL} | Profile: ${PROFILE.name} | max_tokens: ${PROFILE.max_tokens}`);

  const results = [];
  let successCount = 0;
  let failedCount = 0;
  let totalLatency = 0;
  let totalTokens = 0;
  let totalRangeWidth = 0;
  let rangeWidthCount = 0;
  const trustDist = { GREEN: 0, YELLOW: 0, RED: 0 };
  let estimatorMissing = 0;

  for (let i = 0; i < markets.length; i++) {
    const market = markets[i];
    const num = `[${i + 1}/${markets.length}]`;
    console.log(`${num} ${market.question.slice(0, 60)}...`);

    const prompt = buildPrompt(market);
    const t0 = Date.now();
    let apiResp = null;
    let parsed = null;
    let error = null;

    try {
      apiResp = await callDeepSeek(prompt, apiKey);
      const content = apiResp.choices?.[0]?.message?.content || '';
      parsed = parseLLMOutput(content);
      if (!parsed) {
        error = 'JSON parse failed';
        failedCount++;
      } else {
        successCount++;
      }
    } catch (err) {
      error = err.message;
      failedCount++;
    }

    const latencyMs = Date.now() - t0;
    totalLatency += latencyMs;

    const tokensUsed = apiResp?.usage?.total_tokens || 0;
    totalTokens += tokensUsed;

    const systemComputed = computeSystemScores(parsed);
    trustDist[systemComputed.estimator_trust_level]++;

    if (!parsed || !parsed.p_range) estimatorMissing++;

    if (systemComputed.range_width !== null) {
      totalRangeWidth += systemComputed.range_width;
      rangeWidthCount++;
    }

    const statusIcon = parsed ? 'OK' : 'FAIL';
    console.log(`  ${statusIcon} | trust=${systemComputed.estimator_trust_level} score=${systemComputed.estimator_trust_score} | ${latencyMs}ms | ${tokensUsed} tokens${error ? ' | err=' + error.slice(0, 80) : ''}`);

    results.push({
      market_id: market.id,
      input: {
        question: market.question,
        categories: market.categories,
        end_date: market.end_date,
        volume_24h: market.volume_24h,
      },
      output: parsed || { error },
      system_computed: systemComputed,
      latency_ms: latencyMs,
      tokens_used: tokensUsed,
    });

    // 1s interval between calls
    if (i < markets.length - 1) await sleep(1000);
  }

  const summary = {
    total: markets.length,
    success: successCount,
    failed: failedCount,
    estimator_missing_rate: parseFloat((estimatorMissing / markets.length).toFixed(4)),
    trust_level_dist: trustDist,
    avg_range_width: rangeWidthCount > 0 ? parseFloat((totalRangeWidth / rangeWidthCount).toFixed(4)) : null,
    avg_latency_ms: Math.round(totalLatency / markets.length),
    avg_tokens_used: Math.round(totalTokens / markets.length),
  };

  const output = {
    run_id: '20260304_deepseek_v3_scan',
    model: MODEL,
    profile: PROFILE.name,
    generated_at: new Date().toISOString(),
    results,
    summary,
  };

  const outPath = path.resolve(OUT_FILE);
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n', 'utf8');
  console.log(`\n[Eval] Wrote ${outPath}`);

  console.log('\n=== Evaluation Summary ===');
  console.log(`Total:                  ${summary.total}`);
  console.log(`Success:                ${summary.success}`);
  console.log(`Failed:                 ${summary.failed}`);
  console.log(`Estimator missing rate: ${summary.estimator_missing_rate}`);
  console.log(`Trust level dist:       GREEN=${trustDist.GREEN} YELLOW=${trustDist.YELLOW} RED=${trustDist.RED}`);
  console.log(`Avg range width:        ${summary.avg_range_width}`);
  console.log(`Avg latency:            ${summary.avg_latency_ms}ms`);
  console.log(`Avg tokens:             ${summary.avg_tokens_used}`);
  console.log('==========================');

  // --- R1 comparison ---
  console.log('\n=== R1 comparison ===');
  console.log(`Latency:      V3 ${summary.avg_latency_ms}ms vs R1 54434ms`);
  console.log(`Token usage:  V3 ${summary.avg_tokens_used} vs R1 2264`);
  console.log(`Trust dist:   V3 GREEN=${trustDist.GREEN} YELLOW=${trustDist.YELLOW} RED=${trustDist.RED} vs R1 GREEN=24 YELLOW=1 RED=0`);
  console.log(`Range width:  V3 ${summary.avg_range_width} vs R1 0.326`);
  console.log('=====================');
}

main().catch(err => {
  console.error(`[Eval] Fatal: ${err.message}`);
  process.exit(1);
});
