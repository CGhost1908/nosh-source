// Quick Capture: global hotkey window -> "Inbox" note (real Electron).
const fs = require('fs');
const path = require('path');
const { sleep, waitFor, createReporter, createSandbox, launchNosh, forceExit, relevantErrors } = require('./helpers');

(async () => {
    const report = createReporter();
    const { check } = report;
    const sandbox = createSandbox();
    const inboxPath = path.join(sandbox.saves, 'Inbox.nsh');
    let s = null;

    try {
        s = await launchNosh(sandbox);
        const { app, main } = s;

        const registered = await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('CommandOrControl+Alt+N'));
        check('global shortcut Ctrl+Alt+N registered', registered);

        const captureState = () => app.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()
                .filter(w => w.webContents.getURL().includes('quick-capture'))
                .map(w => ({ visible: w.isVisible(), onTop: w.isAlwaysOnTop(), bounds: w.getBounds() }))[0] || null);
        const openCapture = () => main.evaluate(() => ipcRenderer.send('quick-capture-open'));

        // 1. Open the capture window
        await openCapture();
        let cap = null;
        await waitFor(() => (cap = app.windows().find(p => p.url().includes('quick-capture.html'))), 15000, 'capture window');
        cap.on('pageerror', e => s.errors.push('capture pageerror: ' + e.message));
        await cap.waitForSelector('#capture-input');
        await waitFor(async () => (await captureState())?.visible, 5000, 'capture visible');
        const st = await captureState();
        check('capture window is visible and always on top', st && st.visible && st.onTop, st);

        const iso = await cap.evaluate(() => ({ require: typeof require, process: typeof process, bridge: Object.keys(window.quickCapture || {}) }));
        check('capture window has no Node access, only the bridge', iso.require === 'undefined' && iso.process === 'undefined', iso);

        // 2. Code snippet -> Inbox.nsh is created
        await cap.fill('#capture-input', 'def greet(name):\n    return f"hi {name}"');
        await cap.click('[data-mode="code"]');
        await cap.press('#capture-input', 'Control+Enter');
        await waitFor(() => fs.existsSync(inboxPath), 10000, 'Inbox.nsh');
        let html = fs.readFileSync(inboxPath, 'utf8');
        check('Inbox.nsh is created with a code block', html.includes('code-block-wrapper') && html.includes('def greet'));
        check('language is auto-detected', (html.match(/language="([^"]+)"/) || [])[1] === 'python');
        await waitFor(async () => !(await captureState()).visible, 5000, 'capture hidden');
        check('capture window hides after saving', true);
        check('draft is cleared after saving', (await cap.inputValue('#capture-input')) === '');
        await main.waitForSelector('.save[data-file="Inbox"]', { timeout: 10000 });
        check('Inbox appears in the sidebar', true);

        // 3. Text mode with HTML in it stays inert
        await openCapture();
        await waitFor(async () => (await captureState()).visible, 5000, 'capture visible again');
        await cap.click('[data-mode="text"]');
        await cap.fill('#capture-input', 'remember to <b>buy</b> milk');
        await cap.press('#capture-input', 'Control+Enter');
        await waitFor(() => fs.readFileSync(inboxPath, 'utf8').includes('remember to'), 10000, 'text entry');
        html = fs.readFileSync(inboxPath, 'utf8');
        check('text entry is appended and HTML-escaped', html.includes('&lt;b&gt;buy') && !html.includes('<b>buy'));
        check('Inbox holds both entries', (html.match(/quick-capture-meta/g) || []).length === 2);

        // 4. Esc hides and keeps the draft
        await openCapture();
        await waitFor(async () => (await captureState()).visible, 5000, 'capture visible (esc test)');
        await cap.fill('#capture-input', 'half-written draft');
        await cap.press('#capture-input', 'Escape');
        await waitFor(async () => !(await captureState()).visible, 5000, 'hidden after Esc');
        check('Esc hides the window', true);
        await openCapture();
        await waitFor(async () => (await captureState()).visible, 5000, 'visible after reopen');
        check('draft is kept after Esc', (await cap.inputValue('#capture-input')) === 'half-written draft');
        await cap.fill('#capture-input', '');
        await cap.press('#capture-input', 'Escape');

        // 5. Inbox open in the editor with unsaved edits
        await main.click('.save[data-file="Inbox"]');
        await waitFor(() => main.evaluate(() => activeNoteName === 'Inbox'), 10000, 'Inbox opened');
        await sleep(400);
        await main.evaluate(() => {
            const p = document.createElement('p');
            p.textContent = 'UNSAVED-EDIT';
            content.appendChild(p);
            hasUnsavedChanges = true;
        });
        await openCapture();
        await waitFor(async () => (await captureState()).visible, 5000, 'visible (open-note test)');
        await cap.click('[data-mode="code"]');
        await cap.fill('#capture-input', 'console.log(42);');
        await cap.press('#capture-input', 'Control+Enter');
        await waitFor(() => fs.readFileSync(inboxPath, 'utf8').includes('console.log(42);'), 10000, 'live append');
        check('open Inbox: unsaved edit is preserved', fs.readFileSync(inboxPath, 'utf8').includes('UNSAVED-EDIT'));
        const liveCM = await main.evaluate(() => content.querySelectorAll('.CodeMirror').length);
        check('open Inbox: new block is rendered live in the editor', liveCM >= 2, liveCM);

        // 6. The hidden capture window must not keep the app alive once the main window is gone
        await app.evaluate(({ BrowserWindow }) => {
            const w = BrowserWindow.getAllWindows().find(x => x.webContents.getURL().includes('index.html'));
            if (w) w.destroy();
        });
        await waitFor(() => s.closed, 15000, 'app exit').catch(() => {});
        check('destroying the main window also ends the app', s.closed);

        const noisy = relevantErrors(s.errors);
        check('no unexpected renderer errors', noisy.length === 0, noisy.slice(0, 3));
    } catch (err) {
        check('test run completed without exceptions', false, err.stack || err.message);
    } finally {
        await forceExit(s);
        process.exit(report.done() ? 1 : 0);
    }
})();
