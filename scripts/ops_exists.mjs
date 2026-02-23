import fs from 'fs';

// Usage: node ops_exists.mjs <file_path>
// Exit code 0 if exists, 1 if not.

const args = process.argv.slice(2);
if (args.length < 1) {
    console.error("Usage: node ops_exists.mjs <file_path>");
    process.exit(2);
}

const filePath = args[0];
if (fs.existsSync(filePath)) {
    process.exit(0);
} else {
    process.exit(1);
}
