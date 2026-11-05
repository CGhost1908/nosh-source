// Runs every tests/*.e2e.js in its own process, one after another, and reports a summary.
//   node tests/run-e2e.js            run all
//   node tests/run-e2e.js smoke      run files whose name contains "smoke"
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const filters = process.argv.slice(2);
const files = fs.readdirSync(__dirname)
    .filter(f => f.endsWith('.e2e.js'))
    .filter(f => filters.length === 0 || filters.some(x => f.includes(x)))
    .sort();

if (files.length === 0) {
    console.error('No end-to-end test files matched.');
    process.exit(1);
}

const outcome = [];
for (const file of files) {
    console.log(`\n=== ${file} ===`);
    const started = Date.now();
    const run = spawnSync(process.execPath, [path.join(__dirname, file)], { stdio: 'inherit', timeout: 240000 });
    const timedOut = run.error && run.error.code === 'ETIMEDOUT';
    outcome.push({ file, ok: run.status === 0 && !timedOut, seconds: Math.round((Date.now() - started) / 1000), timedOut });
}

console.log('\n=== Summary ===');
for (const o of outcome) {
    console.log(`${o.ok ? 'PASS' : 'FAIL'}  ${o.file}  (${o.seconds}s)${o.timedOut ? '  timed out' : ''}`);
}
process.exit(outcome.every(o => o.ok) ? 0 : 1);
