import crypto from 'crypto';

export class LLMProvider {
    constructor(config = {}) {
        this.config = config;
    }

    async summarizeOpp(opp, ctx = {}) {
        throw new Error("Not implemented");
    }
}

export class MockProvider extends LLMProvider {
    async summarizeOpp(opp, ctx = {}) {
        // Deterministic generation based on opp_id (if available) or random seed
        // We use opp.opp_id as seed for consistency
        const seed = opp.opp_id || 'default_seed';
        const hash = crypto.createHash('sha256').update(seed).digest('hex');
        
        // Mock logic:
        // Summary: "Opportunity {id} shows {strength} potential based on {strategy}."
        // Confidence: derived from hash (0.5 - 0.99)
        // Tags: derived from hash
        
        const hexVal = parseInt(hash.substring(0, 4), 16);
        const confidence = 0.5 + (hexVal / 65535) * 0.49;
        const potential = confidence > 0.8 ? 'strong' : (confidence > 0.6 ? 'moderate' : 'weak');
        
        return {
            summary: `[Mock] Opportunity ${opp.opp_id} shows ${potential} potential based on ${opp.strategy_id}. Baseline score: ${opp.score_baseline}.`,
            confidence: parseFloat(confidence.toFixed(2)),
            tags: ['mock', 'baseline', parseInt(hash[0], 16) > 8 ? 'high_vol' : 'low_vol'],
            cost_estimate: 0
        };
    }
}

export class DeepSeekProvider extends LLMProvider {
    constructor(config = {}) {
        super(config);
        this.apiKey = process.env.DEEPSEEK_API_KEY;
        if (this.apiKey) {
            const fingerprint = crypto.createHash('sha256').update(this.apiKey).digest('hex').substring(0, 8);
            console.log(`DeepSeekProvider initialized with key fingerprint: ${fingerprint}`);
        } else {
            // console.warn("DeepSeekProvider initialized WITHOUT key (DEEPSEEK_API_KEY missing).");
            // Suppress warning if just running mock, but good for debug
        }
    }

    async summarizeOpp(opp, ctx = {}) {
        if (!this.apiKey) {
            return {
                summary: "[DeepSeek] No API Key provided.",
                confidence: 0,
                tags: ['error', 'no_key'],
                cost_estimate: 0
            };
        }
        
        // Placeholder for actual API call
        // For now, return a shell response
        return {
            summary: `[DeepSeek] (Shell) Analysis for ${opp.opp_id}.`,
            confidence: 0.8,
            tags: ['deepseek', 'shell'],
            cost_estimate: 0
        };
    }
}

export function getProvider(type = 'mock') {
    switch ((type || '').toLowerCase()) {
        case 'deepseek':
            return new DeepSeekProvider();
        case 'mock':
        default:
            return new MockProvider();
    }
}
