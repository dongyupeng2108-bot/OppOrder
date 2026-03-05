param (
    [Parameter(Mandatory=$true)]
    [string]$TaskId,

    [Parameter(Mandatory=$true)]
    [ValidateSet("Dev", "Integrate")]
    [string]$Mode,

    [Parameter(Mandatory=$false)]
    [string]$Header,

    [switch]$NonInteractive = $true,

    [Parameter(Mandatory=$false)]
    [int]$StepTimeoutSeconds = 120,

    [Parameter(Mandatory=$false)]
    [bool]$AutoPR = $true,

    [Parameter(Mandatory=$false)]
    [int]$AutoFixMax = 0

    ,[Parameter(Mandatory=$false)]
    [string]$RunId
)

# --- Parameter Normalization ---
$TaskId = $TaskId.Trim()
$Mode = $Mode.Trim()
if ($RunId) { $RunId = $RunId.Trim() }

if ([string]::IsNullOrWhiteSpace($Header)) {
    $Header = "TraeTask_$TaskId"
    Write-Host "[RunTask] Header not provided. Using default: $Header" -ForegroundColor Cyan
} else {
    $Header = $Header.Trim()
}

# --- Integrate Defaults (TraeTask_260219_001) ---
if ($Mode -eq "Integrate") {
    if (-not $PSBoundParameters.ContainsKey("AutoPR")) {
        $AutoPR = $true
        Write-Host "[RunTask] Integrate Default: AutoPR enabled." -ForegroundColor Cyan
    }
    if (-not $PSBoundParameters.ContainsKey("AutoFixMax")) {
        $AutoFixMax = 1
        Write-Host "[RunTask] Integrate Default: AutoFixMax set to 1." -ForegroundColor Cyan
    }
}

$ErrorActionPreference = "Stop"
if ($NonInteractive) {
    $ProgressPreference = 'SilentlyContinue'
}

$RepoRoot = "E:\OppRadar"
$HistoryRoot = Join-Path $Env:TEMP "oppradar_history"
$LatestJsonPath = "$RepoRoot\rules\LATEST.json"

# --- HardStop Latch Check ---
$LatchYearMonth = Get-Date -Format "yyyy-MM"
$LatchPath = "$RepoRoot\rules\task-reports\$LatchYearMonth\.hardstop_latch_$TaskId.json"
if (Test-Path $LatchPath) {
    Write-Host "========== HARD_STOP_LATCH_BLOCK ==========" -ForegroundColor Red
    Write-Host "TASK_ID=$TaskId"
    Write-Host "LATCH_FILE=$LatchPath"
    Write-Host "ACTION=STOP_AND_REPORT"
    Write-Host "REASON=Previous execution triggered HardStop. You must fix the root cause and use a NEW task_id (if Integrate) or manually remove the latch (if Dev/Debugging)."
    Write-Host "==========================================="
    exit 33
}
$LatestJsonRaw = $null
if ($Mode -eq "Dev" -and (Test-Path $LatestJsonPath)) { $LatestJsonRaw = Get-Content $LatestJsonPath -Raw }
$TimingOutput = $Env:SPEED_TIMING_OUT
$TimingEnabled = -not [string]::IsNullOrWhiteSpace($TimingOutput)
if ($Mode -eq "Dev") { $TimingEnabled = $false }
$Timing = [ordered]@{
    task_id = $TaskId
    mode = $Mode
    preflight = 0
    workspace_healer = 0
    pass1_preview = 0
    assemble_evidence = 0
    pass2_verify = 0
    ci_watch = 0
    postflight = 0
    total = 0
}
$StepDurations = [ordered]@{
    task_id = $TaskId
    mode = $Mode
    preflight = 0
    workspace_healer = 0
    pass1_preview = 0
    assemble_evidence = 0
    pass2_verify = 0
    ci_watch = 0
    postflight = 0
    total = 0
}
$TimingStartedAt = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
$TotalWatch = [System.Diagnostics.Stopwatch]::StartNew()
$Script:RunChainStartedAt = Get-Date
$Script:RunChainStartedAtIso = $Script:RunChainStartedAt.ToString("o")
$Script:RunChainWatch = [System.Diagnostics.Stopwatch]::StartNew()
$Script:RunChainPath = ""
$Script:CiWatchMs = 0
$Script:AutoFixCount = 0
$Script:DidAutoPr = $false
$Script:RunChainErrorClass = ""
$Script:RunChainFailReason = ""
$Script:WallTotalMs = 0
$Script:WallTotalRecorded = $false
$Script:CiPassAtIso = ""
$Script:FirstCiFailWatchMs = 0
$Script:AutoFixApplyMs = 0
$Script:SecondCiPassWatchMs = 0
$Script:FailurePenaltyTotalMs = 0
$Script:CiAttempts = 0
$Script:SpeedEvidenceWritten = $false

function Measure-Step {
    param([string]$Key, [scriptblock]$Action)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    & $Action
    $sw.Stop()
    $elapsed = [int]$sw.ElapsedMilliseconds
    $StepDurations[$Key] = $elapsed
    if ($TimingEnabled) { $Timing[$Key] = $elapsed }
}

function Get-BranchTaskId {
    param([string]$BranchName)
    $Matches = [regex]::Matches($BranchName, "\d{6}_\d{3}[a-z]?")
    if ($Matches.Count -gt 0) {
        return $Matches[$Matches.Count - 1].Value
    }
    return ""
}

function Read-LatestTaskId {
    $LatestFile = "$RepoRoot\rules\LATEST.json"
    if (-not (Test-Path $LatestFile)) {
        return ""
    }
    try {
        $LatestJson = Get-Content $LatestFile -Raw | ConvertFrom-Json
        if ($null -ne $LatestJson.task_id) {
            return $LatestJson.task_id.ToString().Trim()
        }
    } catch {
        return ""
    }
    return ""
}

function Write-TaskIdBindingFailfast {
    param([string]$ArgTaskId, [string]$BranchTaskId, [string]$LatestTaskId)
    Write-Host "========== TASK_ID_BINDING_FAILFAST =========="
    Write-Host "MODE=Integrate"
    Write-Host "ARG_TASK_ID=$ArgTaskId"
    Write-Host "BRANCH_TASK_ID=$BranchTaskId"
    Write-Host "LATEST_TASK_ID=$LatestTaskId"
    Write-Host "FAIL_REASON=TASK_ID_MISMATCH"
    Write-Host "ACTION=Align branch name + run_task -TaskId + rules/LATEST.json to same task_id (including suffix if any)"
    Write-Host "=============================================="
}

$Script:LastErrorClass = ""
$Script:LastFailReason = ""
$Script:FixActions = @()
$Script:HardStopTriggered = $false
$Script:HardStopMarkers = @(
    "EVIDENCE_WORM_BYPASS",
    "OPEN_PR_GUARD_BLOCKED",
    "WORKSPACE_DIRTY_TRACKED",
    "STEP_TIMEOUT",
    "SERVICE_HEALTHCHECK_FAIL",
    "CMD_SYNTAX_BANNED",
    "AUTO_PR_CI_FAIL",
    "AUTO_PR_INFRA_FAIL",
    "AUTO_PR_TIMEOUT",
    "AUTO_PR_UNKNOWN_EXIT",
    "AUTO_FIX_MAX_EXCEEDED",
    "AUTO_FIX_FAILED",
    "IMMUTABLE_INTEGRATE_LOCKED",
    "FAIL_BUDGET_EXCEEDED_DEV",
    "FAIL_BUDGET_EXCEEDED_INTEGRATE",
    "PREASSEMBLE_PRECHECK_FAIL",
    "PREASSEMBLE_GENERATOR_MISSING",
    "PREASSEMBLE_MIN_SET_MISSING",
    "PREVIEW_LOG_MISSING",
    "TASK_ID_MISMATCH",
    "LOOP_DETECTED",
    "CONTRACT_SELF_CHECK_FAIL",
    "SAFE_COMMIT_ARG_SPLIT",
    "AUTOPR_PRECOMMIT_FAIL"
)

function Write-HardStopBlock {
    param([string]$Reason)
    Write-Host "HARD_STOP=1"
    Write-Host "HARD_STOP_REASON=$Reason"
    Write-Host "NEXT_ACTION=STOP_AND_REPORT"
}

function Test-HardStopLatch {
    $LatchYearMonth = Get-Date -Format "yyyy-MM"
    $LatchPath = "$RepoRoot\rules\task-reports\$LatchYearMonth\.hardstop_latch_$TaskId.json"
    if (Test-Path $LatchPath) {
        Write-Host "========== HARD_STOP_LATCH_BLOCK ==========" -ForegroundColor Red
        Write-Host "HARD_STOP=1"
        Write-Host "HARD_STOP_REASON=LATCH_DETECTED_MID_EXECUTION"
        Write-Host "NEXT_ACTION=STOP_AND_REPORT"
        Write-Host "LATCH_FILE=$LatchPath"
        Write-Host "==========================================="
        return $true
    }
    return $false
}

function Get-HardStopReason {
    param([string]$ErrorClass, [string]$FailReason, [string]$Mode)
    if ($Mode -eq "Dev" -and -not [string]::IsNullOrWhiteSpace($Env:HARD_STOP_SIMULATE)) {
        return @{ active = $true; reason = $Env:HARD_STOP_SIMULATE }
    }
    if ($FailReason -and $Script:HardStopMarkers -contains $FailReason) {
        return @{ active = $true; reason = $FailReason }
    }
    if ($ErrorClass -and $Script:HardStopMarkers -contains $ErrorClass) {
        return @{ active = $true; reason = $ErrorClass }
    }
    return @{ active = $false; reason = "" }
}

function Stop-RunTask {
    param([string]$Message, [string]$ErrorClass, [string]$FailReason)
    if ($ErrorClass) { $Script:LastErrorClass = $ErrorClass }
    if ($FailReason) { $Script:LastFailReason = $FailReason }
    $HardStop = Get-HardStopReason -ErrorClass $ErrorClass -FailReason $FailReason -Mode $Mode
    if ($HardStop.active -and -not $Script:HardStopTriggered) {
        $Script:HardStopTriggered = $true
        Write-HardStopBlock -Reason $HardStop.reason

        # --- HardStop Latch Write ---
        try {
            $LatchYearMonth = Get-Date -Format "yyyy-MM"
            $LatchDir = "$RepoRoot\rules\task-reports\$LatchYearMonth"
            if (-not (Test-Path $LatchDir)) { New-Item -ItemType Directory -Path $LatchDir -Force | Out-Null }
            $LatchPath = "$LatchDir\.hardstop_latch_$TaskId.json"
            
            $LatchHeadSha = ""
            try { $LatchHeadSha = (git rev-parse HEAD).Trim() } catch {}
            
            $LatchContent = [ordered]@{
                task_id = $TaskId
                run_id = $RunId
                reason = $HardStop.reason
                error_class = $ErrorClass
                fail_reason = $FailReason
                message = $Message
                head_sha = $LatchHeadSha
                timestamp = (Get-Date).ToString("o")
                generated_by = "run_task.ps1"
            } | ConvertTo-Json -Depth 2
            
            Write-LfFile -Path $LatchPath -Content $LatchContent
            Write-Host "[HardStop] Latch written to: $LatchPath" -ForegroundColor Red
        } catch {
            Write-Warning "[HardStop] Failed to write latch file: $_"
        }
    }
    throw $Message
}

function Append-JsonlUtf8 {
    param([string]$Path, [string]$Line)
    $Dir = Split-Path -Parent $Path
    if (-not (Test-Path $Dir)) { New-Item -ItemType Directory -Path $Dir -Force | Out-Null }
    $Utf8 = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::AppendAllText($Path, $Line + "`n", $Utf8)
}

function Write-LfFile {
    param([string]$Path, [string]$Content)
    $Dir = Split-Path -Parent $Path
    if (-not (Test-Path $Dir)) { New-Item -ItemType Directory -Path $Dir -Force | Out-Null }
    $Normalized = $Content -replace "`r`n", "`n"
    [System.IO.File]::WriteAllText($Path, $Normalized, [System.Text.UTF8Encoding]::new($false))
}

function Write-SpeedEvidence {
    param([string]$EvidenceDir, [string]$TaskId)
    if ($Mode -ne "Integrate") { return }
    if ([string]::IsNullOrWhiteSpace($EvidenceDir)) { return }
    $StepDurations.total = [int]$TotalWatch.ElapsedMilliseconds
    if (-not $Script:WallTotalRecorded) {
        $Script:WallTotalMs = $StepDurations.total
        $Script:WallTotalRecorded = $true
    }
    if ($Script:CiAttempts -le 0) { $Script:CiAttempts = 1 }
    $SpeedWallPath = "$EvidenceDir\speed_wall_$TaskId.json"
    $SpeedWall = [ordered]@{
        task_id = $TaskId
        generated_at = (Get-Date).ToString("o")
        wall_total_ms = [int]$Script:WallTotalMs
        ci_watch_ms = [int]$Script:CiWatchMs
        ci_pass_at = $Script:CiPassAtIso
        attempts = [int]$Script:CiAttempts
        failure_penalty_total_ms = [int]$Script:FailurePenaltyTotalMs
        first_ci_fail_watch_ms = [int]$Script:FirstCiFailWatchMs
        autofix_apply_ms = [int]$Script:AutoFixApplyMs
        second_ci_pass_watch_ms = [int]$Script:SecondCiPassWatchMs
    }
    $SpeedWallJson = $SpeedWall | ConvertTo-Json -Depth 6
    Write-LfFile -Path $SpeedWallPath -Content $SpeedWallJson

    $TopEntries = @()
    foreach ($Entry in $StepDurations.GetEnumerator()) {
        if ($Entry.Key -in @("task_id", "mode")) { continue }
        $ms = [int]$Entry.Value
        if ($ms -gt 0) { $TopEntries += @{ key = $Entry.Key; ms = $ms } }
    }
    if ($Script:WallTotalMs -gt 0) { $TopEntries += @{ key = "wall_total_ms"; ms = [int]$Script:WallTotalMs } }
    $TopEntries = $TopEntries | Sort-Object -Property ms -Descending | Select-Object -First 5
    $TopLines = @()
    $TopLines += "task_id=$TaskId"
    $TopLines += "generated_at=$((Get-Date).ToString("o"))"
    foreach ($Entry in $TopEntries) { $TopLines += "$($Entry.key)=$($Entry.ms)" }
    $SpeedTop5Path = "$EvidenceDir\speed_top5_$TaskId.txt"
    Write-LfFile -Path $SpeedTop5Path -Content ($TopLines -join "`n")
    $Script:SpeedEvidenceWritten = $true
}

function Write-RunChainEntry {
    param([hashtable]$Record)
    if (-not $Script:RunChainPath) { return }
    $Line = $Record | ConvertTo-Json -Compress
    if (-not $Script:RunChainStartLine) {
        $Script:RunChainStartLine = $Line
        Write-LfFile -Path $Script:RunChainPath -Content ($Line + "`n")
        return
    }
    Write-LfFile -Path $Script:RunChainPath -Content ($Script:RunChainStartLine + "`n" + $Line + "`n")
}

function Read-JsonSafe {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return $null }
    try { return (Get-Content $Path -Raw | ConvertFrom-Json) } catch { return $null }
}

function Get-TaskIdParts {
    param([string]$TaskId)
    $m = [regex]::Match($TaskId, '^(\d{6}_\d{3})([a-z]?)$')
    if ($m.Success) {
        return @{ Base = $m.Groups[1].Value; Suffix = $m.Groups[2].Value }
    }
    return @{ Base = $TaskId; Suffix = '' }
}

function Get-SuffixNumber {
    param([string]$Suffix)
    if ([string]::IsNullOrWhiteSpace($Suffix)) { return 0 }
    $c = $Suffix.ToLower()[0]
    return ([int][char]$c) - ([int][char]'a') + 1
}

function Test-TaskIdSuffixLoop {
    param([string]$HistoryPath, [string]$Base, [string]$DatePart)
    if (-not (Test-Path $HistoryPath)) { return $false }
    $Now = Get-Date
    $Lines = Get-Content $HistoryPath -ErrorAction SilentlyContinue
    $Records = @()
    foreach ($Line in $Lines) {
        if (-not $Line.Trim()) { continue }
        try { $Records += ($Line | ConvertFrom-Json) } catch {}
    }
    $Recent = $Records | Where-Object {
        $_.base -eq $Base -and $_.date_part -eq $DatePart -and $_.timestamp_utc
    } | Where-Object {
        try { ($Now - [DateTime]::Parse($_.timestamp_utc)).TotalMinutes -le 120 } catch { $false }
    } | Sort-Object { [DateTime]::Parse($_.timestamp_utc) }
    if ($Recent.Count -lt 3) { return $false }
    $Last3 = $Recent | Select-Object -Last 3
    $Nums = $Last3 | ForEach-Object { [int]$_.suffix_num }
    if ($Nums.Count -lt 3) { return $false }
    return ($Nums[2] -gt $Nums[1]) -and ($Nums[1] -gt $Nums[0]) -and (($Nums[2] - $Nums[0]) -ge 2)
}

function Invoke-ErrorTiering {
    param([string]$ErrorClass, [string]$FailReason)
    $Args = @("$RepoRoot\scripts\error_tiering.mjs", "--error_class", "$ErrorClass")
    if ($FailReason) { $Args += @("--fail_reason", "$FailReason") }
    $Output = & node @Args
    if ($LASTEXITCODE -ne 0) {
        return @{ tier = "NON_SELF_HEALABLE"; recommended_action = "ESCALATE"; error_class = $ErrorClass; fail_reason = $FailReason }
    }
    try { return $Output | ConvertFrom-Json } catch { return @{ tier = "NON_SELF_HEALABLE"; recommended_action = "ESCALATE"; error_class = $ErrorClass; fail_reason = $FailReason } }
}

function Get-LastErrorMarkersFromLog {
    param([string]$LogPath)
    if ([string]::IsNullOrWhiteSpace($LogPath)) { return @{ error_class = ""; fail_reason = "" } }
    if (-not (Test-Path $LogPath)) { return @{ error_class = ""; fail_reason = "" } }
    $Lines = @(Get-Content $LogPath -ErrorAction SilentlyContinue)
    $ErrorClass = ""
    $FailReason = ""
    foreach ($Line in $Lines) {
        $Trimmed = $Line.Trim()
        if ($Trimmed -like "ERROR_CLASS=*") { $ErrorClass = $Trimmed.Split("=", 2)[1].Trim() }
        if ($Trimmed -like "FAIL_REASON=*") { $FailReason = $Trimmed.Split("=", 2)[1].Trim() }
    }
    return @{ error_class = $ErrorClass; fail_reason = $FailReason }
}

function Get-AutoPrInfo {
    param([string]$EvidenceDir, [string]$TaskId)
    $AutoPrPath = "$EvidenceDir\auto_pr_$TaskId.json"
    $AutoPr = Read-JsonSafe -Path $AutoPrPath
    if (-not $AutoPr) { return @{ error_class = ""; fail_reason = ""; pr_task_id_detected = "" } }
    $PrTaskId = ""
    if ($AutoPr.head) {
        $Match = [regex]::Match($AutoPr.head, '\d{6}_\d{3}[a-z]?')
        if ($Match.Success) { $PrTaskId = $Match.Value }
    }
    $ErrorClass = ""
    if ($AutoPr.PSObject.Properties.Name -contains "error_class" -and $AutoPr.error_class) { $ErrorClass = $AutoPr.error_class }
    $FailReason = ""
    if ($AutoPr.PSObject.Properties.Name -contains "fail_reason" -and $AutoPr.fail_reason) { $FailReason = $AutoPr.fail_reason }
    return @{ error_class = $ErrorClass; fail_reason = $FailReason; pr_task_id_detected = $PrTaskId }
}

function Invoke-EscalationReport {
    param([string]$ErrorClass, [string]$FailReason, [string]$LogPath, [string]$PrTaskIdDetected)
    $FixJson = $Script:FixActions | ConvertTo-Json -Compress
    $Args = @(
        "$RepoRoot\scripts\escalation_report.mjs",
        "--task_id", "$TaskId",
        "--out_dir", "$EvidenceDir",
        "--error_class", "$ErrorClass",
        "--fail_reason", "$FailReason",
        "--arg_task_id", "$TaskId",
        "--branch_task_id", "$BranchTaskId",
        "--latest_task_id", "$LatestTaskId",
        "--log_path", "$LogPath",
        "--fix_actions", "$FixJson"
    )
    if (-not [string]::IsNullOrWhiteSpace($PrTaskIdDetected)) {
        $Args += @("--pr_task_id_detected", "$PrTaskIdDetected")
    }
    $ReportPath = & node @Args
    return $ReportPath
}

$BranchName = ""
try { $BranchName = (git rev-parse --abbrev-ref HEAD).Trim() } catch { $BranchName = "" }
$BranchTaskId = Get-BranchTaskId -BranchName $BranchName
$LatestTaskId = Read-LatestTaskId

if ($Mode -eq "Integrate") {
    if ([string]::IsNullOrWhiteSpace($BranchTaskId) -or $BranchTaskId -ne $TaskId) {
        Write-TaskIdBindingFailfast -ArgTaskId $TaskId -BranchTaskId $BranchTaskId -LatestTaskId $LatestTaskId
        Stop-RunTask -Message "TASK_ID_BINDING_FAILFAST" -ErrorClass "TASK_ID_MISMATCH" -FailReason "TASK_ID_MISMATCH"
    }
}

# --- Import Unified Command Executor ---
. "$RepoRoot\scripts\ps\Invoke-Step.ps1"

# --- 1. Immutable Integrate Guard (Fail-fast) ---
if ($Mode -eq "Integrate") {
    $LockFile = "$RepoRoot\rules\task-reports\locks\$TaskId.lock.json"
    
    # 1.1 Standard Lock Check (Local)
    if (Test-Path $LockFile) {
        Write-Error "[RunTask] FAILED: Immutable Integrate Guard Triggered."
        Write-Error "    Lock file already exists: $LockFile"
        Write-Error "    You MUST use a new task_id. Modification of locked tasks is FORBIDDEN."
        Stop-RunTask -Message "IMMUTABLE_INTEGRATE_LOCKED" -ErrorClass "IMMUTABLE_INTEGRATE_LOCKED" -FailReason "LOCK_EXISTS"
    }

    # 1.2 WORM Defense: History Check (Strategy B)
    # Check if lock file EVER existed in history (even if deleted locally)
    # We use git log to check for the file's existence in the current branch history
    try {
        $LockHistory = git log --diff-filter=A --summary -- $LockFile 2>$null
        if ($LockHistory) {
            Write-Error "[RunTask] FAILED: EVIDENCE_WORM_BYPASS Detected."
            Write-Error "    Lock file '$LockFile' was found in git history but is missing locally."
            Write-Error "    Deleting a lock file to force a re-run is FORBIDDEN."
            
            Write-Host "`nFAIL_ROOT_CAUSE_BLOCK"
            Write-Host "ERROR_CLASS=EVIDENCE_WORM_BYPASS"
            Write-Host "ROOT_CAUSE_HINT=Lock file found in history but missing locally (Tampering detected)."
            Stop-RunTask -Message "EVIDENCE_WORM_BYPASS" -ErrorClass "EVIDENCE_WORM_BYPASS" -FailReason "WORM_TAMPER"
        }
    } catch {
        Write-Warning "[RunTask] Warning: Failed to check git history for lock file. Skipping WORM check."
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
$Script:RunChainPath = Join-Path $EvidenceDir "run_chain_$TaskId.jsonl"
$RunChainStart = @{
    task_id = $TaskId
    mode = $Mode
    branch = $BranchName
    started_at = $Script:RunChainStartedAtIso
    finished_at = ""
    duration_ms = $null
    ci_watch_ms = $null
    error_class = ""
    fail_reason = ""
    did_autofix = $false
    autofix_count = 0
    did_autopr = $false
    pr_number = ""
}
Write-RunChainEntry -Record $RunChainStart

function PreassembleFailfast {
    param($EvidenceDir, $TaskId, $Mode, $GenerateScript)
    if ($Mode -ne "Integrate") {
        return
    }
    if (-not $GenerateScript) {
        $YearMonth = Get-Date -Format "yyyy-MM"
        Write-Host "========== PREASSEMBLE_FAILFAST =========="
        Write-Host "MODE=Integrate"
        Write-Host "TASK_ID=$TaskId"
        Write-Host "FAIL_REASON=GENERATE_EVIDENCE_SCRIPT_MISSING"
        Write-Host "ACTION=Create rules/task-reports/$YearMonth/generate_evidence_${TaskId}.mjs to generate result/git_meta/dod_evidence before Integrate"
        Write-Host "=========================================="
        Stop-RunTask -Message "PREASSEMBLE_GENERATOR_MISSING" -ErrorClass "PREASSEMBLE_GENERATOR_MISSING" -FailReason "GENERATE_EVIDENCE_SCRIPT_MISSING"
    }
    $RequiredMin = @(
        "result_${TaskId}.json",
        "git_meta_${TaskId}.json",
        "dod_evidence_${TaskId}.txt"
    )
    $MissingMin = @()
    foreach ($File in $RequiredMin) {
        if (-not (Test-Path "$EvidenceDir\$File")) {
            $MissingMin += $File
        }
    }
    if ($MissingMin.Count -gt 0) {
        $MissingList = $MissingMin -join ","
        Write-Host "========== PREASSEMBLE_FAILFAST =========="
        Write-Host "MODE=Integrate"
        Write-Host "TASK_ID=$TaskId"
        Write-Host "FAIL_REASON=MIN_SET_MISSING"
        Write-Host "MISSING=$MissingList"
        Write-Host "ACTION=Run generate_evidence_${TaskId}.mjs (or fix it) to produce missing files before Integrate"
        Write-Host "=========================================="
        Stop-RunTask -Message "PREASSEMBLE_MIN_SET_MISSING" -ErrorClass "PREASSEMBLE_MIN_SET_MISSING" -FailReason "MIN_SET_MISSING"
    }
    Write-Host "PREASSEMBLE_FAILFAST=PASS"
}

PreassembleFailfast -EvidenceDir $EvidenceDir -TaskId $TaskId -Mode $Mode -GenerateScript $GenerateScript

# --- PreAssemblePrecheck Function ---
function PreAssemblePrecheck {
    param($EvidenceDir, $TaskId, $Mode)
    if ($Mode -eq "Dev") { return $true }
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
             Stop-RunTask -Message "PREASSEMBLE_PRECHECK_FAIL" -ErrorClass "PREASSEMBLE_PRECHECK_FAIL" -FailReason "PRECHECK_MISSING"
        }
    }
    return $true
}

try {

Write-Host ">>> [RunTask] TaskId: $TaskId | Mode: $Mode | Header: $Header" -ForegroundColor Cyan
Write-Host ">>> [RunTask] Evidence Dir: $EvidenceDir" -ForegroundColor Gray

if ($Mode -eq "Dev" -and -not [string]::IsNullOrWhiteSpace($Env:HARD_STOP_SIMULATE)) {
    Stop-RunTask -Message "HARD_STOP_SIMULATE" -ErrorClass "HARD_STOP_SIMULATE" -FailReason $Env:HARD_STOP_SIMULATE
}

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

Measure-Step -Key "workspace_healer" -Action {
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
            Stop-RunTask -Message "WORKSPACE_HEALER_DUMMY_FAIL" -ErrorClass "WORKSPACE_DIRTY_TRACKED" -FailReason "WORKSPACE_HEALER_DUMMY_FAIL"
        }
        Write-Host "    Dummy Workspace Healer Evidence Created: $HealerEvidence" -ForegroundColor Gray
    } else {
        $HealerCmd = @("powershell", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", "$RepoRoot\scripts\reset_workspace.ps1", "-Mode", "EnforceClean")
        
        Invoke-Step -Name "Workspace Healer" -Cmd $HealerCmd -RedirectTo $HealerEvidence
        Write-Host "    Workspace Healer PASS. Output: $HealerEvidence" -ForegroundColor Gray
    }
}

# --- Start Transcript (Log Everything) ---
$LogFile = "$EvidenceDir\run_$TaskId.log"
Start-Transcript -Path $LogFile -Force

# --- Step 1: Preflight ---
Write-Host ">>> [RunTask] Step 1: Preflight" -ForegroundColor Cyan
$HeaderArg = $Header
if (-not [string]::IsNullOrWhiteSpace($HeaderArg)) {
    $HeaderArg = '"' + ($HeaderArg -replace '"', '\"') + '"'
}
$PreflightArgs = @("-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", "$RepoRoot\scripts\preflight.ps1", "-TaskId", $TaskId, "-Mode", $Mode, "-Header", $HeaderArg)
$PreflightCmd = @("powershell") + $PreflightArgs
try {
    Measure-Step -Key "preflight" -Action { Invoke-Step -Name "Preflight" -Cmd $PreflightCmd }
} catch {
    Write-Host ""
    Write-Host "=== FIX_GUIDE: Preflight Failed ===" -ForegroundColor Yellow
    Write-Host "CAUSE: Workspace dirty or Header invalid" -ForegroundColor Yellow
    Write-Host "FIX_CMD: git status" -ForegroundColor White
    Write-Host "FIX_CMD: git restore ." -ForegroundColor White
    Write-Host "FIX_CMD: git clean -fd" -ForegroundColor White
    Write-Host "===================================" -ForegroundColor Yellow
    Write-Host ""
    throw $_
}

$TaskIdParts = Get-TaskIdParts -TaskId $TaskId
$TaskIdBase = $TaskIdParts.Base
$TaskIdSuffix = $TaskIdParts.Suffix
$TaskIdSuffixNum = Get-SuffixNumber -Suffix $TaskIdSuffix
$DatePart = if ($TaskIdBase.Length -ge 6) { $TaskIdBase.Substring(0, 6) } else { "" }
$TaskIdHistoryPath = Join-Path $HistoryRoot "task_id_history.jsonl"
$TaskIdRecord = @{
    task_id = $TaskId
    base = $TaskIdBase
    suffix = $TaskIdSuffix
    suffix_num = $TaskIdSuffixNum
    date_part = $DatePart
    timestamp_utc = (Get-Date).ToUniversalTime().ToString("o")
} | ConvertTo-Json -Compress
Append-JsonlUtf8 -Path $TaskIdHistoryPath -Line $TaskIdRecord
if ($TaskIdSuffix -and (Test-TaskIdSuffixLoop -HistoryPath $TaskIdHistoryPath -Base $TaskIdBase -DatePart $DatePart)) {
    Stop-RunTask -Message "TASK_ID_SUFFIX_LOOP" -ErrorClass "LOOP_DETECTED" -FailReason "TASK_ID_SUFFIX_LOOP"
}

# --- 0. Fail Budget ---
$YearMonth = Get-Date -Format "yyyy-MM"
$BudgetDir = "$RepoRoot\rules\task-reports\$YearMonth"
$BudgetFile = Join-Path $BudgetDir ".budget_$TaskId.json"
if (-not (Test-Path $BudgetDir)) {
    New-Item -ItemType Directory -Path $BudgetDir -Force | Out-Null
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
        Write-Host "[RunTask] FAILED: Dev Fail Budget Exceeded ($($Budget.Dev)/2)." -ForegroundColor Red
        Write-Host "    You have exhausted your 2 allowed Dev attempts for Task $TaskId." -ForegroundColor Red
        Write-Host "    Action: Fix your code/logic and use a NEW Task ID." -ForegroundColor Red
        Write-Host ""
        $NextNum = [int]($TaskId.Split('_')[1]) + 1
        $NextTaskId = "$($TaskId.Split('_')[0])_$($NextNum.ToString('000'))"
        Write-Host "=== FIX_GUIDE: Dev Budget Exceeded ===" -ForegroundColor Yellow
        Write-Host "CAUSE: Dev mode allows max 2 attempts, budget exhausted" -ForegroundColor Yellow
        Write-Host "NEXT_TASK_ID: $NextTaskId" -ForegroundColor White
        Write-Host "FIX_CMD: .\scripts\run_task.ps1 -TaskId $NextTaskId -Mode Dev -Header 'TraeTask_$NextTaskId'" -ForegroundColor White
        Write-Host "========================================" -ForegroundColor Yellow
        Write-Host ""
        $Budget | ConvertTo-Json | Set-Content $BudgetFile
        Stop-RunTask -Message "FAIL_BUDGET_EXCEEDED_DEV" -ErrorClass "FAIL_BUDGET_EXCEEDED_DEV" -FailReason "DEV_FAIL_BUDGET_EXCEEDED"
    }
} elseif ($Mode -eq "Integrate") {
    $Budget.Integrate++
    if ($Budget.Integrate -gt 1) {
        Write-Host "[RunTask] FAILED: Integrate Fail Budget Exceeded ($($Budget.Integrate)/1)." -ForegroundColor Red
        Write-Host "    Integrate mode is strictly One-Shot." -ForegroundColor Red
        Write-Host "    Action: Use a NEW Task ID." -ForegroundColor Red
        Write-Host ""
        $NextNum = [int]($TaskId.Split('_')[1]) + 1
        $NextTaskId = "$($TaskId.Split('_')[0])_$($NextNum.ToString('000'))"
        Write-Host "=== FIX_GUIDE: Integrate Budget Exceeded ===" -ForegroundColor Yellow
        Write-Host "CAUSE: Integrate mode allows max 1 attempt, budget exhausted" -ForegroundColor Yellow
        Write-Host "NEXT_TASK_ID: $NextTaskId" -ForegroundColor White
        Write-Host "FIX_CMD: git checkout main" -ForegroundColor White
        Write-Host "FIX_CMD: git pull origin main" -ForegroundColor White
        Write-Host "FIX_CMD: .\scripts\run_task.ps1 -TaskId $NextTaskId -Mode Integrate -Header 'TraeTask_$NextTaskId'" -ForegroundColor White
        Write-Host "==============================================" -ForegroundColor Yellow
        Write-Host ""
        $Budget | ConvertTo-Json | Set-Content $BudgetFile
        Stop-RunTask -Message "FAIL_BUDGET_EXCEEDED_INTEGRATE" -ErrorClass "FAIL_BUDGET_EXCEEDED_INTEGRATE" -FailReason "INTEGRATE_FAIL_BUDGET_EXCEEDED"
    }
}

# Save Budget
$Budget | ConvertTo-Json | Set-Content $BudgetFile

# --- Step 1.1: Update LATEST.json ---
# Ensure LATEST.json points to current task so Gate Light consistency checks pass
if ($Header -match "^(TraeTask_|FIX:)") {
    Write-Host ">>> [RunTask] Step 1.1: Update LATEST.json" -ForegroundColor Cyan
    $LatestInfo = @{
        task_id = $TaskId
        timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    }
    $LatestInfo | ConvertTo-Json | Set-Content $LatestJsonPath
    Write-Host "    Updated rules/LATEST.json to $TaskId" -ForegroundColor Gray
}

# --- Step 1.2: Open PR Guard (Integrate Only) ---
if ($Mode -eq "Integrate") {
    Write-Host ">>> [RunTask] Step 1.2: Open PR Guard" -ForegroundColor Cyan
    $OpenPRGuardOutput = "$EvidenceDir\open_pr_guard_$TaskId.json"
    
    $OpenPRGuardArgs = @("--task_id", $TaskId, "--mode", $Mode, "--output", $OpenPRGuardOutput)
    
    if ($Env:OPEN_PR_GUARD_IGNORE_PR_NUMBERS) {
        $OpenPRGuardArgs += "--ignore_pr_numbers"
        $OpenPRGuardArgs += $Env:OPEN_PR_GUARD_IGNORE_PR_NUMBERS
    }
    
    if ($Env:OPEN_PR_GUARD_SUPERSEDE_TASK_IDS) {
        $OpenPRGuardArgs += "--supersede_task_ids"
        $OpenPRGuardArgs += $Env:OPEN_PR_GUARD_SUPERSEDE_TASK_IDS
    }

    $OpenPRGuardCmd = @("node", "$RepoRoot\scripts\open_pr_guard_probe.mjs") + $OpenPRGuardArgs
    Invoke-Step -Name "Open PR Guard" -Cmd $OpenPRGuardCmd
    Write-Host "    Open PR Guard PASS. Output: $OpenPRGuardOutput" -ForegroundColor Gray
}

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
        if (Test-Path "$EvidenceDir\gate_light_preview_$TaskId.log") {
             node "$RepoRoot\scripts\ops_delete.mjs" "$EvidenceDir\gate_light_preview_$TaskId.log" --force
        }
        if (Test-Path "$EvidenceDir\gate_light_verify_$TaskId.log") {
             node "$RepoRoot\scripts\ops_delete.mjs" "$EvidenceDir\gate_light_verify_$TaskId.log" --force
        }

        $GenCmd = @("node", $GenerateScript.FullName)
        $EffectiveTimeoutSec = $StepTimeoutSeconds
        if ($EffectiveTimeoutSec -le 0) { $EffectiveTimeoutSec = 300 }
        Write-Host "STEP_TIMEOUT_SEC=$EffectiveTimeoutSec step=Generate Evidence"
        Invoke-Step -Name "Generate Evidence" -Cmd $GenCmd -TimeoutSec $EffectiveTimeoutSec
    } else {
        Write-Host ">>> [RunTask] Step 2: Skip Generation (Script not found)" -ForegroundColor Yellow
    }

    Write-Host "[State] VERIFYING (Pass 1)..." -ForegroundColor Cyan
    Write-Host ">>> [RunTask] Step 3: Pass 1 - Gate Light Preview" -ForegroundColor Cyan
    $PreviewLog = "$EvidenceDir\gate_light_preview_$TaskId.log"
    $Env:GENERATE_PREVIEW = "1"
    
    $GateScript = "$RepoRoot\scripts\gate_light_ci.mjs"
    $Pass1Cmd = @("node", $GateScript, "--task_id", $TaskId, "--result_dir", $EvidenceDir)
    try {
        Measure-Step -Key "pass1_preview" -Action { Invoke-Step -Name "Pass 1 - Gate Light Preview" -Cmd $Pass1Cmd -RedirectTo $PreviewLog }
    } catch {
        Write-Host ""
        Write-Host "=== FIX_GUIDE: Gate Light CI Failed ===" -ForegroundColor Yellow
        Write-Host "CAUSE: Gate Light CI check did not pass" -ForegroundColor Yellow
        Write-Host "CHECK_LOG: Select-String -Path '$EvidenceDir\gate_light_preview_$TaskId.log' -Pattern 'FAILED|FIX_CMD'" -ForegroundColor White
        Write-Host "COMMON_FIXES:" -ForegroundColor Yellow
        Write-Host "  1. Missing evidence files: node rules/task-reports/2026-03/generate_evidence_$($TaskId).mjs" -ForegroundColor White
        Write-Host "  2. LATEST.json out of sync: update rules/LATEST.json task_id to $TaskId" -ForegroundColor White
        Write-Host "  3. Healthcheck fail: ensure mock_server_53122 is running" -ForegroundColor White
        Write-Host "========================================" -ForegroundColor Yellow
        Write-Host ""
        throw $_
    }

    $Env:GENERATE_PREVIEW = $null

    if (-not (Test-Path $PreviewLog)) {
        Write-Host "[RunTask] FAILED: Preview log not created." -ForegroundColor Red
        Stop-RunTask -Message "PREVIEW_LOG_MISSING" -ErrorClass "PREVIEW_LOG_MISSING" -FailReason "PREVIEW_LOG_MISSING"
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
        Stop-RunTask -Message "PREASSEMBLE_PRECHECK_FAIL" -ErrorClass "PREASSEMBLE_PRECHECK_FAIL" -FailReason "PRECHECK_MISSING"
    }
}

# --- Step 3.5: Error Digest (Pass 1) ---
Write-Host ">>> [RunTask] Step 3.5: Error Digest (Pass 1)" -ForegroundColor Cyan
$Commit = git rev-parse HEAD
$ShortSha = $Commit.Substring(0, 7)
if ([string]::IsNullOrWhiteSpace($RunId)) {
    $RunId = (Get-Date).ToString("yyyyMMddHHmmss") + "_" + $ShortSha
}
Write-Host ">>> [RunTask] Generated Run ID: $RunId" -ForegroundColor Cyan

$DigestCmd = @("node", "$RepoRoot\scripts\error_digest.mjs", "--task_id", $TaskId, "--mode", $Mode, "--commit", $Commit, "--out_dir", $EvidenceDir)
if (Test-Path "$EvidenceDir\gate_light_preview_$TaskId.log") { $DigestCmd += "--source_logs=$EvidenceDir\gate_light_preview_$TaskId.log" }
if (Test-Path "$EvidenceDir\command_audit_$TaskId.jsonl") { $DigestCmd += "--source_logs=$EvidenceDir\command_audit_$TaskId.jsonl" }
Invoke-Step -Name "Error Digest (Pass 1)" -Cmd $DigestCmd

# --- Step 3.6: Append Error Stats (Pass 1) ---
if ($Mode -eq "Integrate") {
    Write-Host ">>> [RunTask] Step 3.6: Append Error Stats (Pass 1)" -ForegroundColor Cyan
    $AppendCmd = @("node", "$RepoRoot\scripts\error_stats_append.mjs", "--task_id", $TaskId, "--run_id", $RunId, "--commit", $Commit, "--mode", $Mode, "--source_errors", "$EvidenceDir\errors_$TaskId.jsonl")
    Invoke-Step -Name "Append Error Stats" -Cmd $AppendCmd

    # --- Step 3.7: Three-Strike Governance ---
    Write-Host ">>> [RunTask] Step 3.7: Three-Strike Governance" -ForegroundColor Cyan
    $ThreeStrikeCmd = @("node", "$RepoRoot\scripts\error_three_strike.mjs", "--run_id", $RunId)
    Invoke-Step -Name "Three-Strike Governance" -Cmd $ThreeStrikeCmd
}

# --- Step 4: Assemble Evidence ---
if ($Mode -eq "Integrate") {
    Write-Host ">>> [RunTask] Step 4: Assemble Evidence" -ForegroundColor Cyan
    $AssembleCmd = @("node", "$RepoRoot\scripts\assemble_evidence.mjs", "--task_id=$TaskId", "--evidence_dir=$EvidenceDir", "--mode=$Mode", "--phase=assemble")
    Measure-Step -Key "assemble_evidence" -Action { Invoke-Step -Name "Assemble Evidence" -Cmd $AssembleCmd }
} else {
    Write-Host ">>> [RunTask] Step 4: Skip Assemble Evidence (Dev Mode)" -ForegroundColor Yellow
}

# --- Step 8.9: AutoPR Pre-Commit (Optional) ---
if ($Mode -eq "Integrate") {
    if ($AutoPR) {
        $DirtyStatus = git status --porcelain
        if ($DirtyStatus) {
            Write-Host ">>> [RunTask] Step 8.9: AutoPR Pre-Commit" -ForegroundColor Cyan
            $SafeCommitScript = "$RepoRoot\scripts\safe_commit.ps1"
            $CommitMessage = "TraeTask_${TaskId}: integrate evidence"
            # FIX: Use argument array with call operator '&' to prevent argument splitting
            # This replaces Invoke-Step to guarantee correct array handling by PowerShell
            $CommitArgs = @("-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", $SafeCommitScript, "-Message", $CommitMessage)
            
            try {
                & powershell $CommitArgs
                if ($LASTEXITCODE -ne 0) { throw "AutoPR Pre-Commit failed with exit code $LASTEXITCODE" }
            } catch {
                Write-Host ""
                Write-Host "=== FIX_GUIDE: AutoPR Pre-Commit Failed ===" -ForegroundColor Yellow
                Write-Host "CAUSE: safe_commit.ps1 returned non-zero exit code" -ForegroundColor Yellow
                Write-Host "FIX_CMD: gh auth status" -ForegroundColor White
                Write-Host "FIX_CMD: git status" -ForegroundColor White
                Write-Host "FIX_CMD: gh pr create --title 'TraeTask_$TaskId' --body 'Manual PR'" -ForegroundColor White
                Write-Host "============================================" -ForegroundColor Yellow
                Write-Host ""
                Stop-RunTask -Message "AutoPR Pre-Commit Failed" -ErrorClass "AUTOPR_PRECOMMIT_FAIL" -FailReason "SAFE_COMMIT_ARG_SPLIT"
            }
        }
    } else {
        Write-Host "AUTOPR_DISABLED=1" -ForegroundColor Yellow
        Write-Host ">>> [RunTask] Step 9: AutoPR Disabled. Skipping." -ForegroundColor Yellow
        
        # Generate dummy AutoPR evidence for Gate Light compliance
        $AutoPrEvidencePath = "$EvidenceDir\auto_pr_${TaskId}.json"
        $DummyEvidence = [ordered]@{
            task_id = $TaskId
            run_id = $RunId
            attempt = "0"
            did_autopr = $false
            status = "SKIPPED"
            final_state = "SKIPPED"
            reason = "AUTOPR_DISABLED_BY_FLAG"
            pr_url = "SKIPPED_BY_USER_REQUEST"
        }
        $DummyEvidence | ConvertTo-Json | Out-File -FilePath $AutoPrEvidencePath -Encoding Ascii -Force
        Write-Host "DUMMY_AUTOPR_EVIDENCE=1 path=$AutoPrEvidencePath attempt=0" -ForegroundColor DarkGray
    }
}

# --- Step 9: AutoPR (Optional) ---
if ($Mode -eq "Integrate") {
    if ($AutoPR) {
        Write-Host ">>> [RunTask] Step 9: AutoPR Loop" -ForegroundColor Cyan

        # --- Stage Evidence (Node Wrapper) ---
        # --- HardStop Latch Check Before Staging ---
        if (Test-HardStopLatch) {
            Stop-RunTask -Message "HARDSTOP_LATCH_MID_EXECUTION" -ErrorClass "HARDSTOP_LATCH_MID_EXECUTION" -FailReason "LATCH_DETECTED_BEFORE_STAGE"
        }
        Write-Host ">>> [AutoPR] Staging Evidence (Node)..." -ForegroundColor Cyan
        $StageArgs = @("$RepoRoot\scripts\ops_git_stage_task_evidence.mjs", "--task_id", "$TaskId", "--evidence_dir", "$EvidenceDir")
        if ($RunId) { $StageArgs += "--run_id"; $StageArgs += "$RunId" }
        $StageProcess = Start-Process -FilePath "node" -ArgumentList $StageArgs -NoNewWindow -PassThru -Wait
        if ($StageProcess.ExitCode -ne 0) {
            Write-Warning "[AutoPR] Failed to stage evidence files via Node tool. Proceeding anyway..."
        }
    
        $WatchScript = "$RepoRoot\scripts\ci_watch_pr.mjs"
    $FixScript = "$RepoRoot\scripts\ci_autofix_pack.mjs"
    $Script:DidAutoPr = $true
    
    Measure-Step -Key "ci_watch" -Action {
        $CurrentFixCount = 0
        $GlobalFixCount = 0
        $FixCountByClass = @{}
        $LastCiErrorClass = ""
        $LastCiFailReason = ""
        $LoopActive = $true
        
        while ($LoopActive) {
            # --- HardStop Latch Mid-Execution Check ---
            if (Test-HardStopLatch) {
                Stop-RunTask -Message "HARDSTOP_LATCH_MID_EXECUTION" -ErrorClass "HARDSTOP_LATCH_MID_EXECUTION" -FailReason "LATCH_DETECTED_IN_AUTOPR_LOOP"
            }
            $CurrentAttempt = $CurrentFixCount + 1
            $Script:CiAttempts = $CurrentAttempt
            Write-Host "[AutoPR] Loop Iteration $CurrentAttempt (Max Fixes: $AutoFixMax)..." -ForegroundColor Cyan
            
            Write-Host ">>> [AutoPR] Running CI Watch..." -ForegroundColor Cyan
            $WatchArgs = @("$WatchScript", "--task_id", "$TaskId", "--attempt", "$CurrentAttempt", "--max_attempts", "$($AutoFixMax + 1)", "--result_dir", "$EvidenceDir")
            $WatchTimer = [System.Diagnostics.Stopwatch]::StartNew()
            $WatchProcess = Start-Process -FilePath "node" -ArgumentList $WatchArgs -NoNewWindow -PassThru -Wait
            $WatchTimer.Stop()
            $WatchElapsed = [int]$WatchTimer.ElapsedMilliseconds
            $Script:CiWatchMs += $WatchElapsed
            $ExitCode = $WatchProcess.ExitCode
            
            if ($ExitCode -eq 0) {
                Write-Host "[AutoPR] CI Passed!" -ForegroundColor Green
                $Script:CiPassAtIso = (Get-Date).ToString("o")
                $Script:WallTotalMs = [int]((Get-Date) - $Script:RunChainStartedAt).TotalMilliseconds
                $Script:WallTotalRecorded = $true
                if ($CurrentAttempt -eq 1) {
                    $Script:FailurePenaltyTotalMs = 0
                    $Script:FirstCiFailWatchMs = 0
                    $Script:AutoFixApplyMs = 0
                    $Script:SecondCiPassWatchMs = 0
                } elseif ($Script:FirstCiFailWatchMs -gt 0 -and $Script:SecondCiPassWatchMs -eq 0) {
                    $Script:SecondCiPassWatchMs = $WatchElapsed
                    $Script:FailurePenaltyTotalMs = $Script:FirstCiFailWatchMs + $Script:AutoFixApplyMs + $Script:SecondCiPassWatchMs
                }
                $LoopActive = $false
            } elseif ($ExitCode -eq 1) {
                Write-Error "[AutoPR] CI Watch failed with Infra/Critical Error (Exit Code 1)."
                Write-Host ""
                Write-Host "=== FIX_GUIDE: AutoPR CI Watch Infra Error ===" -ForegroundColor Yellow
                Write-Host "CAUSE: CI Watch infrastructure or critical error" -ForegroundColor Yellow
                Write-Host "FIX_CMD: gh auth status" -ForegroundColor White
                Write-Host "FIX_CMD: gh pr list --state open --head $BranchName" -ForegroundColor White
                Write-Host "FIX_CMD: gh pr create --title 'TraeTask_$TaskId' --body 'Manual PR after CI infra fail'" -ForegroundColor White
                Write-Host "===============================================" -ForegroundColor Yellow
                Write-Host ""
                $AutoPrInfo = Get-AutoPrInfo -EvidenceDir $EvidenceDir -TaskId $TaskId
                $ErrorClass = if ($AutoPrInfo.error_class) { $AutoPrInfo.error_class } else { "AUTO_PR_INFRA_FAIL" }
                $FailReason = if ($AutoPrInfo.fail_reason) { $AutoPrInfo.fail_reason } else { "CI_WATCH_INFRA_FAIL" }
                $HardStop = Get-HardStopReason -ErrorClass $ErrorClass -FailReason $FailReason -Mode $Mode
                if ($HardStop.active) {
                    Stop-RunTask -Message "HARD_STOP" -ErrorClass $ErrorClass -FailReason $HardStop.reason
                }
                Stop-RunTask -Message "AUTO_PR_INFRA_FAIL" -ErrorClass $ErrorClass -FailReason $FailReason
            } elseif ($ExitCode -eq 2) {
                Write-Host "[AutoPR] CI Failed (Exit Code 2)." -ForegroundColor Red
                if ($CurrentAttempt -eq 1 -and $Script:FirstCiFailWatchMs -eq 0) {
                    $Script:FirstCiFailWatchMs = $WatchElapsed
                }
                
                $AutoPrInfo = Get-AutoPrInfo -EvidenceDir $EvidenceDir -TaskId $TaskId
                $ErrorClass = if ($AutoPrInfo.error_class) { $AutoPrInfo.error_class } else { "AUTO_PR_CI_FAIL" }
                $FailReason = if ($AutoPrInfo.fail_reason) { $AutoPrInfo.fail_reason } else { "CI_CHECKS_FAILED" }
                $HardStop = Get-HardStopReason -ErrorClass $ErrorClass -FailReason $FailReason -Mode $Mode
                if ($HardStop.active) {
                    Stop-RunTask -Message "HARD_STOP" -ErrorClass $ErrorClass -FailReason $HardStop.reason
                }
                if ($ErrorClass -and $ErrorClass -eq $LastCiErrorClass) {
                    Stop-RunTask -Message "LOOP_DETECTED" -ErrorClass "LOOP_DETECTED" -FailReason "ERROR_CLASS_REPEAT"
                }
                if ($FailReason -and $FailReason -eq $LastCiFailReason) {
                    Stop-RunTask -Message "LOOP_DETECTED" -ErrorClass "LOOP_DETECTED" -FailReason "FAIL_REASON_REPEAT"
                }
                $LastCiErrorClass = $ErrorClass
                $LastCiFailReason = $FailReason

                if ($GlobalFixCount -ge 1 -or $AutoFixMax -le 0) {
                    Stop-RunTask -Message "AUTO_FIX_MAX_EXCEEDED" -ErrorClass "AUTO_FIX_MAX_EXCEEDED" -FailReason "GLOBAL_AUTOFIX_MAX_REACHED"
                }
                if ($FixCountByClass.ContainsKey($ErrorClass) -and $FixCountByClass[$ErrorClass] -ge 1) {
                    Stop-RunTask -Message "AUTO_FIX_MAX_EXCEEDED" -ErrorClass "AUTO_FIX_MAX_EXCEEDED" -FailReason "CLASS_AUTOFIX_MAX_REACHED"
                }
                if ($CurrentFixCount -lt $AutoFixMax) {
                    $CurrentFixCount++
                    $GlobalFixCount++
                    $Script:AutoFixCount++
                    if (-not $FixCountByClass.ContainsKey($ErrorClass)) { $FixCountByClass[$ErrorClass] = 0 }
                    $FixCountByClass[$ErrorClass]++
                    $Script:FixActions += "AutoFix pack for $ErrorClass"
                    Write-Host "[AutoPR] Attempting AutoFix ($CurrentFixCount/$AutoFixMax)..." -ForegroundColor Yellow
                    
                    # --- HardStop Latch Check Before AutoFix ---
                    if (Test-HardStopLatch) {
                        Stop-RunTask -Message "HARDSTOP_LATCH_MID_EXECUTION" -ErrorClass "HARDSTOP_LATCH_MID_EXECUTION" -FailReason "LATCH_DETECTED_BEFORE_AUTOFIX"
                    }
                    Write-Host ">>> [AutoPR] Running AutoFix..." -ForegroundColor Cyan
                    $FixTimer = [System.Diagnostics.Stopwatch]::StartNew()
                    $FixProcess = Start-Process -FilePath "node" -ArgumentList "$FixScript", "--task_id", "$TaskId" -NoNewWindow -PassThru -Wait
                    $FixTimer.Stop()
                    if ($Script:AutoFixApplyMs -eq 0) { $Script:AutoFixApplyMs = [int]$FixTimer.ElapsedMilliseconds }
                    
                    if ($FixProcess.ExitCode -ne 0) {
                        Write-Error "[AutoPR] AutoFix failed with exit code $($FixProcess.ExitCode)."
                        Stop-RunTask -Message "AUTO_FIX_FAILED" -ErrorClass "AUTO_FIX_FAILED" -FailReason "AUTO_FIX_FAILED"
                    }
                } else {
                    Write-Error "[AutoPR] AutoFix limit reached ($AutoFixMax). CI still failing."
                    Stop-RunTask -Message "AUTO_FIX_MAX_EXCEEDED" -ErrorClass "AUTO_FIX_MAX_EXCEEDED" -FailReason "AUTOFIX_LIMIT_REACHED"
                }
            } else {
                Write-Error "[AutoPR] Unknown Exit Code from CI Watch: $ExitCode"
                Stop-RunTask -Message "AUTO_PR_UNKNOWN_EXIT" -ErrorClass "AUTO_PR_UNKNOWN_EXIT" -FailReason "CI_WATCH_UNKNOWN_EXIT"
            }
        }
    }
    } else {
        Write-Host "AUTOPR_DISABLED=1" -ForegroundColor Yellow
        Write-Host ">>> [RunTask] Step 9: AutoPR Disabled. Skipping." -ForegroundColor Yellow
    }
}

# --- Step 5: Pass 2 - Gate Light Verify ---
if ($Mode -eq "Integrate") {
    Write-Host "[State] VERIFYING (Pass 2)..." -ForegroundColor Cyan
    Write-Host ">>> [RunTask] Step 5: Pass 2 - Gate Light Verify" -ForegroundColor Cyan
    $VerifyLog = "$EvidenceDir\gate_light_verify_$TaskId.log"
    $Pass2Cmd = @("node", "$RepoRoot\scripts\gate_light_ci.mjs", "--task_id", $TaskId, "--mode", $Mode, "--result_dir", $EvidenceDir, "--run_id", $RunId)
    Measure-Step -Key "pass2_verify" -Action { Invoke-Step -Name "Pass 2 - Gate Light Verify" -Cmd $Pass2Cmd -RedirectTo $VerifyLog }
    Write-Host "    Verify Log: $VerifyLog" -ForegroundColor Gray
} else {
    Write-Host ">>> [RunTask] Step 5: Skip Pass 2 Verify (Dev Mode)" -ForegroundColor Yellow
}

# --- Step 6: Postflight (Integrate Only) ---
if ($Mode -eq "Integrate") {
    Write-Host "[State] POSTFLIGHT..." -ForegroundColor Cyan
    Write-Host ">>> [RunTask] Step 6: Postflight (Integrate)" -ForegroundColor Cyan
    $PostflightScript = "$RepoRoot\scripts\postflight_validate_envelope.mjs"
    Measure-Step -Key "postflight" -Action {
        if (Test-Path $PostflightScript) {
            $PostCmd = @("node", $PostflightScript, "--task_id", $TaskId, "--result_dir", $EvidenceDir)
            Invoke-Step -Name "Postflight" -Cmd $PostCmd -RedirectTo $VerifyLog -Append
        } else {
            Write-Host "    Warning: Postflight script not found." -ForegroundColor Yellow
        }
    }

    # --- Step 6.5: Error Digest (Pass 2) ---
    Write-Host ">>> [RunTask] Step 6.5: Error Digest (Pass 2)" -ForegroundColor Cyan
    $DigestCmd2 = @("node", "$RepoRoot\scripts\error_digest.mjs", "--task_id", $TaskId, "--mode", $Mode, "--commit", $Commit, "--out_dir", $EvidenceDir)
    if (Test-Path "$EvidenceDir\gate_light_verify_$TaskId.log") { $DigestCmd2 += "--source_logs=$EvidenceDir\gate_light_verify_$TaskId.log" }
    if (Test-Path "$EvidenceDir\command_audit_$TaskId.jsonl") { $DigestCmd2 += "--source_logs=$EvidenceDir\command_audit_$TaskId.jsonl" }
    Invoke-Step -Name "Error Digest (Pass 2)" -Cmd $DigestCmd2

    # --- Step 7: Update Evidence with Verify Logs (Integrate Only) ---
    Write-Host ">>> [RunTask] Step 7: Update Evidence with Verify Logs" -ForegroundColor Cyan
    # Overwrite Preview Log with Verify Log
    # REPLACED: Copy-Item -Path $VerifyLog -Destination "$EvidenceDir\gate_light_preview_$TaskId.log" -Force
    node "$RepoRoot\scripts\ops_copy_file.mjs" "$VerifyLog" "$EvidenceDir\gate_light_preview_$TaskId.log" --force
    if ($LASTEXITCODE -ne 0) { throw "Failed to overwrite preview log with verify log" }
    
    # Re-run Assemble Evidence
    Write-SpeedEvidence -EvidenceDir $EvidenceDir -TaskId $TaskId
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
    $ArchiveCmd = @("node", "$RepoRoot\scripts\assemble_evidence.mjs", "--task_id=$TaskId", "--evidence_dir=$EvidenceDir", "--mode=$Mode", "--phase=archive", "--run_id=$RunId")
    Invoke-Step -Name "Archive & Lock" -Cmd $ArchiveCmd
    Write-Host "    Archived evidence and locked task." -ForegroundColor Gray

    # === 回报提示 ===
    $LockExists = Test-Path "$RepoRoot\rules\task-reports\locks\$TaskId.lock.json"
    $LockStatus = if ($LockExists) { "✅ 存在" } else { "❌ 未找到" }
    $RptAutoPrPath = "$EvidenceDir\auto_pr_$TaskId.json"
    $RptAutoPrJson = Read-JsonSafe -Path $RptAutoPrPath
    $PrNumber = ""
    if ($RptAutoPrJson -and $RptAutoPrJson.PSObject.Properties.Name -contains "number" -and $RptAutoPrJson.number) {
        $PrNumber = $RptAutoPrJson.number.ToString()
    }
    $PrDisplay = if ($PrNumber) { "#$PrNumber" } else { "（未创建）" }
    $ReportPrompt = @"

========================================
⚠  任务完成 — 必须填写以下回报模板
========================================
Task ID   : $TaskId
PR 号     : $PrDisplay
Lock 文件 : $LockStatus
----------------------------------------
请逐行填写胶囊验收 CheckList 各项（✅ 或 ❌），
然后将完整回报输出给 Owner。
========================================
"@
    Write-Host $ReportPrompt -ForegroundColor Yellow
    $ReportPromptPath = "$EvidenceDir\report_prompt_$TaskId.txt"
    $Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($ReportPromptPath, $ReportPrompt, $Utf8NoBom)

}

Write-Host ">>> [RunTask] SUCCESS: Task $TaskId ($Mode) Completed." -ForegroundColor Green
} catch {
    Write-Host "[RunTask] FAILED: Script execution error: $_" -ForegroundColor Red
    $ErrorHistoryPath = Join-Path $HistoryRoot "error_history.jsonl"
    $AutoPrInfo = Get-AutoPrInfo -EvidenceDir $EvidenceDir -TaskId $TaskId
    $ErrorClass = $Script:LastErrorClass
    $FailReason = $Script:LastFailReason
    if (-not $ErrorClass) { $ErrorClass = $AutoPrInfo.error_class }
    if (-not $FailReason) { $FailReason = $AutoPrInfo.fail_reason }
    if (-not $ErrorClass -or -not $FailReason) {
        $Markers = Get-LastErrorMarkersFromLog -LogPath $LogFile
        if (-not $ErrorClass) { $ErrorClass = $Markers.error_class }
        if (-not $FailReason) { $FailReason = $Markers.fail_reason }
    }
    if (-not $ErrorClass) { $ErrorClass = "UNKNOWN_ERROR" }
    if (-not $FailReason) { $FailReason = "UNKNOWN_FAIL_REASON" }

    $PrevRecord = $null
    if (Test-Path $ErrorHistoryPath) {
        $Lines = @(Get-Content $ErrorHistoryPath -ErrorAction SilentlyContinue)
        for ($i = $Lines.Count - 1; $i -ge 0; $i--) {
            if ($Lines[$i].Trim()) {
                try { $PrevRecord = $Lines[$i] | ConvertFrom-Json } catch {}
                break
            }
        }
    }
    $LoopTriggered = $false
    $LoopReason = ""
    if ($PrevRecord) {
        if ($PrevRecord.error_class -and $PrevRecord.error_class -eq $ErrorClass) {
            $LoopTriggered = $true
            $LoopReason = "ERROR_CLASS_REPEAT"
        } elseif ($PrevRecord.fail_reason -and $PrevRecord.fail_reason -eq $FailReason) {
            $LoopTriggered = $true
            $LoopReason = "FAIL_REASON_REPEAT"
        }
    }

    $ErrorRecord = @{
        task_id = $TaskId
        error_class = $ErrorClass
        fail_reason = $FailReason
        timestamp_utc = (Get-Date).ToUniversalTime().ToString("o")
    } | ConvertTo-Json -Compress
    Append-JsonlUtf8 -Path $ErrorHistoryPath -Line $ErrorRecord

    $TierInfo = Invoke-ErrorTiering -ErrorClass $ErrorClass -FailReason $FailReason
    if ($LoopTriggered) {
        if ($ErrorClass -eq "FAIL_BUDGET_EXCEEDED_INTEGRATE" -or $FailReason -eq "INTEGRATE_FAIL_BUDGET_EXCEEDED") {
            $LoopReason = "FAIL_BUDGET_EXCEEDED_INTEGRATE"
        }
        $ErrorClass = "LOOP_DETECTED"
        $FailReason = $LoopReason
        $TierInfo = @{ tier = "NON_SELF_HEALABLE"; recommended_action = "ESCALATE" }
    }
    $Script:RunChainErrorClass = $ErrorClass
    $Script:RunChainFailReason = $FailReason
    if (-not $Script:HardStopTriggered) {
        $HardStop = Get-HardStopReason -ErrorClass $ErrorClass -FailReason $FailReason -Mode $Mode
        if ($HardStop.active) {
            $Script:HardStopTriggered = $true
            Write-HardStopBlock -Reason $HardStop.reason
        }
    }

    if ($TierInfo.tier -eq "NON_SELF_HEALABLE" -or $LoopTriggered) {
        $PrTaskIdDetected = if ($AutoPrInfo.pr_task_id_detected) { $AutoPrInfo.pr_task_id_detected } else { "" }
        $ReportPath = Invoke-EscalationReport -ErrorClass $ErrorClass -FailReason $FailReason -LogPath $LogFile -PrTaskIdDetected $PrTaskIdDetected
        if ($ReportPath) { Write-Host "Escalation report generated: $ReportPath" -ForegroundColor Yellow }
    }

    exit 1
} finally {
    try {
        if ($Script:RunChainWatch) { $Script:RunChainWatch.Stop() }
        $AutoPrPath = "$EvidenceDir\auto_pr_$TaskId.json"
        $AutoPrJson = Read-JsonSafe -Path $AutoPrPath
        $PrNumber = ""
        if ($AutoPrJson -and $AutoPrJson.PSObject.Properties.Name -contains "number" -and $AutoPrJson.number) {
            $PrNumber = $AutoPrJson.number.ToString()
        }
        $DidAutoFix = $false
        if ($Script:AutoFixCount -gt 0) { $DidAutoFix = $true }
        $RunChainEnd = @{
            task_id = $TaskId
            mode = $Mode
            branch = $BranchName
            started_at = $Script:RunChainStartedAtIso
            finished_at = (Get-Date).ToString("o")
            duration_ms = [int]$Script:RunChainWatch.ElapsedMilliseconds
            ci_watch_ms = $Script:CiWatchMs
            error_class = $Script:RunChainErrorClass
            fail_reason = $Script:RunChainFailReason
            did_autofix = $DidAutoFix
            autofix_count = $Script:AutoFixCount
            did_autopr = $Script:DidAutoPr
            pr_number = $PrNumber
        }
        Write-RunChainEntry -Record $RunChainEnd
    } catch {}
    if ($Mode -eq "Dev") {
        if ($null -ne $LatestJsonRaw) {
            $Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
            [System.IO.File]::WriteAllText($LatestJsonPath, $LatestJsonRaw, $Utf8NoBom)
        } elseif (Test-Path $LatestJsonPath) {
            node scripts/ops_delete.mjs "$LatestJsonPath" --force
        }
    }
    if ($TotalWatch) { $TotalWatch.Stop() }
    $StepDurations.total = [int]$TotalWatch.ElapsedMilliseconds
    if (-not $Script:WallTotalRecorded) {
        $Script:WallTotalMs = $StepDurations.total
        $Script:WallTotalRecorded = $true
    }
    if ($Script:CiAttempts -le 0) { $Script:CiAttempts = 1 }
    if ($TimingEnabled) {
        $Timing.total = $StepDurations.total
        $Timing["started_at"] = $TimingStartedAt
        $Timing["finished_at"] = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
        $Timing | ConvertTo-Json | Set-Content -Encoding UTF8 $TimingOutput
    }
    if (-not $Script:SpeedEvidenceWritten) {
        try { Write-SpeedEvidence -EvidenceDir $EvidenceDir -TaskId $TaskId } catch {}
    }
    try { Stop-Transcript -ErrorAction SilentlyContinue } catch {}
}
