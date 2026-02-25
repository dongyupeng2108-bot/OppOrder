import fs from 'fs';
import path from 'path';
import os from 'os';

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
    warnings: [],
    errors: []
};

if (!pattern) {
    result.errors.push('Usage: node scripts/ops_delete.mjs <pathOrGlob> ...');
    console.log(JSON.stringify(result));
    process.exit(1);
}

try {
    allowUnder = path.resolve(allowUnder);

    // --- Allowed Roots Strategy ---
    // 1. User specified root (default: repo root)
    // 2. System Temp
    // 3. User Temp
    const allowedRoots = [
        allowUnder,
        os.tmpdir(),
        'C:\\Windows\\Temp',
        // Hardcoded common user temp to be safe if os.tmpdir() varies
        `C:\\Users\\${process.env.USERNAME || 'ypdong'}\\AppData\\Local\\Temp` 
    ].map(r => path.resolve(r).toLowerCase());

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
        
        // Check 1: Under Allowed Roots
        const normFile = absFile.toLowerCase();
        let isAllowed = false;

        for (const root of allowedRoots) {
            if (normFile.startsWith(root)) {
                isAllowed = true;
                break;
            }
        }
        
        if (!isAllowed) {
            result.warnings.push(`File outside allowed root (skipped): ${absFile}`);
            result.skipped = true;
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

    // --- Delete Files ---
    for (const absFile of validFiles) {
        if (result.deleted >= maxFiles) {
            result.warnings.push(`Max files limit (${maxFiles}) reached. Skipping remaining.`);
            break;
        }

        try {
            const isAllowed = allowedRoots.some(root => absFile.toLowerCase().startsWith(root));
            if (!isAllowed) {
                result.warnings.push(`File outside allowed root (skipped): ${absFile}`);
                result.skipped = true;
                continue;
            }

            if (dryRun) {
                result.deleted++;
                continue;
            }

            if (fs.lstatSync(absFile).isDirectory()) {
                if (recurse) {
                    fs.rmSync(absFile, { recursive: true, force: true });
                    result.deleted++;
                } else {
                    result.warnings.push(`Skipping directory (use --recurse to delete): ${absFile}`);
                }
            } else {
                fs.unlinkSync(absFile);
                result.deleted++;
            }
        } catch (err) {
            result.warnings.push(`Failed to delete ${absFile}: ${err.message}`);
        }
    }

    result.ok = true; // Always return true to prevent workflow failure on non-critical delete issues
    console.log(JSON.stringify(result));

} catch (err) {
    result.ok = false;
    result.errors.push(err.message);
    console.log(JSON.stringify(result));
    process.exit(1);
}
