param(
    [Parameter(Mandatory=$true)]
    [string]$Message
)

$ErrorActionPreference = "Stop"

Write-Host "Running Safe Commit..."

# --- HardStop Latch Check ---
$RepoRoot = "E:\OppRadar"
$CurrentBranch = git rev-parse --abbrev-ref HEAD
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$TaskIdMatch = [regex]::Match($CurrentBranch, "\d{6}_\d{3}[a-z]?")
if ($TaskIdMatch.Success) {
    $TaskId = $TaskIdMatch.Value
    $LatchYearMonth = Get-Date -Format "yyyy-MM"
    $LatchPath = "$RepoRoot\rules\task-reports\$LatchYearMonth\.hardstop_latch_$TaskId.json"
    if (Test-Path $LatchPath) {
        Write-Host "========== HARD_STOP_LATCH_BLOCK ==========" -ForegroundColor Red
        Write-Host "BLOCKING: safe_commit"
        Write-Host "REASON: HardStop Latch exists for $TaskId"
        Write-Host "FILE: $LatchPath"
        Write-Host "==========================================="
        exit 1
    }
}
# ----------------------------

# 1. Git Add
Write-Host "1. Adding changes..."
git add -A
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# 2. Check Staged
$Staged = git diff --name-only --cached
if (-not $Staged) {
    Write-Host "Nothing to commit."
    exit 1
}

# 3. Git Commit
Write-Host "2. Committing..."
git commit -m "$Message"
exit $LASTEXITCODE
