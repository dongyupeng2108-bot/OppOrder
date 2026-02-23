import fs from 'fs';
import path from 'path';

// Usage: node scripts/ops_copy_file.mjs <src> <dst> [--force]

const args = process.argv.slice(2);
let force = false;
const paths = [];

for (const arg of args) {
    if (arg === '--force') {
        force = true;
    } else {
        paths.push(arg);
    }
}

if (paths.length < 2) {
    console.log(JSON.stringify({ op: 'copy', error: 'Usage: node scripts/ops_copy_file.mjs <src> <dst> [--force]', ok: false }));
    process.exit(1);
}

const src = paths[0];
const dst = paths[1];

const result = {
    op: 'copy',
    src,
    dst,
    force,
    ok: false
};

try {
    if (!fs.existsSync(src)) {
        throw new Error(`Source file not found: ${src}`);
    }

    if (fs.existsSync(dst) && !force) {
        throw new Error(`Destination exists and --force not specified: ${dst}`);
    }
    
    // Check parent directory of destination
    const dstDir = path.dirname(dst);
    if (!fs.existsSync(dstDir)) {
        throw new Error(`Destination parent directory not found: ${dstDir}`);
    }

    fs.copyFileSync(src, dst);
    result.ok = true;
    console.log(JSON.stringify(result));

} catch (err) {
    result.error = err.message;
    console.log(JSON.stringify(result));
    process.exit(1);
}
