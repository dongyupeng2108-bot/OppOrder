import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import https from 'https';

// Interface for NewsProvider
export class NewsProvider {
    constructor() {}

    /**
     * Fetch news for a given topic
     * @param {string} topicKey
     * @param {number} limit
     * @returns {Promise<Array<{source, url, published_at, fetched_at, title, snippet, raw_hash}>>}
     */
    async fetchNews(topicKey, limit = 5) {
        throw new Error('Not implemented');
    }
}

class LocalFileNewsProvider extends NewsProvider {
    constructor() {
        super();
        this.filePath = path.join(process.cwd(), 'data', 'runtime', 'news_feed.jsonl');
        // Fallback to .json if jsonl doesn't exist, though spec says jsonl preference
        // Ensure directory exists
        const dir = path.dirname(this.filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    async fetchNews(topicKey, limit = 5) {
        if (!fs.existsSync(this.filePath)) {
            console.warn(`[LocalFileNewsProvider] File not found: ${this.filePath}`);
            return [];
        }

        const fileContent = fs.readFileSync(this.filePath, 'utf-8');
        const lines = fileContent.split('\n').filter(line => line.trim() !== '');
        
        const allNews = [];
        for (const line of lines) {
            try {
                const item = JSON.parse(line);
                // Filter by topicKey if provided (and if item has topic_key or related tags)
                // For simplicity, strict match on topic_key or wildcard if item has no topic_key
                if (item.topic_key === topicKey || !item.topic_key) {
                    allNews.push(this._normalize(item));
                }
            } catch (e) {
                console.error('[LocalFileNewsProvider] Parse error:', e);
            }
        }

        // Sort by published_at desc
        allNews.sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime());

        return allNews.slice(0, limit);
    }

    _normalize(item) {
        // Map fields to standard schema
        const fetchedAt = new Date().toISOString();
        const rawString = JSON.stringify(item);
        const rawHash = crypto.createHash('md5').update(rawString).digest('hex');

        return {
            provider: 'local',
            source: item.source || item.publisher || 'local_file',
            url: item.url || null,
            published_at: item.published_at || item.ts || new Date().toISOString(),
            fetched_at: fetchedAt,
            title: item.title || 'Untitled',
            snippet: item.snippet || item.summary || item.content || '',
            raw_hash: rawHash,
            // Preserve original for raw storage if needed
            _raw: item
        };
    }
}

class WebNewsProvider extends NewsProvider {
    constructor() {
        super();
    }

    async fetchNews(topicKey, limit = 5) {
        // Stub implementation
        console.warn('[WebNewsProvider] Web fetch is currently disabled/stubbed.');
        return [];
    }
}

export class GdeltDocNewsProvider extends NewsProvider {
    constructor() {
        super();
        this.baseUrl = 'https://api.gdeltproject.org/api/v2/doc/doc';
    }

    /**
     * Fetch news from GDELT
     * @param {string} topicKey 
     * @param {number} limit 
     * @param {Object} options - { query, timespan }
     * @returns {Promise<Array>}
     */
    async fetchNews(topicKey, limit = 20, options = {}) {
        // Cap limit at 50
        const maxRecords = Math.min(Math.max(limit, 5), 50);
        
        // Build Query
        // Map topicKey to query if needed, or just use topicKey
        const query = encodeURIComponent(options.query || topicKey);
        const timespan = options.timespan || '1d';
        const mode = 'artlist';
        const format = 'json';
        const sort = 'datedesc';

        const url = `${this.baseUrl}?query=${query}&mode=${mode}&format=${format}&sort=${sort}&timespan=${timespan}&maxrecords=${maxRecords}`;

        console.log(`[GdeltDocNewsProvider] Fetching: ${url}`);

        try {
            const data = await this._fetchWithTimeout(url, 8000); // 8s timeout
            if (!data || !data.articles) {
                console.warn('[GdeltDocNewsProvider] No articles found or invalid format.');
                return [];
            }

            return data.articles.map(article => this._normalize(article));

        } catch (error) {
            console.error(`[GdeltDocNewsProvider] Fetch failed: ${error.message}`);
            // Throw to allow caller to fallback
            throw error;
        }
    }

    _fetchWithTimeout(url, timeoutMs) {
        return new Promise((resolve, reject) => {
            const req = https.get(url, (res) => {
                if (res.statusCode !== 200) {
                    res.resume(); // consume response data to free up memory
                    return reject(new Error(`Status Code: ${res.statusCode}`));
                }

                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(new Error('Invalid JSON response'));
                    }
                });
            });

            req.on('error', (err) => reject(err));
            
            req.setTimeout(timeoutMs, () => {
                req.destroy();
                reject(new Error('Request timed out'));
            });
        });
    }

    _normalize(item) {
        // GDELT item: { url, title, seendate, domain, language, sourcecountry, ... }
        
        // Parse seendate: YYYYMMDDTHHMMSSZ
        let publishedAt = new Date().toISOString();
        if (item.seendate) {
            // "20231026T120000Z" -> Standard ISO?
            // GDELT format is usually ISO 8601 compact.
            // Let's try to parse it. If standard Date parse fails, we might need manual parsing.
            // Actually JS Date often handles ISO 8601.
            // "20231026T120000Z"
            const year = item.seendate.substring(0, 4);
            const month = item.seendate.substring(4, 6);
            const day = item.seendate.substring(6, 8);
            const hour = item.seendate.substring(9, 11);
            const minute = item.seendate.substring(11, 13);
            const second = item.seendate.substring(13, 15);
            publishedAt = `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
        }

        const rawString = JSON.stringify(item);
        const rawHash = crypto.createHash('md5').update(rawString).digest('hex');

        return {
            provider: 'gdelt',
            source: item.source || item.source_name || 'gdelt',
            url: item.url,
            published_at: publishedAt,
            fetched_at: new Date().toISOString(),
            title: item.title || 'Untitled',
            snippet: '', // Artlist mode doesn't provide snippets
            raw_hash: rawHash,
            _raw: item,
            provider: 'gdelt' // Explicitly mark as gdelt
        };
    }
}

export function getProvider(name = 'local') {
    switch (name.toLowerCase()) {
        case 'web':
            return new WebNewsProvider();
        case 'gdelt':
            return new GdeltDocNewsProvider();
        case 'local':
        default:
            return new LocalFileNewsProvider();
    }
}
