<#
.SYNOPSIS
    Development Batch Mode Script (Dev vs Integrate)
    
.DESCRIPTION
    Streamlines the "Two-Phase Rhythm" workflow:
    1. Dev Mode: Local changes, minimal smoke tests (No evidence, No LATEST update).
    2. Integrate Mode: Healthcheck, Envelope Build, Postflight, Pre-PR Check.
    
    Fails fast on any error. No interactive prompts.

.PARAMETER Mode
    'Dev' or 'Integrate' (Mandatory)

.PARAMETER TaskId
    Task ID (e.g., '260208_001') (Mandatory)

.PARAMETER Summary
    Summary text for Envelope Build (Mandatory for Integrate mode)
#>

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet('Dev', 'Integrate')]
    [string]$Mode,

    [Parameter(Mandatory=$true)]
    [string]$TaskId,

    [string]$Summary = "No summary provided"
)

$ErrorActionPreference = "Stop"

function Check-LastExitCode {
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Command failed with exit code $LASTEXITCODE. Aborting."
        exit 1
    }
}

# --- Common Setup ---
$RepoRoot = "E:\OppRadar"
$RulesDir = Join-Path $RepoRoot "rules"
$ReportsDir = Join-Path $RulesDir "task-reports\2026-02"

# Ensure no cd /d used (PowerShell Set-Location is safe)
Set-Location $RepoRoot

Write-Host ">>> Starting Batch Mode: $Mode (Task: $TaskId)" -ForegroundColor Cyan

if ($Mode -eq 'Dev') {
    # --- Dev Phase ---
    Write-Host "--- [Dev Phase] ---" -ForegroundColor Green
    Write-Host "1. Checking environment..."
    if (!(Test-Path "scripts")) { Write-Error "scripts/ directory not found!"; exit 1 }
    
    Write-Host "2. Running minimal smoke tests (Placeholder)..."
    # Add project-specific smoke commands here if needed
    # node scripts/smoke_test.js ...
    
    Write-Host "Dev Phase Complete. Ready for coding/testing."
    Write-Host "Remember: DO NOT generate evidence or update LATEST.json until Integrate phase."
}
elseif ($Mode -eq 'Integrate') {
    # --- Integrate Phase ---
    Write-Host "--- [Integrate Phase] ---" -ForegroundColor Yellow
    
    # 1. Healthcheck
    Write-Host "1. Running Healthcheck..."
    $HcRoot = Join-Path $ReportsDir "${TaskId}_healthcheck_53122_root.txt"
    $HcPairs = Join-Path $ReportsDir "${TaskId}_healthcheck_53122_pairs.txt"
    
    # Use curl.exe --output to avoid PowerShell redirection encoding issues (UTF-16/BOM)
    # and ensure headers are captured (-i).
    curl.exe -s -i http://localhost:53122/ --output $HcRoot
    curl.exe -s -i http://localhost:53122/pairs --output $HcPairs
    
    # Copy to reports/ for envelope_build (legacy compatibility)
    # envelope_build.mjs expects reports/healthcheck_root.txt
    $LegacyReportsDir = Join-Path $RepoRoot "reports"
    if (-not (Test-Path $LegacyReportsDir)) { New-Item -ItemType Directory -Path $LegacyReportsDir | Out-Null }
    Copy-Item $HcRoot -Destination (Join-Path $LegacyReportsDir "healthcheck_root.txt") -Force
    Copy-Item $HcPairs -Destination (Join-Path $LegacyReportsDir "healthcheck_pairs.txt") -Force
    
    Write-Host "   Saved to $HcRoot and $HcPairs"

    # 2. Envelope Build
    Write-Host "2. Building Envelope..."
    node scripts/envelope_build.mjs --task_id $TaskId --result_dir $ReportsDir --status DONE --summary $Summary
    Check-LastExitCode

    # 3. Postflight Validation
    Write-Host "3. Running Postflight..."
    node scripts/postflight_validate_envelope.mjs --task_id $TaskId --result_dir $ReportsDir --report_dir $ReportsDir
    Check-LastExitCode

    # 4. Pre-PR Check
    Write-Host "4. Running Pre-PR Check..."
    node scripts/pre_pr_check.mjs --task_id $TaskId
    Check-LastExitCode

    Write-Host "--- [Integrate Phase Complete] ---" -ForegroundColor Green
    Write-Host "Ready to commit and push:"
    Write-Host "  git add -A"
    Write-Host "  git commit -m '...'"
    Write-Host "  git push ..."
    Write-Host "  gh pr create ..."
}
