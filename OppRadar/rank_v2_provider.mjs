/**
 * rank_v2_provider.mjs
 * M3-T9: Integrate LLM Gateway for rank_v2 scoring.
 *
 * Exposes getRankV2Score(oppId, mode) → { p_llm, provider_used, model_used, prompt_hash, fallback }
 * mode maps to llm_gateway modes: 'mock' | 'cache' | 'live'
 */

import crypto from 'crypto';
import { callLLM } from './llm_gateway.mjs';

/**
 * Deterministic fallback score (legacy, used when gateway result.score is unavailable).
 */
function getDeterministicP(id) {
    const hash = crypto.createHash('sha256').update(id).digest('hex');
    const intVal = parseInt(hash.substring(0, 8), 16);
    return parseFloat((intVal / 0xFFFFFFFF).toFixed(4));
}

/**
 * Get rank_v2 score for an opportunity via the LLM Gateway.
 * @param {string} oppId
 * @param {string} [mode] - 'mock' | 'cache' | 'live' (default: 'mock')
 * @returns {Promise<{ p_llm: number, provider_used: string, model_used: string, prompt_hash: string, fallback: boolean }>}
 */
export async function getRankV2Score(oppId, mode = 'mock') {
    const prompt = `Rate trading opportunity ${oppId}. Return a probability score between 0 and 1.`;

    const { result, meta } = await callLLM({
        prompt,
        model: 'mock-v1',
        mode,
        taskId: 'rank_v2'
    });

    // Use result.score from gateway; fall back to deterministic if missing
    const p_llm = (typeof result.score === 'number' && result.score >= 0 && result.score <= 1)
        ? result.score
        : getDeterministicP(oppId);

    return {
        p_llm,
        provider_used: meta.provider_used,
        model_used: meta.model_used,
        prompt_hash: meta.prompt_hash,
        fallback: meta.fallback
    };
}
