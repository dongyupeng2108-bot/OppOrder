param (
    [Parameter(Mandatory=$false)]
    [string]$TaskId = "260222_003",

    [Parameter(Mandatory=$false)]
    [string]$Header = "TraeTask_260222_003"
)

$RepoRoot = "E:\OppRadar"
$YearMonth = Get-Date -Format "yyyy-MM"
$EvidenceDir = "$RepoRoot\rules\task-reports\$YearMonth"
if (-not (Test-Path $EvidenceDir)) {
    New-Item -ItemType Directory -Path $EvidenceDir -Force | Out-Null
}

$SpeedCmdsPath = "$EvidenceDir\speed_cmds_${TaskId}.txt"
$SpeedTimingPath = "$EvidenceDir\speed_timing_${TaskId}.json"

$DevCmd = "scripts/run_task.ps1 -TaskId $TaskId -Mode Dev -Header `"$Header`""
$IntegrateCmd = "scripts/run_task.ps1 -TaskId $TaskId -Mode Integrate -Header `"$Header`" -AutoFixMax 0"

@($DevCmd, $IntegrateCmd) -join "`n" | Set-Content -Encoding UTF8 $SpeedCmdsPath

$DevTimingTmp = "$EvidenceDir\speed_timing_${TaskId}_dev.tmp.json"
$IntegrateTimingTmp = "$EvidenceDir\speed_timing_${TaskId}_integrate.tmp.json"

$Env:SPEED_TIMING_OUT = $DevTimingTmp
powershell -NonInteractive -ExecutionPolicy Bypass -File "$RepoRoot\scripts\run_task.ps1" -TaskId $TaskId -Mode Dev -Header $Header
$Env:SPEED_TIMING_OUT = $IntegrateTimingTmp
powershell -NonInteractive -ExecutionPolicy Bypass -File "$RepoRoot\scripts\run_task.ps1" -TaskId $TaskId -Mode Integrate -Header $Header -AutoFixMax 0
$Env:SPEED_TIMING_OUT = $null

$DevTiming = Get-Content $DevTimingTmp -Raw | ConvertFrom-Json
$IntegrateTiming = Get-Content $IntegrateTimingTmp -Raw | ConvertFrom-Json

$FinalTiming = [ordered]@{
    task_id = $TaskId
    generated_at = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    dev = $DevTiming
    integrate = $IntegrateTiming
}

$FinalTiming | ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 $SpeedTimingPath
