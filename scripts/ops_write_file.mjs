import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const [,, filePath, ...contentParts] = process.argv;
const content = contentParts.join(' ');

if (!filePath) {
    console.error('[WriteFile] ERROR: Missing file path argument');
    console.error('Usage: node scripts/ops_write_file.mjs <file_path> <content>');
    process.exit(1);
}

try {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content || '', 'utf8');
    console.log(`[WriteFile] OK: ${filePath}`);
} catch (err) {
    console.error(`[WriteFile] FAIL: ${filePath} - ${err.message}`);
    process.exit(1);
}
