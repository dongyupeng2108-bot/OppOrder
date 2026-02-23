
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const repoRoot = path.resolve(__dirname, '../../..');
const opsCopy = path.join(repoRoot, 'scripts', 'ops_copy_file.mjs');
const opsDelete = path.join(repoRoot, 'scripts', 'ops_delete.mjs');

const srcFile = path.join(__dirname, 'test_copy_src.txt');
const dstFile = path.join(__dirname, 'test_copy_dest.txt');

try {
    // Setup source file
    fs.writeFileSync(srcFile, 'This is a test file for ops_copy_file.mjs verification.');

    // 1. Verify Copy
    console.log('Verifying ops_copy_file.mjs...');
    // Ensure destination doesn't exist
    if (fs.existsSync(dstFile)) fs.unlinkSync(dstFile);
    
    const copyCmd = `node "${opsCopy}" "${srcFile}" "${dstFile}" --force`;
    const copyOut = execSync(copyCmd).toString().trim();
    console.log(copyOut);
    
    if (fs.existsSync(dstFile) && fs.readFileSync(dstFile, 'utf8') === fs.readFileSync(srcFile, 'utf8')) {
        console.log('Copy verification passed.');
    } else {
        throw new Error('Copy verification failed: Destination file missing or content mismatch.');
    }

    // 2. Verify Delete
    console.log('Verifying ops_delete.mjs...');
    const deleteCmd1 = `node "${opsDelete}" "${dstFile}" --force`;
    const deleteOut1 = execSync(deleteCmd1).toString().trim();
    console.log(deleteOut1);

    const deleteCmd2 = `node "${opsDelete}" "${srcFile}" --force`;
    const deleteOut2 = execSync(deleteCmd2).toString().trim();
    console.log(deleteOut2);

    if (!fs.existsSync(dstFile) && !fs.existsSync(srcFile)) {
        console.log('Delete verification passed.');
    } else {
        throw new Error('Delete verification failed: Files still exist.');
    }

    // Write result and notify files
    const resultFile = path.join(__dirname, 'result_260223_004.json');
    const notifyFile = path.join(__dirname, 'notify_260223_004.txt');
    
    fs.writeFileSync(resultFile, JSON.stringify({
        task_id: "260223_004",
        status: "success",
        evidence: {
            ops_copy_file: "verified",
            ops_delete: "verified"
        }
    }, null, 2));

    fs.writeFileSync(notifyFile, "Task 260223_004 Completed.\nVerified ops_copy_file.mjs and ops_delete.mjs.\nGATE_LIGHT_EXIT=0\n");

    console.log('Evidence generation complete.');

} catch (error) {
    console.error('Evidence generation failed:', error.message);
    if (error.stdout) console.error('Stdout:', error.stdout.toString());
    if (error.stderr) console.error('Stderr:', error.stderr.toString());
    process.exit(1);
}
