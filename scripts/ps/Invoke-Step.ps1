
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
    # Note: Scanner should ignore this line:
    $Banned = @("&&", "||", "< NUL", "2>nul", "1>nul", ">nul")
    foreach ($Arg in $Cmd) {
        foreach ($Token in $Banned) {
            if ($Arg -match [regex]::Escape($Token)) {
                 Throw "FAIL: Banned cmd syntax '$Token' detected in '$Arg'. Use PowerShell native syntax."
            }
        }
    }

    Write-Host ">>> [RunTask] Step: $Name" -ForegroundColor Cyan
    
    $TempLogOut = [System.IO.Path]::GetTempFileName()
    $TempLogErr = [System.IO.Path]::GetTempFileName()
    
    try {
        $Exe = $Cmd[0]
        if ($Cmd.Count -gt 1) {
            $ArgsList = $Cmd[1..($Cmd.Count-1)]
        } else {
            $ArgsList = @()
        }

        # Execute
        # Note: Use -WindowStyle Hidden to ensure no popup
        $Process = Start-Process -FilePath $Exe -ArgumentList $ArgsList `
            -RedirectStandardOutput $TempLogOut `
            -RedirectStandardError $TempLogErr `
            -PassThru -WindowStyle Hidden

        # Wait with Timeout
        try {
            $Process | Wait-Process -Timeout $TimeoutSec -ErrorAction Stop
        } catch {
            # Timeout or other error waiting
            $HasExited = $false
            try { $HasExited = $Process.HasExited } catch {}
            
            if (-not $HasExited) {
                try { $Process | Stop-Process -Force -ErrorAction SilentlyContinue } catch {}
                Write-Host "[RunTask] FAILED: Step '$Name' TIMED OUT after ${TimeoutSec}s." -ForegroundColor Red
                
                $ContentOut = Get-Content $TempLogOut -Raw -ErrorAction SilentlyContinue
                $ContentErr = Get-Content $TempLogErr -Raw -ErrorAction SilentlyContinue
                # Append TIMED OUT to stderr for root cause summary
                $ContentErr += "`n[RunTask] Step '$Name' TIMED OUT"
                
                Write-RootCauseSummary -Name $Name -Cmd $Cmd -ExitCode "TIMEOUT" -Out $ContentOut -Err $ContentErr
                Throw "[RunTask] FAILED: Step '$Name' TIMED OUT after ${TimeoutSec}s."
            }
        }

        # A2. Check ExitCode
        $ExitCode = $Process.ExitCode
        if ($null -eq $ExitCode) {
            $Process.Refresh()
            $ExitCode = $Process.ExitCode
        }
        
        if ($null -eq $ExitCode) {
             # Give it one more short wait just in case
             if (-not $Process.HasExited) { $Process.WaitForExit(1000) }
             $Process.Refresh()
             $ExitCode = $Process.ExitCode
        }

        if ($null -eq $ExitCode) {
             Throw "FATAL: ExitCode is null for step '$Name'. Executable: '$Exe', Args: $($ArgsList -join ' ')"
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
        
        # Save to LogFile
        if ($LogFile -and $LogFile -ne $RedirectTo) {
             $MergedOutput = "$ContentOut`n$ContentErr"
             Add-Content -Path $LogFile -Value $MergedOutput -NoNewline
        }

        # Interactive Prompt Detection
        $Combined = "$ContentOut`n$ContentErr"
        if ($Combined -match "Please provide value" -or $Combined -match "Select an option" -or $Combined -match "Press any key" -or $Combined -match "INTERACTIVE_PROMPT_DETECTED") {
             Throw "INTERACTIVE_PROMPT_DETECTED"
        }

        if ($ExitCode -ne 0) {
            Write-Host "[RunTask] FAILED: Step '$Name' failed with exit code $ExitCode." -ForegroundColor Red
            Write-RootCauseSummary -Name $Name -Cmd $Cmd -ExitCode $ExitCode -Out $ContentOut -Err $ContentErr
            Throw "[RunTask] FAILED: Step '$Name' failed with exit code $ExitCode."
        }

    } catch {
        Write-Host "[RunTask] FAILED: Step '$Name' Exception: $_" -ForegroundColor Red
        $ContentOut = Get-Content $TempLogOut -Raw -ErrorAction SilentlyContinue
        $ContentErr = Get-Content $TempLogErr -Raw -ErrorAction SilentlyContinue
        Write-RootCauseSummary -Name $Name -Cmd $Cmd -ExitCode "EXCEPTION" -Out $ContentOut -Err $ContentErr
        Throw $_
    } finally {
        if (Test-Path $TempLogOut) { node scripts/ops_delete.mjs "$TempLogOut" --force }
        if (Test-Path $TempLogErr) { node scripts/ops_delete.mjs "$TempLogErr" --force }
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
