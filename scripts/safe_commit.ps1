param(
    [Parameter(Mandatory=$true)]
    [string]$Message,

    [Parameter(Mandatory=$false)]
    [string]$Mode = "Dev"
)

$ErrorActionPreference = "Stop"

Write-Host "Running Safe Commit..."

# --- HardStop Latch Check (New) ---
$RepoRoot = "E:\OppRadar"
$CurrentBranch = git rev-parse --abbrev-ref HEAD
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$TaskIdMatch = [regex]::Match($CurrentBranch, "\d{6}_\d{3}[a-z]?")
if ($TaskIdMatch.Success) {
    $TaskId = $TaskIdMatch.Value
    Write-Host ">>> [SafeCommit] Checking HardStop Latch for $TaskId..." -ForegroundColor Cyan
    node "$RepoRoot\scripts\ops_hardstop_latch.mjs" --action check --task_id $TaskId --mode $Mode --entry safe_commit
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
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
