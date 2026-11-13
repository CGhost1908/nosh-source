// Sidebar hover note preview: intent delay, rich sanitized render, click-through open, cache invalidation, and settings toggle (real Electron).
const fs = require('fs');
const path = require('path');
const { sleep, waitFor, createReporter, createSandbox, launchNosh, forceExit, relevantErrors } = require('./helpers');

(async () => {
    const report = createReporter();
    const { check } = report;

    const longParagraphs = Array.from({ length: 24 }, (_, idx) => `<p>Long scroll paragraph #${idx + 1} with extra detail.</p>`).join('');
    const sandbox = createSandbox({
        Alpha: '<h1>Alpha</h1><p>First note body with <strong>important</strong> summary.</p><div class="code-block-wrapper"><div class="code-block-header"><span class="code-lang-tag">Python</span></div><textarea class="code" language="python" data-label="Python">def hello():\n    return 42</textarea></div><script>window.__xssProbe = true;</script>',
        Beta: '<h1>Beta</h1><div class="checklist-item"><input type="checkbox" class="checklist-checkbox" checked><span class="checklist-text">Ship preview card</span></div><p>Second note paragraph.</p>',
        LongNote: `<h1>LongNote</h1>${longParagraphs}<p>LONG-END-MARKER</p>`,
        BlankDoc: '<h1>BlankDoc</h1><p><br></p>'
    });

    let s = null;

    try {
        s = await launchNosh(sandbox);
        const { main } = s;

        // 1. Hovering Alpha: should wait for intent delay before appearing
        const alphaBox = await main.locator('.save[data-file="Alpha"]').boundingBox();
        check('sidebar note item Alpha is rendered', Boolean(alphaBox));
        await main.mouse.move(alphaBox.x + alphaBox.width / 2, alphaBox.y + alphaBox.height / 2);
        await sleep(140);
        const earlyVisible = await main.evaluate(() => window.NoshSidebarPreview?.isVisible() === true);
        check('preview does not flash immediately before hover delay', earlyVisible === false, earlyVisible);

        // 2. Wait for preview to appear with sanitized rich content
        await waitFor(() => main.evaluate(() => window.NoshSidebarPreview?.isVisible() === true), 3000, 'hover preview visible');
        const alphaState = await main.evaluate(() => {
            const card = document.getElementById('note-hover-preview');
            const sidebarRect = document.querySelector('.left-side').getBoundingClientRect();
            const cardRect = card.getBoundingClientRect();
            const cs = getComputedStyle(card);
            const bg = cs.backgroundColor || '';
            const slashAlpha = bg.match(/\/\s*([\d.]+)\s*\)/);
            const rgbaMatch = bg.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/);
            const bgAlpha = slashAlpha ? parseFloat(slashAlpha[1]) : (rgbaMatch ? parseFloat(rgbaMatch[1]) : 1);
            return {
                title: card.querySelector('.note-hover-preview-title')?.textContent || '',
                meta: card.querySelector('.note-hover-preview-meta')?.textContent || '',
                bodyText: card.querySelector('.note-hover-preview-content')?.textContent || '',
                hasH1: Boolean(card.querySelector('.note-hover-preview-content h1')),
                hasScript: Boolean(card.querySelector('script')),
                hasPreCode: Boolean(card.querySelector('.note-hover-preview-content pre.history-text-code')),
                hasTextarea: Boolean(card.querySelector('textarea')),
                xssTriggered: Boolean(window.__xssProbe),
                pointerEvents: cs.pointerEvents,
                backdropFilter: cs.backdropFilter || cs.webkitBackdropFilter || '',
                bgColor: bg,
                bgAlpha,
                actionCount: card.querySelectorAll('.note-hover-preview-footer [data-preview-action]').length,
                leftOk: cardRect.left >= sidebarRect.right,
                inViewport: cardRect.right <= window.innerWidth && cardRect.bottom <= window.innerHeight
            };
        });
        check('hover preview renders title, meta stats, code pre block, and omits redundant H1',
            alphaState.title === 'Alpha' &&
            alphaState.meta.includes('code') &&
            alphaState.bodyText.includes('First note body') &&
            alphaState.hasPreCode &&
            !alphaState.hasTextarea &&
            !alphaState.hasH1,
            alphaState);
        check('hover preview strips scripts and stays positioned beside sidebar',
            !alphaState.hasScript && !alphaState.xssTriggered && alphaState.pointerEvents === 'auto' && alphaState.leftOk && alphaState.inViewport,
            alphaState);
        check('hover preview uses frosted glassmorphism and renders 5 interactive action buttons',
            alphaState.backdropFilter.includes('blur(') &&
            alphaState.bgAlpha > 0 && alphaState.bgAlpha < 1 &&
            alphaState.actionCount === 5,
            { backdropFilter: alphaState.backdropFilter, bgColor: alphaState.bgColor, bgAlpha: alphaState.bgAlpha, actionCount: alphaState.actionCount });

        // 2a. Interactive action buttons inside preview (Pin, Copy, Open, Move, Delete)
        await main.click('#note-hover-preview [data-preview-action="pin"]');
        await waitFor(() => main.evaluate(() => document.querySelector('#note-hover-preview [data-preview-action="pin"]')?.classList.contains('is-active') === true), 2000, 'pin button active');
        const pinnedState = await main.evaluate(() => ({
            stillVisible: window.NoshSidebarPreview?.isVisible() === true,
            itemPinned: document.querySelector('.save[data-file="Alpha"]')?.classList.contains('pinned') === true,
            pressed: document.querySelector('#note-hover-preview [data-preview-action="pin"]')?.getAttribute('aria-pressed')
        }));
        await main.click('#note-hover-preview [data-preview-action="pin"]');
        await waitFor(() => main.evaluate(() => document.querySelector('#note-hover-preview [data-preview-action="pin"]')?.classList.contains('is-active') === false), 2000, 'unpin button inactive');
        const unpinnedItem = await main.evaluate(() => document.querySelector('.save[data-file="Alpha"]')?.classList.contains('pinned') === false);
        check('preview pin button toggles pinned state cleanly without closing preview',
            pinnedState.stillVisible && pinnedState.itemPinned && pinnedState.pressed === 'true' && unpinnedItem,
            { ...pinnedState, unpinnedItem });

        await main.click('#note-hover-preview [data-preview-action="copy"]');
        await waitFor(() => main.evaluate(() => document.querySelector('#note-hover-preview [data-preview-action="copy"]')?.classList.contains('is-copied') === true), 2000, 'copy button feedback');
        const copiedMarkdown = await main.evaluate(() => window.nosh.clipboard.readText());
        check('preview copy button copies note Markdown to clipboard',
            copiedMarkdown.includes('First note body') && copiedMarkdown.includes('def hello():'),
            { copiedMarkdown });

        await main.click('#note-hover-preview [data-preview-action="move"]');
        await waitFor(() => main.evaluate(() => document.getElementById('move-to-folder-modal')?.classList.contains('active') && window.NoshSidebarPreview?.isVisible() === false), 2000, 'move button opens folder modal');
        await main.evaluate(() => closeAllModals());

        const alphaDeleteBox = await main.locator('.save[data-file="Alpha"]').boundingBox();
        await main.mouse.move(alphaDeleteBox.x + alphaDeleteBox.width / 2, alphaDeleteBox.y + alphaDeleteBox.height / 2);
        await waitFor(() => main.evaluate(() => window.NoshSidebarPreview?.isVisible() === true && window.NoshSidebarPreview?.getCurrentNote() === 'Alpha'), 3000, 're-hover Alpha for delete modal');
        await main.click('#note-hover-preview [data-preview-action="delete"]');
        await waitFor(() => main.evaluate(() => document.getElementById('delete-modal')?.classList.contains('active') && window.NoshSidebarPreview?.isVisible() === false), 2000, 'delete button opens delete confirmation modal');
        const deleteModalPrompt = await main.evaluate(() => document.getElementById('delete-modal-msg')?.textContent || '');
        await main.evaluate(() => closeAllModals());
        check('preview move and delete buttons hide preview and open respective modals',
            deleteModalPrompt.includes('Alpha'),
            { deleteModalPrompt });

        const alphaOpenBox = await main.locator('.save[data-file="Alpha"]').boundingBox();
        await main.mouse.move(alphaOpenBox.x + alphaOpenBox.width / 2, alphaOpenBox.y + alphaOpenBox.height / 2);
        await waitFor(() => main.evaluate(() => window.NoshSidebarPreview?.isVisible() === true && window.NoshSidebarPreview?.getCurrentNote() === 'Alpha'), 3000, 're-hover Alpha for open button');
        await main.click('#note-hover-preview [data-preview-action="open"]');
        await waitFor(() => main.evaluate(() => activeNoteName === 'Alpha' && window.NoshSidebarPreview?.isVisible() === false), 3000, 'open button opens Alpha');
        check('preview open button opens the note and hides preview', true);

        // 2b. Long note preview can be hovered onto and scrolled with mouse wheel
        const longBox = await main.locator('.save[data-file="LongNote"]').boundingBox();
        await main.mouse.move(longBox.x + longBox.width / 2, longBox.y + longBox.height / 2);
        await waitFor(() => main.evaluate(() => window.NoshSidebarPreview?.getCurrentNote() === 'LongNote'), 3000, 'switch preview to LongNote');
        const previewBox = await main.locator('#note-hover-preview').boundingBox();
        await main.mouse.move(previewBox.x + previewBox.width / 2, previewBox.y + previewBox.height / 2);
        await sleep(260);
        const stayedOpenOnCard = await main.evaluate(() => window.NoshSidebarPreview?.isVisible() === true);
        await main.mouse.wheel(0, 600);
        await sleep(120);
        const scrollState = await main.evaluate(() => {
            const body = document.querySelector('#note-hover-preview .note-hover-preview-body');
            const stage = document.querySelector('#note-hover-preview .note-hover-preview-stage');
            return {
                scrollTop: body ? body.scrollTop : 0,
                scrollHeight: body ? body.scrollHeight : 0,
                clientHeight: body ? body.clientHeight : 0,
                scrollbarWidth: body ? (body.offsetWidth - body.clientWidth) : -1,
                hasEndMarker: Boolean(body && body.textContent.includes('LONG-END-MARKER')),
                hasOverflowFade: Boolean(stage && stage.classList.contains('has-overflow'))
            };
        });
        check('hovering onto preview card keeps it open, hides scrollbars, and allows mouse-wheel scrolling',
            stayedOpenOnCard && scrollState.scrollbarWidth === 0 && scrollState.scrollHeight > scrollState.clientHeight && scrollState.scrollTop > 0 && scrollState.hasEndMarker,
            { stayedOpenOnCard, ...scrollState });

        // 3. Moving to Beta updates preview; moving to BlankDoc shows empty-note hint
        const betaBox = await main.locator('.save[data-file="Beta"]').boundingBox();
        await main.mouse.move(betaBox.x + betaBox.width / 2, betaBox.y + betaBox.height / 2);
        await waitFor(() => main.evaluate(() => window.NoshSidebarPreview?.getCurrentNote() === 'Beta'), 3000, 'switch preview to Beta');
        const betaCheckDisabled = await main.evaluate(() => {
            const cb = document.querySelector('#note-hover-preview input.checklist-checkbox');
            return Boolean(cb && cb.disabled);
        });
        check('checklist items inside preview are disabled and inert', betaCheckDisabled);

        const blankBox = await main.locator('.save[data-file="BlankDoc"]').boundingBox();
        await main.mouse.move(blankBox.x + blankBox.width / 2, blankBox.y + blankBox.height / 2);
        await waitFor(() => main.evaluate(() => window.NoshSidebarPreview?.getCurrentNote() === 'BlankDoc'), 3000, 'switch preview to BlankDoc');
        const blankState = await main.evaluate(() => ({
            emptyHidden: document.querySelector('#note-hover-preview .note-hover-preview-empty')?.hidden
        }));
        check('note with only matching title shows clean empty state hint', blankState.emptyHidden === false, blankState);

        // 4. Clicking a note hides preview and opens the file normally
        await main.click('.save[data-file="Beta"]');
        await waitFor(() => main.evaluate(() => activeNoteName === 'Beta'), 5000, 'Beta opened on click');
        const hiddenOnClick = await main.evaluate(() => window.NoshSidebarPreview?.isVisible() === false);
        check('clicking a hovered note hides preview and opens the file', hiddenOnClick);

        // 5. Hovering the currently open active note (Beta) does not pop a redundant preview
        await main.mouse.move(betaBox.x + betaBox.width / 2, betaBox.y + betaBox.height / 2);
        await sleep(550);
        const activeHoveredVisible = await main.evaluate(() => window.NoshSidebarPreview?.isVisible() === true);
        check('hovering the currently open active note does not open preview', activeHoveredVisible === false, activeHoveredVisible);

        // 6. Editing and saving Beta invalidates cache; switching to Alpha then hovering Beta shows new content
        await main.evaluate(async () => {
            const p = document.createElement('p');
            p.textContent = 'CACHE-UPDATED-TEXT';
            content.appendChild(p);
            hasUnsavedChanges = true;
            await saveFile();
        });
        await main.click('.save[data-file="Alpha"]');
        await waitFor(() => main.evaluate(() => activeNoteName === 'Alpha'), 5000, 'Alpha opened');

        const freshBetaBox = await main.locator('.save[data-file="Beta"]').boundingBox();
        await main.mouse.move(freshBetaBox.x + freshBetaBox.width / 2, freshBetaBox.y + freshBetaBox.height / 2);
        await waitFor(() => main.evaluate(() => window.NoshSidebarPreview?.getCurrentNote() === 'Beta'), 3000, 'Beta preview after save');
        const updatedBody = await main.evaluate(() => document.querySelector('#note-hover-preview .note-hover-preview-content')?.textContent || '');
        check('saving a note updates its hover preview cache', updatedBody.includes('CACHE-UPDATED-TEXT'), updatedBody);

        // 7. Leaving the sidebar/preview area hides the preview and resets pointer-events
        await main.mouse.move(800, 300);
        await waitFor(() => main.evaluate(() => window.NoshSidebarPreview?.isVisible() === false), 2000, 'preview hidden on mouse leave');
        const hiddenPointerEvents = await main.evaluate(() => getComputedStyle(document.getElementById('note-hover-preview')).pointerEvents);
        check('moving mouse away from sidebar/preview hides card and restores pointer-events: none', hiddenPointerEvents === 'none', hiddenPointerEvents);

        // 8. Disabling Hover Note Preview in settings prevents preview from opening
        await main.evaluate(() => {
            openSettingsModal();
            const cb = document.getElementById('setting-hover-preview');
            cb.checked = false;
            saveSettings();
            closeAllModals();
        });
        await main.mouse.move(freshBetaBox.x + freshBetaBox.width / 2, freshBetaBox.y + freshBetaBox.height / 2);
        await sleep(550);
        const disabledVisible = await main.evaluate(() => window.NoshSidebarPreview?.isVisible() === true);
        check('disabling Hover Note Preview setting suppresses preview', disabledVisible === false, disabledVisible);

        const errs = relevantErrors(s.errors);
        check('no renderer console or page errors', errs.length === 0, errs);
    } finally {
        await forceExit(s);
        try { fs.rmSync(sandbox.tmp, { recursive: true, force: true }); } catch (_) {}
    }

    process.exit(report.done() ? 1 : 0);
})();
