param (
    [Parameter(Mandatory=$true)]
    [string]$Path
)

# Convert to absolute path
$AbsPath = Resolve-Path $Path -ErrorAction SilentlyContinue
if (-not $AbsPath) {
    $AbsPath = $Path # Try as-is if Resolve-Path fails (e.g. if it doesn't exist, though we should check existence)
}

if (-not (Test-Path $Path)) {
    Write-Host "Path not found: $Path" -ForegroundColor Yellow
    exit 0
}

Write-Host "Removing: $Path" -ForegroundColor Cyan

try {
    # Try PowerShell Remove-Item with -Recurse -Force -Confirm:$false
    Remove-Item -Path $Path -Recurse -Force -Confirm:$false -ErrorAction Stop
    Write-Host "Success (PowerShell)" -ForegroundColor Green
}
catch {
    Write-Host "PowerShell rm failed, falling back to cmd rmdir..." -ForegroundColor Yellow
    # Fallback to cmd rmdir
    try {
        if (Test-Path -Path $Path -PathType Container) {
             cmd /c "rmdir /s /q `"$Path`""
        } else {
             cmd /c "del /f /q `"$Path`""
        }
        
        if (Test-Path $Path) {
            throw "Failed to remove $Path even with cmd fallback"
        }
        Write-Host "Success (CMD Fallback)" -ForegroundColor Green
    }
    catch {
        Write-Error "CRITICAL: Could not remove $Path. Please check locks."
        exit 1
    }
}
