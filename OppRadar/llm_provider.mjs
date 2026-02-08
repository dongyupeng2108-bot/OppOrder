import crypto from 'crypto';
import http from 'http';
import https from 'https';

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
        
        const prompt = `[Mock Prompt] Analyze opportunity ${opp.opp_id} for strategy ${opp.strategy_id} with score ${opp.score_baseline}. Summarize in 1 sentence.`;

        const summary = `[Mock] Opportunity ${opp.opp_id} shows ${potential} potential based on ${opp.strategy_id}. Baseline score: ${opp.score_baseline}.`;

        return {
            llm_provider: 'mock',
            llm_model: 'mock-v1',
            llm_summary: summary,
            llm_confidence: parseFloat(confidence.toFixed(2)),
            llm_tags: ['mock', 'baseline', parseInt(hash[0], 16) > 8 ? 'high_vol' : 'low_vol'],
            llm_latency_ms: Date.now() - start,
            llm_error: null,
            llm_input_prompt: prompt,
            llm_json: {
                summary: summary,
                signals: [
                    { type: 'mock_signal', stance: potential === 'strong' ? 'bullish' : (potential === 'weak' ? 'bearish' : 'neutral'), strength: parseFloat(confidence.toFixed(2)), evidence: 'Random seed generation' }
                ],
                assumptions: ['Market conditions are normal', 'Mock data simulation']
            }
        };
    }
}

export class DeepSeekProvider extends LLMProvider {
    constructor(config = {}) {
        super(config);
        this.apiKey = process.env.DEEPSEEK_API_KEY;
        this.model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
        this.timeout = parseInt(process.env.DEEPSEEK_TIMEOUT || '30000');
        this.maxTokens = parseInt(process.env.DEEPSEEK_MAX_TOKENS || '1024');
        this.mockProvider = new MockProvider(config);

        if (this.apiKey) {
            const fingerprint = crypto.createHash('sha256').update(this.apiKey).digest('hex').substring(0, 8);
            console.log(`DeepSeekProvider initialized with key fingerprint: ${fingerprint}`);
        } else {
            console.log("DeepSeekProvider initialized without key (Fallback Mode)");
        }
    }

    async summarizeOpp(opp, ctx = {}) {
        const start = Date.now();
        
        // Fail-soft Fallback if no key
        if (!this.apiKey) {
            const mockResult = await this.mockProvider.summarizeOpp(opp, ctx);
            return {
                ...mockResult,
                llm_provider: 'deepseek', // Identify as deepseek (fallback)
                llm_model: this.model,
                llm_tags: [...(mockResult.llm_tags || []), 'fallback', 'no_key'],
                llm_latency_ms: Date.now() - start
            };
        }

        const prompt = `Analyze opportunity ${opp.opp_id} for strategy ${opp.strategy_id} with score ${opp.score_baseline}. Return JSON with fields: summary, signals (array of type, stance, strength, evidence), assumptions.`;
        
        try {
            const response = await this._callDeepSeekWithRetry(prompt, 2);
            
            // Extract content from DeepSeek response
            const contentStr = response.choices?.[0]?.message?.content || "";
            let jsonContent = {};
            
            // Attempt to parse JSON from content (it might be wrapped in markdown code blocks)
            try {
                const jsonMatch = contentStr.match(/```json\n([\s\S]*?)\n```/) || contentStr.match(/{[\s\S]*}/);
                if (jsonMatch) {
                    jsonContent = JSON.parse(jsonMatch[1] || jsonMatch[0]);
                } else {
                    // Fallback if not valid JSON
                    jsonContent = {
                        summary: contentStr,
                        signals: [],
                        assumptions: []
                    };
                }
            } catch (e) {
                jsonContent = {
                    summary: contentStr,
                    signals: [],
                    assumptions: []
                };
            }

            return {
                llm_provider: 'deepseek',
                llm_model: this.model,
                llm_summary: jsonContent.summary || contentStr.substring(0, 100),
                llm_confidence: 0.9,
                llm_tags: ['deepseek', 'live'],
                llm_latency_ms: Date.now() - start,
                llm_error: null,
                llm_input_prompt: prompt,
                llm_json: jsonContent
            };

        } catch (error) {
             console.warn(`[DeepSeek] Error: ${error.message}. Fallback to Mock.`);
             const mockResult = await this.mockProvider.summarizeOpp(opp, ctx);
             return {
                ...mockResult,
                llm_provider: 'deepseek',
                llm_model: this.model,
                llm_tags: [...(mockResult.llm_tags || []), 'fallback', 'error'],
                llm_error: error.message,
                llm_latency_ms: Date.now() - start
             };
        }
    }

    async _callDeepSeekWithRetry(prompt, retries) {
        let lastError;
        for (let i = 0; i <= retries; i++) {
            try {
                return await this._callDeepSeek(prompt);
            } catch (err) {
                lastError = err;
                console.warn(`[DeepSeek] Attempt ${i + 1} failed: ${err.message}`);
                if (i < retries) {
                    await new Promise(r => setTimeout(r, 1000 * (i + 1))); // Backoff
                }
            }
        }
        throw lastError;
    }

    _callDeepSeek(prompt) {
        return new Promise((resolve, reject) => {
            const url = new URL('https://api.deepseek.com/chat/completions');
            const body = JSON.stringify({
                model: this.model,
                messages: [
                    { role: 'system', content: 'You are a trading assistant. Output JSON only.' },
                    { role: 'user', content: prompt }
                ],
                max_tokens: this.maxTokens,
                stream: false
            });

            const req = https.request(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
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
            
            req.setTimeout(this.timeout);
            req.write(body);
            req.end();
        });
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
            const content = response.response || response.message?.content || "[Ollama] No content";
            
            return {
                llm_provider: 'ollama',
                llm_model: this.model,
                llm_summary: content,
                llm_confidence: 0.7, 
                llm_tags: ['ollama', 'local'],
                llm_latency_ms: Date.now() - start,
                llm_error: null,
                llm_input_prompt: prompt,
                llm_json: {
                    summary: content,
                    signals: [],
                    assumptions: []
                }
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
                llm_error: err.message,
                llm_input_prompt: prompt,
                llm_json: { summary: "Fallback", signals: [], assumptions: [] }
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

export class OpenRouterProvider extends LLMProvider {
    constructor(config = {}) {
        super(config);
        this.apiKey = process.env.OPENROUTER_API_KEY;
        this.model = process.env.OPENROUTER_MODEL || 'google/gemini-2.0-flash-exp:free'; // Default to a free model
        if (this.apiKey) {
            const fingerprint = crypto.createHash('sha256').update(this.apiKey).digest('hex').substring(0, 8);
            console.log(`OpenRouterProvider initialized with key fingerprint: ${fingerprint}`);
        }
    }

    async summarizeOpp(opp, ctx = {}) {
        const start = Date.now();
        if (!this.apiKey) {
            // Should theoretically be handled by getProvider, but safe guard here
            console.warn("[OpenRouter] No API Key found, falling back to Mock.");
            const mock = new MockProvider();
            return mock.summarizeOpp(opp, ctx);
        }

        const prompt = `Analyze opportunity ${opp.opp_id} for strategy ${opp.strategy_id} with score ${opp.score_baseline}. Summarize in 1 sentence.`;
        
        try {
            const response = await this._callOpenRouter(prompt);
            const content = response.choices?.[0]?.message?.content || "[OpenRouter] No content";
            
            return {
                llm_provider: 'openrouter',
                llm_model: this.model,
                llm_summary: content,
                llm_confidence: 0.9, 
                llm_tags: ['openrouter', 'cloud'],
                llm_latency_ms: Date.now() - start,
                llm_error: null,
                llm_input_prompt: prompt,
                llm_json: {
                    summary: content,
                    signals: [],
                    assumptions: []
                }
            };
        } catch (err) {
            console.warn(`[OpenRouter] Failed: ${err.message}. Falling back to Mock.`);
            const mock = new MockProvider();
            const fallbackResult = await mock.summarizeOpp(opp, ctx);
            
            // Merge fallback result with error info
            return {
                ...fallbackResult,
                llm_summary: `[Fallback] ${fallbackResult.llm_summary}`,
                llm_tags: [...fallbackResult.llm_tags, 'fallback_from_openrouter'],
                llm_error: `OpenRouter error: ${err.message}`
            };
        }
    }

    _callOpenRouter(prompt) {
        return new Promise((resolve, reject) => {
            const url = new URL('https://openrouter.ai/api/v1/chat/completions');
            const body = JSON.stringify({
                model: this.model,
                messages: [
                    { role: 'user', content: prompt }
                ]
            });

            const req = https.request(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body),
                    // OpenRouter optional headers for ranking
                    'HTTP-Referer': 'https://github.com/dongyupeng2108-bot/OppOrder', 
                    'X-Title': 'OppRadar'
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
            
            req.setTimeout(10000); // 10s timeout
            req.write(body);
            req.end();
        });
    }
}

export function getProvider(type) {
    // If type is explicitly provided, respect it
    if (type) {
        switch (type.toLowerCase()) {
            case 'deepseek': return new DeepSeekProvider();
            case 'ollama': return new OllamaProvider();
            case 'openrouter': return new OpenRouterProvider();
            case 'mock': return new MockProvider();
            default: return new MockProvider();
        }
    }
    
    // Auto-selection logic based on Environment Variables
    if (process.env.DEEPSEEK_API_KEY) {
        return new DeepSeekProvider();
    }
    
    if (process.env.OPENROUTER_API_KEY) {
        return new OpenRouterProvider();
    }
    
    // Default to mock
    return new MockProvider();
}
