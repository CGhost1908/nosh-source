// Tray icon + keep-running-when-closed (real Electron). Needs the Quick Capture feature too.
const fs = require('fs');
const path = require('path');
const { sleep, waitFor, createReporter, createSandbox, launchNosh, forceExit } = require('./helpers');

(async () => {
    const report = createReporter();
    const { check } = report;
    const sandbox = createSandbox();
    const prefsFile = path.join(sandbox.userData, 'nosh-prefs.json');
    const readPrefs = () => JSON.parse(fs.readFileSync(prefsFile, 'utf8'));

    // Operations on the tray through the test hook that tray.js exposes when NOSH_E2E=1
    const trayOp = (s, op, value) => s.app.evaluate((_, a) => {
        const t = global.__noshTray;
        const tray = t.getTray();
        const template = t.buildMenuTemplate();
        switch (a.op) {
            case 'info': return {
                active: !!tray && !tray.isDestroyed(),
                labels: template.map(i => i.label || i.type),
                keepChecked: template.find(i => i.type === 'checkbox').checked,
                prefs: t.getPrefs()
            };
            case 'click': tray.emit('click'); return true;
            case 'toggleKeep': template.find(i => i.type === 'checkbox').click({ checked: a.value }); return true;
            case 'quit': template.find(i => i.label === 'Quit Nosh').click(); return true;
        }
    }, { op, value });

    let s = null;
    try {
        // ---------- Launch 1: defaults ----------
        s = await launchNosh(sandbox);
        const info = await trayOp(s, 'info');
        check('tray icon exists', info.active);
        check('tray menu has the expected entries',
            JSON.stringify(info.labels) === JSON.stringify(['Open Nosh', 'Quick note', 'separator', 'Keep running when the window is closed', 'separator', 'Quit Nosh']), info.labels);
        check('keep-running is on by default', info.keepChecked && info.prefs.keepInTray === true, info.prefs);

        // Closing the window (what the title-bar X sends) hides it instead of exiting
        await s.main.evaluate(() => ipcRenderer.send('close'));
        await waitFor(async () => !(await s.mainWindow()).visible, 10000, 'window hidden');
        const hidden = await s.mainWindow();
        check('closing the window hides it to the tray', hidden.exists && !hidden.visible && !s.closed, hidden);
        check('the renderer is still alive while hidden', (await s.main.evaluate(() => 1 + 1)) === 2);
        check('the first-close hint is remembered', fs.existsSync(prefsFile) && readPrefs().trayHintShown === true);

        // Quick Capture still saves while the main window is hidden
        await s.main.evaluate(() => ipcRenderer.send('quick-capture-open'));
        let cap = null;
        await waitFor(() => (cap = s.app.windows().find(p => p.url().includes('quick-capture.html'))), 15000, 'capture window');
        await cap.waitForSelector('#capture-input');
        await cap.fill('#capture-input', 'saved while hidden');
        await cap.click('[data-mode="text"]');
        await cap.press('#capture-input', 'Control+Enter');
        const inbox = path.join(sandbox.saves, 'Inbox.nsh');
        await waitFor(() => fs.existsSync(inbox) && fs.readFileSync(inbox, 'utf8').includes('saved while hidden'), 10000, 'Inbox.nsh');
        check('a quick note is saved while the main window is hidden', true);
        check('the main window stays hidden after a quick note', !(await s.mainWindow()).visible);

        // Tray click brings the window back
        await trayOp(s, 'click');
        await waitFor(async () => (await s.mainWindow()).visible, 10000, 'window shown');
        check('clicking the tray icon shows the window again', true);

        // Turn keep-running off via the menu; it is saved to disk
        await trayOp(s, 'toggleKeep', false);
        check('turning keep-running off is saved to disk', readPrefs().keepInTray === false, readPrefs());
        check('the menu checkbox reflects the new setting', (await trayOp(s, 'info')).keepChecked === false);

        // With it off, closing really exits
        await s.main.evaluate(() => ipcRenderer.send('close'));
        await waitFor(() => s.closed, 15000, 'app exit');
        check('with keep-running off, closing the window quits the app', s.closed);

        // ---------- Launch 2: preference persists; tray Quit ----------
        s = await launchNosh(sandbox);
        const persisted = await trayOp(s, 'info');
        check('the preference persists across restarts', persisted.prefs.keepInTray === false && persisted.keepChecked === false, persisted.prefs);
        await trayOp(s, 'toggleKeep', true);
        await trayOp(s, 'quit');
        await waitFor(() => s.closed, 15000, 'tray quit');
        check('"Quit Nosh" exits a clean app', s.closed);

        // ---------- Launch 3: unsaved changes + quit ----------
        s = await launchNosh(sandbox);
        await s.main.click('.save[data-file="Existing"]');
        await waitFor(() => s.main.evaluate(() => activeNoteName === 'Existing'), 10000, 'note opened');
        await s.main.evaluate(() => { hasUnsavedChanges = true; });
        await s.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('index.html')).hide());
        check('the window is hidden for the unsaved-changes scenario', !(await s.mainWindow()).visible);

        await trayOp(s, 'quit');
        await waitFor(async () => (await s.mainWindow()).visible, 10000, 'window shown for the prompt');
        await waitFor(() => s.main.evaluate(() => document.getElementById('unsaved-modal').classList.contains('active')), 10000, 'unsaved prompt');
        check('Quit with unsaved changes shows the window and asks first', !s.closed);

        await s.main.click('#unsaved-cancel-btn');
        await sleep(600);
        check('cancelling keeps the app running and the window visible', !s.closed && (await s.mainWindow()).visible);

        // A cancelled quit must not leave a stale quit flag: a normal close still hides
        await s.main.evaluate(() => ipcRenderer.send('close'));
        await waitFor(() => s.main.evaluate(() => document.getElementById('unsaved-modal').classList.contains('active')), 10000, 'prompt again');
        await s.main.click('#unsaved-discard-btn');
        await waitFor(async () => !(await s.mainWindow()).visible, 10000, 'hidden after discard');
        check('after a cancelled quit, a normal close still hides to the tray', !s.closed && !(await s.mainWindow()).visible);

        await trayOp(s, 'quit');
        await waitFor(() => s.closed, 15000, 'final quit');
        check('Quit then exits cleanly (nothing left to save)', s.closed);
    } catch (err) {
        check('test run completed without exceptions', false, err.stack || err.message);
    } finally {
        await forceExit(s);
        process.exit(report.done() ? 1 : 0);
    }
})();
