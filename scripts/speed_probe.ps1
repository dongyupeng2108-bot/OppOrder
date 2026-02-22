param (
    [Parameter(Mandatory=$false)]
    [string]$TaskId = "260222_003a",

    [Parameter(Mandatory=$false)]
    [string]$Header = "TraeTask_260222_003a"
)

$RepoRoot = "E:\OppRadar"
$null = Set-Location $RepoRoot
$YearMonth = Get-Date -Format "yyyy-MM"
$GenerateScript = Get-ChildItem -Path "$RepoRoot\rules\task-reports" -Recurse | Where-Object { $_.Name -match "^generate_evidence_${TaskId}\.(js|mjs)$" } | Select-Object -First 1

$EvidenceDir = ""
if ($GenerateScript) {
    $EvidenceDir = $GenerateScript.DirectoryName
} else {
    $EvidenceDir = "$RepoRoot\rules\task-reports\$YearMonth"
    if (-not (Test-Path $EvidenceDir)) {
        New-Item -ItemType Directory -Path $EvidenceDir -Force | Out-Null
    }
}

$DevCmd = "scripts/run_task.ps1 -TaskId $TaskId -Mode Dev -Header `"$Header`""
$IntegrateCmd = "scripts/run_task.ps1 -TaskId $TaskId -Mode Integrate -Header `"$Header`" -AutoFixMax 0"

$SpeedCmdsPath = "$EvidenceDir\speed_cmds_${TaskId}.txt"
$SpeedTimingPath = "$EvidenceDir\speed_timing_${TaskId}.json"

function Write-LfFile {
    param([string]$Path, [string]$Content)
    $Normalized = $Content -replace "`r`n", "`n"
    [System.IO.File]::WriteAllText($Path, $Normalized, [System.Text.UTF8Encoding]::new($false))
}

$TempDir = [System.IO.Path]::GetTempPath()
$DevTimingTmp = Join-Path $TempDir "speed_timing_${TaskId}_dev.tmp.json"
$IntegrateTimingTmp = Join-Path $TempDir "speed_timing_${TaskId}_integrate.tmp.json"

$Env:SPEED_TIMING_OUT = $DevTimingTmp
powershell -NonInteractive -ExecutionPolicy Bypass -File "$RepoRoot\scripts\run_task.ps1" -TaskId $TaskId -Mode Dev -Header $Header
$Env:SPEED_TIMING_OUT = $null
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$DevTiming = Get-Content $DevTimingTmp -Raw | ConvertFrom-Json
Remove-Item $DevTimingTmp -Force -ErrorAction SilentlyContinue

$CleanupTargets = Get-ChildItem -Path $EvidenceDir -Filter "*${TaskId}*" -File | Where-Object {
    $_.Name -notmatch "^generate_evidence_${TaskId}\.(js|mjs)$" -and $_.Name -ne ".budget_${TaskId}.json"
}
foreach ($Item in $CleanupTargets) {
    Remove-Item $Item.FullName -Force -ErrorAction SilentlyContinue
}

if (-not $GenerateScript) {
    Write-Error "Missing generate_evidence_${TaskId}.mjs in $EvidenceDir"
    exit 1
}

node $GenerateScript.FullName
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

powershell -NonInteractive -ExecutionPolicy Bypass -File "$RepoRoot\scripts\safe_commit.ps1" -Message "TraeTask_${TaskId}: prepare evidence for integrate speed baseline"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$Env:SPEED_TIMING_OUT = $IntegrateTimingTmp
powershell -NonInteractive -ExecutionPolicy Bypass -File "$RepoRoot\scripts\run_task.ps1" -TaskId $TaskId -Mode Integrate -Header $Header -AutoFixMax 0
$Env:SPEED_TIMING_OUT = $null
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$IntegrateTiming = Get-Content $IntegrateTimingTmp -Raw | ConvertFrom-Json
Remove-Item $IntegrateTimingTmp -Force -ErrorAction SilentlyContinue

$FinalTiming = [ordered]@{
    task_id = $TaskId
    generated_at = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    dev = $DevTiming
    integrate = $IntegrateTiming
}

$SpeedCmdsContent = @($DevCmd, $IntegrateCmd) -join "`n"
Write-LfFile -Path $SpeedCmdsPath -Content $SpeedCmdsContent
$FinalJson = $FinalTiming | ConvertTo-Json -Depth 6
Write-LfFile -Path $SpeedTimingPath -Content $FinalJson

powershell -NonInteractive -ExecutionPolicy Bypass -File "$RepoRoot\scripts\safe_commit.ps1" -Message "TraeTask_${TaskId}: speed baseline evidence"
