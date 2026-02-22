import { classifyError } from './error_tiering.mjs';

const cases = [
    { error_class: 'CI_PARITY_MERGEBASE_MISMATCH', expect: 'SELF_HEALABLE' },
    { error_class: 'ERROR_STATS_INDEX_MISSING', expect: 'SELF_HEALABLE' },
    { error_class: 'ERROR_STATS_RECORD_MISSING', expect: 'SELF_HEALABLE' },
    { error_class: 'AUTO_PR_EVIDENCE_MISSING', expect: 'SELF_HEALABLE' },
    { error_class: 'PREVIEW_ENCODING', expect: 'SELF_HEALABLE' },
    { error_class: 'EVIDENCE_WORM_BYPASS', expect: 'NON_SELF_HEALABLE' },
    { error_class: 'OPEN_PR_GUARD_BLOCKED', expect: 'NON_SELF_HEALABLE' },
    { error_class: 'AUTO_PR_CI_FAIL', expect: 'NON_SELF_HEALABLE' },
    { error_class: 'AUTO_FIX_MAX_EXCEEDED', expect: 'NON_SELF_HEALABLE' },
    { error_class: 'LOOP_DETECTED', expect: 'NON_SELF_HEALABLE' },
    { error_class: 'UNKNOWN_ERROR', expect: 'NON_SELF_HEALABLE' }
];

let failed = 0;
cases.forEach((c, idx) => {
    const result = classifyError({ error_class: c.error_class, fail_reason: c.fail_reason });
    const ok = result.tier === c.expect;
    if (!ok) failed += 1;
    console.log(`case_${idx + 1}: ${c.error_class} => ${result.tier} (${ok ? 'OK' : 'FAIL'})`);
});

if (failed > 0) {
    console.error(`failed_cases=${failed}`);
    process.exit(1);
}
console.log('all_cases_passed=1');
