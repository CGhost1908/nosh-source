const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { sleep, waitFor, createReporter, createSandbox, launchNosh, forceExit, relevantErrors } = require('./helpers');

// Helper to create valid zip archives in pure node
function createZipArchive(files) {
    const localHeaders = [];
    const centralHeaders = [];
    let offset = 0;

    for (const file of files) {
        const nameBuf = Buffer.from(file.name, 'utf8');
        const dataBuf = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data, 'utf8');

        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0, 6);
        local.writeUInt16LE(0, 8); // Stored
        local.writeUInt16LE(0, 10);
        local.writeUInt16LE(0, 12);
        local.writeUInt32LE(0, 14);
        local.writeUInt32LE(dataBuf.length, 18);
        local.writeUInt32LE(dataBuf.length, 22);
        local.writeUInt16LE(nameBuf.length, 26);
        local.writeUInt16LE(0, 28);

        localHeaders.push(Buffer.concat([local, nameBuf, dataBuf]));

        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(0, 8);
        central.writeUInt16LE(0, 10);
        central.writeUInt16LE(0, 12);
        central.writeUInt16LE(0, 14);
        central.writeUInt32LE(dataBuf.length, 16);
        central.writeUInt32LE(dataBuf.length, 20);
        central.writeUInt32LE(dataBuf.length, 24);
        central.writeUInt16LE(nameBuf.length, 28);
        central.writeUInt16LE(0, 30);
        central.writeUInt16LE(0, 32);
        central.writeUInt16LE(0, 34);
        central.writeUInt16LE(0, 36);
        central.writeUInt32LE(0, 38);
        central.writeUInt32LE(offset, 42);

        centralHeaders.push(Buffer.concat([central, nameBuf]));
        offset += 30 + nameBuf.length + dataBuf.length;
    }

    const localPart = Buffer.concat(localHeaders);
    const centralPart = Buffer.concat(centralHeaders);

    const endRecord = Buffer.alloc(22);
    endRecord.writeUInt32LE(0x06054b50, 0);
    endRecord.writeUInt16LE(0, 4);
    endRecord.writeUInt16LE(0, 6);
    endRecord.writeUInt16LE(files.length, 8);
    endRecord.writeUInt16LE(files.length, 10);
    endRecord.writeUInt32LE(centralPart.length, 12);
    endRecord.writeUInt32LE(localPart.length, 16);
    endRecord.writeUInt16LE(0, 20);

    return Buffer.concat([localPart, centralPart, endRecord]);
}

(async () => {
    const report = createReporter();
    const { check } = report;
    const sandbox = createSandbox();
    let s = null;

    try {
        s = await launchNosh(sandbox);
        const { main } = s;

        // 1. Dashboard displays clean welcome view
        const hasDashboard = await main.evaluate(() => Boolean(document.querySelector('.welcome-dashboard')));
        check('dashboard displays clean welcome view', hasDashboard);

        // 2. Test Markdown paste styling fidelity (tables, callout boxes, KaTeX math, headers)
        const mdText = [
            '# Test Fuzzy Logic Document',
            '',
            'Introductory paragraph with **bold text** and `inline code`.',
            '',
            '| Operation | Rule | Output Type |',
            '| --- | --- | --- |',
            '| Height hgt(A) | max(mu_A(x)) | Number |',
            '| Normalization | Divide by hgt | Fuzzy Set |',
            '',
            '> **Dikkat:** This is an important warning callout box with special notes.',
            '',
            '> [!NOTE] Here is a standard note callout',
            '',
            '```latex',
            '\\mu_A(x) = \\frac{1}{1 + x^2}',
            '```'
        ].join('\n');

        const pasteTestResult = await main.evaluate(async (text) => {
            await createNewFile();
            const handled = handleSmartEditorPaste({ text, html: '', plainOnly: false });
            const editorEl = document.getElementById('content');
            return {
                handled,
                hasH1: Boolean(editorEl.querySelector('h1')),
                h1Text: editorEl.querySelector('h1')?.textContent,
                hasTable: Boolean(editorEl.querySelector('.table-container table')),
                tableRows: editorEl.querySelectorAll('table tr').length,
                hasCalloutWarning: Boolean(editorEl.querySelector('.callout-box.callout-warning')),
                hasCalloutInfo: Boolean(editorEl.querySelector('.callout-box.callout-info')),
                hasMathBlock: Boolean(editorEl.querySelector('.math-formula-block'))
            };
        }, mdText);

        check('pasted markdown produces 1:1 styles (h1 title, scrollable table, callouts, latex math)',
            pasteTestResult.handled &&
            pasteTestResult.hasH1 &&
            pasteTestResult.h1Text.includes('Test Fuzzy Logic Document') &&
            pasteTestResult.hasTable &&
            pasteTestResult.tableRows === 3 &&
            pasteTestResult.hasCalloutWarning &&
            pasteTestResult.hasCalloutInfo &&
            pasteTestResult.hasMathBlock,
            pasteTestResult);

        // Save any pending edits before importing so editor can switch notes
        await main.evaluate(async () => {
            await saveFile();
            hasUnsavedChanges = false;
        });

        // 3. Test dropped markdown file import via importDroppedFilesToVault
        const sampleMdFile = path.join(sandbox.tmp, 'Sample Dropped Note.md');
        fs.writeFileSync(sampleMdFile, '# Sample Dropped Note\n\nContent inside the dropped file.', 'utf8');

        const dropResult = await main.evaluate(async (filePath) => {
            const fileObj = {
                name: 'Sample Dropped Note.md',
                path: filePath
            };
            const ok = await window.importDroppedFilesToVault([fileObj]);
            return {
                ok,
                activeNote: activeNoteName
            };
        }, sampleMdFile);

        check('importDroppedFilesToVault imports .md file and opens it',
            dropResult.ok && dropResult.activeNote === 'Sample Dropped Note', dropResult);

        // Save any pending edits before importing next
        await main.evaluate(async () => {
            await saveFile();
            hasUnsavedChanges = false;
        });

        // 4. Test Notion ZIP import with CSV database and images
        const notionZipPath = path.join(sandbox.tmp, 'Notion Export Test.zip');
        const zipBuffer = createZipArchive([
            {
                name: 'Overview Page 12345.md',
                data: '# Notion Overview\n\nWelcome to our Notion workspace export.\n\n![diagram](photo.png)\n\nRelated page: [Project Specs](Project%20Specs%2099999.md)'
            },
            {
                name: 'photo.png',
                data: Buffer.from('FAKEPNGDATA')
            },
            {
                name: 'Task Board 67890.csv',
                data: 'Task,Assignee,Status\n"Finish Architecture",Berkay,Done\n"Run E2E Suite",Antigravity,"In Progress"'
            }
        ]);
        fs.writeFileSync(notionZipPath, zipBuffer);

        const notionImportResult = await main.evaluate(async (zipPath) => {
            const fileObj = {
                name: 'Notion Export Test.zip',
                path: zipPath
            };
            const ok = await window.importDroppedFilesToVault([fileObj]);
            return {
                ok,
                activeNote: activeNoteName
            };
        }, notionZipPath);

        const assetsFolder = path.join(sandbox.saves, 'assets');
        const hasAsset = fs.existsSync(assetsFolder) && fs.readdirSync(assetsFolder).length > 0;

        check('Notion .zip import extracts multi-page notes, CSV tables, and images',
            notionImportResult.ok && hasAsset,
            { notionImportResult, hasAsset, assets: fs.existsSync(assetsFolder) ? fs.readdirSync(assetsFolder) : [] });

        // 5. Test First Header Protection on imported note
        const headerProtectionResult = await main.evaluate(async () => {
            const editorEl = document.getElementById('content');
            const firstH1 = editorEl.querySelector('h1');
            const originalTitle = firstH1.textContent;

            // Attempt to backspace or clear the header
            firstH1.textContent = '';
            // Trigger sync
            await syncFirstHeaderToNoteName({ immediate: true, restoreIfEmpty: true });

            return {
                originalTitle,
                restoredTitle: firstH1.textContent,
                isRestored: Boolean(firstH1.textContent && firstH1.textContent.trim())
            };
        });

        check('first header cannot be deleted and stays synchronized',
            headerProtectionResult.isRestored, headerProtectionResult);

        // Check for renderer errors
        const errors = relevantErrors(await main.evaluate(() => window._e2eErrors || []));
        check('no unexpected renderer errors', errors.length === 0, errors);

    } catch (err) {
        console.error('Test error:', err);
        check('test executed without unhandled exception', false, err.message);
    } finally {
        if (s) {
            await forceExit(s);
        }
        process.exit(report.done() ? 1 : 0);
    }
})();
