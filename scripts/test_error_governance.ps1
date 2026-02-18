param(
    [string]$TaskId = "TEST_GOV_TRIGGER"
)

$RepoRoot = (git rev-parse --show-toplevel).Trim()
$GovScript = "$RepoRoot\scripts\error_governance.mjs"
$GovDir = "$RepoRoot\rules\task-reports\governance-backlog"

# Clean up previous test artifacts
$Today = (Get-Date).ToString("yyyyMMdd")
$GovFile = "$GovDir\GOV_${Today}_TEST_ERROR_CLASS.md"
if (Test-Path $GovFile) { Remove-Item $GovFile }

Write-Host "Testing 3-Strike Trigger..."

# 1. Trigger 3 times
for ($i=1; $i -le 3; $i++) {
    Write-Host "  Triggering error $i..."
    node $GovScript --task_id "${TaskId}_$i" --mode "Dev" --step "TestStep" --error_class "TEST_ERROR_CLASS" --evidence_dir "test_dir"
}

# 2. Verify File Creation
if (Test-Path $GovFile) {
    Write-Host "PASS: Governance file created: $GovFile" -ForegroundColor Green
    Get-Content $GovFile | Select-Object -First 20
} else {
    Write-Host "FAIL: Governance file NOT created." -ForegroundColor Red
    exit 1
}

# 3. Verify Idempotency
Write-Host "Testing Idempotency (4th trigger)..."
node $GovScript --task_id "${TaskId}_4" --mode "Dev" --step "TestStep" --error_class "TEST_ERROR_CLASS" --evidence_dir "test_dir"

# Check file modification time or rely on script output "already exists"
# Since we can't easily capture node output in this simple script without redirection, 
# we assume the script logic is correct if file exists.
# But we can check if file content has duplicated sections.
$Content = Get-Content $GovFile -Raw
$Matches = [regex]::Matches($Content, "Trigger Condition")
if ($Matches.Count -eq 1) {
    Write-Host "PASS: Idempotency verified (File content not duplicated)." -ForegroundColor Green
} else {
    Write-Host "FAIL: Idempotency failed (Content duplicated or missing)." -ForegroundColor Red
    exit 1
}

Write-Host "Test Complete."
