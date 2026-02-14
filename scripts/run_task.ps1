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
# Try to find generate script
$GenerateScript = Get-ChildItem -Path "$RepoRoot\rules\task-reports" -Recurse -Filter "generate_evidence_$TaskId.mjs" | Select-Object -First 1

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
node "$RepoRoot\scripts\gate_light_ci.mjs" --task_id $TaskId --mode $Mode
if ($LASTEXITCODE -ne 0) {
    Write-Host "[RunTask] FAILED: Gate Light Verify failed." -ForegroundColor Red
    exit 1
}

# --- Step 6: Postflight (Integrate Only) ---
if ($Mode -eq "Integrate") {
    Write-Host ">>> [RunTask] Step 6: Postflight (Integrate)" -ForegroundColor Cyan
    $PostflightScript = "$RepoRoot\scripts\postflight_validate_envelope.mjs"
    if (Test-Path $PostflightScript) {
        node $PostflightScript --task_id $TaskId
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[RunTask] FAILED: Postflight validation failed." -ForegroundColor Red
            exit 1
        }
    } else {
        Write-Host "    Warning: Postflight script not found." -ForegroundColor Yellow
    }
}

Write-Host ">>> [RunTask] SUCCESS: Task $TaskId ($Mode) Completed." -ForegroundColor Green
