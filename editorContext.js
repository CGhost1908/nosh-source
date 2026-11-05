// Editor Right-Click Context Menu (rich text editor + code blocks + links)

(function () {
    const editorEl = document.getElementById('content');
    const scrollArea = document.getElementById('editor-scroll-area');
    if (!editorEl) return;

    let menu = document.getElementById('editor-context-menu');
    if (!menu) {
        menu = document.createElement('div');
        menu.id = 'editor-context-menu';
        document.body.appendChild(menu);
    }

    let savedRange = null;
    let savedWordRange = null;
    let ctx = null; // { cm, link, wrapper }

    const getClipboard = () => {
        try {
            return nativeClipboard;
        } catch {
            return {
                writeText: (t) => navigator.clipboard && navigator.clipboard.writeText(t),
                readText: () => '',
                readHTML: () => ''
            };
        }
    };

    function hideEditorMenu() {
        if (menu) menu.style.display = 'none';
    }
    window.hideEditorContextMenu = hideEditorMenu;

    function isMenuVisible() {
        return menu && menu.style.display !== 'none';
    }

    function selectRange(range) {
        if (!range) return;
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    }

    function restoreRange(preferWord = false) {
        const target = (preferWord && savedWordRange) ? savedWordRange : savedRange;
        if (target) selectRange(target);
    }

    function runInEditor(fn, autoExpandWord = false) {
        editorEl.focus();
        restoreRange(autoExpandWord);
        try {
            fn();
        } catch (err) {
            console.error('Editor action failed:', err);
        }
        if (typeof triggerAutoSave === 'function') triggerAutoSave();
        if (typeof updateStatusBarStats === 'function') updateStatusBarStats();
    }

    function fmt(cmd, value = null, autoExpandWord = true) {
        runInEditor(() => {
            if (value !== null) {
                document.execCommand(cmd, false, value);
            } else {
                document.execCommand(cmd, false, null);
            }
        }, autoExpandWord);
    }

    // Identify exact word boundaries around caret
    function getWordRangeAt(node, offset) {
        if (!node || node.nodeType !== Node.TEXT_NODE) return null;
        const text = node.textContent;
        if (!text) return null;

        const isWordChar = (ch) => /[\p{L}\p{N}_]/u.test(ch);
        let start = Math.min(offset, text.length);
        let end = start;

        if (start > 0 && !isWordChar(text.charAt(start)) && isWordChar(text.charAt(start - 1))) {
            start--;
            end = start;
        }
        if (!isWordChar(text.charAt(start))) return null;

        while (start > 0 && isWordChar(text.charAt(start - 1))) start--;
        while (end < text.length && isWordChar(text.charAt(end))) end++;

        if (start >= end) return null;

        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, end);
        return range;
    }

    function handleCut() {
        const cb = getClipboard();
        if (ctx && ctx.cm) {
            const sel = ctx.cm.getSelection();
            if (sel) {
                cb.writeText(sel);
                ctx.cm.replaceSelection('');
            }
            return;
        }

        const sel = window.getSelection();
        let targetRange = (sel.rangeCount > 0 && !sel.isCollapsed) ? sel.getRangeAt(0) : savedWordRange;
        if (!targetRange && savedRange && !savedRange.collapsed) targetRange = savedRange;

        if (targetRange) {
            const text = targetRange.toString();
            if (text) cb.writeText(text);
            targetRange.deleteContents();
            if (typeof triggerAutoSave === 'function') triggerAutoSave();
            if (typeof showToast === 'function') showToast('Cut to clipboard', 'info');
        }
    }

    function handleCopy() {
        const cb = getClipboard();
        if (ctx && ctx.cm) {
            const sel = ctx.cm.getSelection() || ctx.cm.getValue();
            if (sel) {
                cb.writeText(sel);
                if (typeof showToast === 'function') showToast('Code copied', 'info');
            }
            return;
        }

        const sel = window.getSelection();
        let text = (sel.rangeCount > 0 && !sel.isCollapsed) ? sel.toString() : '';
        if (!text && savedRange && !savedRange.collapsed) text = savedRange.toString();
        if (!text && savedWordRange) text = savedWordRange.toString();

        if (text) {
            cb.writeText(text);
            if (typeof showToast === 'function') showToast('Copied to clipboard', 'info');
        }
    }

    function handlePaste(plain = false) {
        const cb = getClipboard();
        const text = cb.readText();
        const html = plain ? null : cb.readHTML();

        if (ctx && ctx.cm) {
            if (text) ctx.cm.replaceSelection(text);
            return;
        }

        runInEditor(() => {
            if (!plain && html && html.trim()) {
                document.execCommand('insertHTML', false, html);
            } else if (text) {
                document.execCommand('insertText', false, text);
            }
        }, false);
    }

    function handleChecklistInsert() {
        runInEditor(() => {
            if (typeof insertChecklist === 'function') {
                insertChecklist();
            } else {
                const item = document.createElement('div');
                item.className = 'checklist-item';
                item.setAttribute('contenteditable', 'false');
                item.innerHTML = `
                    <input type="checkbox" class="checklist-checkbox" onchange="toggleChecklistItem(this)">
                    <span class="checklist-text" contenteditable="true" placeholder="To-do item..."></span>
                `;
                const sel = window.getSelection();
                if (sel && sel.rangeCount > 0) {
                    const range = sel.getRangeAt(0);
                    range.deleteContents();
                    range.insertNode(item);
                } else {
                    editorEl.appendChild(item);
                }
            }
        }, false);
    }

    function openLink(rawUrl) {
        if (typeof openExternalUrlSafely === 'function') {
            openExternalUrlSafely(rawUrl);
        } else {
            let url = (rawUrl || '').trim();
            if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//i.test(url) && !url.startsWith('mailto:')) {
                url = 'https://' + url;
            }
            try {
                shell.openExternal(url);
            } catch {
                window.open(url, '_blank');
            }
        }
    }

    function buildItems(hasSelection) {
        // 1. Code Block Context
        if (ctx && ctx.cm) {
            const cm = ctx.cm;
            const hasCmSel = !!cm.getSelection();
            return [
                { icon: 'solar:scissors-linear', label: 'Cut', hint: 'Ctrl+X', disabled: !hasCmSel, run: handleCut },
                { icon: 'solar:copy-linear', label: 'Copy', hint: 'Ctrl+C', disabled: !hasCmSel, run: handleCopy },
                { icon: 'solar:clipboard-linear', label: 'Paste', hint: 'Ctrl+V', run: () => handlePaste(true) },
                { icon: 'solar:check-square-linear', label: 'Select All Code', hint: 'Ctrl+A', run: () => { cm.focus(); cm.execCommand('selectAll'); } },
                '-',
                { icon: 'solar:copy-bold-duotone', label: 'Copy Entire Code Block', run: () => { getClipboard().writeText(cm.getValue()); if (typeof showToast === 'function') showToast('Code copied', 'success'); } },
                { icon: 'solar:code-square-linear', label: 'Change Language...', run: () => {
                    const tag = ctx.wrapper && ctx.wrapper.querySelector('.code-lang-tag');
                    if (tag && typeof openBlockLangSwitcher === 'function') openBlockLangSwitcher(tag);
                } }
            ];
        }

        // 2. Welcome Screen Context (no note active)
        if (typeof activeNoteName === 'undefined' || !activeNoteName) {
            return [
                { icon: 'solar:pen-new-square-linear', label: 'New Note', hint: 'Ctrl+N', run: () => { if (typeof createNewFile === 'function') createNewFile(); } },
                { icon: 'solar:layers-minimalistic-linear', label: 'New from Template...', run: () => { if (typeof openTemplateModal === 'function') openTemplateModal(); } },
                { icon: 'solar:folder-open-linear', label: 'Open File...', hint: 'Ctrl+O', run: () => { if (typeof openFileFromSystem === 'function') openFileFromSystem(); } }
            ];
        }

        // 3. Regular Note Editor Context
        const items = [];

        // Link-specific actions if clicked on <a>
        if (ctx && ctx.link) {
            const href = ctx.link.getAttribute('href') || ctx.link.textContent || '';
            if (href && !ctx.link.classList.contains('note-internal-link')) {
                items.push({ icon: 'solar:link-round-angle-linear', label: 'Open Link', run: () => openLink(href) });
                items.push({
                    icon: 'solar:pen-linear', label: 'Edit Link...', run: () => {
                        const range = document.createRange();
                        range.selectNodeContents(ctx.link);
                        selectRange(range);
                        if (typeof openLinkModal === 'function') openLinkModal('url', href, ctx.link ? ctx.link.textContent : '');
                    }
                });
            }
            if (href) {
                items.push({
                    icon: 'solar:copy-linear', label: 'Copy Link Address', run: () => {
                        const targetUrl = (typeof normalizeExternalUrl === 'function') ? normalizeExternalUrl(href) : href;
                        getClipboard().writeText(targetUrl);
                        if (typeof showToast === 'function') showToast('Link address copied', 'info');
                    }
                });
            }
            items.push({
                icon: 'solar:link-broken-linear', label: 'Remove Link', run: () => {
                    const range = document.createRange();
                    range.selectNodeContents(ctx.link);
                    selectRange(range);
                    document.execCommand('unlink', false, null);
                    if (typeof triggerAutoSave === 'function') triggerAutoSave();
                    if (typeof showToast === 'function') showToast('Link removed', 'info');
                }
            });
            items.push('-');
        }

        const canCopyOrCut = hasSelection || !!savedWordRange;

        items.push(
            { icon: 'solar:scissors-linear', label: 'Cut', hint: 'Ctrl+X', disabled: !canCopyOrCut, run: handleCut },
            { icon: 'solar:copy-linear', label: 'Copy', hint: 'Ctrl+C', disabled: !canCopyOrCut, run: handleCopy },
            { icon: 'solar:clipboard-linear', label: 'Paste', hint: 'Ctrl+V', run: () => handlePaste(false) },
            { icon: 'solar:clipboard-text-linear', label: 'Paste as Plain Text', hint: 'Ctrl+Shift+V', run: () => handlePaste(true) },
            { icon: 'solar:check-square-linear', label: 'Select All', hint: 'Ctrl+A', run: () => { editorEl.focus(); document.execCommand('selectAll'); } },
            '-',
            { type: 'row', buttons: [
                { icon: 'solar:text-bold-bold', title: 'Bold (Ctrl+B)', run: () => fmt('bold', null, true) },
                { icon: 'solar:text-italic-linear', title: 'Italic (Ctrl+I)', run: () => fmt('italic', null, true) },
                { icon: 'solar:text-underline-linear', title: 'Underline (Ctrl+U)', run: () => fmt('underline', null, true) },
                { icon: 'solar:text-cross-linear', title: 'Strikethrough', run: () => fmt('strikethrough', null, true) },
                { icon: 'solar:eraser-linear', title: 'Clear Formatting', run: () => fmt('removeFormat', null, true) }
            ] },
            { type: 'row', buttons: [
                { text: 'P', title: 'Paragraph', run: () => fmt('formatBlock', 'p', false) },
                { text: 'H1', title: 'Heading 1', run: () => fmt('formatBlock', 'h1', false) },
                { text: 'H2', title: 'Heading 2', run: () => fmt('formatBlock', 'h2', false) },
                { text: 'H3', title: 'Heading 3', run: () => fmt('formatBlock', 'h3', false) },
                { icon: 'solar:chat-square-like-linear', title: 'Quote', run: () => fmt('formatBlock', 'blockquote', false) }
            ] },
            { type: 'row', buttons: [
                { icon: 'solar:list-linear', title: 'Bullet List', run: () => fmt('insertUnorderedList', null, false) },
                { icon: 'solar:list-heart-minimalistic-linear', title: 'Numbered List', run: () => fmt('insertOrderedList', null, false) },
                { icon: 'solar:checklist-minimalistic-linear', title: 'Checklist', run: handleChecklistInsert },
                { icon: 'lucide:align-left', title: 'Align Left', run: () => fmt('justifyLeft', null, false) },
                { icon: 'lucide:align-center', title: 'Align Center', run: () => fmt('justifyCenter', null, false) },
                { icon: 'lucide:align-right', title: 'Align Right', run: () => fmt('justifyRight', null, false) }
            ] },
            '-',
            { icon: 'solar:code-square-linear', label: (hasSelection || savedWordRange) ? 'Turn into Code Block' : 'Insert Code Block', run: () => {
                restoreRange(true);
                if (typeof insertCodeBlockFromSelection === 'function') {
                    insertCodeBlockFromSelection();
                } else if (typeof openLanguageModal === 'function') {
                    openLanguageModal();
                }
            } },
            { icon: 'solar:link-linear', label: (hasSelection || savedWordRange) ? 'Link Selection...' : 'Insert Link...', run: () => {
                restoreRange(true);
                if (typeof openLinkModal === 'function') openLinkModal('url');
            } },
            { icon: 'solar:link-minimalistic-2-linear', label: 'Link to Note [[...]]', run: () => {
                restoreRange(true);
                if (typeof openInternalLinkModal === 'function') openInternalLinkModal();
            } },
            { icon: 'solar:gallery-linear', label: 'Insert Image...', run: () => {
                restoreRange(false);
                if (typeof openMediaModal === 'function') openMediaModal('image');
            } },
            { icon: 'solar:videocamera-linear', label: 'Insert Video...', run: () => {
                restoreRange(false);
                if (typeof openMediaModal === 'function') openMediaModal('video');
            } },
            '-',
            { icon: 'solar:magnifer-linear', label: 'Find in Document', hint: 'Ctrl+F', run: () => { if (typeof openDocFindBar === 'function') openDocFindBar(); } },
            { icon: 'solar:document-add-linear', label: 'Copy as Markdown', run: () => { if (typeof copyAsMarkdown === 'function') copyAsMarkdown(); } },
            { icon: 'solar:diskette-linear', label: 'Save', hint: 'Ctrl+S', run: () => { if (typeof saveFile === 'function') saveFile(); } }
        );
        return items;
    }

    function render(items) {
        menu.innerHTML = '';
        const ul = document.createElement('ul');

        items.forEach(item => {
            if (item === '-') {
                const sep = document.createElement('li');
                sep.className = 'ectx-sep';
                ul.appendChild(sep);
                return;
            }

            if (item.type === 'row') {
                const row = document.createElement('li');
                row.className = 'ectx-row';
                item.buttons.forEach(b => {
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.title = b.title || '';
                    if (b.icon) {
                        btn.innerHTML = `<iconify-icon icon="${b.icon}"></iconify-icon>`;
                    } else {
                        btn.textContent = b.text;
                    }

                    btn.addEventListener('mousedown', (e) => e.preventDefault());
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        hideEditorMenu();
                        try {
                            b.run();
                        } catch (err) {
                            console.error('Row button error:', err);
                        }
                    });
                    row.appendChild(btn);
                });
                ul.appendChild(row);
                return;
            }

            const li = document.createElement('li');
            li.className = 'ectx-item' + (item.disabled ? ' disabled' : '');
            li.innerHTML = `
                <iconify-icon icon="${item.icon}"></iconify-icon>
                <span class="ectx-label">${item.label}</span>
                ${item.hint ? `<span class="ectx-hint">${item.hint}</span>` : ''}
            `;

            li.addEventListener('mousedown', (e) => e.preventDefault());
            li.addEventListener('click', (e) => {
                e.stopPropagation();
                if (item.disabled) return;
                hideEditorMenu();
                try {
                    item.run();
                } catch (err) {
                    console.error('Menu item error:', err);
                }
            });
            ul.appendChild(li);
        });

        menu.appendChild(ul);
    }

    function handleContextMenu(e) {
        // Target must be within editor-scroll-area or content
        const insideScrollArea = scrollArea && (scrollArea === e.target || scrollArea.contains(e.target));
        const insideEditor = editorEl && (editorEl === e.target || editorEl.contains(e.target));
        if (!insideScrollArea && !insideEditor) return;

        e.preventDefault();
        if (typeof hideContextMenu === 'function') hideContextMenu();

        const codeWrapper = e.target.closest('.code-block-wrapper');
        const cmEl = e.target.closest('.CodeMirror') || (codeWrapper ? codeWrapper.querySelector('.CodeMirror') : null);
        ctx = {
            cm: cmEl && cmEl.CodeMirror ? cmEl.CodeMirror : null,
            wrapper: codeWrapper,
            link: e.target.closest('a')
        };

        let hasSelection = false;
        savedRange = null;
        savedWordRange = null;

        if (!ctx.cm) {
            const sel = window.getSelection();
            const hasExistingSel = sel && sel.rangeCount > 0 && editorEl.contains(sel.anchorNode) && !sel.isCollapsed;

            if (hasExistingSel) {
                savedRange = sel.getRangeAt(0).cloneRange();
                hasSelection = true;
            } else {
                // Determine caret position from click coordinates
                let caretRange = null;
                if (document.caretRangeFromPoint) {
                    caretRange = document.caretRangeFromPoint(e.clientX, e.clientY);
                } else if (document.caretPositionFromPoint) {
                    const pos = document.caretPositionFromPoint(e.clientX, e.clientY);
                    if (pos) {
                        caretRange = document.createRange();
                        caretRange.setStart(pos.offsetNode, pos.offset);
                        caretRange.collapse(true);
                    }
                }

                if (caretRange && editorEl.contains(caretRange.startContainer)) {
                    selectRange(caretRange);
                    savedRange = caretRange.cloneRange();
                    savedWordRange = getWordRangeAt(caretRange.startContainer, caretRange.startOffset);
                } else if (insideScrollArea && !insideEditor) {
                    // Right clicked in empty area below content: place caret at the end
                    const endRange = document.createRange();
                    endRange.selectNodeContents(editorEl);
                    endRange.collapse(false);
                    selectRange(endRange);
                    savedRange = endRange.cloneRange();
                }
            }
        }

        render(buildItems(hasSelection));

        menu.style.display = 'block';
        menu.style.visibility = 'hidden';

        const w = menu.offsetWidth || 230;
        const h = menu.offsetHeight || 300;
        let left = e.clientX;
        let top = e.clientY;

        if (left + w > window.innerWidth - 10) left = Math.max(10, window.innerWidth - w - 10);
        if (top + h > window.innerHeight - 10) top = Math.max(10, window.innerHeight - h - 10);

        menu.style.left = `${left}px`;
        menu.style.top = `${top}px`;
        menu.style.visibility = 'visible';
    }

    if (scrollArea) {
        scrollArea.addEventListener('contextmenu', handleContextMenu);
    } else {
        editorEl.addEventListener('contextmenu', handleContextMenu);
    }

    // Dismiss context menu on click outside
    document.addEventListener('mousedown', (e) => {
        if (!e.target.closest('#editor-context-menu')) hideEditorMenu();
    });
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#editor-context-menu')) hideEditorMenu();
    });

    // Keyboard handling while context menu is open
    document.addEventListener('keydown', (e) => {
        if (!isMenuVisible()) return;

        if (e.key === 'Escape') {
            e.preventDefault();
            hideEditorMenu();
            return;
        }

        if (e.ctrlKey && !e.shiftKey) {
            const k = e.key.toLowerCase();
            if (k === 'c') { e.preventDefault(); hideEditorMenu(); handleCopy(); }
            else if (k === 'x') { e.preventDefault(); hideEditorMenu(); handleCut(); }
            else if (k === 'v') { e.preventDefault(); hideEditorMenu(); handlePaste(false); }
            else if (k === 'b') { e.preventDefault(); hideEditorMenu(); fmt('bold', null, true); }
            else if (k === 'i') { e.preventDefault(); hideEditorMenu(); fmt('italic', null, true); }
            else if (k === 'u') { e.preventDefault(); hideEditorMenu(); fmt('underline', null, true); }
            else if (k === 'a') { e.preventDefault(); hideEditorMenu(); editorEl.focus(); document.execCommand('selectAll'); }
            else if (k === 's') { e.preventDefault(); hideEditorMenu(); if (typeof saveFile === 'function') saveFile(); }
            else if (k === 'f') { e.preventDefault(); hideEditorMenu(); if (typeof openDocFindBar === 'function') openDocFindBar(); }
        } else if (e.ctrlKey && e.shiftKey) {
            if (e.key.toLowerCase() === 'v') {
                e.preventDefault();
                hideEditorMenu();
                handlePaste(true);
            }
        }
    });

    window.addEventListener('blur', hideEditorMenu);
    window.addEventListener('resize', hideEditorMenu);
    if (scrollArea) scrollArea.addEventListener('scroll', hideEditorMenu);
})();
