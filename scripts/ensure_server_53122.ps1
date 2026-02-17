# Unified Service Policy - Port 53122
# Checks if server is running on 53122. If not, starts it.
# Usage: ./ensure_server_53122.ps1

$Port = 53122
$Url = "http://localhost:$Port/"
$ServerScript = "scripts/mock_server.mjs"
$RuntimeDir = "runtime"

# Ensure runtime directory exists
if (!(Test-Path $RuntimeDir)) {
    New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
}

Write-Host "[Service Policy] Checking Port $Port..."

# 1. Check if already reachable
try {
    $Response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
    if ($Response.StatusCode -eq 200) {
        Write-Host "[Service Policy] Server 53122 is ALREADY RUNNING and Healthy."
        exit 0
    }
} catch {
    Write-Host "[Service Policy] Server not reachable ($($_.Exception.Message)). Attempting start..."
}

# 2. Start Server
Write-Host "[Service Policy] Starting $ServerScript..."
$LogFile = "$RuntimeDir/mock_server_53122.log"
$ErrFile = "$RuntimeDir/mock_server_53122.err"

# Start process in background
# Use Start-Process to detach slightly, but we need it to persist.
# -NoNewWindow might bind it to current console which is okay for local dev but we want it to survive if possible?
# Actually, for run_task.ps1, if we close the terminal, the server dies. That's usually fine for "ensure".
# But user said "pid/temp files ... untracked".
$Process = Start-Process -FilePath "node" -ArgumentList "$ServerScript" -RedirectStandardOutput $LogFile -RedirectStandardError $ErrFile -PassThru -WindowStyle Hidden

if ($Process.Id) {
    Write-Host "[Service Policy] Server Process Started (PID: $($Process.Id)). Logs: $LogFile"
    $Process.Id | Out-File "$RuntimeDir/mock_server_53122.pid" -Encoding ASCII
} else {
    Write-Error "[Service Policy] Failed to start server process."
    exit 1
}

# 3. Wait for Healthy (Max 8s, check every 0.5s = 16 checks)
$MaxRetries = 16
$RetryDelay = 500 # ms

for ($i = 1; $i -le $MaxRetries; $i++) {
    Start-Sleep -Milliseconds $RetryDelay
    try {
        $Response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 1 -ErrorAction SilentlyContinue
        if ($Response.StatusCode -eq 200) {
            Write-Host "[Service Policy] Server 53122 is UP and HEALTHY (Attempt $i)."
            exit 0
        }
    } catch {
        # Continue waiting
    }
    Write-Host -NoNewline "."
}

Write-Error "[Service Policy] TIMEOUT: Server 53122 failed to become healthy after 8 seconds."
Write-Host "Check logs at $LogFile"
exit 1
