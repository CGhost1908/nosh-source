// Visual, Modal & UI Interaction Logic

const globalOverlay = document.getElementById('global-overlay');
const toastContainer = document.getElementById('toast-container');
const sidebar = document.querySelector('.left-side');
const toggleSidebarBtn = document.getElementById('toggle-sidebar-btn');

let savedTextRange = null;

// Modal Management
function openModal(modalId) {
    closeAllDropdowns();
    const modal = document.getElementById(modalId);
    if (!modal) return;

    if (globalOverlay) globalOverlay.classList.add('active');
    modal.classList.add('active');

    // Auto focus first input if any
    const firstInput = modal.querySelector('input:not([type="checkbox"]):not([readonly]), textarea');
    if (firstInput) {
        setTimeout(() => firstInput.focus(), 50);
    }
}

function closeAllModals() {
    if (globalOverlay) globalOverlay.classList.remove('active');
    document.querySelectorAll('.modal-container').forEach(modal => {
        modal.classList.remove('active');
    });
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('active');
    const remaining = document.querySelectorAll('.modal-container.active');
    if (remaining.length === 0 && globalOverlay) {
        globalOverlay.classList.remove('active');
    }
}

window.openModal = openModal;
window.closeAllModals = closeAllModals;
window.closeModal = closeModal;

// Escape key to close modals, dropdowns, context menu, outline, and exit zen mode
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const cropModal = document.getElementById('crop-modal');
        if (cropModal && cropModal.classList.contains('active')) {
            closeModal('crop-modal');
            return;
        }
        closeAllModals();
        closeAllDropdowns();
        hideContextMenu();
        toggleDocumentOutline(false);
        if (document.body.classList.contains('zen-mode')) {
            toggleZenMode(false);
        }
    }
});

// Toast Notifications
function showToast(message, type = 'info', duration = 2500) {
    if (!toastContainer) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    let iconName = 'solar:info-circle-linear';
    if (type === 'success') iconName = 'solar:check-circle-bold';
    else if (type === 'error') iconName = 'solar:danger-triangle-bold';
    else if (type === 'warning') iconName = 'solar:shield-warning-bold';

    toast.innerHTML = `
        <iconify-icon class="toast-icon" icon="${iconName}"></iconify-icon>
        <span>${message}</span>
    `;

    toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        toast.style.transition = '0.2s ease';
        setTimeout(() => toast.remove(), 200);
    }, duration);
}

// Sidebar Toggle
function toggleSidebar() {
    if (!sidebar) return;
    sidebar.classList.toggle('collapsed');
    const isCollapsed = sidebar.classList.contains('collapsed');
    localStorage.setItem('sidebar-collapsed', isCollapsed ? 'true' : 'false');
}

if (toggleSidebarBtn) {
    toggleSidebarBtn.addEventListener('click', toggleSidebar);
}

// Restore sidebar state
if (localStorage.getItem('sidebar-collapsed') === 'true' && sidebar) {
    sidebar.classList.add('collapsed');
}

// Dropdowns with Fixed Viewport Positioning (prevents clipping by overflow:hidden)
function toggleDropdown(dropdownId, triggerEl = null) {
    const dropdown = document.getElementById(dropdownId);
    if (!dropdown) return;

    const isOpen = dropdown.classList.contains('open');
    closeAllDropdowns();
    if (!isOpen) {
        let trigger = triggerEl;
        if (!trigger && typeof event !== 'undefined' && event) {
            trigger = event.currentTarget || event.target.closest('.dropdown-trigger');
        }
        if (!trigger) {
            trigger = dropdown.previousElementSibling;
        }

        if (trigger) {
            const rect = trigger.getBoundingClientRect();
            dropdown.style.position = 'fixed';
            dropdown.style.top = `${rect.bottom + 4}px`;
            dropdown.style.left = `${rect.left}px`;
            dropdown.style.zIndex = '99999';
        }
        dropdown.classList.add('open');
    }
}

function closeAllDropdowns() {
    document.querySelectorAll('.dropdown-menu').forEach(menu => {
        menu.classList.remove('open');
    });
}

// Close dropdowns on click outside or on scroll/resize
document.addEventListener('click', (e) => {
    if (!e.target.closest('.toolbar-dropdown') && !e.target.closest('.dropdown-menu')) {
        closeAllDropdowns();
    }
});

window.addEventListener('resize', closeAllDropdowns);
window.addEventListener('scroll', closeAllDropdowns, true);

// Window Maximize State Toggle & IPC
function toggleMaximizeWindow() {
    ipcRenderer.send('maximize');
}

ipcRenderer.on('window-maximized-state', (event, isMaximized) => {
    const maxIcon = document.getElementById('maximize-icon');
    if (!maxIcon) return;
    if (isMaximized) {
        maxIcon.setAttribute('icon', 'codicon:chrome-restore');
    } else {
        maxIcon.setAttribute('icon', 'codicon:chrome-maximize');
    }
});

// Selection helpers for links
function saveSelection() {
    const sel = window.getSelection();
    if (sel.rangeCount > 0) {
        return sel.getRangeAt(0);
    }
    return null;
}

function restoreSelection(range) {
    if (!range) return;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
}

// Link Modal handlers (Web URL & Internal Note Reference)
let currentLinkTab = 'url';

function switchLinkModalTab(tab) {
    currentLinkTab = tab;
    const urlTab = document.getElementById('link-tab-url');
    const noteTab = document.getElementById('link-tab-note');
    const urlPanel = document.getElementById('link-panel-url');
    const notePanel = document.getElementById('link-panel-note');

    if (urlTab) urlTab.classList.toggle('active', tab === 'url');
    if (noteTab) noteTab.classList.toggle('active', tab === 'note');
    if (urlPanel) urlPanel.style.display = tab === 'url' ? 'block' : 'none';
    if (notePanel) notePanel.style.display = tab === 'note' ? 'block' : 'none';

    if (tab === 'note') {
        filterVaultNotesPicker();
        const noteInput = document.getElementById('link-note-input');
        if (noteInput) {
            setTimeout(() => {
                noteInput.focus();
                noteInput.select();
            }, 60);
        }
    } else {
        updateLinkUrlPreview();
        const textInput = document.getElementById('link-text-input');
        const urlInput = document.getElementById('link-url-input');
        setTimeout(() => {
            if (urlInput && urlInput.value.trim() === '' && textInput && textInput.value.trim() !== '') {
                urlInput.focus();
            } else if (textInput && textInput.value.trim() === '') {
                textInput.focus();
            } else if (urlInput) {
                urlInput.focus();
                urlInput.select();
            }
        }, 60);
    }
}

function filterVaultNotesPicker() {
    const list = document.getElementById('link-note-picker-list');
    const noteInput = document.getElementById('link-note-input');
    if (!list) return;

    const query = noteInput ? noteInput.value.trim().toLowerCase() : '';
    const noteElements = document.querySelectorAll('#saves-container .save');
    const noteNames = [];
    noteElements.forEach(el => {
        const name = el.getAttribute('data-file');
        if (name && !noteNames.includes(name)) noteNames.push(name);
    });

    list.innerHTML = '';

    const currentSelected = noteInput ? noteInput.value.trim() : '';
    const filtered = noteNames.filter(name => !query || name.toLowerCase().includes(query));

    if (filtered.length === 0 && query) {
        const createItem = document.createElement('div');
        createItem.className = 'link-note-item selected';
        createItem.innerHTML = `
            <iconify-icon icon="solar:pen-new-square-linear"></iconify-icon>
            <span class="link-note-title">Create new note: <strong>"${escapeHtml(noteInput.value.trim())}"</strong></span>
            <span class="link-note-badge">New</span>
        `;
        createItem.onclick = () => selectVaultNote(noteInput.value.trim());
        list.appendChild(createItem);
        return;
    }

    filtered.forEach(name => {
        const item = document.createElement('div');
        const isSelected = currentSelected && currentSelected.toLowerCase() === name.toLowerCase();
        item.className = 'link-note-item' + (isSelected ? ' selected' : '');
        item.innerHTML = `
            <iconify-icon icon="solar:document-text-linear"></iconify-icon>
            <span class="link-note-title">${escapeHtml(name)}</span>
            ${isSelected ? '<iconify-icon icon="solar:check-circle-bold" style="color: var(--accent);"></iconify-icon>' : ''}
        `;
        item.onclick = () => selectVaultNote(name);
        list.appendChild(item);
    });
}

function selectVaultNote(noteName) {
    const noteInput = document.getElementById('link-note-input');
    if (noteInput) {
        noteInput.value = noteName;
    }
    filterVaultNotesPicker();
}

function insertInternalNoteLinkElement(noteName, customDisplay = '') {
    if (!noteName || !content) return;
    const span = document.createElement('span');
    span.className = 'note-internal-link';
    span.setAttribute('data-note', noteName);
    span.setAttribute('contenteditable', 'false');
    span.setAttribute('title', `Jump to note: ${noteName}`);
    const label = customDisplay.trim() || noteName;
    span.innerHTML = `<iconify-icon icon="solar:link-minimalistic-2-linear"></iconify-icon> ${escapeHtml(label)}`;
    span.onclick = (e) => jumpToInternalNote(e, noteName);

    const sel = window.getSelection();
    let inserted = false;
    if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        if (content.contains(range.commonAncestorContainer)) {
            range.deleteContents();
            range.insertNode(span);
            const space = document.createTextNode(' ');
            span.parentNode.insertBefore(space, span.nextSibling);
            range.setStartAfter(space);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
            inserted = true;
        }
    }
    if (!inserted) {
        content.appendChild(span);
        content.appendChild(document.createTextNode(' '));
    }
    if (typeof triggerAutoSave === 'function') triggerAutoSave();
}

function normalizeExternalUrl(rawUrl) {
    if (!rawUrl) return '';
    let url = rawUrl.trim();
    if (!url) return '';
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//i.test(url) || /^mailto:/i.test(url)) {
        return url;
    }
    if (url.startsWith('//')) {
        return 'https:' + url;
    }
    return 'https://' + url;
}

function openExternalUrlSafely(rawUrl) {
    const safeUrl = normalizeExternalUrl(rawUrl);
    if (!safeUrl) return;
    try {
        const { shell } = require('electron');
        shell.openExternal(safeUrl);
    } catch {
        if (typeof ipcRenderer !== 'undefined') {
            ipcRenderer.invoke('open-external', safeUrl);
        } else {
            window.open(safeUrl, '_blank');
        }
    }
}

function updateLinkUrlPreview() {
    // Kept clean and minimal
}

function pasteUrlFromClipboard() {
    try {
        const text = require('electron').clipboard.readText() || '';
        const urlInput = document.getElementById('link-url-input');
        if (urlInput && text.trim()) {
            urlInput.value = text.trim();
            urlInput.focus();
        }
    } catch (e) {
        console.error('Failed to read clipboard:', e);
    }
}

function openLinkModal(defaultTab = 'url', prefillUrl = '', prefillText = '') {
    if (typeof activeNoteName === 'undefined' || !activeNoteName) {
        if (typeof showToast === 'function') showToast('Create or open a note first', 'warning');
        return;
    }
    savedTextRange = saveSelection();

    // Determine initial display text from selected editor range or parameter
    let initialText = prefillText;
    if (!initialText && savedTextRange) {
        const str = savedTextRange.toString().trim();
        if (str && !str.startsWith('http://') && !str.startsWith('https://')) {
            initialText = str;
        }
    }

    const titleEl = document.getElementById('link-modal-title');
    const btnText = document.getElementById('confirm-link-btn-text');
    const unlinkBtn = document.getElementById('link-modal-unlink-btn');
    const textInput = document.getElementById('link-text-input');
    const urlInput = document.getElementById('link-url-input');
    const noteInput = document.getElementById('link-note-input');
    const noteTextInput = document.getElementById('link-note-text-input');

    if (textInput) textInput.value = initialText || '';
    if (urlInput) urlInput.value = prefillUrl || '';
    if (noteInput) noteInput.value = '';
    if (noteTextInput) noteTextInput.value = initialText || '';

    const isEdit = !!prefillUrl;
    if (titleEl) titleEl.textContent = isEdit ? 'Edit Link' : 'Insert Link';
    if (btnText) btnText.textContent = isEdit ? 'Update Link' : 'Insert Link';
    if (unlinkBtn) unlinkBtn.style.display = isEdit ? 'inline-flex' : 'none';

    // Auto-prefill URL from clipboard if opening fresh and clipboard has a link
    if (!isEdit && urlInput && !urlInput.value.trim()) {
        try {
            const cbText = (require('electron').clipboard.readText() || '').trim();
            const isUrlPattern = /^https?:\/\/\S+/i.test(cbText) || /^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}\b/i.test(cbText);
            if (isUrlPattern) {
                urlInput.value = cbText;
            }
        } catch {}
    }

    switchLinkModalTab(defaultTab);
    openModal('link-modal');

    // Attach Enter key submit handler to inputs if not attached
    [textInput, urlInput, noteInput, noteTextInput].forEach(input => {
        if (input && !input.dataset.enterBound) {
            input.dataset.enterBound = 'true';
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    confirmAddLink();
                }
            });
        }
    });
}

function removeLinkFromModal() {
    if (savedTextRange) {
        restoreSelection(savedTextRange);
    }
    document.execCommand('unlink', false, null);
    if (typeof triggerAutoSave === 'function') triggerAutoSave();
    closeAllModals();
    showToast('Link removed', 'info');
}

function openInternalLinkModal() {
    openLinkModal('note');
}

function confirmAddLink() {
    if (currentLinkTab === 'note') {
        const noteInput = document.getElementById('link-note-input');
        const noteName = noteInput ? noteInput.value.trim() : '';
        const customText = document.getElementById('link-note-text-input')?.value.trim() || '';
        if (noteName) {
            if (savedTextRange) {
                restoreSelection(savedTextRange);
            }
            insertInternalNoteLinkElement(noteName, customText);
            showToast(`Linked to note "${noteName}"`, 'success');
            closeAllModals();
        } else {
            showToast('Please select or enter a target note', 'warning');
        }
        return;
    }

    // Web URL
    const rawUrl = document.getElementById('link-url-input')?.value.trim();
    if (!rawUrl) {
        showToast('Please enter a web address (URL)', 'warning');
        const urlInput = document.getElementById('link-url-input');
        if (urlInput) urlInput.focus();
        return;
    }

    const url = normalizeExternalUrl(rawUrl);
    const customText = document.getElementById('link-text-input')?.value.trim();
    const displayText = customText || rawUrl;

    if (savedTextRange) {
        restoreSelection(savedTextRange);
    }

    const sel = window.getSelection();
    const a = document.createElement('a');
    a.href = url;
    a.textContent = displayText;
    a.target = '_blank';

    let replaced = false;
    if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        if (content && content.contains(range.commonAncestorContainer)) {
            // Check if current selection is inside an existing <a>
            let existingA = range.commonAncestorContainer;
            while (existingA && existingA !== content && existingA.tagName !== 'A') {
                existingA = existingA.parentElement;
            }

            if (existingA && existingA.tagName === 'A') {
                existingA.href = url;
                existingA.textContent = displayText;
                replaced = true;
            } else {
                range.deleteContents();
                range.insertNode(a);
                const space = document.createTextNode(' ');
                a.parentNode.insertBefore(space, a.nextSibling);
                range.setStartAfter(space);
                range.collapse(true);
                sel.removeAllRanges();
                sel.addRange(range);
                replaced = true;
            }
        }
    }

    if (!replaced && content) {
        content.appendChild(a);
        content.appendChild(document.createTextNode(' '));
    }

    if (typeof triggerAutoSave === 'function') triggerAutoSave();
    showToast('Link added', 'success');
    closeAllModals();
}

// Global click handler on editor content for opening external links
if (content) {
    content.addEventListener('click', (e) => {
        const link = e.target.closest('a');
        if (!link || !content.contains(link)) return;
        if (link.classList.contains('note-internal-link')) return;

        const href = link.getAttribute('href') || link.textContent;
        if (href) {
            e.preventDefault();
            e.stopPropagation();
            openExternalUrlSafely(href);
        }
    });
}

// Delete Note Modal
let noteToDelete = null;

function openDeleteModal(noteName) {
    noteToDelete = noteName || activeNoteName;
    if (!noteToDelete) {
        showToast('No note selected to delete', 'warning');
        return;
    }
    const msg = document.getElementById('delete-modal-msg');
    if (msg) {
        msg.textContent = `Are you sure you want to move "${noteToDelete}" to Trash? You can restore it anytime.`;
    }
    openModal('delete-modal');
}

function confirmDeleteActiveNote() {
    if (noteToDelete) {
        deleteSave(noteToDelete);
        noteToDelete = null;
    }
    closeAllModals();
}

// ==========================================================================
// Document Table of Contents & Structure Outline Drawer (Ctrl+Shift+O)
// ==========================================================================
let currentOutlineFilter = 'all';
let outlineLiveRefreshTimer = null;

function safeEscapeOutlineText(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function setOutlineFilter(filter) {
    currentOutlineFilter = filter;
    const filterBtns = document.querySelectorAll('.outline-filter-pill');
    filterBtns.forEach(btn => {
        if (btn.getAttribute('data-filter') === filter) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
    populateDocumentOutline();
}

function toggleDocumentOutline(forceState = null, evt = null) {
    // If first argument is an event object (e.g. from onclick="toggleDocumentOutline(event)")
    if (forceState && typeof forceState === 'object' && ('stopPropagation' in forceState || 'target' in forceState)) {
        evt = forceState;
        forceState = null;
    }
    if (evt) {
        if (typeof evt.preventDefault === 'function') evt.preventDefault();
        if (typeof evt.stopPropagation === 'function') evt.stopPropagation();
    }

    const drawer = document.getElementById('document-outline-drawer');
    const outlineBadge = document.getElementById('status-outline');
    if (!drawer) return;

    const isOpen = drawer.classList.contains('open');
    const nextState = (forceState !== null && typeof forceState === 'boolean') ? forceState : !isOpen;

    if (nextState) {
        // Dismiss backlinks popover if open
        const backlinksPopover = document.getElementById('backlinks-popover');
        if (backlinksPopover) backlinksPopover.style.display = 'none';

        populateDocumentOutline();
        drawer.classList.add('open');
        if (outlineBadge) outlineBadge.classList.add('active');
    } else {
        drawer.classList.remove('open');
        if (outlineBadge) outlineBadge.classList.remove('active');
    }
}

function populateDocumentOutline() {
    const list = document.getElementById('outline-list');
    const countBadge = document.getElementById('outline-count-badge');
    if (!list) return;
    list.innerHTML = '';

    const contentEl = document.getElementById('content');
    if (!contentEl) return;

    // Check if welcome dashboard is displayed
    const hasWelcome = !!contentEl.querySelector('.welcome-container');
    if (hasWelcome && !activeNoteName) {
        if (countBadge) countBadge.textContent = '0';
        list.innerHTML = `
            <div class="outline-empty">
                <iconify-icon icon="solar:notes-linear" style="font-size: 24px; opacity: 0.4; margin-bottom: 8px;"></iconify-icon>
                <div style="font-weight: 500;">No active note</div>
                <div style="font-size: 11px; margin-top: 4px; opacity: 0.7;">Open or create a note to view its outline.</div>
            </div>
        `;
        return;
    }

    // Query structural elements in pre-order document sequence
    const rawElements = contentEl.querySelectorAll('h1, h2, h3, h4, h5, h6, .code-block-wrapper, .checklist-item, blockquote, .media-container, table');
    const itemsData = [];

    rawElements.forEach((el) => {
        // Skip elements located inside a code-block-wrapper (except the wrapper itself)
        if (el.closest('.code-block-wrapper') && !el.classList.contains('code-block-wrapper')) {
            return;
        }

        const tagName = el.tagName ? el.tagName.toLowerCase() : '';

        // 1. Headings (H1 to H6)
        if (/^h[1-6]$/.test(tagName)) {
            const headingText = el.textContent.trim() || `Untitled ${tagName.toUpperCase()}`;
            itemsData.push({
                type: 'heading',
                level: tagName,
                badge: tagName.toUpperCase(),
                text: headingText,
                icon: null,
                meta: null,
                element: el
            });
            return;
        }

        // 2. Code Block (.code-block-wrapper)
        if (el.classList.contains('code-block-wrapper')) {
            let lang = 'Code';
            const langNameEl = el.querySelector('.lang-name');
            if (langNameEl && langNameEl.textContent.trim()) {
                lang = langNameEl.textContent.trim();
            } else {
                const ta = el.querySelector('textarea.code');
                if (ta) lang = ta.getAttribute('data-label') || ta.getAttribute('language') || 'Code';
            }

            let codeVal = '';
            const cmEl = el.querySelector('.CodeMirror');
            if (cmEl && cmEl.CodeMirror) {
                codeVal = cmEl.CodeMirror.getValue();
            } else {
                const ta = el.querySelector('textarea.code');
                if (ta) codeVal = ta.value || ta.textContent || '';
            }

            const lines = codeVal.split('\n');
            const firstNonEmpty = lines.map(l => l.trim()).find(l => l.length > 0) || 'Empty code block';
            const lineCount = lines.length;

            itemsData.push({
                type: 'code',
                level: 'code',
                badge: lang.length > 8 ? lang.slice(0, 7) + '…' : lang,
                text: firstNonEmpty,
                icon: 'solar:code-square-linear',
                meta: `${lineCount} line${lineCount === 1 ? '' : 's'}`,
                element: el
            });
            return;
        }

        // 3. Checklist Item (.checklist-item)
        if (el.classList.contains('checklist-item')) {
            const cb = el.querySelector('.checklist-checkbox');
            const isCompleted = cb ? (cb.checked || cb.hasAttribute('checked') || el.classList.contains('completed')) : false;
            const textEl = el.querySelector('.checklist-text');
            const taskText = textEl ? textEl.textContent.trim() : 'Task item';

            itemsData.push({
                type: 'task',
                level: 'task',
                badge: isCompleted ? 'DONE' : 'TODO',
                text: taskText || 'Untitled task',
                icon: isCompleted ? 'solar:check-circle-bold' : 'solar:square-linear',
                isCompleted: isCompleted,
                meta: null,
                element: el
            });
            return;
        }

        // 4. Blockquote
        if (tagName === 'blockquote') {
            const quoteText = el.textContent.trim() || 'Quote';
            const firstLine = quoteText.split('\n')[0].trim();
            itemsData.push({
                type: 'quote',
                level: 'quote',
                badge: 'QUOTE',
                text: firstLine || 'Empty quote',
                icon: 'solar:quote-up-linear',
                meta: null,
                element: el
            });
            return;
        }

        // 5. Media Container (.media-container)
        if (el.classList.contains('media-container')) {
            const img = el.querySelector('img');
            const video = el.querySelector('video');
            const isImg = !!img;
            let label = isImg ? (img.alt || img.getAttribute('data-asset-rel')?.split('/').pop() || 'Image') : (video?.getAttribute('data-asset-rel')?.split('/').pop() || 'Video');

            itemsData.push({
                type: 'media',
                level: 'media',
                badge: isImg ? 'IMG' : 'VIDEO',
                text: label,
                icon: isImg ? 'solar:gallery-linear' : 'solar:videocamera-linear',
                meta: null,
                element: el
            });
            return;
        }

        // 6. Tables
        if (tagName === 'table') {
            const firstHeader = el.querySelector('th, td')?.textContent.trim() || 'Table';
            const rowCount = el.querySelectorAll('tr').length;
            itemsData.push({
                type: 'table',
                level: 'table',
                badge: 'TABLE',
                text: firstHeader,
                icon: 'solar:widget-2-linear',
                meta: `${rowCount} rows`,
                element: el
            });
            return;
        }
    });

    if (countBadge) {
        countBadge.textContent = itemsData.length;
    }

    if (itemsData.length === 0) {
        list.innerHTML = `
            <div class="outline-empty">
                <iconify-icon icon="solar:document-text-linear" style="font-size: 24px; opacity: 0.4; margin-bottom: 8px;"></iconify-icon>
                <div style="font-weight: 500;">No outline items</div>
                <div style="font-size: 11px; margin-top: 4px; opacity: 0.7;">Add headings (H1-H4), code blocks, or checklists to build an outline.</div>
            </div>
        `;
        return;
    }

    // Apply active filter tab
    const filtered = currentOutlineFilter === 'all'
        ? itemsData
        : itemsData.filter(item => {
            if (currentOutlineFilter === 'heading') return item.type === 'heading';
            if (currentOutlineFilter === 'code') return item.type === 'code';
            if (currentOutlineFilter === 'task') return item.type === 'task';
            return true;
        });

    if (filtered.length === 0) {
        list.innerHTML = `
            <div class="outline-empty">
                <iconify-icon icon="solar:filter-linear" style="font-size: 22px; opacity: 0.4; margin-bottom: 6px;"></iconify-icon>
                <div>No items match the "${safeEscapeOutlineText(currentOutlineFilter)}" filter.</div>
            </div>
        `;
        return;
    }

    filtered.forEach((item) => {
        const itemEl = document.createElement('div');
        itemEl.className = `outline-item type-${item.type} level-${item.level}`;
        if (item.type === 'task' && item.isCompleted) {
            itemEl.classList.add('completed');
        }

        let badgeClass = `${item.level}-badge`;
        if (item.type === 'heading') badgeClass = `${item.level}-badge`;
        else if (item.type === 'code') badgeClass = 'code-badge';
        else if (item.type === 'task') badgeClass = `task-badge ${item.isCompleted ? 'completed' : ''}`;
        else if (item.type === 'quote') badgeClass = 'quote-badge';
        else if (item.type === 'media') badgeClass = 'media-badge';
        else if (item.type === 'table') badgeClass = 'table-badge';

        let innerHTML = '';
        if (item.icon) {
            innerHTML += `<iconify-icon icon="${item.icon}" class="outline-type-icon ${item.type === 'task' && item.isCompleted ? 'task-done-icon' : ''}"></iconify-icon>`;
        }
        innerHTML += `<span class="outline-badge ${badgeClass}">${safeEscapeOutlineText(item.badge)}</span>`;

        if (item.type === 'code') {
            innerHTML += `<span class="outline-code-preview" title="${safeEscapeOutlineText(item.text)}">${safeEscapeOutlineText(item.text)}</span>`;
        } else if (item.type === 'task') {
            innerHTML += `<span class="outline-task-text ${item.isCompleted ? 'completed' : ''}" title="${safeEscapeOutlineText(item.text)}">${safeEscapeOutlineText(item.text)}</span>`;
        } else {
            innerHTML += `<span class="outline-item-text" title="${safeEscapeOutlineText(item.text)}" style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${safeEscapeOutlineText(item.text)}</span>`;
        }

        if (item.meta) {
            innerHTML += `<span class="outline-item-meta">${safeEscapeOutlineText(item.meta)}</span>`;
        }

        itemEl.innerHTML = innerHTML;

        itemEl.onclick = (e) => {
            e.stopPropagation();
            if (item.element) {
                item.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                item.element.classList.remove('outline-target-pulse');
                item.element.classList.remove('heading-pulse');
                void item.element.offsetWidth; // trigger reflow
                item.element.classList.add('outline-target-pulse');
                setTimeout(() => {
                    item.element.classList.remove('outline-target-pulse');
                }, 1600);
            }
        };

        list.appendChild(itemEl);
    });
}

function refreshOutlineIfOpen() {
    const drawer = document.getElementById('document-outline-drawer');
    if (drawer && drawer.classList.contains('open')) {
        clearTimeout(outlineLiveRefreshTimer);
        outlineLiveRefreshTimer = setTimeout(() => {
            populateDocumentOutline();
        }, 300);
    }
}

// Global click outside to dismiss outline drawer
document.addEventListener('click', (e) => {
    const drawer = document.getElementById('document-outline-drawer');
    if (drawer && drawer.classList.contains('open')) {
        if (e.target.closest('#document-outline-drawer') || e.target.closest('#status-outline')) {
            return;
        }
        toggleDocumentOutline(false);
    }
});

// --- Custom Rich Text Color Picker System ---
let currentColorCommand = 'foreColor';
let savedColorRange = null;

const CURATED_COLOR_PALETTE = [
    { name: 'Default', hex: 'inherit', bg: '#94a3b8', isDefault: true },
    { name: 'Pure White', hex: '#ffffff', bg: '#ffffff' },
    { name: 'Charcoal', hex: '#334155', bg: '#334155' },
    { name: 'Ruby Red', hex: '#ef4444', bg: '#ef4444' },
    { name: 'Sunset Coral', hex: '#f97316', bg: '#f97316' },
    { name: 'Warm Amber', hex: '#f59e0b', bg: '#f59e0b' },
    { name: 'Emerald', hex: '#10b981', bg: '#10b981' },
    { name: 'Teal Mint', hex: '#14b8a6', bg: '#14b8a6' },
    { name: 'Cyan Sky', hex: '#06b6d4', bg: '#06b6d4' },
    { name: 'Royal Blue', hex: '#3b82f6', bg: '#3b82f6' },
    { name: 'Indigo Accent', hex: '#6366f1', bg: '#6366f1' },
    { name: 'Purple Violet', hex: '#8b5cf6', bg: '#8b5cf6' },
    { name: 'Berry Rose', hex: '#ec4899', bg: '#ec4899' },
    { name: 'Pastel Yellow', hex: '#fef08a', bg: '#fef08a' },
    { name: 'Pastel Green', hex: '#bbf7d0', bg: '#bbf7d0' },
    { name: 'Pastel Blue', hex: '#bae6fd', bg: '#bae6fd' },
    { name: 'Pastel Lavender', hex: '#e9d5ff', bg: '#e9d5ff' },
    { name: 'Pastel Pink', hex: '#fbcfe8', bg: '#fbcfe8' }
];

function initCustomColorPicker() {
    const grid = document.getElementById('color-swatches-grid');
    if (!grid) return;
    grid.innerHTML = '';

    CURATED_COLOR_PALETTE.forEach(c => {
        const btn = document.createElement('button');
        btn.className = 'color-swatch-btn';
        btn.title = c.name;
        btn.style.backgroundColor = c.bg;
        if (c.isDefault) {
            btn.innerHTML = '<iconify-icon icon="solar:close-circle-bold" style="font-size:12px; color:#1e293b;"></iconify-icon>';
        }
        btn.onclick = (e) => {
            e.stopPropagation();
            applyCustomColor(c.hex);
        };
        grid.appendChild(btn);
    });
}

function openCustomColorPicker(cmd, btn) {
    const popover = document.getElementById('custom-color-popover');
    if (!popover) return;

    if (popover.style.display === 'flex' && currentColorCommand === cmd) {
        closeCustomColorPicker();
        return;
    }

    closeAllDropdowns();
    savedColorRange = saveSelection();
    currentColorCommand = cmd;

    const titleEl = document.getElementById('color-popover-title');
    if (titleEl) {
        titleEl.textContent = cmd === 'foreColor' ? 'Text Color' : 'Highlight Color';
    }

    const rect = btn.getBoundingClientRect();
    popover.style.position = 'fixed';
    popover.style.top = `${rect.bottom + 6}px`;
    popover.style.left = `${Math.min(rect.left, window.innerWidth - 240)}px`;
    popover.style.zIndex = '99999';
    popover.style.display = 'flex';
}

function closeCustomColorPicker() {
    const popover = document.getElementById('custom-color-popover');
    if (popover) popover.style.display = 'none';
}

function applyCustomColor(color) {
    if (savedColorRange) {
        restoreSelection(savedColorRange);
    }

    if (color === 'inherit' || color === 'transparent') {
        if (currentColorCommand === 'foreColor') {
            document.execCommand('foreColor', false, 'inherit');
            const ind = document.getElementById('text-color-indicator');
            if (ind) ind.style.backgroundColor = 'transparent';
        } else {
            document.execCommand('hiliteColor', false, 'transparent');
            const ind = document.getElementById('bg-color-indicator');
            if (ind) ind.style.backgroundColor = 'transparent';
        }
    } else {
        if (currentColorCommand === 'foreColor') {
            document.execCommand('foreColor', false, color);
            const ind = document.getElementById('text-color-indicator');
            if (ind) ind.style.backgroundColor = color;
        } else {
            document.execCommand('hiliteColor', false, color);
            const ind = document.getElementById('bg-color-indicator');
            if (ind) ind.style.backgroundColor = color;
        }
    }

    if (content) content.focus();
    if (typeof triggerAutoSave === 'function') triggerAutoSave();
    closeCustomColorPicker();
}

function onCustomHexInput(val) {
    const hexInput = document.getElementById('color-hex-input');
    if (hexInput) hexInput.value = val;
    const preview = document.getElementById('color-wheel-preview');
    if (preview) preview.style.backgroundColor = val;
}

function applyCustomHexFromInput() {
    const hexInput = document.getElementById('color-hex-input');
    const val = hexInput ? hexInput.value.trim() : '';
    if (!val) return;
    const color = val.startsWith('#') ? val : `#${val}`;
    applyCustomColor(color);
}

// Close color popover on click outside or on scroll/resize
document.addEventListener('click', (e) => {
    const popover = document.getElementById('custom-color-popover');
    if (popover && popover.style.display === 'flex') {
        if (!e.target.closest('#custom-color-popover') && !e.target.closest('.color-popover-trigger')) {
            closeCustomColorPicker();
        }
    }
});

window.addEventListener('resize', closeCustomColorPicker);
window.addEventListener('scroll', closeCustomColorPicker, true);

// Initialize on load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCustomColorPicker);
} else {
    initCustomColorPicker();
}

// ==========================================================================
// Distraction-Free Focus / Zen Mode (Ctrl+Shift+F)
// ==========================================================================
function toggleZenMode(forceState = null) {
    const isZen = document.body.classList.contains('zen-mode');
    const nextState = forceState !== null ? forceState : !isZen;

    if (nextState) {
        document.body.classList.add('zen-mode');
        showToast('Entered Focus Mode (Esc to exit)', 'info');
    } else {
        document.body.classList.remove('zen-mode');
        showToast('Exited Focus Mode', 'info');
    }
}

// ==========================================================================
// NOSH DESKTOP - High-Craft Skeleton Loading Engine (Linear / Raycast Style)
// ==========================================================================

function getSidebarSkeletonHTML() {
    return `
        <div class="skeleton-note-list" id="sidebar-skeleton-list">
            <!-- Pinned Section Header -->
            <div class="sk-section-header">
                <div class="nosh-skeleton sk-section-icon"></div>
                <div class="nosh-skeleton sk-section-title" style="width: 46px;"></div>
            </div>

            <!-- Pinned Note 1 (Rich 2-Line) -->
            <div class="skeleton-note-item pinned two-line">
                <div class="nosh-skeleton sk-icon"></div>
                <div class="sk-body">
                    <div class="nosh-skeleton sk-title" style="width: 74%;"></div>
                    <div class="nosh-skeleton sk-subtitle" style="width: 48%;"></div>
                </div>
                <div class="sk-actions-group">
                    <div class="nosh-skeleton sk-pin"></div>
                    <div class="nosh-skeleton sk-cloud"></div>
                </div>
            </div>

            <!-- Pinned Note 2 (1-Line) -->
            <div class="skeleton-note-item pinned">
                <div class="nosh-skeleton sk-icon"></div>
                <div class="sk-body">
                    <div class="nosh-skeleton sk-title" style="width: 66%;"></div>
                </div>
                <div class="sk-actions-group">
                    <div class="nosh-skeleton sk-pin"></div>
                </div>
            </div>

            <!-- All Notes Section Header -->
            <div class="sk-section-header">
                <div class="nosh-skeleton sk-section-icon"></div>
                <div class="nosh-skeleton sk-section-title" style="width: 60px;"></div>
            </div>

            <!-- Note Item 1 (Rich 2-Line) -->
            <div class="skeleton-note-item two-line">
                <div class="nosh-skeleton sk-icon"></div>
                <div class="sk-body">
                    <div class="nosh-skeleton sk-title" style="width: 82%;"></div>
                    <div class="nosh-skeleton sk-subtitle" style="width: 58%;"></div>
                </div>
                <div class="sk-actions-group">
                    <div class="nosh-skeleton sk-pin"></div>
                </div>
            </div>

            <!-- Note Item 2 (1-Line) -->
            <div class="skeleton-note-item">
                <div class="nosh-skeleton sk-icon"></div>
                <div class="sk-body">
                    <div class="nosh-skeleton sk-title" style="width: 56%;"></div>
                </div>
                <div class="sk-actions-group">
                    <div class="nosh-skeleton sk-cloud"></div>
                </div>
            </div>

            <!-- Note Item 3 (Rich 2-Line) -->
            <div class="skeleton-note-item two-line">
                <div class="nosh-skeleton sk-icon"></div>
                <div class="sk-body">
                    <div class="nosh-skeleton sk-title" style="width: 76%;"></div>
                    <div class="nosh-skeleton sk-subtitle" style="width: 44%;"></div>
                </div>
                <div class="sk-actions-group">
                    <div class="nosh-skeleton sk-pin"></div>
                </div>
            </div>

            <!-- Note Item 4 (1-Line) -->
            <div class="skeleton-note-item">
                <div class="nosh-skeleton sk-icon"></div>
                <div class="sk-body">
                    <div class="nosh-skeleton sk-title" style="width: 68%;"></div>
                </div>
                <div class="sk-actions-group">
                    <div class="nosh-skeleton sk-pin"></div>
                </div>
            </div>

            <!-- Note Item 5 (Rich 2-Line) -->
            <div class="skeleton-note-item two-line">
                <div class="nosh-skeleton sk-icon"></div>
                <div class="sk-body">
                    <div class="nosh-skeleton sk-title" style="width: 86%;"></div>
                    <div class="nosh-skeleton sk-subtitle" style="width: 52%;"></div>
                </div>
                <div class="sk-actions-group">
                    <div class="nosh-skeleton sk-pin"></div>
                </div>
            </div>

            <!-- Note Item 6 (1-Line) -->
            <div class="skeleton-note-item">
                <div class="nosh-skeleton sk-icon"></div>
                <div class="sk-body">
                    <div class="nosh-skeleton sk-title" style="width: 60%;"></div>
                </div>
                <div class="sk-actions-group">
                    <div class="nosh-skeleton sk-pin"></div>
                </div>
            </div>

            <!-- Note Item 7 (1-Line) -->
            <div class="skeleton-note-item">
                <div class="nosh-skeleton sk-icon"></div>
                <div class="sk-body">
                    <div class="nosh-skeleton sk-title" style="width: 72%;"></div>
                </div>
                <div class="sk-actions-group">
                    <div class="nosh-skeleton sk-pin"></div>
                </div>
            </div>
        </div>
    `;
}

function showSidebarSkeleton() {
    const savesContainer = document.getElementById('saves-container');
    if (savesContainer) {
        savesContainer.innerHTML = getSidebarSkeletonHTML();
    }
    const countBadge = document.getElementById('notes-count');
    if (countBadge) {
        countBadge.classList.add('sk-badge-shimmer');
    }
}

function hideSidebarSkeleton() {
    const countBadge = document.getElementById('notes-count');
    if (countBadge) {
        countBadge.classList.remove('sk-badge-shimmer');
    }
}

function getDocumentSkeletonHTML(titleText = '') {
    return `
        <div class="skeleton-doc-view" id="document-skeleton-view">
            <div class="sk-doc-header">
                ${titleText ? `<h1 style="font-size:28px;font-weight:700;color:var(--text-primary);margin:0 0 4px 0;opacity:0.85;">${escapeHtml(titleText)}</h1>` : `<div class="nosh-skeleton sk-doc-title"></div>`}
                <div class="sk-doc-meta">
                    <div class="nosh-skeleton nosh-skeleton-pill sk-doc-badge"></div>
                    <div class="nosh-skeleton sk-doc-date"></div>
                </div>
            </div>
            <div class="sk-doc-paragraphs">
                <div class="nosh-skeleton sk-doc-line" style="width: 96%;"></div>
                <div class="nosh-skeleton sk-doc-line" style="width: 89%;"></div>
                <div class="nosh-skeleton sk-doc-line" style="width: 94%;"></div>
                <div class="nosh-skeleton sk-doc-line" style="width: 62%;"></div>
            </div>
            <div class="sk-code-block">
                <div class="sk-code-header">
                    <div class="sk-code-dots">
                        <span class="nosh-skeleton sk-code-dot" style="background:#ef4444;"></span>
                        <span class="nosh-skeleton sk-code-dot" style="background:#f59e0b;"></span>
                        <span class="nosh-skeleton sk-code-dot" style="background:#10b981;"></span>
                    </div>
                    <div class="sk-code-actions">
                        <div class="nosh-skeleton sk-code-badge"></div>
                        <div class="nosh-skeleton sk-code-btn"></div>
                    </div>
                </div>
                <div class="sk-code-lines">
                    <div class="nosh-skeleton sk-code-line" style="width: 42%;"></div>
                    <div class="nosh-skeleton sk-code-line" style="width: 74%; margin-left: 20px;"></div>
                    <div class="nosh-skeleton sk-code-line" style="width: 58%; margin-left: 20px;"></div>
                    <div class="nosh-skeleton sk-code-line" style="width: 82%; margin-left: 20px;"></div>
                    <div class="nosh-skeleton sk-code-line" style="width: 36%;"></div>
                </div>
            </div>
            <div class="sk-doc-paragraphs">
                <div class="nosh-skeleton sk-doc-line" style="width: 91%;"></div>
                <div class="nosh-skeleton sk-doc-line" style="width: 84%;"></div>
                <div class="nosh-skeleton sk-doc-line" style="width: 68%;"></div>
            </div>
            <div class="sk-doc-tasks">
                <div class="sk-doc-task-row">
                    <div class="nosh-skeleton sk-doc-checkbox"></div>
                    <div class="nosh-skeleton sk-doc-line" style="width: 54%;"></div>
                </div>
                <div class="sk-doc-task-row">
                    <div class="nosh-skeleton sk-doc-checkbox"></div>
                    <div class="nosh-skeleton sk-doc-line" style="width: 48%;"></div>
                </div>
            </div>
        </div>
    `;
}

function showDocumentSkeleton(titleText = '') {
    if (!content) return;
    content.setAttribute('contenteditable', 'false');
    content.innerHTML = getDocumentSkeletonHTML(titleText);
}

function getWelcomeDashboardSkeletonHTML() {
    return `
        <div class="skeleton-dashboard-view" id="dashboard-skeleton-view">
            <div class="sk-dash-hero">
                <div class="nosh-skeleton sk-dash-logo"></div>
                <div class="nosh-skeleton sk-dash-title"></div>
                <div class="nosh-skeleton sk-dash-sub"></div>
            </div>
            <div class="sk-dash-stats">
                <div class="sk-dash-stat-pill">
                    <div class="nosh-skeleton sk-dash-stat-icon"></div>
                    <div class="sk-dash-stat-info">
                        <div class="nosh-skeleton" style="width: 45px; height: 18px;"></div>
                        <div class="nosh-skeleton" style="width: 90px; height: 11px;"></div>
                    </div>
                </div>
                <div class="sk-dash-stat-pill">
                    <div class="nosh-skeleton sk-dash-stat-icon"></div>
                    <div class="sk-dash-stat-info">
                        <div class="nosh-skeleton" style="width: 45px; height: 18px;"></div>
                        <div class="nosh-skeleton" style="width: 80px; height: 11px;"></div>
                    </div>
                </div>
                <div class="sk-dash-stat-pill">
                    <div class="nosh-skeleton sk-dash-stat-icon"></div>
                    <div class="sk-dash-stat-info">
                        <div class="nosh-skeleton" style="width: 55px; height: 18px;"></div>
                        <div class="nosh-skeleton" style="width: 85px; height: 11px;"></div>
                    </div>
                </div>
            </div>
            <div class="sk-dash-lang-card">
                <div class="sk-dash-lang-head">
                    <div class="nosh-skeleton" style="width: 90px; height: 14px;"></div>
                    <div class="nosh-skeleton" style="width: 140px; height: 11px;"></div>
                </div>
                <div class="nosh-skeleton sk-dash-lang-bar"></div>
                <div class="sk-dash-lang-chips">
                    <div class="nosh-skeleton sk-dash-lang-chip"></div>
                    <div class="nosh-skeleton sk-dash-lang-chip"></div>
                    <div class="nosh-skeleton sk-dash-lang-chip"></div>
                    <div class="nosh-skeleton sk-dash-lang-chip"></div>
                </div>
            </div>
            <div class="sk-dash-quick-cards">
                <div class="sk-dash-quick-card">
                    <div class="nosh-skeleton sk-dash-card-icon"></div>
                    <div class="nosh-skeleton" style="width: 80px; height: 15px;"></div>
                    <div class="nosh-skeleton" style="width: 90%; height: 11px;"></div>
                </div>
                <div class="sk-dash-quick-card">
                    <div class="nosh-skeleton sk-dash-card-icon"></div>
                    <div class="nosh-skeleton" style="width: 80px; height: 15px;"></div>
                    <div class="nosh-skeleton" style="width: 90%; height: 11px;"></div>
                </div>
                <div class="sk-dash-quick-card">
                    <div class="nosh-skeleton sk-dash-card-icon"></div>
                    <div class="nosh-skeleton" style="width: 90px; height: 15px;"></div>
                    <div class="nosh-skeleton" style="width: 90%; height: 11px;"></div>
                </div>
            </div>
            <div class="sk-dash-shortcuts-card">
                <div class="nosh-skeleton" style="width: 150px; height: 14px; margin-bottom: 4px;"></div>
                <div class="sk-dash-shortcut-row">
                    <div class="nosh-skeleton" style="width: 80px; height: 12px;"></div>
                    <div class="nosh-skeleton" style="width: 60px; height: 18px; border-radius: 4px;"></div>
                </div>
                <div class="sk-dash-shortcut-row">
                    <div class="nosh-skeleton" style="width: 85px; height: 12px;"></div>
                    <div class="nosh-skeleton" style="width: 60px; height: 18px; border-radius: 4px;"></div>
                </div>
                <div class="sk-dash-shortcut-row">
                    <div class="nosh-skeleton" style="width: 95px; height: 12px;"></div>
                    <div class="nosh-skeleton" style="width: 60px; height: 18px; border-radius: 4px;"></div>
                </div>
            </div>
        </div>
    `;
}

function showDashboardSkeleton() {
    if (!content) return;
    content.setAttribute('contenteditable', 'false');
    content.innerHTML = getWelcomeDashboardSkeletonHTML();
}

function showPublishedSkeleton(container, count = 2) {
    if (!container) return;
    let html = '<div class="skeleton-published-list">';
    for (let i = 0; i < count; i++) {
        html += `
            <div class="skeleton-published-card">
                <div class="sk-pub-top">
                    <div style="display:flex;align-items:center;gap:10px;">
                        <div class="nosh-skeleton" style="width: 140px; height: 16px;"></div>
                        <div class="nosh-skeleton nosh-skeleton-pill" style="width: 50px; height: 18px;"></div>
                        <div class="nosh-skeleton" style="width: 80px; height: 12px;"></div>
                    </div>
                </div>
                <div class="nosh-skeleton sk-pub-url"></div>
                <div class="sk-pub-actions">
                    <div class="nosh-skeleton" style="width: 70px; height: 26px; border-radius: 4px;"></div>
                    <div class="nosh-skeleton" style="width: 80px; height: 26px; border-radius: 4px;"></div>
                </div>
            </div>
        `;
    }
    html += '</div>';
    container.innerHTML = html;
}

function showDriveMissingSkeleton(container, count = 3) {
    if (!container) return;
    let html = '<div class="skeleton-drive-scan">';
    for (let i = 0; i < count; i++) {
        html += `
            <div class="skeleton-drive-item">
                <div class="sk-drive-left">
                    <div class="nosh-skeleton" style="width: 20px; height: 20px; border-radius: 4px;"></div>
                    <div class="nosh-skeleton" style="width: ${130 + (i * 35)}px; height: 13px;"></div>
                </div>
                <div class="nosh-skeleton sk-drive-btn"></div>
            </div>
        `;
    }
    html += '</div>';
    container.innerHTML = html;
}

function showTrashSkeleton(container, count = 3) {
    if (!container) return;
    let html = '<div class="skeleton-trash-list">';
    for (let i = 0; i < count; i++) {
        html += `
            <div class="skeleton-trash-card">
                <div class="sk-trash-left">
                    <div class="nosh-skeleton" style="width: 18px; height: 18px; border-radius: 4px;"></div>
                    <div style="display:flex;flex-direction:column;gap:5px;">
                        <div class="nosh-skeleton" style="width: ${120 + (i * 25)}px; height: 14px;"></div>
                        <div class="nosh-skeleton" style="width: 80px; height: 10px;"></div>
                    </div>
                </div>
                <div class="sk-trash-actions">
                    <div class="nosh-skeleton" style="width: 65px; height: 26px; border-radius: 4px;"></div>
                    <div class="nosh-skeleton" style="width: 26px; height: 26px; border-radius: 4px;"></div>
                </div>
            </div>
        `;
    }
    html += '</div>';
    container.innerHTML = html;
}

function showThemesSkeleton(container, count = 16) {
    if (!container) return;
    let html = '<div class="skeleton-themes-grid">';
    for (let i = 0; i < count; i++) {
        html += '<div class="nosh-skeleton skeleton-theme-btn"></div>';
    }
    html += '</div>';
    container.innerHTML = html;
}

function showGraphSkeleton() {
    let overlay = document.getElementById('graph-skeleton-overlay');
    if (!overlay) {
        const wrap = document.querySelector('.graph-canvas-wrap');
        if (!wrap) return;
        overlay = document.createElement('div');
        overlay.id = 'graph-skeleton-overlay';
        overlay.className = 'graph-skeleton-overlay';
        overlay.innerHTML = `
            <div class="graph-radar-spinner">
                <div class="graph-radar-scanner"></div>
                <iconify-icon icon="solar:pie-chart-2-linear" style="font-size: 26px; color: var(--accent); opacity: 0.8;"></iconify-icon>
            </div>
            <div style="display:flex;flex-direction:column;align-items:center;gap:6px;">
                <span style="font-size: 13.5px; font-weight: 600; color: #fff;">Mapping Knowledge Graph</span>
                <span style="font-size: 11.5px; color: var(--text-muted);">Analyzing backlinks and cross-references...</span>
            </div>
        `;
        wrap.appendChild(overlay);
    }
    overlay.classList.remove('hidden');
}

function hideGraphSkeleton() {
    const overlay = document.getElementById('graph-skeleton-overlay');
    if (overlay) {
        overlay.classList.add('hidden');
    }
}

function showYouTubeSkeleton() {
    let frame = document.getElementById('youtube-skeleton-frame');
    if (!frame) {
        const wrapper = document.getElementById('youtube-frame-wrapper');
        if (!wrapper) return;
        frame = document.createElement('div');
        frame.id = 'youtube-skeleton-frame';
        frame.className = 'youtube-skeleton-frame';
        frame.innerHTML = `
            <div class="sk-waveform-wrap">
                <div class="sk-waveform-bar"></div>
                <div class="sk-waveform-bar"></div>
                <div class="sk-waveform-bar"></div>
                <div class="sk-waveform-bar"></div>
                <div class="sk-waveform-bar"></div>
            </div>
            <div class="nosh-skeleton" style="width: 140px; height: 11px; border-radius: 4px;"></div>
        `;
        wrapper.appendChild(frame);
    }
    frame.classList.remove('hidden');
}

function hideYouTubeSkeleton() {
    const frame = document.getElementById('youtube-skeleton-frame');
    if (frame) {
        frame.classList.add('hidden');
    }
}

window.showSidebarSkeleton = showSidebarSkeleton;
window.hideSidebarSkeleton = hideSidebarSkeleton;
window.getSidebarSkeletonHTML = getSidebarSkeletonHTML;
window.showDocumentSkeleton = showDocumentSkeleton;
window.getDocumentSkeletonHTML = getDocumentSkeletonHTML;
window.showDashboardSkeleton = showDashboardSkeleton;
window.getWelcomeDashboardSkeletonHTML = getWelcomeDashboardSkeletonHTML;
window.showPublishedSkeleton = showPublishedSkeleton;
window.showDriveMissingSkeleton = showDriveMissingSkeleton;
window.showTrashSkeleton = showTrashSkeleton;
window.showThemesSkeleton = showThemesSkeleton;
window.showGraphSkeleton = showGraphSkeleton;
window.hideGraphSkeleton = hideGraphSkeleton;
window.showYouTubeSkeleton = showYouTubeSkeleton;
window.hideYouTubeSkeleton = hideYouTubeSkeleton;


