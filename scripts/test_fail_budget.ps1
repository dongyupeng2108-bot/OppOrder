$ErrorActionPreference = "Continue"

function Run-Task {
    param($TaskId, $Mode, $Header, $ExpectedError)
    $Log = "rules/task-reports/test_$TaskId.log"
    Write-Host "Running Task $TaskId ($Mode)..."
    
    # Using specific command invocation to capture output correctly
    $Cmd = "powershell -ExecutionPolicy Bypass -File scripts/run_task.ps1 -TaskId $TaskId -Mode $Mode -Header `"$Header`""
    cmd /c "$Cmd > $Log 2>&1"
    
    if ($ExpectedError) {
        if (Select-String -Path $Log -Pattern $ExpectedError) {
            Write-Host "TEST PASS: Found '$ExpectedError'" -ForegroundColor Green
        } else {
            Write-Host "TEST FAIL: Did not find '$ExpectedError'" -ForegroundColor Red
            Get-Content $Log | Select-Object -Last 20
        }
    }
}

# Ensure clean state for tests (remove budget entries if exist)
# Since we use new TaskIDs, it should be fine.
# But if rerun, we might hit limits immediately.
# We will use random suffix or just remove the budget file entries if needed.
# For now, assume clean run.

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
Run-Task -TaskId "260216_009_TEST_INTERACTIVE" -Mode "Dev" -Header "TraeTask_" -ExpectedError "INTERACTIVE_PROMPT_DETECTED"
