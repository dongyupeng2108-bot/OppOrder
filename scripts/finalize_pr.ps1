<#
.SYNOPSIS
    Automates PR submission, monitoring, and one-shot auto-fixing for Trae tasks.
    Implements the "Recalculable Link" fix for CI Parity/Evidence drift.

.DESCRIPTION
    1. Pushes current branch.
    2. Creates PR if not exists.
    3. Watches PR checks.
    4. If checks fail, attempts ONE auto-fix round:
       - Fetch origin/main (unshallow if needed).
       - Recompute CI Parity (ci_parity_probe.mjs).
       - Reassemble Evidence (assemble_evidence.mjs).
       - Verify Local Gate Light.
       - Append commit and push.
    5. Re-watches checks.

.PARAMETER TaskId
    The Task ID (e.g., 260218_019). Mandatory.

.PARAMETER Branch
    The branch to push/PR. Defaults to current branch.

.EXAMPLE
    .\scripts\finalize_pr.ps1 -TaskId 260218_019
#>

param (
    [Parameter(Mandatory=$true)]
    [string]$TaskId,

    [string]$Branch
)

$ErrorActionPreference = "Stop"

# Verify gh CLI
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    Write-Error "GitHub CLI (gh) is not installed or not in PATH."
    exit 1
}

# Helper to get current branch
if ([string]::IsNullOrWhiteSpace($Branch)) {
    $Branch = git branch --show-current
    if ([string]::IsNullOrWhiteSpace($Branch)) {
        Write-Error "Could not determine current branch. Please specify -Branch."
        exit 1
    }
}

Write-Host "[Finalizer] Task: $TaskId | Branch: $Branch"

# 1. Push
Write-Host "[Finalizer] Pushing to origin/$Branch..."
git push origin $Branch
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# 2. Check/Create PR
Write-Host "[Finalizer] Checking for existing PR..."
$PRJson = gh pr list --head $Branch --json number,url,state | ConvertFrom-Json
$PRNumber = $null

if ($PRJson.Count -eq 0) {
    Write-Host "[Finalizer] No PR found. Creating..."
    # Try to use existing title/body if possible, or defaults
    gh pr create --fill --head $Branch
    if ($LASTEXITCODE -ne 0) { 
        Write-Error "[Finalizer] Failed to create PR."
        exit 1 
    }
    # Re-fetch to get number
    $PRJson = gh pr list --head $Branch --json number,url,state | ConvertFrom-Json
}

if ($PRJson.Count -gt 0) {
    $PRNumber = $PRJson[0].number
    Write-Host "[Finalizer] Monitoring PR #$PRNumber (${PRJson[0].url})..."
} else {
    Write-Error "[Finalizer] Failed to resolve PR number."
    exit 1
}

# 3. Watch Loop
$MaxRetries = 1
$RetryCount = 0

while ($true) {
    Write-Host "[Finalizer] Watching PR checks (Timeout: 10m)..."
    # gh pr checks returns 0 on pass, 1 on fail
    # We use --watch to wait.
    gh pr checks $PRNumber --watch --interval 10
    $CheckExitCode = $LASTEXITCODE

    if ($CheckExitCode -eq 0) {
        Write-Host "[Finalizer] SUCCESS: All checks passed. PR #$PRNumber is ready."
        exit 0
    }

    Write-Warning "[Finalizer] Checks FAILED."

    if ($RetryCount -ge $MaxRetries) {
        Write-Error "[Finalizer] Max retries ($MaxRetries) exceeded. Stopping."
        gh pr checks $PRNumber # Show the failed checks
        exit 1
    }

    $RetryCount++
    Write-Host "[Finalizer] Attempting Auto-Fix ($RetryCount/$MaxRetries) - Recalculable Link..."

    # --- Auto-Fix Routine ---
    
    # A. Fetch & Unshallow
    Write-Host "-> Fetching origin/main..."
    git fetch origin main --prune
    $IsShallow = git rev-parse --is-shallow-repository
    if ($IsShallow -eq "true") {
        Write-Host "-> Unshallowing repository..."
        git fetch --prune --unshallow origin
    }

    # B. Locate RunDir
    $LockFile = "rules/task-reports/locks/$TaskId.lock.json"
    if (-not (Test-Path $LockFile)) {
        Write-Error "Lock file not found at $LockFile. Cannot auto-fix."
        exit 1
    }
    try {
        $LockData = Get-Content $LockFile -Raw | ConvertFrom-Json
        $RunDir = $LockData.run_dir
        $Mode = $LockData.mode
    } catch {
        Write-Error "Failed to read lock file."
        exit 1
    }
    Write-Host "-> RunDir: $RunDir"
    Write-Host "-> Mode: $Mode"

    # C. Recompute Evidence (Probe + Assemble)
    Write-Host "-> Recomputing CI Parity Evidence..."
    node scripts/ci_parity_probe.mjs --task_id $TaskId --result_dir $RunDir
    if ($LASTEXITCODE -ne 0) { Write-Error "Probe failed."; exit 1 }

    Write-Host "-> Reassembling Evidence..."
    node scripts/assemble_evidence.mjs --task_id=$TaskId --evidence_dir=$RunDir --mode=$Mode
    if ($LASTEXITCODE -ne 0) { Write-Error "Assemble failed."; exit 1 }

    # D. Local Gate Light Verify
    Write-Host "-> Verifying with Local Gate Light..."
    node scripts/gate_light_ci.mjs --task_id $TaskId --mode Integrate
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Local Gate Light failed. Auto-fix aborted."
        exit 1
    }

    # E. Commit & Push
    Write-Host "-> Committing and Pushing fix..."
    git add .
    # Check if anything to commit
    $Status = git status --porcelain
    if ($Status) {
        git commit -m "fix(auto): recompute ci parity and evidence (Task $TaskId)"
        git push origin $Branch
        if ($LASTEXITCODE -ne 0) { Write-Error "Push failed."; exit 1 }
        
        Write-Host "[Finalizer] Waiting 15s for GitHub to register new checks..."
        Start-Sleep -Seconds 15
    } else {
        Write-Warning "No changes detected after recomputation. It might be a non-evidence issue."
        # If no changes, we can't fix it via this method.
        # But maybe the previous checks failed due to flake?
        # We'll retry watching.
    }

    Write-Host "[Finalizer] Auto-Fix applied. Re-watching checks..."
}
