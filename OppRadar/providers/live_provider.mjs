/**
 * live_provider.mjs
 * Simulated live LLM provider. Uses setTimeout to simulate latency.
 * Does NOT call a real external API — validates the record/schema/fallback flow.
 * Used by llm_gateway in mode='live'.
 */

/**
 * Call simulated live LLM.
 * @param {{ prompt: string, model?: string }} opts
 * @returns {Promise<object>} OpportunityCard-compatible result with provider_used='live'
 */
export async function callLive({ prompt, model = 'live-v1' }) {
    // Simulate network latency (50ms)
    await new Promise(r => setTimeout(r, 50));

    // Return a valid OpportunityCard structure
    return {
        id: `live_${Date.now()}`,
        title: `Live Opportunity`,
        score: 0.75,
        run_id: 'live_run',
        created_at: new Date().toISOString(),
        summary: '[Live] Simulated LLM response',
        provider: 'live'
    };
}
