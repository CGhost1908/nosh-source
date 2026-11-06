// Note version history: snapshots, panel, restore, prune, rename, delete (real Electron).
const fs = require('fs');
const path = require('path');
const { sleep, waitFor, createReporter, createSandbox, launchNosh, forceExit, relevantErrors } = require('./helpers');

(async () => {
    const report = createReporter();
    const { check } = report;

    const v1 = '<h1>Doc</h1><p>version one</p><input type="checkbox" class="checklist-checkbox" checked><div class="code-block-wrapper"><textarea class="code" language="python">print(1)</textarea></div>';
    const sandbox = createSandbox({ Doc: v1 });
    const saves = sandbox.saves;
    const docPath = path.join(saves, 'Doc.nsh');
    const anHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    fs.utimesSync(docPath, anHourAgo, anHourAgo);
    const v1Mtime = Math.floor(fs.statSync(docPath).mtimeMs);
    const histDir = () => path.join(saves, '.history', 'Doc');
    const snaps = () => (fs.existsSync(histDir()) ? fs.readdirSync(histDir()).filter(f => f.endsWith('.nsh')).sort() : []);
    let s = null;

    try {
        s = await launchNosh(sandbox);
        const { main } = s;

        const dashDisplay = await main.evaluate(() => document.getElementById('history-btn')?.style.display);
        check('history button is hidden on the dashboard', dashDisplay === 'none', dashDisplay);

        await main.click('.save[data-file="Doc"]');
        await waitFor(() => main.evaluate(() => activeNoteName === 'Doc'), 10000, 'Doc opened');
        await sleep(500);
        const openDisplay = await main.evaluate(() => document.getElementById('history-btn')?.style.display);
        check('history button is visible with a note open', openDisplay === 'inline-flex', openDisplay);

        const edit = (html) => main.evaluate(async (h) => {
            content.innerHTML = h;
            hasUnsavedChanges = true;
            await saveFile();
        }, html);

        // Save #1 keeps the original (v1)
        await edit('<h1>Doc</h1><p>version two</p>');
        let list = snaps();
        check('first save keeps the original version', list.length === 1, list);
        check("snapshot is labelled with the version's own time, not the save time", list[0] === `${v1Mtime}.nsh`, { got: list[0], want: `${v1Mtime}.nsh` });
        check('snapshot content equals the overwritten file', fs.readFileSync(path.join(histDir(), list[0]), 'utf8') === v1);

        // Save #2 right away is throttled
        await edit('<h1>Doc</h1><p>version three</p>');
        check('a rapid second save is throttled (no new snapshot)', snaps().length === 1, snaps());

        // Age the snapshot; save #3 keeps version three
        const old = new Date(Date.now() - 10 * 60 * 1000);
        fs.utimesSync(path.join(histDir(), snaps()[0]), old, old);
        const v3OnDisk = fs.readFileSync(docPath, 'utf8');
        await edit('<h1>Doc</h1><p>version four</p>');
        list = snaps();
        check('a save after the interval keeps another version', list.length === 2, list);
        check('the second snapshot holds the previous save', fs.readFileSync(path.join(histDir(), list[1]), 'utf8') === v3OnDisk);

        // Unchanged save adds nothing
        const beforeNoop = snaps().length;
        await main.evaluate(async () => { hasUnsavedChanges = true; await saveFile(); });
        check('saving unchanged content adds nothing', snaps().length === beforeNoop);

        // No reload: clicking the already-open note must not reset the editor
        const preReload = await main.evaluate(() => {
            const marker = document.createElement('p');
            marker.id = 'no-reopen-marker';
            marker.textContent = 'still-open';
            content.appendChild(marker);
            content.scrollTop = 5; // touch state
            return true;
        });
        await main.click('.save[data-file="Doc"]');
        await sleep(500);
        const postReload = await main.evaluate(() => ({
            marker: !!document.getElementById('no-reopen-marker'),
            active: activeNoteName
        }));
        check('clicking the open note again does not reload the editor', preReload && postReload.marker && postReload.active === 'Doc', postReload);

        // Reopening with unsaved changes must stay silent (no Save/Discard prompt)
        await main.evaluate(() => {
            const p = document.createElement('p');
            p.id = 'draft-marker';
            p.textContent = 'draft';
            content.appendChild(p);
            hasUnsavedChanges = true;
        });
        await main.click('.save[data-file="Doc"]');
        await sleep(500);
        const draftCheck = await main.evaluate(() => ({
            marker: !!document.getElementById('draft-marker'),
            popup: document.getElementById('unsaved-modal')?.classList.contains('active'),
            unsaved: hasUnsavedChanges,
            active: activeNoteName
        }));
        check('reopening the open note with a draft stays silent (no prompt, no reload)',
            draftCheck.marker && !draftCheck.popup && draftCheck.unsaved && draftCheck.active === 'Doc', draftCheck);

        // .history must not leak into the sidebar as a folder
        await main.evaluate(() => readDatabase('Doc'));
        await sleep(600);
        const leaked = await main.evaluate(() => ({
            folderNames: (typeof vaultFolders !== 'undefined' ? vaultFolders : []).map(f => f.name),
            sidebarHasHistory: document.getElementById('saves-container').innerText.toLowerCase().includes('.history'),
            noteCount: document.querySelectorAll('.save').length
        }));
        check('.history is not treated as a folder or a note', !leaked.folderNames.includes('.history') && !leaked.sidebarHasHistory && leaked.noteCount === 1, leaked);

        // Panel via the real button
        await main.click('#history-btn');
        await waitFor(() => main.evaluate(() => document.getElementById('history-modal').classList.contains('active')), 5000, 'history modal');
        await waitFor(() => main.evaluate(() => document.querySelectorAll('#history-list .history-item').length === 2), 5000, 'list rendered');
        check('the panel lists both versions', true);
        const panel = await main.evaluate(() => ({
            name: document.getElementById('history-note-name').textContent,
            selected: document.querySelector('#history-list .history-item.active')?.dataset.id,
            restoreDisabled: document.getElementById('history-restore-btn').disabled
        }));
        check('the panel shows the note name, selects the newest, enables restore',
            panel.name === 'Doc' && panel.selected === snaps()[1].replace('.nsh', '') && !panel.restoreDisabled, panel);

        // Oldest version: the snapshot uses the note's own read-only layout.
        await main.click('#history-list .history-item:last-child');
        await sleep(300);
        const preview = await main.evaluate(() => {
            const el = document.getElementById('history-preview');
            return {
                text: el.textContent,
                rendered: !!el.querySelector('.history-rendered'),
                heading: el.querySelector('.history-rendered h1')?.textContent === 'Doc',
                checkbox: !!el.querySelector('.history-rendered .checklist-checkbox'),
                checked: !!(el.querySelector('.history-rendered .checklist-checkbox') || {}).checked || el.querySelector('.history-rendered .checklist-checkbox')?.hasAttribute('checked'),
                code: el.querySelector('.history-rendered .history-text-code')?.textContent === 'print(1)',
                hasDiff: !!el.querySelector('.history-diff'),
                added: el.querySelectorAll('.history-rendered .history-change-add').length,
                removed: el.querySelectorAll('.history-rendered .history-change-remove').length,
                addPrefix: getComputedStyle(el.querySelector('.history-change-add'), '::before').content,
                removePrefix: getComputedStyle(el.querySelector('.history-change-remove'), '::before').content,
                radius: getComputedStyle(el.querySelector('.history-change-add')).borderRadius,
                shadow: getComputedStyle(el.querySelector('.history-change-add')).boxShadow,
                zoom: getComputedStyle(el.querySelector('.history-rendered')).zoom
            };
        });
        check('preview keeps the saved note layout and highlights additions and removals',
            preview.rendered && preview.heading && preview.checkbox && preview.checked && preview.code && !preview.hasDiff && preview.added > 0 && preview.removed > 0 && preview.addPrefix === '"+"' && preview.removePrefix === '"−"' && preview.radius === '0px' && preview.shadow === 'none' && preview.zoom === '0.85', preview);

        // Restore through the UI
        const beforeRestore = snaps().length;
        await main.click('#history-restore-btn');
        await waitFor(() => fs.readFileSync(docPath, 'utf8') === v1, 10000, 'restored file');
        check('restore writes the chosen version to disk', true);
        await waitFor(() => main.evaluate(() => content.innerText.includes('version one')), 10000, 'editor refresh');
        check('restore reloads the editor with that version', true);
        check('restore keeps the replaced text as a new version (undoable)', snaps().length === beforeRestore + 1, { before: beforeRestore, after: snaps().length });
        check('the modal closes after restore', !(await main.evaluate(() => document.getElementById('history-modal').classList.contains('active'))));
        check('the note is not marked unsaved after restore', (await main.evaluate(() => hasUnsavedChanges)) === false);

        // Injection attempt in a snapshot stays inert
        await main.evaluate(() => { window.__pwned = 0; });
        fs.writeFileSync(path.join(histDir(), `${Date.now() + 5000}.nsh`), '<p>hi</p><img src="x" onerror="window.__pwned=1"><script>window.__pwned=2</script>', 'utf8');
        await main.evaluate(() => openNoteHistory());
        await waitFor(() => main.evaluate(() => document.querySelectorAll('#history-list .history-item').length >= 4), 5000, 'evil entry listed');
        await sleep(500);
        const inert = await main.evaluate(() => ({
            pwned: window.__pwned,
            scriptInPreview: !!document.querySelector('#history-preview script, #history-preview .CodeMirror'),
            text: document.getElementById('history-preview').textContent
        }));
        check('malicious snapshot is rendered inertly (no scripts, no editors, no handlers fired)',
            inert.pwned === 0 && !inert.scriptInPreview && inert.text.includes('hi'), inert);
        await main.evaluate(() => closeAllModals());

        const traversal = await main.evaluate(async () => {
            try { await readNoteSnapshot('Doc', '../../Doc'); return 'read'; } catch (e) { return 'rejected'; }
        });
        check('snapshot ids cannot traverse paths', traversal === 'rejected', traversal);

        // Pruning
        await main.evaluate(async () => {
            for (let i = 0; i < 60; i++) {
                await snapshotNote('Prune', `<p>version ${i}</p>`, { timestamp: 1700000000000 + i * 1000, force: true });
            }
        });
        const pruneFiles = fs.readdirSync(path.join(saves, '.history', 'Prune')).sort();
        check('history is capped at 50 versions per note', pruneFiles.length === 50, pruneFiles.length);
        check('pruning drops the oldest versions', pruneFiles[0] === '1700000010000.nsh' && pruneFiles.at(-1) === '1700000059000.nsh', [pruneFiles[0], pruneFiles.at(-1)]);

        // Rename moves history along
        const countBeforeRename = snaps().length;
        await main.evaluate(() => renameSave('Doc', 'Renamed'));
        await waitFor(() => fs.existsSync(path.join(saves, 'Renamed.nsh')), 10000, 'renamed note');
        const moved = fs.existsSync(path.join(saves, '.history', 'Renamed')) && !fs.existsSync(histDir());
        const renamedCount = moved ? fs.readdirSync(path.join(saves, '.history', 'Renamed')).length : 0;
        check('rename moves the history folder with the note', moved && renamedCount === countBeforeRename, { moved, renamedCount, countBeforeRename });

        // Trash keeps history; emptying it removes it
        await main.evaluate(() => deleteSave('Renamed', false));
        await sleep(800);
        check('moving to the trash keeps history', fs.existsSync(path.join(saves, '.history', 'Renamed')));
        await main.evaluate(() => emptyTrash());
        await sleep(500);
        check("emptying the trash removes that note's history", !fs.existsSync(path.join(saves, '.history', 'Renamed')));

        const noisy = relevantErrors(s.errors);
        check('no unexpected renderer errors', noisy.length === 0, noisy.slice(0, 3));
    } catch (err) {
        check('test run completed without exceptions', false, err.stack || err.message);
    } finally {
        await forceExit(s);
        process.exit(report.done() ? 1 : 0);
    }
})();
