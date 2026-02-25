import fs from 'fs';
import path from 'path';

// Usage: node ops_write_file.mjs <file_path> <content> [encoding]
// Example: node ops_write_file.mjs "output.txt" "Hello World" "utf8"

const args = process.argv.slice(2);
if (args.length < 2) {
    console.error("Usage: node ops_write_file.mjs <file_path> <content> [encoding]");
    process.exit(1);
}

const filePath = args[0];
const content = args[1];
const encoding = args[2] || 'utf8';

try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, content, { encoding });
} catch (err) {
    console.error(`[ops_write_file] Error writing to ${filePath}: ${err.message}`);
    process.exit(1);
}
