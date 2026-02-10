$ErrorActionPreference = "Stop"

Write-Host "Running Safe Push..."
$CurrentBranch = git rev-parse --abbrev-ref HEAD
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Pushing to origin/$CurrentBranch..."
git push origin $CurrentBranch
exit $LASTEXITCODE
