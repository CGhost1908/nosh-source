// Note Version History
// Every time a note is saved, the version that is about to be overwritten can be kept as a
// snapshot in <notes folder>/.history/<note name>/<version time>.nsh, so an earlier state
// can be previewed and restored. Snapshots are plain .nsh files: the note format and Drive
// sync are untouched, and the folder is ignored by the vault scanners.

const NOTE_HISTORY_DIR = '.history';
const HISTORY_MIN_INTERVAL_MS = 5 * 60 * 1000; // at most one automatic snapshot per note every 5 minutes
const HISTORY_MAX_SNAPSHOTS = 50;
const HISTORY_ID_PATTERN = /^\d{10,16}$/;

function getNoteHistoryDir(noteName) {
    return path.join(savesDir, NOTE_HISTORY_DIR, path.basename(String(noteName)));
}

async function getHistoryIds(noteName) {
    try {
        const files = await fsPromises.readdir(getNoteHistoryDir(noteName));
        return files
            .filter(f => f.endsWith('.nsh') && HISTORY_ID_PATTERN.test(path.basename(f, '.nsh')))
            .map(f => path.basename(f, '.nsh'))
            .sort((a, b) => Number(b) - Number(a)); // newest version first
    } catch (err) {
        return [];
    }
}

// List the saved versions of a note, newest first
async function listNoteHistory(noteName) {
    const dir = getNoteHistoryDir(noteName);
    const ids = await getHistoryIds(noteName);
    const entries = await Promise.all(ids.map(async (id) => {
        try {
            const stat = await fsPromises.stat(path.join(dir, `${id}.nsh`));
            return { id, timestamp: Number(id), size: stat.size };
        } catch (err) {
            return null;
        }
    }));
    return entries.filter(Boolean);
}

async function pruneNoteHistory(noteName) {
    const ids = await getHistoryIds(noteName);
    const dir = getNoteHistoryDir(noteName);
    for (const id of ids.slice(HISTORY_MAX_SNAPSHOTS)) {
        await fsPromises.unlink(path.join(dir, `${id}.nsh`)).catch(() => {});
    }
}

// Save a snapshot of `html` taken as it was at `timestamp`.
// Never throws: a history problem must not get in the way of saving the note.
// Returns the snapshot id, or null when nothing was written.
async function snapshotNote(noteName, html, { timestamp = Date.now(), force = false } = {}) {
    try {
        if (!noteName || typeof html !== 'string' || !html.trim()) return null;

        const dir = getNoteHistoryDir(noteName);
        const ids = await getHistoryIds(noteName);
        const id = String(Math.floor(timestamp));
        if (ids.includes(id)) return null; // this exact version is already kept

        if (ids.length > 0) {
            const latestPath = path.join(dir, `${ids[0]}.nsh`);
            if (!force) {
                // Throttle on when the last snapshot was taken, not on the version's own time,
                // so the state before a long break is never skipped
                const latestStat = await fsPromises.stat(latestPath);
                if (Date.now() - latestStat.mtimeMs < HISTORY_MIN_INTERVAL_MS) return null;
            }
            const latestHtml = await fsPromises.readFile(latestPath, 'utf8');
            if (latestHtml === html) return null;
        }

        await fsPromises.mkdir(dir, { recursive: true });
        await fsPromises.writeFile(path.join(dir, `${id}.nsh`), html, 'utf8');
        await pruneNoteHistory(noteName);
        return id;
    } catch (err) {
        console.warn('Could not save note history snapshot:', err);
        return null;
    }
}

// Called by saveFile() right before it overwrites the note on disk
async function captureHistoryBeforeSave(noteName, filePath, newHtml) {
    try {
        const stat = await fsPromises.stat(filePath);
        const previousHtml = await fsPromises.readFile(filePath, 'utf8');
        if (previousHtml === newHtml) return;
        await snapshotNote(noteName, previousHtml, { timestamp: stat.mtimeMs });
    } catch (err) {
        if (err.code !== 'ENOENT') console.warn('History capture skipped:', err);
    }
}

async function readNoteSnapshot(noteName, id) {
    if (!HISTORY_ID_PATTERN.test(String(id))) throw new Error('Invalid version id');
    return fsPromises.readFile(path.join(getNoteHistoryDir(noteName), `${id}.nsh`), 'utf8');
}

async function renameNoteHistory(oldName, newName) {
    try {
        const from = getNoteHistoryDir(oldName);
        const to = getNoteHistoryDir(newName);
        if (!fs.existsSync(from) || fs.existsSync(to)) return;
        await fsPromises.rename(from, to);
    } catch (err) {
        console.warn('Could not move note history on rename:', err);
    }
}

async function deleteNoteHistory(noteName) {
    try {
        await fsPromises.rm(getNoteHistoryDir(noteName), { recursive: true, force: true });
    } catch (err) {
        console.warn('Could not delete note history:', err);
    }
}

// Turn saved note HTML into inert plain text for the preview (nothing is ever executed or rendered)
function historyHtmlToText(html) {
    const doc = new DOMParser().parseFromString(html || '', 'text/html');
    doc.querySelectorAll('.CodeMirror, .media-toolbar, .media-resize-handle, script, style').forEach(el => el.remove());

    doc.querySelectorAll('textarea.code').forEach(ta => {
        ta.replaceWith(doc.createTextNode(`\n\`\`\`\n${ta.value || ta.textContent || ''}\n\`\`\`\n`));
    });
    doc.querySelectorAll('input.checklist-checkbox').forEach(cb => {
        cb.replaceWith(doc.createTextNode(cb.hasAttribute('checked') ? '[x] ' : '[ ] '));
    });
    doc.querySelectorAll('img, video').forEach(el => {
        el.replaceWith(doc.createTextNode(`[${el.tagName.toLowerCase()}]`));
    });
    doc.querySelectorAll('br').forEach(br => br.replaceWith(doc.createTextNode('\n')));
    doc.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6, li, pre, tr, blockquote').forEach(el => {
        el.append(doc.createTextNode('\n'));
    });

    return (doc.body.textContent || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function countWords(text) {
    const trimmed = (text || '').trim();
    return trimmed ? trimmed.split(/\s+/).length : 0;
}

// Restore a snapshot as the current content of the note.
// The content being replaced is snapshotted first, so a restore can always be undone.
async function restoreNoteSnapshot(noteName, id) {
    const safeName = path.basename(noteName);
    const filePath = path.join(savesDir, `${safeName}.nsh`);

    const snapshotHtml = await readNoteSnapshot(safeName, id);

    let currentHtml = null;
    if (activeNoteName === safeName && hasUnsavedChanges && typeof getCleanContentHTML === 'function') {
        currentHtml = getCleanContentHTML(); // keep unsaved edits too
    } else if (fs.existsSync(filePath)) {
        currentHtml = await fsPromises.readFile(filePath, 'utf8');
    }
    if (currentHtml && currentHtml !== snapshotHtml) {
        await snapshotNote(safeName, currentHtml, { force: true });
    }

    await fsPromises.writeFile(filePath, snapshotHtml, 'utf8');
    hasUnsavedChanges = false;
    if (typeof unsavedDot !== 'undefined' && unsavedDot) unsavedDot.classList.remove('active');

    if (typeof invalidateVaultDashboardCache === 'function') invalidateVaultDashboardCache();
    await readDatabase(safeName);

    const item = typeof findNoteElement === 'function' ? findNoteElement(safeName) : null;
    if (item && item.classList.contains('drive-save') && typeof uploadFileToDrive === 'function') {
        uploadFileToDrive(filePath, snapshotHtml).catch(err => console.error('History restore Drive upload error:', err));
    }
}

// ---------- Version history panel ----------

let historyPanelNote = null;
let historyPanelSelectedId = null;

function historyTimeLabel(timestamp) {
    return typeof formatRelativeTime === 'function'
        ? formatRelativeTime(timestamp)
        : new Date(timestamp).toLocaleString();
}

async function openNoteHistory() {
    if (!activeNoteName) {
        showToast('Open a note first', 'warning');
        return;
    }
    historyPanelNote = activeNoteName;
    historyPanelSelectedId = null;

    const title = document.getElementById('history-note-name');
    if (title) title.textContent = historyPanelNote;

    await renderHistoryList();
    openModal('history-modal');
}

async function renderHistoryList() {
    const list = document.getElementById('history-list');
    const empty = document.getElementById('history-empty');
    const layout = document.getElementById('history-layout');
    if (!list) return;

    const entries = await listNoteHistory(historyPanelNote);
    list.textContent = '';

    if (empty) empty.style.display = entries.length ? 'none' : 'block';
    if (layout) layout.style.display = entries.length ? 'flex' : 'none';

    entries.forEach(entry => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'history-item';
        row.dataset.id = entry.id;

        const when = document.createElement('span');
        when.className = 'history-item-time';
        when.textContent = historyTimeLabel(entry.timestamp);

        const meta = document.createElement('span');
        meta.className = 'history-item-meta';
        const sizeLabel = entry.size < 1024 ? `${entry.size} B` : `${(entry.size / 1024).toFixed(1)} KB`;
        meta.textContent = `${new Date(entry.timestamp).toLocaleString()} · ${sizeLabel}`;

        row.append(when, meta);
        row.addEventListener('click', () => selectHistoryEntry(entry.id));
        list.appendChild(row);
    });

    if (entries.length) {
        await selectHistoryEntry(entries[0].id);
    } else {
        updateHistoryRestoreButton();
    }
}

function updateHistoryRestoreButton() {
    const btn = document.getElementById('history-restore-btn');
    if (btn) btn.disabled = !historyPanelSelectedId;
}

async function selectHistoryEntry(id) {
    historyPanelSelectedId = id;
    document.querySelectorAll('#history-list .history-item').forEach(el => {
        el.classList.toggle('active', el.dataset.id === id);
    });
    updateHistoryRestoreButton();

    const preview = document.getElementById('history-preview');
    const stats = document.getElementById('history-preview-stats');
    if (!preview) return;

    try {
        const html = await readNoteSnapshot(historyPanelNote, id);
        if (historyPanelSelectedId !== id) return; // user clicked another version meanwhile
        const text = historyHtmlToText(html);
        preview.textContent = text || '(empty note)';
        if (stats) {
            const currentWords = content ? countWords(content.innerText) : 0;
            stats.textContent = `${countWords(text)} words in this version · ${currentWords} in the current note`;
        }
    } catch (err) {
        preview.textContent = 'Could not read this version.';
        if (stats) stats.textContent = '';
    }
}

async function restoreSelectedHistoryEntry() {
    if (!historyPanelNote || !historyPanelSelectedId) return;
    const label = historyTimeLabel(Number(historyPanelSelectedId));
    try {
        await restoreNoteSnapshot(historyPanelNote, historyPanelSelectedId);
        closeAllModals();
        showToast(`Restored version from ${label}. Your previous text is in history too.`, 'success');
    } catch (err) {
        console.error('Error restoring version:', err);
        showToast('Could not restore this version', 'error');
    }
}
