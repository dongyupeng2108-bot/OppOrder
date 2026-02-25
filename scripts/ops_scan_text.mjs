import fs from 'fs';
import path from 'path';

// Usage: node scripts/ops_scan_text.mjs --globs "pattern" --pattern "regex" ...

const ARGS = process.argv.slice(2);
const REPO_ROOT = path.resolve(process.cwd());
const IS_WIN = process.platform === 'win32';

// Config
let config = {
    globs: [],
    pattern: null,
    ignores: ['.git/**', 'node_modules/**'], 
    maxHits: 50,
    maxFiles: 200,
    json: false,
    debug: false
};

// Parse Arguments
for (let i = 0; i < ARGS.length; i++) {
    const arg = ARGS[i];
    if (arg === '--globs') {
        const val = ARGS[++i];
        if (val) {
            val.split(',').forEach(v => config.globs.push(v.trim()));
        }
    } else if (arg === '--pattern') {
        config.pattern = ARGS[++i];
    } else if (arg === '--ignore') {
        const val = ARGS[++i];
        if (val) {
            val.split(',').forEach(v => config.ignores.push(v.trim()));
        }
    } else if (arg === '--max_hits') {
        config.maxHits = parseInt(ARGS[++i], 10);
    } else if (arg === '--max_files') {
        config.maxFiles = parseInt(ARGS[++i], 10);
    } else if (arg === '--json') {
        config.json = true;
    } else if (arg === '--debug') {
        config.debug = true;
    }
}

if (!config.pattern || config.globs.length === 0) {
    if (config.json) {
        console.log(JSON.stringify({ error: "Missing required arguments: --globs or --pattern" }));
    } else {
        console.error("Usage: node scripts/ops_scan_text.mjs --globs <glob> --pattern <regex> [--ignore <glob>] [--max_hits <N>] [--max_files <N>] [--json]");
    }
    process.exit(1);
}

// Normalize Path to forward slashes
function normalizePath(p) {
    return p.split(path.sep).join('/');
}

// Convert Glob to Regex
function globToRegex(glob) {
    let regex = glob;
    // Escape special regex chars (excluding * ? which are glob chars)
    regex = regex.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    
    // Handle ** (recursive match across directories)
    regex = regex.replace(/\*\*/g, '.*');
    
    // Handle * (single path component)
    regex = regex.replace(/\*/g, '[^/]*');
    
    // Handle ? (single char)
    regex = regex.replace(/\?/g, '.');
    
    // Use case-insensitive flag if Windows
    return new RegExp(`^${regex}$`, IS_WIN ? 'i' : '');
}

// Prepare Regexes
const globRegexes = config.globs.map(g => globToRegex(normalizePath(g)));
const ignoreRegexes = config.ignores.map(g => globToRegex(normalizePath(g)));

// Helper to check if a path should be ignored
function isIgnored(relPath, isDir) {
    const normalized = normalizePath(relPath);
    for (const ig of config.ignores) {
        const base = ig.replace(/\/\*\*$/, '');
        if (isDir) {
             if (normalized === base) return true;
             if (normalized.startsWith(base + '/')) return true;
        }
    }
    for (const re of ignoreRegexes) {
        if (re.test(normalized)) return true;
    }
    return false;
}

const searchRegex = new RegExp(config.pattern, IS_WIN ? 'i' : ''); // Case-insensitive content search? User didn't specify, but safer for Windows/PowerShell habits. Or strict? User pattern is regex. Let's assume strict unless specified? No, grep usually case-sensitive by default. But Select-String is case-insensitive by default.
// The user pattern "(Remove-Item|...)" has mixed case. "echo" is lowercase.
// "echo" matches "ECHO" in cmd but usually lowercase in scripts.
// Let's stick to Case-SENSITIVE for CONTENT unless pattern has flags (which we can't easily parse from string without assuming format).
// User pattern is a string. `new RegExp(string)`.
// I'll keep content search case-sensitive for now as per JS default, but path search case-insensitive on Windows.

// State
let state = {
    hitCount: 0,
    fileCount: 0, 
    scannedFiles: 0, 
    skippedFiles: 0,
    firstHits: [] 
};

// Walker
function walk(dir) {
    if (state.hitCount > config.maxHits || state.fileCount > config.maxFiles) return;

    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
        if (config.debug) console.error(`Error reading dir ${dir}: ${e.message}`);
        return; 
    }

    for (const entry of entries) {
        if (state.hitCount > config.maxHits || state.fileCount > config.maxFiles) return;

        const fullPath = path.join(dir, entry.name);
        const relPath = path.relative(REPO_ROOT, fullPath); 

        if (isIgnored(relPath, entry.isDirectory())) {
            if (config.debug) console.log(`Ignored: ${relPath}`);
            continue;
        }

        if (entry.isDirectory()) {
            walk(fullPath);
        } else if (entry.isFile()) {
            const normalized = normalizePath(relPath);
            let matched = false;
            for (const gr of globRegexes) {
                if (gr.test(normalized)) {
                    matched = true;
                    break;
                }
            }
            
            if (matched) {
                if (config.debug) console.log(`Scanning: ${normalized}`);
                scanFile(fullPath, normalized);
            } else {
                if (config.debug) console.log(`Not Matched: ${normalized}`);
            }
        }
    }
}

function scanFile(fullPath, relPath) {
    try {
        const stats = fs.statSync(fullPath);
        if (stats.size > 1024 * 1024) { // 1MB limit
            state.skippedFiles++;
            return;
        }

        const fd = fs.openSync(fullPath, 'r');
        const buffer = Buffer.alloc(512);
        const bytesRead = fs.readSync(fd, buffer, 0, 512, 0);
        fs.closeSync(fd);
        
        for (let i = 0; i < bytesRead; i++) {
            if (buffer[i] === 0) { 
                state.skippedFiles++;
                return;
            }
        }

        const content = fs.readFileSync(fullPath, 'utf8');
        state.scannedFiles++;
        
        const lines = content.split(/\r?\n/);
        let fileHasHit = false;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (searchRegex.test(line)) {
                state.hitCount++;
                fileHasHit = true;
                if (state.firstHits.length < 10) {
                    state.firstHits.push({
                        file: relPath,
                        line: i + 1,
                        content: line.trim().substring(0, 100)
                    });
                }
            }
            if (state.hitCount > config.maxHits) break;
        }
        
        if (fileHasHit) state.fileCount++;

    } catch (e) {
        if (config.debug) console.error(`Error scanning ${relPath}: ${e.message}`);
        state.skippedFiles++;
    }
}

try {
    walk(REPO_ROOT);
} catch (e) {
    // ignore
}

const limitExceeded = (state.hitCount > config.maxHits || state.fileCount > config.maxFiles);
const exitCode = limitExceeded ? 1 : 0;

if (config.json) {
    console.log(JSON.stringify({
        hit_count: state.hitCount,
        file_count: state.fileCount,
        scanned_files: state.scannedFiles,
        skipped_files: state.skippedFiles,
        first_hits: state.firstHits,
        limit_exceeded: limitExceeded
    }));
} else {
    console.log("=== Scan Result ===");
    console.log(`Hits: ${state.hitCount} / ${config.maxHits}`);
    console.log(`Files: ${state.fileCount} / ${config.maxFiles}`);
    console.log(`Scanned: ${state.scannedFiles}, Skipped: ${state.skippedFiles}`);
    if (state.firstHits.length > 0) {
        console.log("--- First Hits ---");
        state.firstHits.forEach(h => console.log(`[${h.file}:${h.line}] ${h.content}`));
    }
    if (limitExceeded) {
        console.error("FAIL: Scan limits exceeded");
    }
}

process.exit(exitCode);
