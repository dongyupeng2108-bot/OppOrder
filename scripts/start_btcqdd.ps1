# BTCQDD 守护进程启动脚本
# 服务退出后自动重启，按 Ctrl+C 停止
Set-Location $PSScriptRoot\..
while ($true) {
    Write-Host "[Guardian] Starting BTCQDD server..."
    node strategies/crypto_binary/server.mjs
    $code = $LASTEXITCODE
    if ($code -eq 0) {
        Write-Host "[Guardian] Server restarting in 2 seconds..."
        Start-Sleep -Seconds 2
    } else {
        Write-Host "[Guardian] Server crashed (exit $code). Restarting in 3 seconds..."
        Start-Sleep -Seconds 3
    }
}