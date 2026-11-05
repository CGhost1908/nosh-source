// Floating YouTube player window: runs isolated, with its own small preload (real Electron).
const { waitFor, createReporter, createSandbox, launchNosh, forceExit, relevantErrors } = require('./helpers');

(async () => {
    const report = createReporter();
    const { check } = report;
    const sandbox = createSandbox();
    let s = null;

    try {
        s = await launchNosh(sandbox);
        const { app, main } = s;

        const opened = await main.evaluate(() => ipcRenderer.invoke('open-youtube-pip', { videoId: 'dQw4w9WgXcQ', title: 'Test video' }));
        check('the floating player opens', opened && opened.success === true, opened);

        let pip = null;
        await waitFor(() => (pip = app.windows().find(p => p.url().includes('youtube-pip.html'))), 20000, 'pip window');
        await pip.waitForLoadState('domcontentloaded');

        const globals = await pip.evaluate(() => ({
            require: typeof require, process: typeof process,
            bridge: Object.keys(window.pip || {}).sort()
        }));
        check('the player window has no Node access, only its small bridge',
            globals.require === 'undefined' && globals.process === 'undefined' &&
            JSON.stringify(globals.bridge) === JSON.stringify(['getServerPort', 'onLoadVideo', 'setAlwaysOnTop']), globals);

        const port = await pip.evaluate(() => window.pip.getServerPort());
        check('the player can ask for the local server port', Number.isInteger(port) && port > 0, port);

        const pipState = () => app.evaluate(({ BrowserWindow }) => {
            const w = BrowserWindow.getAllWindows().find(x => !x.isDestroyed() && x.webContents.getURL().includes('youtube-pip.html'));
            return w ? w.isAlwaysOnTop() : null;
        });
        check('the player starts always on top', (await pipState()) === true);

        // The pin button used the removed `remote` module before and did nothing
        const accepted = await pip.evaluate(() => window.pip.setAlwaysOnTop(false));
        await waitFor(async () => (await pipState()) === false, 5000, 'unpinned');
        check('the pin button now really toggles always-on-top', accepted === true);

        // Loading another video reaches the already open window
        await main.evaluate(() => ipcRenderer.invoke('open-youtube-pip', { videoId: 'jNQXAC9IVRw', title: 'Second video' }));
        await waitFor(() => pip.evaluate(() => document.getElementById('pip-title-text').textContent === 'Second video'), 10000, 'title updated');
        check('opening another video updates the open window', true);

        await main.evaluate(() => ipcRenderer.invoke('close-youtube-pip'));
        await waitFor(async () => !app.windows().some(p => p.url().includes('youtube-pip.html') && !p.isClosed()), 10000, 'pip closed');
        check('the player closes', true);

        const noisy = relevantErrors(s.errors);
        check('no unexpected renderer errors in the main window', noisy.length === 0, noisy.slice(0, 3));
    } catch (err) {
        check('test run completed without exceptions', false, err.stack || err.message);
    } finally {
        await forceExit(s);
        process.exit(report.done() ? 1 : 0);
    }
})();
