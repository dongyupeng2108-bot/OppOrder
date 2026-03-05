/**
 * draft_generator.mjs
 * Reads the latest Polymarket eligible scan and generates draft snapshots
 * for each candidate. Uses EstimatorV1 for system-computed fields.
 *
 * Output: data/snapshots/<opp_id>/draft_<timestamp>.json
 *
 * Exports: generateDrafts()
 * Usage:   node OppRadar/draft_generator.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { appendSnapshot } from './snapshot_index.mjs';
import {
  buildEstimatorPrompt,
  normalizeLLMOutput,
  computeSystemFields,
  assembleEstimatorOutput,
  mockEstimatorOutput,
} from './estimator_v1.mjs';
import { runUniverse } from './universe_service.mjs';
import { runScanner } from './scanner_service.mjs';
import { getLatestCoreSnapshot } from './snapshot_store.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Project root: OppRadar/ → root
const PROJECT_ROOT = path.resolve(__dirname, '..');
const SCANS_DIR = path.join(PROJECT_ROOT, 'data', 'scans');
const SNAPSHOTS_DIR = path.join(PROJECT_ROOT, 'data', 'snapshots');

// ── LLM JSON parser ────────────────────────────────────────────────────────
function parseLLMJSON(content) {
  if (!content || typeof content !== 'string') return null;
  let jsonStr = content;
  const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) jsonStr = fenceMatch[1].trim();
  else {
    const braceMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (braceMatch) jsonStr = braceMatch[0];
  }
  try { return JSON.parse(jsonStr); }
  catch { return null; }
}

// ── callLLM wrapper ──────────────────────────────────────────────────────────
async function callLLM({ prompt, model, mode, candidate }) {
  if (mode === 'live') {
    const { callLive } = await import('./providers/live_provider.mjs');
    return { raw: await callLive({ prompt, model }), source: 'live' };
  }
  // Mock: deterministic via EstimatorV1
  return { estimatorOutput: mockEstimatorOutput(candidate), source: 'mock' };
}

// ── Find latest eligible scan file ──────────────────────────────────────────
function findLatestScan() {
  if (!fs.existsSync(SCANS_DIR)) return null;
  const files = fs.readdirSync(SCANS_DIR)
    .filter(f => f.startsWith('eligible_') && f.endsWith('.json'))
    .sort()
    .reverse();
  return files.length > 0 ? path.join(SCANS_DIR, files[0]) : null;
}

// ── Write snapshot to disk (append-only: each call creates a new file) ──────
function writeSnapshot(oppId, snapshot) {
  const dir = path.join(SNAPSHOTS_DIR, oppId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `draft_${ts}.json`;
  const outPath = path.join(dir, filename);
  fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2) + '\n', { encoding: 'utf8' });
  return { outPath, relPath: path.join(oppId, filename) };
}

// ── Main: generate drafts for all candidates ─────────────────────────────────

/**
 * Read the latest eligible scan, generate EstimatorV1 output for each candidate,
 * and write draft snapshots to data/snapshots/.
 *
 * @returns {Promise<{ total, success, failed, skipped, scan_date, snapshots_dir, estimator_v1 }>}
 */
export async function generateDrafts() {
  if (!fs.existsSync(SNAPSHOTS_DIR)) {
    fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
  }

  // M5.5-S4: Universe → Scanner → CoreSnapshot pipeline
  let eligibleMarkets = null;
  let universeRun = null;
  let scannerRun = null;
  try {
    universeRun = await runUniverse();
    scannerRun = await runScanner({ universeRun });

    // Build candidate list from CoreSnapshot (only markets with successful snapshots)
    eligibleMarkets = [];
    for (const marketId of universeRun.market_list) {
      const snap = await getLatestCoreSnapshot(marketId);
      if (snap && snap.mid_price != null) {
        eligibleMarkets.push({
          marketId,
          mid_price: snap.mid_price,
          core_snapshot_id: snap.snapshot_id,
        });
      }
      // No CoreSnapshot → skip (hard rule: no price substitution)
    }
    console.log(`[draft_generator] CoreSnapshot pipeline: ${eligibleMarkets.length} eligible markets (from ${universeRun.market_count} universe)`);
  } catch (err) {
    console.warn('[draft_generator] CoreSnapshot pipeline failed, falling back to scan file:', err.message);
    eligibleMarkets = null;
  }

  // Load candidates: prefer CoreSnapshot pipeline, fallback to scan file
  let candidates;
  let scan_date;

  if (eligibleMarkets && eligibleMarkets.length > 0) {
    // Use CoreSnapshot-backed candidates
    // Reconstruct candidate objects compatible with existing LLM estimation
    const scanFile = findLatestScan();
    let scanCandidatesMap = {};
    if (scanFile) {
      try {
        const scanData = JSON.parse(fs.readFileSync(scanFile, 'utf8'));
        for (const c of (scanData.candidates || [])) {
          scanCandidatesMap[c.opp_id] = c;
        }
      } catch (_) {}
    }

    candidates = eligibleMarkets.map(em => {
      const existing = scanCandidatesMap[em.marketId] || {};
      return {
        ...existing,
        opp_id: em.marketId,
        yes_price: em.mid_price,
        _core_snapshot_id: em.core_snapshot_id,
        title: existing.title || em.marketId,
        question: existing.question || em.marketId,
      };
    });
    scan_date = new Date().toISOString();
  } else {
    // Fallback: original scan file path
    const scanFile = findLatestScan();
    if (!scanFile) {
      console.warn('[draft_generator] No eligible scan files found in', SCANS_DIR);
      return {
        total: 0, success: 0, failed: 0, skipped: 0,
        scan_date: null, snapshots_dir: SNAPSHOTS_DIR,
        error: 'No scan files found. Run GET /eligible/scan first.'
      };
    }

    let scanData;
    try {
      scanData = JSON.parse(fs.readFileSync(scanFile, 'utf8'));
    } catch (err) {
      throw new Error(`[draft_generator] Failed to read scan file: ${err.message}`);
    }

    candidates = Array.isArray(scanData.candidates) ? scanData.candidates : [];
    scan_date = scanData.scan_date || null;
  }

  console.log(`[draft_generator] Processing ${candidates.length} candidates from ${path.basename(scanFile)}`);

  let success = 0;
  let failed = 0;
  let skipped = 0;
  const trustDist = { GREEN: 0, YELLOW: 0, RED: 0 };

  for (const candidate of candidates) {
    const oppId = candidate.opp_id || `opp_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    try {
      const prompt = buildEstimatorPrompt(candidate);
      const t0 = Date.now();
      const llmResponse = await callLLM({
        prompt,
        model: 'deepseek-reasoner',
        mode: 'live',
        candidate,
      });
      const latency_ms = Date.now() - t0;

      // Build EstimatorV1 output
      let estOutput;
      if (llmResponse.source === 'mock') {
        estOutput = llmResponse.estimatorOutput;
      } else {
        // Live mode: parse raw LLM response, normalize, compute system fields
        const rawContent = typeof llmResponse.raw === 'string'
          ? llmResponse.raw
          : (llmResponse.raw?.content || llmResponse.raw?.summary || '');
        const parsed = typeof llmResponse.raw === 'object' && llmResponse.raw.p_range
          ? llmResponse.raw
          : parseLLMJSON(rawContent);
        const llmFields = normalizeLLMOutput(parsed);
        const yesPrice = candidate.yes_price != null ? candidate.yes_price : 0.5;
        const systemFields = computeSystemFields(llmFields, yesPrice);
        estOutput = assembleEstimatorOutput({
          llmFields, systemFields,
          model: 'deepseek-reasoner',
          latency_ms,
          provider: 'live',
          fallback: !parsed,
        });
      }

      trustDist[estOutput.estimator_trust_level]++;

      // Build full OpportunityCard-compatible draft snapshot
      const snapshot = {
        // Required OpportunityCard fields
        id: `draft_${oppId}_${Date.now()}`,
        title: candidate.title || candidate.question || '',
        score: candidate.yes_price || 0.5,
        run_id: `draft_${new Date().toISOString().slice(0, 10)}`,
        created_at: new Date().toISOString(),

        // M4 identity
        opp_id: oppId,
        snapshot_type: 'draft',
        model_used: estOutput.model_used,
        evidence_refs: [path.basename(scanFile)],

        // EstimatorV1 LLM fields
        p_range: estOutput.p_range,
        confidence: estOutput.confidence,
        claims: estOutput.claims,
        risk_triggers: estOutput.risk_triggers,
        veto: estOutput.veto,
        rules_text: estOutput.rules_text,
        rules_unknown: estOutput.rules_unknown,
        bullshit_score: estOutput.bullshit_score,
        why_1_liner: estOutput.why_1_liner,
        mispricing_type: estOutput.mispricing_type,

        // EstimatorV1 system-computed fields
        estimator_v1: {
          trust_score: estOutput.estimator_trust_score,
          trust_level: estOutput.estimator_trust_level,
          rules_penalty: estOutput.rules_penalty,
          range_width: estOutput.range_width,
          p_valid: estOutput.p_valid,
        },

        // Offset fields (system-computed)
        p_mid: estOutput.p_mid,
        dev_signed: estOutput.dev_signed,
        dev_abs: estOutput.dev_abs,
        dev_flag: estOutput.dev_flag,

        // M4 model source
        model_role: 'scan',
        latency_ms: estOutput.latency_ms,

        // Extra context
        market_url: candidate.market_url || '',
        yes_price: candidate.yes_price,
        event_time: candidate.event_time || candidate.end_date,
        provider: estOutput.provider,
        _fallback: estOutput._fallback,
      };

      const { outPath, relPath } = writeSnapshot(oppId, snapshot);
      console.log(`[draft_generator] Written: ${outPath}`);

      appendSnapshot({
        opp_id: oppId,
        title: snapshot.title || '',
        file: relPath,
        snapshot_type: snapshot.snapshot_type || 'draft',
        model_used: snapshot.model_used || 'unknown',
        created_at: snapshot.created_at || new Date().toISOString()
      });

      success++;
    } catch (err) {
      console.error(`[draft_generator] Failed for ${oppId}: ${err.message}`);
      failed++;
    }
  }

  const summary = {
    total: candidates.length,
    success,
    failed,
    skipped,
    scan_date,
    snapshots_dir: SNAPSHOTS_DIR,
    estimator_v1: {
      trust_dist: { ...trustDist },
    },
  };

  console.log(`[draft_generator] Done. total=${candidates.length} success=${success} failed=${failed} trust: GREEN=${trustDist.GREEN} YELLOW=${trustDist.YELLOW} RED=${trustDist.RED}`);
  return summary;
}

// ── Direct execution ─────────────────────────────────────────────────────────
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  generateDrafts()
    .then(r => {
      console.log('[draft_generator] Summary:', JSON.stringify(r, null, 2));
    })
    .catch(err => {
      console.error('[draft_generator] Fatal error:', err.message);
      process.exit(1);
    });
}
