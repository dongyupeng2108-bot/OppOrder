import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);
const taskIdArg = args.find(arg => arg.startsWith('--task_id='));
const logArg = args.find(arg => arg.startsWith('--log='));

if (!taskIdArg || !logArg) {
    console.error('Usage: node scripts/extract_gate_light_preview.mjs --task_id=<id> --log=<path_to_log>');
    process.exit(1);
}

const taskId = taskIdArg.split('=')[1];
const logPath = logArg.split('=')[1];

if (!fs.existsSync(logPath)) {
    console.error(`[Extract Preview] Error: Log file not found at ${logPath}`);
    process.exit(1);
}

const logBuffer = fs.readFileSync(logPath);
const logContent = logBuffer.toString('utf8');
if (logContent.charCodeAt(0) === 0xFEFF || logContent.includes('\r\n')) {
    console.error('FAIL_REASON=PREVIEW_ENCODING');
    console.error(`[Extract Preview] Error: Log must be LF + UTF-8 (no BOM): ${logPath}`);
    process.exit(1);
}
const lines = logContent.split('\n');

// Strategy: Extract from first '[Gate Light]' to 'GATE_LIGHT_EXIT='
let startIndex = -1;
let endIndex = -1;

for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (startIndex === -1 && line.startsWith('[Gate Light]')) {
        startIndex = i;
    }
    if (line.startsWith('GATE_LIGHT_EXIT=')) {
        endIndex = i;
    }
}

if (startIndex === -1 || endIndex === -1) {
    console.error('[Extract Preview] Error: Could not find valid Gate Light block ([Gate Light] ... GATE_LIGHT_EXIT=) in log.');
    // If we can't find the block, we can't extract.
    // However, for negative tests or partial runs, we might need to be flexible?
    // User says "Extract 'stable match' preview block".
    // If missing, fail?
    console.error(`Debug: startIndex=${startIndex}, endIndex=${endIndex}`);
    process.exit(1);
}

const previewLines = lines.slice(startIndex, endIndex + 1);
const filteredLines = previewLines.filter(line => {
    const trimmed = line.trim();
    return trimmed.startsWith('[Gate Light]') || trimmed.startsWith('[BLOCK]') || trimmed.startsWith('[Postflight]') || trimmed.startsWith('GATE_LIGHT_EXIT=');
});
const previewContent = filteredLines.join('\n');

const outputContent = `=== GATE_LIGHT_PREVIEW ===
${previewContent}`;

const outputDir = path.dirname(logPath);
const outputPath = path.join(outputDir, `gate_light_preview_${taskId}.txt`);

if (outputContent.includes('\r\n') || outputContent.charCodeAt(0) === 0xFEFF) {
    console.error('FAIL_REASON=PREVIEW_ENCODING');
    console.error('[Extract Preview] Error: Preview content must be LF + UTF-8 (no BOM).');
    process.exit(1);
}
fs.writeFileSync(outputPath, outputContent);
console.log(`[Extract Preview] Wrote preview to: ${outputPath}`);
