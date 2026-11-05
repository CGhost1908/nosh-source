// Command Palette & Quick Note Switcher (Ctrl+P / Ctrl+K)

const commandPaletteActions = [
    { id: 'new-note', title: 'New Note', category: 'Action', icon: 'solar:pen-new-square-linear', action: () => createNewFile() },
    { id: 'new-folder', title: 'New Folder', category: 'Action', icon: 'solar:folder-add-linear', action: () => openCreateFolderModal() },
    { id: 'new-template', title: 'New Note from Template...', category: 'Action', icon: 'solar:layers-minimalistic-linear', action: () => openTemplateModal() },
    { id: 'quick-capture', title: 'Quick Capture to Inbox (Ctrl+Alt+N)', category: 'Action', icon: 'solar:bolt-linear', action: () => ipcRenderer.send('quick-capture-open') },
    { id: 'save-note', title: 'Save Note', category: 'Action', icon: 'solar:diskette-linear', action: () => saveFile() },
    { id: 'note-history', title: 'Version History of This Note', category: 'Action', icon: 'solar:history-linear', action: () => openNoteHistory() },
    { id: 'export-md', title: 'Export as Markdown (.md)', category: 'Export', icon: 'solar:document-add-linear', action: () => exportToMarkdown() },
    { id: 'copy-md', title: 'Copy Note as Markdown', category: 'Action', icon: 'solar:copy-linear', action: () => copyAsMarkdown() },
    { id: 'export-pdf', title: 'Export as PDF', category: 'Export', icon: 'solar:file-text-linear', action: () => exportToPdf() },
    { id: 'insert-code', title: 'Insert Code Block', category: 'Insert', icon: 'solar:code-square-linear', action: () => {
        if (typeof activeNoteName === 'undefined' || !activeNoteName) {
            if (typeof showToast === 'function') showToast('Create or open a note first', 'warning');
            return;
        }
        if (typeof openLanguageModal === 'function') {
            openLanguageModal();
        } else if (typeof insertCodeBlockFromSelection === 'function') {
            insertCodeBlockFromSelection();
        }
    } },
    { id: 'insert-checklist', title: 'Insert Checklist / Task List', category: 'Insert', icon: 'solar:checklist-minimalistic-linear', action: () => insertChecklist() },
    { id: 'insert-link', title: 'Insert Link / Note Reference', category: 'Insert', icon: 'solar:link-linear', action: () => openLinkModal() },
    { id: 'insert-wiki-link', title: 'Link to Note ([[Note Title]])', category: 'Insert', icon: 'solar:document-add-linear', action: () => openInternalLinkModal() },
    { id: 'insert-image', title: 'Insert Image', category: 'Insert', icon: 'solar:gallery-linear', action: () => openMediaModal('image') },
    { id: 'insert-video', title: 'Insert Video', category: 'Insert', icon: 'solar:videocamera-linear', action: () => openMediaModal('video') },
    { id: 'find-replace', title: 'Find & Replace in Document', category: 'Edit', icon: 'solar:magnifer-linear', action: () => {
        if (typeof activeNoteName === 'undefined' || !activeNoteName) {
            if (typeof showToast === 'function') showToast('Create or open a note first', 'warning');
            return;
        }
        openDocFindBar();
        toggleReplaceRow(true);
    } },
    { id: 'knowledge-graph', title: 'Open Knowledge Graph View (Ctrl+G)', category: 'View', icon: 'solar:pie-chart-2-linear', action: () => openKnowledgeGraph() },
    { id: 'document-outline', title: 'Toggle Document Outline (Ctrl+Shift+O)', category: 'View', icon: 'solar:list-linear', action: () => toggleDocumentOutline() },
    { id: 'focus-mode', title: 'Toggle Focus / Zen Mode (Ctrl+Shift+F)', category: 'View', icon: 'solar:minimize-square-linear', action: () => toggleZenMode() },
    { id: 'toggle-sidebar', title: 'Toggle Sidebar (Ctrl+\\)', category: 'View', icon: 'solar:sidebar-minimalistic-linear', action: () => toggleSidebar() },
    { id: 'open-settings', title: 'Open Preferences', category: 'Preferences', icon: 'solar:tuning-2-linear', action: () => openSettingsModal() },
    { id: 'open-trash', title: 'Open Trash & Recycle Bin', category: 'Preferences', icon: 'solar:trash-bin-trash-linear', action: () => { openSettingsModal(); switchSettingsTab('trash'); } },
    { id: 'theme-obsidian', title: 'Switch Theme: Obsidian Dark', category: 'Theme', icon: 'solar:moon-linear', action: () => selectAppTheme('dark') },
    { id: 'theme-oled', title: 'Switch Theme: OLED Pure Black', category: 'Theme', icon: 'solar:sun-2-linear', action: () => selectAppTheme('oled') },
    { id: 'theme-nord', title: 'Switch Theme: Nord Slate', category: 'Theme', icon: 'solar:snowflake-linear', action: () => selectAppTheme('nord') },
    { id: 'theme-tokyo', title: 'Switch Theme: Tokyo Night', category: 'Theme', icon: 'solar:stars-minimalistic-linear', action: () => selectAppTheme('tokyo') }
];

let paletteCurrentItems = [];
let paletteSelectedIndex = 0;
let paletteMode = 'all'; // 'all' | 'notes' | 'commands'

function openCommandPalette(mode = 'all') {
    paletteMode = mode;
    const input = document.getElementById('palette-input');
    if (input) {
        input.value = '';
        input.placeholder = mode === 'notes' ? 'Quick jump to note...' : (mode === 'commands' ? 'Type a command...' : 'Type a command or search notes...');
    }

    renderPaletteItems('');
    openModal('command-palette-modal');

    setTimeout(() => {
        if (input) {
            input.focus();
            input.select();
        }
    }, 60);
}

function showPaletteSkeleton(count = 5) {
    const resultsContainer = document.getElementById('palette-results');
    if (!resultsContainer) return;
    let html = '';
    for (let i = 0; i < count; i++) {
        html += `
            <div class="skeleton-palette-item">
                <div class="sk-palette-left">
                    <div class="nosh-skeleton nosh-skeleton-circle" style="width: 18px; height: 18px;"></div>
                    <div class="nosh-skeleton" style="width: ${110 + (i * 24)}px; height: 13px;"></div>
                </div>
                <div class="nosh-skeleton nosh-skeleton-pill" style="width: 48px; height: 18px;"></div>
            </div>
        `;
    }
    resultsContainer.innerHTML = html;
}

function renderPaletteItems(query = '') {
    const resultsContainer = document.getElementById('palette-results');
    if (!resultsContainer) return;
    resultsContainer.innerHTML = '';

    const q = query.toLowerCase().trim();
    paletteCurrentItems = [];

    // 1. Gather all notes from sidebar
    const noteElements = document.querySelectorAll('#saves-container .save');
    const noteItems = [];
    noteElements.forEach(el => {
        const name = el.getAttribute('data-file');
        if (name && (paletteMode !== 'commands')) {
            if (!q || name.toLowerCase().includes(q)) {
                noteItems.push({
                    id: `note-${name}`,
                    title: name,
                    category: el.classList.contains('pinned') ? 'Pinned' : 'Note',
                    icon: el.classList.contains('pinned') ? 'solar:pin-bold' : 'solar:document-text-linear',
                    action: () => openDesiredFile(name)
                });
            }
        }
    });

    // 2. Filter commands
    const commandItems = [];
    if (paletteMode !== 'notes') {
        commandPaletteActions.forEach(cmd => {
            if (!q || cmd.title.toLowerCase().includes(q) || cmd.category.toLowerCase().includes(q)) {
                commandItems.push(cmd);
            }
        });
    }

    if (paletteMode === 'notes') {
        paletteCurrentItems = [...noteItems, ...commandItems];
    } else {
        paletteCurrentItems = [...commandItems, ...noteItems];
    }

    if (paletteCurrentItems.length === 0) {
        resultsContainer.innerHTML = `<div class="palette-empty">No matching notes or commands found for "${escapeHtml(query)}"</div>`;
        return;
    }

    paletteSelectedIndex = 0;

    paletteCurrentItems.forEach((item, index) => {
        const itemEl = document.createElement('div');
        itemEl.className = `palette-item${index === 0 ? ' active' : ''}`;
        itemEl.innerHTML = `
            <div class="palette-item-left">
                <iconify-icon class="palette-item-icon" icon="${item.icon}"></iconify-icon>
                <span class="palette-item-title">${escapeHtml(item.title)}</span>
            </div>
            <span class="palette-item-badge">${item.category}</span>
        `;

        itemEl.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            closeModal('command-palette-modal');
            setTimeout(() => {
                try {
                    item.action();
                } catch (err) {
                    console.error('Palette item action error:', err);
                }
            }, 30);
        });

        itemEl.addEventListener('mouseenter', () => {
            setPaletteActiveIndex(index);
        });

        resultsContainer.appendChild(itemEl);
    });
}

function setPaletteActiveIndex(index) {
    const items = document.querySelectorAll('#palette-results .palette-item');
    if (items.length === 0) return;

    items.forEach((el, idx) => {
        el.classList.toggle('active', idx === index);
    });
    paletteSelectedIndex = index;

    if (items[index]) {
        items[index].scrollIntoView({ block: 'nearest' });
    }
}

// Bind Palette keyboard input
document.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('palette-input');
    if (input) {
        input.addEventListener('input', (e) => {
            renderPaletteItems(e.target.value);
        });

        input.addEventListener('keydown', (e) => {
            const items = document.querySelectorAll('#palette-results .palette-item');
            if (items.length === 0) return;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                const nextIndex = (paletteSelectedIndex + 1) % items.length;
                setPaletteActiveIndex(nextIndex);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                const prevIndex = (paletteSelectedIndex - 1 + items.length) % items.length;
                setPaletteActiveIndex(prevIndex);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (paletteCurrentItems[paletteSelectedIndex]) {
                    const selectedItem = paletteCurrentItems[paletteSelectedIndex];
                    closeModal('command-palette-modal');
                    setTimeout(() => {
                        try {
                            selectedItem.action();
                        } catch (err) {
                            console.error('Palette enter action error:', err);
                        }
                    }, 30);
                }
            } else if (e.key === 'Escape') {
                e.preventDefault();
                closeAllModals();
            }
        });
    }
});
