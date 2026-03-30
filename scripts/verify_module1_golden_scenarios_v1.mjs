import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260330_002';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: 'http://localhost:53168',
  defaultOutputSuffix: 'module1_golden_scenarios_v1',
  defaultSampleName: 'module1_golden_scenarios_v1'
});

const readJsonSafe = (filePath) => {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
};

const runScript = ({ script, sample, suffix }, taskId, reportsDir) => {
  const result = spawnSync(process.execPath, [`scripts/${script}`, `--task_id=${taskId}`, `--sample=${sample}`], {
    cwd: REPO_ROOT,
    encoding: 'utf8'
  });
  const evidenceFile = path.join(reportsDir, `${taskId}_${suffix}.json`);
  const parsed = readJsonSafe(evidenceFile);
  return {
    pass: result.status === 0 && parsed?.pass !== false,
    evidence_file: parsed?.evidence_file || evidenceFile,
    parsed
  };
};

const boolAt = (value, key) => value?.summary?.checks?.[key] === true || value?.result?.[key] === true;

const scenarioFrom007A = (parsed) => {
  const pass = boolAt(parsed, '007-C_post_fix_new_window_has_4_entries_and_no_tp')
    && boolAt(parsed, '007-F_non_regression_wait_next_window_after_start')
    && boolAt(parsed, '007-G_non_regression_tp1_no_take_profit_rows');
  return {
    scenario_id: 'S1_non_symmetric_tp1_wait_next_window',
    conclusion: pass ? 'PASS' : 'FAIL',
    pass,
    first_break_layer: pass ? null : (parsed?.first_break_layer || '未锁定'),
    evidence_index: {
      source_script: 'truth_audit_window_chain_owner_scenario_260329_007',
      evidence_file: parsed?.evidence_file || null,
      required_checks: [
        '007-C_post_fix_new_window_has_4_entries_and_no_tp',
        '007-F_non_regression_wait_next_window_after_start',
        '007-G_non_regression_tp1_no_take_profit_rows'
      ]
    }
  };
};

const scenarioFrom001 = (parsed) => {
  const pass = boolAt(parsed, '001-C_post_fix_same_tick_prob_and_order_status_are_consistent')
    && boolAt(parsed, '001-D_post_fix_min_regression_script_for_owner_scene_passed');
  return {
    scenario_id: 'S2_owner_screenshot_tick_consistency',
    conclusion: pass ? 'PASS' : 'FAIL',
    pass,
    first_break_layer: pass ? null : (parsed?.first_break_layer || '未锁定'),
    evidence_index: {
      source_script: 'truth_audit_order_prob_consistency_260330_001',
      evidence_file: parsed?.evidence_file || null,
      required_checks: [
        '001-C_post_fix_same_tick_prob_and_order_status_are_consistent',
        '001-D_post_fix_min_regression_script_for_owner_scene_passed'
      ]
    }
  };
};

const scenarioFrom008 = (parsed) => {
  const pass = boolAt(parsed, '008-C_post_fix_runtime_no60_yes120_directional_cancel')
    && boolAt(parsed, '008-D_post_fix_reason_intent_separates_up_down_cancel');
  return {
    scenario_id: 'S3_directional_cancel_priority',
    conclusion: pass ? 'PASS' : 'FAIL',
    pass,
    first_break_layer: pass ? null : (parsed?.first_break_layer || '未锁定'),
    evidence_index: {
      source_script: 'truth_audit_directional_cancel_priority_260329_008',
      evidence_file: parsed?.evidence_file || null,
      required_checks: [
        '008-C_post_fix_runtime_no60_yes120_directional_cancel',
        '008-D_post_fix_reason_intent_separates_up_down_cancel'
      ]
    }
  };
};

const scenarioFrom007B = (parsed) => {
  const pass = boolAt(parsed, '007-D_post_fix_next_window_switches_and_shows_only_new_window');
  return {
    scenario_id: 'S4_window_switch_no_old_window_mix',
    conclusion: pass ? 'PASS' : 'FAIL',
    pass,
    first_break_layer: pass ? null : (parsed?.first_break_layer || '未锁定'),
    evidence_index: {
      source_script: 'truth_audit_window_chain_owner_scenario_260329_007',
      evidence_file: parsed?.evidence_file || null,
      required_checks: [
        '007-D_post_fix_next_window_switches_and_shows_only_new_window'
      ]
    }
  };
};

const main = () => {
  const args = parseArgs();
  const reportsDir = path.dirname(args.output);
  const source007 = runScript({
    script: 'truth_audit_window_chain_owner_scenario_260329_007.mjs',
    sample: 'owner_manual_window_chain_v1',
    suffix: 'truth_audit_window_chain_owner_scenario'
  }, args.taskId, reportsDir);
  const source001 = runScript({
    script: 'truth_audit_order_prob_consistency_260330_001.mjs',
    sample: 'owner_screenshot_consistency_v1',
    suffix: 'truth_audit_order_prob_consistency'
  }, args.taskId, reportsDir);
  const source008 = runScript({
    script: 'truth_audit_directional_cancel_priority_260329_008.mjs',
    sample: 'directional_cancel_priority_v1',
    suffix: 'truth_audit_directional_cancel_priority'
  }, args.taskId, reportsDir);

  const scenarios = [
    scenarioFrom007A(source007.parsed),
    scenarioFrom001(source001.parsed),
    scenarioFrom008(source008.parsed),
    scenarioFrom007B(source007.parsed)
  ];
  const scenarioTotal = scenarios.length;
  const scenarioPass = scenarios.filter((item) => item.pass).length;
  const scenarioFail = scenarioTotal - scenarioPass;
  const failedScenarios = scenarios.filter((item) => !item.pass).map((item) => ({
    scenario_id: item.scenario_id,
    first_break_layer: item.first_break_layer,
    evidence_index: item.evidence_index
  }));
  const pass = scenarioFail === 0;
  const firstBreakLayer = pass
    ? null
    : (failedScenarios[0]?.first_break_layer || '未锁定');
  const checks = {
    'G1_scenario1_non_symmetric_tp1_wait_next_window': scenarios[0].pass,
    'G2_scenario2_owner_screenshot_tick_consistency': scenarios[1].pass,
    'G3_scenario3_directional_cancel_priority': scenarios[2].pass,
    'G4_scenario4_window_switch_no_old_window_mix': scenarios[3].pass
  };

  const standard = buildStandardResult({
    scriptName: 'verify_module1_golden_scenarios_v1',
    taskId: args.taskId,
    sampleName: args.sampleName,
    pass,
    message: pass ? '模块1黄金场景回归 v1 通过' : '模块1黄金场景回归 v1 存在失败场景',
    firstBreakLayer,
    evidenceFile: args.output,
    summary: {
      conclusion: pass ? 'A：模块1黄金场景回归包 v1 全通过' : 'C：模块1黄金场景回归包 v1 有失败',
      total_checks: 4,
      pass_checks: Object.values(checks).filter(Boolean).length,
      fail_checks: Object.values(checks).filter((item) => !item).length,
      checks
    },
    rawExcerpt: {
      scenario_total: scenarioTotal,
      scenario_pass: scenarioPass,
      scenario_fail: scenarioFail,
      failed_scenarios: failedScenarios
    }
  });

  const output = {
    ...standard,
    task_id: args.taskId,
    scenario_total: scenarioTotal,
    scenario_pass: scenarioPass,
    scenario_fail: scenarioFail,
    failed_scenarios: failedScenarios,
    scenarios,
    evidence_index: {
      source_007: source007.evidence_file,
      source_001: source001.evidence_file,
      source_008: source008.evidence_file
    }
  };

  ensureDir(args.output);
  fs.writeFileSync(args.output, JSON.stringify(output, null, 2));
  const logPath = writeStandardLog(args.output, standard);
  console.log(`VERIFY_OUTPUT=${args.output}`);
  console.log(`VERIFY_LOG=${logPath}`);
  console.log(JSON.stringify({
    pass,
    scenario_total: scenarioTotal,
    scenario_pass: scenarioPass,
    scenario_fail: scenarioFail
  }));
  if (!pass) process.exitCode = 1;
};

main();
