// Quick Capture -> "Inbox" note
// main.js forwards snippets captured with the global hotkey (Ctrl+Alt+N) here,
// so they go through the same notes folder, sidebar and Drive sync as normal saves.

const QUICK_CAPTURE_NOTE = 'Inbox';
const QUICK_CAPTURE_NOTE_INTRO = `<h1>${QUICK_CAPTURE_NOTE}</h1><p>Snippets captured with Ctrl+Alt+N from anywhere land here.</p>`;

function buildQuickCaptureEntry(text, kind) {
    const fragment = document.createDocumentFragment();

    const meta = document.createElement('p');
    meta.className = 'quick-capture-meta';
    const stamp = new Date().toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    meta.textContent = `Quick note · ${stamp}`;
    fragment.appendChild(meta);

    if (kind === 'code') {
        const lang = typeof detectCodeLanguage === 'function' ? detectCodeLanguage(text) : null;
        fragment.appendChild(buildCodeBlockElement(
            lang ? lang.mode : 'javascript',
            lang ? lang.name : 'JavaScript',
            text
        ));
    } else {
        // textContent keeps captured text inert; one paragraph per line
        text.split(/\r?\n/).forEach(line => {
            const p = document.createElement('p');
            if (line) {
                p.textContent = line;
            } else {
                p.appendChild(document.createElement('br'));
            }
            fragment.appendChild(p);
        });
    }

    const spacer = document.createElement('p');
    spacer.appendChild(document.createElement('br'));
    fragment.appendChild(spacer);
    return fragment;
}

async function appendQuickCaptureToInbox(text, kind) {
    await invokeSavesDir();
    const entry = buildQuickCaptureEntry(text, kind);

    // Inbox is open in the editor: append live and save, so unsaved edits there aren't overwritten
    if (activeNoteName === QUICK_CAPTURE_NOTE && content) {
        const appendLive = () => {
            content.appendChild(entry);
            processCodeBlock();
        };
        if (window.NoshUndo) window.NoshUndo.runWithUndo(appendLive);
        else appendLive();
        hasUnsavedChanges = true;
        await saveFile();
        if (hasUnsavedChanges) {
            throw new Error('Saving the open Inbox note failed');
        }
        return;
    }

    const filePath = path.join(savesDir, `${QUICK_CAPTURE_NOTE}.nsh`);
    let existing;
    let isNewNote = false;
    try {
        existing = await fsPromises.readFile(filePath, 'utf8');
    } catch (err) {
        if (err.code !== 'ENOENT') throw err;
        existing = QUICK_CAPTURE_NOTE_INTRO;
        isNewNote = true;
    }

    const holder = document.createElement('div');
    holder.appendChild(entry);
    const updatedHTML = existing + holder.innerHTML;
    await fsPromises.writeFile(filePath, updatedHTML, 'utf8');

    if (typeof invalidateVaultDashboardCache === 'function') {
        invalidateVaultDashboardCache();
    }
    if (typeof updateNoteSearchCache === 'function') {
        const textHolder = document.createElement('div');
        textHolder.innerHTML = updatedHTML;
        updateNoteSearchCache(QUICK_CAPTURE_NOTE, textHolder.textContent);
    }

    if (isNewNote) {
        // Re-render the sidebar so the new Inbox note shows up (keeps the active note)
        await readDatabase();
        return;
    }

    const item = typeof findNoteElement === 'function'
        ? findNoteElement(QUICK_CAPTURE_NOTE)
        : document.querySelector(`.save[data-file="${QUICK_CAPTURE_NOTE}"]`);
    if (item) {
        item.setAttribute('data-mtime', Date.now());
        if (typeof sortSaves === 'function') sortSaves();

        if (item.classList.contains('drive-save') && typeof uploadFileToDrive === 'function') {
            uploadFileToDrive(filePath, updatedHTML).catch(err => {
                console.error('Quick Capture Drive upload error:', err);
            });
        }
    }
}

ipcRenderer.on('quick-capture-append', async (event, request) => {
    const { requestId, text, kind } = request || {};
    try {
        await appendQuickCaptureToInbox(String(text || ''), kind === 'text' ? 'text' : 'code');
        if (activeNoteName !== QUICK_CAPTURE_NOTE && typeof showToast === 'function') {
            showToast(`Saved to ${QUICK_CAPTURE_NOTE}`, 'success');
        }
        ipcRenderer.send('quick-capture-result', { requestId, success: true });
    } catch (err) {
        console.error('Quick Capture append error:', err);
        ipcRenderer.send('quick-capture-result', { requestId, success: false, error: `Could not save to ${QUICK_CAPTURE_NOTE}` });
    }
});
