// Shared helpers for the end-to-end tests (real Electron driven by Playwright).
//
// Every test runs against a throwaway --user-data-dir and notes folder, so a developer's real
// Nosh data is never touched. launchNosh() refuses to continue if the profile is not isolated.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron } = require('playwright');

const repo = path.resolve(__dirname, '..');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(fn, ms = 10000, label = 'condition') {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        try { if (await fn()) return true; } catch (_) {}
        await sleep(150);
    }
    throw new Error(`Timed out waiting for ${label}`);
}

// Collects PASS/FAIL lines and the final summary; done() returns the number of failures
function createReporter() {
    const results = [];
    return {
        check(name, ok, detail) {
            results.push({ name, ok: Boolean(ok) });
            const extra = detail !== undefined ? '  :: ' + JSON.stringify(detail) : '';
            console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra}`);
        },
        done() {
            const failed = results.filter(r => !r.ok).length;
            console.log(`\n${results.length - failed}/${results.length} checks passed`);
            return failed;
        }
    };
}

// A temp profile + notes folder. Pass it to launchNosh() again to restart with the same data.
function createSandbox(notes = { Existing: '<h1>Existing</h1><p>hello</p>' }) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nosh-e2e-'));
    const saves = path.join(tmp, 'Saves');
    fs.mkdirSync(saves, { recursive: true });
    for (const [name, html] of Object.entries(notes)) {
        fs.writeFileSync(path.join(saves, `${name}.nsh`), html, 'utf8');
    }
    return { tmp, userData: path.join(tmp, 'userData'), saves, noteNames: Object.keys(notes) };
}

async function launchNosh(sandbox, { env = {} } = {}) {
    const app = await electron.launch({
        args: [repo, `--user-data-dir=${sandbox.userData}`],
        cwd: repo,
        env: { ...process.env, NOSH_E2E: '1', ...env },
        timeout: 90000
    });

    const state = { app, sandbox, closed: false, errors: [], stderr: [] };
    app.on('close', () => { state.closed = true; });
    app.process().stderr.on('data', d => state.stderr.push(String(d)));

    const userData = await app.evaluate(({ app }) => app.getPath('userData'));
    if (!userData.toLowerCase().startsWith(sandbox.tmp.toLowerCase())) {
        await app.evaluate(({ app }) => app.exit(1)).catch(() => {});
        throw new Error(`Refusing to run: userData is not isolated (${userData})`);
    }

    let main = null;
    await waitFor(() => (main = app.windows().find(p => p.url().includes('index.html'))), 30000, 'main window');
    main.on('console', m => { if (m.type() === 'error') state.errors.push('main: ' + m.text()); });
    main.on('pageerror', e => state.errors.push('pageerror: ' + e.message));
    await main.waitForLoadState('domcontentloaded');

    // Point the renderer at the sandbox notes folder, then reload so it picks it up
    await main.evaluate((p) => localStorage.setItem('saves-path', p), sandbox.saves);
    await main.reload();
    if (sandbox.noteNames.length) {
        await main.waitForSelector(`.save[data-file="${sandbox.noteNames[0]}"]`, { timeout: 30000 });
    }

    state.main = main;
    state.mainWindow = () => app.evaluate(({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows().find(x => !x.isDestroyed() && x.webContents.getURL().includes('index.html'));
        return w ? { exists: true, visible: w.isVisible() } : { exists: false, visible: false };
    });
    return state;
}

// The app asks before closing with unsaved changes, so tests exit it directly
async function forceExit(state) {
    if (state && !state.closed) {
        await state.app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    }
}

// Console noise that is expected offline / in CI and says nothing about the app
function relevantErrors(errors) {
    return errors.filter(e => !/favicon|ERR_INTERNET_DISCONNECTED|youtube|googleapis\.com|Autofill|Failed to load resource/i.test(e));
}

module.exports = { repo, sleep, waitFor, createReporter, createSandbox, launchNosh, forceExit, relevantErrors };
