const fs = require('fs');
const path = require('path');

const filePath = path.resolve('rules/task-reports/2026-02/gate_light_preview_260226_001.log');
console.log(`Normalizing file: ${filePath}`);

if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, 'utf8');
    // Remove BOM
    if (content.charCodeAt(0) === 0xFEFF) {
        content = content.slice(1);
    }
    // Normalize newlines to LF
    content = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    
    // Write back
    fs.writeFileSync(filePath, content, { encoding: 'utf8' });
    console.log('File normalized to UTF-8 (no BOM) and LF line endings.');
} else {
    console.error('File not found!');
    process.exit(1);
}
