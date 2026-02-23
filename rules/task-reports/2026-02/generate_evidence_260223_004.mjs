
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

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

    console.log('Evidence generation complete.');

} catch (error) {
    console.error('Evidence generation failed:', error.message);
    if (error.stdout) console.error('Stdout:', error.stdout.toString());
    if (error.stderr) console.error('Stderr:', error.stderr.toString());
    process.exit(1);
}
