$ErrorActionPreference = "Stop"

function Check-Url {
    param ($Url)
    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -Method Head
        if ($response.StatusCode -eq 200) {
            return "$($Url.Replace('http://localhost:53122', '')) -> 200"
        }
    } catch {
        Write-Host "Error checking $Url : $_"
    }
    return "$($Url.Replace('http://localhost:53122', '')) -> ERROR"
}

$root = Check-Url "http://localhost:53122/"
$pairs = Check-Url "http://localhost:53122/pairs"

# Ensure reports directory exists
if (-not (Test-Path "reports")) {
    New-Item -ItemType Directory -Force -Path "reports" | Out-Null
}

New-Item -Path "reports/healthcheck_root.txt" -Value $root -Force
New-Item -Path "reports/healthcheck_pairs.txt" -Value $pairs -Force

Write-Host "Healthcheck complete."
Write-Host $root
Write-Host $pairs
