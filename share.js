// Web Publishing & Sharing (Supabase Cloud + GitHub Pages Web Viewer)

const SUPABASE_CONFIG = {
    url: 'https://buvtdaxlibejpjlkxaor.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ1dnRkYXhsaWJlanBqbGt4YW9yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM1MjA2NTIsImV4cCI6MjEwOTA5NjY1Mn0.Kd2bR8gAm2lLGKHLhV1CJCacuLE1NKPptVmIJiKZnNY',
    viewerBaseUrl: 'https://cghost1908.github.io/nosh/view.html'
};

// Public note IDs end up in shareable URLs, so use the CSPRNG instead of Math.random()
function generateRandomID(length = 16) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const limit = 256 - (256 % chars.length); // reject biased bytes
    let res = '';
    while (res.length < length) {
        const bytes = window.crypto.getRandomValues(new Uint8Array(length));
        for (const b of bytes) {
            if (b < limit && res.length < length) res += chars[b % chars.length];
        }
    }
    return res;
}

// Secret that proves ownership of a published note. Only its SHA-256 hash is stored
// in Supabase (see supabase/secure_shared_notes.sql); the token itself stays local.
function generateEditToken() {
    const bytes = window.crypto.getRandomValues(new Uint8Array(32));
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

async function callSupabaseRpc(fnName, args) {
    const response = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/rpc/${fnName}`, {
        method: 'POST',
        headers: {
            'apikey': SUPABASE_CONFIG.anonKey,
            'Authorization': `Bearer ${SUPABASE_CONFIG.anonKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(args)
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`${fnName} failed (${response.status}): ${errText}`);
    }
    return response.json();
}

// Create a new shared note and return the local record to persist
async function publishNewSharedNote(title, noteHTML) {
    const id = generateRandomID();
    const editToken = generateEditToken();

    await callSupabaseRpc('publish_shared_note', {
        p_id: id,
        p_title: title,
        p_content: noteHTML,
        p_edit_token: editToken
    });

    return {
        id,
        name: title,
        url: `${SUPABASE_CONFIG.viewerBaseUrl}?id=${id}`,
        date: new Date().toLocaleDateString(),
        updatedAt: null,
        editToken
    };
}

// Update a shared note in place. Returns false when this device has no valid
// edit token for it (e.g. it was published by an older Nosh version).
async function updateSharedNote(record, title, noteHTML) {
    if (!record || !record.id || !record.editToken) return false;

    const updated = await callSupabaseRpc('update_shared_note', {
        p_id: record.id,
        p_edit_token: record.editToken,
        p_title: title,
        p_content: noteHTML
    });
    return updated === true;
}

function formatUpdateTime() {
    const now = new Date();
    return now.toLocaleDateString() + ' ' + now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Persistent cache mapping local asset paths (e.g., "assets/asset_123.png") to Catbox URLs
function getCatboxAssetCache() {
    try {
        return JSON.parse(localStorage.getItem('nosh-catbox-asset-cache')) || {};
    } catch {
        return {};
    }
}

function saveCatboxAssetCache(cache) {
    try {
        localStorage.setItem('nosh-catbox-asset-cache', JSON.stringify(cache));
    } catch (e) {
        console.warn('Failed to save Catbox asset cache:', e);
    }
}

// Upload any local or data-URL media in note HTML to Catbox and replace src with public URLs for publishing
async function resolvePublishedMediaInHTML(rawHtml, onProgressStatus) {
    if (!rawHtml || typeof document === 'undefined') return rawHtml;

    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = rawHtml;

    // Strip any editor-only chrome just in case rawHtml came straight from disk
    tempDiv.querySelectorAll('.CodeMirror, .media-toolbar, .media-resize-handle').forEach(el => el.remove());

    const mediaEls = Array.from(tempDiv.querySelectorAll('img, video'));
    if (mediaEls.length === 0) return tempDiv.innerHTML;

    const assetCache = getCatboxAssetCache();
    let cacheUpdated = false;

    if (typeof savesDir === 'undefined' || !savesDir) {
        if (typeof invokeSavesDir === 'function') {
            await invokeSavesDir();
        }
    }

    for (let i = 0; i < mediaEls.length; i++) {
        const el = mediaEls[i];
        const rawSrc = (el.getAttribute('src') || '').trim();
        const rel = el.getAttribute('data-asset-rel') || (rawSrc.startsWith('assets/') ? rawSrc : null);

        // 1. Already in localStorage asset cache
        if (rel && assetCache[rel] && /^https?:\/\//i.test(assetCache[rel])) {
            el.setAttribute('src', assetCache[rel]);
            continue;
        }

        // 2. Already an external http/https URL
        if (/^https?:\/\//i.test(rawSrc)) {
            continue;
        }

        // 3. Local asset ("assets/...", "file://...", or "data:...") -> Upload to Catbox on publish
        if (typeof ipcRenderer === 'undefined') continue;

        let uploadPayload = null;
        if (rel && typeof savesDir !== 'undefined' && savesDir && typeof path !== 'undefined') {
            const fullPath = path.join(savesDir, rel);
            uploadPayload = {
                filePath: fullPath,
                fileName: path.basename(fullPath)
            };
        } else if (rawSrc.startsWith('file://')) {
            let localPath = decodeURIComponent(rawSrc.replace(/^file:\/\/\/?/i, ''));
            if (window.nosh.platform !== 'win32' && !localPath.startsWith('/')) {
                localPath = '/' + localPath;
            }
            uploadPayload = {
                filePath: localPath,
                fileName: typeof path !== 'undefined' ? path.basename(localPath) : 'media.png'
            };
        } else if (rawSrc.startsWith('data:')) {
            const match = rawSrc.match(/^data:([^;]+);base64,(.+)$/i);
            if (match) {
                const mimeType = match[1];
                const base64Data = match[2];
                const extMap = {
                    'image/png': '.png',
                    'image/jpeg': '.jpg',
                    'image/gif': '.gif',
                    'image/webp': '.webp',
                    'image/svg+xml': '.svg',
                    'video/mp4': '.mp4',
                    'video/webm': '.webm'
                };
                const ext = extMap[mimeType.toLowerCase()] || '.png';
                uploadPayload = {
                    base64Data,
                    mimeType,
                    fileName: `embedded_${Date.now()}${ext}`
                };
            }
        }

        if (uploadPayload) {
            if (typeof onProgressStatus === 'function') {
                onProgressStatus(`Uploading media (${i + 1}/${mediaEls.length})...`);
            }
            const res = await ipcRenderer.invoke('upload-to-catbox', uploadPayload);
            if (res && res.success && res.url) {
                el.setAttribute('src', res.url);
                if (rel) {
                    assetCache[rel] = res.url;
                    cacheUpdated = true;
                }
            } else {
                console.warn('Failed to upload media asset to Catbox:', res && res.error);
            }
        }
    }

    if (cacheUpdated) {
        saveCatboxAssetCache(assetCache);
    }

    return tempDiv.innerHTML;
}

// Published Notes Storage Helpers
function getPublishedInfoForNote(noteName) {
    if (!noteName) return null;
    const safeTarget = typeof path !== 'undefined' ? path.basename(noteName, '.nsh').toLowerCase() : noteName.toLowerCase();
    const list = JSON.parse(localStorage.getItem('publishedFiles')) || [];
    return list.find(f => {
        if (!f || !f.name) return false;
        const entryName = typeof path !== 'undefined' ? path.basename(f.name, '.nsh').toLowerCase() : f.name.toLowerCase();
        return entryName === safeTarget;
    }) || null;
}

function isNotePublished(noteName) {
    return Boolean(getPublishedInfoForNote(noteName));
}

function savePublishedRecord(record) {
    if (!record || !record.name) return;
    let list = JSON.parse(localStorage.getItem('publishedFiles')) || [];
    const safeTarget = typeof path !== 'undefined' ? path.basename(record.name, '.nsh').toLowerCase() : record.name.toLowerCase();

    // Remove existing duplicates for this note
    list = list.filter(f => {
        if (!f || !f.name) return false;
        const entryName = typeof path !== 'undefined' ? path.basename(f.name, '.nsh').toLowerCase() : f.name.toLowerCase();
        return entryName !== safeTarget;
    });

    list.unshift(record);
    localStorage.setItem('publishedFiles', JSON.stringify(list));
}

// Update Toolbar Publish Button UI State
function updatePublishButtonState() {
    const shareBtn = document.getElementById('share-file');
    if (!shareBtn) return;

    if (typeof activeNoteName === 'undefined' || !activeNoteName) {
        shareBtn.style.display = 'none';
        return;
    }

    shareBtn.style.display = 'inline-flex';
    const publishedInfo = getPublishedInfoForNote(activeNoteName);

    // Clean up any stray duplicate spans created previously
    const strayDots = shareBtn.querySelectorAll('.publish-live-dot');
    strayDots.forEach(d => {
        if (d.id !== 'share-file-dot') d.remove();
    });

    const label = document.getElementById('share-file-label') || shareBtn.querySelector('span:not(.live-dot)');
    const dot = document.getElementById('share-file-dot');
    const icon = document.getElementById('share-file-icon') || shareBtn.querySelector('iconify-icon');

    if (publishedInfo) {
        shareBtn.classList.add('published');
        const updateInfo = publishedInfo.updatedAt ? ` (Updated: ${publishedInfo.updatedAt})` : '';
        shareBtn.setAttribute('title', `Note is live online (${publishedInfo.date || 'Live'})${updateInfo}.\nClick to manage, copy link, or update live note.`);
        if (label) label.textContent = 'Published';
        if (icon) icon.setAttribute('icon', 'solar:cloud-check-bold');
        if (dot) dot.style.display = 'inline-block';
    } else {
        shareBtn.classList.remove('published');
        shareBtn.setAttribute('title', 'Publish Note to Web (Cloud)');
        if (label) label.textContent = 'Publish';
        if (icon) icon.setAttribute('icon', 'solar:upload-track-2-bold');
        if (dot) dot.style.display = 'none';
    }
}

// Open Publish / Live Status Modal
const shareFileBtn = document.getElementById('share-file');
if (shareFileBtn) {
    shareFileBtn.addEventListener('click', () => {
        if (typeof activeNoteName === 'undefined' || !activeNoteName) {
            showToast('Open a note first to publish', 'warning');
            return;
        }

        const publishedInfo = getPublishedInfoForNote(activeNoteName);

        if (publishedInfo) {
            // File is ALREADY published: open management & update popup
            openPublishedStatusModal(publishedInfo);
        } else {
            // File is NOT published: open publish confirmation popup
            const docNameEl = document.getElementById('publish-doc-name');
            if (docNameEl) docNameEl.textContent = activeNoteName;
            openModal('publish-modal');
        }
    });
}

function openPublishedStatusModal(publishedInfo) {
    const info = publishedInfo || getPublishedInfoForNote(activeNoteName);
    if (!info) return;

    const docNameEl = document.getElementById('published-status-doc-name');
    if (docNameEl) docNameEl.textContent = info.name || activeNoteName;

    const firstDateEl = document.getElementById('published-status-first-date');
    if (firstDateEl) firstDateEl.textContent = `Published: ${info.date || '-'}`;

    const updatedDateEl = document.getElementById('published-status-updated-date');
    if (updatedDateEl) updatedDateEl.textContent = `Updated: ${info.updatedAt || 'Never (Initial publish)'}`;

    const linkInput = document.getElementById('published-status-link-input');
    if (linkInput) linkInput.value = info.url || `${SUPABASE_CONFIG.viewerBaseUrl}?id=${info.id}`;

    openModal('published-status-modal');
}

function copyPublishedStatusLink() {
    const linkInput = document.getElementById('published-status-link-input');
    if (!linkInput || !linkInput.value) return;

    navigator.clipboard.writeText(linkInput.value).then(() => {
        showToast('Public link copied to clipboard', 'success');
    });
}

function openPublishedStatusExternal() {
    const linkInput = document.getElementById('published-status-link-input');
    if (linkInput && linkInput.value) {
        if (typeof ipcRenderer !== 'undefined') {
            ipcRenderer.invoke('open-external', linkInput.value);
        } else {
            window.open(linkInput.value, '_blank');
        }
    }
}

// Unpublish Note
function confirmUnpublishNote() {
    if (typeof activeNoteName === 'undefined' || !activeNoteName) return;

    const info = getPublishedInfoForNote(activeNoteName);
    if (!info) return;

    const confirmed = confirm(`Are you sure you want to remove "${activeNoteName}" from the published list?`);
    if (!confirmed) return;

    removePublishedFile(info.id);
    closeAllModals();
    showToast(`"${activeNoteName}" removed from published list`, 'info');
}

// Execute In-Place Update to Live Note on Supabase
async function executeUpdatePublishedNote() {
    if (typeof activeNoteName === 'undefined' || !activeNoteName) return;

    const publishedInfo = getPublishedInfoForNote(activeNoteName);
    if (!publishedInfo || !publishedInfo.id) {
        showToast('No published record found for this note', 'warning');
        return;
    }

    const updateBtn = document.getElementById('publish-update-btn');
    const originalText = updateBtn ? updateBtn.innerHTML : '';
    if (updateBtn) {
        updateBtn.disabled = true;
        updateBtn.innerHTML = '<iconify-icon icon="eos-icons:three-dots-loading"></iconify-icon> Updating Live Note...';
    }

    try {
        // Auto-save local note if unsaved
        if (typeof saveFile === 'function' && typeof hasUnsavedChanges !== 'undefined' && hasUnsavedChanges) {
            await saveFile();
        }

        const rawCleanContent = typeof getCleanContentHTML === 'function' ? getCleanContentHTML() : content.innerHTML;
        const cleanContent = await resolvePublishedMediaInHTML(rawCleanContent, (statusMsg) => {
            if (updateBtn) {
                updateBtn.innerHTML = `<iconify-icon icon="eos-icons:three-dots-loading"></iconify-icon> ${statusMsg}`;
            }
        });
        if (updateBtn) {
            updateBtn.innerHTML = '<iconify-icon icon="eos-icons:three-dots-loading"></iconify-icon> Updating Live Note...';
        }
        const updated = await updateSharedNote(publishedInfo, activeNoteName, cleanContent);
        if (!updated) {
            console.warn('No valid edit token for this published note; it cannot be updated in place.');
            closeModal('published-status-modal');
            openModal('publish-legacy-modal');
            return;
        }

        // Successfully updated existing live note!
        const updateTimeStr = formatUpdateTime();
        publishedInfo.updatedAt = updateTimeStr;
        publishedInfo.name = activeNoteName;
        savePublishedRecord(publishedInfo);

        const updatedDateEl = document.getElementById('published-status-updated-date');
        if (updatedDateEl) updatedDateEl.textContent = `Updated: ${updateTimeStr}`;

        updatePublishButtonState();
        renderPublishedFilesList();

        closeAllModals();
        showToast('Live note updated successfully with latest changes!', 'success');

    } catch (err) {
        console.error('Error updating published note in Supabase:', err);
        showToast(`Update error: ${err.message}`, 'error');
    } finally {
        if (updateBtn) {
            updateBtn.disabled = false;
            updateBtn.innerHTML = originalText || '<iconify-icon icon="solar:restart-linear"></iconify-icon> Update Live Note';
        }
    }
}

// Republish Note as New Independent Link
async function republishAsNewLink() {
    if (typeof activeNoteName === 'undefined' || !activeNoteName) return;

    closeModal('published-status-modal');
    closeModal('publish-legacy-modal');

    // Auto-save local note if unsaved
    if (typeof saveFile === 'function' && typeof hasUnsavedChanges !== 'undefined' && hasUnsavedChanges) {
        await saveFile();
    }

    const rawCleanContent = typeof getCleanContentHTML === 'function' ? getCleanContentHTML() : content.innerHTML;

    showToast('Publishing as new link...', 'info');

    try {
        const cleanContent = await resolvePublishedMediaInHTML(rawCleanContent);
        const record = await publishNewSharedNote(activeNoteName, cleanContent);

        const linkInput = document.getElementById('published-link-input');
        if (linkInput) linkInput.value = record.url;

        savePublishedRecord(record);

        updatePublishButtonState();
        renderPublishedFilesList();

        closeAllModals();
        openModal('publish-success-modal');
        showToast('Published as new live link successfully!', 'success');

    } catch (err) {
        console.error('Error republishing note to Supabase:', err);
        showToast(`Publish error: ${err.message}`, 'error');
    }
}

// Execute Initial Publish to Supabase Cloud
async function executePublishNote() {
    if (typeof activeNoteName === 'undefined' || !activeNoteName) return;

    const publishConfirmBtn = document.getElementById('publish-confirm-btn');
    if (publishConfirmBtn) {
        publishConfirmBtn.disabled = true;
        publishConfirmBtn.textContent = 'Publishing to Cloud...';
    }

    // Auto-save local note if unsaved
    if (typeof saveFile === 'function' && typeof hasUnsavedChanges !== 'undefined' && hasUnsavedChanges) {
        await saveFile();
    }

    const rawCleanContent = typeof getCleanContentHTML === 'function' ? getCleanContentHTML() : content.innerHTML;

    try {
        const cleanContent = await resolvePublishedMediaInHTML(rawCleanContent, (statusMsg) => {
            if (publishConfirmBtn) {
                publishConfirmBtn.textContent = statusMsg;
            }
        });
        if (publishConfirmBtn) {
            publishConfirmBtn.textContent = 'Publishing to Cloud...';
        }
        const record = await publishNewSharedNote(activeNoteName, cleanContent);

        const linkInput = document.getElementById('published-link-input');
        if (linkInput) linkInput.value = record.url;

        // Store published file info (including its edit token) in localStorage
        savePublishedRecord(record);

        updatePublishButtonState();
        renderPublishedFilesList();

        closeAllModals();
        openModal('publish-success-modal');
        showToast('Note published online successfully!', 'success');

    } catch (err) {
        console.error('Error publishing note to Supabase:', err);
        showToast(`Publish error: ${err.message}`, 'error');
    } finally {
        if (publishConfirmBtn) {
            publishConfirmBtn.disabled = false;
            publishConfirmBtn.textContent = 'Publish Online';
        }
    }
}

function copyPublishedLink() {
    const linkInput = document.getElementById('published-link-input');
    if (!linkInput) return;

    navigator.clipboard.writeText(linkInput.value).then(() => {
        showToast('Public link copied to clipboard', 'success');
    });
}

function openPublishedUrlExternal() {
    const linkInput = document.getElementById('published-link-input');
    if (linkInput && linkInput.value) {
        if (typeof ipcRenderer !== 'undefined') {
            ipcRenderer.invoke('open-external', linkInput.value);
        } else {
            window.open(linkInput.value, '_blank');
        }
    }
}

// Render Published Files in Settings
function renderPublishedFilesList() {
    const container = document.getElementById('published-files-list');
    if (!container) return;

    const files = JSON.parse(localStorage.getItem('publishedFiles')) || [];

    if (files.length === 0) {
        container.innerHTML = `
            <div style="padding: 40px; text-align: center; color: var(--text-muted); font-size: 13px; background: var(--bg-surface); border-radius: var(--radius-md); border: 1px dashed var(--border-medium);">
                <iconify-icon icon="solar:cloud-upload-linear" style="font-size: 36px; opacity: 0.5; margin-bottom: 8px;"></iconify-icon>
                <div style="font-weight: 600; color: var(--text-primary); margin-bottom: 4px;">No published notes yet</div>
                <div>Use the "Publish" button in the note toolbar to publish any note to Supabase Cloud.</div>
            </div>
        `;
        return;
    }

    container.innerHTML = '';

    files.forEach((file) => {
        const card = document.createElement('div');
        card.className = 'published-file-card';
        card.setAttribute('data-id', file.id);
        const fileDate = file.date || new Date().toLocaleDateString();
        const updatedBadge = file.updatedAt ? `<span class="published-date-badge" title="Last updated: ${file.updatedAt}">• Updated: ${file.updatedAt}</span>` : '';

        card.innerHTML = `
            <div class="published-card-header">
                <div class="published-file-info">
                    <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                        <span class="published-file-name">${escapeHtml(file.name || 'Untitled')}</span>
                        <span class="published-badge-live">
                            <span class="live-dot"></span> Live
                        </span>
                        <span class="published-date-badge">${fileDate}</span>
                        ${updatedBadge}
                    </div>
                    <div class="published-url-bar">
                        <span class="published-file-url">${file.url}</span>
                        <button class="published-mini-btn" onclick="navigator.clipboard.writeText('${file.url}'); showToast('Copied public link', 'success');" title="Copy URL">
                            <iconify-icon icon="solar:copy-linear"></iconify-icon>
                        </button>
                    </div>
                </div>
                <div class="published-file-actions">
                    <button class="btn-secondary btn-sm" onclick="togglePublishedPreview('${file.id}')" id="preview-btn-${file.id}" title="Toggle live preview">
                        <iconify-icon icon="solar:eye-linear"></iconify-icon>
                        <span>Preview</span>
                    </button>
                    <button class="btn-secondary btn-sm" onclick="updatePublishedFileFromList('${file.id}')" title="Update online with latest local changes">
                        <iconify-icon icon="solar:restart-linear"></iconify-icon>
                        <span>Update</span>
                    </button>
                    <button class="btn-secondary btn-sm" onclick="ipcRenderer.invoke('open-external', '${file.url}')" title="Open in browser">
                        <iconify-icon icon="solar:arrow-right-up-linear"></iconify-icon>
                        <span>Browser</span>
                    </button>
                    <button class="btn-danger btn-sm" onclick="deletePublishedFile('${file.id}')" title="Remove from list">
                        <iconify-icon icon="solar:trash-bin-trash-linear"></iconify-icon>
                    </button>
                </div>
            </div>
            <div class="published-preview-wrap" id="preview-wrap-${file.id}" style="display: none;">
                <div class="preview-browser-bar">
                    <span class="browser-dot"></span>
                    <span class="browser-dot"></span>
                    <span class="browser-dot"></span>
                    <span class="browser-url-text">${file.url}</span>
                </div>
                <iframe class="published-file-webview" data-src="${file.url}" style="width:100%; height:260px; border:none; background:#0d0f12;"></iframe>
            </div>
        `;
        container.appendChild(card);
    });
}

// Update Published Note Directly From Settings List
async function updatePublishedFileFromList(fileId) {
    const list = JSON.parse(localStorage.getItem('publishedFiles')) || [];
    const item = list.find(f => f.id === fileId);
    if (!item) return;

    if (typeof savesDir === 'undefined') {
        showToast('Saves directory not accessible', 'error');
        return;
    }

    const safeTarget = path.basename(item.name, '.nsh');
    const filePath = path.join(savesDir, `${safeTarget}.nsh`);

    if (!fs.existsSync(filePath)) {
        showToast(`Local note file "${item.name}" not found on disk`, 'error');
        return;
    }

    try {
        showToast(`Updating "${item.name}" in cloud...`, 'info');
        let noteHTML = '';
        if (typeof activeNoteName !== 'undefined' && activeNoteName && path.basename(activeNoteName, '.nsh').toLowerCase() === safeTarget.toLowerCase()) {
            noteHTML = typeof getCleanContentHTML === 'function' ? getCleanContentHTML() : content.innerHTML;
        } else {
            noteHTML = await fsPromises.readFile(filePath, 'utf8');
        }
        noteHTML = await resolvePublishedMediaInHTML(noteHTML);

        const updated = await updateSharedNote(item, item.name, noteHTML);
        if (!updated) {
            openModal('publish-legacy-modal');
            return;
        }

        item.updatedAt = formatUpdateTime();
        localStorage.setItem('publishedFiles', JSON.stringify(list));
        renderPublishedFilesList();
        updatePublishButtonState();
        showToast(`"${item.name}" updated online successfully!`, 'success');

    } catch (err) {
        console.error('Error updating file from list:', err);
        showToast(`Update failed: ${err.message}`, 'error');
    }
}

function togglePublishedPreview(fileId) {
    const wrap = document.getElementById(`preview-wrap-${fileId}`);
    const btn = document.getElementById(`preview-btn-${fileId}`);
    if (!wrap) return;

    const isHidden = wrap.style.display === 'none';
    if (isHidden) {
        wrap.style.display = 'block';
        if (btn) btn.classList.add('active');
        const iframe = wrap.querySelector('iframe');
        if (iframe && !iframe.src && iframe.getAttribute('data-src')) {
            iframe.src = iframe.getAttribute('data-src');
        }
    } else {
        wrap.style.display = 'none';
        if (btn) btn.classList.remove('active');
    }
}

function deletePublishedFile(fileId) {
    removePublishedFile(fileId);
}

function removePublishedFile(fileId) {
    let files = JSON.parse(localStorage.getItem('publishedFiles')) || [];
    files = files.filter(f => f.id !== fileId);
    localStorage.setItem('publishedFiles', JSON.stringify(files));
    updatePublishButtonState();
    renderPublishedFilesList();
    showToast('Removed from published list', 'info');
}

// Initial state check
if (typeof activeNoteName !== 'undefined' && activeNoteName) {
    updatePublishButtonState();
}
