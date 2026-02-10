param(
    [Parameter(Mandatory=$true)]
    [string]$Message
)

$ErrorActionPreference = "Stop"

Write-Host "Running Safe Commit..."

# 1. Git Add
Write-Host "1. Adding changes..."
git add -A
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# 2. Check Staged
$Staged = git diff --name-only --cached
if (-not $Staged) {
    Write-Host "Nothing to commit."
    exit 1
}

# 3. Git Commit
Write-Host "2. Committing..."
git commit -m "$Message"
exit $LASTEXITCODE
