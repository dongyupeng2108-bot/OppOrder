import crypto from 'crypto';
import http from 'http';

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
        const start = Date.now();
        // Deterministic generation based on opp_id (if available) or random seed
        const seed = opp.opp_id || 'default_seed';
        const hash = crypto.createHash('sha256').update(seed).digest('hex');
        
        const hexVal = parseInt(hash.substring(0, 4), 16);
        const confidence = 0.5 + (hexVal / 65535) * 0.49;
        const potential = confidence > 0.8 ? 'strong' : (confidence > 0.6 ? 'moderate' : 'weak');
        
        return {
            llm_provider: 'mock',
            llm_model: 'mock-v1',
            llm_summary: `[Mock] Opportunity ${opp.opp_id} shows ${potential} potential based on ${opp.strategy_id}. Baseline score: ${opp.score_baseline}.`,
            llm_confidence: parseFloat(confidence.toFixed(2)),
            llm_tags: ['mock', 'baseline', parseInt(hash[0], 16) > 8 ? 'high_vol' : 'low_vol'],
            llm_latency_ms: Date.now() - start,
            llm_error: null
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
        }
    }

    async summarizeOpp(opp, ctx = {}) {
        const start = Date.now();
        if (!this.apiKey) {
            return {
                llm_provider: 'deepseek',
                llm_model: 'deepseek-chat',
                llm_summary: "[DeepSeek] No API Key provided.",
                llm_confidence: 0,
                llm_tags: ['error', 'no_key'],
                llm_latency_ms: Date.now() - start,
                llm_error: "Missing DEEPSEEK_API_KEY"
            };
        }
        
        // Placeholder for actual API call
        return {
            llm_provider: 'deepseek',
            llm_model: 'deepseek-chat',
            llm_summary: `[DeepSeek] (Shell) Analysis for ${opp.opp_id}.`,
            llm_confidence: 0.8,
            llm_tags: ['deepseek', 'shell'],
            llm_latency_ms: Date.now() - start,
            llm_error: null
        };
    }
}

export class OllamaProvider extends LLMProvider {
    constructor(config = {}) {
        super(config);
        this.baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
        this.model = process.env.OLLAMA_MODEL || 'qwen2.5:7b';
        console.log(`OllamaProvider initialized: ${this.baseUrl} model=${this.model}`);
    }

    async summarizeOpp(opp, ctx = {}) {
        const start = Date.now();
        const prompt = `Analyze opportunity ${opp.opp_id} for strategy ${opp.strategy_id} with score ${opp.score_baseline}. Summarize in 1 sentence.`;
        
        try {
            const response = await this._callOllama(prompt);
            return {
                llm_provider: 'ollama',
                llm_model: this.model,
                llm_summary: response.response || response.message?.content || "[Ollama] No content",
                llm_confidence: 0.7, 
                llm_tags: ['ollama', 'local'],
                llm_latency_ms: Date.now() - start,
                llm_error: null
            };
        } catch (err) {
            // console.warn(`Ollama failed: ${err.message}`); // Reduce noise
            return {
                llm_provider: 'ollama',
                llm_model: this.model,
                llm_summary: "OLLAMA_UNAVAILABLE_FALLBACK",
                llm_confidence: 0,
                llm_tags: ['error', 'fallback'],
                llm_latency_ms: Date.now() - start,
                llm_error: err.message
            };
        }
    }

    _callOllama(prompt) {
        return new Promise((resolve, reject) => {
            let urlStr = this.baseUrl + '/api/generate';
            // Simple check if user provided full path
            if (this.baseUrl.endsWith('/api/chat') || this.baseUrl.endsWith('/api/generate')) {
                 urlStr = this.baseUrl;
            }
            
            const url = new URL(urlStr);
            const body = JSON.stringify({
                model: this.model,
                prompt: prompt,
                stream: false
            });

            const req = http.request(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body)
                }
            }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    if (res.statusCode !== 200) {
                        reject(new Error(`Status ${res.statusCode}: ${data}`));
                    } else {
                        try {
                            resolve(JSON.parse(data));
                        } catch (e) {
                            reject(e);
                        }
                    }
                });
            });

            req.on('error', (err) => reject(err));
            req.on('timeout', () => {
                req.destroy();
                reject(new Error("Timeout"));
            });
            
            req.setTimeout(5000); // 5s timeout
            req.write(body);
            req.end();
        });
    }
}

export function getProvider(type = 'mock') {
    switch ((type || '').toLowerCase()) {
        case 'deepseek':
            return new DeepSeekProvider();
        case 'ollama':
            return new OllamaProvider();
        case 'mock':
        default:
            return new MockProvider();
    }
}
