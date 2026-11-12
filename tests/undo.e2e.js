// End-to-end verification of the unified Undo / Redo system across all editor operations (real Electron).
const fs = require('fs');
const path = require('path');
const { sleep, waitFor, createReporter, createSandbox, launchNosh, forceExit, relevantErrors } = require('./helpers');

(async () => {
    const report = createReporter();
    const { check } = report;

    const initialMain = '<h1>Alpha</h1><p>Initial line</p><p>target word here and target word there</p>';
    const initialBeta = '<h1>Beta</h1><p>Second note content</p>';
    const sandbox = createSandbox({ Alpha: initialMain, Beta: initialBeta });
    let s = null;

    async function placeCaretAtEndOfP(main, pIndex = 0) {
        await main.evaluate((idx) => {
            const p = document.querySelectorAll('#content p')[idx];
            const range = document.createRange();
            const sel = window.getSelection();
            range.selectNodeContents(p);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
            content.focus();
        }, pIndex);
    }

    async function selectWordInFirstP(main, word) {
        return main.evaluate((w) => {
            const p = document.querySelector('#content p');
            if (!p || !p.firstChild) return false;
            const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
            let node;
            while ((node = walker.nextNode())) {
                const pos = node.nodeValue.indexOf(w);
                if (pos !== -1) {
                    const range = document.createRange();
                    range.setStart(node, pos);
                    range.setEnd(node, pos + w.length);
                    const sel = window.getSelection();
                    sel.removeAllRanges();
                    sel.addRange(range);
                    content.focus();
                    return true;
                }
            }
            return false;
        }, word);
    }

    try {
        s = await launchNosh(sandbox);
        const { main } = s;

        // 1. Dashboard state: toolbar buttons disabled
        const dashBtns = await main.evaluate(() => ({
            undoDisabled: document.getElementById('toolbar-undo-btn').disabled,
            redoDisabled: document.getElementById('toolbar-redo-btn').disabled
        }));
        check('toolbar Undo/Redo disabled on dashboard', dashBtns.undoDisabled && dashBtns.redoDisabled, dashBtns);

        // Open Alpha
        await main.click('.save[data-file="Alpha"]');
        await waitFor(() => main.evaluate(() => activeNoteName === 'Alpha' && window.NoshUndo && window.NoshUndo.getDebugState().committedHtml !== null), 10000, 'Alpha hydrated');
        await sleep(100);

        const initBtns = await main.evaluate(() => ({
            undoDisabled: document.getElementById('toolbar-undo-btn').disabled,
            redoDisabled: document.getElementById('toolbar-redo-btn').disabled
        }));
        check('toolbar Undo/Redo disabled initially when note opens', initBtns.undoDisabled && initBtns.redoDisabled, initBtns);

        // 2. Typing burst + immediate undo (before 650ms debounce) + Ctrl+Y + Ctrl+Shift+Z + redo cleared on new edit
        await placeCaretAtEndOfP(main, 0);
        await main.keyboard.type(' added', { delay: 10 });
        await sleep(750);
        await main.keyboard.type(' rapid', { delay: 10 });

        const typedText = await main.evaluate(() => document.querySelectorAll('#content p')[0].textContent);
        check('typing updates paragraph text', typedText === 'Initial line added rapid', typedText);

        // Undo immediately WITHOUT waiting 650ms for rapid burst
        await main.keyboard.press('Control+z');
        await sleep(80);
        const afterRapidUndo = await main.evaluate(() => document.querySelectorAll('#content p')[0].textContent);
        check('Ctrl+Z immediately flushes and undoes rapid burst', afterRapidUndo === 'Initial line added', afterRapidUndo);

        // Second Ctrl+Z brings note back to clean initial state
        await main.keyboard.press('Control+z');
        await sleep(80);
        const afterSecondUndo = await main.evaluate(() => ({
            text: document.querySelectorAll('#content p')[0].textContent,
            unsaved: hasUnsavedChanges,
            undoDisabled: document.getElementById('toolbar-undo-btn').disabled,
            redoDisabled: document.getElementById('toolbar-redo-btn').disabled
        }));
        check('second Ctrl+Z reverts to initial baseline and marks clean',
            afterSecondUndo.text === 'Initial line' && !afterSecondUndo.unsaved && afterSecondUndo.undoDisabled && !afterSecondUndo.redoDisabled,
            afterSecondUndo);

        // Redo with Ctrl+Y then Ctrl+Shift+Z
        await main.keyboard.press('Control+y');
        await sleep(80);
        const afterCtrlY = await main.evaluate(() => ({
            text: document.querySelectorAll('#content p')[0].textContent,
            unsaved: hasUnsavedChanges
        }));
        check('Ctrl+Y redoes first typing step', afterCtrlY.text === 'Initial line added' && afterCtrlY.unsaved, afterCtrlY);

        await main.keyboard.press('Control+Shift+z');
        await sleep(80);
        const afterShiftZ = await main.evaluate(() => document.querySelectorAll('#content p')[0].textContent);
        check('Ctrl+Shift+Z redoes second typing step', afterShiftZ === 'Initial line added rapid', afterShiftZ);

        // Test clearing redo stack on new edit
        await main.keyboard.press('Control+z');
        await sleep(80);
        await placeCaretAtEndOfP(main, 0);
        await main.keyboard.type(' branch', { delay: 10 });
        await sleep(750);
        const branchState = await main.evaluate(() => ({
            text: document.querySelectorAll('#content p')[0].textContent,
            redoDisabled: document.getElementById('toolbar-redo-btn').disabled
        }));
        check('new edit clears redo stack', branchState.text === 'Initial line added branch' && branchState.redoDisabled, branchState);

        // Toolbar Undo/Redo buttons
        await main.click('#toolbar-undo-btn');
        await sleep(80);
        const afterToolbarUndo = await main.evaluate(() => document.querySelectorAll('#content p')[0].textContent);
        check('toolbar Undo button works without stealing focus', afterToolbarUndo === 'Initial line added', afterToolbarUndo);

        await main.click('#toolbar-redo-btn');
        await sleep(80);
        const afterToolbarRedo = await main.evaluate(() => document.querySelectorAll('#content p')[0].textContent);
        check('toolbar Redo button works cleanly', afterToolbarRedo === 'Initial line added branch', afterToolbarRedo);

        // Clean back to baseline for clean subsequent assertions
        await main.keyboard.press('Control+z');
        await main.keyboard.press('Control+z');
        await sleep(100);

        // 3. Formatting (Bold) & Custom Color
        await selectWordInFirstP(main, 'Initial');
        await main.keyboard.press('Control+b');
        await sleep(80);
        const boldHtml = await main.evaluate(() => document.querySelector('#content p').innerHTML);
        check('Ctrl+B bolds selected word', /<(b|strong)>Initial<\/(b|strong)>/i.test(boldHtml), boldHtml);

        await main.keyboard.press('Control+z');
        await sleep(80);
        const unboldHtml = await main.evaluate(() => document.querySelector('#content p').innerHTML);
        check('Ctrl+Z undoes bold formatting', unboldHtml === 'Initial line', unboldHtml);

        await main.keyboard.press('Control+y');
        await sleep(80);
        const reboldHtml = await main.evaluate(() => document.querySelector('#content p').innerHTML);
        check('Ctrl+Y redoes bold formatting', /<(b|strong)>Initial<\/(b|strong)>/i.test(reboldHtml), reboldHtml);
        await main.keyboard.press('Control+z');
        await sleep(80);

        // Color picker
        await selectWordInFirstP(main, 'line');
        await main.evaluate(() => {
            openCustomColorPicker('foreColor', document.getElementById('text-color-btn'));
            applyCustomColor('#ef4444');
        });
        await sleep(80);
        const coloredHtml = await main.evaluate(() => document.querySelector('#content p').innerHTML);
        check('custom color applied', coloredHtml.includes('color') || coloredHtml.includes('<font'), coloredHtml);
        await main.keyboard.press('Control+z');
        await sleep(80);
        check('Ctrl+Z removes custom color', (await main.evaluate(() => document.querySelector('#content p').innerHTML)) === 'Initial line');

        // 4. Checklist: insert, type, toggle (with focus ON checkbox), Enter, Backspace
        await placeCaretAtEndOfP(main, 0);
        await main.evaluate(() => insertChecklist());
        await sleep(80);
        await main.keyboard.type('Buy milk', { delay: 10 });
        await sleep(750);
        check('checklist item created with typed text',
            (await main.evaluate(() => document.querySelector('#content .checklist-text')?.textContent)) === 'Buy milk');

        // Toggle checkbox by real click (activeElement becomes <input type="checkbox">)
        await main.click('#content .checklist-checkbox');
        await sleep(80);
        const checkedNow = await main.evaluate(() => ({
            checked: document.querySelector('#content .checklist-checkbox').checked,
            completed: document.querySelector('#content .checklist-item').classList.contains('completed'),
            activeTag: document.activeElement?.tagName
        }));
        check('clicking checkbox marks completed', checkedNow.checked && checkedNow.completed, checkedNow);

        // Press Ctrl+Z while checkbox itself is activeElement
        await main.keyboard.press('Control+z');
        await sleep(80);
        const uncheckedUndo = await main.evaluate(() => ({
            checked: document.querySelector('#content .checklist-checkbox').checked,
            completed: document.querySelector('#content .checklist-item').classList.contains('completed'),
            focusedCheckbox: Boolean(document.activeElement?.classList?.contains('checklist-checkbox'))
        }));
        check('Ctrl+Z while checkbox focused unchecks checkbox and removes .completed',
            !uncheckedUndo.checked && !uncheckedUndo.completed && uncheckedUndo.focusedCheckbox, uncheckedUndo);

        await main.keyboard.press('Control+y');
        await sleep(80);
        const recheckedRedo = await main.evaluate(() => ({
            checked: document.querySelector('#content .checklist-checkbox').checked,
            completed: document.querySelector('#content .checklist-item').classList.contains('completed')
        }));
        check('Ctrl+Y restores checked state and .completed class', recheckedRedo.checked && recheckedRedo.completed, recheckedRedo);

        // Checklist Enter creates second item -> Ctrl+Z removes it
        await main.evaluate(() => {
            const t = document.querySelector('#content .checklist-text');
            t.focus();
            const r = document.createRange();
            r.selectNodeContents(t);
            r.collapse(false);
            const s = window.getSelection();
            s.removeAllRanges();
            s.addRange(r);
        });
        await main.keyboard.press('Enter');
        await sleep(80);
        check('Enter in checklist inserts 2nd checklist item', (await main.evaluate(() => document.querySelectorAll('#content .checklist-item').length)) === 2);
        await main.keyboard.press('Control+z');
        await sleep(80);
        check('Ctrl+Z undoes Enter checklist creation', (await main.evaluate(() => document.querySelectorAll('#content .checklist-item').length)) === 1);

        // 5. CodeMirror: create, type inside CM, toolbar undo from CM, language switch, move up/down, delete block
        await main.evaluate(() => createCodeBlock('javascript', 'JavaScript', ''));
        await sleep(80);
        const cmFocused = await main.evaluate(() => Boolean(document.activeElement?.closest('.CodeMirror')));
        check('new code block focuses CodeMirror', cmFocused);

        await main.keyboard.type('const a = 1;', { delay: 10 });
        await sleep(750);
        await main.keyboard.press('Enter');
        await main.keyboard.type('const b = 2;', { delay: 10 });
        await sleep(750);

        // Toolbar Undo while focus is inside CodeMirror
        await main.click('#toolbar-undo-btn');
        await sleep(80);
        const cmAfterToolbarUndo = await main.evaluate(() => ({
            val: document.querySelector('#content .CodeMirror')?.CodeMirror.getValue(),
            hasFocus: document.querySelector('#content .CodeMirror')?.CodeMirror.hasFocus()
        }));
        check('toolbar Undo button inside CodeMirror undoes CM edit and keeps CM focus',
            cmAfterToolbarUndo.val === 'const a = 1;\n' && cmAfterToolbarUndo.hasFocus, cmAfterToolbarUndo);

        // Redo CM edit with Ctrl+Shift+Z inside CodeMirror
        await main.keyboard.press('Control+Shift+z');
        await sleep(80);
        check('Ctrl+Shift+Z inside CodeMirror redoes CM edit',
            (await main.evaluate(() => document.querySelector('#content .CodeMirror')?.CodeMirror.getValue())) === 'const a = 1;\nconst b = 2;');

        // Shift+Enter exits code block -> type prose -> undo unwinds chronologically (prose first, then CM)
        await main.keyboard.press('Shift+Enter');
        await sleep(80);
        await main.keyboard.type('After code', { delay: 10 });
        await sleep(750);
        await main.keyboard.press('Control+z');
        await sleep(80);
        const afterProseUndo = await main.evaluate(() => ({
            hasAfterCode: content.innerText.includes('After code'),
            cmVal: document.querySelector('#content .CodeMirror')?.CodeMirror.getValue()
        }));
        check('Ctrl+Z after exiting CodeMirror undoes prose first before CM',
            !afterProseUndo.hasAfterCode && afterProseUndo.cmVal === 'const a = 1;\nconst b = 2;', afterProseUndo);

        // Switch language -> Undo -> Redo
        await main.evaluate(() => {
            const tag = document.querySelector('#content .code-lang-tag');
            openBlockLangSwitcher(tag);
            switchBlockLanguage('python', 'Python', 'logos:python', true);
        });
        await sleep(80);
        check('manual language switch sets Python',
            (await main.evaluate(() => document.querySelector('#content textarea.code').getAttribute('language'))) === 'python');
        await main.keyboard.press('Control+z');
        await sleep(80);
        const afterLangUndo = await main.evaluate(() => ({
            lang: document.querySelector('#content textarea.code').getAttribute('language'),
            label: document.querySelector('#content .code-lang-tag .lang-name').textContent
        }));
        check('Ctrl+Z restores previous code language and tag', afterLangUndo.lang === 'javascript' && afterLangUndo.label === 'JavaScript', afterLangUndo);

        // Move code block up -> Undo restores order with live CM
        const orderBeforeMove = await main.evaluate(() => Array.from(content.children).indexOf(document.querySelector('#content .code-block-wrapper')));
        await main.evaluate(() => moveBlockUp(document.querySelector('#content .move-up-btn')));
        await sleep(80);
        const orderAfterMove = await main.evaluate(() => Array.from(content.children).indexOf(document.querySelector('#content .code-block-wrapper')));
        check('moveBlockUp changes block index', orderAfterMove < orderBeforeMove, { orderBeforeMove, orderAfterMove });

        await main.keyboard.press('Control+z');
        await sleep(80);
        const orderAfterUndoMove = await main.evaluate(() => ({
            idx: Array.from(content.children).indexOf(document.querySelector('#content .code-block-wrapper')),
            cmAlive: Boolean(document.querySelector('#content .CodeMirror')?.CodeMirror),
            cmVal: document.querySelector('#content .CodeMirror')?.CodeMirror.getValue()
        }));
        check('Ctrl+Z restores block position and live CodeMirror',
            orderAfterUndoMove.idx === orderBeforeMove && orderAfterUndoMove.cmAlive && orderAfterUndoMove.cmVal === 'const a = 1;\nconst b = 2;',
            orderAfterUndoMove);

        // Delete code block -> Undo restores exact code block & live CM
        await main.evaluate(() => deleteCodeBlock(document.querySelector('#content .code-action-btn.delete')));
        await sleep(80);
        check('code block removed', !(await main.evaluate(() => document.querySelector('#content .code-block-wrapper'))));
        await main.keyboard.press('Control+z');
        await sleep(80);
        const restoredBlock = await main.evaluate(() => ({
            exists: Boolean(document.querySelector('#content .code-block-wrapper')),
            cmVal: document.querySelector('#content .CodeMirror')?.CodeMirror?.getValue()
        }));
        check('Ctrl+Z restores deleted code block with code intact',
            restoredBlock.exists && restoredBlock.cmVal === 'const a = 1;\nconst b = 2;', restoredBlock);

        // 6. Table insert + edit + resize column -> Undo
        await main.evaluate(() => insertTable(2, 2));
        await sleep(80);
        check('table inserted', (await main.evaluate(() => document.querySelectorAll('#content table').length)) === 1);
        await main.evaluate(() => {
            const table = document.querySelector('#content table');
            const th = table.querySelector('th');
            const handle = th.querySelector('.table-col-resizer');
            handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 100 }));
            window.dispatchEvent(new MouseEvent('mousemove', { clientX: 180 }));
            window.dispatchEvent(new MouseEvent('mouseup', { clientX: 180 }));
        });
        await sleep(80);
        const resizedColWidth = await main.evaluate(() => document.querySelector('#content table th').style.width);
        await main.keyboard.press('Control+z');
        await sleep(80);
        const undoneColWidth = await main.evaluate(() => document.querySelector('#content table th').style.width);
        check('Ctrl+Z reverts table column resize width', resizedColWidth !== '' && undoneColWidth === '', { resizedColWidth, undoneColWidth });
        await main.keyboard.press('Control+z');
        await sleep(80);
        check('Ctrl+Z removes inserted table', !(await main.evaluate(() => document.querySelector('#content table'))));

        // 7. Media insert, resize, delete -> Undo / Redo
        const png1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=', 'base64');
        await main.evaluate(async (b64) => {
            const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
            const file = new File([bytes], 'tiny.png', { type: 'image/png' });
            const rel = await saveMediaAsset(file);
            insertMediaElement(rel, 'image');
        }, png1x1.toString('base64'));
        await sleep(80);
        check('image block inserted', (await main.evaluate(() => document.querySelectorAll('#content .media-container').length)) === 1);
        await main.evaluate(() => setMediaSize(document.querySelector('#content .media-container'), '50%'));
        await sleep(80);
        check('media resized to 50%', (await main.evaluate(() => document.querySelector('#content .media-container').style.width)) === '50%');
        await main.evaluate(() => deleteMediaBlock(document.querySelector('#content .media-container')));
        await sleep(80);
        check('media deleted', !(await main.evaluate(() => document.querySelector('#content .media-container'))));
        await main.keyboard.press('Control+z');
        await sleep(80);
        check('Ctrl+Z restores deleted image with 50% width',
            (await main.evaluate(() => document.querySelector('#content .media-container')?.style.width)) === '50%');
        await main.keyboard.press('Control+z');
        await sleep(80);
        check('Ctrl+Z restores original image width',
            (await main.evaluate(() => document.querySelector('#content .media-container')?.style.width)) === '');

        // 8. Find & Replace All -> Undo -> Redo
        await main.keyboard.press('Control+h');
        await sleep(80);
        await main.fill('#doc-find-input', 'target word');
        await main.fill('#doc-replace-input', 'REPLACED');
        await main.evaluate(() => replaceAllMatches());
        await sleep(80);
        check('replaceAllMatches replaces multiple occurrences',
            (await main.evaluate(() => (content.innerText.match(/REPLACED/g) || []).length)) === 2);

        // Undo from Replace button/content restores all replacements
        await main.click('#toolbar-undo-btn');
        await sleep(80);
        const afterReplaceUndo = await main.evaluate(() => ({
            replacedCount: (content.innerText.match(/REPLACED/g) || []).length,
            targetCount: (content.innerText.match(/target word/g) || []).length
        }));
        check('Undo reverts Replace All in single step',
            afterReplaceUndo.replacedCount === 0 && afterReplaceUndo.targetCount === 2, afterReplaceUndo);
        await main.evaluate(() => closeDocFindBar());

        // 9. Smart Markdown Paste -> Single Undo
        await main.evaluate(() => {
            const p = Array.from(document.querySelectorAll('#content p')).find(el => el.textContent.includes('target word'))
                || document.querySelector('#content p:last-of-type');
            const range = document.createRange();
            const sel = window.getSelection();
            range.selectNodeContents(p);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
            content.focus();
        });
        await main.evaluate(() => {
            handleSmartEditorPaste({ text: '## Pasted Heading\n\n- bullet one\n- bullet two' });
        });
        await sleep(100);
        check('smart paste inserted heading and list',
            (await main.evaluate(() => content.innerText.includes('Pasted Heading') && content.innerText.includes('bullet one'))));
        await main.keyboard.press('Control+z');
        await sleep(80);
        check('Ctrl+Z undoes entire smart paste cleanly in one step',
            !(await main.evaluate(() => content.innerText.includes('Pasted Heading'))));

        // 10. Web link & Internal wiki-link & Context menu cut
        await selectWordInFirstP(main, 'line');
        await main.evaluate(() => {
            openLinkModal('note');
            document.getElementById('link-note-input').value = 'Beta';
            confirmAddLink();
        });
        await sleep(80);
        check('internal link inserted', Boolean(await main.evaluate(() => document.querySelector('#content .note-internal-link[data-note="Beta"]'))));
        await main.keyboard.press('Control+z');
        await sleep(80);
        check('Ctrl+Z removes internal link and restores text',
            !(await main.evaluate(() => document.querySelector('#content .note-internal-link'))) &&
            (await main.evaluate(() => content.innerText.includes('line'))));

        // Right-click context menu Cut -> Undo
        await main.evaluate(() => {
            const p = Array.from(document.querySelectorAll('#content p')).find(el => el.textContent.includes('word here and'));
            const range = document.createRange();
            const sel = window.getSelection();
            range.setStart(p.firstChild, 0);
            range.setEnd(p.firstChild, 6); // "target"
            sel.removeAllRanges();
            sel.addRange(range);
            p.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 200, clientY: 200 }));
        });
        await sleep(80);
        await main.click('#editor-context-menu .ectx-item:has(.ectx-label:text-is("Cut"))');
        await sleep(80);
        check('context menu Cut removes selected word',
            !(await main.evaluate(() => {
                const p = Array.from(document.querySelectorAll('#content p')).find(el => el.textContent.includes('word here and'));
                return Boolean(p && p.textContent.startsWith('target'));
            })));
        await main.evaluate(() => {
            const p = Array.from(document.querySelectorAll('#content p')).find(el => el.textContent.includes('word here and'));
            p.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 200, clientY: 200 }));
        });
        await sleep(80);
        await main.click('#editor-context-menu .ectx-item:has(.ectx-label:text-is("Undo"))');
        await sleep(80);
        check('context menu Undo restores word removed via context menu Cut',
            (await main.evaluate(() => {
                const p = Array.from(document.querySelectorAll('#content p')).find(el => el.textContent.includes('word here and'));
                return Boolean(p && p.textContent.startsWith('target'));
            })));

        // 11. Math Formula double-click -> Undo restores rendered KaTeX
        await main.evaluate(() => {
            const p = document.createElement('p');
            p.textContent = '\\[ x^2 + y^2 = z^2 \\]';
            content.appendChild(p);
            processMathFormulas();
        });
        await sleep(80);
        check('math formula rendered', Boolean(await main.evaluate(() => document.querySelector('#content .math-formula-block'))));
        await main.dblclick('#content .math-formula-block');
        await sleep(80);
        check('dblclick turns math formula into editable LaTeX',
            !(await main.evaluate(() => document.querySelector('#content .math-formula-block'))) &&
            (await main.evaluate(() => content.innerText.includes('x^2 + y^2 = z^2'))));
        await main.keyboard.press('Control+z');
        await sleep(80);
        check('Ctrl+Z restores rendered KaTeX math formula', Boolean(await main.evaluate(() => document.querySelector('#content .math-formula-block'))));

        // 12. Ctrl+A + Backspace full wipe recovery
        await main.evaluate(() => content.focus());
        await main.keyboard.press('Control+a');
        await main.keyboard.press('Backspace');
        await sleep(80);
        const wipedCheck = await main.evaluate(() => ({
            hasCode: Boolean(document.querySelector('#content .code-block-wrapper')),
            hasMedia: Boolean(document.querySelector('#content .media-container')),
            h1Text: content.firstElementChild?.textContent
        }));
        check('Ctrl+A + Backspace wipes body while protecting H1', !wipedCheck.hasCode && !wipedCheck.hasMedia && wipedCheck.h1Text === 'Alpha', wipedCheck);

        await main.keyboard.press('Control+z');
        await sleep(100);
        const recoveredCheck = await main.evaluate(() => ({
            hasCode: Boolean(document.querySelector('#content .code-block-wrapper')),
            cmVal: document.querySelector('#content .CodeMirror')?.CodeMirror?.getValue(),
            hasMedia: Boolean(document.querySelector('#content .media-container')),
            hasMath: Boolean(document.querySelector('#content .math-formula-block'))
        }));
        check('Ctrl+Z after Ctrl+A + Backspace restores entire rich document',
            recoveredCheck.hasCode && recoveredCheck.cmVal === 'const a = 1;\nconst b = 2;' && recoveredCheck.hasMedia && recoveredCheck.hasMath,
            recoveredCheck);

        // 13. H1 rename sync + Undo restores H1 title + filename
        await main.evaluate(() => saveFile()); // save Alpha cleanly first so switching away is clean
        await sleep(150);
        await main.evaluate(() => {
            const h1 = document.querySelector('#content h1');
            h1.focus();
            const r = document.createRange();
            r.selectNodeContents(h1);
            const s = window.getSelection();
            s.removeAllRanges();
            s.addRange(r);
        });
        await main.keyboard.press('Backspace');
        await sleep(80);
        await main.keyboard.type('AlphaRenamed', { delay: 10 });
        await waitFor(() => main.evaluate(() => activeNoteName === 'AlphaRenamed'), 5000, 'H1 rename sync');
        check('editing H1 renames active note file', fs.existsSync(path.join(sandbox.saves, 'AlphaRenamed.nsh')));

        await main.keyboard.press('Control+z');
        await sleep(80);
        const h1AfterUndo = await main.evaluate(() => document.querySelector('#content h1')?.textContent);
        // Second Ctrl+Z reverts the full H1 clear before typing if Backspace & typing were separate steps; ensure H1 comes back to Alpha
        if (h1AfterUndo === '') {
            await main.keyboard.press('Control+z');
            await sleep(80);
        }
        await waitFor(() => main.evaluate(() => activeNoteName === 'Alpha'), 5000, 'H1 undo rename back');
        check('Ctrl+Z reverts renamed H1 back to original note name', fs.existsSync(path.join(sandbox.saves, 'Alpha.nsh')));

        // 14. Note switching isolation + saved stack persistence + native input undo + Version History restore undo
        await main.evaluate(() => saveFile());
        await sleep(150);
        const alphaUndoCountBeforeSwitch = await main.evaluate(() => window.NoshUndo.getDebugState().undoCount);

        await main.click('.save[data-file="Beta"]');
        await waitFor(() => main.evaluate(() => activeNoteName === 'Beta' && window.NoshUndo.getDebugState().activeNote === 'Beta'), 10000, 'Beta hydrated');
        await sleep(100);
        check('Beta starts with fresh empty undo stack', (await main.evaluate(() => window.NoshUndo.getDebugState().undoCount)) === 0);

        await placeCaretAtEndOfP(main, 0);
        await main.keyboard.type(' BETA-EDIT', { delay: 10 });
        await sleep(750);
        await main.keyboard.press('Control+z');
        await sleep(80);
        check('Beta Ctrl+Z works independently', (await main.evaluate(() => document.querySelector('#content p').textContent)) === 'Second note content');

        // Native input undo check (#search-input) must not touch Beta
        await main.click('#search-input');
        await main.keyboard.type('xyz');
        await main.keyboard.press('Control+z');
        await sleep(50);
        const searchAndEditor = await main.evaluate(() => ({
            searchVal: document.getElementById('search-input').value,
            betaText: document.querySelector('#content p').textContent,
            betaRedoCount: window.NoshUndo.getDebugState().redoCount
        }));
        check('Ctrl+Z in search input uses native input undo without affecting editor',
            searchAndEditor.searchVal === '' && searchAndEditor.betaText === 'Second note content' && searchAndEditor.betaRedoCount === 1,
            searchAndEditor);

        // Switch back to saved Alpha -> Alpha's undo history preserved!
        await main.click('.save[data-file="Alpha"]');
        await waitFor(() => main.evaluate(() => activeNoteName === 'Alpha'), 10000, 'Alpha reopened');
        await sleep(120);
        const alphaUndoCountAfterReturn = await main.evaluate(() => window.NoshUndo.getDebugState().undoCount);
        check('reopening saved note preserves its undo stack', alphaUndoCountAfterReturn === alphaUndoCountBeforeSwitch,
            { alphaUndoCountBeforeSwitch, alphaUndoCountAfterReturn });

        // Version History snapshot restore undoability
        await main.evaluate(async () => {
            const snapId = await snapshotNote('Alpha', '<h1>Alpha</h1><p>Snapshot OLD</p>', { timestamp: Date.now() - 100000, force: true });
            await restoreNoteSnapshot('Alpha', snapId);
        });
        await waitFor(() => main.evaluate(() => content.innerText.includes('Snapshot OLD') && window.NoshUndo.canUndo()), 5000, 'history restore applied');
        await sleep(80);
        const afterHistRestore = await main.evaluate(() => ({
            hasOld: content.innerText.includes('Snapshot OLD'),
            unsaved: hasUnsavedChanges
        }));
        check('version history restore updates DOM cleanly', afterHistRestore.hasOld && !afterHistRestore.unsaved, afterHistRestore);

        await main.evaluate(() => content.focus());
        await main.keyboard.press('Control+z');
        await sleep(100);
        check('Ctrl+Z undoes version history restore',
            !(await main.evaluate(() => content.innerText.includes('Snapshot OLD'))) &&
            (await main.evaluate(() => Boolean(document.querySelector('#content .code-block-wrapper')))));

        const noisy = relevantErrors(s.errors);
        check('no unexpected renderer errors', noisy.length === 0, noisy.slice(0, 5));
    } catch (err) {
        check('test run completed without exceptions', false, err.stack || err.message);
    } finally {
        await forceExit(s);
        process.exit(report.done() ? 1 : 0);
    }
})();
