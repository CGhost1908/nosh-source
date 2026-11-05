// Fast safety net: parse every JavaScript file in the app with `node --check` so a typo
// is caught in seconds, before the slower end-to-end tests.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const skip = new Set(['node_modules', 'dist', 'out', 'build', '.git']);

function collect(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        if (skip.has(entry.name)) return [];
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return collect(full);
        return entry.name.endsWith('.js') ? [full] : [];
    });
}

const files = collect(root);
const broken = files.filter(file => {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status !== 0) {
        console.error(`\nSyntax error in ${path.relative(root, file)}:\n${result.stderr}`);
        return true;
    }
    return false;
});

console.log(`${files.length - broken.length}/${files.length} JavaScript files parse cleanly`);
process.exit(broken.length ? 1 : 0);
