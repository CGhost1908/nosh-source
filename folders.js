// Vault Folders Management & Sidebar Hierarchical Tree (Drag-and-Drop & Context Menus)
// =========================================================================================

let vaultFolders = [];
let pendingFolderActionId = null;
let pendingNoteMoveName = null;

// File path for persistent folder configuration inside vault
function getFoldersConfigPath() {
    if (typeof savesDir !== 'undefined' && savesDir) {
        return path.join(savesDir, '.folders.json');
    }
    return null;
}

// Load folders from .folders.json or localStorage, and auto-detect physical subdirectories
async function loadVaultFolders(availableFiles = []) {
    const configPath = getFoldersConfigPath();
    let loaded = null;

    if (configPath && fs.existsSync(configPath)) {
        try {
            const raw = await fsPromises.readFile(configPath, 'utf8');
            const data = JSON.parse(raw);
            if (data && Array.isArray(data.folders)) {
                loaded = data.folders;
            }
        } catch (e) {
            console.warn('Could not read .folders.json, falling back to localStorage:', e);
        }
    }

    if (!loaded) {
        try {
            const localRaw = localStorage.getItem('nosh-folders');
            if (localRaw) {
                loaded = JSON.parse(localRaw);
            }
        } catch (e) {
            loaded = [];
        }
    }

    if (!Array.isArray(loaded)) {
        loaded = [];
    }

    // Auto-discover physical subdirectories in savesDir if any (only if directory contains .nsh files)
    if (typeof savesDir !== 'undefined' && savesDir && fs.existsSync(savesDir)) {
        try {
            const dirents = await fsPromises.readdir(savesDir, { withFileTypes: true });
            const ignoredDirs = new Set(['.trash', '.history', 'assets', '.git', 'node_modules', '.temp']);

            for (const dirent of dirents) {
                if (dirent.isDirectory() && !ignoredDirs.has(dirent.name)) {
                    const existing = loaded.find(f => f.name.toLowerCase() === dirent.name.toLowerCase());
                    if (!existing) {
                        try {
                            const subPath = path.join(savesDir, dirent.name);
                            const subFiles = await fsPromises.readdir(subPath);
                            const nshFiles = subFiles.filter(f => f.endsWith('.nsh'));
                            if (nshFiles.length > 0) {
                                loaded.push({
                                    id: `folder_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                                    name: dirent.name,
                                    collapsed: false,
                                    notes: nshFiles.map(f => f.replace(/\.nsh$/, ''))
                                });
                            }
                        } catch (e) {}
                    }
                }
            }
        } catch (e) {
            console.warn('Error auto-discovering vault subdirectories:', e);
        }
    }

    // Sanitize folders: normalize structure & filter out note names that don't exist
    const availableSet = availableFiles.length > 0 ? new Set(availableFiles) : null;
    vaultFolders = loaded.map(f => {
        let validNotes = Array.isArray(f.notes) ? f.notes : [];
        if (availableSet) {
            validNotes = validNotes.filter(n => availableSet.has(n));
        }
        return {
            id: String(f.id || `folder_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`),
            name: String(f.name || 'Untitled Folder').trim(),
            collapsed: !!f.collapsed,
            notes: validNotes
        };
    });

    return vaultFolders;
}

// Persist folders to disk and localStorage
async function saveVaultFolders(foldersToSave = null) {
    if (foldersToSave) {
        vaultFolders = foldersToSave;
    }

    try {
        localStorage.setItem('nosh-folders', JSON.stringify(vaultFolders));
    } catch (e) {}

    const configPath = getFoldersConfigPath();
    if (configPath && typeof fsPromises !== 'undefined') {
        try {
            await fsPromises.writeFile(configPath, JSON.stringify({ folders: vaultFolders }, null, 2), 'utf8');
        } catch (e) {
            console.error('Failed to save .folders.json to disk:', e);
        }
    }
}

function getVaultFolders() {
    return vaultFolders;
}

function getVaultFolderById(id) {
    return vaultFolders.find(f => f.id === id) || null;
}

function getNoteFolder(noteName) {
    if (!noteName) return null;
    return vaultFolders.find(f => f.notes.includes(noteName)) || null;
}

// Create a new folder
async function createVaultFolder(folderName, initialNotes = []) {
    const trimmed = (folderName || '').trim();
    if (!trimmed) {
        showToast('Folder name cannot be empty', 'warning');
        return null;
    }

    if (vaultFolders.some(f => f.name.toLowerCase() === trimmed.toLowerCase())) {
        showToast(`Folder "${trimmed}" already exists`, 'warning');
        return null;
    }

    // Clean up initialNotes from any existing folders if moving
    if (Array.isArray(initialNotes) && initialNotes.length > 0) {
        vaultFolders.forEach(f => {
            f.notes = f.notes.filter(n => !initialNotes.includes(n));
        });
    }

    // Create physical directory in savesDir if possible
    if (typeof savesDir !== 'undefined' && savesDir) {
        try {
            const diskFolder = path.join(savesDir, trimmed);
            if (!fs.existsSync(diskFolder)) {
                await fsPromises.mkdir(diskFolder, { recursive: true });
            }
        } catch (e) {}
    }

    const newFolder = {
        id: `folder_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
        name: trimmed,
        collapsed: false,
        notes: Array.isArray(initialNotes) ? initialNotes : []
    };

    vaultFolders.push(newFolder);
    await saveVaultFolders();
    showToast(`Created folder "${trimmed}"`, 'success');
    await readDatabase(activeNoteName);
    return newFolder;
}

// Rename a folder
async function renameVaultFolder(folderId, newName) {
    const trimmed = (newName || '').trim();
    if (!trimmed) {
        showToast('Folder name cannot be empty', 'warning');
        return false;
    }

    const folder = getVaultFolderById(folderId);
    if (!folder) return false;

    if (vaultFolders.some(f => f.id !== folderId && f.name.toLowerCase() === trimmed.toLowerCase())) {
        showToast(`A folder named "${trimmed}" already exists`, 'warning');
        return false;
    }

    const oldName = folder.name;
    folder.name = trimmed;

    // Rename disk directory if present and empty
    if (typeof savesDir !== 'undefined' && savesDir) {
        try {
            const oldPath = path.join(savesDir, oldName);
            const newPath = path.join(savesDir, trimmed);
            if (fs.existsSync(oldPath) && !fs.existsSync(newPath)) {
                await fsPromises.rename(oldPath, newPath);
            }
        } catch (e) {}
    }

    await saveVaultFolders();
    showToast(`Renamed folder to "${trimmed}"`, 'success');
    await readDatabase(activeNoteName);
    return true;
}

// Delete a folder (notes are kept safe and moved back to root notes)
async function deleteVaultFolder(folderId) {
    const folder = getVaultFolderById(folderId);
    if (!folder) return false;

    const folderName = folder.name;
    const notesCount = folder.notes ? folder.notes.length : 0;
    vaultFolders = vaultFolders.filter(f => f.id !== folderId);

    // Delete physical folder on disk if it exists
    if (typeof savesDir !== 'undefined' && savesDir) {
        try {
            const diskFolder = path.join(savesDir, folderName);
            if (fs.existsSync(diskFolder)) {
                await fsPromises.rm(diskFolder, { recursive: true, force: true });
            }
        } catch (e) {
            console.warn('Could not remove disk folder:', e);
        }
    }

    await saveVaultFolders();
    showToast(`Deleted folder "${folderName}" (${notesCount} notes kept in General Notes)`, 'info');
    await readDatabase(activeNoteName);
    return true;
}

// Move note into folder (or out to root if targetFolderId is null/undefined)
async function moveNoteToFolder(noteName, targetFolderId = null) {
    if (!noteName) return;

    // 1. Remove from any folder where it currently belongs
    vaultFolders.forEach(f => {
        f.notes = f.notes.filter(n => n !== noteName);
    });

    // 2. Add to target folder if specified
    if (targetFolderId) {
        const target = getVaultFolderById(targetFolderId);
        if (target) {
            target.notes.push(noteName);
            target.collapsed = false; // Expand folder so user sees the dropped note
        }
    }

    await saveVaultFolders();
    await readDatabase(activeNoteName);
}

// Note rename lifecycle sync
async function updateNoteNameInFolders(oldName, newName) {
    let changed = false;
    vaultFolders.forEach(f => {
        const idx = f.notes.indexOf(oldName);
        if (idx !== -1) {
            f.notes[idx] = newName;
            changed = true;
        }
    });
    if (changed) {
        await saveVaultFolders();
    }
}

// Note delete lifecycle sync
async function removeNoteFromFolders(noteName) {
    let changed = false;
    vaultFolders.forEach(f => {
        if (f.notes.includes(noteName)) {
            f.notes = f.notes.filter(n => n !== noteName);
            changed = true;
        }
    });
    if (changed) {
        await saveVaultFolders();
    }
}

// Note duplicate lifecycle sync
async function duplicateNoteInFolders(sourceName, dupName) {
    const folder = getNoteFolder(sourceName);
    if (folder) {
        folder.notes.push(dupName);
        await saveVaultFolders();
    }
}

// Toggle folder expand / collapse
async function toggleFolderCollapse(folderId, evt = null) {
    if (evt) {
        evt.stopPropagation();
    }
    const folder = getVaultFolderById(folderId);
    if (!folder) return;

    folder.collapsed = !folder.collapsed;
    const folderEl = document.querySelector(`.sidebar-folder[data-folder-id="${folderId}"]`);
    if (folderEl) {
        folderEl.classList.toggle('collapsed', folder.collapsed);
        const icon = folderEl.querySelector('.folder-icon');
        if (icon) {
            icon.setAttribute('icon', folder.collapsed ? 'solar:folder-linear' : 'solar:folder-open-linear');
        }
    }

    await saveVaultFolders();
}

// Create a new note directly inside a specific folder
async function createNoteInFolder(folderId) {
    const folder = getVaultFolderById(folderId);
    if (!folder) return;

    await createNewFile();
    if (typeof activeNoteName !== 'undefined' && activeNoteName) {
        await moveNoteToFolder(activeNoteName, folderId);
        showToast(`Created note in "${folder.name}"`, 'success');
    }
}

// =========================================================================
// Main Sidebar Hierarchy Renderer (Folders + Pinned + Root Notes)
// =========================================================================
async function renderSidebarWithFolders(fileStats) {
    const savesContainer = document.getElementById('saves-container');
    if (!savesContainer) return;

    const allFileNames = fileStats.map(f => f.fileName);
    await loadVaultFolders(allFileNames);

    savesContainer.innerHTML = '';

    const pinnedNotes = typeof getPinnedNotes === 'function' ? getPinnedNotes() : [];
    const statsMap = new Map();
    fileStats.forEach(item => statsMap.set(item.fileName, item.mtimeMs));

    // Group notes: Folder Notes vs Root Notes
    const noteToFolderMap = new Map();
    vaultFolders.forEach(folder => {
        folder.notes.forEach(noteName => {
            if (statsMap.has(noteName)) {
                noteToFolderMap.set(noteName, folder.id);
            }
        });
    });

    const rootNotes = fileStats.filter(item => !noteToFolderMap.has(item.fileName));

    // Sort helper: Pinned notes on top, then newest mtime
    function sortNoteItems(items) {
        return items.slice().sort((a, b) => {
            const aPinned = pinnedNotes.includes(a.fileName);
            const bPinned = pinnedNotes.includes(b.fileName);
            if (aPinned && !bPinned) return -1;
            if (!aPinned && bPinned) return 1;
            if (aPinned && bPinned) {
                return pinnedNotes.indexOf(a.fileName) - pinnedNotes.indexOf(b.fileName);
            }
            return (b.mtimeMs || 0) - (a.mtimeMs || 0);
        });
    }

    let globalNoteIndex = 0;

    // 1. Render Pinned Notes Section (if any pinned notes exist)
    const allPinnedItems = fileStats.filter(item => pinnedNotes.includes(item.fileName));
    if (allPinnedItems.length > 0) {
        const pinnedSection = document.createElement('div');
        pinnedSection.className = 'sidebar-section sidebar-pinned-section';
        pinnedSection.innerHTML = `
            <div class="sidebar-section-header">
                <iconify-icon icon="solar:pin-bold" style="font-size: 13px; color: var(--accent);"></iconify-icon>
                <span>Pinned (${allPinnedItems.length})</span>
            </div>
            <div class="sidebar-pinned-items" id="sidebar-pinned-items"></div>
        `;
        const pinnedContainer = pinnedSection.querySelector('#sidebar-pinned-items');
        sortNoteItems(allPinnedItems).forEach(item => {
            createNoteSidebarElement(item.fileName, item.mtimeMs, globalNoteIndex++, pinnedContainer);
        });
        savesContainer.appendChild(pinnedSection);
    }

    // 2. Render Folders directly in the main list
    vaultFolders.forEach(folder => {
        const folderNotesStats = folder.notes
            .filter(name => statsMap.has(name))
            .map(name => ({ fileName: name, mtimeMs: statsMap.get(name) }));

        const folderEl = document.createElement('div');
        folderEl.className = `sidebar-folder${folder.collapsed ? ' collapsed' : ''}`;
        folderEl.setAttribute('data-folder-id', folder.id);
        folderEl.setAttribute('data-folder-name', folder.name);

        folderEl.innerHTML = `
            <div class="sidebar-folder-header" title="${escapeHtml(folder.name)}">
                <div class="folder-header-left">
                    <iconify-icon class="folder-chevron" icon="solar:alt-arrow-down-linear"></iconify-icon>
                    <iconify-icon class="folder-icon" icon="${folder.collapsed ? 'solar:folder-linear' : 'solar:folder-open-linear'}"></iconify-icon>
                    <span class="folder-name">${escapeHtml(folder.name)}</span>
                </div>
                <div class="folder-header-right">
                    <span class="folder-count-badge">${folderNotesStats.length}</span>
                </div>
            </div>
            <div class="sidebar-folder-items" id="folder-items-${folder.id}"></div>
        `;

        const folderHeader = folderEl.querySelector('.sidebar-folder-header');
        const itemsContainer = folderEl.querySelector('.sidebar-folder-items');

        // Header Click -> Toggle Collapse
        folderHeader.addEventListener('click', (e) => {
            toggleFolderCollapse(folder.id, e);
        });

        // Smooth & reliable Drag and Drop target on entire folder
        folderEl.addEventListener('dragenter', (e) => {
            e.preventDefault();
            e.stopPropagation();
            folderEl.classList.add('drag-over-folder');
            folderHeader.classList.add('drag-over');
        });

        folderEl.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.dataTransfer) {
                e.dataTransfer.dropEffect = window._draggedNoteName ? 'move' : 'copy';
            }
            folderEl.classList.add('drag-over-folder');
            folderHeader.classList.add('drag-over');
        });

        folderEl.addEventListener('dragleave', (e) => {
            e.stopPropagation();
            if (!folderEl.contains(e.relatedTarget)) {
                folderEl.classList.remove('drag-over-folder');
                folderHeader.classList.remove('drag-over');
            }
        });

        folderEl.addEventListener('drop', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            folderEl.classList.remove('drag-over-folder');
            folderHeader.classList.remove('drag-over');
            document.body.classList.remove('is-dragging-note');

            const noteName = window._draggedNoteName || (e.dataTransfer && e.dataTransfer.getData('text/nosh-note'));
            window._draggedNoteName = null;

            if (noteName) {
                const currentFolder = getNoteFolder(noteName);
                if (currentFolder && currentFolder.id === folder.id) {
                    return; // Already in this folder
                }
                await moveNoteToFolder(noteName, folder.id);
                showToast(`Moved "${noteName}" to folder "${folder.name}"`, 'success');
                return;
            }

            // External file(s) dropped directly onto a folder from OS Explorer
            if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0 && typeof window.importDroppedFilesToVault === 'function') {
                await window.importDroppedFilesToVault(e.dataTransfer.files, folder.id);
                return;
            }

            const fallbackNoteName = e.dataTransfer ? e.dataTransfer.getData('text/plain') : '';
            if (fallbackNoteName && fs.existsSync(path.join(savesDir, `${path.basename(fallbackNoteName)}.nsh`))) {
                const currentFolder = getNoteFolder(fallbackNoteName);
                if (currentFolder && currentFolder.id === folder.id) {
                    return;
                }
                await moveNoteToFolder(fallbackNoteName, folder.id);
                showToast(`Moved "${fallbackNoteName}" to folder "${folder.name}"`, 'success');
            }
        });

        // Populate notes inside folder
        sortNoteItems(folderNotesStats).forEach(item => {
            createNoteSidebarElement(item.fileName, item.mtimeMs, globalNoteIndex++, itemsContainer);
        });

        savesContainer.appendChild(folderEl);
    });

    // 3. Render Root Notes directly in the same list (no separating header)
    const sortedRootNotes = sortNoteItems(rootNotes);
    sortedRootNotes.forEach(item => {
        createNoteSidebarElement(item.fileName, item.mtimeMs, globalNoteIndex++, savesContainer);
    });

    // Setup drop listener on savesContainer to move note back to root
    if (!savesContainer._dndRootInit) {
        savesContainer._dndRootInit = true;
        savesContainer.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (window._draggedNoteName) {
                e.stopPropagation();
                if (e.dataTransfer) {
                    e.dataTransfer.dropEffect = 'move';
                }
            }
        });
        savesContainer.addEventListener('drop', async (e) => {
            // Only trigger if dropped directly on savesContainer or on a root note (not inside a .sidebar-folder)
            if (!e.target.closest('.sidebar-folder')) {
                const noteName = window._draggedNoteName || (e.dataTransfer && e.dataTransfer.getData('text/nosh-note'));
                if (noteName) {
                    e.preventDefault();
                    e.stopPropagation();
                    window._draggedNoteName = null;
                    document.body.classList.remove('is-dragging-note');
                    const currentFolder = getNoteFolder(noteName);
                    if (currentFolder) {
                        await moveNoteToFolder(noteName, null);
                        showToast(`Moved "${noteName}" to General Notes`, 'info');
                    }
                }
            }
        });
    }
}

// Open Folder Action Menu
function openFolderActionMenu(event, folderId) {
    if (typeof openFolderContextMenu === 'function') {
        openFolderContextMenu(event, folderId);
    }
}

// =========================================================================
// Modal UI Handlers: Create, Rename, Move
// =========================================================================
function openCreateFolderModal() {
    closeAllModals();
    const input = document.getElementById('create-folder-input');
    if (input) input.value = '';
    openModal('create-folder-modal');
    setTimeout(() => {
        if (input) {
            input.focus();
            input.select();
        }
    }, 60);
}

async function confirmCreateFolder() {
    const input = document.getElementById('create-folder-input');
    const name = input ? input.value.trim() : '';
    if (!name) {
        showToast('Please enter a folder name', 'warning');
        return;
    }
    const res = await createVaultFolder(name);
    if (res) {
        closeAllModals();
    }
}

function openRenameFolderModal(folderId) {
    const folder = getVaultFolderById(folderId);
    if (!folder) return;

    pendingFolderActionId = folderId;
    closeAllModals();
    const input = document.getElementById('rename-folder-input');
    if (input) input.value = folder.name;
    openModal('rename-folder-modal');
    setTimeout(() => {
        if (input) {
            input.focus();
            input.select();
        }
    }, 60);
}

async function confirmRenameFolder() {
    if (!pendingFolderActionId) return;
    const input = document.getElementById('rename-folder-input');
    const newName = input ? input.value.trim() : '';
    if (!newName) {
        showToast('Please enter a valid folder name', 'warning');
        return;
    }
    const ok = await renameVaultFolder(pendingFolderActionId, newName);
    if (ok) {
        pendingFolderActionId = null;
        closeAllModals();
    }
}

let pendingFolderDeleteId = null;

function openDeleteFolderModal(folderId) {
    const folder = getVaultFolderById(folderId);
    if (!folder) return;
    pendingFolderDeleteId = folderId;
    closeAllModals();

    const msg = document.getElementById('delete-folder-modal-msg');
    if (msg) {
        msg.textContent = `Are you sure you want to delete "${folder.name}"? All notes inside will be kept safe and moved to General Notes.`;
    }

    openModal('delete-folder-modal');
}

async function confirmDeleteFolder() {
    if (!pendingFolderDeleteId) return;
    const folderId = pendingFolderDeleteId;
    pendingFolderDeleteId = null;
    closeAllModals();
    await deleteVaultFolder(folderId);
}

function openMoveToFolderModal(noteName) {
    if (!noteName) return;
    pendingNoteMoveName = noteName;
    closeAllModals();

    const subtitle = document.getElementById('move-to-folder-subtitle');
    if (subtitle) {
        subtitle.textContent = `Moving: "${noteName}"`;
    }

    const input = document.getElementById('move-new-folder-input');
    if (input) {
        input.value = '';
        input.onkeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                confirmCreateFolderAndMove();
            }
        };
    }

    const currentFolder = getNoteFolder(noteName);
    const container = document.getElementById('move-folder-list');
    if (container) {
        let html = `
            <div class="move-folder-item ${!currentFolder ? 'selected' : ''}" onclick="confirmMoveNoteTo(null)">
                <iconify-icon icon="solar:notes-linear"></iconify-icon>
                <span class="move-folder-name">General Notes (Root)</span>
                ${!currentFolder ? '<span class="move-current-badge">Current</span>' : ''}
            </div>
        `;

        if (vaultFolders.length === 0) {
            html += `
                <div style="padding: 14px 10px; text-align: center; color: var(--text-muted); font-size: 12px;">
                    No folders created yet. Type a folder name above to create your first folder!
                </div>
            `;
        } else {
            vaultFolders.forEach(folder => {
                const isCurrent = currentFolder && currentFolder.id === folder.id;
                html += `
                    <div class="move-folder-item ${isCurrent ? 'selected' : ''}" onclick="confirmMoveNoteTo('${folder.id}')">
                        <iconify-icon icon="solar:folder-linear"></iconify-icon>
                        <span class="move-folder-name">${escapeHtml(folder.name)}</span>
                        <span class="folder-count-badge" style="margin-left: auto;">${folder.notes.length}</span>
                        ${isCurrent ? '<span class="move-current-badge">Current</span>' : ''}
                    </div>
                `;
            });
        }

        container.innerHTML = html;
    }

    openModal('move-to-folder-modal');
    setTimeout(() => {
        if (input) {
            input.focus();
            input.select();
        }
    }, 60);
}

async function confirmCreateFolderAndMove() {
    if (!pendingNoteMoveName) return;
    const input = document.getElementById('move-new-folder-input');
    const folderName = input ? input.value.trim() : '';
    if (!folderName) {
        showToast('Please enter a folder name', 'warning');
        if (input) input.focus();
        return;
    }

    const noteToMove = pendingNoteMoveName;

    // Check if folder already exists with this name
    let targetFolder = vaultFolders.find(f => f.name.toLowerCase() === folderName.toLowerCase());
    if (!targetFolder) {
        targetFolder = await createVaultFolder(folderName, [noteToMove]);
        if (!targetFolder) return;
        pendingNoteMoveName = null;
        closeAllModals();
        showToast(`Created folder "${folderName}" and moved "${noteToMove}"`, 'success');
    } else {
        await moveNoteToFolder(noteToMove, targetFolder.id);
        pendingNoteMoveName = null;
        closeAllModals();
        showToast(`Moved "${noteToMove}" to folder "${targetFolder.name}"`, 'success');
    }
}

async function confirmMoveNoteTo(folderId) {
    if (!pendingNoteMoveName) return;
    const noteName = pendingNoteMoveName;
    pendingNoteMoveName = null;
    closeAllModals();

    await moveNoteToFolder(noteName, folderId);
    if (folderId) {
        const folder = getVaultFolderById(folderId);
        showToast(`Moved "${noteName}" to folder "${folder?.name || ''}"`, 'success');
    } else {
        showToast(`Moved "${noteName}" to general notes`, 'info');
    }
}

// Window globals export
Object.defineProperty(window, 'vaultFolders', {
    get() { return vaultFolders; },
    set(v) { vaultFolders = v; },
    configurable: true
});
window.loadVaultFolders = loadVaultFolders;
window.saveVaultFolders = saveVaultFolders;
window.getVaultFolders = getVaultFolders;
window.getVaultFolderById = getVaultFolderById;
window.getNoteFolder = getNoteFolder;
window.createVaultFolder = createVaultFolder;
window.renameVaultFolder = renameVaultFolder;
window.deleteVaultFolder = deleteVaultFolder;
window.moveNoteToFolder = moveNoteToFolder;
window.updateNoteNameInFolders = updateNoteNameInFolders;
window.removeNoteFromFolders = removeNoteFromFolders;
window.duplicateNoteInFolders = duplicateNoteInFolders;
window.toggleFolderCollapse = toggleFolderCollapse;
window.createNoteInFolder = createNoteInFolder;
window.renderSidebarWithFolders = renderSidebarWithFolders;
window.openCreateFolderModal = openCreateFolderModal;
window.confirmCreateFolder = confirmCreateFolder;
window.openRenameFolderModal = openRenameFolderModal;
window.confirmRenameFolder = confirmRenameFolder;
window.openDeleteFolderModal = openDeleteFolderModal;
window.confirmDeleteFolder = confirmDeleteFolder;
window.openMoveToFolderModal = openMoveToFolderModal;
window.confirmMoveNoteTo = confirmMoveNoteTo;
window.confirmCreateFolderAndMove = confirmCreateFolderAndMove;
