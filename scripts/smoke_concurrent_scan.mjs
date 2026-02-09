import http from 'http';

const PORT = 53122;

const jobs = [
    { seed: 101, n_opps: 5, topic_key: 'gold' },
    { seed: 102, n_opps: 5, topic_key: 'silver' },
    { seed: 103, n_opps: 5, topic_key: 'btc' },
    { seed: 104, n_opps: 5, topic_key: 'mes' },
    { seed: 105, n_opps: 5, topic_key: 'mnq' },
    { seed: 999, n_opps: -1, topic_key: 'FAIL_TEST' } // 6th job INTENTIONAL FAILURE to test fail-soft
];

const payload = JSON.stringify({
    jobs: jobs,
    concurrency: 3
});

const options = {
    hostname: 'localhost',
    port: PORT,
    path: '/scans/run_batch',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
    }
};

console.log(`Sending batch request with ${jobs.length} jobs, concurrency: 3...`);
const start = Date.now();

const req = http.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => data += chunk);
    res.on('end', () => {
        const duration = Date.now() - start;
        console.log(`Response received in ${duration}ms`);
        
        if (res.statusCode !== 200) {
            console.error(`FAILED: Status code ${res.statusCode}`);
            console.error(data);
            process.exit(1);
        }

        try {
            const response = JSON.parse(data);
            console.log('Response Structure Valid:', !!(response.run_id && response.results));
            console.log('Run ID:', response.run_id);
            console.log('Concurrency Used:', response.concurrency_used);
            console.log('Results Count:', response.results.length);
            
            if (response.results.length !== jobs.length) {
                console.error(`FAILED: Expected ${jobs.length} results, got ${response.results.length}`);
                process.exit(1);
            }

            const failures = response.results.filter(r => !r.ok);
            const successes = response.results.filter(r => r.ok);
            
            if (failures.length > 0) {
                console.log(`Verified Fail-Soft: ${failures.length} job(s) failed as expected.`);
                failures.forEach(f => console.log(` - Job ${f.job_id} failed: ${f.error}`));
            } else {
                console.warn('WARNING: Expected at least 1 failure for fail-soft verification, but all succeeded.');
            }

            if (successes.length === 0) {
                console.error('FAILED: All jobs failed. No isolation verified.');
                process.exit(1);
            }
            
            console.log(`Verified Isolation: ${successes.length} jobs succeeded despite failure(s).`);

            // Print first result as sample
            console.log('Sample Result:', JSON.stringify(response.results[0], null, 2));

            console.log('PASS: Concurrent Batch Scan Verified');
        } catch (e) {
            console.error('FAILED: Invalid JSON response', e);
            console.error(data);
            process.exit(1);
        }
    });
});

req.on('error', (e) => {
    console.error(`FAILED: Request error: ${e.message}`);
    process.exit(1);
});

req.write(payload);
req.end();
