export class NewsStore {
    constructor() {
        this.items = []; // Main storage, sorted by ID DESC
        this.idSet = new Set(); // O(1) lookup for existing IDs
    }

    /**
     * Insert multiple items into the store.
     * Deduplicates based on 'id'.
     * Returns statistics on inserted/deduped count.
     * @param {Array} newItems - List of news items to insert
     * @returns {Object} { inserted: number, deduped: number }
     */
    upsertMany(newItems) {
        let inserted = 0;
        let deduped = 0;

        for (const item of newItems) {
            if (!item.id) {
                console.warn('[NewsStore] Skipping item without id:', item);
                continue;
            }

            if (this.idSet.has(item.id)) {
                deduped++;
                // Optional: Update existing item? 
                // Requirement says "Dedup based on id", implies "Keep existing" or "Overwrite".
                // Usually for news, if ID is same, content is same. We skip.
                continue;
            }

            this.items.push(item);
            this.idSet.add(item.id);
            inserted++;
        }

        if (inserted > 0) {
            // Maintain sort order: ID DESC (Newest first)
            // This is efficient enough for small in-memory lists.
            this.items.sort((a, b) => {
                if (a.id > b.id) return -1;
                if (a.id < b.id) return 1;
                return 0;
            });
        }

        return { inserted, deduped };
    }

    /**
     * List items with pagination.
     * @param {Object} options 
     * @param {string} options.since_id - Return items with ID > since_id
     * @param {number} options.limit - Max items to return (clamped 1-50)
     * @returns {Object} { items: Array, count: number, limit: number, since_id: string, next_since_id: string|null }
     */
    list({ since_id, limit } = {}) {
        // 1. Parse/Clamp Limit
        let safeLimit = parseInt(limit);
        if (isNaN(safeLimit) || safeLimit <= 0) safeLimit = 50; // Default if invalid
        if (safeLimit > 50) safeLimit = 50; // Max cap

        // 2. Filter
        let resultItems = this.items;
        
        // If since_id provided, we want items NEWER than since_id (ID > since_id)
        // Since items are sorted DESC, we can just filter.
        // Optimization: We could binary search, but filter is fine for MVP.
        if (since_id) {
            resultItems = resultItems.filter(item => item.id > since_id);
        }

        // 3. Slice
        // We take the top 'limit' items (which are the newest > since_id)
        const slicedItems = resultItems.slice(0, safeLimit);

        // 4. Cursor
        // For "since_id" pagination (moving forward in time/ID):
        // Usually client tracks the max ID they have seen.
        // So "next_since_id" should be the ID of the newest item returned?
        // Or if we are paging *backwards*? 
        // "since_id" usually implies "give me updates".
        // If I ask for since_id=100, and get [105, 104, 103], the next call should be since_id=105.
        // So `next_since_id` is the MAX ID in the returned batch.
        
        let nextSinceId = null;
        if (slicedItems.length > 0) {
            // Items are DESC, so first item is max ID
            nextSinceId = slicedItems[0].id;
        } else {
            // If no items returned, next_since_id is strictly speaking current since_id, 
            // or null to indicate "no change".
            // Let's return the current since_id if provided, or null.
            // Actually, if we return items, we update cursor. If empty, cursor stays same.
            nextSinceId = since_id || null;
        }

        return {
            items: slicedItems,
            count: slicedItems.length,
            limit: safeLimit,
            since_id: since_id || null,
            next_since_id: nextSinceId
        };
    }

    /**
     * Get total count of items in store.
     * @returns {number}
     */
    count() {
        return this.items.length;
    }
}
