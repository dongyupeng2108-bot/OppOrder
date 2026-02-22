import fs from 'fs';
import { fileURLToPath } from 'url';

const args = process.argv.slice(2);
const getArg = (name) => {
    const flag = `--${name}`;
    const index = args.indexOf(flag);
    if (index !== -1 && index + 1 < args.length) return args[index + 1];
    const inline = args.find(a => a.startsWith(`${flag}=`));
    if (inline) return inline.split('=').slice(1).join('=');
    return null;
};

const norm = (v) => (v ?? '').toString().trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');

const SELF_HEALABLE = {
    CI_PARITY_MERGEBASE_MISMATCH: { tier: 'SELF_HEALABLE', recommended_action: 'AUTO_FIX' },
    ERROR_STATS_INDEX_MISSING: { tier: 'SELF_HEALABLE', recommended_action: 'AUTO_FIX' },
    ERROR_STATS_RECORD_MISSING: { tier: 'SELF_HEALABLE', recommended_action: 'AUTO_FIX' },
    AUTO_PR_EVIDENCE_MISSING: { tier: 'SELF_HEALABLE', recommended_action: 'AUTO_FIX' },
    LATEST_JSON_MISMATCH: { tier: 'SELF_HEALABLE', recommended_action: 'AUTO_FIX' },
    PREVIEW_ENCODING: { tier: 'SELF_HEALABLE', recommended_action: 'AUTO_FIX' }
};

const NON_SELF_HEALABLE = {
    EVIDENCE_WORM_BYPASS: { tier: 'NON_SELF_HEALABLE', recommended_action: 'ESCALATE' },
    OPEN_PR_GUARD_BLOCKED: { tier: 'NON_SELF_HEALABLE', recommended_action: 'ESCALATE' },
    WORKSPACE_DIRTY_TRACKED: { tier: 'NON_SELF_HEALABLE', recommended_action: 'ESCALATE' },
    STEP_TIMEOUT: { tier: 'NON_SELF_HEALABLE', recommended_action: 'ESCALATE' },
    SERVICE_HEALTHCHECK_FAIL: { tier: 'NON_SELF_HEALABLE', recommended_action: 'ESCALATE' },
    CMD_SYNTAX_BANNED: { tier: 'NON_SELF_HEALABLE', recommended_action: 'ESCALATE' },
    AUTO_PR_CI_FAIL: { tier: 'NON_SELF_HEALABLE', recommended_action: 'ESCALATE' },
    AUTO_PR_INFRA_FAIL: { tier: 'NON_SELF_HEALABLE', recommended_action: 'ESCALATE' },
    AUTO_PR_TIMEOUT: { tier: 'NON_SELF_HEALABLE', recommended_action: 'ESCALATE' },
    AUTO_PR_UNKNOWN_EXIT: { tier: 'NON_SELF_HEALABLE', recommended_action: 'ESCALATE' },
    AUTO_FIX_MAX_EXCEEDED: { tier: 'NON_SELF_HEALABLE', recommended_action: 'ESCALATE' },
    AUTO_FIX_FAILED: { tier: 'NON_SELF_HEALABLE', recommended_action: 'ESCALATE' },
    IMMUTABLE_INTEGRATE_LOCKED: { tier: 'NON_SELF_HEALABLE', recommended_action: 'ESCALATE' },
    FAIL_BUDGET_EXCEEDED_DEV: { tier: 'NON_SELF_HEALABLE', recommended_action: 'ESCALATE' },
    FAIL_BUDGET_EXCEEDED_INTEGRATE: { tier: 'NON_SELF_HEALABLE', recommended_action: 'ESCALATE' },
    PREASSEMBLE_PRECHECK_FAIL: { tier: 'NON_SELF_HEALABLE', recommended_action: 'ESCALATE' },
    PREASSEMBLE_GENERATOR_MISSING: { tier: 'NON_SELF_HEALABLE', recommended_action: 'ESCALATE' },
    PREASSEMBLE_MIN_SET_MISSING: { tier: 'NON_SELF_HEALABLE', recommended_action: 'ESCALATE' },
    PREVIEW_LOG_MISSING: { tier: 'NON_SELF_HEALABLE', recommended_action: 'ESCALATE' },
    TASK_ID_MISMATCH: { tier: 'NON_SELF_HEALABLE', recommended_action: 'ESCALATE' },
    LOOP_DETECTED: { tier: 'NON_SELF_HEALABLE', recommended_action: 'ESCALATE' },
    CONTRACT_SELF_CHECK_FAIL: { tier: 'NON_SELF_HEALABLE', recommended_action: 'ESCALATE' }
};

export const classifyError = (input = {}) => {
    const errorClassRaw = norm(input.error_class);
    const failReasonRaw = norm(input.fail_reason);
    const errorClass = errorClassRaw || 'UNKNOWN_ERROR';
    const failReason = failReasonRaw || '';
    let result = null;

    if (SELF_HEALABLE[errorClass]) result = SELF_HEALABLE[errorClass];
    if (!result && NON_SELF_HEALABLE[errorClass]) result = NON_SELF_HEALABLE[errorClass];
    if (!result && errorClass.startsWith('THREE_STRIKE_GOVERNANCE_MISSING_')) {
        result = { tier: 'NON_SELF_HEALABLE', recommended_action: 'ESCALATE' };
    }
    if (!result && (failReason === 'TASK_ID_MISMATCH' || failReason === 'TASK_ID_SUFFIX_LOOP')) {
        result = { tier: 'NON_SELF_HEALABLE', recommended_action: 'ESCALATE' };
    }
    if (!result && errorClass === 'NO_ERROR') {
        result = { tier: 'SELF_HEALABLE', recommended_action: 'NONE' };
    }
    if (!result) result = { tier: 'NON_SELF_HEALABLE', recommended_action: 'ESCALATE' };

    return {
        error_class: errorClass,
        fail_reason: failReason,
        tier: result.tier,
        recommended_action: result.recommended_action
    };
};

const runAsMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (runAsMain) {
    let input = {};
    const inputJson = getArg('input_json');
    const inputFile = getArg('input_file');
    if (inputJson) {
        try { input = JSON.parse(inputJson); } catch (e) { input = {}; }
    } else if (inputFile && fs.existsSync(inputFile)) {
        try { input = JSON.parse(fs.readFileSync(inputFile, 'utf8')); } catch (e) { input = {}; }
    } else {
        input = {
            error_class: getArg('error_class'),
            fail_reason: getArg('fail_reason')
        };
    }
    const result = classifyError(input);
    process.stdout.write(JSON.stringify(result));
}
