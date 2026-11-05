// Smoke test: launches the real app and checks the core still works.
// Catches missing dependencies, broken startup and regressions in note handling.
const fs = require('fs');
const path = require('path');
const { sleep, waitFor, createReporter, createSandbox, launchNosh, forceExit, relevantErrors } = require('./helpers');

(async () => {
    const report = createReporter();
    const { check } = report;
    const sandbox = createSandbox();
    let s = null;

    try {
        s = await launchNosh(sandbox);
        const { main } = s;
        check('app starts and lists notes from the notes folder', true);

        // Libraries the page uses directly, and the ones that live behind the preload bridge
        const libs = await main.evaluate(async () => {
            const driveUrl = await nosh.drive.call('authUrl', { clientId: 'x', clientSecret: 'y' }, []);
            return {
                codemirror: typeof CodeMirror === 'function' || typeof CodeMirror === 'object',
                pythonMode: !!CodeMirror.modes && !!CodeMirror.modes.python,
                markdownMode: !!CodeMirror.modes && !!CodeMirror.modes.markdown,
                phpMode: !!CodeMirror.modes && !!CodeMirror.modes.php,
                sublimeKeymap: !!CodeMirror.keyMap && !!CodeMirror.keyMap.sublime,
                googleapis: driveUrl.ok === true && String(driveUrl.value).startsWith('https://accounts.google.com/'),
                highlightjs: nosh.highlight.hasLanguage('python') && String(nosh.highlight.highlight('print(1)', 'python')).includes('hljs-'),
                interactjs: typeof interact === 'function',
                katex: typeof katex === 'object'
            };
        });
        check('page libraries load (CodeMirror modes and keymap, interact.js, KaTeX)',
            libs.codemirror && libs.pythonMode && libs.markdownMode && libs.phpMode && libs.sublimeKeymap && libs.interactjs && libs.katex, libs);
        check('libraries behind the preload bridge work (googleapis auth URL, highlight.js)', libs.googleapis && libs.highlightjs, libs);

        // Open, edit and save a note
        await main.click('.save[data-file="Existing"]');
        await waitFor(() => main.evaluate(() => activeNoteName === 'Existing'), 10000, 'note opened');
        await main.evaluate(async () => {
            const p = document.createElement('p');
            p.textContent = 'SMOKE-EDIT';
            content.appendChild(p);
            hasUnsavedChanges = true;
            await saveFile();
        });
        check('edit + save writes the note to disk',
            fs.readFileSync(path.join(sandbox.saves, 'Existing.nsh'), 'utf8').includes('SMOKE-EDIT'));

        // Code block with a live CodeMirror editor
        await main.evaluate(() => createCodeBlock('python', 'Python', 'print("hi")'));
        await waitFor(() => main.evaluate(() => content.querySelectorAll('.CodeMirror').length === 1), 10000, 'code block');
        const cmValue = await main.evaluate(() => content.querySelector('.CodeMirror').CodeMirror.getValue());
        check('code block renders a live CodeMirror editor', cmValue === 'print("hi")', cmValue);

        // PDF export path uses highlight.js
        const hl = await main.evaluate(() => highlightCodeForPdf('print(1)', 'python'));
        check('PDF syntax highlighting (highlight.js) works', typeof hl === 'string' && hl.includes('hljs-'), hl);

        // Binary data crosses the bridge intact (image paste / insert goes through saveMediaAsset)
        const png = [137, 80, 78, 71, 13, 10, 26, 10, 0, 255, 128, 7];
        const assetRel = await main.evaluate((bytes) =>
            saveMediaAsset(new File([new Uint8Array(bytes)], 'pic.png', { type: 'image/png' })), png);
        const assetOnDisk = fs.readFileSync(path.join(sandbox.saves, assetRel));
        check('an image asset is saved byte for byte through the bridge',
            /^assets\/asset_\d+_pic\.png$/.test(assetRel) && Buffer.compare(assetOnDisk, Buffer.from(png)) === 0, assetRel);

        // PDF export: the main process writes the file, and honours an output path inside the notes folder
        const pdfPath = path.join(sandbox.saves, 'export-test.pdf');
        const pdfResult = await main.evaluate((target) => ipcRenderer.invoke('export-pdf', {
            defaultName: 'Export test', title: 'Export test', htmlContent: '<h1>Export test</h1><p>hello</p>', outputPath: target
        }), pdfPath);
        const pdfHead = fs.existsSync(pdfPath) ? fs.readFileSync(pdfPath).subarray(0, 5).toString() : '';
        check('PDF export writes a real PDF inside the notes folder', pdfHead === '%PDF-', { result: pdfResult && pdfResult.success, pdfHead });

        // The clipboard bridge answers (read only, so the developer's clipboard is left alone)
        check('clipboard bridge works', (await main.evaluate(() => typeof nativeClipboard.readText())) === 'string');

        // New note
        await main.evaluate(() => createNewFile());
        await waitFor(() => fs.readdirSync(sandbox.saves).some(f => f.startsWith('Untitled')), 10000, 'new note file');
        check('creating a new note works', true);

        // Local OAuth server (express) is listening
        const port = await main.evaluate(() => ipcRenderer.invoke('get-server-port'));
        const res = await fetch(`http://127.0.0.1:${port}/drive-callback`).catch(() => null);
        check('local auth server (express) answers', res !== null, { port, status: res && res.status });

        // Nothing is missing anywhere
        await sleep(300);
        const missing = [...s.errors, ...s.stderr].filter(l => /Cannot find module|MODULE_NOT_FOUND|is not defined/i.test(l));
        check('no missing-module or undefined-symbol errors', missing.length === 0, missing.slice(0, 3));
        const noisy = relevantErrors(s.errors);
        check('no unexpected renderer errors', noisy.length === 0, noisy.slice(0, 3));
    } catch (err) {
        check('test run completed without exceptions', false, err.stack || err.message);
    } finally {
        await forceExit(s);
        process.exit(report.done() ? 1 : 0);
    }
})();
