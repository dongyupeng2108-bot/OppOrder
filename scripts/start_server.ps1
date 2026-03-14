while ($true) {
    Write-Host "[AutoRestart] 检查端口 53123..."
    $pid53123 = (netstat -ano | findstr "LISTENING" | findstr ":53123 ") -replace '.*\s+(\d+)$','$1' | Select-Object -First 1
    if ($pid53123) {
        Write-Host "[AutoRestart] 清理旧进程 PID=$pid53123"
        taskkill /F /PID $pid53123 2>$null | Out-Null
        Start-Sleep -Seconds 1
    }
    Write-Host "[AutoRestart] 启动服务..."
    node E:\OppRadar\strategies\crypto_binary\server.mjs
    Write-Host "[AutoRestart] 服务退出，3秒后重启..."
    Start-Sleep -Seconds 3
}
