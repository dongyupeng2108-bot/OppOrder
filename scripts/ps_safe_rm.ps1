param (
    [Parameter(Mandatory=$true)]
    [string]$Path
)

# Convert to absolute path
$AbsPath = Resolve-Path $Path -ErrorAction SilentlyContinue
if (-not $AbsPath) {
    $AbsPath = $Path # Try as-is if Resolve-Path fails
}

if (-not (Test-Path $Path)) {
    Write-Host "Path not found: $Path" -ForegroundColor Yellow
    exit 0
}

Write-Host "Removing (via Node): $Path" -ForegroundColor Cyan

# Use ops_delete.mjs for safe, cross-platform deletion
# Pass --recurse to handle directories, --force to suppress errors if missing (though we checked existence)
node scripts/ops_delete.mjs "$Path" --force --recurse

if ($LASTEXITCODE -ne 0) {
    Write-Error "CRITICAL: Could not remove $Path using ops_delete.mjs"
    exit 1
}

Write-Host "Success" -ForegroundColor Green
