/**
 * mock_provider.mjs
 * Deterministic mock LLM provider — same input always yields same output.
 * No external calls. Used by llm_gateway in mode='mock'.
 */
import crypto from 'crypto';

/**
 * Call mock LLM — returns a deterministic OpportunityCard-compatible result.
 * @param {{ prompt: string, model?: string }} opts
 * @returns {Promise<object>}
 */
export async function callMock({ prompt, model = 'mock-v1' }) {
    const hash = crypto.createHash('sha256').update(prompt).digest('hex');
    const intVal = parseInt(hash.slice(0, 8), 16);
    const score = parseFloat((intVal / 0xFFFFFFFF).toFixed(4));

    return {
        id: `llm_${hash.slice(0, 8)}`,
        title: `Mock Opportunity (${hash.slice(0, 4)})`,
        score: Math.max(0, Math.min(1, score)),
        run_id: 'mock_run',
        created_at: new Date().toISOString(),
        summary: `[Mock] Deterministic score: ${score.toFixed(4)}`,
        provider: 'mock'
    };
}
