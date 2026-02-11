
$TaskId = "260211_006"
$RepoRoot = "E:\OppRadar"
$RulesDir = Join-Path $RepoRoot "rules"
$ReportsDir = Join-Path $RulesDir "task-reports\2026-02"
$LocksDir = Join-Path $RulesDir "task-reports\locks"
$LockFile = Join-Path $LocksDir "${TaskId}.lock.json"
$LockBackup = "${LockFile}.bak"

$RunsDir = Join-Path $RulesDir "task-reports\runs\${TaskId}"
$RunsBackup = "${RunsDir}_bak"

$GateScript = "scripts/gate_light_ci.mjs"
$OutputFile = Join-Path $ReportsDir "deletion_audit_negative_test_${TaskId}.txt"

Set-Location $RepoRoot

function Run-GateLight {
    param($Label)
    Write-Host "--- Running Gate Light ($Label) ---"
    "--- Running Gate Light ($Label) ---" | Out-File -FilePath $OutputFile -Append -Encoding UTF8
    
    # Run Gate Light directly with --task_id (Task 260211_006)
    $output = node $GateScript --task_id $TaskId 2>&1
    $exitCode = $LASTEXITCODE
    
    $output | Out-File -FilePath $OutputFile -Append -Encoding UTF8
    "EXIT_CODE=$exitCode" | Out-File -FilePath $OutputFile -Append -Encoding UTF8
    
    if ($exitCode -eq 41) {
        Write-Host "PASS: Gate Light correctly failed with Exit 41." -ForegroundColor Green
    } else {
        Write-Host "FAIL: Gate Light exited with $exitCode (Expected 41)." -ForegroundColor Red
    }
}

# Clear previous output
if (Test-Path $OutputFile) { Remove-Item $OutputFile }

Write-Host "Starting Negative Tests for Deletion Audit..."

# Test 1: Missing Lock File
if (Test-Path $LockFile) {
    Move-Item -Path $LockFile -Destination $LockBackup -Force
    try {
        Run-GateLight "Missing Lock File"
    } finally {
        Move-Item -Path $LockBackup -Destination $LockFile -Force
    }
} else {
    Write-Error "Lock file not found for test!"
}

# Test 2: Missing Run Directory
# We need to find the run dir from index or just rename the whole task run folder
if (Test-Path $RunsDir) {
    Move-Item -Path $RunsDir -Destination $RunsBackup -Force
    try {
        Run-GateLight "Missing Run Directory"
    } finally {
        Move-Item -Path $RunsBackup -Destination $RunsDir -Force
    }
} else {
    Write-Error "Runs directory not found for test!"
}

Write-Host "Negative Tests Completed. Evidence saved to $OutputFile"
