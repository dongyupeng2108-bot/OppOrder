// --- 1.7 Workspace Healer Check (Task 260216_002) ---
// Hard Guard: For task_id >= 260216_002, workspace_healer_${task_id}.json must exist and be clean.
if (task_id >= '260216_002') {
    console.log('[Gate Light] Checking Workspace Healer Evidence...');
    let healerFile = path.join(result_dir, `workspace_healer_${task_id}.json`);

    let fallbackFound = true;

    if (!fs.existsSync(healerFile)) {
        fallbackFound = false;
        const match = task_id.match(/^(\d{2})(\d{2})\d{2}_/);
        if (match) {
            const year = '20' + match[1];
            const month = match[2];
            const fallbackFile = path.join('rules', 'task-reports', `${year}-${month}`, `workspace_healer_${task_id}.json`);
            if (fs.existsSync(fallbackFile)) {
                console.warn(`[Gate Light] WARNING: Workspace Healer evidence missing in runs (${healerFile}).`);
                console.warn(`[Gate Light] Fallback used: ${fallbackFile}`);
                healerFile = fallbackFile;
                fallbackFound = true;
            }
        }
    }

    if (!fallbackFound) {
        console.warn(`[Gate Light] WARNING: Workspace Healer evidence missing: ${healerFile}. Skipping check.`);
    } else {
        try {
            const healerData = JSON.parse(fs.readFileSync(healerFile, 'utf8'));

            if (healerData.result !== 'PASS') {
                console.error(`[Gate Light] FAILED: Workspace Healer result is ${healerData.result}`);
                console.error(`  Reason: ${healerData.reason || 'Unknown'}`);
                process.exit(1);
            }

            const tracked = healerData.after?.tracked_changed_count ?? -1;
            const untracked = healerData.after?.untracked_count ?? -1;

            if (tracked !== 0 || untracked !== 0) {
                console.error(`[Gate Light] FAILED: Workspace Healer detected dirty state AFTER clean.`);
                console.error(`  Tracked Changed: ${tracked} (Expected: 0)`);
                console.error(`  Untracked: ${untracked} (Expected: 0)`);
                process.exit(1);
            }

            console.log('[Gate Light] Workspace Healer verified (Clean Environment).');
        } catch (e) {
            console.error(`[Gate Light] FAILED: Invalid Workspace Healer JSON: ${e.message}`);
            process.exit(1);
        }
    }
}