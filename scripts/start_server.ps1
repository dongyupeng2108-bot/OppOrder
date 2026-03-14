while ($true) {
  Write-Host "[AutoRestart] 启动服务..."
  node E:\OppRadar\strategies\crypto_binary\server.mjs
  Write-Host "[AutoRestart] 服务退出，3秒后重启..."
  Start-Sleep -Seconds 3
}