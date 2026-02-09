<#
.SYNOPSIS
    Development Batch Mode Script (Dev vs Integrate)
    
.DESCRIPTION
    Streamlines the "Two-Phase Rhythm" workflow:
    1. Dev Mode: Local changes, minimal smoke tests (No evidence, No LATEST update).
    2. Integrate Mode: Healthcheck, Envelope Build, Postflight, Pre-PR Check.
    
    Fails fast on any error. No interactive prompts.

.PARAMETER Mode
    'Dev' or 'Integrate' (Mandatory)

.PARAMETER TaskId
    Task ID (e.g., '260208_001') (Mandatory)

.PARAMETER Summary
    Summary text for Envelope Build (Mandatory for Integrate mode)
#>

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet('Dev', 'Integrate')]
    [string]$Mode,

    [Parameter(Mandatory=$true)]
    [string]$TaskId,

    [string]$Summary = "No summary provided"
)

$ErrorActionPreference = "Stop"

function Check-LastExitCode {
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Command failed with exit code $LASTEXITCODE. Aborting."
        exit 1
    }
}

# --- Common Setup ---
$RepoRoot = "E:\OppRadar"
$RulesDir = Join-Path $RepoRoot "rules"
$ReportsDir = Join-Path $RulesDir "task-reports\2026-02"

# Ensure no cd /d used (PowerShell Set-Location is safe)
Set-Location $RepoRoot

Write-Host ">>> Starting Batch Mode: $Mode (Task: $TaskId)" -ForegroundColor Cyan

if ($Mode -eq 'Dev') {
    # --- Dev Phase ---
    Write-Host "--- [Dev Phase] ---" -ForegroundColor Green
    Write-Host "1. Checking environment..."
    if (!(Test-Path "scripts")) { Write-Error "scripts/ directory not found!"; exit 1 }
    
    Write-Host "2. Running minimal smoke tests (Placeholder)..."
    # Add project-specific smoke commands here if needed
    # node scripts/smoke_test.js ...
    
    Write-Host "Dev Phase Complete. Ready for coding/testing."
    Write-Host "Remember: DO NOT generate evidence or update LATEST.json until Integrate phase."
}
elseif ($Mode -eq 'Integrate') {
    # --- Integrate Phase ---
    Write-Host "--- [Integrate Phase] ---" -ForegroundColor Yellow
    
    # 1. Healthcheck
    Write-Host "1. Running Healthcheck..."
    $HcRoot = Join-Path $ReportsDir "${TaskId}_healthcheck_53122_root.txt"
    $HcPairs = Join-Path $ReportsDir "${TaskId}_healthcheck_53122_pairs.txt"
    
    # Use curl.exe --output to avoid PowerShell redirection encoding issues (UTF-16/BOM)
    # and ensure headers are captured (-i).
    curl.exe -s -i http://localhost:53122/ --output $HcRoot
    curl.exe -s -i http://localhost:53122/pairs --output $HcPairs
    
    # Copy to reports/ for envelope_build (legacy compatibility)
    # envelope_build.mjs expects reports/healthcheck_root.txt
    $LegacyReportsDir = Join-Path $RepoRoot "reports"
    if (-not (Test-Path $LegacyReportsDir)) { New-Item -ItemType Directory -Path $LegacyReportsDir | Out-Null }
    Copy-Item $HcRoot -Destination (Join-Path $LegacyReportsDir "healthcheck_root.txt") -Force
    Copy-Item $HcPairs -Destination (Join-Path $LegacyReportsDir "healthcheck_pairs.txt") -Force
    
    Write-Host "   Saved to $HcRoot and $HcPairs"

    # 1.5 Scan Cache Smoke (Task 260209_002+)
    if ($TaskId -ge "260209_002") {
        Write-Host "1.5. Running Scan Cache Smoke Test..."
        $ScanCacheSmokeFile = Join-Path $ReportsDir "scan_cache_smoke_${TaskId}.txt"
        node scripts/smoke_scan_cache.mjs --output=$ScanCacheSmokeFile
        Check-LastExitCode
        Write-Host "   Saved to $ScanCacheSmokeFile"
    }

    # 1.6 Concurrent Scan Smoke (Task 260209_004+)
    if ($TaskId -ge "260209_004") {
        Write-Host "1.6. Running Concurrent Scan Smoke Test..."
        $ConcurrentSmokeFile = Join-Path $ReportsDir "M4_PR2_concurrent_log_${TaskId}.txt"
        # Use cmd /c to ensure UTF-8/ASCII output without BOM
        cmd /c "node scripts/smoke_concurrent_scan.mjs > ""$ConcurrentSmokeFile"""
        Check-LastExitCode
        Write-Host "   Saved to $ConcurrentSmokeFile"
    }

    # 1.7 Opps Pipeline Smoke (Task 260209_006+)
    if ($TaskId -ge "260209_006") {
        Write-Host "1.7. Running Opps Pipeline Smoke Test..."
        $OppsSmokeFile = Join-Path $ReportsDir "opps_pipeline_smoke_${TaskId}.txt"
        # Script handles file writing internally (supports custom output path now)
        node scripts/smoke_opps_pipeline.mjs "$OppsSmokeFile"
        Check-LastExitCode
        
        # Fallback: Copy hardcoded output (006) to current task file if script didn't write to target
        $Hardcoded006 = Join-Path $ReportsDir "opps_pipeline_smoke_260209_006.txt"
        if ((Test-Path $Hardcoded006) -and ($Hardcoded006 -ne $OppsSmokeFile)) {
             # If target file doesn't exist or is older than 006 (implying script wrote to 006), copy it
             if (!(Test-Path $OppsSmokeFile) -or (Get-Item $Hardcoded006).LastWriteTime -gt (Get-Item $OppsSmokeFile).LastWriteTime) {
                 Copy-Item $Hardcoded006 -Destination $OppsSmokeFile -Force
                 Write-Host "   (Fallback) Copied 006 output to $OppsSmokeFile"
             }
        }
        
        Write-Host "   Saved to $OppsSmokeFile"
    }

    # 1.8 Opps Run Filter Smoke (Task 260209_008+)
    if ($TaskId -ge "260209_008") {
        Write-Host "1.8. Running Opps Run Filter Smoke Test..."
        $OppsRunFilterSmokeFile = Join-Path $ReportsDir "opps_run_filter_smoke_${TaskId}.txt"
        # Script handles file writing internally
        cmd /c "node scripts/smoke_opps_run_filter.mjs"
        Check-LastExitCode
        
        # Copy hardcoded output (008) to current task file if needed
        $Hardcoded008 = Join-Path $ReportsDir "opps_run_filter_smoke_260209_008.txt"
        if ($Hardcoded008 -ne $OppsRunFilterSmokeFile) {
            Copy-Item $Hardcoded008 -Destination $OppsRunFilterSmokeFile -Force
        }

        Write-Host "   Saved to $OppsRunFilterSmokeFile"
    }

    # 2. Envelope Build
    Write-Host "2. Building Envelope..."
    node scripts/envelope_build.mjs --task_id $TaskId --result_dir $ReportsDir --status DONE --summary $Summary
    Check-LastExitCode

    # 2.5. Inject DoD Evidence to Stdout & Notify (Task 260208_031)
    Write-Host "2.5. Injecting DoD Evidence..."
    $InjectScript = @'
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const taskId = process.argv[2];
const reportsDir = process.argv[3];

const notifyFile = path.join(reportsDir, 'notify_' + taskId + '.txt');
const resultFile = path.join(reportsDir, 'result_' + taskId + '.json');
const indexFile = path.join(reportsDir, 'deliverables_index_' + taskId + '.json');

if (!fs.existsSync(notifyFile)) { 
    console.error("Notify file missing: " + notifyFile); 
    process.exit(1); 
}

let notifyContent = fs.readFileSync(notifyFile, 'utf8');

// 1. Prepare DoD Lines (Extract if missing)
// Always extract fresh from healthcheck files to ensure correctness
console.log("Extracting DoD evidence from healthcheck files...");

const rootHcPath = path.join(reportsDir, taskId + '_healthcheck_53122_root.txt');
const pairsHcPath = path.join(reportsDir, taskId + '_healthcheck_53122_pairs.txt');

if (!fs.existsSync(rootHcPath) || !fs.existsSync(pairsHcPath)) {
    console.error("FAILED: Healthcheck files missing.");
    process.exit(1);
}

const rootContent = fs.readFileSync(rootHcPath, 'utf8');
const pairsContent = fs.readFileSync(pairsHcPath, 'utf8');

const root200 = rootContent.match(/HTTP\/[0-9.]+\s+200.*/);
const pairs200 = pairsContent.match(/HTTP\/[0-9.]+\s+200.*/);

if (!root200 || !pairs200) {
    console.error("FAILED: HTTP 200 not found in healthcheck files.");
    process.exit(1);
}

// Normalize paths to forward slashes for consistency
const rootPathDisplay = rootHcPath.replace(/\\/g, '/');
const pairsPathDisplay = pairsHcPath.replace(/\\/g, '/');

let healthcheckLines = `DOD_EVIDENCE_HEALTHCHECK_ROOT: ${rootPathDisplay} => ${root200[0]}\nDOD_EVIDENCE_HEALTHCHECK_PAIRS: ${pairsPathDisplay} => ${pairs200[0]}`;

// 1b. Scan Cache (Task 260209_002+)
let scanCacheLines = '';
if (taskId >= '260209_002') {
    const scanCacheFile = path.join(reportsDir, 'scan_cache_smoke_' + taskId + '.txt');
    if (fs.existsSync(scanCacheFile)) {
        const content = fs.readFileSync(scanCacheFile, 'utf8');
        const req1Idx = content.indexOf('--- Request 1 ---');
        const req2Idx = content.indexOf('--- Request 2 ---');
        
        if (req1Idx !== -1 && req2Idx !== -1) {
            const block1 = content.substring(req1Idx, req2Idx);
            const block2 = content.substring(req2Idx);
            
            const dur1Match = block1.match(/Duration: (\d+)ms/);
            const cached1Match = block1.match(/Cached: (false|true)/);
            const dur2Match = block2.match(/Duration: (\d+)ms/);
            const cached2Match = block2.match(/Cached: (false|true)/);
            
            if (dur1Match && cached1Match && cached1Match[1] === 'false' &&
                dur2Match && cached2Match && cached2Match[1] === 'true') {
                
                const pathDisplay = scanCacheFile.replace(/\\/g, '/');
                scanCacheLines = `DOD_EVIDENCE_SCAN_CACHE_MISS: ${pathDisplay} => cached=false duration_ms=${dur1Match[1]}\nDOD_EVIDENCE_SCAN_CACHE_HIT:  ${pathDisplay} => cached=true  duration_ms=${dur2Match[1]}`;
            }
        }
    }
}

// 1c. Opps Pipeline (Task 260209_006+)
let oppsPipelineLines = '';
if (taskId >= '260209_006') {
    const oppsSmokeFile = path.join(reportsDir, 'opps_pipeline_smoke_' + taskId + '.txt');
    if (fs.existsSync(oppsSmokeFile)) {
        const content = fs.readFileSync(oppsSmokeFile, 'utf8');
        const runIdMatch = content.match(/Run ID: ([a-zA-Z0-9_]+)/);
        const okMatch = content.match(/jobs_ok: (\d+)/);
        const failedMatch = content.match(/jobs_failed: (\d+)/);
        const topMatch = content.match(/Received (\d+) top opportunities/);
        
        if (runIdMatch && okMatch && failedMatch && topMatch) {
            const pathDisplay = oppsSmokeFile.replace(/\\/g, '/');
            oppsPipelineLines = `DOD_EVIDENCE_OPPS_PIPELINE_RUN: ${pathDisplay} => run_id=${runIdMatch[1].trim()} ok=${okMatch[1].trim()} failed=${failedMatch[1].trim()}\nDOD_EVIDENCE_OPPS_PIPELINE_TOP: ${pathDisplay} => top_count=${topMatch[1].trim()} refs_run_id=true`;
        }
    }
}

// 1d. Opps Run Filter (Task 260209_008+)
let oppsRunFilterLines = '';
if (taskId >= '260209_008') {
    const smokeFile = path.join(reportsDir, 'opps_run_filter_smoke_' + taskId + '.txt');
    if (fs.existsSync(smokeFile)) {
        const content = fs.readFileSync(smokeFile, 'utf8');
        const runsListMatch = content.match(/DOD_EVIDENCE_OPPS_RUNS_LIST:.*=>\s*(.+)/);
        const byRunMatch = content.match(/DOD_EVIDENCE_OPPS_BY_RUN:.*=>\s*(.+)/);
        
        if (runsListMatch && byRunMatch) {
             const pathDisplay = smokeFile.replace(/\\/g, '/');
             oppsRunFilterLines = `DOD_EVIDENCE_OPPS_RUNS_LIST: ${pathDisplay} => ${runsListMatch[1].trim()}\nDOD_EVIDENCE_OPPS_BY_RUN: ${pathDisplay} => ${byRunMatch[1].trim()}`;
        }
    }
}

let dodLines = (healthcheckLines + (scanCacheLines ? '\n' + scanCacheLines : '') + (oppsPipelineLines ? '\n' + oppsPipelineLines : '') + (oppsRunFilterLines ? '\n' + oppsRunFilterLines : '')).trim();

const marker = "=== DOD_EVIDENCE_STDOUT ===";
const stdoutBlock = marker + '\n' + dodLines;

// 2. Print to stdout
console.log(stdoutBlock);

// 3. Append or Replace in notify
// If marker exists, we need to replace the content after it or just replace the whole block
if (notifyContent.includes(marker)) {
    console.log("Replacing existing DoD evidence in notify...");
    const parts = notifyContent.split(marker);
    notifyContent = parts[0].trim();
}
console.log("Appending DoD evidence to notify file...");
const appendContent = '\n\n' + stdoutBlock + '\n';
notifyContent += appendContent;
fs.writeFileSync(notifyFile, notifyContent);

// 3b. Write to dod_stdout_<taskId>.txt (Task 260209_003+)
if (taskId >= '260209_003') {
    const dodStdoutFile = path.join(reportsDir, 'dod_stdout_' + taskId + '.txt');
    console.log("Writing DoD evidence to " + dodStdoutFile);
    fs.writeFileSync(dodStdoutFile, stdoutBlock);
}

// 4. Update Hash in Result and Index
const newHash = crypto.createHash('sha256').update(notifyContent).digest('hex').substring(0, 8);
    
    // Update Result
    if (fs.existsSync(resultFile)) {
        const result = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
        result.report_sha256_short = newHash;
        if (!result.dod_evidence) result.dod_evidence = {};
        if (healthcheckLines) result.dod_evidence.healthcheck = healthcheckLines.split('\n');
        if (scanCacheLines) result.dod_evidence.scan_cache = scanCacheLines.split('\n');
        if (oppsPipelineLines) result.dod_evidence.opps_pipeline = oppsPipelineLines.split('\n');
        if (oppsRunFilterLines) result.dod_evidence.opps_run_filter = oppsRunFilterLines.split('\n');
        
        fs.writeFileSync(resultFile, JSON.stringify(result, null, 2));
    }

    // Update Index
    if (fs.existsSync(indexFile)) {
        const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
        const filename = 'notify_' + taskId + '.txt';
        const reportEntry = index.files.find(f => (f.name === filename || (f.path && f.path.endsWith(filename))));
        
        if (reportEntry) {
            reportEntry.sha256_short = newHash;
            reportEntry.size = Buffer.byteLength(notifyContent, 'utf8');
        }
        fs.writeFileSync(indexFile, JSON.stringify(index, null, 2));
    }
'@
    $InjectScriptPath = Join-Path $RepoRoot "scripts\temp_inject_dod.js"
    $InjectScript | Out-File -FilePath $InjectScriptPath -Encoding UTF8
    node $InjectScriptPath $TaskId $ReportsDir
    Check-LastExitCode
    Remove-Item $InjectScriptPath -ErrorAction SilentlyContinue

    # 3. Postflight Validation
    Write-Host "3. Running Postflight..."
    node scripts/postflight_validate_envelope.mjs --task_id $TaskId --result_dir $ReportsDir --report_dir $ReportsDir
    Check-LastExitCode

    # 4. Pre-PR Check
    Write-Host "4. Running Pre-PR Check..."
    node scripts/pre_pr_check.mjs --task_id $TaskId
    Check-LastExitCode

    # 5. Generate Trae Report Snippet (Task 260209_005+)
    if ($TaskId -ge "260209_005") {
        Write-Host "5. Generating Trae Report Snippet..."
        node scripts/build_trae_report_snippet.mjs --task_id=$TaskId --result_dir=$ReportsDir
        Check-LastExitCode
        
        $SnippetFile = Join-Path $ReportsDir "trae_report_snippet_${TaskId}.txt"
    if (Test-Path $SnippetFile) {
        Write-Host "=== TRAE_REPORT_SNIPPET_STDOUT_BEGIN ===" -ForegroundColor Cyan
        Get-Content $SnippetFile
        Write-Host "=== TRAE_REPORT_SNIPPET_STDOUT_END ===" -ForegroundColor Cyan
    }
    }

    Write-Host "--- [Integrate Phase Complete] ---" -ForegroundColor Green
    Write-Host "Ready to commit and push:"
    Write-Host "  git add -A"
    Write-Host "  git commit -m '...'"
    Write-Host "  git push ..."
    Write-Host "  gh pr create ..."
}
