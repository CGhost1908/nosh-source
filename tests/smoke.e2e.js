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

        // Runtime dependencies resolve in the renderer
        const libs = await main.evaluate(() => ({
            codemirror: typeof CodeMirror === 'function' || typeof CodeMirror === 'object',
            pythonMode: !!CodeMirror.modes && !!CodeMirror.modes.python,
            googleapis: typeof require('googleapis').google === 'object',
            highlightjs: typeof require('highlight.js').highlight === 'function',
            interactjs: typeof interact === 'function',
            katex: typeof katex === 'object'
        }));
        check('renderer libraries load (codemirror, googleapis, highlight.js, interact.js)',
            libs.codemirror && libs.pythonMode && libs.googleapis && libs.highlightjs && libs.interactjs, libs);

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

        // New note
        await main.evaluate(() => createNewFile());
        await waitFor(() => fs.readdirSync(sandbox.saves).some(f => f.startsWith('Untitled')), 10000, 'new note file');
        check('creating a new note works', true);

        // Local OAuth server (express) is listening
        const port = await main.evaluate(() => require('electron').ipcRenderer.invoke('get-server-port'));
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
