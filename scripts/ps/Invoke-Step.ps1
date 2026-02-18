
function Invoke-Step {
    param(
        [Parameter(Mandatory=$true)]
        [string]$Name,

        [Parameter(Mandatory=$true)]
        [string[]]$Cmd,

        [string]$LogFile,
        [string]$RedirectTo,
        [switch]$Append,
        [int]$TimeoutSec = 120,
        [switch]$NonInteractive
    )

    # --- B. Ban cmd syntax hard check ---
    $Banned = @("&&", "||", "< NUL", "2>nul", "1>nul", ">nul")
    foreach ($Arg in $Cmd) {
        foreach ($Token in $Banned) {
            if ($Arg -match [regex]::Escape($Token)) {
                 Write-Error "FAIL: Banned cmd syntax '$Token' detected in '$Arg'. Use PowerShell native syntax."
                 exit 1
            }
        }
    }

    Write-Host ">>> [RunTask] Step: $Name" -ForegroundColor Cyan
    
    $TempLogOut = [System.IO.Path]::GetTempFileName()
    $TempLogErr = [System.IO.Path]::GetTempFileName()
    
    try {
        $Exe = $Cmd[0]
        # Fix for empty args causing issues
        if ($Cmd.Count -gt 1) {
            $ArgsList = $Cmd[1..($Cmd.Count-1)]
        } else {
            $ArgsList = @()
        }

        # Execute
        $Process = Start-Process -FilePath $Exe -ArgumentList $ArgsList `
            -RedirectStandardOutput $TempLogOut `
            -RedirectStandardError $TempLogErr `
            -PassThru -NoNewWindow

        # Wait with Timeout
        try {
            $Process | Wait-Process -Timeout $TimeoutSec -ErrorAction Stop
        } catch {
            $Process | Stop-Process -Force -ErrorAction SilentlyContinue
            Write-Host "[RunTask] FAILED: Step '$Name' TIMED OUT after ${TimeoutSec}s." -ForegroundColor Red
            
            $ContentOut = Get-Content $TempLogOut -Raw -ErrorAction SilentlyContinue
            $ContentErr = Get-Content $TempLogErr -Raw -ErrorAction SilentlyContinue
            
            Write-RootCauseSummary -Name $Name -Cmd $Cmd -ExitCode "TIMEOUT" -Out $ContentOut -Err $ContentErr
            exit 1
        }

        # Read output
        $ContentOut = Get-Content $TempLogOut -Raw -ErrorAction SilentlyContinue
        $ContentErr = Get-Content $TempLogErr -Raw -ErrorAction SilentlyContinue
        
        # Print to Host
        if ($ContentOut) { Write-Host $ContentOut }
        if ($ContentErr) { Write-Host $ContentErr -ForegroundColor Red }

        # Save to RedirectTo
        if ($RedirectTo) {
            $MergedOutput = "$ContentOut`n$ContentErr"
            if ($Append) {
                Add-Content -Path $RedirectTo -Value $MergedOutput -NoNewline
            } else {
                Set-Content -Path $RedirectTo -Value $MergedOutput -NoNewline
            }
        }

        # Interactive Prompt Detection
        $Combined = "$ContentOut`n$ContentErr"
        if ($Combined -match "Please provide value" -or $Combined -match "Select an option" -or $Combined -match "Press any key" -or $Combined -match "INTERACTIVE_PROMPT_DETECTED") {
             Write-Error "INTERACTIVE_PROMPT_DETECTED"
             # Kill process if still running (though Wait-Process returned, so it should be done)
             exit 1
        }

        if ($Process.ExitCode -ne 0) {
            Write-Host "[RunTask] FAILED: Step '$Name' failed with exit code $($Process.ExitCode)." -ForegroundColor Red
            Write-RootCauseSummary -Name $Name -Cmd $Cmd -ExitCode $Process.ExitCode -Out $ContentOut -Err $ContentErr
            exit 1
        }

    } catch {
        Write-Host "[RunTask] FAILED: Step '$Name' Exception: $_" -ForegroundColor Red
        # If we have captured output, print it in summary
        $ContentOut = Get-Content $TempLogOut -Raw -ErrorAction SilentlyContinue
        $ContentErr = Get-Content $TempLogErr -Raw -ErrorAction SilentlyContinue
        Write-RootCauseSummary -Name $Name -Cmd $Cmd -ExitCode "EXCEPTION" -Out $ContentOut -Err $ContentErr
        exit 1
    } finally {
        if (Test-Path $TempLogOut) { Remove-Item $TempLogOut -Force -ErrorAction SilentlyContinue }
        if (Test-Path $TempLogErr) { Remove-Item $TempLogErr -Force -ErrorAction SilentlyContinue }
    }
}

function Write-RootCauseSummary {
    param($Name, $Cmd, $ExitCode, $Out, $Err)
    
    Write-Host "`n========== FAIL_ROOT_CAUSE_BLOCK ==========" -ForegroundColor Red
    Write-Host "Step: $Name"
    Write-Host "Command: $($Cmd -join ' ')"
    Write-Host "Exit Code: $ExitCode"
    Write-Host "--- STDERR (Tail 80) ---" -ForegroundColor Yellow
    if ($Err) { ($Err -split "`n") | Select-Object -Last 80 | Write-Host }
    Write-Host "--- STDOUT (Tail 80) ---" -ForegroundColor Yellow
    if ($Out) { ($Out -split "`n") | Select-Object -Last 80 | Write-Host }
    
    # Context (Try to access script scope vars from caller)
    Write-Host "--- Context ---"
    if ($Script:EvidenceDir) { Write-Host "Evidence Dir: $Script:EvidenceDir" }
    if ($Script:TaskId) { Write-Host "Task ID: $Script:TaskId" }
    if ($Script:Mode) { Write-Host "Mode: $Script:Mode" }
    
    try {
        $Branch = git rev-parse --abbrev-ref HEAD 2>$null
        $Sha = git rev-parse --short HEAD 2>$null
        Write-Host "Branch: $Branch"
        Write-Host "HEAD: $Sha"
    } catch {}
    Write-Host "==========================================`n" -ForegroundColor Red
}
