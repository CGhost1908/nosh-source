// Process isolation: a script running inside the page (for example from a malicious note) must
// not reach Node, the wider file system, arbitrary IPC channels or the OS shell (real Electron).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { sleep, waitFor, createReporter, createSandbox, launchNosh, forceExit, relevantErrors } = require('./helpers');

(async () => {
    const report = createReporter();
    const { check } = report;

    // A note whose HTML tries to use Node and read a file outside the notes folder as soon as it loads
    const secretFile = path.join(os.tmpdir(), `nosh-secret-${Date.now()}.txt`);
    fs.writeFileSync(secretFile, 'TOP-SECRET', 'utf8');
    // The JS string literal is HTML-escaped (&quot;) so it can sit inside the onerror="..." attribute
    const secretLiteral = JSON.stringify(secretFile).replace(/"/g, '&quot;');
    const evilNote =
        '<h1>Evil</h1><p>hello</p>' +
        '<img src="x" onerror="' +
        "window.__attack = { requireType: typeof require, processType: typeof process };" +
        `nosh.fs.readFile(${secretLiteral}, 'utf8').then(function (r) { window.__attack.leaked = r.ok; window.__attack.code = r.code; });` +
        '">';

    const sandbox = createSandbox({ Existing: '<h1>Existing</h1><p>hello</p>', Evil: evilNote });
    const outside = path.join(os.tmpdir(), `nosh-outside-${Date.now()}`);
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, 'x.txt'), 'outside', 'utf8');
    let s = null;

    try {
        s = await launchNosh(sandbox);
        const { main } = s;

        // 1. No Node in the page
        const globals = await main.evaluate(() => ({
            require: typeof require, process: typeof process, module: typeof module,
            Buffer: typeof Buffer, global: typeof global, nodeVersion: typeof window.versions
        }));
        check('the page has no require, process, module, Buffer or global',
            ['require', 'process', 'module', 'Buffer', 'global'].every(k => globals[k] === 'undefined'), globals);

        const api = await main.evaluate(() => Object.keys(window.nosh).sort());
        check('the bridge exposes only the intended API', JSON.stringify(api) === JSON.stringify(['clipboard', 'drive', 'fs', 'highlight', 'ipc', 'path', 'platform']), api);

        // 2. File access stays inside the notes folder
        const inside = await main.evaluate(async (dir) => {
            await fsPromises.writeFile(path.join(dir, 'scratch.txt'), 'ok', 'utf8');
            return fsPromises.readFile(path.join(dir, 'scratch.txt'), 'utf8');
        }, sandbox.saves);
        check('reading and writing inside the notes folder works', inside === 'ok', inside);

        const attempts = await main.evaluate(async ({ saves, outside, secret }) => {
            const fail = async (fn) => { try { await fn(); return 'allowed'; } catch (e) { return e.code; } };
            return {
                readOutside: await fail(() => fsPromises.readFile(secret, 'utf8')),
                readdirOutside: await fail(() => fsPromises.readdir(outside)),
                writeOutside: await fail(() => fsPromises.writeFile(path.join(outside, 'pwned.txt'), 'x', 'utf8')),
                traversal: await fail(() => fsPromises.readFile(saves + '/../' + path.basename(secret), 'utf8')),
                siblingPrefix: await fail(() => fsPromises.readdir(saves + '-other')),
                removeRoot: await fail(() => fsPromises.rm(saves, { recursive: true, force: true })),
                renameRoot: await fail(() => fsPromises.rename(saves, saves + '-moved')),
                existsOutside: fs.existsSync(secret)
            };
        }, { saves: sandbox.saves, outside, secret: secretFile });
        check('reads, listings and writes outside the notes folder are refused',
            ['readOutside', 'readdirOutside', 'writeOutside', 'traversal', 'siblingPrefix'].every(k => attempts[k] === 'ENOSH_FORBIDDEN'), attempts);
        check('the notes folder itself cannot be deleted or moved', attempts.removeRoot === 'ENOSH_FORBIDDEN' && attempts.renameRoot === 'ENOSH_FORBIDDEN', attempts);
        check('existsSync says "no" for paths outside the notes folder', attempts.existsOutside === false);
        check('nothing was written outside the notes folder', !fs.existsSync(path.join(outside, 'pwned.txt')));

        const missing = await main.evaluate(async (saves) => {
            try { await fsPromises.readFile(path.join(saves, 'does-not-exist.nsh'), 'utf8'); return 'read'; } catch (e) { return e.code; }
        }, sandbox.saves);
        check('a missing note still reports ENOENT (error codes survive the bridge)', missing === 'ENOENT', missing);

        // 3. IPC is a whitelist
        const ipcAttempts = await main.evaluate(async () => {
            const result = {};
            for (const [name, fn] of Object.entries({
                invokeUnknown: () => ipcRenderer.invoke('definitely-not-a-channel'),
                sendUnknown: () => ipcRenderer.send('quick-capture-submit', { text: 'x', kind: 'text' }),
                listenUnknown: () => ipcRenderer.on('spotify-token', () => {})
            })) {
                try { await fn(); result[name] = 'allowed'; } catch (e) { result[name] = 'blocked'; }
            }
            return result;
        });
        check('unknown IPC channels are blocked (invoke, send and listen)', Object.values(ipcAttempts).every(v => v === 'blocked'), ipcAttempts);

        // 4. Privileged main-process handlers refuse dangerous input
        const handlers = await main.evaluate(async (secret) => ({
            fileUrl: await ipcRenderer.invoke('open-external', 'file:///C:/Windows/System32/calc.exe'),
            jsUrl: await ipcRenderer.invoke('open-external', 'javascript:alert(1)'),
            msProtocol: await ipcRenderer.invoke('open-external', 'ms-msdt:/id PCWDiagnostic'),
            catbox: await ipcRenderer.invoke('upload-to-catbox', { filePath: secret })
        }), secretFile);
        check('open-external refuses file:, javascript: and OS protocol URLs',
            handlers.fileUrl === false && handlers.jsUrl === false && handlers.msProtocol === false, handlers);
        check('upload-to-catbox refuses a file outside the notes folder', handlers.catbox && handlers.catbox.success === false && /outside the notes folder/i.test(handlers.catbox.error || ''), handlers.catbox);

        // 5. A hostile note runs inside the page but gets nothing
        await main.evaluate(() => { window.__attack = null; });
        await main.click('.save[data-file="Evil"]');
        await waitFor(() => main.evaluate(() => activeNoteName === 'Evil'), 10000, 'evil note opened');
        await waitFor(() => main.evaluate(() => window.__attack && 'leaked' in window.__attack), 10000, 'attack script finished');
        const attack = await main.evaluate(() => window.__attack);
        check('script in a note ran, but has no Node: require and process are undefined', attack.requireType === 'undefined' && attack.processType === 'undefined', attack);
        check('script in a note could not read a file outside the notes folder', attack.leaked === false && attack.code === 'ENOSH_FORBIDDEN', attack);

        // 6. The page cannot be navigated away from the app or open windows.
        // (Last in this session: a blocked navigation leaves Playwright waiting for the page.)
        const before = await main.evaluate(() => location.href);
        await main.evaluate(() => { location.href = 'file:///C:/Windows/win.ini'; });
        await sleep(600);
        const after = await main.evaluate(() => location.href);
        check('navigating to another file URL is blocked', after === before, { before, after });
        const popup = await main.evaluate(() => window.open('file:///C:/Windows/win.ini', '_blank'));
        check('window.open is denied', popup === null);

        // 7. A folder cannot be granted through localStorage after the first run
        await main.evaluate((dir) => localStorage.setItem('saves-path', dir), outside);
        await sleep(1500); // let localStorage reach the disk before the app is killed
        await forceExit(s);
        await waitFor(() => s.closed, 10000, 'first run closed');
        s = await launchNosh(sandbox);
        const grantAttempt = await s.main.evaluate(async (dir) => {
            try { await fsPromises.readdir(dir); return 'allowed'; } catch (e) { return e.code; }
        }, outside);
        check('a page cannot grant itself a new folder through localStorage', grantAttempt === 'ENOSH_FORBIDDEN', grantAttempt);

        // 8. Upgrade path: a custom notes folder saved by an older version is accepted exactly once.
        // The app resets an unusable saves-path to the default, so put the old value back first.
        await s.main.evaluate((dir) => localStorage.setItem('saves-path', dir), outside);
        await sleep(1500);
        await forceExit(s);
        await waitFor(() => s.closed, 10000, 'second run closed');
        const rootsFile = path.join(sandbox.userData, 'nosh-roots.json');
        fs.writeFileSync(rootsFile, JSON.stringify({ roots: [], legacyClaimed: false }), 'utf8'); // as if never migrated
        // saves-path = outside is still in localStorage, so the app now opens that folder (which has
        // no notes) instead of the sandbox: do not wait for the sandbox's notes to appear
        s = await launchNosh({ ...sandbox, noteNames: [] });
        const migrated = await s.main.evaluate(async (dir) => {
            try { return (await fsPromises.readdir(dir)).includes('x.txt'); } catch (e) { return e.code; }
        }, outside);
        check('an older version\'s custom notes folder is migrated on first launch', migrated === true, migrated);
        const savedRoots = JSON.parse(fs.readFileSync(rootsFile, 'utf8'));
        check('the migration is recorded and happens only once', savedRoots.legacyClaimed === true && savedRoots.roots.length === 1, savedRoots);

        const noisy = relevantErrors(s.errors);
        check('no unexpected renderer errors', noisy.length === 0, noisy.slice(0, 3));
    } catch (err) {
        check('test run completed without exceptions', false, err.stack || err.message);
    } finally {
        await forceExit(s);
        try { fs.rmSync(secretFile, { force: true }); fs.rmSync(outside, { recursive: true, force: true }); } catch (_) {}
        process.exit(report.done() ? 1 : 0);
    }
})();
