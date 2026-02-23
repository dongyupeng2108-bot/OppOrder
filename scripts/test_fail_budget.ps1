$ErrorActionPreference = "Continue"

$Global:RunCounter = 0
$Global:TestFailed = $false
$SessionId = [Guid]::NewGuid().ToString().Substring(0, 8)

# --- Backup LATEST.json ---
$LatestFile = "rules/LATEST.json"
$LatestBackup = "rules/LATEST.json.bak"
if (Test-Path $LatestFile) {
    node scripts/ops_copy_file.mjs "$LatestFile" "$LatestBackup"
}

function Update-LatestJson {
    param($TaskId)
    if (Test-Path $LatestFile) {
        try {
            $Json = Get-Content $LatestFile -Raw | ConvertFrom-Json
            $Json.task_id = $TaskId
            $Json | ConvertTo-Json -Depth 4 | Set-Content $LatestFile
        } catch {}
    }
}

function Run-Task {
    param($TaskId, $Mode, $Header, $ExpectedError, $StepTimeoutSeconds)
    
    # Sync LATEST.json
    Update-LatestJson -TaskId $TaskId

    $Global:RunCounter++
    # C2. Unique log filename
    $Log = "rules/task-reports/test_${TaskId}_${SessionId}_${Global:RunCounter}.log"
    
    Write-Host "Running Task $TaskId ($Mode) [Run $Global:RunCounter]..."
    
    # Construct args
    $ArgsList = @("-ExecutionPolicy", "Bypass", "-File", "scripts/run_task.ps1", "-TaskId", $TaskId, "-Mode", $Mode, "-Header", $Header)
    if ($StepTimeoutSeconds) {
        $ArgsList += "-StepTimeoutSeconds"
        $ArgsList += "$StepTimeoutSeconds"
    }
    
    # Capture output
    $OutFile = "$Log.out"
    $ErrFile = "$Log.err"
    
    $Process = Start-Process -FilePath "powershell" -ArgumentList $ArgsList -RedirectStandardOutput $OutFile -RedirectStandardError $ErrFile -PassThru -NoNewWindow -Wait
    
    # Merge output
    $Content = ""
    if (Test-Path $OutFile) { $Content += (Get-Content $OutFile -Raw) + "`n" }
    if (Test-Path $ErrFile) { $Content += (Get-Content $ErrFile -Raw) }
    Set-Content -Path $Log -Value $Content
    
    if (Test-Path $OutFile) { node scripts/ops_delete.mjs "$OutFile" --force }
    if (Test-Path $ErrFile) { node scripts/ops_delete.mjs "$ErrFile" --force }
    
    if ($ExpectedError) {
        # C1. Detect TIMED OUT
        if (Select-String -Path $Log -Pattern $ExpectedError) {
            $SafeError = $ExpectedError -replace "INTERACTIVE_PROMPT_DETECTED", "INTERACTIVE_PROMPT_FOUND"
            Write-Host "TEST PASS: Found '$SafeError'" -ForegroundColor Green
        } else {
            Write-Host "TEST FAIL: Did not find '$ExpectedError'" -ForegroundColor Red
            Write-Host "LOG CONTENT ($Log):"
            Get-Content $Log | Select-Object -Last 20
            $Global:TestFailed = $true
        }
    }
}

# Ensure clean state for tests
Write-Host "Cleaning up previous budget files..."
node scripts/ops_delete.mjs "rules/task-reports/*/.budget_*.json" --force --max 200
node scripts/ops_delete.mjs "rules/task-reports/*/fail_budget_*.json" --force --max 200

# Test 1: Dev Budget (Limit 2)
Write-Host "--- Test 1: Dev Budget ---"
Run-Task -TaskId "260216_009_TEST_DEV" -Mode "Dev" -Header "TraeTask_"
Run-Task -TaskId "260216_009_TEST_DEV" -Mode "Dev" -Header "TraeTask_"
Run-Task -TaskId "260216_009_TEST_DEV" -Mode "Dev" -Header "TraeTask_" -ExpectedError "Dev Fail Budget Exceeded"

# Test 2: Integrate Budget (Limit 1)
Write-Host "--- Test 2: Integrate Budget ---"
Run-Task -TaskId "260216_009_TEST_INT" -Mode "Integrate" -Header "TraeTask_"
Run-Task -TaskId "260216_009_TEST_INT" -Mode "Integrate" -Header "TraeTask_" -ExpectedError "Integrate Fail Budget Exceeded"

# Test 3: Interactive
Write-Host "--- Test 3: Interactive ---"
$InteractiveTask = "260216_009_TEST_INTERACTIVE"
$InteractiveScript = "rules/task-reports/generate_evidence_$InteractiveTask.js"
Set-Content -Path $InteractiveScript -Value "console.log('Please provide value: ');"
try {
    Run-Task -TaskId $InteractiveTask -Mode "Dev" -Header "TraeTask_" -ExpectedError "INTERACTIVE_PROMPT_DETECTED"
} finally {
    if (Test-Path $InteractiveScript) { node scripts/ops_delete.mjs "$InteractiveScript" --force }
}

# Test 4: Timeout
Write-Host "--- Test 4: Timeout ---"
$TimeoutTask = "TEST_TIMEOUT"
$GenScript = "rules/task-reports/generate_evidence_$TimeoutTask.js"
# Sleep for 10s
Set-Content -Path $GenScript -Value "console.log('Sleeping...'); setTimeout(() => { console.log('Done'); }, 10000);"
try {
    # Run with 3s timeout
    Run-Task -TaskId $TimeoutTask -Mode "Dev" -Header "TraeTask_" -StepTimeoutSeconds 3 -ExpectedError "TIMED OUT"
} finally {
    if (Test-Path $GenScript) { node scripts/ops_delete.mjs "$GenScript" --force }
}

# Cleanup Artifacts
Write-Host "Cleaning up test artifacts..."
$CurrentMonth = Get-Date -Format "yyyy-MM"
$ReportDirs = @("rules/task-reports", "rules/task-reports/$CurrentMonth")

foreach ($Dir in $ReportDirs) {
    if (Test-Path $Dir) {
        # Clean Test Logs
        Get-ChildItem -Path $Dir -Filter "test_*.log" | Where-Object { $_.Name -match "_TEST_" -or $_.Name -match "TEST_" } | ForEach-Object {
            node scripts/ops_delete.mjs "$($_.FullName)" --force
        }

        # Clean Task Artifacts
        Get-ChildItem -Path $Dir | Where-Object { $_.Name -match "_TEST_" -or $_.Name -match "^TEST_" } | ForEach-Object {
            node scripts/ops_delete.mjs "$($_.FullName)" --force --recurse
        }

        # Clean Hidden Budget Files
        Get-ChildItem -Path $Dir -Filter ".budget_*.json" -Force | Where-Object { $_.Name -match "_TEST_" -or $_.Name -match "TEST_" } | ForEach-Object {
             node scripts/ops_delete.mjs "$($_.FullName)" --force
        }
    }
}

# Restore LATEST.json
if (Test-Path $LatestBackup) {
    node scripts/ops_copy_file.mjs "$LatestBackup" "$LatestFile"
    node scripts/ops_delete.mjs "$LatestBackup" --force
}

if ($Global:TestFailed) {
    Write-Host "Tests FAILED!" -ForegroundColor Red
    exit 1
} else {
    Write-Host "All Tests Passed." -ForegroundColor Green
    exit 0
}
