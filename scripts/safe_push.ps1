$ErrorActionPreference = "Stop"

Write-Host "Running Safe Push..."
$CurrentBranch = git rev-parse --abbrev-ref HEAD
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# --- HardStop Latch Check ---
$RepoRoot = "E:\OppRadar"
$TaskIdMatch = [regex]::Match($CurrentBranch, "\d{6}_\d{3}[a-z]?")
if ($TaskIdMatch.Success) {
    $TaskId = $TaskIdMatch.Value
    node "$RepoRoot\scripts\ops_hardstop_latch.mjs" --action check --task_id $TaskId --mode Dev --entry safe_push
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
# ----------------------------

Write-Host "Pushing to origin/$CurrentBranch..."
git push origin $CurrentBranch
exit $LASTEXITCODE
