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
    if (value) {
        document.execCommand(cmd, false, value);
    } else {
        document.execCommand(cmd, false, null);
    }
    content.focus();
}

// Get clean HTML without transient CodeMirror DOM trees
function getCleanContentHTML() {
    if (!content) return '';
    const clone = content.cloneNode(true);
    // Remove all CodeMirror injected DOM trees and transient media toolbars/handles from the clone
    clone.querySelectorAll('.CodeMirror').forEach(el => el.remove());
    clone.querySelectorAll('.media-toolbar').forEach(el => el.remove());
    clone.querySelectorAll('.media-resize-handle').forEach(el => el.remove());
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

// Native Open File
async function openFileFromSystem() {
    const fileData = await ipcRenderer.invoke('open-file-dialog');
    if (!fileData) return;

    const { fileName, content: loadedContent } = fileData;
    const destPath = path.join(savesDir, `${fileName}.nsh`);

    try {
        await fsPromises.writeFile(destPath, loadedContent, 'utf8');
        showToast(`Imported "${fileName}"`, 'success');
        await readDatabase(fileName);
    } catch (err) {
        console.error('Error importing file:', err);
        showToast('Failed to import file', 'error');
    }
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
    clone.querySelectorAll('.CodeMirror, .code-block-actions, .code-window-dots, .lang-caret, .block-lang-dropdown, .custom-color-popover, .delete-code-button').forEach(el => el.remove());

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

// Change Tracking & Auto-Save
let autoSaveTimer = null;

function triggerAutoSave() {
    if (!activeNoteName) return;

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

    // Debounced Auto-save if enabled
    if (localStorage.getItem('autoSave') === 'true') {
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
        range.deleteContents();
        const textNode = document.createTextNode(replacement);
        range.insertNode(textNode);
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
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
            if (node.parentElement && node.parentElement.closest('.CodeMirror')) {
                return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
        }
    });

    const regex = new RegExp(escapeRegex(query), 'gi');
    const nodesToReplace = [];
    while (walker.nextNode()) {
        if (regex.test(walker.currentNode.nodeValue)) {
            nodesToReplace.push(walker.currentNode);
        }
    }

    nodesToReplace.forEach(node => {
        const matches = node.nodeValue.match(regex);
        if (matches) count += matches.length;
        node.nodeValue = node.nodeValue.replace(regex, replacement);
    });

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
        setTimeout(() => textSpan.focus(), 50);
        textSpan.addEventListener('keydown', handleChecklistKeydown);
    }

    triggerAutoSave();
    showToast('Checklist item added', 'info');
}

function toggleChecklistItem(checkbox) {
    const item = checkbox.closest('.checklist-item');
    if (!item) return;

    if (checkbox.checked) {
        item.classList.add('completed');
        checkbox.setAttribute('checked', 'checked');
    } else {
        item.classList.remove('completed');
        checkbox.removeAttribute('checked');
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
            const p = document.createElement('p');
            p.innerHTML = '<br>';
            item.parentNode.replaceChild(p, item);
            const range = document.createRange();
            const sel = window.getSelection();
            range.setStart(p, 0);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
            triggerAutoSave();
        }
    }
}

// Ensure loaded checklists have change handlers attached
function processChecklists() {
    document.querySelectorAll('.checklist-item').forEach(item => {
        const cb = item.querySelector('.checklist-checkbox');
        if (cb && !cb.hasAttribute('onchange')) {
            cb.setAttribute('onchange', 'toggleChecklistItem(this)');
            if (cb.checked) item.classList.add('completed');
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

            // Code Block
            if (node.classList.contains('code-block-wrapper')) {
                const lang = node.querySelector('.code-lang-tag')?.textContent?.trim()?.toLowerCase() || '';
                const code = node.querySelector('.CodeMirror')?.CodeMirror ? 
                    node.querySelector('.CodeMirror').CodeMirror.getValue() : 
                    (node.querySelector('textarea.code')?.value || node.querySelector('textarea.code')?.textContent || '');
                return `\n\`\`\`${lang}\n${code}\n\`\`\`\n\n`;
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

            let inner = '';
            node.childNodes.forEach(child => {
                inner += parseNode(child);
            });

            switch (tag) {
                case 'h1': return `# ${inner.trim()}\n\n`;
                case 'h2': return `## ${inner.trim()}\n\n`;
                case 'h3': return `### ${inner.trim()}\n\n`;
                case 'h4': return `#### ${inner.trim()}\n\n`;
                case 'p': return `${inner.trim()}\n\n`;
                case 'strong':
                case 'b': return `**${inner}**`;
                case 'em':
                case 'i': return `*${inner}*`;
                case 'u': return `<u>${inner}</u>`;
                case 'strike':
                case 's': return `~~${inner}~~`;
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
                case 'ol': return `${inner}\n`;
                case 'li': return `- ${inner.trim()}\n`;
                case 'blockquote': return `> ${inner.trim()}\n\n`;
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
    const isInput = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');
    const contentEl = document.getElementById('content');
    const sel = window.getSelection();
    const isInsideContent = contentEl && (
        activeEl === contentEl ||
        contentEl.contains(activeEl) || 
        (sel && sel.anchorNode && contentEl.contains(sel.anchorNode))
    );

    // Ctrl+A: Select All Note Content (when inside editor and not in CodeMirror or an input)
    if (e.ctrlKey && !e.shiftKey && (key === 'a' || code === 'KeyA')) {
        if (isInsideContent && !insideCM && !isInput && contentEl) {
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

// Drag and Drop File Import (.md, .txt, .html, .nsh)
window.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
});

window.addEventListener('drop', async (e) => {
    e.preventDefault();
    if (!e.dataTransfer || !e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
    const file = e.dataTransfer.files[0];
    const ext = path.extname(file.name).toLowerCase();

    if (['.md', '.txt', '.html', '.nsh'].includes(ext)) {
        try {
            let fileText = '';
            if (file.path && fs.existsSync(file.path)) {
                fileText = await fsPromises.readFile(file.path, 'utf8');
            } else {
                fileText = await file.text();
            }

            const baseName = path.basename(file.name, ext);
            let noteContent = '';

            if (ext === '.md') {
                const lines = fileText.split('\n');
                let inCode = false;
                let codeLines = [];
                let codeLang = 'javascript';
                const htmlParts = [];

                for (const line of lines) {
                    if (line.trim().startsWith('```')) {
                        if (!inCode) {
                            inCode = true;
                            codeLang = line.trim().replace(/^```/, '') || 'javascript';
                            codeLines = [];
                        } else {
                            inCode = false;
                            const langMeta = typeof getLanguageMeta === 'function' ? getLanguageMeta(codeLang) : { name: codeLang, mode: codeLang, icon: 'solar:code-square-linear' };
                            htmlParts.push(`
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
                                    <textarea class="code" language="${langMeta.mode}" data-label="${langMeta.name}" style="display:block;">${escapeHtml(codeLines.join('\n'))}</textarea>
                                </div>
                            `);
                        }
                        continue;
                    }

                    if (inCode) {
                        codeLines.push(line);
                        continue;
                    }

                    if (line.startsWith('# ')) htmlParts.push(`<h1>${escapeHtml(line.slice(2))}</h1>`);
                    else if (line.startsWith('## ')) htmlParts.push(`<h2>${escapeHtml(line.slice(3))}</h2>`);
                    else if (line.startsWith('### ')) htmlParts.push(`<h3>${escapeHtml(line.slice(4))}</h3>`);
                    else if (line.startsWith('- [x] ')) htmlParts.push(`<div class="checklist-item completed" contenteditable="false"><input type="checkbox" class="checklist-checkbox" checked onchange="toggleChecklistItem(this)"><span class="checklist-text" contenteditable="true">${escapeHtml(line.slice(6))}</span></div>`);
                    else if (line.startsWith('- [ ] ')) htmlParts.push(`<div class="checklist-item" contenteditable="false"><input type="checkbox" class="checklist-checkbox" onchange="toggleChecklistItem(this)"><span class="checklist-text" contenteditable="true">${escapeHtml(line.slice(6))}</span></div>`);
                    else if (line.startsWith('- ') || line.startsWith('* ')) htmlParts.push(`<ul><li>${escapeHtml(line.slice(2))}</li></ul>`);
                    else if (line.trim().length > 0) {
                        let parsedLine = escapeHtml(line);
                        parsedLine = parsedLine.replace(/\[\[([^\[\]]+)\]\]/g, '<span class="note-internal-link" data-note="$1" contenteditable="false"><iconify-icon icon="solar:link-minimalistic-2-linear"></iconify-icon> $1</span>');
                        htmlParts.push(`<p>${parsedLine}</p>`);
                    }
                    else htmlParts.push('<p><br></p>');
                }
                noteContent = htmlParts.join('\n');
            } else if (ext === '.nsh' || ext === '.html') {
                noteContent = fileText;
            } else {
                noteContent = `<h1>${escapeHtml(baseName)}</h1><p>${escapeHtml(fileText).replace(/\n/g, '<br>')}</p>`;
            }

            if (!savesDir) await invokeSavesDir();
            const newFilePath = path.join(savesDir, `${baseName}.nsh`);
            await fsPromises.writeFile(newFilePath, noteContent, 'utf8');
            await readDatabase(baseName);
            showToast(`Imported "${file.name}" as note`, 'success');
        } catch (err) {
            console.error('Failed to import dropped file:', err);
            showToast('Failed to import dropped file', 'error');
        }
    }
});
