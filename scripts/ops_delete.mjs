import fs from 'fs';
import path from 'path';

// Usage: node scripts/ops_delete.mjs <pathOrGlob> [--force] [--recurse] [--dry-run] [--max N] [--allow-under <root>]

const args = process.argv.slice(2);
let pattern = '';
let force = false;
let recurse = false;
let dryRun = false;
let maxFiles = 50;
let allowUnder = process.cwd(); // Default: RepoRoot

// --- Parse Arguments ---
for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--force') {
        force = true;
    } else if (arg === '--recurse') {
        recurse = true;
    } else if (arg === '--dry-run') {
        dryRun = true;
    } else if (arg === '--max') {
        maxFiles = parseInt(args[i + 1], 10);
        i++;
    } else if (arg === '--allow-under') {
        allowUnder = path.resolve(args[i + 1]);
        i++;
    } else if (!arg.startsWith('--')) {
        pattern = arg;
    }
}

const result = {
    op: 'delete',
    pattern,
    matched: 0,
    deleted: 0,
    dry_run: dryRun,
    ok: false,
    errors: []
};

if (!pattern) {
    result.errors.push('Usage: node scripts/ops_delete.mjs <pathOrGlob> ...');
    console.log(JSON.stringify(result));
    process.exit(1);
}

try {
    allowUnder = path.resolve(allowUnder);

    // --- Helper: Glob Matching ---
    function findFiles(pattern) {
        // 1. Direct match (no magic)
        if (!pattern.includes('*') && !pattern.includes('?')) {
            const abs = path.resolve(pattern);
            return fs.existsSync(abs) ? [abs] : [];
        }

        // 2. Magic match
        // Split into fixed base and pattern
        // Normalize path separators to forward slash for regex construction
        const p = pattern.replace(/\\/g, '/');
        
        // Find the first magic character
        const magicIdx = p.search(/[\*\?]/);
        let base = p.substring(0, magicIdx);
        let magic = p.substring(magicIdx);
        
        // Adjust base to be a directory
        const lastSlash = base.lastIndexOf('/');
        if (lastSlash !== -1) {
            magic = base.substring(lastSlash + 1) + magic;
            base = base.substring(0, lastSlash);
        } else {
            // Pattern starts with magic or is relative to cwd
            // If base is empty, it means relative to cwd
            if (base === '') base = '.';
        }

        const absBase = path.resolve(base);
        if (!fs.existsSync(absBase)) return [];

        const found = [];
        
        // Convert glob magic to regex
        // We support: * (non-recursive wildcard), ** (recursive wildcard), ? (single char)
        // Escape regex special chars except * and ?
        // Note: This is a simplified glob to regex.
        let regexStr = '^' + magic
            .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape regex chars
            .replace(/\*\*/g, '.__RECURSIVE__')     // Placeholder for **
            .replace(/\*/g, '[^/\\\\]*')           // * matches non-separator
            .replace(/\?/g, '.')                    // ? matches any char
            .replace(/\.__RECURSIVE__/g, '.*');     // ** matches anything
        
        regexStr += '$';
        const regex = new RegExp(regexStr);

        // Walker
        function walk(dir, relativeToScanRoot) {
            try {
                const list = fs.readdirSync(dir);
                for (const item of list) {
                    const fullPath = path.join(dir, item);
                    const relPath = relativeToScanRoot ? relativeToScanRoot + '/' + item : item;
                    
                    // Check match
                    if (regex.test(relPath)) {
                        found.push(fullPath);
                    }
                    
                    // Recurse if needed (if pattern contains ** or we just want to traverse)
                    // For performance, only recurse if pattern has **
                    if (magic.includes('**')) {
                         const stat = fs.statSync(fullPath);
                         if (stat.isDirectory()) {
                             walk(fullPath, relPath);
                         }
                    }
                }
            } catch (e) {
                // Ignore permission errors etc.
            }
        }
        
        walk(absBase, '');
        return found;
    }

    const matchedFiles = findFiles(pattern);

    // --- Validate & Filter ---
    const validFiles = [];
    for (const file of matchedFiles) {
        const absFile = path.resolve(file);
        
        // Check 1: Under Allow Root
        const normFile = absFile.toLowerCase();
        const normRoot = allowUnder.toLowerCase();
        
        if (!normFile.startsWith(normRoot)) {
            result.errors.push(`File outside allowed root: ${absFile}`);
            continue;
        }

        // Check 2: Protect .git
        if (absFile.includes(path.sep + '.git') || absFile.includes('/.git')) {
             result.errors.push(`Protected path: ${absFile}`);
             continue;
        }

        validFiles.push(absFile);
    }

    result.matched = validFiles.length;

    // Check 3: Max Files
    if (validFiles.length > maxFiles) {
        throw new Error(`Matched files (${validFiles.length}) exceeds limit (${maxFiles}). Use --max N to increase.`);
    }

    // --- Delete ---
    let deletedCount = 0;
    
    // Sort reverse length to delete children before parents
    validFiles.sort((a, b) => b.length - a.length);

    for (const file of validFiles) {
        if (dryRun) {
            // Just simulate
            deletedCount++;
        } else {
            try {
                // Check if exists (might have been deleted if child of deleted dir)
                if (!fs.existsSync(file)) {
                    // Already gone (e.g. we deleted parent dir)
                    // We count it as deleted or just ignore?
                    // If we explicitly matched it, we should count it.
                    // But if we deleted 'dir', and 'dir/file' was in list, it's gone.
                    continue;
                }

                const stat = fs.statSync(file);
                if (stat.isDirectory()) {
                    if (recurse) {
                        fs.rmSync(file, { recursive: true, force: true });
                        deletedCount++;
                    } else {
                        // Try rmdir (only works if empty)
                        fs.rmdirSync(file);
                        deletedCount++;
                    }
                } else {
                    fs.unlinkSync(file);
                    deletedCount++;
                }
            } catch (err) {
                if (err.code !== 'ENOENT') {
                    result.errors.push(`Failed to delete ${file}: ${err.message}`);
                }
            }
        }
    }

    result.deleted = dryRun ? deletedCount : result.matched - result.errors.length; // Approximate for summary
    // Correct deleted count for non-dry-run: we iterated validFiles.
    if (!dryRun) {
         // Actually, if we deleted a parent, children are gone.
         // But our count logic above increments only on explicit delete call success.
         // If child was auto-deleted by parent delete, we didn't increment.
         // But that's fine, we reported "matched".
         // Let's just return what we successfully called delete on.
         // Or should we return matched count if successful?
         // Simpler: result.deleted = deletedCount.
         result.deleted = deletedCount;
    }

    result.ok = result.errors.length === 0;
    console.log(JSON.stringify(result));

} catch (err) {
    result.ok = false;
    result.errors.push(err.message);
    console.log(JSON.stringify(result));
    process.exit(1);
}
