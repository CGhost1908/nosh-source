// Custom Context Menu System (Sidebar Notes, Folders & Workspace)
// =========================================================================

const contextMenu = document.getElementById('context-menu');
const sidebarContextMenu = document.getElementById('sidebar-context-menu');
const folderContextMenu = document.getElementById('folder-context-menu');

let contextTargetNote = null;
let contextTargetFolderId = null;

function hideAllContextMenus() {
    if (contextMenu) contextMenu.style.display = 'none';
    if (sidebarContextMenu) sidebarContextMenu.style.display = 'none';
    if (folderContextMenu) folderContextMenu.style.display = 'none';
}

function positionContextMenu(menuEl, pageX, pageY, minWidth = 180, minHeight = 170) {
    if (!menuEl) return;
    menuEl.style.display = 'block';

    let left = pageX;
    let top = pageY;

    if (left + minWidth > window.innerWidth) {
        left = window.innerWidth - minWidth - 10;
    }
    if (top + minHeight > window.innerHeight) {
        top = window.innerHeight - minHeight - 10;
    }

    menuEl.style.left = `${Math.max(10, left)}px`;
    menuEl.style.top = `${Math.max(10, top)}px`;
}

// Right click routing
document.addEventListener('contextmenu', (e) => {
    // 1. Check if clicking inside editor or input
    if (e.target.closest('#content, .CodeMirror, input, textarea')) {
        hideAllContextMenus();
        return;
    }

    const saveItem = e.target.closest('.save');
    const folderEl = e.target.closest('.sidebar-folder');
    const sidebar = e.target.closest('.left-side, #saves-container');

    // Case A: Right clicked on a Note
    if (saveItem) {
        e.preventDefault();
        hideAllContextMenus();
        contextTargetNote = saveItem.getAttribute('data-file');

        if (contextMenu) {
            // Update Pin / Unpin label and icon
            const ctxPinText = document.getElementById('ctx-pin-text');
            const ctxPin = document.getElementById('ctx-pin');
            if (ctxPinText && ctxPin && typeof isNotePinned === 'function') {
                const isPinned = isNotePinned(contextTargetNote);
                ctxPinText.textContent = isPinned ? 'Unpin Note' : 'Pin Note';
                const pinIcon = ctxPin.querySelector('iconify-icon');
                if (pinIcon) {
                    pinIcon.setAttribute('icon', isPinned ? 'solar:pin-bold' : 'solar:pin-linear');
                }
            }

            // Check if note is currently inside a folder
            const ctxRemoveFolder = document.getElementById('ctx-remove-folder');
            if (ctxRemoveFolder && typeof getNoteFolder === 'function') {
                const currentFolder = getNoteFolder(contextTargetNote);
                ctxRemoveFolder.style.display = currentFolder ? 'flex' : 'none';
            }

            positionContextMenu(contextMenu, e.pageX, e.pageY, 185, 210);
        }
        return;
    }

    // Case B: Right clicked on a Folder (header or folder container)
    if (folderEl) {
        e.preventDefault();
        hideAllContextMenus();
        contextTargetFolderId = folderEl.getAttribute('data-folder-id');

        if (folderContextMenu && contextTargetFolderId) {
            positionContextMenu(folderContextMenu, e.pageX, e.pageY, 190, 140);
        }
        return;
    }

    // Case C: Right clicked on Sidebar empty space
    if (sidebar) {
        e.preventDefault();
        hideAllContextMenus();
        if (sidebarContextMenu) {
            positionContextMenu(sidebarContextMenu, e.pageX, e.pageY, 180, 130);
        }
        return;
    }

    hideAllContextMenus();
});

// Dismiss context menus on click or Escape
document.addEventListener('click', (e) => {
    if (!e.target.closest('#context-menu, #sidebar-context-menu, #folder-context-menu')) {
        hideAllContextMenus();
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        hideAllContextMenus();
    }
});

// Exposed helper for opening folder context menu from dots button
function openFolderContextMenu(e, folderId) {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
    hideAllContextMenus();
    contextTargetFolderId = folderId;

    if (folderContextMenu) {
        const x = e ? e.pageX : 100;
        const y = e ? e.pageY : 100;
        positionContextMenu(folderContextMenu, x, y, 190, 140);
    }
}
window.openFolderContextMenu = openFolderContextMenu;

// =========================================================================
// Note Context Menu Options Bindings
// =========================================================================
const ctxPin = document.getElementById('ctx-pin');
if (ctxPin) {
    ctxPin.addEventListener('click', () => {
        hideAllContextMenus();
        if (contextTargetNote && typeof togglePinNote === 'function') {
            togglePinNote(contextTargetNote);
        }
    });
}

const ctxMoveFolder = document.getElementById('ctx-move-folder');
if (ctxMoveFolder) {
    ctxMoveFolder.addEventListener('click', () => {
        hideAllContextMenus();
        if (contextTargetNote && typeof openMoveToFolderModal === 'function') {
            openMoveToFolderModal(contextTargetNote);
        }
    });
}

const ctxRemoveFolder = document.getElementById('ctx-remove-folder');
if (ctxRemoveFolder) {
    ctxRemoveFolder.addEventListener('click', async () => {
        hideAllContextMenus();
        if (contextTargetNote && typeof moveNoteToFolder === 'function') {
            await moveNoteToFolder(contextTargetNote, null);
            showToast(`Removed "${contextTargetNote}" from folder`, 'info');
        }
    });
}

const ctxRename = document.getElementById('ctx-rename');
if (ctxRename) {
    ctxRename.addEventListener('click', () => {
        hideAllContextMenus();
        if (contextTargetNote) {
            openRenameModal(contextTargetNote);
        }
    });
}

const ctxOpenDir = document.getElementById('ctx-open-dir');
if (ctxOpenDir) {
    ctxOpenDir.addEventListener('click', () => {
        hideAllContextMenus();
        openNotesFolder();
    });
}

const ctxDuplicate = document.getElementById('ctx-duplicate');
if (ctxDuplicate) {
    ctxDuplicate.addEventListener('click', () => {
        hideAllContextMenus();
        if (contextTargetNote) {
            duplicateSave(contextTargetNote);
        }
    });
}

const ctxDelete = document.getElementById('ctx-delete');
if (ctxDelete) {
    ctxDelete.addEventListener('click', () => {
        hideAllContextMenus();
        if (contextTargetNote) {
            openDeleteModal(contextTargetNote);
        }
    });
}

// =========================================================================
// Folder Context Menu Options Bindings
// =========================================================================
const folderCtxNewNote = document.getElementById('folder-ctx-new-note');
if (folderCtxNewNote) {
    folderCtxNewNote.addEventListener('click', () => {
        hideAllContextMenus();
        if (contextTargetFolderId && typeof createNoteInFolder === 'function') {
            createNoteInFolder(contextTargetFolderId);
        }
    });
}

const folderCtxRename = document.getElementById('folder-ctx-rename');
if (folderCtxRename) {
    folderCtxRename.addEventListener('click', () => {
        hideAllContextMenus();
        if (contextTargetFolderId && typeof openRenameFolderModal === 'function') {
            openRenameFolderModal(contextTargetFolderId);
        }
    });
}

const folderCtxDelete = document.getElementById('folder-ctx-delete');
if (folderCtxDelete) {
    folderCtxDelete.addEventListener('click', () => {
        hideAllContextMenus();
        if (contextTargetFolderId) {
            if (typeof openDeleteFolderModal === 'function') {
                openDeleteFolderModal(contextTargetFolderId);
            } else if (typeof deleteVaultFolder === 'function') {
                deleteVaultFolder(contextTargetFolderId);
            }
        }
    });
}

// In-App Rename Note Modal
function openRenameModal(noteName) {
    if (!noteName) return;
    contextTargetNote = noteName;
    const input = document.getElementById('rename-note-input');
    if (input) {
        input.value = noteName;
    }
    openModal('rename-modal');
    setTimeout(() => {
        if (input) {
            input.focus();
            input.select();
        }
    }, 60);
}

async function confirmRenameNote() {
    const input = document.getElementById('rename-note-input');
    const newName = input ? input.value.trim() : '';
    if (newName && newName !== contextTargetNote) {
        await renameSave(contextTargetNote, newName);
    }
    closeAllModals();
}

window.openRenameModal = openRenameModal;
window.confirmRenameNote = confirmRenameNote;

const renameInput = document.getElementById('rename-note-input');
if (renameInput) {
    renameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            confirmRenameNote();
        } else if (e.key === 'Escape') {
            closeAllModals();
        }
    });
}
