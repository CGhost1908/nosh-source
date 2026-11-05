// Google Drive Cloud Synchronization Logic

const driveCallback = 'http://localhost:2222/drive-callback';

function getDriveCredentials() {
    const fallbackId = (typeof defaultDriveClientId !== 'undefined' ? defaultDriveClientId : (window?.defaultDriveClientId || ''));
    const fallbackSecret = (typeof defaultDriveClientSecret !== 'undefined' ? defaultDriveClientSecret : (window?.defaultDriveClientSecret || ''));
    return {
        clientId: process.env.GOOGLE_DRIVE_CLIENT_ID || localStorage.getItem('drive_client_id') || fallbackId,
        clientSecret: process.env.GOOGLE_DRIVE_CLIENT_SECRET || localStorage.getItem('drive_client_secret') || fallbackSecret
    };
}

function openDriveAuth() {
    const { clientId, clientSecret } = getDriveCredentials();

    if (!clientId || !clientSecret) {
        showToast('Please set Google Drive Client ID & Secret in environment or settings', 'warning');
        openSettingsModal();
        switchSettingsTab('integrations');
        return;
    }

    try {
        const { google } = require('googleapis');
        const oAuth2Client = new google.auth.OAuth2(clientId, clientSecret, driveCallback);
        const authUrl = oAuth2Client.generateAuthUrl({
            access_type: 'offline',
            prompt: 'consent',
            scope: [
                'https://www.googleapis.com/auth/drive.file',
                'https://www.googleapis.com/auth/userinfo.email'
            ]
        });

        ipcRenderer.invoke('open-external', authUrl);
        showToast('Complete Google authorization in your browser', 'info');
    } catch (err) {
        console.error('Error opening Google Drive auth:', err);
        showToast('Google Drive setup error', 'error');
    }
}

async function fetchDriveUserProfile() {
    try {
        const drive = await getAuthenticatedDriveClient();
        if (!drive) return null;
        const res = await drive.about.get({ fields: 'user(displayName,emailAddress)' });
        if (res && res.data && res.data.user) {
            const email = res.data.user.emailAddress;
            const name = res.data.user.displayName;
            if (email) localStorage.setItem('google_drive_email', email);
            if (name) localStorage.setItem('google_drive_name', name);
            return { email, name };
        }
    } catch (e) {
        console.warn('Could not fetch drive user profile:', e);
    }
    return null;
}

ipcRenderer.on('drive-token', (event, tokens) => {
    const { access_token, refresh_token, email, name } = tokens;
    if (access_token) {
        localStorage.setItem('google_drive_access_token', access_token);
    }
    if (refresh_token) {
        localStorage.setItem('google_drive_refresh_token', refresh_token);
    }
    if (email) {
        localStorage.setItem('google_drive_email', email);
    }
    if (name) {
        localStorage.setItem('google_drive_name', name);
    }
    showToast(`Google Drive linked${email ? ` (${email})` : ''}!`, 'success');
    loadSettingsIntoUI();
    getNoshFilesFromDrive();
});

function disconnectDrive() {
    localStorage.removeItem('google_drive_access_token');
    localStorage.removeItem('google_drive_refresh_token');
    localStorage.removeItem('google_drive_email');
    localStorage.removeItem('google_drive_name');
    document.querySelectorAll('.save').forEach(el => el.classList.remove('drive-save'));
    updateDriveSyncButtonState(false);
    loadSettingsIntoUI();
    showToast('Google Drive unlinked', 'info');
}

// Drive Sync Button in Editor
function updateDriveSyncButtonState(isSynced) {
    const syncBtn = document.getElementById('drive-sync-btn');
    const syncLabel = document.getElementById('drive-sync-label');
    if (!syncBtn || !syncLabel) return;

    if (isSynced) {
        syncBtn.classList.add('primary');
        syncLabel.textContent = 'Synced';
        syncBtn.title = 'Google Drive: Synced (Click to disable sync)';
    } else {
        syncBtn.classList.remove('primary');
        syncLabel.textContent = 'Sync to Drive';
        syncBtn.title = 'Sync this note to Google Drive';
    }
}

// Centralized authenticated Drive client with auto-refresh and persistence
async function getAuthenticatedDriveClient() {
    const accessToken = localStorage.getItem('google_drive_access_token');
    const refreshToken = localStorage.getItem('google_drive_refresh_token');

    if (!accessToken && !refreshToken) {
        return null;
    }

    const { clientId, clientSecret } = getDriveCredentials();
    if (!clientId || !clientSecret) {
        return null;
    }

    const { google } = require('googleapis');
    const oAuth2Client = new google.auth.OAuth2(clientId, clientSecret, driveCallback);

    oAuth2Client.setCredentials({
        access_token: accessToken || undefined,
        refresh_token: refreshToken || undefined
    });

    oAuth2Client.on('tokens', (tokens) => {
        if (tokens.access_token) {
            localStorage.setItem('google_drive_access_token', tokens.access_token);
        }
        if (tokens.refresh_token) {
            localStorage.setItem('google_drive_refresh_token', tokens.refresh_token);
        }
    });

    // Proactively verify/refresh access token if refresh_token is present
    if (refreshToken) {
        try {
            const tokenRes = await oAuth2Client.getAccessToken();
            if (tokenRes && tokenRes.token) {
                localStorage.setItem('google_drive_access_token', tokenRes.token);
            }
        } catch (err) {
            console.error('Failed to validate or refresh Google Drive access token:', err);
            if (err.message && (err.message.includes('invalid_grant') || err.message.includes('Invalid Credentials'))) {
                showToast('Google Drive session expired. Please reconnect in Settings.', 'warning');
                return null;
            }
        }
    }

    return google.drive({ version: 'v3', auth: oAuth2Client });
}

// Drive Sync Confirmation State
let pendingDriveSyncNote = null;
let pendingDriveSyncAction = null; // 'sync' or 'unsync'

function promptDriveSyncConfirmation(noteName) {
    const targetNote = noteName || activeNoteName;
    if (!targetNote) {
        showToast('No active note selected', 'warning');
        return;
    }

    const driveToken = localStorage.getItem('google_drive_access_token');
    const refreshToken = localStorage.getItem('google_drive_refresh_token');
    if ((!driveToken || driveToken === 'null') && (!refreshToken || refreshToken === 'null')) {
        showToast('Connect Google Drive in Settings first', 'warning');
        openSettingsModal();
        switchSettingsTab('integrations');
        return;
    }

    const safeName = path.basename(targetNote, '.nsh');
    const noteEl = typeof findNoteElement === 'function' ? findNoteElement(safeName) : document.querySelector(`.save[data-file="${safeName}"]`);
    const isSynced = noteEl && noteEl.classList.contains('drive-save');

    pendingDriveSyncNote = safeName;
    pendingDriveSyncAction = isSynced ? 'unsync' : 'sync';

    const titleEl = document.getElementById('drive-sync-modal-title');
    const headingEl = document.getElementById('drive-sync-modal-heading');
    const msgEl = document.getElementById('drive-sync-modal-msg');
    const confirmBtn = document.getElementById('drive-sync-modal-confirm-btn');
    const iconWrap = document.getElementById('drive-sync-modal-icon-wrap');
    const iconEl = document.getElementById('drive-sync-modal-icon');

    const displayName = typeof escapeHtml === 'function' ? escapeHtml(safeName) : safeName;

    if (isSynced) {
        if (titleEl) titleEl.textContent = 'Disable Google Drive Sync';
        if (headingEl) headingEl.textContent = 'Disable Cloud Sync?';
        if (msgEl) {
            msgEl.innerHTML = `Are you sure you want to stop syncing <strong style="color: #fff;">"${displayName}"</strong> with Google Drive?<br><span style="font-size: 12px; color: var(--text-muted); display: inline-block; margin-top: 6px;">This will remove the backup copy from the 'noshTheNotepad' folder on Google Drive. Your local note will remain safe.</span>`;
        }
        if (confirmBtn) {
            confirmBtn.textContent = 'Disable Sync';
            confirmBtn.className = 'btn-danger';
        }
        if (iconWrap) {
            iconWrap.className = 'drive-sync-dialog-icon danger';
        }
        if (iconEl) {
            iconEl.setAttribute('icon', 'solar:cloud-cross-bold');
            iconEl.style.color = 'var(--danger)';
        }
    } else {
        if (titleEl) titleEl.textContent = 'Google Drive Sync';
        if (headingEl) headingEl.textContent = 'Sync Note to Google Drive?';
        if (msgEl) {
            msgEl.innerHTML = `Do you want to sync <strong style="color: #fff;">"${displayName}"</strong> with Google Drive?<br><span style="font-size: 12px; color: var(--text-muted); display: inline-block; margin-top: 6px;">A copy will be uploaded to the 'noshTheNotepad' folder on your Google Drive and kept up to date automatically.</span>`;
        }
        if (confirmBtn) {
            confirmBtn.textContent = 'Sync to Drive';
            confirmBtn.className = 'btn-primary';
        }
        if (iconWrap) {
            iconWrap.className = 'drive-sync-dialog-icon';
        }
        if (iconEl) {
            iconEl.setAttribute('icon', 'logos:google-drive');
            iconEl.style.color = '';
        }
    }

    openModal('drive-sync-modal');
}

async function confirmDriveSyncAction() {
    const noteName = pendingDriveSyncNote;
    const action = pendingDriveSyncAction;
    closeAllModals();

    if (!noteName) return;

    pendingDriveSyncNote = null;
    pendingDriveSyncAction = null;

    await performDriveSync(noteName, action);
}

async function toggleDriveSync() {
    if (!activeNoteName) return;
    promptDriveSyncConfirmation(activeNoteName);
}

async function toggleDriveSyncForNote(noteName) {
    promptDriveSyncConfirmation(noteName || activeNoteName);
}

async function performDriveSync(safeName, action) {
    if (!safeName) return;

    const noteEl = typeof findNoteElement === 'function' ? findNoteElement(safeName) : document.querySelector(`.save[data-file="${safeName}"]`);
    const isCurrentlySynced = noteEl && noteEl.classList.contains('drive-save');
    const shouldUnsync = action ? (action === 'unsync') : isCurrentlySynced;

    if (shouldUnsync) {
        // Unsync: remove local marker and delete from Drive
        if (noteEl) noteEl.classList.remove('drive-save');
        if (activeNoteName === safeName) updateDriveSyncButtonState(false);
        try {
            await deleteFileFromDriveByName(safeName);
        } catch (e) {
            console.warn('Failed to delete unsynced note from Drive:', e);
        }
        showToast(`Cloud sync disabled for "${safeName}"`, 'info');
    } else {
        // Sync
        const filePath = path.join(savesDir, `${safeName}.nsh`);
        if (activeNoteName === safeName && typeof saveCurrentFile === 'function' && typeof hasUnsavedChanges !== 'undefined' && hasUnsavedChanges) {
            await saveCurrentFile();
        }

        if (fs.existsSync(filePath)) {
            const syncBtn = document.getElementById('drive-sync-btn');
            const syncLabel = document.getElementById('drive-sync-label');
            if (activeNoteName === safeName && syncLabel) {
                syncLabel.textContent = 'Syncing...';
            }

            const fileHTML = await fsPromises.readFile(filePath, 'utf8');
            const success = await uploadFileToDrive(filePath, fileHTML);
            if (success) {
                const refreshedNoteEl = typeof findNoteElement === 'function' ? findNoteElement(safeName) : document.querySelector(`.save[data-file="${safeName}"]`);
                if (refreshedNoteEl) refreshedNoteEl.classList.add('drive-save');
                if (activeNoteName === safeName) updateDriveSyncButtonState(true);
                showToast(`"${safeName}" synced with Google Drive`, 'success');
            } else {
                if (activeNoteName === safeName) updateDriveSyncButtonState(false);
                showToast(`Failed to sync "${safeName}" to Google Drive. Check connection or reconnect in Settings.`, 'error');
            }
        }
    }
}

// Keyboard support for drive sync confirmation modal (Enter to confirm)
document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        const modal = document.getElementById('drive-sync-modal');
        if (modal && modal.classList.contains('active')) {
            e.preventDefault();
            confirmDriveSyncAction();
        }
    }
});

// Upload file to Google Drive folder 'noshTheNotepad'
async function uploadFileToDrive(filePath, fileContent) {
    try {
        const drive = await getAuthenticatedDriveClient();
        if (!drive) {
            console.warn('Google Drive not authenticated');
            return false;
        }

        const fileName = path.basename(filePath);

        // Find or create 'noshTheNotepad' folder
        const folderRes = await drive.files.list({
            q: "name = 'noshTheNotepad' and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
            fields: 'files(id, name)'
        });

        let folderId = folderRes.data.files && folderRes.data.files[0]?.id;
        if (!folderId) {
            const createFolder = await drive.files.create({
                resource: { name: 'noshTheNotepad', mimeType: 'application/vnd.google-apps.folder' },
                fields: 'id'
            });
            folderId = createFolder.data.id;
        }

        const fileRes = await drive.files.list({
            q: `name = '${fileName}' and '${folderId}' in parents and trashed = false`,
            fields: 'files(id, name)'
        });

        const media = {
            mimeType: 'text/plain',
            body: fileContent
        };

        if (fileRes.data.files && fileRes.data.files.length > 0) {
            const fileId = fileRes.data.files[0].id;
            await drive.files.update({
                fileId: fileId,
                media: media
            });
            // Clean up any extraneous duplicate copies
            for (let i = 1; i < fileRes.data.files.length; i++) {
                try {
                    await drive.files.delete({ fileId: fileRes.data.files[i].id });
                } catch (_) {}
            }
        } else {
            await drive.files.create({
                resource: {
                    name: fileName,
                    parents: [folderId]
                },
                media: media,
                fields: 'id'
            });
        }
        return true;
    } catch (err) {
        console.error('Error syncing file to Google Drive:', err);
        return false;
    }
}

// Delete file from Drive
async function deleteFileFromDriveByName(fileName) {
    try {
        const drive = await getAuthenticatedDriveClient();
        if (!drive) return false;

        const fileRes = await drive.files.list({
            q: `name = '${fileName}.nsh' and trashed = false`,
            fields: 'files(id, name)'
        });

        if (fileRes.data.files && fileRes.data.files.length > 0) {
            for (const file of fileRes.data.files) {
                await drive.files.delete({ fileId: file.id });
            }
        }
        return true;
    } catch (err) {
        console.error('Error deleting file from Google Drive:', err);
        return false;
    }
}

// Rename file on Drive
async function renameFileDrive(oldName, newName) {
    try {
        const drive = await getAuthenticatedDriveClient();
        if (!drive) return false;

        const fileRes = await drive.files.list({
            q: `name = '${oldName}.nsh' and trashed = false`,
            fields: 'files(id, name)'
        });

        if (fileRes.data.files && fileRes.data.files.length > 0) {
            for (const file of fileRes.data.files) {
                await drive.files.update({
                    fileId: file.id,
                    resource: { name: `${newName}.nsh` }
                });
            }
        }
        return true;
    } catch (err) {
        console.error('Error renaming file on Google Drive:', err);
        return false;
    }
}

// Get list of synced files from Drive and apply badges
async function getNoshFilesFromDrive() {
    try {
        const drive = await getAuthenticatedDriveClient();
        if (!drive) return;

        const folderRes = await drive.files.list({
            q: "name = 'noshTheNotepad' and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
            fields: 'files(id, name)'
        });

        if (!folderRes.data.files || folderRes.data.files.length === 0) return;
        const folderId = folderRes.data.files[0].id;

        const filesRes = await drive.files.list({
            q: `'${folderId}' in parents and trashed = false`,
            fields: 'files(id, name)',
            pageSize: 1000
        });

        if (filesRes.data.files) {
            const driveFileNames = new Set(filesRes.data.files.map(f => path.basename(f.name, '.nsh')));

            document.querySelectorAll('.save').forEach(el => {
                const fName = el.getAttribute('data-file') || el.getAttribute('file-name');
                if (fName && driveFileNames.has(fName)) {
                    el.classList.add('drive-save');
                } else {
                    el.classList.remove('drive-save');
                }
            });

            if (activeNoteName) {
                const safeName = path.basename(activeNoteName, '.nsh');
                const isSynced = driveFileNames.has(safeName);
                updateDriveSyncButtonState(isSynced);
            }
        }
    } catch (err) {
        console.error('Error getting files from Google Drive:', err);
    }
}

// Check files on Drive that do not exist locally
async function checkNonExistFilesDrive() {
    const container = document.getElementById('drive-missing-container');
    const countEl = document.getElementById('drive-missing-count');
    if (!container) return;

    container.style.display = 'flex';

    const driveToken = localStorage.getItem('google_drive_access_token');
    const refreshToken = localStorage.getItem('google_drive_refresh_token');
    if ((!driveToken || driveToken === 'null') && (!refreshToken || refreshToken === 'null')) {
        container.innerHTML = `<div style="color:var(--text-muted);font-size:12px;padding:10px 0;">Connect your Google Drive account first.</div>`;
        return;
    }

    if (typeof showDriveMissingSkeleton === 'function') {
        showDriveMissingSkeleton(container, 3);
    } else {
        container.innerHTML = `<div style="color:var(--text-muted);font-size:12px;padding:10px 0;">Scanning Google Drive for missing notes...</div>`;
    }

    try {
        const drive = await getAuthenticatedDriveClient();
        if (!drive) {
            container.innerHTML = `<div style="color:var(--danger);font-size:12px;padding:10px 0;">Unable to authenticate with Google Drive. Please reconnect in Settings.</div>`;
            return;
        }

        const folderRes = await drive.files.list({
            q: "name = 'noshTheNotepad' and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
            fields: 'files(id, name)'
        });

        if (!folderRes.data.files || folderRes.data.files.length === 0) {
            container.innerHTML = `<div style="color:var(--text-muted);font-size:12px;padding:10px 0;">Folder 'noshTheNotepad' does not exist on Drive yet.</div>`;
            return;
        }

        const folderId = folderRes.data.files[0].id;
        const fileRes = await drive.files.list({
            q: `'${folderId}' in parents and name contains '.nsh' and trashed = false`,
            fields: 'files(id, name)'
        });

        const files = fileRes.data.files || [];
        const localFiles = await fsPromises.readdir(savesDir);

        const missing = files.filter(f => !localFiles.includes(f.name));

        if (countEl) countEl.textContent = `${missing.length} notes found`;

        if (missing.length === 0) {
            container.innerHTML = `<div style="color:var(--text-muted);font-size:12px;padding:10px 0;">All notes on Google Drive are already present locally.</div>`;
            return;
        }

        container.innerHTML = '';
        missing.forEach(file => {
            const item = document.createElement('div');
            item.className = 'drive-missing-item';
            item.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:var(--radius-sm);margin-bottom:6px;';
            item.innerHTML = `
                <div style="display:flex;align-items:center;gap:8px;">
                    <iconify-icon icon="logos:google-drive"></iconify-icon>
                    <span style="font-size:13px;font-weight:500;color:var(--text-primary);">${escapeHtml(file.name)}</span>
                </div>
                <button class="btn-primary" style="height:26px;font-size:11px;padding:0 10px;" onclick="importFileFromDrive('${escapeHtml(file.name)}', '${file.id}', this)">
                    Import
                </button>
            `;
            container.appendChild(item);
        });
    } catch (err) {
        console.error('Error scanning Drive files:', err);
        container.innerHTML = `<div style="color:var(--danger);font-size:12px;padding:10px 0;">Failed to scan Drive: ${err.message}</div>`;
    }
}

// Import single file from Drive
async function importFileFromDrive(fileName, fileId, btn) {
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<iconify-icon icon="line-md:loading-loop"></iconify-icon> Importing...`;
    }

    try {
        const drive = await getAuthenticatedDriveClient();
        if (!drive) {
            showToast('Unable to authenticate with Google Drive', 'error');
            if (btn) {
                btn.disabled = false;
                btn.textContent = 'Import';
            }
            return;
        }

        const res = await drive.files.get({
            fileId: fileId,
            alt: 'media'
        });

        const targetPath = path.join(savesDir, fileName);
        await fsPromises.writeFile(targetPath, res.data, 'utf8');

        showToast(`Imported "${fileName}" from Google Drive`, 'success');
        await readDatabase(path.basename(fileName, '.nsh'));
        checkNonExistFilesDrive();
    } catch (err) {
        console.error('Error importing file from Drive:', err);
        showToast('Error importing file from Drive', 'error');
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Import';
        }
    }
}

async function refreshDriveToken() {
    const refreshToken = localStorage.getItem('google_drive_refresh_token');
    if (!refreshToken) return;

    try {
        const drive = await getAuthenticatedDriveClient();
        if (drive && typeof readDatabase === 'function') {
            readDatabase();
        }
    } catch (err) {
        console.error('Error refreshing Google Drive token:', err);
    }
}

// Automatically load and apply Drive sync status on application startup & page load
(function autoInitDriveSync() {
    function tryInit() {
        const hasDriveAuth = (localStorage.getItem('google_drive_access_token') && localStorage.getItem('google_drive_access_token') !== 'null') ||
                             (localStorage.getItem('google_drive_refresh_token') && localStorage.getItem('google_drive_refresh_token') !== 'null');
        if (hasDriveAuth && typeof getNoshFilesFromDrive === 'function') {
            getNoshFilesFromDrive();
        }
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(tryInit, 100);
    } else {
        document.addEventListener('DOMContentLoaded', tryInit);
    }
    window.addEventListener('load', () => setTimeout(tryInit, 250));
})();

window.fetchDriveUserProfile = fetchDriveUserProfile;
