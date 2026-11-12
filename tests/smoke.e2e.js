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

        // Media toolbar should be stripped from PDF payload
        await main.evaluate((rel) => insertMediaElement(rel, 'image'), assetRel);
        const pdfPayload = await main.evaluate(() => buildPdfDocumentPayload('Test Note'));
        check('media toolbar and resize buttons are stripped from PDF payload',
            !pdfPayload.htmlContent.includes('media-toolbar') &&
            !pdfPayload.htmlContent.includes('25%') &&
            !pdfPayload.htmlContent.includes('50%') &&
            !pdfPayload.htmlContent.includes('media-resize-handle'),
            pdfPayload.htmlContent);

        // PDF export: the main process writes the file, and honours an output path inside the notes folder
        const pdfPath = path.join(sandbox.saves, 'export-test.pdf');
        const pdfResult = await main.evaluate((target) => ipcRenderer.invoke('export-pdf', {
            defaultName: 'Export test', title: 'Export test', htmlContent: '<h1>Export test</h1><p>hello</p>', outputPath: target
        }), pdfPath);
        const pdfHead = fs.existsSync(pdfPath) ? fs.readFileSync(pdfPath).subarray(0, 5).toString() : '';
        check('PDF export writes a real PDF inside the notes folder', pdfHead === '%PDF-', { result: pdfResult && pdfResult.success, pdfHead });

        // The clipboard bridge answers (read only, so the developer's clipboard is left alone)
        check('clipboard bridge works', (await main.evaluate(() => typeof nativeClipboard.readText())) === 'string');

        // Default theme is solarized and local CodeMirror stylesheet loads cleanly without duplicate theme links
        const cmAssetState = await main.evaluate(() => ({
            defaultTheme: localStorage.getItem('code-theme'),
            cmHasSolarized: Boolean(document.querySelector('#content .code-block-wrapper .CodeMirror.cm-s-solarized')),
            localCmCssLoaded: Boolean(document.querySelector('link[href="node_modules/codemirror/lib/codemirror.css"]')?.sheet),
            solarizedLinks: document.querySelectorAll('link[href$="/solarized.css"]').length
        }));
        check('default code theme is solarized and local CodeMirror CSS loads cleanly',
            cmAssetState.defaultTheme === 'solarized' && cmAssetState.cmHasSolarized &&
            cmAssetState.localCmCssLoaded && cmAssetState.solarizedLinks === 1, cmAssetState);

        // New note (save Existing first so switching away is clean)
        await main.evaluate(async () => { await saveFile(); });
        await main.evaluate(() => createNewFile());
        await waitFor(() => fs.readdirSync(sandbox.saves).some(f => f.startsWith('Untitled')), 10000, 'new note file');
        await waitFor(() => main.evaluate(() => activeNoteName && activeNoteName.startsWith('Untitled')), 10000, 'new note opened');
        check('creating a new note works', true);

        // Reopening a note with code blocks must hydrate CodeMirror & non-preloaded theme CSS immediately (no 30ms raw textarea flash)
        const reopenState = await main.evaluate(async () => {
            localStorage.setItem('code-theme', 'ayu-dark');
            let sawRawTextareaFrame = false;
            const obs = new MutationObserver(() => {
                const ta = document.querySelector('#content .code-block-wrapper textarea.code');
                const cm = document.querySelector('#content .code-block-wrapper .CodeMirror');
                if (ta && !cm && getComputedStyle(ta).display !== 'none') {
                    sawRawTextareaFrame = true;
                }
            });
            obs.observe(content, { childList: true, subtree: true });
            await openDesiredFile('Existing');
            obs.disconnect();

            const wrapper = document.querySelector('#content .code-block-wrapper');
            const cmEl = wrapper ? wrapper.querySelector('.CodeMirror') : null;
            const ta = wrapper ? wrapper.querySelector('textarea.code') : null;
            const cs = cmEl ? getComputedStyle(cmEl) : null;
            return {
                sawRawTextareaFrame,
                hasCmImmediately: Boolean(cmEl && cmEl.CodeMirror),
                taHidden: Boolean(ta && ta.style.display === 'none'),
                hasMoveBtns: Boolean(wrapper && wrapper.querySelector('.move-up-btn') && wrapper.querySelector('.move-down-btn')),
                themeSheetLoaded: Boolean(document.querySelector('link[data-code-theme="ayu-dark"]')?.sheet),
                cmPosition: cs ? cs.position : null,
                cmHeight: cmEl ? cmEl.getBoundingClientRect().height : 0
            };
        });
        check('opening note renders hydrated CodeMirror & theme synchronously with zero raw-textarea flash',
            !reopenState.sawRawTextareaFrame &&
            reopenState.hasCmImmediately &&
            reopenState.taHidden &&
            reopenState.hasMoveBtns &&
            reopenState.themeSheetLoaded &&
            reopenState.cmPosition === 'relative' &&
            reopenState.cmHeight > 0,
            reopenState);

        // Settings -> Code Themes uses Previous / Next carousel + searchable dropdown across all 64 themes
        const expectedThemes = fs.readdirSync(path.join(__dirname, '..', 'src', 'code-theme'))
            .filter(f => f.endsWith('.css') && f !== 'ambiance-mobile.css')
            .map(f => path.basename(f, '.css'));
        await main.evaluate(() => {
            openSettingsModal();
            switchSettingsTab('code-themes');
        });
        await main.waitForSelector('#theme-picker-trigger', { timeout: 5000 });

        const carouselLayout = await main.evaluate(() => ({
            hasGrid: Boolean(document.getElementById('themes-grid')),
            hasPrev: Boolean(document.getElementById('theme-prev-btn')),
            hasNext: Boolean(document.getElementById('theme-next-btn')),
            currentName: document.getElementById('theme-current-name')?.textContent?.trim(),
            indexBadge: document.getElementById('theme-index-badge')?.textContent?.trim(),
            previewWidth: document.getElementById('settings-theme-preview')?.getBoundingClientRect().width || 0
        }));
        check('Code Themes pane shows wide preview and Previous/Next carousel',
            !carouselLayout.hasGrid && carouselLayout.hasPrev && carouselLayout.hasNext &&
            carouselLayout.currentName === 'ayu-dark' && carouselLayout.indexBadge === '13 / 64' &&
            carouselLayout.previewWidth > 500,
            carouselLayout);

        // Next button advances ayu-dark (13/64) -> ayu-mirage (14/64)
        await main.click('#theme-next-btn');
        await waitFor(() => main.evaluate(() => {
            const previewCm = document.querySelector('#settings-theme-preview .CodeMirror');
            const cmEl = document.querySelector('#content .code-block-wrapper .CodeMirror');
            return Boolean(
                document.getElementById('theme-current-name')?.textContent?.trim() === 'ayu-mirage' &&
                document.getElementById('theme-index-badge')?.textContent?.trim() === '14 / 64' &&
                previewCm && previewCm.classList.contains('cm-s-ayu-mirage') &&
                cmEl && cmEl.classList.contains('cm-s-ayu-mirage')
            );
        }), 5000, 'Next theme button switches to ayu-mirage');
        check('Next button switches preview and editor to next theme', true);

        // Previous button goes back (14/64 -> 13/64)
        await main.click('#theme-prev-btn');
        await waitFor(() => main.evaluate(() => {
            const previewCm = document.querySelector('#settings-theme-preview .CodeMirror');
            return Boolean(
                document.getElementById('theme-current-name')?.textContent?.trim() === 'ayu-dark' &&
                document.getElementById('theme-index-badge')?.textContent?.trim() === '13 / 64' &&
                previewCm && previewCm.classList.contains('cm-s-ayu-dark')
            );
        }), 5000, 'Previous theme button returns to ayu-dark');
        check('Previous button steps backward to prior theme', true);

        // Dropdown opens, Escape closes only dropdown (keeps settings modal open), and search picks any theme
        await main.click('#theme-picker-trigger');
        await main.waitForSelector('#theme-picker-dropdown.open .theme-dropdown-item', { timeout: 5000 });
        const uiThemes = await main.evaluate(() =>
            Array.from(document.querySelectorAll('#theme-dropdown-list .theme-dropdown-item'))
                .map(b => b.dataset.theme || b.textContent.trim())
        );
        const missingThemes = expectedThemes.filter(t => !uiThemes.includes(t));
        check('all 64 standalone themes (including yonce) appear in Code Themes dropdown',
            expectedThemes.length === 64 && missingThemes.length === 0 && uiThemes.includes('yonce'),
            { count: uiThemes.length, expected: expectedThemes.length, missingThemes });

        await main.press('#theme-search-input', 'Escape');
        const escapeState = await main.evaluate(() => ({
            dropdownOpen: document.getElementById('theme-picker-dropdown')?.classList.contains('open'),
            settingsOpen: document.getElementById('settings-modal')?.classList.contains('active')
        }));
        check('Escape closes theme dropdown without closing Settings modal',
            !escapeState.dropdownOpen && escapeState.settingsOpen,
            escapeState);

        await main.click('#theme-picker-trigger');
        await main.fill('#theme-search-input', 'dracula');
        const visibleAfterFilter = await main.evaluate(() =>
            Array.from(document.querySelectorAll('#theme-dropdown-list .theme-dropdown-item'))
                .filter(b => b.style.display !== 'none')
                .map(b => b.dataset.theme)
        );
        check('theme dropdown search filters matching themes',
            visibleAfterFilter.length === 1 && visibleAfterFilter[0] === 'dracula',
            visibleAfterFilter);

        await main.click('#theme-dropdown-list .theme-dropdown-item[data-theme="dracula"]');
        await waitFor(() => main.evaluate(() =>
            document.getElementById('theme-current-name')?.textContent?.trim() === 'dracula' &&
            document.getElementById('theme-index-badge')?.textContent?.trim() === '1 / 64' &&
            !document.getElementById('theme-picker-dropdown')?.classList.contains('open')
        ), 5000, 'dropdown selects dracula');

        // Previous at 1/64 wraps around to 64/64 (zenburn), and another Previous selects yonce (63/64)
        await main.click('#theme-prev-btn');
        await waitFor(() => main.evaluate(() =>
            document.getElementById('theme-current-name')?.textContent?.trim() === 'zenburn' &&
            document.getElementById('theme-index-badge')?.textContent?.trim() === '64 / 64'
        ), 5000, 'Previous wraps from 1/64 to zenburn (64/64)');
        check('Previous wraps around from first theme (1/64) to last theme (64/64)', true);

        await main.click('#theme-prev-btn');
        await waitFor(() => main.evaluate(() => {
            const cmEl = document.querySelector('#content .code-block-wrapper .CodeMirror');
            const previewCm = document.querySelector('#settings-theme-preview .CodeMirror');
            return Boolean(
                document.getElementById('theme-current-name')?.textContent?.trim() === 'yonce' &&
                document.getElementById('theme-index-badge')?.textContent?.trim() === '63 / 64' &&
                cmEl && cmEl.classList.contains('cm-s-yonce') &&
                previewCm && previewCm.classList.contains('cm-s-yonce') &&
                getComputedStyle(cmEl).backgroundColor === 'rgb(28, 28, 28)' &&
                getComputedStyle(previewCm).backgroundColor === 'rgb(28, 28, 28)'
            );
        }), 5000, 'yonce theme applied');
        check('Previous reaches yonce (63/64) and applies authentic cm-s-yonce styling', true);
        await main.evaluate(() => closeAllModals());

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
