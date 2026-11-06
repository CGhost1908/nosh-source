// Preferences & Settings Management

function openSettingsModal() {
    loadSettingsIntoUI();
    openModal('settings-modal');
}

function switchSettingsTab(tabName) {
    document.querySelectorAll('.settings-tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelectorAll('.settings-pane').forEach(pane => {
        pane.classList.remove('active');
    });

    const activeBtn = document.querySelector(`.settings-tab-btn[onclick*="${tabName}"]`);
    if (activeBtn) activeBtn.classList.add('active');

    const activePane = document.getElementById(`pane-${tabName}`);
    if (activePane) activePane.classList.add('active');

    if (tabName === 'code-themes' && typeof renderSettingsThemes === 'function') {
        const grid = document.getElementById('themes-grid');
        if (grid && grid.children.length === 0 && typeof showThemesSkeleton === 'function') {
            showThemesSkeleton(grid, 12);
        }
        renderSettingsThemes();
    } else if (tabName === 'published' && typeof renderPublishedFilesList === 'function') {
        const pubList = document.getElementById('published-files-list');
        if (pubList && pubList.children.length === 0 && typeof showPublishedSkeleton === 'function') {
            showPublishedSkeleton(pubList, 2);
        }
        renderPublishedFilesList();
    } else if (tabName === 'trash' && typeof renderTrashList === 'function') {
        renderTrashList();
    }
}

function loadSettingsIntoUI() {
    // 0. App Theme
    const activeAppTheme = localStorage.getItem('app-theme') || 'dark';
    document.querySelectorAll('.app-theme-card').forEach(card => {
        card.classList.toggle('active', card.getAttribute('data-app-theme') === activeAppTheme);
    });
    const currentTheme = document.body.getAttribute('data-theme') || 'dark';
    if (currentTheme !== activeAppTheme) {
        applyAppTheme(activeAppTheme);
    }

    // 1. Font size
    const fontSize = localStorage.getItem('defaultFontSize') || '15';
    const fontSizeInput = document.getElementById('setting-font-size');
    if (fontSizeInput) fontSizeInput.value = fontSize;
    if (content && content.style.fontSize !== `${fontSize}px`) {
        applyFontSize(fontSize);
    }

    // 2. Auto save (on by default)
    const autoSave = localStorage.getItem('autoSave') !== 'false';
    const autoSaveCheckbox = document.getElementById('setting-auto-save');
    if (autoSaveCheckbox) autoSaveCheckbox.checked = autoSave;

    // 3. Save path
    const savePathInput = document.getElementById('setting-save-path');
    if (savePathInput) savePathInput.value = savesDir || '';

    // 4. YouTube Companion Player view toggle
    const viewYouTube = localStorage.getItem('view-youtube-player') !== 'false';
    const youtubeCheckbox = document.getElementById('setting-view-youtube');
    if (youtubeCheckbox) youtubeCheckbox.checked = viewYouTube;

    // 5. Google Drive Auth status
    const hasDrive = (localStorage.getItem('google_drive_access_token') && localStorage.getItem('google_drive_access_token') !== 'null') ||
                     (localStorage.getItem('google_drive_refresh_token') && localStorage.getItem('google_drive_refresh_token') !== 'null');
    const driveStatusDesc = document.getElementById('drive-status-desc');
    const driveStatusPill = document.getElementById('drive-status-pill');
    const driveConnectBtn = document.getElementById('drive-connect-btn');
    const driveDisconnectBtn = document.getElementById('drive-disconnect-btn');
    const driveConnectedInfo = document.getElementById('drive-connected-info');
    const driveUserEmail = document.getElementById('drive-user-email');
    const driveImportItem = document.getElementById('drive-import-item');

    if (hasDrive) {
        let email = localStorage.getItem('google_drive_email');
        if (driveStatusPill) {
            driveStatusPill.textContent = 'Connected';
            driveStatusPill.style.background = 'rgba(16, 185, 129, 0.15)';
            driveStatusPill.style.color = '#10b981';
            driveStatusPill.style.borderColor = 'rgba(16, 185, 129, 0.3)';
        }
        if (driveStatusDesc) {
            driveStatusDesc.textContent = 'Notes automatically sync to your Google Drive folder.';
            driveStatusDesc.style.color = 'var(--text-secondary)';
        }
        if (driveConnectedInfo) {
            driveConnectedInfo.style.display = 'block';
        }
        if (driveUserEmail) {
            if (email) {
                driveUserEmail.textContent = email;
            } else {
                driveUserEmail.textContent = 'Loading account details...';
                if (typeof window.fetchDriveUserProfile === 'function') {
                    window.fetchDriveUserProfile().then(profile => {
                        if (profile && profile.email) {
                            const emailEl = document.getElementById('drive-user-email');
                            if (emailEl) emailEl.textContent = profile.email;
                        }
                    });
                }
            }
        }
        if (driveConnectBtn) driveConnectBtn.style.display = 'none';
        if (driveDisconnectBtn) driveDisconnectBtn.style.display = 'inline-flex';
        if (driveImportItem) driveImportItem.style.display = 'flex';
    } else {
        if (driveStatusPill) {
            driveStatusPill.textContent = 'Not Linked';
            driveStatusPill.style.background = 'rgba(148, 163, 184, 0.12)';
            driveStatusPill.style.color = 'var(--text-muted)';
            driveStatusPill.style.borderColor = 'rgba(148, 163, 184, 0.2)';
        }
        if (driveStatusDesc) {
            driveStatusDesc.textContent = 'Sync and back up your notes with Google Drive.';
            driveStatusDesc.style.color = 'var(--text-muted)';
        }
        if (driveConnectedInfo) {
            driveConnectedInfo.style.display = 'none';
        }
        if (driveConnectBtn) driveConnectBtn.style.display = 'inline-flex';
        if (driveDisconnectBtn) driveDisconnectBtn.style.display = 'none';
        if (driveImportItem) driveImportItem.style.display = 'none';
    }
}

function applyFontSize(size) {
    if (content) {
        content.style.fontSize = `${size}px`;
    }
}

function saveSettings() {
    // Font size
    const fontSizeInput = document.getElementById('setting-font-size');
    if (fontSizeInput) {
        const val = parseInt(fontSizeInput.value, 10);
        if (val >= 11 && val <= 32) {
            localStorage.setItem('defaultFontSize', val);
            applyFontSize(val);
        }
    }

    // Auto save
    const autoSaveCheckbox = document.getElementById('setting-auto-save');
    if (autoSaveCheckbox) {
        localStorage.setItem('autoSave', autoSaveCheckbox.checked ? 'true' : 'false');
    }

    // YouTube player view
    const youtubeCheckbox = document.getElementById('setting-view-youtube');
    if (youtubeCheckbox) {
        localStorage.setItem('view-youtube-player', youtubeCheckbox.checked ? 'true' : 'false');
        if (typeof updateYouTubeUIState === 'function') {
            updateYouTubeUIState();
        }
    }

    showToast('Preferences updated', 'success');
}

function openExternalUrl(targetUrl) {
    if (typeof ipcRenderer !== 'undefined') {
        ipcRenderer.invoke('open-external', targetUrl);
    } else {
        window.open(targetUrl, '_blank');
    }
}

// Browse and Change Saves Directory
async function browseSaveDirectory() {
    const selectedFolder = await ipcRenderer.invoke('select-folder');
    if (selectedFolder) {
        localStorage.setItem('saves-path', selectedFolder);
        savesDir = selectedFolder;
        const input = document.getElementById('setting-save-path');
        if (input) input.value = selectedFolder;
        await readDatabase();
        showToast('Notes directory changed', 'success');
    }
}

// App Theme Management
function selectAppTheme(themeName) {
    if (!themeName) return;
    localStorage.setItem('app-theme', themeName);
    applyAppTheme(themeName);
    document.querySelectorAll('.app-theme-card').forEach(card => {
        card.classList.toggle('active', card.getAttribute('data-app-theme') === themeName);
    });
    showToast(`App theme set to ${themeName}`, 'info');
}

function applyAppTheme(themeName = null) {
    const theme = themeName || localStorage.getItem('app-theme') || 'dark';
    if (theme === 'dark') {
        document.body.removeAttribute('data-theme');
    } else {
        document.body.setAttribute('data-theme', theme);
    }
}

// Reset Saves Directory to Default
async function resetSaveDirectory() {
    localStorage.removeItem('saves-path');
    await invokeSavesDir();
    const input = document.getElementById('setting-save-path');
    if (input) input.value = savesDir;
    await readDatabase();
    showToast('Reset notes directory to default', 'info');
}

// Trash & Safe Recovery UI
async function renderTrashList() {
    const listEl = document.getElementById('trash-notes-list');
    if (!listEl) return;

    if (typeof showTrashSkeleton === 'function') {
        showTrashSkeleton(listEl, 3);
    } else {
        listEl.innerHTML = '<div style="color: var(--text-muted); font-size: 13px; text-align: center; padding: 24px;">Loading trash...</div>';
    }

    const trashNotes = typeof getTrashNotes === 'function' ? await getTrashNotes() : [];
    const emptyBtn = document.getElementById('empty-trash-btn');

    if (trashNotes.length === 0) {
        listEl.innerHTML = `
            <div class="empty-trash-state">
                <iconify-icon icon="solar:trash-bin-trash-linear" style="font-size: 36px; color: var(--text-muted); margin-bottom: 8px;"></iconify-icon>
                <p style="color: var(--text-secondary); font-size: 13px; margin: 0; font-weight: 500;">Trash is empty</p>
                <p style="color: var(--text-muted); font-size: 12px; margin: 4px 0 0 0;">Deleted notes will safely appear here for recovery.</p>
            </div>
        `;
        if (emptyBtn) emptyBtn.disabled = true;
        return;
    }

    if (emptyBtn) emptyBtn.disabled = false;
    listEl.innerHTML = '';

    trashNotes.forEach(name => {
        const item = document.createElement('div');
        item.className = 'trash-item-row';
        item.innerHTML = `
            <div class="trash-item-info">
                <iconify-icon icon="solar:document-text-linear" style="font-size: 18px; color: var(--text-muted);"></iconify-icon>
                <span class="trash-item-title">${escapeHtml(name)}</span>
            </div>
            <div class="trash-item-actions">
                <button class="btn-secondary" style="padding: 4px 10px; font-size: 12px;" onclick="handleRestoreTrashNote('${escapeHtml(name)}')">
                    <iconify-icon icon="solar:restart-linear"></iconify-icon> Restore
                </button>
                <button class="btn-secondary" style="padding: 4px 10px; font-size: 12px; color: var(--danger); border-color: rgba(239, 68, 68, 0.3);" onclick="handlePermanentDeleteNote('${escapeHtml(name)}')">
                    <iconify-icon icon="solar:trash-bin-trash-linear"></iconify-icon> Delete Forever
                </button>
            </div>
        `;
        listEl.appendChild(item);
    });
}

async function handleRestoreTrashNote(noteName) {
    if (typeof restoreFromTrash === 'function') {
        await restoreFromTrash(noteName);
        renderTrashList();
    }
}

async function handlePermanentDeleteNote(noteName) {
    if (!noteName) return;
    const trashDir = path.join(savesDir, '.trash');
    const targetPath = path.join(trashDir, `${path.basename(noteName)}.nsh`);
    try {
        if (fs.existsSync(targetPath)) {
            await fsPromises.unlink(targetPath);
            showToast(`Permanently deleted "${noteName}"`, 'info');
            renderTrashList();
        }
    } catch (err) {
        console.error('Error permanently deleting note:', err);
        showToast('Failed to delete note permanently', 'error');
    }
}

async function confirmEmptyTrash() {
    if (typeof emptyTrash === 'function') {
        await emptyTrash();
        renderTrashList();
    }
}

// Initialize settings and theme on startup
applyAppTheme();
loadSettingsIntoUI();
