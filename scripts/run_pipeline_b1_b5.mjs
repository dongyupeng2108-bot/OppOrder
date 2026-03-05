/**
 * run_pipeline_b1_b5.mjs
 * Full B1→B5 pipeline on evaluation_set_v1_260302.jsonl (25 markets).
 * Live mode: DeepSeek Reasoner (BASELINE profile, max_tokens=4096).
 *
 * Live price: Fetches current yes_price from Polymarket Gamma API before pipeline.
 *   HTTPS_PROXY=http://127.0.0.1:51081, 500ms interval between requests.
 *   Markets that fail price fetch are skipped (not fallback to 0.5).
 *
 * Flow per market:
 *   B1 estimator → B2 veto → B3 risk → B4 filter
 * After all markets:
 *   B5 ranker → ranked output
 *
 * Output: data/pipeline_run_live_20260304.json
 *
 * Usage: node scripts/run_pipeline_b1_b5.mjs
 *   Env: DEEPSEEK_API_KEY (required for live mode)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import nodeFetch from 'node-fetch';
import httpsProxyAgentPkg from 'https-proxy-agent';
const { HttpsProxyAgent } = httpsProxyAgentPkg;
import {
  buildEstimatorPrompt,
  normalizeLLMOutput,
  computeSystemFields,
  assembleEstimatorOutput,
  mockEstimatorOutput,
} from '../OppRadar/estimator_v1.mjs';
import { runVeto }              from '../OppRadar/veto_v1.mjs';
import { assessRisk }           from '../OppRadar/risk_v1.mjs';
import { classifyOpportunity }  from '../OppRadar/filter_v1.mjs';
import { rankOpportunities }    from '../OppRadar/ranker_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

// ── .env loader ──────────────────────────────────────────────────────────────
const ENV_PATH = path.join(PROJECT_ROOT, '.env');
if (fs.existsSync(ENV_PATH)) {
  const lines = fs.readFileSync(ENV_PATH, 'utf8').split('\n');
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    if (k && v && !process.env[k]) process.env[k] = v;
  }
}

// ── Proxy agent for Gamma API ────────────────────────────────────────────────
const PROXY_URL = 'http://127.0.0.1:51081';
const proxyAgent = new HttpsProxyAgent(PROXY_URL);
const GAMMA_DELAY_MS = 500;

async function fetchYesPrice(slug) {
  const url = `https://gamma-api.polymarket.com/markets?slug=${encodeURIComponent(slug)}`;
  const resp = await nodeFetch(url, { agent: proxyAgent, timeout: 15_000 });
  if (!resp.ok) throw new Error(`Gamma HTTP ${resp.status}`);
  const data = await resp.json();
  // API returns an array; take first element
  const market = Array.isArray(data) ? data[0] : data;
  if (!market || !market.outcomePrices) throw new Error('No outcomePrices in response');
  const prices = typeof market.outcomePrices === 'string'
    ? JSON.parse(market.outcomePrices)
    : market.outcomePrices;
  const yesPrice = parseFloat(prices[0]);
  if (isNaN(yesPrice)) throw new Error(`Invalid yes_price: ${prices[0]}`);
  return yesPrice;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Config from BASELINE profile ─────────────────────────────────────────────
const profilePath = path.join(PROJECT_ROOT, 'OppRadar/contracts/profile_config_v1.json');
const profileConfig = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
const BASELINE = profileConfig.profiles.BASELINE;
const MODEL     = BASELINE.model_key;   // deepseek-reasoner
const MAX_TOKENS = BASELINE.max_tokens; // 4096

const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';
const TIMEOUT_MS = 120_000; // 120s for reasoner model
const SYSTEM_PROMPT = '你是一个预测市场概率分析师。请对以下市场机会进行结构化分析，严格返回 JSON，不要有任何其他文字。';

const AS_OF = new Date().toISOString();

// ── CLI args ─────────────────────────────────────────────────────────────────
const CLI_LIMIT  = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1]) || 0;
const CLI_OUTPUT = process.argv.find(a => a.startsWith('--output='))?.split('=')[1] || '';

// ── Paths ────────────────────────────────────────────────────────────────────
const EVAL_SET_PATH = path.join(PROJECT_ROOT, 'data/evaluation_set_v1_260302.jsonl');
const OUTPUT_PATH   = CLI_OUTPUT
  ? path.join(PROJECT_ROOT, CLI_OUTPUT)
  : path.join(PROJECT_ROOT, 'data/pipeline_run_live_20260304.json');

// ── DeepSeek API call ────────────────────────────────────────────────────────
async function callDeepSeek(userPrompt) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY not set');

  const body = JSON.stringify({
    model: MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: MAX_TOKENS,
    stream: false,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response;
  try {
    response = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`DeepSeek HTTP ${response.status}: ${errText.slice(0, 300)}`);
  }

  return response.json();
}

// ── JSON extractor ───────────────────────────────────────────────────────────
function extractJson(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (_) {}
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fence) { try { return JSON.parse(fence[1]); } catch (_) {} }
  const brace = raw.match(/\{[\s\S]*\}/);
  if (brace) { try { return JSON.parse(brace[0]); } catch (_) {} }
  return null;
}

// ── B1: Estimator (live) ─────────────────────────────────────────────────────
async function runEstimatorLive(market) {
  const prompt = buildEstimatorPrompt(market);
  const t0 = Date.now();

  const apiResult = await callDeepSeek(prompt);
  const latency_ms = Date.now() - t0;

  // deepseek-reasoner: content is in choices[0].message.content
  const rawContent = apiResult?.choices?.[0]?.message?.content || '';
  const parsed = extractJson(rawContent);
  const llmFields = normalizeLLMOutput(parsed);
  const yesPrice = market.yes_price != null ? market.yes_price : 0.5;
  const systemFields = computeSystemFields(llmFields, yesPrice);

  return assembleEstimatorOutput({
    llmFields,
    systemFields,
    model: MODEL,
    latency_ms,
    provider: 'live',
    fallback: !parsed,
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`[pipeline] Model: ${MODEL} | max_tokens: ${MAX_TOKENS}`);
  console.log(`[pipeline] Loading evaluation set...`);

  const lines = fs.readFileSync(EVAL_SET_PATH, 'utf8').trim().split('\n');
  let markets = lines.map(l => JSON.parse(l));
  if (CLI_LIMIT > 0) markets = markets.slice(0, CLI_LIMIT);
  console.log(`[pipeline] ${markets.length} markets loaded${CLI_LIMIT ? ` (limited to ${CLI_LIMIT})` : ''}.`);

  // ── Fetch live yes_price from Polymarket Gamma API ──────────────────────
  console.log(`[pipeline] Fetching live prices from Gamma API (proxy: ${PROXY_URL})...`);
  const priced = [];
  for (let i = 0; i < markets.length; i++) {
    const m = markets[i];
    const short = (m.question || m.slug || '').slice(0, 50);
    try {
      const yp = await fetchYesPrice(m.slug);
      m.yes_price = yp;
      if (yp === 0 || yp === 1) {
        console.log(`  [${i + 1}/${markets.length}] [SKIP] 已结算市场：${m.question || m.slug}`);
      } else {
        priced.push(m);
        console.log(`  [${i + 1}/${markets.length}] yes_price=${yp.toFixed(4)} — ${short}`);
      }
    } catch (err) {
      console.warn(`  [${i + 1}/${markets.length}] SKIP (price fetch failed: ${err.message}) — ${short}`);
    }
    if (i < markets.length - 1) await sleep(GAMMA_DELAY_MS);
  }
  markets = priced;
  console.log(`[pipeline] ${markets.length} active markets (${lines.length - markets.length} excluded: settled or price-fetch failed).`);

  const candidates = [];
  let success = 0;
  let failed = 0;

  const trustDist  = { GREEN: 0, YELLOW: 0, RED: 0 };
  const vetoDist   = { GREEN: 0, YELLOW: 0, RED: 0 };
  const riskDist   = { HIGH: 0, MED: 0, LOW: 0 };
  const filterDist = { BLOCKED: 0, THIN: 0, RULE: 0, SLOW: 0, UNKNOWN: 0 };

  for (let i = 0; i < markets.length; i++) {
    const m = markets[i];
    const meta = { ...m, as_of_utc: AS_OF };
    const tag = `[${i + 1}/${markets.length}]`;
    const short = (m.question || m.slug || '').slice(0, 50);

    try {
      // B1: Estimator
      console.log(`${tag} B1 estimator: ${short}...`);
      const estimator = await runEstimatorLive(m);
      console.log(`${tag}   trust=${estimator.estimator_trust_level} dev_abs=${estimator.dev_abs} latency=${estimator.latency_ms}ms fallback=${estimator._fallback}`);

      // B2: Veto
      const veto = runVeto({ estimatorOutput: estimator, market: meta });
      console.log(`${tag}   veto=${veto.veto_light} codes=[${veto.veto_codes.join(',')}]`);

      // B3: Risk
      const risk = assessRisk(estimator, meta);
      console.log(`${tag}   risk=${risk.risk_level} reason=${risk.reason}`);

      // B4: Filter
      const filter = classifyOpportunity(estimator, veto, risk, meta);
      console.log(`${tag}   filter=${filter.label} skip=${filter.skip}`);

      // Collect distributions
      trustDist[estimator.estimator_trust_level]++;
      vetoDist[veto.veto_light]++;
      riskDist[risk.risk_level]++;
      filterDist[filter.label]++;

      candidates.push({ market: meta, estimator, veto, risk, filter });
      success++;
    } catch (err) {
      console.error(`${tag} FAILED: ${err.message}`);

      // Fallback to mock so pipeline continues
      try {
        const estimator = mockEstimatorOutput(m);
        const veto = runVeto({ estimatorOutput: estimator, market: meta });
        const risk = assessRisk(estimator, meta);
        const filter = classifyOpportunity(estimator, veto, risk, meta);

        trustDist[estimator.estimator_trust_level]++;
        vetoDist[veto.veto_light]++;
        riskDist[risk.risk_level]++;
        filterDist[filter.label]++;

        candidates.push({ market: meta, estimator, veto, risk, filter });
      } catch (_) {}

      failed++;
    }
  }

  // B5: Ranker
  console.log(`\n[pipeline] B5 ranker: ${candidates.length} candidates...`);
  const ranked = rankOpportunities(candidates);
  console.log(`[pipeline] ranked=${ranked.ranked_count} skipped=${ranked.skipped_count}`);

  // Build opp_id → candidate lookup
  const byOppId = {};
  for (const c of candidates) byOppId[c.market.id] = c;

  // ── Print full details for all candidates ────────────────────────────────
  console.log(`\n${'='.repeat(80)}`);
  console.log(`  FULL DETAILS — ${candidates.length} candidates`);
  console.log(`${'='.repeat(80)}`);
  for (let i = 0; i < ranked.top_n.length; i++) {
    const r = ranked.top_n[i];
    const c = byOppId[r.opp_id] || {};
    const m = c.market || {};
    const est = r.estimator || c.estimator || {};
    const veto = r.veto || c.veto || {};
    const risk = r.risk || c.risk || {};
    const filter = r.filter || c.filter || {};
    console.log(`\n[${i + 1}] ${r.question || m.question || '?'}`);
    console.log(`    opp_id:     ${r.opp_id}`);
    console.log(`    yes_price:  ${m.yes_price ?? 'N/A'}`);
    console.log(`    score:      ${r.score}  rank: ${r.rank}`);
    console.log(`    p_mid:      ${est.p_mid ?? 'N/A'}  dev_abs: ${est.dev_abs ?? 'N/A'}  dev_flag: ${est.dev_flag ?? 'N/A'}`);
    console.log(`    trust:      ${est.estimator_trust_level ?? '?'}  veto: ${veto.veto_light ?? '?'}  risk: ${risk.risk_level ?? '?'}  filter: ${filter.label ?? '?'}`);
    console.log(`    risk_reason: ${risk.reason ?? 'N/A'}`);
    console.log(`    rank_reason: ${r.rank_reason ?? 'N/A'}`);
  }
  // Also print skipped
  for (const s of ranked.skipped || []) {
    const c = byOppId[s.opp_id] || {};
    const m = c.market || {};
    console.log(`\n[SKIPPED] ${s.question || m.question || '?'}`);
    console.log(`    opp_id:     ${s.opp_id}`);
    console.log(`    yes_price:  ${m.yes_price ?? 'N/A'}`);
    console.log(`    filter: ${(s.filter || c.filter || {}).label ?? '?'}  skip_reason: ${s.skip_reason ?? 'N/A'}`);
  }

  // ── Top 5 ───────────────────────────────────────────────────────────────
  const top5 = ranked.top_n.slice(0, 5);
  console.log(`\n${'='.repeat(80)}`);
  console.log(`  TOP 5`);
  console.log(`${'='.repeat(80)}`);
  for (const r of top5) {
    const c = byOppId[r.opp_id] || {};
    const m = c.market || {};
    const est = r.estimator || c.estimator || {};
    console.log(`  #${r.rank}  score=${r.score}  yes_price=${m.yes_price ?? 'N/A'}  p_mid=${est.p_mid ?? '?'}  dev=${est.dev_abs ?? '?'}  ${(r.question || '').slice(0, 55)}`);
  }

  // Build output
  const output = {
    run_at: AS_OF,
    model: MODEL,
    profile: 'BASELINE',
    max_tokens: MAX_TOKENS,
    total_eval_set: lines.length,
    total_priced: markets.length,
    success,
    failed,
    skipped: ranked.skipped_count,
    top_n: ranked.top_n,
    candidates: candidates.map(c => ({
      market_id: c.market.id,
      question: c.market.question,
      yes_price: c.market.yes_price,
      p_model: c.estimator?.p_model,
      dev_abs: c.estimator?.dev_abs,
      trust: c.estimator?.estimator_trust_level,
      veto: c.veto?.veto_light,
      risk: c.risk?.risk_level,
      filter: c.filter?.label,
      skip: c.filter?.skip,
    })),
    summary: {
      trust_dist:  { ...trustDist },
      veto_dist:   { ...vetoDist },
      risk_dist:   { ...riskDist },
      filter_dist: { ...filterDist },
    },
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2) + '\n', { encoding: 'utf8' });
  console.log(`\n[pipeline] Output written: ${OUTPUT_PATH}`);
  console.log(`[pipeline] Summary:`);
  console.log(`  success=${success} failed=${failed}`);
  console.log(`  trust:  GREEN=${trustDist.GREEN} YELLOW=${trustDist.YELLOW} RED=${trustDist.RED}`);
  console.log(`  veto:   GREEN=${vetoDist.GREEN} YELLOW=${vetoDist.YELLOW} RED=${vetoDist.RED}`);
  console.log(`  risk:   HIGH=${riskDist.HIGH} MED=${riskDist.MED} LOW=${riskDist.LOW}`);
  console.log(`  filter: BLOCKED=${filterDist.BLOCKED} THIN=${filterDist.THIN} RULE=${filterDist.RULE} SLOW=${filterDist.SLOW} UNKNOWN=${filterDist.UNKNOWN}`);
  console.log(`  ranked: ${ranked.ranked_count} | top score=${ranked.top_n[0]?.score ?? 'N/A'}`);
}

main().catch(err => {
  console.error(`[pipeline] Fatal: ${err.message}`);
  process.exit(1);
});
