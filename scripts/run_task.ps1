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

$ErrorActionPreference = "Stop"
if ($NonInteractive) {
    $ProgressPreference = 'SilentlyContinue'
}

# --- Helper: Invoke-Step with Timeout & Non-Interactive ---
function Invoke-Step {
    param(
        [string]$Name,
        [string]$CmdLine, # Full command line for cmd /c
        [string]$LogFile, # Optional log file path (for error reporting on failure)
        [int]$Timeout = $StepTimeoutSeconds,
        [ScriptBlock]$OnFailure
    )

    Write-Host ">>> [RunTask] Step: $Name" -ForegroundColor Cyan
    
    $TempLogOut = [System.IO.Path]::GetTempFileName()
    $TempLogErr = [System.IO.Path]::GetTempFileName()
    
    # Start process with redirection to capture stdout/stderr to temp files
    # This avoids Transcript buffering issues and allows immediate inspection
    $Process = Start-Process -FilePath "cmd" -ArgumentList "/c", $CmdLine -RedirectStandardOutput $TempLogOut -RedirectStandardError $TempLogErr -PassThru -NoNewWindow
    
    try {
        # Wait for process with timeout
        $Process | Wait-Process -Timeout $Timeout -ErrorAction Stop
        
        # Read captured output and print to Host (so it goes to Transcript)
        $ContentOut = Get-Content $TempLogOut -Raw -ErrorAction SilentlyContinue
        $ContentErr = Get-Content $TempLogErr -Raw -ErrorAction SilentlyContinue
        
        if ($ContentOut) { Write-Host $ContentOut }
        if ($ContentErr) { Write-Host $ContentErr -ForegroundColor Red }
        
        $Content = "$ContentOut`n$ContentErr"
        
        # Check for interactive prompt in captured content (ALWAYS)
        if ($Content -match "Please provide value" -or $Content -match "Select an option" -or $Content -match "Press any key" -or $Content -match "INTERACTIVE_PROMPT_DETECTED") {
             Write-Error "INTERACTIVE_PROMPT_DETECTED"
             if (-not $Process.HasExited) { $Process | Stop-Process -Force -ErrorAction SilentlyContinue }
             exit 1
        }
        
        if ($Process.ExitCode -ne 0) {
            Write-Host "[RunTask] FAILED: Step '$Name' failed with exit code $($Process.ExitCode)." -ForegroundColor Red
            if ($OnFailure) {
                try { & $OnFailure } catch { Write-Warning "Error in OnFailure block: $_" }
            }
            
            # Also check external LogFile if provided (for steps that redirect internally)
            if ($LogFile -and (Test-Path $LogFile)) {
                 # Wait a bit for file flush if needed
                 Start-Sleep -Milliseconds 500
                 $ExtContent = Get-Content $LogFile -Tail 100 -ErrorAction SilentlyContinue | Out-String
                 if ($ExtContent -match "Please provide value" -or $ExtContent -match "Select an option" -or $ExtContent -match "Press any key" -or $ExtContent -match "INTERACTIVE_PROMPT_DETECTED") {
                     Write-Error "INTERACTIVE_PROMPT_DETECTED"
                     exit 1
                 }
            }
            
            exit 1
        }
    } catch {
        if ($_ -match "time" -or $_.Exception -match "time") {
            Write-Host "[RunTask] FAILED: Step '$Name' TIMED OUT after ${Timeout}s." -ForegroundColor Red
            $Process | Stop-Process -Force -ErrorAction SilentlyContinue
            exit 1
        }
        throw $_
    } finally {
        if (Test-Path $TempLogOut) { Remove-Item $TempLogOut -Force -ErrorAction SilentlyContinue }
        if (Test-Path $TempLogErr) { Remove-Item $TempLogErr -Force -ErrorAction SilentlyContinue }
    }
}


$RepoRoot = "E:\OppRadar"

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
# Must be the very first check before anything else.
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
# Try to find generate script (js or mjs)
$GenerateScript = Get-ChildItem -Path "$RepoRoot\rules\task-reports" -Recurse | Where-Object { $_.Name -match "^generate_evidence_$TaskId\.(js|mjs)$" } | Select-Object -First 1

$EvidenceDir = ""
if ($GenerateScript) {
    $EvidenceDir = $GenerateScript.DirectoryName
} else {
    # Fallback to current month
    $YearMonth = Get-Date -Format "yyyy-MM"
    $EvidenceDir = "$RepoRoot\rules\task-reports\$YearMonth"
    if (-not (Test-Path $EvidenceDir)) {
        New-Item -ItemType Directory -Path $EvidenceDir | Out-Null
    }
}

# --- Start Transcript (Log Everything) ---
$LogFile = "$EvidenceDir\run_$TaskId.log"
Start-Transcript -Path $LogFile -Force

try {

Write-Host ">>> [RunTask] TaskId: $TaskId | Mode: $Mode | Header: $Header" -ForegroundColor Cyan
Write-Host ">>> [RunTask] Evidence Dir: $EvidenceDir" -ForegroundColor Gray

# --- State Skeleton ---
Write-Host "[State] INITIALIZING..." -ForegroundColor Cyan

# --- Step 0: Unified Service Policy ---
Write-Host ">>> [RunTask] Step 0: Service Policy (ensure_server_53122)" -ForegroundColor Cyan
$ServiceScript = "$RepoRoot\scripts\ensure_server_53122.ps1"
if (Test-Path $ServiceScript) {
    # Call the service script (no pipe to avoid binding errors)
    $ServiceCmd = "powershell -NonInteractive -ExecutionPolicy Bypass -File ""$ServiceScript"""
    Invoke-Step -Name "Service Policy" -CmdLine $ServiceCmd -LogFile "$EvidenceDir\run_$TaskId.log" -Timeout 60
} else {
    Write-Host "[RunTask] Warning: Service Policy script not found ($ServiceScript)." -ForegroundColor Yellow
}

# --- Step 0.5: Workspace Healer ---
# (Moved before preflight to ensure clean slate and prevent deletion of attestation)
Write-Host ">>> [RunTask] Step 0.5: Workspace Healer" -ForegroundColor Cyan
if ($TaskId -match "TEST") {
    Write-Host "    SKIPPED: Workspace Healer bypassed for TEST task." -ForegroundColor Yellow
} else {
    $HealerEvidence = "$EvidenceDir\workspace_healer_$TaskId.json"
    # Capture stdout to file, ensure ASCII
    $HealerCmd = "powershell -NonInteractive -ExecutionPolicy Bypass -File ""$RepoRoot\scripts\reset_workspace.ps1"" -Mode EnforceClean > ""$HealerEvidence"" 2>&1"
    
    Invoke-Step -Name "Workspace Healer" -CmdLine $HealerCmd -LogFile "$EvidenceDir\run_$TaskId.log" -OnFailure {
        if (Test-Path $HealerEvidence) { Get-Content $HealerEvidence | Write-Host }
    }
    Write-Host "    Workspace Healer PASS. Output: $HealerEvidence" -ForegroundColor Gray
}

# DEBUG: Check if attestation exists (should not yet)
if (Test-Path "$EvidenceDir\preflight_attestation_$TaskId.json") {
    Write-Host "[DEBUG] Attestation exists BEFORE Preflight (unexpected)" -ForegroundColor Magenta
}

# --- Step 1: Preflight ---
Write-Host ">>> [RunTask] Step 1: Preflight" -ForegroundColor Cyan
$PreflightCmd = "powershell -NonInteractive -ExecutionPolicy Bypass -File ""$RepoRoot\scripts\preflight.ps1"" -TaskId $TaskId -Mode $Mode -Header ""$Header"""
Invoke-Step -Name "Preflight" -CmdLine $PreflightCmd -LogFile "$EvidenceDir\run_$TaskId.log"

# --- Step 1.2: Open PR Guard ---
Write-Host ">>> [RunTask] Step 1.2: Open PR Guard" -ForegroundColor Cyan
$OpenPRGuardOutput = "$EvidenceDir\open_pr_guard_$TaskId.json"
$OpenPRGuardCmd = "node ""$RepoRoot\scripts\open_pr_guard.mjs"" --task_id $TaskId --mode $Mode --output ""$OpenPRGuardOutput"" < NUL"
Invoke-Step -Name "Open PR Guard" -CmdLine $OpenPRGuardCmd -LogFile "$EvidenceDir\run_$TaskId.log" -OnFailure {
    if (Test-Path $OpenPRGuardOutput) {
        Get-Content $OpenPRGuardOutput | Write-Host
    }
}
Write-Host "    Open PR Guard PASS. Output: $OpenPRGuardOutput" -ForegroundColor Gray

# --- Step 1.3: Contract Verification First (Contract First) ---
# Must run before any evidence generation.
Write-Host ">>> [RunTask] Step 1.3: Contract Verification First" -ForegroundColor Cyan
$ContractScript = "$RepoRoot\scripts\verify_contracts_early.mjs"
if (Test-Path $ContractScript) {
    $ContractCmd = "node ""$ContractScript"" < NUL"
    Invoke-Step -Name "Contract Verification" -CmdLine $ContractCmd -LogFile "$EvidenceDir\run_$TaskId.log"
} else {
    Write-Host "[RunTask] Warning: Contract Verification script not found ($ContractScript)." -ForegroundColor Yellow
}

# --- Step 1.5: Healthcheck Evidence ---
Write-Host ">>> [RunTask] Step 1.5: Healthcheck Evidence" -ForegroundColor Cyan
$HealthRoot = "$EvidenceDir\${TaskId}_healthcheck_53122_root.txt"
$HealthPairs = "$EvidenceDir\${TaskId}_healthcheck_53122_pairs.txt"

Invoke-Step -Name "Healthcheck Root" -CmdLine "curl.exe -s -i ""http://localhost:53122/"" --output ""$HealthRoot""" -Timeout 30
Invoke-Step -Name "Healthcheck Pairs" -CmdLine "curl.exe -s -i ""http://localhost:53122/pairs"" --output ""$HealthPairs""" -Timeout 30

# --- Step 1.6: CI Parity Probe ---
Write-Host ">>> [RunTask] Step 1.6: CI Parity Probe" -ForegroundColor Cyan
$ParityScript = "$RepoRoot\scripts\ci_parity_probe.mjs"
$ParityCmd = "node ""$ParityScript"" --task_id $TaskId --result_dir ""$EvidenceDir"" < NUL"
Invoke-Step -Name "CI Parity Probe" -CmdLine $ParityCmd -LogFile "$EvidenceDir\run_$TaskId.log"

# --- Step 2: Generate Evidence (Dev/Integrate) ---
Write-Host "[State] GENERATING EVIDENCE..." -ForegroundColor Cyan

# DEBUG: Check if attestation exists BEFORE Evidence Generation
if (-not (Test-Path "$EvidenceDir\preflight_attestation_$TaskId.json")) {
    Write-Host "[DEBUG] Attestation MISSING BEFORE Evidence Generation!" -ForegroundColor Magenta
} else {
    Write-Host "[DEBUG] Attestation exists BEFORE Evidence Generation." -ForegroundColor Magenta
}

if ($GenerateScript) {
    Write-Host ">>> [RunTask] Step 2: Generate Evidence" -ForegroundColor Cyan
    
    # Cleanup previous run logs to prevent stale reads
    if (Test-Path "$EvidenceDir\gate_light_preview_$TaskId.log") { Remove-Item "$EvidenceDir\gate_light_preview_$TaskId.log" }
    if (Test-Path "$EvidenceDir\gate_light_verify_$TaskId.log") { Remove-Item "$EvidenceDir\gate_light_verify_$TaskId.log" }

    $GenCmd = "node ""$($GenerateScript.FullName)"" < NUL"
    Invoke-Step -Name "Generate Evidence" -CmdLine $GenCmd -LogFile "$EvidenceDir\run_$TaskId.log"
} else {
    Write-Host ">>> [RunTask] Step 2: Skip Generation (Script not found)" -ForegroundColor Yellow
}

# DEBUG: Check if attestation exists AFTER Evidence Generation
if (-not (Test-Path "$EvidenceDir\preflight_attestation_$TaskId.json")) {
    Write-Host "[DEBUG] Attestation MISSING AFTER Evidence Generation!" -ForegroundColor Magenta
} else {
    Write-Host "[DEBUG] Attestation exists AFTER Evidence Generation." -ForegroundColor Magenta
}

# --- Step 3: Pass 1 - Gate Light Preview ---
Write-Host "[State] VERIFYING (Pass 1)..." -ForegroundColor Cyan
Write-Host ">>> [RunTask] Step 3: Pass 1 - Gate Light Preview" -ForegroundColor Cyan
$PreviewLog = "$EvidenceDir\gate_light_preview_$TaskId.log"
$Env:GENERATE_PREVIEW = "1"

$GateScript = "$RepoRoot\scripts\gate_light_ci.mjs"
$Pass1Cmd = "node ""$GateScript"" --task_id $TaskId --result_dir ""$EvidenceDir"" < NUL > ""$PreviewLog"" 2>&1"
Invoke-Step -Name "Pass 1 - Gate Light Preview" -CmdLine $Pass1Cmd -LogFile $PreviewLog

$Env:GENERATE_PREVIEW = $null

# Check if preview log created
if (-not (Test-Path $PreviewLog)) {
    Write-Host "[RunTask] FAILED: Preview log not created." -ForegroundColor Red
    exit 1
}

Write-Host "    Preview Log: $PreviewLog" -ForegroundColor Gray

# --- Step 4: Assemble Evidence ---
Write-Host ">>> [RunTask] Step 4: Assemble Evidence" -ForegroundColor Cyan
$AssembleCmd = "node ""$RepoRoot\scripts\assemble_evidence.mjs"" --task_id=$TaskId --evidence_dir=""$EvidenceDir"" --mode=$Mode --phase=assemble < NUL"
Invoke-Step -Name "Assemble Evidence" -CmdLine $AssembleCmd -LogFile "$EvidenceDir\run_$TaskId.log"

# --- Step 5: Pass 2 - Gate Light Verify ---
Write-Host "[State] VERIFYING (Pass 2)..." -ForegroundColor Cyan
Write-Host ">>> [RunTask] Step 5: Pass 2 - Gate Light Verify" -ForegroundColor Cyan
$VerifyLog = "$EvidenceDir\gate_light_verify_$TaskId.log"
$Pass2Cmd = "node ""$RepoRoot\scripts\gate_light_ci.mjs"" --task_id $TaskId --mode $Mode --result_dir ""$EvidenceDir"" < NUL > ""$VerifyLog"" 2>&1"
Invoke-Step -Name "Pass 2 - Gate Light Verify" -CmdLine $Pass2Cmd -LogFile $VerifyLog -OnFailure {
    Get-Content $VerifyLog | Select-Object -Last 20 | Write-Host
}
Write-Host "    Verify Log: $VerifyLog" -ForegroundColor Gray

# --- Step 6: Postflight (Integrate Only) ---
if ($Mode -eq "Integrate") {
    Write-Host "[State] POSTFLIGHT..." -ForegroundColor Cyan
    Write-Host ">>> [RunTask] Step 6: Postflight (Integrate)" -ForegroundColor Cyan
    $PostflightScript = "$RepoRoot\scripts\postflight_validate_envelope.mjs"
    if (Test-Path $PostflightScript) {
        # Append Postflight output to Verify Log
        $PostCmd = "node $PostflightScript --task_id $TaskId --result_dir ""$EvidenceDir"" < NUL >> ""$VerifyLog"" 2>&1"
        Invoke-Step -Name "Postflight" -CmdLine $PostCmd -LogFile $VerifyLog -OnFailure {
             Get-Content $VerifyLog | Select-Object -Last 20 | Write-Host
        }
    } else {
        Write-Host "    Warning: Postflight script not found." -ForegroundColor Yellow
    }

    # --- Step 7: Update Evidence with Verify Logs (Integrate Only) ---
    Write-Host ">>> [RunTask] Step 7: Update Evidence with Verify Logs" -ForegroundColor Cyan
    # Overwrite Preview Log with Verify Log so assemble_evidence picks it up
    Copy-Item -Path $VerifyLog -Destination "$EvidenceDir\gate_light_preview_$TaskId.log" -Force
    
    # Re-run Assemble Evidence to update notify and index
    $UpdateCmd = "node ""$RepoRoot\scripts\assemble_evidence.mjs"" --task_id=$TaskId --evidence_dir=""$EvidenceDir"" --mode=$Mode --phase=assemble < NUL"
    Invoke-Step -Name "Update Evidence" -CmdLine $UpdateCmd -LogFile "$EvidenceDir\run_$TaskId.log"
    Write-Host "    Updated notify and index with Verify logs." -ForegroundColor Gray

    # --- Step 8: Archive & Lock (Integrate Only) ---
    Write-Host "[State] ARCHIVING..." -ForegroundColor Cyan
    Write-Host ">>> [RunTask] Step 8: Archive & Lock" -ForegroundColor Cyan
    
    # --- Step 8.1: Evidence Smoke Test (Archive Precheck) ---
    Write-Host ">>> [RunTask] Step 8.1: Evidence Smoke Test" -ForegroundColor Cyan
    $SmokeCmd = "node ""$RepoRoot\scripts\evidence_smoke_test.mjs"" --task_id=$TaskId --dir=""$EvidenceDir"" < NUL"
    Invoke-Step -Name "Evidence Smoke Test" -CmdLine $SmokeCmd -LogFile "$EvidenceDir\run_$TaskId.log"
    Write-Host "    Evidence Smoke Test PASS." -ForegroundColor Gray

    # Stop Transcript before Archive to ensure log is complete and hashable
    Stop-Transcript

    # --- Step 8.2: Execute Archive ---
    $ArchiveCmd = "node ""$RepoRoot\scripts\assemble_evidence.mjs"" --task_id=$TaskId --evidence_dir=""$EvidenceDir"" --mode=$Mode --phase=archive < NUL"
    Invoke-Step -Name "Archive & Lock" -CmdLine $ArchiveCmd -LogFile "$EvidenceDir\run_$TaskId.log"
    Write-Host "    Archived evidence and locked task." -ForegroundColor Gray
}

Write-Host ">>> [RunTask] SUCCESS: Task $TaskId ($Mode) Completed." -ForegroundColor Green
} catch {
    Write-Host "[RunTask] FAILED: Script execution error: $_" -ForegroundColor Red
    exit 1
} finally {
    # Ensure transcript is stopped if still running
    try { Stop-Transcript -ErrorAction SilentlyContinue } catch {}
}
