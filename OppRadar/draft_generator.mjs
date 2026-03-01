/**
 * draft_generator.mjs
 * Reads the latest Polymarket eligible scan and generates draft snapshots
 * for each candidate using DeepSeek deepseek-reasoner via live_provider.
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Project root: OppRadar/ → root
const PROJECT_ROOT = path.resolve(__dirname, '..');
const SCANS_DIR = path.join(PROJECT_ROOT, 'data', 'scans');
const SNAPSHOTS_DIR = path.join(PROJECT_ROOT, 'data', 'snapshots');

// ── User prompt template (filled per candidate) ──────────────────────────────
function buildUserPrompt(candidate) {
  const title = candidate.title || '';
  const question = candidate.question || candidate.title || '';
  const yes_price = candidate.yes_price != null ? String(candidate.yes_price) : '未知';
  const event_time = candidate.event_time || '未知';

  return `市场标题：${title}
市场问题：${question}
当前 YES 价格：${yes_price}
结算时间：${event_time}
请返回以下 JSON 结构：
{
  "p_range": { "low": 0.0, "high": 1.0 },
  "confidence": "High|Med|Low",
  "risk_triggers": ["trigger1", "trigger2"],
  "veto": {
    "decision": "ALLOW|DEGRADE|BLOCK",
    "labels": ["label1"],
    "rule_facts": {}
  },
  "summary": "一句话分析"
}`;
}

// ── callLLM wrapper ──────────────────────────────────────────────────────────
async function callLLM({ prompt, model, mode }) {
  if (mode === 'live') {
    const { callLive } = await import('./providers/live_provider.mjs');
    return callLive({ prompt, model });
  }
  // Mock fallback
  return {
    id: `mock_${Date.now()}`,
    title: 'Mock Draft',
    score: 0.5,
    run_id: 'mock_run',
    created_at: new Date().toISOString(),
    summary: '[mock] No live mode',
    provider: 'mock',
    snapshot_type: 'draft',
    model_used: model,
    p_range: { low: 0.4, high: 0.6 },
    confidence: 'Low',
    risk_triggers: [],
    veto: { decision: 'ALLOW', labels: [], rule_facts: {} }
  };
}

// ── Find latest eligible scan file ──────────────────────────────────────────
function findLatestScan() {
  if (!fs.existsSync(SCANS_DIR)) return null;
  const files = fs.readdirSync(SCANS_DIR)
    .filter(f => f.startsWith('eligible_') && f.endsWith('.json'))
    .sort() // lexicographic → latest date last
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
  // Never overwrite: each timestamp-named file is unique (append-only guarantee)
  fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2) + '\n', { encoding: 'utf8' });
  return { outPath, relPath: path.join(oppId, filename) };
}

// ── Main: generate drafts for all candidates ─────────────────────────────────

/**
 * Read the latest eligible scan, call DeepSeek for each candidate,
 * and write draft snapshots to data/snapshots/.
 *
 * @returns {Promise<{ total, success, failed, skipped, scan_date, snapshots_dir }>}
 */
export async function generateDrafts() {
  // Ensure snapshots dir
  if (!fs.existsSync(SNAPSHOTS_DIR)) {
    fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
  }

  const scanFile = findLatestScan();
  if (!scanFile) {
    console.warn('[draft_generator] No eligible scan files found in', SCANS_DIR);
    return {
      total: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      scan_date: null,
      snapshots_dir: SNAPSHOTS_DIR,
      error: 'No scan files found. Run GET /eligible/scan first.'
    };
  }

  let scanData;
  try {
    scanData = JSON.parse(fs.readFileSync(scanFile, 'utf8'));
  } catch (err) {
    throw new Error(`[draft_generator] Failed to read scan file: ${err.message}`);
  }

  const candidates = Array.isArray(scanData.candidates) ? scanData.candidates : [];
  const scan_date = scanData.scan_date || null;

  console.log(`[draft_generator] Processing ${candidates.length} candidates from ${path.basename(scanFile)}`);

  let success = 0;
  let failed = 0;
  let skipped = 0;

  for (const candidate of candidates) {
    const oppId = candidate.opp_id || `opp_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    try {
      const userPrompt = buildUserPrompt(candidate);
      const llmResult = await callLLM({
        prompt: userPrompt,
        model: 'deepseek-reasoner',
        mode: 'live'
      });

      // Build full OpportunityCard-compatible draft snapshot
      const snapshot = {
        // Required OpportunityCard fields
        id: llmResult.id || `draft_${oppId}_${Date.now()}`,
        title: candidate.title || llmResult.title || '',
        score: llmResult.score != null ? llmResult.score : (candidate.yes_price || 0.5),
        run_id: `draft_${new Date().toISOString().slice(0, 10)}`,
        created_at: llmResult.created_at || new Date().toISOString(),

        // M4 fields
        opp_id: oppId,
        snapshot_type: 'draft',
        model_used: llmResult.model_used || 'deepseek-reasoner',
        p_range: llmResult.p_range || { low: 0.3, high: 0.7 },
        confidence: llmResult.confidence || 'Low',
        risk_triggers: llmResult.risk_triggers || [],
        veto: llmResult.veto || { decision: 'ALLOW', labels: [], rule_facts: {} },
        evidence_refs: [path.basename(scanFile)],

        // Extra context
        summary: llmResult.summary || '',
        market_url: candidate.market_url || '',
        yes_price: candidate.yes_price,
        event_time: candidate.event_time,
        provider: llmResult.provider || 'live',
        _fallback: llmResult._fallback || false
      };

      const { outPath, relPath } = writeSnapshot(oppId, snapshot);
      console.log(`[draft_generator] Written: ${outPath}`);

      // Update global snapshot index (append-only)
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
    snapshots_dir: SNAPSHOTS_DIR
  };

  console.log(`[draft_generator] Done. total=${candidates.length} success=${success} failed=${failed}`);
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
