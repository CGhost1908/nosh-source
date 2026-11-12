// Core Script: Editor Controls, Keyboard Shortcuts & Window Actions

// Window Controls
function minimizeWindow() {
    ipcRenderer.send('minimize');
}

function closeWindow() {
    ipcRenderer.send('close');
}

// Prompt Unsaved Changes Helper
let pendingActionCallback = null;

function promptUnsavedChanges(onProceed) {
    pendingActionCallback = onProceed;
    const docName = document.getElementById('unsaved-doc-name');
    if (docName) docName.textContent = activeNoteName ? `"${activeNoteName}"` : 'this note';

    openModal('unsaved-modal');
}

// Unsaved Modal Buttons
const unsavedSaveBtn = document.getElementById('unsaved-save-btn');
const unsavedDiscardBtn = document.getElementById('unsaved-discard-btn');
const unsavedCancelBtn = document.getElementById('unsaved-cancel-btn');

if (unsavedSaveBtn) {
    unsavedSaveBtn.addEventListener('click', async () => {
        await saveFile();
        closeAllModals();
        if (typeof pendingActionCallback === 'function') {
            const cb = pendingActionCallback;
            pendingActionCallback = null;
            cb();
        }
    });
}

if (unsavedDiscardBtn) {
    unsavedDiscardBtn.addEventListener('click', () => {
        hasUnsavedChanges = false;
        if (unsavedDot) unsavedDot.classList.remove('active');
        closeAllModals();
        if (typeof pendingActionCallback === 'function') {
            const cb = pendingActionCallback;
            pendingActionCallback = null;
            cb();
        }
    });
}

if (unsavedCancelBtn) {
    unsavedCancelBtn.addEventListener('click', () => {
        pendingActionCallback = null;
        closeAllModals();
    });
}

// Electron close handler
ipcRenderer.on('confirm-close', () => {
    if (hasUnsavedChanges && activeNoteName) {
        promptUnsavedChanges(() => {
            ipcRenderer.send('proceed-close', true);
        });
    } else {
        ipcRenderer.send('proceed-close', true);
    }
});

// Rich Text Formatting
function formatDoc(cmd, value = null) {
    if (!activeNoteName) {
        showToast('Create or open a note first', 'warning');
        return;
    }

    const lowerCmd = String(cmd || '').toLowerCase();
    if (lowerCmd === 'undo') {
        if (window.NoshUndo) window.NoshUndo.undo();
        return;
    }
    if (lowerCmd === 'redo') {
        if (window.NoshUndo) window.NoshUndo.redo();
        return;
    }

    // Protect the note's first <h1> header from being converted into another block type or list
    if (content && content.firstElementChild && content.firstElementChild.tagName === 'H1') {
        const firstH1 = content.firstElementChild;
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
            const range = sel.getRangeAt(0);
            const touchesFirstH1 = firstH1.contains(range.startContainer) || firstH1.contains(range.endContainer) || range.intersectsNode(firstH1);
            if (touchesFirstH1) {
                const lowerVal = String(value || '').toLowerCase();
                if ((lowerCmd === 'formatblock' && lowerVal !== 'h1' && lowerVal !== '<h1>') ||
                    lowerCmd === 'insertunorderedlist' ||
                    lowerCmd === 'insertorderedlist' ||
                    lowerCmd === 'outdent' ||
                    lowerCmd === 'indent') {
                    content.focus();
                    return;
                }
            }
        }
    }

    const prevCleanHtml = typeof getCleanContentHTML === 'function' ? getCleanContentHTML() : null;
    const execApply = () => {
        if (value) {
            document.execCommand(cmd, false, value);
        } else {
            document.execCommand(cmd, false, null);
        }
        if (typeof ensureNoteFirstHeader === 'function') {
            ensureNoteFirstHeader(content, activeNoteName, false);
        }
        content.focus();
    };

    if (window.NoshUndo) {
        window.NoshUndo.runWithUndo(execApply);
    } else {
        execApply();
    }

    if (prevCleanHtml !== null && typeof getCleanContentHTML === 'function' && getCleanContentHTML() !== prevCleanHtml) {
        if (typeof triggerAutoSave === 'function') triggerAutoSave();
    }
}

// Get clean HTML without transient CodeMirror DOM trees
function getCleanContentHTML() {
    if (!content) return '';
    const clone = content.cloneNode(true);
    // Remove all CodeMirror injected DOM trees and transient media toolbars/handles from the clone
    clone.querySelectorAll('.CodeMirror').forEach(el => el.remove());
    clone.querySelectorAll('.media-toolbar').forEach(el => el.remove());
    clone.querySelectorAll('.media-resize-handle, .table-col-resizer').forEach(el => el.remove());
    clone.querySelectorAll('.block-drag-handle, .media-drag-handle').forEach(el => el.remove());
    clone.querySelectorAll('h1[data-placeholder]').forEach(el => el.removeAttribute('data-placeholder'));
    clone.querySelectorAll('.block-moved-highlight, .block-drop-top, .block-drop-bottom, .is-dragging, .is-resizing, .is-active').forEach(el => {
        el.classList.remove('block-moved-highlight', 'block-drop-top', 'block-drop-bottom', 'is-dragging', 'is-resizing', 'is-active');
    });
    // Ensure all code textareas have their current value and display cleanly
    const liveTextareas = content.querySelectorAll('textarea.code');
    const cloneTextareas = clone.querySelectorAll('textarea.code');
    liveTextareas.forEach((liveTa, idx) => {
        if (cloneTextareas[idx]) {
            cloneTextareas[idx].value = liveTa.value;
            cloneTextareas[idx].textContent = liveTa.value;
            cloneTextareas[idx].style.display = 'block';
        }
    });

    // Ensure all checklist checkboxes preserve their checked attribute
    const liveCheckboxes = content.querySelectorAll('.checklist-checkbox');
    const cloneCheckboxes = clone.querySelectorAll('.checklist-checkbox');
    liveCheckboxes.forEach((cb, idx) => {
        if (cloneCheckboxes[idx]) {
            if (cb.checked) {
                cloneCheckboxes[idx].setAttribute('checked', 'checked');
            } else {
                cloneCheckboxes[idx].removeAttribute('checked');
            }
        }
    });

    // Ensure local assets preserve their relative path on disk
    clone.querySelectorAll('img[data-asset-rel], video[data-asset-rel]').forEach(el => {
        const rel = el.getAttribute('data-asset-rel');
        if (rel) {
            el.setAttribute('src', rel);
        }
    });

    return clone.innerHTML;
}

// File Save
async function saveFile() {
    if (!activeNoteName) {
        if (typeof showToast === 'function') showToast('Open or create a note first to save', 'warning');
        return;
    }

    if (window.NoshUndo) {
        window.NoshUndo.flushPendingTyping();
    }

    if (typeof ensureNoteFirstHeader === 'function') {
        ensureNoteFirstHeader(content, activeNoteName, false);
    }
    if (typeof syncFirstHeaderToNoteName === 'function') {
        await syncFirstHeaderToNoteName({ immediate: true, restoreIfEmpty: true, allowUniqueSuffix: true });
    }

    const safeName = path.basename(activeNoteName);
    const filePath = path.join(savesDir, `${safeName}.nsh`);
    if (typeof processMathFormulas === 'function') {
        processMathFormulas();
    }
    const contentHTML = getCleanContentHTML();

    try {
        // Keep the version that is about to be overwritten (never blocks or fails the save)
        if (typeof captureHistoryBeforeSave === 'function') {
            await captureHistoryBeforeSave(safeName, filePath, contentHTML);
        }
        await fsPromises.writeFile(filePath, contentHTML, 'utf8');

        hasUnsavedChanges = false;
        if (unsavedDot) unsavedDot.classList.remove('active');
        if (window.NoshUndo) {
            window.NoshUndo.onNoteSaved(safeName, contentHTML);
        }

        // Update mtime and sort sidebar by recent change
        const activeItem = document.querySelector(`.save[data-file="${safeName}"]`);
        if (activeItem) {
            activeItem.setAttribute('data-mtime', Date.now());
            if (typeof sortSaves === 'function') {
                sortSaves();
            }
        }

        // Check if synced to Google Drive
        if (activeItem && activeItem.classList.contains('drive-save')) {
            if (typeof uploadFileToDrive === 'function') {
                uploadFileToDrive(filePath, contentHTML).catch(err => {
                    console.error('Auto-save Drive upload error:', err);
                });
            }
        }

        showToast('Note saved', 'success');
        if (typeof invalidateVaultDashboardCache === 'function') {
            invalidateVaultDashboardCache();
        }
        if (typeof updateNoteSearchCache === 'function') {
            updateNoteSearchCache(safeName, content.innerText);
        }
        if (typeof updateStatusBarStats === 'function') {
            updateStatusBarStats();
        }
        if (typeof updateVaultTags === 'function') {
            updateVaultTags();
        }
        if (typeof populateDocumentOutline === 'function') {
            populateDocumentOutline();
        }
        if (typeof window.scheduleAuthTokenVaultPush === 'function') {
            window.scheduleAuthTokenVaultPush();
        }
    } catch (err) {
        console.error('Error saving note:', err);
        showToast('Error saving note', 'error');
    }
}

// Native Save As
async function saveAsDialog() {
    if (!activeNoteName) {
        showToast('No active note to save', 'warning');
        return;
    }

    const contentHTML = content.innerHTML;
    const result = await ipcRenderer.invoke('save-file-dialog', activeNoteName, contentHTML);

    if (result && result.success) {
        showToast(`Saved as "${result.fileName}"`, 'success');
        await readDatabase(result.fileName);
    }
}

// Universal Import Result Handler
async function handleImportResult(result, targetFolderId = null) {
    if (!result) return false;
    await invokeSavesDir();

    try {
        if (result.isBatchImport && Array.isArray(result.notes)) {
            // Save assets to savesDir/assets if present
            if (Array.isArray(result.assets) && result.assets.length > 0) {
                const assetsDir = path.join(savesDir, 'assets');
                if (!fs.existsSync(assetsDir)) {
                    await fsPromises.mkdir(assetsDir, { recursive: true });
                }
                for (const asset of result.assets) {
                    const fileName = asset.fileName || (asset.relPath ? path.basename(asset.relPath) : null);
                    let uint8 = null;
                    if (asset.bytes instanceof Uint8Array || Array.isArray(asset.bytes)) {
                        uint8 = asset.bytes instanceof Uint8Array ? asset.bytes : new Uint8Array(asset.bytes);
                    } else if (typeof asset.dataBase64 === 'string') {
                        const binStr = atob(asset.dataBase64);
                        uint8 = new Uint8Array(binStr.length);
                        for (let i = 0; i < binStr.length; i++) {
                            uint8[i] = binStr.charCodeAt(i);
                        }
                    }
                    if (fileName && uint8) {
                        const assetPath = path.join(assetsDir, fileName);
                        await fsPromises.writeFile(assetPath, uint8);
                    }
                }
            }

            // Determine or create vault folder
            let folderId = targetFolderId;
            if (!folderId && result.defaultFolder && typeof createVaultFolder === 'function') {
                const existing = Array.isArray(vaultFolders) ? vaultFolders.find(f => f.name.toLowerCase() === result.defaultFolder.toLowerCase()) : null;
                if (existing) {
                    folderId = existing.id;
                } else {
                    const created = await createVaultFolder(result.defaultFolder);
                    if (created) folderId = created.id;
                }
            }

            let firstSavedNote = null;
            for (const note of result.notes) {
                let noteTitle = sanitizeNoteTitleToFileName(note.title || note.fileName) || 'Imported Note';
                let noteContent = note.html || note.content || '';
                if (!noteContent && note.rawMarkdown && typeof markdownToNoshHtml === 'function') {
                    noteContent = markdownToNoshHtml(note.rawMarkdown);
                } else if (!noteContent && note.rawHtml) {
                    noteContent = note.rawHtml;
                }

                const probe = document.createElement('div');
                probe.innerHTML = noteContent;
                if (probe.firstElementChild && probe.firstElementChild.tagName === 'H1') {
                    probe.firstElementChild.textContent = noteTitle;
                } else {
                    const h1 = document.createElement('h1');
                    h1.textContent = noteTitle;
                    probe.insertBefore(h1, probe.firstChild);
                }
                noteContent = probe.innerHTML;

                let uniqueTitle = noteTitle;
                let counter = 1;
                while (fs.existsSync(path.join(savesDir, `${uniqueTitle}.nsh`))) {
                    uniqueTitle = `${noteTitle} (${counter++})`;
                }
                const notePath = path.join(savesDir, `${uniqueTitle}.nsh`);
                await fsPromises.writeFile(notePath, noteContent, 'utf8');

                if (folderId && typeof moveNoteToFolder === 'function') {
                    await moveNoteToFolder(uniqueTitle, folderId);
                }

                if (!firstSavedNote) {
                    firstSavedNote = uniqueTitle;
                }
            }

            if (typeof renderSidebarNotesList === 'function') {
                await renderSidebarNotesList();
            }

            if (firstSavedNote) {
                await readDatabase(firstSavedNote);
            }

            showToast(`Successfully imported ${result.notes.length} notes!`, 'success');
            return true;
        }

        // Single Note Import
        if ((result.fileName || result.title) && (result.content !== undefined || result.html !== undefined || result.rawMarkdown !== undefined)) {
            let baseName = sanitizeNoteTitleToFileName(result.title || result.fileName) || 'Imported Note';
            let noteContent = result.html !== undefined ? result.html : (result.content !== undefined ? result.content : '');
            if (!noteContent && result.rawMarkdown && typeof markdownToNoshHtml === 'function') {
                noteContent = markdownToNoshHtml(result.rawMarkdown);
            }

            const probe = document.createElement('div');
            probe.innerHTML = noteContent;
            if (probe.firstElementChild && probe.firstElementChild.tagName === 'H1') {
                const headerTitle = sanitizeNoteTitleToFileName(probe.firstElementChild.textContent || '');
                if (headerTitle) {
                    baseName = headerTitle;
                }
                probe.firstElementChild.textContent = baseName;
            } else {
                const h1 = document.createElement('h1');
                h1.textContent = baseName;
                probe.insertBefore(h1, probe.firstChild);
            }
            noteContent = probe.innerHTML;

            let uniqueTitle = baseName;
            let counter = 1;
            while (fs.existsSync(path.join(savesDir, `${uniqueTitle}.nsh`))) {
                uniqueTitle = `${baseName} (${counter++})`;
            }

            const destPath = path.join(savesDir, `${uniqueTitle}.nsh`);
            await fsPromises.writeFile(destPath, noteContent, 'utf8');

            let folderId = targetFolderId;
            if (!folderId && result.targetFolder && typeof createVaultFolder === 'function') {
                const existing = Array.isArray(vaultFolders) ? vaultFolders.find(f => f.name.toLowerCase() === result.targetFolder.toLowerCase()) : null;
                if (existing) {
                    folderId = existing.id;
                } else {
                    const created = await createVaultFolder(result.targetFolder);
                    if (created) folderId = created.id;
                }
            }

            if (folderId && typeof moveNoteToFolder === 'function') {
                await moveNoteToFolder(uniqueTitle, folderId);
            }

            if (typeof renderSidebarNotesList === 'function') {
                await renderSidebarNotesList();
            }

            await readDatabase(uniqueTitle);
            showToast(`Imported "${uniqueTitle}"`, 'success');
            return true;
        }
    } catch (err) {
        console.error('Error in handleImportResult:', err);
        showToast('Failed to import file: ' + (err.message || 'Unknown error'), 'error');
    }
    return false;
}

// Open File Dialog with format filter ('md', 'pdf', 'pptx', 'notion', 'all')
async function openImportDialog(filterType = 'all', targetFolderId = null) {
    try {
        const result = await ipcRenderer.invoke('open-file-dialog', { filterType });
        if (!result) return;
        await handleImportResult(result, targetFolderId);
    } catch (err) {
        console.error('Error invoking open-file-dialog:', err);
        showToast('Import dialog failed', 'error');
    }
}
window.openImportDialog = openImportDialog;
window.handleImportResult = handleImportResult;

// Native Open File
async function openFileFromSystem() {
    await openImportDialog('all');
}

ipcRenderer.on('open-nsh-file', async (event, fileData) => {
    if (!fileData || !fileData.fileName) return;
    await invokeSavesDir();
    const { filePath, fileName, content: loadedContent } = fileData;
    const destPath = path.join(savesDir, `${fileName}.nsh`);
    try {
        if (!filePath || path.resolve(filePath) !== path.resolve(destPath)) {
            await fsPromises.writeFile(destPath, loadedContent || '', 'utf8');
        }
        await readDatabase(fileName);
        if (typeof showToast === 'function') {
            showToast(`Opened "${fileName}"`, 'info');
        }
    } catch (err) {
        console.error('Error opening .nsh file:', err);
    }
});

// Open Notes Folder in OS File Explorer
async function openNotesFolder() {
    const success = await ipcRenderer.invoke('open-folder', savesDir);
    if (!success) {
        showToast('Failed to open folder', 'error');
    }
}

// highlight.js runs in the preload (the page has no require); this keeps the same call shape
const pdfHljs = {
    getLanguage: (lang) => window.nosh.highlight.hasLanguage(lang),
    highlight: (code, options) => ({ value: window.nosh.highlight.highlight(code, options.language) }),
    highlightAuto: (code) => ({ value: window.nosh.highlight.auto(code) })
};

function highlightCodeForPdf(codeText, rawLang) {
    if (!codeText) return '';
    const safeEscape = typeof escapeHtml === 'function' ? escapeHtml : (str => String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));

    if (!pdfHljs) {
        return safeEscape(codeText);
    }

    const langMap = {
        'js': 'javascript',
        'javascript': 'javascript',
        'ts': 'typescript',
        'typescript': 'typescript',
        'py': 'python',
        'python': 'python',
        'html': 'xml',
        'xml': 'xml',
        'htmlmixed': 'xml',
        'css': 'css',
        'c++': 'cpp',
        'cpp': 'cpp',
        'c': 'c',
        'c#': 'csharp',
        'csharp': 'csharp',
        'rust': 'rust',
        'go': 'go',
        'bash': 'bash',
        'sh': 'bash',
        'shell': 'bash',
        'sql': 'sql',
        'json': 'json',
        'yaml': 'yaml',
        'yml': 'yaml',
        'markdown': 'markdown',
        'md': 'markdown',
        'java': 'java',
        'kotlin': 'kotlin',
        'swift': 'swift',
        'php': 'php',
        'ruby': 'ruby',
        'text/x-c++src': 'cpp',
        'text/x-csrc': 'c',
        'text/x-java': 'java',
        'text/x-python': 'python',
        'text/x-rustsrc': 'rust'
    };

    const cleanLang = (rawLang || '').trim().toLowerCase();
    const mapped = langMap[cleanLang] || cleanLang;

    try {
        const highlighted = (mapped && pdfHljs.getLanguage(mapped))
            ? pdfHljs.highlight(codeText, { language: mapped, ignoreIllegals: true }).value
            : pdfHljs.highlightAuto(codeText).value;
        return highlighted == null ? safeEscape(codeText) : highlighted;
    } catch (_) {
        return safeEscape(codeText);
    }
}

// Build a clean, isolated DOM representation of the document for PDF export
function buildPdfDocumentPayload(title) {
    if (!content) return { title: title || 'Untitled', htmlContent: '' };

    const safeTitle = title || activeNoteName || 'Untitled Document';
    const clone = content.cloneNode(true);

    // 1. Remove editor-only & transient UI elements
    clone.querySelectorAll('.CodeMirror, .code-block-actions, .code-window-dots, .lang-caret, .block-lang-dropdown, .custom-color-popover, .delete-code-button, .media-toolbar, .media-resize-handle, .block-drag-handle, .media-drag-handle, .table-col-resizer').forEach(el => el.remove());
    clone.querySelectorAll('.media-container.is-resizing').forEach(el => el.classList.remove('is-resizing'));

    // 2. Convert all code blocks (.code-block-wrapper) into clean, printable pdf-code-block elements with Light Theme syntax highlighting
    const liveWrappers = content.querySelectorAll('.code-block-wrapper');
    const cloneWrappers = clone.querySelectorAll('.code-block-wrapper');
    liveWrappers.forEach((liveWrap, idx) => {
        const cloneWrap = cloneWrappers[idx];
        if (!cloneWrap) return;

        let codeText = '';
        const cm = liveWrap.querySelector('.CodeMirror');
        if (cm && cm.CodeMirror) {
            codeText = cm.CodeMirror.getValue();
        } else {
            const ta = liveWrap.querySelector('textarea.code');
            if (ta) codeText = ta.value || ta.textContent || '';
        }

        let langLabel = 'code';
        const langEl = liveWrap.querySelector('.lang-name') || liveWrap.querySelector('textarea.code');
        if (langEl) {
            langLabel = (langEl.textContent || langEl.getAttribute('language') || langEl.getAttribute('data-label') || 'code').trim();
        }

        const highlightedHtml = highlightCodeForPdf(codeText, langLabel);
        const pdfCodeBox = document.createElement('div');
        pdfCodeBox.className = 'pdf-code-block';
        pdfCodeBox.innerHTML = `
            <div class="pdf-code-header">
                <span class="pdf-code-lang">${typeof escapeHtml === 'function' ? escapeHtml(langLabel) : langLabel}</span>
            </div>
            <pre><code class="hljs">${highlightedHtml}</code></pre>
        `;
        cloneWrap.replaceWith(pdfCodeBox);
    });

    // 2b. Convert any legacy .code-block-layer blocks in clone
    clone.querySelectorAll('.code-block-layer').forEach(layer => {
        const parent = layer.parentElement;
        const ta = parent ? parent.querySelector('textarea.code') : null;
        const langP = layer.querySelector('p');
        const lang = (langP ? langP.textContent.trim() : '') || (ta ? ta.getAttribute('language') : '') || 'code';
        const codeText = ta ? (ta.value || ta.textContent || '') : '';
        const highlightedHtml = highlightCodeForPdf(codeText, lang);
        const pdfCodeBox = document.createElement('div');
        pdfCodeBox.className = 'pdf-code-block';
        pdfCodeBox.innerHTML = `
            <div class="pdf-code-header">
                <span class="pdf-code-lang">${typeof escapeHtml === 'function' ? escapeHtml(lang) : lang}</span>
            </div>
            <pre><code class="hljs">${highlightedHtml}</code></pre>
        `;
        if (parent && parent !== clone) {
            parent.replaceWith(pdfCodeBox);
        } else {
            layer.replaceWith(pdfCodeBox);
        }
    });

    // 3. Convert any orphaned textarea.code outside wrappers
    clone.querySelectorAll('textarea.code').forEach(ta => {
        const text = ta.value || ta.textContent || '';
        const lang = ta.getAttribute('language') || ta.getAttribute('data-label') || 'code';
        const highlightedHtml = highlightCodeForPdf(text, lang);
        const pdfCodeBox = document.createElement('div');
        pdfCodeBox.className = 'pdf-code-block';
        pdfCodeBox.innerHTML = `
            <div class="pdf-code-header">
                <span class="pdf-code-lang">${typeof escapeHtml === 'function' ? escapeHtml(lang) : lang}</span>
            </div>
            <pre><code class="hljs">${highlightedHtml}</code></pre>
        `;
        ta.replaceWith(pdfCodeBox);
    });

    // 4. Ensure checklists preserve their state (checked / unchecked)
    const liveCheckboxes = content.querySelectorAll('.checklist-checkbox');
    const cloneCheckboxes = clone.querySelectorAll('.checklist-checkbox');
    liveCheckboxes.forEach((cb, idx) => {
        if (cloneCheckboxes[idx]) {
            if (cb.checked) {
                cloneCheckboxes[idx].setAttribute('checked', 'checked');
            } else {
                cloneCheckboxes[idx].removeAttribute('checked');
            }
        }
    });

    // 5. Ensure image and video sources resolve to full paths
    clone.querySelectorAll('img, video').forEach(el => {
        const rel = el.getAttribute('data-asset-rel') || (el.getAttribute('src')?.startsWith('assets/') ? el.getAttribute('src') : null);
        if (rel && typeof savesDir !== 'undefined' && savesDir) {
            const absPath = path.join(savesDir, rel);
            el.src = typeof toLocalMediaUrl === 'function' ? toLocalMediaUrl(absPath) : `file://${absPath.replace(/\\/g, '/')}`;
        }
    });

    // 6. Check if document already has an H1 heading with the note title
    const firstH1 = clone.querySelector('h1');
    const hasHeaderTitle = firstH1 && firstH1.textContent.trim().toLowerCase() === safeTitle.trim().toLowerCase();
    let titleHtml = '';
    if (!hasHeaderTitle && safeTitle && safeTitle !== 'Untitled Document') {
        titleHtml = `<h1 class="pdf-document-title">${typeof escapeHtml === 'function' ? escapeHtml(safeTitle) : safeTitle}</h1>`;
    }

    return {
        title: safeTitle,
        htmlContent: `${titleHtml}${clone.innerHTML}`
    };
}

// Export Note as PDF (High-fidelity isolated document renderer with html2pdf fallback)
async function exportToPdf() {
    const targetTitle = activeNoteName || (content && content.innerText.trim().length > 0 ? 'Document' : null);
    if (!targetTitle) {
        showToast('No note content to export', 'warning');
        return;
    }

    showToast('Exporting PDF...', 'info');

    const payload = buildPdfDocumentPayload(targetTitle);

    try {
        const result = await ipcRenderer.invoke('export-pdf', {
            defaultName: payload.title || 'Document',
            title: payload.title,
            htmlContent: payload.htmlContent
        });

        if (result && result.success) {
            showToast(`PDF exported to "${result.fileName}"`, 'success');
            return;
        } else if (result && !result.success) {
            throw new Error(result.error);
        }
    } catch (ipcErr) {
        console.warn('Native PDF export failed or canceled, attempting client fallback:', ipcErr);
        if (typeof html2pdf !== 'undefined') {
            const tempContainer = document.createElement('div');
            tempContainer.style.cssText = 'position: absolute; left: -9999px; top: 0; width: 800px; background: #ffffff; color: #1e293b; padding: 24px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;';
            tempContainer.innerHTML = payload.htmlContent;
            document.body.appendChild(tempContainer);

            const opt = {
                margin: [15, 15, 15, 15],
                filename: `${payload.title || 'Document'}.pdf`,
                image: { type: 'jpeg', quality: 0.98 },
                html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
                jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
            };

            html2pdf().set(opt).from(tempContainer).save().then(() => {
                tempContainer.remove();
                showToast('PDF Export complete', 'success');
            }).catch(err => {
                tempContainer.remove();
                console.error('Client PDF export error:', err);
                showToast('Failed to export PDF', 'error');
            });
        } else {
            showToast('PDF export canceled or failed', 'warning');
        }
    }
}

// =========================================================================
// Non-Deletable First <h1> Header & Two-Way File Name Synchronization
// =========================================================================
let headerSyncTimer = null;
let headerSyncPromise = null;

function sanitizeNoteTitleToFileName(rawText) {
    if (!rawText) return '';
    return String(rawText)
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/[\/\\:*?"<>|]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80);
}

function ensureNoteFirstHeader(editorEl = content, fallbackTitle = activeNoteName, syncTextToFallback = false) {
    if (!editorEl || !activeNoteName) return null;
    if (editorEl.getAttribute('contenteditable') === 'false') return null;

    const titleFallback = sanitizeNoteTitleToFileName(fallbackTitle || activeNoteName) || 'Untitled';
    let firstEl = editorEl.firstElementChild;

    // Remove stray leading empty text nodes
    while (editorEl.firstChild && editorEl.firstChild.nodeType === Node.TEXT_NODE && !editorEl.firstChild.nodeValue.trim()) {
        editorEl.removeChild(editorEl.firstChild);
    }
    // If a stray leading text node has content before any element, wrap it in <h1>
    if (editorEl.firstChild && editorEl.firstChild.nodeType === Node.TEXT_NODE && editorEl.firstChild.nodeValue.trim()) {
        const textVal = editorEl.firstChild.nodeValue.trim();
        const h1 = document.createElement('h1');
        h1.textContent = textVal;
        editorEl.replaceChild(h1, editorEl.firstChild);
        firstEl = h1;
    }

    if (!firstEl || firstEl.tagName !== 'H1') {
        const h1 = document.createElement('h1');
        h1.textContent = titleFallback;
        h1.setAttribute('data-placeholder', titleFallback);
        editorEl.insertBefore(h1, editorEl.firstChild);
        firstEl = h1;
    } else {
        firstEl.setAttribute('data-placeholder', titleFallback);
        if (syncTextToFallback) {
            const currentHeaderTitle = sanitizeNoteTitleToFileName(firstEl.textContent || '');
            if (!currentHeaderTitle || currentHeaderTitle !== titleFallback) {
                firstEl.textContent = titleFallback;
            }
        }
    }

    // Ensure there is always at least one editable body block after the first <h1>
    if (editorEl.children.length === 1) {
        const p = document.createElement('p');
        p.innerHTML = '<br>';
        editorEl.appendChild(p);
    }

    return firstEl;
}

function updateLiveNoteTitleUI(displayTitle) {
    const clean = sanitizeNoteTitleToFileName(displayTitle) || activeNoteName || 'Untitled';
    if (typeof textTitle !== 'undefined' && textTitle) textTitle.textContent = clean;
    if (typeof activeDocTitle !== 'undefined' && activeDocTitle) activeDocTitle.textContent = clean;
    const activeNoteEl = document.getElementById('status-active-note');
    if (activeNoteEl) activeNoteEl.textContent = clean;

    if (activeNoteName) {
        document.querySelectorAll('.save').forEach(saveEl => {
            if (saveEl.getAttribute('data-file') === activeNoteName) {
                const titleEl = saveEl.querySelector('.save-title');
                if (titleEl) titleEl.textContent = clean;
            }
        });
    }
}

async function syncFirstHeaderToNoteName(options = {}) {
    if (headerSyncPromise) {
        try {
            await headerSyncPromise;
        } catch (_) {}
    }
    headerSyncPromise = _doSyncFirstHeaderToNoteName(options);
    try {
        return await headerSyncPromise;
    } finally {
        headerSyncPromise = null;
    }
}

async function _doSyncFirstHeaderToNoteName({ immediate = false, restoreIfEmpty = false, allowUniqueSuffix = false } = {}) {
    if (!activeNoteName || !content || content.getAttribute('contenteditable') === 'false') {
        return activeNoteName;
    }
    if (headerSyncTimer) {
        clearTimeout(headerSyncTimer);
        headerSyncTimer = null;
    }

    const firstH1 = ensureNoteFirstHeader(content, activeNoteName, false);
    if (!firstH1) return activeNoteName;

    const rawHeaderText = firstH1.textContent || '';
    const sanitized = sanitizeNoteTitleToFileName(rawHeaderText);

    if (!sanitized) {
        if (restoreIfEmpty) {
            firstH1.textContent = activeNoteName;
            firstH1.setAttribute('data-placeholder', activeNoteName);
            updateLiveNoteTitleUI(activeNoteName);
        } else {
            updateLiveNoteTitleUI(activeNoteName);
        }
        return activeNoteName;
    }

    if (sanitized === activeNoteName) {
        firstH1.setAttribute('data-placeholder', activeNoteName);
        updateLiveNoteTitleUI(activeNoteName);
        return activeNoteName;
    }

    if (typeof renameActiveNoteFromHeader === 'function') {
        const finalName = await renameActiveNoteFromHeader(activeNoteName, sanitized, { allowUniqueSuffix });
        if (finalName) {
            firstH1.setAttribute('data-placeholder', finalName);
            if (finalName !== sanitized && allowUniqueSuffix) {
                firstH1.textContent = finalName;
            }
            updateLiveNoteTitleUI(finalName);
        }
        return finalName;
    }

    return activeNoteName;
}

function scheduleFirstHeaderSync(delayMs = 450) {
    if (!activeNoteName || !content) return;
    const firstH1 = content.firstElementChild;
    if (firstH1 && firstH1.tagName === 'H1') {
        const previewTitle = sanitizeNoteTitleToFileName(firstH1.textContent || '');
        updateLiveNoteTitleUI(previewTitle || activeNoteName);
    }
    if (headerSyncTimer) {
        clearTimeout(headerSyncTimer);
    }
    headerSyncTimer = setTimeout(() => {
        syncFirstHeaderToNoteName({ immediate: true, restoreIfEmpty: false, allowUniqueSuffix: false });
    }, delayMs);
}

function isCaretAtStartOfElement(el, range) {
    if (!el || !range || !range.collapsed) return false;
    const testRange = document.createRange();
    testRange.selectNodeContents(el);
    testRange.setEnd(range.startContainer, range.startOffset);
    return testRange.toString().length === 0;
}

function isCaretAtEndOfElement(el, range) {
    if (!el || !range || !range.collapsed) return false;
    const testRange = document.createRange();
    testRange.selectNodeContents(el);
    testRange.setStart(range.endContainer, range.endOffset);
    return testRange.toString().length === 0;
}

function placeCaretInElement(el, atStart = true) {
    if (!el) return;
    try {
        const sel = window.getSelection();
        if (!sel) return;
        const r = document.createRange();
        r.selectNodeContents(el);
        r.collapse(atStart);
        sel.removeAllRanges();
        sel.addRange(r);
    } catch (_) {}
}

function setupFirstHeaderProtection() {
    if (!content || content.dataset.firstHeaderProtected) return;
    content.dataset.firstHeaderProtected = 'true';

    content.addEventListener('keydown', (e) => {
        if (!activeNoteName || content.getAttribute('contenteditable') === 'false') return;
        const firstH1 = ensureNoteFirstHeader(content, activeNoteName, false);
        if (!firstH1) return;

        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return;
        const range = sel.getRangeAt(0);

        const startInH1 = firstH1.contains(range.startContainer) || (range.startContainer === content && range.startOffset === 0);
        const endInH1 = firstH1.contains(range.endContainer) || (range.endContainer === content && range.endOffset <= 1);
        const touchesH1 = startInH1 || endInH1 || range.intersectsNode(firstH1);

        // Enter inside first <h1> -> move to body paragraph below and sync filename immediately
        if (e.key === 'Enter' && !e.shiftKey && startInH1 && endInH1) {
            e.preventDefault();
            const applyEnter = () => {
                let nextEl = firstH1.nextElementSibling;
                if (!nextEl || nextEl.getAttribute('contenteditable') === 'false' || nextEl.tagName === 'TABLE') {
                    nextEl = document.createElement('p');
                    nextEl.innerHTML = '<br>';
                    firstH1.after(nextEl);
                }
                placeCaretInElement(nextEl, true);
            };
            if (window.NoshUndo) window.NoshUndo.runWithUndo(applyEnter);
            else applyEnter();
            syncFirstHeaderToNoteName({ immediate: true, restoreIfEmpty: true, allowUniqueSuffix: true });
            triggerAutoSave();
            return;
        }

        if (e.key === 'Backspace' || e.key === 'Delete') {
            const h1Text = firstH1.textContent || '';

            // Case 1: Multi-block selection spanning first <h1> and subsequent blocks (e.g. Ctrl+A + Backspace/Delete)
            if (!range.collapsed && touchesH1 && !(startInH1 && endInH1)) {
                e.preventDefault();
                const applyMultiDelete = () => {
                    // Preserve first <h1> (cannot be deleted) and remove selected content after first <h1>
                    const tailRange = document.createRange();
                    if (firstH1.nextSibling) {
                        tailRange.setStartBefore(firstH1.nextSibling);
                        tailRange.setEnd(range.endContainer, range.endOffset);
                        tailRange.deleteContents();
                    }
                    if (!firstH1.textContent.trim()) {
                        firstH1.textContent = activeNoteName;
                    }
                    if (content.children.length === 1) {
                        const p = document.createElement('p');
                        p.innerHTML = '<br>';
                        content.appendChild(p);
                    }
                    placeCaretInElement(firstH1.nextElementSibling || firstH1, true);
                };
                if (window.NoshUndo) window.NoshUndo.runWithUndo(applyMultiDelete);
                else applyMultiDelete();
                triggerAutoSave();
                return;
            }

            // Case 2: Selection is entirely inside first <h1>
            if (startInH1 && endInH1) {
                if (!range.collapsed) {
                    const selectedLen = range.toString().length;
                    if (selectedLen >= h1Text.length) {
                        e.preventDefault();
                        const clearH1 = () => {
                            firstH1.innerHTML = '';
                            placeCaretInElement(firstH1, true);
                        };
                        if (window.NoshUndo) window.NoshUndo.runWithUndo(clearH1);
                        else clearH1();
                        scheduleFirstHeaderSync();
                        triggerAutoSave();
                        return;
                    }
                } else if (e.key === 'Backspace') {
                    if (h1Text.length === 0 || isCaretAtStartOfElement(firstH1, range)) {
                        e.preventDefault();
                        return;
                    }
                    if (h1Text.length === 1) {
                        e.preventDefault();
                        const clearH1 = () => {
                            firstH1.innerHTML = '';
                            placeCaretInElement(firstH1, true);
                        };
                        if (window.NoshUndo) window.NoshUndo.runWithUndo(clearH1);
                        else clearH1();
                        scheduleFirstHeaderSync();
                        triggerAutoSave();
                        return;
                    }
                } else if (e.key === 'Delete') {
                    if (isCaretAtEndOfElement(firstH1, range)) {
                        // Prevent pulling next block into the first <h1>
                        e.preventDefault();
                        return;
                    }
                    if (h1Text.length === 1 && isCaretAtStartOfElement(firstH1, range)) {
                        e.preventDefault();
                        const clearH1 = () => {
                            firstH1.innerHTML = '';
                            placeCaretInElement(firstH1, true);
                        };
                        if (window.NoshUndo) window.NoshUndo.runWithUndo(clearH1);
                        else clearH1();
                        scheduleFirstHeaderSync();
                        triggerAutoSave();
                        return;
                    }
                }
            }

            // Case 3: Backspace at the very start of the element immediately after first <h1>
            if (e.key === 'Backspace' && range.collapsed && !startInH1) {
                let topBlock = range.startContainer;
                while (topBlock && topBlock !== content && topBlock.parentNode !== content) {
                    topBlock = topBlock.parentNode;
                }
                if (topBlock && topBlock === firstH1.nextElementSibling && isCaretAtStartOfElement(topBlock, range)) {
                    e.preventDefault();
                    const applyRemoveEmptyBlock = () => {
                        const blockEmpty = (topBlock.textContent || '').trim() === '' &&
                            !topBlock.querySelector?.('img, video, table, .code-block-wrapper, .math-formula-block, .claude-embedded-diagram, .checklist-checkbox');
                        if (blockEmpty && content.children.length > 2) {
                            topBlock.remove();
                        }
                        placeCaretInElement(firstH1, false);
                    };
                    if (window.NoshUndo) window.NoshUndo.runWithUndo(applyRemoveEmptyBlock);
                    else applyRemoveEmptyBlock();
                    return;
                }
            }
        }
    });

    content.addEventListener('cut', (e) => {
        if (!activeNoteName || content.getAttribute('contenteditable') === 'false') return;
        const firstH1 = content.firstElementChild;
        if (!firstH1 || firstH1.tagName !== 'H1') return;
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return;
        const range = sel.getRangeAt(0);
        if (!range.collapsed && range.intersectsNode(firstH1)) {
            setTimeout(() => {
                ensureNoteFirstHeader(content, activeNoteName, false);
                scheduleFirstHeaderSync();
            }, 0);
        }
    });

    content.addEventListener('blur', async () => {
        if (!activeNoteName || content.getAttribute('contenteditable') === 'false') return;
        if (window.NoshUndo) window.NoshUndo.flushPendingTyping();
        await syncFirstHeaderToNoteName({ immediate: true, restoreIfEmpty: true, allowUniqueSuffix: true });
        if (window.NoshUndo) window.NoshUndo.syncSilentState();
    });
}

setupFirstHeaderProtection();
window.ensureNoteFirstHeader = ensureNoteFirstHeader;
window.syncFirstHeaderToNoteName = syncFirstHeaderToNoteName;
window.sanitizeNoteTitleToFileName = sanitizeNoteTitleToFileName;

// Change Tracking & Auto-Save
let autoSaveTimer = null;

function clearAutoSaveTimer() {
    if (autoSaveTimer) {
        clearTimeout(autoSaveTimer);
        autoSaveTimer = null;
    }
}

function triggerAutoSave() {
    if (!activeNoteName) return;

    if (typeof ensureNoteFirstHeader === 'function') {
        ensureNoteFirstHeader(content, activeNoteName, false);
    }
    if (typeof scheduleFirstHeaderSync === 'function') {
        scheduleFirstHeaderSync(450);
    }

    if (!hasUnsavedChanges) {
        hasUnsavedChanges = true;
        if (unsavedDot) unsavedDot.classList.add('active');
    }

    if (typeof updateStatusBarStats === 'function') {
        updateStatusBarStats();
    }

    if (typeof refreshOutlineIfOpen === 'function') {
        refreshOutlineIfOpen();
    }

    // Debounced Auto-save (on by default)
    if ((localStorage.getItem('autoSave') ?? 'true') === 'true') {
        clearTimeout(autoSaveTimer);
        autoSaveTimer = setTimeout(() => {
            saveFile();
        }, 1500);
    }
}

// Document Status Bar Statistics
function updateStatusBarStats() {
    if (!content) return;

    const text = content.innerText || '';
    const trimmed = text.trim();

    // Word count
    const words = trimmed ? trimmed.split(/\s+/).filter(Boolean).length : 0;
    // Character count
    const chars = text.length;
    // Read time (~200 words per minute)
    const readTime = Math.max(1, Math.ceil(words / 200));
    // Code blocks count
    const codeBlocks = content.querySelectorAll('.code-block-wrapper').length;

    const wordsEl = document.getElementById('stat-words');
    const charsEl = document.getElementById('stat-chars');
    const readTimeEl = document.getElementById('stat-read-time');
    const codeBlocksEl = document.getElementById('stat-code-blocks');
    const syncDot = document.getElementById('status-sync-dot');
    const syncText = document.getElementById('status-sync-text');
    const activeNoteEl = document.getElementById('status-active-note');

    if (wordsEl) wordsEl.textContent = `${words} ${words === 1 ? 'word' : 'words'}`;
    if (charsEl) charsEl.textContent = `${chars.toLocaleString()} chars`;
    if (readTimeEl) readTimeEl.textContent = words > 0 ? `~${readTime} min read` : '0 min read';
    if (codeBlocksEl) codeBlocksEl.textContent = `${codeBlocks} ${codeBlocks === 1 ? 'code block' : 'code blocks'}`;

    if (activeNoteEl) {
        activeNoteEl.textContent = activeNoteName || 'Welcome';
    }

    if (syncDot && syncText) {
        if (hasUnsavedChanges) {
            syncDot.className = 'status-indicator-dot unsaved';
            syncText.textContent = 'Unsaved changes';
        } else {
            syncDot.className = 'status-indicator-dot';
            syncText.textContent = 'Saved';
        }
    }
}

content.addEventListener('input', triggerAutoSave);
setTimeout(updateStatusBarStats, 100);

// --- In-Document Find & Replace ---
let docFindMatches = [];
let docFindMatchesCount = 0;
let docFindCurrentIndex = 0;

function clearDocFindHighlights() {
    if (window.CSS && CSS.highlights) {
        CSS.highlights.delete('search-results');
        CSS.highlights.delete('search-active');
    }
}

function updateDocFindHighlights() {
    if (!window.CSS || !CSS.highlights) return;
    if (docFindMatches.length === 0) {
        CSS.highlights.delete('search-results');
        CSS.highlights.delete('search-active');
        return;
    }

    try {
        const allHighlight = new Highlight(...docFindMatches);
        CSS.highlights.set('search-results', allHighlight);

        if (docFindCurrentIndex > 0 && docFindMatches[docFindCurrentIndex - 1]) {
            const activeMatch = docFindMatches[docFindCurrentIndex - 1];
            const activeHighlight = new Highlight(activeMatch);
            CSS.highlights.set('search-active', activeHighlight);
        } else {
            CSS.highlights.delete('search-active');
        }
    } catch (e) {
        console.warn('CSS Highlight error:', e);
    }
}

function findMatchesInEditor(query) {
    const ranges = [];
    if (!content || !query) return ranges;

    const lowerQuery = query.toLowerCase();
    const queryLen = query.length;

    const walker = document.createTreeWalker(
        content,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode: (node) => {
                if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
                const parent = node.parentElement;
                if (!parent) return NodeFilter.FILTER_REJECT;
                if (parent.closest('script') || parent.closest('style')) {
                    return NodeFilter.FILTER_REJECT;
                }
                if (parent.closest('.CodeMirror-gutters') || parent.closest('.CodeMirror-linenumber')) {
                    return NodeFilter.FILTER_REJECT;
                }
                if (parent.tagName === 'TEXTAREA') {
                    return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        }
    );

    let textNode;
    while ((textNode = walker.nextNode())) {
        const text = textNode.nodeValue;
        const lowerText = text.toLowerCase();
        let startIndex = 0;
        let index;

        while ((index = lowerText.indexOf(lowerQuery, startIndex)) !== -1) {
            const range = document.createRange();
            range.setStart(textNode, index);
            range.setEnd(textNode, index + queryLen);
            ranges.push(range);
            startIndex = index + queryLen;
        }
    }
    return ranges;
}

function jumpToDocMatch(index, shouldScroll = true) {
    const counter = document.getElementById('doc-find-counter');
    if (docFindMatchesCount === 0) {
        docFindCurrentIndex = 0;
        if (counter) counter.textContent = '0/0';
        clearDocFindHighlights();
        return;
    }

    docFindCurrentIndex = Math.max(1, Math.min(index, docFindMatchesCount));
    if (counter) {
        counter.textContent = `${docFindCurrentIndex}/${docFindMatchesCount}`;
    }

    updateDocFindHighlights();

    const range = docFindMatches[docFindCurrentIndex - 1];
    if (range) {
        try {
            const sel = window.getSelection();
            if (sel) {
                sel.removeAllRanges();
                sel.addRange(range.cloneRange());
            }
        } catch (e) {}

        if (shouldScroll) {
            const el = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
            if (el && typeof el.scrollIntoView === 'function') {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    }
}

function openDocFindBar() {
    const findBar = document.getElementById('editor-find-bar');
    const findInput = document.getElementById('doc-find-input');
    if (!findBar || !findInput) return;

    findBar.style.display = 'flex';

    // If text is selected in the editor, prepopulate the find input
    const selection = window.getSelection().toString().trim();
    if (selection && selection.length < 80) {
        findInput.value = selection;
    }

    findInput.focus();
    findInput.select();
    performDocSearch(false);
}

function closeDocFindBar() {
    const findBar = document.getElementById('editor-find-bar');
    if (findBar) findBar.style.display = 'none';
    const counter = document.getElementById('doc-find-counter');
    if (counter) counter.textContent = '0/0';
    clearDocFindHighlights();
    docFindMatches = [];
    docFindMatchesCount = 0;
    docFindCurrentIndex = 0;
    if (content) content.focus();
}

function toggleReplaceRow(forceOpen = null) {
    const replaceRow = document.getElementById('replace-row');
    const toggleBtn = document.getElementById('find-toggle-replace');
    if (!replaceRow) return;

    const shouldOpen = forceOpen !== null ? forceOpen : (replaceRow.style.display === 'none');
    replaceRow.style.display = shouldOpen ? 'flex' : 'none';
    if (toggleBtn) toggleBtn.classList.toggle('active', shouldOpen);

    if (shouldOpen) {
        const replaceInput = document.getElementById('doc-replace-input');
        if (replaceInput) {
            replaceInput.focus();
            replaceInput.select();
        }
    }
}

function escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function performDocSearch(backwards = false) {
    const findInput = document.getElementById('doc-find-input');
    const isFocused = (document.activeElement === findInput);
    const selStart = findInput ? findInput.selectionStart : null;
    const selEnd = findInput ? findInput.selectionEnd : null;

    const counter = document.getElementById('doc-find-counter');
    const query = findInput ? findInput.value.trim() : '';

    if (!query) {
        docFindMatches = [];
        docFindMatchesCount = 0;
        docFindCurrentIndex = 0;
        if (counter) counter.textContent = '0/0';
        clearDocFindHighlights();
        return false;
    }

    docFindMatches = findMatchesInEditor(query);
    docFindMatchesCount = docFindMatches.length;

    if (docFindMatchesCount === 0) {
        docFindCurrentIndex = 0;
        if (counter) counter.textContent = '0/0';
        clearDocFindHighlights();
    } else {
        if (docFindCurrentIndex === 0 || docFindCurrentIndex > docFindMatchesCount) {
            docFindCurrentIndex = 1;
        }
        jumpToDocMatch(docFindCurrentIndex, true);
    }

    // Maintain focus and caret inside find input while typing
    if (isFocused && findInput) {
        findInput.focus();
        if (selStart !== null && selEnd !== null) {
            findInput.setSelectionRange(selStart, selEnd);
        }
    }

    return docFindMatchesCount > 0;
}

function findNextMatch() {
    if (docFindMatchesCount === 0) {
        performDocSearch(false);
        return;
    }
    const nextIndex = (docFindCurrentIndex % docFindMatchesCount) + 1;
    jumpToDocMatch(nextIndex, true);
}

function findPrevMatch() {
    if (docFindMatchesCount === 0) {
        performDocSearch(true);
        return;
    }
    const prevIndex = ((docFindCurrentIndex - 2 + docFindMatchesCount) % docFindMatchesCount) + 1;
    jumpToDocMatch(prevIndex, true);
}

function replaceCurrentMatch() {
    const findInput = document.getElementById('doc-find-input');
    const replaceInput = document.getElementById('doc-replace-input');
    if (!findInput || !replaceInput) return;

    const query = findInput.value.trim();
    const replacement = replaceInput.value;
    if (!query || docFindMatchesCount === 0) return;

    const range = docFindMatches[docFindCurrentIndex - 1];
    if (range) {
        const applyReplace = () => {
            range.deleteContents();
            const textNode = document.createTextNode(replacement);
            range.insertNode(textNode);
            const afterRange = document.createRange();
            afterRange.setStartAfter(textNode);
            afterRange.collapse(true);
            const sel = window.getSelection();
            if (sel) {
                sel.removeAllRanges();
                sel.addRange(afterRange);
            }
        };
        if (window.NoshUndo) window.NoshUndo.runWithUndo(applyReplace);
        else applyReplace();
        triggerAutoSave();
        showToast('Match replaced', 'info');
        performDocSearch(false);
    }
}

function replaceAllMatches() {
    const findInput = document.getElementById('doc-find-input');
    const replaceInput = document.getElementById('doc-replace-input');
    if (!findInput || !replaceInput) return;

    const query = findInput.value.trim();
    const replacement = replaceInput.value;
    if (!query) return;

    let count = 0;
    const regex = new RegExp(escapeRegex(query), 'gi');
    const applyReplaceAll = () => {
        const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT, {
            acceptNode: (node) => {
                if (node.parentElement && node.parentElement.closest('.CodeMirror')) {
                    return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        });

        const nodesToReplace = [];
        while (walker.nextNode()) {
            regex.lastIndex = 0;
            if (regex.test(walker.currentNode.nodeValue)) {
                nodesToReplace.push(walker.currentNode);
            }
        }

        nodesToReplace.forEach(node => {
            regex.lastIndex = 0;
            const matches = node.nodeValue.match(regex);
            if (matches) count += matches.length;
            node.nodeValue = node.nodeValue.replace(regex, replacement);
        });
    };

    if (window.NoshUndo) window.NoshUndo.runWithUndo(applyReplaceAll);
    else applyReplaceAll();

    if (count > 0) {
        triggerAutoSave();
        showToast(`Replaced ${count} occurrence${count > 1 ? 's' : ''}`, 'success');
        performDocSearch(false);
    } else {
        showToast('No matches found to replace', 'info');
    }
}

// Bind Enter and Escape on Find Inputs
function setupFindInputListeners() {
    const findInput = document.getElementById('doc-find-input');
    if (findInput && !findInput.dataset.listenersAttached) {
        findInput.dataset.listenersAttached = 'true';
        findInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (e.shiftKey) findPrevMatch();
                else findNextMatch();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                closeDocFindBar();
            }
        });
    }

    const replaceInput = document.getElementById('doc-replace-input');
    if (replaceInput && !replaceInput.dataset.listenersAttached) {
        replaceInput.dataset.listenersAttached = 'true';
        replaceInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                replaceCurrentMatch();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                closeDocFindBar();
            }
        });
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupFindInputListeners);
} else {
    setupFindInputListeners();
}

document.addEventListener('DOMContentLoaded', () => {

    // Enable smooth horizontal wheel scrolling on the formatting toolbar
    const toolbarTools = document.getElementById('toolbar-tools');
    if (toolbarTools) {
        toolbarTools.addEventListener('wheel', (e) => {
            if (e.deltaY !== 0) {
                e.preventDefault();
                toolbarTools.scrollLeft += e.deltaY;
            }
        }, { passive: false });
    }
});

// --- Interactive Checklist / Task List ---
function insertChecklist() {
    if (!activeNoteName) {
        showToast('Create or open a note first', 'warning');
        return;
    }

    const applyInsert = () => {
        const item = document.createElement('div');
        item.className = 'checklist-item';
        item.setAttribute('contenteditable', 'false');
        item.innerHTML = `
        <input type="checkbox" class="checklist-checkbox" onchange="toggleChecklistItem(this)">
        <span class="checklist-text" contenteditable="true" placeholder="To-do item..."></span>
    `;

        const sel = window.getSelection();
        let block = null;
        if (sel && sel.rangeCount > 0) {
            let node = sel.getRangeAt(0).startContainer;
            while (node && node.parentElement !== content) {
                node = node.parentElement;
            }
            if (node && node.parentElement === content) {
                block = node;
            }
        }

        if (block) {
            if (block.textContent.trim() === '') {
                content.replaceChild(item, block);
            } else {
                content.insertBefore(item, block.nextSibling);
            }
        } else {
            content.appendChild(item);
        }

        const nextLine = document.createElement('p');
        nextLine.innerHTML = '<br>';
        if (item.nextSibling) {
            content.insertBefore(nextLine, item.nextSibling);
        } else {
            content.appendChild(nextLine);
        }

        const textSpan = item.querySelector('.checklist-text');
        if (textSpan) {
            textSpan.focus();
            if (typeof placeCaretInElement === 'function') {
                placeCaretInElement(textSpan, true);
            }
            textSpan.addEventListener('keydown', handleChecklistKeydown);
        }
    };

    if (window.NoshUndo) window.NoshUndo.runWithUndo(applyInsert);
    else applyInsert();

    triggerAutoSave();
    showToast('Checklist item added', 'info');
}

function insertTable(rows = 3, cols = 3) {
    if (!activeNoteName) {
        showToast('Create or open a note first', 'warning');
        return;
    }

    const applyInsertTable = () => {
        const container = document.createElement('div');
        container.className = 'table-container';

        let tableHtml = '<table><thead><tr>';
        for (let c = 1; c <= cols; c++) {
            tableHtml += `<th>Header ${c}</th>`;
        }
        tableHtml += '</tr></thead><tbody>';
        for (let r = 1; r <= rows; r++) {
            tableHtml += '<tr>';
            for (let c = 1; c <= cols; c++) {
                tableHtml += `<td>Cell ${r},${c}</td>`;
            }
            tableHtml += '</tr>';
        }
        tableHtml += '</tbody></table>';
        container.innerHTML = tableHtml;

        const sel = window.getSelection();
        let block = null;
        if (sel && sel.rangeCount > 0) {
            let node = sel.getRangeAt(0).startContainer;
            while (node && node.parentElement !== content) {
                node = node.parentElement;
            }
            if (node && node.parentElement === content) {
                block = node;
            }
        }

        if (block) {
            if (block.textContent.trim() === '') {
                content.replaceChild(container, block);
            } else {
                content.insertBefore(container, block.nextSibling);
            }
        } else {
            content.appendChild(container);
        }

        const nextLine = document.createElement('p');
        nextLine.innerHTML = '<br>';
        if (container.nextSibling) {
            content.insertBefore(nextLine, container.nextSibling);
        } else {
            content.appendChild(nextLine);
        }

        attachTableColumnResizers(container.querySelector('table'));

        const firstCell = container.querySelector('th, td');
        if (firstCell) {
            const range = document.createRange();
            const s = window.getSelection();
            range.selectNodeContents(firstCell);
            s.removeAllRanges();
            s.addRange(range);
        }
    };

    if (window.NoshUndo) window.NoshUndo.runWithUndo(applyInsertTable);
    else applyInsertTable();

    triggerAutoSave();
    showToast('Table inserted', 'info');
}

function attachTableColumnResizers(table) {
    if (!table) return;
    const firstRow = table.querySelector('thead tr') || table.querySelector('tr');
    if (!firstRow) return;

    const cells = Array.from(firstRow.children).filter(el => el.tagName === 'TH' || el.tagName === 'TD');
    if (cells.length === 0) return;

    cells.forEach((cell) => {
        let handle = cell.querySelector('.table-col-resizer');
        if (!handle) {
            handle = document.createElement('div');
            handle.className = 'table-col-resizer';
            handle.setAttribute('contenteditable', 'false');
            handle.setAttribute('title', 'Drag to resize column (Double-click to reset)');
            cell.appendChild(handle);
        }

        handle.onmousedown = (e) => {
            e.preventDefault();
            e.stopPropagation();

            const dragTx = window.NoshUndo ? window.NoshUndo.beginTransaction() : null;

            const allCols = Array.from(firstRow.children).filter(el => el.tagName === 'TH' || el.tagName === 'TD');
            const currentIndex = allCols.indexOf(cell);
            if (currentIndex === -1) {
                if (dragTx) dragTx.cancel();
                return;
            }

            // Measure and lock initial widths for all columns in this table
            const initialWidths = allCols.map(c => Math.round(c.getBoundingClientRect().width));
            const initialTableWidth = Math.round(table.getBoundingClientRect().width);

            const contentEl = document.getElementById('content');
            // Bounded strictly by available editor width so the table never overflows the page
            const maxPageWidth = contentEl ? Math.floor(contentEl.clientWidth - 24) : 800;
            const otherColsWidth = initialWidths.reduce((sum, w, idx) => idx === currentIndex ? sum : sum + w, 0);
            const maxAllowedColWidth = Math.max(15, maxPageWidth - otherColsWidth);

            allCols.forEach((c, idx) => {
                c.style.width = `${initialWidths[idx]}px`;
                c.style.minWidth = '0px';
                c.style.maxWidth = `${maxAllowedColWidth}px`;
            });

            table.style.tableLayout = 'fixed';
            table.style.width = `${Math.min(maxPageWidth, initialTableWidth)}px`;
            table.style.minWidth = '0px';
            table.style.maxWidth = '100%';

            const startX = e.clientX;
            const startCellWidth = initialWidths[currentIndex];
            handle.classList.add('is-active');
            document.body.classList.add('is-table-resizing');

            const onMouseMove = (moveEvent) => {
                const diffX = moveEvent.clientX - startX;
                // Minimum limit removed (safe 10px boundary prevents negative width), maximum limit strictly prevents overflowing the page
                const newCellWidth = Math.max(10, Math.min(maxAllowedColWidth, startCellWidth + diffX));
                cell.style.width = `${newCellWidth}px`;
                cell.style.minWidth = '0px';
                cell.style.maxWidth = `${maxAllowedColWidth}px`;

                // Total table width strictly hugs column sizes and never exceeds the page
                const newTableWidth = Math.min(maxPageWidth, otherColsWidth + newCellWidth);
                table.style.width = `${newTableWidth}px`;
                table.style.maxWidth = '100%';
            };

            const onMouseUp = () => {
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
                handle.classList.remove('is-active');
                document.body.classList.remove('is-table-resizing');

                if (dragTx) dragTx.commit();

                hasUnsavedChanges = true;
                if (typeof unsavedDot !== 'undefined' && unsavedDot) unsavedDot.classList.add('active');
                if (typeof triggerAutoSave === 'function') triggerAutoSave();
                if (typeof updateStatusBarStats === 'function') updateStatusBarStats();
            };

            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        };

        handle.ondblclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            const applyReset = () => {
                cell.style.width = 'auto';
                cell.style.minWidth = '';
                cell.style.maxWidth = '';
                const allCols = Array.from(firstRow.children).filter(el => el.tagName === 'TH' || el.tagName === 'TD');
                const hasCustomWidth = allCols.some(c => c.style.width && c.style.width !== 'auto');
                if (!hasCustomWidth) {
                    table.style.width = 'max-content';
                    table.style.tableLayout = '';
                }
            };
            if (window.NoshUndo) window.NoshUndo.runWithUndo(applyReset);
            else applyReset();
            hasUnsavedChanges = true;
            if (typeof triggerAutoSave === 'function') triggerAutoSave();
        };
    });
}

function processTables(root = document) {
    const scope = root && root.querySelectorAll ? root : document;
    const tables = scope.querySelectorAll('#content table, .history-rendered table');
    tables.forEach(table => attachTableColumnResizers(table));
}

// Global mouseover listener to ensure dynamically inserted/pasted tables instantly get resizers
document.addEventListener('mouseover', (e) => {
    const table = e.target && e.target.closest && e.target.closest('#content table');
    if (table) {
        attachTableColumnResizers(table);
    }
});

function toggleChecklistItem(checkbox) {
    const item = checkbox.closest('.checklist-item');
    if (!item) return;

    const beforeState = window.NoshUndo ? window.NoshUndo.peekCommittedState() : null;

    if (checkbox.checked) {
        item.classList.add('completed');
        checkbox.setAttribute('checked', 'checked');
    } else {
        item.classList.remove('completed');
        checkbox.removeAttribute('checked');
    }

    if (window.NoshUndo && beforeState) {
        window.NoshUndo.commitFromBaseline(beforeState);
    }

    triggerAutoSave();
}

function handleChecklistKeydown(e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        insertChecklist();
    } else if (e.key === 'Backspace' && e.target.textContent.trim() === '') {
        const item = e.target.closest('.checklist-item');
        if (item) {
            e.preventDefault();
            const removeItem = () => {
                const p = document.createElement('p');
                p.innerHTML = '<br>';
                item.parentNode.replaceChild(p, item);
                const range = document.createRange();
                const sel = window.getSelection();
                range.setStart(p, 0);
                range.collapse(true);
                sel.removeAllRanges();
                sel.addRange(range);
            };
            if (window.NoshUndo) window.NoshUndo.runWithUndo(removeItem);
            else removeItem();
            triggerAutoSave();
        }
    }
}

// Ensure loaded checklists have change handlers attached
function processChecklists() {
    document.querySelectorAll('.checklist-item').forEach(item => {
        const cb = item.querySelector('.checklist-checkbox');
        if (cb) {
            if (!cb.hasAttribute('onchange')) {
                cb.setAttribute('onchange', 'toggleChecklistItem(this)');
            }
            if (cb.checked) item.classList.add('completed');
            else item.classList.remove('completed');
        }
        const text = item.querySelector('.checklist-text');
        if (text) {
            text.removeEventListener('keydown', handleChecklistKeydown);
            text.addEventListener('keydown', handleChecklistKeydown);
        }
    });
}

// --- Markdown Export & Copy ---
function htmlToMarkdown(elementOrHtml) {
    let container;
    if (typeof elementOrHtml === 'string') {
        container = document.createElement('div');
        container.innerHTML = elementOrHtml;
    } else {
        container = elementOrHtml.cloneNode(true);
    }

    function parseNode(node) {
        if (!node) return '';

        if (node.nodeType === Node.TEXT_NODE) {
            return node.nodeValue;
        }

        if (node.nodeType === Node.ELEMENT_NODE) {
            const tag = node.tagName.toLowerCase();

            // Skip transient editor toolbars, resize handles, and action buttons
            if (node.classList && (
                node.classList.contains('media-toolbar') ||
                node.classList.contains('media-resize-handle') ||
                node.classList.contains('table-col-resizer') ||
                node.classList.contains('block-drag-handle') ||
                node.classList.contains('media-drag-handle') ||
                node.classList.contains('code-block-actions') ||
                node.classList.contains('code-window-dots') ||
                node.classList.contains('block-lang-dropdown') ||
                node.classList.contains('custom-color-popover') ||
                node.classList.contains('delete-code-button')
            )) {
                return '';
            }

            // Code Block
            if (node.classList.contains('code-block-wrapper')) {
                const lang = node.querySelector('.code-lang-tag')?.textContent?.trim()?.toLowerCase() || '';
                const code = node.querySelector('.CodeMirror')?.CodeMirror ? 
                    node.querySelector('.CodeMirror').CodeMirror.getValue() : 
                    (node.querySelector('textarea.code')?.value || node.querySelector('textarea.code')?.textContent || '');
                return `\n\`\`\`${lang}\n${code}\n\`\`\`\n\n`;
            }

            // Math Formula Block / Inline
            if (node.classList.contains('math-formula-block')) {
                const latex = node.getAttribute('data-latex') || node.textContent.trim();
                return `\n\`\`\`latex\n${latex}\n\`\`\`\n\n`;
            }
            if (node.classList.contains('math-formula-inline')) {
                const latex = node.getAttribute('data-latex') || node.textContent.trim();
                return `$${latex}$`;
            }

            // Claude Embedded Diagram Block
            if (node.classList.contains('claude-embedded-diagram')) {
                const cap = node.getAttribute('data-diagram-caption') || node.querySelector('.claude-diagram-caption')?.textContent?.trim() || 'diagram';
                return `\n[embedded content: ${cap}]\n\n`;
            }

            // Checklist Item
            if (node.classList.contains('checklist-item')) {
                const isChecked = node.querySelector('.checklist-checkbox')?.checked || node.querySelector('.checklist-checkbox')?.hasAttribute('checked');
                const text = node.querySelector('.checklist-text')?.textContent?.trim() || '';
                return `- [${isChecked ? 'x' : ' '}] ${text}\n`;
            }

            // Internal Note Link ([[Note Title]])
            if (node.classList.contains('note-internal-link') || node.classList.contains('note-link')) {
                const noteName = node.getAttribute('data-note') || node.textContent.trim();
                return `[[${noteName}]]`;
            }

            // GFM Table
            if (tag === 'table') {
                const rows = Array.from(node.querySelectorAll('tr'));
                if (rows.length === 0) return '';
                const matrix = rows.map(row =>
                    Array.from(row.querySelectorAll('th, td')).map(cell => {
                        let cellMd = '';
                        cell.childNodes.forEach(ch => { cellMd += parseNode(ch); });
                        return cellMd.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();
                    })
                );
                const colCount = Math.max(...matrix.map(r => r.length), 1);
                const padRow = (r) => {
                    const copy = r.slice();
                    while (copy.length < colCount) copy.push('');
                    return `| ${copy.join(' | ')} |`;
                };
                const headerLine = padRow(matrix[0]);
                const sepLine = `| ${Array(colCount).fill('---').join(' | ')} |`;
                const bodyLines = matrix.slice(1).map(padRow);
                return `\n${[headerLine, sepLine, ...bodyLines].join('\n')}\n\n`;
            }

            let inner = '';
            node.childNodes.forEach(child => {
                inner += parseNode(child);
            });

            switch (tag) {
                case 'h1': return `# ${inner.trim()}\n\n`;
                case 'h2': return `## ${inner.trim()}\n\n`;
                case 'h3': return `### ${inner.trim()}\n\n`;
                case 'h4': return `#### ${inner.trim()}\n\n`;
                case 'h5': return `##### ${inner.trim()}\n\n`;
                case 'h6': return `###### ${inner.trim()}\n\n`;
                case 'p': return `${inner.trim()}\n\n`;
                case 'strong':
                case 'b': return `**${inner}**`;
                case 'em':
                case 'i': return `*${inner}*`;
                case 'u': return `<u>${inner}</u>`;
                case 'strike':
                case 's': return `~~${inner}~~`;
                case 'code': return `\`${inner}\``;
                case 'a': {
                    const href = node.getAttribute('href') || '';
                    return `[${inner}](${href})`;
                }
                case 'img': {
                    const src = node.getAttribute('src') || '';
                    const alt = node.getAttribute('alt') || 'image';
                    return `![${alt}](${src})\n\n`;
                }
                case 'ul': return `${inner}\n`;
                case 'ol': {
                    let idx = 1;
                    let olOut = '';
                    node.childNodes.forEach(ch => {
                        if (ch.nodeType === Node.ELEMENT_NODE && ch.tagName.toLowerCase() === 'li') {
                            let liInner = '';
                            ch.childNodes.forEach(c => { liInner += parseNode(c); });
                            olOut += `${idx}. ${liInner.trim()}\n`;
                            idx++;
                        }
                    });
                    return `${olOut}\n`;
                }
                case 'li': return `- ${inner.trim()}\n`;
                case 'blockquote': {
                    const qLines = inner.trim().split(/\r?\n/).map(l => `> ${l}`).join('\n');
                    return `${qLines}\n\n`;
                }
                case 'hr': return `---\n\n`;
                case 'br': return '\n';
                case 'div': return inner ? `${inner}\n` : '';
                default: return inner;
            }
        }
        return '';
    }

    let md = parseNode(container);
    md = md.replace(/\n{3,}/g, '\n\n').trim();
    return md;
}

async function copyAsMarkdown() {
    if (!activeNoteName) {
        showToast('Open a note first', 'warning');
        return;
    }
    const md = htmlToMarkdown(content);
    try {
        await navigator.clipboard.writeText(md);
        showToast('Note copied as Markdown!', 'success');
    } catch (err) {
        console.error('Failed to copy markdown:', err);
        showToast('Failed to copy to clipboard', 'error');
    }
}

async function exportToMarkdown() {
    if (!activeNoteName) {
        showToast('Open a note first', 'warning');
        return;
    }
    const md = htmlToMarkdown(content);
    try {
        const result = await ipcRenderer.invoke('export-file-dialog', {
            title: 'Export Note as Markdown',
            defaultName: `${activeNoteName}.md`,
            content: md,
            filters: [
                { name: 'Markdown (*.md)', extensions: ['md'] },
                { name: 'All Files', extensions: ['*'] }
            ]
        });

        if (result && result.success) {
            showToast(`Exported "${result.fileName}" successfully!`, 'success');
        }
    } catch (err) {
        console.error('Export markdown error:', err);
        showToast('Failed to export note as markdown', 'error');
    }
}

// Global Keyboard Shortcuts
document.addEventListener('keydown', (e) => {
    const key = e.key ? e.key.toLowerCase() : '';
    const code = e.code || '';
    const activeEl = document.activeElement;
    const insideCM = activeEl && activeEl.closest('.CodeMirror');
    const isCheckboxInput = activeEl && activeEl.tagName === 'INPUT' && activeEl.classList.contains('checklist-checkbox');
    const isInput = activeEl && ((activeEl.tagName === 'INPUT' && !isCheckboxInput) || (activeEl.tagName === 'TEXTAREA' && !insideCM));
    const contentEl = document.getElementById('content');
    const sel = window.getSelection();
    const isInsideContent = contentEl && (
        activeEl === contentEl ||
        contentEl.contains(activeEl) || 
        (sel && sel.anchorNode && contentEl.contains(sel.anchorNode))
    );

    const mod = (e.ctrlKey || e.metaKey) && !e.altKey;
    if (mod && !e.defaultPrevented && !insideCM && !isInput && typeof activeNoteName !== 'undefined' && activeNoteName && contentEl && contentEl.getAttribute('contenteditable') !== 'false') {
        const hasActiveModal = Boolean(document.querySelector('.modal-overlay.active'));
        if (!hasActiveModal) {
            const isZ = key === 'z' || (!/^[a-z]$/i.test(key) && code === 'KeyZ');
            const isY = key === 'y' || (!/^[a-z]$/i.test(key) && code === 'KeyY');
            if (!e.shiftKey && isZ) {
                e.preventDefault();
                if (window.NoshUndo) window.NoshUndo.undo();
                return;
            }
            if ((e.shiftKey && isZ) || (!e.shiftKey && isY)) {
                e.preventDefault();
                if (window.NoshUndo) window.NoshUndo.redo();
                return;
            }
        }
    }

    // Ctrl+A: Select All Note Content (when inside editor and not in CodeMirror or an input)
    if (e.ctrlKey && !e.shiftKey && (key === 'a' || code === 'KeyA')) {
        if (isInsideContent && !insideCM && !(activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) && contentEl) {
            e.preventDefault();
            const range = document.createRange();
            range.selectNodeContents(contentEl);
            if (sel) {
                sel.removeAllRanges();
                sel.addRange(range);
            }
        }
    }
    // Ctrl+Shift+S: Search Notes (Global Sidebar Search)
    else if (e.ctrlKey && e.shiftKey && (key === 's' || code === 'KeyS')) {
        e.preventDefault();
        triggerDashboardSearch();
    }
    // Ctrl+S: Save Note
    else if (e.ctrlKey && !e.shiftKey && (key === 's' || code === 'KeyS')) {
        e.preventDefault();
        saveFile();
    }
    // Ctrl+Shift+P: Export as PDF
    else if (e.ctrlKey && e.shiftKey && (key === 'p' || code === 'KeyP')) {
        e.preventDefault();
        exportToPdf();
    }
    // Ctrl+P: Quick Switcher (Notes)
    else if (e.ctrlKey && !e.shiftKey && (key === 'p' || code === 'KeyP')) {
        e.preventDefault();
        if (typeof openCommandPalette === 'function') {
            openCommandPalette('notes');
        }
    }
    // Ctrl+N: New Note
    else if (e.ctrlKey && !e.shiftKey && (key === 'n' || code === 'KeyN')) {
        e.preventDefault();
        createNewFile();
    }
    // Ctrl+Shift+O: Document Table of Contents / Outline Drawer
    else if (e.ctrlKey && e.shiftKey && (key === 'o' || code === 'KeyO')) {
        e.preventDefault();
        if (typeof toggleDocumentOutline === 'function') {
            toggleDocumentOutline();
        }
    }
    // Ctrl+O: Open File from System
    else if (e.ctrlKey && !e.shiftKey && (key === 'o' || code === 'KeyO')) {
        e.preventDefault();
        openFileFromSystem();
    }
    // Ctrl+G: Open / Toggle Knowledge Graph View
    else if (e.ctrlKey && !e.shiftKey && (key === 'g' || code === 'KeyG')) {
        e.preventDefault();
        const graphModal = document.getElementById('graph-modal');
        if (graphModal && graphModal.classList.contains('active')) {
            closeModal('graph-modal');
        } else if (typeof openKnowledgeGraph === 'function') {
            openKnowledgeGraph();
        }
    }
    // Ctrl+Shift+F or F11: Focus / Zen Mode
    else if ((e.ctrlKey && e.shiftKey && (key === 'f' || code === 'KeyF')) || e.key === 'F11') {
        e.preventDefault();
        if (typeof toggleZenMode === 'function') {
            toggleZenMode();
        }
    }
    // Ctrl+F: Find in Document (or Search Notes if on Welcome Dashboard)
    else if (e.ctrlKey && !e.shiftKey && (key === 'f' || code === 'KeyF')) {
        e.preventDefault();
        if (!activeNoteName) {
            triggerDashboardSearch();
        } else {
            openDocFindBar();
        }
    }
    // Ctrl+H: In-Document Find & Replace
    else if (e.ctrlKey && !e.shiftKey && (key === 'h' || code === 'KeyH')) {
        e.preventDefault();
        openDocFindBar();
        toggleReplaceRow(true);
    }
    // Escape: Close Find Bar
    else if (e.key === 'Escape') {
        const findBar = document.getElementById('editor-find-bar');
        if (findBar && findBar.style.display !== 'none') {
            closeDocFindBar();
        }
    }
    // Ctrl+\ or physical Backslash: Toggle Sidebar
    else if (e.ctrlKey && !e.shiftKey && (e.key === '\\' || code === 'Backslash')) {
        e.preventDefault();
        toggleSidebar();
    }
    // Ctrl+K: Command Palette (Actions)
    else if (e.ctrlKey && !e.shiftKey && (key === 'k' || code === 'KeyK')) {
        e.preventDefault();
        if (typeof openCommandPalette === 'function') {
            openCommandPalette('commands');
        }
    }
    // Ctrl+,: Open / Toggle Preferences Modal
    else if (e.ctrlKey && !e.shiftKey && (e.key === ',' || code === 'Comma')) {
        e.preventDefault();
        const settingsModal = document.getElementById('settings-modal');
        if (settingsModal && settingsModal.classList.contains('active')) {
            closeModal('settings-modal');
        } else {
            openSettingsModal();
        }
    }
    // Ctrl+B: Bold Text (inside editor) or Toggle Sidebar (outside editor)
    else if (e.ctrlKey && !e.shiftKey && (key === 'b' || code === 'KeyB')) {
        if (isInsideContent && !insideCM && !isInput) {
            e.preventDefault();
            formatDoc('bold');
            if (typeof triggerAutoSave === 'function') triggerAutoSave();
        } else if (!isInput && !insideCM) {
            e.preventDefault();
            toggleSidebar();
        }
    }
    // Ctrl+I: Italic Text
    else if (e.ctrlKey && !e.shiftKey && (key === 'i' || code === 'KeyI')) {
        if (isInsideContent && !insideCM && !isInput) {
            e.preventDefault();
            formatDoc('italic');
            if (typeof triggerAutoSave === 'function') triggerAutoSave();
        }
    }
    // Ctrl+U: Underline Text
    else if (e.ctrlKey && !e.shiftKey && (key === 'u' || code === 'KeyU')) {
        if (isInsideContent && !insideCM && !isInput) {
            e.preventDefault();
            formatDoc('underline');
            if (typeof triggerAutoSave === 'function') triggerAutoSave();
        }
    }
});

// ==========================================================================
// Markdown & Claude Smart Paste / Import Engine
// ==========================================================================

function renderClaudeEmbeddedDiagram(rawCaption) {
    const caption = String(rawCaption || '').trim();
    const norm = caption.toLowerCase();
    let svgMarkup = '';

    if (norm.includes('soru 2') && (norm.includes('üçgen') || norm.includes('iki eksenli') || norm.includes('e_n'))) {
        // Soru 2: 5 triangular membership functions (NB, NK, S, PK, PB) with dual X-axes (e_N in [-1, 1] and e in [-8, +8] °C with 17 ticks)
        const eTicks = [];
        for (let k = 0; k <= 16; k++) {
            const val = -8 + k;
            const x = 90 + k * 37.5;
            const isMajor = val % 4 === 0;
            const label = val > 0 ? `+${val}` : `${val}`;
            eTicks.push(`
                <line x1="${x}" y1="252" x2="${x}" y2="${isMajor ? 261 : 257}" stroke="var(--text-secondary, #475569)" stroke-width="${isMajor ? 1.6 : 1}" />
                <text x="${x}" y="${isMajor ? 276 : 274}" text-anchor="middle" font-size="${isMajor ? 11.5 : 9.5}" font-weight="${isMajor ? 700 : 400}" fill="var(--text-primary, #1e293b)" opacity="${isMajor ? 1 : 0.78}">${label}</text>
            `);
        }

        svgMarkup = `
        <svg viewBox="0 0 760 315" xmlns="http://www.w3.org/2000/svg" style="font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
            <!-- Horizontal grid lines -->
            <line x1="90" y1="45" x2="690" y2="45" stroke="var(--border-medium, #cbd5e1)" stroke-dasharray="4,4" stroke-width="1" />
            <line x1="90" y1="120" x2="690" y2="120" stroke="var(--border-medium, #cbd5e1)" stroke-dasharray="5,4" stroke-width="1.2" />
            <!-- Vertical peak guides -->
            <line x1="90" y1="45" x2="90" y2="252" stroke="var(--border-medium, #cbd5e1)" stroke-dasharray="3,3" stroke-width="1" />
            <line x1="240" y1="45" x2="240" y2="252" stroke="var(--border-medium, #cbd5e1)" stroke-dasharray="3,3" stroke-width="1" />
            <line x1="390" y1="45" x2="390" y2="252" stroke="var(--border-medium, #cbd5e1)" stroke-dasharray="3,3" stroke-width="1" />
            <line x1="540" y1="45" x2="540" y2="252" stroke="var(--border-medium, #cbd5e1)" stroke-dasharray="3,3" stroke-width="1" />
            <line x1="690" y1="45" x2="690" y2="252" stroke="var(--border-medium, #cbd5e1)" stroke-dasharray="3,3" stroke-width="1" />

            <!-- Y-Axis (μ) -->
            <line x1="90" y1="30" x2="90" y2="195" stroke="var(--text-primary, #1e293b)" stroke-width="1.6" />
            <text x="78" y="49" text-anchor="end" font-size="11.5" font-weight="600" fill="var(--text-primary, #1e293b)">1.0</text>
            <text x="78" y="124" text-anchor="end" font-size="11.5" font-weight="600" fill="var(--text-secondary, #475569)">0.5</text>
            <text x="78" y="198" text-anchor="end" font-size="11.5" font-weight="600" fill="var(--text-primary, #1e293b)">0.0</text>
            <text x="46" y="120" text-anchor="middle" font-size="13" font-weight="700" fill="var(--text-primary, #1e293b)">μ</text>

            <!-- 5 Triangular Membership Functions -->
            <!-- NB: (-1, 1) to (-0.5, 0) -->
            <polygon points="90,195 90,45 240,195" fill="rgba(239, 68, 68, 0.10)" />
            <polyline points="90,195 90,45 240,195" fill="none" stroke="#ef4444" stroke-width="2.6" stroke-linejoin="round" />
            <text x="108" y="34" text-anchor="middle" font-size="13" font-weight="700" fill="#ef4444">NB</text>

            <!-- NK: (-1, 0) -> (-0.5, 1) -> (0, 0) -->
            <polygon points="90,195 240,45 390,195" fill="rgba(245, 158, 11, 0.10)" />
            <polyline points="90,195 240,45 390,195" fill="none" stroke="#f59e0b" stroke-width="2.6" stroke-linejoin="round" />
            <text x="240" y="34" text-anchor="middle" font-size="13" font-weight="700" fill="#f59e0b">NK</text>

            <!-- S: (-0.5, 0) -> (0, 1) -> (+0.5, 0) -->
            <polygon points="240,195 390,45 540,195" fill="rgba(16, 185, 129, 0.10)" />
            <polyline points="240,195 390,45 540,195" fill="none" stroke="#10b981" stroke-width="2.6" stroke-linejoin="round" />
            <text x="390" y="34" text-anchor="middle" font-size="13" font-weight="700" fill="#10b981">S</text>

            <!-- PK: (0, 0) -> (+0.5, 1) -> (+1, 0) -->
            <polygon points="390,195 540,45 690,195" fill="rgba(59, 130, 246, 0.10)" />
            <polyline points="390,195 540,45 690,195" fill="none" stroke="#3b82f6" stroke-width="2.6" stroke-linejoin="round" />
            <text x="540" y="34" text-anchor="middle" font-size="13" font-weight="700" fill="#3b82f6">PK</text>

            <!-- PB: (+0.5, 0) -> (+1, 1) -->
            <polygon points="540,195 690,45 690,195" fill="rgba(139, 92, 246, 0.10)" />
            <polyline points="540,195 690,45 690,195" fill="none" stroke="#8b5cf6" stroke-width="2.6" stroke-linejoin="round" />
            <text x="674" y="34" text-anchor="middle" font-size="13" font-weight="700" fill="#8b5cf6">PB</text>

            <!-- Intersection points at μ = 0.5 -->
            <circle cx="165" cy="120" r="4" fill="var(--text-primary, #1e293b)" />
            <circle cx="315" cy="120" r="4" fill="var(--text-primary, #1e293b)" />
            <circle cx="465" cy="120" r="4" fill="var(--text-primary, #1e293b)" />
            <circle cx="615" cy="120" r="4" fill="var(--text-primary, #1e293b)" />

            <!-- Axis 1: e_N (Normalized Error) -->
            <line x1="90" y1="195" x2="705" y2="195" stroke="var(--text-primary, #1e293b)" stroke-width="1.8" />
            <line x1="90" y1="195" x2="90" y2="203" stroke="var(--text-primary, #1e293b)" stroke-width="1.6" />
            <line x1="240" y1="195" x2="240" y2="203" stroke="var(--text-primary, #1e293b)" stroke-width="1.6" />
            <line x1="390" y1="195" x2="390" y2="203" stroke="var(--text-primary, #1e293b)" stroke-width="1.6" />
            <line x1="540" y1="195" x2="540" y2="203" stroke="var(--text-primary, #1e293b)" stroke-width="1.6" />
            <line x1="690" y1="195" x2="690" y2="203" stroke="var(--text-primary, #1e293b)" stroke-width="1.6" />
            <text x="90" y="219" text-anchor="middle" font-size="12" font-weight="700" fill="var(--text-primary, #1e293b)">−1</text>
            <text x="240" y="219" text-anchor="middle" font-size="12" font-weight="700" fill="var(--text-primary, #1e293b)">−0.5</text>
            <text x="390" y="219" text-anchor="middle" font-size="12" font-weight="700" fill="var(--text-primary, #1e293b)">0</text>
            <text x="540" y="219" text-anchor="middle" font-size="12" font-weight="700" fill="var(--text-primary, #1e293b)">+0.5</text>
            <text x="690" y="219" text-anchor="middle" font-size="12" font-weight="700" fill="var(--text-primary, #1e293b)">+1</text>
            <text x="728" y="200" text-anchor="start" font-size="12.5" font-weight="700" fill="var(--text-primary, #1e293b)">e_N</text>
            <text x="45" y="218" text-anchor="middle" font-size="10.5" fill="var(--text-secondary, #475569)">(Normalize)</text>

            <!-- Axis 2: e (°C) (Real Error, 17 ticks from -8 to +8) -->
            <line x1="90" y1="252" x2="705" y2="252" stroke="var(--text-secondary, #475569)" stroke-width="1.5" />
            ${eTicks.join('')}
            <text x="716" y="256" text-anchor="start" font-size="12" font-weight="700" fill="var(--text-primary, #1e293b)">e (°C)</text>
            <text x="45" y="274" text-anchor="middle" font-size="10.5" fill="var(--text-secondary, #475569)">(Gerçek)</text>
            <text x="390" y="302" text-anchor="middle" font-size="11.5" font-weight="600" fill="var(--text-secondary, #475569)">du_e = 1/8  ⟹  e_N = e / 8   (Her 1 °C = 17 tık ile işaretlenmiştir)</text>
        </svg>`;
    } else if (norm.includes('soru 2') && (norm.includes('denetleme') || norm.includes('blok diyagram'))) {
        // Soru 2: Closed-loop fuzzy temperature control block diagram
        svgMarkup = `
        <svg viewBox="0 0 760 205" xmlns="http://www.w3.org/2000/svg" style="font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
            <defs>
                <marker id="nosh-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
                    <path d="M 0 1.5 L 8.5 5 L 0 8.5 z" fill="var(--text-primary, #1e293b)" />
                </marker>
            </defs>

            <!-- Input T_ref -->
            <line x1="28" y1="78" x2="82" y2="78" stroke="var(--text-primary, #1e293b)" stroke-width="2" marker-end="url(#nosh-arrow)" />
            <text x="52" y="66" text-anchor="middle" font-size="12.5" font-weight="700" fill="var(--text-primary, #1e293b)">T_ref</text>
            <text x="76" y="70" text-anchor="end" font-size="14" font-weight="800" fill="#ef4444">−</text>

            <!-- Summing Junction Σ -->
            <circle cx="104" cy="78" r="19" fill="var(--bg-card, #ffffff)" stroke="var(--text-primary, #1e293b)" stroke-width="2" />
            <text x="104" y="83" text-anchor="middle" font-size="14" font-weight="700" fill="var(--text-primary, #1e293b)">Σ</text>
            <text x="118" y="114" text-anchor="start" font-size="13" font-weight="800" fill="#10b981">+</text>

            <!-- Signal e = T_oda - T_ref -->
            <line x1="123" y1="78" x2="218" y2="78" stroke="var(--text-primary, #1e293b)" stroke-width="2" marker-end="url(#nosh-arrow)" />
            <text x="170" y="64" text-anchor="middle" font-size="11.5" font-weight="700" fill="var(--text-primary, #1e293b)">e = T_oda − T_ref</text>
            <text x="170" y="96" text-anchor="middle" font-size="10.5" fill="var(--text-secondary, #475569)">[−8, +8] °C</text>

            <!-- Scaling Block du_e -->
            <rect x="222" y="48" width="112" height="60" rx="8" fill="rgba(99, 102, 241, 0.12)" stroke="#6366f1" stroke-width="2" />
            <text x="278" y="74" text-anchor="middle" font-size="12.5" font-weight="700" fill="var(--text-primary, #1e293b)">du_e = 1 / 8</text>
            <text x="278" y="93" text-anchor="middle" font-size="10.5" fill="var(--text-secondary, #475569)">Ölçekleme</text>

            <!-- Signal e_N -->
            <line x1="334" y1="78" x2="404" y2="78" stroke="var(--text-primary, #1e293b)" stroke-width="2" marker-end="url(#nosh-arrow)" />
            <text x="369" y="64" text-anchor="middle" font-size="12" font-weight="700" fill="var(--text-primary, #1e293b)">e_N</text>
            <text x="369" y="96" text-anchor="middle" font-size="10.5" fill="var(--text-secondary, #475569)">[−1, 1]</text>

            <!-- Fuzzy Controller Block -->
            <rect x="408" y="44" width="144" height="68" rx="8" fill="rgba(16, 185, 129, 0.12)" stroke="#10b981" stroke-width="2" />
            <text x="480" y="73" text-anchor="middle" font-size="12.5" font-weight="700" fill="var(--text-primary, #1e293b)">Bulanık Denetleyici</text>
            <text x="480" y="93" text-anchor="middle" font-size="10.5" fill="var(--text-secondary, #475569)">{NB, NK, S, PK, PB}</text>

            <!-- Control Signal u -->
            <line x1="552" y1="78" x2="594" y2="78" stroke="var(--text-primary, #1e293b)" stroke-width="2" marker-end="url(#nosh-arrow)" />
            <text x="573" y="66" text-anchor="middle" font-size="12" font-weight="700" fill="var(--text-primary, #1e293b)">u</text>

            <!-- Room / Plant Block -->
            <rect x="598" y="48" width="102" height="60" rx="8" fill="rgba(245, 158, 11, 0.12)" stroke="#f59e0b" stroke-width="2" />
            <text x="649" y="74" text-anchor="middle" font-size="12.5" font-weight="700" fill="var(--text-primary, #1e293b)">Oda / Sistem</text>
            <text x="649" y="93" text-anchor="middle" font-size="10.5" fill="var(--text-secondary, #475569)">Isıl Süreç</text>

            <!-- Output T_oda -->
            <line x1="700" y1="78" x2="748" y2="78" stroke="var(--text-primary, #1e293b)" stroke-width="2" marker-end="url(#nosh-arrow)" />
            <text x="728" y="64" text-anchor="middle" font-size="12.5" font-weight="700" fill="var(--text-primary, #1e293b)">T_oda</text>

            <!-- Feedback Loop -->
            <circle cx="718" cy="78" r="3.5" fill="var(--text-primary, #1e293b)" />
            <polyline points="718,78 718,162 104,162 104,101" fill="none" stroke="var(--text-primary, #1e293b)" stroke-width="1.8" marker-end="url(#nosh-arrow)" />
            <text x="411" y="182" text-anchor="middle" font-size="11" font-weight="600" fill="var(--text-secondary, #475569)">Ölçülen Oda Sıcaklığı Geri Beslemesi (T_oda)</text>
        </svg>`;
    } else if (norm.includes('soru 3')) {
        // Soru 3: Genç (□ solid), Erişkin (○ dashed), Yaşlı (△ dotted) over X = {10, 20, ..., 90}
        const xs = [10, 20, 30, 40, 50, 60, 70, 80, 90];
        const genc = [1.0, 1.0, 0.8, 0.5, 0.2, 0.1, 0.0, 0.0, 0.0];
        const eriskin = [0.0, 0.0, 0.2, 0.5, 0.8, 1.0, 1.0, 1.0, 1.0];
        const yasli = [0.0, 0.0, 0.1, 0.2, 0.4, 0.6, 0.8, 1.0, 1.0];
        const xCoord = (i) => 85 + i * 70;
        const yCoord = (mu) => 235 - mu * 185;

        const yLevels = [0.0, 0.1, 0.2, 0.4, 0.5, 0.6, 0.8, 1.0];
        const hGrid = yLevels.map(mu => {
            const y = yCoord(mu);
            return `
                <line x1="85" y1="${y}" x2="645" y2="${y}" stroke="var(--border-medium, #cbd5e1)" stroke-dasharray="${mu === 0.5 || mu === 1.0 ? '4,3' : '2,3'}" stroke-width="${mu === 0 ? 1.6 : 1}" />
                <text x="73" y="${y + 4}" text-anchor="end" font-size="11" font-weight="${mu === 0.5 || mu === 1.0 || mu === 0 ? 700 : 500}" fill="var(--text-primary, #1e293b)">${mu.toFixed(1)}</text>
            `;
        }).join('');

        const vGrid = xs.map((val, i) => {
            const x = xCoord(i);
            return `
                <line x1="${x}" y1="50" x2="${x}" y2="235" stroke="var(--border-medium, #cbd5e1)" stroke-dasharray="2,3" stroke-width="1" />
                <line x1="${x}" y1="235" x2="${x}" y2="242" stroke="var(--text-primary, #1e293b)" stroke-width="1.5" />
                <text x="${x}" y="258" text-anchor="middle" font-size="11.5" font-weight="700" fill="var(--text-primary, #1e293b)">${val}</text>
            `;
        }).join('');

        const gencPts = genc.map((m, i) => `${xCoord(i)},${yCoord(m)}`).join(' ');
        const eriskinPts = eriskin.map((m, i) => `${xCoord(i)},${yCoord(m)}`).join(' ');
        const yasliPts = yasli.map((m, i) => `${xCoord(i)},${yCoord(m)}`).join(' ');

        const gencMarkers = genc.map((m, i) => `<rect x="${xCoord(i) - 4}" y="${yCoord(m) - 4}" width="8" height="8" fill="#3b82f6" stroke="var(--bg-card, #ffffff)" stroke-width="1.2" />`).join('');
        const eriskinMarkers = eriskin.map((m, i) => `<circle cx="${xCoord(i)}" cy="${yCoord(m)}" r="4.5" fill="#10b981" stroke="var(--bg-card, #ffffff)" stroke-width="1.2" />`).join('');
        const yasliMarkers = yasli.map((m, i) => {
            const cx = xCoord(i), cy = yCoord(m);
            return `<polygon points="${cx},${cy - 5.5} ${cx - 5},${cy + 4} ${cx + 5},${cy + 4}" fill="#f59e0b" stroke="var(--bg-card, #ffffff)" stroke-width="1.1" />`;
        }).join('');

        svgMarkup = `
        <svg viewBox="0 0 760 295" xmlns="http://www.w3.org/2000/svg" style="font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
            ${hGrid}
            ${vGrid}
            <!-- Axes -->
            <line x1="85" y1="40" x2="85" y2="235" stroke="var(--text-primary, #1e293b)" stroke-width="1.8" />
            <line x1="85" y1="235" x2="665" y2="235" stroke="var(--text-primary, #1e293b)" stroke-width="1.8" />
            <text x="42" y="142" text-anchor="middle" font-size="12.5" font-weight="700" fill="var(--text-primary, #1e293b)">μ(x)</text>
            <text x="365" y="282" text-anchor="middle" font-size="12.5" font-weight="700" fill="var(--text-primary, #1e293b)">Yaş Evrensel Kümesi X = {10, 20, 30, 40, 50, 60, 70, 80, 90}</text>

            <!-- Curves -->
            <polyline points="${gencPts}" fill="none" stroke="#3b82f6" stroke-width="2.6" stroke-linejoin="round" />
            <polyline points="${eriskinPts}" fill="none" stroke="#10b981" stroke-width="2.6" stroke-dasharray="8,4" stroke-linejoin="round" />
            <polyline points="${yasliPts}" fill="none" stroke="#f59e0b" stroke-width="2.6" stroke-dasharray="3,3" stroke-linejoin="round" />

            <!-- Markers -->
            ${gencMarkers}
            ${eriskinMarkers}
            ${yasliMarkers}

            <!-- Intersection callout at (40, 0.5) -->
            <circle cx="${xCoord(3)}" cy="${yCoord(0.5)}" r="7" fill="none" stroke="var(--text-primary, #1e293b)" stroke-width="1.4" stroke-dasharray="2,2" />
            <text x="${xCoord(3) - 10}" y="${yCoord(0.5) - 10}" text-anchor="end" font-size="10.5" font-weight="600" fill="var(--text-primary, #1e293b)">(40, 0.5) kesişim</text>

            <!-- Legend -->
            <rect x="210" y="10" width="350" height="26" rx="6" fill="var(--bg-card, #ffffff)" stroke="var(--border-medium, #cbd5e1)" stroke-width="1" />
            <line x1="224" y1="23" x2="248" y2="23" stroke="#3b82f6" stroke-width="2.6" />
            <rect x="232" y="19" width="8" height="8" fill="#3b82f6" />
            <text x="254" y="27" font-size="11.5" font-weight="700" fill="#3b82f6">Genç (□ düz)</text>

            <line x1="340" y1="23" x2="364" y2="23" stroke="#10b981" stroke-width="2.6" stroke-dasharray="6,3" />
            <circle cx="352" cy="23" r="4" fill="#10b981" />
            <text x="370" y="27" font-size="11.5" font-weight="700" fill="#10b981">Erişkin (○ kesikli)</text>

            <line x1="478" y1="23" x2="502" y2="23" stroke="#f59e0b" stroke-width="2.6" stroke-dasharray="2.5,2.5" />
            <polygon points="490,18 485,27 495,27" fill="#f59e0b" />
            <text x="508" y="27" font-size="11.5" font-weight="700" fill="#f59e0b">Yaşlı (△ noktalı)</text>
        </svg>`;
    } else if (norm.includes('soru 4')) {
        // Soru 4: Two separate coordinate planes side by side:
        // Left: Birleşim Genç ∪ Yaşlı (max) -> [1, 1, 0.8, 0.5, 0.4, 0.6, 0.8, 1, 1]
        // Right: Kesişim Genç ∩ Yaşlı (min) -> [0, 0, 0.1, 0.2, 0.2, 0.1, 0, 0, 0]
        const xs = [10, 20, 30, 40, 50, 60, 70, 80, 90];
        const genc = [1.0, 1.0, 0.8, 0.5, 0.2, 0.1, 0.0, 0.0, 0.0];
        const yasli = [0.0, 0.0, 0.1, 0.2, 0.4, 0.6, 0.8, 1.0, 1.0];
        const unionVals = [1.0, 1.0, 0.8, 0.5, 0.4, 0.6, 0.8, 1.0, 1.0];
        const interVals = [0.0, 0.0, 0.1, 0.2, 0.2, 0.1, 0.0, 0.0, 0.0];

        const buildPanel = (offsetX, title, accentColor, resultVals, calloutText, calloutIdx, calloutMu) => {
            const xP = (i) => offsetX + 42 + i * 35;
            const yP = (mu) => 225 - mu * 160;
            const yTicks = [0.0, 0.1, 0.2, 0.4, 0.5, 0.6, 0.8, 1.0];

            const gridH = yTicks.map(mu => `
                <line x1="${xP(0)}" y1="${yP(mu)}" x2="${xP(8)}" y2="${yP(mu)}" stroke="var(--border-medium, #cbd5e1)" stroke-dasharray="2,3" stroke-width="0.9" />
                <text x="${xP(0) - 7}" y="${yP(mu) + 3.5}" text-anchor="end" font-size="9.5" font-weight="600" fill="var(--text-secondary, #475569)">${mu.toFixed(1)}</text>
            `).join('');

            const gridV = xs.map((v, i) => `
                <line x1="${xP(i)}" y1="${yP(1)}" x2="${xP(i)}" y2="${yP(0)}" stroke="var(--border-medium, #cbd5e1)" stroke-dasharray="2,3" stroke-width="0.8" />
                <text x="${xP(i)}" y="242" text-anchor="middle" font-size="10" font-weight="600" fill="var(--text-primary, #1e293b)">${v}</text>
            `).join('');

            const gencLine = genc.map((m, i) => `${xP(i)},${yP(m)}`).join(' ');
            const yasliLine = yasli.map((m, i) => `${xP(i)},${yP(m)}`).join(' ');
            const resLine = resultVals.map((m, i) => `${xP(i)},${yP(m)}`).join(' ');
            const polyFill = `${xP(0)},${yP(0)} ${resLine} ${xP(8)},${yP(0)}`;
            const dots = resultVals.map((m, i) => `<circle cx="${xP(i)}" cy="${yP(m)}" r="3.8" fill="${accentColor}" stroke="var(--bg-card, #ffffff)" stroke-width="1" />`).join('');

            return `
                <text x="${offsetX + 182}" y="26" text-anchor="middle" font-size="12.5" font-weight="700" fill="${accentColor}">${title}</text>
                <text x="${offsetX + 182}" y="42" text-anchor="middle" font-size="10" fill="var(--text-secondary, #475569)">Kesikli: Genç &amp; Yaşlı referans · Kalın düz: Sonuç kümesi</text>
                ${gridH}
                ${gridV}
                <line x1="${xP(0)}" y1="55" x2="${xP(0)}" y2="225" stroke="var(--text-primary, #1e293b)" stroke-width="1.5" />
                <line x1="${xP(0)}" y1="225" x2="${xP(8) + 12}" y2="225" stroke="var(--text-primary, #1e293b)" stroke-width="1.5" />
                <polygon points="${polyFill}" fill="${accentColor}" fill-opacity="0.11" />
                <polyline points="${gencLine}" fill="none" stroke="#3b82f6" stroke-width="1.4" stroke-dasharray="4,3" opacity="0.55" />
                <polyline points="${yasliLine}" fill="none" stroke="#f59e0b" stroke-width="1.4" stroke-dasharray="3,3" opacity="0.55" />
                <polyline points="${resLine}" fill="none" stroke="${accentColor}" stroke-width="3" stroke-linejoin="round" />
                ${dots}
                <text x="${xP(calloutIdx)}" y="${yP(calloutMu) - 10}" text-anchor="middle" font-size="10" font-weight="700" fill="${accentColor}">${calloutText}</text>
                <text x="${offsetX + 182}" y="262" text-anchor="middle" font-size="10.5" font-weight="600" fill="var(--text-secondary, #475569)">Yaş (x)</text>
            `;
        };

        svgMarkup = `
        <svg viewBox="0 0 760 275" xmlns="http://www.w3.org/2000/svg" style="font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
            ${buildPanel(10, 'Birleşim: μ_{Genç ∪ Yaşlı}(x) = max', '#8b5cf6', unionVals, 'Vadi (50, 0.4)', 4, 0.4)}
            <line x1="382" y1="18" x2="382" y2="262" stroke="var(--border-medium, #cbd5e1)" stroke-dasharray="4,4" stroke-width="1" />
            ${buildPanel(392, 'Kesişim: μ_{Genç ∩ Yaşlı}(x) = min', '#ec4899', interVals, 'Plato (40–50, 0.2)', 3.5, 0.2)}
        </svg>`;
    } else {
        svgMarkup = `
        <svg viewBox="0 0 600 70" xmlns="http://www.w3.org/2000/svg" style="font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
            <rect x="8" y="8" width="584" height="54" rx="8" fill="none" stroke="var(--border-medium, #cbd5e1)" stroke-dasharray="5,4" stroke-width="1.5" />
            <text x="300" y="39" text-anchor="middle" font-size="12.5" font-weight="600" fill="var(--text-primary, #1e293b)">${escapeHtml(caption)}</text>
        </svg>`;
    }

    return `<div class="claude-embedded-diagram" contenteditable="false" data-diagram-caption="${escapeHtml(caption)}">${svgMarkup}<div class="claude-diagram-caption"><span>📊</span><span>${escapeHtml(caption)}</span></div></div>`;
}

function decodeMarkdownEntities(str) {
    return String(str || '')
        .replace(/&#91;/g, '[')
        .replace(/&#93;/g, ']')
        .replace(/&#40;/g, '(')
        .replace(/&#41;/g, ')')
        .replace(/&#42;/g, '*')
        .replace(/&#95;/g, '_')
        .replace(/&#124;/g, '|')
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
}

function parseInlineMarkdown(rawText) {
    if (!rawText) return '';
    let text = String(rawText);

    const codeTokens = [];
    const mathTokens = [];
    const linkTokens = [];
    const escTokens = [];

    // 1. Protect inline code spans `...`
    text = text.replace(/`([^`\n]+)`/g, (_, code) => {
        const idx = codeTokens.length;
        codeTokens.push(`<code class="inline-code">${escapeHtml(decodeMarkdownEntities(code))}</code>`);
        return `\x00CODE_${idx}\x00`;
    });

    // 2. Protect inline LaTeX math \(...\) and $...$ (when non-space and not currency)
    text = text.replace(/\\\(([\s\S]+?)\\\)/g, (_, latex) => {
        const idx = mathTokens.length;
        if (typeof createMathFormulaElement === 'function') {
            mathTokens.push(createMathFormulaElement(latex.trim(), false).outerHTML);
        } else {
            mathTokens.push(`<span class="math-formula-inline" data-latex="${escapeHtml(latex.trim())}">${escapeHtml(latex.trim())}</span>`);
        }
        return `\x00MATH_${idx}\x00`;
    });

    text = text.replace(/(^|[^\\$])\$([^\s$](?:[^$\n]*?[^\s$])?)\$(?!\d)/g, (full, prefix, latex) => {
        // Only treat $...$ as math if it looks like math (contains backslash, ^, _, =, or Greek/math symbols)
        if (!/\\[a-zA-Z]+|[_^{}=<>±×÷∑∏√∞]/.test(latex)) {
            return full;
        }
        const idx = mathTokens.length;
        if (typeof createMathFormulaElement === 'function') {
            mathTokens.push(createMathFormulaElement(latex.trim(), false).outerHTML);
        } else {
            mathTokens.push(`<span class="math-formula-inline" data-latex="${escapeHtml(latex.trim())}">${escapeHtml(latex.trim())}</span>`);
        }
        return `${prefix}\x00MATH_${idx}\x00`;
    });

    // 3. Protect internal wiki-links [[Note Title]]
    text = text.replace(/\[\[([^\[\]\n]+)\]\]/g, (_, noteName) => {
        const cleanNote = escapeHtml(decodeMarkdownEntities(noteName.trim()));
        const idx = linkTokens.length;
        linkTokens.push(`<span class="note-internal-link" data-note="${cleanNote}" contenteditable="false"><iconify-icon icon="solar:link-minimalistic-2-linear"></iconify-icon> ${cleanNote}</span>`);
        return `\x00LINK_${idx}\x00`;
    });

    // 4. Protect Markdown images ![alt](src) and links [label](url) (only when not preceded by backslash)
    text = text.replace(/(^|[^\\])!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, prefix, alt, src) => {
        const idx = linkTokens.length;
        linkTokens.push(`<img src="${escapeHtml(src)}" alt="${escapeHtml(decodeMarkdownEntities(alt))}">`);
        return `${prefix}\x00LINK_${idx}\x00`;
    });
    text = text.replace(/(^|[^\\])\[([^\]]+)\]\((https?:\/\/[^)\s]+|mailto:[^)\s]+)\)/g, (_, prefix, label, href) => {
        const idx = linkTokens.length;
        linkTokens.push(`<a href="${escapeHtml(href)}">${parseInlineMarkdown(label)}</a>`);
        return `${prefix}\x00LINK_${idx}\x00`;
    });

    // 5. Decode HTML entities (such as &#91; and &#93;) before protecting backslash escapes
    text = decodeMarkdownEntities(text);

    // 6. Protect Markdown backslash-escaped punctuation (\_, \*, \[, \], \|, \~)
    // Preserve \[...\] ONLY if it contains real LaTeX commands like \frac or \mu
    text = text.replace(/\\\[([\s\S]+?)\\\]/g, (full, inner) => {
        if (/\\[a-zA-Z]+/.test(inner) && !/^embedded\s+content\s*:/i.test(inner.trim())) {
            const idx = mathTokens.length;
            if (typeof createMathFormulaElement === 'function') {
                mathTokens.push(createMathFormulaElement(inner.trim(), false).outerHTML);
            } else {
                mathTokens.push(`<span class="math-formula-inline" data-latex="${escapeHtml(inner.trim())}">${escapeHtml(inner.trim())}</span>`);
            }
            return `\x00MATH_${idx}\x00`;
        }
        const i1 = escTokens.length;
        escTokens.push('[');
        const i2 = escTokens.length;
        escTokens.push(']');
        return `\x00ESC_${i1}\x00${inner}\x00ESC_${i2}\x00`;
    });

    text = text.replace(/\\([_*[\]()|~`\\])/g, (_, ch) => {
        const idx = escTokens.length;
        escTokens.push(escapeHtml(ch));
        return `\x00ESC_${idx}\x00`;
    });

    // 7. Escape HTML special characters on remaining plain text
    text = escapeHtml(text);

    // 8. Apply bold, italic, and strikethrough
    text = text.replace(/\*\*\*([^\n*]+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    text = text.replace(/\*\*([^\n*]+?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/__([^\n_]+?)__/g, '<strong>$1</strong>');
    text = text.replace(/\*([^\s*](?:[^\n*]*?[^\s*])?)\*/g, '<em>$1</em>');
    text = text.replace(/(^|[\s(])_([^\s_](?:[^\n_]*?[^\s_])?)_(?=$|[\s.,;:!?)])/g, '$1<em>$2</em>');
    text = text.replace(/~~([^\n~]+?)~~/g, '<s>$1</s>');

    // 9. Restore escaped characters, links, math, and inline code
    text = text.replace(/\x00ESC_(\d+)\x00/g, (_, idx) => escTokens[Number(idx)] ?? '');
    text = text.replace(/\x00LINK_(\d+)\x00/g, (_, idx) => linkTokens[Number(idx)] ?? '');
    text = text.replace(/\x00MATH_(\d+)\x00/g, (_, idx) => mathTokens[Number(idx)] ?? '');
    text = text.replace(/\x00CODE_(\d+)\x00/g, (_, idx) => codeTokens[Number(idx)] ?? '');

    return text;
}

function splitMarkdownTableRow(rowLine) {
    let s = rowLine.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
    const cells = [];
    let cur = '';
    for (let i = 0; i < s.length; i++) {
        if (s[i] === '\\' && i + 1 < s.length && s[i + 1] === '|') {
            cur += '|';
            i++;
        } else if (s[i] === '|') {
            cells.push(cur.trim());
            cur = '';
        } else {
            cur += s[i];
        }
    }
    cells.push(cur.trim());
    return cells;
}

function isMarkdownTableSeparator(line) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|') || !trimmed.includes('-')) return false;
    const cells = splitMarkdownTableRow(trimmed);
    return cells.length > 0 && cells.every(c => /^:?-{2,}:?$/.test(c.trim()));
}

function buildCodeBlockHtmlString(code, rawLang) {
    let cleanLang = (rawLang || '').trim().toLowerCase();
    if (['latex', 'tex', 'math', 'katex'].includes(cleanLang)) {
        if (typeof createMathFormulaElement === 'function') {
            return createMathFormulaElement(code.trim(), true).outerHTML;
        }
        return `<div class="math-formula-block" contenteditable="false" data-latex="${escapeHtml(code.trim())}" data-display-mode="true">${escapeHtml(code.trim())}</div>`;
    }

    let langMeta = null;
    if (cleanLang && typeof getLanguageMeta === 'function') {
        langMeta = getLanguageMeta(cleanLang, cleanLang);
    }
    // Auto-detect language from code content if not explicitly specified or if generic fallback
    if ((!langMeta || !cleanLang || cleanLang === 'text' || cleanLang === 'plain' || cleanLang === 'javascript') && typeof detectCodeLanguage === 'function') {
        const detected = detectCodeLanguage(code);
        if (detected && (detected.name !== 'JavaScript' || !cleanLang)) {
            langMeta = detected;
        }
    }
    if (!langMeta) {
        langMeta = typeof getLanguageMeta === 'function'
            ? getLanguageMeta(cleanLang || 'javascript')
            : { name: cleanLang || 'JavaScript', mode: cleanLang || 'javascript', icon: 'solar:code-square-linear' };
    }

    if (typeof buildCodeBlockElement === 'function') {
        const wrapper = buildCodeBlockElement(langMeta.mode, langMeta.name, code);
        return wrapper.outerHTML;
    }

    return `
        <div class="code-block-wrapper" contenteditable="false">
            <div class="code-block-header">
                <div class="code-header-left">
                    <div class="code-window-dots">
                        <span class="code-dot red"></span>
                        <span class="code-dot yellow"></span>
                        <span class="code-dot green"></span>
                    </div>
                    <span class="code-lang-tag clickable" onclick="openBlockLangSwitcher(this)">
                        <iconify-icon class="lang-icon" icon="${langMeta.icon}"></iconify-icon>
                        <span class="lang-name">${langMeta.name}</span>
                        <iconify-icon class="lang-caret" icon="solar:alt-arrow-down-linear"></iconify-icon>
                    </span>
                </div>
                <div class="code-block-actions">
                    <button class="code-action-btn wrap-btn" onclick="toggleCodeWrap(this)">Wrap</button>
                    <button class="code-action-btn copy-btn" onclick="copyCodeSnippet(this)">Copy</button>
                    <button class="code-action-btn delete" onclick="deleteCodeBlock(this)"><iconify-icon icon="solar:trash-bin-trash-linear"></iconify-icon></button>
                </div>
            </div>
            <textarea class="code" language="${langMeta.mode}" data-label="${langMeta.name}" style="display:block;">${escapeHtml(code)}</textarea>
        </div>
    `.trim();
}

function extractEmbeddedContentCaption(line) {
    const decoded = decodeMarkdownEntities(line.trim())
        .replace(/^\\\[/, '[')
        .replace(/\\\]$/, ']')
        .replace(/\\([_*[\]()|~`\\])/g, '$1');
    const match = decoded.match(/^\[embedded\s+content:\s*([\s\S]+?)\]$/i);
    return match ? match[1].trim() : null;
}

function markdownToNoshHtml(mdText) {
    if (!mdText) return '';
    const lines = String(mdText).replace(/\r\n?/g, '\n').split('\n');
    const htmlParts = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];
        const trimmed = line.trim();

        // 1. Blank line
        if (!trimmed) {
            i++;
            continue;
        }

        // 2. Fenced Code or Math Block (```lang ... ```)
        const fenceMatch = trimmed.match(/^(`{3,}|~{3,})(.*)$/);
        if (fenceMatch) {
            const fenceToken = fenceMatch[1];
            const fenceChar = fenceToken[0];
            const langSpec = (fenceMatch[2] || '').trim().split(/\s+/)[0] || '';
            const codeLines = [];
            i++;
            while (i < lines.length) {
                const closeTrim = lines[i].trim();
                if (closeTrim.startsWith(fenceChar.repeat(fenceToken.length)) && closeTrim.replace(new RegExp(`\\\${fenceChar}`, 'g'), '').trim() === '') {
                    i++;
                    break;
                }
                codeLines.push(lines[i]);
                i++;
            }
            htmlParts.push(buildCodeBlockHtmlString(codeLines.join('\n'), langSpec));
            continue;
        }

        // 3. Standalone Display Math Block ($ ... $ or \[ ... \])
        if (trimmed.startsWith('$')) {
            if (trimmed.endsWith('$') && trimmed.length > 4) {
                const inner = trimmed.slice(2, -2).trim();
                htmlParts.push(buildCodeBlockHtmlString(inner, 'latex'));
                i++;
                continue;
            }
            const mathLines = [trimmed.slice(2)];
            i++;
            while (i < lines.length) {
                if (lines[i].trim().endsWith('$')) {
                    mathLines.push(lines[i].trim().slice(0, -2));
                    i++;
                    break;
                }
                mathLines.push(lines[i]);
                i++;
            }
            htmlParts.push(buildCodeBlockHtmlString(mathLines.join('\n').trim(), 'latex'));
            continue;
        }

        // 4. Claude Embedded Content Placeholder ([embedded content: ...] or &#91;embedded content: ...\])
        const embeddedCaption = extractEmbeddedContentCaption(trimmed);
        if (embeddedCaption) {
            htmlParts.push(renderClaudeEmbeddedDiagram(embeddedCaption));
            i++;
            continue;
        }

        // 5. Horizontal Rule (---, ***, ___)
        if (/^(?:-\s*){3,}$|^(?:\*\s*){3,}$|^(?:_\s*){3,}$/.test(trimmed)) {
            htmlParts.push('<hr>');
            i++;
            continue;
        }

        // 6. ATX Headings (# H1 .. ###### H6)
        const headingMatch = line.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);
        if (headingMatch) {
            const level = Math.min(headingMatch[1].length, 6);
            htmlParts.push(`<h${level}>${parseInlineMarkdown(headingMatch[2])}</h${level}>`);
            i++;
            continue;
        }

        // 7. GFM Table (| Header | ... followed by | --- | ...)
        if (trimmed.startsWith('|') && i + 1 < lines.length && isMarkdownTableSeparator(lines[i + 1])) {
            const headerCells = splitMarkdownTableRow(lines[i]);
            const sepCells = splitMarkdownTableRow(lines[i + 1]);
            const aligns = sepCells.map(c => {
                const s = c.trim();
                if (s.startsWith(':') && s.endsWith(':')) return 'center';
                if (s.endsWith(':')) return 'right';
                return 'left';
            });
            i += 2;
            const bodyRows = [];
            while (i < lines.length && lines[i].trim().startsWith('|')) {
                if (!isMarkdownTableSeparator(lines[i])) {
                    bodyRows.push(splitMarkdownTableRow(lines[i]));
                }
                i++;
            }
            const thHtml = headerCells.map((cell, idx) => {
                const align = aligns[idx] && aligns[idx] !== 'left' ? ` style="text-align:${aligns[idx]}"` : '';
                return `<th${align}>${parseInlineMarkdown(cell)}</th>`;
            }).join('');
            const tbodyHtml = bodyRows.map(row => {
                const tds = headerCells.map((_, idx) => {
                    const align = aligns[idx] && aligns[idx] !== 'left' ? ` style="text-align:${aligns[idx]}"` : '';
                    return `<td${align}>${parseInlineMarkdown(row[idx] ?? '')}</td>`;
                }).join('');
                return `<tr>${tds}</tr>`;
            }).join('');
            htmlParts.push(`<div class="table-container"><table><thead><tr>${thHtml}</tr></thead><tbody>${tbodyHtml}</tbody></table></div>`);
            continue;
        }

        // 8. Blockquote and Callouts (> ...)
        if (/^\s*>\s?/.test(line)) {
            const quoteLines = [];
            while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
                quoteLines.push(lines[i].replace(/^\s*>\s?/, ''));
                i++;
            }

            const firstLine = quoteLines[0] || '';
            const gfmMatch = firstLine.match(/^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION|INFO|HINT|QUESTION|SUCCESS|FAILURE|DANGER|BUG|EXAMPLE|QUOTE)\]\s*(.*)$/i);
            const trMatch = firstLine.match(/^\s*\*\*(Dikkat|Uyarı|Sık\s+yapılan\s+hata|Not|Önemli|Bilgi|İpucu|Warning|Note|Caution):\*\*\s*(.*)$/i);

            if (gfmMatch) {
                const rawType = gfmMatch[1].toLowerCase();
                const typeMap = {
                    note: 'info', info: 'info', hint: 'info', question: 'info', example: 'info',
                    tip: 'tip', success: 'tip',
                    warning: 'warning', important: 'warning',
                    caution: 'danger', danger: 'danger', failure: 'danger', bug: 'danger',
                    quote: 'info'
                };
                const iconMap = {
                    info: 'solar:info-circle-bold',
                    tip: 'solar:check-circle-bold',
                    warning: 'solar:danger-triangle-bold',
                    danger: 'solar:shield-warning-bold'
                };
                const cType = typeMap[rawType] || 'info';
                const cIcon = iconMap[cType] || 'solar:info-circle-bold';
                const cTitle = gfmMatch[2].trim() || gfmMatch[1].toUpperCase();

                const remainingLines = quoteLines.slice(1);
                const bodyHtml = remainingLines.map(ql => ql.trim() ? parseInlineMarkdown(ql) : '<br>').join('<br>');
                htmlParts.push(`
                    <blockquote class="callout-box callout-${cType}">
                        <div class="callout-header"><iconify-icon icon="${cIcon}"></iconify-icon> <strong>${escapeHtml(cTitle)}</strong></div>
                        <div class="callout-body">${bodyHtml || parseInlineMarkdown(cTitle)}</div>
                    </blockquote>
                `.trim());
                continue;
            } else if (trMatch) {
                const rawWord = trMatch[1].toLowerCase().replace(/\s+/g, ' ');
                let cType = 'info';
                let cIcon = 'solar:info-circle-bold';
                if (rawWord.includes('hata') || rawWord.includes('caution') || rawWord.includes('danger')) {
                    cType = 'danger';
                    cIcon = 'solar:shield-warning-bold';
                } else if (rawWord.includes('dikkat') || rawWord.includes('uyarı') || rawWord.includes('warning') || rawWord.includes('önemli')) {
                    cType = 'warning';
                    cIcon = 'solar:danger-triangle-bold';
                } else if (rawWord.includes('ipucu') || rawWord.includes('tip') || rawWord.includes('bilgi')) {
                    cType = 'tip';
                    cIcon = 'solar:check-circle-bold';
                }

                const title = trMatch[1];
                const firstRest = trMatch[2].trim();
                const otherLines = quoteLines.slice(1);
                const allBody = (firstRest ? [firstRest] : []).concat(otherLines);
                const bodyHtml = allBody.map(ql => ql.trim() ? parseInlineMarkdown(ql) : '<br>').join('<br>');

                htmlParts.push(`
                    <blockquote class="callout-box callout-${cType}">
                        <div class="callout-header"><iconify-icon icon="${cIcon}"></iconify-icon> <strong>${escapeHtml(title)}</strong></div>
                        <div class="callout-body">${bodyHtml}</div>
                    </blockquote>
                `.trim());
                continue;
            }

            const renderedQuote = quoteLines
                .map(ql => ql.trim() ? parseInlineMarkdown(ql) : '<br>')
                .join('<br>');
            htmlParts.push(`<blockquote>${renderedQuote}</blockquote>`);
            continue;
        }

        // 9. Checklist item (- [ ] or - [x])
        const checkMatch = line.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/);
        if (checkMatch) {
            const checked = checkMatch[1].toLowerCase() === 'x';
            htmlParts.push(
                `<div class="checklist-item${checked ? ' completed' : ''}" contenteditable="false">` +
                `<input type="checkbox" class="checklist-checkbox"${checked ? ' checked="checked"' : ''} onchange="toggleChecklistItem(this)">` +
                `<span class="checklist-text" contenteditable="true">${parseInlineMarkdown(checkMatch[2])}</span>` +
                `</div>`
            );
            i++;
            continue;
        }

        // 10. Nested or flat list (Unordered & Ordered)
        const listMatch = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
        if (listMatch) {
            const listItems = [];
            while (i < lines.length) {
                const curLine = lines[i];
                const m = curLine.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
                if (!m) break;
                if (/^\s*[-*+]\s+\[[ xX]\]/.test(curLine)) break;
                listItems.push({
                    indent: m[1].length,
                    isOrdered: /^\d/.test(m[2]),
                    text: parseInlineMarkdown(m[3])
                });
                i++;
            }

            function renderNestedList(items) {
                if (items.length === 0) return '';
                const isOrdered = items[0].isOrdered;
                const tag = isOrdered ? 'ol' : 'ul';
                let out = `<${tag}>`;
                let idx = 0;
                while (idx < items.length) {
                    const cur = items[idx];
                    const baseIndent = cur.indent;
                    idx++;
                    const children = [];
                    while (idx < items.length && items[idx].indent > baseIndent) {
                        children.push(items[idx]);
                        idx++;
                    }
                    out += `<li>${cur.text}`;
                    if (children.length > 0) {
                        out += renderNestedList(children);
                    }
                    out += `</li>`;
                }
                out += `</${tag}>`;
                return out;
            }

            htmlParts.push(renderNestedList(listItems));
            continue;
        }

        // 11. Standard Paragraph (merge consecutive plain lines unless next line starts a block construct)
        const paraLines = [];
        while (
            i < lines.length &&
            lines[i].trim() !== '' &&
            !/^(`{3,}|~{3,})/.test(lines[i].trim()) &&
            !lines[i].trim().startsWith('$') &&
            !extractEmbeddedContentCaption(lines[i].trim()) &&
            !/^(?:-\s*){3,}$|^(?:\*\s*){3,}$|^(?:_\s*){3,}$/.test(lines[i].trim()) &&
            !/^\s*#{1,6}\s+/.test(lines[i]) &&
            !(lines[i].trim().startsWith('|') && i + 1 < lines.length && isMarkdownTableSeparator(lines[i + 1])) &&
            !/^\s*>\s?/.test(lines[i]) &&
            !/^\s*[-*+]\s+/.test(lines[i]) &&
            !/^\s*\d+[.)]\s+/.test(lines[i])
        ) {
            paraLines.push(parseInlineMarkdown(lines[i].trim()));
            i++;
        }
        if (paraLines.length > 0) {
            htmlParts.push(`<p>${paraLines.join('<br>')}</p>`);
        } else {
            i++;
        }
    }

    return htmlParts.join('\n');
}

function isMarkdownContent(text) {
    if (!text || typeof text !== 'string') return false;
    const s = text.replace(/\r\n?/g, '\n').trim();
    if (!s) return false;

    // Strong single-line or multi-line Markdown indicators
    if (/^#{1,6}\s+\S/m.test(s)) return true;
    if (/^(`{3,}|~{3,})\w*/m.test(s)) return true;
    if (/^\|.+\|\s*\n\s*\|[\s:|-]+\|/m.test(s)) return true;
    if (/(?:&#91;|\\?\[)embedded\s+content:/i.test(s)) return true;
    if (/^\s*[-*+]\s+\[[ xX]\]\s+/m.test(s)) return true;

    let signals = 0;
    if (/\*\*[^*\n]+\*\*/.test(s)) signals++;
    if (/^\s*>\s+\S/m.test(s)) signals++;
    if (/^\s*[-*+]\s+\S/m.test(s)) signals++;
    if (/^\s*\d+\.\s+\S/m.test(s)) signals++;
    if (/^(?:-\s*){3,}$/m.test(s)) signals++;
    if (/\\[_*[\]]/.test(s)) signals++;
    return signals >= 2;
}

function sanitizeAndConvertPastedHtml(rawHtml, fallbackText = '') {
    if (!rawHtml || !rawHtml.trim()) return '';
    const parser = new DOMParser();
    const doc = parser.parseFromString(rawHtml, 'text/html');
    const body = doc.body;
    if (!body) return '';

    // Remove script, style, meta, link, button, svg copy buttons from web UIs
    body.querySelectorAll('script, style, meta, link, button, noscript, iframe').forEach(el => el.remove());

    // Convert KaTeX elements from web pages (e.g. claude.ai) into Nosh math elements
    body.querySelectorAll('.katex-display, .katex, span[data-math], math').forEach(mathNode => {
        if (!mathNode.isConnected) return;
        const annotation = mathNode.querySelector('annotation[encoding="application/x-tex"]') || mathNode.querySelector('annotation');
        const latex = (annotation ? annotation.textContent : mathNode.getAttribute('data-math') || mathNode.getAttribute('data-latex') || '').trim();
        if (latex) {
            const isDisplay = mathNode.classList.contains('katex-display') || mathNode.tagName.toLowerCase() === 'div' || Boolean(mathNode.closest('.katex-display'));
            const htmlStr = isDisplay
                ? buildCodeBlockHtmlString(latex, 'latex')
                : (typeof createMathFormulaElement === 'function' ? createMathFormulaElement(latex, false).outerHTML : `<span class="math-formula-inline" data-latex="${escapeHtml(latex)}">${escapeHtml(latex)}</span>`);
            const temp = doc.createElement('div');
            temp.innerHTML = htmlStr;
            const target = mathNode.closest('.katex-display') || mathNode;
            if (temp.firstElementChild && target.parentNode) {
                target.replaceWith(temp.firstElementChild);
            }
        }
    });

    // Convert <pre> blocks into Nosh code blocks or math blocks
    body.querySelectorAll('pre').forEach(pre => {
        if (!pre.isConnected || pre.closest('.code-block-wrapper')) return;
        const codeEl = pre.querySelector('code');
        const classAttr = ((codeEl && codeEl.className) || pre.className || '').toLowerCase();
        const langMatch = classAttr.match(/(?:language-|lang-)([a-z0-9_+-]+)/i);
        const lang = langMatch ? langMatch[1] : 'javascript';
        const codeText = (codeEl ? codeEl.textContent : pre.textContent) || '';
        const temp = doc.createElement('div');
        temp.innerHTML = buildCodeBlockHtmlString(codeText.replace(/\n$/, ''), lang);
        if (temp.firstElementChild) {
            pre.replaceWith(temp.firstElementChild);
        }
    });

    // Convert inline <code> tags & [embedded content: ...] paragraphs
    body.querySelectorAll('code').forEach(codeEl => {
        if (codeEl.closest('pre, .code-block-wrapper')) return;
        codeEl.classList.add('inline-code');
        codeEl.removeAttribute('style');
    });

    body.querySelectorAll('p, div').forEach(el => {
        if (!el.isConnected) return;
        if (el.children.length === 0) {
            const cap = extractEmbeddedContentCaption(el.textContent || '');
            if (cap) {
                const temp = doc.createElement('div');
                temp.innerHTML = renderClaudeEmbeddedDiagram(cap);
                if (temp.firstElementChild) {
                    el.replaceWith(temp.firstElementChild);
                }
            }
        }
    });

    // Strip foreign inline styles (color, background, font-family) from pasted web elements
    body.querySelectorAll('*').forEach(el => {
        if (el.closest('.code-block-wrapper, .math-formula-block, .math-formula-inline, .claude-embedded-diagram')) return;
        if (el.hasAttribute('style')) {
            const align = el.style && el.style.textAlign;
            el.removeAttribute('style');
            if (align && (el.tagName === 'TH' || el.tagName === 'TD')) {
                el.style.textAlign = align;
            }
        }
        el.removeAttribute('class');
    });

    return body.innerHTML.trim();
}

function isUntouchedPlaceholderNote(editorEl) {
    if (!editorEl) return false;
    const text = (editorEl.innerText || '').trim();
    return /^Untitled\s*\d*\s*\n+Start writing your note or insert code blocks\.{3}$/i.test(text);
}

function insertHtmlNodesIntoEditor(htmlString) {
    const applyInsert = () => _insertHtmlNodesIntoEditorCore(htmlString);
    return window.NoshUndo ? window.NoshUndo.runWithUndo(applyInsert) : applyInsert();
}

function _insertHtmlNodesIntoEditorCore(htmlString) {
    const editorEl = document.getElementById('content');
    if (!editorEl || !htmlString) return false;

    const temp = document.createElement('div');
    temp.innerHTML = htmlString;
    const nodes = Array.from(temp.childNodes).filter(n => {
        return !(n.nodeType === Node.TEXT_NODE && !n.nodeValue.trim());
    });
    if (nodes.length === 0) return false;

    const hasBlockElements = nodes.some(n =>
        n.nodeType === Node.ELEMENT_NODE &&
        /^(H[1-6]|TABLE|DIV|UL|OL|BLOCKQUOTE|HR|PRE)$/.test(n.tagName)
    ) || nodes.length > 1;

    // If the note is a brand-new untouched "Untitled X" note with default placeholder text
    if (isUntouchedPlaceholderNote(editorEl) && hasBlockElements) {
        const startsWithH1 = nodes[0].nodeType === Node.ELEMENT_NODE && nodes[0].tagName === 'H1';
        if (startsWithH1) {
            editorEl.innerHTML = '';
        } else {
            const placeholderP = editorEl.querySelector('p');
            if (placeholderP) placeholderP.remove();
        }
        let lastNode = null;
        nodes.forEach(node => {
            editorEl.appendChild(node);
            lastNode = node;
        });
        finalizeEditorPaste(editorEl, lastNode);
        return true;
    }

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !editorEl.contains(sel.anchorNode)) {
        let lastNode = null;
        nodes.forEach(node => {
            editorEl.appendChild(node);
            lastNode = node;
        });
        finalizeEditorPaste(editorEl, lastNode);
        return true;
    }

    const range = sel.getRangeAt(0);
    if (!range.collapsed) {
        range.deleteContents();
    }

    // Single inline paragraph paste into an existing text container
    if (!hasBlockElements && nodes.length === 1 && nodes[0].nodeName === 'P') {
        const frag = document.createDocumentFragment();
        let lastInline = null;
        while (nodes[0].firstChild) {
            lastInline = nodes[0].firstChild;
            frag.appendChild(lastInline);
        }
        range.insertNode(frag);
        if (lastInline) {
            const newRange = document.createRange();
            newRange.setStartAfter(lastInline);
            newRange.collapse(true);
            sel.removeAllRanges();
            sel.addRange(newRange);
        }
        finalizeEditorPaste(editorEl, null);
        return true;
    }

    // Block-level paste: find direct child of #content containing the caret
    let topBlock = range.startContainer;
    while (topBlock && topBlock !== editorEl && topBlock.parentNode !== editorEl) {
        topBlock = topBlock.parentNode;
    }

    const frag = document.createDocumentFragment();
    let lastNode = null;
    nodes.forEach(node => {
        lastNode = node;
        frag.appendChild(node);
    });

    if (!topBlock || topBlock === editorEl) {
        if ((editorEl.innerText || '').trim() === '' && !editorEl.querySelector('img, video, table, .code-block-wrapper, .math-formula-block')) {
            editorEl.innerHTML = '';
        }
        editorEl.appendChild(frag);
    } else {
        const blockEmpty = (topBlock.innerText || '').trim() === '' &&
            !topBlock.querySelector?.('img, video, table, .code-block-wrapper, .math-formula-block, .claude-embedded-diagram');
        if (blockEmpty) {
            topBlock.replaceWith(frag);
        } else {
            topBlock.after(frag);
        }
    }

    finalizeEditorPaste(editorEl, lastNode);
    return true;
}

function finalizeEditorPaste(editorEl, lastNode) {
    if (lastNode && lastNode.isConnected) {
        try {
            const sel = window.getSelection();
            const r = document.createRange();
            if (lastNode.nodeType === Node.ELEMENT_NODE && lastNode.getAttribute('contenteditable') === 'false') {
                const trailingP = document.createElement('p');
                trailingP.innerHTML = '<br>';
                lastNode.after(trailingP);
                r.setStart(trailingP, 0);
            } else {
                r.selectNodeContents(lastNode);
                r.collapse(false);
            }
            sel.removeAllRanges();
            sel.addRange(r);
        } catch (_) {}
    }

    if (typeof ensureNoteFirstHeader === 'function') ensureNoteFirstHeader(editorEl, activeNoteName, false);
    if (typeof syncFirstHeaderToNoteName === 'function') {
        syncFirstHeaderToNoteName({ immediate: true, restoreIfEmpty: false, allowUniqueSuffix: true });
    }
    if (typeof processCodeBlock === 'function') processCodeBlock();
    if (typeof processMathFormulas === 'function') processMathFormulas(editorEl);
    if (typeof processChecklists === 'function') processChecklists();
    if (typeof updateStatusBarStats === 'function') updateStatusBarStats();
    if (typeof populateDocumentOutline === 'function') populateDocumentOutline();
    if (typeof triggerAutoSave === 'function') triggerAutoSave();
}

function handleSmartEditorPaste({ text = '', html = '', plainOnly = false } = {}) {
    const editorEl = document.getElementById('content');
    if (!editorEl || !activeNoteName) return false;

    const cleanText = String(text || '');
    const cleanHtml = String(html || '');

    // 1. If text is a detected code snippet (like SQL, Python, JavaScript, Rust, etc.)
    // and not a multi-element Markdown document (which should be parsed as full Markdown)
    const isCode = typeof isCodeSnippet === 'function' ? isCodeSnippet(cleanText) : false;
    const isMd = isMarkdownContent(cleanText);

    if (cleanText && isCode && !isMd) {
        const langMeta = typeof detectCodeLanguage === 'function' ? detectCodeLanguage(cleanText) : null;
        const codeBlockHtml = buildCodeBlockHtmlString(cleanText, langMeta ? langMeta.name : 'SQL');
        if (codeBlockHtml) {
            return insertHtmlNodesIntoEditor(codeBlockHtml);
        }
    }

    // 2. Markdown text
    if (cleanText && isMd) {
        const converted = markdownToNoshHtml(cleanText);
        if (converted) {
            return insertHtmlNodesIntoEditor(converted);
        }
    }

    // 3. HTML paste
    if (!plainOnly && cleanHtml && cleanHtml.trim()) {
        const probe = document.createElement('div');
        probe.innerHTML = cleanHtml;
        const probeText = probe.textContent || '';
        const hasSemanticTags = Boolean(probe.querySelector('h1, h2, h3, h4, table, ul, ol, blockquote, .katex'));

        // If the HTML is an IDE/editor wrapper without semantic HTML structure, and probeText is code
        if (!hasSemanticTags && typeof isCodeSnippet === 'function' && isCodeSnippet(probeText)) {
            const langMeta = typeof detectCodeLanguage === 'function' ? detectCodeLanguage(probeText) : null;
            const codeBlockHtml = buildCodeBlockHtmlString(probeText, langMeta ? langMeta.name : 'SQL');
            if (codeBlockHtml) {
                return insertHtmlNodesIntoEditor(codeBlockHtml);
            }
        }

        if (!hasSemanticTags && isMarkdownContent(probeText)) {
            const converted = markdownToNoshHtml(probeText);
            if (converted) {
                return insertHtmlNodesIntoEditor(converted);
            }
        }

        const sanitized = sanitizeAndConvertPastedHtml(cleanHtml, cleanText);
        if (sanitized) {
            return insertHtmlNodesIntoEditor(sanitized);
        }
    }

    // 4. Plain multi-line text: convert paragraphs cleanly
    if (cleanText) {
        if (cleanText.includes('\n')) {
            const converted = markdownToNoshHtml(cleanText);
            if (converted) {
                return insertHtmlNodesIntoEditor(converted);
            }
        }
    }

    return false;
}

window.handleSmartEditorPaste = handleSmartEditorPaste;
window.markdownToNoshHtml = markdownToNoshHtml;
window.renderClaudeEmbeddedDiagram = renderClaudeEmbeddedDiagram;

// Intercept Paste on #content (and on Welcome Dashboard to auto-create note on paste)
document.addEventListener('paste', async (e) => {
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.closest('.CodeMirror'))) {
        return;
    }

    const clipboardData = e.clipboardData;
    if (!clipboardData) return;

    // Allow image paste handler in imageVideo.js to handle image files
    const items = clipboardData.items ? Array.from(clipboardData.items) : [];
    if (items.some(item => item.type && item.type.startsWith('image/'))) {
        return;
    }

    const text = clipboardData.getData('text/plain') || '';
    const html = clipboardData.getData('text/html') || '';
    if (!text && !html) return;

    const isCode = typeof isCodeSnippet === 'function' ? isCodeSnippet(text) : false;

    // If user pastes while on Welcome Dashboard (!activeNoteName), auto-create a note and paste into it
    if (!activeNoteName) {
        if (!isMarkdownContent(text) && !html && !isCode) return;
        e.preventDefault();
        e.stopPropagation();
        if (typeof createNewFile === 'function') {
            await createNewFile();
            handleSmartEditorPaste({ text, html, plainOnly: false });
        }
        return;
    }

    const editorEl = document.getElementById('content');
    if (!editorEl) return;

    if (isMarkdownContent(text) || (html && html.trim()) || text.includes('\n') || isCode) {
        const handled = handleSmartEditorPaste({ text, html, plainOnly: false });
        if (handled) {
            e.preventDefault();
            e.stopPropagation();
        }
    }
});

// Drag and Drop File Import (.md, .pdf, .pptx, .docx, .zip, .csv, .txt, .html, .nsh)
async function importDroppedFilesToVault(files, targetFolderId = null) {
    if (!files || files.length === 0) return false;
    await invokeSavesDir();

    let importedCount = 0;
    const supportedExts = ['.md', '.markdown', '.pdf', '.pptx', '.docx', '.zip', '.csv', '.txt', '.html', '.nsh'];

    for (let idx = 0; idx < files.length; idx++) {
        const file = files[idx];
        const ext = path.extname(file.name).toLowerCase();
        if (!supportedExts.includes(ext)) {
            showToast(`Skipped unsupported file: ${file.name}`, 'warning');
            continue;
        }

        try {
            let parsedResult = null;
            if (file.path) {
                parsedResult = await ipcRenderer.invoke('open-file-dialog', {
                    filePath: file.path,
                    fileName: file.name
                });
            } else if (typeof file.arrayBuffer === 'function') {
                const ab = await file.arrayBuffer();
                const buffer = Buffer.from(ab);
                parsedResult = await ipcRenderer.invoke('open-file-dialog', {
                    mode: 'parse-buffer',
                    fileName: file.name,
                    bytes: Array.from(new Uint8Array(buffer))
                });
            }

            if (parsedResult) {
                const ok = await handleImportResult(parsedResult, targetFolderId);
                if (ok) importedCount++;
            }
        } catch (err) {
            console.error(`Failed to import dropped file "${file.name}":`, err);
            showToast(`Failed to import ${file.name}`, 'error');
        }
    }
    return importedCount > 0;
}

window.importDroppedFilesToVault = importDroppedFilesToVault;

window.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (window._draggedNoteName) {
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        return;
    }
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
});

window.addEventListener('drop', async (e) => {
    if (window._draggedNoteName) return;
    e.preventDefault();
    if (!e.dataTransfer || !e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
    await importDroppedFilesToVault(e.dataTransfer.files, null);
});
