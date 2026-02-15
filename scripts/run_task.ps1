param (
    [Parameter(Mandatory=$true)]
    [string]$TaskId,

    [Parameter(Mandatory=$true)]
    [ValidateSet("Dev", "Integrate")]
    [string]$Mode,

    [Parameter(Mandatory=$true)]
    [string]$Header
)

$ErrorActionPreference = "Stop"
$RepoRoot = "E:\OppRadar"

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

Write-Host ">>> [RunTask] TaskId: $TaskId | Mode: $Mode | Header: $Header" -ForegroundColor Cyan
Write-Host ">>> [RunTask] Evidence Dir: $EvidenceDir" -ForegroundColor Gray

# --- Step 1: Preflight ---
Write-Host ">>> [RunTask] Step 1: Preflight" -ForegroundColor Cyan
& "$RepoRoot\scripts\preflight.ps1" -TaskId $TaskId -Mode $Mode -Header $Header
if ($LASTEXITCODE -ne 0) {
    Write-Host "[RunTask] FAILED: Preflight checks failed." -ForegroundColor Red
    exit 1
}

# --- Step 1.2: Open PR Guard ---
Write-Host ">>> [RunTask] Step 1.2: Open PR Guard" -ForegroundColor Cyan
$OpenPRGuardOutput = "$EvidenceDir\open_pr_guard_$TaskId.json"
node "$RepoRoot\scripts\open_pr_guard.mjs" --task_id $TaskId --output "$OpenPRGuardOutput"
if ($LASTEXITCODE -ne 0) {
    Write-Host "[RunTask] FAILED: Open PR Guard blocked execution." -ForegroundColor Red
    if (Test-Path $OpenPRGuardOutput) {
        Get-Content $OpenPRGuardOutput | Write-Host
    }
    exit 1
}
Write-Host "    Open PR Guard PASS. Output: $OpenPRGuardOutput" -ForegroundColor Gray

# --- Step 1.5: Healthcheck Evidence ---
Write-Host ">>> [RunTask] Step 1.5: Healthcheck Evidence" -ForegroundColor Cyan
$HealthRoot = "$EvidenceDir\${TaskId}_healthcheck_53122_root.txt"
$HealthPairs = "$EvidenceDir\${TaskId}_healthcheck_53122_pairs.txt"

# Use curl.exe to ensure ASCII output compatible with Gate Light
curl.exe -s -i "http://localhost:53122/" --output "$HealthRoot"
if ($LASTEXITCODE -ne 0) {
    Write-Host "[RunTask] FAILED: Healthcheck Root failed. Ensure mock_server is running." -ForegroundColor Red
    exit 1
}

curl.exe -s -i "http://localhost:53122/pairs" --output "$HealthPairs"
if ($LASTEXITCODE -ne 0) {
    Write-Host "[RunTask] FAILED: Healthcheck Pairs failed." -ForegroundColor Red
    exit 1
}

# --- Step 2: Generate Evidence (Dev/Integrate) ---
if ($GenerateScript) {
    Write-Host ">>> [RunTask] Step 2: Generate Evidence" -ForegroundColor Cyan
    node $GenerateScript.FullName
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[RunTask] FAILED: Evidence Generation failed." -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host ">>> [RunTask] Step 2: Skip Generation (Script not found)" -ForegroundColor Yellow
}

# --- Step 3: Pass 1 - Gate Light Preview ---
Write-Host ">>> [RunTask] Step 3: Pass 1 - Gate Light Preview" -ForegroundColor Cyan
$PreviewLog = "$EvidenceDir\gate_light_preview_$TaskId.log"
$Env:GENERATE_PREVIEW = "1"

# Use cmd /c to avoid PowerShell UTF-16 encoding issues
$GateScript = "$RepoRoot\scripts\gate_light_ci.mjs"
$CmdLine = "node ""$GateScript"" --task_id $TaskId > ""$PreviewLog"" 2>&1"
cmd /c $CmdLine

$Env:GENERATE_PREVIEW = $null

# Check if preview log created
if (-not (Test-Path $PreviewLog)) {
    Write-Host "[RunTask] FAILED: Preview log not created." -ForegroundColor Red
    exit 1
}
Write-Host "    Preview Log: $PreviewLog" -ForegroundColor Gray

# --- Step 4: Assemble Evidence ---
Write-Host ">>> [RunTask] Step 4: Assemble Evidence" -ForegroundColor Cyan
node "$RepoRoot\scripts\assemble_evidence.mjs" --task_id=$TaskId --evidence_dir="$EvidenceDir"
if ($LASTEXITCODE -ne 0) {
    Write-Host "[RunTask] FAILED: Assemble Evidence failed." -ForegroundColor Red
    exit 1
}

# --- Step 5: Pass 2 - Gate Light Verify ---
Write-Host ">>> [RunTask] Step 5: Pass 2 - Gate Light Verify" -ForegroundColor Cyan
$VerifyLog = "$EvidenceDir\gate_light_verify_$TaskId.log"
# Use cmd /c to ensure redirection works and capture both stdout and stderr
cmd /c "node ""$RepoRoot\scripts\gate_light_ci.mjs"" --task_id $TaskId --mode $Mode > ""$VerifyLog"" 2>&1"
if ($LASTEXITCODE -ne 0) {
    Write-Host "[RunTask] FAILED: Gate Light Verify failed. See $VerifyLog" -ForegroundColor Red
    Get-Content $VerifyLog | Select-Object -Last 20
    exit 1
}
Write-Host "    Verify Log: $VerifyLog" -ForegroundColor Gray

# --- Step 6: Postflight (Integrate Only) ---
if ($Mode -eq "Integrate") {
    Write-Host ">>> [RunTask] Step 6: Postflight (Integrate)" -ForegroundColor Cyan
    $PostflightScript = "$RepoRoot\scripts\postflight_validate_envelope.mjs"
    if (Test-Path $PostflightScript) {
        # Append Postflight output to Verify Log
        cmd /c "node $PostflightScript --task_id $TaskId --result_dir ""$EvidenceDir"" >> ""$VerifyLog"" 2>&1"
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[RunTask] FAILED: Postflight validation failed. See $VerifyLog" -ForegroundColor Red
            Get-Content $VerifyLog | Select-Object -Last 20
            exit 1
        }
    } else {
        Write-Host "    Warning: Postflight script not found." -ForegroundColor Yellow
    }

    # --- Step 7: Update Evidence with Verify Logs (Integrate Only) ---
    Write-Host ">>> [RunTask] Step 7: Update Evidence with Verify Logs" -ForegroundColor Cyan
    # Overwrite Preview Log with Verify Log so assemble_evidence picks it up
    Copy-Item -Path $VerifyLog -Destination "$EvidenceDir\gate_light_preview_$TaskId.log" -Force
    
    # Re-run Assemble Evidence to update notify and index
    node "$RepoRoot\scripts\assemble_evidence.mjs" --task_id=$TaskId --evidence_dir="$EvidenceDir"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[RunTask] FAILED: Assemble Evidence update failed." -ForegroundColor Red
        exit 1
    }
    Write-Host "    Updated notify and index with Verify logs." -ForegroundColor Gray
}

Write-Host ">>> [RunTask] SUCCESS: Task $TaskId ($Mode) Completed." -ForegroundColor Green
