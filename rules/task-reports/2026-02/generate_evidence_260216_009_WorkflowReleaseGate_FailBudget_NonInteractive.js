const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const repoRoot = path.resolve(__dirname, '../../../');
const scriptPath = path.join(repoRoot, 'scripts', 'test_fail_budget.ps1');

console.log(">>> [Evidence] Running Regression Tests for Task 009...");
console.log(`>>> [Evidence] Script: ${scriptPath}`);

try {
    // Run the PowerShell test script
    // We use 'inherit' for stdio so output streams directly to parent process (captured by run_task.ps1 transcript)
    // But since run_task.ps1 uses pipe to Write-Host, 'inherit' might bypass the pipe?
    // No, 'inherit' connects to parent's stdout/stderr.
    // Parent's stdout is piped to Write-Host.
    // So 'inherit' should work.
    // Wait, run_task.ps1 does: cmd /c "node ... < NUL" 2>&1 | Write-Host
    // So node's stdout is piped. 'inherit' connects to node's stdout. So it works.
    
    // However, execSync with stdio 'inherit' returns null. We want output to be visible.
    execSync(`powershell -ExecutionPolicy Bypass -File "${scriptPath}"`, { stdio: 'inherit' });
    
    console.log(">>> [Evidence] Regression Tests PASSED.");
} catch (error) {
    console.error(">>> [Evidence] Regression Tests FAILED.");
    console.error(error.message);
    process.exit(1);
}
