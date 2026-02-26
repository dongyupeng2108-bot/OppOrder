$ErrorActionPreference = "Stop"

Write-Host "Running Safe Push..."
$CurrentBranch = git rev-parse --abbrev-ref HEAD
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# --- HardStop Latch Check ---
$RepoRoot = "E:\OppRadar"
$TaskIdMatch = [regex]::Match($CurrentBranch, "\d{6}_\d{3}[a-z]?")
if ($TaskIdMatch.Success) {
    $TaskId = $TaskIdMatch.Value
    $LatchYearMonth = Get-Date -Format "yyyy-MM"
    $LatchPath = "$RepoRoot\rules\task-reports\$LatchYearMonth\.hardstop_latch_$TaskId.json"
    if (Test-Path $LatchPath) {
        Write-Host "========== HARD_STOP_LATCH_BLOCK ==========" -ForegroundColor Red
        Write-Host "BLOCKING: safe_push"
        Write-Host "REASON: HardStop Latch exists for $TaskId"
        Write-Host "FILE: $LatchPath"
        Write-Host "==========================================="
        exit 1
    }
}
# ----------------------------

Write-Host "Pushing to origin/$CurrentBranch..."
git push origin $CurrentBranch
exit $LASTEXITCODE
