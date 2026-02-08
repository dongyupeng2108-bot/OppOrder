$base = "http://localhost:53122"
Write-Host "Checking $base..."

try {
    $r1 = Invoke-WebRequest -Uri "$base/" -Method Get -UseBasicParsing
    Write-Host "/ -> $($r1.StatusCode)"
} catch {
    Write-Host "/ -> ERROR: $($_.Exception.Message)"
}

try {
    $r2 = Invoke-WebRequest -Uri "$base/pairs" -Method Get -UseBasicParsing
    Write-Host "/pairs -> $($r2.StatusCode)"
} catch {
    Write-Host "/pairs -> ERROR: $($_.Exception.Message)"
}
