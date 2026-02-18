param (
    [Parameter(Mandatory=$true)]
    [string]$TaskId,

    [Parameter(Mandatory=$true)]
    [ValidateSet("Dev", "Integrate")]
    [string]$Mode,

    [Parameter(Mandatory=$true)]
    [string]$Header,

    [switch]$NonInteractive = $true,

    [Parameter(Mandatory=$false)]
    [int]$StepTimeoutSeconds = 120
)

# --- Parameter Normalization ---
$TaskId = $TaskId.Trim()
$Mode = $Mode.Trim()
$Header = $Header.Trim()

$ErrorActionPreference = "Stop"
if ($NonInteractive) {
    $ProgressPreference = 'SilentlyContinue'
}

$RepoRoot = "E:\OppRadar"

# --- Import Unified Command Executor ---
. "$RepoRoot\scripts\ps\Invoke-Step.ps1"

# --- 0. Fail Budget & Immutable Integrate Guard ---
$YearMonth = Get-Date -Format "yyyy-MM"
$BudgetFile = "$RepoRoot\rules\task-reports\$YearMonth\.budget_$TaskId.json"
if (-not (Test-Path "$RepoRoot\rules\task-reports\$YearMonth")) {
    New-Item -ItemType Directory -Path "$RepoRoot\rules\task-reports\$YearMonth" -Force | Out-Null
}

# Load Budget
$Budget = @{ Dev = 0; Integrate = 0 }
if (Test-Path $BudgetFile) {
    try {
        $Json = Get-Content $BudgetFile -Raw | ConvertFrom-Json
        $Budget.Dev = $Json.Dev
        $Budget.Integrate = $Json.Integrate
    } catch {
        Write-Warning "Failed to load budget file. Resetting."
    }
}

# Increment & Check
if ($Mode -eq "Dev") {
    $Budget.Dev++
    if ($Budget.Dev -gt 2) {
        Write-Error "[RunTask] FAILED: Dev Fail Budget Exceeded ($($Budget.Dev)/2)."
        Write-Error "    You have exhausted your 2 allowed Dev attempts for Task $TaskId."
        Write-Error "    Action: Fix your code/logic and use a NEW Task ID."
        $Budget | ConvertTo-Json | Set-Content $BudgetFile
        exit 1
    }
} elseif ($Mode -eq "Integrate") {
    $Budget.Integrate++
    if ($Budget.Integrate -gt 1) {
        Write-Error "[RunTask] FAILED: Integrate Fail Budget Exceeded ($($Budget.Integrate)/1)."
        Write-Error "    Integrate mode is strictly One-Shot."
        Write-Error "    Action: Use a NEW Task ID."
        $Budget | ConvertTo-Json | Set-Content $BudgetFile
        exit 1
    }
}

# Save Budget
$Budget | ConvertTo-Json | Set-Content $BudgetFile

# --- 1. Immutable Integrate Guard (Fail-fast) ---
if ($Mode -eq "Integrate") {
    $LockFile = "$RepoRoot\rules\task-reports\locks\$TaskId.lock.json"
    if (Test-Path $LockFile) {
        Write-Error "[RunTask] FAILED: Immutable Integrate Guard Triggered."
        Write-Error "    Lock file already exists: $LockFile"
        Write-Error "    You MUST use a new task_id. Modification of locked tasks is FORBIDDEN."
        exit 1
    }
}

# --- Helper: Find Evidence Directory & Generator ---
$GenerateScript = Get-ChildItem -Path "$RepoRoot\rules\task-reports" -Recurse | Where-Object { $_.Name -match "^generate_evidence_$TaskId\.(js|mjs)$" } | Select-Object -First 1

$EvidenceDir = ""
if ($GenerateScript) {
    $EvidenceDir = $GenerateScript.DirectoryName
} else {
    $YearMonth = Get-Date -Format "yyyy-MM"
    $EvidenceDir = "$RepoRoot\rules\task-reports\$YearMonth"
    if (-not (Test-Path $EvidenceDir)) {
        New-Item -ItemType Directory -Path $EvidenceDir | Out-Null
    }
}
Write-Host "Evidence Dir: $EvidenceDir" -ForegroundColor Yellow
$EvidenceDir = $EvidenceDir.Trim()

# --- Start Transcript (Log Everything) ---
$LogFile = "$EvidenceDir\run_$TaskId.log"
Start-Transcript -Path $LogFile -Force

# --- PreAssemblePrecheck Function ---
function PreAssemblePrecheck {
    param($EvidenceDir, $TaskId, $Mode)
    
    $Required = @(
            "ci_parity_${TaskId}.json",
            "gate_light_preview_${TaskId}.log",
            "dod_evidence_${TaskId}.txt",
            "git_meta_${TaskId}.json",
            "preflight_attestation_${TaskId}.json",
            "workspace_healer_${TaskId}.json",
            "result_${TaskId}.json"
        )
    
    $Missing = @()
    foreach ($File in $Required) {
        if (-not (Test-Path "$EvidenceDir\$File")) {
            $Missing += $File
        }
    }
    
    if ($Missing.Count -gt 0) {
        Write-Host "PreAssemblePrecheck FAILED. Missing files:" -ForegroundColor Red
        $Missing | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow }
        
        if ($Mode -eq "Dev") {
             Write-Host "Dev Mode: Retrying Generate Evidence..." -ForegroundColor Yellow
             return $false
        } else {
             Write-Error "Integrate Mode: Precheck failed. Cannot retry."
             exit 1
        }
    }
    return $true
}

try {

Write-Host ">>> [RunTask] TaskId: $TaskId | Mode: $Mode | Header: $Header" -ForegroundColor Cyan
Write-Host ">>> [RunTask] Evidence Dir: $EvidenceDir" -ForegroundColor Gray

# --- State Skeleton ---
Write-Host "[State] INITIALIZING..." -ForegroundColor Cyan

# --- Step 0: Service Policy ---
Write-Host ">>> [RunTask] Step 0: Service Policy (ensure_server_53122)" -ForegroundColor Cyan
$ServiceScript = "$RepoRoot\scripts\ensure_server_53122.ps1"
if (Test-Path $ServiceScript) {
    $ServiceCmd = @("powershell", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", $ServiceScript)
    Invoke-Step -Name "Service Policy" -Cmd $ServiceCmd -TimeoutSec 60
} else {
    Write-Host "[RunTask] Warning: Service Policy script not found ($ServiceScript)." -ForegroundColor Yellow
}

# --- Step 0.5: Workspace Healer ---
Write-Host ">>> [RunTask] Step 0.5: Workspace Healer" -ForegroundColor Cyan
$HealerEvidence = "$EvidenceDir\workspace_healer_$TaskId.json"

if ($TaskId -match "TEST") {
    Write-Host "    SKIPPED: Workspace Healer bypassed for TEST task (Creating Dummy Evidence)." -ForegroundColor Yellow
    @{
        task_id = $TaskId
        timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
        mode = "EnforceClean"
        result = "PASS"
        reason = "TEST_TASK_BYPASS"
        after = @{
            tracked_changed_count = 0
            untracked_count = 0
        }
    } | ConvertTo-Json | Set-Content $HealerEvidence
    
    if (-not (Test-Path $HealerEvidence)) {
        Write-Error "FATAL: Failed to create dummy workspace healer evidence at $HealerEvidence"
        exit 1
    }
    Write-Host "    Dummy Workspace Healer Evidence Created: $HealerEvidence" -ForegroundColor Gray
} else {
    $HealerCmd = @("powershell", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", "$RepoRoot\scripts\reset_workspace.ps1", "-Mode", "EnforceClean")
    
    Invoke-Step -Name "Workspace Healer" -Cmd $HealerCmd -RedirectTo $HealerEvidence
    Write-Host "    Workspace Healer PASS. Output: $HealerEvidence" -ForegroundColor Gray
}

# --- Step 1: Preflight ---
Write-Host ">>> [RunTask] Step 1: Preflight" -ForegroundColor Cyan
$PreflightCmd = @("powershell", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", "$RepoRoot\scripts\preflight.ps1", "-TaskId", $TaskId, "-Mode", $Mode, "-Header", $Header)
Invoke-Step -Name "Preflight" -Cmd $PreflightCmd

# --- Step 1.1: Update LATEST.json ---
# Ensure LATEST.json points to current task so Gate Light consistency checks pass
if ($Header -match "^(TraeTask_|FIX:)") {
    Write-Host ">>> [RunTask] Step 1.1: Update LATEST.json" -ForegroundColor Cyan
    $LatestInfo = @{
        task_id = $TaskId
        timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    }
    $LatestInfo | ConvertTo-Json | Set-Content "$RepoRoot\rules\LATEST.json"
    Write-Host "    Updated rules/LATEST.json to $TaskId" -ForegroundColor Gray
}

# --- Step 1.2: Open PR Guard ---
Write-Host ">>> [RunTask] Step 1.2: Open PR Guard" -ForegroundColor Cyan
$OpenPRGuardOutput = "$EvidenceDir\open_pr_guard_$TaskId.json"
$OpenPRGuardCmd = @("node", "$RepoRoot\scripts\open_pr_guard.mjs", "--task_id", $TaskId, "--mode", $Mode, "--output", $OpenPRGuardOutput)
Invoke-Step -Name "Open PR Guard" -Cmd $OpenPRGuardCmd
Write-Host "    Open PR Guard PASS. Output: $OpenPRGuardOutput" -ForegroundColor Gray

# --- Step 1.3: Contract Verification First ---
Write-Host ">>> [RunTask] Step 1.3: Contract Verification First" -ForegroundColor Cyan
$ContractScript = "$RepoRoot\scripts\verify_contracts_early.mjs"
if (Test-Path $ContractScript) {
    $ContractCmd = @("node", $ContractScript)
    Invoke-Step -Name "Contract Verification" -Cmd $ContractCmd
} else {
    Write-Host "[RunTask] Warning: Contract Verification script not found ($ContractScript)." -ForegroundColor Yellow
}

# --- Step 1.5: Healthcheck Evidence ---
Write-Host ">>> [RunTask] Step 1.5: Healthcheck Evidence" -ForegroundColor Cyan
$HealthRoot = "$EvidenceDir\${TaskId}_healthcheck_53122_root.txt"
$HealthPairs = "$EvidenceDir\${TaskId}_healthcheck_53122_pairs.txt"

Invoke-Step -Name "Healthcheck Root" -Cmd @("curl.exe", "-s", "-i", "http://localhost:53122/", "--output", $HealthRoot) -TimeoutSec 30
Invoke-Step -Name "Healthcheck Pairs" -Cmd @("curl.exe", "-s", "-i", "http://localhost:53122/pairs", "--output", $HealthPairs) -TimeoutSec 30

# --- Step 1.6: CI Parity Probe ---
Write-Host ">>> [RunTask] Step 1.6: CI Parity Probe" -ForegroundColor Cyan
$ParityScript = "$RepoRoot\scripts\ci_parity_probe.mjs"
$ParityCmd = @("node", $ParityScript, "--task_id", $TaskId, "--result_dir", $EvidenceDir)
Invoke-Step -Name "CI Parity Probe" -Cmd $ParityCmd

# --- Step 2 & 3: Evidence Generation & Pass 1 (with Retry Logic) ---
Write-Host "[State] GENERATING EVIDENCE..." -ForegroundColor Cyan

function Run-Evidence-Gen-And-Preview {
    if ($GenerateScript) {
        Write-Host ">>> [RunTask] Step 2: Generate Evidence" -ForegroundColor Cyan
        
        # Cleanup previous run logs
        if (Test-Path "$EvidenceDir\gate_light_preview_$TaskId.log") { Remove-Item "$EvidenceDir\gate_light_preview_$TaskId.log" }
        if (Test-Path "$EvidenceDir\gate_light_verify_$TaskId.log") { Remove-Item "$EvidenceDir\gate_light_verify_$TaskId.log" }

        $GenCmd = @("node", $GenerateScript.FullName)
        Invoke-Step -Name "Generate Evidence" -Cmd $GenCmd -TimeoutSec $StepTimeoutSeconds
    } else {
        Write-Host ">>> [RunTask] Step 2: Skip Generation (Script not found)" -ForegroundColor Yellow
    }

    Write-Host "[State] VERIFYING (Pass 1)..." -ForegroundColor Cyan
    Write-Host ">>> [RunTask] Step 3: Pass 1 - Gate Light Preview" -ForegroundColor Cyan
    $PreviewLog = "$EvidenceDir\gate_light_preview_$TaskId.log"
    $Env:GENERATE_PREVIEW = "1"
    
    $GateScript = "$RepoRoot\scripts\gate_light_ci.mjs"
    $Pass1Cmd = @("node", $GateScript, "--task_id", $TaskId, "--result_dir", $EvidenceDir)
    Invoke-Step -Name "Pass 1 - Gate Light Preview" -Cmd $Pass1Cmd -RedirectTo $PreviewLog
    
    $Env:GENERATE_PREVIEW = $null
    
    if (-not (Test-Path $PreviewLog)) {
        Write-Host "[RunTask] FAILED: Preview log not created." -ForegroundColor Red
        exit 1
    }
    Write-Host "    Preview Log: $PreviewLog" -ForegroundColor Gray
}

# Run first attempt
Run-Evidence-Gen-And-Preview

# Precheck
if (-not (PreAssemblePrecheck -EvidenceDir $EvidenceDir -TaskId $TaskId -Mode $Mode)) {
    Write-Host ">>> [RunTask] Retrying Evidence Generation & Preview..." -ForegroundColor Yellow
    Run-Evidence-Gen-And-Preview
    
    if (-not (PreAssemblePrecheck -EvidenceDir $EvidenceDir -TaskId $TaskId -Mode $Mode)) {
        Write-Error "Precheck failed after retry."
        exit 1
    }
}

# --- Step 4: Assemble Evidence ---
Write-Host ">>> [RunTask] Step 4: Assemble Evidence" -ForegroundColor Cyan
$AssembleCmd = @("node", "$RepoRoot\scripts\assemble_evidence.mjs", "--task_id=$TaskId", "--evidence_dir=$EvidenceDir", "--mode=$Mode", "--phase=assemble")
Invoke-Step -Name "Assemble Evidence" -Cmd $AssembleCmd

# --- Step 5: Pass 2 - Gate Light Verify ---
Write-Host "[State] VERIFYING (Pass 2)..." -ForegroundColor Cyan
Write-Host ">>> [RunTask] Step 5: Pass 2 - Gate Light Verify" -ForegroundColor Cyan
$VerifyLog = "$EvidenceDir\gate_light_verify_$TaskId.log"
$Pass2Cmd = @("node", "$RepoRoot\scripts\gate_light_ci.mjs", "--task_id", $TaskId, "--mode", $Mode, "--result_dir", $EvidenceDir)
Invoke-Step -Name "Pass 2 - Gate Light Verify" -Cmd $Pass2Cmd -RedirectTo $VerifyLog

Write-Host "    Verify Log: $VerifyLog" -ForegroundColor Gray

# --- Step 6: Postflight (Integrate Only) ---
if ($Mode -eq "Integrate") {
    Write-Host "[State] POSTFLIGHT..." -ForegroundColor Cyan
    Write-Host ">>> [RunTask] Step 6: Postflight (Integrate)" -ForegroundColor Cyan
    $PostflightScript = "$RepoRoot\scripts\postflight_validate_envelope.mjs"
    if (Test-Path $PostflightScript) {
        $PostCmd = @("node", $PostflightScript, "--task_id", $TaskId, "--result_dir", $EvidenceDir)
        Invoke-Step -Name "Postflight" -Cmd $PostCmd -RedirectTo $VerifyLog -Append
    } else {
        Write-Host "    Warning: Postflight script not found." -ForegroundColor Yellow
    }

    # --- Step 7: Update Evidence with Verify Logs (Integrate Only) ---
    Write-Host ">>> [RunTask] Step 7: Update Evidence with Verify Logs" -ForegroundColor Cyan
    # Overwrite Preview Log with Verify Log
    Copy-Item -Path $VerifyLog -Destination "$EvidenceDir\gate_light_preview_$TaskId.log" -Force
    
    # Re-run Assemble Evidence
    $UpdateCmd = @("node", "$RepoRoot\scripts\assemble_evidence.mjs", "--task_id=$TaskId", "--evidence_dir=$EvidenceDir", "--mode=$Mode", "--phase=assemble")
    Invoke-Step -Name "Update Evidence" -Cmd $UpdateCmd
    Write-Host "    Updated notify and index with Verify logs." -ForegroundColor Gray

    # --- Step 8: Archive & Lock (Integrate Only) ---
    Write-Host "[State] ARCHIVING..." -ForegroundColor Cyan
    Write-Host ">>> [RunTask] Step 8: Archive & Lock" -ForegroundColor Cyan
    
    # --- Step 8.1: Evidence Smoke Test ---
    Write-Host ">>> [RunTask] Step 8.1: Evidence Smoke Test" -ForegroundColor Cyan
    $SmokeCmd = @("node", "$RepoRoot\scripts\evidence_smoke_test.mjs", "--task_id=$TaskId", "--dir=$EvidenceDir")
    Invoke-Step -Name "Evidence Smoke Test" -Cmd $SmokeCmd
    Write-Host "    Evidence Smoke Test PASS." -ForegroundColor Gray

    Stop-Transcript

    # --- Step 8.2: Execute Archive ---
    $ArchiveCmd = @("node", "$RepoRoot\scripts\assemble_evidence.mjs", "--task_id=$TaskId", "--evidence_dir=$EvidenceDir", "--mode=$Mode", "--phase=archive")
    Invoke-Step -Name "Archive & Lock" -Cmd $ArchiveCmd
    Write-Host "    Archived evidence and locked task." -ForegroundColor Gray
}

Write-Host ">>> [RunTask] SUCCESS: Task $TaskId ($Mode) Completed." -ForegroundColor Green
} catch {
    Write-Host "[RunTask] FAILED: Script execution error: $_" -ForegroundColor Red
    exit 1
} finally {
    try { Stop-Transcript -ErrorAction SilentlyContinue } catch {}
}
