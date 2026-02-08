import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// Interface for NewsProvider
class NewsProvider {
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

export function getProvider(name = 'local') {
    switch (name.toLowerCase()) {
        case 'web':
            return new WebNewsProvider();
        case 'local':
        default:
            return new LocalFileNewsProvider();
    }
}
